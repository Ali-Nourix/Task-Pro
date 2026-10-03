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
      export { handleUpdate, cleanTitle, numbersIn, parseRepeat, parseTags } from "../supabase/functions/_shared/bot.ts";
      export { handleSync, cleanTask } from "../supabase/functions/_shared/sync.ts";
      export { runTick } from "../supabase/functions/_shared/tick.ts";
      export { MemoryStore } from "../supabase/functions/_shared/memory-store.ts";
      export { jalaliToGregorian as botJalaliToGregorian, gregorianToJalali as botGregorianToJalali } from "../supabase/functions/_shared/jalali.ts";
      export { jalaliToGregorian, gregorianToJalali } from "../src/date-utils";
      export { TASK_SETTINGS_SQL } from "../supabase/functions/_shared/schema-sql.ts";
      export { buildMonth, daysIn, monthKeyOf, dayOf } from "../supabase/functions/_shared/calendar-picker.ts";
      export { htmlToRich, mdEscape } from "../supabase/functions/_shared/rich.ts";
      export { telegramApi } from "../supabase/functions/_shared/telegram-api.ts";
      export { widenHtml, widenMarkdown, padOf, PADS } from "../supabase/functions/_shared/widen.ts";
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
eq(parse('Buy bread tomorrow 9 #home !high'), { title: 'Buy bread', tags: ['home'], priority: 'high', plan: { date: '2026-10-03', start: '09:00' } }, 'a tag or a priority after the hour ends the phrase too');
eq(parse('تحویل فردا ساعت ۹ !زیاد').priority, 'high', 'the plugin’s own Persian name for high is read as well');
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
  const edits = [];
  const toasts = [];
  const commands = [];
  const state = { now: new Date(at) };
  const tg = {
    send: async (chat, text, buttons, options) => void sent.push({ chat, text, buttons, options }),
    edit: async (chat, id, text, buttons, rich) => void edits.push({ chat, id, text, buttons, rich }),
    answer: async (_id, text) => void toasts.push(text),
    setCommands: async (chat, list) => void commands.push(list.map((c) => c.command)),
  };
  const deps = { store, tg, pairingCode: 'sesame', now: () => state.now };
  let id = 100;
  return {
    store, sent, edits, toasts, commands, state, deps,
    say: (text, chat = 7) => handleUpdate({ message: { chat: { id: chat, type: 'private' }, text, message_id: id++ } }, deps),
    reply: (text, to, chat = 7) => handleUpdate({ message: { chat: { id: chat, type: 'private' }, text, message_id: id++, reply_to_message: { text: to } } }, deps),
    press: (data, chat = 7) => handleUpdate({ callback_query: { id: 'cb', data, message: { chat: { id: chat }, message_id: 555 } } }, deps),
    last: () => sent[sent.length - 1],
    lastEdit: () => edits[edits.length - 1],
    data: (view) => (view?.buttons ?? []).flat().map((b) => b.data),
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
  eq([w.last().text, w.store.owner], ['🚫 کد درست نیست.', null], 'a wrong code pairs nothing, and is told so');
  await w.say('/start sesame');
  eq(w.store.owner.chat_id, 7, 'the right code pairs the chat');
  eq([w.store.owner.language, w.store.owner.timezone, w.store.owner.calendar], ['fa', 'Asia/Tehran', 'jalali'], 'in Persian, Tehran time and the Jalali calendar to begin with');
  eq(w.sent.slice(-2).map((m) => m.text.startsWith('👋 <b>') ? 'greeting' : m.text.startsWith('✨ <b>') ? 'menu' : '?'), ['greeting', 'menu'], 'it greets, then shows the main menu');
  eq(w.commands[0], ['start', 'today', 'list', 'status', 'settings', 'help'], 'and puts its commands in the chat’s menu');
  eq(w.data(w.last()), ['ls:t:0', 'ls:a:0', 'new', 'st', 'set', 'help'], 'the menu: today, all, new, status, settings, help');
  eq(w.last().buttons[0][0].style, 'primary', 'the first button is blue');
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
  const card = w.last().text;
  eq([card.includes('#۱'), card.includes('<blockquote>'), card.includes('فردا ۰۹:۰۰'.replace('۰۹', '۰۹')), card.includes('ثبت شد')], [true, true, true, true], 'the reply is a card: numbered in Persian digits, the plan in a quote');
  eq(w.data(w.last()), ['done:1', 'undo:1', 'ed:1', 'sm:1', 'pm:1', 'dm:1', 'pl:1', 'rm:1', 'tm:1', 'qm:1', 'home'], 'with done, undo, a button for every setting and the menu');
  eq(w.last().buttons.flat().filter((b) => b.style).map((b) => [b.data, b.style]), [['done:1', 'success'], ['undo:1', 'danger']], 'done is green and undo red');

  await w.say('remind in 30 minutes call mom');
  eq(w.store.tasks[1].remind_at, '2026-10-02T12:30:00.000Z', 'a reminder from now');
  await w.say('یادآوری 2026-09-01 ساعت ۸ قدیمی');
  eq(w.last().text.includes('گذشته'), true, 'a reminder in the past is refused with a word');
  eq(w.store.tasks[2].remind_at, null, 'and not stored');
  await w.say('tomorrow');
  eq(w.store.tasks.length, 3, 'a message with no title adds nothing');
  eq(cleanTitle('x @priority(high) @due(2026-01-01) ^abc'), 'x priority(high) due(2026-01-01)', 'a title cannot carry markers or a block ID into a note');
  eq(numbersIn('#12 ۱۳ و 14'), [12, 13, 14], 'numbers in any digits');

  await w.say('Fix <b>bold</b> & more');
  eq(w.last().text.includes('Fix &lt;b&gt;bold&lt;/b&gt; &amp; more'), true, 'what is typed is escaped, so it cannot break the message');
  await w.press('undo:4');
  eq([w.store.tasks.some((t) => t.n === 4), w.lastEdit().text.includes('حذف شد'), w.store.commands.at(-1).kind], [false, true, 'add'], 'undo takes the task back before it was ever written, and says so in place');
  eq((await w.store.pendingCommands()).some((c) => c.payload.title?.startsWith('Fix')), false, 'its add is cancelled rather than a delete queued');
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
  eq(today.indexOf('عقب‌افتاده') < today.indexOf('Late') && today.indexOf('Late') < today.lastIndexOf('📅 امروز'), true, 'in sections of their own, the late first');
  eq(w.data(w.last()), ['t:1@t0', 't:2@t0', 'ls:a:0', 'ls:t:0', 'ls:o:0', 'home', 'ls:t:0', 'ls:a:0', 'new', 'set'], 'each task opens by a button; the filters show only what has tasks, then the tab bar');
  eq(w.last().buttons.flat().find((b) => b.data === 'ls:t:0').style, 'primary', 'the filter in use is blue');
  await w.say('/list');
  eq(w.last().text.includes('Later') && w.last().text.includes('🗓 بعداً'), true, '/list lists them all, the far ones under “later”');

  // A button edits the message it is on.
  await w.press('t:2@t0');
  eq([w.edits.length, w.lastEdit().id], [1, 555], 'opening a task edits the list message in place');
  eq(w.lastEdit().text.includes('Today') && w.lastEdit().text.includes('<blockquote>'), true, 'into the task’s card');
  eq(w.data(w.lastEdit()), ['done:2@t0', 'del:2@t0', 'ed:2', 'sm:2@t0', 'pm:2@t0', 'dm:2@t0', 'pl:2@t0', 'rm:2@t0', 'tm:2@t0', 'qm:2@t0', 'ls:t:0'], 'whose buttons remember the list they came from');
  await w.press('done:2@t0');
  eq([w.store.tasks[1].status, w.store.commands.at(-1).kind, w.store.commands.at(-1).payload], ['done', 'status', { key: 'Work.md|^b|0', status: 'done' }], 'done closes it and queues the change');
  eq([w.toasts.at(-1), w.lastEdit().text.includes('Today'), w.lastEdit().text.includes('Late')], ['✅ انجام شد', false, true], 'then the list is back, without it, and a note over the chat says so');
  await w.say('/done 99');
  eq(w.last().text.includes('پیدا نشد'), true, 'an unknown number is said so');
  await w.press('done:3');
  eq([w.store.tasks[2].status, w.lastEdit().text.includes('<s>Later</s>')], ['done', true], 'a done button on a lone message turns it into a note that it is done');
  await w.say('/done 1');
  eq(w.last().text, '✅ انجام شد: Late', '/done answers in a line');
  await w.sync({ snapshot: [{ key: 'Work.md|^a|0', title: 'Late', status: 'open', deadline: '2026-10-01', tags: [] }] });
  await w.say('/list');
  eq(w.last().text.includes('Late'), false, 'a task whose done is still waiting stays out of the list even though the notes’ upload still has it open');
}

