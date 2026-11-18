# Reminders Panel

An Obsidian plugin that shows Apple Reminders and Apple Calendar in a sidebar panel.

- On a Mac it can edit: complete, create and change reminders, and create and move calendar events.
- On iPhone, iPad, Linux and Windows it is view only. It shows the last snapshot the Mac wrote, with a "last updated" time.
- Apple Reminders and Apple Calendar stay the only source of truth. No tasks are stored as Markdown.
- There is no delete action anywhere, by design.

## Layout

| Path | What it is |
|---|---|
| `CONTRACT.md` | The JSON interface between helper and plugin. Source of truth. |
| `helper/` | Swift command line tool over EventKit. Source, build and install scripts. |
| `plugin/` | Obsidian plugin in TypeScript. Source, tests, mock helper, and the built `main.js`. |

## Status on 2026-11-18

Tested on macOS 27.2.1 (Apple Silicon), Obsidian 1.15.0.

| Part | State |
|---|---|
| Plugin typecheck, 71 unit tests, build | Pass |
| Swift helper compile and read-only smoke test | Pass |
| Permission prompt when Obsidian starts the helper | Pass. The helper runs as its own responsible process, so macOS asks for "reminders-helper", not Obsidian. |
| Panel against the Reminders and Calendar apps | Pass |
| Dry run: actions change nothing | Pass |
| Reminder writes: create, set date, add time, clear time, complete | Pass |
| Calendar writes (time block, event edit) | Not tested yet |
| Completing a repeating reminder from the panel | Not tested yet |
| Notification for a reminder with a time | Not tested yet |
| iPhone view mode and iCloud lag | Not tested yet |

Access is granted to the helper itself. Any process on the Mac that can run the helper can read and change Reminders and Calendar through it.

## How it works

1. The plugin on the Mac runs `reminders-helper snapshot` every few minutes and on window focus.
2. It shows the result in the panel and writes `snapshot.json` into its own plugin folder.
3. iCloud syncs the vault, including that file, to the other devices.
4. The plugin on iPhone reads `snapshot.json` and shows the same panel, read only.

The phone view is only as fresh as the Mac's last write plus iCloud lag. The panel always shows the time of the data.

## Install order (on the Mac)

1. `cd helper && ./build.sh` (needs Xcode Command Line Tools).
2. `./smoke-test.sh` (read only checks).
3. `./install.sh` (copies the binary to `~/Library/Application Support/RemindersPanel/`).
4. Copy `plugin/main.js`, `plugin/manifest.json` and `plugin/styles.css` into `<vault>/.obsidian/plugins/reminders-panel/`.
5. Enable "Reminders Panel" in Obsidian, Settings, Community plugins.
6. Open the panel and press "Grant access".

## Guard rails (defaults)

- Reminder writeback: off.
- Calendar writeback: off.
- Dry run: on. With dry run on, a write action only shows what it would send.

Turn writeback on and dry run off only after the panel shows correct data.

## Rebuilding the plugin

```
cd plugin
npm ci
npm run typecheck
npm test
npm run build
```
