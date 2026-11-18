# reminders-helper

A small macOS command line tool that reads and edits Apple Reminders and Apple Calendar through EventKit. The Reminders Panel Obsidian plugin runs it and reads one JSON object from its output. The interface is defined in `../CONTRACT.md`.

It never uses the network.

## Requirements

- macOS 13 or later (Apple Silicon by default).
- Xcode Command Line Tools. If they are missing, run `xcode-select --install` yourself.

## Build

```
./build.sh
```

The result is `build/reminders-helper`, ad-hoc signed, with `Info.plist` embedded (it holds the text macOS shows in the permission prompts). For a universal binary (arm64 and x86_64):

```
UNIVERSAL=1 ./build.sh
```

You can also double-click `build.command` in Finder. It builds, runs `version` and `status`, and writes everything to `build.log`. The last line of the log is `BUILD OK` or `BUILD FAILED`.

## Install

```
./install.sh
```

This copies the binary to `~/Library/Application Support/RemindersPanel/reminders-helper`. If a binary is already there, it is first copied to `reminders-helper.backup-YYYYMMDD-HHMMSS` in the same folder.

## Test (read-only)

```
./smoke-test.sh
```

It runs `version`, `status`, `snapshot`, and three cases that must fail with `invalid_input`. It never creates or changes anything and never asks for permission.

## Commands

Each command prints one JSON object: `{"ok":true,"data":{...}}` or `{"ok":false,"error":{"code":"...","message":"..."}}`. Exit code is 0 or 1.

```
reminders-helper version
reminders-helper status
reminders-helper request-access '{"reminders":true,"events":true}'
reminders-helper snapshot '{"daysAhead":7,"completedLookbackDays":1}'
reminders-helper reminder-create '{"title":"Buy milk","dueDate":"2026-11-20","dueTime":"09:00","priority":5}'
reminders-helper reminder-update '{"id":"REMINDER-ID","completed":true}'
reminders-helper event-create '{"title":"Call","start":"2026-11-20T10:00:00+07:00","end":"2026-11-20T10:30:00+07:00"}'
reminders-helper event-update '{"id":"EVENT-ID","occurrenceStart":"2026-11-20T10:00:00+07:00","location":null}'
```

`status` and `snapshot` never show a permission prompt. Only `request-access` does. In `reminder-update` and `event-update`, a missing key means "no change" and `null` means "clear".

## No delete

There is no delete command, and the code never calls EventKit remove for reminders or events. The scripts never delete files. `install.sh` keeps a backup of the old binary.

## Known risks to test on the Mac

- First compile on macOS 27.2.1 with Swift 6.4.2 (2026-11-18) had no errors and no warnings.
- When Obsidian launches the helper, macOS treats Obsidian as the responsible app. Obsidian has no full access usage text, so no prompt appeared (tested 2026-11-18). The helper now starts a copy of itself with responsibility disclaimed (`Sources/Responsibility.swift`), so macOS uses the helper's own identity and `Info.plist`. This uses a private Apple function, looked up at run time. If it is missing, the helper runs in process as before and logs a line to stderr.
- The binary is ad-hoc signed, so a rebuild can make macOS ask for permission again.
- Completing a repeating reminder through EventKit should be checked by hand once, to see that the next occurrence appears.
- Due dates are written as plain Gregorian year, month, day (and hour, minute) with no calendar or time zone attached. Check once that a reminder created by the helper shows the right date and time in the Reminders app, especially if the Mac uses a non Gregorian calendar (for example Buddhist).
