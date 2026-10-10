// The bot: what each message, command and button press does.
//
// The bot is a small app inside the chat: a main menu, lists you page through,
// a card for each task with its actions, and menus for a reminder and a plan.
// Moving between them edits the one message in place, so the chat stays clean.

import { normalize, parseQuickAdd } from './quickadd.ts';
import { MAX_TAGS, OFF, cleanTitle, parseRepeat, parseTags } from './taskfields.ts';
import type { Moment, Plan } from './quickadd.ts';
import { addDays, clockMinutes, daysBetween, isRealDate, isZone, localNow, localToUtc, toClock, utcToLocal, weekdayOf } from './time.ts';
import { bucketOf, byHour, byPlan, isOverdue, isToday, onDay } from './agenda.ts';
import type { Bucket } from './agenda.ts';
import { buildMonth, monthKeyOf, monthName, partsOf } from './calendar-picker.ts';
import { htmlToRich, mdEscape } from './rich.ts';
import { PADS, padOf, widenHtml, widenMarkdown } from './widen.ts';
import { clockLabel, counted, dateLabel, dayItem, dayLabel, dayNumber, digits, esc, priorityMark, priorityName, repeatLabel, taskCard, taskCardRich, taskEntry, taskEntryRich, truncate, weekdayAndDay, weekdayInitial, weekRange, words } from './texts.ts';
import type { Relatives } from './texts.ts';
import type { Words } from './texts.ts';
import type { AiConfirm, PendingPlan, DeadlineNudge, AddPayload, Button, EditPayload, OwnerRow, PlanPayload, Rich, RemindPayload, StatusPayload, Store, TaskRow, Telegram } from './types.ts';
import { PROVISIONAL_N, isOpen } from './types.ts';
import { AiError } from './ai.ts';
import type { Ai } from './ai.ts';
import { MEMORY_MINUTES, freshMemory, remember, replayCalls, runAssistant } from './assistant.ts';
import { OverlayStore } from './overlay-store.ts';
import type { AssistantResult, Effects, NewTask } from './assistant.ts';

export { cleanTitle, parseRepeat, parseTags };

export interface BotDeps {
  store: Store;
  tg: Telegram;
  /** The code that proves who may use the bot: /start <code>. */
  pairingCode: string;
  /** Telegram's numeric id of the one person the bot answers (ALLOWED_USER_ID); anyone else is ignored. A value that is not a number answers nobody. */
  allowedUserId?: number;
  now: () => Date;
  /** The assistant (Cloudflare Workers AI), when its keys are set. */
  ai?: Ai;
}

const COMMANDS: Record<string, string> = {
  start: 'start', menu: 'start', منو: 'start',
  help: 'help', راهنما: 'help',
  today: 'today', امروز: 'today',
  list: 'list', لیست: 'list',
  done: 'done', انجام: 'done', تیک: 'done',
  fail: 'fail', failed: 'fail', نشد: 'fail',
  del: 'del', delete: 'del', حذف: 'del',
  remind: 'remind', یادآوری: 'remind',
  plan: 'plan', برنامه: 'plan',
  status: 'status', sync: 'status', وضعیت: 'status',
  settings: 'settings', تنظیمات: 'settings',
  lang: 'lang', زبان: 'lang',
  id: 'id', شناسه: 'id',
  tz: 'tz', timezone: 'tz',
  cal: 'cal', تقویم: 'cal',
  lead: 'lead',
  tags: 'tags', tag: 'tags', برچسب: 'tags', برچسبها: 'tags',
  ai: 'ai', دستیار: 'ai', هوش: 'ai',
  overview: 'overview', نمایکلی: 'overview', week: 'overview', هفته: 'overview',
  day: 'day', روز: 'day',
  planday: 'planday', روزم: 'planday',
};

/** Words said on their own, without a slash, that are commands rather than tasks. */
const BARE = new Set(['امروز', 'لیست', 'راهنما', 'وضعیت', 'منو', 'تنظیمات', 'help', 'today', 'list', 'status', 'menu', 'settings']);

const DEFAULT = new Set(['default', 'پیشفرض']);

/** Tasks to a page of the list. */
const PAGE = 8;
/** Minutes after which a quiet Obsidian is worth a word. */
const STALE_MINUTES = 30;
const LEADS = [5, 10, 15, 30, 60];
const PRIORITIES = ['highest', 'high', 'medium', 'low', 'lowest'] as const;
/** Tags to a page of the tag list and of the picker. */
const TAG_PAGE = 10;
/** The most bytes of a tag that fit in a button's data beside the rest of it (Telegram allows 64). */
const TAG_PICK_BYTES = 36;
const TAG_LIST_BYTES = 24;
const TAG_SAFE = /^[\p{L}\p{N}\p{M}_\-/\u200c]+$/u;
const byteLength = (text: string): number => new TextEncoder().encode(text).length;
/** A tag that can ride in a button's data. */
const fits = (tag: string, limit: number): boolean => TAG_SAFE.test(tag) && byteLength(tag) <= limit;

/** A message that answers one of the bot's questions starts with the property's emoji and ends its first line with the task's number. */
const ASKED = /^(🔔|📅|✏|⏳|🏷|🔁|⏰|🕒|🧩)[^\n#]*#([\d۰-۹]+)[ \t]*(?:\n|$)/u;
/** The question "what is the task?" asked for a day chosen on the calendar: the day is on the second line. */
const ASKED_DAY = /^🗓[^\n]*\n(\d{4}-\d{2}-\d{2})/u;
/** The question "what is the task?" asked for a new task that starts with a tag: the tag is on the second line. */
const ASKED_TAGGED = /^🆕[^\n]*\n#(\S+)/u;

/** What the calendar is picking a day for: a reminder, a plan, a deadline, or a new task. */
type Pick = 'r' | 'p' | 'd' | 'x';
const PICKS = new Set<string>(['r', 'p', 'd', 'x']);

type Filter = 'a' | 't' | 'o' | 'd' | 'u';
const FILTERS: Filter[] = ['a', 't', 'o', 'd', 'u'];

interface Message {
  chat: { id: number; type?: string };
  from?: { id: number };
  text?: string;
  message_id: number;
  reply_to_message?: { text?: string };
  voice?: Voice;
  audio?: Voice;
}

/** A voice message, or an audio file. */
interface Voice {
  file_id: string;
  duration?: number;
}

interface Update {
  message?: Message;
  callback_query?: { id: string; data?: string; from?: { id: number }; message?: Message };
}

/** Whether the bot may answer this person: always, unless it was locked to one user id. */
const mayAnswer = (deps: BotDeps, sender: number | undefined): boolean => deps.allowedUserId === undefined || sender === deps.allowedUserId;

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
  /** The message being answered, when it is one the owner wrote. */
  incoming?: number;
}

/** A button that holds a place and does nothing: drawn disabled where Telegram can. */
const idle = (text: string): Button => ({ text, data: 'noop', disabled: true });

interface View {
  text: string;
  buttons: Button[][];
  /** The screen as rich Markdown, where it reads better than the HTML turned into it. */
  rich?: string;
}

