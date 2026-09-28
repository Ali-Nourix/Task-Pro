// ── calendar/calendar-items.ts ────────────────────────────────────────────
// What the calendar shows on each day, and where timed tasks sit in a day's
// column. Pure functions over board tasks, so the rules are tested without a
// DOM.
//
// A task appears on a day for one of three reasons, in this order:
//  1. it is scheduled for that day, `@schedule(...)`;
//  2. it has no schedule and lives in that day's daily note;
//  3. it is due that day, `@due(...)`. A task already on its due day for one
//     of the reasons above carries a due flag there instead of a second item.
// ─────────────────────────────────────────────────────────────────────────────

import { PRIORITY_RANK, TaskSchedule } from '../types';
import { BoardTask } from '../board/task-store';
import { DayKey, compareDays, parseClock } from './calendar-dates';

/**
 * `scheduled`, `note` and `due` are the three reasons above; `free` is an
 * unscheduled task in the side list, on no day yet.
 */
export type CalendarItemKind = 'scheduled' | 'note' | 'due' | 'free';

export interface CalendarItem {
  /** Unique within one render. */
  id: string;
  kind: CalendarItemKind;
  task: BoardTask;
  /** Empty for a `free` item. */
  day: DayKey;
  /** Minutes after midnight, on a scheduled item with a time. */
  start?: number;
  end?: number;
  /** Also due on this day. */
  dueHere?: boolean;
}

export interface CollectOptions {
  from: DayKey;
  to: DayKey;
  showDeadlines: boolean;
  showNoteTasks: boolean;
  showDone: boolean;
  /** Minutes given to a scheduled start that has no end. */
  defaultDuration: number;
  /** The day a note is the daily note of, for the notes in range. */
  noteDay: (path: string) => DayKey | undefined;
}

const DAY_MINUTES = 24 * 60;

/** A schedule's time as minutes after midnight, or null for a day with no time. */
export function scheduleMinutes(schedule: TaskSchedule, defaultDuration: number): { start: number; end: number } | null {
  const start = parseClock(schedule.start);
  if (start === null) return null;
  const end = parseClock(schedule.end);
  return { start, end: end !== null && end > start ? end : Math.min(DAY_MINUTES, start + defaultDuration) };
}

function inRange(day: DayKey, from: DayKey, to: DayKey): boolean {
  return compareDays(day, from) >= 0 && compareDays(day, to) <= 0;
}

const KIND_ORDER: Record<CalendarItemKind, number> = { scheduled: 0, note: 1, free: 2, due: 3 };

/**
 * Day order: untimed plans first (as a calendar lists all-day events), then
 * timed ones from morning to evening, then deadlines. Ties go to open tasks,
 * then the more urgent priority, then the order of the notes.
 */
export function compareItems(a: CalendarItem, b: CalendarItem): number {
  const group = (item: CalendarItem) => (item.kind === 'due' ? 2 : item.start !== undefined ? 1 : 0);
  return (
    group(a) - group(b) ||
    (a.start ?? 0) - (b.start ?? 0) ||
    (b.end ?? 0) - (b.start ?? 0) - ((a.end ?? 0) - (a.start ?? 0)) ||
    KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
    Number(a.task.status === '[x]') - Number(b.task.status === '[x]') ||
    (b.task.priority ? PRIORITY_RANK[b.task.priority] : 0) - (a.task.priority ? PRIORITY_RANK[a.task.priority] : 0) ||
    a.task.filePath.localeCompare(b.task.filePath) ||
    a.task.lineNumber - b.task.lineNumber
  );
}

/** Every item from `from` to `to`, both included, by day and in day order. */
export function collectItems(tasks: readonly BoardTask[], options: CollectOptions): Map<DayKey, CalendarItem[]> {
  const byDay = new Map<DayKey, CalendarItem[]>();
  const push = (item: CalendarItem) => {
    const list = byDay.get(item.day);
    if (list) list.push(item);
    else byDay.set(item.day, [item]);
  };

  for (const task of tasks) {
    if (!options.showDone && task.status === '[x]') continue;

    let placed: CalendarItem | undefined;
    if (task.schedule) {
      if (inRange(task.schedule.date, options.from, options.to)) {
        const time = scheduleMinutes(task.schedule, options.defaultDuration);
        placed = { id: `scheduled:${task.id}`, kind: 'scheduled', task, day: task.schedule.date, ...time };
      }
    } else if (options.showNoteTasks) {
      const day = options.noteDay(task.filePath);
      if (day && inRange(day, options.from, options.to)) {
        placed = { id: `note:${task.id}`, kind: 'note', task, day };
      }
    }
    if (placed) push(placed);

    if (options.showDeadlines && task.deadline && inRange(task.deadline, options.from, options.to)) {
      if (placed && placed.day === task.deadline) placed.dueHere = true;
      else push({ id: `due:${task.id}`, kind: 'due', task, day: task.deadline });
    }
  }

  for (const list of byDay.values()) list.sort(compareItems);
  return byDay;
}

/**
 * Open tasks with no schedule that are not already on the calendar by their
 * note: the list a plan is dragged out of. Soonest deadline first, then the
 * most urgent, then note order.
 */
export function unscheduledTasks(
  tasks: readonly BoardTask[],
  isOnCalendar: (task: BoardTask) => boolean
): BoardTask[] {
  return tasks
    .filter((task) => task.status !== '[x]' && !task.schedule && !isOnCalendar(task))
    .sort(
      (a, b) =>
        (a.deadline ?? '9999').localeCompare(b.deadline ?? '9999') ||
        (b.priority ? PRIORITY_RANK[b.priority] : 0) - (a.priority ? PRIORITY_RANK[a.priority] : 0) ||
        a.filePath.localeCompare(b.filePath) ||
        a.lineNumber - b.lineNumber
    );
}

export interface PlacedBlock {
  item: CalendarItem;
  /** Column within the overlap group, from the start edge. */
  lane: number;
  /** Columns the overlap group is split into. */
  lanes: number;
}

/**
 * Side-by-side columns for timed items that overlap, the way calendars lay
 * out clashing events. Items that overlap each other, directly or through a
 * chain, share one group and split its width; each takes the first column
 * that is free by its start. Very short items count as `minMinutes` long, so
 * two back-to-back 5-minute items do not draw over each other.
 */
export function layoutBlocks(items: readonly CalendarItem[], minMinutes = 20): PlacedBlock[] {
  const timed = items
    .filter((item) => item.start !== undefined && item.end !== undefined)
    .sort((a, b) => a.start! - b.start! || b.end! - b.start! - (a.end! - a.start!));

  const placed: PlacedBlock[] = [];
  let group: PlacedBlock[] = [];
  let laneEnds: number[] = [];
  let groupEnd = -1;

  const closeGroup = () => {
    for (const block of group) block.lanes = laneEnds.length;
    group = [];
    laneEnds = [];
    groupEnd = -1;
  };

  for (const item of timed) {
    const start = item.start!;
    const end = Math.max(item.end!, start + minMinutes);
    if (group.length && start >= groupEnd) closeGroup();

    let lane = laneEnds.findIndex((laneEnd) => laneEnd <= start);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(end);
    } else {
      laneEnds[lane] = end;
    }

    const block: PlacedBlock = { item, lane, lanes: 1 };
    group.push(block);
    placed.push(block);
    groupEnd = Math.max(groupEnd, end);
  }
  closeGroup();

  return placed;
}
