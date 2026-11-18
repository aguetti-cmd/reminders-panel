// End to end: the real HelperBridge runs dev/mock-helper.mjs through real child_process.execFile.

import { execFile } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HelperBridge, type ExecFileFn } from "../src/bridge";
import { HelperError } from "../src/envelope";
import { localDateOf } from "../src/dates";
import { snapshotProblem } from "../src/snapshotFile";

const MOCK = resolve(__dirname, "../dev/mock-helper.mjs");
let dir = "";

const realExecFile: ExecFileFn = (file, args, options, cb) =>
  execFile(file, args, { ...options, encoding: "utf8" }, cb);

function bridgeWithState(name: string, env: Record<string, string> = {}): HelperBridge {
  const statePath = join(dir, name + ".json");
  const withEnv: ExecFileFn = (file, args, options, cb) =>
    execFile(
      file,
      args,
      { ...options, encoding: "utf8", env: { ...process.env, REMINDERS_MOCK_STATE: statePath, ...env } },
      cb,
    );
  return new HelperBridge(withEnv, MOCK);
}

beforeAll(() => {
  chmodSync(MOCK, 0o755);
  dir = mkdtempSync(join(tmpdir(), "rp-mock-"));
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("bridge against the mock helper", () => {
  it("version returns contract version 1", async () => {
    const b = new HelperBridge(realExecFile, MOCK);
    const v = await b.version();
    expect(v.contractVersion).toBe(1);
    expect(typeof v.helperVersion).toBe("string");
  });

  it("snapshot returns a valid, sorted snapshot", async () => {
    const b = bridgeWithState("snap");
    const s = await b.snapshot({ daysAhead: 7, completedLookbackDays: 1 });
    expect(snapshotProblem(s)).toBeNull();
    expect(s.daysAhead).toBe(7);
    expect(s.access).toEqual({ reminders: "fullAccess", events: "fullAccess" });
    expect(s.reminders.some((r) => r.completed)).toBe(true);
    // Contract sort: dated first, nulls last.
    const dates = s.reminders.map((r) => r.dueDate);
    const firstNull = dates.indexOf(null);
    expect(firstNull === -1 || dates.slice(firstNull).every((d) => d === null)).toBe(true);
    // Lookback 0 hides completed.
    const s0 = await b.snapshot({ daysAhead: 100, completedLookbackDays: 0 });
    expect(s0.reminders.some((r) => r.completed)).toBe(false);
    expect(s0.daysAhead).toBe(60);
  });

  it("reminder-create then reminder-update with absent versus null", async () => {
    const b = bridgeWithState("crud");
    const today = localDateOf(new Date());
    const created = await b.reminderCreate({ title: "  Test item ", listId: "list-work", dueDate: today, dueTime: "09:30", notes: "n" });
    expect(created).toMatchObject({ title: "Test item", listId: "list-work", dueDate: today, dueTime: "09:30", alarmCount: 1, notes: "n" });

    // Absent keys do not change anything.
    const renamed = await b.reminderUpdate({ id: created.id, title: "Renamed" });
    expect(renamed).toMatchObject({ title: "Renamed", dueDate: today, dueTime: "09:30", notes: "n" });

    // dueTime null makes it date-only, notes null clears.
    const dateOnly = await b.reminderUpdate({ id: created.id, dueTime: null, notes: null });
    expect(dateOnly).toMatchObject({ dueDate: today, dueTime: null, notes: null, alarmCount: 0 });

    // dueDate null clears the date and the time.
    await b.reminderUpdate({ id: created.id, dueTime: "11:00" });
    const cleared = await b.reminderUpdate({ id: created.id, dueDate: null });
    expect(cleared).toMatchObject({ dueDate: null, dueTime: null });

    const done = await b.reminderUpdate({ id: created.id, completed: true });
    expect(done.completed).toBe(true);
    expect(done.completedAt).not.toBeNull();
    const reopened = await b.reminderUpdate({ id: created.id, completed: false });
    expect(reopened).toMatchObject({ completed: false, completedAt: null });

    const snap = await b.snapshot({});
    expect(snap.reminders.find((r) => r.id === created.id)?.title).toBe("Renamed");
  });

  it("event-create and event-update with occurrenceStart", async () => {
    const b = bridgeWithState("events");
    const start = new Date();
    start.setHours(15, 0, 0, 0);
    const end = new Date(start.getTime() + 30 * 60000);
    const ev = await b.eventCreate({ title: "Block", calendarId: "cal-work", start: start.toISOString(), end: end.toISOString() });
    expect(ev.calendarId).toBe("cal-work");
    const moved = await b.eventUpdate({ id: ev.id, occurrenceStart: ev.start, title: "Block 2" });
    expect(moved.title).toBe("Block 2");
    await expect(b.eventUpdate({ id: ev.id, occurrenceStart: "2000-01-01T00:00:00Z", title: "x" })).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("returns typed errors: not_found, read_only, invalid_input", async () => {
    const b = bridgeWithState("errors");
    await expect(b.reminderUpdate({ id: "does-not-exist", completed: true })).rejects.toMatchObject({ code: "not_found" });
    await expect(b.reminderCreate({ title: "x", listId: "list-shared" })).rejects.toMatchObject({ code: "read_only" });
    await expect(b.reminderCreate({ title: "   " })).rejects.toMatchObject({ code: "invalid_input" });
    await expect(b.reminderCreate({ title: "x", dueTime: "10:00" })).rejects.toMatchObject({ code: "invalid_input" });
    const err = await b.call("snapshot", { daysAhead: "seven" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HelperError);
    expect((err as HelperError).code).toBe("invalid_input");
  });

  it("access_not_determined, then request-access grants", async () => {
    const b = bridgeWithState("access", { REMINDERS_MOCK_ACCESS: "notDetermined" });
    const s = await b.snapshot({});
    expect(s.access.reminders).toBe("notDetermined");
    expect(s.reminders).toEqual([]);
    expect(s.lists).toEqual([]);
    await expect(b.reminderCreate({ title: "x" })).rejects.toMatchObject({ code: "access_not_determined" });
    const after = await b.requestAccess({});
    expect(after).toEqual({ reminders: "fullAccess", events: "fullAccess" });
  });

  it("garbage stdout with exit 1 becomes internal with stderr", async () => {
    const b = bridgeWithState("garbage", { REMINDERS_MOCK_GARBAGE: "1" });
    await expect(b.version()).rejects.toMatchObject({ code: "internal" });
    const e = (await b.version().catch((x: unknown) => x)) as HelperError;
    expect(e.message).toContain("garbage mode");
  });

  it("a missing helper binary is internal", async () => {
    const b = new HelperBridge(realExecFile, join(dir, "no-such-helper"));
    await expect(b.version()).rejects.toMatchObject({ code: "internal" });
  });
});
