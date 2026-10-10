# TaskPro 1.6.0 integration and publication audit

## Scope and recovery

The verified TaskPro 1.6.0 implementation was integrated through PRs #7–#9. A subsequent owner-authorized privacy cleanup rewrites author/committer identities and private values in all retained branch/tag histories. The complete pre-cleanup history and artifact metadata are backed up privately outside GitHub; the remote recovery branch retains its source snapshot with sanitized history, not the original sensitive commits. No source branch, tag or release is deleted and the repository remains private.

PR #8 brought the feature-only integration to main; PR #9 added the privacy and validated interaction fixes. The code and branch decisions below are retained. Historical commit hashes changed during cleanup, so pre-cleanup hashes are intentionally not republished here.

## Branch decisions

| Branch / PR | Decision |
| --- | --- |
| `main` | Preserve existing refactor, theme adaptation, checkbox compatibility, settings, calendar/timeline, mobile, RTL, documentation and test infrastructure. |
| `claude/obsidian-plugins-refactor-b1w86h` / PR #5 | Already merged; retain its implementation, do not replay it. |
| `feature/auto-plan-new-tasks` / PR #6 | Integrate all eight feature commits, merged to integration by PR #7 and subsequently to main by PR #8. |
| `build/auto-plan-zip` | Ancestor of the complete feature branch; no independent implementation to replay. |
| `claude/taskpro-theme-adaptive` | Its checkbox/style/documentation/fixture additions are already present in main and the feature snapshot. Preserve the newer actual implementation and preview renderers rather than replaying an overlapping commit. |
| `recovery/main-before-public-audit-20261010` | Retain its source snapshot with sanitized history; original recovery lives only in the private offsite bundle. |

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

The unchanged UI source retains the previous integration’s verified browser results. The reproducible browser suite uses Playwright 1.56.1 and its bundled Chromium 141. These are synthetic fixture/browser checks, not a test inside the Obsidian application. Optional Bookcloth checks use the independently audited 3.8.1 stylesheet locally; it is not vendored into this repository.

| Command / check | Actual result |
| --- | --- |
| `npm ci --ignore-scripts` | Clean dependency installation succeeded. |
| `npm test` | 16 suites, 1,377 checks passed, including 76 privacy checks. |
| `npm run build` | Plugin TypeScript, backend TypeScript and production esbuild passed. |
| `npm run test:ui` | All nine suites passed: board 323, calendar 98, mobile interactions 218, mobile accessibility 602, Reading Mode 15, chip scroll 32, gesture guard 10, mobile chrome 24 checks; clip guard inspected 1,844 states. |
| `npm run check:contrast` | All tested chip variants meet AA on default Obsidian and Bookcloth, in light and dark modes. |
| `npm run previews` | 26 synthetic previews rendered successfully. |
| `npm audit --json` | Zero reported dependency vulnerabilities in the locked development graph. |
| Gitleaks 8.30.1, redacted current source/build scan | Zero findings in current files/build. The follow-up also scanned all retained local Git history and downloaded archives, with zero credential findings after removing temporary local authentication metadata; GitHub PR/cache cleanup is a separate outstanding gate. |
| Source diff / version / deterministic build | Whitespace check passed; Latest upstream LICENSE preserved, including the concurrent GPL v3.0 update; manifest, package, lockfile and versions index agree on 1.6.0; repeated production builds match. |
| `node test/telegram-supabase.mjs` | Explicitly skipped: local PostgreSQL/PostgREST test environment unavailable. |

No failed assertion is skipped or replaced with a forced JavaScript click. The supplied experimental Chrome 153 also exhibited a native post-multitouch tap failure on the untouched feature branch and an earlier candidate. The complete final suite passes with the documented, matching stable toolchain; this is not a claim of validation in every Chromium version. Recheck the target Obsidian webview and real devices before broad release.

## Follow-up privacy audit

The full authenticated pre-cleanup inventory covers 79 commits and 941 unique blobs, retained branches/tags and read-only PR heads, nine PRs with their conversation/review surfaces, two historical releases and eight assets, six Actions runs and four artifacts. The audit identifies a personal commit email, a private AI session link and a personal project reference for removal. Four existing PR descriptions containing the private session link are sanitized separately from Git history. No credential was detected in historical Git content or downloaded release/log/artifact content by the redacted scanner; this is not a guarantee that no credential can exist in any external copy.

A temporary authentication value returned in repository API metadata was detected only in the protected local metadata backup and removed from that backup; it was not a committed or released project credential. English OCR and metadata checks across 93 historical preview-image versions found no occurrences of the identified private values. OCR is not a guarantee that every possible piece of information encoded in pixels has been removed.

The ticker's server error response is additionally changed to a fixed diagnostic message, preserving notification behavior while preventing provider exception text from reaching API callers. No API guide is added.

Hosted Actions execution is separate from local build validation. Account-specific failure details and original logs remain in the private audit, not in this public-facing document. No payment, new release/tag or production deployment is performed by this cleanup.

**Publication remains gated:** force-updating branch/tag refs cannot overwrite GitHub's read-only PR refs or purge cached old commit views. GitHub Support must assess removal of the remaining sensitive references; the owner must also clean other clones. Support may not remove ordinary personal metadata. Keep this existing repository private until the remaining references are resolved, or choose a new separately audited clean repository. Do not expose the private backup, redaction list or original commit map.

Manual checks still required: install the generated plugin package in an Obsidian test vault; exercise mobile long-press/swipe/back, theme adaptation, mixed Persian/English tasks and live editor chips; verify live Telegram/Supabase integration using a dedicated test backend, not production tables. The optional PostgreSQL/PostgREST integration test cannot run without its local test environment.
