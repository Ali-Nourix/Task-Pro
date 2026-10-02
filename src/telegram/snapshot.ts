// ── telegram/snapshot.ts ──────────────────────────────────────────────────
// What the plugin tells the bot: the open tasks, each with a key that finds it
// again in the notes, and the instant its reminder is due. Pure, so it is
// tested without Obsidian.
// ─────────────────────────────────────────────────────────────────────────────

import type { BoardTask } from '../board/task-store';
import { subtaskCounts } from '../board/task-relations';
import type { TaskPriority, TaskRepeat, TaskStatus } from '../types';

/** A task as the bot stores it. Its status is a word, not the marker between brackets. */
export interface SnapshotTask {
  key: string;
  title: string;
  status: 'open' | 'doing';
  priority: TaskPriority | null;
  deadline: string | null;
  plan_date: string | null;
  plan_start: string | null;
  plan_end: string | null;
  remind_at: string | null;
  /** How often it comes back, as the marker writes it: 1d, 2w, 1m. */
  repeat: string | null;
  /** The task it is nested under, by key and title (the parent may be closed, so it may not be in the upload). */
  parent_key: string | null;
  parent_title: string | null;
  /** For a task with subtasks: how many of its direct subtasks are done, and how many it has. */
  subs_done: number | null;
  subs_total: number | null;
  tags: string[];
  note_path: string | null;
}

export interface ReminderDefaults {
  /** Whether a plan with a time reminds before it starts, as the setting says. */
  enabled: boolean;
  leadMinutes: number;
}

/**
 * Names every task so it can be found again: its note, its block ID or title,
 * and, among tasks in one note with the same title, which of them it is.
 */
export function keyTasks(tasks: readonly BoardTask[]): Map<string, BoardTask> {
  const keyed = new Map<string, BoardTask>();
  const counts = new Map<string, number>();
  for (const task of tasks) {
    const name = task.blockId ? `^${task.blockId}` : task.text;
    const base = `${task.filePath}|${name}`;
    const nth = counts.get(base) ?? 0;
    counts.set(base, nth + 1);
    keyed.set(`${base}|${nth}`, task);
  }
  return keyed;
}

/** The key a task appended to a note will have, given what the note holds now. */
export function keyForNewTask(tasks: readonly BoardTask[], path: string, title: string): string {
  const same = tasks.filter((task) => task.filePath === path && !task.blockId && task.text === title).length;
  return `${path}|${title}|${same}`;
}

const localInstant = (date: string, time: string): number => {
  const [year, month, day] = date.split('-').map(Number);
  const [hours, minutes] = time.split(':').map(Number);
  return new Date(year, month - 1, day, hours, minutes).getTime();
};

/**
 * When the task's reminder is due, as an instant: the moment it asked for, or
 * its plan's start less the lead (its own, else the setting's). Null when it has none.
 */
export function reminderAt(task: BoardTask, defaults: ReminderDefaults): string | null {
  if (task.remindAt) return new Date(localInstant(task.remindAt.date, task.remindAt.time)).toISOString();
  if (task.remind === null) return null;
  if (!task.schedule?.start) return null;
  const lead = task.remind ?? (defaults.enabled ? defaults.leadMinutes : null);
  if (lead === null) return null;
  return new Date(localInstant(task.schedule.date, task.schedule.start) - lead * 60_000).toISOString();
}

const REPEAT_TOKEN = { day: 'd', week: 'w', month: 'm' } as const;

export const repeatToken = (repeat: TaskRepeat | undefined): string | null => (repeat ? `${repeat.every}${REPEAT_TOKEN[repeat.unit]}` : null);

const STATUS_WORDS: Partial<Record<TaskStatus, 'open' | 'doing'>> = { '[ ]': 'open', '[/]': 'doing' };

/** The open tasks, as the bot wants them. Tasks already done are left out: the bot lists what is open. */
export function buildSnapshot(tasks: readonly BoardTask[], defaults: ReminderDefaults): SnapshotTask[] {
  const out: SnapshotTask[] = [];
  const keyed = keyTasks(tasks);
  const byId = new Map<string, { key: string; task: BoardTask }>();
  for (const [key, task] of keyed) byId.set(task.id, { key, task });
  const counts = subtaskCounts(tasks);
  for (const [key, task] of keyed) {
    const status = STATUS_WORDS[task.status];
    if (!status || !task.text.trim()) continue;
    out.push({
      key,
      title: task.text.slice(0, 500),
      status,
      priority: task.priority ?? null,
      deadline: task.deadline ?? null,
      plan_date: task.schedule?.date ?? null,
      plan_start: task.schedule?.start ?? null,
      plan_end: task.schedule?.end && task.schedule.end !== '24:00' ? task.schedule.end : null,
      remind_at: reminderAt(task, defaults),
      repeat: repeatToken(task.repeat),
      parent_key: (task.parentId && byId.get(task.parentId)?.key) || null,
      parent_title: (task.parentId && byId.get(task.parentId)?.task.text.slice(0, 500)) || null,
      subs_done: counts.get(task.id)?.done ?? null,
      subs_total: counts.get(task.id)?.total ?? null,
      tags: task.tags.slice(0, 20),
      note_path: task.filePath,
    });
  }
  return out;
}
