-- TaskPro Telegram bot, fifth step: how wide a short message is held. A message is
-- as wide as its longest line and its buttons can be wider, so a short text is
-- padded with invisible characters; this is how many. Safe to run more than once.
-- The Edge Functions run this themselves the first time they are used after an update.

alter table public.bot_owner add column if not exists pad integer not null default 60 check (pad between 0 and 200);
