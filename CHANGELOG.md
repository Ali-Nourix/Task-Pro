# Changelog

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