{
  const w = await paired();
  await w.sync({ snapshot: [
    { key: 'Work.md|^a|0', title: 'Late', status: 'open', deadline: '2026-10-01', tags: [] },
    { key: 'Work.md|^b|0', title: 'Plain', status: 'open', tags: [] },
  ] });

  await w.press('rm:1');
  eq(w.data(w.lastEdit()), ['rs:1:10', 'rs:1:60', 'rs:1:180', 'rs:1:eve', 'rs:1:tom', 'cn:r:1:1405-7', 'rc:1', 't:1'], 'the reminder menu offers moments, the calendar, a free choice and a way back');
  await w.press('rs:1:60');
  eq([w.store.tasks[0].remind_at, w.store.commands.at(-1).payload.moment], ['2026-10-02T13:00:00.000Z', { date: '2026-10-02', time: '16:30' }], 'a preset reminder an hour from now');
  eq(w.lastEdit().text.includes('یادآوری تنظیم شد') && w.lastEdit().text.includes('🔔'), true, 'shown on the card');
  await w.press('rm:1');
  eq(w.data(w.lastEdit()).includes('rs:1:off'), true, 'with a way to remove it once there is one');
  await w.press('rs:1:eve');
  eq(w.store.tasks[0].remind_at, '2026-10-02T16:30:00.000Z', 'tonight is twenty o’clock Tehran time');
  w.state.now = new Date('2026-10-02T17:00:00Z');
  await w.press('rs:1:eve');
  eq(w.store.tasks[0].remind_at, '2026-10-03T16:30:00.000Z', 'and tomorrow night once it is past');
  w.state.now = new Date('2026-10-02T12:00:00Z');
  await w.press('rs:1:off');
  eq([w.store.tasks[0].remind_at, w.store.commands.at(-1).payload.moment], [null, 'off'], 'or none');

  await w.press('rc:1');
  eq([w.last().options.forceReply !== undefined, w.last().text.startsWith('🔔'), w.last().text.includes('#۱')], [true, true, true], '“pick a time” asks, with the field ready for the answer');
  await w.reply('tomorrow 8', w.last().text);
  eq(w.store.tasks[0].remind_at, '2026-10-03T04:30:00.000Z', 'the answer is the reminder, found by the number in the question');
  await w.reply('blah', '🔔 یادآوری برای #۱\n«Late»');
  eq(w.last().text.includes('متوجه زمان نشدم'), true, 'an answer it cannot read is said so');

  await w.press('pl:2');
  eq(w.data(w.lastEdit()), ['ps:2:0', 'ps:2:1', 'ps:2:2', 'ps:2:7', 'cn:p:2:1405-7', 'pc:2', 't:2'], 'the plan menu offers days and the calendar');
  await w.press('ps:2:1');
  eq([w.store.tasks[1].plan_date, w.store.tasks[1].plan_start, w.store.commands.at(-1).payload.plan], ['2026-10-03', null, { date: '2026-10-03' }], 'a day for a task with no hours');
  await w.say('/plan 2 sat 9-10');
  eq([w.store.tasks[1].plan_date, w.store.tasks[1].plan_start, w.store.tasks[1].plan_end], ['2026-10-03', '09:00', '10:00'], '/plan sets a plan');
  await w.press('ps:2:2');
  eq([w.store.tasks[1].plan_date, w.store.tasks[1].plan_start, w.store.tasks[1].plan_end], ['2026-10-04', '09:00', '10:00'], 'moving the day keeps the hours');
  await w.press('pc:2');
  await w.reply('sat 14-15', w.last().text);
  eq([w.store.tasks[1].plan_date, w.store.tasks[1].plan_start], ['2026-10-03', '14:00'], 'a typed answer sets the plan');
  await w.press('ps:2:off');
  eq([w.store.tasks[1].plan_date, w.store.commands.at(-1).payload.plan], [null, null], 'or takes it off');

  await w.say('/remind 1 tomorrow 8');
  eq([w.store.tasks[0].remind_at, w.store.commands.at(-1).payload.moment], ['2026-10-03T04:30:00.000Z', { date: '2026-10-03', time: '08:00' }], '/remind sets a moment');
  await w.say('/remind 1 off');
  eq([w.store.tasks[0].remind_at, w.store.commands.at(-1).payload.moment], [null, 'off'], 'or none');
  await w.say('/remind 1 blah');
  eq(w.last().text.includes('متوجه زمان نشدم'), true, 'a time it cannot read is said so');
  await w.say('/plan 1 off');

  await w.say('/del 1');
  eq(w.data(w.last()), ['delok:1', 't:1'], '/del asks first');
  eq(w.store.tasks.some((t) => t.title === 'Late'), true, 'and deletes nothing yet');
  await w.press('t:1');
  await w.press('del:1@a0');
  eq(w.data(w.lastEdit()), ['delok:1@a0', 't:1@a0'], 'a card’s delete asks first too');
  await w.press('delok:1@a0');
  eq([w.store.tasks.some((t) => t.title === 'Late'), w.store.commands.at(-1).kind, w.store.commands.at(-1).payload], [false, 'delete', { key: 'Work.md|^a|0' }], 'confirmed, it goes and a delete is queued');
  eq(w.lastEdit().text.includes('Plain') && !w.lastEdit().text.includes('Late'), true, 'and the list comes back');

  // Settings, in place.
  await w.say('/settings');
  eq(w.data(w.last()), ['set:lang', 'set:cal', 'set:lead', 'set:tz', 'set:rich', 'set:pad', 'home', 'ls:t:0', 'ls:a:0', 'new', 'set'], 'settings, with the tab bar');
  await w.press('set:cal');
  eq([w.store.owner.calendar, w.lastEdit().text.includes('میلادی')], ['gregorian', true], 'the calendar flips');
  await w.press('set:lead');
  eq(w.store.owner.lead_minutes, 15, 'the lead time steps through its choices');
  await w.press('set:tz');
  eq(w.toasts.at(-1).includes('/tz'), true, 'the time zone points at its command');
  await w.press('set:lang');
  eq([w.store.owner.language, w.lastEdit().text.startsWith('⚙️ <b>Settings</b>'), w.commands.at(-1)[0]], ['en', true, 'start'], 'the language flips and the page is redrawn in it');
  await w.say('/help');
  eq(w.last().text.startsWith('📖 <b>Help</b>'), true, 'in English from then on');
  await w.say('/tz Mars/Base');
  eq(w.last().text.includes('Asia/Tehran'), true, 'a time zone that does not exist is refused');
  await w.say('/tz Europe/Berlin');
  eq(w.store.owner.timezone, 'Europe/Berlin', 'one that does is kept');
}

