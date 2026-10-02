// How the bot writes: dates, tasks and every sentence, in Persian and English.
// Everything here is HTML for Telegram: what a person typed goes through `esc`.

import { gregorianToJalali } from './jalali.ts';
import { daysBetween, parseIso, utcToLocal, weekdayOf } from './time.ts';
import type { Button, Language, OwnerRow, TaskRow } from './types.ts';

const PERSIAN = '۰۱۲۳۴۵۶۷۸۹';

/** Digits as the language writes them. */
export function digits(text: string | number, language: Language): string {
  const s = String(text);
  return language === 'fa' ? s.replace(/\d/g, (d) => PERSIAN[Number(d)]) : s;
}

/** Text safe to put inside Telegram's HTML. */
export function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function truncate(text: string, length: number): string {
  const chars = Array.from(text);
  return chars.length > length ? `${chars.slice(0, length - 1).join('').trimEnd()}…` : text;
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
const PRIORITY_NAME: Record<Language, Record<string, string>> = {
  fa: { highest: 'فوری', high: 'بالا', medium: 'متوسط', low: 'کم', lowest: 'خیلی کم' },
  en: { highest: 'Highest', high: 'High', medium: 'Medium', low: 'Low', lowest: 'Lowest' },
};

/** "1w" as the language says it: every week, every 2 weeks. */
export function repeatLabel(token: string | null, language: Language): string | null {
  const match = token ? /^(\d+)([dwm])$/.exec(token) : null;
  if (!match) return null;
  const every = Number(match[1]);
  const unit = match[2];
  if (language === 'fa') {
    const name = { d: 'روز', w: 'هفته', m: 'ماه' }[unit]!;
    return every === 1 ? `هر ${name}` : `هر ${digits(every, 'fa')} ${name}`;
  }
  const name = { d: 'day', w: 'week', m: 'month' }[unit]!;
  return every === 1 ? `Every ${name}` : `Every ${every} ${name}s`;
}

export const priorityName = (language: Language, priority: string): string => PRIORITY_NAME[language][priority];
export const priorityMark = (priority: string): string => PRIORITY_MARK[priority];

function planText(task: TaskRow, owner: Owner, today: string): string | null {
  if (!task.plan_date) return null;
  let text = dayLabel(task.plan_date, owner, today);
  if (task.plan_start) text += ` ${clockLabel(task.plan_start, owner.language)}${task.plan_end ? `–${clockLabel(task.plan_end, owner.language)}` : ''}`;
  return text;
}

function remindText(task: TaskRow, owner: Owner, today: string): string | null {
  if (!task.remind_at) return null;
  const at = utcToLocal(owner.timezone, new Date(task.remind_at));
  return `${dayLabel(at.date, owner, today)} ${clockLabel(at.time, owner.language)}`;
}

/** One task for a list: its number and title, then what is set on it, on a line. */
export function taskEntry(task: TaskRow, owner: Owner, today: string): string {
  const language = owner.language;
  const glyph = task.status === 'doing' ? '🔄 ' : task.pending ? '🕓 ' : '';
  const priority = task.priority ? ` ${PRIORITY_MARK[task.priority]}` : '';
  const head = `${glyph}<b>#${digits(task.n, language)}</b> ${esc(truncate(task.title, 110))}${priority}`;
  const parts: string[] = [];
  const plan = planText(task, owner, today);
  if (plan) parts.push(`📅 ${plan}`);
  if (task.deadline) parts.push(`⏳ ${dayLabel(task.deadline, owner, today)}`);
  const remind = remindText(task, owner, today);
  if (remind) parts.push(`🔔 ${remind}`);
  if (task.tags.length) parts.push(esc(task.tags.map((tag) => `#${tag}`).join(' ')));
  return parts.length ? `${head}\n${parts.join(' · ')}` : head;
}

/** A task as the card shows it: a line for each property that is set. */
export function taskCard(task: TaskRow, owner: Owner, today: string): string {
  const w = words(owner.language);
  const rows: string[] = [];
  const plan = planText(task, owner, today);
  if (plan) rows.push(`📅 ${w.labels.plan} · ${plan}`);
  if (task.deadline) rows.push(`⏳ ${w.labels.deadline} · ${dayLabel(task.deadline, owner, today)}`);
  const remind = remindText(task, owner, today);
  if (remind) rows.push(`🔔 ${w.labels.remind} · ${remind}`);
  const repeat = repeatLabel(task.repeat ?? null, owner.language);
  if (repeat) rows.push(`🔁 ${w.labels.repeat} · ${repeat}`);
  if (task.priority) rows.push(`${PRIORITY_MARK[task.priority]} ${w.labels.priority} · ${PRIORITY_NAME[owner.language][task.priority]}`);
  if (task.tags.length) rows.push(`🏷 ${w.labels.tags} · ${esc(task.tags.map((tag) => `#${tag}`).join(' '))}`);
  if (task.note_path) rows.push(`📄 ${w.labels.note} · ${esc(task.note_path.replace(/^.*\//, '').replace(/\.md$/i, ''))}`);
  const title = task.status === 'done' ? `<s>${esc(task.title)}</s>` : `<b>${esc(task.title)}</b>`;
  const body = rows.length ? `<blockquote>${rows.join('\n')}</blockquote>` : `<i>${w.labels.nothingSet}</i>`;
  const state = `<i>#${digits(task.n, owner.language)} · ${w.labels.statuses[task.status]}${task.pending ? ` · ${w.labels.pending}` : ''}</i>`;
  return `${title}\n${body}\n${state}`;
}

export interface Words {
  welcome: string;
  help: string;
  badCode: string;
  needStart: string;

  home: (counts: { overdue: number; today: number; open: number }, lastSync: string | null, health: 'ok' | 'stale' | 'never') => string;
  buttons: {
    today: string;
    all: string;
    newTask: string;
    overdue: string;
    status: string;
    settings: string;
    help: string;
    menu: string;
    details: string;
    back: string;
    refresh: string;
    done: string;
    remind: string;
    plan: string;
    remove: string;
    undo: string;
    yes: string;
    no: string;
    custom: string;
    noReminder: string;
    noPlan: string;
    prev: string;
    next: string;
  };
  filters: { a: string; t: string; o: string; u: string };
  listTitle: { a: string; t: string; o: string; u: string };
  empty: { a: string; t: string; o: string; u: string };
  sections: { overdue: string; today: string; tomorrow: string; later: string; none: string };
  page: (page: number, pages: number) => string;
  openCount: (count: number) => string;

  labels: {
    plan: string;
    deadline: string;
    remind: string;
    priority: string;
    repeat: string;
    tags: string;
    note: string;
    nothingSet: string;
    pending: string;
    statuses: Record<string, string>;
  };

  added: string;
  waitingForNotes: string;
  needTitle: string;
  reminderPast: string;
  doneTitle: string;
  doneToast: string;
  done: (title: string) => string;
  noSuchTask: (n: string) => string;
  needNumber: string;
  confirmDelete: (title: string) => string;
  deleted: (title: string) => string;
  deletedToast: string;
  reminderSet: (title: string, when: string) => string;
  reminderOff: (title: string) => string;
  reminderDefault: (title: string) => string;
  planSet: (title: string, when: string) => string;
  planOff: (title: string) => string;
  cantRead: string;

  remindMenu: (title: string, current: string | null) => string;
  planMenu: (title: string, current: string | null) => string;
  askRemind: (n: string, title: string) => string;
  askPlan: (n: string, title: string) => string;
  askHintRemind: string;
  askHintPlan: string;
  presets: { m10: string; h1: string; h3: string; evening: string; tomorrow: string };
  planPresets: { today: string; tomorrow: string; after: string; week: string };

  task: {
    /** The button on the card that opens the panel. */
    open: string;
    panel: string;
    fields: { title: string; status: string; priority: string; deadline: string; plan: string; remind: string; tags: string; repeat: string };
    none: string;
    statusNames: { open: string; doing: string; done: string };
    statusMenu: (title: string) => string;
    priorityMenu: (title: string) => string;
    noPriority: string;
    deadlineMenu: (title: string, current: string | null) => string;
    deadlinePresets: { today: string; tomorrow: string; after: string; week: string };
    noDeadline: string;
    tagsMenu: (title: string, tags: string[]) => string;
    addTag: string;
    clearTags: string;
    repeatMenu: (title: string, current: string | null) => string;
    repeatPresets: { daily: string; weekly: string; biweekly: string; monthly: string };
    noRepeat: string;
    askTitle: (n: string, title: string) => string;
    askDeadline: (n: string, title: string) => string;
    askTags: (n: string, title: string) => string;
    askRepeat: (n: string, title: string) => string;
    hintTitle: string;
    hintDeadline: string;
    hintTags: string;
    hintRepeat: string;
    saved: (what: string) => string;
    needTags: string;
    cantReadRepeat: string;
    cantReadDeadline: string;
    editUnavailable: string;
    editToast: string;
  };

  newTask: string;
  statusView: (open: number, waiting: number, lastSync: string | null, health: 'ok' | 'stale' | 'never') => string;
  agoMinutes: (minutes: number) => string;
  settings: (o: { language: string; calendar: string; timezone: string; lead: number }) => string;
  settingButtons: { language: string; calendar: string; lead: (minutes: number) => string; zone: (zone: string) => string };
  zoneHint: string;
  languageNames: { fa: string; en: string };
  calendarNames: { jalali: string; gregorian: string };
  langSet: string;
  zoneSet: (zone: string) => string;
  badZone: string;
  calSet: string;
  leadSet: (minutes: number) => string;
  usage: Record<string, string>;
  reminder: string;
  syncFailed: (title: string, reason: string) => string;
  snoozeToast: string;
  commands: { command: string; description: string }[];
  minutes: (n: number) => string;
}

const fa: Words = {
  welcome:
    '👋 <b>سلام! من ربات TaskPro هستم.</b>\n' +
    'به یادداشت‌های Obsidian تو وصلم و از اینجا تسک و یادآوری را مدیریت می‌کنیم.\n\n' +
    '<blockquote>هر چیزی بنویسی تبدیل به تسک می‌شود:\n' +
    '«خرید نان فردا ساعت ۹ #خانه !بالا»\n' +
    '«یادم بنداز ۲۰ دقیقه دیگه چایی»</blockquote>',
  help:
    '📖 <b>راهنما</b>\n\n' +
    '<b>تسک تازه</b> — فقط بنویس:\n' +
    '<blockquote>خرید نان <b>فردا ساعت ۹</b> ← برنامه\n' +
    'دارو <b>یادآوری جمعه ۸</b> ← یادآوری\n' +
    'گزارش <b>مهلت شنبه</b> ← مهلت\n' +
    'جلسه شنبه ۹ تا ۱۰ ← بازهٔ زمانی\n' +
    '<b>#برچسب</b> · <b>!بالا</b> <b>!فوری</b> <b>!کم</b> ← برچسب و اولویت</blockquote>\n' +
    '<b>دستورها</b>\n' +
    '<blockquote expandable>/start — منوی اصلی\n/today — امروز\n/list — همهٔ تسک‌ها\n' +
    '/done ۱۲ — انجام شد\n/remind ۱۲ فردا ۸ — یادآوری (یا off)\n/plan ۱۲ شنبه ۹-۱۰ — برنامه (یا off)\n' +
    '/del ۱۲ — حذف\n/status — وضعیت همگام‌سازی\n/settings — تنظیمات\n' +
    '/lang fa|en · /tz Asia/Tehran · /cal jalali|gregorian · /lead ۱۰</blockquote>',
  badCode: '🚫 کد درست نیست.',
  needStart: 'اول با <code>/start</code> و کد راه‌اندازی وصلم کن.',

  home: (counts, lastSync, health) => {
    const rows: string[] = [];
    if (counts.overdue) rows.push(`⚠️ ${digits(counts.overdue, 'fa')} عقب‌افتاده`);
    rows.push(`📅 ${digits(counts.today, 'fa')} برای امروز`);
    rows.push(`📋 ${digits(counts.open, 'fa')} تسک باز`);
    const dot = health === 'ok' ? '🟢' : health === 'stale' ? '🟡' : '⚪';
    return (
      '✨ <b>TaskPro</b>\n' +
      `<blockquote>${rows.join('\n')}</blockquote>\n` +
      `${dot} آخرین همگام‌سازی: ${lastSync ?? 'هنوز نشده'}\n\n` +
      '<i>هر چیزی بنویسی، تسک می‌شود.</i>'
    );
  },
  buttons: {
    today: '📅 امروز',
    all: '📋 همهٔ تسک‌ها',
    newTask: '➕ تسک جدید',
    overdue: '⚠️ عقب‌افتاده',
    status: '📊 وضعیت',
    settings: '⚙️ تنظیمات',
    help: '📖 راهنما',
    menu: '🏠 منو',
    details: '🔎 جزئیات',
    back: '⬅️ بازگشت',
    refresh: '🔄 تازه‌سازی',
    done: '✅ انجام شد',
    remind: '🔔 یادآوری',
    plan: '📅 برنامه',
    remove: '🗑 حذف',
    undo: '↩️ لغو',
    yes: '🗑 بله، حذف شود',
    no: 'نه',
    custom: '✏️ زمان دلخواه',
    noReminder: '🔕 بدون یادآوری',
    noPlan: '✖️ بدون برنامه',
    prev: '‹',
    next: '›',
  },
  filters: { a: 'همه', t: 'امروز', o: 'عقب‌افتاده', u: 'بدون برنامه' },
  listTitle: { a: '📋 همهٔ تسک‌ها', t: '📅 امروز', o: '⚠️ عقب‌افتاده', u: '📥 بدون برنامه' },
  empty: {
    a: 'تسک بازی نیست. 🎉',
    t: 'برای امروز چیزی نیست. 🎉',
    o: 'چیزی عقب نیفتاده. 👏',
    u: 'همهٔ تسک‌ها برنامه یا مهلت دارند. 👏',
  },
  sections: { overdue: '⚠️ عقب‌افتاده', today: '📅 امروز', tomorrow: '🌅 فردا', later: '🗓 بعداً', none: '📥 بدون برنامه' },
  page: (page, pages) => `${digits(page, 'fa')} از ${digits(pages, 'fa')}`,
  openCount: (count) => `${digits(count, 'fa')} باز`,

  labels: {
    plan: 'برنامه',
    deadline: 'مهلت',
    remind: 'یادآوری',
    priority: 'اولویت',
    repeat: 'تکرار',
    tags: 'برچسب',
    note: 'یادداشت',
    nothingSet: 'هنوز برنامه، مهلت یا یادآوری ندارد.',
    pending: 'منتظر Obsidian',
    statuses: { open: 'باز', doing: 'در حال انجام', done: 'انجام‌شده', failed: 'ناموفق' },
  },

  added: '✅ <b>ثبت شد</b>',
  waitingForNotes: '<i>با روشن شدن Obsidian به یادداشت‌ها اضافه می‌شود.</i>',
  needTitle: 'عنوان تسک را هم بنویس.',
  reminderPast: '⚠️ زمان یادآوری گذشته بود؛ یادآوری ثبت نشد.',
  doneTitle: '✅ <b>انجام شد</b>',
  doneToast: '✅ انجام شد',
  done: (title) => `✅ انجام شد: ${esc(title)}`,
  noSuchTask: (n) => `تسکی با شمارهٔ ${n} پیدا نشد.`,
  needNumber: 'شمارهٔ تسک را بنویس، مثلاً ۱۲.',
  confirmDelete: (title) => `🗑 <b>حذف شود؟</b>\n<blockquote>${esc(title)}</blockquote>`,
  deleted: (title) => `🗑 <b>حذف شد</b>\n<s>${esc(title)}</s>`,
  deletedToast: '🗑 حذف شد',
  reminderSet: (title, when) => `🔔 <b>یادآوری تنظیم شد</b>\n<blockquote>${esc(title)}\n${when}</blockquote>`,
  reminderOff: (title) => `🔕 یادآوری «${esc(title)}» برداشته شد.`,
  reminderDefault: (title) => `یادآوری «${esc(title)}» مثل تنظیمات شد.`,
  planSet: (title, when) => `📅 <b>برنامه تنظیم شد</b>\n<blockquote>${esc(title)}\n${when}</blockquote>`,
  planOff: (title) => `برنامهٔ «${esc(title)}» برداشته شد.`,
  cantRead: 'متوجه زمان نشدم. مثلاً: <code>فردا ساعت ۹</code> ، <code>شنبه ۱۴:۳۰</code> ، <code>۲۰ دقیقه دیگه</code> ، <code>۱۴۰۵/۰۷/۱۵ ساعت ۸</code>',

  remindMenu: (title, current) =>
    `🔔 <b>یادآوری</b>\n<blockquote>${esc(title)}${current ? `\nاکنون: ${current}` : ''}</blockquote>\nچه موقع یادت بیندازم؟`,
  planMenu: (title, current) =>
    `📅 <b>برنامه</b>\n<blockquote>${esc(title)}${current ? `\nاکنون: ${current}` : ''}</blockquote>\nکی انجامش بدهی؟`,
  askRemind: (n, title) => `🔔 یادآوری برای #${n}\n«${title}»\n\nزمان را بنویس، مثلاً: فردا ساعت ۸`,
  askPlan: (n, title) => `📅 برنامه برای #${n}\n«${title}»\n\nزمان را بنویس، مثلاً: شنبه ۹ تا ۱۰`,
  askHintRemind: 'فردا ساعت ۸ …',
  askHintPlan: 'شنبه ۹ تا ۱۰ …',
  presets: { m10: '۱۰ دقیقه بعد', h1: '۱ ساعت بعد', h3: '۳ ساعت بعد', evening: 'امشب ۲۰:۰۰', tomorrow: 'فردا ۹ صبح' },
  planPresets: { today: 'امروز', tomorrow: 'فردا', after: 'پس‌فردا', week: 'هفتهٔ بعد' },

  task: {
    open: '⚙️ تنظیمات',
    panel: '⚙️ <b>تنظیمات تسک</b>',
    fields: { title: 'عنوان', status: 'وضعیت', priority: 'اولویت', deadline: 'مهلت', plan: 'برنامه', remind: 'یادآوری', tags: 'برچسب', repeat: 'تکرار' },
    none: '—',
    statusNames: { open: 'باز', doing: 'در حال انجام', done: 'انجام شد' },
    statusMenu: (title) => `🔄 <b>وضعیت</b>\n<blockquote>${esc(title)}</blockquote>`,
    priorityMenu: (title) => `🚩 <b>اولویت</b>\n<blockquote>${esc(title)}</blockquote>`,
    noPriority: '✖️ بدون اولویت',
    deadlineMenu: (title, current) => `⏳ <b>مهلت</b>\n<blockquote>${esc(title)}${current ? `\nاکنون: ${current}` : ''}</blockquote>\nتا کی؟`,
    deadlinePresets: { today: 'امروز', tomorrow: 'فردا', after: 'پس‌فردا', week: 'هفتهٔ بعد' },
    noDeadline: '✖️ بدون مهلت',
    tagsMenu: (title, tags) => `🏷 <b>برچسب‌ها</b>\n<blockquote>${esc(title)}${tags.length ? `\n${esc(tags.map((tag) => `#${tag}`).join(' '))}` : '\nبرچسبی ندارد'}</blockquote>\nبا زدن روی یک برچسب برداشته می‌شود.`,
    addTag: '➕ افزودن برچسب',
    clearTags: '🧹 برداشتن همه',
    repeatMenu: (title, current) => `🔁 <b>تکرار</b>\n<blockquote>${esc(title)}${current ? `\nاکنون: ${current}` : ''}</blockquote>\nهر چند وقت یک‌بار برگردد؟`,
    repeatPresets: { daily: 'هر روز', weekly: 'هر هفته', biweekly: 'هر ۲ هفته', monthly: 'هر ماه' },
    noRepeat: '✖️ بدون تکرار',
    askTitle: (n, title) => `✏️ عنوان تازه برای #${n}\n«${title}»\n\nعنوان را بنویس.`,
    askDeadline: (n, title) => `⏳ مهلت برای #${n}\n«${title}»\n\nتاریخ را بنویس، مثلاً: جمعه ، ۱۴۰۵/۰۸/۱۰ ، ۳ روز دیگه`,
    askTags: (n, title) => `🏷 برچسب برای #${n}\n«${title}»\n\nبرچسب‌ها را بنویس، مثلاً: کار خانه`,
    askRepeat: (n, title) => `🔁 تکرار برای #${n}\n«${title}»\n\nبنویس، مثلاً: هر ۳ روز ، هر ۲ هفته ، ماهانه`,
    hintTitle: 'عنوان تازه …',
    hintDeadline: 'جمعه …',
    hintTags: 'کار خانه …',
    hintRepeat: 'هر ۳ روز …',
    saved: (what) => `✅ ${what}`,
    needTags: 'برچسبی ندیدم؛ مثلاً بنویس: کار خانه',
    cantReadRepeat: 'متوجه نشدم. مثلاً: <code>هر ۳ روز</code> ، <code>هر ۲ هفته</code> ، <code>ماهانه</code> ، <code>off</code>',
    cantReadDeadline: 'متوجه تاریخ نشدم. مثلاً: <code>جمعه</code> ، <code>۱۴۰۵/۰۸/۱۰</code> ، <code>۳ روز دیگه</code>',
    editUnavailable: '⚠️ ویرایش کامل هنوز در پایگاه داده آماده نیست. چند ثانیه بعد دوباره امتحان کن؛ اگر ماند، فایل <code>supabase/migrations/20261003000000_task_settings.sql</code> را در SQL Editor اجرا کن.',
    editToast: '✅ ذخیره شد',
  },

  newTask:
    '➕ <b>تسک جدید</b>\n' +
    'همین‌جا بنویس؛ هر پیامی یک تسک می‌شود.\n\n' +
    '<blockquote>خرید نان فردا ساعت ۹ #خانه\n' +
    'دارو یادآوری جمعه ۸\n' +
    'گزارش مهلت شنبه !فوری\n' +
    'جلسه شنبه ۹ تا ۱۰</blockquote>',
  statusView: (open, waiting, lastSync, health) => {
    const note =
      health === 'ok'
        ? '🟢 Obsidian به‌روز است.'
        : health === 'stale'
          ? '🟡 مدتی است Obsidian باز نبوده؛ تغییرها با باز شدنش اعمال می‌شود.'
          : '⚪ هنوز همگام نشده؛ Obsidian را باز کن و «Sync now» را بزن.';
    return (
      '📊 <b>وضعیت</b>\n' +
      `<blockquote>📋 ${digits(open, 'fa')} تسک باز\n` +
      `⏳ ${digits(waiting, 'fa')} تغییر منتظر Obsidian\n` +
      `🔄 آخرین همگام‌سازی: ${lastSync ?? 'هنوز نشده'}</blockquote>\n${note}`
    );
  },
  agoMinutes: (minutes) =>
    minutes < 1 ? 'همین الان' : minutes < 60 ? `${digits(minutes, 'fa')} دقیقه پیش` : minutes < 2880 ? `${digits(Math.floor(minutes / 60), 'fa')} ساعت پیش` : `${digits(Math.floor(minutes / 1440), 'fa')} روز پیش`,
  settings: (o) =>
    '⚙️ <b>تنظیمات</b>\n' +
    `<blockquote>🌐 زبان · ${o.language}\n📆 تقویم · ${o.calendar}\n🕒 منطقهٔ زمانی · <code>${esc(o.timezone)}</code>\n⏱ یادآوری پیش از برنامه · ${digits(o.lead, 'fa')} دقیقه</blockquote>`,
  settingButtons: {
    language: '🌐 زبان',
    calendar: '📆 تقویم',
    lead: (minutes) => `⏱ ${digits(minutes, 'fa')} دقیقه پیش از برنامه`,
    zone: (zone) => `🕒 ${zone}`,
  },
  zoneHint: 'برای تغییر بنویس: /tz Asia/Tehran',
  languageNames: { fa: 'فارسی', en: 'English' },
  calendarNames: { jalali: 'شمسی', gregorian: 'میلادی' },
  langSet: 'زبان تغییر کرد.',
  zoneSet: (zone) => `🕒 منطقهٔ زمانی: ${esc(zone)}`,
  badZone: 'این منطقهٔ زمانی را نمی‌شناسم؛ مثل Asia/Tehran بنویس.',
  calSet: 'تقویم تغییر کرد.',
  leadSet: (minutes) => `یادآوری برنامه‌ها ${digits(minutes, 'fa')} دقیقه قبل از شروع.`,
  usage: {
    done: '<code>/done ۱۲</code>',
    del: '<code>/del ۱۲</code>',
    remind: '<code>/remind ۱۲ فردا ساعت ۸</code>   (یا <code>/remind ۱۲ off</code>)',
    plan: '<code>/plan ۱۲ شنبه ساعت ۹ تا ۱۰</code>   (یا <code>/plan ۱۲ off</code>)',
    lang: '<code>/lang fa</code>  یا  <code>/lang en</code>',
    tz: '<code>/tz Asia/Tehran</code>',
    cal: '<code>/cal jalali</code>  یا  <code>/cal gregorian</code>',
    lead: '<code>/lead ۱۰</code>',
  },
  reminder: '⏰ <b>یادآوری</b>',
  syncFailed: (title, reason) => `⚠️ «${esc(title)}» را در Obsidian نتوانستم اعمال کنم:\n<blockquote>${esc(reason)}</blockquote>`,
  snoozeToast: '⏰ عقب افتاد',
  commands: [
    { command: 'start', description: 'منوی اصلی' },
    { command: 'today', description: 'تسک‌های امروز' },
    { command: 'list', description: 'همهٔ تسک‌ها' },
    { command: 'status', description: 'وضعیت همگام‌سازی' },
    { command: 'settings', description: 'تنظیمات' },
    { command: 'help', description: 'راهنما' },
  ],
  minutes: (n) => `${digits(n, 'fa')} دقیقه`,
};

const en: Words = {
  welcome:
    '👋 <b>Hi! I am the TaskPro bot.</b>\n' +
    'I am connected to your Obsidian notes; manage tasks and reminders from here.\n\n' +
    '<blockquote>Anything you type becomes a task:\n' +
    '“Buy bread tomorrow at 9 #home !high”\n' +
    '“remind me in 20 minutes tea”</blockquote>',
  help:
    '📖 <b>Help</b>\n\n' +
    '<b>New task</b> — just type it:\n' +
    '<blockquote>Buy bread <b>tomorrow at 9</b> → a plan\n' +
    'Pills <b>remind friday 8</b> → a reminder\n' +
    'Report <b>due saturday</b> → a deadline\n' +
    'Meeting sat 9-10 → a time range\n' +
    '<b>#tag</b> · <b>!high</b> <b>!highest</b> <b>!low</b> → tag and priority</blockquote>\n' +
    '<b>Commands</b>\n' +
    '<blockquote expandable>/start — main menu\n/today\n/list — everything open\n' +
    '/done 12\n/remind 12 tomorrow 8 (or off)\n/plan 12 sat 9-10 (or off)\n' +
    '/del 12\n/status — sync status\n/settings\n' +
    '/lang fa|en · /tz Asia/Tehran · /cal jalali|gregorian · /lead 10</blockquote>',
  badCode: '🚫 That code is not right.',
  needStart: 'Connect me first with <code>/start</code> and your setup code.',

  home: (counts, lastSync, health) => {
    const rows: string[] = [];
    if (counts.overdue) rows.push(`⚠️ ${counts.overdue} overdue`);
    rows.push(`📅 ${counts.today} for today`);
    rows.push(`📋 ${counts.open} open`);
    const dot = health === 'ok' ? '🟢' : health === 'stale' ? '🟡' : '⚪';
    return (
      '✨ <b>TaskPro</b>\n' +
      `<blockquote>${rows.join('\n')}</blockquote>\n` +
      `${dot} Last sync: ${lastSync ?? 'not yet'}\n\n` +
      '<i>Type anything and it becomes a task.</i>'
    );
  },
  buttons: {
    today: '📅 Today',
    all: '📋 All tasks',
    newTask: '➕ New task',
    overdue: '⚠️ Overdue',
    status: '📊 Status',
    settings: '⚙️ Settings',
    help: '📖 Help',
    menu: '🏠 Menu',
    details: '🔎 Details',
    back: '⬅️ Back',
    refresh: '🔄 Refresh',
    done: '✅ Done',
    remind: '🔔 Remind',
    plan: '📅 Plan',
    remove: '🗑 Delete',
    undo: '↩️ Undo',
    yes: '🗑 Yes, delete',
    no: 'No',
    custom: '✏️ Pick a time',
    noReminder: '🔕 No reminder',
    noPlan: '✖️ No plan',
    prev: '‹',
    next: '›',
  },
  filters: { a: 'All', t: 'Today', o: 'Overdue', u: 'Unplanned' },
  listTitle: { a: '📋 All tasks', t: '📅 Today', o: '⚠️ Overdue', u: '📥 Unplanned' },
  empty: {
    a: 'No open tasks. 🎉',
    t: 'Nothing for today. 🎉',
    o: 'Nothing is overdue. 👏',
    u: 'Every task has a plan or a deadline. 👏',
  },
  sections: { overdue: '⚠️ Overdue', today: '📅 Today', tomorrow: '🌅 Tomorrow', later: '🗓 Later', none: '📥 Unplanned' },
  page: (page, pages) => `${page} / ${pages}`,
  openCount: (count) => `${count} open`,

  labels: {
    plan: 'Plan',
    deadline: 'Due',
    remind: 'Reminder',
    priority: 'Priority',
    repeat: 'Repeat',
    tags: 'Tags',
    note: 'Note',
    nothingSet: 'No plan, deadline or reminder yet.',
    pending: 'waiting for Obsidian',
    statuses: { open: 'Open', doing: 'In progress', done: 'Done', failed: 'Failed' },
  },

  added: '✅ <b>Added</b>',
  waitingForNotes: '<i>It goes into your notes when Obsidian is next open.</i>',
  needTitle: 'Write the task’s title too.',
  reminderPast: '⚠️ That reminder time had already passed; no reminder was set.',
  doneTitle: '✅ <b>Done</b>',
  doneToast: '✅ Done',
  done: (title) => `✅ Done: ${esc(title)}`,
  noSuchTask: (n) => `No task numbered ${n}.`,
  needNumber: 'Give the task’s number, like 12.',
  confirmDelete: (title) => `🗑 <b>Delete it?</b>\n<blockquote>${esc(title)}</blockquote>`,
  deleted: (title) => `🗑 <b>Deleted</b>\n<s>${esc(title)}</s>`,
  deletedToast: '🗑 Deleted',
  reminderSet: (title, when) => `🔔 <b>Reminder set</b>\n<blockquote>${esc(title)}\n${when}</blockquote>`,
  reminderOff: (title) => `🔕 Reminder for “${esc(title)}” removed.`,
  reminderDefault: (title) => `“${esc(title)}” reminds as in settings.`,
  planSet: (title, when) => `📅 <b>Plan set</b>\n<blockquote>${esc(title)}\n${when}</blockquote>`,
  planOff: (title) => `“${esc(title)}” is no longer planned.`,
  cantRead: 'I did not catch the time. Try: <code>tomorrow at 9</code>, <code>sat 14:30</code>, <code>in 20 minutes</code>, <code>2026-10-15 at 8</code>',

  remindMenu: (title, current) =>
    `🔔 <b>Reminder</b>\n<blockquote>${esc(title)}${current ? `\nNow: ${current}` : ''}</blockquote>\nWhen should I remind you?`,
  planMenu: (title, current) =>
    `📅 <b>Plan</b>\n<blockquote>${esc(title)}${current ? `\nNow: ${current}` : ''}</blockquote>\nWhen will you do it?`,
  askRemind: (n, title) => `🔔 Reminder for #${n}\n“${title}”\n\nType the time, like: tomorrow at 8`,
  askPlan: (n, title) => `📅 Plan for #${n}\n“${title}”\n\nType the time, like: sat 9-10`,
  askHintRemind: 'tomorrow at 8 …',
  askHintPlan: 'sat 9-10 …',
  presets: { m10: 'In 10 min', h1: 'In 1 hour', h3: 'In 3 hours', evening: 'Tonight 20:00', tomorrow: 'Tomorrow 9 am' },
  planPresets: { today: 'Today', tomorrow: 'Tomorrow', after: 'In 2 days', week: 'Next week' },

  task: {
    open: '⚙️ Settings',
    panel: '⚙️ <b>Task settings</b>',
    fields: { title: 'Title', status: 'Status', priority: 'Priority', deadline: 'Due', plan: 'Plan', remind: 'Reminder', tags: 'Tags', repeat: 'Repeat' },
    none: '—',
    statusNames: { open: 'Open', doing: 'In progress', done: 'Done' },
    statusMenu: (title) => `🔄 <b>Status</b>\n<blockquote>${esc(title)}</blockquote>`,
    priorityMenu: (title) => `🚩 <b>Priority</b>\n<blockquote>${esc(title)}</blockquote>`,
    noPriority: '✖️ No priority',
    deadlineMenu: (title, current) => `⏳ <b>Deadline</b>\n<blockquote>${esc(title)}${current ? `\nNow: ${current}` : ''}</blockquote>\nBy when?`,
    deadlinePresets: { today: 'Today', tomorrow: 'Tomorrow', after: 'In 2 days', week: 'Next week' },
    noDeadline: '✖️ No deadline',
    tagsMenu: (title, tags) => `🏷 <b>Tags</b>\n<blockquote>${esc(title)}${tags.length ? `\n${esc(tags.map((tag) => `#${tag}`).join(' '))}` : '\nNo tags'}</blockquote>\nTap a tag to remove it.`,
    addTag: '➕ Add tags',
    clearTags: '🧹 Remove all',
    repeatMenu: (title, current) => `🔁 <b>Repeat</b>\n<blockquote>${esc(title)}${current ? `\nNow: ${current}` : ''}</blockquote>\nHow often should it come back?`,
    repeatPresets: { daily: 'Every day', weekly: 'Every week', biweekly: 'Every 2 weeks', monthly: 'Every month' },
    noRepeat: '✖️ No repeat',
    askTitle: (n, title) => `✏️ New title for #${n}\n“${title}”\n\nType the title.`,
    askDeadline: (n, title) => `⏳ Deadline for #${n}\n“${title}”\n\nType the date, like: friday, 2026-10-30, in 3 days`,
    askTags: (n, title) => `🏷 Tags for #${n}\n“${title}”\n\nType the tags, like: work home`,
    askRepeat: (n, title) => `🔁 Repeat for #${n}\n“${title}”\n\nType it, like: every 3 days, every 2 weeks, monthly`,
    hintTitle: 'New title …',
    hintDeadline: 'friday …',
    hintTags: 'work home …',
    hintRepeat: 'every 3 days …',
    saved: (what) => `✅ ${what}`,
    needTags: 'I saw no tag; type them like: work home',
    cantReadRepeat: 'I did not catch that. Try: <code>every 3 days</code>, <code>every 2 weeks</code>, <code>monthly</code>, <code>off</code>',
    cantReadDeadline: 'I did not catch the date. Try: <code>friday</code>, <code>2026-10-30</code>, <code>in 3 days</code>',
    editUnavailable: '⚠️ Full editing is not ready in the database yet. Try again in a few seconds; if it stays, run <code>supabase/migrations/20261003000000_task_settings.sql</code> in the SQL Editor.',
    editToast: '✅ Saved',
  },

  newTask:
    '➕ <b>New task</b>\n' +
    'Type it right here; every message becomes a task.\n\n' +
    '<blockquote>Buy bread tomorrow at 9 #home\n' +
    'Pills remind friday 8\n' +
    'Report due saturday !highest\n' +
    'Meeting sat 9-10</blockquote>',
  statusView: (open, waiting, lastSync, health) => {
    const note =
      health === 'ok'
        ? '🟢 Obsidian is up to date.'
        : health === 'stale'
          ? '🟡 Obsidian has not been open for a while; changes apply when it is.'
          : '⚪ Not synced yet; open Obsidian and press “Sync now”.';
    return (
      '📊 <b>Status</b>\n' +
      `<blockquote>📋 ${open} open tasks\n` +
      `⏳ ${waiting} changes waiting for Obsidian\n` +
      `🔄 Last sync: ${lastSync ?? 'not yet'}</blockquote>\n${note}`
    );
  },
  agoMinutes: (minutes) =>
    minutes < 1 ? 'just now' : minutes < 60 ? `${minutes} min ago` : minutes < 2880 ? `${Math.floor(minutes / 60)} h ago` : `${Math.floor(minutes / 1440)} d ago`,
  settings: (o) =>
    '⚙️ <b>Settings</b>\n' +
    `<blockquote>🌐 Language · ${o.language}\n📆 Calendar · ${o.calendar}\n🕒 Time zone · <code>${esc(o.timezone)}</code>\n⏱ Remind before a plan · ${o.lead} min</blockquote>`,
  settingButtons: {
    language: '🌐 Language',
    calendar: '📆 Calendar',
    lead: (minutes) => `⏱ ${minutes} min before a plan`,
    zone: (zone) => `🕒 ${zone}`,
  },
  zoneHint: 'To change it, send: /tz Asia/Tehran',
  languageNames: { fa: 'فارسی', en: 'English' },
  calendarNames: { jalali: 'Jalali', gregorian: 'Gregorian' },
  langSet: 'Language changed.',
  zoneSet: (zone) => `🕒 Time zone: ${esc(zone)}`,
  badZone: 'I do not know that time zone; write it like Asia/Tehran.',
  calSet: 'Calendar changed.',
  leadSet: (minutes) => `Plans remind ${minutes} min before they start.`,
  usage: {
    done: '<code>/done 12</code>',
    del: '<code>/del 12</code>',
    remind: '<code>/remind 12 tomorrow 8</code>   (or <code>/remind 12 off</code>)',
    plan: '<code>/plan 12 sat 9-10</code>   (or <code>/plan 12 off</code>)',
    lang: '<code>/lang fa</code>  or  <code>/lang en</code>',
    tz: '<code>/tz Asia/Tehran</code>',
    cal: '<code>/cal jalali</code>  or  <code>/cal gregorian</code>',
    lead: '<code>/lead 10</code>',
  },
  reminder: '⏰ <b>Reminder</b>',
  syncFailed: (title, reason) => `⚠️ I could not apply “${esc(title)}” in Obsidian:\n<blockquote>${esc(reason)}</blockquote>`,
  snoozeToast: '⏰ Snoozed',
  commands: [
    { command: 'start', description: 'Main menu' },
    { command: 'today', description: 'Today’s tasks' },
    { command: 'list', description: 'All tasks' },
    { command: 'status', description: 'Sync status' },
    { command: 'settings', description: 'Settings' },
    { command: 'help', description: 'Help' },
  ],
  minutes: (n) => `${n} min`,
};

export const words = (language: Language): Words => (language === 'fa' ? fa : en);

/** The message a reminder arrives as, and the buttons under it. */
export function reminderMessage(task: TaskRow, owner: Owner, today: string): { text: string; buttons: Button[][] } {
  const w = words(owner.language);
  return {
    text: `${w.reminder}\n\n${taskCard(task, owner, today)}`,
    buttons: [
      [{ text: w.buttons.done, data: `done:${task.n}`, style: 'success' }],
      [
        { text: w.presets.m10, data: `snz:${task.n}:10` },
        { text: w.presets.h1, data: `snz:${task.n}:60` },
        { text: w.presets.tomorrow, data: `snz:${task.n}:tom` },
      ],
      [{ text: w.buttons.details, data: `t:${task.n}` }],
    ],
  };
}
