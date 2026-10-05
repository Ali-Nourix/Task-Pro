// The ticker: once a minute, announces the reminders that have come due.

import { reminderMessage } from './texts.ts';
import { padOf, widenHtml, widenMarkdown } from './widen.ts';
import { localNow } from './time.ts';
import type { Store, Telegram } from './types.ts';

/** How long after its time a reminder is still worth sending (the phone may have been off). */
export const GRACE_MS = 10 * 60_000;

export async function runTick(deps: { store: Store; tg: Telegram; now: () => Date }): Promise<number> {
  const owner = await deps.store.getOwner();
  if (!owner) return 0;
  const now = deps.now();
  const due = await deps.store.dueReminders(new Date(now.getTime() - GRACE_MS), now);
  const clock = localNow(owner.timezone, now);
  let sent = 0;
  for (const task of due) {
    // Marked first: a reminder that fails to send is lost rather than sent every minute.
    await deps.store.markReminded(task.key, task.remind_at!);
    const message = reminderMessage(task, owner, clock.date);
    try {
      const pad = padOf(owner.pad);
      const options = owner.rich === false ? undefined : { rich: { markdown: widenMarkdown(message.rich, message.text, true, pad), rtl: owner.language === 'fa' } };
      await deps.tg.send(owner.chat_id, widenHtml(message.text, true, pad), message.buttons, options);
      sent++;
    } catch (error) {
      console.error('reminder not sent', error);
    }
  }
  return sent;
}
