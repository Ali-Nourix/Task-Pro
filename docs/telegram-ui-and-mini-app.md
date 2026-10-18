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

The confirmed production bot project is **Obsidian Reminder**. Its existing
schema was inspected; no migration was applied. The polished `telegram` function
is active at version 19, and `miniapp` backend version 1 is deployed with the
frontend URL deliberately unset. `sync`, `tick`, existing webhook configuration
and secrets were not changed.

Public smoke checks: health 200 with `ready:false`; unsigned API requests 401;
untrusted browser origin 403; unsigned Telegram webhook requests 403.
Authenticated Mini App production testing remains pending a working HTTPS host
and real Telegram launch. Cloudflare hosting was blocked by a connection that
requires re-authentication. The Mini App menu is **not active yet**.

## Verification

- `node test/telegram-polish.mjs`: 108 checks across Persian/English and configured /
  unavailable AI; compact/expanded navigation, legacy commands, delete protection,
  ownership, quick Undo and valid Telegram payloads.
- `node test/telegram-bot.mjs`: existing bot regression coverage.
- `npm run build`: plugin and backend TypeScript checks.

Local visual previews are layout approximations of recorded bot responses, not
screenshots of a real Telegram client. Production smoke testing remains necessary.
