// How the bot writes: dates, tasks and every sentence, in Persian and English.

import { gregorianToJalali } from './jalali.ts';
import { daysBetween, parseIso, utcToLocal, weekdayOf } from './time.ts';
import type { Button, Language, OwnerRow, TaskRow } from './types.ts';

const PERSIAN = '۰۱۲۳۴۵۶۷۸۹';

/** Digits as the language writes them. */
export function digits(text: string | number, language: Language): string {
  const s = String(text);
  return language === 'fa' ? s.replace(/\d/g, (d) => PERSIAN[Number(d)]) : s;
}

const JALALI_MONTHS = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'];
const GREGORIAN_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const FA_WEEKDAYS = ['یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه', 'شنبه'];
const EN_WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

type Owner = Pick<OwnerRow, 'language' | 'calendar' | 'timezone'>;

/** "Today", "Tomorrow", or a weekday and date in the owner's calendar. */
export function dayLabel(date: string, owner: Owner, today: string): string {
  const language = owner.language;
  const offset = daysBetween(today, date);
  if (offset === 0) return language === 'fa' ? 'امروز' : 'Today';
  if (offset === 1) return language === 'fa' ? 'فردا' : 'Tomorrow';
  if (offset === -1) return language === 'fa' ? 'دیروز' : 'Yesterday';
  const [y, m, d] = parseIso(date);
  const weekday = (language === 'fa' ? FA_WEEKDAYS : EN_WEEKDAYS)[weekdayOf(date)];
  if (owner.calendar === 'jalali') {
    const [, jm, jd] = gregorianToJalali(y, m, d);
    return `${weekday} ${digits(jd, language)} ${JALALI_MONTHS[jm - 1]}`;
  }
  return language === 'fa' ? `${weekday} ${digits(d, language)} ${GREGORIAN_MONTHS[m - 1]}` : `${weekday} ${d} ${GREGORIAN_MONTHS[m - 1]}`;
}

export function clockLabel(time: string, language: Language): string {
  return digits(time, language);
}

const PRIORITY_MARK: Record<string, string> = { highest: '🔴', high: '🟠', medium: '🟡', low: '🔵', lowest: '⚪' };

/** One task as two short lines: its number and title, then what is set on it. */
export function taskLines(task: TaskRow, owner: Owner, today: string, now: Date): string[] {
  const language = owner.language;
  const mark = task.status === 'doing' ? '🔄' : task.pending ? '🕓' : '⬜';
  const priority = task.priority ? ` ${PRIORITY_MARK[task.priority]}` : '';
  const head = `#${digits(task.n, language)} ${mark} ${task.title}${priority}`;
  const parts: string[] = [];
  if (task.plan_date) {
    let plan = `📅 ${dayLabel(task.plan_date, owner, today)}`;
    if (task.plan_start) plan += ` ${clockLabel(task.plan_start, language)}${task.plan_end ? `–${clockLabel(task.plan_end, language)}` : ''}`;
    parts.push(plan);
  }
  if (task.deadline) parts.push(`${language === 'fa' ? '⏳ مهلت' : '⏳ due'} ${dayLabel(task.deadline, owner, today)}`);
  if (task.remind_at) {
    const at = utcToLocal(owner.timezone, new Date(task.remind_at));
    parts.push(`🔔 ${dayLabel(at.date, owner, today)} ${clockLabel(at.time, language)}`);
  }
  if (task.tags.length) parts.push(task.tags.map((tag) => `#${tag}`).join(' '));
  void now;
  return parts.length ? [head, `      ${parts.join(' · ')}`] : [head];
}

export function renderTasks(tasks: TaskRow[], owner: Owner, today: string, now: Date): string {
  return tasks.map((task) => taskLines(task, owner, today, now).join('\n')).join('\n');
}

export interface Words {
  welcome: string;
  help: string;
  badCode: string;
  needStart: string;
  today: string;
  overdue: string;
  nothingToday: string;
  nothingOpen: string;
  all: string;
  more: (count: number) => string;
  added: string;
  needTitle: string;
  reminderPast: string;
  waitingForNotes: string;
  done: (title: string) => string;
  reopened: string;
  noSuchTask: (n: string) => string;
  needNumber: string;
  confirmDelete: (title: string) => string;
  deleted: (title: string) => string;
  reminderSet: (title: string, when: string) => string;
  reminderOff: (title: string) => string;
  reminderDefault: (title: string) => string;
  planSet: (title: string, when: string) => string;
  planOff: (title: string) => string;
  cantRead: string;
  status: (open: number, waiting: number, lastSync: string | null) => string;
  agoMinutes: (minutes: number) => string;
  never: string;
  langSet: string;
  zoneSet: (zone: string) => string;
  badZone: string;
  calSet: string;
  leadSet: (minutes: number) => string;
  usage: Record<string, string>;
  reminder: string;
  syncFailed: (title: string, reason: string) => string;
  undo: string;
  doneButton: string;
  snooze: (label: string) => string;
  tomorrowMorning: string;
  yes: string;
  no: string;
  minutes: (n: number) => string;
  hour: string;
}

