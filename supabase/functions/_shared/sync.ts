// The sync with the plugin: it uploads the open tasks and what it has applied,
// and is handed the changes made in Telegram since.

import { addDays, isClock, isRealDate } from './time.ts';
import { words } from './texts.ts';
import type { CommandRow, SnapshotTask, Status, Store, Telegram } from './types.ts';

const STATUSES = new Set<string>(['open', 'doing', 'done', 'failed']);
const PRIORITIES = new Set<string>(['highest', 'high', 'medium', 'low', 'lowest']);
export const MAX_TASKS = 5000;

export interface Ack {
  id: string;
  /** For an added task: the key it has in the notes now. */
  key?: string;
  error?: string;
}

export interface SyncRequest {
  snapshot?: unknown[];
  acks?: Ack[];
}

export interface SyncResponse {
  ok: true;
  commands: CommandRow[];
  owner: { language: string; timezone: string; calendar: string; lead_minutes: number } | null;
  serverTime: string;
}

const text = (value: unknown, max: number): string | null => (typeof value === 'string' && value.length > 0 && value.length <= max ? value : null);

/** A task from the upload, or null when it is not one. */
export function cleanTask(value: unknown): SnapshotTask | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  const key = text(v.key, 600);
  const title = text(v.title, 600);
  if (!key || !title || typeof v.status !== 'string' || !STATUSES.has(v.status)) return null;
  const date = (x: unknown) => (typeof x === 'string' && isRealDate(x) ? x : null);
  const clock = (x: unknown) => (typeof x === 'string' && isClock(x) ? x : null);
  const remind = typeof v.remind_at === 'string' && !Number.isNaN(Date.parse(v.remind_at)) ? new Date(v.remind_at).toISOString() : null;
  const tags = Array.isArray(v.tags) ? v.tags.filter((tag): tag is string => typeof tag === 'string' && tag.length > 0 && tag.length <= 60).slice(0, 20) : [];
  return {
    key,
    title,
    status: v.status as Status,
    priority: typeof v.priority === 'string' && PRIORITIES.has(v.priority) ? (v.priority as SnapshotTask['priority']) : null,
    deadline: date(v.deadline),
    plan_date: date(v.plan_date),
    plan_start: clock(v.plan_start),
    plan_end: clock(v.plan_end),
    remind_at: remind,
    tags,
    note_path: text(v.note_path, 600),
  };
}

export async function handleSync(
  request: SyncRequest,
  deps: { store: Store; tg?: Telegram; now: () => Date }
): Promise<SyncResponse> {
  const { store } = deps;
  const owner = await store.getOwner();

  // What the plugin has done: finished commands, and a new task's key in the notes.
  for (const ack of Array.isArray(request.acks) ? request.acks : []) {
    if (!ack || typeof ack.id !== 'string') continue;
    const command = await store.finishCommand(ack.id, typeof ack.error === 'string' ? ack.error.slice(0, 300) : undefined);
    if (!command) continue;
    if (command.kind === 'add' && typeof ack.key === 'string' && !ack.error) {
      await store.rekey(String(command.payload.key), ack.key);
    } else if (ack.error && ack.error !== 'cancelled' && owner && deps.tg) {
      const title = typeof command.payload.title === 'string' ? command.payload.title : String(command.payload.key ?? '');
      await deps.tg.send(owner.chat_id, words(owner.language as 'fa' | 'en').syncFailed(title, ack.error.slice(0, 120)));
    }
  }

  if (Array.isArray(request.snapshot)) {
    if (request.snapshot.length > MAX_TASKS) throw new Error('too many tasks');
    const rows: SnapshotTask[] = [];
    const seen = new Set<string>();
    for (const item of request.snapshot) {
      const task = cleanTask(item);
      if (task && !seen.has(task.key)) {
        seen.add(task.key);
        rows.push(task);
      }
    }
    // A task with a change from Telegram still waiting is left as Telegram has it.
    const keep = new Set<string>();
    for (const command of await store.pendingCommands()) {
      if (typeof command.payload.key === 'string') keep.add(command.payload.key);
    }
    await store.replaceSnapshot(rows, keep);
  }

  if (owner) await store.patchOwner({ last_sync_at: deps.now().toISOString() });
  const fresh = await store.getOwner();
  return {
    ok: true,
    commands: await store.pendingCommands(),
    owner: fresh && {
      language: fresh.language,
      timezone: fresh.timezone,
      calendar: fresh.calendar,
      lead_minutes: fresh.lead_minutes,
    },
    serverTime: deps.now().toISOString(),
  };
}

export { addDays };
