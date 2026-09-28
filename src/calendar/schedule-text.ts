// ── calendar/schedule-text.ts ─────────────────────────────────────────────
// A task's schedule as people read it: "Today, 09:00 – 10:30",
// "Mon 28 Sep", "دوشنبه 6 مهر، 09:00". Shared by the chip in a note, the
// task menu and the calendar.

import { CalendarSystem, Language, TaskSchedule, TimeFormat } from '../types';
import { daysBetween, formatClock, formatClockRange, mediumDay, parseClock, todayKey } from './calendar-dates';

const RELATIVE: Record<Language, Record<'-1' | '0' | '1', string>> = {
  en: { '-1': 'Yesterday', '0': 'Today', '1': 'Tomorrow' },
  fa: { '-1': 'دیروز', '0': 'امروز', '1': 'فردا' },
};

export interface ScheduleTextOptions {
  language: Language;
  calendarSystem: CalendarSystem;
  timeFormat: TimeFormat;
  /** `YYYY-MM-DD`; injected by tests. */
  today?: string;
}

/** The day part: Yesterday, Today or Tomorrow near today, else "Mon 28 Sep". */
export function scheduleDayText(date: string, options: ScheduleTextOptions): string {
  const offset = daysBetween(options.today ?? todayKey(), date);
  if (offset >= -1 && offset <= 1) return RELATIVE[options.language][String(offset) as '-1' | '0' | '1'];
  return mediumDay(date, options.calendarSystem, options.language);
}

/** The time part, or an empty string for a plan with no time. */
export function scheduleTimeText(schedule: TaskSchedule, options: ScheduleTextOptions): string {
  const start = parseClock(schedule.start);
  if (start === null) return '';
  const end = parseClock(schedule.end);
  return end !== null && end > start
    ? formatClockRange(start, end, options.timeFormat, options.language)
    : formatClock(start, options.timeFormat, options.language);
}

export function scheduleText(schedule: TaskSchedule, options: ScheduleTextOptions): string {
  const day = scheduleDayText(schedule.date, options);
  const time = scheduleTimeText(schedule, options);
  if (!time) return day;
  return `${day}${options.language === 'fa' ? '، ' : ', '}${time}`;
}

/** Whether the plan's day has gone by; a past plan on an open task is worth noticing. */
export function isSchedulePast(schedule: TaskSchedule, today = todayKey()): boolean {
  return daysBetween(today, schedule.date) < 0;
}
