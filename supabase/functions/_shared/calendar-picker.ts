// The month the bot draws as buttons, in the owner's calendar: Jalali or Gregorian,
// a Jalali week starting on Saturday. Pure, so it is tested without Telegram.

import { gregorianToJalali, jalaliToGregorian } from './jalali.ts';
import { isoDate, parseIso, weekdayOf } from './time.ts';
import type { CalendarKind, Language } from './types.ts';

export const JALALI_MONTHS = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'];
const GREGORIAN_MONTHS_FA = ['ژانویه', 'فوریه', 'مارس', 'آوریل', 'مه', 'ژوئن', 'ژوئیه', 'اوت', 'سپتامبر', 'اکتبر', 'نوامبر', 'دسامبر'];
const GREGORIAN_MONTHS_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** Weekday initials from Sunday (0) to Saturday (6). */
const INITIALS: Record<Language, string[]> = {
  fa: ['ی', 'د', 'س', 'چ', 'پ', 'ج', 'ش'],
  en: ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'],
};

export interface Month {
  /** "Mehr 1405". */
  year: number;
  month: number;
  /** The month before and after, as "year-month" in this calendar. */
  prev: string;
  next: string;
  /** Weekday initials in the order the columns are drawn. */
  header: string[];
  /** Days in the order the columns are drawn: an ISO date, or null for a blank. */
  weeks: (string | null)[][];
}

export const monthName = (system: CalendarKind, language: Language, month: number): string =>
  system === 'jalali' ? JALALI_MONTHS[month - 1] : (language === 'fa' ? GREGORIAN_MONTHS_FA : GREGORIAN_MONTHS_EN)[month - 1];

function parseKey(key: string): [number, number] | null {
  const match = /^(\d{3,4})-(\d{1,2})$/.exec(key);
  if (!match) return null;
  const month = Number(match[2]);
  return month >= 1 && month <= 12 ? [Number(match[1]), month] : null;
}

const step = (year: number, month: number, by: number): string => {
  const index = year * 12 + (month - 1) + by;
  return `${Math.floor(index / 12)}-${(index % 12) + 1}`;
};

/** The day `day` of a month of the calendar, as an ISO (Gregorian) date. */
export function dayOf(system: CalendarKind, year: number, month: number, day: number): string {
  if (system === 'gregorian') return isoDate(year, month, day);
  const [gy, gm, gd] = jalaliToGregorian(year, month, day);
  return isoDate(gy, gm, gd);
}

export function daysIn(system: CalendarKind, year: number, month: number): number {
  if (system === 'gregorian') return new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (month <= 6) return 31;
  if (month <= 11) return 30;
  // Esfand has a thirtieth day in a leap year: it exists when it converts back to Esfand.
  const [gy, gm, gd] = jalaliToGregorian(year, 12, 30);
  const [, jm] = gregorianToJalali(gy, gm, gd);
  return jm === 12 ? 30 : 29;
}

/** The "year-month" of the calendar that a date falls in. */
export function monthKeyOf(system: CalendarKind, date: string): string {
  const [y, m, d] = parseIso(date);
  if (system === 'gregorian') return `${y}-${m}`;
  const [jy, jm] = gregorianToJalali(y, m, d);
  return `${jy}-${jm}`;
}

/** A date as the calendar numbers it: year, month, day. */
export function partsOf(system: CalendarKind, date: string): [number, number, number] {
  const [y, m, d] = parseIso(date);
  return system === 'gregorian' ? [y, m, d] : gregorianToJalali(y, m, d);
}

/**
 * One month as rows of seven. A Jalali week starts on Saturday, a Gregorian one
 * on Monday; for Persian the row is turned round so the first day is at the right.
 */
export function buildMonth(key: string, system: CalendarKind, language: Language, fallback: string): Month {
  const [year, month] = parseKey(key) ?? (parseKey(fallback) as [number, number]);
  const first = dayOf(system, year, month, 1);
  const startOffset = system === 'jalali' ? (weekdayOf(first) + 1) % 7 : (weekdayOf(first) + 6) % 7;
  const cells: (string | null)[] = Array(startOffset).fill(null);
  for (let day = 1; day <= daysIn(system, year, month); day++) cells.push(dayOf(system, year, month, day));
  while (cells.length % 7) cells.push(null);

  const order = system === 'jalali' ? [6, 0, 1, 2, 3, 4, 5] : [1, 2, 3, 4, 5, 6, 0];
  let header = order.map((weekday) => INITIALS[language][weekday]);
  const weeks: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  if (language === 'fa') {
    header = header.reverse();
    for (const week of weeks) week.reverse();
  }
  return { year, month, prev: step(year, month, -1), next: step(year, month, 1), header, weeks };
}
