# TaskPro

A powerful Obsidian plugin for seamless task management with bi-directional sync, dynamic status badges, deadline tracking, and per-task capabilities you add as you need them.

## ✨ Features

### 1. Task Import & Bi-directional Sync
- Import tasks from a central "Reference Note" (e.g., `Weekly Tasks.md`)
- Select parent tasks via Command Palette modal
- Automatically sync task status changes between imported tasks and source tasks
- Changes in either location update the other automatically

### 2. Tri-State Task Toggle
- Custom hotkey (default: `Ctrl+T`) to toggle task status
- Three-state loop: `[ ]` → `[/]` → `[x]` → `[ ]`
- Automatically triggers sync mechanism

### 3. Global Internal Tasks
- Create and manage tasks directly within plugin settings
- Independent of any markdown note
- Available in the import modal alongside reference note tasks

### 4. Dynamic Status Badges
- Beautiful capsule-shaped badges rendered dynamically
- Works in both Live Preview and Reading Mode
- No markdown pollution - badges are rendered via CodeMirror decorations
- Customizable size and language

**Badge States:**
- `[x]` → Light Green - "Done" / "انجام شده"
- `[ ]` → Light Gray - "Not Started" / "شروع نشده"
- `[/]` → Light Blue - "In Progress" / "در حال انجام"

### 5. Deadline Management
- Support for deadline syntax: `⏳ YYYY-MM-DD` or `[due:: YYYY-MM-DD]`
- Automatic deadline badge rendering
- Shows "Overdue" in red if past deadline and not completed
- Shows days remaining for future deadlines

### 6. Per-Task Capabilities

Every task can carry any combination of three capabilities. Click a task's status chip and pick one from **Add Capability** — nothing is switched on until you ask for it, so a plain task stays a plain task.

| Capability | Chip | Where it is stored |
| --- | --- | --- |
| **Progress bar** | `42%` | Plugin data, keyed by block ID |
| **Focus timer** | `12:30` | Plugin data, keyed by block ID |
| **Repeat** | `Every week` | The task line itself, as `@repeat(1w)` |

#### Focus timer

A countdown attached to a single task, for the "I'll give this 25 minutes" way of working.

- Click the timer chip to start, pause, add 5 or 15 minutes, reset, change the duration, or remove it.
- The running timer also shows in Obsidian's status bar; clicking it opens the note the task lives in.
- When time is up you get an in-app notice, an optional sound, and a **desktop notification** — on Windows that arrives as a system toast and stays in the Action Center, so you see it even with Obsidian in the background. Permission is asked for once.
- Remaining time is derived from timestamps rather than counted down in memory, so a timer keeps running while Obsidian is closed and comes back with the right time left (or already finished) when you reopen the vault.
- `Start / Pause Focus Timer on Current Task` in the Command Palette does the same thing from the keyboard, creating a timer at the default duration if the task does not have one.

Defaults live under **Settings → TaskPro → Capabilities**: duration, desktop notification, sound, and the status-bar readout.

#### Repeat

Turns a task into a recurring one, which is what a planner actually needs from a task that comes back.

- Presets for every day, week, two weeks, and month, plus a custom interval (any number of days, weeks, or months).
- Ticking off a repeating task **rolls it forward instead of closing it**: the deadline moves to the next occurrence, the status returns to `[ ]`, and any progress bar or focus timer on the task resets with it.
- The next date is counted from the task's own deadline, so a weekly task keeps its weekday even when you tick it off two days late. A deadline already in the past is advanced until it lands in the future, so clearing a month of missed dailies leaves one task due tomorrow — not one due last week.
- Month intervals clamp rather than spill: a task due on the 31st repeats on the 30th in a 30-day month.
- The rule is written into the task line as `@repeat(1w)`, so it survives moving, syncing, and sharing the note. The marker is hidden behind the chip while badges are on.
- Rolling forward works however the task was completed — the chip menu, the checkbox in Reading Mode, `Ctrl+T`, or typing `[x]` by hand.

## 🚀 Quick Start

### Installation

1. Download `taskpro-<version>.zip` from the latest release (or the loose `main.js`, `manifest.json`, and `styles.css`).
2. Extract to `.obsidian/plugins/taskpro/`.
3. Enable the plugin in Obsidian settings.

### Setup

1. Open Settings → TaskPro
2. Set your "Reference Note Path" (e.g., `Weekly Tasks.md`)
3. Configure badge preferences (language, size, enable/disable)

### Usage

