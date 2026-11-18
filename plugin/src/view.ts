import { ItemView, Menu, Notice, setIcon, type WorkspaceLeaf } from "obsidian";
import { dayLabel, localDateOf, parseIso, relativeTime, shortStamp, localTimeOf } from "./dates";
import { eventKey, groupEvents, groupReminders } from "./grouping";
import type RemindersPanelPlugin from "./main";
import { EventModal, ReminderModal, TimeBlockModal } from "./modals";
import { buildCompleteToggle, buildReminderCreate, pickDefaultContainer, priorityLevel } from "./payloads";
import type { AccessStatus, CalEvent, Container, Reminder } from "./types";

export const VIEW_TYPE = "reminders-panel-view";

const P = "reminders-panel-";

function accessHelp(status: AccessStatus, what: "Reminders" | "Calendars"): string | null {
  if (status === "fullAccess") return null;
  if (status === "notDetermined") return null;
  return `No access to ${what}. Open System Settings, then Privacy and Security, then ${what}, and allow access.`;
}

export class RemindersPanelView extends ItemView {
  private unsubscribe: (() => void) | null = null;
  private headerEl!: HTMLElement;
  private quickAddEl!: HTMLElement;
  private bodyEl!: HTMLElement;
  private collapsed = new Map<string, boolean>([
    ["noDate", true],
    ["completed", true],
  ]);
  // Quick add values survive re-renders.
  private qa = { title: "", date: "", time: "", listId: "" };
  private qaListTouched = false;
  private qaBusy = false;
  private qaSig = "";

