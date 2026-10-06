-- TaskPro Telegram bot: the tables the bot and the Obsidian plugin share.
--
-- The notes stay the truth. Supabase holds (1) a snapshot of the open tasks the
-- plugin uploads, so the bot can list them and remind you while the computer is
-- off, and (2) a queue of changes made from Telegram, which the plugin applies to
-- the notes the next time Obsidian is open.
--
-- Every table has row level security on and no policy: the public (anon) key
-- cannot read or write anything. Only the Edge Functions, which hold the service
-- key, touch these tables.

create extension if not exists pgcrypto;

-- The one person the bot talks to.
create table if not exists public.bot_owner (
  id          boolean primary key default true check (id),
  chat_id     bigint not null,
  timezone    text   not null default 'Asia/Tehran',
  language    text   not null default 'fa' check (language in ('fa', 'en')),
  calendar    text   not null default 'jalali' check (calendar in ('jalali', 'gregorian')),
  lead_minutes integer not null default 10 check (lead_minutes between 0 and 1440),
  last_sync_at timestamptz,
  created_at  timestamptz not null default now()
);

-- Open tasks. `n` is the short number the bot shows (#12); it stays with a task
-- across syncs. It is given after a row is really inserted: an identity column
-- would also count the rows an upload only updates, and the numbers would race
-- ahead with every sync.
create sequence if not exists public.tasks_n_seq;

create table if not exists public.tasks (
  n               bigint unique,
  key             text primary key,
  title           text not null,
  -- open, doing (in progress), done, failed (not done)
  status          text not null default 'open' check (status in ('open', 'doing', 'done', 'failed')),
  priority        text check (priority in ('highest', 'high', 'medium', 'low', 'lowest')),
  deadline        date,
  plan_date       date,
  plan_start      text check (plan_start ~ '^\d{2}:\d{2}$'),
  plan_end        text check (plan_end ~ '^\d{2}:\d{2}$'),
  -- When to remind, as an instant: the plugin works it out (a moment of its own,
  -- or the plan's start minus its lead), so time zones are settled on your computer.
  remind_at       timestamptz,
  -- The remind_at that was last announced, so each reminder goes out once.
  remind_sent_for timestamptz,
  tags            text[] not null default '{}',
  note_path       text,
  origin          text not null default 'vault' check (origin in ('vault', 'telegram')),
  -- Made in Telegram and not yet written into a note.
  pending         boolean not null default false,
  seen_run        uuid,
  updated_at      timestamptz not null default now()
);
create index if not exists tasks_remind_due on public.tasks (remind_at) where status in ('open', 'doing');
create index if not exists tasks_plan_date on public.tasks (plan_date);

create or replace function public.tasks_give_number() returns trigger
language plpgsql as $$
begin
  update public.tasks set n = nextval('public.tasks_n_seq') where key = new.key;
  return null;
end $$;

drop trigger if exists tasks_give_number on public.tasks;
create trigger tasks_give_number after insert on public.tasks
  for each row when (new.n is null) execute function public.tasks_give_number();

-- Changes made in Telegram, waiting for the plugin.
create table if not exists public.commands (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null check (kind in ('add', 'status', 'remind', 'plan', 'delete')),
  payload    jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  applied_at timestamptz,
  error      text
);
create index if not exists commands_pending on public.commands (created_at) where applied_at is null;

-- Locked: no policy means no access through the public API.
alter table public.bot_owner enable row level security;
alter table public.tasks     enable row level security;
alter table public.commands  enable row level security;
revoke all on public.bot_owner, public.tasks, public.commands from anon, authenticated;
