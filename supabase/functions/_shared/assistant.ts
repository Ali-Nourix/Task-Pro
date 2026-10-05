// The assistant: what you write or say in words becomes tasks, through the commands the
// model is given (ai.ts). The model decides; this module checks every field it sends
// (a date that is not a date, a reminder in the past, a number that is not a task) and then
// does the work through the bot's own effects, so a task made this way is exactly a task
// made by hand: queued for the notes the same way, editable from the same screens.

import { AI_TOOLS, READ_ONLY, asciiDigits, cleanReply, readDate, readMoment, readPriority, readTime, saysNone, systemPrompt, taskLine } from './ai.ts';
import type { Ai, AiCall, AiMessage } from './ai.ts';
import type { Moment, Plan, Priority } from './quickadd.ts';
import { MAX_TAGS, cleanTitle, parseRepeat, parseTags } from './taskfields.ts';
import { clockMinutes, daysBetween, localNow, localToUtc } from './time.ts';
import type { EditPayload, OwnerRow, Remembered, Status, Store, TaskRow } from './types.ts';
import { isOpen } from './types.ts';

/** A task to make, with every field already checked. */
export interface NewTask {
  title: string;
  plan?: Plan;
  remind?: Moment;
  deadline?: string;
  priority?: Priority;
  tags: string[];
  repeat?: string;
}

/** What the assistant may do to the bot's tasks; the bot provides them. */
export interface Effects {
  create(task: NewTask): Promise<{ row: TaskRow; warning?: string }>;
  setPlan(task: TaskRow, plan: Plan | null): Promise<void>;
  setRemind(task: TaskRow, moment: Moment | 'off' | 'default'): Promise<void>;
  edit(task: TaskRow, fields: Omit<EditPayload, 'key'>, patch: Partial<Omit<TaskRow, 'n' | 'key'>>): Promise<boolean>;
  setStatus(task: TaskRow, status: Status): Promise<void>;
}

export type WarningKind = 'badValue' | 'reminderPast' | 'noTask' | 'duplicate' | 'noTitle' | 'tooMany';

export interface AssistantWarning {
  kind: WarningKind;
  /** What it is about: the field's value, a task's number or title. */
  detail?: string;
}

export interface Change {
  kind: 'added' | 'changed' | 'status';
  key: string;
}

export interface AssistantResult {
  /** What the model said in words, made safe to show. */
  say: string;
  changes: Change[];
  /** Tasks the model proposed to delete: the user confirms each. */
  proposals: string[];
  warnings: AssistantWarning[];
  /** What was done, in plain lines with the task numbers: the model reads it next time. */
  summary: string;
}

export interface AssistantInput {
  ai: Ai;
  store: Store;
  effects: Effects;
  owner: OwnerRow;
  now: Date;
  text: string;
  memory: Remembered[];
  /** The tag keys the notes use. */
  tags: string[];
}

/** How long a conversation is remembered, and how much of it. */
export const MEMORY_MINUTES = 30;
export const MEMORY_LINES = 8;
const MAX_ROUNDS = 6;
const MAX_CALLS = 25;
/** Past this the model is not asked again: the webhook has to answer. */
const BUDGET_MS = 30_000;
/** A date this far back or ahead is a slip of the model's (a wrong year), not a wish. */
const PAST_DAYS = 31;
const AHEAD_DAYS = 1100;

/** The remembered lines that are still fresh, as the model's earlier turns. */
export function freshMemory(memory: Remembered[] | null | undefined, now: Date): Remembered[] {
  return (Array.isArray(memory) ? memory : [])
    .filter((line) => line && (line.role === 'user' || line.role === 'assistant') && typeof line.content === 'string' && now.getTime() - new Date(line.at).getTime() < MEMORY_MINUTES * 60_000)
    .slice(-MEMORY_LINES);
}

export function remember(memory: Remembered[], text: string, result: AssistantResult, now: Date): Remembered[] {
  const at = now.toISOString();
  const answer = [result.say, result.summary].filter(Boolean).join('\n') || '(nothing done)';
  return [...memory, { role: 'user' as const, content: text.slice(0, 600), at }, { role: 'assistant' as const, content: answer.slice(0, 1200), at }].slice(-MEMORY_LINES);
}

