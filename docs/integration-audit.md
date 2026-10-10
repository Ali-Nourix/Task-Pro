# TaskPro 1.6.0 integration and publication audit

## Scope and recovery

The original `main` recovery point is `1a1ec20c4e51089a204a13320acf1a73a00172f7`, retained as `recovery/main-before-public-audit-20261010`. No source branches, commits, tags or releases were deleted, no shared history rewritten, and the repository remains private. `integration/final-taskpro` began at that recovery point.

While this audit was running, PR #8 merged the feature-only integration into `main` at `24813b3b21435c41576b4b4efd70a45233a6c9be`. That commit contains the previously audited feature work; the separate privacy and validation fixes below were not part of PR #8.

## Branch decisions

| Branch / PR | Decision |
| --- | --- |
| `main` | Preserve existing refactor, theme adaptation, checkbox compatibility, settings, calendar/timeline, mobile, RTL, documentation and test infrastructure. |
| `claude/obsidian-plugins-refactor-b1w86h` / PR #5 | Already merged; retain its implementation, do not replay it. |
| `feature/auto-plan-new-tasks` / PR #6 | Integrate all eight commits through `9519f2d8f0aeb4efd0b7f49263de3339d55060bd`, merged to integration by PR #7 and subsequently to main by PR #8. |
| `build/auto-plan-zip` | Ancestor of the complete feature branch; no independent implementation to replay. |
| `claude/taskpro-theme-adaptive` | Its checkbox/style/documentation/fixture additions are already present in main and the feature snapshot. Preserve the newer actual implementation and preview renderers rather than replaying an overlapping commit. |
| `recovery/main-before-public-audit-20261010` | Keep as the private recovery point. |

The newest feature commits implement per-line detection of new tasks, a three-second quiet period using live editor text, incomplete-task handling, daily-note watching outside the target folder, start/end time tracking, eased horizontally scrolling chips, and the newer Telegram planning, dashboard and rich-answer behavior.

## Semantic fixes and retained behavior

- Keep newer main/feature code; do not replace entire conflicting files with an older branch. Overlapping adaptive checkbox changes were checked against actual source additions, not commit counts alone.
- Map vertical wheel input toward the trailing chips in negative-scroll RTL layouts. Keyboard focus cancels an unfinished wheel glide so it cannot undo focus scrolling.
- Reduced-motion mode disables animation/transition immediately instead of briefly exposing a backwards-filled starting transform. Preserve normal-motion behavior.
- Keep small table control focus rings inside clipped cells.
- Suppress only the trailing click from a swipe/long press; clear the guard on the next primary press, allow keyboard activation, and expire it. Preserve pop-out document compatibility.
- Pointer focus must not move the floating mobile `+` between press and click. Reveal collapsed chrome after successful activation; keyboard/switch-visible focus still reveals it.
- Preserve all feature settings, task transformations, sync payloads and schema/migration changes. Privacy fixes affect diagnostics and error reporting, not intended sync data.
- Preserve LICENSE unchanged and original mixed line endings in existing documentation. Synthetic preview images were regenerated for inspection, not mass-replaced in Git.

## Working-tree privacy and dependency hardening

Remove the personal Supabase project reference from the updater and documentation. Require a locally linked project or `SUPABASE_PROJECT_REF`; never commit credentials. Ignore vault/settings, environment/secrets, CLI state and log files. Runtime console calls use fixed messages only, without exception objects, private paths, task text or provider bodies. Sync/command failures use controlled messages instead of persisting/uploading arbitrary exception strings. The token input remains masked; local plugin settings still store the token unencrypted, as documented in SECURITY.md.

Set the plugin/package/build version to 1.6.0 and retain the existing minimum app version. Pin tested Obsidian API declarations; update esbuild and transitive Moment to remove the reported development dependency advisories.

## Validation protocol

The reproducible browser suite uses Playwright 1.56.1 and its bundled Chromium 141. These are synthetic fixture/browser checks, not a test inside the Obsidian application. Optional Bookcloth checks use the independently audited 3.8.1 stylesheet locally; it is not vendored into this repository.

| Command / check | Actual result |
| --- | --- |
| `npm ci --ignore-scripts` | Clean dependency installation succeeded. |
| `npm test` | 16 suites, 1,373 checks passed, including 72 privacy checks. |
| `npm run build` | Plugin TypeScript, backend TypeScript and production esbuild passed. |
| `npm run test:ui` | All nine suites passed: board 323, calendar 98, mobile interactions 218, mobile accessibility 602, Reading Mode 15, chip scroll 32, gesture guard 10, mobile chrome 24 checks; clip guard inspected 1,844 states. |
| `npm run check:contrast` | All tested chip variants meet AA on default Obsidian and Bookcloth, in light and dark modes. |
| `npm run previews` | 26 synthetic previews rendered successfully. |
| `npm audit --json` | Zero reported dependency vulnerabilities in the locked development graph. |
| Gitleaks 8.30.1, redacted current source/build scan | Zero findings. Additional private-data patterns found zero current-file findings. Not a complete history scan. |
| Source diff / version / deterministic build | Whitespace check passed; LICENSE unchanged; manifest, package, lockfile and versions index agree on 1.6.0; repeated production builds match. |
| `node test/telegram-supabase.mjs` | Explicitly skipped: local PostgreSQL/PostgREST test environment unavailable. |

No failed assertion is skipped or replaced with a forced JavaScript click. The supplied experimental Chrome 153 also exhibited a native post-multitouch tap failure on the untouched feature branch and an earlier candidate. The complete final suite passes with the documented, matching stable toolchain; this is not a claim of validation in every Chromium version. Recheck the target Obsidian webview and real devices before broad release.

## Publication is still blocked

A clean current snapshot does **not** establish that this existing repository is safe to make public. The audit found personal email addresses and private AI session links in commit metadata and a personal project reference in historical source. A project identifier is not itself an authentication credential, but it is private configuration the owner requested not to publish. Branch deletion does not erase that history.

PR discussions/review threads retrieved for the existing PRs were empty; release description text was reviewed. Historical release binaries, complete historical blobs, and Actions logs/artifacts were not fully auditable with the available authenticated interfaces. Do not treat these as clean or as blank. The complete authenticated Git history scan remains outstanding.

Keep the repository private until a full history/metadata/artifact review and any required cleanup are completed, or publish a separately audited clean snapshot in a new public repository without inherited private history. If any credential is discovered in historical material, revoke/rotate it before cleanup. History rewriting, branch deletion, release deletion, public visibility changes and production backend deployment were not authorized or performed in this integration.

Manual checks still required: install the generated plugin package in an Obsidian test vault; exercise mobile long-press/swipe/back, theme adaptation, mixed Persian/English tasks and live editor chips; verify live Telegram/Supabase integration using a dedicated test backend, not production tables. The optional PostgreSQL/PostgREST integration test cannot run without its local test environment.