export async function handleUpdate(update: Update, deps: BotDeps): Promise<void> {
  if (update.callback_query) return handleCallback(update.callback_query, deps);
  const message = update.message;
  // Locked to one person: everyone else gets no answer at all, not even «send /start».
  if (message && !mayAnswer(deps, message.from?.id ?? message.chat.id)) return;
  const voice = message?.voice ?? message?.audio;
  if (!message || message.chat.type !== 'private' || (!message.text && !voice)) return;
  const text = message.text?.trim() ?? '';
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
  const ctx = { ...ctxFor(deps, owner, chatId), incoming: message.message_id };
  if (!text && voice) return handleVoice(voice, ctx);

  if (text.startsWith('/')) {
    const name = normalize(first.slice(1).replace(/@\w+$/, ''));
    const command = COMMANDS[name];
    const args = text.slice(first.length).trim();
    if (command) return runCommand(command, args, ctx);
    return sendView(ctx, helpView(ctx));
  }

  // An answer to one of the bot's questions: the question says which task and which property.
  const replied = message.reply_to_message?.text ?? '';
  const askedDay = ASKED_DAY.exec(replied);
  if (askedDay) return addTask(text, ctx, askedDay[1]);
  const askedTag = ASKED_TAGGED.exec(replied);
  if (askedTag) return addTask(`${text} #${askedTag[1]}`, ctx);
  const asked = ASKED.exec(replied);
  if (asked) return answerAsked(asked[1], numbersIn(asked[2])[0], text, replied, ctx);

  const bare = COMMANDS[normalize(text)];
  if (BARE.has(normalize(text)) && bare) return runCommand(bare, '', ctx);
  // With the assistant on, what is written goes to it first; the plain reading of the words is its fallback.
  if (deps.ai && owner.ai !== false) return assist(text, ctx, { fallback: true });
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
    case 'id':
      return tg.send(chatId, w.userId(chatId));
    case 'tags':
      return sendView(ctx, await tagsView(ctx, 0));
    case 'ai':
      return args ? assist(args, ctx) : sendView(ctx, aiView(ctx));
    case 'overview':
      return sendView(ctx, await weekView(ctx, 0));
    case 'day':
      return sendView(ctx, await dayView(ctx, todayOf(ctx)));
    case 'planday':
      return planDay(ctx);
    case 'settings':
      return sendView(ctx, settingsView(ctx));
    case 'done': {
      const numbers = numbersIn(args);
      if (!numbers.length) return tg.send(chatId, `${w.needNumber}\n${w.usage.done}`);
      for (const n of numbers) await markDone(n, ctx);
      return;
    }
    case 'fail': {
      const [n] = numbersIn(args);
      if (n === undefined) return tg.send(chatId, `${w.needNumber}\n${w.usage.fail}`);
      const task = await store.taskByN(n);
      if (!task || !isOpen(task.status)) return tg.send(chatId, w.noSuchTask(digits(n, owner.language)));
      await closeTask(task, 'failed', ctx);
      return tg.send(chatId, w.failed(task.title));
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

/** The screen as a rich message, unless the owner turned that off. */
function richOf(ctx: Ctx, view: View): Rich | undefined {
  if (ctx.owner.rich === false) return undefined;
  const markdown = view.rich ?? htmlToRich(view.text);
  return { markdown: widenMarkdown(markdown, view.text, view.buttons.length > 0, padOf(ctx.owner.pad)), rtl: ctx.owner.language === 'fa' };
}

/** The classic text of a screen, widened so a short message does not hang its buttons out from under it. */
const textOf = (ctx: Ctx, view: View): string => widenHtml(view.text, view.buttons.length > 0, padOf(ctx.owner.pad));

/** Shows a view: in place over the message a button was pressed on, otherwise as a new message. */
async function present(ctx: Ctx, view: View): Promise<void> {
  const { tg } = ctx.deps;
  if (ctx.messageId !== undefined) {
    try {
      await tg.edit(ctx.chatId, ctx.messageId, textOf(ctx, view), view.buttons, richOf(ctx, view));
      return;
    } catch (error) {
      console.error("edit failed, sending instead");
    }
  }
  await sendView(ctx, view);
}

const sendView = (ctx: Ctx, view: View, replyTo?: number): Promise<void> => ctx.deps.tg.send(ctx.chatId, textOf(ctx, view), view.buttons, { rich: richOf(ctx, view), ...(replyTo ? { replyTo } : {}) });

/** The tab bar under the main screens: home, today, all, new, settings. */
function navRow(ctx: Ctx, active?: 'home' | 'today' | 'all' | 'new' | 'settings'): Button[] {
  const n = ctx.w.nav;
  const tab = (key: NonNullable<typeof active>, text: string, data: string): Button => ({ text, data, ...(active === key ? { style: 'primary' as const } : {}) });
  return [tab('home', n.home, 'home'), tab('today', n.today, 'ls:t:0'), tab('all', n.all, 'ls:a:0'), tab('new', n.newTask, 'new'), tab('settings', n.settings, 'set')];
}

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
  // A dashboard: what is next, and the first of today's tasks.
  const clock = localNow(owner.timezone, now);
  const late = (task: TaskRow) => (bucketOf(task, today, owner.timezone) === 'overdue' ? 0 : 1);
  const todays = open.filter((_, i) => buckets[i] === 'today' || buckets[i] === 'overdue').sort((a, b) => late(a) - late(b) || byPlan(a, b));
  const next = todays.find((task) => task.plan_date === today && task.plan_start && clockMinutes(task.plan_start) >= clock.minutes - 30) ?? null;
  const preview = todays.slice(0, 3).map((task) => `${task.plan_date === today && task.plan_start ? `<code>${clockLabel(task.plan_start, owner.language)}</code> ` : '• '}${esc(truncate(task.title, 40))}`);
  let board = `<i>${w.ui.greeting(clock.minutes)}</i>`;
  if (next) board += `\n⏭ ${w.ui.nextUp}: <b>${esc(truncate(next.title, 40))}</b> · ${clockLabel(next.plan_start!, owner.language)}`;
  if (preview.length) board += `\n\n<b>📅 ${w.ui.todayHeading}</b>\n<blockquote>${preview.join('\n')}${todays.length > 3 ? `\n${w.ui.moreToday(todays.length - 3)}` : ''}</blockquote>`;
  const rows: Button[][] = [
    [
      { text: w.buttons.today, data: 'ls:t:0', style: 'primary' },
      { text: w.buttons.all, data: 'ls:a:0' },
    ],
    [{ text: w.buttons.newTask, data: 'new', style: 'success' }, { text: w.digest.buttons.overview, data: 'ov' }],
  ];
  if (counts.overdue) rows[1].push({ text: counted(w.buttons.overdue, counts.overdue, owner.language), data: 'ls:o:0', style: 'danger' });
  rows.push([
    { text: w.tagsUi.button, data: 'tg:0' },
    { text: w.buttons.status, data: 'st' },
  ]);
  if (ctx.deps.ai) rows.push([{ text: `🤖 ${w.ai.name}`, data: 'ai' }]);
  rows.push([
    { text: w.buttons.settings, data: 'set' },
    { text: w.buttons.help, data: 'help' },
  ]);
  // Under the name, before the counts.
  const summary = w.home(counts, sync.text, sync.health);
  const cut = summary.indexOf('\n');
  // The rich home: the name, a greeting, what is next marked, today as a task list, the counts on one line, the sync small at the foot.
  const md: string[] = [`# ✨ TaskPro`, `*${w.ui.greeting(clock.minutes)}*`];
  if (next) md.push(`==⏭ ${w.ui.nextUp}: **${mdEscape(truncate(next.title, 40))}** · ${clockLabel(next.plan_start!, owner.language)}==`);
  if (todays.length) {
    const items = todays.slice(0, 3).map((task) => `- [ ] ${task.plan_date === today && task.plan_start ? `\`${clockLabel(task.plan_start, owner.language)}\` ` : ''}${mdEscape(truncate(task.title, 40))}`);
    md.push(`### 📅 ${w.ui.todayHeading}\n\n${items.join('\n')}${todays.length > 3 ? `\n\n${htmlToRich(w.ui.moreToday(todays.length - 3))}` : ''}`);
  } else md.push(htmlToRich(w.empty.t));
  md.push(w.ui.countsLine(counts));
  md.push(footer(`${sync.health === 'ok' ? '🟢' : sync.health === 'stale' ? '🟡' : '⚪'} ${w.ui.syncLine(sync.text)} · ${w.ui.typeHint}`));
  return { text: `${summary.slice(0, cut)}\n${board}\n${summary.slice(cut + 1)}`, rich: md.join('\n\n'), buttons: rows };
}

function helpView(ctx: Ctx): View {
  return { text: ctx.w.help, buttons: [navRow(ctx)] };
}

async function newTaskView(ctx: Ctx): Promise<View> {
  const key = monthKeyOf(ctx.owner.calendar, localNow(ctx.owner.timezone, ctx.deps.now()).date);
  const tags = (await knownTags(ctx)).filter((tag) => fits(tag.key, TAG_LIST_BYTES)).slice(0, 6);
  const buttons: Button[][] = [[{ text: ctx.w.cal.newOnDay, data: `cn:x:0:${key}`, style: 'primary' }]];
  for (let i = 0; i < tags.length; i += 3) buttons.push(tags.slice(i, i + 3).map((tag) => ({ text: truncate(`#${tag.key}`, 18), data: `nt:${tag.key}` })));
  buttons.push(navRow(ctx, 'new'));
  const hint = tags.length ? `\n\n<b>${ctx.w.tagsUi.yourTags}</b> — <i>${ctx.w.tagsUi.startWith}</i>` : '';
  return { text: `${ctx.w.newTask}${hint}`, buttons };
}

async function statusView(ctx: Ctx): Promise<View> {
  const { w } = ctx;
  const open = await ctx.deps.store.openTasks();
  const waiting = (await ctx.deps.store.pendingCommands()).length;
  const sync = syncHealth(ctx.owner, ctx.deps.now());
  return {
    text: w.statusView(open.length, waiting, sync.text, sync.health),
    buttons: [[{ text: w.buttons.refresh, data: 'st' }], navRow(ctx)],
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
      rich: w.richNames[owner.rich === false ? 'off' : 'on'],
      pad: w.padNames(padOf(owner.pad)),
      ai: w.ai.states[aiState(ctx)],
    }),
    buttons: [
      [
        { text: `${w.settingButtons.language}: ${w.languageNames[owner.language]}`, data: 'set:lang' },
        { text: `${w.settingButtons.calendar}: ${w.calendarNames[owner.calendar]}`, data: 'set:cal' },
      ],
      [{ text: w.settingButtons.lead(owner.lead_minutes), data: 'set:lead' }],
      [{ text: w.settingButtons.zone(owner.timezone), data: 'set:tz' }, { text: w.settingButtons.rich(owner.rich !== false), data: 'set:rich' }],
      [{ text: w.settingButtons.pad(w.padNames(padOf(owner.pad))), data: 'set:pad' }],
      [{ text: w.ai.button(aiState(ctx)), data: 'set:ai', ...(aiState(ctx) === 'on' ? { style: 'primary' as const } : {}) }],
      [{ text: w.notif.open, data: 'nf' }],
      navRow(ctx, 'settings'),
    ],
  };
}

// ── Tags ───────────────────────────────────────────────────────────────────

/** A tag the bot can offer: how many tasks the notes have with it, and how many of those are open. */
interface KnownTag {
  key: string;
  name?: string;
  uses: number;
  open: number;
}

/** The tags the notes know (as the plugin last uploaded them) with the ones open tasks carry, most used first. */
async function knownTags(ctx: Ctx): Promise<KnownTag[]> {
  const known = new Map<string, KnownTag>();
  for (const info of ctx.owner.tag_catalog ?? []) known.set(info.key, { key: info.key, name: info.name, uses: info.count, open: 0 });
  for (const task of await ctx.deps.store.openTasks()) {
    for (const key of new Set(task.tags)) {
      const entry = known.get(key) ?? { key, uses: 0, open: 0 };
      entry.open++;
      entry.uses = Math.max(entry.uses, entry.open);
      known.set(key, entry);
    }
  }
  return [...known.values()].sort((a, b) => b.uses - a.uses || b.open - a.open || a.key.localeCompare(b.key));
}

/** All the tags, a page at a time: tap one for its open tasks. */
async function tagsView(ctx: Ctx, requestedPage: number): Promise<View> {
  const { w, owner } = ctx;
  const all = await knownTags(ctx);
  const tags = all.filter((tag) => fits(tag.key, TAG_LIST_BYTES));
  const pages = Math.max(1, Math.ceil(tags.length / TAG_PAGE));
  const index = Math.min(Math.max(0, requestedPage), pages - 1);
  const slice = tags.slice(index * TAG_PAGE, (index + 1) * TAG_PAGE);
  const u = w.tagsUi;

  const lines = slice.map((tag) => `<code>#${esc(tag.key)}</code>${tag.name ? ` — ${esc(tag.name)}` : ''} · ${u.openCount(tag.open).replace(/\d+/g, (d) => digits(d, owner.language))}`);
  const text = tags.length
    ? `${u.viewTitle(tags.length, index + 1, pages)}\n<blockquote>${lines.join('\n')}</blockquote>\n${u.viewHelp}${all.length > tags.length ? `\n<i>${u.tooLong}</i>` : ''}`
    : `${u.viewTitle(0, 1, 1)}\n\n${u.none}`;

  const buttons: Button[][] = [];
  for (let i = 0; i < slice.length; i += 2) {
    buttons.push(slice.slice(i, i + 2).map((tag) => ({ text: truncate(`#${tag.key} · ${digits(tag.open, owner.language)}`, 24), data: `lg:0:${tag.key}` })));
  }
  if (pages > 1) {
    buttons.push([
      index > 0 ? { text: w.buttons.prev, data: `tg:${index - 1}` } : idle('·'),
      idle(w.page(index + 1, pages)),
      index < pages - 1 ? { text: w.buttons.next, data: `tg:${index + 1}` } : idle('·'),
    ]);
  }
  buttons.push(navRow(ctx));
  return { text, buttons };
}

const BUCKET_ORDER: Bucket[] = ['overdue', 'today', 'tomorrow', 'later', 'none'];

function matches(filter: Filter, entry: { task: TaskRow; bucket: Bucket }): boolean {
  const { bucket } = entry;
  if (filter === 'a') return true;
  if (filter === 'd') return entry.task.status === 'doing';
  if (filter === 't') return bucket === 'overdue' || bucket === 'today';
  if (filter === 'o') return bucket === 'overdue';
  return bucket === 'none';
}

interface Row {
  task: TaskRow;
  bucket: Bucket;
  depth: 0 | 1;
  /** A subtask whose parent is not in this list. */
  orphan: boolean;
}

/** The tasks as a list reads: each parent followed by its subtasks, families in the order of their first task. */
function families(shown: { task: TaskRow; bucket: Bucket }[]): Row[][] {
  const byKey = new Map(shown.map((entry) => [entry.task.key, entry]));
  const kids = new Map<string, { task: TaskRow; bucket: Bucket }[]>();
  const roots: { task: TaskRow; bucket: Bucket }[] = [];
  for (const entry of shown) {
    const parent = entry.task.parent_key ? byKey.get(entry.task.parent_key) : undefined;
    if (parent && parent !== entry) kids.set(parent.task.key, [...(kids.get(parent.task.key) ?? []), entry]);
    else roots.push(entry);
  }
  const seen = new Set<string>();
  const build = (root: { task: TaskRow; bucket: Bucket }): Row[] => {
    const rows: Row[] = [{ ...root, depth: 0, orphan: !!root.task.parent_key }];
    seen.add(root.task.key);
    const walk = (key: string) => {
      for (const child of kids.get(key) ?? []) {
        if (seen.has(child.task.key)) continue;
        seen.add(child.task.key);
        rows.push({ ...child, depth: 1, orphan: false });
        walk(child.task.key);
      }
    };
    walk(root.task.key);
    return rows;
  };
  const out = roots.map(build);
  // Tasks that point at each other (a loop in the notes) are still listed.
  for (const entry of shown) if (!seen.has(entry.task.key)) out.push(build(entry));
  return out;
}

