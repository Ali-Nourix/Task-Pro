-- TaskPro Telegram bot, eighth step: messages the bot sends by itself (a morning summary, an
-- evening review, a nudge before a deadline, a reminder that repeats until the task is done),
-- and the assistant's «show me first» mode. `notified` remembers what was already sent so that
-- nothing goes out twice. Safe to run more than once. The Edge Functions run this themselves the
-- first time they are used after an update.

alter table public.bot_owner add column if not exists brief_time text default '08:00' check (brief_time is null or brief_time ~ '^\d{2}:\d{2}$');
alter table public.bot_owner add column if not exists review_time text default '21:00' check (review_time is null or review_time ~ '^\d{2}:\d{2}$');
alter table public.bot_owner add column if not exists deadline_nudge text not null default 'eve' check (deadline_nudge in ('off', 'eve', 'morn', 'both'));
alter table public.bot_owner add column if not exists nag boolean not null default true;
alter table public.bot_owner add column if not exists notified jsonb not null default '{}'::jsonb;
alter table public.bot_owner add column if not exists ai_confirm text not null default 'big' check (ai_confirm in ('ask', 'big', 'auto'));
alter table public.bot_owner add column if not exists ai_pending jsonb;
