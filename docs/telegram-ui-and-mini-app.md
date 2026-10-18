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

This UI-only update adds no database columns, tables, migrations or new secrets.
An older installation may still need migrations from earlier versions. The
current production deployment has not been verified, so no claim is made that
its existing functions or schema are up to date. Do not deploy to an unrelated
project merely because it appears in the connected account.

## Optional next phase: Telegram Mini App

A Mini App can coexist with the conversational bot; it need not replace commands,
reminders or notifications. It is **not implemented in this update**.

A scoped first version could provide Today / All tasks, task details and editing,
launched via Telegram's menu button. It requires an HTTPS-hosted frontend and a
backend authorization path:

1. Pass `Telegram.WebApp.initData` to the server. Validate the official signature
   with the bot token and reject expired `auth_date` values.
2. Resolve the authenticated Telegram user to the existing TaskPro owner; enforce
   ownership on every read and write. Do not trust `initDataUnsafe` for auth.
3. Keep the bot token and Supabase service-role key only on the backend. Reuse
   existing task validation and synchronization rules rather than creating a
   separate, conflicting task store.
4. Verify RTL/LTR, mobile layout, loading/offline/error states and every existing
   editing operation before enabling the menu button in production.

Official specification: https://core.telegram.org/bots/webapps

## Verification

- `node test/telegram-polish.mjs`: 108 checks across Persian/English and configured /
  unavailable AI; compact/expanded navigation, legacy commands, delete protection,
  ownership, quick Undo and valid Telegram payloads.
- `node test/telegram-bot.mjs`: existing bot regression coverage.
- `npm run build`: plugin and backend TypeScript checks.

Local visual previews are layout approximations of recorded bot responses, not
screenshots of a real Telegram client. Production smoke testing remains necessary.
