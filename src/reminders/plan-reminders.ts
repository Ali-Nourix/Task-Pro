// ── reminders/plan-reminders.ts ───────────────────────────────────────────
// A notice shortly before a planned task starts: "Starts in 10 min — Design
// review, 09:30 – 11:00", with a way to open it, put it off for five minutes,
// or tick it off.
//
// Only tasks planned at a time of day are announced, never whole-day plans
// or tasks already closed. The lead time is the setting's unless the task
// has its own (`@remind(15m)`, or `@remind(off)`). One low-frequency ticker
// checks the plans the task store already holds, and every announcement is
// remembered, so a restart or a second device never repeats one. A plan that
// was due while Obsidian was closed is still announced if its start is only
// a few minutes behind; older ones are let go.
// ─────────────────────────────────────────────────────────────────────────────

import { Notice } from 'obsidian';
import type { Language, ReminderSettings, TaskSchedule } from '../types';
import type { BoardTask } from '../board/task-store';
import { displayTitle } from '../board/board-text';
import { isolate } from '../bidi';
import { durationText } from '../board/task-actions';

/** How often plans are checked. Announcements are minute-grained. */
const TICK_MS = 20_000;
/** How long after its start a plan is still worth announcing. */
const GRACE_MINUTES = 10;
/** How long "Snooze" puts one off. */
const SNOOZE_MINUTES = 5;
/** Remembered announcements are dropped once their plan is this old. */
const KEEP_DAYS = 3;

export interface DueReminder {
  task: BoardTask;
  /** Names this announcement: the task, its plan and its lead time. */
  key: string;
  /** When the plan starts, in epoch milliseconds. */
  startsAt: number;
  lead: number;
}

/** When a timed plan starts, in epoch milliseconds, local time. Null for a whole-day plan. */
export function planStartsAt(schedule: TaskSchedule): number | null {
  const time = /^(\d{1,2}):(\d{2})$/.exec(schedule.start ?? '');
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(schedule.date);
  if (!time || !day) return null;
  return new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3]), Number(time[1]), Number(time[2])).getTime();
}

export function reminderKey(task: BoardTask, lead: number): string {
  const schedule = task.schedule!;
  return `${task.filePath}|${task.blockId ?? displayTitle(task.text)}|${schedule.date} ${schedule.start}|${lead}`;
}

/**
 * The plans to announce now: timed, not closed, not already announced, and
 * inside the window that opens `lead` minutes before the start and closes a
 * few minutes after it.
 */
export function dueReminders(
  tasks: Iterable<BoardTask>,
  now: number,
  settings: Pick<ReminderSettings, 'planReminders' | 'planLeadMinutes'>,
  announced: ReadonlySet<string>
): DueReminder[] {
  const due: DueReminder[] = [];
  for (const task of tasks) {
    if (!task.schedule?.start || task.status === '[x]' || task.status === '[!]') continue;
    const lead = task.remind === undefined ? (settings.planReminders ? settings.planLeadMinutes : null) : task.remind;
    if (lead === null) continue;
    const startsAt = planStartsAt(task.schedule);
    if (startsAt === null) continue;
    if (now < startsAt - lead * 60_000 || now > startsAt + GRACE_MINUTES * 60_000) continue;
    const key = reminderKey(task, lead);
    if (announced.has(key)) continue;
    due.push({ task, key, startsAt, lead });
  }
  return due.sort((a, b) => a.startsAt - b.startsAt);
}

const LABELS: Record<Language, {
  startsIn: (minutes: number) => string;
  startsNow: string;
  started: (minutes: number) => string;
  open: string;
  snooze: string;
  done: string;
}> = {
  en: {
    startsIn: (minutes) => `Starts in ${durationText('en', minutes)}`,
    startsNow: 'Starts now',
    started: (minutes) => `Started ${durationText('en', minutes)} ago`,
    open: 'Open',
    snooze: `Snooze ${SNOOZE_MINUTES} min`,
    done: 'Done',
  },
  fa: {
    startsIn: (minutes) => `${durationText('fa', minutes)} دیگر شروع می‌شود`,
    startsNow: 'همین حالا شروع می‌شود',
    started: (minutes) => `${durationText('fa', minutes)} پیش شروع شد`,
    open: 'باز کردن',
    snooze: `${SNOOZE_MINUTES} دقیقه بعد`,
    done: 'انجام شد',
  },
};

