import { PluginSettingTab, Setting, type App } from "obsidian";
import type RemindersPanelPlugin from "./main";
import { DEFAULT_HELPER_PATH, DEFAULT_SETTINGS, defaultSnapshotPath, type RemindersPanelSettings } from "./settings";
import type { Container } from "./types";

type NumKey = "daysAhead" | "completedLookbackDays" | "refreshMinutes" | "staleMinutes";
type BoolKey = "showEvents" | "reminderWriteback" | "calendarWriteback" | "dryRun";

export class RemindersSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private readonly plugin: RemindersPanelPlugin,
  ) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    const p = this.plugin;
    const s = p.settings;
    const macOnly = p.state.mode === "view" ? "Mac only. " : "";
    containerEl.empty();
    containerEl.addClass("reminders-panel-settings");

    // Status line
    const modeText =
      p.state.mode === "edit"
        ? `Mode: edit. Helper version ${p.state.helperVersion ?? "unknown"}.`
        : `Mode: view only.${p.state.hint ? " " + p.state.hint : ""}`;
    new Setting(containerEl).setName("Status").setDesc(modeText);

    new Setting(containerEl).setName("Helper (Mac)").setHeading();

    new Setting(containerEl)
      .setName("Helper path")
      .setDesc(`${macOnly}Path to the reminders-helper binary. A leading ~ means your home folder.`)
      .addText((t) =>
        t
          .setPlaceholder(DEFAULT_HELPER_PATH)
          .setValue(s.helperPath)
          .onChange(async (v) => {
            s.helperPath = v.trim() || DEFAULT_HELPER_PATH;
            await p.saveSettings();
          }),
      )
      .addButton((b) =>
        b.setButtonText("Check helper").onClick(async () => {
          await p.recheckHelper();
          this.display();
        }),
      );

    new Setting(containerEl)
      .setName("Device label")
      .setDesc(`${macOnly}Name shown on other devices as the source of the data.`)
      .addText((t) =>
        t
          .setPlaceholder(p.defaultDeviceLabel())
          .setValue(s.deviceLabel)
          .onChange(async (v) => {
            s.deviceLabel = v;
            await p.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Snapshot file")
      .setDesc("Vault-relative path. Empty means the default in the plugin folder. Use the same value on every device.")
      .addText((t) =>
        t
          .setPlaceholder(defaultSnapshotPath(this.app.vault.configDir))
          .setValue(s.snapshotPath)
          .onChange(async (v) => {
            s.snapshotPath = v.trim();
            await p.saveSettings();
          }),
      );

    new Setting(containerEl).setName("Display").setHeading();
    this.num("daysAhead", "Days ahead", "How many days count as upcoming, including today. 1 to 60.");
    this.num("completedLookbackDays", "Completed days", "Show reminders completed in this many days. 0 hides them. 1 means today.");
    this.num("refreshMinutes", "Refresh every (minutes)", `${macOnly}How often to reload from the helper.`, true);
    this.num("staleMinutes", "Stale after (minutes)", "Show a warning when the data is older than this.");
    this.bool("showEvents", "Show calendar events", "Show events below the reminders.");

    const snap = p.state.snapshot;
    new Setting(containerEl)
      .setName("Default list")
      .setDesc(`${macOnly}List for new reminders.`)
      .addDropdown((d) => {
        d.addOption("", "Helper default");
        for (const l of (snap?.lists ?? []).filter((x) => x.allowsModify)) d.addOption(l.id, l.title);
        if (s.defaultListId && !snap?.lists.some((l) => l.id === s.defaultListId)) d.addOption(s.defaultListId, "(Unknown list)");
        d.setValue(s.defaultListId).onChange(async (v) => {
          s.defaultListId = v;
          await p.saveSettings();
        });
      });
    new Setting(containerEl)
      .setName("Default calendar")
      .setDesc(`${macOnly}Calendar for time blocks.`)
      .addDropdown((d) => {
        d.addOption("", "Helper default");
        for (const c of (snap?.calendars ?? []).filter((x) => x.allowsModify)) d.addOption(c.id, c.title);
        if (s.defaultCalendarId && !snap?.calendars.some((c) => c.id === s.defaultCalendarId)) {
          d.addOption(s.defaultCalendarId, "(Unknown calendar)");
        }
        d.setValue(s.defaultCalendarId).onChange(async (v) => {
          s.defaultCalendarId = v;
          await p.saveSettings();
        });
      });

    new Setting(containerEl).setName("Shown lists").setHeading();
    this.visibility(snap?.lists ?? [], "hiddenListIds", "Lists appear here after the first load.");
    new Setting(containerEl).setName("Shown calendars").setHeading();
    this.visibility(snap?.calendars ?? [], "hiddenCalendarIds", "Calendars appear here after the first load.");

    new Setting(containerEl).setName("Changes (Mac)").setHeading();
    containerEl.createEl("p", {
      cls: "setting-item-description",
      text: "There is no delete action. Changes go to Apple Reminders and Calendar through the helper.",
    });
    this.bool("reminderWriteback", "Allow reminder changes", `${macOnly}Complete, edit and add reminders.`);
    this.bool("calendarWriteback", "Allow calendar changes", `${macOnly}Create time blocks and edit events.`);
    this.bool("dryRun", "Dry run", `${macOnly}Do not send changes. Show what would be sent and log it below.`);

    new Setting(containerEl).setName("Dry run log").setHeading();
    const entries = p.dryRunLog.list();
    if (entries.length === 0) {
      containerEl.createEl("p", { cls: "setting-item-description", text: "No entries in this session." });
    } else {
      new Setting(containerEl).setDesc(`${entries.length} entries, newest first. Kept in memory only.`).addButton((b) =>
        b.setButtonText("Clear log").onClick(() => {
          p.dryRunLog.clear();
          this.display();
        }),
      );
      const box = containerEl.createDiv({ cls: "reminders-panel-log" });
      for (const e of entries) {
        const line = box.createDiv({ cls: "reminders-panel-log-entry" });
        line.createSpan({ cls: "reminders-panel-log-time", text: new Date(e.at).toLocaleTimeString() + " " });
        line.createEl("code", { text: `${e.command} ${JSON.stringify(e.payload)}` });
      }
    }
  }

  private num(key: NumKey, name: string, desc: string, resetTimers = false): void {
    const p = this.plugin;
    new Setting(this.containerEl)
      .setName(name)
      .setDesc(desc)
      .addText((t) => {
        t.inputEl.type = "number";
        t.setPlaceholder(String(DEFAULT_SETTINGS[key]))
          .setValue(String(p.settings[key]))
          .onChange(async (v) => {
            const n = Number(v);
            if (v.trim() === "" || !Number.isFinite(n)) return;
            (p.settings as RemindersPanelSettings)[key] = n;
            await p.saveSettings();
            if (resetTimers) p.resetTimers();
            if (key === "daysAhead" || key === "completedLookbackDays") void p.refresh();
          });
      });
  }

  private bool(key: BoolKey, name: string, desc: string): void {
    const p = this.plugin;
    new Setting(this.containerEl)
      .setName(name)
      .setDesc(desc)
      .addToggle((t) =>
        t.setValue(p.settings[key]).onChange(async (v) => {
          p.settings[key] = v;
          await p.saveSettings();
        }),
      );
  }

  private visibility(items: Container[], key: "hiddenListIds" | "hiddenCalendarIds", emptyText: string): void {
    const p = this.plugin;
    if (items.length === 0) {
      this.containerEl.createEl("p", { cls: "setting-item-description", text: emptyText });
      return;
    }
    for (const c of items) {
      new Setting(this.containerEl)
        .setName(c.title)
        .setDesc(c.source + (c.allowsModify ? "" : " (read only)"))
        .addToggle((t) =>
          t.setValue(!p.settings[key].includes(c.id)).onChange(async (show) => {
            const set = new Set(p.settings[key]);
            if (show) set.delete(c.id);
            else set.add(c.id);
            p.settings[key] = [...set];
            await p.saveSettings();
          }),
        );
    }
  }
}