const fa: Words = {
  welcome: 'سلام! من ربات TaskPro هستم. 👋\nهر چیزی بنویسی تبدیل به تسک می‌شود؛ مثلاً:\n«خرید نان فردا ساعت ۹ #خانه !بالا»\n«یادم بنداز ۲۰ دقیقه دیگه چایی»\nبرای راهنما /help را بزن.',
  help:
    '📝 تسک جدید: هر متنی که بنویسی.\n' +
    '   فردا ساعت ۹ — برنامه‌ریزی · «یادآوری فردا ۸» — یادآوری · «مهلت جمعه» — مهلت\n' +
    '   #برچسب · !بالا !فوری !کم\n\n' +
    '/today — امروز\n/list — همهٔ باز\n/done ۱۲ — انجام شد\n' +
    '/remind ۱۲ فردا ۸ — یادآوری (یا off)\n/plan ۱۲ شنبه ۹-۱۰ — برنامه (یا off)\n' +
    '/del ۱۲ — حذف\n/status — وضعیت همگام‌سازی\n' +
    '/lang fa|en · /tz Asia/Tehran · /cal jalali|gregorian · /lead ۱۰',
  badCode: 'کد درست نیست.',
  needStart: 'اول با /start و کد راه‌اندازی وصلم کن.',
  today: '📅 امروز',
  overdue: '⚠️ عقب‌افتاده',
  nothingToday: 'برای امروز چیزی نیست. 🎉',
  nothingOpen: 'تسک بازی نیست. 🎉',
  all: '📋 همهٔ تسک‌های باز',
  more: (count) => `… و ${count} تای دیگر`,
  added: '✅ ثبت شد',
  needTitle: 'عنوان تسک را هم بنویس.',
  reminderPast: '⚠️ زمان یادآوری گذشته بود؛ یادآوری ثبت نشد.',
  waitingForNotes: 'با روشن شدن Obsidian به یادداشت‌ها اضافه می‌شود.',
  done: (title) => `✅ انجام شد: ${title}`,
  reopened: 'دوباره باز شد',
  noSuchTask: (n) => `تسکی با شمارهٔ ${n} پیدا نشد.`,
  needNumber: 'شمارهٔ تسک را بنویس، مثلاً ۱۲.',
  confirmDelete: (title) => `«${title}» حذف شود؟`,
  deleted: (title) => `🗑 حذف شد: ${title}`,
  reminderSet: (title, when) => `🔔 «${title}» — ${when}`,
  reminderOff: (title) => `🔕 یادآوری «${title}» برداشته شد.`,
  reminderDefault: (title) => `یادآوری «${title}» مثل تنظیمات شد.`,
  planSet: (title, when) => `📅 «${title}» — ${when}`,
  planOff: (title) => `برنامهٔ «${title}» برداشته شد.`,
  cantRead: 'متوجه زمان نشدم. مثلاً: فردا ساعت ۹ ، شنبه ۱۴:۳۰ ، ۲۰ دقیقه دیگه ، ۱۴۰۵/۰۷/۱۵ ساعت ۸',
  status: (open, waiting, lastSync) =>
    `📊 ${open} تسک باز · ${waiting} تغییر منتظر Obsidian\nآخرین همگام‌سازی: ${lastSync ?? 'هنوز نشده'}`,
  agoMinutes: (minutes) => (minutes < 1 ? 'همین الان' : minutes < 60 ? `${minutes} دقیقه پیش` : `${Math.floor(minutes / 60)} ساعت پیش`),
  never: 'هنوز نشده',
  langSet: 'زبان تغییر کرد.',
  zoneSet: (zone) => `منطقهٔ زمانی: ${zone}`,
  badZone: 'این منطقهٔ زمانی را نمی‌شناسم؛ مثل Asia/Tehran بنویس.',
  calSet: 'تقویم تغییر کرد.',
  leadSet: (minutes) => `یادآوری برنامه‌ها ${minutes} دقیقه قبل از شروع.`,
  usage: {
    done: '/done ۱۲',
    del: '/del ۱۲',
    remind: '/remind ۱۲ فردا ساعت ۸   (یا /remind ۱۲ off)',
    plan: '/plan ۱۲ شنبه ساعت ۹ تا ۱۰   (یا /plan ۱۲ off)',
    lang: '/lang fa  یا  /lang en',
    tz: '/tz Asia/Tehran',
    cal: '/cal jalali  یا  /cal gregorian',
    lead: '/lead ۱۰',
  },
  reminder: '⏰ یادآوری',
  syncFailed: (title, reason) => `⚠️ «${title}» را در Obsidian نتوانستم اعمال کنم: ${reason}`,
  undo: '↩️ لغو',
  doneButton: '✅ انجام شد',
  snooze: (label) => `⏰ ${label}`,
  tomorrowMorning: 'فردا ۹ صبح',
  yes: '🗑 حذف',
  no: 'نه',
  minutes: (n) => `${digits(n, 'fa')} دقیقه`,
  hour: '۱ ساعت',
};

