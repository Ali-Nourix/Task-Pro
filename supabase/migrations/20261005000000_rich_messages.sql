-- TaskPro Telegram bot, fourth step: the choice between rich messages and the
-- classic ones. On unless turned off. Safe to run more than once. The Edge
-- Functions run this themselves the first time they are used after an update.

alter table public.bot_owner add column if not exists rich boolean not null default true;
