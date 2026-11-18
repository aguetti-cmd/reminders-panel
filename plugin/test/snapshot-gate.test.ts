import { describe, expect, it } from "vitest";
import { canWrite, decideMode, DryRunLog, gateWrite, type GateSettings } from "../src/gate";
import { normalizeSettings, resolveSnapshotPath } from "../src/settings";
import {
  buildSnapshotFile,
  parseSnapshotFile,
  serializeSnapshotFile,
  SNAPSHOT_REWRITE_MS,
  shouldWriteSnapshot,
  snapshotKey,
  snapshotsEqual,
} from "../src/snapshotFile";
import { reminder, snapshot } from "./fixtures";

describe("snapshot file validation", () => {
  it("round trips a valid file", () => {
    const f = buildSnapshotFile(snapshot(), "MacBook", new Date("2026-11-18T02:00:00Z"));
    const res = parseSnapshotFile(serializeSnapshotFile(f));
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.file.writtenBy).toBe("MacBook");
      expect(res.file.writtenAt).toBe("2026-11-18T02:00:00.000Z");
    }
  });

  it("reports missing, unreadable, schema and invalid files", () => {
    expect(parseSnapshotFile(null)).toMatchObject({ ok: false, reason: "missing" });
    expect(parseSnapshotFile("{not json")).toMatchObject({ ok: false, reason: "unreadable" });
    expect(parseSnapshotFile("[]")).toMatchObject({ ok: false, reason: "unreadable" });
    const f = buildSnapshotFile(snapshot(), "Mac", new Date());
    expect(parseSnapshotFile(JSON.stringify({ ...f, schemaVersion: 2 }))).toMatchObject({ ok: false, reason: "schema" });
    expect(parseSnapshotFile(JSON.stringify({ ...f, writtenAt: "yesterday" }))).toMatchObject({ ok: false, reason: "invalid" });
    const badAccess = { ...f, snapshot: { ...f.snapshot, access: { reminders: "maybe", events: "fullAccess" } } };
    expect(parseSnapshotFile(JSON.stringify(badAccess))).toMatchObject({ ok: false, reason: "invalid" });
    const badReminder = { ...f, snapshot: { ...f.snapshot, reminders: [{ id: 1 }] } };
    expect(parseSnapshotFile(JSON.stringify(badReminder))).toMatchObject({ ok: false, reason: "invalid" });
    const noEvents = { ...f, snapshot: { ...f.snapshot, events: undefined } };
    expect(parseSnapshotFile(JSON.stringify(noEvents))).toMatchObject({ ok: false, reason: "invalid" });
  });
});

describe("snapshot change detection", () => {
  it("ignores generatedAt and key order", () => {
    const a = snapshot({ generatedAt: "2026-11-18T09:00:00+07:00" });
    const b = snapshot({ generatedAt: "2026-11-18T09:05:00+07:00" });
    expect(snapshotsEqual(a, b)).toBe(true);
    const reordered = Object.fromEntries(Object.entries(a).reverse()) as typeof a;
    expect(snapshotKey(reordered)).toBe(snapshotKey(a));
  });

  it("sees a real change", () => {
    const a = snapshot();
    const b = snapshot({ reminders: [reminder({ title: "Changed" })] });
    expect(snapshotsEqual(a, b)).toBe(false);
  });

  it("writes on first run, on change, and after 15 minutes", () => {
    const a = snapshot();
    const t0 = 1_000_000;
    expect(shouldWriteSnapshot(null, a, t0)).toBe(true);
    const last = { key: snapshotKey(a), atMs: t0 };
    expect(shouldWriteSnapshot(last, snapshot({ generatedAt: "2026-11-18T10:00:00+07:00" }), t0 + 60_000)).toBe(false);
    expect(shouldWriteSnapshot(last, snapshot({ daysAhead: 3 }), t0 + 60_000)).toBe(true);
    expect(shouldWriteSnapshot(last, a, t0 + SNAPSHOT_REWRITE_MS - 1)).toBe(false);
    expect(shouldWriteSnapshot(last, a, t0 + SNAPSHOT_REWRITE_MS)).toBe(true);
  });
});