async function listView(ctx: Ctx, filter: Filter, requestedPage: number, tag?: string, quick = false): Promise<View> {
  const { w, owner } = ctx;
  const now = ctx.deps.now();
  const today = localNow(owner.timezone, now).date;
  const open = await ctx.deps.store.openTasks();
  const entries = open
    .map((task) => ({ task, bucket: bucketOf(task, today, owner.timezone) }))
    .sort((a, b) => BUCKET_ORDER.indexOf(a.bucket) - BUCKET_ORDER.indexOf(b.bucket) || byPlan(a.task, b.task));
  const counts: Record<Filter, number> = { a: 0, t: 0, o: 0, d: 0, u: 0 };
  for (const entry of entries) for (const f of FILTERS) if (matches(f, entry)) counts[f]++;

  const shown = entries.filter((entry) => (tag ? entry.task.tags.includes(tag) : matches(filter, entry)));
  const all = families(shown);
  // Numbered 1 to the end across every page, so the numbers read in order.
  const position = new Map<string, number>();
  all.flat().forEach((row, i) => position.set(row.task.key, i + 1));
  // A page takes whole families; one family bigger than a page has a page to itself.
  const pageList: Row[][][] = [];
  let page: Row[][] = [];
  let size = 0;
  for (const family of all) {
    if (page.length && size + family.length > PAGE) {
      pageList.push(page);
      page = [];
      size = 0;
    }
    page.push(family);
    size += family.length;
  }
  if (page.length) pageList.push(page);
  const pages = Math.max(1, pageList.length);
  const index = Math.min(Math.max(0, requestedPage), pages - 1);
  const slice = pageList[index] ?? [];
  // Quick tick (`q`) is kept by the list a tick comes back to; a tag's list has none.
  if (tag) quick = false;
  const back = tag ? `g${index}~${tag}` : `${filter}${index}${quick ? 'q' : ''}`;

  const filterRow = FILTERS.filter((f) => f === filter || f === 'a' || counts[f] > 0).map((f) => ({
    text: counted(w.filters[f], counts[f], owner.language),
    data: `ls:${f}:0`,
    ...(f === filter ? { style: 'primary' as const } : {}),
  }));

  const tagName = tag ? (await knownTags(ctx)).find((known) => known.key === tag)?.name : undefined;
  // Today's list says which day it is: the heading under it would only say «today» again.
  const dated = filter === 't' ? ` · ${dateLabel(today, owner)}` : '';
  const title = tag ? w.tagsUi.listTitle(tag, tagName) : `<b>${w.listTitle[filter]}${dated}</b>`;
  let text = `${title}${shown.length ? ` — <i>${w.openCount(shown.length)}</i>` : ''}`;
  let rich = `# ${htmlToRich(title).replace(/^#+ /, '')}${shown.length ? ` — *${w.openCount(shown.length)}*` : ''}`;
  const buttons: Button[][] = [];
  if (!slice.length) {
    const empty = tag ? w.tagsUi.listEmpty(tag) : w.empty[filter];
    text += `\n\n${empty}`;
    rich += `\n\n${htmlToRich(empty)}`;
  } else {
    let current: Bucket | null = null;
    let group: string[] = [];
    let richGroup: string[] = [];
    // One section on a filtered page is the list's own title: it is not said twice.
    const single = !!(filter !== 'a' || tag) && new Set(slice.map((family) => family[0].bucket)).size === 1;
    // What is not for now (later, no plan) folds away in the rich message when something nearer is on the page.
    const near = slice.some((family) => family[0].bucket === 'overdue' || family[0].bucket === 'today' || family[0].bucket === 'tomorrow');
    const flush = () => {
      if (current !== null && group.length) {
        text += single ? `\n<blockquote>${group.join('\n\n')}</blockquote>` : `\n\n<b><u>${w.sections[current]}</u></b>\n<blockquote>${group.join('\n\n')}</blockquote>`;
        const heading = current === 'overdue' ? `==${w.sections[current]}==` : w.sections[current];
        if (single) rich += `\n\n${richGroup.join('\n')}`;
        else if (near && (current === 'later' || current === 'none')) rich += `\n\n<details><summary>${w.sections[current]} (${digits(group.length, owner.language)})</summary>\n\n${richGroup.join('\n')}\n\n</details>`;
        else rich += `\n\n## ${heading}\n\n${richGroup.join('\n')}`;
      }
      group = [];
      richGroup = [];
    };
    for (const family of slice) {
      if (family[0].bucket !== current) {
        flush();
        current = family[0].bucket;
      }
      const options = (row: Row) => ({ position: position.get(row.task.key)!, depth: row.depth, parentHint: row.orphan });
      group.push(family.map((row) => taskEntry(row.task, owner, today, options(row))).join('\n'));
      richGroup.push(family.map((row) => taskEntryRich(row.task, owner, today, options(row))).join('\n'));
    }
    flush();

    if (quick) {
      text += `\n\n${w.ui.quickHint}`;
      rich += `\n\n${footer(w.ui.quickHint)}`;
    }
    buttons.push(...taskButtons(ctx, slice.flat().map(({ task }) => ({ task, position: position.get(task.key)! })), back, quick));
    if (pages > 1) {
      buttons.push([
        index > 0 ? { text: w.buttons.prev, data: listData({ filter, page: index - 1, tag }) } : idle('·'),
        idle(w.page(index + 1, pages)),
        index < pages - 1 ? { text: w.buttons.next, data: listData({ filter, page: index + 1, tag }) } : idle('·'),
      ]);
    }
  }
  if (tag) {
    buttons.push([{ text: w.tagsUi.newWith(tag), data: `nt:${tag}`, style: 'primary' }], [{ text: w.tagsUi.allTags, data: 'tg:0' }]);
    buttons.push(navRow(ctx));
    return { text, buttons, rich };
  }
  if (slice.length) buttons.push([quick ? { text: w.ui.quickOff, data: listData({ filter, page: index }), style: 'success' } : { text: w.ui.quick, data: listData({ filter, page: index, quick: true }) }]);
  if (filter === 't') {
    buttons.push(dayNavRow(ctx, todayOf(ctx), { text: w.digest.buttons.overview, data: 'ov' }));
    if (ctx.deps.ai) buttons.push([{ text: w.digest.buttons.planDay, data: 'pd' }]);
  }
  // Two to a row, so a label is never cut short.
  if (filterRow.length > 1) for (let i = 0; i < filterRow.length; i += 2) buttons.push(filterRow.slice(i, i + 2));
  buttons.push(navRow(ctx, filter === 't' ? 'today' : filter === 'a' ? 'all' : undefined));
  return { text, buttons, rich };
}

/** A list a card came from: a filter and a page, or the open tasks with one tag. */
interface ListRef {
  filter: Filter;
  page: number;
  tag?: string;
  /** Not a list: one day's screen (`y2026-10-05`). */
  day?: string;
  /** Its task buttons tick tasks off (`q` at the end of the code). */
  quick?: boolean;
}

/** The list a card came from, as its «back» button names it: `a2` is page 3 of all, `g0~home` the first page of #home. */
function listOf(back: string): ListRef {
  const day = /^y(\d{4}-\d{2}-\d{2})$/.exec(back);
  if (day) return { filter: 'a', page: 0, day: day[1] };
  const tagged = /^g(\d+)~(.+)$/u.exec(back);
  if (tagged) return { filter: 'a', page: Number(tagged[1]), tag: tagged[2] };
  const filter = FILTERS.find((f) => f === back[0]) ?? 'a';
  const quick = back.endsWith('q');
  const page = Number(back.slice(1, quick ? -1 : undefined)) || 0;
  return quick ? { filter, page, quick } : { filter, page };
}

/** The button data that opens a list. */
const listData = (ref: ListRef): string => (ref.day ? `dy:${ref.day}` : ref.tag ? `lg:${ref.page}:${ref.tag}` : `ls:${ref.filter}:${ref.page}${ref.quick ? ':q' : ''}`);

/** Tasks to a page that each get a whole row, so their titles can be read. */
const ROOMY = 4;

/**
 * A button for each task of a list. A few get a row each with most of their title; more go two
 * to a row. In quick tick a tap ticks the task off (⬜) and the list comes back; otherwise it
 * opens the task. «.» after the number: a «·» beside Persian digits reads as a zero.
 */
function taskButtons(ctx: Ctx, rows: { task: TaskRow; position: number }[], back: string, quick: boolean): Button[][] {
  const { owner } = ctx;
  const roomy = rows.length <= ROOMY;
  const button = ({ task, position }: { task: TaskRow; position: number }): Button => ({
    text: `${quick ? '⬜ ' : ''}${digits(position, owner.language)}. ${truncate(task.title, roomy ? 30 : quick ? 13 : 15)}`,
    data: `${quick ? 'done' : 't'}:${task.n}@${back}`,
  });
  const out: Button[][] = [];
  const step = roomy ? 1 : 2;
  for (let i = 0; i < rows.length; i += step) out.push(readingOrder(ctx, rows.slice(i, i + step).map(button)));
  return out;
}

const showList = (ctx: Ctx, ref: ListRef): Promise<View> =>
  ref.day ? dayView(ctx, ref.day) : listView(ctx, ref.filter, ref.page, ref.tag, ref.quick);

/** A task's parent and its open subtasks, for its card. */
async function relativesOf(ctx: Ctx, task: TaskRow): Promise<{ parent: TaskRow | null; children: TaskRow[]; relatives: Relatives }> {
  const { store } = ctx.deps;
  const children = (await store.openTasks()).filter((candidate) => candidate.parent_key === task.key).sort(byPlan);
  const parent = task.parent_key ? await store.taskByKey(task.parent_key) : null;
  return { parent: parent && isOpen(parent.status) ? parent : null, children, relatives: { parentTitle: parent?.title ?? task.parent_title, children } };
}

/**
 * A task as an app screen: its card on top, every setting a button under it
 * (each showing its value), its family, and the way back. Tapping a task in a
 * list opens this, so its settings are one tap away.
 */
async function taskView(ctx: Ctx, task: TaskRow, back: string, header?: string, footer?: string): Promise<View> {
  const { w, owner } = ctx;
  const today = localNow(owner.timezone, ctx.deps.now()).date;
  const at = back ? `@${back}` : '';
  const { parent, children, relatives } = await relativesOf(ctx, task);
  const f = w.task.fields;
  const dash = w.task.none;
  const label = (emoji: string, name: string, value: string | null) => truncate(`${emoji} ${name}${value === null ? '' : `: ${value}`}`, 30);
  const plan = task.plan_date
    ? planLabel({ date: task.plan_date, start: task.plan_start ?? undefined, end: task.plan_end ?? undefined }, owner, today)
    : dash;

  const family: Button[][] = [];
  for (let i = 0; i < Math.min(children.length, 6); i += 2) {
    family.push(
      children.slice(i, i + 2).map((child) => ({
        text: `↳ ${truncate(child.title, 18)}`,
        data: `t:${child.n}${at}`,
      }))
    );
  }
  if (parent) family.push([{ text: `⬆️ ${truncate(parent.title, 24)}`, data: `t:${parent.n}${at}` }]);
  else family.push([{ text: w.buttons.addSubtask, data: `sb:${task.n}${at}` }]);

  const buttons: Button[][] = [
    [
      { text: w.buttons.done, data: `done:${task.n}${at}`, style: 'success' },
      { text: w.buttons.remove, data: `del:${task.n}${at}`, style: 'danger' },
    ],
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
    ...family,
    [back ? { text: w.buttons.back, data: listData(listOf(back)) } : { text: w.buttons.menu, data: 'home' }],
  ];
  return {
    text: [header, taskCard(task, owner, today, relatives), footer].filter(Boolean).join('\n\n'),
    rich: taskCardRich(task, owner, today, relatives, header, footer),
    buttons,
  };
}

/** A choice that is the current one, ticked. */
const selected = (on: boolean, text: string): string => (on ? `✓ ${text}` : text);

/** A small menu of choices for one setting, with a way back to the panel. */
function choiceView(ctx: Ctx, task: TaskRow, back: string, text: string, rows: Button[][]): View {
  const at = back ? `@${back}` : '';
  return { text, buttons: [...rows, [{ text: ctx.w.buttons.back, data: `t:${task.n}${at}` }]] };
}

function statusMenuView(ctx: Ctx, task: TaskRow, back: string): View {
  const { w } = ctx;
  const at = back ? `@${back}` : '';
  const names = w.task.statusNames;
  const mark = (status: string, text: string) => selected(task.status === status, text);
  return choiceView(ctx, task, back, w.task.statusMenu(task.title), [
    [
      { text: mark('open', `⚪ ${names.open}`), data: `ss:${task.n}:open${at}` },
      { text: mark('doing', `🔄 ${names.doing}`), data: `ss:${task.n}:doing${at}` },
    ],
    [
      { text: `✅ ${names.done}`, data: `ss:${task.n}:done${at}`, style: 'success' },
      { text: `❌ ${names.failed}`, data: `ss:${task.n}:failed${at}`, style: 'danger' },
    ],
  ]);
}

