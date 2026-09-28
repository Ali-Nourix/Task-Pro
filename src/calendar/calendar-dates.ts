// ── calendar/calendar-dates.ts ────────────────────────────────────────────
// Date arithmetic and date text for the calendar, in both calendars TaskPro
// shows. Every day is carried as a Gregorian day key, `YYYY-MM-DD`, exactly as
// notes store dates; the Jalali calendar is a way of reading those keys, never
// a second kind of key. Pure, so it is tested without Obsidian.
// ─────────────────────────────────────────────────────────────────────────────

import { CalendarSystem, Language, TimeFormat, WeekStart } from '../types';
import { gregorianToJalali, jalaliToGregorian } from '../date-utils';

/** A day as `YYYY-MM-DD`, Gregorian. */
export type DayKey = string;

export interface DateParts {
  year: number;
  month: number;
  day: number;
}

const DAY_MS = 86_400_000;
const pad2 = (n: number) => String(n).padStart(2, '0');

export function dayKey(year: number, month: number, day: number): DayKey {
  return `${String(year).padStart(4, '0')}-${pad2(month)}-${pad2(day)}`;
}

export function toDayKey(date: Date): DayKey {
  return dayKey(date.getFullYear(), date.getMonth() + 1, date.getDate());
}

export function todayKey(now: Date = new Date()): DayKey {
  return toDayKey(now);
}

/** The key's parts, or null when it is not a real day. */
export function parseDayKey(key: string): DateParts | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!match) return null;
  const parts = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
  const check = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  if (check.getUTCMonth() !== parts.month - 1 || check.getUTCDate() !== parts.day) return null;
  return parts;
}

export function isDayKey(value: string): boolean {
  return parseDayKey(value) !== null;
}

// Days are counted on UTC midnights, so a daylight-saving change can never
// make a day 23 or 25 hours long and push a date off by one.
function utc(key: DayKey): number {
  const parts = parseDayKey(key);
  if (!parts) throw new Error(`Not a day: ${key}`);
  return Date.UTC(parts.year, parts.month - 1, parts.day);
}

