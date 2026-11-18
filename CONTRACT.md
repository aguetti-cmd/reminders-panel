# Reminders Panel: helper and plugin contract (contractVersion 1)

This file is the single source of truth for the interface between:

- `helper/`: a Swift command line tool (`reminders-helper`) that talks to Apple EventKit on macOS.
- `plugin/`: an Obsidian plugin (id `reminders-panel`, name "Reminders Panel") written in TypeScript.

If code and this file disagree, this file wins. Do not change this file. If you find a real defect in it, stop and report it in your final message.

## 1. Hard rules (apply to both sides)

1. **No delete operations exist.** No command deletes a reminder, an event, a list, a calendar, or a file. Do not add one.
2. Apple Reminders and Apple Calendar are the only source of truth. The plugin never stores tasks as Markdown in notes.
3. The helper never uses the network. The plugin never uses the network.
4. The helper prints **exactly one JSON object** to stdout, UTF-8, followed by a newline, and nothing else on stdout. Diagnostics go to stderr.
5. Exit code is `0` when `ok` is `true`, `1` when `ok` is `false`.
6. No em-dashes (the long dash character) anywhere: UI text, comments, README, error messages. Use commas, periods, or parentheses.
7. UI text and messages use simple, short English.

## 2. Invocation

```
reminders-helper <command> [json-payload]
```

- `<command>` is one of the commands in section 5.
- `[json-payload]` is one optional argv argument holding a JSON object. A missing payload means `{}`.
- The plugin calls the helper with `child_process.execFile` (no shell), so the payload is passed as one argument with no shell escaping.
- Unknown keys in a payload are ignored.
- A payload that is not valid JSON, or not an object, returns error code `invalid_input`.

## 3. Envelope

Success:

```json
{"ok": true, "data": { }}
```

Failure:

```json
{"ok": false, "error": {"code": "access_denied", "message": "Short human readable sentence."}}
```

Error codes (closed set):

| code | meaning |
|---|---|
| `invalid_input` | bad command, bad JSON, missing or malformed field |
| `access_denied` | EventKit access for the needed entity type is denied or restricted, or is write-only where full access is needed |
| `access_not_determined` | access was never requested. The plugin should run `request-access` |
| `not_found` | no reminder, event, list, or calendar with that id |
| `read_only` | the target list or calendar does not allow modification |
| `unsupported_os` | macOS version is too old (minimum macOS 13) |
| `internal` | anything else, including EventKit save errors (put the underlying error text in `message`) |

## 4. Data types

### 4.1 Dates and times

- `IsoDateTime`: ISO 8601 with a numeric offset, seconds precision, for example `2026-11-18T14:30:00+07:00`. The helper **emits** the local time zone offset of the Mac. The helper **accepts** any numeric offset or `Z`, with or without fractional seconds.
- `LocalDate`: `YYYY-MM-DD`, in the Mac's local time zone.
- `LocalTime`: `HH:mm`, 24 hour, in the Mac's local time zone.

### 4.2 AccessStatus

String, one of: `fullAccess`, `writeOnly`, `denied`, `restricted`, `notDetermined`.

On macOS 13 the legacy `authorized` status maps to `fullAccess`.

### 4.3 Container (a reminder list or an event calendar)

```ts
interface Container {
  id: string;            // EKCalendar.calendarIdentifier
  title: string;
  color: string | null;  // "#RRGGBB" uppercase hex, or null if unknown
  allowsModify: boolean; // EKCalendar.allowsContentModifications
  source: string;        // EKSource.title, for example "iCloud". Empty string if unknown
}
```

### 4.4 Reminder

```ts
interface Reminder {
  id: string;                 // EKReminder.calendarItemIdentifier
  title: string;              // empty string if nil
  notes: string | null;
  listId: string;             // Container.id of the list
  completed: boolean;
  completedAt: IsoDateTime | null;
  priority: number;           // raw EventKit integer 0..9. 0 none, 1 high, 5 medium, 9 low
  dueDate: LocalDate | null;
  dueTime: LocalTime | null;  // null when the due date has no time part. Always null when dueDate is null
  hasRecurrence: boolean;
  alarmCount: number;
  createdAt: IsoDateTime | null;
  modifiedAt: IsoDateTime | null;
}
```

