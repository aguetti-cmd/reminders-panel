# Reminders Panel (Obsidian plugin)

Shows Apple Reminders and Apple Calendar in a sidebar panel in Obsidian.
Apple Reminders and Calendar stay the only source of truth. Tasks are never stored as Markdown.

## Modes

- **Edit mode** (Mac desktop with the helper installed). The plugin calls the `reminders-helper` binary, shows live data, can write changes back, and saves a snapshot file in the vault.
- **View mode** (iPhone, iPad, Linux, Windows, or a Mac without a working helper). The plugin only reads the snapshot file and shows the same panel, read only, with the time and device of the last update.

Edit mode needs all of: Obsidian desktop on macOS, the helper file at the configured path, and the helper reporting contract version 1. Otherwise the plugin uses view mode. On a Mac it then shows a short setup hint with the helper path.

## What the panel shows

- Reminders in sections: Overdue, Today, Upcoming (by day), Later, No date (collapsed), Completed (collapsed).
- Calendar events for today and the next days, by day, all-day events first. Can be turned off.
- A warning style when the data is older than the "Stale after" setting.
- A "Grant access" button when access was never requested (Mac only), or a line pointing to System Settings when access is denied.

## Changes (Mac only)

- Complete or reopen with the checkbox.
- Edit a reminder: title, list, due date, due time, priority, notes.
- Quick add at the top of the panel.
- Time block: create a calendar event from a reminder.
- Edit an event: title, calendar, start, end (only this occurrence of a repeating event).

## Guard rails

- There is no delete action anywhere.
- Reminder changes and calendar changes each need their own setting. Both are off by default.
- **Dry run** is on by default. A change is not sent. A notice shows what would have been sent, and the settings tab lists the last 50 such entries (kept in memory only).
- After a real change the panel reloads from the helper. There are no optimistic updates.
- Read-only lists and calendars cannot be chosen as targets, and their items are read only.
- View mode never calls the helper and never writes the snapshot file.
- The plugin never uses the network.

## Commands

Open panel, Refresh, New reminder, New reminder from current note (title is the note name, notes hold an `obsidian://` link to the note), Request access. No default hotkeys.

## Settings

| Setting | Default | Notes |
|---|---|---|
| Helper path | `~/Library/Application Support/RemindersPanel/reminders-helper` | Mac only. `~` is your home folder. |
| Device label | the Mac's host name | Shown on other devices. |
| Snapshot file | `<configDir>/plugins/reminders-panel/snapshot.json` | Vault relative. Use the same value on all devices. |
| Days ahead | 7 | Includes today. |
| Completed days | 1 | 0 hides completed reminders. 1 means today. |
| Refresh every | 5 minutes | Mac only. |
| Stale after | 60 minutes | |
| Show calendar events | on | |
| Default list, default calendar | helper default | |
| Shown lists, shown calendars | all | |
| Allow reminder changes | off | Mac only. |
| Allow calendar changes | off | Mac only. |
| Dry run | on | Mac only. |

## Refresh

- Mac: when Obsidian starts, every "Refresh every" minutes, when the window gets focus (at most every 30 seconds), after each change, and on the refresh button or command. The snapshot file is written when the data changed or the last write is 15 minutes old.
- Other devices: when the panel opens, when the app comes back to the front, every 60 seconds while visible, and on the refresh button.

## Install (manual)

1. Run `npm install` and `npm run build` in this folder.
2. Copy `main.js`, `manifest.json` and `styles.css` into `<vault>/<configDir>/plugins/reminders-panel/` (the config folder is usually `.obsidian`).
3. On the Mac, install the helper at the helper path (see `../helper`).
4. Enable "Reminders Panel" in Settings, Community plugins.
5. On the Mac, open the panel and use "Grant access" if asked.

## Development

- `npm run typecheck`, `npm test`, `npm run build`.
- `dev/mock-helper.mjs` is a stand-in for the helper for tests and local work. Its state file path comes from `REMINDERS_MOCK_STATE`.
- `node dev/smoke-mobile.cjs` loads the built `main.js` with Node modules blocked, as on a phone, and checks view mode. `SMOKE_EDIT=1 node dev/smoke-mobile.cjs` checks edit mode against the mock helper.

## Known limits

- The snapshot is only as fresh as the Mac's last write. If the Mac is asleep or Obsidian is closed there, other devices show old data (with the warning style).
- iCloud sync can take minutes or longer to move the snapshot file to other devices.
- A sync service that does not copy the config folder, or extra files in plugin folders, will not carry the default snapshot file. Set a path outside the config folder if needed.
- Plugin settings (`data.json`) sync too, so all devices share the same settings.
- All-day events can only have their title and calendar changed here.
- A reminder's due date is a calendar date from the Mac. On a device in another time zone it is still shown on that date.
