// Snapshot validation, the snapshot file (contract section 7) and change detection.
// Pure module, no obsidian import.

import { ACCESS_STATUSES, SNAPSHOT_SCHEMA_VERSION, type Snapshot, type SnapshotFile } from "./types";

export const SNAPSHOT_REWRITE_MS = 15 * 60 * 1000;

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function isStr(v: unknown): v is string {
  return typeof v === "string";
}
function isStrOrNull(v: unknown): boolean {
  return v === null || typeof v === "string";
}
function isBool(v: unknown): v is boolean {
  return typeof v === "boolean";
}
function isNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function validContainer(c: unknown): boolean {
  return isObj(c) && isStr(c.id) && isStr(c.title) && isStrOrNull(c.color) && isBool(c.allowsModify);
}

function validReminder(r: unknown): boolean {
  return (
    isObj(r) &&
    isStr(r.id) &&
    isStr(r.title) &&
    isStrOrNull(r.notes) &&
    isStr(r.listId) &&
    isBool(r.completed) &&
    isStrOrNull(r.completedAt) &&
    isNum(r.priority) &&
    isStrOrNull(r.dueDate) &&
    isStrOrNull(r.dueTime) &&
    isBool(r.hasRecurrence)
  );
}

function validEvent(e: unknown): boolean {
  return (
    isObj(e) &&
    isStr(e.id) &&
    isStr(e.calendarId) &&
    isStr(e.title) &&
    isStrOrNull(e.location) &&
    isStr(e.start) &&
    isStr(e.end) &&
    isBool(e.allDay)
  );
}

/** Returns null when valid, else a short reason. */
export function snapshotProblem(s: unknown): string | null {
  if (!isObj(s)) return "snapshot is not an object";
  if (!isStr(s.generatedAt)) return "generatedAt is missing";
  if (!isObj(s.access)) return "access is missing";
  const acc = s.access;
  if (!(ACCESS_STATUSES as readonly unknown[]).includes(acc.reminders)) return "access.reminders is not valid";
  if (!(ACCESS_STATUSES as readonly unknown[]).includes(acc.events)) return "access.events is not valid";
  for (const key of ["lists", "reminders", "calendars", "events"] as const) {
    if (!Array.isArray(s[key])) return `${key} is not a list`;
  }
  if (!(s.lists as unknown[]).every(validContainer)) return "a reminder list is malformed";
  if (!(s.calendars as unknown[]).every(validContainer)) return "a calendar is malformed";
  if (!(s.reminders as unknown[]).every(validReminder)) return "a reminder is malformed";
  if (!(s.events as unknown[]).every(validEvent)) return "an event is malformed";
  return null;
}

export type SnapshotFileResult =
  | { ok: true; file: SnapshotFile }
  | { ok: false; reason: "missing" | "unreadable" | "schema" | "invalid"; detail: string };

/** Validates the text of the snapshot file. Pass null when the file does not exist. */
export function parseSnapshotFile(text: string | null): SnapshotFileResult {
  if (text === null) return { ok: false, reason: "missing", detail: "No snapshot file yet." };
  let parsed: unknown;
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
      detail: `The snapshot file has schema version ${String(parsed.schemaVersion)}, expected ${SNAPSHOT_SCHEMA_VERSION}. Update the plugin on all devices.`,
    };
  }
  if (!isStr(parsed.writtenAt) || Number.isNaN(Date.parse(parsed.writtenAt))) {
    return { ok: false, reason: "invalid", detail: "The snapshot file has no valid writtenAt time." };
  }
  if (!isStr(parsed.writtenBy)) return { ok: false, reason: "invalid", detail: "The snapshot file has no writtenBy." };
  const problem = snapshotProblem(parsed.snapshot);
  if (problem) return { ok: false, reason: "invalid", detail: `The snapshot file is damaged (${problem}).` };
  return { ok: true, file: parsed as unknown as SnapshotFile };
}

export function buildSnapshotFile(snapshot: Snapshot, writtenBy: string, now: Date): SnapshotFile {
  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    writtenAt: now.toISOString(),
    writtenBy,
    snapshot,
  };
}

export function serializeSnapshotFile(f: SnapshotFile): string {
  return JSON.stringify(f, null, 2) + "\n";
}

/** JSON with sorted object keys, so key order does not affect comparison. */
export function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return "[" + v.map(stableStringify).join(",") + "]";
  if (isObj(v)) {
    const keys = Object.keys(v).sort();
    return "{" + keys.map((k) => JSON.stringify(k) + ":" + stableStringify(v[k])).join(",") + "}";
  }
  return JSON.stringify(v) ?? "null";
}

/** A comparison key for a snapshot that ignores generatedAt. */
export function snapshotKey(s: Snapshot): string {
  const { generatedAt: _ignored, ...rest } = s;
  void _ignored;
  return stableStringify(rest);
}

export function snapshotsEqual(a: Snapshot, b: Snapshot): boolean {
  return snapshotKey(a) === snapshotKey(b);
}

export interface LastWrite {
  key: string;
  atMs: number;
}

/** Write when nothing was written yet, when the data changed, or when the last write is 15 minutes old or more. */
export function shouldWriteSnapshot(last: LastWrite | null, next: Snapshot, nowMs: number): boolean {
  if (!last) return true;
  if (last.key !== snapshotKey(next)) return true;
  return nowMs - last.atMs >= SNAPSHOT_REWRITE_MS;
}