function priorityMenuView(ctx: Ctx, task: TaskRow, back: string): View {
  const { w, owner } = ctx;
  const at = back ? `@${back}` : '';
  const buttons = PRIORITIES.map((level) => ({
    text: selected(task.priority === level, `${priorityMark(level)} ${priorityName(owner.language, level)}`),
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
    [{ text: w.cal.button, data: `cn:d:${task.n}:${monthKeyOf(owner.calendar, todayOf(ctx))}${at}`, style: 'primary' }, { text: w.buttons.custom, data: `dc:${task.n}` }],
    ...(task.deadline ? [[{ text: w.task.noDeadline, data: `ds:${task.n}:off${at}` }]] : []),
  ]);
}

/** A task's tags as a picker: every tag the notes know, ticked when it is on the task; a tap adds or removes it. */
async function tagsMenuView(ctx: Ctx, task: TaskRow, back: string, requestedPage = 0): Promise<View> {
  const { w, owner } = ctx;
  const at = back ? `@${back}` : '';
  const known = await knownTags(ctx);
  // The task's own tags are in the list even when the notes' catalog has not got them yet.
  for (const key of task.tags) if (!known.some((tag) => tag.key === key)) known.push({ key, uses: 0, open: 0 });
  const offered = known.filter((tag) => fits(tag.key, TAG_PICK_BYTES));
  const pages = Math.max(1, Math.ceil(offered.length / TAG_PAGE));
  const index = Math.min(Math.max(0, requestedPage), pages - 1);
  const slice = offered.slice(index * TAG_PAGE, (index + 1) * TAG_PAGE);

  const rows: Button[][] = [];
  for (let i = 0; i < slice.length; i += 2) {
    rows.push(
      slice.slice(i, i + 2).map((tag) => {
        const on = task.tags.includes(tag.key);
        return {
          text: truncate(selected(on, `#${tag.key}`), 24),
          data: `tt:${task.n}:${index}~${tag.key}${at}`,
          ...(on ? { style: 'primary' as const } : {}),
        };
      })
    );
  }
  if (pages > 1) {
    rows.push([
      index > 0 ? { text: w.buttons.prev, data: `tp:${task.n}:${index - 1}${at}` } : idle('·'),
      idle(w.page(index + 1, pages)),
      index < pages - 1 ? { text: w.buttons.next, data: `tp:${task.n}:${index + 1}${at}` } : idle('·'),
    ]);
  }
  rows.push([{ text: w.tagsUi.newTag, data: `ta:${task.n}` }, ...(task.tags.length ? [{ text: w.task.clearTags, data: `tx:${task.n}${at}` }] : [])]);
  return choiceView(ctx, task, back, w.tagsUi.pick(task.title, task.tags, index + 1, pages), rows);
}

function repeatMenuView(ctx: Ctx, task: TaskRow, back: string): View {
  const { w, owner } = ctx;
  const at = back ? `@${back}` : '';
  const p = w.task.repeatPresets;
  const set = (token: string) => `qs:${task.n}:${token}${at}`;
  const mark = (token: string, text: string) => selected(task.repeat === token, text);
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
      [{ text: w.cal.button, data: `cn:r:${task.n}:${monthKeyOf(owner.calendar, todayOf(ctx))}${at}`, style: 'primary' }, { text: w.buttons.custom, data: `rc:${task.n}` }],
      ...(task.remind_at ? [[{ text: w.buttons.noReminder, data: set('off') }]] : []),
      [{ text: w.buttons.back, data: `t:${task.n}${at}` }],
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
      [{ text: w.cal.button, data: `cn:p:${task.n}:${monthKeyOf(owner.calendar, todayOf(ctx))}${at}`, style: 'primary' }, { text: w.buttons.custom, data: `pc:${task.n}` }],
      ...(task.plan_date ? [[{ text: w.buttons.noPlan, data: set('off') }]] : []),
      [{ text: w.buttons.back, data: `t:${task.n}${at}` }],
    ],
  };
}

// ── Planning by itself ─────────────────────────────────────────────────────

/**
 * The plan a task made in Telegram gets when it has none: today, as the plugin's
 * «Plan new tasks for today» gives a task typed into the notes, and with «Track start
 * and end time» on, a start at this moment. The settings are the plugin's, sent with
 * every sync.
 */
export function autoPlanFor(owner: OwnerRow, today: string, minutes: number): Plan | undefined {
  const track = owner.track_time === true;
  if (owner.auto_plan === false && !track) return undefined;
  return track ? { date: today, start: toClock(minutes) } : { date: today };
}

/** With time tracking on, the plan a task ticked off now ends with: today's, started and not yet ended. */
export function trackedEnd(owner: OwnerRow, task: { plan_date: string | null; plan_start: string | null; plan_end: string | null }, today: string, minutes: number): Plan | null {
  if (owner.track_time !== true || task.plan_date !== today || !task.plan_start || task.plan_end) return null;
  const start = clockMinutes(task.plan_start);
  const end = Math.min(24 * 60 - 1, Math.max(minutes, start + 1));
  if (end <= start) return null;
  return { date: today, start: task.plan_start, end: toClock(end) };
}

/** Writes down when a task ticked off in Telegram ended, before the tick itself is queued. */
async function endTracked(ctx: Ctx, task: TaskRow): Promise<void> {
  const clock = localNow(ctx.owner.timezone, ctx.deps.now());
  const plan = trackedEnd(ctx.owner, task, clock.date, clock.minutes);
  if (!plan) return;
  await ctx.deps.store.patchTask(task.key, { plan_end: plan.end ?? null });
  const payload: PlanPayload = { key: task.key, plan };
  await ctx.deps.store.addCommand('plan', payload);
}

// ── A new task ─────────────────────────────────────────────────────────────

/** Makes a task and queues it for the notes, as if it had been typed in. `warning` says what was left out. */
async function createTask(ctx: Ctx, spec: NewTask): Promise<{ row: TaskRow; warning?: string }> {
  const { w, owner } = ctx;
  const now = ctx.deps.now();
  const clock = localNow(owner.timezone, now);

  let warning: string | undefined;
  let remindAt: string | null = null;
  let remind = spec.remind;
  if (remind) {
    const at = localToUtc(owner.timezone, remind.date, remind.time);
    if (at.getTime() < now.getTime()) {
      warning = w.reminderPast;
      remind = undefined;
    } else remindAt = at.toISOString();
  } else if (spec.plan?.start) {
    const start = localToUtc(owner.timezone, spec.plan.date, spec.plan.start);
    const at = new Date(start.getTime() - owner.lead_minutes * 60_000);
    if (at.getTime() >= now.getTime()) remindAt = at.toISOString();
  }

  // The task is made for the day it is planned, reminded or due on (else today), and written into that day's note.
  const day = spec.plan?.date ?? remind?.date ?? spec.deadline ?? clock.date;
  // Without a plan of its own it is planned for today, the day it was made, as the plugin plans a new
  // task typed into the notes; with time tracking on, it starts at this moment.
  const plan = spec.plan ?? autoPlanFor(owner, clock.date, clock.minutes);
  const tracked = !spec.plan && !!plan?.start;

  const key = `tg:${crypto.randomUUID()}`;
  const row = await ctx.deps.store.insertTask({
    key,
    title: spec.title,
    status: 'open',
    priority: spec.priority ?? null,
    deadline: spec.deadline ?? null,
    plan_date: plan?.date ?? null,
    plan_start: plan?.start ?? null,
    plan_end: plan?.end ?? null,
    remind_at: remindAt,
    tags: spec.tags,
    repeat: spec.repeat ?? null,
    parent_key: spec.parent?.key ?? null,
    parent_title: spec.parent?.title ?? null,
    subs_done: null,
    subs_total: null,
    note_path: null,
    origin: 'telegram',
    pending: true,
  });
  const payload: AddPayload = { key, day, title: spec.title, tags: spec.tags };
  if (spec.priority) payload.priority = spec.priority;
  if (spec.deadline) payload.deadline = spec.deadline;
  if (plan) payload.plan = plan;
  if (tracked) payload.tracked = true;
  if (remind) payload.remind = remind;
  if (spec.parent) payload.parent = spec.parent.key;
  await ctx.deps.store.addCommand('add', payload);
  if (spec.parent) {
    // Its task shows one more step at once; the notes' own count replaces it at the next sync.
    const parent = (await ctx.deps.store.taskByKey(spec.parent.key)) ?? spec.parent;
    await ctx.deps.store.patchTask(parent.key, { subs_total: (parent.subs_total ?? 0) + 1, subs_done: parent.subs_done ?? 0 });
  }
  if (spec.repeat) {
    try {
      await ctx.deps.store.addCommand('edit', { key, repeat: spec.repeat });
    } catch (error) {
      console.error("repeat not queued");
      await ctx.deps.store.patchTask(key, { repeat: null });
    }
  }
  return { row, warning };
}

/** The task a line of words describes. `forcedDay`: the day was chosen on the calendar, so the task is for that day. */
function specOf(text: string, ctx: Ctx, forcedDay?: string): NewTask | null {
  const clock = localNow(ctx.owner.timezone, ctx.deps.now());
  const parsed = parseQuickAdd(text, { today: clock.date, minutes: clock.minutes });
  // A day chosen on the calendar wins over a day in the words; an hour in the words is kept.
  if (forcedDay) parsed.plan = { ...parsed.plan, date: forcedDay };
  const title = cleanTitle(parsed.title);
  if (!title) return null;
  const spec: NewTask = { title, tags: parsed.tags };
  if (parsed.priority) spec.priority = parsed.priority;
  if (parsed.deadline) spec.deadline = parsed.deadline;
  if (parsed.plan) spec.plan = parsed.plan;
  if (parsed.remind) spec.remind = parsed.remind;
  return spec;
}

async function addTask(text: string, ctx: Ctx, forcedDay?: string): Promise<void> {
  const { w, chatId } = ctx;
  const spec = specOf(text, ctx, forcedDay);
  if (!spec) return ctx.deps.tg.send(chatId, w.needTitle);
  const { row, warning } = await createTask(ctx, spec);

  const view = await taskView(ctx, row, '', w.added, [warning, w.waitingForNotes].filter(Boolean).join('\n'));
  // A task just typed can be taken back with one tap.
  const undo = view.buttons.flat().find((button) => button.data.startsWith('del:'));
  if (undo) Object.assign(undo, { text: w.buttons.undo, data: `undo:${row.n}` });
  await sendView(ctx, view);
}

// ── The overview and the day ───────────────────────────────────────────────────

/** In Persian the next is to the left: a row of buttons that goes forward is turned round. */
const readingOrder = <T,>(ctx: Ctx, items: T[]): T[] => (ctx.owner.language === 'fa' ? [...items].reverse() : items);

/** A button that goes back or forward: with an arrow in English; in Persian the order and the words say it (an arrow would be turned round). */
const stepLabel = (ctx: Ctx, side: 'back' | 'forward', text: string): string => (ctx.owner.language === 'fa' ? text : side === 'back' ? `‹ ${text}` : `${text} ›`);

/** The first day of the week the owner's calendar uses: Saturday with the Jalali calendar, Monday with the Gregorian. */
const weekStart = (ctx: Ctx, date: string): string => addDays(date, -((weekdayOf(date) - (ctx.owner.calendar === 'jalali' ? 6 : 1) + 7) % 7));

