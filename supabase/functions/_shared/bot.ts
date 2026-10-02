// The bot: what each message, command and button press does.
//
// The bot is a small app inside the chat: a main menu, lists you page through,
// a card for each task with its actions, and menus for a reminder and a plan.
// Moving between them edits the one message in place, so the chat stays clean.

import { normalize, parseQuickAdd } from './quickadd.ts';
import type { Moment, Plan } from './quickadd.ts';
import { addDays, isZone, localNow, localToUtc, utcToLocal } from './time.ts';
import { clockLabel, dayLabel, digits, esc, priorityMark, priorityName, repeatLabel, taskCard, taskEntry, truncate, words } from './texts.ts';
import type { Words } from './texts.ts';
import type { AddPayload, Button, EditPayload, OwnerRow, PlanPayload, RemindPayload, StatusPayload, Store, TaskRow, Telegram } from './types.ts';
import { isOpen } from './types.ts';

export interface BotDeps {
  store: Store;
  tg: Telegram;
  /** The code that proves who may use the bot: /start <code>. */
  pairingCode: string;
  now: () => Date;
}

const COMMANDS: Record<string, string> = {
  start: 'start', menu: 'start', منو: 'start',
  help: 'help', راهنما: 'help',
  today: 'today', امروز: 'today',
  list: 'list', لیست: 'list',
  done: 'done', انجام: 'done', تیک: 'done',
  del: 'del', delete: 'del', حذف: 'del',
  remind: 'remind', یادآوری: 'remind',
  plan: 'plan', برنامه: 'plan',
  status: 'status', sync: 'status', وضعیت: 'status',
  settings: 'settings', تنظیمات: 'settings',
  lang: 'lang', زبان: 'lang',
  tz: 'tz', timezone: 'tz',
  cal: 'cal', تقویم: 'cal',
  lead: 'lead',
};

/** Words said on their own, without a slash, that are commands rather than tasks. */
const BARE = new Set(['امروز', 'لیست', 'راهنما', 'وضعیت', 'منو', 'تنظیمات', 'help', 'today', 'list', 'status', 'menu', 'settings']);

const OFF = new Set(['off', 'none', 'no', 'خاموش', 'هیچ', 'نه', 'حذف']);
const DEFAULT = new Set(['default', 'پیشفرض']);

/** Tasks to a page of the list. */
const PAGE = 8;
/** Minutes after which a quiet Obsidian is worth a word. */
const STALE_MINUTES = 30;
const LEADS = [5, 10, 15, 30, 60];
const PRIORITIES = ['highest', 'high', 'medium', 'low', 'lowest'] as const;
const MAX_TAGS = 20;

/** A message that answers one of the bot's questions starts with the property's emoji and ends its first line with the task's number. */
const ASKED = /^(🔔|📅|✏|⏳|🏷|🔁)[^\n#]*#([\d۰-۹]+)[ \t]*(?:\n|$)/u;

type Filter = 'a' | 't' | 'o' | 'u';
const FILTERS: Filter[] = ['a', 't', 'o', 'u'];

interface Message {
  chat: { id: number; type?: string };
  text?: string;
  message_id: number;
  reply_to_message?: { text?: string };
}

interface Update {
  message?: Message;
  callback_query?: { id: string; data?: string; message?: Message };
}

/** Where a request comes from, and what answering it may touch. */
interface Ctx {
  deps: BotDeps;
  owner: OwnerRow;
  w: Words;
  chatId: number;
  /** The message a button was pressed on: navigation edits it. */
  messageId?: number;
  /** A line over the chat for the button just pressed. */
  toast?: string;
}

interface View {
  text: string;
  buttons: Button[][];
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
    const fresh: Omit<OwnerRow, 'last_sync_at'> = { chat_id: chatId, timezone: 'Asia/Tehran', language: 'fa', calendar: 'jalali', lead_minutes: 10 };
    await deps.store.setOwner(fresh);
    await deps.tg.setCommands(chatId, words('fa').commands);
    await deps.tg.send(chatId, words('fa').welcome);
    const paired = await deps.store.getOwner();
    return paired ? sendView(ctxFor(deps, paired, chatId), await homeView(ctxFor(deps, paired, chatId))) : undefined;
  }
  // Nobody but the owner gets an answer.
  if (owner.chat_id !== chatId) return;
  const ctx = ctxFor(deps, owner, chatId);

  if (text.startsWith('/')) {
    const name = normalize(first.slice(1).replace(/@\w+$/, ''));
    const command = COMMANDS[name];
    const args = text.slice(first.length).trim();
    if (command) return runCommand(command, args, ctx);
    return sendView(ctx, helpView(ctx));
  }

  // An answer to one of the bot's questions: the question says which task and which property.
  const asked = ASKED.exec(message.reply_to_message?.text ?? '');
  if (asked) return answerAsked(asked[1], numbersIn(asked[2])[0], text, ctx);

  const bare = COMMANDS[normalize(text)];
  if (BARE.has(normalize(text)) && bare) return runCommand(bare, '', ctx);
  return addTask(text, ctx);
}

function ctxFor(deps: BotDeps, owner: OwnerRow, chatId: number, messageId?: number): Ctx {
  return { deps, owner, w: words(owner.language), chatId, messageId };
}

// ── Commands ───────────────────────────────────────────────────────────────

