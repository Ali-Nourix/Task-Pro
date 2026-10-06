// Which day a task belongs to, and how a day's tasks are put in order. Shared by the lists,
// the week and day screens and the messages the ticker sends.

import { addDays } from './time.ts';
import { utcToLocal } from './time.ts';
import type { TaskRow } from './types.ts';

export type Bucket = 'overdue' | 'today' | 'tomorrow' | 'later' | 'none';

/** Late: past its deadline, or past its plan with no deadline to wait for. */
export function isOverdue(task: TaskRow, today: string): boolean {
  return (!!task.deadline && task.deadline < today) || (!!task.plan_date && task.plan_date < today && !task.deadline);
}

/** Whether a day is the day a task is planned, due or reminded on. */
export function onDay(task: TaskRow, day: string, zone: string): boolean {
  if (task.plan_date === day || task.deadline === day) return true;
  return !!task.remind_at && utcToLocal(zone, new Date(task.remind_at)).date === day;
}

export const isToday = (task: TaskRow, today: string, zone: string): boolean => onDay(task, today, zone);

export function bucketOf(task: TaskRow, today: string, zone: string): Bucket {
  if (isOverdue(task, today)) return 'overdue';
  if (isToday(task, today, zone)) return 'today';
  const date = task.plan_date ?? task.deadline;
  if (!date) return 'none';
  return date === addDays(today, 1) ? 'tomorrow' : 'later';
}

/** By day and hour, then by number. */
export function byPlan(a: TaskRow, b: TaskRow): number {
  const left = `${a.plan_date ?? a.deadline ?? '9999'} ${a.plan_start ?? ''}`;
  const right = `${b.plan_date ?? b.deadline ?? '9999'} ${b.plan_start ?? ''}`;
  return left === right ? a.n - b.n : left < right ? -1 : 1;
}

/** One day's tasks in the order of the day: with an hour first, by the hour; then the rest. */
export function byHour(a: TaskRow, b: TaskRow): number {
  const left = a.plan_start ?? '99:99';
  const right = b.plan_start ?? '99:99';
  return left === right ? a.n - b.n : left < right ? -1 : 1;
}
