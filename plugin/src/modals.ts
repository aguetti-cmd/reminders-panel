import { Modal, Notice, Setting, type App } from "obsidian";
import { localDateOf, nextQuarterHour } from "./dates";
import type RemindersPanelPlugin from "./main";
import {
  buildEventUpdate,
  buildReminderCreate,
  buildReminderUpdate,
  buildTimeBlock,
  eventToForm,
  isEmptyUpdate,
  pickDefaultContainer,
  reminderToForm,
  type PriorityLevel,
  type ReminderFormValues,
} from "./payloads";
import type { CalEvent, Container, Reminder } from "./types";

function writableContainers(all: Container[] | undefined): Container[] {
  return (all ?? []).filter((c) => c.allowsModify);
}

function addDateInput(setting: Setting, value: string, onChange: (v: string) => void, type: "date" | "time" | "datetime-local"): void {
  setting.addText((t) => {
    t.inputEl.type = type;
    t.inputEl.addClass("reminders-panel-input");
    t.setValue(value);
    t.onChange(onChange);
  });
}

function addButtons(modal: Modal, saveLabel: string, onSave: () => void): void {
  new Setting(modal.contentEl)
    .addButton((b) => b.setButtonText("Cancel").onClick(() => modal.close()))
    .addButton((b) => b.setButtonText(saveLabel).setCta().onClick(onSave));
}

export type ReminderModalOptions =
  | { kind: "create"; initial?: { title?: string; notes?: string; dueDate?: string; dueTime?: string } }
  | { kind: "edit"; reminder: Reminder };

export class ReminderModal extends Modal {
  private values: ReminderFormValues;
  private busy = false;

  constructor(
    app: App,
    private readonly plugin: RemindersPanelPlugin,
    private readonly opts: ReminderModalOptions,
  ) {
    super(app);
    if (opts.kind === "edit") {
      this.values = reminderToForm(opts.reminder);
    } else {
      const lists = plugin.state.snapshot?.lists ?? [];
      this.values = {
        title: opts.initial?.title ?? "",
        listId: pickDefaultContainer(plugin.settings.defaultListId, lists) ?? "",
        dueDate: opts.initial?.dueDate ?? "",
        dueTime: opts.initial?.dueTime ?? "",
        priority: "none",
        notes: opts.initial?.notes ?? "",
      };
    }
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass("reminders-panel-modal");
    this.titleEl.setText(this.opts.kind === "edit" ? "Edit reminder" : "New reminder");
    const v = this.values;

    new Setting(contentEl).setName("Title").addText((t) => {
      t.setValue(v.title).onChange((x) => (v.title = x));
      t.inputEl.addClass("reminders-panel-input");
      window.setTimeout(() => t.inputEl.focus(), 0);
    });

    const lists = writableContainers(this.plugin.state.snapshot?.lists);
    new Setting(contentEl).setName("List").addDropdown((d) => {
      if (this.opts.kind === "create") d.addOption("", "Default list");
      for (const l of lists) d.addOption(l.id, l.title);
      d.setValue(v.listId);
      d.onChange((x) => (v.listId = x));
    });

    addDateInput(new Setting(contentEl).setName("Due date").setDesc("Leave empty for no date."), v.dueDate, (x) => (v.dueDate = x), "date");
    addDateInput(new Setting(contentEl).setName("Due time").setDesc("Leave empty for a date only."), v.dueTime, (x) => (v.dueTime = x), "time");

    new Setting(contentEl).setName("Priority").addDropdown((d) => {
      const opts: [PriorityLevel, string][] = [
        ["none", "None"],
        ["low", "Low"],
        ["medium", "Medium"],
        ["high", "High"],
      ];
      for (const [k, label] of opts) d.addOption(k, label);
      d.setValue(v.priority);
      d.onChange((x) => (v.priority = x as PriorityLevel));
    });

    new Setting(contentEl).setName("Notes").addTextArea((t) => {
      t.setValue(v.notes).onChange((x) => (v.notes = x));
      t.inputEl.rows = 4;
      t.inputEl.addClass("reminders-panel-input");
    });

    addButtons(this, this.opts.kind === "edit" ? "Save" : "Add", () => void this.save());
  }

