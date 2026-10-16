# Changelog

## 1.7.1 — Inline embed state persistence

- Remember each inline block’s layout, filters, calendar mode/system, and visited date across Markdown rerenders and Obsidian restarts, without changing the main board or other embeds.
- Advance release metadata from the already-published 1.7.0 to 1.7.1 so the release workflow can publish this fix without replacing previous assets.

## Unreleased — Note embeds and Pomodoro


- Align embedded-view settings actions with their neighboring controls; share an 8px side gutter across minimal/full content without doubling calendar navigation padding.
- Default note views to the configured target folder on every reopen. Add a General setting for target-folder, whole-vault, or explicit code-block scope policy; refresh existing embeds when the policy changes.
- Keep narrow-calendar view switches at full width rather than reserving the options-button column for every row.

- Follow-up: minimal embedded chrome by default, recoverable full controls and optional calendar sidebar.
- Fixed the floating kanban hover-selection square; bulk selection is preserved inside the card.
- Cached ordered task snapshots and relation indexes, coalesced store-driven paints per animation frame, and removed redundant loaded-store mount paints. Existing motion remains in place.

- Interactive `taskpro` Markdown code blocks for inline tables and calendars, using the shared task store and isolated per-embed preferences.
- Per-task Pomodoro focus/break cycles, long-break cadence, target/completed rounds and optional auto-start, built on the existing persistent timer service.
- Persian/English controls, bounded mobile timer settings, completion/reload tests and real-renderer browser checks.
- See [usage and behavior](docs/note-embeds-pomodoro.md). No Google Calendar changes.

## 1.6.0 - Automatic planning, time tracking, scrolling chips and private diagnostics

### Auto-plan that never misses

- Every task written into a note gets its plan (and, with time tracking, its start)
  **3 seconds after you stop typing**, read from the open editor rather than the
  saved file.
- A task is new when its text was not in the note a moment ago; only a change to
  an old task's text on the same line counts as an edit. TaskPro no longer asks
  its age index, so a task deleted and written again, or a word typed before, is
  still new.
- A task saved half typed and then finished stays new; a note created a moment ago
  counts all its tasks as new; a bare checkbox is not a task yet.
- Notes in the **daily notes folder** are watched even when it is outside the
  target folder.

### A cleaner Telegram bot

- **Quick tick**: a ☑️ button on every list turns its task buttons into check boxes;
  a tap ticks the task off and the list stays, ready for the next.
- **Nothing said twice**: today's list has the date in its title and no «today»
  heading under it; a plan for today shows only its hour (🕒 16:00–16:30).
- **Readable task buttons**: a few tasks get a row each with most of their title,
  more go two to a row in reading order; «۱.» instead of «۱ ·», which looked like «۰۱».
- **The week shows what is planned**: a summary line, only the days that have tasks,
  and the free days in one line; day buttons mark busy days with a dot that no longer
  runs into the digits.
- **Home is a dashboard**: a greeting for the time of day, what is next, and today's
  first three tasks. The tab bar's ➕ (grey on dark themes) is now 📝.
- **Telegram's rich formatting used where it helps**: home is a small dashboard
  (the next task ==marked==, today as a task list, the counts on one line, the sync
  in a footer); in the full list, «later» and «no plan» fold into `<details>` when
  something nearer is on the page and overdue is marked; today's day is marked in
  the week; hints and the «waiting for Obsidian» note are footers.
