# Telegram UI polish and Mini App follow-up

## This update

- Home prioritizes Today, All tasks, New task and Week overview. Tags, sync
  status, settings and help remain available under Tools & settings. The AI
  shortcut remains available when AI is configured.
- Task cards start with Done, Plan, Reminder and More, plus existing family
  navigation and a contextual Back button. More opens every previous editing
  action: title, status, priority, deadline, plan, reminder, tags, repeat,
  subtasks and delete confirmation.
- Existing slash commands and callback links remain supported. Quick Undo
  after task creation remains available. Persian and English are both covered.

## Deployment boundary

The mobile capsule menu is client-side: replace the plugin's `main.js`,
`manifest.json` and `styles.css`, then reload the plugin.

The Telegram navigation changes are server-side: deploy the `telegram` Edge
Function from this same revision to the **existing TaskPro bot project**. A
plugin ZIP alone does not update the bot. Use the repository's existing update
script after checking its linked project, or the documented Supabase deployment
workflow. Keep the existing bot secret, webhook and credentials unchanged.

The bot UI polish adds no database columns or new secrets. The companion Mini App
adds an authenticated Edge Function and a separately hosted frontend; see
[Mini App setup](../miniapp/README.md) for the current implementation, security
boundary, limitations and activation steps. Never deploy to an unrelated project
merely because it appears in the connected account.

## Deployment checkpoint

The confirmed production bot project is **Obsidian Reminder**. Its schema was
inspected; no migration was applied. `telegram` is ACTIVE at version 21,
`miniapp` at version 4 and `sync` at version 21. They use the same confirmed project and frontend URL. `tick`, webhook configuration and existing secrets were not changed. No migration was applied.

Frontend: https://taskpro-miniapp.alinorizadeh1384.workers.dev

Cloudflare connection re-authentication is resolved. `taskpro-miniapp` is deployed
as an ES-module Worker with workers.dev enabled and preview URLs disabled. Its
public HTML was fetched successfully with a browser User-Agent and matched the
locally tested build byte-for-byte. Python's default User-Agent received a
Cloudflare 1010 rejection; ordinary browser requests returned 200.

Live smoke checks: frontend 200 with security headers; API health 200 with
`ready:true`; approved-origin preflight 204; unsigned approved-origin API request
401 with correct CORS; unrelated origin 403; unsigned webhook 403. No production
task data was changed by these tests.

**Owner launch remains required:** send `/app` or `/start` in the bot's private
chat to configure the owner-specific menu button. Then open it and check a real
authenticated task list and a reversible edit. No bot token was retrieved and no
signed production user session was fabricated, so authenticated Telegram
end-to-end testing is not claimed yet.

## Verification

- `node test/telegram-polish.mjs`: 108 checks across Persian/English and configured /
  unavailable AI; compact/expanded navigation, legacy commands, delete protection,
  ownership, quick Undo and valid Telegram payloads.
- `node test/telegram-bot.mjs`: existing bot regression coverage.
- `npm run build`: plugin and backend TypeScript checks.

Local visual previews are layout approximations of recorded bot responses, not
screenshots of a real Telegram client. Production smoke testing remains necessary.

## Follow-up UI and conversation update

Monthly Jalali/Gregorian calendar with daily task counts and agenda; explicit subtask toggle and shared custom parent/status/priority pickers; corrected composite search focus; instant pending state and one HTTP snapshot response per mutation. Added authenticated read-only AI conversation in the Mini App using the existing bot provider configuration. No bot token or service key reaches the frontend, and no new schema/migration is required. The bot’s existing AI action workflow is unchanged.

The owner reported a successful connection. Native Main Mini App setup via BotFather remains a manual owner step using the frontend URL; it is not equivalent to setting a per-chat menu button.

Follow-up deployed: miniapp v3 ACTIVE and Worker deployment fbe175d9f6e14fa5af58c70e8eb51e4d. Public frontend exactly matches the tested build; health 200 ready:true, preflight 204, unsigned AI POST 401, foreign origin 403. Full build and 22 backend/plugin suites passed, plus 140 UI/calendar checks. Production AI completion was not simulated with owner credentials.


## All-status calendar and Task Pro name

Calendar now includes open, in-progress, done and failed tasks, with multi-select status filters, Select all/Clear selection and undated records. The grid counts, status markers and day agenda share the same filtered source. Filter preferences persist locally, but task data, chat history and credentials do not. Completing a task does not remove it from the default all-status calendar; Undo restores the original status. Home and Tasks still list active tasks.

The plugin uploads all four statuses with `snapshotScope:all`. Install this revision’s plugin files, reload it and sync once to populate closed tasks that still exist in notes. Older open-only clients preserve already-known closed records but cannot restore records already dropped by previous snapshots. New authoritative uploads remove genuinely deleted tasks; this is not an immutable completion-event archive. The 5,000-task upload limit is unchanged and oversized uploads fail without silently truncating.

The Telegram menu label and HTML document title are **Task Pro**. The owner sends `/app` once to refresh the menu label. BotFather Main Mini App/profile metadata remains a separate manual owner setting.

The bottom dock has a reserved layout region; the main content scrolls independently and the final agenda row remains reachable above navigation. Calendar rows use neutral bordered surfaces and explicit status labels; checkboxes retain keyboard focus while filtering. Long titles/tags, three-digit counts and six-row months have regression coverage.

Deployed: miniapp v4, sync v21, telegram v21; Worker deployment `24cd9c548e4143d19e34eb393b78dfeb`. Build and all 22 regression suites passed (2,328 checks), plus 207 browser checks. Browser screenshots use fixtures, not private production tasks. Public smoke: frontend 200 and exact build match, health ready:true, preflight 204, unsigned all-status list 401, foreign origin 403, unsigned sync/webhook 403. No production task writes or manufactured owner sessions were used for verification.
