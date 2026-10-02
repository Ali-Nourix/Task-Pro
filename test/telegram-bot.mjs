/**
 * The Telegram bot's logic (supabase/functions/_shared): reading what is typed
 * into a task, time zones and the Jalali calendar, the bot's commands, the sync
 * with the plugin and the reminder ticker. It runs on an in-memory store and a
 * recording Telegram, so nothing leaves the machine.
 */
import * as esbuild from 'esbuild';
import { fileURLToPath } from 'url';

const build = await esbuild.build({
  stdin: {
    contents: `
      export * from "../supabase/functions/_shared/time.ts";
      export * from "../supabase/functions/_shared/quickadd.ts";
      export { handleUpdate, cleanTitle, numbersIn } from "../supabase/functions/_shared/bot.ts";
      export { handleSync, cleanTask } from "../supabase/functions/_shared/sync.ts";
      export { runTick } from "../supabase/functions/_shared/tick.ts";
      export { MemoryStore } from "../supabase/functions/_shared/memory-store.ts";
      export { jalaliToGregorian as botJalaliToGregorian, gregorianToJalali as botGregorianToJalali } from "../supabase/functions/_shared/jalali.ts";
      export { jalaliToGregorian, gregorianToJalali } from "../src/date-utils";
    `,
    resolveDir: new URL('.', import.meta.url).pathname,
    loader: 'ts',
  },
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
  logLevel: 'error',
});
const mod = await import('data:text/javascript;base64,' + Buffer.from(build.outputFiles[0].text).toString('base64'));

