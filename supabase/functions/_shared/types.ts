// What the bot, the sync and the ticker pass around.

import type { Moment, Plan, Priority } from './quickadd.ts';

/** Open, in progress, done, not done: the marker between a task line's brackets, in words. */
export type Status = 'open' | 'doing' | 'done' | 'failed';

export type Language = 'fa' | 'en';
export type CalendarKind = 'jalali' | 'gregorian';

export interface OwnerRow {
  chat_id: number;
  timezone: string;
  language: Language;
  calendar: CalendarKind;
  lead_minutes: number;
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
  tags: string[];
  note_path: string | null;
  origin: 'vault' | 'telegram';
  pending: boolean;
}

/** A task as the plugin uploads it. */
export type SnapshotTask = Pick<
  TaskRow,
  'key' | 'title' | 'status' | 'priority' | 'deadline' | 'plan_date' | 'plan_start' | 'plan_end' | 'remind_at' | 'repeat' | 'tags' | 'note_path'
>;

export type CommandKind = 'add' | 'status' | 'remind' | 'plan' | 'edit' | 'delete';

export interface AddPayload {
  key: string;
  title: string;
  priority?: Priority;
  tags: string[];
  deadline?: string;
  plan?: Plan;
  remind?: Moment;
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
}

export interface BotCommand {
  command: string;
  description: string;
}

export interface Telegram {
  /** `text` is HTML. With `forceReply` the message asks for an answer, with that hint in the field. */
  send(chatId: number, text: string, buttons?: Button[][], options?: { forceReply?: string }): Promise<void>;
  /** Replaces a message in place, text and buttons together. Throws when it cannot (the caller then sends instead). */
  edit(chatId: number, messageId: number, text: string, buttons?: Button[][]): Promise<void>;
  /** Stops the button's spinner, with a short note over the chat when `text` is given. */
  answer(callbackId: string, text?: string): Promise<void>;
  /** The list of commands in the chat's menu. */
  setCommands(chatId: number, commands: BotCommand[]): Promise<void>;
}

export const OPEN: readonly Status[] = ['open', 'doing'];

export const isOpen = (status: Status): boolean => status === 'open' || status === 'doing';

export function sameInstant(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return a === b;
  return new Date(a).getTime() === new Date(b).getTime();
}