**Import a Task:**
1. Open any note
2. Press `Ctrl+P` → "Import Task from Reference Note"
3. Select a task from the modal
4. Task is inserted with sync enabled

**Toggle Task Status:**
1. Place cursor on any task line
2. Press `Ctrl+T`
3. Status cycles: `[ ]` → `[/]` → `[x]` → `[ ]`

## 📖 Documentation

### Task Syntax

```markdown
- [ ] Task name
- [/] Task in progress
- [x] Completed task
- [ ] Task with a deadline @due(2026-12-31)
- [ ] Task with a priority @priority(high)
- [ ] Task that repeats @repeat(1w)
- [ ] Everything at once @priority(high) @due(2026-12-31) @repeat(2w)
```

`@due(...)`, `@priority(...)`, and `@repeat(...)` are the canonical forms and are hidden behind chips while badges are on. The older `⏳ YYYY-MM-DD`, `[due:: ...]`, `[priority:: ...]`, and Obsidian Tasks priority emoji are still read, and are rewritten to the canonical form the next time the task is edited. Progress bars and focus timers are *not* written into your notes — they are keyed by the task's block ID and live in `data.json`.

### Bi-directional Sync

When you import a task from your reference note, TaskPro creates a mapping between the imported task and the source task. Any status change in either location automatically updates the other.

### Settings

- **Reference Note Path**: Path to your central task note
- **Enable Status Badges**: Toggle badges on/off
- **Badge Language**: English or Persian (فارسی)
- **Badge Text Size**: Adjust badge font size (8-16px)
- **Show Focus Timer / Repeat Badges**: Toggle the two new chips independently
- **Capabilities → Focus Timer**: Default duration, desktop notification, sound, status-bar readout
- **Global Internal Tasks**: Manage plugin-stored tasks

## 🛠️ Technical Details

- Uses CodeMirror 6 `ViewPlugin` for Live Preview badges
- Uses `MarkdownPostProcessor` for Reading Mode badges
- Task mappings stored in `data.json` to keep markdown clean
- Safe file writing with `App.vault.process()`, so a concurrent edit is never clobbered
- Focus timers tick from one shared interval that only exists while a timer is running, and countdown chips are retargeted in place rather than by rebuilding editor decorations
- Supports RTL text for Persian language
- `npm test` covers the recurrence date maths and the timer bookkeeping

## 🔖 Releasing

1. Update the version in `manifest.json`, `package.json`, and `package-lock.json`.
2. Add the version and minimum Obsidian version to `versions.json`.
3. Commit and push.
4. Tag the commit with exactly the manifest version, without a `v` prefix:

   ```bash
   git tag 1.2.0
   git push origin 1.2.0
   ```

The release workflow validates that the tag, manifest, package, lockfile, and
`versions.json` all agree, runs the tests, builds, and publishes `main.js`,
`manifest.json`, `styles.css`, and `taskpro-<version>.zip` containing the three.

### Releasing without a local tag

The same workflow can be run from the **Actions** tab, which is useful when you
cannot push a tag from a clone:

| Input | Effect |
| --- | --- |
| *(none)* | Builds and uploads the zip and the three loose files as run artifacts. Nothing is tagged or published. |
| **publish** | Also creates the tag — taken from `manifest.json`, so the metadata check still has to pass — and the GitHub release with all four assets. |
| **target** | The commit-ish to build and tag. Defaults to the branch the run was started from; set it to `main` to release from the default branch. |

`gh release create` refuses to overwrite an existing release, so a version can
only be published once.

## 📝 License

MIT License

## 🙏 Credits

Developed by Ali

## Reminder note sources

Scheduled reminders keep their time, repeat, quiet-hours, sound, strictness, snooze, and system-notification controls. Reminder tasks are read only from the active note plus any additional notes selected in Settings → TaskPro → Reminders. Every unfinished task is included; completed tasks are skipped.

### Per-note intervals

Each selected reminder note has its own enable switch, repeat number, and unit (minutes, hours, days, or weeks). The active note still follows the global daily/repeat schedule; selected notes can also fire independently on their own intervals. Quiet hours, sound, snooze, strictness, and system notifications apply to every reminder.

### Active-note default and embed isolation

Active-note reminders are enabled by default and use the global reminder schedule. Tasks rendered through `![[embedded note]]` references are not counted as tasks belonging to the parent note and are excluded from parent-note reminders.

### Embed owner-note fix

The active reminder now resolves the outer Markdown view's file, not the focused transcluded source. For callouts such as `> [!warning]` followed by `> ![[Other note#Heading]]`, only task lines physically present in the outer note are counted.
