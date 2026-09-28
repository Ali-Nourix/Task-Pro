// ── timeline/timeline-model.ts ────────────────────────────────────────────
// What the timeline draws, worked out from the tasks alone: each task's span
// from its plan to its deadline, and the rows in the order they are shown,
// families kept together with a parent's bar spanning its subtasks.
// ─────────────────────────────────────────────────────────────────────────────

import type { BoardTask } from '../board/task-store';
import { compareDays, type DayKey } from '../calendar/calendar-dates';

export type SpanKind = 'span' | 'day' | 'milestone';

export interface TaskSpan {
  start: DayKey;
  /** The last day it covers, inclusive. */
  end: DayKey;
  /**
   * span: planned, and due on a later day; day: a single day, planned or
   * both on the same day; milestone: only a deadline, drawn as a diamond.
   */
  kind: SpanKind;
  /** A deadline before the plan: the bar is the plan, and this day is flagged. */
  late?: DayKey;
}

/** From the plan's day to the deadline; a deadline alone is a milestone. Null with neither. */
export function taskSpan(task: Pick<BoardTask, 'schedule' | 'deadline'>): TaskSpan | null {
  const plan = task.schedule?.date;
  const due = task.deadline;
  if (plan && due) {
    const order = compareDays(plan, due);
    if (order < 0) return { start: plan, end: due, kind: 'span' };
    if (order === 0) return { start: plan, end: plan, kind: 'day' };
    return { start: plan, end: plan, kind: 'day', late: due };
  }
  if (plan) return { start: plan, end: plan, kind: 'day' };
  if (due) return { start: due, end: due, kind: 'milestone' };
  return null;
}

export interface TimelineRow {
  task: BoardTask;
  depth: number;
  span: TaskSpan | null;
  /** For a parent: from the first of its family's days to the last. */
  summary?: { start: DayKey; end: DayKey };
  hasChildren: boolean;
}

export interface TimelineModel {
  rows: TimelineRow[];
  /** Tasks with no plan and no deadline, in note order. */
  undated: BoardTask[];
}

/**
 * The rows: every task with a date, and each one's ancestors so its family
 * stays together, parents before their subtasks, each level by its first
 * day. `tasks` is what the board shows; `all` supplies ancestors a filter
 * left out.
 */
export function buildTimeline(tasks: readonly BoardTask[], all: readonly BoardTask[]): TimelineModel {
  const byId = new Map(all.map((task) => [task.id, task]));
  for (const task of tasks) byId.set(task.id, task);
  const spans = new Map<string, TaskSpan>();
  const included = new Set<string>();
  const undated: BoardTask[] = [];

  for (const task of tasks) {
    const span = taskSpan(task);
    if (!span) continue;
    spans.set(task.id, span);
    for (let t: BoardTask | undefined = task; t && !included.has(t.id); t = t.parentId ? byId.get(t.parentId) : undefined) {
      included.add(t.id);
    }
  }
  for (const task of tasks) if (!included.has(task.id)) undated.push(task);

  const children = new Map<string, BoardTask[]>();
  const roots: BoardTask[] = [];
  for (const id of included) {
    const task = byId.get(id)!;
    const parent = task.parentId && included.has(task.parentId) ? task.parentId : null;
    if (parent) {
      const list = children.get(parent);
      if (list) list.push(task);
      else children.set(parent, [task]);
    } else {
      roots.push(task);
    }
  }

  // A family's days: its own and every descendant's.
  const extent = new Map<string, { start: DayKey; end: DayKey }>();
  const measure = (task: BoardTask): { start: DayKey; end: DayKey } | null => {
    const own = spans.get(task.id);
    let range = own ? { start: own.start, end: own.late && compareDays(own.late, own.end) > 0 ? own.late : own.end } : null;
    for (const child of children.get(task.id) ?? []) {
      const sub = measure(child);
      if (!sub) continue;
      if (!range) range = { ...sub };
      else {
        if (compareDays(sub.start, range.start) < 0) range.start = sub.start;
        if (compareDays(sub.end, range.end) > 0) range.end = sub.end;
      }
    }
    if (range) extent.set(task.id, range);
    return range;
  };
  roots.forEach(measure);

  const byStart = (a: BoardTask, b: BoardTask) => {
    const ea = extent.get(a.id);
    const eb = extent.get(b.id);
    if (ea && eb) {
      const order = compareDays(ea.start, eb.start) || compareDays(ea.end, eb.end);
      if (order) return order;
    }
    return a.filePath.localeCompare(b.filePath) || a.lineNumber - b.lineNumber;
  };

  const rows: TimelineRow[] = [];
  const walk = (task: BoardTask, depth: number) => {
    const kids = (children.get(task.id) ?? []).sort(byStart);
    rows.push({
      task,
      depth,
      span: spans.get(task.id) ?? null,
      summary: kids.length ? extent.get(task.id) : undefined,
      hasChildren: kids.length > 0,
    });
    for (const kid of kids) walk(kid, depth + 1);
  };
  roots.sort(byStart).forEach((root) => walk(root, 0));
  return { rows, undated };
}
