// Reads a line typed into the bot, in Persian or English, into a task:
//
//   خرید نان فردا ساعت ۹ #خانه !بالا
//   call the vet tomorrow 9:30-10 #health !high
//   یادم بنداز ۲۰ دقیقه دیگه چایی رو بردارم
//   submit report due friday
//
// A day or a time on its own is a plan; behind "remind" / «یادآوری» /
// «یادم بنداز» it is a reminder; behind "due" / «مهلت» it is a deadline.
// What is not understood stays in the title, so nothing typed is lost.

import { jalaliToGregorian } from './jalali.ts';
import { addDays, clockMinutes, isRealDate, isoDate, pad2, toClock, weekdayOf } from './time.ts';

export type Priority = 'highest' | 'high' | 'medium' | 'low' | 'lowest';

export interface Plan {
  date: string;
  start?: string;
  end?: string;
}

export interface Moment {
  date: string;
  time: string;
}

export interface Parsed {
  title: string;
  priority?: Priority;
  tags: string[];
  deadline?: string;
  plan?: Plan;
  remind?: Moment;
}

export interface Clock {
  /** Today in the owner's zone. */
  today: string;
  /** Minutes since midnight there. */
  minutes: number;
}

type Role = 'plan' | 'remind' | 'due';

interface Group {
  role?: Role;
  date?: string;
  start?: number;
  end?: number;
  /** Counted from now ("in 20 minutes"): date and start are already worked out. */
  relative?: boolean;
  first: number;
  last: number;
}

const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';

/** Digits to ASCII, Arabic letters to their Persian forms, joiners and marks gone, lower case. */
export function normalize(text: string): string {
  return text
    .replace(/[۰-۹]/g, (digit) => String(PERSIAN_DIGITS.indexOf(digit)))
    .replace(/[٠-٩]/g, (digit) => String(ARABIC_DIGITS.indexOf(digit)))
    .replace(/ي/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/[‌‍ً-ٟ]/g, '')
    .toLowerCase();
}