// ── Lists of many tasks ────────────────────────────────────────────────────
{
  const w = await paired();
  const snapshot = [];
  for (let i = 1; i <= 19; i++) snapshot.push({ key: `N.md|^${i}|0`, title: i === 3 ? 'A very long title that goes on and on and on' : `Task ${i}`, status: 'open', plan_date: i <= 4 ? '2026-10-05' : undefined, tags: [] });
  await w.sync({ snapshot });
  await w.say('/list');
  const first = w.last();
  eq(first.buttons.slice(0, 4).map((row) => row.length), [2, 2, 2, 2], 'a page holds eight tasks, two buttons to a row');
  eq(first.buttons[1][0].text.endsWith('…'), true, 'a long title is cut on its button');
  eq(w.data(first).filter((d) => d.startsWith('t:')).length, 8, 'eight task buttons');
  eq(w.data(first).filter((d) => d.startsWith('ls:')), ['ls:a:1', 'ls:a:0', 'ls:u:0', 'ls:t:0', 'ls:a:0'], 'a way to the next page, the filters that have tasks, then the tab bar’s today and all');
  eq(first.buttons[4].map((b) => b.text), ['·', '۱ از ۳', '›'], 'the page number sits between the arrows');
  eq(first.text.includes('<b>۱.</b>') && !first.text.includes('<b>۹.</b>'), true, 'the text holds the same eight');
  await w.press('ls:a:1');
  eq([w.lastEdit().id, w.lastEdit().text.includes('<b>۹.</b>'), w.lastEdit().buttons[4].map((b) => b.text)], [555, true, ['‹', '۲ از ۳', '›']], 'the next page replaces the list in place');
  await w.press('ls:a:9');
  eq(w.lastEdit().buttons.find((row) => row[0].text === '‹' || row[0].text === '·')[1].text, '۳ از ۳', 'a page past the end is the last');
  await w.press('t:19@a2');
  eq(w.data(w.lastEdit()).at(-1), 'ls:a:2', 'a card’s back button returns to the page it came from');
  eq(Math.max(...w.edits.concat(w.sent).map((m) => m.text.length)) < 4096, true, 'no message is near Telegram’s limit');
}

// ── The menu ───────────────────────────────────────────────────────────────
{
  const w = await paired();
  await w.sync({ snapshot: [
    { key: 'A.md|^a|0', title: 'Late', status: 'open', deadline: '2026-10-01', tags: [] },
    { key: 'A.md|^b|0', title: 'Now', status: 'open', plan_date: '2026-10-02', tags: [] },
  ] });
  await w.say('/start');
  const home = w.last();
  eq([home.text.includes('۱ عقب‌افتاده'), home.text.includes('۲ تسک باز'), home.text.includes('🟢')], [true, true, true], 'the menu counts what is late, due today and open, and shows the sync');
  eq(w.data(home), ['ls:t:0', 'ls:a:0', 'new', 'ls:o:0', 'st', 'set', 'help'], 'with a button for what is overdue when something is');
  eq(home.buttons.flat().find((b) => b.data === 'ls:o:0').style, 'danger', 'in red');
  await w.press('st');
  eq(w.lastEdit().text.includes('📊'), true, 'the status page opens in place');
  w.state.now = new Date('2026-10-02T14:00:00Z');
  await w.press('st');
  eq(w.lastEdit().text.includes('🟡'), true, 'and says when Obsidian has been closed for a while');
  await w.press('new');
  eq(w.lastEdit().text.includes('تسک جدید') && w.data(w.lastEdit()).join() === 'cn:x:0:1405-7,home,ls:t:0,ls:a:0,new,set', true, '“new task” explains, offers a day from the calendar and the menu');
  await w.press('home');
  eq(w.lastEdit().text.startsWith('✨'), true, 'the menu button goes home');
  await w.press('help');
  eq(w.lastEdit().text.includes('blockquote expandable'), true, 'help folds its list of commands away');
  await w.say('وضعیت');
  eq(w.last().text.includes('📊'), true, 'a bare Persian word is a command');
  await w.press('t:77');
  eq(w.toasts.at(-1).includes('پیدا نشد'), true, 'a button for a task that is gone says so over the chat');
}


