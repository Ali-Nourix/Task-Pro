# TaskPro Mini App

Production redesign, stacked on `fix/telegram-target-folder-sync`. No database migration or Edge Function replacement is required for this UI release.

## Build and test

```sh
cd miniapp
npm install
npx playwright install chromium
npm test
```

Tests launch Chromium at `CHROME_PATH` or the Playwright installation. Synthetic Telegram/API fixtures are generated **only** as `after.html`; they are never imported by `index.html`, `dist.html` or `worker.mjs`. Never publish fixture pages.

`node build.mjs` produces self-contained `dist.html` and `worker.mjs`. The Worker uses standard Web Streams gzip decompression once per isolate, keeps the result in memory, serves GET/HEAD, and rejects other methods. No build service or external asset hosting is needed. The three font text fragments concatenate to the unchanged, originally deployed Vazirmatn variable font declaration (SIL OFL, see OFL.txt).

## Authentication and privacy

- Telegram initData stays in memory and is sent as `Authorization: tma …`, never in URLs or storage.
- Supabase validates signatures, ownership and the exact allowed origin. No auth bypass is shipped.
- All task/message content uses textContent, not HTML interpolation.
- Existing CSP, Telegram frame restrictions, no-referrer, nosniff and disabled device permissions are preserved.
- No analytics, trackers, external fonts or user content in source.

## Product behavior

- Home shows the selected day's active tasks. Prior overdue tasks remain in a clearly labelled separate review filter; no dates are rewritten.
- Overdue matches the bot: overdue deadline, or past planned date when there is no deadline. A future deadline is not labelled overdue solely because of an earlier plan.
- Today-done summary and its calendar destination share today's scope. List tally counts the displayed rows, not every active task.
- Calendar retains all four statuses, undated tasks, Jalali display, time zone and keyboard navigation.
- Create/edit/status/subtask/reminder/delete and undo contracts remain unchanged.
- Errors preserve form input. Pending labels reflect actual pending records. Last-sync text is a dated snapshot receipt, **not** a claim that Obsidian is online.
- Returning after 30 seconds or reconnecting triggers only a read refresh; active sheets/chat are not interrupted and writes are never retried automatically.

## Deployment and rollback

Target: existing Cloudflare Worker `taskpro-miniapp`, original compatibility date `2026-10-01`, no bindings. Upload generated `worker.mjs` as ES module `worker.js`; preserve worker name, route and settings. Frontend Supabase origin remains unchanged.

Prior production version: `56489114-619a-4629-8925-5c0942692c80`. Roll back via Cloudflare version deployments if needed. UI deployment does not roll back sync v25 or edit any task rows.

## Bounded verification

Existing plugin/server regression: 2,098 checks across 20 suites, plus 24 current-production-source end-to-end checks passed before redesign. Initial redesign UI: 28 browser checks with synthetic records (home/all/overdue/search, responsive widths 360/390/768/1440, details, failed create preserving draft, retry, status/undo, calendar/undated, assistant response, dark theme, outside-Telegram auth gate), plus 3 Worker build/HTTP checks. Screenshots visually reviewed for mobile/desktop, calendar, details, error and dark mode. This does not certify absence of all bugs or replace checking the real Telegram WebView on the user's device.

Design: UI UX Pro Max accessible flat/minimal guidance + taste-skill app/workspace Achromatic ledger, seed 1127536246. Product face: daily-note-aware date lanes, explicit overdue boundary and honest Obsidian snapshot receipt. Persian typography is retained rather than substituting a Latin-only recommendation. Existing behavior is modularized, not migrated to a new framework.

Seven-question critique: the main job is today's work; primary create is clear; navigation and selected day are visible; data density remains scannable; dates/statuses and sync source provide product identity; error/empty states remain actionable; mobile and RTL are first-class. Deliberate exceptions: no photos or decorative charts for a task utility, and no animation required for comprehension.

## Layout and Persian follow-up

The subsequent Impeccable/Emil/Persian-writing refinement has 42 browser checks and 3 Worker checks. See REFINEMENT.md for scope, copy policy, evidence and real-device limitations. This pass does not rerun or replace the earlier 2,098 backend/plugin checks.