`dueDate` and `dueTime` come from `EKReminder.dueDateComponents`. If the components carry their own time zone, convert to the Mac's local time zone first.

### 4.5 Event

```ts
interface CalEvent {
  id: string;            // EKEvent.eventIdentifier (shared by all occurrences of a recurring event)
  calendarId: string;    // Container.id of the calendar
  title: string;         // empty string if nil
  notes: string | null;
  location: string | null;
  start: IsoDateTime;    // for all-day events: local midnight at the start of the first day
  end: IsoDateTime;      // as given by EventKit
  allDay: boolean;
  isRecurring: boolean;  // EKEvent.hasRecurrenceRules
}
```

Because recurring occurrences share `id`, the plugin uses `id + "|" + start` as the UI key.

### 4.6 Snapshot

```ts
interface Snapshot {
  generatedAt: IsoDateTime;
  timeZone: string;                 // IANA id of the Mac, for example "Asia/Bangkok"
  daysAhead: number;                // the value actually used
  access: { reminders: AccessStatus; events: AccessStatus };
  lists: Container[];               // reminder lists. Empty if reminders access is not fullAccess
  reminders: Reminder[];            // empty if reminders access is not fullAccess
  calendars: Container[];           // event calendars. Empty if events access is not fullAccess
  events: CalEvent[];               // empty if events access is not fullAccess
}
```

## 5. Commands

### 5.1 `version`

Payload: none. No EventKit access needed.

```json
{"ok": true, "data": {"helperVersion": "0.1.0", "contractVersion": 1}}
```

### 5.2 `status`

Payload: none. Never shows a permission prompt.

```json
{"ok": true, "data": {"reminders": "notDetermined", "events": "fullAccess"}}
```

### 5.3 `request-access`

Payload: `{"reminders"?: boolean, "events"?: boolean}`. Both default to `true`.

Requests full access for each selected entity type whose status is `notDetermined` (macOS 14 and later: `requestFullAccessToReminders` and `requestFullAccessToEvents`. macOS 13: `requestAccess(to:)`). Waits for the user's answer. Returns the same shape as `status`, read after the requests finish. A denial is **not** an error: the command still returns `ok: true` with the resulting statuses.

### 5.4 `snapshot`

Payload:

```ts
{
  daysAhead?: number;             // integer, default 7, clamped to 1..60
  completedLookbackDays?: number; // integer, default 0, clamped to 0..7
}
```

Returns `data` = `Snapshot`.

- `reminders`: every incomplete reminder (with or without a due date) in every reminder list, plus, when `completedLookbackDays > 0`, reminders completed since local midnight `completedLookbackDays - 1` days ago (so `1` means "completed today").
- `events`: every event occurrence that overlaps the window from local midnight today (inclusive) to local midnight `daysAhead` days later (exclusive), from every event calendar.
- Sort `reminders` by: `dueDate` ascending (nulls last), then `dueTime` ascending (nulls first within a date), then `title` case-insensitive. Sort `events` by `start` ascending, then `title`.
- `snapshot` never prompts. If an entity type is not `fullAccess`, its arrays are empty and `access` says why. The command still returns `ok: true`. It returns an error only on an unexpected failure.

### 5.5 `reminder-create`

Payload:

```ts
{
  title: string;            // required, not empty after trimming
  listId?: string;          // default: EKEventStore.defaultCalendarForNewReminders()
  notes?: string;
  dueDate?: LocalDate;
  dueTime?: LocalTime;      // only valid together with dueDate, otherwise invalid_input
  priority?: number;        // integer 0..9, default 0
}
```

Returns `{"reminder": Reminder}`.

