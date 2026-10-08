-- TaskPro Telegram bot, ninth step: a task made in Telegram is planned the way the plugin
-- plans one typed into the notes. The plugin sends its «Plan new tasks for today» and
-- «Track start and end time» settings with every sync; the bot keeps them here and plans a
-- new task for its day at once (with a start at that moment when time is tracked), and ends
-- the plan when the task is ticked off in Telegram. Safe to run more than once. The Edge
-- Functions run this themselves the first time they are used after an update.

alter table public.bot_owner add column if not exists auto_plan boolean not null default true;
alter table public.bot_owner add column if not exists track_time boolean not null default false;