function fromUtc(ms: number): DayKey {
  const date = new Date(ms);
  return dayKey(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

export function addDays(key: DayKey, days: number): DayKey {
  return fromUtc(utc(key) + days * DAY_MS);
}

/** Whole days from `from` to `to`; negative when `to` is earlier. */
export function daysBetween(from: DayKey, to: DayKey): number {
  return Math.round((utc(to) - utc(from)) / DAY_MS);
}

/** 0 is Sunday, as in `Date.getDay`. */
export function weekdayOf(key: DayKey): number {
  return new Date(utc(key)).getUTCDay();
}

export function compareDays(a: DayKey, b: DayKey): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

// ── One day, read in either calendar ─────────────────────────────────────────

export function partsIn(key: DayKey, system: CalendarSystem): DateParts {
  const parts = parseDayKey(key);
  if (!parts) throw new Error(`Not a day: ${key}`);
  if (system === 'gregorian') return parts;
  const [year, month, day] = gregorianToJalali(parts.year, parts.month, parts.day);
  return { year, month, day };
}

export function keyFrom(system: CalendarSystem, year: number, month: number, day: number): DayKey {
  if (system === 'gregorian') return dayKey(year, month, day);
  const [gy, gm, gd] = jalaliToGregorian(year, month, day);
  return dayKey(gy, gm, gd);
}

/** A (year, month) pair moved by whole months: month 13 is next year's first. */
export function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const index = year * 12 + (month - 1) + delta;
  return { year: Math.floor(index / 12), month: (((index % 12) + 12) % 12) + 1 };
}

/**
 * Days in a month. Measured as the distance to the next month's first day
 * rather than looked up, so Esfand's 29 or 30 days come from the same
 * conversion that draws the calendar and the two can never disagree.
 */
export function monthLength(system: CalendarSystem, year: number, month: number): number {
  const next = shiftMonth(year, month, 1);
  return daysBetween(keyFrom(system, year, month, 1), keyFrom(system, next.year, next.month, 1));
}

export function firstOfMonth(key: DayKey, system: CalendarSystem): DayKey {
  const parts = partsIn(key, system);
  return keyFrom(system, parts.year, parts.month, 1);
}

export function lastOfMonth(key: DayKey, system: CalendarSystem): DayKey {
  const parts = partsIn(key, system);
  return keyFrom(system, parts.year, parts.month, monthLength(system, parts.year, parts.month));
}

/** The same day of the month `delta` months on, or the month's last day when it is shorter. */
export function addMonths(key: DayKey, system: CalendarSystem, delta: number): DayKey {
  const parts = partsIn(key, system);
  const target = shiftMonth(parts.year, parts.month, delta);
  const day = Math.min(parts.day, monthLength(system, target.year, target.month));
  return keyFrom(system, target.year, target.month, day);
}

export function isSameMonth(a: DayKey, b: DayKey, system: CalendarSystem): boolean {
  const pa = partsIn(a, system);
  const pb = partsIn(b, system);
  return pa.year === pb.year && pa.month === pb.month;
}

// ── Weeks ────────────────────────────────────────────────────────────────────

/** The weekday a week starts on, as a `Date.getDay` number. */
export function resolveWeekStart(preference: WeekStart, system: CalendarSystem): number {
  switch (preference) {
    case 'saturday':
      return 6;
    case 'sunday':
      return 0;
    case 'monday':
      return 1;
    default:
      return system === 'jalali' ? 6 : 1;
  }
}

export function startOfWeek(key: DayKey, weekStartsOn: number): DayKey {
  return addDays(key, -((weekdayOf(key) - weekStartsOn + 7) % 7));
}

export function daysFrom(start: DayKey, count: number): DayKey[] {
  return Array.from({ length: count }, (_, i) => addDays(start, i));
}

export function weekOf(key: DayKey, weekStartsOn: number): DayKey[] {
  return daysFrom(startOfWeek(key, weekStartsOn), 7);
}

/**
 * The weeks a month view shows: whole weeks, from the one holding the
 * month's first day to the one holding its last. Four to six rows.
 */
export function monthWeeks(key: DayKey, system: CalendarSystem, weekStartsOn: number): DayKey[][] {
  const last = lastOfMonth(key, system);
  const weeks: DayKey[][] = [];
  for (let cursor = startOfWeek(firstOfMonth(key, system), weekStartsOn); compareDays(cursor, last) <= 0; cursor = addDays(cursor, 7)) {
    weeks.push(daysFrom(cursor, 7));
  }
  return weeks;
}

/** Friday in Iran; Saturday and Sunday on the Gregorian calendar. */
export function isWeekend(key: DayKey, system: CalendarSystem): boolean {
  const weekday = weekdayOf(key);
  return system === 'jalali' ? weekday === 5 : weekday === 0 || weekday === 6;
}

/** ISO 8601 week: weeks start on Monday and week 1 holds the year's first Thursday. */
export function isoWeek(key: DayKey): { year: number; week: number } {
  const thursday = addDays(key, 3 - ((weekdayOf(key) + 6) % 7));
  const year = parseDayKey(thursday)!.year;
  return { year, week: Math.floor(daysBetween(dayKey(year, 1, 1), thursday) / 7) + 1 };
}

// ── Names ────────────────────────────────────────────────────────────────────

export const MONTH_NAMES: Record<CalendarSystem, Record<Language, readonly string[]>> = {
  gregorian: {
    en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
    fa: ['ژانویه', 'فوریه', 'مارس', 'آوریل', 'مه', 'ژوئن', 'ژوئیه', 'اوت', 'سپتامبر', 'اکتبر', 'نوامبر', 'دسامبر'],
  },
  jalali: {
    en: ['Farvardin', 'Ordibehesht', 'Khordad', 'Tir', 'Mordad', 'Shahrivar', 'Mehr', 'Aban', 'Azar', 'Dey', 'Bahman', 'Esfand'],
    fa: ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'],
  },
};

/** Short month names. Persian month names are short already and stay whole. */
export const MONTH_NAMES_SHORT: Record<CalendarSystem, Record<Language, readonly string[]>> = {
  gregorian: {
    en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
    fa: MONTH_NAMES.gregorian.fa,
  },
  jalali: {
    en: ['Far', 'Ord', 'Kho', 'Tir', 'Mor', 'Sha', 'Meh', 'Aba', 'Aza', 'Dey', 'Bah', 'Esf'],
    fa: MONTH_NAMES.jalali.fa,
  },
};

/** Indexed by `Date.getDay`: Sunday first. */
export const WEEKDAY_NAMES: Record<Language, readonly string[]> = {
  en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
  fa: ['یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنج‌شنبه', 'جمعه', 'شنبه'],
};

export const WEEKDAY_NAMES_SHORT: Record<Language, readonly string[]> = {
  en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  fa: WEEKDAY_NAMES.fa,
};

/** One letter per day, as Persian calendars head their columns. */
export const WEEKDAY_NAMES_MIN: Record<Language, readonly string[]> = {
  en: ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'],
  fa: ['ی', 'د', 'س', 'چ', 'پ', 'ج', 'ش'],
};

function ordinal(day: number, language: Language): string {
  if (language === 'fa') return `${day}م`;
  const tens = day % 100;
  if (tens >= 11 && tens <= 13) return `${day}th`;
  return `${day}${['th', 'st', 'nd', 'rd'][day % 10] ?? 'th'}`;
}

// ── Formatting a day with a pattern ──────────────────────────────────────────
// The tokens are moment.js's, which is what Obsidian's own daily notes and the
// Periodic Notes plugin use, plus moment-jalaali's `j` tokens for the Jalali
// calendar. Text in square brackets is kept as it is: `[Week] W`.
const FORMAT_TOKEN =
  /\[([^\]]*)\]|jYYYY|jYY|jMMMM|jMMM|jMM|jM|jDo|jDD|jD|YYYY|YY|MMMM|MMM|MM|M|Do|DD|D|dddd|ddd|dd|d|GGGG|WW|W/g;

