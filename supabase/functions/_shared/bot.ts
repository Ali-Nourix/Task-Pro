// The bot: what each message, command and button press does.

import { normalize, parseQuickAdd } from './quickadd.ts';
import type { Moment, Plan } from './quickadd.ts';
import { addDays, isZone, localNow, localToUtc, utcToLocal } from './time.ts';
import { clockLabel, dayLabel, digits, renderTasks, words } from './texts.ts';
import type { AddPayload, Button, OwnerRow, PlanPayload, RemindPayload, StatusPayload, Store, TaskRow, Telegram } from './types.ts';
import { isOpen } from './types.ts';

export interface BotDeps {
  store: Store;
  tg: Telegram;
  /** The code that proves who may use the bot: /start <code>. */
  pairingCode: string;
  now: () => Date;
}

const COMMANDS: Record<string, string> = {
  start: 'start', help: 'help', راهنما: 'help',
  today: 'today', امروز: 'today',
  list: 'list', لیست: 'list',
  done: 'done', انجام: 'done', تیک: 'done',
  del: 'del', delete: 'del', حذف: 'del',
  remind: 'remind', یادآوری: 'remind',
  plan: 'plan', برنامه: 'plan',
  status: 'status', sync: 'status', وضعیت: 'status',
  lang: 'lang', زبان: 'lang',
  tz: 'tz', timezone: 'tz',
  cal: 'cal', تقویم: 'cal',
  lead: 'lead',
};

/** Words said on their own, without a slash, that are commands rather than tasks. */
const BARE = new Set(['امروز', 'لیست', 'راهنما', 'وضعیت', 'help', 'today', 'list', 'status']);

const OFF = new Set(['off', 'none', 'no', 'خاموش', 'هیچ', 'نه', 'حذف']);
const DEFAULT = new Set(['default', 'پیشفرض']);

const MAX_LIST = 40;
const MAX_TEXT = 3800;

interface Message {
  chat: { id: number; type?: string };
  text?: string;
  message_id: number;
}

interface Update {
  message?: Message;
  callback_query?: { id: string; data?: string; message?: Message };
}

export async function handleUpdate(update: Update, deps: BotDeps): Promise<void> {
  if (update.callback_query) return handleCallback(update.callback_query, deps);
  const message = update.message;
  if (!message?.text || message.chat.type !== 'private') return;
  const text = message.text.trim();
  const chatId = message.chat.id;

  const owner = await deps.store.getOwner();
  const first = text.split(/\s+/)[0];
  const isStart = /^\/start(@\w+)?$/i.test(first);

  if (!owner) {
    if (!isStart) return deps.tg.send(chatId, words('fa').needStart);
    const code = text.split(/\s+/)[1] ?? '';
    if (!code || !constantTimeEquals(code, deps.pairingCode)) return deps.tg.send(chatId, words('fa').badCode);
    await deps.store.setOwner({ chat_id: chatId, timezone: 'Asia/Tehran', language: 'fa', calendar: 'jalali', lead_minutes: 10 });
    return deps.tg.send(chatId, words('fa').welcome);
  }
  // Nobody but the owner gets an answer.
  if (owner.chat_id !== chatId) return;

  const w = words(owner.language);
  if (text.startsWith('/')) {
    const name = normalize(first.slice(1).replace(/@\w+$/, ''));
    const command = COMMANDS[name];
    const args = text.slice(first.length).trim();
    if (command) return runCommand(command, args, owner, deps, chatId);
    return deps.tg.send(chatId, w.help);
  }
  const bare = COMMANDS[normalize(text)];
  if (BARE.has(normalize(text)) && bare) return runCommand(bare, '', owner, deps, chatId);
  return addTask(text, owner, deps, chatId);
}

// ── Commands ───────────────────────────────────────────────────────────────

