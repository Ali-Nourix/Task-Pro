# Focus clock 1.8.0 validation

## Passed

- `npm run build`: TypeScript checks and production bundle.
- `npm test`: 21 suites, 2,166 checks.
- `test/clock-ui.mjs`: 40 checks covering desktop, 390px Persian/dark,
  320px English/light, live countdown, pause/reset, duration editing,
  calendar counters and 300px split panes.
- `test/floating-clock-ui.mjs`: 76 checks for equal themed button metrics,
  non-modal editing, mouse/touch/keyboard movement, edge clamping, position
  recall, resize, single-window lifecycle, focus/Escape and cleanup.
- `test/mobile-chips.mjs`: 63 checks for one capsule + More in LTR/RTL,
  touch/keyboard actions, original node/event preservation, viewport bounds,
  desktop restoration and lifecycle cleanup.
- Existing browser tests: note-embed-pomodoro-ui (33), embed-presentation-ui
  (42), embed-scope-spacing-ui (52), table-selection-ui (84), embed-lazy-ui
  (42), embed-state-ui (14), board-interactions (324), mobile-a11y (599),
  reading-mode (20), chip-scroll (32), touch-guard (10), mobile-chrome (24).
- clip-guard: 1,842 states scanned.
- Visual inspection: clock 1280px, 390px Persian dark, 320px English light;
  narrow calendar and split-pane layouts; mobile capsule menu and real Reading renderer.

- Telegram polish: 108 additional checks for both languages, compact/expanded
  navigation, feature retention, owner checks, legacy commands and quick Undo.

## Known existing suite failures

The full `npm run test:ui` is **not entirely green**:

- `calendar-interactions.mjs:155` times out waiting for
  `.taskpro-cal-picker__input`. Reproduced in the unchanged baseline harness.
- `mobile-interactions.mjs:239` times out waiting for `.taskpro-menu.is-sheet`.
  Previously reproduced against the unchanged base during embed-state work.

The new clock/mobile tests and the other listed suites were run independently
so those existing timeouts did not skip their coverage.

Browser tests use actual renderers with a stub Obsidian host. Test the supplied
build in a real desktop/mobile Obsidian vault before publishing a release;
operating-system notification/audio behavior is not proven by these mocks.
