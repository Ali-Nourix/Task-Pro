# TaskPro

An Obsidian plugin for task management: interactive chips on every task line,
bi-directional sync with a central task note, deadlines, priorities, and
per-task capabilities you add only where you want them.

![Task lines with status, priority, repeat, deadline, timer and progress chips](docs/images/task-chips-dark.png)

<sub>Rendered from the plugin's own `styles.css` over Obsidian's default theme
variables (see <a href="#previews">Development → Previews</a>), not screenshots
of a live vault.</sub>

## Contents

- [Features](#features)
- [Per-task capabilities](#per-task-capabilities)
- [Requirements](#requirements)
- [Installation](#installation)
- [Setup](#setup)
- [Commands](#commands)
- [Task syntax](#task-syntax)
- [Bi-directional sync](#bi-directional-sync)
- [Reminders](#reminders)
- [Settings](#settings)
- [How it works](#how-it-works)
- [Development](#development)
- [Releasing](#releasing)
- [License](#license)

## Features

### Interactive chips

Every task line gets a row of chips, rendered through CodeMirror decorations in
Live Preview and a post-processor in Reading Mode. Nothing is written into your
notes to make them appear, and clicking one opens the menu for that property.

| Chip | Meaning |
| --- | --- |
| `Not Started` `In Progress` `Done` `Not Done` | Task status; click to change it |
| `Highest` … `Lowest` | Priority, five levels |
| `Every week` | Recurrence |
| `Tomorrow` `3 Days Left` `Not completed on time` | Deadline, coloured by urgency |
| `18:42` | A running focus timer |
| `38%` | Progress through a set number of steps |

Chips follow the vault's theme and are sized by one setting:

<table>
<tr>
<td align="center"><b>Dark</b></td>
<td align="center"><b>Light</b></td>
</tr>
<tr>
<td><img src="docs/images/task-chips-dark.png" alt="Task chips in a dark vault" width="400"></td>
<td><img src="docs/images/task-chips-light.png" alt="The same chips in a light vault" width="400"></td>
</tr>
</table>

### Four-state task toggle

`Ctrl+T` cycles the task under the cursor through all four states:

```text
[ ] → [/] → [x] → [!] → [ ]
```

`[!]` means *not done* — for something that missed its moment rather than
something still open. Overdue tasks are moved into it automatically.

### Task import and bi-directional sync

Import tasks from a central reference note (say `Weekly Tasks.md`) into any
note, and a status change on either side updates the other.

### Global internal tasks

Tasks stored in plugin settings rather than in a note, available in the import
modal alongside the reference note's own.

### Bilingual, with Jalali dates

Every chip and menu is available in English or Persian (فارسی), with correct
right-to-left text, and deadlines can be displayed and picked in either the
Gregorian or the Jalali calendar.

## Per-task capabilities

Three capabilities can be attached to any task, in any combination. Click a
task's status chip and pick one under **Add Capability** — nothing is switched
on until you ask for it, so a plain task stays a plain task.

| Capability | Chip | Stored in |
| --- | --- | --- |
| **Progress bar** | `38%` | Plugin data, keyed by the task's block ID |
| **Focus timer** | `18:42` | Plugin data, keyed by the task's block ID |
| **Repeat** | `Every week` | The task line itself, as `@repeat(1w)` |

### Focus timer

A countdown attached to one task, for the "I'll give this twenty-five minutes"
way of working.

![Focus timer, repeat and priority chips in each of their states](docs/images/chip-states.png)

- Click the chip to start, pause, add 5 or 15 minutes, reset, change the
  duration, or remove the timer.
- The running timer also sits in Obsidian's status bar; clicking it opens the
  note the task lives in.

  ![The running timer in Obsidian's status bar](docs/images/status-bar-timer.png)

- When time is up you get an in-app notice, an optional sound, and a **desktop
  notification** naming the task — on Windows that arrives as a system toast
  and stays in the Action Center, so you see it with Obsidian in the
  background. Permission is asked for once.
- Remaining time is read from timestamps rather than counted down in memory, so
  a timer keeps running while Obsidian is closed and comes back with the right
  time left — or already finished — when you reopen the vault.
- **Start / Pause Focus Timer on Current Task** does the same from the keyboard,
  creating a timer at the default duration if the task has none.

Defaults live under **Settings → TaskPro → Capabilities**: duration, desktop
notification, sound, and the status-bar readout.

### Repeat

What a planner actually needs from a task that comes back.

- Presets for every day, week, two weeks and month, plus a custom interval of
  any number of days, weeks or months.
- Ticking off a repeating task **rolls it forward instead of closing it**: the
  deadline moves to the next occurrence, the status returns to `[ ]`, and any
  progress bar or focus timer on the task resets with it.
- The next date is counted from the task's own deadline, so a weekly task keeps
  its weekday even when you tick it off two days late. A deadline already in the
  past is advanced until it lands in the future — clearing a month of missed
  dailies leaves one task due tomorrow, not one due last week.
- Month intervals clamp instead of spilling: a task due on the 31st repeats on
  the 30th in a 30-day month.
- The rule lives in the task line as `@repeat(1w)`, so it survives moving,
  syncing and sharing the note. The marker is hidden behind the chip while that
  chip is on.
- Rolling forward works however the task was completed — the chip menu, the
  Reading Mode checkbox, `Ctrl+T`, or typing `[x]` by hand.

## Requirements

- Obsidian **1.5.0** or newer (this is the plugin's `minAppVersion`).
- Desktop or mobile. Two features are desktop-only in practice: the status-bar
  timer readout and the system notification when a timer ends.

## Installation

1. From the [latest release](../../releases/latest), download either
   `taskpro-<version>.zip` or the three loose files `main.js`,
   `manifest.json`, and `styles.css`.
2. Create `.obsidian/plugins/taskpro/` inside your vault.
3. Unzip the archive into that folder, or copy the three files into it.
4. Enable **TaskPro** under **Settings → Community plugins**.

## Setup

1. Open **Settings → TaskPro**.
2. Set the **Reference Note Path** (for example `Weekly Tasks.md`).
3. Optionally set a **Target Folder** to restrict the plugin to part of the
   vault.
4. Choose your chip language, size, and calendar system under **Badges**.

## Commands

| Command | Default hotkey |
| --- | --- |
| Import Task from Reference Note | — |
| Toggle Task Status (4-State) | `Ctrl+T` |
| Toggle Task Not Done | `Ctrl+Shift+X` |
| Move Task with Subtasks Up | `Alt+Shift+↑` |
| Move Task with Subtasks Down | `Alt+Shift+↓` |
| Set/Change Task Deadline | `Ctrl+Shift+D` |
| Set/Change Task Priority | `Ctrl+Shift+P` |
| Start / Pause Focus Timer on Current Task | — |
| Toggle Weekly Repeat on Current Task | — |
| Show Task Reminders Now | — |
| Toggle Daily Task Reminders | — |

## Task syntax

```markdown
- [ ] Task name
- [/] Task in progress
- [x] Completed task
- [!] Task that was not done
- [ ] Task with a deadline @due(2026-12-31)
- [ ] Task with a priority @priority(high)
- [ ] Task that repeats @repeat(1w)
- [ ] Everything at once @priority(high) @due(2026-12-31) @repeat(2w)
```

`@due(...)`, `@priority(...)` and `@repeat(...)` are the canonical markers, and
each is hidden behind its chip while that chip is on. The older `⏳ 2026-12-31`,
`📅 2026-12-31`, `[due:: ...]`, `[deadline:: ...]`, `[priority:: ...]` and
Obsidian Tasks priority emoji (`🔺⏫🔼🔽⏬`) are still read, so existing vaults
keep working, and they are rewritten to the canonical form the next time the
task is edited.

Progress bars and focus timers are **not** written into your notes. They are
keyed by the task's block ID and live in the plugin's `data.json`; a task
without a block ID gets one the first time you attach one of them.

## Bi-directional sync

Importing a task creates a mapping between the imported copy and the source
line. A status, deadline, priority or progress change on either side updates the
other, and each mapping can be unlinked from the task's own menu without losing
the task.

A repeating task that rolls forward advances its linked copy too, rather than
telling it about a completion that no longer stands.

## Reminders

Reminders are read from the active note plus any notes you select under
**Settings → TaskPro → Reminders**. Every unfinished task counts; completed ones
are skipped.

- **Schedule:** fixed times of day, plus an optional repeat every N minutes, with
  quiet hours.
- **Per-note intervals:** each selected note has its own switch, interval and
  unit (minutes, hours, days or weeks), so a note can fire independently of the
  global schedule.
- **Filters:** by priority, by status, by how close the deadline is, and by how
  recently the task was first seen — the plugin keeps its own hidden index of
  when each task appeared, so nothing is guessed from file names.
- **Strictness:** a toast, a dismissible fullscreen alert, or one that holds for
  a few seconds before it can be acknowledged. Sound, snooze and system
  notifications apply to all three.

Active-note reminders are on by default. Tasks that only appear through an
`![[embed]]` are not counted as belonging to the note doing the embedding — the
alert resolves the outer note's own file, so a callout like
`> ![[Other note#Heading]]` does not pull in tasks that are not really there.

## Settings

| Tab | Holds |
| --- | --- |
| **General** | Reference note, target folder restriction |
| **Badges** | Chip language, size, calendar system, embed visibility, and a switch per optional chip |
| **Capabilities** | Focus-timer duration, desktop notification, sound, status-bar readout; a note on how repeat intervals are counted |
| **Reminders** | Schedule, note sources, filters, strictness, sound |
| **Internal Tasks** | Tasks stored in the plugin rather than a note |

Chip colours, padding, radius and opacity are exposed to the
[Style Settings](https://github.com/mgmeyers/obsidian-style-settings) plugin.

## How it works

- CodeMirror 6 `ViewPlugin` for Live Preview chips; `MarkdownPostProcessor` for
  Reading Mode.
- Chips are decorations, so the markers stay out of the rendered line and out of
  the file's visible text.
- All writes go through `Vault.process()`, which re-reads under the vault lock —
  a concurrent edit is never clobbered.
- Focus timers share one interval that only exists while a timer is running, and
  countdown chips are retargeted in place instead of by rebuilding editor
  decorations, so a per-second update never fights the cursor.
- Mappings, progress and timers live in `data.json`, keyed by block ID, so the
  markdown stays clean.

## Development

```bash
npm install
npm run dev     # watch build
npm run build   # typecheck + production build
npm test        # recurrence date maths and timer bookkeeping
```

The distributable files are `main.js`, `manifest.json`, and `styles.css`.

### Previews

`test/chips-preview.html` loads the real `styles.css` over Obsidian's default
theme variables (`test/obsidian-theme.css`) and reproduces the DOM the chip
renderers build. Open it in a browser to check a style change without reloading
Obsidian — add `?light` for the light theme — or regenerate the images in this
README:

```bash
npm i --no-save playwright && npx playwright install chromium
node test/render-previews.mjs
```

## Releasing

1. Update the version in `manifest.json`, `package.json` and
   `package-lock.json`.
2. Add the version and its minimum Obsidian version to `versions.json`.
3. Commit and push.
4. Tag the commit with exactly the manifest version, no `v` prefix:

   ```bash
   git tag 1.2.1
   git push origin 1.2.1
   ```

The workflow checks that the tag, manifest, package, lockfile and
`versions.json` all agree, runs the tests, builds, and publishes `main.js`,
`manifest.json`, `styles.css`, and `taskpro-<version>.zip` holding the same
three files.

### Releasing without a local tag

The same workflow runs from the **Actions** tab, which helps when you cannot
push a tag from a clone:

| Input | Effect |
| --- | --- |
| *(none)* | Builds and uploads the zip and the three loose files as run artifacts. Nothing is tagged or published. |
| **publish** | Also creates the tag — taken from `manifest.json`, so the metadata check still has to pass — and the release with all four assets. |
| **target** | The commit-ish to build and tag. Defaults to the branch the run was started from; set it to `main` to release from the default branch. |

`gh release create` refuses to overwrite an existing release, so a version can
only be published once.

See [CHANGELOG.md](CHANGELOG.md) for what changed in each version.

## License

Released under the [MIT License](LICENSE). Developed by Ali.