- **The assistant's answer no longer pushes the chat up**: the «Thinking…» draft is a
  rich draft by default and the answer is streamed into that same draft before it is
  sent, so the bubble grows in place; the answer no longer quotes your message. Its
  tasks are a task list with readable buttons; «📤» marks a task not yet in the notes
  (the old 🕓 looked like the plan's 🕒).
- The week's «free days» line is gone: the week shows only days with tasks.
- The brief behind it is in `docs/telegram-bot-design.md`.

### Tasks planned by themselves, in the notes and in Telegram

- **Plan new tasks for today** (Settings → Calendar, on by default): a task you
  type without a plan is planned for the day it was written, so the calendar and
  the bot's lists show it there.
- **Track start and end time** (off by default): the plan starts at the moment the
  task was written and ends when it is ticked off that day (at least a minute).
  No «starts now» reminder is shown for a start written this way.
- **Telegram does the same at once**: the plugin sends both settings with each
  sync, and a task made in the bot is planned (and started) the moment it is made
  there, and ended the moment it is ticked off there, not when the notes next
  sync. The bot's database learns two settings (`20261010000000_task_timing.sql`);
  the functions add them themselves on first use after `update-bot.bat`.
- **Long chip rows scroll** sideways with a fade at the edges, instead of
  wrapping under the task.

### Accessibility and validation fixes

- Reduced-motion mode disables animations and transitions outright; zero-duration backwards-filled animations no longer expose a transient scaled hit target.
- Gesture click guards expire at the next primary press and do not block keyboard activation, so a legitimate next tap is not swallowed after a swipe/long press.
- Chip rows map downward wheel input to the trailing edge in negative-scroll RTL/reversed layouts.
- Keyboard focus cancels an unfinished wheel glide, so it cannot pull an offscreen focused chip back out of view.
- Pointer focus no longer reveals collapsed mobile chrome mid-tap and moves the floating + away; keyboard/switch focus still reveals it.
- Small table controls keep their keyboard focus rings inside clipped cells.
- Added a light/dark × LTR/RTL × motion-preference chip-scroll regression matrix.
- Pinned the tested Obsidian API declarations and updated build tooling/transitive Moment to resolve the three reported development-dependency advisories.

### Privacy hardening

- Deployment instructions and the update script no longer contain a personal Supabase project reference.
- Runtime diagnostics log fixed events only, not exception objects, provider responses or note paths.
- Sync failures and command failures no longer persist or upload raw exception messages.
- Local credentials and vault/deployment state are ignored. See `SECURITY.md` before publishing.

## 1.5.0 - A calendar and a timeline to plan your days on, and a board that fits a phone

### The phone, rebuilt: a frame, quick add, light rows, accessibility

- **A frame made for a thumb**: a slim top bar, the layouts as tabs along the
  bottom (List, Board, Calendar, Timeline) and the round **+** above them. On
  the list the bars step aside while you scroll down and return at the first
  scroll up, without the list changing size.
- **A gesture to the task board from anywhere**: two fingers put down together and
  pulled straight down, from a note or any other view (a setting turns it off).
  It acts **on release**: a pill follows the pull and says *Release to open the
  Task Board*, a buzz tells you it is armed, and nothing changes until both
  fingers are up. Two fingers on the list no longer tick or open the tasks under
  them (a second finger cancels a row's swipe, its long press and a carried card).
- **The back gesture goes back**: the board opens in your pane as a step of its
  history, so the phone's back closes it and returns to the note; a sheet, menu or
  quick-add field takes the first back and closes.
- **Moving between the board's columns is steadier**: the finger moves the strip,
  one column per swipe, with a buzz where it settles; each column keeps its own
  scroll; a tap that ends a swipe is ignored; the strip no longer depends on
  how a browser chains a sideways pan out of a column that scrolls up and down
  (newer engines drop it).
- **A swipe on a row can be taken back**: it buzzes once when it is far enough to
  count, and dragging back before letting go cancels it.
- **Quick add reads a line of words**: `call Sara tomorrow 9 #work !high` becomes
  a task for tomorrow at nine, tagged and urgent, with what was understood shown
  as chips under the field (each can be left as words). English and Persian;
  plans, reminders, deadlines, priorities and tags; Today, Tomorrow, a month to
  pick a day from, priority, tags and reminders as buttons that write into the
  line. A task with a day goes into that day's note. Adding keeps the sheet and
  the keyboard open for the next. The same reader as the Telegram bot's (a test
  reads 64,800 lines with both and compares).
- **Lighter rows**: a title and one calm line of small text, colour only for
  what is overdue, due today or urgent; **Row style › Chips** keeps the old look.
  A 24px circle with a 44px target.
- **A tap or a swipe that was not meant is forgiven**: a line at the foot says
  what happened, with **Undo**, and a short buzz where the phone has one.
- **A task's sheet leads with Today / Tomorrow / Next week / Pick a date…** and
  has **Done** as a large button at its foot.
- **The calendar's bar is two lines** instead of three, with a sheet for the rest;
  a swipe across the month turns the page; the calendar and the timeline now fill
  the screen down to the tab bar with the **+** floating over them, and what is
  written inside a frame keeps a 16px margin from it.
- **Accessibility**: names for everything (a checkbox is named for its task), a
  tab bar that is a real tab list, sheets that are modal (the board behind them
  is inert, Tab goes round inside, focus returns), spoken confirmations, a ring
  wherever the keyboard lands, targets of at least 24px with a bigger touch area,
  bars that grow with the text, `prefers-contrast` and forced colours, and
  `lang` set to the board's language. `test/mobile-a11y.mjs` sweeps every screen.
- The phone buttons keep their heights under themes that give every button one
  (Bookcloth).

### Telegram bot

- **A Telegram bot for your tasks and reminders**, backed by your own Supabase
  project (`supabase/`: migrations, three Edge Functions, a Persian setup guide).
  It works like a small app: a main menu, lists in sections (overdue, today,
  tomorrow, later, unplanned) set in quotes with filters and pages, and a card
  for each task, all edited in place, with coloured buttons.
- **Every setting of a task from Telegram**: title, status, priority, deadline,
  plan, reminder, tags and repeat, each a button that shows its value and opens
  its choices (presets, or a typed answer such as "every 3 days"). Add tasks in
  plain words; reminders arrive as a card with Done and Snooze.
- **Sync from the plugin**: a new **Telegram** settings tab and the **Sync
  Telegram now** command. The plugin uploads a snapshot of open tasks (now with
  how often each repeats) and applies queued changes to your notes, each exactly
  once, including a new `edit` change for the settings above.
- **Telegram's rich messages (Markdown)**: every screen is also written as a rich
  message: headings, the list as a task list with subtasks nested, a task's
  settings as a table, right to left for Persian. If Telegram or the client does
  not take it the classic message is sent; **Rich display** in the bot's settings
  switches it off. The task's screen and its settings are now one screen, reached
  by tapping the task, and a tab bar sits under the main screens. Short messages
  are widened so the buttons under them keep their room.
- **Full-width cards**: a short message is held at the width of a full card (a
  line of invisible characters, rich or classic), so the buttons under it are not
  wider than it; **Message width** in the bot's settings steps through none /
  narrow / medium / wide / widest. Filters are two to a row so no label is cut,
  titles count with a dash instead of a dot, and a subtask ratio reads "۱ از ۳".
- **All four statuses from Telegram**: open, in progress, done and *not done*
  (`[ ]` `[/]` `[x]` `[!]`), from the status menu or `/fail`, and a filter in the
  lists for what is in progress.
- **A calendar in the chat**: reminder, plan, deadline and "New task for a day"
  open a month as buttons (Jalali or Gregorian, Saturday first in Persian) with
  today, the current day and days that have tasks marked, then an hour grid and,
  for a plan, how long it lasts. Hours can still be typed.
- **Tasks made in Telegram go into their day's note** (the day of the plan, else
  the reminder, else the deadline, else today) instead of the inbox, through the
  same daily-note settings as the calendar.
- **Subtasks and numbering**: lists number tasks 1 to the end instead of by a
  hidden ID, a parent is followed by its subtasks with a count and a bar, and the
  card shows the family. The ID, used by typed commands, is shown on the card.
- **One double-click to update**: `update-bot.bat` redeploys the three functions;
  they bring the database up to date themselves on first use.
