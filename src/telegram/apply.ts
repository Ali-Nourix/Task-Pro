// ── telegram/apply.ts ─────────────────────────────────────────────────────
// Makes the changes asked for in Telegram in the notes: a new task into the
// inbox, a tick, a reminder, a plan, an edit of the task's own settings (title,
// priority, deadline, tags, repeat), a deletion. Each is answered with what
// happened, so the bot can tell the owner when one could not be made.
// ─────────────────────────────────────────────────────────────────────────────

import type { BoardTask } from '../board/task-store';
import { RemindAt, normalizeTagKey, setDeadline, setPriority, setRemind, setSchedule, setTags } from '../task-metadata';
import type { TaskPriority, TaskRepeat, TaskSchedule, TaskStatus } from '../types';
import { keyForNewTask, keyTasks } from './snapshot';

export interface Command {
  id: string;
  kind: 'add' | 'status' | 'remind' | 'plan' | 'edit' | 'delete';
  payload: Record<string, unknown>;
}

export interface Result {
  id: string;
  /** For an added task, or one renamed: the key it has in the notes. */
  key?: string;
  /** The key the bot knew it by, which later commands may still use. */
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
  /**
   * Where a task for a day goes (that day's note, or the inbox when the settings
   * say so), and writing it there. Absent, new tasks always go to the inbox.
   */
  dayTarget?(day: string): string | null;
  addTaskOnDay?(day: string, line: string): Promise<string | null>;
  setStatus(task: BoardTask, status: TaskStatus): Promise<void>;
  setRemind(task: BoardTask, value: RemindAt | null | undefined): Promise<void>;
  setSchedule(task: BoardTask, schedule: TaskSchedule | null): Promise<void>;
  setPriority(task: BoardTask, priority: TaskPriority | null): Promise<void>;
  setDeadline(task: BoardTask, deadline: string | null): Promise<void>;
  setTags(task: BoardTask, keys: string[]): Promise<void>;
  setRepeat(task: BoardTask, repeat: TaskRepeat | null): Promise<void>;
  setText(task: BoardTask, text: string): Promise<void>;
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

function repeatOf(value: unknown): TaskRepeat | null {
  if (typeof value !== 'string') return null;
  const match = /^(\d{1,3})([dwm])$/.exec(value);
  if (!match || Number(match[1]) < 1) return null;
  return { every: Number(match[1]), unit: { d: 'day', w: 'week', m: 'month' }[match[2]] as TaskRepeat['unit'] };
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
    if (!title) return void (result.error = 'no title');
    const day = str(payload.day);
    const line = lineForNewTask(payload);
    const before = host.tasks();
    let path: string | null = null;
    // A task made for a day goes into that day's note, as one added on the calendar would.
    if (day && DAY.test(day) && host.addTaskOnDay && host.dayTarget?.(day)) {
      path = await host.addTaskOnDay(day, line);
      if (!path) return void (result.error = "the day's note could not be written");
    } else {
      path = host.inboxPath();
      if (!path) return void (result.error = 'no inbox note is set');
      if (!(await host.appendLine(path, line))) return void (result.error = 'the inbox note could not be written');
    }
    result.key = keyForNewTask(before, path, title);
    if (typeof payload.key === 'string') {
      aliases.set(payload.key, result.key);
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
    case 'edit': {
      await applyEdit(task, key!, payload, host, result);
      return;
    }
    case 'delete':
      await host.deleteTask(task);
      break;
  }
  await host.settled();
}

/**
 * Changes a task's own settings, one after the other. Each edit rewrites the
 * line, so the task is found again (by its place in the note) before the next.
 * A new title changes the key a task is known by, which is reported back.
 */
async function applyEdit(task: BoardTask, before: string, payload: Record<string, unknown>, host: ApplyHost, result: Result): Promise<void> {
  let current = task;
  const next = async () => {
    await host.settled();
    current = host.tasks().find((candidate) => candidate.filePath === task.filePath && candidate.lineNumber === task.lineNumber) ?? current;
  };

  if ('priority' in payload) {
    const priority = str(payload.priority);
    if (payload.priority !== null && !(priority && PRIORITIES.has(priority))) return void (result.error = 'unknown priority');
    await host.setPriority(current, payload.priority === null ? null : (priority as TaskPriority));
    await next();
  }
  if ('deadline' in payload) {
    const deadline = str(payload.deadline);
    if (payload.deadline !== null && !(deadline && DAY.test(deadline))) return void (result.error = 'unreadable deadline');
    await host.setDeadline(current, payload.deadline === null ? null : (deadline as string));
    await next();
  }
  if ('tags' in payload) {
    if (!Array.isArray(payload.tags)) return void (result.error = 'unreadable tags');
    const keys = payload.tags.filter((tag): tag is string => typeof tag === 'string').map(normalizeTagKey).filter(Boolean);
    await host.setTags(current, keys);
    await next();
  }
  if ('repeat' in payload) {
    const repeat = payload.repeat === null ? null : repeatOf(payload.repeat);
    if (payload.repeat !== null && !repeat) return void (result.error = 'unreadable repeat');
    await host.setRepeat(current, repeat);
    await next();
  }
  if ('title' in payload) {
    const title = str(payload.title)?.replace(/\s+/g, ' ').trim();
    if (!title) return void (result.error = 'no title');
    await host.setText(current, title);
    await next();
  }

  const after = [...keyTasks(host.tasks())].find(([, candidate]) => candidate.filePath === task.filePath && candidate.lineNumber === task.lineNumber)?.[0];
  if (after && before !== after) {
    result.from = before;
    result.key = after;
  }
}
