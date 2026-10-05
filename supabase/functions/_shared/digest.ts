// The messages the bot sends by itself: a morning summary, an evening review, a nudge before
// a deadline. Each is a screen like the others: HTML for the classic message, Markdown for the
// rich one, and the buttons under it.

import { byHour, isOverdue, onDay } from './agenda.ts';
import { dayLabel, digits, taskEntry, taskEntryRich, truncate, words } from './texts.ts';
import { htmlToRich } from './rich.ts';
import { addDays } from './time.ts';
import type { Button, OwnerRow, TaskRow } from './types.ts';

export interface Outgoing {
  text: string;
  rich: string;
  buttons: Button[][];
}

type Owner = Pick<OwnerRow, 'language' | 'calendar' | 'timezone'>;

/** Tasks listed in full in a message; the rest are counted. */
const SHOWN = 6;

const RANK: Record<string, number> = { highest: 0, high: 1, medium: 2, low: 3, lowest: 4 };
const rank = (task: TaskRow): number => (task.priority ? RANK[task.priority] : 2.5);

const entries = (tasks: TaskRow[], owner: Owner, today: string): { html: string; rich: string; more: number } => {
  const shown = tasks.slice(0, SHOWN);
  return {
    html: shown.map((task) => taskEntry(task, owner, today, { position: task.n })).join('\n'),
    rich: shown.map((task) => taskEntryRich(task, owner, today, { position: task.n })).join('\n'),
    more: tasks.length - shown.length,
  };
};

/** A block of tasks under a heading: the quote in the classic message, a task list in the rich one. */
function block(heading: string, tasks: TaskRow[], owner: Owner, today: string): { html: string; rich: string } {
  const list = entries(tasks, owner, today);
  const more = list.more > 0 ? `\n${words(owner.language).digest.more(list.more)}` : '';
  return {
    html: `${heading ? `${heading}\n` : ''}<blockquote>${list.html}</blockquote>${more}`,
    rich: `${heading ? `${htmlToRich(heading)}\n\n` : ''}${list.rich}${list.more > 0 ? `\n\n${htmlToRich(words(owner.language).digest.more(list.more))}` : ''}`,
  };
}

/** What to start with among what has no hour: late first, then what is due today, by priority. */
export function startWith(tasks: TaskRow[], today: string): TaskRow[] {
  return tasks
    .filter((task) => task.plan_date !== today && (isOverdue(task, today) || task.deadline === today || task.status === 'doing'))
    .sort((a, b) => Number(isOverdue(b, today)) - Number(isOverdue(a, today)) || rank(a) - rank(b) || a.n - b.n)
    .slice(0, 3);
}

const rows = (...groups: Button[][]): Button[][] => groups.filter((row) => row.length);

export function briefMessage(owner: Owner, tasks: TaskRow[], today: string, ai: boolean): Outgoing {
  const w = words(owner.language);
  const planned = tasks.filter((task) => task.plan_date === today).sort(byHour);
  const due = tasks.filter((task) => task.deadline === today);
  const overdue = tasks.filter((task) => isOverdue(task, today));
  const first = startWith(tasks, today);
  const head = w.digest.brief.title(dayLabel(today, owner, today));
  const counts = w.digest.brief.counts({ today: planned.length, deadline: due.length, overdue: overdue.length });
  const parts = [{ html: `${head}${counts ? `\n${counts}` : ''}`, rich: `${htmlToRich(head)}${counts ? `\n\n${htmlToRich(counts)}` : ''}` }];
  if (planned.length) parts.push(block(w.digest.brief.planned, planned, owner, today));
  if (first.length) parts.push(block(w.digest.brief.first, first, owner, today));
  if (!planned.length && !first.length) parts.push({ html: w.digest.brief.empty, rich: w.digest.brief.empty });
  const buttons = rows(
    [{ text: w.digest.buttons.today, data: 'ls:t:0', style: 'primary' }, { text: w.digest.buttons.week, data: 'wk:0' }],
    ai ? [{ text: w.digest.buttons.planDay, data: 'pd' }] : []
  );
  return { text: parts.map((part) => part.html).join('\n\n'), rich: parts.map((part) => part.rich).join('\n\n'), buttons };
}

export function reviewMessage(owner: Owner, tasks: TaskRow[], today: string): Outgoing {
  const w = words(owner.language);
  const tomorrow = addDays(today, 1);
  const left = tasks.filter((task) => task.plan_date === today).sort(byHour);
  const overdue = tasks.filter((task) => isOverdue(task, today));
  const planned = tasks.filter((task) => onDay(task, tomorrow, owner.timezone)).length;
  const head = w.digest.review.title(dayLabel(today, owner, today));
  const summary = left.length
    ? `<blockquote>${[w.digest.review.left(left.length), overdue.length ? w.digest.review.overdue(overdue.length) : ''].filter(Boolean).join('\n')}</blockquote>`
    : w.digest.review.allDone;
  const parts = [{ html: `${head}\n${summary}`, rich: `${htmlToRich(head)}\n\n${htmlToRich(summary)}` }];
  if (left.length) parts.push(block('', left, owner, today));
  const tomorrowLine = w.digest.review.tomorrow(planned);
  parts.push({ html: tomorrowLine, rich: htmlToRich(tomorrowLine) });
  const buttons = rows(
    left.length ? [{ text: w.digest.review.moveButton(left.length), data: 'mv', style: 'primary' }] : [],
    [{ text: w.digest.buttons.tomorrow, data: `dy:${tomorrow}` }, { text: w.digest.buttons.week, data: 'wk:0' }],
    overdue.length ? [{ text: `${w.digest.buttons.overdue} ${digits(overdue.length, owner.language)}`, data: 'ls:o:0', style: 'danger' }] : []
  );
  return { text: parts.map((part) => part.html).join('\n\n').replace(/\n\n\n+/g, '\n\n'), rich: parts.map((part) => part.rich).join('\n\n'), buttons };
}

/** The tasks due tomorrow (`eve`) or today (`morn`), as one message with a button for each. */
export function nudgeMessage(owner: Owner, tasks: TaskRow[], today: string, when: 'eve' | 'morn'): Outgoing {
  const w = words(owner.language);
  const day = when === 'eve' ? addDays(today, 1) : today;
  const due = tasks.filter((task) => task.deadline === day).sort((a, b) => rank(a) - rank(b) || a.n - b.n);
  const head = (when === 'eve' ? w.digest.nudge.eve : w.digest.nudge.morn)(due.length);
  const list = block(head, due, owner, today);
  const buttons = due.slice(0, 6).map((task): Button[] => [{ text: `${digits(task.n, owner.language)} · ${truncate(task.title, 40)}`, data: `t:${task.n}` }]);
  return { text: list.html, rich: list.rich, buttons };
}

/** The tasks a nudge would list: those due on a day. */
export const dueOn = (tasks: TaskRow[], day: string): TaskRow[] => tasks.filter((task) => task.deadline === day);
