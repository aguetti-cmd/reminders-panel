import type { CalEvent, Container, Reminder, Snapshot } from "../src/types";

export function reminder(o: Partial<Reminder> = {}): Reminder {
  return {
    id: "r1",
    title: "Task",
    notes: null,
    listId: "l1",
    completed: false,
    completedAt: null,
    priority: 0,
    dueDate: null,
    dueTime: null,
    hasRecurrence: false,
    alarmCount: 0,
    createdAt: null,
    modifiedAt: null,
    ...o,
  };
}

export function event(o: Partial<CalEvent> = {}): CalEvent {
  return {
    id: "e1",
    calendarId: "c1",
    title: "Event",
    notes: null,
    location: null,
    start: "2026-11-18T10:00:00+07:00",
    end: "2026-11-18T11:00:00+07:00",
    allDay: false,
    isRecurring: false,
    ...o,
  };
}

export function container(o: Partial<Container> = {}): Container {
  return { id: "l1", title: "Personal", color: "#FF9500", allowsModify: true, source: "iCloud", ...o };
}

export function snapshot(o: Partial<Snapshot> = {}): Snapshot {
  return {
    generatedAt: "2026-11-18T09:00:00+07:00",
    timeZone: "Asia/Bangkok",
    daysAhead: 7,
    access: { reminders: "fullAccess", events: "fullAccess" },
    lists: [container()],
    reminders: [reminder()],
    calendars: [container({ id: "c1", title: "Home" })],
    events: [event()],
    ...o,
  };
}