- **Your tags, listed**: the bot knows every tag you have used (open or finished
  tasks) and the tags you defined under **Settings → Tags**, with their names.
  `/tags` (and the 🏷 button on the menu) shows them with how many tasks are open
  under each; a tag opens its list of tasks or starts a new task already tagged.
  Wherever a tag is asked for (a task's tags, a new task) the known tags are
  buttons, so you tap instead of typing; typing still works. The plugin uploads
  the list with the snapshot, only when it changes.
- **MarkdownV2 throughout**: screens are sent as MarkdownV2 (bold labels, underlined
  headings, italic notes, quotes, an expandable quote for a long list of subtasks
  and the command list, code for ids). Every character Telegram reserves is
  escaped; a message Telegram still refuses falls back to HTML, then plain text.
  The converter has its own validator in the tests, and every screen the bot
  sends is checked against it.
- **An assistant that understands you** (Cloudflare Workers AI, the same service as
  Agenter; optional): say or write what you want in your own words, or send a **voice
  message** (read by Whisper), and the tasks are made on the right days. The model works
  through commands built for it — `add_task`, `update_task`, `set_status`, `delete_task`
  (only proposes; a button confirms) and `find_tasks` — and everything it sends is checked
  before it is done: a Jalali date is converted by code, a day that is not a day, a year
  that is a slip, an hour that cannot exist and a reminder in the past are left out and
  said so, and asking twice makes one task. What it makes is queued for your notes exactly
  as a task you typed is. The card shows each task with its day and hour in plain words,
  buttons to open them, **Undo**, and what was heard; the next sentence is read with what
  came before (for 30 minutes). With no keys set, or switched off in **Settings →
  Assistant**, the bot reads words the plain way as before, and does so too when
  Cloudflare cannot be reached. `/ai your words` calls it by name. Needs the secrets
  `CF_ACCOUNT_ID` and `CF_API_TOKEN` (see the setup guide).
- **A design pass from Telegram's own documentation** (Bot API 10.3): the plan and the
  reminder on a task's card are Telegram's **date entities** — our words stay (Jalali,
  «فردا ۰۹:۰۰»), a tap shows the exact moment on the reader's own clock, and beside
  them a **countdown** («in 20 minutes») that keeps counting, in the classic message,
  the rich message and the HTML fallback (a finished task keeps its date, loses the
  countdown). Italic next to underline is now kept apart the way the formatting notes
  say (an empty bold entity), not with a stray control character. Buttons that only
  hold a place (the page number, the blanks of a month) are **disabled buttons**.
  When the assistant gets a message, the message receives a 👀 at once, a **«Thinking…»
  placeholder** shows (Telegram's own, which is a plain text draft with no text; for a voice
  message it says what was heard), «typing…» is renewed while the model takes longer than the
  draft lasts, the answer hangs from the
  message it answers, and the message ends with 👌 (or 👍 for an answer in words, 🤔
  when something failed). Each of these falls back by itself on a Telegram that does
  not know it.
- **Messages the bot sends by itself** (the ticker, once a minute; **Settings → Notifications**
  sets each): a **morning summary** (what is planned, due and late today, and what to
  start with), an **evening review** (what is left, tomorrow's count, and one button that
  moves what is left to tomorrow at the same hours, its reminder with it), a **nudge the
  evening before a deadline** (or the morning of it) listing what is due, and a **reminder that
  comes again** every ten minutes up to three times until the task is ticked or snoozed.
  Everything is written down before it is sent, so nothing goes out twice, and without a
  place to write it down nothing goes out at all.
- **The overview, as a week or a day** (one screen with a **Day | Week** switch): `/overview`
  (and the menu's button; `/week` still opens it) shows the **week day by day** in clean Markdown:
  each day has a heading with how many tasks it holds in brackets and lists them in the order of
  the day, tasks with no hour included (a deadline marked ⏳, a reminder-only task 🔔); no table.
  A crowded day shows six and points to its own screen. `/day` shows one day with a button for
  each task. Under both, the late ones and those with no plan are a tap away, counted in brackets.
  **The days and weeks around the one shown are named by their dates** («چهارشنبه ۱۵»,
  «۲۵ مهر – ۱ آبان»), never «tomorrow» or «yesterday», which stop making sense a few steps from
  today; a button goes back to today / this week.
- **Counts in brackets** on the filters and the menu: «امروز (۳)», «بدون برنامه (۵)», «عقب‌افتاده (۱)».
- **Only for one user**: set the `ALLOWED_USER_ID` secret to a Telegram id (`/id` shows yours) and
  everyone else is ignored completely, including at pairing; a value that is not a number answers
  nobody.
- **Plan my day** (`/planday`, a button on Today and in the morning summary): the assistant
  fits the tasks that have no plan, or are late, into the free hours, leaving alone what already
  has an hour. It **shows its plan first** and does nothing until you tap Apply; **Settings →
  Notifications → Assistant confirmation** chooses between always showing first, only for big jobs
  (more than four changes: the default) and never. The preview is the commands run on a copy of
  your tasks, and Apply runs the same commands again on the real ones.
- **Subtasks from Telegram**: a card has **Add a subtask**, and the assistant breaks a task into
  steps (`parent_n`). The plugin writes each under its task, indented, in that task's note.
- **Edits reach the bot when you stop typing**: a few seconds after the notes stop changing
  (set in the Telegram settings; 4 seconds by default, and at least once a minute while you keep
  going) instead of after a fixed 20 seconds, and an edit made while a sync is running is sent right
  after it. What you ask for in Telegram can be fetched as often as every 30 seconds.
- Notes remain the source of truth; the tables are locked to the service role and
  the bot answers only the chat it was paired with.

### Remind on a date

- **Remind me → On a date…** sets a reminder for a specific day and time,
  written as `@remind(YYYY-MM-DD HH:MM)`. It needs no plan, shows as a bell chip
  with the day and time, and is announced once.

### Calendar

- The task board has a third layout, **Calendar**, next to Table and Board,
  also opened with **Open Task Calendar**. It has four views: **Month**,
  **Week**, **Day** and **Agenda** (the next 14 days as a list). Switch views
  with `M` `W` `D` `A`, go to today with `T`, step with the arrow keys, and add
  a task with `N`. The keys go by position, so a Persian keyboard layout works
  too.
- **Gregorian or Jalali**, switched from the calendar's bar, with the other
  calendar's date shown small on every day. A Jalali week starts on Saturday
  and has Friday as its weekend; a Gregorian week starts on Monday and has
  Saturday and Sunday. The start can be changed in settings. In Persian the
  calendar reads right to left.
- **Plan a block of time**: drag across the week or day grid, or click a slot.
  The card that opens creates a new task there, or plans one of the tasks you
  already have.
- **Drag to reschedule**: move a block to another hour or day, drag its edge to
  change its length, drop it on the all-day row to keep only the day, or drop
  it on the **Unscheduled** sidebar to unplan it. The sidebar lists open tasks
  with no plan, ready to be dragged onto the calendar. `Esc` cancels a drag.
- **Click a task** to open its card: rename it, change its day and time, set
  its status, priority, deadline and tags, open its note, or remove it from
  the calendar.
- Deadlines show as outlined flags on their day. Dragging one plans it and
  leaves the deadline alone. Deadlines, daily-note tasks and done tasks can
  each be hidden from the options menu.
- Times are typed rather than picked, so they follow TaskPro's clock setting
  (24- or 12-hour) and not the computer's locale. `9`, `930`, `2:30 pm`,
  `21:30` and Persian digits are all understood, and the arrow keys step by
  the grid's snap.

### Subtasks on the calendar

- A task nested under another is shown as part of its family. A subtask with
  no tag takes its parent's colour, a tall enough block names its parent, and
  hovering one member rings the others on screen.
- **Unscheduled** shows each family as a tree: the parent with a toggle and
  a done count, and its subtasks under it on a guide line, in note order. A
  planned parent stays in the list, muted, to hold its open subtasks.
- A parent's card lists its subtasks, with when each is planned, and adds new
  ones from an **Add a subtask** field. A subtask's card links to its parent.
- The board's task index records each task's parent, from the note's list
  structure. A plain bullet between the two keeps the link, and a paragraph at
  the margin ends it.

### The task menu

- Right-click a task on the calendar, a table row or a kanban card, or press
  its **⋯**, for a Notion-like menu. It has the status, priority, tags,
  deadline, plan, repeat and progress, each showing its value and offering
  choices in a submenu. It also has **Add a subtask**, **Duplicate**, and the
  chip menu for the timer and sync.
- Type to search every action at any depth (`high` finds **Priority ›
  High**). The arrow keys, `Enter` and `Esc` work throughout, mirrored in
  Persian.
- A right click on an empty slot offers a task at that time, the day's note,
  or the day view.
- The task card is laid out like a Notion page: parent, title, then one row
  per property (when, status, priority, deadline, repeat, tags, note), name on
  one side and value on the other, then subtasks. Each value is edited in
  place or from a dropdown under it, and an empty one says so.
- **Tags** in the menu has a submenu listing every tag, ticked when the task
  has it.
- A click on an empty slot shows the block a task there would be, faint and
  dashed, with a **+** and the time at its start, always at the start of the
  lane and not where the pointer was; the picker opens when that block is
  clicked. Dragging across the grid still opens it at once. The word beside the
  time leaves when the lane is too narrow for it.
- One panel at a time: opening a card closes the menu, and the menu (a right
  click, or a card's **⋯**) closes the card, so neither covers the other.
- A design pass over the calendar:
  - Every floating panel shares one hairline edge, a soft shadow (deeper in
    dark mode) and a panel radius, with tighter corners inside.
  - Hover states fade in, a keyboard focus is always visible, and buttons
    give a little on press.
  - Key caps use the monospace font.
  - A subtask with no plan shows a plan button on hover instead of
    repeating "Not planned yet".
  - A Latin title on a Persian board, or the other way round, sits next to
    its checkbox instead of drifting to the far side. Blocks of an hour and a half or more show their
  priority, repeat, deadline and tags when there is room. The lines a block
  gives its title are worked out from its height, so nothing is cut through
  the middle.

### Table and board columns

- The table has a **Plan** column: the day in a chip and the hours beside it
  ("Today · 14:00 – 15:30"), so a task's time is on the board, not only on the
  calendar. Cards show the plan the way the chip in a note does. Sort by plan
  puts the earliest first.
- Columns move, resize, and come and go. Drag a header to move its column
  (a line shows where it lands; `Escape` cancels), drag its edge to resize it
  and double-click the edge to reset it, or right-click the header to sort,
  move, reset its width or hide it. `Alt` with the arrow keys moves a focused
  header. The **+** at the end of the header row and **Properties** in the
  toolbar list every property with a switch and a grip to drag it into order,
  and stay open while you switch several; **Reset to default** undoes it all.
  **Repeat** is a column that starts hidden.
- On the board, **Properties** picks what a card shows and in what order,
  status and repeat included.
- The board's columns move by dragging their headers, and share one width
  that dragging any column's edge changes. A column's **⋯** menu (or a right
  click on its header) moves or hides it and resets the width or the order.
  Hidden columns are listed at the end of the board, where a click brings one
  back; grouped by tag, **New tag** there adds a column.
- A status, priority, deadline, plan or repeat cell opens the same menu as
  the task menu's submenu, right under the cell.
- All of it is remembered per board, and mirrored in Persian: a column's edge
  is on its left there, and "move right" moves it earlier.

### Deleting a task

- **Delete** in the task menu, at the foot of a card, or the `Delete` key on
  a focused calendar task removes the task from its note, with everything
  nested under it. The label says when subtasks go with it. A notice offers
  **Undo**, which puts the lines back exactly.

### Properties with `@`

- On a task line, `@` lists priorities, deadlines, plans, repeats, tags and
  statuses, filtered as you type (`@high`, `@tomorrow`, `@weekly`, a tag's
  name). Choosing one writes the canonical marker, replacing one already
  there, and removes the typed word. There is a switch under Badges.

### Plans

- A plan is stored in the task line as `@schedule(2026-09-28 09:30-11:00)`, or
  `@schedule(2026-09-28)` for a whole day. It is shown as a pink chip in Live
  Preview and Reading View (**Show Plan Badges** under Badges), and the chip
  turns grey when the day has passed with the task still open.
- **Plan Current Task…** and **Plan a Time… / Change Plan… / Remove from
  Calendar** in the task menu set the plan from a note.
- A plan belongs to one copy of a task. It is not synced to a linked source,
  and importing a task leaves the plan behind. A repeating task moves its plan
  forward with the same time of day. A task that has a plan but no deadline
  repeats by the plan and is not given a deadline.

### Daily notes

- Every day can have its own note, named after its date: in English while the
  Gregorian calendar is showing, and in Persian while the Jalali one is (or
  always one of the two). A task created on a day goes into that day's note,
  under a heading of your choice. A note that does not exist yet is created
  from your template in one write, with the task already in it.
- Tasks written in a day's note appear on that day without a plan.
- A new **Calendar** settings tab holds the folder, a Gregorian and a Jalali
  name format (moment-style tokens plus `jYYYY`, `jMM`, `jDD`, `jMMMM`; text in
  `[brackets]` is kept as it is; a `/` makes subfolders), the naming calendar,
  the template, the task heading, a live preview of today's path, and a button
  that copies Obsidian's own Daily notes settings.
- Templates can use `{{title}}`, `{{date}}`, `{{date:FORMAT}}`, `{{time}}`,
  `{{weekday}}`, `{{gregorian}}`, `{{jalali}}`, `{{yesterday}}` and
  `{{tomorrow}}`. Templater commands run too.
- Both calendars' names are checked before a note is created, so a day never
  gets two notes. **Open Today's Daily Note** opens or creates today's note.

### Subtask progress

- A parent task with no progress bar of its own shows how many of its direct
  subtasks are done, as a `2/4` chip in Live Preview and Reading View and in
  the board's **Progress** column. It fills in as they are ticked off.
  **Show Subtask Progress** under Badges turns it off.

### Waiting on another task

- **Waiting on › Wait on a task…** in the task menu makes a task wait on
  others, found by searching. It writes `@waiting([[Note#^id]], …)` into the
  line: ordinary block links, so they follow renames and show in backlinks.
  A task waited on gets a block ID the first time.
- In a note the marker is a chip with an hourglass naming the task, or *2
  tasks* with the names in its tooltip, and a click opens it. Once all of
  them are done it shows a double tick. **Show Waiting Badges** under Badges
  turns it off.
- The menu lists what a task waits on, each with **Stop waiting**, and the
  tasks waiting on it. A task cannot wait on itself or on anything that
  waits on it.
- The board has a **Waiting on** column, and a waiting task shows an
  hourglass beside its title.

### A reminder before a plan starts

- A task planned for a time of day gets a notice 10 minutes before it
  starts: *Starts in 8 minutes*, the task and its plan, with **Done**,
  **Snooze 5 min** and **Open**. A chime and a system notification go with
  it. **How Early** and both switches are under **Remind Before a Plan
  Starts** in the Reminders tab.
- **Remind me** in the task menu gives one task its own time, from the start
  to an hour before, or none: `@remind(15m)`, `@remind(off)`. A bell on the
  plan chip shows it.
- Whole-day plans and done tasks are skipped. A plan is announced once, even
  across a restart, and one that came due while Obsidian was closed is still
  announced up to 10 minutes after its start.
- **Remind me › On a date…** asks for a day (Gregorian or Jalali) and a time
  and reminds you at that moment, planned or not: `@remind(2026-10-05 09:30)`.
  It replaces the reminder before the plan. The notice reads *Reminder*, and
  the line shows a bell chip with the day and time, grey once it has passed.
  The row is in the card and in the plan's menu for any task, not only one
  with a time of day.

### Timeline

- The board's fourth layout lays tasks out as bars from their plan to their
  deadline, as a Gantt chart does. A task with only a deadline is a diamond,
  and a parent's family is spanned by a bracket over its subtasks.
- Drag a bar to move the task (plan and deadline together, keeping the time
  of day), its start to change the plan, or its end to change or set the
  deadline. A label shows the dates the bar will get. A click opens the task
  menu.
- **Days**, **Weeks** and **Months** zoom the scale, **Earlier**, **Later**
  and **Today** move along it, and the dates are Gregorian or Jalali.
- Arrows join a task to what it waits on, leaving the bar by its top or
  bottom so they pass behind other bars rather than through their names, and
  turn red when the task waited on is planned to end after the other starts.
  A waiting task's bar is hatched. A deadline before the plan is flagged.
- Tasks with no dates are folded under the chart. Open them and click a day
  in a row to plan that task for that day.
- In Persian the chart runs right to left, and so do drags.

### On a phone

- On a phone, and in any pane under 640px wide, the board is laid out for a
  thumb, and nothing is taken away:
  - Menus, task cards and pickers are bottom sheets, with a handle to swipe
    them down and the board dimmed behind. A submenu slides in as a page with
    a back button.
  - A round **+** button adds a task.
  - The table is a list of two-line rows with the properties as chips.
    Swiping a row ticks it off or opens its sheet. **Table style** brings the
    full table back.
  - The board shows a column at a time, with tabs to jump between them.
  - The calendar's week shows three days from today and scrolls through the
    rest, and the month is a grid of dots over the chosen day's tasks.
  - The timeline's rows are 44px high.
- A long press is the right click. On a touch screen, cards, blocks and bars
  are dragged after being held for a moment, so a quick swipe still scrolls.
- Every control is at least 44px. The board keeps clear of the home
  indicator and of Obsidian's floating bar, which it reads from
  `--view-bottom-spacing`.
- A theme that sizes every button without an icon on a phone no longer
  stretches a task's circle into an oval or a day's number into a pill.
  Bookcloth sets 40px there.

### A design pass

The board, the calendar, the timeline and the menus were gone over one view at
a time, against Notion's own, and share one set of radii, shadows, easing and
focus rings now.

- **The layout switch is a row of tabs.** A hairline runs under the toolbar and
  the current tab sits on it with a 2px bar; the others are plain text with a
  soft fill under the pointer. The search field has no box until you use it.
  The Planner / Whole vault switch shows only when a target folder is set.
- **Status is a capsule**; tags, priorities and dates stay rounded rectangles,
  so the property people read first has a shape of its own. The capsule follows
  the chip radius setting (eight times over), so squaring the chips squares it
  too. It applies in notes as well.
- **Table:** tighter rows and faint column lines; a **New** row ends every
  group and adds a task with that group's status, priority or tag (one at the
  end of the table when it is grouped any other way); the check and the title
  stay in view when the properties are scrolled sideways; a row's **Open** and
  a card's **⋯** appear on hover as small raised buttons. Group names stay put
  while the table scrolls. The Plan column starts wider (228px) so a day and its
  hours stay on one line.
- **Board:** a column's **New** is aligned to the start, and a column's
  header chip is a capsule tinted like its column.
- **Calendar:** the time it is stands in the gutter, on the now line's height,
  in the same red as today's number; the hour mark it would cover is hidden
  while it is there.
- **Timeline:** today's line starts with a dot under the number, and
  dependency arrows have rounded corners.
- **Menus:** a menu's search is a line under the title rather than a boxed
  field (a filled field on a phone, where there is something to aim at).
- **Empty and loading states** are composed rather than bare: an icon, a line
  of text, and for a search that finds nothing a **Clear search and filters**
  button. The board shows skeleton rows while it loads.
- **Reduced motion:** with the system setting on, nothing in TaskPro slides,
  fades or pulses.
- Style Settings defaults were re-tuned: a chip's fill is 15% of its accent, its
  stroke 16% (was 32%) and its label takes 40% of the accent (was 78%), so
  the text is nearer the theme's own; the chip corner radius is 6px (was 12px)
  and the panel radius 12px (was 10px). A setting you have changed keeps its
  value.

### Room to breathe

- A month cell clips what does not fit, and the ring that marks a hovered
  task's family (like a keyboard focus ring) is drawn outside its chip, so a
  lit chip lost its sides at the edge of the list. Every gap, padding and
  margin now comes from one scale of space tokens (`--taskpro-space-1` to
  `-8`: 2, 4, 6, 8, 10, 12, 16 and 24px), and a box that clips its children
  pads itself by the halo token (`--taskpro-halo`, 4px) and leans out by as
  much. Children stand where they did, and the clip edge is a halo further
  out. Where a box has no room to spare (the table's **New** row) the ring is
  drawn inside instead.
- `test/clip-guard.mjs` walks every view of the board, the calendar and the
  timeline, in both directions of writing, and fails on any ring that an
  ancestor cuts. It failed on the old styles.

### Motion

Each animation says what just happened. Only opacity and transform move.

- Changing the layout, the grouping or a filter brings the new view in. The
  calendar and the timeline turn a page toward the day they are heading to,
  and the bar under the layout tabs travels to the tab you chose.
- A task you just added, or whose status just changed, flashes where it lands,
  and its check pops. Opening a group lets its rows follow one another in. The
  timeline's bars grow from their start, and a lit family fades up instead of
  blinking on.
- The board decides what plays. A redraw for any other reason (a search, a
  note changing under it) plays nothing, and a reload or an import that brings
  in a crowd of tasks at once does not flash them all.
- With reduced motion set in the system, none of it plays.

### Finding tasks and moving them

- **Filter** is the board's own searchable menu now (a popover on a desktop, a
  sheet on a phone). Besides status, priority and tag it filters by
  **Deadline** (overdue, today, next 7 days, later, past, none), **Plan**
  (missed, today, next 7 days, later, past, not planned) and **Note**. Each
  active filter is a pill, and **Clear filters** takes them all off.
- Tasks can be **grouped by plan**, as they can by deadline.
- The task menu has **Copy link**, which copies a `[[Note#^id]]` block link
  (writing the ID into the line when the task has none), and **Move to note…**,
  a searchable list of every note in the vault: the inbox first, then the notes
  beside the task's own, then the ones that hold tasks.
  - A move takes the task with everything nested under it, sets it down at the
    left edge of the other note, and swaps a block ID the other note already
    uses for a new one.
  - What TaskPro keeps about a task outside its line goes with it: its progress
    bar, its timer, and the sync mapping between a copy and its source.
  - The links that say a task waits on another are rewritten, both on the tasks
    that moved and on the tasks elsewhere that wait on them.
  - A note that cannot be written to gets the task back exactly where it was.

### The card, from every layout

- The card the calendar opens (a row for each property, then the subtasks with
  a row to add one) opens from the table, the board and the timeline too, so a
  task looks the same whichever layout it is opened from. **Open card** is the
  first row of the task menu in every layout and on the phone's sheet. A table
  row shows an **Open** button on hover beside the one for its note, a board
  card shows one beside its **⋯**, and a click on the card's own space opens it
  as well.
- The card follows the notes as they change, and closes with its task.

### View options

- **Properties → View** sets how much room a view takes. **Density** (compact,
  comfortable or spacious) sizes the table's rows and the board's cards through
  tokens on the board's root. **Wrap titles** lets a title in the table run
  over as many lines as it needs. **Hide empty columns** leaves out the
  columns of a board that have nothing in them, without listing them as hidden
  ones. A finger keeps its 44px whatever the density.

### Keyboard

- The table and the board take the arrow keys (and `J` and `K`) to move a
  cursor through the tasks; `←` and `→` go between a board's columns (mirrored
  in Persian) and `Home` and `End` go to the ends. On the task under the cursor:
  `Enter` opens the card, `Space` ticks it off and back, `E` renames it, `M`
  opens its menu, `Delete` removes it and `Ctrl`/`⌘` with `Enter` opens its
  note. `N` goes to the new-task field and `/` to the search.
- `?`, or the keyboard button in the header, opens a sheet that lists them all.
- Letters are read from the physical key, so they work on a Persian layout as
  they do on a Latin one.
- Menus, cards and inline edits give the focus back when they close, so the
  keys carry on where they were. The cursor is shown while the board has the
  focus, and never slides the table sideways.

### Sub-items

- In the table a subtask sits one step in under its parent, whatever the
  grouping. Only what is on the screen counts: a subtask whose parent is
  filtered out, or in another group, stands at the edge instead of hanging under
  nothing.
- A parent shows how many subtasks it has after its title; a click folds them
  away and brings them back, and the fold is kept. `←` and `→` do the same from
  the keyboard, and `←` on a subtask steps up to its parent.

### Selecting several tasks

- A square in a row's margin, and on the corner of a card, picks it. `Ctrl` or
  `⌘` with a click picks one more and `Shift` with a click picks a range. `X`,
  `Shift` with the arrows and `Ctrl`/`⌘` with `A` do the same from the keyboard,
  and **Select** in the task menu starts a selection; on a phone, taps then
  carry it on. Picked tasks are tinted, and stay picked while the notes change
  under them. `Esc` drops the selection before anything under it.
- A bar rises over the board with what can be done to all of them: status,
  priority, tags, deadline, plan, moving them to a note, deleting them. Its menus
  are a single task's, built by the same code from a stand-in task that has only
  what all the picked share (so a status they all have is ticked), and each
  choice is applied to every task in turn.
- A move or a delete takes a parent's subtasks with it once, even when they are
  picked too. Deleting several puts up one notice whose **Undo** puts every one
  back where it was.
- On a phone the bar rises above Obsidian's floating bar and shows icons and
  the count alone, so all of it fits the width.

### Saved views

- **Views** in the toolbar (a page of the options sheet on a phone) lists the
  views you have saved, saves the board as it is now, and puts a saved one
  back. A view holds what makes the board look as it does: the layout,
  grouping, sort, filters, properties and density, and the calendar's and the
  timeline's options. It leaves out the search, the groups and parents you
  folded, and the note new tasks go into.
- Applying a view sets every one of those, to the view's value or to the
  default, so it means the same board whatever it was applied over. The button
  shows the view's name, with a dot once the board has been changed since;
  **Update** takes the change into the view. Views can be renamed, duplicated
  and deleted, and **Default view** puts everything back.

### The task card and the calendar's blocks

- The card is roomier (384px) with a larger title, fields of one height and one corner, and **All day** as a switch on a line of its own instead of the system checkbox. Its footer actions are buttons with room to be pressed, and its subtasks rows are a little taller.
- A calendar block is a soft fill of the item's colour with a bar at its start, not an outline; the title leads and the time steps back. A done task rests: its colour fades, its title is struck through. A lit family is told by a soft ring drawn inside the block.

### Fixes
- A task's checkbox is a square with soft corners now (`--taskpro-check-radius`), not a circle, in the table, the board, the calendar and the card.
- In the status capsule the icon sits level with the letters and set in from the capsule's end, instead of low and close to the edge.
- The task card's header is tidier: the checkbox, the title's first line and the two tools share one centre line, and the date field no longer runs past the card's edge.
- Turning the plugin off right after it started could leave the plan-reminder ticker running, announcing every reminder twice. The ticker now stays off once the plugin has been unloaded.
- Subtasks in the unscheduled list have a gap between their boxes, so the tint of a lit family does not run together.

- A task added under a heading is laid out the Markdown way: a blank line
  under the heading, joined to the list already there, and a blank line
  before the next heading. A task added to the end of a note after a
  paragraph starts a new list one line down.
- The settings tab:
  - Every icon is 16px in a square box.
  - A section's icon sits in a small badge, with the title and its
    description beside it (Obsidian's own `h3` padding had pushed them out
    of line).
  - The tabs lost Obsidian's button chrome.
  - Tag colour dots stay round.
  - The reference note shows beside its button rather than below the row.
- Persian and Latin text side by side kept its pieces out of order: a time
  range read `14:15 – 13:15`, and `Esc` sat between two Persian words in the
  picker. Times are held left to right, note names and titles dropped into a
  sentence are isolated, and the picker's keys are shown as key caps. This
  applies to notices and tag and timer messages too.
- The block a drag across the grid draws now has the same shape and place as
  the block it becomes.
- A repeat rule set on one of two identical task lines could land on the
  first. It now goes to the line it was set on.
- The first `Esc` in a card or menu over the floating board closed the board
  too, because Obsidian's keymap handles keys before the page does. Cards,
  drags and TaskPro panels now push a keymap scope of their own, so `Esc`
  closes the innermost one only.
- Reading View showed `[/]` and `[!]` tasks as done, because Obsidian ticks the
  checkbox for any marker that is not a space. The marker is now read first.
- Opening a task's note from the floating board now closes the board, so the
  note is not hidden behind it.
- In Reading View a parent task read its markers from its subtasks' lines as
  well, and hid theirs before they were read. A subtask's plan chip went
  missing, and a parent could pick up a subtask's priority or block ID. Its
  chips also landed under its subtasks. Each task now reads and hides only
  its own line, and its chips sit on that line.
- The calendar's header was only as wide as the screen. When a week wider
  than the screen was scrolled sideways, blocks showed through the part left
  uncovered.
- Chips did not follow the theme in Obsidian: Obsidian keeps a theme's colours
  and text sizes on `<body>`, and the plugin's derived colours were declared
  on `:root`, above them, so a tag's green was a fallback rather than the
  theme's. They are declared on `<body>` now (and Style Settings, which
  writes there, still wins).