/**
 * A day written with a moment-style pattern. Month and weekday names are in
 * `language`: English or Persian.
 */
export function formatDay(key: DayKey, pattern: string, language: Language): string {
  const g = parseDayKey(key);
  if (!g) return '';
  const j = partsIn(key, 'jalali');
  const weekday = weekdayOf(key);

  return pattern.replace(FORMAT_TOKEN, (token: string, literal?: string) => {
    if (literal !== undefined) return literal;
    switch (token) {
      case 'YYYY':
        return String(g.year).padStart(4, '0');
      case 'YY':
        return pad2(g.year % 100);
      case 'MMMM':
        return MONTH_NAMES.gregorian[language][g.month - 1];
      case 'MMM':
        return MONTH_NAMES_SHORT.gregorian[language][g.month - 1];
      case 'MM':
        return pad2(g.month);
      case 'M':
        return String(g.month);
      case 'Do':
        return ordinal(g.day, language);
      case 'DD':
        return pad2(g.day);
      case 'D':
        return String(g.day);
      case 'jYYYY':
        return String(j.year).padStart(4, '0');
      case 'jYY':
        return pad2(j.year % 100);
      case 'jMMMM':
        return MONTH_NAMES.jalali[language][j.month - 1];
      case 'jMMM':
        return MONTH_NAMES_SHORT.jalali[language][j.month - 1];
      case 'jMM':
        return pad2(j.month);
      case 'jM':
        return String(j.month);
      case 'jDo':
        return ordinal(j.day, language);
      case 'jDD':
        return pad2(j.day);
      case 'jD':
        return String(j.day);
      case 'dddd':
        return WEEKDAY_NAMES[language][weekday];
      case 'ddd':
        return WEEKDAY_NAMES_SHORT[language][weekday];
      case 'dd':
        return WEEKDAY_NAMES_MIN[language][weekday];
      case 'd':
        return String(weekday);
      case 'GGGG':
        return String(isoWeek(key).year);
      case 'WW':
        return pad2(isoWeek(key).week);
      case 'W':
        return String(isoWeek(key).week);
      default:
        return token;
    }
  });
}

// ── Date text for the calendar's own labels ──────────────────────────────────

export function monthName(key: DayKey, system: CalendarSystem, language: Language, short = false): string {
  const names = short ? MONTH_NAMES_SHORT : MONTH_NAMES;
  return names[system][language][partsIn(key, system).month - 1];
}

/** "September 2026", "مهر 1405". */
export function monthTitle(key: DayKey, system: CalendarSystem, language: Language): string {
  return `${monthName(key, system, language)} ${partsIn(key, system).year}`;
}

/** "28 Sep", "6 مهر". */
export function shortDay(key: DayKey, system: CalendarSystem, language: Language): string {
  return `${partsIn(key, system).day} ${monthName(key, system, language, true)}`;
}

/** "Mon 28 Sep", "دوشنبه 6 مهر". */
export function mediumDay(key: DayKey, system: CalendarSystem, language: Language): string {
  return `${WEEKDAY_NAMES_SHORT[language][weekdayOf(key)]} ${shortDay(key, system, language)}`;
}

/** "Monday, 28 September 2026", "دوشنبه 6 مهر 1405". */
export function longDay(key: DayKey, system: CalendarSystem, language: Language): string {
  const parts = partsIn(key, system);
  const weekday = WEEKDAY_NAMES[language][weekdayOf(key)];
  const separator = language === 'fa' ? '، ' : ', ';
  return `${weekday}${separator}${parts.day} ${monthName(key, system, language)} ${parts.year}`;
}

/**
 * A span of days, naming a month or year only once when both ends share it:
 * "21 – 27 September 2026", "28 Sep – 4 Oct 2026", "6 – 12 مهر 1405".
 */
