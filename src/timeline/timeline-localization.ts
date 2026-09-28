// ── timeline/timeline-localization.ts ─────────────────────────────────────
// The timeline layout's words, in English and Persian.

import type { Language } from '../types';

export type TimelineZoom = 'day' | 'week' | 'month';

export interface TimelineLabels {
  layout: string;
  task: string;
  zooms: Record<TimelineZoom, string>;
  today: string;
  previous: string;
  next: string;
  undated: (count: number) => string;
  planOnDay: string;
  jumpTo: string;
  plan: string;
  deadline: string;
  late: string;
  waitingOn: string;
  empty: string;
  hint: string;
}

const EN: TimelineLabels = {
  layout: 'Timeline',
  task: 'Task',
  zooms: { day: 'Days', week: 'Weeks', month: 'Months' },
  today: 'Today',
  previous: 'Earlier',
  next: 'Later',
  undated: (count) => (count === 1 ? '1 task with no dates' : `${count} tasks with no dates`),
  planOnDay: 'Click a day to plan it',
  jumpTo: 'Show it',
  plan: 'Plan',
  deadline: 'Deadline',
  late: 'Due before it is planned',
  waitingOn: 'Waiting on',
  empty: 'Nothing is planned or due. Tasks with a plan or a deadline show here.',
  hint: 'Drag a bar to move it; drag its start to change the plan, its end to change the deadline.',
};

const FA: TimelineLabels = {
  layout: 'خط زمانی',
  task: 'تسک',
  zooms: { day: 'روز', week: 'هفته', month: 'ماه' },
  today: 'امروز',
  previous: 'قبل‌تر',
  next: 'بعدتر',
  undated: (count) => `${count} تسک بدون تاریخ`,
  planOnDay: 'روی یک روز بزنید تا برای آن برنامه‌ریزی شود',
  jumpTo: 'نشان بده',
  plan: 'برنامه',
  deadline: 'سررسید',
  late: 'سررسید پیش از برنامه است',
  waitingOn: 'منتظرِ',
  empty: 'هیچ تسکی برنامه یا سررسید ندارد. تسک‌هایی که برنامه یا سررسید دارند اینجا می‌آیند.',
  hint: 'نوار را بکشید تا جابه‌جا شود؛ سرِ آن برنامه را و تهِ آن سررسید را عوض می‌کند.',
};

export function getTimelineLabels(language: Language): TimelineLabels {
  return language === 'fa' ? FA : EN;
}