- A block or a timeline bar dropped where the pointer was let go could land a
  step from it, because the last move event had not been applied. The
  pointer-up position is applied first now, in the table, the board, the
  calendar and the timeline.
- Holding a block against the edge of the calendar scrolled the grid at once,
  which could move a block an hour or more by itself. The grid now scrolls
  only after the pointer has rested at the edge for a moment.
- A field in a Persian board took the wrong side for its placeholder while it
  was empty (an empty field has no text to take a direction from). Empty
  fields now rest in the board's direction and follow what is typed.
- Closing a column's or a group's **New** field with `Esc` after adding a task
  raised an error in the console, because taking the field out of the page
  blurred it and asked to close it again.
- In the floating board a right click's menu stayed open when you clicked
  elsewhere, because every press in it counted as a press on another window
  the menu had raised. Only another modal counts now.
- On a phone, swiping the board within a moment of tapping a column's tab could
  be pulled back to that column. The tab's scroll now lets go once a hand is on
  the board.

### Under the hood

- Dates are `YYYY-MM-DD` keys counted in UTC, so daylight saving never shifts
  a day. The Jalali calendar is only a way of reading them, and a note always
  stores the Gregorian date.
- The calendar reads the same task index as the board. A day's note is found
  by computing its path from the date, not by searching the vault.