  private async save(): Promise<void> {
    if (this.busy) return;
    if (this.opts.kind === "edit") {
      const res = buildReminderUpdate(this.opts.reminder, this.values);
      if (!res.ok) return void new Notice(res.error);
      if (isEmptyUpdate(res.payload)) {
        new Notice("No changes.");
        this.close();
        return;
      }
      this.busy = true;
      const out = await this.plugin.runWrite("reminder-update", res.payload);
      this.busy = false;
      if (out === "sent" || out === "dryRun") this.close();
    } else {
      const res = buildReminderCreate(this.values);
      if (!res.ok) return void new Notice(res.error);
      this.busy = true;
      const out = await this.plugin.runWrite("reminder-create", res.payload);
      this.busy = false;
      if (out === "sent" || out === "dryRun") this.close();
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

export class TimeBlockModal extends Modal {
  private calendarId: string;
  private date: string;
  private startTime: string;
  private duration = "30";
  private busy = false;

  constructor(
    app: App,
    private readonly plugin: RemindersPanelPlugin,
    private readonly reminder: Reminder,
  ) {
    super(app);
    const cals = plugin.state.snapshot?.calendars ?? [];
    this.calendarId = pickDefaultContainer(plugin.settings.defaultCalendarId, cals) ?? "";
    const now = new Date();
    this.date = reminder.dueDate ?? localDateOf(now);
    this.startTime = reminder.dueTime ?? nextQuarterHour(now);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass("reminders-panel-modal");
    this.titleEl.setText("Time block");
    contentEl.createEl("p", { text: this.reminder.title || "(No title)", cls: "reminders-panel-modal-subject" });

    const cals = writableContainers(this.plugin.state.snapshot?.calendars);
    new Setting(contentEl).setName("Calendar").addDropdown((d) => {
      d.addOption("", "Default calendar");
      for (const c of cals) d.addOption(c.id, c.title);
      d.setValue(this.calendarId);
      d.onChange((x) => (this.calendarId = x));
    });
    addDateInput(new Setting(contentEl).setName("Date"), this.date, (x) => (this.date = x), "date");
    addDateInput(new Setting(contentEl).setName("Start time"), this.startTime, (x) => (this.startTime = x), "time");
    new Setting(contentEl).setName("Duration (minutes)").addText((t) => {
      t.inputEl.type = "number";
      t.inputEl.min = "1";
      t.inputEl.addClass("reminders-panel-input");
      t.setValue(this.duration).onChange((x) => (this.duration = x));
    });
    addButtons(this, "Create event", () => void this.save());
  }

  private async save(): Promise<void> {
    if (this.busy) return;
    const res = buildTimeBlock({
      title: this.reminder.title,
      calendarId: this.calendarId,
      date: this.date,
      startTime: this.startTime,
      durationMinutes: Number(this.duration),
    });
    if (!res.ok) return void new Notice(res.error);
    this.busy = true;
    const out = await this.plugin.runWrite("event-create", res.payload);
    this.busy = false;
    if (out === "sent" || out === "dryRun") this.close();
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

export class EventModal extends Modal {
  private values;
  private busy = false;

  constructor(
    app: App,
    private readonly plugin: RemindersPanelPlugin,
    private readonly event: CalEvent,
  ) {
    super(app);
    this.values = eventToForm(event);
  }

  onOpen(): void {
    const { contentEl } = this;
    const v = this.values;
    contentEl.addClass("reminders-panel-modal");
    this.titleEl.setText("Edit event");
    if (this.event.isRecurring) {
      contentEl.createEl("p", { text: "This is a repeating event. Only this occurrence changes.", cls: "reminders-panel-muted" });
    }
    new Setting(contentEl).setName("Title").addText((t) => {
      t.setValue(v.title).onChange((x) => (v.title = x));
      t.inputEl.addClass("reminders-panel-input");
    });
    const cals = writableContainers(this.plugin.state.snapshot?.calendars);
    new Setting(contentEl).setName("Calendar").addDropdown((d) => {
      for (const c of cals) d.addOption(c.id, c.title);
      d.setValue(v.calendarId);
      d.onChange((x) => (v.calendarId = x));
    });
    if (this.event.allDay) {
      contentEl.createEl("p", { text: "All-day event. Change its dates in Calendar.", cls: "reminders-panel-muted" });
    } else {
      addDateInput(new Setting(contentEl).setName("Start"), v.start, (x) => (v.start = x), "datetime-local");
      addDateInput(new Setting(contentEl).setName("End"), v.end, (x) => (v.end = x), "datetime-local");
    }
    addButtons(this, "Save", () => void this.save());
  }

  private async save(): Promise<void> {
    if (this.busy) return;
    const res = buildEventUpdate(this.event, this.values);
    if (!res.ok) return void new Notice(res.error);
    if (isEmptyUpdate(res.payload)) {
      new Notice("No changes.");
      this.close();
      return;
    }
    this.busy = true;
    const out = await this.plugin.runWrite("event-update", res.payload);
    this.busy = false;
    if (out === "sent" || out === "dryRun") this.close();
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
