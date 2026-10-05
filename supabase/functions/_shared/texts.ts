// How the bot writes: dates, tasks and every sentence, in Persian and English.
// Everything here is HTML for Telegram: what a person typed goes through `esc`.

import { JALALI_MONTHS } from './calendar-picker.ts';
import { htmlToRich, mdEscape } from './rich.ts';
import { gregorianToJalali } from './jalali.ts';
import { daysBetween, localToUtc, parseIso, utcToLocal, weekdayOf } from './time.ts';
import type { Button, Language, OwnerRow, TaskRow } from './types.ts';
import { isOpen } from './types.ts';

const PERSIAN = '۰۱۲۳۴۵۶۷۸۹';

/** Digits as the language writes them. */
export function digits(text: string | number, language: Language): string {
  const s = String(text);
  return language === 'fa' ? s.replace(/\d/g, (d) => PERSIAN[Number(d)]) : s;
}

/** "1 of 3" as the language writes it. A slash between digits is turned round when read right to left, so Persian says «از». */
export function ratio(done: number, total: number, language: Language): string {
  return language === 'fa' ? `${digits(done, 'fa')} از ${digits(total, 'fa')}` : `${done}/${total}`;
}

/** Text safe to put inside Telegram's HTML. */
export function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function truncate(text: string, length: number): string {
  const chars = Array.from(text);
  return chars.length > length ? `${chars.slice(0, length - 1).join('').trimEnd()}…` : text;
}

const GREGORIAN_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const FA_WEEKDAYS = ['یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه', 'شنبه'];
const EN_WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
/** A label with how many there are, the number in brackets: «امروز (۳)». */
export const counted = (label: string, count: number, language: Language): string => `${label} (${digits(count, language)})`;

/**
 * One task on the overview, short and clean: the heading above it says the day, so a task of
 * today or tomorrow shows its hour (and a mark if it is also due or only has a reminder), and one
 * of another day says which. `day` is the day the heading stands for, when it stands for one.
 */
export function overviewItem(task: TaskRow, day: string | null, owner: Owner, today: string, rich = false): string {
  const title = (rich ? mdEscape : esc)(truncate(task.title, 60));
  const glyph = task.status === 'doing' ? '🔄 ' : '';
  const priority = task.priority === 'highest' || task.priority === 'high' ? ` ${PRIORITY_MARK[task.priority]}` : '';
  const hour = task.plan_start ? `${clockLabel(task.plan_start, owner.language)} ` : '';
  if (day) {
    const marks: string[] = [];
    if (task.deadline === day && task.plan_date !== day) marks.push('⏳');
    if (task.plan_date !== day && task.deadline !== day && task.remind_at) marks.push(`🔔 ${clockLabel(utcToLocal(owner.timezone, new Date(task.remind_at)).time, owner.language)}`);
    return `${task.plan_date === day ? hour : ''}${glyph}${title}${priority}${marks.length ? ` ${marks.join(' ')}` : ''}`;
  }
  const when = task.plan_date ?? task.deadline;
  if (!when) return `${glyph}${title}${priority}`;
  const label = `${task.plan_date ? '' : '⏳ '}${dayLabel(when, owner, today)}${task.plan_date ? ` ${hour.trim()}`.trimEnd() : ''}`;
  return `${glyph}${title}${priority} — ${rich ? mdEscape(label) : label}`;
}

type Owner = Pick<OwnerRow, 'language' | 'calendar' | 'timezone'>;

/** "Today", "Tomorrow", or a weekday and date in the owner's calendar. */
export function dayLabel(date: string, owner: Owner, today: string): string {
  const language = owner.language;
  const offset = daysBetween(today, date);
  if (offset === 0) return language === 'fa' ? 'امروز' : 'Today';
  if (offset === 1) return language === 'fa' ? 'فردا' : 'Tomorrow';
  if (offset === -1) return language === 'fa' ? 'دیروز' : 'Yesterday';
  return dateLabel(date, owner);
}

