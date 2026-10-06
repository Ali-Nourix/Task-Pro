-- TaskPro Telegram bot, sixth step: the tags the notes know (so the bot can list them to
-- pick from). Safe to run more than once. The Edge Functions run this themselves the first
-- time they are used after an update.

alter table public.bot_owner add column if not exists tag_catalog jsonb not null default '[]'::jsonb;
