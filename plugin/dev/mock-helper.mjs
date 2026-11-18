#!/usr/bin/env node
// Mock of reminders-helper for tests and local development only.
// Implements the command line interface from CONTRACT.md with sample data.
//
// State is kept in a JSON file. Its path comes from REMINDERS_MOCK_STATE
// (default: <tmpdir>/reminders-panel-mock-state.json). Delete the file to reset.
// REMINDERS_MOCK_ACCESS sets the starting access status for both entity types
// when the state file is first created (default fullAccess).

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const STATE_PATH = process.env.REMINDERS_MOCK_STATE || join(tmpdir(), "reminders-panel-mock-state.json");
const ACCESS = ["fullAccess", "writeOnly", "denied", "restricted", "notDetermined"];

class Fail extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function out(obj, exitCode) {
  process.stdout.write(JSON.stringify(obj) + "\n");
  process.exitCode = exitCode;
}

// Date helpers (local time of this process)

const pad = (n) => String(n).padStart(2, "0");
function localDate(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function localTime(d) {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function iso(d) {
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? "+" : "-";
  const a = Math.abs(off);
  return `${localDate(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${sign}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}
function midnight(daysFromToday) {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate() + daysFromToday);
}
function at(daysFromToday, h, m = 0) {
  const d = midnight(daysFromToday);
  d.setHours(h, m, 0, 0);
  return d;
}
function isLocalDate(s) {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}
function isLocalTime(s) {
  return typeof s === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
}
function parseIsoStrict(s, field) {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(s)) {
    throw new Fail("invalid_input", `${field} must be an ISO 8601 date and time with an offset.`);
  }
  const ms = Date.parse(s);
  if (Number.isNaN(ms)) throw new Fail("invalid_input", `${field} is not a valid date and time.`);
  return ms;
}
function timeZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

// State

function seed() {
  const access = ACCESS.includes(process.env.REMINDERS_MOCK_ACCESS) ? process.env.REMINDERS_MOCK_ACCESS : "fullAccess";
  const now = new Date();
  const r = (o) => ({
    id: randomUUID(),
    title: "",
    notes: null,
    listId: "list-personal",
    completed: false,
    completedAt: null,
    priority: 0,
    dueDate: null,
    dueTime: null,
    hasRecurrence: false,
    alarmCount: 0,
    createdAt: iso(now),
    modifiedAt: iso(now),
    ...o,
  });
  const e = (o) => ({
    id: randomUUID(),
    calendarId: "cal-home",
    title: "",
    notes: null,
    location: null,
    allDay: false,
    isRecurring: false,
    ...o,
  });
  return {
    access: { reminders: access, events: access },
    lists: [
      { id: "list-personal", title: "Personal", color: "#FF9500", allowsModify: true, source: "iCloud" },
      { id: "list-work", title: "Work", color: "#007AFF", allowsModify: true, source: "iCloud" },
      { id: "list-shared", title: "Shared", color: "#34C759", allowsModify: false, source: "iCloud" },
    ],
    defaultListId: "list-personal",
    calendars: [
      { id: "cal-home", title: "Home", color: "#FF2D55", allowsModify: true, source: "iCloud" },
      { id: "cal-work", title: "Work", color: "#5856D6", allowsModify: true, source: "iCloud" },
      { id: "cal-holidays", title: "Holidays", color: "#8E8E93", allowsModify: false, source: "Other" },
    ],
    defaultCalendarId: "cal-home",
    reminders: [
      r({ title: "Pay electricity bill", dueDate: localDate(midnight(-2)), priority: 1 }),
      r({ title: "Call the landlord", dueDate: localDate(midnight(0)), dueTime: "10:00", alarmCount: 1, listId: "list-personal" }),
      r({ title: "Send weekly report", dueDate: localDate(midnight(0)), listId: "list-work", notes: "Include the new numbers." }),
      r({ title: "Buy cat food", dueDate: localDate(midnight(1)), dueTime: "18:30", alarmCount: 1, hasRecurrence: true }),
      r({ title: "Review team schedule", dueDate: localDate(midnight(3)), listId: "list-work", priority: 5 }),
      r({ title: "Renew passport", dueDate: localDate(midnight(20)), priority: 9 }),
      r({ title: "Read the new book", listId: "list-personal" }),
      r({ title: "Shared groceries", listId: "list-shared", dueDate: localDate(midnight(0)) }),
      r({ title: "Water the plants", completed: true, completedAt: iso(at(0, 8)), dueDate: localDate(midnight(0)) }),
    ],
    events: [
      e({ title: "Public holiday", calendarId: "cal-holidays", allDay: true, start: iso(midnight(0)), end: iso(at(0, 23, 59)) }),
      e({ title: "Team standup", calendarId: "cal-work", start: iso(at(0, 9, 30)), end: iso(at(0, 9, 45)), isRecurring: true, location: "Room 4" }),
      e({ title: "Lunch with Sam", start: iso(at(0, 12)), end: iso(at(0, 13)), location: "Noodle bar" }),
      e({ title: "Dentist", start: iso(at(2, 15)), end: iso(at(2, 16)) }),
    ],
  };
}

function load() {
  if (existsSync(STATE_PATH)) return JSON.parse(readFileSync(STATE_PATH, "utf8"));
  const s = seed();
  save(s);
  return s;
}
function save(s) {
  writeFileSync(STATE_PATH, JSON.stringify(s, null, 2));
}

// Validation helpers

const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
function needFull(state, kind) {
  const st = state.access[kind];
  if (st === "fullAccess") return;
  if (st === "notDetermined") throw new Fail("access_not_determined", `Access to ${kind} was never requested.`);
  throw new Fail("access_denied", `No full access to ${kind}.`);
}
function nonEmptyTitle(v, field = "title") {
  if (typeof v !== "string" || v.trim() === "") throw new Fail("invalid_input", `${field} must be a non-empty string.`);
  return v.trim();
}
function optString(v, field, allowNull) {
  if (v === null && allowNull) return null;
  if (typeof v !== "string") throw new Fail("invalid_input", `${field} must be a string${allowNull ? " or null" : ""}.`);
  return v;
}
function priorityOf(v) {
  if (!Number.isInteger(v) || v < 0 || v > 9) throw new Fail("invalid_input", "priority must be an integer from 0 to 9.");
  return v;
}
function container(arr, id, what) {
  const c = arr.find((x) => x.id === id);
  if (!c) throw new Fail("not_found", `No ${what} with id ${id}.`);
  return c;
}
function writable(c, what) {
  if (!c.allowsModify) throw new Fail("read_only", `The ${what} "${c.title}" does not allow changes.`);
}
function clampInt(v, def, min, max) {
  if (v === undefined) return def;
  if (typeof v !== "number" || !Number.isFinite(v)) throw new Fail("invalid_input", "Expected a number.");
  return Math.min(max, Math.max(min, Math.trunc(v)));
}

function sortReminders(a, b) {
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
  const x = a.title.toLowerCase();
  const y = b.title.toLowerCase();
  return x < y ? -1 : x > y ? 1 : 0;
}

// Commands

const commands = {
  version() {
    return { helperVersion: "0.1.0-mock", contractVersion: 1 };
  },

  status(_p, state) {
    return { ...state.access };
  },

  "request-access"(p, state) {
    const wantR = p.reminders === undefined ? true : p.reminders;
    const wantE = p.events === undefined ? true : p.events;
    if (typeof wantR !== "boolean" || typeof wantE !== "boolean") {
      throw new Fail("invalid_input", "reminders and events must be booleans.");
    }
    const grant = process.env.REMINDERS_MOCK_GRANT === "deny" ? "denied" : "fullAccess";
    if (wantR && state.access.reminders === "notDetermined") state.access.reminders = grant;
    if (wantE && state.access.events === "notDetermined") state.access.events = grant;
    save(state);
    return { ...state.access };
  },

  snapshot(p, state) {
    const daysAhead = clampInt(p.daysAhead, 7, 1, 60);
    const lookback = clampInt(p.completedLookbackDays, 0, 0, 7);
    const remOk = state.access.reminders === "fullAccess";
    const evOk = state.access.events === "fullAccess";
    const completedSince = lookback > 0 ? midnight(-(lookback - 1)).getTime() : Infinity;
    const reminders = remOk
      ? state.reminders
          .filter((r) => !r.completed || (r.completedAt && Date.parse(r.completedAt) >= completedSince))
          .sort(sortReminders)
      : [];
    const winStart = midnight(0).getTime();
    const winEnd = midnight(daysAhead).getTime();
    const events = evOk
      ? state.events
          .filter((e) => {
            const s = Date.parse(e.start);
            const en = Date.parse(e.end);
            return s < winEnd && (en > winStart || (en === s && s >= winStart));
          })
          .sort((a, b) => Date.parse(a.start) - Date.parse(b.start) || (a.title < b.title ? -1 : a.title > b.title ? 1 : 0))
      : [];
    return {
      generatedAt: iso(new Date()),
      timeZone: timeZone(),
      daysAhead,
      access: { ...state.access },
      lists: remOk ? state.lists : [],
      reminders,
      calendars: evOk ? state.calendars : [],
      events,
    };
  },

  "reminder-create"(p, state) {
    needFull(state, "reminders");
    const title = nonEmptyTitle(p.title);
    const listId = has(p, "listId") ? optString(p.listId, "listId", false) : state.defaultListId;
    const list = container(state.lists, listId, "list");
    writable(list, "list");
    if (has(p, "dueDate") && !isLocalDate(p.dueDate)) throw new Fail("invalid_input", "dueDate must be YYYY-MM-DD.");
    if (has(p, "dueTime")) {
      if (!isLocalTime(p.dueTime)) throw new Fail("invalid_input", "dueTime must be HH:mm.");
      if (!has(p, "dueDate")) throw new Fail("invalid_input", "dueTime needs a dueDate.");
    }
    const now = iso(new Date());
    const rem = {
      id: randomUUID(),
      title,
      notes: has(p, "notes") ? optString(p.notes, "notes", false) : null,
      listId,
      completed: false,
      completedAt: null,
      priority: has(p, "priority") ? priorityOf(p.priority) : 0,
      dueDate: has(p, "dueDate") ? p.dueDate : null,
      dueTime: has(p, "dueTime") ? p.dueTime : null,
      hasRecurrence: false,
      alarmCount: has(p, "dueTime") ? 1 : 0,
      createdAt: now,
      modifiedAt: now,
    };
    state.reminders.push(rem);
    save(state);
    return { reminder: rem };
  },

  "reminder-update"(p, state) {
    needFull(state, "reminders");
    if (typeof p.id !== "string" || p.id === "") throw new Fail("invalid_input", "id is required.");
    const rem = state.reminders.find((r) => r.id === p.id);
    if (!rem) throw new Fail("not_found", `No reminder with id ${p.id}.`);
    writable(container(state.lists, rem.listId, "list"), "list");
    const next = { ...rem };
    if (has(p, "title")) next.title = nonEmptyTitle(p.title);
    if (has(p, "notes")) next.notes = optString(p.notes, "notes", true);
    if (has(p, "listId")) {
      const target = container(state.lists, optString(p.listId, "listId", false), "list");
      writable(target, "list");
      next.listId = target.id;
    }
    if (has(p, "dueDate")) {
      if (p.dueDate === null) {
        next.dueDate = null;
        next.dueTime = null;
      } else if (isLocalDate(p.dueDate)) {
        next.dueDate = p.dueDate;
      } else {
        throw new Fail("invalid_input", "dueDate must be YYYY-MM-DD or null.");
      }
    }
    if (has(p, "dueTime")) {
      if (p.dueTime === null) next.dueTime = null;
      else if (isLocalTime(p.dueTime)) next.dueTime = p.dueTime;
      else throw new Fail("invalid_input", "dueTime must be HH:mm or null.");
    }
    if (next.dueTime !== null && next.dueDate === null) throw new Fail("invalid_input", "dueTime needs a dueDate.");
    if (has(p, "priority")) next.priority = priorityOf(p.priority);
    if (has(p, "completed")) {
      if (typeof p.completed !== "boolean") throw new Fail("invalid_input", "completed must be a boolean.");
      next.completed = p.completed;
      next.completedAt = p.completed ? (rem.completed ? rem.completedAt : iso(new Date())) : null;
    }
    if ((has(p, "dueDate") || has(p, "dueTime")) && rem.alarmCount <= 1) {
      next.alarmCount = next.dueTime !== null ? 1 : 0;
    }
    next.modifiedAt = iso(new Date());
    Object.assign(rem, next);
    save(state);
    return { reminder: rem };
  },

  "event-create"(p, state) {
    needFull(state, "events");
    const title = nonEmptyTitle(p.title);
    const calendarId = has(p, "calendarId") ? optString(p.calendarId, "calendarId", false) : state.defaultCalendarId;
    const cal = container(state.calendars, calendarId, "calendar");
    writable(cal, "calendar");
    const s = parseIsoStrict(p.start, "start");
    const e = parseIsoStrict(p.end, "end");
    const allDay = has(p, "allDay") ? p.allDay : false;
    if (typeof allDay !== "boolean") throw new Fail("invalid_input", "allDay must be a boolean.");
    if (allDay ? e < s : e <= s) throw new Fail("invalid_input", "end must be after start.");
    const ev = {
      id: randomUUID(),
      calendarId,
      title,
      notes: has(p, "notes") ? optString(p.notes, "notes", false) : null,
      location: has(p, "location") ? optString(p.location, "location", false) : null,
      start: iso(new Date(s)),
      end: iso(new Date(e)),
      allDay,
      isRecurring: false,
    };
    state.events.push(ev);
    save(state);
    return { event: ev };
  },

  "event-update"(p, state) {
    needFull(state, "events");
    if (typeof p.id !== "string" || p.id === "") throw new Fail("invalid_input", "id is required.");
    let ev;
    if (has(p, "occurrenceStart")) {
      const occ = Math.floor(parseIsoStrict(p.occurrenceStart, "occurrenceStart") / 1000);
      ev = state.events.find((x) => x.id === p.id && Math.floor(Date.parse(x.start) / 1000) === occ);
    } else {
      ev = state.events.find((x) => x.id === p.id);
    }
    if (!ev) throw new Fail("not_found", `No event with id ${p.id}.`);
    writable(container(state.calendars, ev.calendarId, "calendar"), "calendar");
    const next = { ...ev };
    if (has(p, "title")) next.title = nonEmptyTitle(p.title);
    if (has(p, "calendarId")) {
      const target = container(state.calendars, optString(p.calendarId, "calendarId", false), "calendar");
      writable(target, "calendar");
      next.calendarId = target.id;
    }
    if (has(p, "start")) next.start = iso(new Date(parseIsoStrict(p.start, "start")));
    if (has(p, "end")) next.end = iso(new Date(parseIsoStrict(p.end, "end")));
    if (has(p, "allDay")) {
      if (typeof p.allDay !== "boolean") throw new Fail("invalid_input", "allDay must be a boolean.");
      next.allDay = p.allDay;
    }
    if (has(p, "notes")) next.notes = optString(p.notes, "notes", true);
    if (has(p, "location")) next.location = optString(p.location, "location", true);
    const ns = Date.parse(next.start);
    const ne = Date.parse(next.end);
    // Contract 5.7: for all-day events the end may equal the start.
    if (next.allDay ? ne < ns : ne <= ns) throw new Fail("invalid_input", "end must be after start.");
    Object.assign(ev, next);
    save(state);
    return { event: ev };
  },
};

function main() {
  const [command, rawPayload] = process.argv.slice(2);
  try {
    if (!command || !has(commands, command)) throw new Fail("invalid_input", `Unknown command: ${command ?? "(none)"}.`);
    let payload = {};
    if (rawPayload !== undefined) {
      try {
        payload = JSON.parse(rawPayload);
      } catch {
        throw new Fail("invalid_input", "The payload is not valid JSON.");
      }
      if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
        throw new Fail("invalid_input", "The payload must be a JSON object.");
      }
    }
    if (process.env.REMINDERS_MOCK_GARBAGE === "1") {
      process.stdout.write("this is not json\n");
      process.stderr.write("mock: garbage mode\n");
      process.exitCode = 1;
      return;
    }
    const state = command === "version" ? null : load();
    const data = commands[command](payload, state);
    out({ ok: true, data }, 0);
  } catch (e) {
    if (e instanceof Fail) out({ ok: false, error: { code: e.code, message: e.message } }, 1);
    else {
      process.stderr.write(String(e && e.stack ? e.stack : e) + "\n");
      out({ ok: false, error: { code: "internal", message: String(e && e.message ? e.message : e) } }, 1);
    }
  }
}

main();