const EDGE = /^[«"'`(\[]+|[»"'`)\],.،؛;!؟?]+$/g;

const TODAY = new Set(['today', 'امروز']);
const TOMORROW = new Set(['tomorrow', 'tmrw', 'tmr', 'فردا']);
const AFTER_TOMORROW = new Set(['پسفردا']);

const WEEKDAYS: Record<string, number> = {
  sunday: 0, sun: 0, یکشنبه: 0,
  monday: 1, mon: 1, دوشنبه: 1,
  tuesday: 2, tue: 2, tues: 2, سهشنبه: 2,
  wednesday: 3, wed: 3, چهارشنبه: 3,
  thursday: 4, thu: 4, thur: 4, thurs: 4, پنجشنبه: 4,
  friday: 5, fri: 5, جمعه: 5,
  saturday: 6, sat: 6, شنبه: 6,
};

const PRIORITIES: Record<string, Priority> = {
  highest: 'highest', urgent: 'highest', فوری: 'highest', خیلیمهم: 'highest', بحرانی: 'highest',
  high: 'high', بالا: 'high', مهم: 'high', زیاد: 'high',
  medium: 'medium', متوسط: 'medium', معمولی: 'medium',
  low: 'low', کم: 'low', پایین: 'low',
  lowest: 'lowest', خیلیکم: 'lowest',
};

const REMIND_WORDS = new Set(['remind', 'reminder', 'remindme', 'یادآوری', 'یادآور', 'یادم']);
const DUE_WORDS = new Set(['due', 'deadline', 'مهلت', 'ددلاین', 'موعد']);
const LATER = new Set(['دیگه', 'دیگر', 'بعد', 'later']);
const PM_WORDS = new Set(['عصر', 'بعدازظهر', 'شب', 'pm']);
const AM_WORDS = new Set(['صبح', 'am']);
const MINUTE_UNITS = new Set(['دقیقه', 'min', 'mins', 'minute', 'minutes']);
const HOUR_UNITS = new Set(['ساعت', 'hour', 'hours', 'hr', 'hrs']);
const DAY_UNITS = new Set(['روز', 'day', 'days']);

interface Token {
  raw: string;
  n: string;
}

function tokenize(text: string): Token[] {
  return text
    .split(/\s+/)
    .filter(Boolean)
    .map((raw) => ({ raw, n: normalize(raw).replace(EDGE, '') }));
}

/** A year in the Jalali range reads as Jalali; others as Gregorian. */
function dayFromWords(n: string): string | null {
  const match = /^(\d{3,4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(n);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (year >= 1300 && year < 1700) {
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    const [gy, gm, gd] = jalaliToGregorian(year, month, day);
    const date = isoDate(gy, gm, gd);
    return isRealDate(date) ? date : null;
  }
  const date = isoDate(year, month, day);
  return isRealDate(date) ? date : null;
}

function nextWeekday(today: string, weekday: number): string {
  const ahead = ((weekday - weekdayOf(today) + 7) % 7) || 7;
  return addDays(today, ahead);
}

/** "9", "9:30", "9pm" as minutes; a bare number needs `sure` (something said it is a time). */
function clockFromWords(n: string, sure: boolean): { minutes: number; period?: 'am' | 'pm' } | null {
  const match = /^(\d{1,2})(?::(\d{2}))?(am|pm)?$/.exec(n);
  if (!match) return null;
  if (!sure && match[2] === undefined && !match[3]) return null;
  const hours = Number(match[1]);
  const minutes = match[2] === undefined ? 0 : Number(match[2]);
  if (minutes > 59 || hours > 24) return null;
  const period = match[3] as 'am' | 'pm' | undefined;
  if (period && (hours < 1 || hours > 12)) return null;
  return { minutes: applyPeriod(hours, minutes, period), period };
}

function applyPeriod(hours: number, minutes: number, period?: 'am' | 'pm'): number {
  let h = hours;
  if (period === 'pm' && h < 12) h += 12;
  if (period === 'am' && h === 12) h = 0;
  return Math.min(h * 60 + minutes, 24 * 60);
}

/** "شب", "عصر" and "pm" move an hour before noon to the evening; «۱۲ شب» is midnight. */
function applyWord(minutes: number, word: string): number {
  if (PM_WORDS.has(word)) {
    if (word === 'شب' && Math.floor(minutes / 60) === 12) return minutes - 12 * 60;
    if (minutes < 12 * 60) return minutes + 12 * 60;
  }
  if (AM_WORDS.has(word) && Math.floor(minutes / 60) === 12) return minutes - 12 * 60;
  return minutes;
}

export function parseQuickAdd(text: string, clock: Clock): Parsed {
  const tokens = tokenize(text);
  const used = new Array<boolean>(tokens.length).fill(false);
  const take = (from: number, to: number) => {
    for (let i = from; i <= to; i++) used[i] = true;
  };

  let priority: Priority | undefined;
  const tags: string[] = [];
  const groups: Group[] = [];
  const intents: Array<{ role: Role; at: number }> = [];

  let current: Group | null = null;
  const touch = (first: number, last: number): Group => {
    // Adjacent date and time words are one group; anything between starts another.
    if (current && first <= current.last + 1) {
      current.last = last;
      return current;
    }
    current = { first, last };
    groups.push(current);
    return current;
  };

  const at = (i: number) => (i < tokens.length ? tokens[i].n : '');

  for (let i = 0; i < tokens.length; i++) {
    const { raw, n } = tokens[i];

    if (raw.startsWith('#') && raw.length > 1) {
      tags.push(raw.slice(1).replace(EDGE, ''));
      take(i, i);
      continue;
    }
    if (raw.startsWith('!') && raw.length > 1) {
      const level = PRIORITIES[n.replace(/^!+/, '')];
      if (level) {
        priority = level;
        take(i, i);
        continue;
      }
    }

    // Intent words; «یادم بنداز» is two words.
    if (REMIND_WORDS.has(n)) {
      const end = n === 'یادم' && at(i + 1) === 'بنداز' ? i + 1 : n === 'یادم' ? -1 : i;
      if (end !== -1) {
        intents.push({ role: 'remind', at: i });
        take(i, end);
        i = end;
        continue;
      }
    }
    if (DUE_WORDS.has(n)) {
      intents.push({ role: 'due', at: i });
      take(i, i);
      continue;
    }
    // «تا» before a day is a deadline: «تا جمعه».
    if (n === 'تا' && dateAt(tokens, i + 1, clock.today)) {
      intents.push({ role: 'due', at: i });
      take(i, i);
      continue;
    }

    // "in 20 minutes", «۲۰ دقیقه دیگه», «۲ ساعت دیگه», «۳ روز دیگه».
    const relative = relativeAt(tokens, i, clock);
    if (relative) {
      const group = touch(i, i + relative.length - 1);
      group.date = relative.date;
      group.start = relative.minutes;
      group.relative = relative.minutes !== undefined;
      if (relative.minutes === undefined) group.relative = false;
      take(i, i + relative.length - 1);
      i += relative.length - 1;
      continue;
    }

    const day = dateAt(tokens, i, clock.today);
    if (day) {
      const group = touch(i, i + day.length - 1);
      group.date = day.date;
      take(i, i + day.length - 1);
      i += day.length - 1;
      continue;
    }

    // «فردا ۹»: a bare hour straight after a day, ending the phrase, is a time.
    const afterDay = current !== null && (current as Group).last === i - 1 && (current as Group).date !== undefined;
    const time = timeAt(tokens, i, afterDay);
    if (time) {
      const group = touch(i, i + time.length - 1);
      group.start = time.start;
      if (time.end !== undefined) group.end = time.end;
      take(i, i + time.length - 1);
      i += time.length - 1;
      continue;
    }
  }

  // Each intent word belongs to the group after it, or else the one before it.
  for (const intent of intents) {
    const after = groups.find((group) => group.first > intent.at && group.role === undefined);
    const before = [...groups].reverse().find((group) => group.last < intent.at && group.role === undefined);
    const target = after ?? before;
    if (target) target.role = intent.role;
  }

  const out: Parsed = {
    title: tokens
      .filter((_, i) => !used[i])
      .map((token) => token.raw)
      .join(' ')
      .trim(),
    tags,
  };
  if (priority) out.priority = priority;

  const tomorrow = addDays(clock.today, 1);
  for (const group of groups) {
    const role = group.role ?? (group.relative ? 'remind' : 'plan');
    if (group.date === undefined && group.start === undefined) continue;
    if (role === 'due') {
      out.deadline = group.date ?? clock.today;
      continue;
    }
    // A time with no day is today's, or tomorrow's once it has gone by.
    const date = group.date ?? (group.start !== undefined && group.start <= clock.minutes ? tomorrow : clock.today);
    if (role === 'remind') {
      out.remind = { date, time: toClock(Math.min(group.start ?? 9 * 60, 23 * 60 + 59)) };
    } else {
      const plan: Plan = { date };
      if (group.start !== undefined && group.start < 24 * 60) {
        plan.start = toClock(group.start);
        if (group.end !== undefined && group.end > group.start && group.end <= 24 * 60) {
          plan.end = group.end === 24 * 60 ? '23:59' : toClock(group.end);
        }
      }
      out.plan = plan;
    }
  }
  return out;
}

/** A day named at a token: how many tokens it takes, and which day. */
function dateAt(tokens: Token[], i: number, today: string): { date: string; length: number } | null {
  if (i >= tokens.length) return null;
  const n = tokens[i].n;
  const next = i + 1 < tokens.length ? tokens[i + 1].n : '';
  if (TODAY.has(n)) return { date: today, length: 1 };
  if (TOMORROW.has(n)) return { date: addDays(today, 1), length: 1 };
  if (AFTER_TOMORROW.has(n)) return { date: addDays(today, 2), length: 1 };
  if (n === 'پس' && TOMORROW.has(next)) return { date: addDays(today, 2), length: 2 };
  if (n in WEEKDAYS) return { date: nextWeekday(today, WEEKDAYS[n]), length: 1 };
  if (n === 'next' && next === 'week') return { date: addDays(today, 7), length: 2 };
  if ((n === 'هفته' || n === 'هفتهی') && (next === 'بعد' || next === 'آینده')) return { date: addDays(today, 7), length: 2 };
  if (n === 'هفتهبعد') return { date: addDays(today, 7), length: 1 };
  const iso = dayFromWords(n);
  return iso ? { date: iso, length: 1 } : null;
}

/** "in 20 min", «۲۰ دقیقه دیگه», «۲ ساعت دیگه»; "in 3 days", «۳ روز دیگه». */
function relativeAt(
  tokens: Token[],
  i: number,
  clock: Clock
): { date: string; minutes?: number; length: number } | null {
  const lead = tokens[i].n === 'in';
  const numberAt = lead ? i + 1 : i;
  if (numberAt >= tokens.length || !/^\d{1,4}$/.test(tokens[numberAt].n)) return null;
  const amount = Number(tokens[numberAt].n);
  const unit = numberAt + 1 < tokens.length ? tokens[numberAt + 1].n : '';
  const later = numberAt + 2 < tokens.length && LATER.has(tokens[numberAt + 2].n);
  // Without "in" or a word after it, «۲ ساعت» alone is not a time from now.
  if (!lead && !later) return null;
  const length = (lead ? 1 : 0) + 2 + (later ? 1 : 0);
  if (MINUTE_UNITS.has(unit) || /^m$/.test(unit) || HOUR_UNITS.has(unit) || /^h$/.test(unit)) {
    const minutes = amount * (HOUR_UNITS.has(unit) || unit === 'h' ? 60 : 1);
    const total = clock.minutes + minutes;
    const date = addDays(clock.today, Math.floor(total / (24 * 60)));
    return { date, minutes: total % (24 * 60), length };
  }
  if (DAY_UNITS.has(unit)) return { date: addDays(clock.today, amount), length };
  return null;
}

/** A time (or a range of times) at a token, with the words around it: «ساعت ۹ شب», "at 9pm". */
function timeAt(tokens: Token[], i: number, afterDay = false): { start: number; end?: number; length: number } | null {
  let cursor = i;
  let period: string | undefined;
  let sure = false;

  if (PM_WORDS.has(tokens[cursor].n) || AM_WORDS.has(tokens[cursor].n)) {
    if (!(cursor + 1 < tokens.length && (tokens[cursor + 1].n === 'ساعت' || /^\d/.test(tokens[cursor + 1].n)))) return null;
    if (tokens[cursor].n === 'pm' || tokens[cursor].n === 'am') return null;
    period = tokens[cursor].n;
    cursor++;
    sure = true;
  }
  if (tokens[cursor].n === 'ساعت' || tokens[cursor].n === 'at') {
    cursor++;
    sure = true;
  }
  if (cursor >= tokens.length) return null;

  // A range written as one word: 9-10:30.
  const joined = /^(\d{1,2}(?::\d{2})?)-(\d{1,2}(?::\d{2})?)$/.exec(tokens[cursor].n);
  if (joined && (sure || afterDay || joined[1].includes(':') || joined[2].includes(':'))) {
    const a = clockFromWords(joined[1], true);
    const b = clockFromWords(joined[2], true);
    if (a && b) return finish(a.minutes, b.minutes, cursor - i + 1, tokens, cursor + 1, period);
  }

  const following = cursor + 1 < tokens.length ? tokens[cursor + 1].n : '';
  const endsPhrase =
    !following || following === 'تا' || following === 'to' || following === '-' || PM_WORDS.has(following) || AM_WORDS.has(following) || /^[#!]./.test(following);
  const first = clockFromWords(tokens[cursor].n, sure || (afterDay && endsPhrase));
  if (!first) return null;
  let length = cursor - i + 1;
  let start = first.minutes;
  let end: number | undefined;

  // A range spread over words: 9 تا 10, 9 to 10.
  const connector = cursor + 1 < tokens.length ? tokens[cursor + 1].n : '';
  if ((connector === 'تا' || connector === 'to' || connector === '-') && cursor + 2 < tokens.length) {
    const second = clockFromWords(tokens[cursor + 2].n, true);
    if (second && second.minutes > start) {
      end = second.minutes;
      length += 2;
      cursor += 2;
    }
  }
  return finish(start, end, length, tokens, cursor + 1, period);
}

/** Takes a period word after the time, and applies one from before it. */
function finish(
  start: number,
  end: number | undefined,
  length: number,
  tokens: Token[],
  after: number,
  before?: string
): { start: number; end?: number; length: number } {
  let word = before;
  let size = length;
  if (!word && after < tokens.length && (PM_WORDS.has(tokens[after].n) || AM_WORDS.has(tokens[after].n)) && tokens[after].n !== 'pm' && tokens[after].n !== 'am') {
    word = tokens[after].n;
    size++;
  }
  if (word) {
    start = applyWord(start, word);
    if (end !== undefined) end = applyWord(end, word);
  }
  const out: { start: number; end?: number; length: number } = { start, length: size };
  if (end !== undefined) out.end = end;
  return out;
}

export { clockMinutes, pad2 };