const en: Words = {
  welcome:
    'Hi! I am the TaskPro bot. 👋\nAnything you type becomes a task, for example:\n“Buy bread tomorrow at 9 #home !high”\n“remind me in 20 minutes tea”\nSend /help for the rest.',
  help:
    '📝 New task: just type it.\n' +
    '   tomorrow at 9 — a plan · “remind tomorrow 8” — a reminder · “due friday” — a deadline\n' +
    '   #tag · !high !highest !low\n\n' +
    '/today\n/list — everything open\n/done 12\n' +
    '/remind 12 tomorrow 8 (or off)\n/plan 12 sat 9-10 (or off)\n' +
    '/del 12\n/status — sync status\n' +
    '/lang fa|en · /tz Asia/Tehran · /cal jalali|gregorian · /lead 10',
  badCode: 'That code is not right.',
  needStart: 'Connect me first with /start and your setup code.',
  today: '📅 Today',
  overdue: '⚠️ Overdue',
  nothingToday: 'Nothing for today. 🎉',
  nothingOpen: 'No open tasks. 🎉',
  all: '📋 All open tasks',
  more: (count) => `… and ${count} more`,
  added: '✅ Added',
  needTitle: 'Write the task’s title too.',
  reminderPast: '⚠️ That reminder time had already passed; no reminder was set.',
  waitingForNotes: 'It goes into your notes when Obsidian is next open.',
  done: (title) => `✅ Done: ${title}`,
  reopened: 'Reopened',
  noSuchTask: (n) => `No task numbered ${n}.`,
  needNumber: 'Give the task’s number, like 12.',
  confirmDelete: (title) => `Delete “${title}”?`,
  deleted: (title) => `🗑 Deleted: ${title}`,
  reminderSet: (title, when) => `🔔 “${title}” — ${when}`,
  reminderOff: (title) => `🔕 Reminder for “${title}” removed.`,
  reminderDefault: (title) => `“${title}” reminds as in settings.`,
  planSet: (title, when) => `📅 “${title}” — ${when}`,
  planOff: (title) => `“${title}” is no longer planned.`,
  cantRead: 'I did not catch the time. Try: tomorrow at 9, sat 14:30, in 20 minutes, 2026-10-15 at 8',
  status: (open, waiting, lastSync) => `📊 ${open} open tasks · ${waiting} changes waiting for Obsidian\nLast sync: ${lastSync ?? 'not yet'}`,
  agoMinutes: (minutes) => (minutes < 1 ? 'just now' : minutes < 60 ? `${minutes} min ago` : `${Math.floor(minutes / 60)} h ago`),
  never: 'not yet',
  langSet: 'Language changed.',
  zoneSet: (zone) => `Time zone: ${zone}`,
  badZone: 'I do not know that time zone; write it like Asia/Tehran.',
  calSet: 'Calendar changed.',
  leadSet: (minutes) => `Plans remind ${minutes} min before they start.`,
  usage: {
    done: '/done 12',
    del: '/del 12',
    remind: '/remind 12 tomorrow 8   (or /remind 12 off)',
    plan: '/plan 12 sat 9-10   (or /plan 12 off)',
    lang: '/lang fa  or  /lang en',
    tz: '/tz Asia/Tehran',
    cal: '/cal jalali  or  /cal gregorian',
    lead: '/lead 10',
  },
  reminder: '⏰ Reminder',
  syncFailed: (title, reason) => `⚠️ I could not apply “${title}” in Obsidian: ${reason}`,
  undo: '↩️ Undo',
  doneButton: '✅ Done',
  snooze: (label) => `⏰ ${label}`,
  tomorrowMorning: 'Tomorrow 9 am',
  yes: '🗑 Delete',
  no: 'No',
  minutes: (n) => `${n} min`,
  hour: '1 h',
};

export const words = (language: Language): Words => (language === 'fa' ? fa : en);

/** Buttons under a reminder. */
export function reminderButtons(task: TaskRow, language: Language): Button[][] {
  const w = words(language);
  return [
    [{ text: w.doneButton, data: `done:${task.n}` }],
    [
      { text: w.snooze(w.minutes(10)), data: `snz:${task.n}:10` },
      { text: w.snooze(w.hour), data: `snz:${task.n}:60` },
      { text: w.snooze(w.tomorrowMorning), data: `snz:${task.n}:tom` },
    ],
  ];
}
