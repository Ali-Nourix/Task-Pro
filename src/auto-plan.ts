// ── auto-plan.ts ──────────────────────────────────────────────────────────
// A task written without a plan is planned for the day it was written on.
//
// The Telegram bot's weekly list (and the calendar) place a task by its plan,
// `@schedule(...)`. A task typed into a note with no plan therefore never
// showed up there. Once TaskPro sees a task appear, it writes the day it
// appeared on as the task's plan, with no time: `@schedule(2026-10-08)`.
//
// Pure, so it is tested without Obsidian.
// ─────────────────────────────────────────────────────────────────────────────

import { extractSchedule, setSchedule } from './task-metadata';
import { parseTaskLine, taskKeyFor } from './task-identity';

/** Today, or another moment, as the `YYYY-MM-DD` a plan is written with (local time). */
export function localDayKey(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * The line planned for `day` when it is a new, open task with no plan yet;
 * otherwise null. Done or failed tasks, and tasks that already have a plan,
 * are left as they are.
 */
export function planLineIfNew(line: string, filePath: string, newKeys: ReadonlySet<string>, day: string): string | null {
  const parsed = parseTaskLine(line);
  if (!parsed || !parsed.text) return null;
  if (parsed.status !== '[ ]' && parsed.status !== '[/]') return null;
  if (!newKeys.has(taskKeyFor(filePath, parsed))) return null;
  if (extractSchedule(line)) return null;
  const next = setSchedule(line, { date: day });
  return next === line ? null : next;
}

/**
 * Plans every new task in a note's content for `day`. Resolves the new
 * content, or null when nothing needed a plan.
 */
export function planNewTasksInContent(content: string, filePath: string, newKeys: ReadonlySet<string>, day: string): string | null {
  if (!newKeys.size) return null;
  const lines = content.split('\n');
  let changed = false;
  for (let i = 0; i < lines.length; i++) {
    const next = planLineIfNew(lines[i], filePath, newKeys, day);
    if (next !== null) {
      lines[i] = next;
      changed = true;
    }
  }
  return changed ? lines.join('\n') : null;
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