// The statements the functions run to update the database are the migrations'.
{
  const fs = await import('fs');
  const read = (name) => fs.readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');
  const code = (text) => text.split('\n').filter((line) => !line.startsWith('--')).join(' ').replace(/\s+/g, ' ').trim();
  eq(code(mod.TASK_SETTINGS_SQL), code(read('20261003000000_task_settings.sql') + '\n' + read('20261004000000_subtasks.sql') + '\n' + read('20261005000000_rich_messages.sql') + '\n' + read('20261006000000_message_width.sql')), 'the update the functions run is the migration files, in order');
}

// ── Every setting of a task ────────────────────────────────────────────────
{
  eq([mod.parseRepeat('هر ۳ روز'), mod.parseRepeat('every 2 weeks'), mod.parseRepeat('ماهانه'), mod.parseRepeat('weekly'), mod.parseRepeat('2w'), mod.parseRepeat('هر هفته'), mod.parseRepeat('off'), mod.parseRepeat('بدون تکرار'), mod.parseRepeat('blah blah')], ['3d', '2w', '1m', '1w', '2w', '1w', null, null, undefined], 'a repeat read from words, digits and names');
  eq(mod.parseTags('#کار  خانه, Home  #کار'), ['کار', 'خانه', 'home'], 'tags from what is typed: split, lowered, no repeats');

  const w = await paired();
  await w.sync({ snapshot: [{ key: 'Work.md|^a|0', title: 'Report', status: 'open', deadline: '2026-10-09', tags: ['work'], repeat: '1w', priority: 'high' }] });

  await w.press('t:1@a0');
  eq(w.lastEdit().text.includes('🔁') && w.lastEdit().text.includes('هر هفته'), true, 'the card says the task repeats');
  await w.press('cfg:1@a0');
  eq(w.data(w.lastEdit()), ['done:1@a0', 'del:1@a0', 'ed:1', 'sm:1@a0', 'pm:1@a0', 'dm:1@a0', 'pl:1@a0', 'rm:1@a0', 'tm:1@a0', 'qm:1@a0', 'ls:a:0'], 'a task’s screen holds a button for every setting, in one tap from the list');
  const labels = w.lastEdit().buttons.flat().map((b) => b.text);
  eq([labels[4].includes('بالا'), labels[5].includes('جمعه'), labels[9].includes('هر هفته'), labels[8].includes('۱')], [true, true, true, true], 'each button shows what the setting is now');

  // Priority
  await w.press('pm:1@a0');
  eq(w.data(w.lastEdit()), ['pr:1:highest@a0', 'pr:1:high@a0', 'pr:1:medium@a0', 'pr:1:low@a0', 'pr:1:lowest@a0', 'pr:1:off@a0', 't:1@a0'], 'five levels, none, and a way back');
  await w.press('pr:1:highest@a0');
  eq([w.store.tasks[0].priority, w.store.commands.at(-1).kind, w.store.commands.at(-1).payload], ['highest', 'edit', { key: 'Work.md|^a|0', priority: 'highest' }], 'a priority is kept and queued as an edit');
  eq(w.data(w.lastEdit())[0], 'done:1@a0', 'and the task’s screen is back');
  await w.press('pr:1:off@a0');
  eq([w.store.tasks[0].priority, w.store.commands.at(-1).payload.priority], [null, null], 'or taken off');

  // Deadline
  await w.press('ds:1:1@a0');
  eq([w.store.tasks[0].deadline, w.store.commands.at(-1).payload.deadline], ['2026-10-03', '2026-10-03'], 'a deadline of tomorrow');
  await w.press('dc:1');
  eq([w.last().text.startsWith('⏳'), w.last().text.includes('#۱')], [true, true], 'a free deadline is asked for');
  await w.reply('جمعه', w.last().text);
  eq(w.store.tasks[0].deadline, '2026-10-09', 'and read from the answer');
  await w.reply('blah', '⏳ مهلت برای #۱\n«Report»');
  eq(w.last().text.includes('متوجه تاریخ نشدم'), true, 'an unreadable date is said so');
  await w.press('ds:1:off@a0');
  eq(w.store.tasks[0].deadline, null, 'a deadline taken off');

  // Tags
  await w.press('tm:1@a0');
  eq(w.data(w.lastEdit()), ['tr:1:0@a0', 'ta:1', 't:1@a0'], 'a button for each tag to remove it, one to add');
  await w.press('ta:1');
  await w.reply('home #deep', w.last().text);
  eq([w.store.tasks[0].tags, w.store.commands.at(-1).payload.tags], [['work', 'home', 'deep'], ['work', 'home', 'deep']], 'tags are added to the ones it has');
  await w.press('tr:1:1@a0');
  eq(w.store.tasks[0].tags, ['work', 'deep'], 'one is taken off by its button');
  await w.press('tx:1@a0');
  eq(w.store.tasks[0].tags, [], 'or all of them');

  // Repeat
  await w.press('qm:1@a0');
  eq(w.data(w.lastEdit()), ['qs:1:1d@a0', 'qs:1:1w@a0', 'qs:1:2w@a0', 'qs:1:1m@a0', 'qc:1', 'qs:1:off@a0', 't:1@a0'], 'four common repeats, a free one, and “no repeat” since it has one');
  await w.press('qs:1:2w@a0');
  eq([w.store.tasks[0].repeat, w.store.commands.at(-1).payload.repeat], ['2w', '2w'], 'a repeat every two weeks');
  await w.press('qc:1');
  await w.reply('هر ۳ روز', w.last().text);
  eq(w.store.tasks[0].repeat, '3d', 'or a free one');
  await w.reply('???', '🔁 تکرار برای #۱\n«Report»');
  eq(w.last().text.includes('متوجه نشدم'), true, 'an unreadable one is said so');
  await w.press('qs:1:off@a0');
  eq([w.store.tasks[0].repeat, w.store.commands.at(-1).payload.repeat], [null, null], 'no repeat');

  // Title
  await w.press('ed:1');
  eq(w.last().text.startsWith('✏️'), true, 'a new title is asked for');
  await w.reply('Report <v2>', w.last().text);
  eq([w.store.tasks[0].title, w.store.commands.at(-1).payload.title], ['Report <v2>', 'Report <v2>'], 'the title is changed');
  eq(w.last().text.includes('Report &lt;v2&gt;'), true, 'and shown escaped');

  // Status
  await w.press('sm:1@a0');
  eq(w.data(w.lastEdit()), ['ss:1:open@a0', 'ss:1:doing@a0', 'ss:1:done@a0', 'ss:1:failed@a0', 't:1@a0'], 'open, in progress, done, not done');
  await w.press('ss:1:doing@a0');
  eq([w.store.tasks[0].status, w.store.commands.at(-1).payload], ['doing', { key: 'Work.md|^a|0', status: 'doing' }], 'in progress is queued as a status');
  await w.press('ss:1:done@a0');
  eq([w.store.tasks[0].status, w.lastEdit().text.includes('Report')], ['done', false], 'done goes back to the list without it');

  // Not done, and the in-progress filter.
  const y = await paired();
  await y.sync({ snapshot: [
    { key: 'S.md|One|0', title: 'One', status: 'open', tags: [] },
    { key: 'S.md|Two|0', title: 'Two', status: 'doing', tags: [] },
    { key: 'S.md|Three|0', title: 'Three', status: 'open', tags: [] },
  ] });
  await y.say('/list');
  eq(y.data(y.last()).filter((d) => d.startsWith('ls:')).includes('ls:d:0'), true, 'the lists have a filter for what is in progress');
  await y.press('ls:d:0');
  eq([y.lastEdit().text.includes('Two'), y.lastEdit().text.includes('One'), y.lastEdit().text.includes('🔄 در حال انجام')], [true, false, true], 'that shows only those');
  await y.press('ss:1:failed@d0');
  eq([y.store.tasks[0].status, y.store.commands.at(-1).payload, y.toasts.at(-1)], ['failed', { key: 'S.md|One|0', status: 'failed' }, '❌ انجام نشد'], 'a task marked not done is queued as failed');
  eq(y.lastEdit().text.includes('One'), false, 'and leaves the list');
  await y.press('ss:3:failed');
  eq(y.lastEdit().text.startsWith('❌ <b>انجام نشد</b>'), true, 'with no list to go back to it says so in place');
  await y.say('/fail 2');
  eq([y.store.tasks[1].status, y.last().text], ['failed', '❌ انجام نشد: Two'], '/fail does the same from the keyboard');

  // A database that cannot take an edit yet
  const x = await paired();
  await x.sync({ snapshot: [{ key: 'A.md|^a|0', title: 'T', status: 'open', tags: [] }] });
  const add = x.store.addCommand.bind(x.store);
  x.store.addCommand = async (kind, payload) => { if (kind === 'edit') throw new Error('violates check constraint "commands_kind_check"'); return add(kind, payload); };
  const quiet = console.error;
  console.error = () => {};
  await x.press('pr:1:high');
  console.error = quiet;
  eq([x.store.tasks[0].priority, x.last().text.includes('task_settings.sql')], [null, true], 'if the database cannot queue an edit yet, nothing is changed and the owner is told what to do');
}


