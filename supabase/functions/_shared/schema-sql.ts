// What the database needs on top of the first migration so that every setting of
// a task can be changed from Telegram, and subtasks shown. The same statements
// are in migrations/20261003000000_task_settings.sql, 20261004000000_subtasks.sql and
// 20261005000000_rich_messages.sql,
// 20261006000000_message_width.sql and
// 20261007000000_tags_accessibility.sql;
// a test keeps them alike.

export const TASK_SETTINGS_SQL = `
alter table public.tasks add column if not exists repeat text;
alter table public.tasks drop constraint if exists tasks_repeat_check;
alter table public.tasks add constraint tasks_repeat_check check (repeat is null or repeat ~ '^\\d{1,3}[dwm]$');
alter table public.commands drop constraint if exists commands_kind_check;
alter table public.commands add constraint commands_kind_check check (kind in ('add', 'status', 'remind', 'plan', 'edit', 'delete'));
alter table public.tasks add column if not exists parent_key text;
alter table public.tasks add column if not exists parent_title text;
alter table public.tasks add column if not exists subs_done integer;
alter table public.tasks add column if not exists subs_total integer;
alter table public.bot_owner add column if not exists rich boolean not null default true;
alter table public.bot_owner add column if not exists pad integer not null default 60 check (pad between 0 and 200);
alter table public.bot_owner add column if not exists a11y boolean not null default false;
alter table public.bot_owner add column if not exists tag_catalog jsonb not null default '[]'::jsonb;
`;

/** Answers 't' when the database already has what the statements above give. */
export const TASK_SETTINGS_PRESENT = `
select (
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'tasks' and column_name in ('repeat', 'parent_key', 'parent_title', 'subs_done', 'subs_total')) = 5
  and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'bot_owner' and column_name = 'rich')
  and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'bot_owner' and column_name = 'pad')
  and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'bot_owner' and column_name = 'a11y')
  and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'bot_owner' and column_name = 'tag_catalog')
  and coalesce((select pg_get_constraintdef(oid) like '%edit%' from pg_constraint where conname = 'commands_kind_check' and conrelid = 'public.commands'::regclass), false)
) as present
`;
