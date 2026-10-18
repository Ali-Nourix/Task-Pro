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
inspected; no migration was applied. `telegram` is ACTIVE at version 20 and
`miniapp` at version 2. Both use the real frontend URL. `sync`, `tick`, webhook
configuration and existing secrets were not changed.

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
