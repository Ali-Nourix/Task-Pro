// ── calendar/calendar-localization.ts ─────────────────────────────────────
// Text for the calendar layout of the task board.

import { CalendarSystem, CalendarView, Language } from '../types';

export interface CalendarLabels {
  layout: string;
  views: Record<CalendarView, string>;
  systems: Record<CalendarSystem, string>;
  today: string;
  previous: string;
  next: string;
  allDay: string;
  week: (week: number) => string;
  unscheduled: string;
  unscheduledHint: string;
  noUnscheduled: string;
  nothingPlanned: string;
  more: (count: number) => string;
  addOn: (day: string) => string;
  newTask: string;
  searchOrCreate: string;
  create: (text: string) => string;
  existing: string;
  scheduledAt: (when: string) => string;
  addsTo: (note: string) => string;
  createsNote: (note: string) => string;
  pickerHint: string;
  date: string;
  from: string;
  to: string;
  due: string;
  dueHere: string;
  inDailyNote: string;
  notPlanned: string;
  unschedule: string;
  openNote: string;
  openDailyNote: string;
  moreActions: string;
  editTitle: string;
  viewOptions: string;
  showDeadlines: string;
  showDailyNotes: string;
  showDone: string;
  sidebar: string;
  scheduledNotice: (when: string) => string;
  unscheduledNotice: string;
  addedTo: (note: string) => string;
  addFailed: string;
  invalidDate: string;
  invalidTime: string;
  noSchedulingHost: string;
}

const EN: CalendarLabels = {
  layout: 'Calendar',
  views: { month: 'Month', week: 'Week', day: 'Day', agenda: 'Agenda' },
  systems: { gregorian: 'Gregorian', jalali: 'Jalali' },
  today: 'Today',
  previous: 'Previous',
  next: 'Next',
  allDay: 'All day',
  week: (week) => `W${week}`,
  unscheduled: 'Unscheduled',
  unscheduledHint: 'Drag a task onto the calendar to plan it.',
  noUnscheduled: 'Every open task has a place on the calendar.',
  nothingPlanned: 'Nothing planned',
  more: (count) => `${count} more`,
  addOn: (day) => `Add a task on ${day}`,
  newTask: 'New task',
  searchOrCreate: 'Type a new task, or find one…',
  create: (text) => `Create “${text}”`,
  existing: 'Plan an existing task',
  scheduledAt: (when) => `Planned · ${when}`,
  addsTo: (note) => `Goes into ${note}`,
  createsNote: (note) => `Creates ${note}`,
  pickerHint: '↵ create · esc close',
  date: 'Date',
  from: 'From',
  to: 'To',
  due: 'Due',
  dueHere: 'Also due this day',
  inDailyNote: 'In this day’s note',
  notPlanned: 'Not planned yet',
  unschedule: 'Remove from calendar',
  openNote: 'Open in note',
  openDailyNote: 'Open the daily note',
  moreActions: 'All actions',
  editTitle: 'Click to edit',
  viewOptions: 'View options',
  showDeadlines: 'Show deadlines',
  showDailyNotes: 'Show tasks from daily notes',
  showDone: 'Show done tasks',
  sidebar: 'Unscheduled tasks',
  scheduledNotice: (when) => `Planned for ${when}`,
  unscheduledNotice: 'Taken off the calendar',
  addedTo: (note) => `Task added to ${note}`,
  addFailed: 'The task could not be added',
  invalidDate: 'That is not a date',
  invalidTime: 'The end has to be after the start',
  noSchedulingHost: 'Scheduling is not available here',
};

const FA: CalendarLabels = {
  layout: 'تقویم',
  views: { month: 'ماه', week: 'هفته', day: 'روز', agenda: 'فهرست' },
  systems: { gregorian: 'میلادی', jalali: 'شمسی' },
  today: 'امروز',
  previous: 'قبلی',
  next: 'بعدی',
  allDay: 'تمام روز',
  week: (week) => `هفته ${week}`,
  unscheduled: 'بدون زمان',
  unscheduledHint: 'برای برنامه‌ریزی، تسک را روی تقویم بکشید.',
  noUnscheduled: 'همه تسک‌های باز جایی روی تقویم دارند.',
  nothingPlanned: 'برنامه‌ای نیست',
  more: (count) => `${count} مورد دیگر`,
  addOn: (day) => `افزودن تسک در ${day}`,
  newTask: 'تسک جدید',
  searchOrCreate: 'تسک تازه بنویسید یا یکی را پیدا کنید…',
  create: (text) => `ساختن «${text}»`,
  existing: 'برنامه‌ریزی تسک موجود',
  scheduledAt: (when) => `برنامه · ${when}`,
  addsTo: (note) => `در ${note} نوشته می‌شود`,
  createsNote: (note) => `${note} ساخته می‌شود`,
  pickerHint: '↵ ساختن · esc بستن',
  date: 'تاریخ',
  from: 'از',
  to: 'تا',
  due: 'سررسید',
  dueHere: 'سررسیدش هم همین روز است',
  inDailyNote: 'در یادداشت همین روز',
  notPlanned: 'هنوز برنامه‌ریزی نشده',
  unschedule: 'برداشتن از تقویم',
  openNote: 'باز کردن در یادداشت',
  openDailyNote: 'باز کردن یادداشت روزانه',
  moreActions: 'همه کارها',
  editTitle: 'برای ویرایش کلیک کنید',
  viewOptions: 'گزینه‌های نمایش',
  showDeadlines: 'نمایش سررسیدها',
  showDailyNotes: 'نمایش تسک‌های یادداشت روزانه',
  showDone: 'نمایش تسک‌های انجام‌شده',
  sidebar: 'تسک‌های بدون زمان',
  scheduledNotice: (when) => `برنامه‌ریزی شد: ${when}`,
  unscheduledNotice: 'از تقویم برداشته شد',
  addedTo: (note) => `تسک به ${note} اضافه شد`,
  addFailed: 'تسک اضافه نشد',
  invalidDate: 'این تاریخ درست نیست',
  invalidTime: 'پایان باید بعد از شروع باشد',
  noSchedulingHost: 'برنامه‌ریزی اینجا در دسترس نیست',
};

export function getCalendarLabels(language: Language): CalendarLabels {
  return language === 'fa' ? FA : EN;
}
