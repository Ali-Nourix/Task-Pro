-- TaskPro Telegram bot, third step: subtasks. A task knows the task it is nested
-- under and, if it has subtasks of its own, how many are done out of how many.
-- Safe to run more than once. The Edge Functions run this themselves the first
-- time they are used after an update.

alter table public.tasks add column if not exists parent_key text;
alter table public.tasks add column if not exists parent_title text;
alter table public.tasks add column if not exists subs_done integer;
alter table public.tasks add column if not exists subs_total integer;