// ── The calendar the bot draws ─────────────────────────────────────────────
{
  const month = mod.buildMonth('1405-7', 'jalali', 'fa', '1405-7');
  const days = month.weeks.flat().filter(Boolean).sort();
  eq([days.length, days[0], days.at(-1)], [30, '2026-09-23', '2026-10-22'], 'Mehr 1405 has thirty days, from 23 September to 22 October');
  eq(month.header, ['ج', 'پ', 'چ', 'س', 'د', 'ی', 'ش'], 'a Persian week is drawn from the right, Saturday first');
  eq(month.weeks[0].filter(Boolean).length, 3, 'the first row has four blanks before the first day (Mehr 1 is a Wednesday)');
  eq([month.prev, month.next], ['1405-6', '1405-8'], 'the neighbouring months');
  eq([mod.buildMonth('1405-12', 'jalali', 'en', '1405-12').weeks.flat().filter(Boolean).length, mod.buildMonth('1403-12', 'jalali', 'en', '1403-12').weeks.flat().filter(Boolean).length], [29, 30], 'Esfand has thirty days only in a leap year (1403)');
  eq(mod.buildMonth('1405-12', 'jalali', 'en', '1405-12').next, '1406-1', 'and the year turns');
  const greg = mod.buildMonth('2026-10', 'gregorian', 'en', '2026-10');
  eq([greg.header[0], greg.weeks.flat().filter(Boolean).length, greg.weeks[0].findIndex(Boolean)], ['Mo', 31, 3], 'a Gregorian month starts on Monday: 1 October 2026 is a Thursday');
  eq(mod.monthKeyOf('jalali', '2026-10-12'), '1405-7', 'a date’s month in either calendar');
  eq(mod.dayOf('jalali', 1405, 7, 20), '2026-10-12', '20 Mehr 1405 is 12 October 2026');
}

