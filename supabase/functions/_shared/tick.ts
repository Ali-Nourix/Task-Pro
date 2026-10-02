// The ticker: once a minute, announces the reminders that have come due.

import { reminderButtons, taskLines, words } from './texts.ts';
import { localNow } from './time.ts';
import type { Store, Telegram } from './types.ts';

/** How long after its time a reminder is still worth sending (the phone may have been off). */
export const GRACE_MS = 10 * 60_000;

export async function runTick(deps: { store: Store; tg: Telegram; now: () => Date }): Promise<number> {
  const owner = await deps.store.getOwner();
  if (!owner) return 0;
  const now = deps.now();
  const due = await deps.store.dueReminders(new Date(now.getTime() - GRACE_MS), now);
  const w = words(owner.language);
  const clock = localNow(owner.timezone, now);
  let sent = 0;
  for (const task of due) {
    // Marked first: a reminder that fails to send is lost rather than sent every minute.
    await deps.store.markReminded(task.key, task.remind_at!);
    const lines = taskLines(task, owner, clock.date, now).join('\n');
    try {
      await deps.tg.send(owner.chat_id, `${w.reminder}\n${lines}`, reminderButtons(task, owner.language));
      sent++;
    } catch (error) {
      console.error('reminder not sent', error);
    }
  }
  return sent;
}