describe("dry-run gating", () => {
  const on: GateSettings = { reminderWriteback: true, calendarWriteback: true, dryRun: false };

  it("blocks everything in view mode", () => {
    expect(gateWrite("view", "reminder-update", { id: "1" }, on).action).toBe("blocked");
    expect(gateWrite("view", "event-create", {}, { ...on, dryRun: true }).action).toBe("blocked");
    expect(canWrite("view", "reminder", on)).toBe(false);
  });

  it("blocks each kind when its setting is off", () => {
    const s = { ...on, reminderWriteback: false };
    expect(gateWrite("edit", "reminder-create", { title: "x" }, s)).toMatchObject({ action: "blocked" });
    expect(gateWrite("edit", "event-update", { id: "e" }, s)).toEqual({ action: "send" });
    const c = { ...on, calendarWriteback: false };
    expect(gateWrite("edit", "event-create", {}, c)).toMatchObject({ action: "blocked" });
    expect(canWrite("edit", "event", c)).toBe(false);
    expect(canWrite("edit", "reminder", c)).toBe(true);
  });

  it("dry run never sends and says what would be sent", () => {
    const d = gateWrite("edit", "reminder-update", { id: "1", completed: true }, { ...on, dryRun: true });
    expect(d.action).toBe("dryRun");
    if (d.action === "dryRun") {
      expect(d.notice.startsWith("Dry run:")).toBe(true);
      expect(d.notice).toContain("reminder-update");
      expect(d.notice).toContain('"completed":true');
    }
  });

  it("sends only in edit mode with the setting on and dry run off", () => {
    expect(gateWrite("edit", "reminder-update", { id: "1" }, on)).toEqual({ action: "send" });
  });

  it("the default settings are safe: no writes, dry run on", () => {
    const d = normalizeSettings(undefined);
    expect(d.reminderWriteback).toBe(false);
    expect(d.calendarWriteback).toBe(false);
    expect(d.dryRun).toBe(true);
    expect(gateWrite("edit", "reminder-create", { title: "x" }, d).action).toBe("blocked");
  });

  it("keeps only the last 50 log entries, newest first", () => {
    const log = new DryRunLog();
    for (let i = 0; i < 60; i++) log.add("reminder-create", { title: String(i) });
    expect(log.size).toBe(50);
    expect((log.list()[0].payload as { title: string }).title).toBe("59");
    expect((log.list()[49].payload as { title: string }).title).toBe("10");
  });
});

describe("mode decision", () => {
  const p = "/x/helper";
  it("is view mode off macOS desktop, without a hint", () => {
    expect(decideMode({ isDesktopApp: false, isMacOS: true, helperExists: true, contractVersion: 1 }, p)).toEqual({ mode: "view", hint: null });
    expect(decideMode({ isDesktopApp: true, isMacOS: false, helperExists: true, contractVersion: 1 }, p)).toEqual({ mode: "view", hint: null });
  });
  it("is view mode with a hint when the helper is missing or wrong", () => {
    const missing = decideMode({ isDesktopApp: true, isMacOS: true, helperExists: false, contractVersion: null }, p);
    expect(missing.mode).toBe("view");
    expect(missing.hint).toContain(p);
    expect(decideMode({ isDesktopApp: true, isMacOS: true, helperExists: true, contractVersion: 2 }, p).mode).toBe("view");
    expect(decideMode({ isDesktopApp: true, isMacOS: true, helperExists: true, contractVersion: null }, p).mode).toBe("view");
  });
  it("is edit mode with everything in place", () => {
    expect(decideMode({ isDesktopApp: true, isMacOS: true, helperExists: true, contractVersion: 1 }, p)).toEqual({ mode: "edit", hint: null });
  });
});

describe("settings", () => {
  it("clamps numbers and keeps defaults", () => {
    const s = normalizeSettings({ daysAhead: 500, refreshMinutes: "3", hiddenListIds: ["a", 2], dryRun: "no" });
    expect(s.daysAhead).toBe(60);
    expect(s.refreshMinutes).toBe(3);
    expect(s.hiddenListIds).toEqual(["a"]);
    expect(s.dryRun).toBe(true);
    expect(s.completedLookbackDays).toBe(1);
  });
  it("resolves the snapshot path", () => {
    expect(resolveSnapshotPath("", ".obsidian")).toBe(".obsidian/plugins/reminders-panel/snapshot.json");
    expect(resolveSnapshotPath("/Data/snap.json", ".obsidian")).toBe("Data/snap.json");
  });
});