async function runCommand(command: string, args: string, ctx: Ctx): Promise<void> {
  const { w, owner, chatId } = ctx;
  const { tg, store } = ctx.deps;

  switch (command) {
    case 'start':
      await tg.setCommands(chatId, w.commands);
      return sendView(ctx, await homeView(ctx));
    case 'help':
      return sendView(ctx, helpView(ctx));
    case 'today':
      return sendView(ctx, await listView(ctx, 't', 0));
    case 'list':
      return sendView(ctx, await listView(ctx, 'a', 0));
    case 'status':
      return sendView(ctx, await statusView(ctx));
    case 'settings':
      return sendView(ctx, settingsView(ctx));
    case 'done': {
      const numbers = numbersIn(args);
      if (!numbers.length) return tg.send(chatId, `${w.needNumber}\n${w.usage.done}`);
      for (const n of numbers) await markDone(n, ctx);
      return;
    }
    case 'del': {
      const [n] = numbersIn(args);
      if (n === undefined) return tg.send(chatId, `${w.needNumber}\n${w.usage.del}`);
      const task = await store.taskByN(n);
      if (!task) return tg.send(chatId, w.noSuchTask(digits(n, owner.language)));
      return sendView(ctx, confirmDeleteView(ctx, task, ''));
    }
    case 'remind':
      return setReminder(args, ctx);
    case 'plan':
      return setPlan(args, ctx);
    case 'lang': {
      const value = args.toLowerCase();
      if (value !== 'fa' && value !== 'en') return tg.send(chatId, w.usage.lang);
      await store.patchOwner({ language: value });
      await tg.setCommands(chatId, words(value).commands);
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

// ── Views ──────────────────────────────────────────────────────────────────

/** Shows a view: in place over the message a button was pressed on, otherwise as a new message. */
async function present(ctx: Ctx, view: View): Promise<void> {
  const { tg } = ctx.deps;
  if (ctx.messageId !== undefined) {
    try {
      await tg.edit(ctx.chatId, ctx.messageId, view.text, view.buttons);
      return;
    } catch (error) {
      console.error('edit failed, sending instead', error);
    }
  }
  await tg.send(ctx.chatId, view.text, view.buttons);
}

const sendView = (ctx: Ctx, view: View): Promise<void> => ctx.deps.tg.send(ctx.chatId, view.text, view.buttons);

function syncHealth(owner: OwnerRow, now: Date): { text: string | null; health: 'ok' | 'stale' | 'never' } {
  if (!owner.last_sync_at) return { text: null, health: 'never' };
  const minutes = Math.max(0, Math.round((now.getTime() - new Date(owner.last_sync_at).getTime()) / 60_000));
  return { text: words(owner.language).agoMinutes(minutes), health: minutes > STALE_MINUTES ? 'stale' : 'ok' };
}

async function homeView(ctx: Ctx): Promise<View> {
  const { w, owner } = ctx;
  const now = ctx.deps.now();
  const today = localNow(owner.timezone, now).date;
  const open = await ctx.deps.store.openTasks();
  const buckets = open.map((task) => bucketOf(task, today, owner.timezone));
  const counts = {
    overdue: buckets.filter((b) => b === 'overdue').length,
    today: buckets.filter((b) => b === 'today').length,
    open: open.length,
  };
  const sync = syncHealth(owner, now);
  const rows: Button[][] = [
    [
      { text: w.buttons.today, data: 'ls:t:0', style: 'primary' },
      { text: w.buttons.all, data: 'ls:a:0' },
    ],
    [{ text: w.buttons.newTask, data: 'new', style: 'success' }],
  ];
  if (counts.overdue) rows[1].push({ text: `${w.buttons.overdue} ${digits(counts.overdue, owner.language)}`, data: 'ls:o:0', style: 'danger' });
  rows.push([
    { text: w.buttons.status, data: 'st' },
    { text: w.buttons.settings, data: 'set' },
    { text: w.buttons.help, data: 'help' },
  ]);
  return { text: w.home(counts, sync.text, sync.health), buttons: rows };
}

function helpView(ctx: Ctx): View {
  return { text: ctx.w.help, buttons: [[{ text: ctx.w.buttons.menu, data: 'home' }]] };
}

function newTaskView(ctx: Ctx): View {
  return { text: ctx.w.newTask, buttons: [[{ text: ctx.w.buttons.menu, data: 'home' }]] };
}

async function statusView(ctx: Ctx): Promise<View> {
  const { w } = ctx;
  const open = await ctx.deps.store.openTasks();
  const waiting = (await ctx.deps.store.pendingCommands()).length;
  const sync = syncHealth(ctx.owner, ctx.deps.now());
  return {
    text: w.statusView(open.length, waiting, sync.text, sync.health),
    buttons: [[{ text: w.buttons.refresh, data: 'st' }, { text: w.buttons.menu, data: 'home' }]],
  };
}

function settingsView(ctx: Ctx): View {
  const { w, owner } = ctx;
  return {
    text: w.settings({
      language: w.languageNames[owner.language],
      calendar: w.calendarNames[owner.calendar],
      timezone: owner.timezone,
      lead: owner.lead_minutes,
    }),
    buttons: [
      [
        { text: `${w.settingButtons.language}: ${w.languageNames[owner.language]}`, data: 'set:lang' },
        { text: `${w.settingButtons.calendar}: ${w.calendarNames[owner.calendar]}`, data: 'set:cal' },
      ],
      [{ text: w.settingButtons.lead(owner.lead_minutes), data: 'set:lead' }],
      [{ text: w.settingButtons.zone(owner.timezone), data: 'set:tz' }],
      [{ text: w.buttons.menu, data: 'home' }],
    ],
  };
}

type Bucket = 'overdue' | 'today' | 'tomorrow' | 'later' | 'none';
const BUCKET_ORDER: Bucket[] = ['overdue', 'today', 'tomorrow', 'later', 'none'];

function bucketOf(task: TaskRow, today: string, zone: string): Bucket {
  if (isOverdue(task, today)) return 'overdue';
  if (isToday(task, today, zone)) return 'today';
  const date = task.plan_date ?? task.deadline;
  if (!date) return 'none';
  return date === addDays(today, 1) ? 'tomorrow' : 'later';
}

function matches(filter: Filter, bucket: Bucket): boolean {
  if (filter === 'a') return true;
  if (filter === 't') return bucket === 'overdue' || bucket === 'today';
  if (filter === 'o') return bucket === 'overdue';
  return bucket === 'none';
}

async function listView(ctx: Ctx, filter: Filter, requestedPage: number): Promise<View> {
  const { w, owner } = ctx;
  const now = ctx.deps.now();
  const today = localNow(owner.timezone, now).date;
  const open = await ctx.deps.store.openTasks();
  const entries = open
    .map((task) => ({ task, bucket: bucketOf(task, today, owner.timezone) }))
    .sort((a, b) => BUCKET_ORDER.indexOf(a.bucket) - BUCKET_ORDER.indexOf(b.bucket) || byPlan(a.task, b.task));
  const counts: Record<Filter, number> = { a: 0, t: 0, o: 0, u: 0 };
  for (const entry of entries) for (const f of FILTERS) if (matches(f, entry.bucket)) counts[f]++;

  const shown = entries.filter((entry) => matches(filter, entry.bucket));
  const pages = Math.max(1, Math.ceil(shown.length / PAGE));
  const page = Math.min(Math.max(0, requestedPage), pages - 1);
  const slice = shown.slice(page * PAGE, page * PAGE + PAGE);
  const back = `${filter}${page}`;

  const filterRow = FILTERS.filter((f) => f === filter || f === 'a' || counts[f] > 0).map((f) => ({
    text: `${w.filters[f]} ${digits(counts[f], owner.language)}`,
    data: `ls:${f}:0`,
    ...(f === filter ? { style: 'primary' as const } : {}),
  }));

  let text = `<b>${w.listTitle[filter]}</b>${shown.length ? `  ·  <i>${w.openCount(shown.length)}</i>` : ''}`;
  const buttons: Button[][] = [];
  if (!slice.length) {
    text += `\n\n${w.empty[filter]}`;
  } else {
    let current: Bucket | null = null;
    let group: string[] = [];
    const flush = () => {
      if (current !== null && group.length) text += `\n\n${w.sections[current]}\n<blockquote>${group.join('\n\n')}</blockquote>`;
      group = [];
    };
    for (const { task, bucket } of slice) {
      if (bucket !== current) {
        flush();
        current = bucket;
      }
      group.push(taskEntry(task, owner, today));
    }
    flush();

    for (let i = 0; i < slice.length; i += 2) {
      buttons.push(
        slice.slice(i, i + 2).map(({ task }) => ({
          text: `${digits(task.n, owner.language)} · ${truncate(task.title, 15)}`,
          data: `t:${task.n}@${back}`,
        }))
      );
    }
    if (pages > 1) {
      buttons.push([
        page > 0 ? { text: w.buttons.prev, data: `ls:${filter}:${page - 1}` } : { text: '·', data: 'noop' },
        { text: w.page(page + 1, pages), data: 'noop' },
        page < pages - 1 ? { text: w.buttons.next, data: `ls:${filter}:${page + 1}` } : { text: '·', data: 'noop' },
      ]);
    }
  }
  if (filterRow.length > 1) buttons.push(filterRow);
  buttons.push([{ text: w.buttons.newTask, data: 'new' }, { text: w.buttons.menu, data: 'home' }]);
  return { text, buttons };
}

/** The list a card came from, as its «back» button names it. */
function listOf(back: string): { filter: Filter; page: number } {
  const filter = FILTERS.find((f) => f === back[0]) ?? 'a';
  const page = Number(back.slice(1)) || 0;
  return { filter, page };
}

function cardView(ctx: Ctx, task: TaskRow, back: string, header?: string, footer?: string): View {
  const { w, owner } = ctx;
  const today = localNow(owner.timezone, ctx.deps.now()).date;
  const at = back ? `@${back}` : '';
  const text = [header, taskCard(task, owner, today), footer].filter(Boolean).join('\n\n');
  const buttons: Button[][] = [
    [
      { text: w.buttons.done, data: `done:${task.n}${at}`, style: 'success' },
      { text: w.task.open, data: `cfg:${task.n}${at}`, style: 'primary' },
    ],
    [
      { text: w.buttons.remove, data: `del:${task.n}${at}`, style: 'danger' },
      back ? { text: w.buttons.back, data: `ls:${listOf(back).filter}:${listOf(back).page}` } : { text: w.buttons.menu, data: 'home' },
    ],
  ];
  return { text, buttons };
}

/** Every setting of a task, each a button that shows its value and opens its menu. */
function panelView(ctx: Ctx, task: TaskRow, back: string, header?: string): View {
  const { w, owner } = ctx;
  const today = localNow(owner.timezone, ctx.deps.now()).date;
  const at = back ? `@${back}` : '';
  const f = w.task.fields;
  const dash = w.task.none;
  const label = (emoji: string, name: string, value: string | null) => truncate(`${emoji} ${name}${value === null ? '' : `: ${value}`}`, 30);
  const plan = task.plan_date
    ? planLabel({ date: task.plan_date, start: task.plan_start ?? undefined, end: task.plan_end ?? undefined }, owner, today)
    : dash;
  const text = [header, w.task.panel, taskCard(task, owner, today)].filter(Boolean).join('\n\n');
  const buttons: Button[][] = [
    [
      { text: label('✏️', f.title, null), data: `ed:${task.n}` },
      { text: label('🔄', f.status, w.task.statusNames[task.status === 'doing' ? 'doing' : 'open']), data: `sm:${task.n}${at}` },
    ],
    [
      { text: label('🚩', f.priority, task.priority ? priorityName(owner.language, task.priority) : dash), data: `pm:${task.n}${at}` },
      { text: label('⏳', f.deadline, task.deadline ? dayLabel(task.deadline, owner, today) : dash), data: `dm:${task.n}${at}` },
    ],
    [
      { text: label('📅', f.plan, plan), data: `pl:${task.n}${at}` },
      { text: label('🔔', f.remind, task.remind_at ? momentOf(task.remind_at, ctx, today) : dash), data: `rm:${task.n}${at}` },
    ],
    [
      { text: label('🏷', f.tags, task.tags.length ? digits(task.tags.length, owner.language) : dash), data: `tm:${task.n}${at}` },
      { text: label('🔁', f.repeat, repeatLabel(task.repeat ?? null, owner.language) ?? dash), data: `qm:${task.n}${at}` },
    ],
    [{ text: w.buttons.back, data: `t:${task.n}${at}` }],
  ];
  return { text, buttons };
}

/** A small menu of choices for one setting, with a way back to the panel. */
function choiceView(ctx: Ctx, task: TaskRow, back: string, text: string, rows: Button[][]): View {
  const at = back ? `@${back}` : '';
  return { text, buttons: [...rows, [{ text: ctx.w.buttons.back, data: `cfg:${task.n}${at}` }]] };
}

function statusMenuView(ctx: Ctx, task: TaskRow, back: string): View {
  const { w } = ctx;
  const at = back ? `@${back}` : '';
  const names = w.task.statusNames;
  const mark = (status: string, text: string) => (task.status === status ? `✓ ${text}` : text);
  return choiceView(ctx, task, back, w.task.statusMenu(task.title), [
    [
      { text: mark('open', `⚪ ${names.open}`), data: `ss:${task.n}:open${at}` },
      { text: mark('doing', `🔄 ${names.doing}`), data: `ss:${task.n}:doing${at}` },
    ],
    [{ text: `✅ ${names.done}`, data: `ss:${task.n}:done${at}`, style: 'success' }],
  ]);
}

function priorityMenuView(ctx: Ctx, task: TaskRow, back: string): View {
  const { w, owner } = ctx;
  const at = back ? `@${back}` : '';
  const buttons = PRIORITIES.map((level) => ({
    text: `${task.priority === level ? '✓ ' : ''}${priorityMark(level)} ${priorityName(owner.language, level)}`,
    data: `pr:${task.n}:${level}${at}`,
  }));
  return choiceView(ctx, task, back, w.task.priorityMenu(task.title), [
    buttons.slice(0, 2),
    buttons.slice(2, 4),
    [buttons[4], { text: w.task.noPriority, data: `pr:${task.n}:off${at}` }],
  ]);
}

function deadlineMenuView(ctx: Ctx, task: TaskRow, back: string): View {
  const { w, owner } = ctx;
  const today = localNow(owner.timezone, ctx.deps.now()).date;
  const at = back ? `@${back}` : '';
  const p = w.task.deadlinePresets;
  const set = (days: number) => `ds:${task.n}:${days}${at}`;
  return choiceView(ctx, task, back, w.task.deadlineMenu(task.title, task.deadline ? dayLabel(task.deadline, owner, today) : null), [
    [{ text: p.today, data: set(0) }, { text: p.tomorrow, data: set(1) }],
    [{ text: p.after, data: set(2) }, { text: p.week, data: set(7) }],
    [{ text: w.buttons.custom, data: `dc:${task.n}`, style: 'primary' }],
    ...(task.deadline ? [[{ text: w.task.noDeadline, data: `ds:${task.n}:off${at}` }]] : []),
  ]);
}

function tagsMenuView(ctx: Ctx, task: TaskRow, back: string): View {
  const { w } = ctx;
  const at = back ? `@${back}` : '';
  const rows: Button[][] = [];
  for (let i = 0; i < task.tags.length; i += 2) {
    rows.push(task.tags.slice(i, i + 2).map((tag, j) => ({ text: truncate(`✖️ #${tag}`, 24), data: `tr:${task.n}:${i + j}${at}` })));
  }
  rows.push([{ text: w.task.addTag, data: `ta:${task.n}`, style: 'primary' }]);
  if (task.tags.length > 1) rows.push([{ text: w.task.clearTags, data: `tx:${task.n}${at}` }]);
  return choiceView(ctx, task, back, w.task.tagsMenu(task.title, task.tags), rows);
}

function repeatMenuView(ctx: Ctx, task: TaskRow, back: string): View {
  const { w, owner } = ctx;
  const at = back ? `@${back}` : '';
  const p = w.task.repeatPresets;
  const set = (token: string) => `qs:${task.n}:${token}${at}`;
  const mark = (token: string, text: string) => (task.repeat === token ? `✓ ${text}` : text);
  return choiceView(ctx, task, back, w.task.repeatMenu(task.title, repeatLabel(task.repeat ?? null, owner.language)), [
    [{ text: mark('1d', p.daily), data: set('1d') }, { text: mark('1w', p.weekly), data: set('1w') }],
    [{ text: mark('2w', p.biweekly), data: set('2w') }, { text: mark('1m', p.monthly), data: set('1m') }],
    [{ text: w.buttons.custom, data: `qc:${task.n}`, style: 'primary' }],
    ...(task.repeat ? [[{ text: w.task.noRepeat, data: `qs:${task.n}:off${at}` }]] : []),
  ]);
}

function confirmDeleteView(ctx: Ctx, task: TaskRow, back: string): View {
  const { w } = ctx;
  const at = back ? `@${back}` : '';
  return {
    text: w.confirmDelete(task.title),
    buttons: [[
      { text: w.buttons.yes, data: `delok:${task.n}${at}`, style: 'danger' },
      { text: w.buttons.no, data: `t:${task.n}${at}` },
    ]],
  };
}

function remindMenuView(ctx: Ctx, task: TaskRow, back: string): View {
  const { w, owner } = ctx;
  const today = localNow(owner.timezone, ctx.deps.now()).date;
  const at = back ? `@${back}` : '';
  const current = task.remind_at ? momentOf(task.remind_at, ctx, today) : null;
  const p = w.presets;
  const set = (x: string) => `rs:${task.n}:${x}${at}`;
  return {
    text: w.remindMenu(task.title, current),
    buttons: [
      [{ text: p.m10, data: set('10') }, { text: p.h1, data: set('60') }, { text: p.h3, data: set('180') }],
      [{ text: p.evening, data: set('eve') }, { text: p.tomorrow, data: set('tom') }],
      [{ text: w.buttons.custom, data: `rc:${task.n}`, style: 'primary' }],
      ...(task.remind_at ? [[{ text: w.buttons.noReminder, data: set('off') }]] : []),
      [{ text: w.buttons.back, data: `cfg:${task.n}${at}` }],
    ],
  };
}

function planMenuView(ctx: Ctx, task: TaskRow, back: string): View {
  const { w, owner } = ctx;
  const today = localNow(owner.timezone, ctx.deps.now()).date;
  const at = back ? `@${back}` : '';
  const current = task.plan_date ? planLabel({ date: task.plan_date, start: task.plan_start ?? undefined, end: task.plan_end ?? undefined }, owner, today) : null;
  const p = w.planPresets;
  const set = (x: string) => `ps:${task.n}:${x}${at}`;
  return {
    text: w.planMenu(task.title, current),
    buttons: [
      [{ text: p.today, data: set('0') }, { text: p.tomorrow, data: set('1') }],
      [{ text: p.after, data: set('2') }, { text: p.week, data: set('7') }],
      [{ text: w.buttons.custom, data: `pc:${task.n}`, style: 'primary' }],
      ...(task.plan_date ? [[{ text: w.buttons.noPlan, data: set('off') }]] : []),
      [{ text: w.buttons.back, data: `cfg:${task.n}${at}` }],
    ],
  };
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

async function addTask(text: string, ctx: Ctx): Promise<void> {
  const { w, owner, chatId } = ctx;
  const now = ctx.deps.now();
  const clock = localNow(owner.timezone, now);
  const parsed = parseQuickAdd(text, { today: clock.date, minutes: clock.minutes });
  const title = cleanTitle(parsed.title);
  if (!title) return ctx.deps.tg.send(chatId, w.needTitle);

  let warning = '';
  let remindAt: string | null = null;
  let remind = parsed.remind;
  if (remind) {
    const at = localToUtc(owner.timezone, remind.date, remind.time);
    if (at.getTime() < now.getTime()) {
      warning = w.reminderPast;
      remind = undefined;
    } else remindAt = at.toISOString();
  } else if (parsed.plan?.start) {
    const start = localToUtc(owner.timezone, parsed.plan.date, parsed.plan.start);
    const at = new Date(start.getTime() - owner.lead_minutes * 60_000);
    if (at.getTime() >= now.getTime()) remindAt = at.toISOString();
  }

  const key = `tg:${crypto.randomUUID()}`;
  const row = await ctx.deps.store.insertTask({
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
    repeat: null,
    note_path: null,
    origin: 'telegram',
    pending: true,
  });
  const payload: AddPayload = { key, title, tags: parsed.tags };
  if (parsed.priority) payload.priority = parsed.priority;
  if (parsed.deadline) payload.deadline = parsed.deadline;
  if (parsed.plan) payload.plan = parsed.plan;
  if (remind) payload.remind = remind;
  await ctx.deps.store.addCommand('add', payload);

  const view = cardView(ctx, row, '', w.added, [warning, w.waitingForNotes].filter(Boolean).join('\n'));
  // A task just typed can be taken back with one tap.
  view.buttons[1][0] = { text: w.buttons.undo, data: `undo:${row.n}`, style: 'danger' };
  await sendView(ctx, view);
}

// ── Changing a task ────────────────────────────────────────────────────────

async function markDone(n: number, ctx: Ctx): Promise<void> {
  const { w, owner } = ctx;
  const task = await ctx.deps.store.taskByN(n);
  if (!task || !isOpen(task.status)) return ctx.deps.tg.send(ctx.chatId, w.noSuchTask(digits(n, owner.language)));
  await ctx.deps.store.patchTask(task.key, { status: 'done' });
  const payload: StatusPayload = { key: task.key, status: 'done' };
  await ctx.deps.store.addCommand('status', payload);
  await ctx.deps.tg.send(ctx.chatId, w.done(task.title));
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

/** The moment a preset names, in the owner's time. */
function presetMoment(x: string, ctx: Ctx): Moment | null {
  const now = ctx.deps.now();
  const clock = localNow(ctx.owner.timezone, now);
  if (x === 'tom') return { date: addDays(clock.date, 1), time: '09:00' };
  if (x === 'eve') return clock.minutes < 20 * 60 - 1 ? { date: clock.date, time: '20:00' } : { date: addDays(clock.date, 1), time: '20:00' };
  const minutes = Number(x);
  if (!Number.isFinite(minutes) || minutes <= 0) return null;
  return utcToLocal(ctx.owner.timezone, new Date(now.getTime() + minutes * 60_000));
}

/** Gives a task a reminder at a moment, or none, or the plan's own lead time. Returns what to tell. */
async function applyReminder(ctx: Ctx, task: TaskRow, moment: Moment | 'off' | 'default'): Promise<string> {
  const { w, owner } = ctx;
  const clock = localNow(owner.timezone, ctx.deps.now());
  let remindAt: string | null = null;
  let reply: string;
  if (moment === 'off') reply = w.reminderOff(task.title);
  else if (moment === 'default') {
    if (task.plan_date && task.plan_start) {
      remindAt = new Date(localToUtc(owner.timezone, task.plan_date, task.plan_start).getTime() - owner.lead_minutes * 60_000).toISOString();
    }
    reply = w.reminderDefault(task.title);
  } else {
    remindAt = localToUtc(owner.timezone, moment.date, moment.time).toISOString();
    reply = w.reminderSet(task.title, momentLabel(moment, owner, clock.date));
  }
  await ctx.deps.store.patchTask(task.key, { remind_at: remindAt });
  const payload: RemindPayload = { key: task.key, moment };
  await ctx.deps.store.addCommand('remind', payload);
  return reply;
}

async function setReminder(args: string, ctx: Ctx): Promise<void> {
  const { w, owner } = ctx;
  const { tg, store } = ctx.deps;
  const [n] = numbersIn(args);
  if (n === undefined) return tg.send(ctx.chatId, `${w.needNumber}\n${w.usage.remind}`);
  const task = await store.taskByN(n);
  if (!task) return tg.send(ctx.chatId, w.noSuchTask(digits(n, owner.language)));
  const rest = args.replace(/^\s*#?[\d۰-۹٠-٩]+/, '').trim();
  const word = normalize(rest);
  const now = ctx.deps.now();
  const clock = localNow(owner.timezone, now);

  const finish = async (reply: string) => present(ctx, panelView(ctx, (await store.taskByN(n)) ?? task, '', reply));
  if (OFF.has(word)) return finish(await applyReminder(ctx, task, 'off'));
  if (DEFAULT.has(word)) return finish(await applyReminder(ctx, task, 'default'));
  const moment = parseQuickAdd(`remind ${rest}`, { today: clock.date, minutes: clock.minutes }).remind;
  if (!moment || !rest) return tg.send(ctx.chatId, `${w.cantRead}\n${w.usage.remind}`);
  if (localToUtc(owner.timezone, moment.date, moment.time).getTime() < now.getTime()) return tg.send(ctx.chatId, w.reminderPast);
  return finish(await applyReminder(ctx, task, moment));
}

async function applyPlan(ctx: Ctx, task: TaskRow, plan: Plan | null): Promise<string> {
  const { w, owner } = ctx;
  const clock = localNow(owner.timezone, ctx.deps.now());
  if (plan) await ctx.deps.store.patchTask(task.key, { plan_date: plan.date, plan_start: plan.start ?? null, plan_end: plan.end ?? null });
  else await ctx.deps.store.patchTask(task.key, { plan_date: null, plan_start: null, plan_end: null });
  const payload: PlanPayload = { key: task.key, plan };
  await ctx.deps.store.addCommand('plan', payload);
  return plan ? w.planSet(task.title, planLabel(plan, owner, clock.date)) : w.planOff(task.title);
}

async function setPlan(args: string, ctx: Ctx): Promise<void> {
  const { w, owner } = ctx;
  const { tg, store } = ctx.deps;
  const [n] = numbersIn(args);
  if (n === undefined) return tg.send(ctx.chatId, `${w.needNumber}\n${w.usage.plan}`);
  const task = await store.taskByN(n);
  if (!task) return tg.send(ctx.chatId, w.noSuchTask(digits(n, owner.language)));
  const rest = args.replace(/^\s*#?[\d۰-۹٠-٩]+/, '').trim();
  const clock = localNow(owner.timezone, ctx.deps.now());

  if (OFF.has(normalize(rest))) {
    const reply = await applyPlan(ctx, task, null);
    return present(ctx, panelView(ctx, (await store.taskByN(n)) ?? task, '', reply));
  }
  const plan = parseQuickAdd(rest, { today: clock.date, minutes: clock.minutes }).plan;
  if (!plan || !rest) return tg.send(ctx.chatId, `${w.cantRead}\n${w.usage.plan}`);
  const reply = await applyPlan(ctx, task, plan);
  await present(ctx, panelView(ctx, (await store.taskByN(n)) ?? task, '', reply));
}

// ── A task's own settings ───────────────────────────────────────────────────

/** Asks the plugin to change a task's settings, and shows the change in the bot's copy at once. */
async function saveEdit(ctx: Ctx, task: TaskRow, fields: Omit<EditPayload, 'key'>, patch: Partial<Omit<TaskRow, 'n' | 'key'>>): Promise<boolean> {
  try {
    await ctx.deps.store.addCommand('edit', { key: task.key, ...fields });
  } catch (error) {
    // The database has not learnt the edit yet (it updates itself on first use).
    console.error('edit not queued', error);
    await ctx.deps.tg.send(ctx.chatId, ctx.w.task.editUnavailable);
    return false;
  }
  await ctx.deps.store.patchTask(task.key, patch);
  return true;
}

async function markDoneQuietly(task: TaskRow, ctx: Ctx): Promise<void> {
  await ctx.deps.store.patchTask(task.key, { status: 'done' });
  const payload: StatusPayload = { key: task.key, status: 'done' };
  await ctx.deps.store.addCommand('status', payload);
}

/** The words after "every" as a repeat token: «هر ۳ روز» is 3d. Null for none, undefined when unreadable. */
export function parseRepeat(text: string): string | null | undefined {
  const t = normalize(text).replace(/\s+/g, ' ').trim();
  if (!t) return undefined;
  if (OFF.has(t) || /^(بدون|هیچ|no|none|never)/.test(t)) return null;
  const named: Record<string, string> = { روزانه: '1d', daily: '1d', هفتگی: '1w', weekly: '1w', ماهانه: '1m', monthly: '1m' };
  if (named[t]) return named[t];
  const units: Record<string, string> = { روز: 'd', day: 'd', days: 'd', d: 'd', هفته: 'w', week: 'w', weeks: 'w', w: 'w', ماه: 'm', month: 'm', months: 'm', m: 'm' };
  const match = /^(?:هر|every|each)?\s*(\d{1,3})?\s*([a-z\u0600-\u06ff]+)$/.exec(t);
  const unit = match && units[match[2]];
  const every = match?.[1] ? Number(match[1]) : 1;
  return unit && every >= 1 ? `${every}${unit}` : undefined;
}

/** Tag keys from what was typed: «#کار  خانه, home» is three. */
export function parseTags(text: string): string[] {
  const keys: string[] = [];
  for (const part of text.split(/[\s,،#]+/)) {
    const key = part
      .normalize('NFC')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\p{M}_\-/\u200c]/gu, '')
      .replace(/-{2,}/g, '-')
      .replace(/^[-/]+|[-/]+$/g, '');
    if (key && !keys.includes(key)) keys.push(key);
  }
  return keys.slice(0, MAX_TAGS);
}

/** What came back for a question the bot asked: a title, a deadline, tags, a repeat, a reminder or a plan. */
async function answerAsked(kind: string, n: number, text: string, ctx: Ctx): Promise<void> {
  const { w, owner } = ctx;
  const { store, tg } = ctx.deps;
  if (kind === '🔔') return setReminder(`${n} ${text}`, ctx);
  if (kind === '📅') return setPlan(`${n} ${text}`, ctx);

  const task = await store.taskByN(n);
  if (!task) return tg.send(ctx.chatId, w.noSuchTask(digits(n, owner.language)));
  const clock = localNow(owner.timezone, ctx.deps.now());
  const finish = async (what: string) => present(ctx, panelView(ctx, (await store.taskByN(n)) ?? task, '', w.task.saved(what)));

  if (kind === '✏') {
    const title = cleanTitle(text);
    if (!title) return tg.send(ctx.chatId, w.needTitle);
    if (await saveEdit(ctx, task, { title }, { title })) await finish(`${w.task.fields.title} · ${esc(title)}`);
    return;
  }
  if (kind === '⏳') {
    const parsed = parseQuickAdd(`due ${text}`, { today: clock.date, minutes: clock.minutes });
    const deadline = parsed.deadline ?? parseQuickAdd(text, { today: clock.date, minutes: clock.minutes }).plan?.date;
    if (!deadline) return tg.send(ctx.chatId, w.task.cantReadDeadline);
    if (await saveEdit(ctx, task, { deadline }, { deadline })) await finish(`${w.task.fields.deadline} · ${dayLabel(deadline, owner, clock.date)}`);
    return;
  }
  if (kind === '🏷') {
    const added = parseTags(text);
    if (!added.length) return tg.send(ctx.chatId, w.task.needTags);
    const tags = [...task.tags, ...added.filter((tag) => !task.tags.includes(tag))].slice(0, MAX_TAGS);
    if (await saveEdit(ctx, task, { tags }, { tags })) await finish(`${w.task.fields.tags} · ${esc(tags.map((tag) => `#${tag}`).join(' '))}`);
    return;
  }
  if (kind === '🔁') {
    const repeat = parseRepeat(text);
    if (repeat === undefined) return tg.send(ctx.chatId, w.task.cantReadRepeat);
    if (await saveEdit(ctx, task, { repeat }, { repeat })) await finish(`${w.task.fields.repeat} · ${repeatLabel(repeat, owner.language) ?? w.task.none}`);
  }
}

// ── Buttons ────────────────────────────────────────────────────────────────

async function handleCallback(
  callback: NonNullable<Update['callback_query']>,
  deps: BotDeps
): Promise<void> {
  const owner = await deps.store.getOwner();
  const chatId = callback.message?.chat.id;
  if (!owner || chatId === undefined || owner.chat_id !== chatId) return deps.tg.answer(callback.id);
  const ctx = ctxFor(deps, owner, chatId, callback.message?.message_id);
  try {
    await route(callback.data ?? '', ctx);
  } finally {
    await deps.tg.answer(callback.id, ctx.toast);
  }
}

async function route(data: string, ctx: Ctx): Promise<void> {
  const { w, owner, deps } = ctx;
  const { store, tg } = deps;
  const [core, back = ''] = data.split('@');
  const [action, rawN, arg] = core.split(':');

  switch (action) {
    case 'noop':
      return;
    case 'home':
      return present(ctx, await homeView(ctx));
    case 'help':
      return present(ctx, helpView(ctx));
    case 'new':
      return present(ctx, newTaskView(ctx));
    case 'st':
      return present(ctx, await statusView(ctx));
    case 'ls':
      return present(ctx, await listView(ctx, FILTERS.find((f) => f === rawN) ?? 'a', Number(arg) || 0));
    case 'set':
      return settings(rawN, ctx);
  }

  // Everything below is about one task.
  const n = Number(rawN);
  const task = Number.isFinite(n) ? await store.taskByN(n) : null;
  if (!task) {
    ctx.toast = w.noSuchTask(digits(rawN ?? '', owner.language));
    return;
  }
  const backTo = listOf(back);

  switch (action) {
    case 't':
      return present(ctx, cardView(ctx, task, back));
    case 'rm':
      return present(ctx, remindMenuView(ctx, task, back));
    case 'pl':
      return present(ctx, planMenuView(ctx, task, back));
    case 'rc':
    case 'pc': {
      const remind = action === 'rc';
      const label = digits(task.n, owner.language);
      const prompt = remind ? w.askRemind(label, task.title) : w.askPlan(label, task.title);
      await tg.send(ctx.chatId, esc(prompt), undefined, { forceReply: remind ? w.askHintRemind : w.askHintPlan });
      return;
    }
    case 'done': {
      if (!isOpen(task.status)) {
        ctx.toast = w.noSuchTask(digits(rawN, owner.language));
        return;
      }
      await store.patchTask(task.key, { status: 'done' });
      const payload: StatusPayload = { key: task.key, status: 'done' };
      await store.addCommand('status', payload);
      ctx.toast = w.doneToast;
      // From a list, straight back to it: the next task is one tap away.
      if (back) return present(ctx, await listView(ctx, backTo.filter, backTo.page));
      return present(ctx, { text: `${w.doneTitle}\n<s>${esc(task.title)}</s>`, buttons: [[{ text: w.buttons.all, data: 'ls:a:0' }, { text: w.buttons.menu, data: 'home' }]] });
    }
    case 'del':
      return present(ctx, confirmDeleteView(ctx, task, back));
    case 'undo':
    case 'delok': {
      await removeTask(task, deps);
      ctx.toast = w.deletedToast;
      if (back) return present(ctx, await listView(ctx, backTo.filter, backTo.page));
      return present(ctx, { text: w.deleted(task.title), buttons: [[{ text: w.buttons.all, data: 'ls:a:0' }, { text: w.buttons.menu, data: 'home' }]] });
    }
    case 'snz':
    case 'rs': {
      // A snooze under a reminder shows the card; a choice in the panel goes back to the panel.
      const show = async (reply: string) => {
        const fresh = (await store.taskByN(n)) ?? task;
        return present(ctx, action === 'snz' ? cardView(ctx, fresh, back, reply) : panelView(ctx, fresh, back, reply));
      };
      if (arg === 'off' || arg === 'def') return show(await applyReminder(ctx, task, arg === 'off' ? 'off' : 'default'));
      const moment = presetMoment(arg ?? '10', ctx);
      if (!moment) return;
      const reply = await applyReminder(ctx, task, moment);
      ctx.toast = w.snoozeToast;
      return show(reply);
    }
    case 'ps': {
      if (arg === 'off') {
        const reply = await applyPlan(ctx, task, null);
        return present(ctx, panelView(ctx, (await store.taskByN(n)) ?? task, back, reply));
      }
      const days = Number(arg);
      if (!Number.isFinite(days)) return;
      const today = localNow(owner.timezone, deps.now()).date;
      // The day moves; the hours, if the task had any, stay.
      const plan: Plan = { date: addDays(today, days) };
      if (task.plan_start) plan.start = task.plan_start;
      if (task.plan_end) plan.end = task.plan_end;
      const reply = await applyPlan(ctx, task, plan);
      return present(ctx, panelView(ctx, (await store.taskByN(n)) ?? task, back, reply));
    }

    // The task's own settings.
    case 'cfg':
      return present(ctx, panelView(ctx, task, back));
    case 'sm':
      return present(ctx, statusMenuView(ctx, task, back));
    case 'pm':
      return present(ctx, priorityMenuView(ctx, task, back));
    case 'dm':
      return present(ctx, deadlineMenuView(ctx, task, back));
    case 'tm':
      return present(ctx, tagsMenuView(ctx, task, back));
    case 'qm':
      return present(ctx, repeatMenuView(ctx, task, back));
    case 'ed':
    case 'dc':
    case 'ta':
    case 'qc': {
      const t = w.task;
      const label = digits(task.n, owner.language);
      const [prompt, hint] = {
        ed: [t.askTitle(label, task.title), t.hintTitle],
        dc: [t.askDeadline(label, task.title), t.hintDeadline],
        ta: [t.askTags(label, task.title), t.hintTags],
        qc: [t.askRepeat(label, task.title), t.hintRepeat],
      }[action]!;
      await tg.send(ctx.chatId, esc(prompt), undefined, { forceReply: hint });
      return;
    }
    case 'ss': {
      if (arg === 'done') {
        if (!isOpen(task.status)) return;
        await markDoneQuietly(task, ctx);
        ctx.toast = w.doneToast;
        if (back) return present(ctx, await listView(ctx, backTo.filter, backTo.page));
        return present(ctx, { text: `${w.doneTitle}\n<s>${esc(task.title)}</s>`, buttons: [[{ text: w.buttons.all, data: 'ls:a:0' }, { text: w.buttons.menu, data: 'home' }]] });
      }
      if (arg !== 'open' && arg !== 'doing') return;
      if (task.status !== arg) {
        const payload: StatusPayload = { key: task.key, status: arg };
        await store.addCommand('status', payload);
        await store.patchTask(task.key, { status: arg });
      }
      ctx.toast = w.task.editToast;
      return present(ctx, panelView(ctx, (await store.taskByN(n)) ?? task, back));
    }
    case 'pr': {
      const priority = arg === 'off' ? null : PRIORITIES.find((level) => level === arg);
      if (priority === undefined) return;
      if (await saveEdit(ctx, task, { priority }, { priority })) ctx.toast = w.task.editToast;
      return present(ctx, panelView(ctx, (await store.taskByN(n)) ?? task, back));
    }
    case 'ds': {
      const today = localNow(owner.timezone, deps.now()).date;
      const deadline = arg === 'off' ? null : Number.isFinite(Number(arg)) ? addDays(today, Number(arg)) : undefined;
      if (deadline === undefined) return;
      if (await saveEdit(ctx, task, { deadline }, { deadline })) ctx.toast = w.task.editToast;
      return present(ctx, panelView(ctx, (await store.taskByN(n)) ?? task, back));
    }
    case 'tr':
    case 'tx': {
      const tags = action === 'tx' ? [] : task.tags.filter((_, i) => i !== Number(arg));
      if (await saveEdit(ctx, task, { tags }, { tags })) ctx.toast = w.task.editToast;
      return present(ctx, tagsMenuView(ctx, (await store.taskByN(n)) ?? task, back));
    }
    case 'qs': {
      const repeat = arg === 'off' ? null : /^\d{1,3}[dwm]$/.test(arg ?? '') ? arg! : undefined;
      if (repeat === undefined) return;
      if (await saveEdit(ctx, task, { repeat }, { repeat })) ctx.toast = w.task.editToast;
      return present(ctx, panelView(ctx, (await store.taskByN(n)) ?? task, back));
    }
  }
}

async function settings(what: string | undefined, ctx: Ctx): Promise<void> {
  const { owner, w } = ctx;
  const { store, tg } = ctx.deps;
  let next = owner;
  if (what === 'lang') {
    const language = owner.language === 'fa' ? 'en' : 'fa';
    await store.patchOwner({ language });
    await tg.setCommands(ctx.chatId, words(language).commands);
    next = { ...owner, language };
  } else if (what === 'cal') {
    next = { ...owner, calendar: owner.calendar === 'jalali' ? 'gregorian' : 'jalali' };
    await store.patchOwner({ calendar: next.calendar });
  } else if (what === 'lead') {
    const at = LEADS.indexOf(owner.lead_minutes);
    next = { ...owner, lead_minutes: LEADS[(at + 1) % LEADS.length] };
    await store.patchOwner({ lead_minutes: next.lead_minutes });
  } else if (what === 'tz') {
    ctx.toast = w.zoneHint;
    return;
  }
  const fresh = ctxFor(ctx.deps, next, ctx.chatId, ctx.messageId);
  fresh.toast = ctx.toast;
  await present(fresh, settingsView(fresh));
}

// ── Pieces ─────────────────────────────────────────────────────────────────

function momentLabel(moment: Moment, owner: OwnerRow, today: string): string {
  return `${dayLabel(moment.date, owner, today)} ${clockLabel(moment.time, owner.language)}`;
}

function momentOf(iso: string, ctx: Ctx, today: string): string {
  const at = utcToLocal(ctx.owner.timezone, new Date(iso));
  return momentLabel(at, ctx.owner, today);
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
  const left = `${a.plan_date ?? a.deadline ?? '9999'} ${a.plan_start ?? ''}`;
  const right = `${b.plan_date ?? b.deadline ?? '9999'} ${b.plan_start ?? ''}`;
  return left === right ? a.n - b.n : left < right ? -1 : 1;
}

function constantTimeEquals(a: string, b: string): boolean {
  if (!b) return false;
  const length = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < length; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}
