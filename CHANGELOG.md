# Changelog

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
