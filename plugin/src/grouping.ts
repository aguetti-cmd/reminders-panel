// Grouping and sorting for the panel. Pure module, no obsidian import.

import { addDays, isoDatePart, isoIsMidnight, localDateOf, parseIso } from "./dates";
import type { CalEvent, LocalDate, Reminder } from "./types";

export interface DayGroup<T> {
  date: LocalDate;
  items: T[];
}

export interface ReminderGroups {
  overdue: Reminder[];
  today: Reminder[];
  upcoming: DayGroup<Reminder>[];
  later: Reminder[];
  noDate: Reminder[];
  completed: Reminder[];
}

/** Contract sort: dueDate ascending (nulls last), dueTime ascending (nulls first), title case-insensitive. */
export function compareReminders(a: Reminder, b: Reminder): number {
  if (a.dueDate !== b.dueDate) {
    if (a.dueDate === null) return 1;
    if (b.dueDate === null) return -1;
    return a.dueDate < b.dueDate ? -1 : 1;
  }
  if (a.dueTime !== b.dueTime) {
    if (a.dueTime === null) return -1;
    if (b.dueTime === null) return 1;
    return a.dueTime < b.dueTime ? -1 : 1;
  }
  const ta = a.title.toLocaleLowerCase();
  const tb = b.title.toLocaleLowerCase();
  if (ta !== tb) return ta < tb ? -1 : 1;
  return 0;
}

export function sortReminders(list: Reminder[]): Reminder[] {
  return [...list].sort(compareReminders);
}

/**
 * Splits reminders into panel sections.
 * "Upcoming" covers the days after today inside the daysAhead window
 * (today plus daysAhead - 1 more days, the same window the helper uses for events).
 * "Later" is anything due after that window.
 */
export function groupReminders(
  reminders: Reminder[],
  now: Date,
  daysAhead: number,
  hiddenListIds: readonly string[] = [],
): ReminderGroups {
  const hidden = new Set(hiddenListIds);
  const today = localDateOf(now);
  const windowEnd = addDays(today, Math.max(1, daysAhead)); // exclusive
  const groups: ReminderGroups = {
    overdue: [],
    today: [],
    upcoming: [],
    later: [],
    noDate: [],
    completed: [],
  };
  const upcomingByDay = new Map<LocalDate, Reminder[]>();

  for (const r of sortReminders(reminders)) {
    if (hidden.has(r.listId)) continue;
    if (r.completed) {
      groups.completed.push(r);
    } else if (r.dueDate === null) {
      groups.noDate.push(r);
    } else if (r.dueDate < today) {
      groups.overdue.push(r);
    } else if (r.dueDate === today) {
      groups.today.push(r);
    } else if (r.dueDate < windowEnd) {
      const arr = upcomingByDay.get(r.dueDate) ?? [];
      arr.push(r);
      upcomingByDay.set(r.dueDate, arr);
    } else {
      groups.later.push(r);
    }
  }
  groups.upcoming = [...upcomingByDay.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([date, items]) => ({ date, items }));
  // Most recently completed first.
  groups.completed.sort((a, b) => {
    const ta = a.completedAt ? parseIso(a.completedAt) : 0;
    const tb = b.completedAt ? parseIso(b.completedAt) : 0;
    return tb - ta;
  });
  return groups;
}

/** The device-local days an event occupies, as [first, last] inclusive LocalDates. */
export function eventDaySpan(e: CalEvent): [LocalDate, LocalDate] {
  if (e.allDay) {
    // All-day events carry the Mac's local midnight. Use the written date so the
    // day does not shift on a device in another time zone.
    const first = isoDatePart(e.start);
    let last = isoDatePart(e.end);
    if (isoIsMidnight(e.end) && last > first) last = addDays(last, -1);
    if (last < first) last = first;
    return [first, last];
  }
  const startMs = parseIso(e.start);
  const endMs = parseIso(e.end);
  const first = localDateOf(new Date(startMs));
  // End is exclusive: an event that ends at midnight does not show on the next day.
  const lastMs = endMs > startMs ? endMs - 1 : startMs;
  const last = localDateOf(new Date(lastMs));
  return [first, last < first ? first : last];
}

export function compareEvents(a: CalEvent, b: CalEvent): number {
  if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
  const sa = parseIso(a.start);
  const sb = parseIso(b.start);
  if (sa !== sb) return sa - sb;
  const ta = a.title.toLocaleLowerCase();
  const tb = b.title.toLocaleLowerCase();
  return ta < tb ? -1 : ta > tb ? 1 : 0;
}

/**
 * Groups events by device-local day from today for daysAhead days.
 * An event that spans several days shows on each of them. All-day events come first.
 */
export function groupEvents(
  events: CalEvent[],
  now: Date,
  daysAhead: number,
  hiddenCalendarIds: readonly string[] = [],
): DayGroup<CalEvent>[] {
  const hidden = new Set(hiddenCalendarIds);
  const today = localDateOf(now);
  const days = Math.max(1, daysAhead);
  const out: DayGroup<CalEvent>[] = [];
  const visible = events.filter((e) => !hidden.has(e.calendarId) && !Number.isNaN(parseIso(e.start)));
  for (let i = 0; i < days; i++) {
    const day = addDays(today, i);
    const items = visible
      .filter((e) => {
        const [first, last] = eventDaySpan(e);
        return first <= day && day <= last;
      })
      .sort(compareEvents);
    if (items.length > 0) out.push({ date: day, items });
  }
  return out;
}

/** Stable UI key for an event occurrence (contract 4.5). */
export function eventKey(e: CalEvent): string {
  return `${e.id}|${e.start}`;
}