export interface PlanReminderHost {
  tasks(): BoardTask[] | null;
  settings(): ReminderSettings;
  language(): Language;
  /** The plan as its chip says it: "Today, 09:30 – 11:00". */
  planText(schedule: TaskSchedule): string;
  announced(): string[];
  setAnnounced(keys: string[]): Promise<void>;
  reveal(task: BoardTask): void;
  markDone(task: BoardTask): Promise<void>;
  playSound(): void;
  systemNotification(title: string, body: string): void;
  registerInterval(id: number): void;
}

export class PlanReminderService {
  private timer: number | null = null;
  /** Put off until then, by announcement key. */
  private readonly snoozed = new Map<string, number>();
  private readonly showing = new Map<string, Notice>();

  constructor(private readonly host: PlanReminderHost) {}

  start(): void {
    this.stop();
    this.timer = window.setInterval(() => void this.tick(), TICK_MS);
    this.host.registerInterval(this.timer);
    void this.tick();
  }

  stop(): void {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
  }

  /** The settings changed. */
  refresh(): void {
    this.start();
  }

  async tick(now = Date.now()): Promise<void> {
    const tasks = this.host.tasks();
    if (!tasks) return;
    const announced = new Set(this.host.announced());
    const due = dueReminders(tasks, now, this.host.settings(), announced).filter((reminder) => {
      const until = this.snoozed.get(reminder.key);
      return !this.showing.has(reminder.key) && (until === undefined || now >= until);
    });
    if (!due.length) return;
    for (const reminder of due) {
      this.snoozed.delete(reminder.key);
      announced.add(reminder.key);
      this.announce(reminder, now);
    }
    await this.host.setAnnounced(this.prune(Array.from(announced), now));
  }

  /** Keeps what is still recent, so the list does not grow for ever. */
  private prune(keys: string[], now: number): string[] {
    const oldest = now - KEEP_DAYS * 86_400_000;
    return keys.filter((key) => {
      const when = /\|(\d{4}-\d{2}-\d{2}) (\d{1,2}:\d{2})\|/.exec(key);
      const at = when ? planStartsAt({ date: when[1], start: when[2] }) : null;
      return at === null || at >= oldest;
    });
  }

  private announce(reminder: DueReminder, now: number): void {
    const language = this.host.language();
    const labels = LABELS[language];
    const minutes = Math.round((reminder.startsAt - now) / 60_000);
    const when = minutes > 0 ? labels.startsIn(minutes) : minutes === 0 ? labels.startsNow : labels.started(-minutes);
    const title = displayTitle(reminder.task.text) || reminder.task.text;
    const plan = this.host.planText(reminder.task.schedule!);

    const fragment = document.createDocumentFragment();
    const notice = new Notice(fragment, 0);
    this.showing.set(reminder.key, notice);
    const el = (notice as unknown as { messageEl?: HTMLElement; noticeEl?: HTMLElement }).messageEl
      ?? (notice as unknown as { noticeEl?: HTMLElement }).noticeEl;
    if (el?.createDiv) {
      el.empty();
      el.addClass('taskpro-plan-notice');
      el.setAttribute('dir', language === 'fa' ? 'rtl' : 'ltr');
      el.createDiv({ cls: 'taskpro-plan-notice__when', text: when });
      el.createDiv({ cls: 'taskpro-plan-notice__title', text: title, attr: { dir: 'auto' } });
      el.createDiv({ cls: 'taskpro-plan-notice__plan', text: plan });
      const actions = el.createDiv({ cls: 'taskpro-plan-notice__actions' });
      const button = (text: string, cls: string, run: () => void) => {
        const b = actions.createEl('button', { cls: `taskpro-plan-notice__action ${cls}`, text });
        b.addEventListener('click', (event) => {
          event.stopPropagation();
          this.showing.delete(reminder.key);
          notice.hide();
          run();
        });
      };
      button(labels.done, 'is-done', () => void this.host.markDone(reminder.task));
      button(labels.snooze, 'is-snooze', () => {
        this.snoozed.set(reminder.key, Date.now() + SNOOZE_MINUTES * 60_000);
        void this.host.setAnnounced(this.host.announced().filter((key) => key !== reminder.key));
      });
      button(labels.open, 'mod-cta', () => this.host.reveal(reminder.task));
      // A click anywhere else on the notice closes it, as Obsidian's notices do.
      el.addEventListener('click', () => this.showing.delete(reminder.key));
    }

    const settings = this.host.settings();
    if (settings.planSound) this.host.playSound();
    if (settings.planSystemNotification) this.host.systemNotification(when, `${isolate(title)} · ${plan}`);
  }
}
