// ── board/board-query.ts ──────────────────────────────────────────────────
// Filtering, sorting and grouping for the task board. Pure functions, so the
// behaviour is covered by tests without an Obsidian instance.
// ─────────────────────────────────────────────────────────────────────────────

import {
  BoardGroupBy,
  BoardPreferences,
  BoardSortDir,
  BoardSortKey,
  PRIORITY_RANK,
  TASK_PRIORITIES,
  TaskPriority,
  TaskProgress,
  TaskStatus,
} from '../types';
import { TaskTag } from '../tags';
import { BoardTask } from './task-store';

/** Status order used for grouping, board columns and sorting. */
export const BOARD_STATUS_ORDER: readonly TaskStatus[] = ['[ ]', '[/]', '[!]', '[x]'];

export type DeadlineBucket = 'overdue' | 'today' | 'week' | 'later' | 'past' | 'none';
export const DEADLINE_BUCKET_ORDER: readonly DeadlineBucket[] = ['overdue', 'today', 'week', 'later', 'past', 'none'];

export interface BoardGroup {
  /** Stable id for remembering collapsed groups: `<groupBy>:<value>`. */
  id: string;
  /** Raw value: a status, tag key, priority, bucket or note path; `''` for "none". */
  value: string;
  tasks: BoardTask[];
}

export interface QueryContext {
  tags: readonly TaskTag[];
  getProgress: (task: BoardTask) => TaskProgress | undefined;
  /** Midnight today, local time. Injected so tests do not drift with the calendar. */
  today: Date;
}

function startOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

/** Whole days from today to a `YYYY-MM-DD` deadline; negative when it has passed. */
export function daysUntil(deadline: string, today: Date): number | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(deadline);
  if (!match) return undefined;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Math.round((date.getTime() - startOfDay(today).getTime()) / 86_400_000);
}

export function deadlineBucket(task: BoardTask, today: Date): DeadlineBucket {
  if (!task.deadline) return 'none';
  const days = daysUntil(task.deadline, today);
  if (days === undefined) return 'none';
  if (days < 0) return task.status === '[x]' ? 'past' : 'overdue';
  if (days === 0) return 'today';
  if (days <= 7) return 'week';
  return 'later';
}

/** Title text for searching: the visible title plus the tags' display names. */
function searchableText(task: BoardTask, tags: readonly TaskTag[]): string {
  const names = task.tags.map((key) => tags.find((tag) => tag.key === key)?.name ?? key);
  return `${task.text} ${names.join(' ')} ${task.fileName}`.toLowerCase();
}

export function filterTasks(
  tasks: readonly BoardTask[],
  prefs: Pick<BoardPreferences, 'statuses' | 'priorities' | 'tags'>,
  search: string,
  context: Pick<QueryContext, 'tags'>
): BoardTask[] {
  const terms = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const statuses = new Set(prefs.statuses);
  const priorities = new Set(prefs.priorities);
  const tags = new Set(prefs.tags);

  return tasks.filter((task) => {
    if (statuses.size && !statuses.has(task.status)) return false;
    if (priorities.size && !priorities.has(task.priority ?? 'none')) return false;
    if (tags.size) {
      const matches = task.tags.length ? task.tags.some((key) => tags.has(key)) : tags.has('');
      if (!matches) return false;
    }
    if (terms.length) {
      const haystack = searchableText(task, context.tags);
      if (!terms.every((term) => haystack.includes(term))) return false;
    }
    return true;
  });
}

function compareDocument(a: BoardTask, b: BoardTask): number {
  return a.filePath.localeCompare(b.filePath) || a.lineNumber - b.lineNumber;
}

/**
 * Sorts a copy. Every key has a natural order (most urgent priority first,
 * soonest deadline first, least finished first); `desc` reverses it. Tasks
 * without a value always go last, whichever way the column is sorted, and ties
 * fall back to document order so a sort never shuffles equal rows.
 */
