"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/main.ts
var main_exports = {};
__export(main_exports, {
  default: () => RemindersPanelPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian4 = require("obsidian");

// src/types.ts
var CONTRACT_VERSION = 1;
var SNAPSHOT_SCHEMA_VERSION = 1;
var ACCESS_STATUSES = [
  "fullAccess",
  "writeOnly",
  "denied",
  "restricted",
  "notDetermined"
];
var HELPER_ERROR_CODES = [
  "invalid_input",
  "access_denied",
  "access_not_determined",
  "not_found",
  "read_only",
  "unsupported_os",
  "internal"
];

// src/envelope.ts
var HelperError = class extends Error {
  constructor(code, message) {
    super(message);
    this.name = "HelperError";
    this.code = code;
  }
};
function shortText(s, max = 200) {
  const t = s.trim().replace(/\s+/g, " ");
  return t.length > max ? t.slice(0, max) + "..." : t;
}
function parseEnvelope(stdout, stderr = "") {
  const text = stdout.trim();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    const detail = shortText(stderr) || (text === "" ? "no output" : "output was not JSON");
    throw new HelperError("internal", `The helper returned no valid answer (${detail}).`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new HelperError("internal", "The helper answer was not a JSON object.");
  }
  const env = parsed;
  if (env.ok === true) {
    return env.data ?? {};
  }
  if (env.ok === false) {
    const err = env.error;
    const rawCode = err && typeof err.code === "string" ? err.code : "internal";
    const code = HELPER_ERROR_CODES.includes(rawCode) ? rawCode : "internal";
    const message = err && typeof err.message === "string" && err.message !== "" ? err.message : "Unknown error.";
    throw new HelperError(code, message);
  }
  throw new HelperError("internal", "The helper answer had no ok field.");
}
var CODE_LABELS = {
  invalid_input: "Invalid input",
  access_denied: "No access",
  access_not_determined: "Access not granted yet",
  not_found: "Not found",
  read_only: "Read only",
  unsupported_os: "macOS too old",
  internal: "Helper error"
};
function describeError(err) {
  if (err instanceof HelperError) return `${CODE_LABELS[err.code]}: ${err.message}`;
  if (err instanceof Error) return `Error: ${err.message}`;
  return "Something went wrong.";
}

// src/bridge.ts
var EXEC_OPTIONS = { timeout: 2e4, maxBuffer: 16 * 1024 * 1024 };
var REQUEST_ACCESS_OPTIONS = { ...EXEC_OPTIONS, timeout: 11 * 60 * 1e3 };
function expandHome(p, home) {
  if (p === "~") return home;
  if (p.startsWith("~/")) return home.replace(/\/+$/, "") + p.slice(1);
  return p;
}
var SerialQueue = class {
  constructor() {
    this.tail = Promise.resolve();
  }
  run(task) {
    const next = this.tail.then(task, task);
    this.tail = next.catch(() => void 0);
    return next;
  }
};
var HelperBridge = class {
  constructor(execFile, helperPath) {
    this.execFile = execFile;
    this.helperPath = helperPath;
    this.queue = new SerialQueue();
  }
  setHelperPath(p) {
    this.helperPath = p;
  }
  getHelperPath() {
    return this.helperPath;
  }
  call(command, payload) {
    return this.queue.run(() => this.exec(command, payload));
  }
  exec(command, payload) {
    const args = [command, JSON.stringify(payload ?? {})];
    return new Promise((resolve, reject) => {
      try {
        const options = command === "request-access" ? REQUEST_ACCESS_OPTIONS : EXEC_OPTIONS;
        this.execFile(this.helperPath, args, options, (error, stdout, stderr) => {
          const out = String(stdout ?? "");
          const errText = String(stderr ?? "");
          if (out.trim() !== "") {
            try {
              resolve(parseEnvelope(out, errText));
            } catch (e) {
              reject(e);
            }
            return;
          }
          if (error) {
            if (error.code === "ENOENT") {
              reject(new HelperError("internal", `Helper not found at ${this.helperPath}.`));
            } else if (error.code === "EACCES") {
              reject(new HelperError("internal", `Helper is not executable at ${this.helperPath}.`));
            } else if (error.killed || error.signal) {
              reject(new HelperError("internal", "The helper did not answer in time."));
            } else {
              const detail = (errText || error.message).trim().replace(/\s+/g, " ").slice(0, 200);
              reject(new HelperError("internal", `The helper returned no valid answer (${detail}).`));
            }
            return;
          }
          try {
            resolve(parseEnvelope(out, errText));
          } catch (e) {
            reject(e);
          }
        });
      } catch (e) {
        reject(new HelperError("internal", e instanceof Error ? e.message : String(e)));
      }
    });
  }
  async version() {
    const d = await this.call("version");
    return {
      helperVersion: typeof d.helperVersion === "string" ? d.helperVersion : "unknown",
      contractVersion: typeof d.contractVersion === "number" ? d.contractVersion : -1
    };
  }
  async status() {
    return await this.call("status");
  }
  async requestAccess(payload = {}) {
    return await this.call("request-access", payload);
  }
  async snapshot(payload) {
    return await this.call("snapshot", payload);
  }
  async reminderCreate(payload) {
    return (await this.call("reminder-create", payload)).reminder;
  }
  async reminderUpdate(payload) {
    return (await this.call("reminder-update", payload)).reminder;
  }
  async eventCreate(payload) {
    return (await this.call("event-create", payload)).event;
  }
  async eventUpdate(payload) {
    return (await this.call("event-update", payload)).event;
  }
};

// src/gate.ts
function commandKind(command) {
  return command.startsWith("reminder-") ? "reminder" : "event";
}
function canWrite(mode, kind, s) {
  if (mode !== "edit") return false;
  return kind === "reminder" ? s.reminderWriteback : s.calendarWriteback;
}
function gateWrite(mode, command, payload, s) {
  const kind = commandKind(command);
  if (mode !== "edit") return { action: "blocked", reason: "View only on this device." };
  if (kind === "reminder" && !s.reminderWriteback) {
    return { action: "blocked", reason: "Reminder changes are off in settings." };
  }
  if (kind === "event" && !s.calendarWriteback) {
    return { action: "blocked", reason: "Calendar changes are off in settings." };
  }
  if (s.dryRun) {
    return { action: "dryRun", notice: `Dry run: would send ${command} ${JSON.stringify(payload)}` };
  }
  return { action: "send" };
}
var DRY_RUN_LOG_MAX = 50;
var DryRunLog = class {
  constructor() {
    this.entries = [];
  }
  add(command, payload, now = /* @__PURE__ */ new Date()) {
    this.entries.push({ at: now.toISOString(), command, payload });
    if (this.entries.length > DRY_RUN_LOG_MAX) this.entries.splice(0, this.entries.length - DRY_RUN_LOG_MAX);
  }
  /** Newest first. */
  list() {
    return [...this.entries].reverse();
  }
  clear() {
    this.entries = [];
  }
  get size() {
    return this.entries.length;
  }
};
function decideMode(i, helperPath) {
  if (!i.isDesktopApp || !i.isMacOS) return { mode: "view", hint: null };
  if (!i.helperExists) {
    return { mode: "view", hint: `Helper not found at ${helperPath}. Install it or fix the path in settings.` };
  }
  if (i.contractVersion === null) {
    return { mode: "view", hint: `The helper at ${helperPath} did not answer. Check that it runs.` };
  }
  if (i.contractVersion !== CONTRACT_VERSION) {
    return {
      mode: "view",
      hint: `The helper at ${helperPath} uses contract version ${i.contractVersion}, but this plugin needs ${CONTRACT_VERSION}.`
    };
  }
  return { mode: "edit", hint: null };
}

// src/node.ts
function nodeExecFile() {
  const cp = require("child_process");
  return (file, args, options, callback) => cp.execFile(file, args, { timeout: options.timeout, maxBuffer: options.maxBuffer, encoding: "utf8" }, callback);
}
function nodeHomedir() {
  const os = require("os");
  return os.homedir();
}
function nodeHostname() {
  const os = require("os");
  return os.hostname();
}
function nodeFileExists(absPath) {
  const fs = require("fs");
  try {
    return fs.statSync(absPath).isFile();
  } catch {
    return false;
  }
}

// src/dates.ts
var LOCAL_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
var LOCAL_TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
function pad2(n) {
  return n < 10 ? "0" + n : String(n);
}
function isLocalDate(s) {
  if (typeof s !== "string") return false;
  const m = LOCAL_DATE_RE.exec(s);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(y, mo - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d;
}
function isLocalTime(s) {
  return typeof s === "string" && LOCAL_TIME_RE.test(s);
}
function localDateOf(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function localTimeOf(d) {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
function addDays(date, n) {
  const m = LOCAL_DATE_RE.exec(date);
  if (!m) throw new Error(`Not a date: ${date}`);
  const dt = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + n);
  return localDateOf(dt);
}
function localPartsToDate(date, time) {
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
function toIsoLocal(d) {
  const offsetMin = -d.getTimezoneOffset();
  const sign = offsetMin >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMin);
  return `${localDateOf(d)}T${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}${sign}${pad2(Math.floor(abs / 60))}:${pad2(abs % 60)}`;
}
function parseIso(s) {
  return Date.parse(s);
}
function isoDatePart(s) {
  return s.slice(0, 10);
}
function isoIsMidnight(s) {
  return /T00:00(:00(\.0+)?)?(Z|[+-]\d{2}:?\d{2})?$/.test(s);
}
function relativeTime(thenMs, nowMs) {
  const diff = Math.max(0, nowMs - thenMs);
  const min = Math.floor(diff / 6e4);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? "1 day ago" : `${d} days ago`;
}
var WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function dayLabel(date, today) {
  if (date === today) return "Today";
  if (date === addDays(today, 1)) return "Tomorrow";
  if (date === addDays(today, -1)) return "Yesterday";
  const d = localPartsToDate(date);
  return `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}
function shortStamp(ms, nowMs) {
  const d = new Date(ms);
  const t = localTimeOf(d);
  const today = localDateOf(new Date(nowMs));
  const day = localDateOf(d);
  if (day === today) return t;
  return `${dayLabel(day, today)} ${t}`;
}
function nextQuarterHour(now) {
  const d = new Date(now.getTime());
  d.setSeconds(0, 0);
  const add = 15 - d.getMinutes() % 15;
  d.setMinutes(d.getMinutes() + add);
  return localTimeOf(d);
}

// src/payloads.ts
var PRIORITY_VALUES = {
  none: 0,
  low: 9,
  medium: 5,
  high: 1
};
function priorityLevel(p) {
  if (!p || p < 1 || p > 9) return "none";
  if (p < 5) return "high";
  if (p === 5) return "medium";
  return "low";
}
function reminderToForm(r) {
  return {
    title: r.title,
    listId: r.listId,
    dueDate: r.dueDate ?? "",
    dueTime: r.dueTime ?? "",
    priority: priorityLevel(r.priority),
    notes: r.notes ?? ""
  };
}
function checkDateTime(date, time) {
  if (date !== "" && !isLocalDate(date)) return "The date is not valid.";
  if (time !== "" && !isLocalTime(time)) return "The time is not valid.";
  if (time !== "" && date === "") return "Set a date before a time.";
  return null;
}
function buildReminderUpdate(original, form) {
  const title = form.title.trim();
  if (title === "") return { ok: false, error: "The title is empty." };
  const date = form.dueDate.trim();
  const time = form.dueTime.trim();
  const dtError = checkDateTime(date, time);
  if (dtError) return { ok: false, error: dtError };
  const p = { id: original.id };
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
function isEmptyUpdate(p) {
  return Object.keys(p).filter((k) => k !== "id" && k !== "occurrenceStart").length === 0;
}
function buildCompleteToggle(r, completed) {
  return { id: r.id, completed };
}
function pickDefaultContainer(id, containers) {
  if (!id) return void 0;
  const c = containers.find((x) => x.id === id);
  return c && c.allowsModify ? c.id : void 0;
}
function buildReminderCreate(v) {
  const title = v.title.trim();
  if (title === "") return { ok: false, error: "The title is empty." };
  const date = v.dueDate.trim();
  const time = v.dueTime.trim();
  const dtError = checkDateTime(date, time);
  if (dtError) return { ok: false, error: dtError };
  const p = { title };
  if (v.listId) p.listId = v.listId;
  if (v.notes && v.notes !== "") p.notes = v.notes;
  if (date !== "") p.dueDate = date;
  if (time !== "") p.dueTime = time;
  if (v.priority && v.priority !== "none") p.priority = PRIORITY_VALUES[v.priority];
  return { ok: true, payload: p };
}
function buildTimeBlock(v) {
  const title = v.title.trim();
  if (title === "") return { ok: false, error: "The title is empty." };
  if (!isLocalDate(v.date)) return { ok: false, error: "The date is not valid." };
  if (!isLocalTime(v.startTime)) return { ok: false, error: "The start time is not valid." };
  const mins = Math.round(v.durationMinutes);
  if (!Number.isFinite(mins) || mins < 1 || mins > 24 * 60) {
    return { ok: false, error: "The duration must be 1 to 1440 minutes." };
  }
  const start = localPartsToDate(v.date, v.startTime);
  const end = new Date(start.getTime() + mins * 6e4);
  const p = { title, start: toIsoLocal(start), end: toIsoLocal(end) };
  if (v.calendarId) p.calendarId = v.calendarId;
  return { ok: true, payload: p };
}
var DT_LOCAL_RE = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/;
function isoToDateTimeLocal(iso) {
  const ms = parseIso(iso);
  if (Number.isNaN(ms)) return "";
  const d = new Date(ms);
  return toIsoLocal(d).slice(0, 16);
}
function dateTimeLocalToMs(v) {
  const m = DT_LOCAL_RE.exec(v.trim());
  if (!m || !isLocalDate(m[1]) || !isLocalTime(m[2])) return NaN;
  return localPartsToDate(m[1], m[2]).getTime();
}
function eventToForm(e) {
  return {
    title: e.title,
    calendarId: e.calendarId,
    start: isoToDateTimeLocal(e.start),
    end: isoToDateTimeLocal(e.end)
  };
}
function buildEventUpdate(original, form) {
  const title = form.title.trim();
  if (title === "") return { ok: false, error: "The title is empty." };
  const p = { id: original.id, occurrenceStart: original.start };
  if (title !== original.title) p.title = title;
  if (form.calendarId !== "" && form.calendarId !== original.calendarId) p.calendarId = form.calendarId;
  if (!original.allDay) {
    const s = dateTimeLocalToMs(form.start);
    const e = dateTimeLocalToMs(form.end);
    if (Number.isNaN(s)) return { ok: false, error: "The start is not valid." };
    if (Number.isNaN(e)) return { ok: false, error: "The end is not valid." };
    if (e <= s) return { ok: false, error: "The end must be after the start." };
    const origS = Math.floor(parseIso(original.start) / 6e4) * 6e4;
    const origE = Math.floor(parseIso(original.end) / 6e4) * 6e4;
    if (s !== origS) p.start = toIsoLocal(new Date(s));
    if (e !== origE) p.end = toIsoLocal(new Date(e));
  }
  return { ok: true, payload: p };
}
function buildNoteLink(vaultName, filePath) {
  return `obsidian://open?vault=${encodeURIComponent(vaultName)}&file=${encodeURIComponent(filePath)}`;
}

// src/settings.ts
var DEFAULT_HELPER_PATH = "~/Library/Application Support/RemindersPanel/reminders-helper";
var DEFAULT_SETTINGS = {
  helperPath: DEFAULT_HELPER_PATH,
  deviceLabel: "",
  snapshotPath: "",
  daysAhead: 7,
  completedLookbackDays: 1,
  refreshMinutes: 5,
  staleMinutes: 60,
  showEvents: true,
  defaultListId: "",
  defaultCalendarId: "",
  hiddenListIds: [],
  hiddenCalendarIds: [],
  reminderWriteback: false,
  calendarWriteback: false,
  dryRun: true
};
function clampInt(v, min, max, fallback) {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}
function str(v, fallback) {
  return typeof v === "string" ? v : fallback;
}
function bool(v, fallback) {
  return typeof v === "boolean" ? v : fallback;
}
function strList(v) {
  return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
}
function normalizeSettings(raw) {
  const r = typeof raw === "object" && raw !== null ? raw : {};
  const d = DEFAULT_SETTINGS;
  return {
    helperPath: str(r.helperPath, d.helperPath).trim() || d.helperPath,
    deviceLabel: str(r.deviceLabel, d.deviceLabel),
    snapshotPath: str(r.snapshotPath, d.snapshotPath).trim(),
    daysAhead: clampInt(r.daysAhead, 1, 60, d.daysAhead),
    completedLookbackDays: clampInt(r.completedLookbackDays, 0, 7, d.completedLookbackDays),
    refreshMinutes: clampInt(r.refreshMinutes, 1, 240, d.refreshMinutes),
    staleMinutes: clampInt(r.staleMinutes, 1, 10080, d.staleMinutes),
    showEvents: bool(r.showEvents, d.showEvents),
    defaultListId: str(r.defaultListId, d.defaultListId),
    defaultCalendarId: str(r.defaultCalendarId, d.defaultCalendarId),
    hiddenListIds: strList(r.hiddenListIds),
    hiddenCalendarIds: strList(r.hiddenCalendarIds),
    reminderWriteback: bool(r.reminderWriteback, d.reminderWriteback),
    calendarWriteback: bool(r.calendarWriteback, d.calendarWriteback),
    dryRun: bool(r.dryRun, d.dryRun)
  };
}
function defaultSnapshotPath(configDir) {
  return `${configDir}/plugins/reminders-panel/snapshot.json`;
}
function resolveSnapshotPath(setting, configDir) {
  const p = setting.trim().replace(/^\/+/, "");
  return p === "" ? defaultSnapshotPath(configDir) : p;
}
function parentFolder(p) {
  const i = p.lastIndexOf("/");
  return i <= 0 ? "" : p.slice(0, i);
}

// src/snapshotFile.ts
var SNAPSHOT_REWRITE_MS = 15 * 60 * 1e3;
function isObj(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function isStr(v) {
  return typeof v === "string";
}
function isStrOrNull(v) {
  return v === null || typeof v === "string";
}
function isBool(v) {
  return typeof v === "boolean";
}
function isNum(v) {
  return typeof v === "number" && Number.isFinite(v);
}
function validContainer(c) {
  return isObj(c) && isStr(c.id) && isStr(c.title) && isStrOrNull(c.color) && isBool(c.allowsModify);
}
function validReminder(r) {
  return isObj(r) && isStr(r.id) && isStr(r.title) && isStrOrNull(r.notes) && isStr(r.listId) && isBool(r.completed) && isStrOrNull(r.completedAt) && isNum(r.priority) && isStrOrNull(r.dueDate) && isStrOrNull(r.dueTime) && isBool(r.hasRecurrence);
}
function validEvent(e) {
  return isObj(e) && isStr(e.id) && isStr(e.calendarId) && isStr(e.title) && isStrOrNull(e.location) && isStr(e.start) && isStr(e.end) && isBool(e.allDay);
}
function snapshotProblem(s) {
  if (!isObj(s)) return "snapshot is not an object";
  if (!isStr(s.generatedAt)) return "generatedAt is missing";
  if (!isObj(s.access)) return "access is missing";
  const acc = s.access;
  if (!ACCESS_STATUSES.includes(acc.reminders)) return "access.reminders is not valid";
  if (!ACCESS_STATUSES.includes(acc.events)) return "access.events is not valid";
  for (const key of ["lists", "reminders", "calendars", "events"]) {
    if (!Array.isArray(s[key])) return `${key} is not a list`;
  }
  if (!s.lists.every(validContainer)) return "a reminder list is malformed";
  if (!s.calendars.every(validContainer)) return "a calendar is malformed";
  if (!s.reminders.every(validReminder)) return "a reminder is malformed";
  if (!s.events.every(validEvent)) return "an event is malformed";
  return null;
}
function parseSnapshotFile(text) {
  if (text === null) return { ok: false, reason: "missing", detail: "No snapshot file yet." };
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, reason: "unreadable", detail: "The snapshot file is not valid JSON." };
  }
  if (!isObj(parsed)) return { ok: false, reason: "unreadable", detail: "The snapshot file is not a JSON object." };
  if (parsed.schemaVersion !== SNAPSHOT_SCHEMA_VERSION) {
    return {
      ok: false,
      reason: "schema",
      detail: `The snapshot file has schema version ${String(parsed.schemaVersion)}, expected ${SNAPSHOT_SCHEMA_VERSION}. Update the plugin on all devices.`
    };
  }
  if (!isStr(parsed.writtenAt) || Number.isNaN(Date.parse(parsed.writtenAt))) {
    return { ok: false, reason: "invalid", detail: "The snapshot file has no valid writtenAt time." };
  }
  if (!isStr(parsed.writtenBy)) return { ok: false, reason: "invalid", detail: "The snapshot file has no writtenBy." };
  const problem = snapshotProblem(parsed.snapshot);
  if (problem) return { ok: false, reason: "invalid", detail: `The snapshot file is damaged (${problem}).` };
  return { ok: true, file: parsed };
}
function buildSnapshotFile(snapshot, writtenBy, now) {
  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    writtenAt: now.toISOString(),
    writtenBy,
    snapshot
  };
}
function serializeSnapshotFile(f) {
  return JSON.stringify(f, null, 2) + "\n";
}
function stableStringify(v) {
  if (Array.isArray(v)) return "[" + v.map(stableStringify).join(",") + "]";
  if (isObj(v)) {
    const keys = Object.keys(v).sort();
    return "{" + keys.map((k) => JSON.stringify(k) + ":" + stableStringify(v[k])).join(",") + "}";
  }
  return JSON.stringify(v) ?? "null";
}
function snapshotKey(s) {
  const { generatedAt: _ignored, ...rest } = s;
  void _ignored;
  return stableStringify(rest);
}
function shouldWriteSnapshot(last, next, nowMs) {
  if (!last) return true;
  if (last.key !== snapshotKey(next)) return true;
  return nowMs - last.atMs >= SNAPSHOT_REWRITE_MS;
}

// src/settingsTab.ts
var import_obsidian = require("obsidian");
var RemindersSettingTab = class extends import_obsidian.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    const p = this.plugin;
    const s = p.settings;
    const macOnly = p.state.mode === "view" ? "Mac only. " : "";
    containerEl.empty();
    containerEl.addClass("reminders-panel-settings");
    const modeText = p.state.mode === "edit" ? `Mode: edit. Helper version ${p.state.helperVersion ?? "unknown"}.` : `Mode: view only.${p.state.hint ? " " + p.state.hint : ""}`;
    new import_obsidian.Setting(containerEl).setName("Status").setDesc(modeText);
    new import_obsidian.Setting(containerEl).setName("Helper (Mac)").setHeading();
    new import_obsidian.Setting(containerEl).setName("Helper path").setDesc(`${macOnly}Path to the reminders-helper binary. A leading ~ means your home folder.`).addText(
      (t) => t.setPlaceholder(DEFAULT_HELPER_PATH).setValue(s.helperPath).onChange(async (v) => {
        s.helperPath = v.trim() || DEFAULT_HELPER_PATH;
        await p.saveSettings();
      })
    ).addButton(
      (b) => b.setButtonText("Check helper").onClick(async () => {
        await p.recheckHelper();
        this.display();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Device label").setDesc(`${macOnly}Name shown on other devices as the source of the data.`).addText(
      (t) => t.setPlaceholder(p.defaultDeviceLabel()).setValue(s.deviceLabel).onChange(async (v) => {
        s.deviceLabel = v;
        await p.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Snapshot file").setDesc("Vault-relative path. Empty means the default in the plugin folder. Use the same value on every device.").addText(
      (t) => t.setPlaceholder(defaultSnapshotPath(this.app.vault.configDir)).setValue(s.snapshotPath).onChange(async (v) => {
        s.snapshotPath = v.trim();
        await p.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Display").setHeading();
    this.num("daysAhead", "Days ahead", "How many days count as upcoming, including today. 1 to 60.");
    this.num("completedLookbackDays", "Completed days", "Show reminders completed in this many days. 0 hides them. 1 means today.");
    this.num("refreshMinutes", "Refresh every (minutes)", `${macOnly}How often to reload from the helper.`, true);
    this.num("staleMinutes", "Stale after (minutes)", "Show a warning when the data is older than this.");
    this.bool("showEvents", "Show calendar events", "Show events below the reminders.");
    const snap = p.state.snapshot;
    new import_obsidian.Setting(containerEl).setName("Default list").setDesc(`${macOnly}List for new reminders.`).addDropdown((d) => {
      d.addOption("", "Helper default");
      for (const l of (snap?.lists ?? []).filter((x) => x.allowsModify)) d.addOption(l.id, l.title);
      if (s.defaultListId && !snap?.lists.some((l) => l.id === s.defaultListId)) d.addOption(s.defaultListId, "(Unknown list)");
      d.setValue(s.defaultListId).onChange(async (v) => {
        s.defaultListId = v;
        await p.saveSettings();
      });
    });
    new import_obsidian.Setting(containerEl).setName("Default calendar").setDesc(`${macOnly}Calendar for time blocks.`).addDropdown((d) => {
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
    new import_obsidian.Setting(containerEl).setName("Shown lists").setHeading();
    this.visibility(snap?.lists ?? [], "hiddenListIds", "Lists appear here after the first load.");
    new import_obsidian.Setting(containerEl).setName("Shown calendars").setHeading();
    this.visibility(snap?.calendars ?? [], "hiddenCalendarIds", "Calendars appear here after the first load.");
    new import_obsidian.Setting(containerEl).setName("Changes (Mac)").setHeading();
    containerEl.createEl("p", {
      cls: "setting-item-description",
      text: "There is no delete action. Changes go to Apple Reminders and Calendar through the helper."
    });
    this.bool("reminderWriteback", "Allow reminder changes", `${macOnly}Complete, edit and add reminders.`);
    this.bool("calendarWriteback", "Allow calendar changes", `${macOnly}Create time blocks and edit events.`);
    this.bool("dryRun", "Dry run", `${macOnly}Do not send changes. Show what would be sent and log it below.`);
    new import_obsidian.Setting(containerEl).setName("Dry run log").setHeading();
    const entries = p.dryRunLog.list();
    if (entries.length === 0) {
      containerEl.createEl("p", { cls: "setting-item-description", text: "No entries in this session." });
    } else {
      new import_obsidian.Setting(containerEl).setDesc(`${entries.length} entries, newest first. Kept in memory only.`).addButton(
        (b) => b.setButtonText("Clear log").onClick(() => {
          p.dryRunLog.clear();
          this.display();
        })
      );
      const box = containerEl.createDiv({ cls: "reminders-panel-log" });
      for (const e of entries) {
        const line = box.createDiv({ cls: "reminders-panel-log-entry" });
        line.createSpan({ cls: "reminders-panel-log-time", text: new Date(e.at).toLocaleTimeString() + " " });
        line.createEl("code", { text: `${e.command} ${JSON.stringify(e.payload)}` });
      }
    }
  }
  num(key, name, desc, resetTimers = false) {
    const p = this.plugin;
    new import_obsidian.Setting(this.containerEl).setName(name).setDesc(desc).addText((t) => {
      t.inputEl.type = "number";
      t.setPlaceholder(String(DEFAULT_SETTINGS[key])).setValue(String(p.settings[key])).onChange(async (v) => {
        const n = Number(v);
        if (v.trim() === "" || !Number.isFinite(n)) return;
        p.settings[key] = n;
        await p.saveSettings();
        if (resetTimers) p.resetTimers();
        if (key === "daysAhead" || key === "completedLookbackDays") void p.refresh();
      });
    });
  }
  bool(key, name, desc) {
    const p = this.plugin;
    new import_obsidian.Setting(this.containerEl).setName(name).setDesc(desc).addToggle(
      (t) => t.setValue(p.settings[key]).onChange(async (v) => {
        p.settings[key] = v;
        await p.saveSettings();
      })
    );
  }
  visibility(items, key, emptyText) {
    const p = this.plugin;
    if (items.length === 0) {
      this.containerEl.createEl("p", { cls: "setting-item-description", text: emptyText });
      return;
    }
    for (const c of items) {
      new import_obsidian.Setting(this.containerEl).setName(c.title).setDesc(c.source + (c.allowsModify ? "" : " (read only)")).addToggle(
        (t) => t.setValue(!p.settings[key].includes(c.id)).onChange(async (show) => {
          const set = new Set(p.settings[key]);
          if (show) set.delete(c.id);
          else set.add(c.id);
          p.settings[key] = [...set];
          await p.saveSettings();
        })
      );
    }
  }
};

// src/modals.ts
var import_obsidian2 = require("obsidian");
function writableContainers(all) {
  return (all ?? []).filter((c) => c.allowsModify);
}
function addDateInput(setting, value, onChange, type) {
  setting.addText((t) => {
    t.inputEl.type = type;
    t.inputEl.addClass("reminders-panel-input");
    t.setValue(value);
    t.onChange(onChange);
  });
}
function addButtons(modal, saveLabel, onSave) {
  new import_obsidian2.Setting(modal.contentEl).addButton((b) => b.setButtonText("Cancel").onClick(() => modal.close())).addButton((b) => b.setButtonText(saveLabel).setCta().onClick(onSave));
}
var ReminderModal = class extends import_obsidian2.Modal {
  constructor(app, plugin, opts) {
    super(app);
    this.plugin = plugin;
    this.opts = opts;
    this.busy = false;
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
        notes: opts.initial?.notes ?? ""
      };
    }
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.addClass("reminders-panel-modal");
    this.titleEl.setText(this.opts.kind === "edit" ? "Edit reminder" : "New reminder");
    const v = this.values;
    new import_obsidian2.Setting(contentEl).setName("Title").addText((t) => {
      t.setValue(v.title).onChange((x) => v.title = x);
      t.inputEl.addClass("reminders-panel-input");
      window.setTimeout(() => t.inputEl.focus(), 0);
    });
    const lists = writableContainers(this.plugin.state.snapshot?.lists);
    new import_obsidian2.Setting(contentEl).setName("List").addDropdown((d) => {
      if (this.opts.kind === "create") d.addOption("", "Default list");
      for (const l of lists) d.addOption(l.id, l.title);
      d.setValue(v.listId);
      d.onChange((x) => v.listId = x);
    });
    addDateInput(new import_obsidian2.Setting(contentEl).setName("Due date").setDesc("Leave empty for no date."), v.dueDate, (x) => v.dueDate = x, "date");
    addDateInput(new import_obsidian2.Setting(contentEl).setName("Due time").setDesc("Leave empty for a date only."), v.dueTime, (x) => v.dueTime = x, "time");
    new import_obsidian2.Setting(contentEl).setName("Priority").addDropdown((d) => {
      const opts = [
        ["none", "None"],
        ["low", "Low"],
        ["medium", "Medium"],
        ["high", "High"]
      ];
      for (const [k, label] of opts) d.addOption(k, label);
      d.setValue(v.priority);
      d.onChange((x) => v.priority = x);
    });
    new import_obsidian2.Setting(contentEl).setName("Notes").addTextArea((t) => {
      t.setValue(v.notes).onChange((x) => v.notes = x);
      t.inputEl.rows = 4;
      t.inputEl.addClass("reminders-panel-input");
    });
    addButtons(this, this.opts.kind === "edit" ? "Save" : "Add", () => void this.save());
  }
  async save() {
    if (this.busy) return;
    if (this.opts.kind === "edit") {
      const res = buildReminderUpdate(this.opts.reminder, this.values);
      if (!res.ok) return void new import_obsidian2.Notice(res.error);
      if (isEmptyUpdate(res.payload)) {
        new import_obsidian2.Notice("No changes.");
        this.close();
        return;
      }
      this.busy = true;
      const out = await this.plugin.runWrite("reminder-update", res.payload);
      this.busy = false;
      if (out === "sent" || out === "dryRun") this.close();
    } else {
      const res = buildReminderCreate(this.values);
      if (!res.ok) return void new import_obsidian2.Notice(res.error);
      this.busy = true;
      const out = await this.plugin.runWrite("reminder-create", res.payload);
      this.busy = false;
      if (out === "sent" || out === "dryRun") this.close();
    }
  }
  onClose() {
    this.contentEl.empty();
  }
};
var TimeBlockModal = class extends import_obsidian2.Modal {
  constructor(app, plugin, reminder) {
    super(app);
    this.plugin = plugin;
    this.reminder = reminder;
    this.duration = "30";
    this.busy = false;
    const cals = plugin.state.snapshot?.calendars ?? [];
    this.calendarId = pickDefaultContainer(plugin.settings.defaultCalendarId, cals) ?? "";
    const now = /* @__PURE__ */ new Date();
    this.date = reminder.dueDate ?? localDateOf(now);
    this.startTime = reminder.dueTime ?? nextQuarterHour(now);
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.addClass("reminders-panel-modal");
    this.titleEl.setText("Time block");
    contentEl.createEl("p", { text: this.reminder.title || "(No title)", cls: "reminders-panel-modal-subject" });
    const cals = writableContainers(this.plugin.state.snapshot?.calendars);
    new import_obsidian2.Setting(contentEl).setName("Calendar").addDropdown((d) => {
      d.addOption("", "Default calendar");
      for (const c of cals) d.addOption(c.id, c.title);
      d.setValue(this.calendarId);
      d.onChange((x) => this.calendarId = x);
    });
    addDateInput(new import_obsidian2.Setting(contentEl).setName("Date"), this.date, (x) => this.date = x, "date");
    addDateInput(new import_obsidian2.Setting(contentEl).setName("Start time"), this.startTime, (x) => this.startTime = x, "time");
    new import_obsidian2.Setting(contentEl).setName("Duration (minutes)").addText((t) => {
      t.inputEl.type = "number";
      t.inputEl.min = "1";
      t.inputEl.addClass("reminders-panel-input");
      t.setValue(this.duration).onChange((x) => this.duration = x);
    });
    addButtons(this, "Create event", () => void this.save());
  }
  async save() {
    if (this.busy) return;
    const res = buildTimeBlock({
      title: this.reminder.title,
      calendarId: this.calendarId,
      date: this.date,
      startTime: this.startTime,
      durationMinutes: Number(this.duration)
    });
    if (!res.ok) return void new import_obsidian2.Notice(res.error);
    this.busy = true;
    const out = await this.plugin.runWrite("event-create", res.payload);
    this.busy = false;
    if (out === "sent" || out === "dryRun") this.close();
  }
  onClose() {
    this.contentEl.empty();
  }
};
var EventModal = class extends import_obsidian2.Modal {
  constructor(app, plugin, event) {
    super(app);
    this.plugin = plugin;
    this.event = event;
    this.busy = false;
    this.values = eventToForm(event);
  }
  onOpen() {
    const { contentEl } = this;
    const v = this.values;
    contentEl.addClass("reminders-panel-modal");
    this.titleEl.setText("Edit event");
    if (this.event.isRecurring) {
      contentEl.createEl("p", { text: "This is a repeating event. Only this occurrence changes.", cls: "reminders-panel-muted" });
    }
    new import_obsidian2.Setting(contentEl).setName("Title").addText((t) => {
      t.setValue(v.title).onChange((x) => v.title = x);
      t.inputEl.addClass("reminders-panel-input");
    });
    const cals = writableContainers(this.plugin.state.snapshot?.calendars);
    new import_obsidian2.Setting(contentEl).setName("Calendar").addDropdown((d) => {
      for (const c of cals) d.addOption(c.id, c.title);
      d.setValue(v.calendarId);
      d.onChange((x) => v.calendarId = x);
    });
    if (this.event.allDay) {
      contentEl.createEl("p", { text: "All-day event. Change its dates in Calendar.", cls: "reminders-panel-muted" });
    } else {
      addDateInput(new import_obsidian2.Setting(contentEl).setName("Start"), v.start, (x) => v.start = x, "datetime-local");
      addDateInput(new import_obsidian2.Setting(contentEl).setName("End"), v.end, (x) => v.end = x, "datetime-local");
    }
    addButtons(this, "Save", () => void this.save());
  }
  async save() {
    if (this.busy) return;
    const res = buildEventUpdate(this.event, this.values);
    if (!res.ok) return void new import_obsidian2.Notice(res.error);
    if (isEmptyUpdate(res.payload)) {
      new import_obsidian2.Notice("No changes.");
      this.close();
      return;
    }
    this.busy = true;
    const out = await this.plugin.runWrite("event-update", res.payload);
    this.busy = false;
    if (out === "sent" || out === "dryRun") this.close();
  }
  onClose() {
    this.contentEl.empty();
  }
};

// src/view.ts
var import_obsidian3 = require("obsidian");

// src/grouping.ts
function compareReminders(a, b) {
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
function sortReminders(list) {
  return [...list].sort(compareReminders);
}
function groupReminders(reminders, now, daysAhead, hiddenListIds = []) {
  const hidden = new Set(hiddenListIds);
  const today = localDateOf(now);
  const windowEnd = addDays(today, Math.max(1, daysAhead));
  const groups = {
    overdue: [],
    today: [],
    upcoming: [],
    later: [],
    noDate: [],
    completed: []
  };
  const upcomingByDay = /* @__PURE__ */ new Map();
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
  groups.upcoming = [...upcomingByDay.entries()].sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0).map(([date, items]) => ({ date, items }));
  groups.completed.sort((a, b) => {
    const ta = a.completedAt ? parseIso(a.completedAt) : 0;
    const tb = b.completedAt ? parseIso(b.completedAt) : 0;
    return tb - ta;
  });
  return groups;
}
function eventDaySpan(e) {
  if (e.allDay) {
    const first2 = isoDatePart(e.start);
    let last2 = isoDatePart(e.end);
    if (isoIsMidnight(e.end) && last2 > first2) last2 = addDays(last2, -1);
    if (last2 < first2) last2 = first2;
    return [first2, last2];
  }
  const startMs = parseIso(e.start);
  const endMs = parseIso(e.end);
  const first = localDateOf(new Date(startMs));
  const lastMs = endMs > startMs ? endMs - 1 : startMs;
  const last = localDateOf(new Date(lastMs));
  return [first, last < first ? first : last];
}
function compareEvents(a, b) {
  if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
  const sa = parseIso(a.start);
  const sb = parseIso(b.start);
  if (sa !== sb) return sa - sb;
  const ta = a.title.toLocaleLowerCase();
  const tb = b.title.toLocaleLowerCase();
  return ta < tb ? -1 : ta > tb ? 1 : 0;
}
function groupEvents(events, now, daysAhead, hiddenCalendarIds = []) {
  const hidden = new Set(hiddenCalendarIds);
  const today = localDateOf(now);
  const days = Math.max(1, daysAhead);
  const out = [];
  const visible = events.filter((e) => !hidden.has(e.calendarId) && !Number.isNaN(parseIso(e.start)));
  for (let i = 0; i < days; i++) {
    const day = addDays(today, i);
    const items = visible.filter((e) => {
      const [first, last] = eventDaySpan(e);
      return first <= day && day <= last;
    }).sort(compareEvents);
    if (items.length > 0) out.push({ date: day, items });
  }
  return out;
}
function eventKey(e) {
  return `${e.id}|${e.start}`;
}

// src/view.ts
var VIEW_TYPE = "reminders-panel-view";
var P = "reminders-panel-";
function accessHelp(status, what) {
  if (status === "fullAccess") return null;
  if (status === "notDetermined") return null;
  return `No access to ${what}. Open System Settings, then Privacy and Security, then ${what}, and allow access.`;
}
var RemindersPanelView = class extends import_obsidian3.ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.unsubscribe = null;
    this.collapsed = /* @__PURE__ */ new Map([
      ["noDate", true],
      ["completed", true]
    ]);
    // Quick add values survive re-renders.
    this.qa = { title: "", date: "", time: "", listId: "" };
    this.qaListTouched = false;
    this.qaBusy = false;
    this.qaSig = "";
  }
  getViewType() {
    return VIEW_TYPE;
  }
  getDisplayText() {
    return "Reminders";
  }
  getIcon() {
    return "list-checks";
  }
  async onOpen() {
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
  async onClose() {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }
  render() {
    if (!this.headerEl) return;
    this.renderHeader();
    this.renderQuickAdd();
    this.renderBody();
  }
  // Header
  renderHeader() {
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
      if (now - s.updatedAtMs > this.plugin.settings.staleMinutes * 6e4) {
        status.addClass(P + "stale");
        status.setAttr("title", "This data is old.");
      }
    } else {
      status.setText(s.mode === "edit" ? "Not loaded yet" : "View only");
    }
    const btn = top.createEl("button", { cls: [P + "icon-button", "clickable-icon"], attr: { "aria-label": "Refresh" } });
    (0, import_obsidian3.setIcon)(btn, "refresh-cw");
    if (s.loading) btn.addClass(P + "spinning");
    btn.addEventListener("click", () => void this.plugin.refresh(true));
    if (s.mode === "edit" && this.plugin.settings.dryRun && (this.plugin.settings.reminderWriteback || this.plugin.settings.calendarWriteback)) {
      el.createDiv({ cls: P + "note", text: "Dry run is on. Changes are not sent." });
    }
    if (s.hint) el.createDiv({ cls: [P + "note", P + "warning"], text: s.hint });
    if (s.lastError) el.createDiv({ cls: [P + "note", P + "error"], text: s.lastError });
  }
  // Quick add
  renderQuickAdd(force = false) {
    const el = this.quickAddEl;
    const snap = this.plugin.state.snapshot;
    const enabled = this.plugin.canWrite("reminder") && !!snap && snap.access.reminders === "fullAccess";
    const lists = enabled && snap ? snap.lists.filter((l) => l.allowsModify) : [];
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
      attr: { type: "text", placeholder: "New reminder", "aria-label": "New reminder title" }
    });
    title.value = this.qa.title;
    title.addEventListener("input", () => this.qa.title = title.value);
    title.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        void this.submitQuickAdd();
      }
    });
    const row = el.createDiv({ cls: P + "qa-row" });
    const date = row.createEl("input", { cls: P + "qa-date", attr: { type: "date", "aria-label": "Due date" } });
    date.value = this.qa.date;
    date.addEventListener("change", () => this.qa.date = date.value);
    const time = row.createEl("input", { cls: P + "qa-time", attr: { type: "time", "aria-label": "Due time" } });
    time.value = this.qa.time;
    time.addEventListener("change", () => this.qa.time = time.value);
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
  async submitQuickAdd() {
    if (this.qaBusy) return;
    const res = buildReminderCreate({
      title: this.qa.title,
      listId: this.qa.listId,
      dueDate: this.qa.date,
      dueTime: this.qa.time
    });
    if (!res.ok) {
      new import_obsidian3.Notice(res.error);
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
  renderBody() {
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
    const now = /* @__PURE__ */ new Date();
    const today = localDateOf(now);
    const settings = this.plugin.settings;
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
  renderAccess(el, status, what) {
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
  section(parent, key, title, count, fill, extraCls) {
    if (count === 0) return;
    const sec = parent.createDiv({ cls: P + "section" });
    if (extraCls) sec.addClass(extraCls);
    const isCollapsed = this.collapsed.get(key) ?? false;
    const head = sec.createDiv({ cls: P + "section-head", attr: { role: "button", tabindex: "0", "aria-expanded": String(!isCollapsed) } });
    const chevron = head.createSpan({ cls: P + "chevron" });
    (0, import_obsidian3.setIcon)(chevron, isCollapsed ? "chevron-right" : "chevron-down");
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
  dot(parent, c) {
    const d = parent.createSpan({ cls: P + "dot" });
    if (c?.color) d.style.setProperty("--reminders-panel-dot", c.color);
  }
  reminderRow(parent, r, lists, today, showDate) {
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
      if (!r.completed && r.dueDate === today && r.dueTime < localTimeOf(/* @__PURE__ */ new Date())) t.addClass(P + "past");
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
      (0, import_obsidian3.setIcon)(more, "more-horizontal");
      more.addEventListener("click", (evt) => {
        const menu = new import_obsidian3.Menu();
        if (writable) {
          menu.addItem(
            (i) => i.setTitle("Edit").setIcon("pencil").onClick(() => new ReminderModal(this.app, this.plugin, { kind: "edit", reminder: r }).open())
          );
        }
        if (canTimeBlock) {
          menu.addItem(
            (i) => i.setTitle("Time block").setIcon("calendar-plus").onClick(() => new TimeBlockModal(this.app, this.plugin, r).open())
          );
        }
        menu.showAtMouseEvent(evt);
      });
    }
  }
  marker(parent, icon, label) {
    const m = parent.createSpan({ cls: P + "marker", attr: { "aria-label": label, title: label } });
    (0, import_obsidian3.setIcon)(m, icon);
  }
  eventRow(parent, e, cals, day) {
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
  eventTime(e, day) {
    if (e.allDay) return "All day";
    const s = new Date(parseIso(e.start));
    const en = new Date(parseIso(e.end));
    const startText = localDateOf(s) === day ? localTimeOf(s) : "...";
    const endText = localDateOf(en) === day ? localTimeOf(en) : "...";
    return `${startText} - ${endText}`;
  }
};

// src/main.ts
var FOCUS_THROTTLE_MS = 30 * 1e3;
var VIEW_MODE_POLL_MS = 60 * 1e3;
var RemindersPanelPlugin = class extends import_obsidian4.Plugin {
  constructor() {
    super(...arguments);
    this.dryRunLog = new DryRunLog();
    this.state = {
      ready: false,
      mode: "view",
      hint: null,
      helperVersion: null,
      snapshot: null,
      updatedAtMs: null,
      writtenBy: null,
      emptyReason: null,
      lastError: null,
      loading: false
    };
    this.bridge = null;
    this.listeners = /* @__PURE__ */ new Set();
    this.refreshing = null;
    this.refreshAgain = false;
    this.lastWrite = null;
    this.lastFocusRefresh = 0;
    this.editTimer = null;
    this.viewTimer = null;
  }
  async onload() {
    await this.loadSettings();
    this.registerView(VIEW_TYPE, (leaf) => new RemindersPanelView(leaf, this));
    this.addRibbonIcon("list-checks", "Open reminders panel", () => void this.activateView());
    this.addSettingTab(new RemindersSettingTab(this.app, this));
    this.addCommand({ id: "open-panel", name: "Open panel", callback: () => void this.activateView() });
    this.addCommand({ id: "refresh", name: "Refresh", callback: () => void this.refresh(true) });
    this.addCommand({ id: "new-reminder", name: "New reminder", callback: () => this.openNewReminder() });
    this.addCommand({
      id: "new-reminder-from-note",
      name: "New reminder from current note",
      callback: () => this.openNewReminderFromNote()
    });
    this.addCommand({ id: "request-access", name: "Request access", callback: () => void this.requestAccess() });
    this.registerDomEvent(window, "focus", () => {
      if (this.state.mode !== "edit") return;
      const now = Date.now();
      if (now - this.lastFocusRefresh < FOCUS_THROTTLE_MS) return;
      this.lastFocusRefresh = now;
      void this.refresh();
    });
    this.registerDomEvent(document, "visibilitychange", () => {
      if (this.state.mode === "view" && document.visibilityState === "visible" && this.panelIsOpen()) {
        void this.refresh();
      }
    });
    this.app.workspace.onLayoutReady(() => void this.start());
  }
  onunload() {
    this.clearTimers();
    this.listeners.clear();
  }
  // Settings
  async loadSettings() {
    this.settings = normalizeSettings(await this.loadData());
  }
  async saveSettings() {
    this.settings = normalizeSettings(this.settings);
    await this.saveData(this.settings);
    this.notify();
  }
  /** Call after changing helperPath. */
  async recheckHelper() {
    this.bridge = null;
    await this.detectMode();
    this.resetTimers();
    await this.refresh(true);
  }
  /** Call after changing refreshMinutes. */
  resetTimers() {
    this.clearTimers();
    if (this.state.mode === "edit") {
      this.editTimer = window.setInterval(() => void this.refresh(), this.settings.refreshMinutes * 60 * 1e3);
      this.registerInterval(this.editTimer);
    } else {
      this.viewTimer = window.setInterval(() => {
        if (document.visibilityState === "visible" && this.panelIsOpen()) void this.refresh();
      }, VIEW_MODE_POLL_MS);
      this.registerInterval(this.viewTimer);
    }
  }
  clearTimers() {
    if (this.editTimer !== null) window.clearInterval(this.editTimer);
    if (this.viewTimer !== null) window.clearInterval(this.viewTimer);
    this.editTimer = null;
    this.viewTimer = null;
  }
  // State
  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  notify() {
    for (const fn of this.listeners) {
      try {
        fn();
      } catch (e) {
        console.error("Reminders Panel: render failed", e);
      }
    }
  }
  setState(patch) {
    this.state = { ...this.state, ...patch };
    this.notify();
  }
  snapshotPath() {
    return resolveSnapshotPath(this.settings.snapshotPath, this.app.vault.configDir);
  }
  deviceLabel() {
    if (this.settings.deviceLabel.trim() !== "") return this.settings.deviceLabel.trim();
    return this.defaultDeviceLabel();
  }
  defaultDeviceLabel() {
    if (import_obsidian4.Platform.isDesktopApp) {
      try {
        const h = nodeHostname().replace(/\.local$/, "");
        if (h) return h;
      } catch {
      }
    }
    return "Mac";
  }
  expandedHelperPath() {
    if (!import_obsidian4.Platform.isDesktopApp) return this.settings.helperPath;
    try {
      return expandHome(this.settings.helperPath, nodeHomedir());
    } catch {
      return this.settings.helperPath;
    }
  }
  canWrite(kind) {
    return canWrite(this.state.mode, kind, this.settings);
  }
  panelIsOpen() {
    return this.app.workspace.getLeavesOfType(VIEW_TYPE).length > 0;
  }
  // Startup and mode
  async start() {
    await this.detectMode();
    this.resetTimers();
    await this.refresh();
  }
  async detectMode() {
    const isDesktopApp = import_obsidian4.Platform.isDesktopApp;
    const isMacOS = import_obsidian4.Platform.isMacOS;
    let helperExists = false;
    let contractVersion = null;
    let helperVersion = null;
    const path = this.expandedHelperPath();
    if (isDesktopApp && isMacOS) {
      helperExists = nodeFileExists(path);
      if (helperExists) {
        const bridge = new HelperBridge(nodeExecFile(), path);
        try {
          const v = await bridge.version();
          contractVersion = v.contractVersion;
          helperVersion = v.helperVersion;
          this.bridge = bridge;
        } catch (e) {
          console.warn("Reminders Panel: helper version failed", e);
        }
      }
    }
    const d = decideMode({ isDesktopApp, isMacOS, helperExists, contractVersion }, path);
    if (d.mode !== "edit") this.bridge = null;
    this.setState({ ready: true, mode: d.mode, hint: d.hint, helperVersion });
  }
  // Refresh
  /** Refreshes from the helper (edit mode) or the snapshot file (view mode). Calls are merged. */
  async refresh(manual = false) {
    if (!this.state.ready) return;
    if (this.refreshing) {
      this.refreshAgain = true;
      return this.refreshing;
    }
    this.refreshing = (async () => {
      do {
        this.refreshAgain = false;
        this.setState({ loading: true });
        try {
          if (this.state.mode === "edit") await this.refreshFromHelper();
          else await this.refreshFromFile();
        } finally {
          this.setState({ loading: false });
        }
      } while (this.refreshAgain);
    })();
    try {
      await this.refreshing;
    } finally {
      this.refreshing = null;
    }
    if (manual && this.state.lastError) new import_obsidian4.Notice(this.state.lastError);
  }
  async refreshFromHelper() {
    const bridge = this.bridge;
    if (!bridge) return;
    try {
      const snap = await bridge.snapshot({
        daysAhead: this.settings.daysAhead,
        completedLookbackDays: this.settings.completedLookbackDays
      });
      const problem = snapshotProblem(snap);
      if (problem) throw new HelperError("internal", `The helper sent a bad snapshot (${problem}).`);
      const ms = Date.parse(snap.generatedAt);
      this.setState({
        snapshot: snap,
        updatedAtMs: Number.isNaN(ms) ? Date.now() : ms,
        writtenBy: null,
        emptyReason: null,
        lastError: null
      });
      await this.maybeWriteSnapshotFile(snap);
    } catch (e) {
      this.setState({
        lastError: describeError(e),
        emptyReason: this.state.snapshot ? null : "Could not load data from the helper."
      });
    }
  }
  async maybeWriteSnapshotFile(snap) {
    if (this.state.mode !== "edit") return;
    const now = /* @__PURE__ */ new Date();
    if (!shouldWriteSnapshot(this.lastWrite, snap, now.getTime())) return;
    const path = this.snapshotPath();
    const adapter = this.app.vault.adapter;
    try {
      const folder = parentFolder(path);
      if (folder && !await adapter.exists(folder)) await adapter.mkdir(folder);
      await adapter.write(path, serializeSnapshotFile(buildSnapshotFile(snap, this.deviceLabel(), now)));
      this.lastWrite = { key: snapshotKey(snap), atMs: now.getTime() };
    } catch (e) {
      console.error("Reminders Panel: could not write snapshot file", e);
      this.setState({ lastError: `Could not write the snapshot file at ${path}.` });
    }
  }
  async refreshFromFile() {
    const path = this.snapshotPath();
    const adapter = this.app.vault.adapter;
    let text = null;
    try {
      text = await adapter.exists(path) ? await adapter.read(path) : null;
    } catch {
      this.setState({
        snapshot: null,
        updatedAtMs: null,
        writtenBy: null,
        emptyReason: `Could not read the snapshot file at ${path}.`,
        lastError: null
      });
      return;
    }
    const res = parseSnapshotFile(text);
    if (!res.ok) {
      const extra = res.reason === "missing" ? ` Expected at ${path}. Open Obsidian on your Mac with the helper installed, then wait for sync.` : ` File: ${path}.`;
      this.setState({
        snapshot: null,
        updatedAtMs: null,
        writtenBy: null,
        emptyReason: res.detail + extra,
        lastError: null
      });
      return;
    }
    this.setState({
      snapshot: res.file.snapshot,
      updatedAtMs: Date.parse(res.file.writtenAt),
      writtenBy: res.file.writtenBy,
      emptyReason: null,
      lastError: null
    });
  }
  // Writes
  /** Runs a write through the gate. Refreshes after a real write. Never updates optimistically. */
  async runWrite(command, payload) {
    const decision = gateWrite(this.state.mode, command, payload, this.settings);
    if (decision.action === "blocked") {
      new import_obsidian4.Notice(decision.reason);
      return "blocked";
    }
    if (decision.action === "dryRun") {
      this.dryRunLog.add(command, payload);
      new import_obsidian4.Notice(decision.notice, 8e3);
      this.notify();
      return "dryRun";
    }
    const bridge = this.bridge;
    if (!bridge) {
      new import_obsidian4.Notice("The helper is not available.");
      return "failed";
    }
    try {
      await bridge.call(command, payload);
    } catch (e) {
      new import_obsidian4.Notice(describeError(e), 8e3);
      return "failed";
    }
    await this.refresh();
    return "sent";
  }
  async requestAccess() {
    if (this.state.mode !== "edit" || !this.bridge) {
      new import_obsidian4.Notice("Access can only be requested on a Mac with the helper installed.");
      return;
    }
    try {
      await this.bridge.requestAccess({ reminders: true, events: true });
    } catch (e) {
      new import_obsidian4.Notice(describeError(e), 8e3);
    }
    await this.refresh(true);
  }
  // Commands
  async activateView() {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(VIEW_TYPE)[0] ?? null;
    if (!leaf) {
      leaf = workspace.getRightLeaf(false);
      if (!leaf) return;
      await leaf.setViewState({ type: VIEW_TYPE, active: true });
    }
    await workspace.revealLeaf(leaf);
    if (this.state.mode === "view") void this.refresh();
  }
  writeBlockedReason() {
    if (this.state.mode !== "edit") return "View only on this device.";
    if (!this.settings.reminderWriteback) return "Reminder changes are off in settings.";
    return null;
  }
  openNewReminder(initial) {
    const reason = this.writeBlockedReason();
    if (reason) {
      new import_obsidian4.Notice(reason);
      return;
    }
    new ReminderModal(this.app, this, { kind: "create", initial }).open();
  }
  openNewReminderFromNote() {
    const file = this.app.workspace.getActiveFile();
    if (!file) {
      new import_obsidian4.Notice("Open a note first.");
      return;
    }
    this.openNewReminder({
      title: file.basename,
      notes: buildNoteLink(this.app.vault.getName(), file.path)
    });
  }
};
