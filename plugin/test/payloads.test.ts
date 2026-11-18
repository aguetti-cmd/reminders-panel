import { describe, expect, it } from "vitest";
import {
  buildEventUpdate,
  buildNoteLink,
  buildReminderCreate,
  buildReminderUpdate,
  buildTimeBlock,
  eventToForm,
  isEmptyUpdate,
  pickDefaultContainer,
  priorityLevel,
  reminderToForm,
} from "../src/payloads";
import { container, event, reminder } from "./fixtures";

const base = reminder({
  id: "r1",
  title: "Call",
  notes: "Old notes",
  listId: "l1",
  dueDate: "2026-11-18",
  dueTime: "10:00",
  priority: 5,
});

describe("buildReminderUpdate", () => {
  it("sends only the id when nothing changed", () => {
    const res = buildReminderUpdate(base, reminderToForm(base));
    expect(res).toEqual({ ok: true, payload: { id: "r1" } });
    if (res.ok) expect(isEmptyUpdate(res.payload)).toBe(true);
  });

  it("sends only changed fields", () => {
    const form = { ...reminderToForm(base), title: "Call mum ", priority: "high" as const };
    expect(buildReminderUpdate(base, form)).toEqual({ ok: true, payload: { id: "r1", title: "Call mum", priority: 1 } });
  });

  it("clearing the date sends dueDate null and no dueTime", () => {
    const form = { ...reminderToForm(base), dueDate: "", dueTime: "" };
    expect(buildReminderUpdate(base, form)).toEqual({ ok: true, payload: { id: "r1", dueDate: null } });
  });

  it("clearing only the time sends dueTime null", () => {
    const form = { ...reminderToForm(base), dueTime: "" };
    expect(buildReminderUpdate(base, form)).toEqual({ ok: true, payload: { id: "r1", dueTime: null } });
  });

  it("changing only the date does not send the time", () => {
    const form = { ...reminderToForm(base), dueDate: "2026-11-20" };
    expect(buildReminderUpdate(base, form)).toEqual({ ok: true, payload: { id: "r1", dueDate: "2026-11-20" } });
  });

  it("adds a date and time to an undated reminder", () => {
    const r = reminder({ id: "r2" });
    const form = { ...reminderToForm(r), dueDate: "2026-11-19", dueTime: "08:15" };
    expect(buildReminderUpdate(r, form)).toEqual({
      ok: true,
      payload: { id: "r2", dueDate: "2026-11-19", dueTime: "08:15" },
    });
  });

  it("clearing notes sends null, and new notes send a string", () => {
    expect(buildReminderUpdate(base, { ...reminderToForm(base), notes: "" })).toEqual({
      ok: true,
      payload: { id: "r1", notes: null },
    });
    const r = reminder({ id: "r3" });
    expect(buildReminderUpdate(r, { ...reminderToForm(r), notes: "Hi" })).toEqual({
      ok: true,
      payload: { id: "r3", notes: "Hi" },
    });
  });

  it("moves to another list and changes priority to none", () => {
    const form = { ...reminderToForm(base), listId: "l2", priority: "none" as const };
    expect(buildReminderUpdate(base, form)).toEqual({ ok: true, payload: { id: "r1", listId: "l2", priority: 0 } });
  });

  it("rejects an empty title and a time without a date", () => {
    expect(buildReminderUpdate(base, { ...reminderToForm(base), title: "  " }).ok).toBe(false);
    expect(buildReminderUpdate(base, { ...reminderToForm(base), dueDate: "", dueTime: "10:00" }).ok).toBe(false);
    expect(buildReminderUpdate(base, { ...reminderToForm(base), dueDate: "2026-02-30" }).ok).toBe(false);
  });
});

describe("priority mapping", () => {
  it("maps raw values to levels", () => {
    expect([0, 1, 3, 5, 6, 9].map(priorityLevel)).toEqual(["none", "high", "high", "medium", "low", "low"]);
  });
});

describe("buildReminderCreate", () => {
  it("omits empty fields", () => {
    expect(buildReminderCreate({ title: " Milk ", listId: "", dueDate: "", dueTime: "" })).toEqual({
      ok: true,
      payload: { title: "Milk" },
    });
  });
  it("includes date, time, list, notes and priority", () => {
    expect(
      buildReminderCreate({ title: "A", listId: "l1", dueDate: "2026-11-19", dueTime: "09:00", notes: "n", priority: "low" }),
    ).toEqual({ ok: true, payload: { title: "A", listId: "l1", notes: "n", dueDate: "2026-11-19", dueTime: "09:00", priority: 9 } });
  });
  it("rejects a time without a date", () => {
    expect(buildReminderCreate({ title: "A", listId: "", dueDate: "", dueTime: "09:00" }).ok).toBe(false);
  });
});

describe("pickDefaultContainer", () => {
  it("only returns an existing writable container", () => {
    const cs = [container({ id: "a" }), container({ id: "ro", allowsModify: false })];
    expect(pickDefaultContainer("a", cs)).toBe("a");
    expect(pickDefaultContainer("ro", cs)).toBeUndefined();
    expect(pickDefaultContainer("missing", cs)).toBeUndefined();
    expect(pickDefaultContainer("", cs)).toBeUndefined();
  });
});

describe("buildTimeBlock", () => {
  it("builds local start and end with the device offset", () => {
    expect(buildTimeBlock({ title: "Write", calendarId: "c1", date: "2026-11-18", startTime: "23:45", durationMinutes: 30 })).toEqual({
      ok: true,
      payload: { title: "Write", calendarId: "c1", start: "2026-11-18T23:45:00+07:00", end: "2026-11-19T00:15:00+07:00" },
    });
  });
  it("rejects a bad duration", () => {
    expect(buildTimeBlock({ title: "W", calendarId: "", date: "2026-11-18", startTime: "10:00", durationMinutes: 0 }).ok).toBe(false);
  });
});

describe("buildEventUpdate", () => {
  const ev = event({ id: "e1", start: "2026-11-18T10:00:00+07:00", end: "2026-11-18T11:00:00+07:00" });

  it("always passes occurrenceStart and only changed fields", () => {
    const form = eventToForm(ev);
    expect(form.start).toBe("2026-11-18T10:00");
    expect(buildEventUpdate(ev, form)).toEqual({ ok: true, payload: { id: "e1", occurrenceStart: ev.start } });
    expect(buildEventUpdate(ev, { ...form, end: "2026-11-18T11:30", title: "New" })).toEqual({
      ok: true,
      payload: { id: "e1", occurrenceStart: ev.start, title: "New", end: "2026-11-18T11:30:00+07:00" },
    });
  });

  it("rejects end before start", () => {
    expect(buildEventUpdate(ev, { ...eventToForm(ev), end: "2026-11-18T09:00" }).ok).toBe(false);
  });

  it("ignores start and end for all-day events", () => {
    const ad = event({ allDay: true, start: "2026-11-18T00:00:00+07:00", end: "2026-11-18T23:59:59+07:00" });
    expect(buildEventUpdate(ad, { ...eventToForm(ad), start: "", end: "", calendarId: "c2" })).toEqual({
      ok: true,
      payload: { id: "e1", occurrenceStart: ad.start, calendarId: "c2" },
    });
  });
});

describe("buildNoteLink", () => {
  it("URL-encodes vault and file", () => {
    expect(buildNoteLink("My Vault", "Folder/Note & more.md")).toBe(
      "obsidian://open?vault=My%20Vault&file=Folder%2FNote%20%26%20more.md",
    );
  });
});
