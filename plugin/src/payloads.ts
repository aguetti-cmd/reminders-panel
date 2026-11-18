// Builds helper payloads from form values. Pure module, no obsidian import.

import { isLocalDate, isLocalTime, localPartsToDate, parseIso, toIsoLocal } from "./dates";
import type {
  CalEvent,
  Container,
  EventCreatePayload,
  EventUpdatePayload,
  Reminder,
  ReminderCreatePayload,
  ReminderUpdatePayload,
} from "./types";

export type PriorityLevel = "none" | "low" | "medium" | "high";

export const PRIORITY_VALUES: Record<PriorityLevel, number> = {
  none: 0,
  low: 9,
  medium: 5,
  high: 1,
};

/** Maps the raw EventKit priority (0..9) to a level. 1-4 high, 5 medium, 6-9 low. */
export function priorityLevel(p: number): PriorityLevel {
  if (!p || p < 1 || p > 9) return "none";
  if (p < 5) return "high";
  if (p === 5) return "medium";
  return "low";
}

export type BuildResult<T> = { ok: true; payload: T } | { ok: false; error: string };

/** Values from the reminder edit form. Empty strings mean "not set". */
export interface ReminderFormValues {
  title: string;
  listId: string;
  dueDate: string;
  dueTime: string;
  priority: PriorityLevel;
  notes: string;
}

export function reminderToForm(r: Reminder): ReminderFormValues {
  return {
    title: r.title,
    listId: r.listId,
    dueDate: r.dueDate ?? "",
    dueTime: r.dueTime ?? "",
    priority: priorityLevel(r.priority),
    notes: r.notes ?? "",
  };
}

function checkDateTime(date: string, time: string): string | null {
  if (date !== "" && !isLocalDate(date)) return "The date is not valid.";
  if (time !== "" && !isLocalTime(time)) return "The time is not valid.";
  if (time !== "" && date === "") return "Set a date before a time.";
  return null;
}

/**
 * Builds a reminder-update payload with only the fields that changed.
 * Clearing the date sends dueDate: null (which also clears the time, so dueTime is not sent).
 * Clearing only the time sends dueTime: null.
 * Returns ok with a payload that has only "id" when nothing changed.
 */
export function buildReminderUpdate(
  original: Reminder,
  form: ReminderFormValues,
): BuildResult<ReminderUpdatePayload> {
  const title = form.title.trim();
  if (title === "") return { ok: false, error: "The title is empty." };
  const date = form.dueDate.trim();
  const time = form.dueTime.trim();
  const dtError = checkDateTime(date, time);
  if (dtError) return { ok: false, error: dtError };

  const p: ReminderUpdatePayload = { id: original.id };
  if (title !== original.title) p.title = title;
  if (form.listId !== "" && form.listId !== original.listId) p.listId = form.listId;

  const notes = form.notes;
  const origNotes = original.notes ?? "";
  if (notes !== origNotes) p.notes = notes === "" ? null : notes;

  if (date === "") {
    if (original.dueDate !== null) p.dueDate = null;
  } else {
    if (date !== original.dueDate) p.dueDate = date;
    if (time === "") {
      if (original.dueTime !== null) p.dueTime = null;
    } else if (time !== original.dueTime) {
      p.dueTime = time;
    }
  }

  const prio = PRIORITY_VALUES[form.priority];
  if (priorityLevel(original.priority) !== form.priority) p.priority = prio;
  return { ok: true, payload: p };
}

/** True when an update payload carries no change. */
export function isEmptyUpdate(p: { id: string }): boolean {
  return Object.keys(p).filter((k) => k !== "id" && k !== "occurrenceStart").length === 0;
}

export function buildCompleteToggle(r: Reminder, completed: boolean): ReminderUpdatePayload {
  return { id: r.id, completed };
}

export interface ReminderCreateValues {
  title: string;
  listId: string;
  dueDate: string;
  dueTime: string;
  priority?: PriorityLevel;
  notes?: string;
}

/** Picks a default list: the configured one if it exists and can be modified, else undefined (helper default). */
export function pickDefaultContainer(id: string, containers: Container[]): string | undefined {
  if (!id) return undefined;
  const c = containers.find((x) => x.id === id);
  return c && c.allowsModify ? c.id : undefined;
}