export function sortTasks(
  tasks: readonly BoardTask[],
  key: BoardSortKey,
  dir: BoardSortDir,
  context: Pick<QueryContext, 'getProgress' | 'today'>
): BoardTask[] {
  const sign = dir === 'desc' ? -1 : 1;
  const valueOf = (task: BoardTask): number | string | undefined => {
    switch (key) {
      case 'title':
        return task.text.toLowerCase();
      case 'status':
        return BOARD_STATUS_ORDER.indexOf(task.status);
      case 'priority':
        return task.priority ? -PRIORITY_RANK[task.priority] : undefined;
      case 'deadline':
        return task.deadline ? daysUntil(task.deadline, context.today) : undefined;
      case 'plan':
        return task.schedule ? `${task.schedule.date} ${task.schedule.start ?? '00:00'}` : undefined;
      case 'progress': {
        const progress = context.getProgress(task);
        return progress?.enabled ? progress.currentSteps / progress.totalSteps : undefined;
      }
      case 'note':
        return task.filePath.toLowerCase();
      default:
        return undefined;
    }
  };

  if (key === 'document') {
    const sorted = [...tasks].sort(compareDocument);
    return dir === 'desc' ? sorted.reverse() : sorted;
  }

  return [...tasks]
    .map((task) => ({ task, value: valueOf(task) }))
    .sort((a, b) => {
      if (a.value === undefined && b.value === undefined) return compareDocument(a.task, b.task);
      if (a.value === undefined) return 1;
      if (b.value === undefined) return -1;
      const diff =
        typeof a.value === 'string' && typeof b.value === 'string'
          ? a.value.localeCompare(b.value)
          : (a.value as number) - (b.value as number);
      return diff !== 0 ? diff * sign : compareDocument(a.task, b.task);
    })
    .map((entry) => entry.task);
}

/**
 * Splits already sorted tasks into groups, in a fixed order per grouping.
 * A task with two tags appears under both, as in a Notion multi-select board.
 * Empty groups are kept for statuses (so every board column exists) and
 * dropped elsewhere.
 */
export function groupTasks(
  tasks: readonly BoardTask[],
  groupBy: BoardGroupBy,
  context: Pick<QueryContext, 'tags' | 'today'>
): BoardGroup[] {
  const make = (value: string, list: BoardTask[]): BoardGroup => ({ id: `${groupBy}:${value}`, value, tasks: list });

  switch (groupBy) {
    case 'none':
      return [make('', [...tasks])];

    case 'status':
      return BOARD_STATUS_ORDER.map((status) => make(status, tasks.filter((task) => task.status === status)));

    case 'priority': {
      const order: Array<TaskPriority | ''> = [...TASK_PRIORITIES, ''];
      return order
        .map((priority) => make(priority, tasks.filter((task) => (task.priority ?? '') === priority)))
        .filter((group) => group.tasks.length);
    }

    case 'deadline':
      return DEADLINE_BUCKET_ORDER.map((bucket) =>
        make(bucket, tasks.filter((task) => deadlineBucket(task, context.today) === bucket))
      ).filter((group) => group.tasks.length);

    case 'tag': {
      const known = context.tags.map((tag) => tag.key);
      const unknown = Array.from(new Set(tasks.flatMap((task) => task.tags))).filter((key) => !known.includes(key));
      const keys = [...known, ...unknown.sort()];
      const groups = keys.map((key) => make(key, tasks.filter((task) => task.tags.includes(key))));
      groups.push(make('', tasks.filter((task) => task.tags.length === 0)));
      return groups.filter((group) => group.tasks.length);
    }

    case 'note': {
      const paths = Array.from(new Set(tasks.map((task) => task.filePath))).sort((a, b) => a.localeCompare(b));
      return paths.map((path) => make(path, tasks.filter((task) => task.filePath === path)));
    }
  }
}

/** Counts for the header summary. */
export function summarize(tasks: readonly BoardTask[], today: Date): { total: number; done: number; overdue: number } {
  let done = 0;
  let overdue = 0;
  for (const task of tasks) {
    if (task.status === '[x]') done++;
    else if (deadlineBucket(task, today) === 'overdue') overdue++;
  }
  return { total: tasks.length, done, overdue };
}
