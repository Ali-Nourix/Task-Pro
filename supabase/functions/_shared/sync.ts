// The sync with the plugin: it uploads the open tasks and what it has applied,
// and is handed the changes made in Telegram since.

import { addDays, isClock, isRealDate } from './time.ts';
import { words } from './texts.ts';
import type { CommandRow, OwnerRow, SnapshotTask, Status, Store, TagInfo, Telegram } from './types.ts';

const STATUSES = new Set<string>(['open', 'doing', 'done', 'failed']);
const PRIORITIES = new Set<string>(['highest', 'high', 'medium', 'low', 'lowest']);
export const MAX_TASKS = 5000;

export interface Ack {
  id: string;
  /** For an added task, or one that was renamed: the key it has in the notes now. */
  key?: string;
  error?: string;
}

export interface SyncRequest {
  snapshot?: unknown[];
  acks?: Ack[];
  /** The tags the notes know, with how many tasks have each. */
  tags?: unknown[];
  /** The plugin's planning settings, for tasks made in Telegram to be planned the same way. */
  planning?: unknown;
}

export interface SyncResponse {
  ok: true;
  commands: CommandRow[];
  owner: { language: string; timezone: string; calendar: string; lead_minutes: number } | null;
  serverTime: string;
}

const count = (value: unknown): number | null => (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 100_000 ? value : null);
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
    repeat: typeof v.repeat === 'string' && /^\d{1,3}[dwm]$/.test(v.repeat) ? v.repeat : null,
    parent_key: text(v.parent_key, 600),
    parent_title: text(v.parent_title, 600),
    subs_done: count(v.subs_done),
    subs_total: count(v.subs_total),
    tags,
    note_path: text(v.note_path, 600),
  };
}

export const MAX_TAGS_KNOWN = 300;

/** The tag catalog from the upload: keys the bot can put in a button, with names and counts, most used first. */
export function cleanTagCatalog(value: unknown): TagInfo[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: TagInfo[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const v = item as Record<string, unknown>;
    const key = text(v.key, 60);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const name = text(v.name, 60);
    out.push({ key, ...(name && name !== key ? { name } : {}), count: count(v.count) ?? 0 });
    if (out.length >= MAX_TAGS_KNOWN) break;
  }
  return out.sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
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
    if ((command.kind === 'add' || command.kind === 'edit') && typeof ack.key === 'string' && !ack.error) {
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

  if (owner && Array.isArray(request.tags)) {
    try {
      await store.patchOwner({ tag_catalog: cleanTagCatalog(request.tags) });
    } catch (error) {
      // A database that has not learnt the column yet (it updates itself on first use) still syncs the tasks.
      console.error("tag catalog not saved");
    }
  }

  if (owner && request.planning && typeof request.planning === 'object') {
    const p = request.planning as Record<string, unknown>;
    const patch: Partial<OwnerRow> = {};
    if (typeof p.autoPlan === 'boolean' && p.autoPlan !== (owner.auto_plan ?? true)) patch.auto_plan = p.autoPlan;
    if (typeof p.trackTime === 'boolean' && p.trackTime !== (owner.track_time ?? false)) patch.track_time = p.trackTime;
    if (Object.keys(patch).length) {
      try {
        await store.patchOwner(patch);
      } catch (error) {
        console.error("planning settings not saved");
      }
    }
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