Alarm rule: when `dueTime` is set, add one `EKAlarm(absoluteDate:)` at the due date and time, so the Reminders app notifies. When only `dueDate` is set, add no alarm.

### 5.6 `reminder-update`

Payload:

```ts
{
  id: string;                    // required
  title?: string;                // not empty after trimming
  notes?: string | null;         // null clears
  listId?: string;               // move to another list
  dueDate?: LocalDate | null;    // null clears the date and the time
  dueTime?: LocalTime | null;    // null makes it date-only
  priority?: number;             // 0..9
  completed?: boolean;
}
```

Semantics: a key that is **absent** means "no change". A key that is present with `null` means "clear". The helper must tell these two cases apart.

- If the result would have a `dueTime` without a `dueDate`, return `invalid_input`.
- Alarm rule on update: only when `dueDate` or `dueTime` is present in the payload. If the reminder has 0 or 1 alarms, replace them so that there is exactly one absolute alarm at the new due date and time when a time is set, and none when there is no time. If the reminder has 2 or more alarms, leave its alarms untouched.
- `completed: true` sets `isCompleted = true`. `completed: false` sets `isCompleted = false`.

Returns `{"reminder": Reminder}` read back after the save.

### 5.7 `event-create`

Payload:

```ts
{
  title: string;          // required, not empty after trimming
  calendarId?: string;    // default: EKEventStore.defaultCalendarForNewEvents
  start: IsoDateTime;     // required
  end: IsoDateTime;       // required, must be after start (for allDay: not before start)
  allDay?: boolean;       // default false
  notes?: string;
  location?: string;
}
```

Returns `{"event": CalEvent}`.

### 5.8 `event-update`

Payload:

```ts
{
  id: string;                    // required
  occurrenceStart?: IsoDateTime; // the `start` of the occurrence to change. Required in practice for recurring events
  title?: string;
  calendarId?: string;
  start?: IsoDateTime;
  end?: IsoDateTime;
  allDay?: boolean;
  notes?: string | null;         // null clears
  location?: string | null;      // null clears
}
```

- Finding the event: when `occurrenceStart` is given, search events in a window of one day on each side of it and pick the one with this `id` whose start equals `occurrenceStart` (to the second). Otherwise use `EKEventStore.event(withIdentifier:)`.
- Save with span `.thisEvent` only. Never change future occurrences.
- After applying changes, `end` must be after `start`, otherwise `invalid_input`.

Returns `{"event": CalEvent}`.

## 6. Access rules for write commands

- Reminder commands need reminders `fullAccess`. Event commands need events `fullAccess`.
- `notDetermined` returns `access_not_determined`. Any other non-full status returns `access_denied`.
- A target list or calendar with `allowsModify == false` returns `read_only`.
- An unknown `id`, `listId`, or `calendarId` returns `not_found`.

## 7. Snapshot file (written by the plugin on the Mac, read on every device)

Path (vault relative): `<configDir>/plugins/reminders-panel/snapshot.json` by default, where `<configDir>` is `app.vault.configDir`. The path is a plugin setting.

```ts
interface SnapshotFile {
  schemaVersion: 1;
  writtenAt: IsoDateTime | string; // ISO 8601 time the plugin wrote the file (UTC "Z" form is fine here)
  writtenBy: string;               // free text device label from settings, for example "MacBook Pro"
  snapshot: Snapshot;
}
```

- Only a device in edit mode (macOS desktop with a working helper) writes this file.
- Every other device (iPhone, iPad, Linux, Windows) only reads it and never writes it.
- Reads and writes go through `app.vault.adapter` so they work on mobile.

## 8. Install locations on the Mac

- Helper binary: `~/Library/Application Support/RemindersPanel/reminders-helper` (outside the vault and outside iCloud Drive). The plugin setting `helperPath` defaults to this path and expands a leading `~`.
- Plugin files: `<vault>/<configDir>/plugins/reminders-panel/` (`main.js`, `manifest.json`, `styles.css`). Installing them is a manual step done by the user. No script in this project writes into a vault.
