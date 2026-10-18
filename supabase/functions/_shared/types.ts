// What the bot, the sync and the ticker pass around.

import type { Moment, Plan, Priority } from './quickadd.ts';

/** A tag the notes know: the key written in them, the name the plugin shows for it, and how many tasks carry it. */
export interface TagInfo {
  key: string;
  name?: string;
  count: number;
}

/** Open, in progress, done, not done: the marker between a task line's brackets, in words. */
export type Status = 'open' | 'doing' | 'done' | 'failed';

/** A line of the conversation with the assistant, kept for a while so «make it Friday» can follow «call Sara». */
export interface Remembered {
  role: 'user' | 'assistant';
  content: string;
  at: string;
}

/** What the bot has already sent, and when, so that a message goes out once. */
export interface Notice {
  at: string;
  /** For a reminder that repeats: how many times it has. */
  n?: number;
}

/** What the assistant would do, shown to the owner and kept until it is accepted or dropped. */
export interface PendingPlan {
  at: string;
  text: string;
  calls: { name: string; args: Record<string, unknown> }[];
}

export type DeadlineNudge = 'off' | 'eve' | 'morn' | 'both';
export type AiConfirm = 'ask' | 'big' | 'auto';

export type Language = 'fa' | 'en';
export type CalendarKind = 'jalali' | 'gregorian';

export interface OwnerRow {
  chat_id: number;
  timezone: string;
  language: Language;
  calendar: CalendarKind;
  lead_minutes: number;
  /** Show screens as Telegram's rich messages (headings, tables, task lists). On unless turned off. */
  rich?: boolean | null;
  /** How many invisible characters widen a short message (0: none). */
  pad?: number | null;
  /** The assistant answers what is written, unless turned off. It also needs its keys (see the setup guide). */
  ai?: boolean | null;
  /** When the morning summary comes (HH:MM), or null for never. */
  brief_time?: string | null;
  /** When the evening review comes, or null. */
  review_time?: string | null;
  /** A message the evening before a deadline (eve), the morning of it (morn), both, or none. */
  deadline_nudge?: DeadlineNudge | null;
  /** A reminder that is not answered comes again, up to three times. */
  nag?: boolean | null;
  /** What was sent by itself already: the key says what and for which day. */
  notified?: Record<string, Notice> | null;
  /** Whether the assistant shows its plan first: always, only when it is big, or never. */
  ai_confirm?: AiConfirm | null;
  /** The plan waiting for a yes. */
  ai_pending?: PendingPlan | null;
  /** The last lines of the conversation with the assistant. */
  ai_memory?: Remembered[] | null;
  /** The tags the notes use or define, with how many tasks have each, as the plugin last uploaded them. */
  tag_catalog?: TagInfo[] | null;
  /** A task made in Telegram without a plan is planned for its day, as the plugin's «Plan new tasks for today» does. On unless turned off. */
  auto_plan?: boolean | null;
  /** A task made in Telegram today starts its plan at that moment, and ticking it off there ends it, as the plugin's «Track start and end time» does. */
  track_time?: boolean | null;
  last_sync_at: string | null;
}

export interface TaskRow {
  n: number;
  key: string;
  title: string;
  status: Status;
  priority: Priority | null;
  deadline: string | null;
  plan_date: string | null;
  plan_start: string | null;
  plan_end: string | null;
  remind_at: string | null;
  remind_sent_for: string | null;
  /** How often it comes back: 1d, 2w, 1m. */
  repeat: string | null;
  /** The task it is nested under. */
  parent_key: string | null;
  parent_title: string | null;
  /** For a task with subtasks: how many of its direct subtasks are done, and how many it has. */
  subs_done: number | null;
  subs_total: number | null;
  tags: string[];
  note_path: string | null;
  origin: 'vault' | 'telegram';
  pending: boolean;
}

/** A task as the plugin uploads it. */
export type SnapshotTask = Pick<
  TaskRow,
  'key' | 'title' | 'status' | 'priority' | 'deadline' | 'plan_date' | 'plan_start' | 'plan_end' | 'remind_at' | 'repeat' | 'parent_key' | 'parent_title' | 'subs_done' | 'subs_total' | 'tags' | 'note_path'
>;

export type CommandKind = 'add' | 'status' | 'remind' | 'plan' | 'edit' | 'delete';

export interface AddPayload {
  key: string;
  /** The day it was made for: it is written into that day's note. */
  day?: string;
  title: string;
  priority?: Priority;
  tags: string[];
  deadline?: string;
  plan?: Plan;
  /** The plan's start is the moment the task was made, not a time the owner chose: no «starts now» for it. */
  tracked?: boolean;
  remind?: Moment;
  /** The key of the task it is a subtask of: it is written under that task. */
  parent?: string;
}

export interface StatusPayload {
  key: string;
  status: Status;
}

/** A moment, `off` for none, or `default` to leave it to the plan's lead time. */
export interface RemindPayload {
  key: string;
  moment: Moment | 'off' | 'default';
}

