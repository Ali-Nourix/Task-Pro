// The ticker: once a minute, sends what is due. A reminder that has come; the same reminder
// again, up to three times, if the task is still open; the morning summary and the evening
// review at the hours set; and, the evening before a deadline or the morning of it, a nudge.
//
// What was sent is written down in `notified` *before* it is sent: a message that fails to go
// out is lost rather than sent every minute. And without a place to write it down (the database
// has not learnt the column yet) the messages that depend on it wait.

import { addDays, clockMinutes, localNow } from './time.ts';
import { briefMessage, nudgeMessage, reviewMessage } from './digest.ts';
import type { Outgoing } from './digest.ts';
import { reminderMessage, words } from './texts.ts';
import { padOf, widenHtml, widenMarkdown } from './widen.ts';
import type { Notice, Store, TaskRow, Telegram } from './types.ts';
import { sameInstant } from './types.ts';

/** How long after its time a reminder is still worth sending (the phone may have been off). */
export const GRACE_MS = 10 * 60_000;
/** A reminder that is not answered comes again after this long, and at most this many times. */
export const NAG_EVERY_MS = 10 * 60_000;
export const NAG_TIMES = 3;
/** A reminder this old is let go: it is not a reminder any more. */
const NAG_LIMIT_MS = 50 * 60_000;
/** A scheduled message still goes out this long after its hour (the ticker may have been late). */
const WINDOW_MINUTES = 60;
/** Deadline nudges are sent at these hours. */
const EVENING_NUDGE = '20:00';
const MORNING_NUDGE = '08:00';
/** What was sent is remembered for this long. */
const KEEP_DAYS = 3;

export interface TickDeps {
  store: Store;
  tg: Telegram;
  now: () => Date;
  /** Whether the assistant is set up: the morning summary then offers to plan the day. */
  ai?: boolean;
}

const inWindow = (minutes: number, at: string): boolean => {
  const start = clockMinutes(at);
  return minutes >= start && minutes < start + WINDOW_MINUTES;
};

const valid = (time: string | null | undefined): time is string => typeof time === 'string' && /^\d{2}:\d{2}$/.test(time);

export async function runTick(deps: TickDeps): Promise<number> {
  const owner = await deps.store.getOwner();
  if (!owner) return 0;
  const now = deps.now();
  const clock = localNow(owner.timezone, now);
  let sent = 0;

  const notified: Record<string, Notice> = { ...(owner.notified ?? {}) };
  const today = (): string => clock.date;

  /** Writes down what is in `notified`, without what is too old to matter. False when it cannot be written. */
  const persist = async (): Promise<boolean> => {
    const cutoff = now.getTime() - KEEP_DAYS * 86_400_000;
    for (const [key, notice] of Object.entries(notified)) if (new Date(notice.at).getTime() < cutoff) delete notified[key];
    try {
      await deps.store.patchOwner({ notified });
      return true;
    } catch (error) {
      console.error("what was sent is not kept, so nothing more is sent");
      return false;
    }
  };

  const deliver = async (message: Outgoing): Promise<boolean> => {
    try {
      const pad = padOf(owner.pad);
      const options = owner.rich === false ? undefined : { rich: { markdown: widenMarkdown(message.rich, message.text, true, pad), rtl: owner.language === 'fa' } };
      await deps.tg.send(owner.chat_id, widenHtml(message.text, true, pad), message.buttons, options);
      sent++;
      return true;
    } catch (error) {
      console.error("message not sent");
      return false;
    }
  };

  /** The open tasks, fetched once and only when something needs them. */
  let cache: TaskRow[] | null = null;
  const tasks = async (): Promise<TaskRow[]> => (cache ??= await deps.store.openTasks());

  // ── Reminders that have come ───────────────────────────────────────────
  const due = await deps.store.dueReminders(new Date(now.getTime() - GRACE_MS), now);
  let remembered = false;
  for (const task of due) {
    await deps.store.markReminded(task.key, task.remind_at!);
    if (owner.nag !== false) {
      notified[`nag:${task.key}:${task.remind_at}`] = { at: now.toISOString(), n: 0 };
      remembered = true;
    }
    await deliver(reminderMessage(task, owner, today()));
  }
  if (remembered) await persist();

  // ── The same reminder again, while the task is still open ──────────────
  const waiting = owner.nag === false ? [] : Object.keys(notified).filter((key) => key.startsWith('nag:') && (notified[key].n ?? 0) < NAG_TIMES);
  if (waiting.length) {
    let letGo = false;
    for (const task of await tasks()) {
      const key = `nag:${task.key}:${task.remind_at}`;
      const notice = notified[key];
      if (!notice || !task.remind_at || !sameInstant(task.remind_sent_for, task.remind_at)) continue;
      const times = notice.n ?? 0;
      if (times >= NAG_TIMES || now.getTime() - new Date(notice.at).getTime() < NAG_EVERY_MS) continue;
      if (now.getTime() - new Date(task.remind_at).getTime() > NAG_LIMIT_MS) {
        notified[key] = { at: notice.at, n: NAG_TIMES };
        letGo = true;
        continue;
      }
      notified[key] = { at: now.toISOString(), n: times + 1 };
      if (!(await persist())) break;
      await deliver(reminderMessage(task, owner, today(), words(owner.language).digest.nag(times + 1, NAG_TIMES)));
    }
    if (letGo) await persist();
  }

  // ── What is sent at an hour of the day: once for each day ──────────────
  const once = async (key: string, at: string | null | undefined, make: () => Promise<Outgoing | null>): Promise<void> => {
    if (!valid(at) || !inWindow(clock.minutes, at) || notified[key]) return;
    notified[key] = { at: now.toISOString() };
    if (!(await persist())) {
      delete notified[key];
      return;
    }
    const message = await make();
    if (message) await deliver(message);
  };

  const brief = owner.brief_time === undefined ? '08:00' : owner.brief_time;
  const review = owner.review_time === undefined ? '21:00' : owner.review_time;
  const nudge = owner.deadline_nudge ?? 'eve';

  await once(`brief:${today()}`, brief, async () => briefMessage(owner, await tasks(), today(), !!deps.ai));
  await once(`review:${today()}`, review, async () => reviewMessage(owner, await tasks(), today()));
  if (nudge === 'eve' || nudge === 'both') {
    await once(`nudge-eve:${today()}`, EVENING_NUDGE, async () => {
      const list = (await tasks()).filter((task) => task.deadline === addDays(today(), 1));
      return list.length ? nudgeMessage(owner, list, today(), 'eve') : null;
    });
  }
  // The morning summary already lists what is due today.
  if ((nudge === 'morn' || nudge === 'both') && !valid(brief)) {
    await once(`nudge-morn:${today()}`, MORNING_NUDGE, async () => {
      const list = (await tasks()).filter((task) => task.deadline === today());
      return list.length ? nudgeMessage(owner, list, today(), 'morn') : null;
    });
  }
  return sent;
}