/** The seven days of a week, `offset` weeks from this one. */
function weekDays(ctx: Ctx, offset: number): string[] {
  const start = addDays(weekStart(ctx, todayOf(ctx)), offset * 7);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

/** How many weeks from this one the week of a day is. */
const weekOffsetOf = (ctx: Ctx, day: string): number => Math.round(daysBetween(weekStart(ctx, todayOf(ctx)), weekStart(ctx, day)) / 7);

/**
 * The days either side of a day, named by their dates (never «tomorrow» or «yesterday»: a few
 * steps away from today such names would be wrong), with `middle` between them.
 */
function dayNavRow(ctx: Ctx, day: string, middle: Button): Button[] {
  const [before, after] = [addDays(day, -1), addDays(day, 1)];
  // With the month when both fit a third of a row, otherwise without it (the screen's own title has it).
  const long = [before, after].some((date) => Array.from(dateLabel(date, ctx.owner)).length > 14);
  const label = (date: string) => (long ? weekdayAndDay(date, ctx.owner) : dateLabel(date, ctx.owner));
  return readingOrder(ctx, [
    { text: stepLabel(ctx, 'back', label(before)), data: `dy:${before}` },
    middle,
    { text: stepLabel(ctx, 'forward', label(after)), data: `dy:${after}` },
  ]);
}

/** One screen, two ways to see it: a day or a week. The one shown is blue. */
function modeRow(ctx: Ctx, active: 'day' | 'week', day: string, week: number): Button[] {
  const { w } = ctx;
  return readingOrder(ctx, [
    { text: w.week.modeDay, data: `dy:${day}`, ...(active === 'day' ? { style: 'primary' as const } : {}) },
    { text: w.week.modeWeek, data: `wk:${week}`, ...(active === 'week' ? { style: 'primary' as const } : {}) },
  ]);
}

/** A week, day by day: each day's tasks (the ones with no hour too), a heading with how many, and no table. */
async function weekView(ctx: Ctx, offset: number): Promise<View> {
  const { w, owner } = ctx;
  const today = todayOf(ctx);
  const days = weekDays(ctx, offset);
  const open = await ctx.deps.store.openTasks();
  const rowsOf = days.map((day) => ({ day, tasks: open.filter((task) => onDay(task, day, owner.timezone)).sort(byHour) }));
  const range = `${dateLabel(days[0], owner)} – ${dateLabel(days[6], owner)}`;
  const SHOW = 6;

  const busy = rowsOf.filter(({ tasks }) => tasks.length);
  const summary = `<i>${w.ui.weekSummary(new Set(busy.flatMap(({ tasks }) => tasks.map((task) => task.key))).size, busy.length)}</i>`;
  const html: string[] = [`${w.week.title(range)}\n${summary}`];
  const rich: string[] = [`# ${withoutTags(w.week.title(range))}\n\n${htmlToRich(summary)}`];
  for (const { day, tasks } of busy) {
    const heading = counted(`${dateLabel(day, owner)}${day === today ? ` · ${w.week.today}` : ''}`, tasks.length, owner.language);
    const shown = tasks.slice(0, SHOW);
    const more = tasks.length > shown.length ? w.week.more(tasks.length - shown.length) : '';
    html.push(`<b><u>${heading}</u></b>${shown.length ? `\n<blockquote>${shown.map((task) => `• ${dayItem(task, day, owner)}`).join('\n')}</blockquote>` : ''}${more ? `\n${more}` : ''}`);
    rich.push(`## ${day === today ? `==${heading}==` : heading}${shown.length ? `\n\n${shown.map((task) => `- ${dayItem(task, day, owner, true)}`).join('\n')}` : ''}${more ? `\n\n${htmlToRich(more)}` : ''}`);
  }

  const dayButtons: Button[] = rowsOf.map(({ day, tasks }) => ({
    // In Persian the dot goes first: after the digits it was read as part of them («۱۶•»).
    text: owner.language === 'fa'
      ? `${tasks.length ? '•' : ''}${weekdayInitial(day, owner.language)} ${dayNumber(day, owner)}`
      : `${weekdayInitial(day, owner.language)} ${dayNumber(day, owner)}${tasks.length ? '•' : ''}`,
    data: `dy:${day}`,
    ...(day === today ? { style: 'primary' as const } : {}),
  }));
  const neighbour = (side: -1 | 1): Button => {
    const around = weekDays(ctx, offset + side);
    return { text: stepLabel(ctx, side < 0 ? 'back' : 'forward', weekRange(around[0], around[6], owner)), data: `wk:${offset + side}` };
  };
  const middle: Button = offset === 0 ? idle(w.week.thisWeek) : { text: w.week.thisWeek, data: 'wk:0' };
  const buttons: Button[][] = [
    readingOrder(ctx, dayButtons),
    readingOrder(ctx, [neighbour(-1), middle, neighbour(1)]),
    modeRow(ctx, 'week', offset === 0 ? today : days[0], offset),
  ];
  buttons.push(...(await unfinishedRow(ctx, open)));
  buttons.push(navRow(ctx));
  return { text: html.join('\n\n'), rich: rich.join('\n\n'), buttons };
}

/** What a week or a day does not show but should not be lost: a button to the late ones and to those with no plan. */
async function unfinishedRow(ctx: Ctx, open?: TaskRow[]): Promise<Button[][]> {
  const { w, owner } = ctx;
  const today = todayOf(ctx);
  const buckets = (open ?? (await ctx.deps.store.openTasks())).map((task) => bucketOf(task, today, owner.timezone));
  const late = buckets.filter((bucket) => bucket === 'overdue').length;
  const unplanned = buckets.filter((bucket) => bucket === 'none').length;
  const row: Button[] = [];
  if (late) row.push({ text: counted(w.filters.o, late, owner.language), data: 'ls:o:0', style: 'danger' });
  if (unplanned) row.push({ text: counted(w.filters.u, unplanned, owner.language), data: 'ls:u:0' });
  return row.length ? [row] : [];
}

/** One day: its tasks in the order of the day, a button for each, and the way to the days around it. */
async function dayView(ctx: Ctx, day: string): Promise<View> {
  const { w, owner } = ctx;
  const today = todayOf(ctx);
  const tasks = (await ctx.deps.store.openTasks()).filter((task) => onDay(task, day, owner.timezone)).sort(byHour);
  const shown = tasks.slice(0, PAGE * 2);
  const entries = shown.map((task, i) => taskEntry(task, owner, today, { position: i + 1 }));
  const text = `${w.week.dayTitle(dateLabel(day, owner), tasks.length)}${day === today ? ` · <i>${w.week.today}</i>` : ''}\n${entries.length ? `<blockquote>${entries.join('\n')}</blockquote>` : `<i>${w.week.dayEmpty}</i>`}`;
  const buttons: Button[][] = [];
  buttons.push(...taskButtons(ctx, shown.map((task, i) => ({ task, position: i + 1 })), `y${day}`, false));
  buttons.push(dayNavRow(ctx, day, day === today ? idle(w.digest.buttons.today) : { text: w.digest.buttons.today, data: `dy:${today}` }));
  buttons.push(modeRow(ctx, 'day', day, weekOffsetOf(ctx, day)));
  buttons.push([{ text: w.week.newOnDay, data: `cd:x:0:${day}`, style: 'success' }]);
  buttons.push(navRow(ctx));
  return { text, buttons };
}

/** What is planned for today and not done goes to tomorrow, at the same hour, with its reminder before it. */
async function moveToTomorrow(ctx: Ctx): Promise<void> {
  const { w, owner } = ctx;
  const today = todayOf(ctx);
  const tomorrow = addDays(today, 1);
  const moving = (await ctx.deps.store.openTasks()).filter((task) => task.plan_date === today);
  if (!moving.length) {
    ctx.toast = w.digest.review.nothingToMove;
    return;
  }
  const now = ctx.deps.now().getTime();
  for (const task of moving) {
    await applyPlan(ctx, task, { date: tomorrow, ...(task.plan_start ? { start: task.plan_start } : {}), ...(task.plan_end ? { end: task.plan_end } : {}) });
    // A reminder that was before today's plan has gone by: it goes before tomorrow's.
    if (task.plan_start && task.remind_at && new Date(task.remind_at).getTime() < now) await applyReminder(ctx, (await ctx.deps.store.taskByKey(task.key)) ?? task, 'default');
  }
  const done = w.digest.review.moved(moving.length, dayLabel(tomorrow, owner, today));
  ctx.toast = done;
  await present(ctx, { text: done, buttons: [[{ text: w.digest.buttons.tomorrow, data: `dy:${tomorrow}` }, { text: w.digest.buttons.overview, data: 'ov' }], navRow(ctx)] });
}

// ── Notifications ──────────────────────────────────────────────────────────

const BRIEF_TIMES = [null, '06:00', '07:00', '08:00', '09:00', '10:00'];
const REVIEW_TIMES = [null, '19:00', '20:00', '21:00', '22:00', '23:00'];
const NUDGES: DeadlineNudge[] = ['off', 'eve', 'morn', 'both'];
const CONFIRMS: AiConfirm[] = ['big', 'ask', 'auto'];

/** The next of a list of choices after the current one (the first when the current one is not in it). */
const cycle = <T,>(choices: T[], current: T): T => choices[(choices.indexOf(current) + 1) % choices.length];

const withoutTags = (html: string): string => html.replace(/<[^>]+>/g, '');

/** What the owner has set for the messages the bot sends by itself, with the defaults a database without the columns yet implies. */
function notifSettings(owner: OwnerRow) {
  return {
    brief: owner.brief_time === undefined ? '08:00' : owner.brief_time,
    review: owner.review_time === undefined ? '21:00' : owner.review_time,
    nudge: owner.deadline_nudge ?? 'eve',
    nag: owner.nag !== false,
    confirm: owner.ai_confirm ?? 'big',
  };
}

function notifView(ctx: Ctx): View {
  const { w, owner } = ctx;
  const set = notifSettings(owner);
  const lines = [w.notif.brief(set.brief), w.notif.review(set.review), w.notif.nudge(set.nudge), w.notif.nag(set.nag), ...(ctx.deps.ai ? [w.notif.confirm(set.confirm)] : [])];
  const button = (line: string, data: string): Button[] => [{ text: withoutTags(line), data }];
  return {
    text: `${w.notif.title}\n<blockquote>${lines.join('\n')}</blockquote>\n${w.notif.hint}`,
    buttons: [
      button(lines[0], 'nf:brief'),
      button(lines[1], 'nf:review'),
      button(lines[2], 'nf:nudge'),
      button(lines[3], 'nf:nag'),
      ...(ctx.deps.ai ? [button(lines[4], 'nf:confirm')] : []),
      [{ text: w.buttons.back, data: 'set' }],
      navRow(ctx, 'settings'),
    ],
  };
}

async function notifications(what: string | undefined, ctx: Ctx): Promise<void> {
  const { owner, w } = ctx;
  if (!what) return present(ctx, notifView(ctx));
  const set = notifSettings(owner);
  let patch: Partial<OwnerRow> | null = null;
  if (what === 'brief') patch = { brief_time: cycle(BRIEF_TIMES, set.brief) };
  else if (what === 'review') patch = { review_time: cycle(REVIEW_TIMES, set.review) };
  else if (what === 'nudge') patch = { deadline_nudge: cycle(NUDGES, set.nudge) };
  else if (what === 'nag') patch = { nag: !set.nag };
  else if (what === 'confirm') patch = { ai_confirm: cycle(CONFIRMS, set.confirm) };
  if (!patch) return;
  try {
    await ctx.deps.store.patchOwner(patch);
  } catch (error) {
    // The database has not learnt these settings yet (it updates itself on first use).
    console.error("notification setting not saved");
    ctx.toast = w.notif.unavailable;
    return;
  }
  const fresh = ctxFor(ctx.deps, { ...owner, ...patch }, ctx.chatId, ctx.messageId);
  await present(fresh, notifView(fresh));
}

// ── The assistant ──────────────────────────────────────────────────────────

const aiState = (ctx: Ctx): 'on' | 'off' | 'unset' => (!ctx.deps.ai ? 'unset' : ctx.owner.ai === false ? 'off' : 'on');

/** What the assistant is for, with the switch when it can be switched. */
function aiView(ctx: Ctx): View {
  const state = aiState(ctx);
  const rows: Button[][] = [];
  if (state !== 'unset') rows.push([{ text: ctx.w.ai.button(state), data: 'set:ai', ...(state === 'on' ? { style: 'primary' as const } : {}) }]);
  rows.push(navRow(ctx));
  return { text: ctx.w.ai.intro(state), buttons: rows };
}

/** What the assistant may do to the bot's tasks: the same things a tap or a typed command does. */
function effectsFor(ctx: Ctx): Effects {
  return {
    create: (spec) => createTask(ctx, spec),
    setPlan: async (task, plan) => {
      await applyPlan(ctx, task, plan);
    },
    setRemind: async (task, moment) => {
      await applyReminder(ctx, task, moment);
    },
    edit: (task, fields, patch) => saveEdit(ctx, task, fields, patch),
    setStatus: async (task, status) => {
      if (status === 'done') await endTracked(ctx, task);
      await ctx.deps.store.patchTask(task.key, { status });
      const payload: StatusPayload = { key: task.key, status };
      await ctx.deps.store.addCommand('status', payload);
    },
  };
}

/** The most tasks listed in full on the assistant's card. */
const SHOWN = 15;

async function assistantView(ctx: Ctx, result: AssistantResult, heard?: string, preview?: Store): Promise<View> {
  const { w, owner } = ctx;
  const store = preview ?? ctx.deps.store;
  const today = todayOf(ctx);
  const load = async (keys: string[]): Promise<TaskRow[]> => (await Promise.all(keys.map((key) => store.taskByKey(key)))).filter((task): task is TaskRow => !!task);
  const keysOf = (kind: 'added' | 'changed' | 'status') => result.changes.filter((change) => change.kind === kind).map((change) => change.key);
  const added = await load(keysOf('added'));
  const changed = await load(keysOf('changed'));
  const statuses = await load(keysOf('status'));
  const removing = await load(result.proposals);

  const richEntries = (tasks: TaskRow[]): string => {
    const lines = tasks.slice(0, SHOWN).map((task) => taskEntryRich(task, owner, today, { position: task.n, bullet: task.n >= PROVISIONAL_N, parentHint: !!task.parent_key }));
    if (tasks.length > SHOWN) lines.push(`*+${digits(tasks.length - SHOWN, owner.language)}*`);
    return lines.join('\n');
  };
  const entries = (tasks: TaskRow[]): string => {
    const lines = tasks.slice(0, SHOWN).map((task) => taskEntry(task, owner, today, { position: task.n, bullet: task.n >= PROVISIONAL_N, parentHint: !!task.parent_key }));
    if (tasks.length > SHOWN) lines.push(`<i>+${digits(tasks.length - SHOWN, owner.language)}</i>`);
    return `<blockquote>${lines.join('\n')}</blockquote>`;
  };

  const acted = added.length + changed.length + statuses.length + removing.length > 0;
  const sections: string[] = [];
  /** The same screen as rich Markdown: the tasks as a task list, smaller headings, a footer. */
  const richSections: string[] = [];
  const group = (heading: string, body: string) => `#### ${htmlToRich(heading).replace(/^#+ /, '').replace(/\*\*/g, '')}\n\n${body}`;
  if (heard) sections.push(w.ai.heard(heard)), richSections.push(htmlToRich(w.ai.heard(heard)));
  const say = result.say ? esc(result.say) : '';
  if (acted) {
    sections.push([preview ? w.ai.preview.title : w.ai.done, say].filter(Boolean).join('\n'));
    richSections.push(`### ${htmlToRich(preview ? w.ai.preview.title : w.ai.done).replace(/^#+ /, '').replace(/\*\*/g, '')}${say ? `\n\n${htmlToRich(say)}` : ''}`);
  } else if (say) sections.push(`🤖 ${say}`), richSections.push(htmlToRich(`🤖 ${say}`));
  else if (!result.warnings.length) sections.push(w.ai.nothing), richSections.push(htmlToRich(w.ai.nothing));
  if (added.length) sections.push(`${w.ai.groups.added}\n${entries(added)}`), richSections.push(group(w.ai.groups.added, richEntries(added)));
  if (changed.length) sections.push(`${w.ai.groups.changed}\n${entries(changed)}`), richSections.push(group(w.ai.groups.changed, richEntries(changed)));
  if (statuses.length) {
    const lines = statuses.slice(0, SHOWN).map((task) => `${task.status === 'done' ? '✅' : task.status === 'failed' ? '❌' : '🔄'} <b>${digits(task.n, owner.language)}.</b> ${esc(truncate(task.title, 80))} · ${w.labels.statuses[task.status]}`);
    sections.push(`${w.ai.groups.status}\n<blockquote>${lines.join('\n')}</blockquote>`);
    richSections.push(group(w.ai.groups.status, statuses.slice(0, SHOWN).map((task) => `- [${task.status === 'done' ? 'x' : ' '}] **${digits(task.n, owner.language)}.** ${mdEscape(truncate(task.title, 80))} · ${w.labels.statuses[task.status]}`).join('\n')));
  }
  if (removing.length) sections.push(`${w.ai.groups.remove}\n${entries(removing)}`), richSections.push(group(w.ai.groups.remove, richEntries(removing)));
  if (result.warnings.length) {
    const warned = result.warnings.map((warning) => (warning.kind === 'noTitle' || warning.kind === 'tooMany' ? w.ai.warn[warning.kind] : w.ai.warn[warning.kind](warning.detail ?? ''))).join('\n');
    sections.push(warned);
    richSections.push(htmlToRich(`<blockquote>${warned}</blockquote>`));
  }
  // What the notes have not got yet says so once, small, under it all.
  if ([...added, ...changed].some((task) => task.pending)) richSections.push(footer(w.ui.pendingNote));
  const rich = richSections.join('\n\n');

  if (preview) {
    return {
      text: sections.join('\n\n'),
      rich,
      buttons: [[{ text: w.ai.preview.apply, data: 'ap', style: 'success' }, { text: w.ai.preview.cancel, data: 'ac', style: 'danger' }], navRow(ctx)],
    };
  }
  const buttons: Button[][] = [];
  const opened = [...added, ...changed].slice(0, 8);
  buttons.push(...taskButtons(ctx, opened.map((task) => ({ task, position: task.n })), 'a0', false));
  // The numbers ride in the button's data (64 bytes): ten tasks at most.
  const undoable = added.slice(0, 10);
  if (undoable.length) buttons.push([{ text: w.ai.undoAll(undoable.length), data: `ux:${undoable.map((task) => task.n).join('.')}` }]);
  for (const task of removing.slice(0, 4)) buttons.push([{ text: `🗑 ${truncate(task.title, 24)}`, data: `del:${task.n}@a0`, style: 'danger' }]);
  buttons.push(navRow(ctx));
  return { text: sections.join('\n\n'), rich, buttons };
}

/** A small grey line under a rich message. Markdown is not read inside it: the text is plain. */
function footer(html: string): string {
  const text = html.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  return `<footer>${esc(text)}</footer>`;
}

/** Writes to the assistant, or says what it is. `heard`: the words came from a voice message. */
async function assist(text: string, ctx: Ctx, options: { heard?: string; fallback?: boolean; preview?: boolean } = {}): Promise<void> {
  const { w, owner, chatId } = ctx;
  const { ai, store, tg } = ctx.deps;
  if (!ai) return tg.send(chatId, w.ai.errors.notSetUp);
  // At once: a glance on the message, and a «Thinking…» that Telegram takes away when the answer arrives.
  const incoming = ctx.incoming;
  /** Cosmetic: a failure here must never stop the work. */
  const quietly = (step: Promise<void> | undefined): Promise<void> => Promise.resolve(step).catch(() => undefined);
  const react = (emoji: string | null) => quietly(incoming === undefined ? undefined : tg.react?.(chatId, incoming, emoji));
  const thinking = `${options.heard ? `<p>${w.ai.heard(options.heard)}</p>` : ''}<tg-thinking>${w.ai.thinking}</tg-thinking>`;
  await Promise.all([react('👀'), quietly(tg.thinking ? tg.thinking(chatId, thinking) : tg.typing?.(chatId))]);
  const now = ctx.deps.now();
  const memory = freshMemory(owner.ai_memory, now);
  const mode: AiConfirm = options.preview ? 'ask' : (owner.ai_confirm ?? 'big');
  const tags = (await knownTags(ctx)).map((tag) => tag.key);
  const base = { ai, owner, now, text, memory, tags };
  let result: AssistantResult;
  let overlay: OverlayStore | null = null;
  // A draft lasts thirty seconds and «typing…» five, and the model can take longer: «typing…» is renewed until the answer is ready.
  const keepTyping = setInterval(() => void quietly(tg.typing?.(chatId)), 4_000);
  try {
    if (mode === 'auto') result = await runAssistant({ ...base, store, effects: effectsFor(ctx) });
    else {
      // Tried on a copy first: what it would do is known before anything is kept.
      overlay = new OverlayStore(store);
      const tried = await runAssistant({ ...base, store: overlay, effects: effectsFor(withStore(ctx, overlay)) });
      const size = tried.changes.length + tried.proposals.length;
      if (!tried.calls.length) {
        // Nothing to change: an answer, or a question back.
        result = tried;
        overlay = null;
      } else if (mode === 'big' && size <= BIG_JOB) {
        result = { ...(await replayCalls(tried.calls, { store, effects: effectsFor(ctx), owner, now })), say: tried.say };
        overlay = null;
      } else {
        const pending: PendingPlan = { at: now.toISOString(), text, calls: tried.calls };
        try {
          await store.patchOwner({ ai_pending: pending });
          result = { ...tried, summary: `The user has NOT accepted these yet, nothing is applied: ${tried.summary}` };
        } catch (error) {
          // Nowhere to keep it until the owner answers: it is done now, as it would have been.
          console.error("plan not kept, applying it");
          result = { ...(await replayCalls(tried.calls, { store, effects: effectsFor(ctx), owner, now })), say: tried.say };
          overlay = null;
        }
      }
    }
  } catch (error) {
    console.error("assistant failed");
    await react('🤔');
    const problem = w.ai.errors[error instanceof AiError ? error.kind : 'busy'];
    const heard = options.heard ? `${w.ai.heard(options.heard)}\n\n` : '';
    if (!options.fallback) return tg.send(chatId, `${heard}${problem}`);
    await tg.send(chatId, `${problem}\n${w.ai.errors.fellBack}`);
    return addTask(text, ctx);
  } finally {
    clearInterval(keepTyping);
  }
  try {
    await store.patchOwner({ ai_memory: remember(memory, text, result, now) });
  } catch (error) {
    // The database has not learnt the column yet: the assistant just forgets between messages.
    console.error("assistant memory not kept");
  }
  const acted = result.changes.length > 0 || result.proposals.length > 0;
  // Not hung from the message: the quote over it would only repeat what was said and push the chat up.
  await sendView(ctx, await assistantView(ctx, result, options.heard, overlay ?? undefined));
  if (!overlay) await react(acted ? '👌' : '👍');
}

/** Above this many changes the assistant shows what it would do before doing it (unless told never to). */
const BIG_JOB = 4;

/** The same request, working on another store: for trying commands without keeping them. */
const withStore = (ctx: Ctx, store: Store): Ctx => ({ ...ctx, deps: { ...ctx.deps, store } });

/** Plan the day: the assistant is asked to fit what has no hour into the free ones, and shows its plan first. */
async function planDay(ctx: Ctx): Promise<void> {
  if (!ctx.deps.ai) {
    ctx.toast = ctx.w.ai.errors.notSetUp;
    if (ctx.messageId === undefined) await ctx.deps.tg.send(ctx.chatId, ctx.w.ai.errors.notSetUp);
    return;
  }
  await assist(ctx.w.ai.preview.planDay, ctx, { preview: true });
}

/** The owner accepts what was shown: the same commands run again, for real. */
async function applyPending(ctx: Ctx): Promise<void> {
  const { w, owner } = ctx;
  const { store } = ctx.deps;
  const now = ctx.deps.now();
  const pending = owner.ai_pending;
  if (!pending || !pending.calls?.length || now.getTime() - new Date(pending.at).getTime() > MEMORY_MINUTES * 60_000) {
    ctx.toast = w.ai.preview.gone;
    if (pending) await store.patchOwner({ ai_pending: null }).catch(() => undefined);
    return;
  }
  try {
    // Forgotten first: a second tap on the same button must not do it twice.
    await store.patchOwner({ ai_pending: null });
  } catch (error) {
    console.error("plan not cleared");
    ctx.toast = w.notif.unavailable;
    return;
  }
  const result = await replayCalls(pending.calls, { store, effects: effectsFor(ctx), owner, now });
  try {
    await store.patchOwner({ ai_memory: remember(freshMemory(owner.ai_memory, now), pending.text, result, now) });
  } catch (error) {
    console.error("assistant memory not kept");
  }
  ctx.toast = w.ai.done.replace(/<[^>]+>/g, '');
  await present(ctx, await assistantView(ctx, result));
}

async function cancelPending(ctx: Ctx): Promise<void> {
  const { w } = ctx;
  await ctx.deps.store.patchOwner({ ai_pending: null }).catch(() => undefined);
  await present(ctx, { text: w.ai.preview.cancelled, buttons: [navRow(ctx)] });
}

/** A voice message becomes words, and the words go to the assistant. */
async function handleVoice(voice: Voice, ctx: Ctx): Promise<void> {
  const { w, owner, chatId } = ctx;
  const { ai, tg } = ctx.deps;
  if (!ai || !tg.download) return tg.send(chatId, w.ai.voice.needsAi);
  if ((voice.duration ?? 0) > 120) return tg.send(chatId, w.ai.voice.tooLong);
  await tg.typing?.(chatId).catch(() => undefined);
  let heard: string;
  try {
    heard = (await ai.transcribe(await tg.download(voice.file_id), owner.language)).trim();
  } catch (error) {
    console.error("voice not read");
    return tg.send(chatId, error instanceof AiError && error.kind !== 'bad' && error.kind !== 'format' ? w.ai.errors[error.kind] : w.ai.voice.failed);
  }
  if (!heard) return tg.send(chatId, w.ai.voice.empty);
  return assist(heard, ctx, { heard });
}

/** Takes back the tasks the assistant just made. */
async function undoAssistant(numbers: string, ctx: Ctx): Promise<void> {
  const { w } = ctx;
  let count = 0;
  for (const n of numbers.split('.').map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(0, 10)) {
    const task = await ctx.deps.store.taskByN(n);
    // Only what the bot itself made and is still open: a number in an old message must not reach a task that has moved on.
    if (!task || task.origin !== 'telegram' || !isOpen(task.status)) continue;
    await removeTask(task, ctx.deps);
    count++;
  }
  ctx.toast = w.deletedToast;
  await present(ctx, { text: w.ai.undone(count), buttons: [[{ text: w.buttons.all, data: 'ls:a:0' }, { text: w.buttons.menu, data: 'home' }]] });
}

// ── Changing a task ────────────────────────────────────────────────────────

async function markDone(n: number, ctx: Ctx): Promise<void> {
  const { w, owner } = ctx;
  const task = await ctx.deps.store.taskByN(n);
  if (!task || !isOpen(task.status)) return ctx.deps.tg.send(ctx.chatId, w.noSuchTask(digits(n, owner.language)));
  await endTracked(ctx, task);
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

  const finish = async (reply: string) => present(ctx, await taskView(ctx, (await store.taskByN(n)) ?? task, '', reply));
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
    return present(ctx, await taskView(ctx, (await store.taskByN(n)) ?? task, '', reply));
  }
  const plan = parseQuickAdd(rest, { today: clock.date, minutes: clock.minutes }).plan;
  if (!plan || !rest) return tg.send(ctx.chatId, `${w.cantRead}\n${w.usage.plan}`);
  const reply = await applyPlan(ctx, task, plan);
  await present(ctx, await taskView(ctx, (await store.taskByN(n)) ?? task, '', reply));
}