export interface PlanPayload {
  key: string;
  plan: Plan | null;
}

/** The settings of a task changed together: only the fields present are touched, and null clears one. */
export interface EditPayload {
  key: string;
  title?: string;
  priority?: Priority | null;
  deadline?: string | null;
  tags?: string[];
  repeat?: string | null;
}

export interface DeletePayload {
  key: string;
}

export interface CommandRow {
  id: string;
  kind: CommandKind;
  payload: Record<string, unknown>;
  created_at: string;
}

/** Where tasks, commands and the owner live. A database in production, memory in tests. */
export interface Store {
  getOwner(): Promise<OwnerRow | null>;
  setOwner(owner: Omit<OwnerRow, 'last_sync_at'>): Promise<void>;
  patchOwner(patch: Partial<OwnerRow>): Promise<void>;

  /** Open tasks (not done, not failed), by their number. */
  openTasks(): Promise<TaskRow[]>;
  taskByN(n: number): Promise<TaskRow | null>;
  taskByKey(key: string): Promise<TaskRow | null>;
  insertTask(task: Omit<TaskRow, 'n' | 'remind_sent_for'>): Promise<TaskRow>;
  patchTask(key: string, patch: Partial<Omit<TaskRow, 'n' | 'key'>>): Promise<void>;
  removeTask(key: string): Promise<void>;
  /**
   * Makes the vault's rows match the plugin's upload: rows are added or updated,
   * the ones in `keep` are left as they are (a change from Telegram is waiting for
   * them), and vault rows that are no longer open are removed.
   */
  replaceSnapshot(rows: SnapshotTask[], keep: ReadonlySet<string>): Promise<void>;
  /** A task made in Telegram has been written into a note: it goes by the note's key from now on. */
  rekey(from: string, to: string): Promise<void>;

  addCommand(kind: CommandKind, payload: object): Promise<CommandRow>;
  pendingCommands(): Promise<CommandRow[]>;
  finishCommand(id: string, error?: string): Promise<CommandRow | null>;

  /** Open tasks whose reminder time is in the window and has not been announced. */
  dueReminders(from: Date, to: Date): Promise<TaskRow[]>;
  markReminded(key: string, remindAt: string): Promise<void>;
}

/** Telegram, as far as the bot needs it. */
export interface Button {
  text: string;
  /** What comes back when it is pressed. */
  data: string;
  /** The button's colour: blue, green or red. Older clients show it plain. */
  style?: 'primary' | 'success' | 'danger';
  /** A button that only fills a place (a page number, a gap): drawn disabled, and still a harmless tap on older clients. */
  disabled?: boolean;
}

export interface BotCommand {
  command: string;
  description: string;
}

/** The same screen as a rich message: Markdown, and whether it reads right to left. */
export interface Rich {
  markdown: string;
  rtl: boolean;
}

export interface Telegram {
  /**
   * `text` is HTML. With `rich` the message is sent as a rich message, falling back to the HTML
   * when Telegram will not take it. With `forceReply` it asks for an answer, with that hint in the field.
   */
  send(chatId: number, text: string, buttons?: Button[][], options?: { forceReply?: string; rich?: Rich; replyTo?: number }): Promise<void>;
  /** Replaces a message in place, text and buttons together. Throws when it cannot (the caller then sends instead). */
  edit(chatId: number, messageId: number, text: string, buttons?: Button[][], rich?: Rich): Promise<void>;
  /** Stops the button's spinner, with a short note over the chat when `text` is given. */
  answer(callbackId: string, text?: string): Promise<void>;
  /** The list of commands in the chat's menu. */
  setCommands(chatId: number, commands: BotCommand[]): Promise<void>;
  /** Owner-scoped launch button; other bot commands remain available. */
  setMiniAppMenu?(chatId: number, url: string, text: string): Promise<void>;
  /** Shows «typing…» in the chat while the assistant thinks. */
  typing?(chatId: number): Promise<void>;
  /**
   * A «Thinking…» placeholder that Telegram removes when the real message arrives. `html` is what
   * it says in rich HTML: an optional paragraph (what a voice message said) and a `<tg-thinking>`
   * block with the words. Falls back to «typing…».
   */
  thinking?(chatId: number, html: string): Promise<void>;
  /** Puts one reaction on a message (null takes it off). */
  react?(chatId: number, messageId: number, emoji: string | null): Promise<void>;
  /** The bytes of a file Telegram holds (a voice message). */
  download?(fileId: string): Promise<Uint8Array>;
}

/** The number a task has in a preview, before it is made: far above any real one. */
export const PROVISIONAL_N = 1_000_000;

export const OPEN: readonly Status[] = ['open', 'doing'];

export const isOpen = (status: Status): boolean => status === 'open' || status === 'doing';

export function sameInstant(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return a === b;
  return new Date(a).getTime() === new Date(b).getTime();
}
