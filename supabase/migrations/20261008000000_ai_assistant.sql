-- TaskPro Telegram bot, seventh step: the AI assistant. `ai` is the switch in the bot's
-- settings (it only does anything when the Cloudflare secrets are set); `ai_memory` is the
-- last few lines of the conversation with it, so "make it Friday" can follow "call Sara".
-- Safe to run more than once. The Edge Functions run this themselves the first time they are
-- used after an update.

alter table public.bot_owner add column if not exists ai boolean not null default true;
alter table public.bot_owner add column if not exists ai_memory jsonb not null default '[]'::jsonb;
