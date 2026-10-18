// ── auto-plan.ts ──────────────────────────────────────────────────────────
// A task written without a plan is planned for the day it was written on.
//
// The Telegram bot's weekly list (and the calendar) place a task by its plan,
// `@schedule(...)`. A task typed into a note with no plan therefore never
// showed up there. Once TaskPro sees a task appear, it writes the day it
// appeared on as the task's plan, with no time: `@schedule(2026-10-08)`.
// With time tracking on, the moment it appeared is its start, and the moment
// it is ticked off becomes its end: `@schedule(2026-10-08 09:12-10:40)`.
//
// Pure, so it is tested without Obsidian.
// ─────────────────────────────────────────────────────────────────────────────

import { taskClockParts } from './task-clock';
import { extractSchedule, setSchedule } from './task-metadata';
import { parseTaskLine, taskKeyFor } from './task-identity';
import type { TaskSchedule, TaskStatus } from './types';

/** Today, or another moment, as the `YYYY-MM-DD` a plan is written with (local time). */
export function localDayKey(now: Date = new Date()): string {
  return taskClockParts(now.getTime()).date;
}

/** A moment as HH:mm in the configured scheduling zone. */
export function localClock(now: Date = new Date()): string {
  const minutes = taskClockParts(now.getTime()).minutes;
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/**
 * The line planned for `day` (and, given `start`, from that time) when it is
 * a new, open task with no plan yet; otherwise null. Done or failed tasks, and
 * tasks that already have a plan, are left as they are.
 */
export function planLineIfNew(line: string, filePath: string, newKeys: ReadonlySet<string>, day: string, start?: string): string | null {
  const parsed = parseTaskLine(line);
  if (!parsed || !parsed.text) return null;
  if (parsed.status !== '[ ]' && parsed.status !== '[/]') return null;
  if (!newKeys.has(taskKeyFor(filePath, parsed))) return null;
  if (extractSchedule(line)) return null;
  const schedule: TaskSchedule = start ? { date: day, start } : { date: day };
  const next = setSchedule(line, schedule);
  return next === line ? null : next;
}

const toMinutes = (clock: string): number => {
  const [h, m] = clock.split(':').map(Number);
  return h * 60 + m;
};
const fromMinutes = (total: number): string =>
  `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;

/**
 * The line with its plan closed at `end` when it is a task that was just
 * ticked off, planned for `day` with a start and no end; otherwise null.
 * An end in the same minute as the start becomes one minute after it, so the
 * plan stays a real block of time.
 */
export function finishLineIfDone(line: string, filePath: string, doneKeys: ReadonlySet<string>, day: string, end: string): string | null {
  const parsed = parseTaskLine(line);
  if (!parsed || parsed.status !== '[x]') return null;
  if (!doneKeys.has(taskKeyFor(filePath, parsed))) return null;
  const schedule = extractSchedule(line);
  if (!schedule || schedule.date !== day || !schedule.start || schedule.end) return null;
  const startAt = toMinutes(schedule.start);
  const endAt = Math.min(24 * 60, Math.max(toMinutes(end), startAt + 1));
  if (endAt <= startAt) return null;
  const next = setSchedule(line, { ...schedule, end: fromMinutes(endAt) });
  return next === line ? null : next;
}

/** Applies a line edit to every line of a note. Resolves the new content, or null when no line changed. */
export function editLines(content: string, edit: (line: string) => string | null): string | null {
  const lines = content.split('\n');
  let changed = false;
  for (let i = 0; i < lines.length; i++) {
    const next = edit(lines[i]);
    if (next !== null) {
      lines[i] = next;
      changed = true;
    }
  }
  return changed ? lines.join('\n') : null;
}

/**
 * Plans every new task in a note's content for `day`. Resolves the new
 * content, or null when nothing needed a plan.
 */
export function planNewTasksInContent(content: string, filePath: string, newKeys: ReadonlySet<string>, day: string, start?: string): string | null {
  if (!newKeys.size) return null;
  return editLines(content, (line) => planLineIfNew(line, filePath, newKeys, day, start));
}

/** Each task in a note, by key, with its status. */
export function taskStatuses(filePath: string, content: string): Map<string, TaskStatus> {
  const statuses = new Map<string, TaskStatus>();
  for (const line of content.split('\n')) {
    const parsed = parseTaskLine(line);
    if (!parsed) continue;
    const key = taskKeyFor(filePath, parsed);
    if (!statuses.has(key)) statuses.set(key, parsed.status);
  }
  return statuses;
}

/** The tasks that were open or in progress last time and are done now. */
export function completedTaskKeys(previous: ReadonlyMap<string, TaskStatus> | undefined, current: ReadonlyMap<string, TaskStatus>): string[] {
  if (!previous) return [];
  const done: string[] = [];
  for (const [key, status] of current) {
    const before = previous.get(key);
    if (status === '[x]' && (before === '[ ]' || before === '[/]')) done.push(key);
  }
  return done;
}

/**
 * Which of the keys that just appeared in a note are new tasks rather than
 * old ones whose text was edited. A task without a block ID is known by its
 * text, so editing it looks like one task leaving and another arriving. When
 * as many tasks left the note as arrived, the pass is taken as edits and
 * nothing is planned; otherwise the arrivals are new tasks.
 */
export function freshTaskKeys(previous: ReadonlySet<string> | undefined, current: readonly string[], appeared: readonly string[]): string[] {
  if (!previous || !appeared.length) return [];
  const now = new Set(current);
  let left = 0;
  for (const key of previous) if (!now.has(key)) left++;
  return appeared.length > left ? [...appeared] : [];
}

/** How long a task just written stays "being written": edits to it in that time still count as writing it. */
export const WRITING_WINDOW_MS = 2 * 60_000;

/**
 * The tasks written into a note since its last pass, from the task key on
 * each line then and now. A task is new when its key was not in the note
 * before, unless it took the place of an old task on the same line that is
 * now gone: that is the old task's text being edited, and it is left alone.
 * A task saved half typed ("Bu", then "Buy milk") is in `writing`, so
 * finishing it is still writing a new task, not editing an old one.
 * Without a last pass (`previous` undefined) nothing is new.
 */
export function writtenTaskKeys(
  previous: readonly (string | null)[] | undefined,
  current: readonly (string | null)[],
  writing: ReadonlySet<string> = new Set()
): string[] {
  if (!previous) return [];
  const before = new Set(previous.filter((key): key is string => key !== null));
  const now = new Set(current.filter((key): key is string => key !== null));
  const fresh: string[] = [];
  const seen = new Set<string>();
  current.forEach((key, index) => {
    if (key === null || before.has(key) || seen.has(key)) return;
    seen.add(key);
    const replaced = previous[index];
    const editedOld = replaced != null && !now.has(replaced) && !writing.has(replaced);
    if (!editedOld) fresh.push(key);
  });
  return fresh;
}