const has = (args: Record<string, unknown>, key: string): boolean => args[key] !== undefined && args[key] !== null && args[key] !== '';
const strings = (value: unknown): string[] => (Array.isArray(value) ? value.map((v) => String(v)) : typeof value === 'string' ? [value] : []);

export async function runAssistant(input: AssistantInput): Promise<AssistantResult> {
  const { ai, store, effects, owner, now } = input;
  const started = Date.now();
  const clock = localNow(owner.timezone, now);
  const changes = new Map<string, Change>();
  const proposals = new Set<string>();
  const warnings: AssistantWarning[] = [];
  const summary: string[] = [];
  const warn = (kind: WarningKind, detail?: string) => warnings.push({ kind, detail });

  const record = (kind: Change['kind'], task: TaskRow) => {
    const earlier = changes.get(task.key);
    // A task made in this run stays «added» however it is changed after.
    changes.set(task.key, { kind: earlier?.kind === 'added' ? 'added' : kind, key: task.key });
  };

  const openTask = async (args: Record<string, unknown>): Promise<TaskRow | null> => {
    const n = Number(asciiDigits(String(args.n ?? '')));
    const task = Number.isInteger(n) ? await store.taskByN(n) : null;
    if (!task || !isOpen(task.status)) {
      warn('noTask', String(args.n ?? ''));
      return null;
    }
    return task;
  };

  /** A day field: undefined when it was not sent, null when it was sent but cannot be read. */
  const day = (args: Record<string, unknown>, key: string): string | null | undefined => {
    if (!has(args, key)) return undefined;
    const value = readDate(args[key]);
    const away = value ? daysBetween(clock.date, value) : 0;
    if (!value || away < -PAST_DAYS || away > AHEAD_DAYS) {
      warn('badValue', String(args[key]));
      return null;
    }
    return value;
  };

  const moment = (args: Record<string, unknown>, key: string): Moment | null | undefined => {
    if (!has(args, key)) return undefined;
    const value = readMoment(args[key]);
    if (!value) {
      warn('badValue', String(args[key]));
      return null;
    }
    if (localToUtc(owner.timezone, value.date, value.time).getTime() < now.getTime()) {
      warn('reminderPast', `${value.date} ${value.time}`);
      return null;
    }
    return value;
  };

  const add = async (args: Record<string, unknown>): Promise<string> => {
    const title = cleanTitle(String(args.title ?? ''));
    if (!title) {
      warn('noTitle');
      return 'not created: no title';
    }
    const date = day(args, 'plan_date');
    const start = has(args, 'plan_start') ? readTime(args.plan_start) : null;
    let end = has(args, 'plan_end') ? readTime(args.plan_end) : null;
    if (has(args, 'plan_start') && !start) warn('badValue', String(args.plan_start));
    if (end && (!start || clockMinutes(end) <= clockMinutes(start))) end = null;
    const plan: Plan | undefined = date || start ? { date: date ?? clock.date, ...(start ? { start } : {}), ...(end ? { end } : {}) } : undefined;
    const repeat = has(args, 'repeat') ? parseRepeat(String(args.repeat)) : undefined;
    if (has(args, 'repeat') && repeat === undefined) warn('badValue', String(args.repeat));

    // The model repeating itself (or the user asking twice) must not make two tasks.
    const twin = (await store.openTasks()).find((task) => task.title.trim().toLowerCase() === title.toLowerCase() && task.plan_date === (plan?.date ?? null));
    if (twin) {
      warn('duplicate', `#${twin.n} ${twin.title}`);
      return `not created: #${twin.n} is already the same task`;
    }

    const spec: NewTask = { title, tags: parseTags(strings(args.tags).join(' ')) };
    if (plan) spec.plan = plan;
    const deadline = day(args, 'deadline');
    if (deadline) spec.deadline = deadline;
    const remind = moment(args, 'remind');
    if (remind) spec.remind = remind;
    const priority = has(args, 'priority') ? readPriority(args.priority) : undefined;
    if (has(args, 'priority') && !priority) warn('badValue', String(args.priority));
    if (priority) spec.priority = priority;
    if (repeat) spec.repeat = repeat;

    const { row, warning } = await effects.create(spec);
    if (warning) warn('reminderPast');
    record('added', row);
    summary.push(`Created ${taskLine(row, owner.timezone)}`);
    return `created #${row.n}`;
  };

  const update = async (args: Record<string, unknown>): Promise<string> => {
    const task = await openTask(args);
    if (!task) return 'no such open task';
    const fields: Omit<EditPayload, 'key'> = {};
    const patch: Partial<Omit<TaskRow, 'n' | 'key'>> = {};

    if (has(args, 'title')) {
      const title = cleanTitle(String(args.title));
      if (title) {
        fields.title = title;
        patch.title = title;
      }
    }
    if (has(args, 'priority')) {
      const priority = saysNone(args.priority) ? null : (readPriority(args.priority) ?? undefined);
      if (priority === undefined) warn('badValue', String(args.priority));
      else {
        fields.priority = priority;
        patch.priority = priority;
      }
    }
    if (has(args, 'deadline')) {
      if (saysNone(args.deadline)) {
        fields.deadline = null;
        patch.deadline = null;
      } else {
        const deadline = day(args, 'deadline');
        if (deadline) {
          fields.deadline = deadline;
          patch.deadline = deadline;
        }
      }
    }
    if (has(args, 'add_tags') || has(args, 'remove_tags')) {
      const removed = new Set(parseTags(strings(args.remove_tags).join(' ')));
      const tags = [...task.tags.filter((tag) => !removed.has(tag)), ...parseTags(strings(args.add_tags).join(' ')).filter((tag) => !task.tags.includes(tag))].slice(0, MAX_TAGS);
      fields.tags = tags;
      patch.tags = tags;
    }
    if (has(args, 'repeat')) {
      const repeat = parseRepeat(String(args.repeat));
      if (repeat === undefined) warn('badValue', String(args.repeat));
      else {
        fields.repeat = repeat;
        patch.repeat = repeat;
      }
    }
    if (Object.keys(fields).length && !(await effects.edit(task, fields, patch))) return 'could not save';

    if (has(args, 'plan_date') || has(args, 'plan_start') || has(args, 'plan_end')) {
      if (saysNone(args.plan_date)) await effects.setPlan(task, null);
      else {
        const date = day(args, 'plan_date') ?? task.plan_date ?? clock.date;
        const time = (key: 'plan_start' | 'plan_end', current: string | null): string | undefined => {
          if (!has(args, key)) return current ?? undefined;
          if (saysNone(args[key])) return undefined;
          const value = readTime(args[key]);
          if (!value) warn('badValue', String(args[key]));
          return value ?? current ?? undefined;
        };
        const start = time('plan_start', task.plan_start);
        let end = time('plan_end', task.plan_end);
        if (end && (!start || clockMinutes(end) <= clockMinutes(start))) end = undefined;
        await effects.setPlan(task, { date, ...(start ? { start } : {}), ...(end ? { end } : {}) });
      }
    }
    if (has(args, 'remind')) {
      const fresh = (await store.taskByKey(task.key)) ?? task;
      if (saysNone(args.remind)) await effects.setRemind(fresh, 'off');
      else if (typeof args.remind === 'string' && args.remind.trim().toLowerCase() === 'default') await effects.setRemind(fresh, 'default');
      else {
        const at = moment(args, 'remind');
        if (at) await effects.setRemind(fresh, at);
      }
    }
    const fresh = (await store.taskByKey(task.key)) ?? task;
    record('changed', fresh);
    summary.push(`Updated ${taskLine(fresh, owner.timezone)}`);
    return `updated #${task.n}`;
  };

  const setStatus = async (args: Record<string, unknown>): Promise<string> => {
    const task = await openTask(args);
    if (!task) return 'no such open task';
    const status = String(args.status ?? '').toLowerCase();
    if (status !== 'done' && status !== 'failed' && status !== 'doing' && status !== 'open') {
      warn('badValue', String(args.status));
      return 'unknown status';
    }
    await effects.setStatus(task, status);
    record('status', { ...task, status });
    summary.push(`Marked #${task.n} «${task.title}» as ${status}`);
    return `#${task.n} is now ${status}`;
  };

  const propose = async (args: Record<string, unknown>): Promise<string> => {
    const task = await openTask(args);
    if (!task) return 'no such open task';
    proposals.add(task.key);
    summary.push(`Asked the user to confirm deleting #${task.n} «${task.title}»`);
    return `#${task.n} will be deleted only if the user confirms`;
  };

  const find = async (args: Record<string, unknown>): Promise<string> => {
    const from = has(args, 'from') ? readDate(args.from) : null;
    const to = has(args, 'to') ? readDate(args.to) : null;
    const text = has(args, 'text') ? String(args.text).toLowerCase() : '';
    const tag = has(args, 'tag') ? parseTags(String(args.tag))[0] : undefined;
    const found = (await store.openTasks())
      .filter((task) => {
        if (text && !task.title.toLowerCase().includes(text)) return false;
        if (tag && !task.tags.includes(tag)) return false;
        if (from || to) {
          const days = [task.plan_date, task.deadline].filter((d): d is string => !!d);
          if (!days.some((d) => (!from || d >= from) && (!to || d <= to))) return false;
        }
        return true;
      })
      .slice(0, 30);
    return found.length ? found.map((task) => taskLine(task, owner.timezone)).join('\n') : 'no tasks match';
  };

  const run = async (call: AiCall): Promise<string> => {
    try {
      switch (call.name) {
        case 'add_task':
          return await add(call.args);
        case 'update_task':
          return await update(call.args);
        case 'set_status':
          return await setStatus(call.args);
        case 'delete_task':
          return await propose(call.args);
        case 'find_tasks':
          return await find(call.args);
        default:
          return 'unknown command';
      }
    } catch (error) {
      console.error('assistant command failed', call.name, error);
      return 'failed';
    }
  };

  const messages: AiMessage[] = [
    {
      role: 'system',
      content: systemPrompt({
        language: owner.language,
        calendar: owner.calendar,
        timezone: owner.timezone,
        today: clock.date,
        minutes: clock.minutes,
        leadMinutes: owner.lead_minutes,
        tasks: await store.openTasks(),
        tags: input.tags,
      }),
    },
    ...input.memory.map((line) => ({ role: line.role, content: line.content })),
    { role: 'user', content: input.text },
  ];

  let say = '';
  let executed = 0;
  for (let round = 0; round < MAX_ROUNDS; round++) {
    let reply;
    try {
      reply = await ai.chat(messages, AI_TOOLS);
    } catch (error) {
      // What was already done stays done: only the first question may fail the whole run.
      if (round === 0) throw error;
      console.error('assistant stopped early', error);
      break;
    }
    say = cleanReply(reply.text) || say;
    if (!reply.calls.length) break;

    const results: string[] = [];
    let reads = false;
    let writes = 0;
    for (const call of reply.calls) {
      if (executed >= MAX_CALLS) {
        warn('tooMany');
        break;
      }
      executed++;
      results.push(`${call.name}: ${await run(call)}`);
      if (READ_ONLY.has(call.name)) reads = true;
      else writes++;
    }
    // A command that only looks things up is followed by the model's answer. So is a lone change: some
    // models give one command to a reply, and the rest of what was asked is still to come.
    const again = reads || writes === 1;
    if (!again || Date.now() - started > BUDGET_MS) break;
    messages.push(
      { role: 'assistant', content: reply.text.trim() || `(called ${reply.calls.map((call) => call.name).join(', ')})` },
      { role: 'user', content: `[Results]\n${results.join('\n')}\n[End of results] If the user asked for more than this and it is not done yet, call the next commands now (never repeat one that is done). Otherwise answer in one short sentence.` }
    );
  }

  return { say, changes: [...changes.values()], proposals: [...proposals], warnings, summary: summary.join('\n') };
}