- Overlapping blocks share a day's column in lanes. Rendering is held while a
  drag or a card is open, so a note change never redraws the calendar under the
  pointer.
- Tests: `test/calendar.mjs` covers the date arithmetic in both calendars, the
  name formats, templates, heading insertion and the lane layout.
  `test/plugin-edits.mjs` covers daily notes, plans, sync and rolling forward.
  `npm run test:ui` now also drags through the calendar in Chromium.
- `test/relations.mjs` covers subtask counts, `@waiting` links and how they
  resolve, cycles, when a plan's reminder is due, and the timeline's rows,
  spans and lateness. `test/mobile-interactions.mjs` runs the phone layout
  with touch input: sheets, swipes, long presses, holding to drag, and the
  three-day week. `test/reading-mode.mjs` runs the Reading View processor
  over a nested list.
- The look is built from tokens declared once on `<body>`: a radius scale
  (chip, control, inner, card, panel, column, sheet), shared ring and lift
  shadows tinted from the page colour, easing and three durations, and a focus
  ring. `test/obsidian-theme.css` declares the theme's variables on `<body>`
  too, so the harness would catch a rule that stops following the theme.
- `ui/motion.ts` decides which elements play an entrance (`enter`, `stagger`)
  and which tasks just arrived or changed (`ChangeTracker`); the animations
  themselves are CSS, gathered in one section of `styles.css` that a reduced
  motion setting switches off. The UI tests open pages with reduced motion
  asked for, so nothing is mid-flight when they take coordinates; the motion
  tests open live pages.
