// The store in Supabase: the same rules as the in-memory one, as queries.

import { createClient } from 'npm:@supabase/supabase-js@2';
import type { CommandKind, CommandRow, OwnerRow, SnapshotTask, Store, TaskRow } from './types.ts';
import { sameInstant } from './types.ts';

type Client = ReturnType<typeof createClient>;

const OPEN_STATUSES = ['open', 'doing'];

/** The database has not been given the `repeat` column yet (the schema is brought up to date on first use). */
const noRepeatColumn = (error: { message: string } | null): boolean => !!error && /repeat/i.test(error.message) && /column/i.test(error.message);
const CHUNK = 200;

function fail(what: string, error: { message: string } | null): void {
  if (error) throw new Error(`${what}: ${error.message}`);
}

export function supabaseStore(url: string, serviceKey: string): Store {
  const db: Client = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const one = async (query: PromiseLike<{ data: unknown; error: { message: string } | null }>, what: string) => {
    const { data, error } = await query;
    fail(what, error);
    return data;
  };

  return {
    async getOwner() {
      return (await one(db.from('bot_owner').select('*').maybeSingle(), 'owner')) as OwnerRow | null;
    },

    async setOwner(owner) {
      await one(db.from('bot_owner').upsert({ id: true, ...owner }), 'set owner');
    },

    async patchOwner(patch) {
      await one(db.from('bot_owner').update(patch).eq('id', true), 'patch owner');
    },

    async openTasks() {
      return ((await one(db.from('tasks').select('*').in('status', OPEN_STATUSES).order('n'), 'open tasks')) ?? []) as TaskRow[];
    },

    async taskByN(n) {
      return (await one(db.from('tasks').select('*').eq('n', n).maybeSingle(), 'task by number')) as TaskRow | null;
    },

    async taskByKey(key) {
      return (await one(db.from('tasks').select('*').eq('key', key).maybeSingle(), 'task by key')) as TaskRow | null;
    },

    async insertTask(task) {
      const { repeat, ...rest } = task;
      const first = await db.from('tasks').insert(task);
      if (first.error && noRepeatColumn(first.error)) await one(db.from('tasks').insert(rest), 'insert task');
      else fail('insert task', first.error);
      void repeat;
      // Read back: its number is given by the database just after the insert.
      return (await one(db.from('tasks').select('*').eq('key', task.key).single(), 'read task')) as TaskRow;
    },

    async patchTask(key, patch) {
      const row = { ...patch, updated_at: new Date().toISOString() };
      const first = await db.from('tasks').update(row).eq('key', key);
      if (first.error && noRepeatColumn(first.error)) {
        const { repeat: _repeat, ...rest } = row;
        await one(db.from('tasks').update(rest).eq('key', key), 'patch task');
      } else fail('patch task', first.error);
    },

    async removeTask(key) {
      await one(db.from('tasks').delete().eq('key', key), 'remove task');
    },

    async replaceSnapshot(rows: SnapshotTask[], keep: ReadonlySet<string>) {
      const run = crypto.randomUUID();
      const written = rows.filter((row) => !keep.has(row.key));
      for (let i = 0; i < written.length; i += CHUNK) {
        const chunk = written.slice(i, i + CHUNK).map((row) => ({ ...row, origin: 'vault', pending: false, seen_run: run, updated_at: new Date().toISOString() }));
        const first = await db.from('tasks').upsert(chunk, { onConflict: 'key' });
        if (first.error && noRepeatColumn(first.error)) {
          await one(db.from('tasks').upsert(chunk.map(({ repeat: _repeat, ...rest }) => rest), { onConflict: 'key' }), 'upload tasks');
        } else fail('upload tasks', first.error);
      }
      // Rows left as Telegram has them still count as seen.
      const kept = [...keep];
      for (let i = 0; i < kept.length; i += CHUNK) {
        await one(db.from('tasks').update({ seen_run: run }).in('key', kept.slice(i, i + CHUNK)), 'keep tasks');
      }
      // Whatever the notes did not upload is no longer open, unless it is a task made in
      // Telegram that no note has taken in yet.
      await one(db.from('tasks').delete().eq('pending', false).or(`seen_run.is.null,seen_run.neq.${run}`), 'drop closed tasks');
    },

    async rekey(from, to) {
      const existing = await this.taskByKey(to);
      if (existing) await this.removeTask(from);
      else await one(db.from('tasks').update({ key: to, pending: false }).eq('key', from), 'rekey task');
      const waiting = (await one(db.from('commands').select('id,payload').is('applied_at', null).eq('payload->>key', from), 'commands for key')) as Array<{ id: string; payload: Record<string, unknown> }> | null;
      for (const command of waiting ?? []) {
        await one(db.from('commands').update({ payload: { ...command.payload, key: to } }).eq('id', command.id), 'rekey command');
      }
    },

    async addCommand(kind: CommandKind, payload: object) {
      return (await one(db.from('commands').insert({ kind, payload }).select('id,kind,payload,created_at').single(), 'add command')) as CommandRow;
    },

    async pendingCommands() {
      return ((await one(db.from('commands').select('id,kind,payload,created_at').is('applied_at', null).order('created_at').limit(500), 'pending commands')) ?? []) as CommandRow[];
    },

    async finishCommand(id, error) {
      return (await one(
        db.from('commands').update({ applied_at: new Date().toISOString(), error: error ?? null }).eq('id', id).is('applied_at', null).select('id,kind,payload,created_at').maybeSingle(),
        'finish command'
      )) as CommandRow | null;
    },

    async dueReminders(from, to) {
      const rows = (await one(
        db.from('tasks').select('*').in('status', OPEN_STATUSES).gte('remind_at', from.toISOString()).lte('remind_at', to.toISOString()),
        'due reminders'
      )) as TaskRow[] | null;
      return (rows ?? []).filter((row) => !sameInstant(row.remind_sent_for, row.remind_at));
    },

    async markReminded(key, remindAt) {
      await one(db.from('tasks').update({ remind_sent_for: remindAt }).eq('key', key), 'mark reminded');
    },
  };
}