async function runCommand(command: string, args: string, owner: OwnerRow, deps: BotDeps, chatId: number): Promise<void> {
  const w = words(owner.language);
  const { tg, store } = deps;
  const now = deps.now();
  const clock = localNow(owner.timezone, now);

  switch (command) {
    case 'start':
      return tg.send(chatId, w.welcome);
    case 'help':
      return tg.send(chatId, w.help);
    case 'today': {
      const open = await store.openTasks();
      const overdue = open.filter((task) => isOverdue(task, clock.date));
      const today = open.filter((task) => !isOverdue(task, clock.date) && isToday(task, clock.date, owner.timezone));
      if (!overdue.length && !today.length) return tg.send(chatId, w.nothingToday);
      const parts: string[] = [];
      if (overdue.length) parts.push(`${w.overdue}\n${renderTasks(overdue, owner, clock.date, now)}`);
      if (today.length) parts.push(`${w.today}\n${renderTasks(today, owner, clock.date, now)}`);
      return sendChunks(tg, chatId, parts.join('\n\n'), doneButtons([...overdue, ...today], owner));
    }
    case 'list': {
      const open = (await store.openTasks()).sort(byPlan);
      if (!open.length) return tg.send(chatId, w.nothingOpen);
      const shown = open.slice(0, MAX_LIST);
      let text = `${w.all}\n${renderTasks(shown, owner, clock.date, now)}`;
      if (open.length > shown.length) text += `\n${w.more(open.length - shown.length)}`;
      return sendChunks(tg, chatId, text, doneButtons(shown.slice(0, 10), owner));
    }
    case 'done': {
      const numbers = numbersIn(args);
      if (!numbers.length) return tg.send(chatId, `${w.needNumber}\n${w.usage.done}`);
      for (const n of numbers) await markDone(n, owner, deps, chatId);
      return;
    }
    case 'del': {
      const [n] = numbersIn(args);
      if (n === undefined) return tg.send(chatId, `${w.needNumber}\n${w.usage.del}`);
      const task = await store.taskByN(n);
      if (!task) return tg.send(chatId, w.noSuchTask(digits(n, owner.language)));
      return tg.send(chatId, w.confirmDelete(task.title), [[{ text: w.yes, data: `delok:${task.n}` }, { text: w.no, data: 'noop' }]]);
    }
    case 'remind':
      return setReminder(args, owner, deps, chatId);
    case 'plan':
      return setPlan(args, owner, deps, chatId);
    case 'status': {
      const open = await store.openTasks();
      const waiting = (await store.pendingCommands()).length;
      let last: string | null = null;
      if (owner.last_sync_at) last = w.agoMinutes(Math.max(0, Math.round((now.getTime() - new Date(owner.last_sync_at).getTime()) / 60_000)));
      return tg.send(chatId, w.status(open.length, waiting, last));
    }
    case 'lang': {
      const value = args.toLowerCase();
      if (value !== 'fa' && value !== 'en') return tg.send(chatId, words(owner.language).usage.lang);
      await store.patchOwner({ language: value });
      return tg.send(chatId, words(value).langSet);
    }
    case 'tz': {
      if (!args || !isZone(args)) return tg.send(chatId, `${w.badZone}\n${w.usage.tz}`);
      await store.patchOwner({ timezone: args });
      return tg.send(chatId, w.zoneSet(args));
    }
    case 'cal': {
      const value = args.toLowerCase();
      if (value !== 'jalali' && value !== 'gregorian') return tg.send(chatId, w.usage.cal);
      await store.patchOwner({ calendar: value });
      return tg.send(chatId, w.calSet);
    }
    case 'lead': {
      const [minutes] = numbersIn(args);
      if (minutes === undefined || minutes > 1440) return tg.send(chatId, w.usage.lead);
      await store.patchOwner({ lead_minutes: minutes });
      return tg.send(chatId, w.leadSet(minutes));
    }
  }
}

// ── A new task ─────────────────────────────────────────────────────────────

