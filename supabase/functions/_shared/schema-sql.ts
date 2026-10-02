// What the database needs on top of the first migration so that every setting of
// a task can be changed from Telegram. The same statements are in
// migrations/20261003000000_task_settings.sql; a test keeps the two alike.

export const TASK_SETTINGS_SQL = `
alter table public.tasks add column if not exists repeat text;
alter table public.tasks drop constraint if exists tasks_repeat_check;
alter table public.tasks add constraint tasks_repeat_check check (repeat is null or repeat ~ '^\\d{1,3}[dwm]$');
alter table public.commands drop constraint if exists commands_kind_check;
alter table public.commands add constraint commands_kind_check check (kind in ('add', 'status', 'remind', 'plan', 'edit', 'delete'));
`;

/** Answers 't' when the database already has what the statements above give. */
export const TASK_SETTINGS_PRESENT = `
select (
  exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'tasks' and column_name = 'repeat')
  and coalesce((select pg_get_constraintdef(oid) like '%edit%' from pg_constraint where conname = 'commands_kind_check' and conrelid = 'public.commands'::regclass), false)
) as present
`;