- The pieces that decide are pure and tested without a page: `board-keys.ts`
  (where the cursor goes), `board-nesting.ts` (which tasks nest under which),
  `board-views.ts` (what a saved view holds and when it counts as changed) and
  `task-move.ts` (cutting a block out of one note and setting it down in
  another, and the links that follow it). `test/plugin-edits.mjs` moves tasks
  through the whole plugin on an in-memory Obsidian, including a colliding block
  ID with tasks waiting on it, a note that refuses the write, and a bulk delete
  with its Undo.
- What the board asks of the plugin gained `blockLink`, `notes`, `moveTask` and
  `deleteTasks`; the harness answers them with stand-ins, so the menu, the
  card and the bar of a selection are tested in Chromium as they are drawn in
  Obsidian.
- The UI tests believe it is 15:00 (a fixed clock), so a test that takes its
  coordinates from the calendar does not depend on the time of day. New
  checks cover the tabs, the capsule, the theme's colour on a tag, the New
  rows, the frozen columns, the empty state's action, reduced motion, the
  scope switch and the now label.

## 1.4.0 - Your own tags, and a board of every task

1.3.0 was never published as a release, so its changes (below) ship in this
version too.

### Tags

- Create tags with a **name and a colour**, and give any number of them to a
  task. They show as chips next to the task's other chips, nearest the text, in
  the order the note lists them.