{
  const w = await paired();
  await w.sync({ snapshot: [{ key: 'W.md|^a|0', title: 'Report', status: 'open', plan_date: '2026-10-12', tags: [] }] });

  await w.press('rm:1@a0');
  await w.press('cn:r:1:1405-7@a0');
  const calendar = w.lastEdit();
  eq(calendar.text.includes('<b>مهر ۱۴۰۵</b>') && calendar.text.includes('Report'), true, 'the calendar names the month and the task');
  const labels = calendar.buttons.flat().map((b) => b.text);
  eq([labels[0], labels[2], labels.includes('[۱۰]'), labels.includes('۲۰•')], ['‹', '›', true, true], 'with today in brackets (10 Mehr) and a bullet on the day that has a task (20 Mehr)');
  const twenty = calendar.buttons.flat().find((b) => b.text === '۲۰•');
  eq(twenty.data, 'cd:r:1:2026-10-12@a0', 'a day is picked by its Gregorian date');
  eq(calendar.buttons.at(-1).map((b) => b.data), ['t:1@a0'], 'with a way back');
  await w.press('cn:r:1:1405-8@a0');
  eq(w.lastEdit().text.includes('<b>آبان ۱۴۰۵</b>'), true, 'the arrows change the month');

  await w.press('cd:r:1:2026-10-12@a0');
  const times = w.lastEdit();
  eq([times.text.includes('ساعت چند'), times.buttons.flat().filter((b) => b.data.startsWith('ct:r:1:2026-10-12:')).length], [true, 18], 'a day opens the hours');
  await w.press('ct:r:1:2026-10-12:0900@a0');
  eq([w.store.tasks[0].remind_at, w.store.commands.at(-1).payload.moment], ['2026-10-12T05:30:00.000Z', { date: '2026-10-12', time: '09:00' }], 'an hour sets the reminder, in Tehran time');
  await w.press('ct:r:1:2026-10-01:0900@a0');
  eq(w.toasts.at(-1).includes('گذشته'), true, 'a moment already past is refused over the chat');
  await w.press('cc:r:1:2026-10-12');
  eq([w.last().text.startsWith('⏰'), w.last().text.includes('2026-10-12'), w.last().options.forceReply !== undefined], [true, true, true], 'another hour is asked for, with the day in the question');
  await w.reply('۱۴:۳۰', w.last().text);
  eq(w.store.tasks[0].remind_at, '2026-10-12T11:00:00.000Z', 'and read from the answer');

  await w.press('cn:p:1:1405-7@a0');
  await w.press('cd:p:1:2026-10-14@a0');
  await w.press('ct:p:1:2026-10-14:1000@a0');
  eq(w.data(w.lastEdit()).slice(0, 4), ['cu:p:1:2026-10-14:1000:30@a0', 'cu:p:1:2026-10-14:1000:60@a0', 'cu:p:1:2026-10-14:1000:120@a0', 'cu:p:1:2026-10-14:1000:180@a0'], 'a plan then asks how long');
  await w.press('cu:p:1:2026-10-14:1000:90@a0');
  eq([w.store.tasks[0].plan_date, w.store.tasks[0].plan_start, w.store.tasks[0].plan_end], ['2026-10-14', '10:00', '11:30'], 'the plan has its start and end');
  await w.press('cw:p:1:2026-10-15@a0');
  eq([w.store.tasks[0].plan_date, w.store.tasks[0].plan_start], ['2026-10-15', null], 'or only a day');
  await w.press('cc:p:1:2026-10-16');
  await w.reply('9-10', w.last().text);
  eq([w.store.tasks[0].plan_date, w.store.tasks[0].plan_start, w.store.tasks[0].plan_end], ['2026-10-16', '09:00', '10:00'], 'or a typed range');

  await w.press('cn:d:1:1405-7@a0');
  await w.press('cd:d:1:2026-10-20@a0');
  eq([w.store.tasks[0].deadline, w.store.commands.at(-1).payload.deadline], ['2026-10-20', '2026-10-20'], 'a deadline is one tap on a day');

  // A task made for a day chosen on the calendar.
  await w.press('new');
  eq(w.data(w.lastEdit()).includes('cn:x:0:1405-7'), true, '“new task” offers a day from the calendar');
  await w.press('cd:x:0:2026-10-12');
  eq([w.last().text.startsWith('🗓'), w.last().text.includes('2026-10-12')], [true, true], 'the title is asked for, with the day in the question');
  await w.reply('خرید نان ساعت ۹ #خانه', w.last().text);
  const made = w.store.tasks.find((t) => t.title === 'خرید نان');
  eq([made.plan_date, made.plan_start, made.tags, w.store.commands.at(-1).payload.day], ['2026-10-12', '09:00', ['خانه'], '2026-10-12'], 'the task is planned for that day, at the hour typed');
}

// ── Which day a new task is written for ────────────────────────────────────
{
  const w = await paired();
  const dayOf = async (text) => {
    await w.say(text);
    return w.store.commands.at(-1).payload.day;
  };
  eq(await dayOf('خرید نان 1405/07/20'), '2026-10-12', 'a task typed with a Jalali date is for that day, not the month');
  eq(await dayOf('call mom remind 2026-10-20 8'), '2026-10-20', 'a reminder’s day counts when there is no plan');
  eq(await dayOf('report due 2026-10-25'), '2026-10-25', 'and a deadline’s when there is neither');
  eq(await dayOf('plan 2026-10-14 remind 2026-10-13 8 due 2026-10-30'), '2026-10-14', 'the plan wins');
  eq(await dayOf('buy milk'), '2026-10-02', 'with no date at all it is for today');
}