/** A weekday and date in the owner's calendar, whatever day it is: «شنبه ۱۱ مهر». */
export function dateLabel(date: string, owner: Owner): string {
  const language = owner.language;
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

export function planText(task: TaskRow, owner: Owner, today: string): string | null {
  if (!task.plan_date) return null;
  let text = dayLabel(task.plan_date, owner, today);
  if (task.plan_start) text += ` ${clockLabel(task.plan_start, owner.language)}${task.plan_end ? `–${clockLabel(task.plan_end, owner.language)}` : ''}`;
  return text;
}

export function remindText(task: TaskRow, owner: Owner, today: string): string | null {
  if (!task.remind_at) return null;
  const at = utcToLocal(owner.timezone, new Date(task.remind_at));
  return `${dayLabel(at.date, owner, today)} ${clockLabel(at.time, owner.language)}`;
}

// ── Dates Telegram understands ─────────────────────────────────────────────
// Telegram's date entity keeps our words on screen, and a tap on it shows the exact moment on
// the reader's own clock; with the format `r` it is a countdown («in 20 minutes») that keeps
// counting. Clients that do not know it show our words.

const unixOf = (at: Date): number => Math.floor(at.getTime() / 1000);

/** A moment as an HTML date entity. */
export const timeTag = (at: Date, label: string, format = ''): string => `<tg-time unix="${unixOf(at)}"${format ? ` format="${format}"` : ''}>${label}</tg-time>`;

/** The same moment inside a rich message. */
export const timeRich = (at: Date, label: string, format = ''): string => `![${label}](tg://time?unix=${unixOf(at)}${format ? `&format=${format}` : ''})`;

/** When a task's plan starts, if it has an hour. */
export function planInstant(task: TaskRow, owner: Owner): Date | null {
  return task.plan_date && task.plan_start ? localToUtc(owner.timezone, task.plan_date, task.plan_start) : null;
}

/** A line's moment: our words as a date entity, and, while the task is open, a countdown after it. */
function moment(label: string, at: Date | null, task: TaskRow, rich: boolean): string {
  if (!at) return label;
  const tag = rich ? timeRich : timeTag;
  return `${tag(at, label)}${isOpen(task.status) ? ` · ${tag(at, '⏱', 'r')}` : ''}`;
}

/** A bar of ▰▱ for how much of a task's subtasks are done. */
export function progressBar(done: number, total: number): string {
  const cells = Math.min(total, 8);
  const filled = total <= 8 ? done : Math.round((done / total) * cells);
  return '▰'.repeat(filled) + '▱'.repeat(Math.max(0, cells - filled));
}

export interface EntryOptions {
  /** Its place in the list, 1 to the end. */
  position: number;
  /** 0 for a task on its own or a parent, 1 for a subtask shown under its parent. */
  depth?: 0 | 1;
  /** A subtask whose parent is not in the list says whose it is. */
  parentHint?: boolean;
  /** A dot in place of the number: a task that has none yet. */
  bullet?: boolean;
}

const INDENT = '\u2003';

/** One task for a list: its number in the list and title, then what is set on it. */
export function taskEntry(task: TaskRow, owner: Owner, today: string, options: EntryOptions): string {
  const language = owner.language;
  const depth = options.depth ?? 0;
  const pad = depth ? INDENT : '';
  const glyph = task.status === 'doing' ? '🔄 ' : task.pending ? '🕓 ' : '';
  const priority = task.priority ? ` ${PRIORITY_MARK[task.priority]}` : '';
  const arrow = depth ? '↳ ' : '';
  const progress = task.subs_total ? ` <code>${ratio(task.subs_done ?? 0, task.subs_total, language)}</code>` : '';
  const head = `${pad}${arrow}${glyph}<b>${options.bullet ? '•' : `${digits(options.position, language)}.`}</b> ${esc(truncate(task.title, 110))}${priority}${progress}`;
  const parts: string[] = [];
  if (options.parentHint && task.parent_title) parts.push(`↳ <i>${words(language).labels.subOf} «${esc(truncate(task.parent_title, 28))}»</i>`);
  const plan = planText(task, owner, today);
  if (plan) parts.push(`📅 ${plan}`);
  if (task.deadline) parts.push(`⏳ ${dayLabel(task.deadline, owner, today)}`);
  const remind = remindText(task, owner, today);
  if (remind) parts.push(`🔔 ${remind}`);
  const repeat = repeatLabel(task.repeat ?? null, language);
  if (repeat) parts.push(`🔁 ${repeat}`);
  if (task.tags.length) parts.push(task.tags.map((tag) => `<code>#${esc(tag)}</code>`).join(' '));
  const lines = [head];
  if (task.subs_total) lines.push(`${pad}${INDENT}<code>${progressBar(task.subs_done ?? 0, task.subs_total)}</code>`);
  if (parts.length) lines.push(`${pad}${depth ? INDENT : ''}${parts.join(' • ')}`);
  return lines.join('\n');
}

/** What a card says about the task's family: its parent, and its open subtasks. */
export interface Relatives {
  parentTitle?: string | null;
  children?: TaskRow[];
}

/** A task as the card shows it: a line for each property that is set. */
export function taskCard(task: TaskRow, owner: Owner, today: string, relatives: Relatives = {}): string {
  const w = words(owner.language);
  const language = owner.language;
  const rows: string[] = [];
  const plan = planText(task, owner, today);
  if (plan) rows.push(`📅 <b>${w.labels.plan}</b> · ${moment(plan, planInstant(task, owner), task, false)}`);
  if (task.deadline) rows.push(`⏳ <b>${w.labels.deadline}</b> · ${dayLabel(task.deadline, owner, today)}`);
  const remind = remindText(task, owner, today);
  if (remind) rows.push(`🔔 <b>${w.labels.remind}</b> · ${moment(remind, task.remind_at ? new Date(task.remind_at) : null, task, false)}`);
  const repeat = repeatLabel(task.repeat ?? null, language);
  if (repeat) rows.push(`🔁 <b>${w.labels.repeat}</b> · ${repeat}`);
  if (task.priority) rows.push(`${PRIORITY_MARK[task.priority]} <b>${w.labels.priority}</b> · ${PRIORITY_NAME[language][task.priority]}`);
  if (task.tags.length) rows.push(`🏷 <b>${w.labels.tags}</b> · ${task.tags.map((tag) => `<code>#${esc(tag)}</code>`).join(' ')}`);
  if (task.note_path) rows.push(`📄 <b>${w.labels.note}</b> · <i>${esc(task.note_path.replace(/^.*\//, '').replace(/\.md$/i, ''))}</i>`);
  const title = task.status === 'done' ? `<s>${esc(task.title)}</s>` : `<b>${esc(task.title)}</b>`;
  const parent = relatives.parentTitle || task.parent_title ? `↳ <i>${w.labels.subOf} «${esc(truncate(relatives.parentTitle || task.parent_title || '', 40))}»</i>\n` : '';
  const body = rows.length ? `<blockquote>${rows.join('\n')}</blockquote>` : `<i>${w.labels.nothingSet}</i>`;

  let subs = '';
  const children = relatives.children ?? [];
  if (task.subs_total || children.length) {
    const total = task.subs_total ?? children.length;
    const done = task.subs_done ?? 0;
    const list = children.map((child, i) => `${digits(i + 1, language)}. ${child.status === 'doing' ? '🔄 ' : ''}${esc(truncate(child.title, 60))}`);
    subs =
      `\n<b>${w.labels.subtasks}</b> <code>${ratio(done, total, language)}</code> <code>${progressBar(done, total)}</code>` +
      (list.length ? `\n<blockquote${list.length > 3 ? ' expandable' : ''}>${list.join('\n')}</blockquote>` : '');
  }
  const state = `<i>${w.labels.id} #${digits(task.n, language)} · ${w.labels.statuses[task.status]}${task.pending ? ` · ${w.labels.pending}` : ''}</i>`;
  return `${parent}${title}\n${body}${subs}\n${state}`;
}

/** One task of a list as rich Markdown: a task-list item, its details under it, a subtask nested one step in. */
export function taskEntryRich(task: TaskRow, owner: Owner, today: string, options: EntryOptions): string {
  const language = owner.language;
  const depth = options.depth ?? 0;
  const pad = '  '.repeat(depth);
  const sub = `${pad}  `;
  const glyph = task.status === 'doing' ? '🔄 ' : task.pending ? '🕓 ' : '';
  const priority = task.priority ? ` ${PRIORITY_MARK[task.priority]}` : '';
  const progress = task.subs_total ? ` \`${ratio(task.subs_done ?? 0, task.subs_total, language)}\` \`${progressBar(task.subs_done ?? 0, task.subs_total)}\`` : '';
  const lines = [`${pad}- [ ] ${glyph}**${digits(options.position, language)}.** ${mdEscape(truncate(task.title, 110))}${priority}${progress}`];
  const parts: string[] = [];
  if (options.parentHint && task.parent_title) parts.push(`↳ *${words(language).labels.subOf} «${mdEscape(truncate(task.parent_title, 28))}»*`);
  const plan = planText(task, owner, today);
  if (plan) parts.push(`📅 ${mdEscape(plan)}`);
  if (task.deadline) parts.push(`⏳ ${mdEscape(dayLabel(task.deadline, owner, today))}`);
  const remind = remindText(task, owner, today);
  if (remind) parts.push(`🔔 ${mdEscape(remind)}`);
  const repeat = repeatLabel(task.repeat ?? null, language);
  if (repeat) parts.push(`🔁 ${mdEscape(repeat)}`);
  if (task.tags.length) parts.push(task.tags.map((tag) => `\`#${tag.replace(/`/g, '')}\``).join(' '));
  if (parts.length) lines[0] += '  ', lines.push(`${sub}${parts.join(' • ')}`);
  return lines.join('\n');
}

