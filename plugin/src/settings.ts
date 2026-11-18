// Settings shape and defaults. Pure module, no obsidian import.

export interface RemindersPanelSettings {
  helperPath: string;
  /** Empty means the default label for this device. */
  deviceLabel: string;
  /** Empty means <configDir>/plugins/reminders-panel/snapshot.json. */
  snapshotPath: string;
  daysAhead: number;
  completedLookbackDays: number;
  refreshMinutes: number;
  staleMinutes: number;
  showEvents: boolean;
  defaultListId: string;
  defaultCalendarId: string;
  hiddenListIds: string[];
  hiddenCalendarIds: string[];
  reminderWriteback: boolean;
  calendarWriteback: boolean;
  dryRun: boolean;
}

export const DEFAULT_HELPER_PATH = "~/Library/Application Support/RemindersPanel/reminders-helper";

export const DEFAULT_SETTINGS: RemindersPanelSettings = {
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
  dryRun: true,
};

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function str(v: unknown, fallback: string): string {
  return typeof v === "string" ? v : fallback;
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}

function strList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

/** Merges stored data over the defaults and fixes bad values. */
export function normalizeSettings(raw: unknown): RemindersPanelSettings {
  const r = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
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
    dryRun: bool(r.dryRun, d.dryRun),
  };
}

export function defaultSnapshotPath(configDir: string): string {
  return `${configDir}/plugins/reminders-panel/snapshot.json`;
}

/** Vault-relative snapshot path. Strips leading slashes so it stays inside the vault. */
export function resolveSnapshotPath(setting: string, configDir: string): string {
  const p = setting.trim().replace(/^\/+/, "");
  return p === "" ? defaultSnapshotPath(configDir) : p;
}

export function parentFolder(p: string): string {
  const i = p.lastIndexOf("/");
  return i <= 0 ? "" : p.slice(0, i);
}
