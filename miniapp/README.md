# TaskPro Telegram Mini App

Mobile-first companion to the existing single-owner bot. The conversational bot,
AI, reminders, settings, commands and legacy callback buttons remain available.
There is no second task database.

## Implemented

- Persian/English, RTL/LTR, bundled Vazirmatn font, light/dark Telegram themes.
- Home: interactive week strip, upcoming scheduled task, compact daily list.
- Tasks: all open tasks, Today/Overdue filters and title/tag search.
- Calendar: select a date and see its agenda in start-time order.
- Create tasks/subtasks, complete with quick Undo, change status/title/priority,
  deadline, recurrence and tags; set/remove a plan or reminder; confirmed delete.
- Owner timezone governs plan/reminder entry. List dates follow the owner's
  calendar; browser date-entry fields use Gregorian ISO dates, explained inline.
- Collapsible editing sections, keyboard focus, accessible names, 44px controls,
  reduced motion, offline/session-expiry messages and safe text-only titles.

The backend reads the existing *open-task snapshot*, not a permanent completed
history. Obsidian receives edits through the bot's existing command queue on its
next sync. Do not treat a lost network response as proof a write failed; refresh
before retrying. Mutation requests are not automatically retried or guaranteed
transactionally atomic/idempotent.

## Security

`miniapp` validates Telegram's HMAC-signed `initData` on every POST, accepts at
most one-hour-old sessions (30-second future skew), rejects duplicate query
parameters, and checks the signed user ID against `bot_owner.chat_id` and the
existing optional `ALLOWED_USER_ID` lock **before any task reads/writes**.
`initDataUnsafe` is used only for initial UI language, never authorization.

No bot token or service-role key belongs in this frontend. No credentials are
stored in localStorage, URL parameters or source. Request bodies are size-limited,
CORS permits only the configured frontend origin, and API responses are no-store.
This companion is single-owner, just like the existing installation; it is not a
multi-tenant SaaS or a public bot for arbitrary Telegram users.

## Build and activate

1. Confirm the **existing bot project**, schema and webhook before deploying.
   This addition requires no new schema or secrets for an up-to-date installation.
2. Build the public frontend:

   ```sh
   TASKPRO_API_URL=https://YOUR_PROJECT.supabase.co/functions/v1/miniapp node miniapp/build.mjs
   ```

3. Publish `miniapp/dist/worker.js` as a Cloudflare Worker (ES module). Use its
   real HTTPS URL; `dist/index.html` is also a self-contained static build.
   The Worker sets CSP (including Telegram SDK, API origin and embedded font),
   no-cache, nosniff, restrictive Permissions-Policy and Referrer-Policy headers.
4. Set the **public HTTPS frontend URL**, not the API URL, in
   `supabase/functions/_shared/miniapp-config.ts` (`MINI_APP_URL`). Redeploy both
   `telegram` and `miniapp`. Keep existing secrets and webhook unchanged.
5. The registered owner sends `/app` or `/start` in the private bot chat. The
   bot configures the owner-specific Telegram menu button using `setChatMenuButton`.
   Open the button and verify real authenticated reads and one reversible edit.
   Never extract the production bot token just to manufacture test initData.

The default `MINI_APP_URL` is empty deliberately: browser API origins are denied,
health reports `ready:false`, and no menu button is configured until a real host
is available. An API deployment alone does **not** mean the Mini App is live.

Official Telegram specification: https://core.telegram.org/bots/webapps

## Verification

```sh
npm run build
npm test
TASKPRO_API_URL=https://YOUR_PROJECT.supabase.co/functions/v1/miniapp npm run build:miniapp
PW_CHROMIUM=$(command -v chromium) npm run test:miniapp-ui
```

UI tests use mock fixtures, never private production task data. Captured images
are browser previews, not screenshots from a real Telegram client. Backend tests
exercise signature/expiry/ownership/CORS/validation, shared queue effects, and
protection against unauthorized access and accidental deletes.

## Design provenance

Restyled from the user's organizer/calendar references using the `minimalist-ui`
and `redesign-existing-projects` guides from `Leonxlnx/taste-skill`: warm neutral
canvas, quiet date navigation, soft semantic surfaces, compact task cards and a
bottom dock. Reference avatars, chat messages, notes and alarms are not invented
as features or fake user data. Calendar here is a day agenda, not a full drag-and-
drop weekly scheduler. Vazirmatn is distributed under the SIL Open Font License;
see `assets/OFL.txt` and the notice embedded in `assets/font.css`.