/** A task's card as rich Markdown: its title as a heading, its settings as a table, its subtasks as a task list. */
export function taskCardRich(task: TaskRow, owner: Owner, today: string, relatives: Relatives = {}, header?: string, footer?: string): string {
  const w = words(owner.language);
  const language = owner.language;
  const rows: [string, string][] = [];
  const plan = planText(task, owner, today);
  if (plan) rows.push([`📅 ${w.labels.plan}`, moment(mdEscape(plan), planInstant(task, owner), task, true)]);
  if (task.deadline) rows.push([`⏳ ${w.labels.deadline}`, mdEscape(dayLabel(task.deadline, owner, today))]);
  const remind = remindText(task, owner, today);
  if (remind) rows.push([`🔔 ${w.labels.remind}`, moment(mdEscape(remind), task.remind_at ? new Date(task.remind_at) : null, task, true)]);
  const repeat = repeatLabel(task.repeat ?? null, language);
  if (repeat) rows.push([`🔁 ${w.labels.repeat}`, mdEscape(repeat)]);
  if (task.priority) rows.push([`${PRIORITY_MARK[task.priority]} ${w.labels.priority}`, PRIORITY_NAME[language][task.priority]]);
  if (task.tags.length) rows.push([`🏷 ${w.labels.tags}`, task.tags.map((tag) => `\`#${tag.replace(/`/g, '')}\``).join(' ')]);
  if (task.note_path) rows.push([`📄 ${w.labels.note}`, mdEscape(task.note_path.replace(/^.*\//, '').replace(/\.md$/i, ''))]);

  const md: string[] = [];
  if (header) md.push(htmlToRich(header));
  const parentTitle = relatives.parentTitle || task.parent_title;
  if (parentTitle) md.push(`↳ *${w.labels.subOf} «${mdEscape(truncate(parentTitle, 40))}»*`);
  md.push(task.status === 'done' ? `# ~~${mdEscape(task.title)}~~` : `# ${mdEscape(task.title)}`);
  if (rows.length) md.push(['| | |', '|:--|:--|', ...rows.map(([name, value]) => `| **${name}** | ${value} |`)].join('\n'));
  else md.push(`*${w.labels.nothingSet}*`);

  const children = relatives.children ?? [];
  if (task.subs_total || children.length) {
    const total = task.subs_total ?? children.length;
    const done = task.subs_done ?? 0;
    const list = children.map((child) => `- [ ] ${child.status === 'doing' ? '🔄 ' : ''}${mdEscape(truncate(child.title, 60))}`);
    md.push(`**${w.labels.subtasks}** \`${ratio(done, total, language)}\` \`${progressBar(done, total)}\`${list.length ? `\n\n${list.join('\n')}` : ''}`);
  }
  if (footer) md.push(htmlToRich(footer));
  md.push(`*${w.labels.id} #${digits(task.n, language)} · ${w.labels.statuses[task.status]}${task.pending ? ` · ${w.labels.pending}` : ''}*`);
  return md.join('\n\n');
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
    addSubtask: string;
    yes: string;
    no: string;
    custom: string;
    noReminder: string;
    noPlan: string;
    prev: string;
    next: string;
  };
  filters: { a: string; t: string; o: string; d: string; u: string };
  listTitle: { a: string; t: string; o: string; d: string; u: string };
  empty: { a: string; t: string; o: string; d: string; u: string };
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
    subOf: string;
    subtasks: string;
    id: string;
    pending: string;
    statuses: Record<string, string>;
  };

  added: string;
  waitingForNotes: string;
  needTitle: string;
  reminderPast: string;
  doneTitle: string;
  doneToast: string;
  failedTitle: string;
  failedToast: string;
  failed: (title: string) => string;
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
  askSubtask: (n: string, title: string) => string;
  askHintSubtask: string;
  subtaskAdded: (parent: string) => string;
  askHintPlan: string;
  presets: { m10: string; h1: string; h3: string; evening: string; tomorrow: string };
  planPresets: { today: string; tomorrow: string; after: string; week: string };

  task: {
    /** The button on the card that opens the panel. */
    open: string;
    panel: string;
    fields: { title: string; status: string; priority: string; deadline: string; plan: string; remind: string; tags: string; repeat: string };
    none: string;
    statusNames: { open: string; doing: string; done: string; failed: string };
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

  cal: {
    button: string;
    kinds: { r: string; p: string; d: string; x: string };
    pickDay: (kind: string, title: string | null, current: string | null, month: string) => string;
    legend: string;
    todayJump: string;
    timeTitle: (kind: string, title: string | null, day: string) => string;
    allDay: string;
    customTime: string;
    durationTitle: (title: string | null, day: string, start: string) => string;
    durations: { m30: string; h1: string; h2: string; h3: string; none: string };
    askReminderTime: (n: string, title: string, day: string, iso: string) => string;
    askPlanTime: (n: string, title: string, day: string, iso: string) => string;
    hintTime: string;
    cantReadTime: string;
    newOnDay: string;
    askNew: (day: string, iso: string) => string;
    hintNew: string;
  };

  newTask: string;
  statusView: (open: number, waiting: number, lastSync: string | null, health: 'ok' | 'stale' | 'never') => string;
  agoMinutes: (minutes: number) => string;
  settings: (o: { language: string; calendar: string; timezone: string; lead: number; rich: string; pad: string; ai: string }) => string;
  settingButtons: { language: string; calendar: string; lead: (minutes: number) => string; zone: (zone: string) => string; rich: (on: boolean) => string; pad: (pad: string) => string };
  padNames: (pad: number) => string;
  richNames: { on: string; off: string };
  richUnavailable: string;
  nav: { home: string; today: string; all: string; newTask: string; settings: string };
  /** The tags the notes know: listing them, picking them, a new task that starts with one. */
  tagsUi: {
    button: string;
    viewTitle: (count: number, page: number, pages: number) => string;
    viewHelp: string;
    none: string;
    openCount: (n: number) => string;
    listTitle: (tag: string, name?: string) => string;
    listEmpty: (tag: string) => string;
    newWith: (tag: string) => string;
    askNew: (tag: string) => string;
    hintNew: string;
    allTags: string;
    pick: (title: string, tags: string[], page: number, pages: number) => string;
    newTag: string;
    yourTags: string;
    startWith: string;
    tooLong: string;
  };
  /** The assistant: what you say or write in words becomes tasks. */
  ai: {
    name: string;
    states: { on: string; off: string; unset: string };
    button: (state: 'on' | 'off' | 'unset') => string;
    intro: (state: 'on' | 'off' | 'unset') => string;
    heard: (text: string) => string;
    thinking: string;
    done: string;
    nothing: string;
    groups: { added: string; changed: string; status: string; remove: string };
    undoAll: (count: number) => string;
    undone: (count: number) => string;
    warn: {
      badValue: (detail: string) => string;
      reminderPast: (detail: string) => string;
      noTask: (detail: string) => string;
      duplicate: (detail: string) => string;
      noTitle: string;
      tooMany: string;
    };
    preview: { title: string; apply: string; cancel: string; gone: string; cancelled: string; planDay: string };
    errors: { notSetUp: string; auth: string; quota: string; busy: string; bad: string; format: string; fellBack: string };
    voice: { needsAi: string; tooLong: string; empty: string; failed: string };
  };
  /** The messages the bot sends by itself, and the screen that sets them. */
  digest: {
    brief: {
      title: (day: string) => string;
      counts: (c: { today: number; deadline: number; overdue: number }) => string;
      empty: string;
      planned: string;
      first: string;
    };
    review: {
      title: (day: string) => string;
      left: (n: number) => string;
      overdue: (n: number) => string;
      allDone: string;
      tomorrow: (n: number) => string;
      moveButton: (n: number) => string;
      moved: (n: number, day: string) => string;
      nothingToMove: string;
    };
    nudge: { eve: (n: number) => string; morn: (n: number) => string };
    nag: (n: number, of: number) => string;
    buttons: { today: string; overview: string; planDay: string; tomorrow: string; overdue: string };
    more: (n: number) => string;
  };
  notif: {
    title: string;
    hint: string;
    brief: (time: string | null) => string;
    review: (time: string | null) => string;
    nudge: (mode: 'off' | 'eve' | 'morn' | 'both') => string;
    nag: (on: boolean) => string;
    confirm: (mode: 'ask' | 'big' | 'auto') => string;
    open: string;
    off: string;
    on: string;
    nudgeNames: { off: string; eve: string; morn: string; both: string };
    confirmNames: { ask: string; big: string; auto: string };
    unavailable: string;
  };
  /** The week and the day screens. */
  week: {
    dayTitle: (label: string, count: number) => string;
    today: string;
    dayEmpty: string;
    newOnDay: string;
  };
  /** Every open task at a glance, by when. */
  overview: {
    title: (count: number) => string;
    more: (n: number) => string;
  };
  zoneHint: string;
  /** The person's Telegram id, and what to do with it. */
  userId: (id: number) => string;
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
    '📖 <b><u>راهنما</u></b>\n\n' +
    '<b>تسک تازه</b> — فقط بنویس:\n' +
    '<blockquote>خرید نان <b>فردا ساعت ۹</b> ← برنامه\n' +
    'دارو <b>یادآوری جمعه ۸</b> ← یادآوری\n' +
    'گزارش <b>مهلت شنبه</b> ← مهلت\n' +
    'جلسه شنبه ۹ تا ۱۰ ← بازهٔ زمانی\n' +
    '<b>#برچسب</b> · <b>!بالا</b> <b>!فوری</b> <b>!کم</b> ← برچسب و اولویت</blockquote>\n' +
    '🤖 <b>دستیار هوشمند</b> — اگر راه‌اندازی شده باشد، به زبان خودت بگو (یا <b>ویس</b> بفرست) و خودش تسک‌ها را در روز درست می‌گذارد.\n' +
    '<b>دستورها</b> <i>(برای دیدن باز کن)</i>\n' +
    '<blockquote expandable>/start — منوی اصلی\n/today — امروز\n/overview — نمای کلی\n/list — همهٔ تسک‌ها\n/planday — روزم را بچین\n/tags — برچسب‌ها و تسک‌هایشان\n/ai — دستیار هوشمند (یا /ai و بعدش متن)\n' +
    '/done ۱۲ — انجام شد (عدد = «شناسه» روی صفحهٔ تسک)\n/fail ۱۲ — انجام نشد\n/remind ۱۲ فردا ۸ — یادآوری (یا off)\n/plan ۱۲ شنبه ۹-۱۰ — برنامه (یا off)\n' +
    '/del ۱۲ — حذف\n/status — وضعیت همگام‌سازی\n/settings — تنظیمات\n' +
    '/lang fa|en · /tz Asia/Tehran · /cal jalali|gregorian · /lead ۱۰ · /id</blockquote>',
  badCode: '🚫 کد درست نیست.',
  needStart: 'اول با <code>/start</code> و کد راه‌اندازی وصلم کن.',

  home: (counts, lastSync, health) => {
    const rows: string[] = [];
    if (counts.overdue) rows.push(`⚠️ <b>${digits(counts.overdue, 'fa')}</b> عقب‌افتاده`);
    rows.push(`📅 <b>${digits(counts.today, 'fa')}</b> برای امروز`);
    rows.push(`📋 <b>${digits(counts.open, 'fa')}</b> تسک باز`);
    const dot = health === 'ok' ? '🟢' : health === 'stale' ? '🟡' : '⚪';
    return (
      '✨ <b>TaskPro</b>\n' +
      `<blockquote>${rows.join('\n')}</blockquote>\n` +
      `${dot} آخرین همگام‌سازی: <b>${lastSync ?? 'هنوز نشده'}</b>\n\n` +
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
    addSubtask: '🧩 افزودن زیرتسک',
    yes: '🗑 بله، حذف شود',
    no: 'نه',
    custom: '✏️ زمان دلخواه',
    noReminder: '🔕 بدون یادآوری',
    noPlan: '✖️ بدون برنامه',
    prev: '‹',
    next: '›',
  },
  filters: { a: 'همه', t: 'امروز', o: 'عقب‌افتاده', d: 'در حال انجام', u: 'بدون برنامه' },
  listTitle: { a: '📋 همهٔ تسک‌ها', t: '📅 امروز', o: '⚠️ عقب‌افتاده', d: '🔄 در حال انجام', u: '📥 بدون برنامه' },
  empty: {
    a: 'تسک بازی نیست. 🎉',
    t: 'برای امروز چیزی نیست. 🎉',
    o: 'چیزی عقب نیفتاده. 👏',
    d: 'چیزی در حال انجام نیست.',
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
    subOf: 'زیرتسکِ',
    subtasks: 'زیرتسک‌ها',
    id: 'شناسه',
    pending: 'منتظر Obsidian',
    statuses: { open: 'باز', doing: 'در حال انجام', done: 'انجام‌شده', failed: 'ناموفق' },
  },

  added: '✅ <b>ثبت شد</b>',
  waitingForNotes: '<i>با روشن شدن Obsidian به یادداشت‌ها اضافه می‌شود.</i>',
  needTitle: 'عنوان تسک را هم بنویس.',
  reminderPast: '⚠️ زمان یادآوری گذشته بود؛ یادآوری ثبت نشد.',
  doneTitle: '✅ <b>انجام شد</b>',
  doneToast: '✅ انجام شد',
  failedTitle: '❌ <b>انجام نشد</b>',
  failedToast: '❌ انجام نشد',
  failed: (title) => `❌ انجام نشد: ${esc(title)}`,
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
  askRemind: (n, title) => `🔔 یادآوری · شناسه #${n}\n«${title}»\n\nزمان را بنویس، مثلاً: فردا ساعت ۸`,
  askPlan: (n, title) => `📅 برنامه · شناسه #${n}\n«${title}»\n\nزمان را بنویس، مثلاً: شنبه ۹ تا ۱۰`,
  askHintRemind: 'فردا ساعت ۸ …',
  askSubtask: (n, title) => `🧩 زیرتسک · شناسه #${n}\n«${title}»\n\nعنوان زیرتسک را بنویس (مثل تسک عادی؛ ساعت و برچسب هم می‌شود)`,
  askHintSubtask: 'عنوان زیرتسک …',
  subtaskAdded: (parent) => `🧩 زیرتسک «${parent}» ثبت شد`,
  askHintPlan: 'شنبه ۹ تا ۱۰ …',
  presets: { m10: '۱۰ دقیقه بعد', h1: '۱ ساعت بعد', h3: '۳ ساعت بعد', evening: 'امشب ۲۰:۰۰', tomorrow: 'فردا ۹ صبح' },
  planPresets: { today: 'امروز', tomorrow: 'فردا', after: 'پس‌فردا', week: 'هفتهٔ بعد' },

  task: {
    open: '⚙️ تنظیمات',
    panel: '⚙️ <b>تنظیمات تسک</b>',
    fields: { title: 'عنوان', status: 'وضعیت', priority: 'اولویت', deadline: 'مهلت', plan: 'برنامه', remind: 'یادآوری', tags: 'برچسب', repeat: 'تکرار' },
    none: '—',
    statusNames: { open: 'باز', doing: 'در حال انجام', done: 'انجام شد', failed: 'انجام نشد' },
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
    askTitle: (n, title) => `✏️ عنوان تازه · شناسه #${n}\n«${title}»\n\nعنوان را بنویس.`,
    askDeadline: (n, title) => `⏳ مهلت · شناسه #${n}\n«${title}»\n\nتاریخ را بنویس، مثلاً: جمعه ، ۱۴۰۵/۰۸/۱۰ ، ۳ روز دیگه`,
    askTags: (n, title) => `🏷 برچسب · شناسه #${n}\n«${title}»\n\nبرچسب‌ها را بنویس، مثلاً: کار خانه`,
    askRepeat: (n, title) => `🔁 تکرار · شناسه #${n}\n«${title}»\n\nبنویس، مثلاً: هر ۳ روز ، هر ۲ هفته ، ماهانه`,
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

  cal: {
    button: '📆 تقویم',
    kinds: { r: '🔔 یادآوری', p: '📅 برنامه', d: '⏳ مهلت', x: '➕ تسک تازه' },
    pickDay: (kind, title, current, month) =>
      `📆 <b>روز را انتخاب کن</b>\n<blockquote>${kind}${title ? ` · ${esc(title)}` : ''}${current ? `\nاکنون: ${current}` : ''}</blockquote>\n<b>${month}</b>`,
    legend: '<i>[ ] امروز · ✓ انتخاب فعلی · • روزِ دارای تسک</i>',
    todayJump: '📍 امروز',
    timeTitle: (kind, title, day) => `🕒 <b>ساعت چند؟</b>\n<blockquote>${kind}${title ? ` · ${esc(title)}` : ''}\n${day}</blockquote>`,
    allDay: '☀️ بدون ساعت',
    customTime: '✏️ ساعت دلخواه',
    durationTitle: (title, day, start) => `⏱ <b>چقدر طول می‌کشد؟</b>\n<blockquote>${title ? `${esc(title)}\n` : ''}${day} · از ${start}</blockquote>`,
    durations: { m30: '۳۰ دقیقه', h1: '۱ ساعت', h2: '۲ ساعت', h3: '۳ ساعت', none: 'بدون پایان' },
    askReminderTime: (n, title, day, iso) => `⏰ ساعت یادآوری · شناسه #${n}\n«${title}»\n${day}\n${iso}\n\nساعت را بنویس، مثلاً: ۱۴:۳۰ یا ۹ شب`,
    askPlanTime: (n, title, day, iso) => `🕒 ساعت برنامه · شناسه #${n}\n«${title}»\n${day}\n${iso}\n\nساعت را بنویس، مثلاً: ۹ تا ۱۰ یا ۱۴:۳۰`,
    hintTime: '۱۴:۳۰ …',
    cantReadTime: 'ساعت را نفهمیدم. مثلاً: <code>۱۴:۳۰</code> ، <code>۹ شب</code> ، <code>۹ تا ۱۰</code>',
    newOnDay: '📆 تسک برای یک روز',
    askNew: (day, iso) => `🗓 تسک تازه برای ${day}\n${iso}\n\nعنوان را بنویس؛ اگر ساعت هم بنویسی («ساعت ۹») برنامه می‌شود.`,
    hintNew: 'عنوان تسک …',
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
      `<blockquote>📋 <b>${digits(open, 'fa')}</b> تسک باز\n` +
      `⏳ <b>${digits(waiting, 'fa')}</b> تغییر منتظر Obsidian\n` +
      `🔄 آخرین همگام‌سازی: <b>${lastSync ?? 'هنوز نشده'}</b></blockquote>\n${note}`
    );
  },
  agoMinutes: (minutes) =>
    minutes < 1 ? 'همین الان' : minutes < 60 ? `${digits(minutes, 'fa')} دقیقه پیش` : minutes < 2880 ? `${digits(Math.floor(minutes / 60), 'fa')} ساعت پیش` : `${digits(Math.floor(minutes / 1440), 'fa')} روز پیش`,
  settings: (o) =>
    '⚙️ <b>تنظیمات</b>\n' +
    `<blockquote>🌐 <b>زبان</b> · ${o.language}\n📆 <b>تقویم</b> · ${o.calendar}\n🕒 <b>منطقهٔ زمانی</b> · <code>${esc(o.timezone)}</code>\n⏱ <b>یادآوری پیش از برنامه</b> · ${digits(o.lead, 'fa')} دقیقه\n🧩 <b>نمایش پیشرفته</b> · ${o.rich}\n↔️ <b>عرض پیام</b> · ${o.pad}\n🤖 <b>دستیار هوشمند</b> · ${o.ai}</blockquote>`,
  settingButtons: {
    language: '🌐 زبان',
    calendar: '📆 تقویم',
    lead: (minutes) => `⏱ ${digits(minutes, 'fa')} دقیقه پیش از برنامه`,
    zone: (zone) => `🕒 ${zone}`,
    rich: (on) => `🧩 نمایش پیشرفته: ${on ? 'روشن' : 'خاموش'}`,
    pad: (pad) => `↔️ عرض پیام: ${pad}`,
  },
  padNames: (pad) => (pad === 0 ? 'ساده' : pad <= 40 ? 'کم' : pad <= 60 ? 'متوسط' : pad <= 80 ? 'زیاد' : 'خیلی زیاد'),
  richNames: { on: 'روشن', off: 'خاموش' },
  richUnavailable: 'این گزینه بعد از به‌روزرسانی دیتابیس فعال می‌شود؛ چند ثانیه بعد دوباره امتحان کن.',
  nav: { home: '🏠', today: '📅', all: '📋', newTask: '➕', settings: '⚙️' },
  tagsUi: {
    button: '🏷 برچسب‌ها',
    viewTitle: (count, page, pages) => `🏷 <b>برچسب‌ها</b> — <i>${digits(count, 'fa')} برچسب${pages > 1 ? ` · صفحهٔ ${digits(page, 'fa')} از ${digits(pages, 'fa')}` : ''}</i>`,
    viewHelp: 'روی یک برچسب بزن تا تسک‌های بازِ آن را ببینی، یا با آن تسک تازه بسازی.',
    none: 'هنوز برچسبی نداری. در یادداشت‌ها یا همین‌جا با <code>#نام</code> بساز.',
    openCount: (n) => (n ? `${digits(n, 'fa')} باز` : 'بدون تسک باز'),
    listTitle: (tag, name) => `🏷 <b>#${esc(tag)}</b>${name ? ` — ${esc(name)}` : ''}`,
    listEmpty: (tag) => `تسک بازی با برچسب #${esc(tag)} نیست.`,
    newWith: (tag) => `➕ تسک تازه با #${tag}`,
    askNew: (tag) => `🆕 تسک تازه با برچسب «${tag}»\n#${tag}\n\nعنوان تسک را بنویس؛ زمان و اولویت را هم می‌توانی در همان جمله بنویسی.`,
    hintNew: 'عنوان تسک …',
    allTags: '🏷 همهٔ برچسب‌ها',
    pick: (title, tags, page, pages) =>
      `🏷 <b>برچسب‌ها</b>\n<blockquote>${esc(title)}\n${tags.length ? `روی این تسک: <code>${esc(tags.map((tag) => `#${tag}`).join(' '))}</code>` : 'هنوز برچسبی ندارد'}</blockquote>\n` +
      `یک برچسب را بزن تا اضافه یا برداشته شود؛ ✓ یعنی روی این تسک است.${pages > 1 ? `\n<i>صفحهٔ ${digits(page, 'fa')} از ${digits(pages, 'fa')}</i>` : ''}`,
    newTag: '✏️ برچسب تازه',
    yourTags: 'برچسب‌های تو',
    startWith: 'روی یک برچسب بزن تا تسک تازه‌ای با آن بسازی.',
    tooLong: 'برچسب‌های خیلی بلند را فقط می‌شود نوشت.',
  },
  ai: {
    name: 'دستیار هوشمند',
    states: { on: 'روشن', off: 'خاموش', unset: 'تنظیم نشده' },
    button: (state) => `🤖 دستیار هوشمند: ${state === 'on' ? 'روشن' : state === 'off' ? 'خاموش' : 'تنظیم نشده'}`,
    intro: (state) =>
      '🤖 <b>دستیار هوشمند</b>\n' +
      'هر چیزی را به زبان خودت بگو؛ خودش می‌فهمد کدام روز و ساعت بنشیند، برچسب و اولویت می‌گذارد و تسک‌های قبلی را هم عوض می‌کند. <b>ویس</b> هم بفرست.\n' +
      '<blockquote>«فردا ساعت ۹ با سارا تماس بگیرم و عصر نان بخرم»\n' +
      '«جلسهٔ شنبه رو ببر ساعت ۵ بعدازظهر»\n' +
      '«برای امتحان پنج‌شنبه تا آخر هفته برنامهٔ مطالعه بچین»\n' +
      '«تسک ۱۲ انجام شد»\n' +
      '«فردا چه کارهایی دارم؟»</blockquote>\n' +
      (state === 'unset'
        ? '⚙️ هنوز راه‌اندازی نشده: دو کلید Cloudflare را در Supabase بگذار (راهنما: supabase/README.md، بخش «دستیار هوشمند»).'
        : state === 'off'
          ? 'الان خاموش است و نوشته‌هایت مثل قبل تسک ساده می‌شوند. با <code>/ai متن</code> هر وقت خواستی صدایش کن، یا در ⚙️ تنظیمات روشنش کن.'
          : 'روشن است: هر چه بنویسی یا ویس بدهی، اول به دستیار می‌رسد.'),
    heard: (text) => `🎙 <i>«${esc(text)}»</i>`,
    thinking: 'دارم فکر می‌کنم …',
    done: '🤖 <b>انجام شد</b>',
    nothing: '🤖 کاری انجام ندادم.',
    groups: { added: '➕ <b>تسک تازه</b>', changed: '✏️ <b>تغییر کرد</b>', status: '☑️ <b>وضعیت</b>', remove: '🗑 <b>حذف را تأیید کن</b>' },
    undoAll: (count) => `↩️ برگردان (${digits(count, 'fa')})`,
    undone: (count) => `↩️ ${digits(count, 'fa')} تسک برگردانده شد.`,
    warn: {
      badValue: (detail) => `⚠️ «${esc(detail)}» را نفهمیدم و نادیده گرفتم.`,
      reminderPast: (detail) => (detail ? `⚠️ زمان یادآوری (${esc(detail)}) گذشته بود و گذاشته نشد.` : '⚠️ زمان یادآوری گذشته بود و گذاشته نشد.'),
      noTask: (detail) => `⚠️ تسک باز شمارهٔ ${esc(detail)} پیدا نشد.`,
      duplicate: (detail) => `ℹ️ ${esc(detail)} از قبل هست؛ دوباره نساختم.`,
      noTitle: '⚠️ برای یک تسک عنوانی نبود.',
      tooMany: 'ℹ️ فقط چند کار اول انجام شد؛ بقیه را دوباره بگو.',
    },
    preview: {
      title: '🤖 <b>پیش‌نمایش</b> — هنوز چیزی اعمال نشده',
      apply: '✅ اعمال کن',
      cancel: '✖ لغو',
      gone: 'این پیشنهاد دیگر معتبر نیست؛ دوباره بخواه.',
      cancelled: '✖ لغو شد؛ چیزی تغییر نکرد.',
      planDay: 'روز من را بچین: تسک‌های بازی که برنامه ندارند یا عقب افتاده‌اند را در ساعت‌های خالیِ امروز (از همین الان تا ساعت ۲۱) بگذار، و اگر جا نشد برای فردا. به تسک‌هایی که از قبل ساعت دارند دست نزن و تسک تازه نساز.',
    },
    errors: {
      notSetUp: '🤖 دستیار هنوز راه‌اندازی نشده؛ راهنمای نصب را ببین (بخش «دستیار هوشمند»).',
      auth: '🔑 Cloudflare کلید را نپذیرفت. CF_ACCOUNT_ID و CF_API_TOKEN را در Supabase بررسی کن (دسترسی Workers AI لازم است).',
      quota: '⏳ سهمیهٔ رایگان امروز Cloudflare تمام شده یا درخواست‌ها زیاد است؛ کمی بعد دوباره امتحان کن.',
      busy: '🌐 Cloudflare جواب نداد؛ دوباره امتحان کن.',
      bad: '⚠️ Cloudflare درخواست را قبول نکرد (شاید نام مدل درست نیست: CF_AI_MODEL).',
      format: '⚠️ جواب Cloudflare قابل خواندن نبود؛ دوباره امتحان کن.',
      fellBack: 'دستیار در دسترس نبود؛ نوشته‌ات مثل همیشه تسک شد:',
    },
    voice: {
      needsAi: '🎙 برای ویس، دستیار هوشمند باید راه‌اندازی شده باشد (راهنمای نصب، بخش «دستیار هوشمند»).',
      tooLong: '🎙 این ویس خیلی طولانی است؛ تا ۲ دقیقه بفرست.',
      empty: '🎙 از ویس چیزی نفهمیدم؛ دوباره و واضح‌تر بفرست.',
      failed: '🎙 ویس را نتوانستم بخوانم؛ دوباره امتحان کن یا بنویس.',
    },
  },
  digest: {
    brief: {
      title: (day) => `☀️ <b>صبح بخیر</b> — <i>${day}</i>`,
      counts: (c) => {
        const rows: string[] = [];
        if (c.today) rows.push(`📅 <b>${digits(c.today, 'fa')}</b> برنامه برای امروز`);
        if (c.deadline) rows.push(`⏳ <b>${digits(c.deadline, 'fa')}</b> مهلت امروز`);
        if (c.overdue) rows.push(`⚠️ <b>${digits(c.overdue, 'fa')}</b> عقب‌افتاده`);
        return rows.length ? `<blockquote>${rows.join('\n')}</blockquote>` : '';
      },
      empty: 'برای امروز برنامه‌ای نداری. هر چه خواستی بنویس یا بگو تا بچینم. ✨',
      planned: '<b>برنامهٔ امروز</b>',
      first: '<b>اول سراغ این‌ها برو</b>',
    },
    review: {
      title: (day) => `🌙 <b>مرور شب</b> — <i>${day}</i>`,
      left: (n) => `📋 <b>${digits(n, 'fa')}</b> کار امروز هنوز مانده`,
      overdue: (n) => `⚠️ <b>${digits(n, 'fa')}</b> عقب‌افتاده`,
      allDone: '🎉 همهٔ برنامهٔ امروز انجام شد. خسته نباشی!',
      tomorrow: (n) => (n ? `فردا <b>${digits(n, 'fa')}</b> برنامه داری.` : 'فردا هنوز برنامه‌ای نداری.'),
      moveButton: (n) => `➡️ بریزشان فردا (${digits(n, 'fa')})`,
      moved: (n, day) => `➡️ ${digits(n, 'fa')} تسک به ${day} رفت.`,
      nothingToMove: 'چیزی برای جابه‌جا کردن نمانده.',
    },
    nudge: {
      eve: (n) => `⏳ <b>${digits(n, 'fa')} مهلت فردا</b>`,
      morn: (n) => `⏳ <b>${digits(n, 'fa')} مهلت امروز</b>`,
    },
    nag: (n, of) => `🔁 <b>هنوز انجام نشده</b> · بار ${digits(n, 'fa')} از ${digits(of, 'fa')}`,
    buttons: { today: '📅 امروز', overview: '🗂 نمای کلی', planDay: '🪄 روزم را بچین', tomorrow: '📅 فردا', overdue: '⚠️ عقب‌افتاده' },
    more: (n) => `<i>و ${digits(n, 'fa')} مورد دیگر</i>`,
  },
  notif: {
    title: '🔔 <b>اعلان‌ها</b>',
    hint: '<i>با هر بار زدن یک دکمه، گزینهٔ بعدی انتخاب می‌شود.</i>',
    brief: (time) => `☀️ <b>خلاصهٔ صبح</b> · ${time ? digits(time, 'fa') : 'خاموش'}`,
    review: (time) => `🌙 <b>مرور شب</b> · ${time ? digits(time, 'fa') : 'خاموش'}`,
    nudge: (mode) => `⏳ <b>یادآوری مهلت</b> · ${{ off: 'خاموش', eve: 'شب قبل (۲۰:۰۰)', morn: 'صبح همان روز (۰۸:۰۰)', both: 'شب قبل و صبح' }[mode]}`,
    nag: (on) => `🔁 <b>یادآوری پافشار</b> · ${on ? 'روشن (۱۰ دقیقه، تا ۳ بار)' : 'خاموش'}`,
    confirm: (mode) => `🤖 <b>تأیید دستیار</b> · ${{ ask: 'همیشه پیش‌نمایش', big: 'فقط کارهای بزرگ', auto: 'بدون پرسش' }[mode]}`,
    open: '🔔 اعلان‌ها',
    off: 'خاموش',
    on: 'روشن',
    nudgeNames: { off: 'خاموش', eve: 'شب قبل', morn: 'صبح همان روز', both: 'شب قبل و صبح' },
    confirmNames: { ask: 'همیشه پیش‌نمایش', big: 'فقط کارهای بزرگ', auto: 'بدون پرسش' },
    unavailable: 'این گزینه بعد از به‌روزرسانی دیتابیس فعال می‌شود؛ چند ثانیه بعد دوباره امتحان کن.',
  },
  week: {
    dayTitle: (label, count) => `📅 <b>${label}</b> — <i>${count ? `${digits(count, 'fa')} تسک` : 'خالی'}</i>`,
    today: 'امروز',
    dayEmpty: 'برای این روز برنامه‌ای نیست.',
    newOnDay: '➕ تسک برای این روز',
  },
  overview: {
    title: (count) => `🗂 <b>نمای کلی</b> — <i>${digits(count, 'fa')} تسک باز</i>`,
    more: (n) => `<i>و ${digits(n, 'fa')} مورد دیگر؛ از «همهٔ تسک‌ها» ببین.</i>`,
  },
  zoneHint: 'برای تغییر بنویس: /tz Asia/Tehran',
  userId: (id) => `🪪 شناسهٔ تلگرام تو: <code>${id}</code>\nبرای اینکه ربات فقط به تو جواب بدهد، همین عدد را به‌عنوان <code>ALLOWED_USER_ID</code> در Supabase بگذار.`,
  languageNames: { fa: 'فارسی', en: 'English' },
  calendarNames: { jalali: 'شمسی', gregorian: 'میلادی' },
  langSet: 'زبان تغییر کرد.',
  zoneSet: (zone) => `🕒 منطقهٔ زمانی: ${esc(zone)}`,
  badZone: 'این منطقهٔ زمانی را نمی‌شناسم؛ مثل Asia/Tehran بنویس.',
  calSet: 'تقویم تغییر کرد.',
  leadSet: (minutes) => `یادآوری برنامه‌ها ${digits(minutes, 'fa')} دقیقه قبل از شروع.`,
  usage: {
    done: '<code>/done ۱۲</code>',
    fail: '<code>/fail ۱۲</code>',
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
    { command: 'overview', description: 'نمای کلی' },
    { command: 'tags', description: 'برچسب‌ها' },
    { command: 'ai', description: 'دستیار هوشمند' },
    { command: 'planday', description: 'روزم را بچین' },
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
    '📖 <b><u>Help</u></b>\n\n' +
    '<b>New task</b> — just type it:\n' +
    '<blockquote>Buy bread <b>tomorrow at 9</b> → a plan\n' +
    'Pills <b>remind friday 8</b> → a reminder\n' +
    'Report <b>due saturday</b> → a deadline\n' +
    'Meeting sat 9-10 → a time range\n' +
    '<b>#tag</b> · <b>!high</b> <b>!highest</b> <b>!low</b> → tag and priority</blockquote>\n' +
    '🤖 <b>Assistant</b> — once it is set up, say it in your own words (or send a <b>voice message</b>) and it puts the tasks on the right days.\n' +
    '<b>Commands</b> <i>(tap to open)</i>\n' +
    '<blockquote expandable>/start — main menu\n/today\n/overview — every task at a glance\n/list — everything open\n/planday — plan my day\n/tags — your tags and their tasks\n/ai — the assistant (or /ai and your words)\n' +
    '/done 12 (the number is the task card’s ID)\n/remind 12 tomorrow 8 (or off)\n/plan 12 sat 9-10 (or off)\n' +
    '/del 12\n/status — sync status\n/settings\n' +
    '/lang fa|en · /tz Asia/Tehran · /cal jalali|gregorian · /lead 10 · /id</blockquote>',
  badCode: '🚫 That code is not right.',
  needStart: 'Connect me first with <code>/start</code> and your setup code.',

  home: (counts, lastSync, health) => {
    const rows: string[] = [];
    if (counts.overdue) rows.push(`⚠️ <b>${counts.overdue}</b> overdue`);
    rows.push(`📅 <b>${counts.today}</b> for today`);
    rows.push(`📋 <b>${counts.open}</b> open`);
    const dot = health === 'ok' ? '🟢' : health === 'stale' ? '🟡' : '⚪';
    return (
      '✨ <b>TaskPro</b>\n' +
      `<blockquote>${rows.join('\n')}</blockquote>\n` +
      `${dot} Last sync: <b>${lastSync ?? 'not yet'}</b>\n\n` +
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
    addSubtask: '🧩 Add a subtask',
    yes: '🗑 Yes, delete',
    no: 'No',
    custom: '✏️ Pick a time',
    noReminder: '🔕 No reminder',
    noPlan: '✖️ No plan',
    prev: '‹',
    next: '›',
  },
  filters: { a: 'All', t: 'Today', o: 'Overdue', d: 'In progress', u: 'Unplanned' },
  listTitle: { a: '📋 All tasks', t: '📅 Today', o: '⚠️ Overdue', d: '🔄 In progress', u: '📥 Unplanned' },
  empty: {
    a: 'No open tasks. 🎉',
    t: 'Nothing for today. 🎉',
    o: 'Nothing is overdue. 👏',
    d: 'Nothing is in progress.',
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
    subOf: 'subtask of',
    subtasks: 'Subtasks',
    id: 'ID',
    pending: 'waiting for Obsidian',
    statuses: { open: 'Open', doing: 'In progress', done: 'Done', failed: 'Failed' },
  },

  added: '✅ <b>Added</b>',
  waitingForNotes: '<i>It goes into your notes when Obsidian is next open.</i>',
  needTitle: 'Write the task’s title too.',
  reminderPast: '⚠️ That reminder time had already passed; no reminder was set.',
  doneTitle: '✅ <b>Done</b>',
  doneToast: '✅ Done',
  failedTitle: '❌ <b>Not done</b>',
  failedToast: '❌ Not done',
  failed: (title) => `❌ Not done: ${esc(title)}`,
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
  askRemind: (n, title) => `🔔 Reminder · ID #${n}\n“${title}”\n\nType the time, like: tomorrow at 8`,
  askPlan: (n, title) => `📅 Plan · ID #${n}\n“${title}”\n\nType the time, like: sat 9-10`,
  askHintRemind: 'tomorrow at 8 …',
  askSubtask: (n, title) => `🧩 Subtask · ID #${n}\n“${title}”\n\nType the subtask’s title (like any task; an hour or a tag works too)`,
  askHintSubtask: 'Subtask title …',
  subtaskAdded: (parent) => `🧩 Subtask of “${parent}” added`,
  askHintPlan: 'sat 9-10 …',
  presets: { m10: 'In 10 min', h1: 'In 1 hour', h3: 'In 3 hours', evening: 'Tonight 20:00', tomorrow: 'Tomorrow 9 am' },
  planPresets: { today: 'Today', tomorrow: 'Tomorrow', after: 'In 2 days', week: 'Next week' },

  task: {
    open: '⚙️ Settings',
    panel: '⚙️ <b>Task settings</b>',
    fields: { title: 'Title', status: 'Status', priority: 'Priority', deadline: 'Due', plan: 'Plan', remind: 'Reminder', tags: 'Tags', repeat: 'Repeat' },
    none: '—',
    statusNames: { open: 'Open', doing: 'In progress', done: 'Done', failed: 'Not done' },
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
    askTitle: (n, title) => `✏️ New title · ID #${n}\n“${title}”\n\nType the title.`,
    askDeadline: (n, title) => `⏳ Deadline · ID #${n}\n“${title}”\n\nType the date, like: friday, 2026-10-30, in 3 days`,
    askTags: (n, title) => `🏷 Tags · ID #${n}\n“${title}”\n\nType the tags, like: work home`,
    askRepeat: (n, title) => `🔁 Repeat · ID #${n}\n“${title}”\n\nType it, like: every 3 days, every 2 weeks, monthly`,
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

  cal: {
    button: '📆 Calendar',
    kinds: { r: '🔔 Reminder', p: '📅 Plan', d: '⏳ Deadline', x: '➕ New task' },
    pickDay: (kind, title, current, month) =>
      `📆 <b>Pick a day</b>\n<blockquote>${kind}${title ? ` · ${esc(title)}` : ''}${current ? `\nNow: ${current}` : ''}</blockquote>\n<b>${month}</b>`,
    legend: '<i>[ ] today · ✓ current · • a day with tasks</i>',
    todayJump: '📍 Today',
    timeTitle: (kind, title, day) => `🕒 <b>What time?</b>\n<blockquote>${kind}${title ? ` · ${esc(title)}` : ''}\n${day}</blockquote>`,
    allDay: '☀️ No time',
    customTime: '✏️ Other time',
    durationTitle: (title, day, start) => `⏱ <b>How long?</b>\n<blockquote>${title ? `${esc(title)}\n` : ''}${day} · from ${start}</blockquote>`,
    durations: { m30: '30 min', h1: '1 hour', h2: '2 hours', h3: '3 hours', none: 'No end' },
    askReminderTime: (n, title, day, iso) => `⏰ Reminder time · ID #${n}\n“${title}”\n${day}\n${iso}\n\nType the time, like: 14:30 or 9 pm`,
    askPlanTime: (n, title, day, iso) => `🕒 Plan time · ID #${n}\n“${title}”\n${day}\n${iso}\n\nType the time, like: 9-10 or 14:30`,
    hintTime: '14:30 …',
    cantReadTime: 'I did not catch the time. Try: <code>14:30</code>, <code>9 pm</code>, <code>9-10</code>',
    newOnDay: '📆 Task for a day',
    askNew: (day, iso) => `🗓 New task for ${day}\n${iso}\n\nType the title; add a time (“at 9”) to plan it.`,
    hintNew: 'Task title …',
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
      `<blockquote>📋 <b>${open}</b> open tasks\n` +
      `⏳ <b>${waiting}</b> changes waiting for Obsidian\n` +
      `🔄 Last sync: <b>${lastSync ?? 'not yet'}</b></blockquote>\n${note}`
    );
  },
  agoMinutes: (minutes) =>
    minutes < 1 ? 'just now' : minutes < 60 ? `${minutes} min ago` : minutes < 2880 ? `${Math.floor(minutes / 60)} h ago` : `${Math.floor(minutes / 1440)} d ago`,
  settings: (o) =>
    '⚙️ <b>Settings</b>\n' +
    `<blockquote>🌐 <b>Language</b> · ${o.language}\n📆 <b>Calendar</b> · ${o.calendar}\n🕒 <b>Time zone</b> · <code>${esc(o.timezone)}</code>\n⏱ <b>Remind before a plan</b> · ${o.lead} min\n🧩 <b>Rich display</b> · ${o.rich}\n↔️ <b>Message width</b> · ${o.pad}\n🤖 <b>Assistant</b> · ${o.ai}</blockquote>`,
  settingButtons: {
    language: '🌐 Language',
    calendar: '📆 Calendar',
    lead: (minutes) => `⏱ ${minutes} min before a plan`,
    zone: (zone) => `🕒 ${zone}`,
    rich: (on) => `🧩 Rich display: ${on ? 'on' : 'off'}`,
    pad: (pad) => `↔️ Message width: ${pad}`,
  },
  padNames: (pad) => (pad === 0 ? 'none' : pad <= 40 ? 'narrow' : pad <= 60 ? 'medium' : pad <= 80 ? 'wide' : 'widest'),
  richNames: { on: 'on', off: 'off' },
  richUnavailable: 'This option works once the database is updated; try again in a few seconds.',
  nav: { home: '🏠', today: '📅', all: '📋', newTask: '➕', settings: '⚙️' },
  tagsUi: {
    button: '🏷 Tags',
    viewTitle: (count, page, pages) => `🏷 <b>Tags</b> — <i>${count} tag${count === 1 ? '' : 's'}${pages > 1 ? ` · page ${page} of ${pages}` : ''}</i>`,
    viewHelp: 'Tap a tag to see its open tasks, or to start a new task with it.',
    none: 'No tags yet. Make one in your notes, or here with <code>#name</code>.',
    openCount: (n) => (n ? `${n} open` : 'none open'),
    listTitle: (tag, name) => `🏷 <b>#${esc(tag)}</b>${name ? ` — ${esc(name)}` : ''}`,
    listEmpty: (tag) => `No open tasks tagged #${esc(tag)}.`,
    newWith: (tag) => `➕ New task with #${tag}`,
    askNew: (tag) => `🆕 New task tagged “${tag}”\n#${tag}\n\nWrite the title; a time and a priority can go in the same sentence.`,
    hintNew: 'Task title …',
    allTags: '🏷 All tags',
    pick: (title, tags, page, pages) =>
      `🏷 <b>Tags</b>\n<blockquote>${esc(title)}\n${tags.length ? `On this task: <code>${esc(tags.map((tag) => `#${tag}`).join(' '))}</code>` : 'No tags yet'}</blockquote>\n` +
      `Tap a tag to add or remove it; ✓ means it is on this task.${pages > 1 ? `\n<i>Page ${page} of ${pages}</i>` : ''}`,
    newTag: '✏️ New tag',
    yourTags: 'Your tags',
    startWith: 'Tap a tag to start a new task with it.',
    tooLong: 'Very long tags can only be typed.',
  },
  ai: {
    name: 'Assistant',
    states: { on: 'on', off: 'off', unset: 'not set up' },
    button: (state) => `🤖 Assistant: ${state === 'on' ? 'on' : state === 'off' ? 'off' : 'not set up'}`,
    intro: (state) =>
      '🤖 <b>The assistant</b>\n' +
      'Say it in your own words; it works out the day and time, adds tags and a priority, and changes tasks you already have. Send a <b>voice message</b> too.\n' +
      '<blockquote>“Call Sara tomorrow at 9 and buy bread in the evening”\n' +
      '“Move Saturday’s meeting to 5 pm”\n' +
      '“Plan my study for Thursday’s exam until the weekend”\n' +
      '“Task 12 is done”\n' +
      '“What do I have tomorrow?”</blockquote>\n' +
      (state === 'unset'
        ? '⚙️ Not set up yet: put the two Cloudflare keys into Supabase (see supabase/README.md, “The assistant”).'
        : state === 'off'
          ? 'It is off, so what you type becomes a plain task as before. Call it any time with <code>/ai your words</code>, or turn it on in ⚙️ Settings.'
          : 'It is on: whatever you write or say goes to the assistant first.'),
    heard: (text) => `🎙 <i>“${esc(text)}”</i>`,
    thinking: 'Thinking …',
    done: '🤖 <b>Done</b>',
    nothing: '🤖 I did nothing.',
    groups: { added: '➕ <b>New tasks</b>', changed: '✏️ <b>Changed</b>', status: '☑️ <b>Status</b>', remove: '🗑 <b>Confirm to delete</b>' },
    undoAll: (count) => `↩️ Undo (${count})`,
    undone: (count) => `↩️ ${count} task${count === 1 ? '' : 's'} taken back.`,
    warn: {
      badValue: (detail) => `⚠️ I could not read “${esc(detail)}” and left it out.`,
      reminderPast: (detail) => (detail ? `⚠️ The reminder time (${esc(detail)}) had passed, so none was set.` : '⚠️ The reminder time had passed, so none was set.'),
      noTask: (detail) => `⚠️ There is no open task number ${esc(detail)}.`,
      duplicate: (detail) => `ℹ️ ${esc(detail)} is already there; I did not add it again.`,
      noTitle: '⚠️ A task had no title.',
      tooMany: 'ℹ️ Only the first few things were done; say the rest again.',
    },
    preview: {
      title: '🤖 <b>Preview</b> — nothing is applied yet',
      apply: '✅ Apply',
      cancel: '✖ Cancel',
      gone: 'This proposal is no longer valid; ask again.',
      cancelled: '✖ Cancelled; nothing was changed.',
      planDay: 'Plan my day: put the open tasks that have no plan, or are overdue, into the free hours of today (from now until 21:00), and into tomorrow if they do not fit. Do not touch tasks that already have an hour, and do not create new tasks.',
    },
    errors: {
      notSetUp: '🤖 The assistant is not set up yet; see the setup guide (“The assistant”).',
      auth: '🔑 Cloudflare refused the key. Check CF_ACCOUNT_ID and CF_API_TOKEN in Supabase (it needs Workers AI access).',
      quota: '⏳ Today’s free Cloudflare allowance is used up, or there are too many requests; try again a little later.',
      busy: '🌐 Cloudflare did not answer; try again.',
      bad: '⚠️ Cloudflare did not accept the request (maybe the model name in CF_AI_MODEL is wrong).',
      format: '⚠️ Cloudflare’s answer could not be read; try again.',
      fellBack: 'The assistant was not available; your words became a task as usual:',
    },
    voice: {
      needsAi: '🎙 Voice needs the assistant to be set up (see the setup guide, “The assistant”).',
      tooLong: '🎙 That voice message is too long; send up to 2 minutes.',
      empty: '🎙 I could not make out anything; send it again, a little clearer.',
      failed: '🎙 I could not read that voice message; try again or type it.',
    },
  },
  digest: {
    brief: {
      title: (day) => `☀️ <b>Good morning</b> — <i>${day}</i>`,
      counts: (c) => {
        const rows: string[] = [];
        if (c.today) rows.push(`📅 <b>${c.today}</b> planned for today`);
        if (c.deadline) rows.push(`⏳ <b>${c.deadline}</b> due today`);
        if (c.overdue) rows.push(`⚠️ <b>${c.overdue}</b> overdue`);
        return rows.length ? `<blockquote>${rows.join('\n')}</blockquote>` : '';
      },
      empty: 'Nothing is planned for today. Write or say what you need and I will fit it in. ✨',
      planned: '<b>Today’s plan</b>',
      first: '<b>Start with these</b>',
    },
    review: {
      title: (day) => `🌙 <b>Evening review</b> — <i>${day}</i>`,
      left: (n) => `📋 <b>${n}</b> of today’s tasks still open`,
      overdue: (n) => `⚠️ <b>${n}</b> overdue`,
      allDone: '🎉 Everything planned for today is done. Well done!',
      tomorrow: (n) => (n ? `Tomorrow you have <b>${n}</b> planned.` : 'Nothing is planned for tomorrow yet.'),
      moveButton: (n) => `➡️ Move them to tomorrow (${n})`,
      moved: (n, day) => `➡️ ${n} task${n === 1 ? '' : 's'} moved to ${day}.`,
      nothingToMove: 'Nothing is left to move.',
    },
    nudge: {
      eve: (n) => `⏳ <b>${n} due tomorrow</b>`,
      morn: (n) => `⏳ <b>${n} due today</b>`,
    },
    nag: (n, of) => `🔁 <b>Still not done</b> · ${n} of ${of}`,
    buttons: { today: '📅 Today', overview: '🗂 Overview', planDay: '🪄 Plan my day', tomorrow: '📅 Tomorrow', overdue: '⚠️ Overdue' },
    more: (n) => `<i>and ${n} more</i>`,
  },
  notif: {
    title: '🔔 <b>Notifications</b>',
    hint: '<i>Each tap on a button moves to the next choice.</i>',
    brief: (time) => `☀️ <b>Morning summary</b> · ${time ?? 'off'}`,
    review: (time) => `🌙 <b>Evening review</b> · ${time ?? 'off'}`,
    nudge: (mode) => `⏳ <b>Deadline reminder</b> · ${{ off: 'off', eve: 'the evening before (20:00)', morn: 'the morning of (08:00)', both: 'evening before and morning of' }[mode]}`,
    nag: (on) => `🔁 <b>Persistent reminders</b> · ${on ? 'on (every 10 minutes, up to 3 times)' : 'off'}`,
    confirm: (mode) => `🤖 <b>Assistant confirmation</b> · ${{ ask: 'always show first', big: 'only big jobs', auto: 'never ask' }[mode]}`,
    open: '🔔 Notifications',
    off: 'off',
    on: 'on',
    nudgeNames: { off: 'off', eve: 'evening before', morn: 'morning of', both: 'both' },
    confirmNames: { ask: 'always show first', big: 'only big jobs', auto: 'never ask' },
    unavailable: 'This option works once the database is updated; try again in a few seconds.',
  },
  week: {
    dayTitle: (label, count) => `📅 <b>${label}</b> — <i>${count ? `${count} task${count === 1 ? '' : 's'}` : 'empty'}</i>`,
    today: 'Today',
    dayEmpty: 'Nothing is planned for this day.',
    newOnDay: '➕ Task for this day',
  },
  overview: {
    title: (count) => `🗂 <b>Overview</b> — <i>${count} open task${count === 1 ? '' : 's'}</i>`,
    more: (n) => `<i>and ${n} more; see them in “All tasks”.</i>`,
  },
  zoneHint: 'To change it, send: /tz Asia/Tehran',
  userId: (id) => `🪪 Your Telegram id: <code>${id}</code>\nTo make the bot answer only you, set this number as <code>ALLOWED_USER_ID</code> in Supabase.`,
  languageNames: { fa: 'فارسی', en: 'English' },
  calendarNames: { jalali: 'Jalali', gregorian: 'Gregorian' },
  langSet: 'Language changed.',
  zoneSet: (zone) => `🕒 Time zone: ${esc(zone)}`,
  badZone: 'I do not know that time zone; write it like Asia/Tehran.',
  calSet: 'Calendar changed.',
  leadSet: (minutes) => `Plans remind ${minutes} min before they start.`,
  usage: {
    done: '<code>/done 12</code>',
    fail: '<code>/fail 12</code>',
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
    { command: 'overview', description: 'Overview' },
    { command: 'tags', description: 'Tags' },
    { command: 'ai', description: 'The assistant' },
    { command: 'planday', description: 'Plan my day' },
    { command: 'status', description: 'Sync status' },
    { command: 'settings', description: 'Settings' },
    { command: 'help', description: 'Help' },
  ],
  minutes: (n) => `${n} min`,
};

export const words = (language: Language): Words => (language === 'fa' ? fa : en);

/** The message a reminder arrives as, and the buttons under it. */
export function reminderMessage(task: TaskRow, owner: Owner, today: string, header?: string): { text: string; rich: string; buttons: Button[][] } {
  const w = words(owner.language);
  const title = header ?? w.reminder;
  return {
    text: `${title}\n\n${taskCard(task, owner, today)}`,
    rich: `${htmlToRich(title)}\n\n${taskCardRich(task, owner, today)}`,
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