/** A title safe to write into a note: no markers of ours, no block ID. */
export function cleanTitle(title: string): string {
  return title
    .replace(/\s+/g, ' ')
    .replace(/@(?=[a-z]+\()/gi, '')
    .replace(/\s*\^[\w-]+$/, '')
    .replace(/^[-*+]\s+(\[.\]\s*)?/, '')
    .trim()
    .slice(0, 300);
}

async function addTask(text: string, owner: OwnerRow, deps: BotDeps, chatId: number): Promise<void> {
  const w = words(owner.language);
  const now = deps.now();
  const clock = localNow(owner.timezone, now);
  const parsed = parseQuickAdd(text, { today: clock.date, minutes: clock.minutes });
  const title = cleanTitle(parsed.title);
  if (!title) return deps.tg.send(chatId, w.needTitle);

  let warning = '';
  let remindAt: string | null = null;
  let remind = parsed.remind;
  if (remind) {
    const at = localToUtc(owner.timezone, remind.date, remind.time);
    if (at.getTime() < now.getTime()) {
      warning = `\n${w.reminderPast}`;
      remind = undefined;
    } else remindAt = at.toISOString();
  } else if (parsed.plan?.start) {
    const start = localToUtc(owner.timezone, parsed.plan.date, parsed.plan.start);
    const at = new Date(start.getTime() - owner.lead_minutes * 60_000);
    if (at.getTime() >= now.getTime()) remindAt = at.toISOString();
  }

  const key = `tg:${crypto.randomUUID()}`;
  const row = await deps.store.insertTask({
    key,
    title,
    status: 'open',
    priority: parsed.priority ?? null,
    deadline: parsed.deadline ?? null,
    plan_date: parsed.plan?.date ?? null,
    plan_start: parsed.plan?.start ?? null,
    plan_end: parsed.plan?.end ?? null,
    remind_at: remindAt,
    tags: parsed.tags,
    note_path: null,
    origin: 'telegram',
    pending: true,
  });
  const payload: AddPayload = { key, title, tags: parsed.tags };
  if (parsed.priority) payload.priority = parsed.priority;
  if (parsed.deadline) payload.deadline = parsed.deadline;
  if (parsed.plan) payload.plan = parsed.plan;
  if (remind) payload.remind = remind;
  await deps.store.addCommand('add', payload);

  const lines = renderTasks([row], owner, clock.date, now);
  await deps.tg.send(chatId, `${w.added}\n${lines}${warning}\n${w.waitingForNotes}`, [
    [{ text: w.doneButton, data: `done:${row.n}` }, { text: w.undo, data: `undo:${row.n}` }],
  ]);
}

// ── Changing a task ────────────────────────────────────────────────────────

async function markDone(n: number, owner: OwnerRow, deps: BotDeps, chatId: number): Promise<void> {
  const w = words(owner.language);
  const task = await deps.store.taskByN(n);
  if (!task || !isOpen(task.status)) return deps.tg.send(chatId, w.noSuchTask(digits(n, owner.language)));
  await deps.store.patchTask(task.key, { status: 'done' });
  const payload: StatusPayload = { key: task.key, status: 'done' };
  await deps.store.addCommand('status', payload);
  await deps.tg.send(chatId, w.done(task.title));
}

async function removeTask(task: TaskRow, deps: BotDeps): Promise<void> {
  await deps.store.removeTask(task.key);
  if (task.pending) {
    // Never written into a note: the wish to add it is cancelled instead.
    for (const command of await deps.store.pendingCommands()) {
      if (command.payload.key === task.key) await deps.store.finishCommand(command.id, 'cancelled');
    }
  } else {
    await deps.store.addCommand('delete', { key: task.key });
  }
}

async function setReminder(args: string, owner: OwnerRow, deps: BotDeps, chatId: number): Promise<void> {
  const w = words(owner.language);
  const [n] = numbersIn(args);
  if (n === undefined) return deps.tg.send(chatId, `${w.needNumber}\n${w.usage.remind}`);
  const task = await deps.store.taskByN(n);
  if (!task) return deps.tg.send(chatId, w.noSuchTask(digits(n, owner.language)));
  const rest = args.replace(/^\s*#?[\d۰-۹٠-٩]+/, '').trim();
  const word = normalize(rest);

  let payload: RemindPayload;
  let remindAt: string | null = null;
  let reply: string;
  const now = deps.now();
  const clock = localNow(owner.timezone, now);

  if (OFF.has(word)) {
    payload = { key: task.key, moment: 'off' };
    reply = w.reminderOff(task.title);
  } else if (DEFAULT.has(word)) {
    payload = { key: task.key, moment: 'default' };
    if (task.plan_date && task.plan_start) {
      remindAt = new Date(localToUtc(owner.timezone, task.plan_date, task.plan_start).getTime() - owner.lead_minutes * 60_000).toISOString();
    }
    reply = w.reminderDefault(task.title);
  } else {
    const moment = parseQuickAdd(`remind ${rest}`, { today: clock.date, minutes: clock.minutes }).remind;
    if (!moment || !rest) return deps.tg.send(chatId, `${w.cantRead}\n${w.usage.remind}`);
    const at = localToUtc(owner.timezone, moment.date, moment.time);
    if (at.getTime() < now.getTime()) return deps.tg.send(chatId, w.reminderPast);
    remindAt = at.toISOString();
    payload = { key: task.key, moment };
    reply = w.reminderSet(task.title, momentLabel(moment, owner, clock.date));
  }
  await deps.store.patchTask(task.key, { remind_at: remindAt });
  await deps.store.addCommand('remind', payload);
  await deps.tg.send(chatId, reply);
}

async function setPlan(args: string, owner: OwnerRow, deps: BotDeps, chatId: number): Promise<void> {
  const w = words(owner.language);
  const [n] = numbersIn(args);
  if (n === undefined) return deps.tg.send(chatId, `${w.needNumber}\n${w.usage.plan}`);
  const task = await deps.store.taskByN(n);
  if (!task) return deps.tg.send(chatId, w.noSuchTask(digits(n, owner.language)));
  const rest = args.replace(/^\s*#?[\d۰-۹٠-٩]+/, '').trim();
  const clock = localNow(owner.timezone, deps.now());

  if (OFF.has(normalize(rest))) {
    await deps.store.patchTask(task.key, { plan_date: null, plan_start: null, plan_end: null });
    const payload: PlanPayload = { key: task.key, plan: null };
    await deps.store.addCommand('plan', payload);
    return deps.tg.send(chatId, w.planOff(task.title));
  }
  const plan = parseQuickAdd(rest, { today: clock.date, minutes: clock.minutes }).plan;
  if (!plan || !rest) return deps.tg.send(chatId, `${w.cantRead}\n${w.usage.plan}`);
  await deps.store.patchTask(task.key, { plan_date: plan.date, plan_start: plan.start ?? null, plan_end: plan.end ?? null });
  const payload: PlanPayload = { key: task.key, plan };
  await deps.store.addCommand('plan', payload);
  await deps.tg.send(chatId, w.planSet(task.title, planLabel(plan, owner, clock.date)));
}

// ── Buttons ────────────────────────────────────────────────────────────────

async function handleCallback(
  callback: NonNullable<Update['callback_query']>,
  deps: BotDeps
): Promise<void> {
  const owner = await deps.store.getOwner();
  const chatId = callback.message?.chat.id;
  if (!owner || chatId === undefined || owner.chat_id !== chatId) return deps.tg.answer(callback.id);
  const w = words(owner.language);
  const [action, rawN, extra] = (callback.data ?? '').split(':');
  const n = Number(rawN);
  await deps.tg.answer(callback.id);
  const clear = () => (callback.message ? deps.tg.clearButtons(chatId, callback.message.message_id) : Promise.resolve());

  if (action === 'noop') return clear();
  const task = Number.isFinite(n) ? await deps.store.taskByN(n) : null;
  if (!task) return deps.tg.send(chatId, w.noSuchTask(digits(rawN ?? '', owner.language)));

  switch (action) {
    case 'done':
      await clear();
      return markDone(n, owner, deps, chatId);
    case 'undo':
    case 'delok':
      await clear();
      await removeTask(task, deps);
      return deps.tg.send(chatId, w.deleted(task.title));
    case 'snz': {
      await clear();
      const now = deps.now();
      const clock = localNow(owner.timezone, now);
      let moment: Moment;
      if (extra === 'tom') moment = { date: addDays(clock.date, 1), time: '09:00' };
      else {
        const minutes = Number(extra) || 10;
        moment = utcToLocal(owner.timezone, new Date(now.getTime() + minutes * 60_000));
      }
      const at = localToUtc(owner.timezone, moment.date, moment.time);
      await deps.store.patchTask(task.key, { remind_at: at.toISOString() });
      const payload: RemindPayload = { key: task.key, moment };
      await deps.store.addCommand('remind', payload);
      return deps.tg.send(chatId, w.reminderSet(task.title, momentLabel(moment, owner, clock.date)));
    }
  }
}

// ── Pieces ─────────────────────────────────────────────────────────────────

function momentLabel(moment: Moment, owner: OwnerRow, today: string): string {
  return `${dayLabel(moment.date, owner, today)} ${clockLabel(moment.time, owner.language)}`;
}

function planLabel(plan: Plan, owner: OwnerRow, today: string): string {
  let text = dayLabel(plan.date, owner, today);
  if (plan.start) text += ` ${clockLabel(plan.start, owner.language)}${plan.end ? `–${clockLabel(plan.end, owner.language)}` : ''}`;
  return text;
}

/** Numbers in a message, in any digits: «#12», «۱۲», "12 13". */
export function numbersIn(text: string): number[] {
  return Array.from(normalize(text).matchAll(/\d+/g), (match) => Number(match[0])).filter((n) => Number.isSafeInteger(n));
}

function isOverdue(task: TaskRow, today: string): boolean {
  return (!!task.deadline && task.deadline < today) || (!!task.plan_date && task.plan_date < today && !task.deadline);
}

function isToday(task: TaskRow, today: string, zone: string): boolean {
  if (task.plan_date === today || task.deadline === today) return true;
  return !!task.remind_at && utcToLocal(zone, new Date(task.remind_at)).date === today;
}

function byPlan(a: TaskRow, b: TaskRow): number {
  const left = a.plan_date ?? a.deadline ?? '9999';
  const right = b.plan_date ?? b.deadline ?? '9999';
  return left === right ? a.n - b.n : left < right ? -1 : 1;
}

function doneButtons(tasks: TaskRow[], owner: OwnerRow): Button[][] {
  const buttons = tasks.slice(0, 10).map((task) => ({ text: `✅ ${digits(task.n, owner.language)}`, data: `done:${task.n}` }));
  const rows: Button[][] = [];
  for (let i = 0; i < buttons.length; i += 5) rows.push(buttons.slice(i, i + 5));
  return rows;
}

async function sendChunks(tg: Telegram, chatId: number, text: string, buttons?: Button[][]): Promise<void> {
  const chunks: string[] = [];
  let current = '';
  for (const line of text.split('\n')) {
    if (current.length + line.length + 1 > MAX_TEXT) {
      chunks.push(current);
      current = '';
    }
    current += (current ? '\n' : '') + line;
  }
  if (current) chunks.push(current);
  for (let i = 0; i < chunks.length; i++) await tg.send(chatId, chunks[i], i === chunks.length - 1 ? buttons : undefined);
}

function constantTimeEquals(a: string, b: string): boolean {
  if (!b) return false;
  const length = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < length; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

