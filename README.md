# TaskPro

An Obsidian plugin for task management: interactive chips on every task line,
your own coloured tags, a task board that shows every task in the vault in one
place, a calendar to plan your days on in the Gregorian or the Jalali calendar,
bi-directional sync with a central task note, deadlines, priorities, and
per-task capabilities you add only where you want them.

![Task lines with status, priority, repeat, deadline, timer and progress chips](docs/images/task-chips-dark.png)

![The task board: every task in the vault as a table, grouped by status](docs/images/task-board-table-dark.png)

<sub>Rendered from the plugin's own code and `styles.css` over Obsidian's default
theme variables (see <a href="#previews">Development → Previews</a>), not
screenshots of a live vault.</sub>

## Contents

- [Features](#features)
- [Tags](#tags)
- [Task board](#task-board)
- [Calendar](#calendar)
  - [Subtasks](#subtasks) · [The task menu](#the-task-menu) · [Plans](#plans) · [Daily notes](#daily-notes)
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
| `Today, 09:30 – 11:00` | When you [plan](#plans) to work on it |
| `18:42` | A running focus timer |
| `38%` | Progress through a set number of steps |
| `Work` `Client` | Your own tags, each in its own colour; click to change them |

### Chips that belong to your theme

Every chip is a tint of **one accent colour, taken from the theme you are
using** — nothing in the plugin is a fixed colour. So the same six chips read
correctly on Obsidian's defaults, on a light vault, and on a community theme
with a palette of its own:

<table>
<tr>
<td align="center"><b>Obsidian default · dark</b></td>
<td align="center"><b>Obsidian default · light</b></td>
</tr>
<tr>
<td><img src="docs/images/task-chips-dark.png" alt="Task chips on Obsidian's default dark theme" width="400"></td>
<td><img src="docs/images/task-chips-light.png" alt="The same chips on Obsidian's default light theme" width="400"></td>
</tr>
<tr>
<td align="center"><b>A community theme · dark</b></td>
<td align="center"><b>A community theme · light</b></td>
</tr>
<tr>
<td><img src="docs/images/task-chips-bookcloth-dark.png" alt="The same chips on a community theme in dark mode" width="400"></td>
<td><img src="docs/images/task-chips-bookcloth-light.png" alt="The same chips on the same community theme in light mode" width="400"></td>
</tr>
</table>

A label is also pulled toward the theme's own text colour, which is what keeps
it readable in both modes from one declaration: it lightens on a dark theme and
darkens on a light one, because that is where the theme's text colour is. Every
chip variant is measured against WCAG AA (4.5:1) on each theme by
[`npm run check:contrast`](#previews) — the current worst case is 4.6:1.

If you want a specific hue anyway, each accent is a
[Style Settings](https://github.com/mgmeyers/obsidian-style-settings) knob,
along with how strongly chips tint themselves.

### Custom task statuses

`[/]` and `[!]` are drawn so they read at a glance, in Live Preview and Reading
Mode alike:

![The in-progress and not-done checkboxes](docs/images/task-checkboxes.png)

These are a floor, not a ceiling. Styling a checkbox is really a theme's job, so
the plugin uses plain selectors and no `!important` — a theme that styles these
states takes over with an ordinary rule, and one that ignores them still gets a
sensible default.

### Four-state task toggle

`Ctrl+T` cycles the task under the cursor through all four states:

```text
[ ] → [/] → [x] → [!] → [ ]
```

`[!]` means *not done* — for something that missed its moment rather than
something still open. Overdue tasks are moved into it automatically.

### Properties with `@`

On a task line, type `@` and the plugin lists what the task can be given — a
priority, a deadline (today, tomorrow, next week, or a date you pick), a plan,
a repeat rule, a tag, a status — filtered as you type, the way Notion's `@`
works. `@high`, `@tomorrow`, `@weekly` or a tag's name are enough. Choosing
one writes the marker through the same writers the menus use, so an existing
priority or deadline is replaced rather than doubled, and the `@word` you
typed is taken out again. Picking a tag the task already has takes it off. It
can be switched off under **Settings → TaskPro → Badges**.

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

## Tags

Tags are your own labels for tasks — *Work*, *Client*, *Deep work*, *Home* —
each with a name and a colour you choose, so tasks can be told apart at a glance
and pulled apart on the [task board](#task-board).

<table>
<tr>
<td align="center"><b>Obsidian default · dark</b></td>
<td align="center"><b>A community theme · light</b></td>
</tr>
<tr>
<td><img src="docs/images/task-tags-dark.png" alt="Task lines with tag chips next to the other chips, dark theme" width="400"></td>
<td><img src="docs/images/task-tags-bookcloth-light.png" alt="The same lines on a community theme in light mode" width="400"></td>
</tr>
</table>

- **Add tags to a task** from its status chip (**Add Tags**), by clicking a tag
  chip, with **Set Tags on Current Task**, or from the task board. The picker
  works like a Notion multi-select: type to filter, `Enter` to toggle, and
  typing a name that does not exist yet offers to **create it on the spot**,
  with a colour.

  <img src="docs/images/tag-picker.png" alt="The tag picker with two tags selected" width="360"> <img src="docs/images/tag-picker-create.png" alt="Creating a new tag from the picker, with a colour" width="360">

- **Colours come from your theme.** The palette is the theme's own red, orange,
  yellow, green, cyan, blue, purple and pink (plus grey), so a *blue* tag is
  your theme's blue in light and dark mode alike; a custom colour is there for
  anything else. Every palette colour passes WCAG AA as a chip label in both
  modes on every theme checked.
- **A note stores only the tag's key**, as `@tag(work, deep-work)`, hidden
  behind the chips while they are on. The name and colour live in the plugin's
  tag list, so renaming *Work* to *Office* or making it green updates every
  task at once without touching a note. Keys accept any script, so Persian tags
  (`@tag(کار)`) work as well as Latin ones.
- **Manage tags** under **Settings → TaskPro → Tags**, from the board, or with
  **Manage Tags**: rename, recolour, see how many tasks use each tag, and delete
  a tag either on its own (tasks keep the marker and show a grey chip until you
  define it again) or together with its marker in every note.

  <img src="docs/images/tag-manager.png" alt="The tag manager: colour, name, preview, marker and usage count for each tag" width="560">

- Tags travel with a task: they are copied into an imported task and synced from
  a linked copy back to its source, like the other markers. Obsidian's own
  `#tags` are left alone — they are part of the task text and still searchable
  from the board.

## Task board

Every task in one place, the way a Notion database shows every row: open it from
the ribbon or with **Open Task Board**, and it opens as a tab of its own.

![The task board as a kanban board, one column per status](docs/images/task-board-kanban-dark.png)

- **Scope:** the whole vault, or only the target folder set under **Settings →
  TaskPro → General**. The switch is at the top of the board.
- **Two layouts:** a **table** with a column per property, or a **board** with a
  column per group. Drag a card to another column to change its status,
  priority or tag.
- **Group** by status, tag, priority, deadline (*Overdue*, *Today*, *Next 7
  days*, *Later*, *Past*) or note, and fold away groups you do not need; a
  task with two tags appears under both, as in a Notion multi-select.
- **Sort** by title, status, priority, deadline, progress or note — click a
  column header once, twice to reverse, a third time for note order.
- **Filter** by status, priority and tag, and **search** titles, tag names and
  note names. Active filters show as pills you can click away.
- **Edit in place:** tick a task off, change its status or priority from a menu,
  set the deadline, pick tags, or click a title to rename it. Every edit is
  written into the note the task lives in, keeping all of its markers, and a
  linked copy syncs to its source the same way it does from the chip menu.
  **↗** opens the note with the cursor on the task.
- **Right-click any task** — a row, a card, or a task on the calendar — or
  press its **⋯** button for the [task menu](#the-task-menu): every property
  a task can carry, one hover away.
- **Add tasks** from the row at the top, or from a board column's **New**
  button. A new task goes into the note of your choice and takes on the active
  filters (or the column it was added to), so it does not vanish from the view
  the moment it is created.
- The board remembers its layout, grouping, sort and filters between sessions,
  follows your notes live, and reads right to left in Persian:

  ![The task board in Persian, right to left, on a community theme](docs/images/task-board-kanban-fa.png)

### Floating over everything

Press **`Ctrl+Shift+B`** (`Cmd+Shift+B` on macOS), or run **Toggle Floating
Task Board**, from anywhere — a note, the graph, another plugin's view — and
the board opens as a large floating window over the whole app. The same keys
close it again, as does `Esc`; the search field has focus as soon as it
appears, so you can start typing to find a task. **Open in a tab** in its
header sends it back to a workspace tab, and **Float over Obsidian** on the
tab's header does the reverse.

![The task board floating over Obsidian, with the rest of the app blurred behind it](docs/images/task-board-floating-light.png)

![The same in dark mode, as a board](docs/images/task-board-floating-dark.png)

<sub>These two are screenshots of Obsidian 1.13.7 itself, with the Bookcloth
theme, not harness renders.</sub>

The plugin sizes the window and dims what is behind it. The blur belongs to the
theme: while the float is open the plugin puts `taskpro-board-is-floating` on
`<body>` and `taskpro-board-float` on the modal container, and a theme blurs
from those — [Bookcloth](https://github.com/Ali-Nourix/Obsidian-Theme) does, and
exposes the strength as a Style Settings slider. A theme that blurs should put
`filter: blur()` on `body > .app-container` (and `.titlebar`) rather than
`backdrop-filter` on the modal background: measured in Obsidian with the board
repainting every frame, `filter` holds 60 fps exactly as no blur does, while
`backdrop-filter` drops to about 26.

It stays quick on a large vault: notes the metadata cache says hold no tasks are
never read, only the lines Obsidian itself calls task items are parsed (so a
`- [ ]` in a code block is not a task), a changed note is re-parsed from the
content Obsidian already has in hand, and long groups are drawn 150 rows at a
time.

<table>
<tr>
<td><img src="docs/images/task-board-table-bookcloth-light.png" alt="The task board table on a community theme in light mode" width="820"></td>
</tr>
</table>

## Calendar

The board's third layout, next to **Table** and **Board** (or **Open Task
Calendar** from anywhere). It shows every task that belongs to a day — one you
planned for it, one due that day, or one written in that day's note — so you
can decide what to work on and when, in the Gregorian or the Jalali calendar.

![The calendar's week view: planned tasks as blocks on a time grid, all-day tasks and deadlines above, and the unscheduled tasks in a sidebar](docs/images/task-calendar-week-light.png)

- **Four views:** **Month**, **Week**, **Day**, and **Agenda** (the next 14
  days as a list). With the calendar focused, `M` `W` `D` `A` switch views,
  `T` goes to today, the arrow keys step back and forward, and `N` adds a task.
  The keys go by position on the keyboard, so they work on a Persian layout
  too.
- **Gregorian or Jalali,** switched in the bar at the top. The other calendar's
  date is shown small beside every day. A Jalali week starts on Saturday with
  Friday as the weekend, and a Gregorian one starts on Monday (the start can
  be changed under **Week starts on**). In Persian the calendar reads right to
  left.

  ![The month view in Persian, right to left, in the Jalali calendar](docs/images/task-calendar-month-fa-dark.png)

- **Plan a block of time:** drag across the week or day grid. A click on an
  empty slot only marks it, with a hairline and a square **+** on it beside
  the pointer, so a stray click never opens anything; click the **+** to plan
  there. One panel is open at a time: a card and the task menu replace each
  other rather than stack. A card
  opens on the spot: type a title and press `Enter` to create a new
  task there, or choose one of the tasks you already have to plan it for that
  time. The times are typed, not picked: `9`, `930`, `2:30 pm` and `21:30` all
  work, and the arrow keys move a time by one step.

  ![Planning a block from the week grid: a new task or an existing one](docs/images/task-calendar-picker-light.png)

- **Move and resize** by dragging: a block to another hour or day, its bottom
  edge to change how long it lasts, a task onto the all-day row to keep the day
  but drop the time, and a task onto the sidebar to unplan it. `Esc` cancels a
  drag.
- **Unscheduled** lists the open tasks with no plan yet; drag one onto the
  calendar to give it a time.
- **Click a task** to open its card, laid out like a Notion page: the task it
  is part of, the title with its checkbox, then one row per property — when,
  status, priority, deadline, repeat, tags, note — with the name on one side
  and the value on the other, then its subtasks. Click a title to rename it,
  edit the time in place, or click any other value for its choices right under
  it; an empty one says so, faintly. **⋯** and a right click open the
  [task menu](#the-task-menu).

  ![A task's card in the day view: date, times, status, priority, deadline and tags](docs/images/task-calendar-day-card-dark.png)

- **Deadlines** show as outlined flags on the day they fall. Dragging one
  plans it for that time and leaves the deadline where it is: the plan is when
  you will do it, the deadline is when it is due.
- The options button (the sliders next to the calendar switch) turns
  deadlines, tasks from daily notes, and done tasks on or off.

  ![The agenda view: the next two weeks as a list](docs/images/task-calendar-agenda-light.png)

<table>
<tr>
<td align="center"><b>Month · Gregorian</b></td>
<td align="center"><b>Week · Jalali, in Persian</b></td>
</tr>
<tr>
<td><img src="docs/images/task-calendar-month-light.png" alt="The month view in the Gregorian calendar, light theme" width="400"></td>
<td><img src="docs/images/task-calendar-week-fa-light.png" alt="The week view in the Jalali calendar, in Persian, right to left" width="400"></td>
</tr>
</table>

<sub>The screenshots in this section are of Obsidian 1.13.7 itself, not harness
renders.</sub>

### Subtasks

A task nested under another in its note is its subtask, and the calendar shows
the family together while each subtask is still planned on its own:

- A subtask with no tag of its own takes its parent's colour, and a block with
  room for it names the parent above its title.
- Hovering any member outlines the rest of its family on screen, however far
  apart they are planned.
- **Unscheduled** shows a family as a tree, as Notion's sidebar does: the
  parent with a toggle before it and how many subtasks are done after it, and
  the subtasks under it on a thin guide line, in note order. A parent that is
  already planned stays there, muted, to hold its open subtasks.
- A parent's card lists its subtasks with a checkbox and when each is planned,
  opens any of them with a click, and takes a new one in the **Add a
  subtask** field. A subtask's card links back to its parent.

A plain bullet between a task and its subtask, such as a note written under
it, does not break the link.

![A parent task's card with its subtasks and when each is planned, and the family ringed on the calendar](docs/images/task-calendar-subtasks-light.png)

### The task menu

Right-click a task on the board or the calendar for a Notion-like menu of
everything the task can carry: status, priority, tags, deadline, plan,
repeat and progress, each with its current value beside it and its choices in
a submenu (Tags lists every tag, ticked when the task has it, and a way to
create one). Below them are **Add a subtask**, **Duplicate** (the copy goes
after the task and its subtasks), the full chip menu for the focus timer
and sync, and **Delete**.

**Delete** takes the task out of its note, together with everything nested
under it (its subtasks and the notes written beneath it), and says so when
there are subtasks: *Delete with its 2 subtasks*. A notice then offers
**Undo** for a few seconds, which puts the lines back exactly as they were.
It is also at the foot of a task's card, and the `Delete` key does it for a
task that has focus on the calendar. **Remove from calendar** is different:
it only takes the plan off, and the task stays in its note.

![The task menu on the calendar, with the Plan submenu open](docs/images/task-calendar-menu-light.png)

- Type straight away to search: `high` finds **Priority › High**, `week`
  finds **Repeat › Every week** and **Plan › Next week**. English words work
  in the Persian menu too.
- The arrow keys move through it, the forward arrow opens a submenu and the
  back arrow closes it (mirrored in Persian), `Enter` chooses, and `Esc`
  closes the innermost panel first.
- A right click on an empty slot offers a new task at that time, the day's
  note, or the day on its own.

<img src="docs/images/task-calendar-menu-fa-light.png" alt="The same menu in Persian, right to left, with its submenu opening to the left" width="820">

### Plans

A plan is written into the task line: `@schedule(2026-09-28 09:30-11:00)`, or
`@schedule(2026-09-28)` for the whole day. In Live Preview and Reading Mode it
is hidden behind a pink chip such as `Today, 09:30 – 11:00`, which turns grey
once the day has passed with the task still open. To plan from a note, use
**Plan a Time…** in the task's menu (click any of its chips) or run **Plan
Current Task…**.

A plan belongs to one copy of a task. It is not synced to a linked source, and
importing a task leaves the source's plan behind. A repeating task moves its
plan forward along with its deadline and keeps the time of day, so a weekly
09:00 block stays a weekly 09:00 block. A task with a plan and no deadline
repeats by the plan and is not given a deadline.

### Daily notes

Every day can have a note of its own, named after its date: **in English when
the Gregorian calendar is showing, and in Persian when the Jalali one is**. A
task you create on a day goes into that day's note. If the note does not exist
yet, it is created from your template, with the task already in it. Any task
written in a day's note shows on that day, even without a plan.

Set these up under **Settings → TaskPro → Calendar**:

| Setting | What it does |
| --- | --- |
| **Folder** | Where daily notes are kept (`Daily` by default) |
| **Gregorian name** / **Jalali name** | The name formats: `YYYY-MM-DD` and `jYYYY-jMM-jDD` by default |
| **Name new notes with** | The calendar showing, or always Gregorian, or always Jalali |
| **Template** | The note a new daily note starts from |
| **Put new tasks under** | A heading such as `## Tasks`, added if the note does not have it yet; leave it empty to add tasks at the end of the note. The note is kept tidy: a blank line between the heading and its list, a new task joining the list already there, and a blank line before the next heading |
| **Use Obsidian's Daily notes settings** | Copies the folder, format and template from the core Daily notes plugin |

A preview under the name settings shows today's note path in both calendars as
you type.

**Name formats** use these tokens. Text in `[brackets]` is kept as it is, and a
`/` makes subfolders, so `YYYY/MM/YYYY-MM-DD` files each day under its year and
month:

| Gregorian | Jalali | Gives |
| --- | --- | --- |
| `YYYY` `YY` | `jYYYY` `jYY` | Year: `2026`, `26` / `1405`, `05` |
| `MM` `M` | `jMM` `jM` | Month number: `09`, `9` / `07`, `7` |
| `MMMM` `MMM` | `jMMMM` `jMMM` | Month name: `September`, `Sep` / `مهر` |
| `DD` `D` `Do` | `jDD` `jD` `jDo` | Day: `28`, `28`, `28th` / `06`, `6` |
| `dddd` `ddd` `dd` | | Weekday name, in the naming calendar's language |
| `W` `WW` `GGGG` | | ISO week number and ISO week year |

**Templates** can use `{{title}}` (the note's name), `{{date}}` and
`{{date:FORMAT}}` (with any token above, Jalali ones included), `{{time}}`,
`{{weekday}}`, `{{gregorian}}` and `{{jalali}}` (the day in each calendar), and
`{{yesterday}}` and `{{tomorrow}}` (the names of the notes on either side, so
`[[{{yesterday}}]]` links back a day). If
[Templater](https://github.com/SilentVoid13/Templater) is installed, its
commands in the template run as well.

A day never gets two notes. Before a note is created, the day's name in both
calendars is checked, so a note made while the Gregorian calendar was showing
is still found from the Jalali one. If you would rather keep planned tasks in
one place, set **Tasks made on a day go into** to the board's inbox note; each
task then carries the day in its `@schedule` marker.

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
| Set Tags on Current Task | — |
| Manage Tags | — |
| Open Task Board | — |
| Toggle Floating Task Board | `Ctrl+Shift+B` |
| Open Task Calendar | — |
| Open Today's Daily Note | — |
| Plan Current Task… | — |
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
- [ ] Task with tags @tag(work, deep-work)
- [ ] Task planned for a time @schedule(2026-12-30 09:00-10:30)
- [ ] Task planned for a day @schedule(2026-12-30)
- [ ] Everything at once @priority(high) @due(2026-12-31) @repeat(2w) @tag(client) @schedule(2026-12-30 14:00-16:00)
```

`@due(...)`, `@priority(...)`, `@repeat(...)`, `@tag(...)` and `@schedule(...)`
are the canonical markers, and each is hidden behind its chip while that chip is
on. A tag marker holds tag keys, not names: the name and colour come from your
tag list. A deadline is when a task is due; a
[plan](#plans) is when you mean to work on it. The older `⏳ 2026-12-31`,
`📅 2026-12-31`, `[due:: ...]`, `[deadline:: ...]`, `[priority:: ...]` and
Obsidian Tasks priority emoji (`🔺⏫🔼🔽⏬`) are still read, so existing vaults
keep working, and they are rewritten to the canonical form the next time the
task is edited.

Progress bars and focus timers are **not** written into your notes. They are
keyed by the task's block ID and live in the plugin's `data.json`; a task
without a block ID gets one the first time you attach one of them.

## Bi-directional sync

Importing a task creates a mapping between the imported copy and the source
line. A status, deadline, priority, tag or progress change on either side updates the
other, and each mapping can be unlinked from the task's own menu without losing
the task.

A repeating task that rolls forward advances its linked copy too, rather than
telling it about a completion that no longer stands.

## Reminders

<table>
<tr>
<td><img src="docs/images/reminder-overlay-light.png" alt="The task reminder alert on a light theme" width="400"></td>
<td><img src="docs/images/reminder-overlay-dark.png" alt="The same alert on a dark theme" width="400"></td>
</tr>
</table>

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
| **Badges** | Chip language, size, calendar system, embed visibility, a switch per optional chip, and the `@` suggestions on task lines |
| **Capabilities** | Focus-timer duration, desktop notification, sound, status-bar readout; a note on how repeat intervals are counted |
| **Tags** | Tag chips on or off, and the tag list: create, rename, recolour, delete |
| **Calendar** | [Daily notes](#daily-notes): folder, name formats, template, heading; planning: where new tasks go, week start, 12- or 24-hour clock, the hour the grid opens at, snap, and new block length |
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
  markdown stays clean. Tag names and colours live there too; a note holds only
  the key.
- The chip menu, the board and the commands edit a task through one path, which
  finds the line (by the line number it was read from while that line is
  unchanged, then by block ID, then by text), rewrites it under the vault lock,
  and syncs a linked copy. Renaming a task moves its sync mapping with it.
- Obsidian loads a theme's stylesheet after every plugin's, so a theme wins any
  specificity tie. The board's controls are scoped one class above a theme's
  generic `button` and `input` rules, its checkbox glyphs are CSS masks rather
  than icons (so a theme's icon-button sizing never reaches them), and coloured
  button states are background images, which a theme's `button:hover` colour
  paints under rather than over. That is what keeps the board looking the
  same under any theme.
- The task board keeps an index of every task that follows the vault's metadata
  events. It is built the first time the board (or a tag count) needs it, after
  Obsidian's layout is ready, and costs nothing until then.
- Chip colour is one recipe — tint a background and a border out of an accent,
  and mix the label toward the theme's text colour — so a new chip is a single
  custom-property assignment and inherits the theme adaptivity for free.
- The calendar is drawn from the same task index as the board, plus the tasks
  of the daily notes in view, which are found by working each day's note path
  out from its date rather than by searching the vault. Dates are kept as
  `YYYY-MM-DD` keys and counted in UTC, so a daylight-saving change never
  shifts a day. The Jalali calendar is a way of reading those keys, converted
  with the same arithmetic the deadline picker uses, so no date library is
  involved and a note always stores the Gregorian date.
- Overlapping blocks share a day's column in lanes, as in a calendar app. Drags
  are pointer events with a small threshold, so a click still opens a task and
  a drag works the same with a mouse, a pen or a trackpad; on a touch screen a
  tap opens the task, so scrolling is left alone. While a drag or a card is
  open, a note change is held back and redrawn afterwards, so the calendar
  never redraws under your pointer.
- A task's parent is read from the list structure of its note while the note
  is parsed: the nearest task among the list items it is nested under, past
  any plain bullets in between, and a paragraph at the margin ends the list.
- Mixed Persian and Latin text is kept in order with Unicode isolates rather
  than by hoping the bidi algorithm guesses right: a note name or a task title
  dropped into a sentence is isolated, and a Latin-digit time range is held
  left to right, so `09:00 – 10:30` never reads `10:30 – 09:00` in Persian.
- `Esc` goes to the innermost thing open. Obsidian handles keys before the
  page does, so a card or a drag pushes a keymap scope of its own: the first
  `Esc` closes the card, and only the next one closes the floating board.
- No full-screen `backdrop-filter`. Blurring the window behind an overlay makes
  the compositor re-blur everything whenever anything above it repaints, which
  is why the reminder alert used to feel sluggish with a long task list. The
  overlays dim instead, and `contain` keeps their repaints local.

## Development

```bash
npm install
npm run dev     # watch build
npm run build   # typecheck + production build
npm test        # markers, recurrence, timers, board data, calendar dates and daily notes, and the plugin's edit paths
```

`npm test` includes an integration test (`test/plugin-edits.mjs`) that loads the
whole plugin against an in-memory vault (`test/harness/obsidian-node-mock.mjs`)
and drives the same edit path the chip menu and the board use: status,
priority, deadline, tags and renames, tag sync to a source note, the tag list,
removing a tag from every note, plans and how they roll forward, and daily
notes created from a template. `test/calendar.mjs` covers the calendar's date
arithmetic in both calendars, name formats, templates and block layout.

The distributable files are `main.js`, `manifest.json`, and `styles.css`.

### Previews

`test/` holds offline harnesses that load the real `styles.css` over Obsidian's
default theme variables (`test/obsidian-theme.css`) and reproduce the DOM the
plugin builds. Open one in a browser to check a style change without reloading
Obsidian:

| File | Shows | Query flags |
| --- | --- | --- |
| `test/chips-preview.html` | Task lines with every chip, and each chip's states | `?light`, `?theme=<name>` |
| `test/reminder-preview.html` | The reminder alert | `?light`, `?theme=<name>`, `?strict` |
| `test/board-preview.html` | The task board, calendar, tag picker, tag manager and tag chips, built by the plugin's own classes | `?light`, `?theme=<name>`, `?layout=<board\|calendar>`, `?cal=<month\|week\|day\|agenda>`, `?system=jalali`, `?group=<tag\|priority\|…>`, `?lang=fa`, `?view=<picker\|manager\|note\|palette>` |

`board-preview.html` loads a bundle of the real board code against a stub host
whose edits land in in-memory notes, so it can be clicked through like the
real thing. Build it with `node test/harness/build.mjs` (the preview and test
scripts below do this themselves).

`?theme=<name>` stacks `test/themes/<name>.css` between Obsidian's defaults and
the plugin's sheet, in the order Obsidian loads them — which is how the
community-theme screenshots above were produced, and how a theme is checked
before claiming the chips adapt to it. Drop any theme's `theme.css` into
`test/themes/` to try it.

```bash
npm i --no-save playwright lucide-static && npx playwright install chromium

npm run previews        # regenerate the images in this README
npm run check:contrast  # measure every chip, board and tag colour against WCAG AA on every theme
npm run test:ui         # click and drag through the board and the calendar in a real browser
```

These need Playwright, and the board harness needs Lucide's icon set (the icons
Obsidian ships). Neither is a dependency — they would pull a browser and an
icon set into every install — so `npm test` stays independent of them and
covers the logic instead.

## Releasing

1. Update the version in `manifest.json`, `package.json` and
   `package-lock.json`.
2. Add the version and its minimum Obsidian version to `versions.json`.
3. Commit and push.
4. Tag the commit with exactly the manifest version, no `v` prefix:

   ```bash
   git tag 1.5.0
   git push origin 1.5.0
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
