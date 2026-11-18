import { Notice, Platform, Plugin, type WorkspaceLeaf } from "obsidian";
import { HelperBridge, expandHome } from "./bridge";
import { describeError, HelperError } from "./envelope";
import { DryRunLog, canWrite, decideMode, gateWrite } from "./gate";
import { nodeExecFile, nodeFileExists, nodeHomedir, nodeHostname } from "./node";
import { buildNoteLink } from "./payloads";
import { normalizeSettings, parentFolder, resolveSnapshotPath, type RemindersPanelSettings } from "./settings";
import {
  buildSnapshotFile,
  parseSnapshotFile,
  serializeSnapshotFile,
  shouldWriteSnapshot,
  snapshotKey,
  snapshotProblem,
  type LastWrite,
} from "./snapshotFile";
import { RemindersSettingTab } from "./settingsTab";
import type { Mode, Snapshot, WriteCommand } from "./types";
import { ReminderModal } from "./modals";
import { RemindersPanelView, VIEW_TYPE } from "./view";

const FOCUS_THROTTLE_MS = 30 * 1000;
const VIEW_MODE_POLL_MS = 60 * 1000;

export interface PanelState {
  /** False until the first mode check is done. */
  ready: boolean;
  mode: Mode;
  hint: string | null;
  helperVersion: string | null;
  snapshot: Snapshot | null;
  /** Edit mode: snapshot generatedAt. View mode: file writtenAt. */
  updatedAtMs: number | null;
  writtenBy: string | null;
  /** Why there is no data, shown as the empty state. */
  emptyReason: string | null;
  lastError: string | null;
  loading: boolean;
}

export type WriteOutcome = "sent" | "dryRun" | "blocked" | "failed";

export default class RemindersPanelPlugin extends Plugin {
  settings!: RemindersPanelSettings;
  readonly dryRunLog = new DryRunLog();
  state: PanelState = {
    ready: false,
    mode: "view",
    hint: null,
    helperVersion: null,
    snapshot: null,
    updatedAtMs: null,
    writtenBy: null,
    emptyReason: null,
    lastError: null,
    loading: false,
  };

  private bridge: HelperBridge | null = null;
  private listeners = new Set<() => void>();
  private refreshing: Promise<void> | null = null;
  private refreshAgain = false;
  private lastWrite: LastWrite | null = null;
  private lastFocusRefresh = 0;
  private editTimer: number | null = null;
  private viewTimer: number | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();

    this.registerView(VIEW_TYPE, (leaf: WorkspaceLeaf) => new RemindersPanelView(leaf, this));
    this.addRibbonIcon("list-checks", "Open reminders panel", () => void this.activateView());
    this.addSettingTab(new RemindersSettingTab(this.app, this));

    this.addCommand({ id: "open-panel", name: "Open panel", callback: () => void this.activateView() });
    this.addCommand({ id: "refresh", name: "Refresh", callback: () => void this.refresh(true) });
    this.addCommand({ id: "new-reminder", name: "New reminder", callback: () => this.openNewReminder() });
    this.addCommand({
      id: "new-reminder-from-note",
      name: "New reminder from current note",
      callback: () => this.openNewReminderFromNote(),
    });
    this.addCommand({ id: "request-access", name: "Request access", callback: () => void this.requestAccess() });

    this.registerDomEvent(window, "focus", () => {
      if (this.state.mode !== "edit") return;
      const now = Date.now();
      if (now - this.lastFocusRefresh < FOCUS_THROTTLE_MS) return;
      this.lastFocusRefresh = now;
      void this.refresh();
    });
    this.registerDomEvent(document, "visibilitychange", () => {
      if (this.state.mode === "view" && document.visibilityState === "visible" && this.panelIsOpen()) {
        void this.refresh();
      }
    });