// ── Subtasks and the numbering of a list ───────────────────────────────────
{
  const w = await paired();
  await w.sync({ snapshot: [
    { key: 'P.md|^p|0', title: 'Launch', status: 'open', plan_date: '2026-10-02', subs_done: 1, subs_total: 3, tags: [] },
    { key: 'P.md|Write copy|0', title: 'Write copy', status: 'open', plan_date: '2026-10-02', parent_key: 'P.md|^p|0', parent_title: 'Launch', tags: [] },
    { key: 'P.md|Design|0', title: 'Design', status: 'doing', parent_key: 'P.md|^p|0', parent_title: 'Launch', tags: [] },
    { key: 'Q.md|Solo|0', title: 'Solo', status: 'open', plan_date: '2026-10-02', tags: [] },
    { key: 'Q.md|Orphan|0', title: 'Orphan', status: 'open', deadline: '2026-10-01', parent_key: 'Q.md|Closed|0', parent_title: 'Closed parent', tags: [] },
  ] });
  eq(w.store.tasks.map((t) => [t.title, t.parent_key, t.subs_total]), [['Launch', null, 3], ['Write copy', 'P.md|^p|0', null], ['Design', 'P.md|^p|0', null], ['Solo', null, null], ['Orphan', 'Q.md|Closed|0', null]], 'the upload keeps who is under whom, and the counts');

  await w.say('/list');
  const text = w.last().text;
  const order = ['Orphan', 'Launch', 'Write copy', 'Design', 'Solo'].map((title) => text.indexOf(title));
  eq(order.every((at, i) => at > (order[i - 1] ?? -1)), true, 'a parent is followed by its subtasks, the families in order of their sections');
  eq([text.includes('<b>۱.</b> Orphan'), text.includes('<b>۲.</b> Launch'), text.includes('<b>۳.</b> Write copy'), text.includes('<b>۴.</b> 🔄 Design') || text.includes('🔄 <b>۴.</b> Design'), text.includes('<b>۵.</b> Solo')], [true, true, true, true, true], 'numbered 1 to 5 in the order they are read, with no gaps');
  eq(text.includes('↳ 🔄 <b>۴.</b> Design') || text.includes('↳ <b>۴.</b>'), true, 'a subtask is marked with an arrow and set in from its parent');
  eq(text.includes('<code>۱ از ۳</code>') && text.includes('▰▱▱'), true, 'a parent shows how many subtasks are done, with a bar');
  eq(text.includes('زیرتسکِ «Closed parent»'), true, 'a subtask whose parent is not in the list says whose it is');
  eq(w.data(w.last()).filter((d) => d.startsWith('t:')), ['t:5@a0', 't:1@a0', 't:2@a0', 't:3@a0', 't:4@a0'], 'the buttons follow the same order');
  eq(w.last().buttons[0][0].text.startsWith('۱ · '), true, 'and carry the same numbers');

  await w.press('t:1@a0');
  const card = w.lastEdit();
  eq([card.text.includes('زیرتسک‌ها</b> <code>۱ از ۳</code>'), card.text.includes('۱. Write copy'), card.text.includes('۲. 🔄 Design')], [true, true, true], 'a parent’s card lists its open subtasks and the count');
  eq(w.data(card).filter((d) => d.startsWith('t:')), ['t:2@a0', 't:3@a0'], 'with a button for each');
  await w.press('t:2@a0');
  eq([w.lastEdit().text.startsWith('↳ <i>زیرتسکِ «Launch»</i>'), w.data(w.lastEdit()).includes('t:1@a0')], [true, true], 'a subtask’s card says whose it is, with a button up to its parent');
}


// ── Rich messages ──────────────────────────────────────────────────────────
{
  const { htmlToRich, mdEscape } = mod;
  eq(mdEscape('a*b_c [d] $5 | x'), 'a\\*b\\_c \\[d\\] \\$5 \\| x', 'text a person wrote cannot become formatting');
  eq(htmlToRich('<b>List</b>  ·  <i>4 open</i>\n\n<b>Late</b>\n<blockquote><b>1.</b> Fix &lt;b&gt; &amp; more\n⏳ <code>#work</code></blockquote>'),
    '# List  ·  *4 open*\n\n## Late\n\n> **1.** Fix \\<b> & more  \n> ⏳ `#work`', 'HTML becomes rich Markdown: headings, quotes, code, entities');
  eq(htmlToRich('hello\nworld <s>old</s>'), 'hello  \nworld ~~old~~', 'line breaks are kept');
}

{
  const w = await paired();
  await w.sync({ snapshot: [
    { key: 'P.md|^p|0', title: 'Launch *now*', status: 'open', plan_date: '2026-10-02', subs_done: 1, subs_total: 3, tags: ['work'] },
    { key: 'P.md|Write|0', title: 'Write copy', status: 'open', parent_key: 'P.md|^p|0', parent_title: 'Launch', tags: [] },
  ] });
  await w.say('/list');
  const sent = w.last();
  eq([sent.options.rich.rtl, sent.options.rich.markdown.startsWith('# 📋 همهٔ تسک‌ها — *۲ باز*')], [true, true], 'a screen goes out as a rich message too, read right to left in Persian');
  const md = sent.options.rich.markdown;
  eq(md.includes('## 📅 امروز'), true, 'sections are headings');
  eq(md.includes('- [ ] **۱.** Launch \\*now\\* `۱ از ۳` `▰▱▱`') && md.includes('  - [ ] **۲.** Write copy'), true, 'tasks are task-list items, a subtask nested under its parent, titles escaped');
  eq(sent.text.includes('<b>۱.</b>'), true, 'and the classic HTML is still there to fall back on');

  await w.press('t:1@a0');
  const screen = w.lastEdit();
  eq(screen.rich.markdown.startsWith('# Launch \\*now\\*\n\n| | |\n|:--|:--|\n| **📅 برنامه** |'), true, 'a task screen is a heading and a table of its settings');
  eq(screen.rich.markdown.includes('**زیرتسک‌ها** `۱ از ۳` `▰▱▱`\n\n- [ ] Write copy'), true, 'with its open subtasks as a task list');
  eq(screen.rich.markdown.replace(/\n\n\u2800+$/, '').endsWith('*شناسه #۱ · باز*'), true, 'and its ID last (before the line that holds the width)');
  eq([screen.rich.markdown.endsWith('\u2800'.repeat(60)), screen.text.endsWith('\u2800'.repeat(60))], [true, true], 'a short screen is held at a full card’s width, rich or classic');

  await w.press('set:rich');
  eq([w.store.owner.rich, w.lastEdit().text.includes('خاموش')], [false, true], 'the settings switch rich display off');
  await w.say('/list');
  eq(w.last().options.rich, undefined, 'and screens then go out as classic messages only');
  await w.press('t:1@a0');
  eq(w.lastEdit().rich, undefined, 'edits too');
  await w.press('set:rich');
  eq(w.store.owner.rich, true, 'and back on');

  // A database that does not have the column yet.
  const x = await paired();
  x.store.patchOwner = async () => { throw new Error('column "rich" does not exist'); };
  const quiet = console.error;
  console.error = () => {};
  await x.press('set:rich');
  console.error = quiet;
  eq(x.toasts.at(-1).includes('دیتابیس'), true, 'if the database cannot keep the choice yet, the owner is told');
}

