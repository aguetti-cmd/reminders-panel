// Types from CONTRACT.md (contractVersion 1). Pure module, no obsidian import.

export const CONTRACT_VERSION = 1;
export const SNAPSHOT_SCHEMA_VERSION = 1;

/** ISO 8601 with numeric offset, for example 2026-11-18T14:30:00+07:00. */
export type IsoDateTime = string;
/** YYYY-MM-DD in the Mac's local time zone. */
export type LocalDate = string;
/** HH:mm, 24 hour. */
export type LocalTime = string;

export type AccessStatus = "fullAccess" | "writeOnly" | "denied" | "restricted" | "notDetermined";
export const ACCESS_STATUSES: readonly AccessStatus[] = [
  "fullAccess",
  "writeOnly",
  "denied",
  "restricted",
  "notDetermined",
];

export type HelperErrorCode =
  | "invalid_input"
  | "access_denied"
  | "access_not_determined"
  | "not_found"
  | "read_only"
  | "unsupported_os"
  | "internal";
export const HELPER_ERROR_CODES: readonly HelperErrorCode[] = [
  "invalid_input",
  "access_denied",
  "access_not_determined",
  "not_found",
  "read_only",
  "unsupported_os",
  "internal",
];

export interface Container {
  id: string;
  title: string;
  color: string | null;
  allowsModify: boolean;
  source: string;
}

export interface Reminder {
  id: string;
  title: string;
  notes: string | null;
  listId: string;
  completed: boolean;
  completedAt: IsoDateTime | null;
  priority: number;
  dueDate: LocalDate | null;
  dueTime: LocalTime | null;
  hasRecurrence: boolean;
  alarmCount: number;
  createdAt: IsoDateTime | null;
  modifiedAt: IsoDateTime | null;
}

export interface CalEvent {
  id: string;
  calendarId: string;
  title: string;
  notes: string | null;
  location: string | null;
  start: IsoDateTime;
  end: IsoDateTime;
  allDay: boolean;
  isRecurring: boolean;
}

export interface AccessPair {
  reminders: AccessStatus;
  events: AccessStatus;
}

export interface Snapshot {
  generatedAt: IsoDateTime;
  timeZone: string;
  daysAhead: number;
  access: AccessPair;
  lists: Container[];
  reminders: Reminder[];
  calendars: Container[];
  events: CalEvent[];
}

export interface SnapshotFile {
  schemaVersion: 1;
  writtenAt: string;
  writtenBy: string;
  snapshot: Snapshot;
}

export interface VersionData {
  helperVersion: string;
  contractVersion: number;
}

// Payloads

export interface SnapshotPayload {
  daysAhead?: number;
  completedLookbackDays?: number;
}

export interface RequestAccessPayload {
  reminders?: boolean;
  events?: boolean;
}

export interface ReminderCreatePayload {
  title: string;
  listId?: string;
  notes?: string;
  dueDate?: LocalDate;
  dueTime?: LocalTime;
  priority?: number;
}

export interface ReminderUpdatePayload {
  id: string;
  title?: string;
  notes?: string | null;
  listId?: string;
  dueDate?: LocalDate | null;
  dueTime?: LocalTime | null;
  priority?: number;
  completed?: boolean;
}

export interface EventCreatePayload {
  title: string;
  calendarId?: string;
  start: IsoDateTime;
  end: IsoDateTime;
  allDay?: boolean;
  notes?: string;
  location?: string;
}

export interface EventUpdatePayload {
  id: string;
  occurrenceStart?: IsoDateTime;
  title?: string;
  calendarId?: string;
  start?: IsoDateTime;
  end?: IsoDateTime;
  allDay?: boolean;
  notes?: string | null;
  location?: string | null;
}

export type WriteCommand = "reminder-create" | "reminder-update" | "event-create" | "event-update";
export type HelperCommand = "version" | "status" | "request-access" | "snapshot" | WriteCommand;

export type Mode = "edit" | "view";