// ── The calendar ───────────────────────────────────────────────────────────

const todayOf = (ctx: Ctx): string => localNow(ctx.owner.timezone, ctx.deps.now()).date;

/** The day a task's reminder, plan or deadline is on now, in the owner's time. */
function currentDay(ctx: Ctx, kind: Pick, task: TaskRow | null): string | null {
  if (!task) return null;
  if (kind === 'r') return task.remind_at ? utcToLocal(ctx.owner.timezone, new Date(task.remind_at)).date : null;
  if (kind === 'p') return task.plan_date;
  if (kind === 'd') return task.deadline;
  return null;
}

/** A month drawn as buttons; the day to pick is a tap away. */
async function calendarView(ctx: Ctx, kind: Pick, task: TaskRow | null, key: string, back: string): Promise<View> {
  const { w, owner } = ctx;
  const system = owner.calendar;
  const language = owner.language;
  const now = todayOf(ctx);
  const at = back ? `@${back}` : '';
  const n = task?.n ?? 0;
  const month = buildMonth(key, system, language, monthKeyOf(system, now));
  const busy = new Set((await ctx.deps.store.openTasks()).map((candidate) => candidate.plan_date).filter(Boolean));
  const current = currentDay(ctx, kind, task);
  const go = (ym: string) => `cn:${kind}:${n}:${ym}${at}`;

  // Persian reads from the right: the way to the next month points left.
  const [left, right] = language === 'fa' ? [month.next, month.prev] : [month.prev, month.next];
  const label = `${monthName(system, language, month.month)} ${digits(month.year, language)}`;
  const buttons: Button[][] = [
    [
      { text: language === 'fa' ? '‹' : '‹', data: go(left) },
      { text: label, data: go(monthKeyOf(system, now)) },
      { text: '›', data: go(right) },
    ],
    month.header.map((initial) => ({ text: initial, data: 'noop' })),
  ];
  for (const week of month.weeks) {
    buttons.push(
      week.map((iso) => {
        if (!iso) return idle('·');
        const number = digits(partsOf(system, iso)[2], language);
        const text = iso === current ? `✓${number}` : iso === now ? `[${number}]` : busy.has(iso) ? `${number}•` : number;
        return { text, data: `cd:${kind}:${n}:${iso}${at}`, ...(iso === current ? { style: 'primary' as const } : {}) };
      })
    );
  }
  const currentLabel = current ? dayLabel(current, owner, now) : null;
  buttons.push([{ text: w.buttons.back, data: kind === 'x' ? 'new' : `t:${n}${at}` }]);
  return { text: `${w.cal.pickDay(w.cal.kinds[kind], task?.title ?? null, currentLabel, label)}\n${w.cal.legend}`, buttons };
}