export function rangeTitle(from: DayKey, to: DayKey, system: CalendarSystem, language: Language): string {
  const a = partsIn(from, system);
  const b = partsIn(to, system);
  if (a.year === b.year && a.month === b.month) {
    return `${a.day} – ${b.day} ${monthName(from, system, language)} ${a.year}`;
  }
  if (a.year === b.year) {
    return `${a.day} ${monthName(from, system, language, true)} – ${b.day} ${monthName(to, system, language, true)} ${a.year}`;
  }
  return `${a.day} ${monthName(from, system, language, true)} ${a.year} – ${b.day} ${monthName(to, system, language, true)} ${b.year}`;
}

/** The months a span touches in one calendar: "Mehr – Aban 1405", "September 2026". */
export function monthSpan(from: DayKey, to: DayKey, system: CalendarSystem, language: Language): string {
  const a = partsIn(from, system);
  const b = partsIn(to, system);
  if (a.year === b.year && a.month === b.month) return monthTitle(from, system, language);
  if (a.year === b.year) return `${monthName(from, system, language)} – ${monthName(to, system, language)} ${a.year}`;
  return `${monthTitle(from, system, language)} – ${monthTitle(to, system, language)}`;
}

// ── Times of day ─────────────────────────────────────────────────────────────

/** `HH:mm` to minutes after midnight; `24:00` is 1440. Null for anything else. */
export function parseClock(value: string | undefined): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec((value ?? '').trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (minutes > 59 || hours > 24 || (hours === 24 && minutes > 0)) return null;
  return hours * 60 + minutes;
}

const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';

/**
 * A time as people type it: `9`, `930`, `0930`, `9:30`, `9.30`, `9:30 pm`,
 * `21:30`, `24:00`, in Latin, Persian or Arabic digits, with AM/PM or
 * ق.ظ/ب.ظ. Minutes after midnight, or null when it is not a time.
 */
export function parseTypedClock(value: string): number | null {
  const text = value
    .trim()
    .toLowerCase()
    .replace(/[۰-۹]/g, (d) => String(PERSIAN_DIGITS.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String(ARABIC_DIGITS.indexOf(d)));
  if (!text) return null;
  const pm = /p\.?\s*m\.?|ب\.?\s*ظ/.test(text);
  const am = /a\.?\s*m\.?|ق\.?\s*ظ/.test(text);
  const time = text.replace(/p\.?\s*m\.?|a\.?\s*m\.?|ب\.?\s*ظ\.?|ق\.?\s*ظ\.?/g, '').trim();

  let hours: number;
  let minutes: number;
  const separated = /^(\d{1,2})(?:\s*[:.٫]\s*(\d{1,2}))?$/.exec(time);
  const compact = /^(\d{1,2})(\d{2})$/.exec(time);
  if (separated) {
    hours = Number(separated[1]);
    minutes = separated[2] === undefined ? 0 : Number(separated[2]);
  } else if (compact) {
    hours = Number(compact[1]);
    minutes = Number(compact[2]);
  } else {
    return null;
  }

  if (pm || am) {
    if (hours < 1 || hours > 12) return null;
    if (pm && hours < 12) hours += 12;
    if (am && hours === 12) hours = 0;
  }
  if (minutes > 59 || hours > 24 || (hours === 24 && minutes > 0)) return null;
  return hours * 60 + minutes;
}

/** Minutes after midnight to `HH:mm`, the form markers store. */
export function toClock(minutes: number): string {
  const clamped = Math.max(0, Math.min(24 * 60, Math.round(minutes)));
  return `${pad2(Math.floor(clamped / 60))}:${pad2(clamped % 60)}`;
}

const MERIDIEM: Record<Language, [string, string]> = { en: ['AM', 'PM'], fa: ['ق.ظ', 'ب.ظ'] };

/** A time for people to read: `09:30`, or `9:30 AM` on a 12-hour clock. */
export function formatClock(minutes: number, format: TimeFormat, language: Language): string {
  if (format === '24h') return toClock(minutes);
  const total = Math.max(0, Math.min(24 * 60, Math.round(minutes)));
  const hours24 = Math.floor(total / 60) % 24;
  const hours = hours24 % 12 || 12;
  return `${hours}:${pad2(total % 60)} ${MERIDIEM[language][hours24 < 12 ? 0 : 1]}`;
}

/** An hour mark on the time grid: `09:00`, or `9 AM`. */
export function formatHour(hour: number, format: TimeFormat, language: Language): string {
  if (format === '24h') return `${pad2(hour % 24)}:00`;
  const hours24 = hour % 24;
  return `${hours24 % 12 || 12} ${MERIDIEM[language][hours24 < 12 ? 0 : 1]}`;
}

/** `09:00 – 10:30`. */
export function formatClockRange(start: number, end: number, format: TimeFormat, language: Language): string {
  return `${formatClock(start, format, language)} – ${formatClock(end, format, language)}`;
}
