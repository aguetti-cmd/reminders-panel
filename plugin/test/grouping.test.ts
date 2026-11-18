import { describe, expect, it } from "vitest";
import { addDays, dayLabel, localDateOf, relativeTime, toIsoLocal } from "../src/dates";
import { compareReminders, eventDaySpan, groupEvents, groupReminders, sortReminders } from "../src/grouping";
import { event, reminder } from "./fixtures";

// Wednesday 18 Nov 2026, 14:00 in Asia/Bangkok (TZ set in vitest.config.mjs).
const NOW = new Date(2026, 10, 18, 14, 0, 0);

describe("time zone setup", () => {
  it("runs in Asia/Bangkok", () => {
    expect(toIsoLocal(NOW)).toBe("2026-11-18T14:00:00+07:00");
    expect(localDateOf(NOW)).toBe("2026-11-18");
  });
});

describe("groupReminders", () => {
  const rs = [
    reminder({ id: "overdue", dueDate: "2026-11-17" }),
    reminder({ id: "today", dueDate: "2026-11-18", dueTime: "09:00" }),
    reminder({ id: "tomorrow", dueDate: "2026-11-19" }),
    reminder({ id: "lastUpcoming", dueDate: "2026-11-24" }),
    reminder({ id: "later", dueDate: "2026-11-25" }),
    reminder({ id: "nodate" }),
    reminder({ id: "done", completed: true, completedAt: "2026-11-18T08:00:00+07:00", dueDate: "2026-11-10" }),
    reminder({ id: "hidden", dueDate: "2026-11-18", listId: "hiddenList" }),
  ];

  it("splits into overdue, today, upcoming, later, no date and completed", () => {
    const g = groupReminders(rs, NOW, 7, ["hiddenList"]);
    expect(g.overdue.map((r) => r.id)).toEqual(["overdue"]);
    expect(g.today.map((r) => r.id)).toEqual(["today"]);
    expect(g.upcoming.map((d) => d.date)).toEqual(["2026-11-19", "2026-11-24"]);
    expect(g.upcoming[0].items.map((r) => r.id)).toEqual(["tomorrow"]);
    expect(g.later.map((r) => r.id)).toEqual(["later"]);
    expect(g.noDate.map((r) => r.id)).toEqual(["nodate"]);
    expect(g.completed.map((r) => r.id)).toEqual(["done"]);
  });

  it("uses a window of daysAhead days including today", () => {
    const g = groupReminders(rs, NOW, 1, ["hiddenList"]);
    expect(g.upcoming).toEqual([]);
    expect(g.later.map((r) => r.id)).toEqual(["tomorrow", "lastUpcoming", "later"]);
  });

  it("uses the local date just before and after midnight", () => {
    const lateNight = new Date(2026, 10, 18, 23, 59, 59);
    const earlyMorning = new Date(2026, 10, 19, 0, 0, 1);
    const r = [reminder({ id: "x", dueDate: "2026-11-18" })];
    expect(groupReminders(r, lateNight, 7).today).toHaveLength(1);
    expect(groupReminders(r, earlyMorning, 7).overdue).toHaveLength(1);
  });

  it("sorts completed by completion time, newest first", () => {
    const g = groupReminders(
      [
        reminder({ id: "a", completed: true, completedAt: "2026-11-18T08:00:00+07:00" }),
        reminder({ id: "b", completed: true, completedAt: "2026-11-18T12:00:00+07:00" }),
      ],
      NOW,
      7,
    );
    expect(g.completed.map((r) => r.id)).toEqual(["b", "a"]);
  });
});

