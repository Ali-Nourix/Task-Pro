-- TaskPro Telegram bot, second step: every setting of a task can be changed from
-- Telegram. Tasks learn how often they repeat, and the queue learns the "edit"
-- change (title, priority, deadline, tags, repeat). Safe to run more than once.
-- The Edge Functions run this themselves the first time they are used after an
-- update, so running it by hand is only needed if that did not work.

alter table public.tasks add column if not exists repeat text;
alter table public.tasks drop constraint if exists tasks_repeat_check;
alter table public.tasks add constraint tasks_repeat_check check (repeat is null or repeat ~ '^\d{1,3}[dwm]$');

alter table public.commands drop constraint if exists commands_kind_check;
alter table public.commands add constraint commands_kind_check
  check (kind in ('add', 'status', 'remind', 'plan', 'edit', 'delete'));