// ── Sending: the ladder from rich to classic to plain ──────────────────────
{
  const calls = [];
  const replies = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const method = String(url).split('/').pop();
    const body = JSON.parse(init.body);
    calls.push({ method, body });
    const reply = replies.shift() ?? { ok: true };
    return { ok: reply.ok, status: reply.ok ? 200 : (reply.status ?? 400), text: async () => reply.text ?? '' };
  };
  const quietErrors = console.error;
  console.error = () => {};
  const rich = { markdown: '# Hi', rtl: true };
  const buttons = [[{ text: 'A', data: 'a', style: 'success' }]];
  const tg = mod.telegramApi('TOKEN');

  await tg.send(7, '<b>Hi</b>', buttons, { rich });
  eq([calls[0].method, calls[0].body.rich_message, calls[0].body.reply_markup.inline_keyboard[0][0].style], ['sendRichMessage', { markdown: '# Hi', is_rtl: true, skip_entity_detection: true }, 'success'], 'a rich message goes by sendRichMessage, rich body and coloured buttons');
  calls.length = 0;
  replies.push({ ok: false, status: 400, text: 'Bad Request: can\'t parse rich message' }, { ok: false, status: 400, text: 'Bad Request: can\'t parse rich message' });
  await tg.send(7, '<b>Hi</b>', buttons, { rich });
  eq(calls.map((c) => c.method), ['sendRichMessage', 'sendRichMessage', 'sendMessage'], 'if Telegram refuses it (once more without the colours), the classic message is sent instead');
  eq([calls[1].body.reply_markup.inline_keyboard[0][0].style, calls[2].body.parse_mode, calls[2].body.text], [undefined, 'HTML', '<b>Hi</b>'], 'as HTML');
  calls.length = 0;
  await tg.edit(7, 55, '<b>Hi</b>', buttons, rich);
  eq([calls[0].method, calls[0].body.message_id, !!calls[0].body.rich_message], ['editMessageText', 55, true], 'an edit carries the rich message to editMessageText');
  calls.length = 0;
  replies.push({ ok: false, status: 404, text: 'Not Found: method not found' });
  await tg.send(7, 'x', undefined, { rich });
  calls.length = 0;
  await tg.send(7, 'x', undefined, { rich });
  eq(calls.map((c) => c.method), ['sendMessage'], 'when Telegram does not know rich messages at all, they are not tried again for a while');
  globalThis.fetch = realFetch;
  console.error = quietErrors;
}

// ── A short message keeps its buttons from being squeezed ──────────────────
{
  const { widenHtml, widenMarkdown, padOf, PADS } = mod;
  const short = widenHtml('<b>Done</b>', true, 60);
  eq([short.startsWith('<b>Done</b>\n'), short.endsWith('\u2800'), Array.from(short).filter((c) => c === '\u2800').length], [true, true, 60], 'a short text gets a last line of invisible characters, so the buttons under it have room');
  eq(widenHtml('a long enough line of words that fills the width of a message', true, 60), 'a long enough line of words that fills the width of a message', 'a text that is wide already is left alone');
  eq(widenHtml('<b>Done</b>', false, 60), '<b>Done</b>', 'and so is one with no buttons');
  eq(widenHtml('<b>Done</b>', true, 0), '<b>Done</b>', 'and when the width is switched off');
  eq(widenHtml('short\nand a line that is quite a lot longer than the limit we set here', true, 60).includes('\u2800'), false, 'the longest line counts, not the first');
  eq(widenMarkdown('# Today', '<b>Today</b>', true, 40), '# Today\n\n' + '\u2800'.repeat(40), 'a rich message is widened the same way, by a paragraph of its own');
  eq([padOf(undefined), padOf(null), padOf(0), padOf(80), padOf(9999)], [60, 60, 0, 80, 60], 'the width defaults to 60 and a nonsense one is ignored');
  eq([...PADS], [0, 40, 60, 80, 100], 'the choices');
}


// ── Buttons that are not squeezed, and a width that can be tuned ───────────
{
  const w = await paired();
  await w.sync({ snapshot: [
    { key: 'A.md|1|0', title: 'Late', status: 'open', deadline: '2026-10-01', tags: [] },
    { key: 'A.md|2|0', title: 'Now', status: 'doing', plan_date: '2026-10-02', tags: [] },
    { key: 'A.md|3|0', title: 'Plain', status: 'open', tags: [] },
    { key: 'A.md|4|0', title: 'Parent', status: 'open', subs_done: 0, subs_total: 1, tags: [] },
  ] });
  await w.say('/list');
  const filters = w.last().buttons.filter((row) => row.every((b) => /^ls:[atodu]:0$/.test(b.data)));
  eq(filters.map((row) => row.map((b) => b.data)), [['ls:a:0', 'ls:t:0'], ['ls:o:0', 'ls:d:0'], ['ls:u:0']], 'the filters are two to a row, so no label is cut short');
  eq(w.last().text.startsWith('<b>📋 همهٔ تسک‌ها</b> — <i>۴ باز</i>'), true, 'the title counts with a dash, not a dot that reads as a zero');
  eq(w.last().text.includes('<code>۰ از ۱</code>'), true, 'and a ratio reads «۰ از ۱», not a slash that turns round');

  await w.say('/settings');
  eq(w.data(w.last()).includes('set:pad'), true, 'the settings have a button for the message width');
  eq(w.last().text.includes('↔️ عرض پیام · متوسط'), true, 'which starts at medium (60)');
  await w.press('set:pad');
  eq([w.store.owner.pad, w.lastEdit().text.includes('زیاد')], [80, true], 'a tap makes it wider');
  await w.press('set:pad');
  await w.press('set:pad');
  eq(w.store.owner.pad, 0, 'and round again to none');
  await w.press('home');
  eq(w.lastEdit().text.includes('⠀'), false, 'with none, nothing is added');
  await w.press('set:pad');
  eq(w.store.owner.pad, 40, 'then narrow');
  await w.press('home');
  eq(Array.from(w.lastEdit().text).filter((c) => c === '⠀').length, 40, 'a short screen then carries that many invisible characters');
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
  eq(cleanTask({ key: 'k', title: 't', status: 'done', plan_date: '2026-02-31', tags: [3, 'a'], priority: 'urgent' }), { key: 'k', title: 't', status: 'done', priority: null, deadline: null, plan_date: null, plan_start: null, plan_end: null, remind_at: null, repeat: null, parent_key: null, parent_title: null, subs_done: null, subs_total: null, tags: ['a'], note_path: null }, 'an upload is cleaned field by field');
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
  eq(w.last().buttons.flat().map((b) => b.data), ['done:1', 'snz:1:10', 'snz:1:60', 'snz:1:tom', 't:1'], 'with done, snooze and details buttons');
  eq(w.last().text.startsWith('⏰ <b>'), true, 'as a card under a heading');
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