describe("sortReminders", () => {
  it("orders by date (nulls last), time (nulls first), then title ignoring case", () => {
    const sorted = sortReminders([
      reminder({ id: "nodate", title: "a" }),
      reminder({ id: "d2", dueDate: "2026-11-20", title: "x" }),
      reminder({ id: "d1-10", dueDate: "2026-11-19", dueTime: "10:00", title: "a" }),
      reminder({ id: "d1-none-B", dueDate: "2026-11-19", title: "beta" }),
      reminder({ id: "d1-none-a", dueDate: "2026-11-19", title: "Alpha" }),
      reminder({ id: "d1-09", dueDate: "2026-11-19", dueTime: "09:00", title: "z" }),
    ]);
    expect(sorted.map((r) => r.id)).toEqual(["d1-none-a", "d1-none-B", "d1-09", "d1-10", "d2", "nodate"]);
  });

  it("is a stable comparator for equal items", () => {
    expect(compareReminders(reminder(), reminder())).toBe(0);
  });
});

describe("groupEvents", () => {
  it("groups by local day, all-day first, and drops hidden calendars", () => {
    const evs = [
      event({ id: "late", start: "2026-11-18T16:00:00+07:00", end: "2026-11-18T17:00:00+07:00" }),
      event({ id: "early", start: "2026-11-18T08:00:00+07:00", end: "2026-11-18T09:00:00+07:00" }),
      event({ id: "allday", allDay: true, start: "2026-11-18T00:00:00+07:00", end: "2026-11-18T23:59:59+07:00" }),
      event({ id: "tomorrow", start: "2026-11-19T10:00:00+07:00", end: "2026-11-19T11:00:00+07:00" }),
      event({ id: "hidden", calendarId: "hc" }),
      event({ id: "outside", start: "2026-12-01T10:00:00+07:00", end: "2026-12-01T11:00:00+07:00" }),
    ];
    const days = groupEvents(evs, NOW, 7, ["hc"]);
    expect(days.map((d) => d.date)).toEqual(["2026-11-18", "2026-11-19"]);
    expect(days[0].items.map((e) => e.id)).toEqual(["allday", "early", "late"]);
  });

  it("converts timed events from another offset to local time", () => {
    // 2026-11-18T20:00Z is 03:00 on 19 Nov in Bangkok.
    const e = event({ start: "2026-11-18T20:00:00Z", end: "2026-11-18T21:00:00Z" });
    expect(eventDaySpan(e)).toEqual(["2026-11-19", "2026-11-19"]);
  });

  it("keeps all-day events on their written date and treats midnight end as exclusive", () => {
    const e = event({ allDay: true, start: "2026-11-18T00:00:00-08:00", end: "2026-11-20T00:00:00-08:00" });
    expect(eventDaySpan(e)).toEqual(["2026-11-18", "2026-11-19"]);
  });

  it("does not show an event that ends at midnight on the next day", () => {
    const e = event({ start: "2026-11-18T23:00:00+07:00", end: "2026-11-19T00:00:00+07:00" });
    expect(eventDaySpan(e)).toEqual(["2026-11-18", "2026-11-18"]);
  });

  it("shows a multi-day event on each day", () => {
    const e = event({ start: "2026-11-18T20:00:00+07:00", end: "2026-11-20T09:00:00+07:00" });
    expect(groupEvents([e], NOW, 7).map((d) => d.date)).toEqual(["2026-11-18", "2026-11-19", "2026-11-20"]);
  });
});

describe("date helpers", () => {
  it("adds days across month ends", () => {
    expect(addDays("2026-11-30", 1)).toBe("2026-12-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
  it("labels days", () => {
    expect(dayLabel("2026-11-18", "2026-11-18")).toBe("Today");
    expect(dayLabel("2026-11-19", "2026-11-18")).toBe("Tomorrow");
    expect(dayLabel("2026-11-20", "2026-11-18")).toBe("Fri 20 Nov");
  });
  it("writes relative times", () => {
    const now = NOW.getTime();
    expect(relativeTime(now - 30_000, now)).toBe("just now");
    expect(relativeTime(now - 5 * 60_000, now)).toBe("5 min ago");
    expect(relativeTime(now - 3 * 3600_000, now)).toBe("3 h ago");
    expect(relativeTime(now - 50 * 3600_000, now)).toBe("2 days ago");
  });
});
