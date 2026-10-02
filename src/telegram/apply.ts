// ── telegram/apply.ts ─────────────────────────────────────────────────────
// Makes the changes asked for in Telegram in the notes: a new task into the
// inbox, a tick, a reminder, a plan, a deletion. Each is answered with what
// happened, so the bot can tell the owner when one could not be made.
// ─────────────────────────────────────────────────────────────────────────────

import type { BoardTask } from '../board/task-store';
import { RemindAt, setDeadline, setPriority, setRemind, setSchedule, setTags } from '../task-metadata';
import type { TaskPriority, TaskSchedule, TaskStatus } from '../types';
import { keyForNewTask, keyTasks } from './snapshot';

export interface Command {
  id: string;
  kind: 'add' | 'status' | 'remind' | 'plan' | 'delete';
  payload: Record<string, unknown>;
}

export interface Result {
  id: string;
  /** For an added task: the key it has in the notes. */
  key?: string;
  /** For an added task: the key Telegram gave it, which later commands may still use. */
  from?: string;
  error?: string;
}

/** What applying needs from the plugin. */
export interface ApplyHost {
  /** Every task the notes hold now. */
  tasks(): BoardTask[];
  /** The note a new task goes into, or null when there is none. */
  inboxPath(): string | null;
  appendLine(path: string, line: string): Promise<boolean>;
  setStatus(task: BoardTask, status: TaskStatus): Promise<void>;
  setRemind(task: BoardTask, value: RemindAt | null | undefined): Promise<void>;
  setSchedule(task: BoardTask, schedule: TaskSchedule | null): Promise<void>;
  deleteTask(task: BoardTask): Promise<void>;
  /** Resolves once the notes have been read again after an edit (or a moment has passed). */
  settled(): Promise<void>;
}

const STATUS_MARKERS: Record<string, TaskStatus> = { open: '[ ]', doing: '[/]', done: '[x]', failed: '[!]' };
const PRIORITIES = new Set(['highest', 'high', 'medium', 'low', 'lowest']);
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const CLOCK = /^\d{2}:\d{2}$/;

const str = (value: unknown): string | undefined => (typeof value === 'string' && value ? value : undefined);

function moment(value: unknown): RemindAt | null {
  if (!value || typeof value !== 'object') return null;
  const { date, time } = value as Record<string, unknown>;
  return typeof date === 'string' && DAY.test(date) && typeof time === 'string' && CLOCK.test(time) ? { date, time } : null;
}

function plan(value: unknown): TaskSchedule | null {
  if (!value || typeof value !== 'object') return null;
  const { date, start, end } = value as Record<string, unknown>;
  if (typeof date !== 'string' || !DAY.test(date)) return null;
  const out: TaskSchedule = { date };
  if (typeof start === 'string' && CLOCK.test(start)) {
    out.start = start;
    if (typeof end === 'string' && CLOCK.test(end) && end > start) out.end = end;
  }
  return out;
}

/** The line a task made in Telegram is written as. */
export function lineForNewTask(payload: Record<string, unknown>): string {
  let line = `- [ ] ${String(payload.title ?? '').trim()}`;
  const priority = str(payload.priority);
  if (priority && PRIORITIES.has(priority)) line = setPriority(line, priority as TaskPriority);
  const deadline = str(payload.deadline);
  if (deadline && DAY.test(deadline)) line = setDeadline(line, deadline);
  const schedule = plan(payload.plan);
  if (schedule) line = setSchedule(line, schedule);
  const at = moment(payload.remind);
  if (at) line = setRemind(line, at);
  if (Array.isArray(payload.tags) && payload.tags.length) line = setTags(line, payload.tags.filter((tag): tag is string => typeof tag === 'string'));
  return line;
}

/**
 * Applies the commands in order. A task made earlier in the batch may be named
 * by the key Telegram gave it (`tg:...`); `aliases` remembers its key in the notes.
 */
export async function applyCommands(commands: readonly Command[], host: ApplyHost, aliases = new Map<string, string>()): Promise<Result[]> {
  const results: Result[] = [];
  for (const command of commands) {
    const result: Result = { id: command.id };
    try {
      await applyOne(command, host, aliases, result);
    } catch (error) {
      result.error = String((error as Error)?.message ?? error).slice(0, 200);
    }
    results.push(result);
  }
  return results;
}

async function applyOne(command: Command, host: ApplyHost, aliases: Map<string, string>, result: Result): Promise<void> {
  const { payload } = command;
  if (command.kind === 'add') {
    const title = str(payload.title);
    const path = host.inboxPath();
    if (!title) return void (result.error = 'no title');
    if (!path) return void (result.error = 'no inbox note is set');
    const key = keyForNewTask(host.tasks(), path, title);
    if (!(await host.appendLine(path, lineForNewTask(payload)))) return void (result.error = 'the inbox note could not be written');
    result.key = key;
    if (typeof payload.key === 'string') {
      aliases.set(payload.key, key);
      result.from = payload.key;
    }
    await host.settled();
    return;
  }

  const wanted = str(payload.key);
  const key = wanted ? (aliases.get(wanted) ?? wanted) : undefined;
  const task = key ? keyTasks(host.tasks()).get(key) : undefined;
  if (!task) return void (result.error = 'the task is not in the notes any more');

  switch (command.kind) {
    case 'status': {
      const status = STATUS_MARKERS[String(payload.status)];
      if (!status) return void (result.error = 'unknown status');
      await host.setStatus(task, status);
      break;
    }
    case 'remind': {
      const value = payload.moment;
      if (value === 'off') await host.setRemind(task, null);
      else if (value === 'default') await host.setRemind(task, undefined);
      else {
        const at = moment(value);
        if (!at) return void (result.error = 'unreadable reminder');
        await host.setRemind(task, at);
      }
      break;
    }
    case 'plan': {
      if (payload.plan === null) await host.setSchedule(task, null);
      else {
        const schedule = plan(payload.plan);
        if (!schedule) return void (result.error = 'unreadable plan');
        await host.setSchedule(task, schedule);
      }
      break;
    }
    case 'delete':
      await host.deleteTask(task);
      break;
  }
  await host.settled();
}
