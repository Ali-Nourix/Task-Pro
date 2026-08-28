# Changelog

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