/** The hours of a day, for a reminder or the start of a plan. */
function timeView(ctx: Ctx, kind: 'r' | 'p', task: TaskRow, iso: string, back: string): View {
  const { w, owner } = ctx;
  const at = back ? `@${back}` : '';
  const hours: Button[] = [];
  for (let hour = 6; hour <= 23; hour++) {
    const clock = `${String(hour).padStart(2, '0')}:00`;
    hours.push({ text: digits(clock, owner.language), data: `ct:${kind}:${task.n}:${iso}:${String(hour).padStart(2, '0')}00${at}` });
  }
  const rows: Button[][] = [];
  for (let i = 0; i < hours.length; i += 6) rows.push(hours.slice(i, i + 6));
  const extra: Button[] = [{ text: w.cal.customTime, data: `cc:${kind}:${task.n}:${iso}`, style: 'primary' }];
  if (kind === 'p') extra.push({ text: w.cal.allDay, data: `cw:p:${task.n}:${iso}${at}` });
  rows.push(extra);
  rows.push([{ text: w.buttons.back, data: `cn:${kind}:${task.n}:${monthKeyOf(owner.calendar, iso)}${at}` }]);
  return { text: w.cal.timeTitle(w.cal.kinds[kind], task.title, dayLabel(iso, owner, todayOf(ctx))), buttons: rows };
}

/** How long a plan lasts, once its start is chosen. */
function durationView(ctx: Ctx, task: TaskRow, iso: string, start: string, back: string): View {
  const { w, owner } = ctx;
  const at = back ? `@${back}` : '';
  const hhmm = start.replace(':', '');
  const pick = (minutes: number) => `cu:p:${task.n}:${iso}:${hhmm}:${minutes}${at}`;
  const d = w.cal.durations;
  return {
    text: w.cal.durationTitle(task.title, dayLabel(iso, owner, todayOf(ctx)), digits(start, owner.language)),
    buttons: [
      [{ text: d.m30, data: pick(30) }, { text: d.h1, data: pick(60) }],
      [{ text: d.h2, data: pick(120) }, { text: d.h3, data: pick(180) }],
      [{ text: d.none, data: pick(0) }],
      [{ text: w.buttons.back, data: `cd:p:${task.n}:${iso}${at}` }],
    ],
  };
}

const hhmmToClock = (hhmm: string): string | null => (/^\d{4}$/.test(hhmm) ? `${hhmm.slice(0, 2)}:${hhmm.slice(2)}` : null);

async function calendarRoute(parts: string[], back: string, ctx: Ctx): Promise<void> {
  const [action, kind, rawN, a = '', b = '', c = ''] = parts;
  if (!PICKS.has(kind)) return;
  const pick = kind as Pick;
  const { w, owner } = ctx;
  const { store } = ctx.deps;
  const task = pick === 'x' ? null : await store.taskByN(Number(rawN));
  if (pick !== 'x' && !task) {
    ctx.toast = w.noSuchTask(digits(rawN ?? '', owner.language));
    return;
  }
  const fresh = async () => (task ? ((await store.taskByN(task.n)) ?? task) : task);

  if (action === 'cn') return present(ctx, await calendarView(ctx, pick, task, a, back));
  if (!isRealDate(a)) return;
  const day = dayLabel(a, owner, todayOf(ctx));

  if (action === 'cd') {
    if (pick === 'x') {
      await ctx.deps.tg.send(ctx.chatId, esc(w.cal.askNew(day, a)), undefined, { forceReply: w.cal.hintNew });
      return;
    }
    if (pick === 'd') {
      if (await saveEdit(ctx, task!, { deadline: a }, { deadline: a })) ctx.toast = w.task.editToast;
      return present(ctx, await taskView(ctx, (await fresh())!, back, w.task.saved(`${w.task.fields.deadline} · ${day}`)));
    }
    return present(ctx, timeView(ctx, pick, task!, a, back));
  }

  if (action === 'cc') {
    const label = digits(task!.n, owner.language);
    const prompt = pick === 'r' ? w.cal.askReminderTime(label, task!.title, day, a) : w.cal.askPlanTime(label, task!.title, day, a);
    await ctx.deps.tg.send(ctx.chatId, esc(prompt), undefined, { forceReply: w.cal.hintTime });
    return;
  }

  if (action === 'cw' && pick === 'p') {
    const reply = await applyPlan(ctx, task!, { date: a });
    return present(ctx, await taskView(ctx, (await fresh())!, back, reply));
  }

  const time = hhmmToClock(b);
  if (!time) return;
  if (action === 'ct' && pick === 'r') {
    if (localToUtc(owner.timezone, a, time).getTime() < ctx.deps.now().getTime()) {
      ctx.toast = w.reminderPast;
      return;
    }
    const reply = await applyReminder(ctx, task!, { date: a, time });
    return present(ctx, await taskView(ctx, (await fresh())!, back, reply));
  }
  if (action === 'ct' && pick === 'p') return present(ctx, durationView(ctx, task!, a, time, back));
  if (action === 'cu' && pick === 'p') {
    const minutes = Number(c);
    const plan: Plan = { date: a, start: time };
    if (minutes > 0) plan.end = toClock(Math.min(clockMinutes(time) + minutes, 23 * 60 + 59));
    const reply = await applyPlan(ctx, task!, plan);
    return present(ctx, await taskView(ctx, (await fresh())!, back, reply));
  }
}

// ── A task's own settings ───────────────────────────────────────────────────

/** Asks the plugin to change a task's settings, and shows the change in the bot's copy at once. */
async function saveEdit(ctx: Ctx, task: TaskRow, fields: Omit<EditPayload, 'key'>, patch: Partial<Omit<TaskRow, 'n' | 'key'>>): Promise<boolean> {
  try {
    await ctx.deps.store.addCommand('edit', { key: task.key, ...fields });
  } catch (error) {
    // The database has not learnt the edit yet (it updates itself on first use).
    console.error("edit not queued");
    await ctx.deps.tg.send(ctx.chatId, ctx.w.task.editUnavailable);
    return false;
  }
  await ctx.deps.store.patchTask(task.key, patch);
  return true;
}