    this.app.workspace.onLayoutReady(() => void this.start());
  }

  onunload(): void {
    this.clearTimers();
    this.listeners.clear();
  }

  // Settings

  async loadSettings(): Promise<void> {
    this.settings = normalizeSettings(await this.loadData());
  }

  async saveSettings(): Promise<void> {
    this.settings = normalizeSettings(this.settings);
    await this.saveData(this.settings);
    this.notify();
  }

  /** Call after changing helperPath. */
  async recheckHelper(): Promise<void> {
    this.bridge = null;
    await this.detectMode();
    this.resetTimers();
    await this.refresh(true);
  }

  /** Call after changing refreshMinutes. */
  resetTimers(): void {
    this.clearTimers();
    if (this.state.mode === "edit") {
      this.editTimer = window.setInterval(() => void this.refresh(), this.settings.refreshMinutes * 60 * 1000);
      this.registerInterval(this.editTimer);
    } else {
      this.viewTimer = window.setInterval(() => {
        if (document.visibilityState === "visible" && this.panelIsOpen()) void this.refresh();
      }, VIEW_MODE_POLL_MS);
      this.registerInterval(this.viewTimer);
    }
  }

  private clearTimers(): void {
    if (this.editTimer !== null) window.clearInterval(this.editTimer);
    if (this.viewTimer !== null) window.clearInterval(this.viewTimer);
    this.editTimer = null;
    this.viewTimer = null;
  }

  // State

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  notify(): void {
    for (const fn of this.listeners) {
      try {
        fn();
      } catch (e) {
        console.error("Reminders Panel: render failed", e);
      }
    }
  }

  private setState(patch: Partial<PanelState>): void {
    this.state = { ...this.state, ...patch };
    this.notify();
  }

  snapshotPath(): string {
    return resolveSnapshotPath(this.settings.snapshotPath, this.app.vault.configDir);
  }

  deviceLabel(): string {
    if (this.settings.deviceLabel.trim() !== "") return this.settings.deviceLabel.trim();
    return this.defaultDeviceLabel();
  }

  defaultDeviceLabel(): string {
    if (Platform.isDesktopApp) {
      try {
        const h = nodeHostname().replace(/\.local$/, "");
        if (h) return h;
      } catch {
        // fall through
      }
    }
    return "Mac";
  }

  expandedHelperPath(): string {
    if (!Platform.isDesktopApp) return this.settings.helperPath;
    try {
      return expandHome(this.settings.helperPath, nodeHomedir());
    } catch {
      return this.settings.helperPath;
    }
  }

  canWrite(kind: "reminder" | "event"): boolean {
    return canWrite(this.state.mode, kind, this.settings);
  }

  private panelIsOpen(): boolean {
    return this.app.workspace.getLeavesOfType(VIEW_TYPE).length > 0;
  }

  // Startup and mode

  private async start(): Promise<void> {
    await this.detectMode();
    this.resetTimers();
    await this.refresh();
  }

  private async detectMode(): Promise<void> {
    const isDesktopApp = Platform.isDesktopApp;
    const isMacOS = Platform.isMacOS;
    let helperExists = false;
    let contractVersion: number | null = null;
    let helperVersion: string | null = null;
    const path = this.expandedHelperPath();

    if (isDesktopApp && isMacOS) {
      helperExists = nodeFileExists(path);
      if (helperExists) {
        const bridge = new HelperBridge(nodeExecFile(), path);
        try {
          const v = await bridge.version();
          contractVersion = v.contractVersion;
          helperVersion = v.helperVersion;
          this.bridge = bridge;
        } catch (e) {
          console.warn("Reminders Panel: helper version failed", e);
        }
      }
    }
    const d = decideMode({ isDesktopApp, isMacOS, helperExists, contractVersion }, path);
    if (d.mode !== "edit") this.bridge = null;
    this.setState({ ready: true, mode: d.mode, hint: d.hint, helperVersion });
  }

  // Refresh

  /** Refreshes from the helper (edit mode) or the snapshot file (view mode). Calls are merged. */
  async refresh(manual = false): Promise<void> {
    if (!this.state.ready) return;
    if (this.refreshing) {
      this.refreshAgain = true;
      return this.refreshing;
    }
    this.refreshing = (async () => {
      do {
        this.refreshAgain = false;
        this.setState({ loading: true });
        try {
          if (this.state.mode === "edit") await this.refreshFromHelper();
          else await this.refreshFromFile();
        } finally {
          this.setState({ loading: false });
        }
      } while (this.refreshAgain);
    })();
    try {
      await this.refreshing;
    } finally {
      this.refreshing = null;
    }
    if (manual && this.state.lastError) new Notice(this.state.lastError);
  }

  private async refreshFromHelper(): Promise<void> {
    const bridge = this.bridge;
    if (!bridge) return;
    try {
      const snap = await bridge.snapshot({
        daysAhead: this.settings.daysAhead,
        completedLookbackDays: this.settings.completedLookbackDays,
      });
      const problem = snapshotProblem(snap);
      if (problem) throw new HelperError("internal", `The helper sent a bad snapshot (${problem}).`);
      const ms = Date.parse(snap.generatedAt);
      this.setState({
        snapshot: snap,
        updatedAtMs: Number.isNaN(ms) ? Date.now() : ms,
        writtenBy: null,
        emptyReason: null,
        lastError: null,
      });
      await this.maybeWriteSnapshotFile(snap);
    } catch (e) {
      this.setState({
        lastError: describeError(e),
        emptyReason: this.state.snapshot ? null : "Could not load data from the helper.",
      });
    }
  }

  private async maybeWriteSnapshotFile(snap: Snapshot): Promise<void> {
    // Only edit mode writes the file (contract section 7).
    if (this.state.mode !== "edit") return;
    const now = new Date();
    if (!shouldWriteSnapshot(this.lastWrite, snap, now.getTime())) return;
    const path = this.snapshotPath();
    const adapter = this.app.vault.adapter;
    try {
      const folder = parentFolder(path);
      if (folder && !(await adapter.exists(folder))) await adapter.mkdir(folder);
      await adapter.write(path, serializeSnapshotFile(buildSnapshotFile(snap, this.deviceLabel(), now)));
      this.lastWrite = { key: snapshotKey(snap), atMs: now.getTime() };
    } catch (e) {
      console.error("Reminders Panel: could not write snapshot file", e);
      this.setState({ lastError: `Could not write the snapshot file at ${path}.` });
    }
  }

  private async refreshFromFile(): Promise<void> {
    const path = this.snapshotPath();
    const adapter = this.app.vault.adapter;
    let text: string | null = null;
    try {
      text = (await adapter.exists(path)) ? await adapter.read(path) : null;
    } catch {
      this.setState({
        snapshot: null,
        updatedAtMs: null,
        writtenBy: null,
        emptyReason: `Could not read the snapshot file at ${path}.`,
        lastError: null,
      });
      return;
    }
    const res = parseSnapshotFile(text);
    if (!res.ok) {
      const extra =
        res.reason === "missing"
          ? ` Expected at ${path}. Open Obsidian on your Mac with the helper installed, then wait for sync.`
          : ` File: ${path}.`;
      this.setState({
        snapshot: null,
        updatedAtMs: null,
        writtenBy: null,
        emptyReason: res.detail + extra,
        lastError: null,
      });
      return;
    }
    this.setState({
      snapshot: res.file.snapshot,
      updatedAtMs: Date.parse(res.file.writtenAt),
      writtenBy: res.file.writtenBy,
      emptyReason: null,
      lastError: null,
    });
  }

  // Writes

  /** Runs a write through the gate. Refreshes after a real write. Never updates optimistically. */
  async runWrite(command: WriteCommand, payload: object): Promise<WriteOutcome> {
    const decision = gateWrite(this.state.mode, command, payload, this.settings);
    if (decision.action === "blocked") {
      new Notice(decision.reason);
      return "blocked";
    }
    if (decision.action === "dryRun") {
      this.dryRunLog.add(command, payload);
      new Notice(decision.notice, 8000);
      this.notify();
      return "dryRun";
    }
    const bridge = this.bridge;
    if (!bridge) {
      new Notice("The helper is not available.");
      return "failed";
    }
    try {
      await bridge.call(command, payload);
    } catch (e) {
      new Notice(describeError(e), 8000);
      return "failed";
    }
    await this.refresh();
    return "sent";
  }

  async requestAccess(): Promise<void> {
    if (this.state.mode !== "edit" || !this.bridge) {
      new Notice("Access can only be requested on a Mac with the helper installed.");
      return;
    }
    try {
      await this.bridge.requestAccess({ reminders: true, events: true });
    } catch (e) {
      new Notice(describeError(e), 8000);
    }
    await this.refresh(true);
  }

  // Commands

  async activateView(): Promise<void> {
    const { workspace } = this.app;
    let leaf: WorkspaceLeaf | null = workspace.getLeavesOfType(VIEW_TYPE)[0] ?? null;
    if (!leaf) {
      leaf = workspace.getRightLeaf(false);
      if (!leaf) return;
      await leaf.setViewState({ type: VIEW_TYPE, active: true });
    }
    await workspace.revealLeaf(leaf);
    if (this.state.mode === "view") void this.refresh();
  }

  private writeBlockedReason(): string | null {
    if (this.state.mode !== "edit") return "View only on this device.";
    if (!this.settings.reminderWriteback) return "Reminder changes are off in settings.";
    return null;
  }

  openNewReminder(initial?: { title?: string; notes?: string }): void {
    const reason = this.writeBlockedReason();
    if (reason) {
      new Notice(reason);
      return;
    }
    new ReminderModal(this.app, this, { kind: "create", initial }).open();
  }

  private openNewReminderFromNote(): void {
    const file = this.app.workspace.getActiveFile();
    if (!file) {
      new Notice("Open a note first.");
      return;
    }
    this.openNewReminder({
      title: file.basename,
      notes: buildNoteLink(this.app.vault.getName(), file.path),
    });
  }
}