let checked = 0;
function eq(actual, expected, label) {
  checked++;
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${label}:\n  got      ${a}\n  expected ${e}`);
}

const { parseQuickAdd, localToUtc, localNow, utcToLocal, zoneOffsetMinutes, addDays, weekdayOf } = mod;

// ── Jalali: the bot's copy agrees with the plugin's ────────────────────────
let same = true;
for (let at = Date.UTC(1950, 0, 1); at < Date.UTC(2100, 0, 1); at += 86_400_000 * 3) {
  const day = new Date(at);
  const g = [day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate()];
  const a = mod.botGregorianToJalali(...g);
  const b = mod.gregorianToJalali(...g);
  if (a.join() !== b.join() || mod.botJalaliToGregorian(...a).join() !== mod.jalaliToGregorian(...b).join()) same = false;
}
eq(same, true, 'the Jalali conversion is the plugin’s, over a hundred and fifty years');
eq(mod.botJalaliToGregorian(1405, 7, 10), [2026, 10, 2], '10 Mehr 1405 is 2 October 2026');

// ── Time zones ─────────────────────────────────────────────────────────────
eq(zoneOffsetMinutes('Asia/Tehran', new Date('2026-10-02T12:00:00Z')), 210, 'Tehran is three and a half hours ahead');
eq(zoneOffsetMinutes('Europe/Berlin', new Date('2026-07-01T12:00:00Z')), 120, 'summer time counts');
eq(zoneOffsetMinutes('Europe/Berlin', new Date('2026-12-01T12:00:00Z')), 60, 'and winter time');
eq(localNow('Asia/Tehran', new Date('2026-10-02T21:00:00Z')), { date: '2026-10-03', minutes: 30 }, 'a late evening in UTC is the next morning in Tehran');
eq(localToUtc('Asia/Tehran', '2026-10-05', '09:30').toISOString(), '2026-10-05T06:00:00.000Z', 'a local moment as an instant');
eq(utcToLocal('Asia/Tehran', new Date('2026-10-05T06:00:00Z')), { date: '2026-10-05', time: '09:30' }, 'and back');
eq(localToUtc('Europe/Berlin', '2026-03-29', '02:30').toISOString().slice(0, 10), '2026-03-29', 'a time that does not exist in spring still lands that day');
eq([addDays('2026-10-31', 1), addDays('2026-12-31', 1), weekdayOf('2026-10-02')], ['2026-11-01', '2027-01-01', 5], 'days add and weekdays count');

// ── Quick add ──────────────────────────────────────────────────────────────
// Friday 2 October 2026, 15:00.
const now = { today: '2026-10-02', minutes: 15 * 60 };
const parse = (text) => parseQuickAdd(text, now);
eq(parse('Buy bread'), { title: 'Buy bread', tags: [] }, 'plain words are the title');
eq(parse('Buy bread tomorrow 9'), { title: 'Buy bread', tags: [], plan: { date: '2026-10-03', start: '09:00' } }, 'a bare hour straight after a day ending the line is a time');
eq(parse('Buy bread tomorrow 9 apples'), { title: 'Buy bread 9 apples', tags: [], plan: { date: '2026-10-03' } }, 'but not in the middle of the title');
eq(parse('Buy bread tomorrow at 9'), { title: 'Buy bread', tags: [], plan: { date: '2026-10-03', start: '09:00' } }, '“at” makes it one');
eq(parse('Buy bread tomorrow 9:30'), { title: 'Buy bread', tags: [], plan: { date: '2026-10-03', start: '09:30' } }, 'a clock with a colon is a time');
eq(parse('خرید نان فردا ساعت ۹'), { title: 'خرید نان', tags: [], plan: { date: '2026-10-03', start: '09:00' } }, 'Persian words and digits');
eq(parse('خرید نان فردا ساعت ۹ شب').plan, { date: '2026-10-03', start: '21:00' }, '«شب» is the evening');
eq(parse('جلسه امروز ساعت ۵ عصر').plan, { date: '2026-10-02', start: '17:00' }, '«عصر» too');
eq(parse('جلسه فردا ساعت ۱۲ شب').plan.start, '00:00', 'midnight');
eq(parse('جلسه فردا ساعت ۱۲ ظهر').plan.start, '12:00', 'noon');
eq(parse('standup mon 9:30-10').plan, { date: '2026-10-05', start: '09:30', end: '10:00' }, 'a range in one word, on the next Monday');
eq(parse('standup friday at 9').plan.date, '2026-10-09', 'the weekday said on that weekday is next week’s');
eq(parse('جلسه شنبه ساعت ۹ تا ۱۰').plan, { date: '2026-10-03', start: '09:00', end: '10:00' }, 'a range spread over words');
eq(parse('lunch 2pm').plan, { date: '2026-10-03', start: '14:00' }, 'a time that has gone by today is tomorrow’s');
eq(parse('lunch 5pm').plan, { date: '2026-10-02', start: '17:00' }, 'one still to come is today’s');
eq(parse('Pay rent 1405/07/15'), { title: 'Pay rent', tags: [], plan: { date: '2026-10-07' } }, 'a Jalali date');
eq(parse('Pay rent 2026-11-01').plan.date, '2026-11-01', 'a Gregorian date');
eq(parse('Pay rent due 2026-11-01'), { title: 'Pay rent', tags: [], deadline: '2026-11-01' }, '“due” makes it a deadline');
eq(parse('تحویل گزارش مهلت جمعه').deadline, '2026-10-09', '«مهلت»');
eq(parse('تحویل گزارش تا فردا').deadline, '2026-10-03', '«تا» before a day');
eq(parse('تا حالا کارهام رو نوشتم').deadline, undefined, '«تا» before anything else is just a word');
eq(parse('call mom remind tomorrow 18:00').remind, { date: '2026-10-03', time: '18:00' }, 'a reminder after the words');
eq(parse('remind tomorrow call mom'), { title: 'call mom', tags: [], remind: { date: '2026-10-03', time: '09:00' } }, 'a reminder with no time is for nine');
eq(parse('یادآوری فردا ساعت ۸ دارو'), { title: 'دارو', tags: [], remind: { date: '2026-10-03', time: '08:00' } }, '«یادآوری»');
eq(parse('یادم بنداز ۲۰ دقیقه دیگه چایی').remind, { date: '2026-10-02', time: '15:20' }, '«یادم بنداز» and a time from now');
eq(parse('in 2 hours check oven').remind, { date: '2026-10-02', time: '17:00' }, '“in 2 hours”');
eq(parse('call vet in 3 days').plan, { date: '2026-10-05' }, 'days from now');
eq(parse('buy 2 apples'), { title: 'buy 2 apples', tags: [] }, 'a number in the title stays');
eq(parse('Write report #work #deep-work !high'), { title: 'Write report', tags: ['work', 'deep-work'], priority: 'high' }, 'tags and priority');
eq(parse('کار فوری !فوری #کار').priority, 'highest', 'a Persian priority');
eq(parse('submit report friday 17:00 due friday remind friday 16:00'), {
  title: 'submit report',
  tags: [],
  plan: { date: '2026-10-09', start: '17:00' },
  deadline: '2026-10-09',
  remind: { date: '2026-10-09', time: '16:00' },
}, 'a plan, a deadline and a reminder in one line');
eq(parse('tomorrow').title, '', 'nothing left over: no title');
eq(parse('کتاب شنبه‌ی بعد'), { title: 'کتاب شنبه‌ی بعد', tags: [] }, 'an unusual form is left in the title rather than guessed');

// ── The bot ────────────────────────────────────────────────────────────────
const { handleUpdate, handleSync, cleanTask, cleanTitle, numbersIn, runTick, MemoryStore } = mod;

/** A bot on an in-memory store and a Telegram that writes down what it is asked to send. */
function world(at = '2026-10-02T12:00:00Z') {
  const store = new MemoryStore();
  const sent = [];
  const cleared = [];
  const state = { now: new Date(at) };
  const tg = {
    send: async (chat, text, buttons) => void sent.push({ chat, text, buttons }),
    answer: async () => {},
    clearButtons: async (chat, id) => void cleared.push(id),
  };
  const deps = { store, tg, pairingCode: 'sesame', now: () => state.now };
  let id = 100;
  return {
    store, sent, cleared, state, deps,
    say: (text, chat = 7) => handleUpdate({ message: { chat: { id: chat, type: 'private' }, text, message_id: id++ } }, deps),
    press: (data, chat = 7) => handleUpdate({ callback_query: { id: 'cb', data, message: { chat: { id: chat }, message_id: id++ } } }, deps),
    last: () => sent[sent.length - 1],
    sync: (body) => handleSync(body, { store, tg, now: () => state.now }),
  };
}
async function paired() {
  const w = world();
  await w.say('/start sesame');
  w.sent.length = 0;
  return w;
}

{
  const w = world();
  await w.say('buy bread');
  eq(w.last().text.includes('/start'), true, 'before pairing, only /start is answered');
  await w.say('/start wrong');
  eq([w.last().text, w.store.owner], ['کد درست نیست.', null], 'a wrong code pairs nothing, and is told so');
  await w.say('/start sesame');
  eq(w.store.owner.chat_id, 7, 'the right code pairs the chat');
  eq([w.store.owner.language, w.store.owner.timezone, w.store.owner.calendar], ['fa', 'Asia/Tehran', 'jalali'], 'in Persian, Tehran time and the Jalali calendar to begin with');
  w.sent.length = 0;
  await w.say('hello', 99);
  await w.say('/list', 99);
  eq(w.sent.length, 0, 'another chat gets no answer at all');
  await w.say('/start sesame', 99);
  eq(w.store.owner.chat_id, 7, 'and cannot take the bot over');
}

{
  // 12:00Z is 15:30 in Tehran: Friday 2 October.
  const w = await paired();
  await w.say('Buy bread tomorrow at 9 #home !high');
  const task = w.store.tasks[0];
  eq([task.n, task.title, task.priority, task.tags, task.plan_date, task.plan_start, task.pending, task.origin], [1, 'Buy bread', 'high', ['home'], '2026-10-03', '09:00', true, 'telegram'], 'a message is a pending task');
  eq(task.remind_at, '2026-10-03T05:20:00.000Z', 'reminding ten minutes before 09:00 Tehran time');
  eq(w.store.commands.map((c) => [c.kind, c.payload.title, c.payload.plan]), [['add', 'Buy bread', { date: '2026-10-03', start: '09:00' }]], 'and an add waits for the plugin');
  eq(w.last().text.includes('#۱'), true, 'the reply numbers it, in Persian digits');
  eq(w.last().buttons[0].map((b) => b.data), ['done:1', 'undo:1'], 'with done and undo buttons');

  await w.say('remind in 30 minutes call mom');
  eq(w.store.tasks[1].remind_at, '2026-10-02T12:30:00.000Z', 'a reminder from now');
  await w.say('یادآوری 2026-09-01 ساعت ۸ قدیمی');
  eq(w.last().text.includes('گذشته'), true, 'a reminder in the past is refused with a word');
  eq(w.store.tasks[2].remind_at, null, 'and not stored');
  await w.say('tomorrow');
  eq(w.store.tasks.length, 3, 'a message with no title adds nothing');
  eq(cleanTitle('x @priority(high) @due(2026-01-01) ^abc'), 'x priority(high) due(2026-01-01)', 'a title cannot carry markers or a block ID into a note');
  eq(numbersIn('#12 ۱۳ و 14'), [12, 13, 14], 'numbers in any digits');
}

{
  const w = await paired();
  await w.sync({ snapshot: [
    { key: 'Work.md|^a|0', title: 'Late', status: 'open', deadline: '2026-10-01', tags: [] },
    { key: 'Work.md|^b|0', title: 'Today', status: 'open', plan_date: '2026-10-02', plan_start: '17:00', tags: ['work'] },
    { key: 'Work.md|^c|0', title: 'Later', status: 'open', plan_date: '2026-10-09', tags: [] },
    { key: 'Work.md|^d|0', title: 'Bad', status: 'q' },
  ] });
  eq(w.store.tasks.map((t) => t.title), ['Late', 'Today', 'Later'], 'an upload is stored, a malformed task dropped');
  await w.say('/today');
  const today = w.last().text;
  eq([today.includes('Late'), today.includes('Today'), today.includes('Later')], [true, true, false], '/today lists what is late and what is today');
  eq(today.indexOf('عقب‌افتاده') < today.indexOf('Late'), true, 'under their own headings');
  eq(w.last().buttons[0].map((b) => b.data), ['done:1', 'done:2'], 'each with a done button');
  await w.say('/list');
  eq(w.last().text.includes('Later'), true, '/list lists them all');

  await w.say('/done 2');
  eq([w.store.tasks[1].status, w.store.commands.at(-1).kind, w.store.commands.at(-1).payload], ['done', 'status', { key: 'Work.md|^b|0', status: 'done' }], '/done closes it and queues the change');
  await w.say('/done 99');
  eq(w.last().text.includes('پیدا نشد'), true, 'an unknown number is said so');
  await w.press('done:3');
  eq([w.store.tasks[2].status, w.cleared.length], ['done', 1], 'a button does the same and takes itself off the message');

  await w.say('/remind 1 tomorrow 8');
  eq([w.store.tasks[0].remind_at, w.store.commands.at(-1).payload.moment], ['2026-10-03T04:30:00.000Z', { date: '2026-10-03', time: '08:00' }], '/remind sets a moment');
  await w.say('/remind 1 off');
  eq([w.store.tasks[0].remind_at, w.store.commands.at(-1).payload.moment], [null, 'off'], 'or none');
  await w.say('/remind 1 blah');
  eq(w.last().text.includes('متوجه زمان نشدم'), true, 'a time it cannot read is said so');
  await w.say('/plan 1 sat 9-10');
  eq([w.store.tasks[0].plan_date, w.store.tasks[0].plan_start, w.store.tasks[0].plan_end], ['2026-10-03', '09:00', '10:00'], '/plan sets a plan');
  await w.say('/plan 1 off');
  eq([w.store.tasks[0].plan_date, w.store.commands.at(-1).payload.plan], [null, null], 'or takes it off');

  await w.say('/del 1');
  eq(w.last().buttons[0].map((b) => b.data), ['delok:1', 'noop'], '/del asks first');
  eq(w.store.tasks.some((t) => t.title === 'Late'), true, 'and deletes nothing yet');
  await w.press('delok:1');
  eq([w.store.tasks.some((t) => t.title === 'Late'), w.store.commands.at(-1)], [false, { ...w.store.commands.at(-1), kind: 'delete', payload: { key: 'Work.md|^a|0' } }], 'confirmed, it goes and a delete is queued');

  await w.say('/lang en');
  await w.say('/help');
  eq(w.last().text.startsWith('📝 New task'), true, 'the language can be switched');
  await w.say('/tz Mars/Base');
  eq(w.last().text.includes('Asia/Tehran'), true, 'a time zone that does not exist is refused');
  await w.say('/tz Europe/Berlin');
  eq(w.store.owner.timezone, 'Europe/Berlin', 'one that does is kept');
}

// ── Sync ───────────────────────────────────────────────────────────────────
{
  const w = await paired();
  await w.say('Call the vet tomorrow at 10');
  const pending = w.store.tasks[0];
  const first = await w.sync({ snapshot: [{ key: 'Inbox.md|Other|0', title: 'Other', status: 'open' }] });
  eq(first.commands.map((c) => c.kind), ['add'], 'the plugin is handed the add');
  eq(w.store.tasks.map((t) => t.key).sort(), ['Inbox.md|Other|0', pending.key].sort(), 'a task not yet in a note survives the upload');
  eq(first.owner.timezone, 'Asia/Tehran', 'and is told the owner’s settings');
  eq(w.store.owner.last_sync_at !== null, true, 'the time of the sync is noted');

  await w.say('/done 1');
  await w.sync({
    snapshot: [{ key: 'Inbox.md|Other|0', title: 'Other', status: 'open' }, { key: 'Inbox.md|Call the vet|0', title: 'Call the vet', status: 'open' }],
    acks: [{ id: first.commands[0].id, key: 'Inbox.md|Call the vet|0' }],
  });
  const moved = w.store.tasks.find((t) => t.n === pending.n);
  eq([moved.key, moved.pending], ['Inbox.md|Call the vet|0', false], 'the task takes its note’s key and keeps its number');
  const queued = await w.store.pendingCommands();
  eq(queued.map((c) => [c.kind, c.payload.key]), [['status', 'Inbox.md|Call the vet|0']], 'and a change queued for it follows the new key');

  await w.sync({ snapshot: [
    { key: 'Inbox.md|Other|0', title: 'Other', status: 'open' },
    { key: 'Inbox.md|Call the vet|0', title: 'Call the vet', status: 'open', plan_date: '2026-10-03', plan_start: '10:00' },
  ] });
  eq(w.store.tasks.find((t) => t.n === pending.n).status, 'done', 'while a change is waiting, an upload does not undo it');
  const status = (await w.store.pendingCommands())[0];
  await w.sync({ acks: [{ id: status.id }], snapshot: [{ key: 'Inbox.md|Other|0', title: 'Other', status: 'open' }] });
  eq(w.store.tasks.map((t) => t.title), ['Other'], 'once applied, a task that is not open is gone from the upload and from the list');

  await w.say('call dentist');
  const add = (await w.store.pendingCommands())[0];
  w.sent.length = 0;
  await w.sync({ acks: [{ id: add.id, error: 'the note is read-only' }] });
  eq(w.last().text.includes('the note is read-only'), true, 'a change the plugin could not make is told to the owner');
  await w.say('/status');
  eq(w.last().text.includes('منتظر'), true, '/status reports the sync');
  eq(cleanTask({ key: 'k', title: 't', status: 'done', plan_date: '2026-02-31', tags: [3, 'a'], priority: 'urgent' }), { key: 'k', title: 't', status: 'done', priority: null, deadline: null, plan_date: null, plan_start: null, plan_end: null, remind_at: null, tags: ['a'], note_path: null }, 'an upload is cleaned field by field');
}

// ── Reminders ──────────────────────────────────────────────────────────────
{
  const w = await paired();
  await w.sync({ snapshot: [
    { key: 'A.md|^a|0', title: 'Soon', status: 'open', remind_at: '2026-10-02T12:05:00Z' },
    { key: 'A.md|^b|0', title: 'Later', status: 'open', remind_at: '2026-10-02T14:00:00Z' },
    { key: 'A.md|^c|0', title: 'Old', status: 'open', remind_at: '2026-10-02T11:30:00Z' },
    { key: 'A.md|^d|0', title: 'Closed', status: 'done', remind_at: '2026-10-02T12:05:00Z' },
  ] });
  const tick = () => runTick({ store: w.store, tg: w.deps.tg, now: () => w.state.now });
  eq(await tick(), 0, 'nothing before its time');
  w.state.now = new Date('2026-10-02T12:06:00Z');
  eq(await tick(), 1, 'a reminder is sent when its time comes');
  eq(w.last().text.includes('Soon'), true, 'naming the task');
  eq(w.last().buttons.flat().map((b) => b.data), ['done:1', 'snz:1:10', 'snz:1:60', 'snz:1:tom'], 'with done and snooze buttons');
  eq(await tick(), 0, 'once');
  w.state.now = new Date('2026-10-02T12:08:00Z');
  eq(await tick(), 0, 'not again a minute later');
  await w.press('snz:1:10');
  eq(w.store.tasks[0].remind_at, '2026-10-02T12:18:00.000Z', 'snoozed ten minutes');
  eq(w.store.commands.at(-1).payload.moment, { date: '2026-10-02', time: '15:48' }, 'and the note is told the moment, in the owner’s time');
  w.state.now = new Date('2026-10-02T12:19:00Z');
  eq(await tick(), 1, 'the snoozed reminder comes again');
  await w.press('snz:1:tom');
  eq(w.store.tasks[0].remind_at, '2026-10-03T05:30:00.000Z', 'or tomorrow at nine');
  await w.sync({ snapshot: [{ key: 'A.md|^a|0', title: 'Soon', status: 'open', remind_at: '2026-10-02T12:05:00Z' }] });
  eq(w.store.tasks[0].remind_at, '2026-10-03T05:30:00.000Z', 'an upload made before the plugin applied it does not undo the snooze');
  w.state.now = new Date('2026-10-03T05:36:00Z');
  eq(await tick(), 1, 'a reminder six minutes late is still sent (the phone may have been off)');
  await w.sync({ snapshot: [{ key: 'A.md|^a|0', title: 'Soon', status: 'open', remind_at: '2026-10-03T05:30:00Z' }, { key: 'A.md|^e|0', title: 'Missed', status: 'open', remind_at: '2026-10-03T05:00:00Z' }] });
  eq(await tick(), 0, 'one forty minutes late is let go');
}

console.log(`TELEGRAM_BOT_OK (${checked} checks)`);