/** Closes a task as done or as not done; either way it leaves the open lists once the notes have it. */
async function closeTask(task: TaskRow, status: 'done' | 'failed', ctx: Ctx): Promise<void> {
  if (status === 'done') await endTracked(ctx, task);
  await ctx.deps.store.patchTask(task.key, { status });
  const payload: StatusPayload = { key: task.key, status };
  await ctx.deps.store.addCommand('status', payload);
}

/** What came back for a question the bot asked: a title, a deadline, tags, a repeat, a reminder or a plan. */
async function answerAsked(kind: string, n: number, text: string, replied: string, ctx: Ctx): Promise<void> {
  const { w, owner } = ctx;
  const { store, tg } = ctx.deps;
  if (kind === '🧩') {
    const parent = await store.taskByN(n);
    if (!parent || !isOpen(parent.status)) return tg.send(ctx.chatId, w.noSuchTask(digits(n, owner.language)));
    const spec = specOf(text, ctx);
    if (!spec) return tg.send(ctx.chatId, w.needTitle);
    const { row, warning } = await createTask(ctx, { ...spec, parent });
    const view = await taskView(ctx, row, '', w.subtaskAdded(esc(truncate(parent.title, 40))), [warning, w.waitingForNotes].filter(Boolean).join('\n'));
    return sendView(ctx, view);
  }
  if (kind === '🔔') return setReminder(`${n} ${text}`, ctx);
  if (kind === '📅') return setPlan(`${n} ${text}`, ctx);

  const task = await store.taskByN(n);
  if (!task) return tg.send(ctx.chatId, w.noSuchTask(digits(n, owner.language)));
  const clock = localNow(owner.timezone, ctx.deps.now());
  const finish = async (what: string) => present(ctx, await taskView(ctx, (await store.taskByN(n)) ?? task, '', w.task.saved(what)));

  if (kind === '⏰' || kind === '🕒') {
    const day = /\d{4}-\d{2}-\d{2}/.exec(replied)?.[0];
    const plan = day ? parseQuickAdd(`${day} ${text}`, { today: clock.date, minutes: clock.minutes }).plan : undefined;
    if (!day || !plan?.start) return tg.send(ctx.chatId, w.cal.cantReadTime);
    if (kind === '🕒') return present(ctx, await taskView(ctx, task, '', await applyPlan(ctx, task, { date: day, start: plan.start, ...(plan.end ? { end: plan.end } : {}) })));
    if (localToUtc(owner.timezone, day, plan.start).getTime() < ctx.deps.now().getTime()) return tg.send(ctx.chatId, w.reminderPast);
    return present(ctx, await taskView(ctx, task, '', await applyReminder(ctx, task, { date: day, time: plan.start })));
  }
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
  if (!mayAnswer(deps, callback.from?.id ?? chatId) || !owner || chatId === undefined || owner.chat_id !== chatId) return deps.tg.answer(callback.id);
  const ctx = ctxFor(deps, owner, chatId, callback.message?.message_id);
  try {
    await route(callback.data ?? '', ctx);
  } finally {
    await ctx.deps.tg.answer(callback.id, ctx.toast);
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
      return present(ctx, await newTaskView(ctx));
    case 'st':
      return present(ctx, await statusView(ctx));
    case 'ls':
      return present(ctx, await listView(ctx, FILTERS.find((f) => f === rawN) ?? 'a', Number(arg) || 0, undefined, core.split(':')[3] === 'q'));
    case 'tg':
      return present(ctx, await tagsView(ctx, Number(rawN) || 0));
    case 'lg':
      // The page, then the tag: a tag has no colon in it, so the rest is the tag.
      return present(ctx, await listView(ctx, 'a', Number(rawN) || 0, core.slice(core.indexOf(':', core.indexOf(':') + 1) + 1)));
    case 'nt': {
      const tag = core.slice(core.indexOf(':') + 1);
      if (!tag) return;
      await tg.send(ctx.chatId, esc(w.tagsUi.askNew(tag)), undefined, { forceReply: w.tagsUi.hintNew });
      return;
    }
    case 'set':
      return settings(rawN, ctx);
    case 'ai':
      return present(ctx, aiView(ctx));
    case 'nf':
      return notifications(rawN, ctx);
    case 'ov':
      return present(ctx, await weekView(ctx, 0));
    case 'wk':
      return present(ctx, await weekView(ctx, Number(rawN) || 0));
    case 'dy':
      return present(ctx, await dayView(ctx, rawN && isRealDate(rawN) ? rawN : todayOf(ctx)));
    case 'mv':
      return moveToTomorrow(ctx);
    case 'pd':
      return planDay(ctx);
    case 'ap':
      return applyPending(ctx);
    case 'ac':
      return cancelPending(ctx);
    case 'ux':
      return undoAssistant(rawN ?? '', ctx);
    case 'cn':
    case 'cd':
    case 'ct':
    case 'cu':
    case 'cw':
    case 'cc':
      return calendarRoute(core.split(':'), back, ctx);
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
      return present(ctx, await taskView(ctx, task, back));
    case 'rm':
      return present(ctx, remindMenuView(ctx, task, back));
    case 'pl':
      return present(ctx, planMenuView(ctx, task, back));
    case 'sb': {
      await tg.send(ctx.chatId, esc(w.askSubtask(digits(task.n, owner.language), task.title)), undefined, { forceReply: w.askHintSubtask });
      return;
    }
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
      await endTracked(ctx, task);
      await store.patchTask(task.key, { status: 'done' });
      const payload: StatusPayload = { key: task.key, status: 'done' };
      await store.addCommand('status', payload);
      ctx.toast = w.doneToast;
      // From a list, straight back to it: the next task is one tap away.
      if (back) return present(ctx, await showList(ctx, backTo));
      return present(ctx, { text: `${w.doneTitle}\n<s>${esc(task.title)}</s>`, buttons: [[{ text: w.buttons.all, data: 'ls:a:0' }, { text: w.buttons.menu, data: 'home' }]] });
    }
    case 'del':
      return present(ctx, confirmDeleteView(ctx, task, back));
    case 'undo':
    case 'delok': {
      await removeTask(task, deps);
      ctx.toast = w.deletedToast;
      if (back) return present(ctx, await showList(ctx, backTo));
      return present(ctx, { text: w.deleted(task.title), buttons: [[{ text: w.buttons.all, data: 'ls:a:0' }, { text: w.buttons.menu, data: 'home' }]] });
    }
    case 'snz':
    case 'rs': {
      // A snooze under a reminder shows the card; a choice in the panel goes back to the panel.
      const show = async (reply: string) => {
        const fresh = (await store.taskByN(n)) ?? task;
        return present(ctx, await (action === 'snz' ? taskView(ctx, fresh, back, reply) : taskView(ctx, fresh, back, reply)));
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
        return present(ctx, await taskView(ctx, (await store.taskByN(n)) ?? task, back, reply));
      }
      const days = Number(arg);
      if (!Number.isFinite(days)) return;
      const today = localNow(owner.timezone, deps.now()).date;
      // The day moves; the hours, if the task had any, stay.
      const plan: Plan = { date: addDays(today, days) };
      if (task.plan_start) plan.start = task.plan_start;
      if (task.plan_end) plan.end = task.plan_end;
      const reply = await applyPlan(ctx, task, plan);
      return present(ctx, await taskView(ctx, (await store.taskByN(n)) ?? task, back, reply));
    }

    // The task's own settings.
    case 'cfg':
      // The settings were once a screen of their own; old messages still point here.
      return present(ctx, await taskView(ctx, task, back));
    case 'sm':
      return present(ctx, statusMenuView(ctx, task, back));
    case 'pm':
      return present(ctx, priorityMenuView(ctx, task, back));
    case 'dm':
      return present(ctx, deadlineMenuView(ctx, task, back));
    case 'tm':
      return present(ctx, await tagsMenuView(ctx, task, back));
    case 'tp':
      return present(ctx, await tagsMenuView(ctx, task, back, Number(arg) || 0));
    case 'tt': {
      // `page~tag`: the page to come back to, and the tag to switch.
      const [page, ...rest] = (arg ?? '').split('~');
      const key = rest.join('~');
      if (!key) return;
      const tags = task.tags.includes(key) ? task.tags.filter((tag) => tag !== key) : [...task.tags, key].slice(0, MAX_TAGS);
      if (await saveEdit(ctx, task, { tags }, { tags })) ctx.toast = w.task.editToast;
      return present(ctx, await tagsMenuView(ctx, (await store.taskByN(n)) ?? task, back, Number(page) || 0));
    }
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
      if (arg === 'done' || arg === 'failed') {
        if (!isOpen(task.status)) return;
        await closeTask(task, arg, ctx);
        ctx.toast = arg === 'done' ? w.doneToast : w.failedToast;
        if (back) return present(ctx, await showList(ctx, backTo));
        const heading = arg === 'done' ? w.doneTitle : w.failedTitle;
        return present(ctx, { text: `${heading}\n<s>${esc(task.title)}</s>`, buttons: [[{ text: w.buttons.all, data: 'ls:a:0' }, { text: w.buttons.menu, data: 'home' }]] });
      }
      if (arg !== 'open' && arg !== 'doing') return;
      if (task.status !== arg) {
        const payload: StatusPayload = { key: task.key, status: arg };
        await store.addCommand('status', payload);
        await store.patchTask(task.key, { status: arg });
      }
      ctx.toast = w.task.editToast;
      return present(ctx, await taskView(ctx, (await store.taskByN(n)) ?? task, back));
    }
    case 'pr': {
      const priority = arg === 'off' ? null : PRIORITIES.find((level) => level === arg);
      if (priority === undefined) return;
      if (await saveEdit(ctx, task, { priority }, { priority })) ctx.toast = w.task.editToast;
      return present(ctx, await taskView(ctx, (await store.taskByN(n)) ?? task, back));
    }
    case 'ds': {
      const today = localNow(owner.timezone, deps.now()).date;
      const deadline = arg === 'off' ? null : Number.isFinite(Number(arg)) ? addDays(today, Number(arg)) : undefined;
      if (deadline === undefined) return;
      if (await saveEdit(ctx, task, { deadline }, { deadline })) ctx.toast = w.task.editToast;
      return present(ctx, await taskView(ctx, (await store.taskByN(n)) ?? task, back));
    }
    case 'tr':
    case 'tx': {
      const tags = action === 'tx' ? [] : task.tags.filter((_, i) => i !== Number(arg));
      if (await saveEdit(ctx, task, { tags }, { tags })) ctx.toast = w.task.editToast;
      return present(ctx, await tagsMenuView(ctx, (await store.taskByN(n)) ?? task, back));
    }
    case 'qs': {
      const repeat = arg === 'off' ? null : /^\d{1,3}[dwm]$/.test(arg ?? '') ? arg! : undefined;
      if (repeat === undefined) return;
      if (await saveEdit(ctx, task, { repeat }, { repeat })) ctx.toast = w.task.editToast;
      return present(ctx, await taskView(ctx, (await store.taskByN(n)) ?? task, back));
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
  } else if (what === 'rich') {
    const rich = owner.rich === false;
    try {
      await store.patchOwner({ rich });
      next = { ...owner, rich };
    } catch (error) {
      // The database has not learnt this setting yet (it updates itself on first use).
      console.error("rich setting not saved");
      ctx.toast = w.richUnavailable;
      return;
    }
  } else if (what === 'pad') {
    const at = PADS.indexOf(padOf(owner.pad) as (typeof PADS)[number]);
    const pad = PADS[(at + 1) % PADS.length];
    try {
      await store.patchOwner({ pad });
      next = { ...owner, pad };
    } catch (error) {
      console.error("width setting not saved");
      ctx.toast = w.richUnavailable;
      return;
    }
  } else if (what === 'ai') {
    if (!ctx.deps.ai) {
      ctx.toast = w.ai.errors.notSetUp;
      return;
    }
    const ai = owner.ai === false;
    try {
      await store.patchOwner({ ai });
      next = { ...owner, ai };
    } catch (error) {
      console.error("assistant setting not saved");
      ctx.toast = w.richUnavailable;
      return;
    }
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

function constantTimeEquals(a: string, b: string): boolean {
  if (!b) return false;
  const length = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < length; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}