export function buildReminderCreate(v: ReminderCreateValues): BuildResult<ReminderCreatePayload> {
  const title = v.title.trim();
  if (title === "") return { ok: false, error: "The title is empty." };
  const date = v.dueDate.trim();
  const time = v.dueTime.trim();
  const dtError = checkDateTime(date, time);
  if (dtError) return { ok: false, error: dtError };
  const p: ReminderCreatePayload = { title };
  if (v.listId) p.listId = v.listId;
  if (v.notes && v.notes !== "") p.notes = v.notes;
  if (date !== "") p.dueDate = date;
  if (time !== "") p.dueTime = time;
  if (v.priority && v.priority !== "none") p.priority = PRIORITY_VALUES[v.priority];
  return { ok: true, payload: p };
}

export interface TimeBlockValues {
  title: string;
  calendarId: string;
  date: string;
  startTime: string;
  durationMinutes: number;
}

export function buildTimeBlock(v: TimeBlockValues): BuildResult<EventCreatePayload> {
  const title = v.title.trim();
  if (title === "") return { ok: false, error: "The title is empty." };
  if (!isLocalDate(v.date)) return { ok: false, error: "The date is not valid." };
  if (!isLocalTime(v.startTime)) return { ok: false, error: "The start time is not valid." };
  const mins = Math.round(v.durationMinutes);
  if (!Number.isFinite(mins) || mins < 1 || mins > 24 * 60) {
    return { ok: false, error: "The duration must be 1 to 1440 minutes." };
  }
  const start = localPartsToDate(v.date, v.startTime);
  const end = new Date(start.getTime() + mins * 60000);
  const p: EventCreatePayload = { title, start: toIsoLocal(start), end: toIsoLocal(end) };
  if (v.calendarId) p.calendarId = v.calendarId;
  return { ok: true, payload: p };
}

/** Values from the event edit form. start and end are "YYYY-MM-DDTHH:mm" device-local, as from datetime-local inputs. */
export interface EventFormValues {
  title: string;
  calendarId: string;
  start: string;
  end: string;
}

const DT_LOCAL_RE = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/;

export function isoToDateTimeLocal(iso: string): string {
  const ms = parseIso(iso);
  if (Number.isNaN(ms)) return "";
  const d = new Date(ms);
  return toIsoLocal(d).slice(0, 16);
}

function dateTimeLocalToMs(v: string): number {
  const m = DT_LOCAL_RE.exec(v.trim());
  if (!m || !isLocalDate(m[1]) || !isLocalTime(m[2])) return NaN;
  return localPartsToDate(m[1], m[2]).getTime();
}

export function eventToForm(e: CalEvent): EventFormValues {
  return {
    title: e.title,
    calendarId: e.calendarId,
    start: isoToDateTimeLocal(e.start),
    end: isoToDateTimeLocal(e.end),
  };
}

/**
 * Builds an event-update payload with only changed fields.
 * Always passes occurrenceStart (the event's current start).
 * For all-day events start and end are not editable here and are ignored.
 */
export function buildEventUpdate(original: CalEvent, form: EventFormValues): BuildResult<EventUpdatePayload> {
  const title = form.title.trim();
  if (title === "") return { ok: false, error: "The title is empty." };
  const p: EventUpdatePayload = { id: original.id, occurrenceStart: original.start };
  if (title !== original.title) p.title = title;
  if (form.calendarId !== "" && form.calendarId !== original.calendarId) p.calendarId = form.calendarId;
  if (!original.allDay) {
    const s = dateTimeLocalToMs(form.start);
    const e = dateTimeLocalToMs(form.end);
    if (Number.isNaN(s)) return { ok: false, error: "The start is not valid." };
    if (Number.isNaN(e)) return { ok: false, error: "The end is not valid." };
    if (e <= s) return { ok: false, error: "The end must be after the start." };
    // Compare to the minute, since the form has no seconds.
    const origS = Math.floor(parseIso(original.start) / 60000) * 60000;
    const origE = Math.floor(parseIso(original.end) / 60000) * 60000;
    if (s !== origS) p.start = toIsoLocal(new Date(s));
    if (e !== origE) p.end = toIsoLocal(new Date(e));
  }
  return { ok: true, payload: p };
}

/** obsidian://open link to a note, with both parts URL-encoded. */
export function buildNoteLink(vaultName: string, filePath: string): string {
  return `obsidian://open?vault=${encodeURIComponent(vaultName)}&file=${encodeURIComponent(filePath)}`;
}
