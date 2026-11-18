// Date helpers. Pure module, no obsidian import.
// All "local" values use the time zone of the device running the code.

import type { IsoDateTime, LocalDate, LocalTime } from "./types";

const LOCAL_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const LOCAL_TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

function pad2(n: number): string {
  return n < 10 ? "0" + n : String(n);
}

export function isLocalDate(s: unknown): s is LocalDate {
  if (typeof s !== "string") return false;
  const m = LOCAL_DATE_RE.exec(s);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(y, mo - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d;
}

export function isLocalTime(s: unknown): s is LocalTime {
  return typeof s === "string" && LOCAL_TIME_RE.test(s);
}

/** The device-local calendar date of a Date, as YYYY-MM-DD. */
export function localDateOf(d: Date): LocalDate {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Device-local HH:mm of a Date. */
export function localTimeOf(d: Date): LocalTime {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** Adds whole days to a LocalDate using calendar arithmetic. */
export function addDays(date: LocalDate, n: number): LocalDate {
  const m = LOCAL_DATE_RE.exec(date);
  if (!m) throw new Error(`Not a date: ${date}`);
  const dt = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + n);
  return localDateOf(dt);
}

/** Builds a device-local Date from a LocalDate and an optional LocalTime. */
export function localPartsToDate(date: LocalDate, time?: LocalTime | null): Date {
  const m = LOCAL_DATE_RE.exec(date);
  if (!m) throw new Error(`Not a date: ${date}`);
  let h = 0;
  let mi = 0;
  if (time) {
    const t = LOCAL_TIME_RE.exec(time);
    if (!t) throw new Error(`Not a time: ${time}`);
    h = Number(t[1]);
    mi = Number(t[2]);
  }
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), h, mi, 0, 0);
}

/** Formats a Date as ISO 8601 with the device's numeric offset, seconds precision. */
export function toIsoLocal(d: Date): IsoDateTime {
  const offsetMin = -d.getTimezoneOffset();
  const sign = offsetMin >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMin);
  return (
    `${localDateOf(d)}T${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}` +
    `${sign}${pad2(Math.floor(abs / 60))}:${pad2(abs % 60)}`
  );
}

/** Parses an ISO string to epoch ms, or NaN. */
export function parseIso(s: string): number {
  return Date.parse(s);
}

/** The date written in an ISO string (the writer's local date), without time zone conversion. */
export function isoDatePart(s: IsoDateTime): LocalDate {
  return s.slice(0, 10);
}

/** True when the time part of an ISO string is exactly midnight. */
export function isoIsMidnight(s: IsoDateTime): boolean {
  return /T00:00(:00(\.0+)?)?(Z|[+-]\d{2}:?\d{2})?$/.test(s);
}

/** "5 min ago" style text. */
export function relativeTime(thenMs: number, nowMs: number): string {
  const diff = Math.max(0, nowMs - thenMs);
  const min = Math.floor(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? "1 day ago" : `${d} days ago`;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Today", "Tomorrow", "Yesterday", or "Thu 20 Nov". */
export function dayLabel(date: LocalDate, today: LocalDate): string {
  if (date === today) return "Today";
  if (date === addDays(today, 1)) return "Tomorrow";
  if (date === addDays(today, -1)) return "Yesterday";
  const d = localPartsToDate(date);
  return `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

/** "14:30" when the instant is on today's date, else "Mon 17 Nov 14:30". */
export function shortStamp(ms: number, nowMs: number): string {
  const d = new Date(ms);
  const t = localTimeOf(d);
  const today = localDateOf(new Date(nowMs));
  const day = localDateOf(d);
  if (day === today) return t;
  return `${dayLabel(day, today)} ${t}`;
}

/** Next quarter hour after now, as HH:mm (wraps to 00:00 near midnight). */
export function nextQuarterHour(now: Date): LocalTime {
  const d = new Date(now.getTime());
  d.setSeconds(0, 0);
  const add = 15 - (d.getMinutes() % 15);
  d.setMinutes(d.getMinutes() + add);
  return localTimeOf(d);
}