  constructor(
    leaf: WorkspaceLeaf,
    private readonly plugin: RemindersPanelPlugin,
  ) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Reminders";
  }

  getIcon(): string {
    return "list-checks";
  }

  async onOpen(): Promise<void> {
    const root = this.contentEl;
    root.empty();
    root.addClass(P + "root");
    this.headerEl = root.createDiv({ cls: P + "header" });
    this.quickAddEl = root.createDiv({ cls: P + "quick-add" });
    this.bodyEl = root.createDiv({ cls: P + "body" });
    this.unsubscribe = this.plugin.subscribe(() => this.render());
    this.render();
    if (this.plugin.state.ready && this.plugin.state.mode === "view") void this.plugin.refresh();
  }

  async onClose(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  private render(): void {
    if (!this.headerEl) return;
    this.renderHeader();
    this.renderQuickAdd();
    this.renderBody();
  }

  // Header

  private renderHeader(): void {
    const s = this.plugin.state;
    const el = this.headerEl;
    el.empty();
    const top = el.createDiv({ cls: P + "header-top" });
    const status = top.createDiv({ cls: P + "status" });
    const now = Date.now();

    if (!s.ready) {
      status.setText("Loading...");
    } else if (s.updatedAtMs !== null) {
      const stamp = shortStamp(s.updatedAtMs, now);
      if (s.mode === "edit") {
        status.setText(`Updated ${stamp}`);
      } else {
        status.setText(`View only. From ${s.writtenBy || "unknown"} at ${stamp} (${relativeTime(s.updatedAtMs, now)})`);
      }
      if (now - s.updatedAtMs > this.plugin.settings.staleMinutes * 60000) {
        status.addClass(P + "stale");
        status.setAttr("title", "This data is old.");
      }
    } else {
      status.setText(s.mode === "edit" ? "Not loaded yet" : "View only");
    }

    const btn = top.createEl("button", { cls: [P + "icon-button", "clickable-icon"], attr: { "aria-label": "Refresh" } });
    setIcon(btn, "refresh-cw");
    if (s.loading) btn.addClass(P + "spinning");
    btn.addEventListener("click", () => void this.plugin.refresh(true));

    if (s.mode === "edit" && this.plugin.settings.dryRun && (this.plugin.settings.reminderWriteback || this.plugin.settings.calendarWriteback)) {
      el.createDiv({ cls: P + "note", text: "Dry run is on. Changes are not sent." });
    }
    if (s.hint) el.createDiv({ cls: [P + "note", P + "warning"], text: s.hint });
    if (s.lastError) el.createDiv({ cls: [P + "note", P + "error"], text: s.lastError });
  }

  // Quick add

  private renderQuickAdd(force = false): void {
    const el = this.quickAddEl;
    const snap = this.plugin.state.snapshot;
    const enabled = this.plugin.canWrite("reminder") && !!snap && snap.access.reminders === "fullAccess";
    const lists = enabled && snap ? snap.lists.filter((l) => l.allowsModify) : [];
    // Rebuild only when something it shows changed, so typing is not interrupted by a refresh.
    const sig = JSON.stringify([enabled, this.plugin.settings.defaultListId, lists.map((l) => [l.id, l.title])]);
    if (sig === this.qaSig && !force) return;
    this.qaSig = sig;
    el.empty();
    if (!enabled) {
      el.hide();
      return;
    }
    el.show();
    if (!this.qaListTouched) this.qa.listId = pickDefaultContainer(this.plugin.settings.defaultListId, lists) ?? "";

    const title = el.createEl("input", {
      cls: P + "qa-title",
      attr: { type: "text", placeholder: "New reminder", "aria-label": "New reminder title" },
    });
    title.value = this.qa.title;
    title.addEventListener("input", () => (this.qa.title = title.value));
    title.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        void this.submitQuickAdd();
      }
    });

    const row = el.createDiv({ cls: P + "qa-row" });
    const date = row.createEl("input", { cls: P + "qa-date", attr: { type: "date", "aria-label": "Due date" } });
    date.value = this.qa.date;
    date.addEventListener("change", () => (this.qa.date = date.value));
    const time = row.createEl("input", { cls: P + "qa-time", attr: { type: "time", "aria-label": "Due time" } });
    time.value = this.qa.time;
    time.addEventListener("change", () => (this.qa.time = time.value));

    const sel = row.createEl("select", { cls: [P + "qa-list", "dropdown"], attr: { "aria-label": "List" } });
    sel.createEl("option", { value: "", text: "Default list" });
    for (const l of lists) sel.createEl("option", { value: l.id, text: l.title });
    sel.value = this.qa.listId;
    sel.addEventListener("change", () => {
      this.qa.listId = sel.value;
      this.qaListTouched = true;
    });

    const add = row.createEl("button", { cls: P + "qa-add", text: "Add" });
    add.addEventListener("click", () => void this.submitQuickAdd());
  }

  private async submitQuickAdd(): Promise<void> {
    if (this.qaBusy) return;
    const res = buildReminderCreate({
      title: this.qa.title,
      listId: this.qa.listId,
      dueDate: this.qa.date,
      dueTime: this.qa.time,
    });
    if (!res.ok) {
      new Notice(res.error);
      return;
    }
    this.qaBusy = true;
    const out = await this.plugin.runWrite("reminder-create", res.payload);
    this.qaBusy = false;
    if (out === "sent" || out === "dryRun") {
      this.qa.title = "";
      this.qa.date = "";
      this.qa.time = "";
      this.renderQuickAdd(true);
    }
  }

  // Body

  private renderBody(): void {
    const el = this.bodyEl;
    el.empty();
    const s = this.plugin.state;
    const snap = s.snapshot;
    if (!snap) {
      el.createDiv({ cls: P + "empty", text: s.ready ? s.emptyReason ?? "No data yet." : "Loading..." });
      return;
    }
    const lists = new Map(snap.lists.map((l) => [l.id, l]));
    const cals = new Map(snap.calendars.map((c) => [c.id, c]));
    const now = new Date();
    const today = localDateOf(now);
    const settings = this.plugin.settings;

    // Reminders
    const remHelp = this.renderAccess(el, snap.access.reminders, "Reminders");
    if (!remHelp) {
      const g = groupReminders(snap.reminders, now, settings.daysAhead, settings.hiddenListIds);
      const total = g.overdue.length + g.today.length + g.upcoming.length + g.later.length + g.noDate.length;
      if (total === 0 && g.completed.length === 0) {
        el.createDiv({ cls: P + "empty", text: "No reminders." });
      }
      this.section(el, "overdue", "Overdue", g.overdue.length, (c) => {
        for (const r of g.overdue) this.reminderRow(c, r, lists, today, true);
      }, P + "overdue");
      this.section(el, "today", "Today", g.today.length, (c) => {
        for (const r of g.today) this.reminderRow(c, r, lists, today, false);
      });
      const upCount = g.upcoming.reduce((n, d) => n + d.items.length, 0);
      this.section(el, "upcoming", "Upcoming", upCount, (c) => {
        for (const day of g.upcoming) {
          c.createDiv({ cls: P + "day", text: dayLabel(day.date, today) });
          for (const r of day.items) this.reminderRow(c, r, lists, today, false);
        }
      });
      this.section(el, "later", "Later", g.later.length, (c) => {
        for (const r of g.later) this.reminderRow(c, r, lists, today, true);
      });
      this.section(el, "noDate", "No date", g.noDate.length, (c) => {
        for (const r of g.noDate) this.reminderRow(c, r, lists, today, false);
      });
      this.section(el, "completed", "Completed", g.completed.length, (c) => {
        for (const r of g.completed) this.reminderRow(c, r, lists, today, true);
      });
    }

    // Events
    if (settings.showEvents) {
      const evHeader = el.createDiv({ cls: P + "events-title", text: "Calendar" });
      evHeader.setAttr("role", "heading");
      const evHelp = this.renderAccess(el, snap.access.events, "Calendars");
      if (!evHelp) {
        const days = groupEvents(snap.events, now, settings.daysAhead, settings.hiddenCalendarIds);
        if (days.length === 0) el.createDiv({ cls: P + "empty", text: "No events." });
        for (const day of days) {
          this.section(el, "ev:" + day.date, dayLabel(day.date, today), day.items.length, (c) => {
            for (const e of day.items) this.eventRow(c, e, cals, day.date);
          });
        }
      }
    }
  }

  /** Shows access problems. Returns true when the section has no data to show. */
  private renderAccess(el: HTMLElement, status: AccessStatus, what: "Reminders" | "Calendars"): boolean {
    if (status === "fullAccess") return false;
    const box = el.createDiv({ cls: [P + "note", P + "warning"] });
    if (status === "notDetermined") {
      if (this.plugin.state.mode === "edit") {
        box.createSpan({ text: `${what} access is not granted yet. ` });
        const b = box.createEl("button", { cls: P + "grant", text: "Grant access" });
        b.addEventListener("click", () => void this.plugin.requestAccess());
      } else {
        box.setText(`${what} access is not set up on the Mac yet.`);
      }
    } else {
      box.setText(accessHelp(status, what) ?? "");
    }
    return true;
  }

  private section(
    parent: HTMLElement,
    key: string,
    title: string,
    count: number,
    fill: (container: HTMLElement) => void,
    extraCls?: string,
  ): void {
    if (count === 0) return;
    const sec = parent.createDiv({ cls: P + "section" });
    if (extraCls) sec.addClass(extraCls);
    const isCollapsed = this.collapsed.get(key) ?? false;
    const head = sec.createDiv({ cls: P + "section-head", attr: { role: "button", tabindex: "0", "aria-expanded": String(!isCollapsed) } });
    const chevron = head.createSpan({ cls: P + "chevron" });
    setIcon(chevron, isCollapsed ? "chevron-right" : "chevron-down");
    head.createSpan({ cls: P + "section-title", text: title });
    head.createSpan({ cls: P + "count", text: String(count) });
    const toggle = () => {
      this.collapsed.set(key, !isCollapsed);
      this.renderBody();
    };
    head.addEventListener("click", toggle);
    head.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        toggle();
      }
    });
    if (!isCollapsed) fill(sec.createDiv({ cls: P + "section-body" }));
  }

  private dot(parent: HTMLElement, c: Container | undefined): void {
    const d = parent.createSpan({ cls: P + "dot" });
    if (c?.color) d.style.setProperty("--reminders-panel-dot", c.color);
  }

  private reminderRow(parent: HTMLElement, r: Reminder, lists: Map<string, Container>, today: string, showDate: boolean): void {
    const list = lists.get(r.listId);
    const writable = this.plugin.canWrite("reminder") && !!list?.allowsModify;
    const row = parent.createDiv({ cls: P + "row" });
    if (r.completed) row.addClass(P + "done");
    if (!writable) row.addClass(P + "readonly");

    const cb = row.createEl("input", { cls: P + "check", attr: { type: "checkbox", "aria-label": r.completed ? "Reopen" : "Complete" } });
    cb.checked = r.completed;
    cb.disabled = !writable;
    if (writable) {
      cb.addEventListener("change", async () => {
        const target = cb.checked;
        cb.disabled = true;
        const out = await this.plugin.runWrite("reminder-update", buildCompleteToggle(r, target));
        // No optimistic update. A real write re-renders from the helper.
        if (out !== "sent") {
          cb.checked = r.completed;
          cb.disabled = false;
        }
      });
    }

    const main = row.createDiv({ cls: P + "main" });
    const title = main.createDiv({ cls: P + "title", text: r.title || "(No title)" });
    if (writable) {
      title.addClass(P + "clickable");
      title.addEventListener("click", () => new ReminderModal(this.app, this.plugin, { kind: "edit", reminder: r }).open());
    }

    const meta = main.createDiv({ cls: P + "meta" });
    const listSpan = meta.createSpan({ cls: P + "list" });
    this.dot(listSpan, list);
    listSpan.createSpan({ text: list?.title ?? "Unknown list" });
    if (r.dueDate && showDate) meta.createSpan({ cls: P + "due", text: dayLabel(r.dueDate, today) });
    if (r.dueTime) {
      const t = meta.createSpan({ cls: P + "due", text: r.dueTime });
      if (!r.completed && r.dueDate === today && r.dueTime < localTimeOf(new Date())) t.addClass(P + "past");
    }
    const level = priorityLevel(r.priority);
    if (level !== "none") {
      const marks = level === "high" ? "!!!" : level === "medium" ? "!!" : "!";
      meta.createSpan({ cls: [P + "marker", P + "priority-" + level], text: marks, attr: { "aria-label": `Priority ${level}` } });
    }
    if (r.hasRecurrence) this.marker(meta, "repeat", "Repeats");
    if (r.notes) this.marker(meta, "sticky-note", "Has notes");
    if (!list?.allowsModify) this.marker(meta, "lock", "Read only list");

    const canTimeBlock = this.plugin.canWrite("event") && !r.completed;
    if (writable || canTimeBlock) {
      const more = row.createEl("button", { cls: [P + "icon-button", "clickable-icon"], attr: { "aria-label": "More" } });
      setIcon(more, "more-horizontal");
      more.addEventListener("click", (evt) => {
        const menu = new Menu();
        if (writable) {
          menu.addItem((i) =>
            i.setTitle("Edit").setIcon("pencil").onClick(() => new ReminderModal(this.app, this.plugin, { kind: "edit", reminder: r }).open()),
          );
        }
        if (canTimeBlock) {
          menu.addItem((i) =>
            i.setTitle("Time block").setIcon("calendar-plus").onClick(() => new TimeBlockModal(this.app, this.plugin, r).open()),
          );
        }
        menu.showAtMouseEvent(evt);
      });
    }
  }

  private marker(parent: HTMLElement, icon: string, label: string): void {
    const m = parent.createSpan({ cls: P + "marker", attr: { "aria-label": label, title: label } });
    setIcon(m, icon);
  }

  private eventRow(parent: HTMLElement, e: CalEvent, cals: Map<string, Container>, day: string): void {
    const cal = cals.get(e.calendarId);
    const writable = this.plugin.canWrite("event") && !!cal?.allowsModify;
    const row = parent.createDiv({ cls: [P + "row", P + "event"], attr: { "data-key": eventKey(e) } });
    if (!writable) row.addClass(P + "readonly");
    this.dot(row, cal);
    const main = row.createDiv({ cls: P + "main" });
    const title = main.createDiv({ cls: P + "title", text: e.title || "(No title)" });
    const meta = main.createDiv({ cls: P + "meta" });
    meta.createSpan({ cls: P + "due", text: this.eventTime(e, day) });
    meta.createSpan({ cls: P + "list", text: cal?.title ?? "Unknown calendar" });
    if (e.location) meta.createSpan({ cls: P + "location", text: e.location });
    if (e.isRecurring) this.marker(meta, "repeat", "Repeats");
    if (writable) {
      title.addClass(P + "clickable");
      title.addEventListener("click", () => new EventModal(this.app, this.plugin, e).open());
    }
  }

  private eventTime(e: CalEvent, day: string): string {
    if (e.allDay) return "All day";
    const s = new Date(parseIso(e.start));
    const en = new Date(parseIso(e.end));
    const startText = localDateOf(s) === day ? localTimeOf(s) : "...";
    const endText = localDateOf(en) === day ? localTimeOf(en) : "...";
    return `${startText} - ${endText}`;
  }
}