- A note stores only the tag's key, as `@tag(work, deep-work)`, hidden behind
  the chips while they are on. Renaming or recolouring a tag is a settings
  change and shows on every task at once, in Live Preview and Reading View.
  Keys accept any script, including Persian with its zero-width non-joiner.
- Colours are the theme's own palette (`--color-red` … `--color-pink`, plus
  grey) or a custom hex. `npm run check:contrast` now measures every palette
  colour as a chip label: all nine pass WCAG AA in both modes on every theme
  checked.
- **Tag picker**, from the status chip's menu (**Add Tags** / **Edit Tags**), a
  tag chip, the board, or **Set Tags on Current Task**: filter as you type,
  arrow keys and `Enter` to toggle, `Backspace` on an empty field to drop the
  last tag, and a **Create** row with a colour for a name that does not exist
  yet.
- **Tag manager**, under a new **Tags** settings tab, from the board, or with
  **Manage Tags**: rename, recolour, usage counts, and delete with or without
  removing the marker from every note. A key nobody has defined shows as a
  dashed grey chip rather than disappearing.
- Tags are copied into an imported task and synced from a linked copy to its
  source, like the other markers. A tag never changes a task's identity, so it
  does not break sync, the creation index, or the reminder age filter.

### Task board

- A new view, **Open Task Board** (and a ribbon icon), listing every task in the
  **whole vault or only the target folder**, as a **table** or a **kanban
  board**.
- Group by status, tag, priority, deadline or note; sort from the column
  headers; filter by status, priority and tag; search titles, tag names and
  notes. Groups fold, and the layout, grouping, sort and filters are remembered.
- Edit in place: tick off, status and priority menus, deadline picker, tag
  picker, and click-to-rename that keeps every marker and the block ID. On the
  board, drag a card to another column to change its status, priority or tag.
  The **⋯** button opens the full task menu; **↗** opens the note at the task.
- Quick add, from the top row or a column's **New** button, into a note you
  choose. A new task takes on the active filters or its column, so it stays in
  view.
- Right-to-left in Persian, with the same labels as the rest of the plugin.
- Built to stay quick: task-free notes are skipped using the metadata cache,
  only real task list items are parsed, a changed note is re-parsed from the
  content Obsidian already holds, and long groups are drawn 150 rows at a time.

### Floating board

- **Toggle Floating Task Board** (`Ctrl/Cmd+Shift+B`) opens the board as a
  large floating window over the whole app, from anywhere. The same keys close
  it, as does `Esc`, and search has focus on open. A header button sends it
  back to a tab, and the tab's header can float it.
- While it is open, `<body>` carries `taskpro-board-is-floating` and the modal
  container `taskpro-board-float`, so a theme can blur the app behind it. The
  plugin itself only dims. Bookcloth 3.8.0 blurs.

### The board under a theme

Seen in a real vault on Bookcloth, and reproduced in Obsidian 1.13.7:

- A done task's round checkbox became a large green square. The theme sizes
  any `<button>` with an `<svg>` inside as a 28px icon button and forces the
  icon to 18px with `!important`, and a theme's rules win ties because its
  stylesheet loads after a plugin's. The tick and the cross are now CSS masks,
  so there is no icon for that rule to find.
- The quick-add field drew a box inside its own dashed box, and every board
  control inherited the theme's generic button and input styling. The board's
  rules are now scoped one class above those, and coloured states (checkbox
  fills, the active layout tab, tag pills) are background images that a
  theme's hover colour cannot replace.
- Cards showed the ↗ button meant for table rows; cards open their note from
  the note link in their footer.
- Note columns repeated the full folder path in every header. A header now
  names the note and, only when it differs from the target folder, its parent
  folder; the path is the tooltip.
- A deadline cell cut its date off (`405/07/08`) and the long "Not completed on
  time" chip overflowed. The date wraps under the chip, a missed deadline says
  *Overdue*, a met one shows its date, and a chip that still does not fit
  ends in an ellipsis instead of running past its cell.
- "Choose the note new tasks go into" was the quick-add button's label; it is
  its tooltip now, and the label is *Choose note*.

### Under the hood

- The chip menu, the board and the commands now edit a task through one path.
  It takes a line-number hint when the line is unchanged, which also tells two
  identical task lines apart, and falls back to block ID and text otherwise.
  Renaming a task moves its sync mapping and cached block ID with it.
- Every place that stripped TaskPro's markers (sync matching, the creation
  index, titles, the import parser) now uses one helper, so a new marker can
  no longer be missed in one of five copies.
- The deadline picker is shared by the chip menu and the board, and switching
  it between Jalali and Gregorian now converts the date already typed.
- TaskPro panels take an `onClose` hook, so Escape or a click outside is
  reported as a cancel.
- Tests: tag markers and the tag list (`test/tags.mjs`), board parsing,
  filtering, sorting and grouping (`test/board.mjs`), and an integration test
  that loads the whole plugin against an in-memory vault
  (`test/plugin-edits.mjs`), all in `npm test`. `npm run test:ui` clicks
  through the real board in Chromium.
- `test/board-preview.html` renders the board, tag picker, tag manager and tag
  chips from the plugin's own classes, for the README images and the contrast
  check.

## 1.3.0 - Chips that follow your theme, and a reminder alert that is not sluggish

### Chips adapt to any theme, in both modes

The chip palette was 87 hardcoded colours: pastel backgrounds with fixed dark
text, designed for a light vault. On a dark theme they sat on top of the note
like stickers, and on a community theme with its own palette they matched
nothing. Completed tasks made it worse, because Obsidian dims the whole line and
the chip's own `opacity: 0.86` dimmed it again.

- Every chip is now a tint of **one accent colour taken from the active theme**
  (`--color-green`, `--color-red`, `--color-blue` and friends). There is no
  fixed colour left in the stylesheet — only `var(--…, #fallback)` pairs for
  themes too old to define the standard palette.
- One recipe does the work: tint a background and a border out of the accent,
  and mix the label toward `--text-normal`. That last part is what makes a
  single declaration work in both modes — the label lightens on a dark theme and
  darkens on a light one, because that is where the theme's text colour is.
- Dropped the chip-wide `opacity`, which faded labels along with everything
  else. Emphasis now comes from the hover fill.
- `--text-faint` is no longer used as a chip accent; it is designed to be too
  quiet to read.
- Added `npm run check:contrast`, which measures every chip variant against
  WCAG AA on every theme in `test/themes/`. All 27 variants pass on Obsidian's
  defaults and on a community theme, in both modes; worst case 4.6:1. The two
  mix amounts in the stylesheet were tuned against it rather than by eye.
- Style Settings now exposes the twelve accents and the three tint strengths,
  replacing knobs for variables that no longer exist.

### Custom task statuses

- Fixed the `[!]` checkbox, which lost its fill in this release's palette
  rewrite: the rule still pointed at `--taskpro-status-notdone-color`, one of
  the variables that rewrite deleted.
- Its glyph is now a mask rather than the text character `"!"`. A text glyph
  only works if nothing else is drawing that pseudo-element, and a theme that
  styles these states usually is — the theme's own `mask-image` stayed in force
  and clipped the character down to a speck inside an empty box. A mask
  composes instead of competing, and matches how Obsidian draws its checkmark.
- Both states take their colour from `--color-blue` / `--color-red` instead of
  `--text-accent` and a fixed red, and carry no `!important`, so a theme that
  styles `[/]` or `[!]` takes over with an ordinary rule.
- `test/chips-preview.html` covers all three DOM shapes Obsidian uses for these
  states, plus the two classes the plugin adds in Reading View.

### The reminder alert

- Removed `backdrop-filter: blur()` from the reminder overlay and the shared
  dialog panel. Both cover the whole window, so the compositor was snapshotting
  and re-blurring the entire vault behind them — on every frame of the fade-in,
  and again on any repaint above: a hover, a focus ring, the one-second
  strict-mode countdown, or scrolling a list of twenty-odd tasks. That is what
  made the alert feel slow. They dim instead, which costs one flat fill.
- Added `contain` and `overscroll-behavior` to both dialogs so a repaint or a
  scroll inside them stays inside them.
- The overlay's priority pills use the same colour recipe as the editor chips;
  they were washed out on light themes.
- The panel overlay's `z-index: 10000` is now `var(--layer-modal)`.

### Previews

- `test/chips-preview.html` and the new `test/reminder-preview.html` can stack
  any community theme with `?theme=<name>`, in the order Obsidian loads them.
  Drop a `theme.css` into `test/themes/` to check the plugin against it.
- `npm run previews` regenerates the README images, now including the same
  chips under a community theme in both modes.


## 1.2.1 - Chip text direction fix

- Fixed chip text direction. `.taskpro-badge-container` reversed the chip row
  with `direction: rtl` and `.taskpro-chip` tried to opt out with
  `direction: auto`, which is not a valid value for that property and was
  silently dropped — so every chip inherited RTL. In an English vault
  "3 Days Left" rendered as "Days Left 3" and each chip's icon sat to the right
  of its label. The row is now reversed with `flex-direction: row-reverse`,
  which leaves text direction inherited from the note.
- Added `test/chips-preview.html`, an offline harness that renders the real
  `styles.css` over Obsidian's theme variables, plus
  `test/render-previews.mjs` to screenshot it. The bug above is what the
  harness found.
- Rewrote the README: corrected the task-toggle cycle (four states, not three),
  the deadline syntax, and the missing `[!]` status; documented priority, the
  Jalali calendar, the command list, requirements and the build.


## 1.2.0 - Focus timers and repeating tasks

Every task can now carry two more capabilities beside its progress bar, added
from the same **Add Capability** menu.

- **Focus timer.** A per-task countdown with start / pause / +5 / +15 / reset,
  a live chip, and a status-bar readout that opens the task's note when
  clicked. Time is derived from timestamps rather than ticked down in memory,
  so a timer keeps running while Obsidian is closed. When it ends you get an
  in-app notice, an optional sound, and a desktop notification — a system toast
  on Windows, named after the task itself.
- **Repeat.** Ticking off a repeating task rolls it forward instead of closing
  it: the deadline moves to the next occurrence, the status returns to `[ ]`,
  and any progress bar or timer on the task resets. Presets cover daily,
  weekly, fortnightly, and monthly, plus a custom interval. The next date is
  counted from the task's own deadline so a weekly task keeps its weekday when
  ticked off late, past deadlines catch up to the future instead of landing in
  the past, and month intervals clamp instead of spilling into the next month.
  The rule lives in the task line as `@repeat(1w)`, so it travels with the task.
- Added a **Capabilities** settings tab for the timer defaults and alerting,
  and badge toggles for both new chips under **Badges**.
- Added two commands: *Start / Pause Focus Timer on Current Task* and
  *Toggle Weekly Repeat on Current Task*.
- Style Settings entries for both new chips.

### Fixes and cleanups

- `minAppVersion` was `1.0.0` while the plugin already relied on
  `Vault.process` (Obsidian 1.5). It now declares `1.5.0`.
- Disabling the plugin left `taskpro-hide-badges-in-embeds` on `document.body`,
  so the vault stayed styled by a plugin that was no longer running.
- `@codemirror/state` and `@codemirror/view` are imported by the source but
  were not declared as dependencies, so a clean install could not typecheck.
  Both are now pinned to the versions `obsidian` requires, and a lockfile is
  committed.
- Switched vault lookups to `getFileByPath`, dropping the paired `instanceof`
  checks.
- The shared dialog panel now closes on Escape.
- Moved the last inline styles out of TypeScript, and removed the load/unload
  console noise.
- Added `npm test`, covering the recurrence date maths and timer bookkeeping.
- Added a release workflow that validates the version metadata, runs the tests,
  builds, and publishes `main.js`, `manifest.json`, `styles.css`, and a zip of
  the three.
