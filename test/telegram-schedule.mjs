/**
 * What the bot sends by itself, once a minute from the ticker: the morning summary, the evening
 * review, the nudge before a deadline, and a reminder that comes again until the task is done.
 * Every message must go out once, at the hour set, and never twice; and with nowhere to write
 * down what was sent, none must go out at all.
 */
import * as esbuild from 'esbuild';
import { validateV2 } from './md2-validator.mjs';

const build = await esbuild.build({
  stdin: {
    contents: `
      export { handleUpdate } from "../supabase/functions/_shared/bot.ts";
      export { handleSync } from "../supabase/functions/_shared/sync.ts";
      export { runTick } from "../supabase/functions/_shared/tick.ts";
      export { MemoryStore } from "../supabase/functions/_shared/memory-store.ts";
      export { htmlToMarkdownV2 } from "../supabase/functions/_shared/markdownv2.ts";
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
const { handleUpdate, runTick, MemoryStore } = mod;

console.error = () => undefined;

let checked = 0;
function eq(actual, expected, label) {
  checked++;
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${label}:\n  got      ${a}\n  expected ${e}`);
}

const plain = (html) => html.replace(/<[^>]+>/g, '');

function world(at, ai = false) {
  const store = new MemoryStore();
  const sent = [];
  const edits = [];
  const toasts = [];
  const state = { now: new Date(at) };
  const vet = (text, buttons) => {
    const problem = validateV2(mod.htmlToMarkdownV2(text));
    if (problem) throw new Error(`a message Telegram would refuse as MarkdownV2 (${problem}):\n${text}`);
    for (const button of (buttons ?? []).flat()) if (Buffer.byteLength(button.data) > 64) throw new Error(`button data over 64 bytes: ${button.data}`);
  };
  const tg = {
    send: async (chat, text, buttons, options) => void (vet(text, buttons), sent.push({ chat, text, buttons, options })),
    edit: async (chat, id, text, buttons, rich) => void (vet(text, buttons), edits.push({ chat, id, text, buttons, rich })),
    answer: async (_id, text) => void toasts.push(text),
    setCommands: async () => undefined,
  };
  const deps = { store, tg, pairingCode: 'sesame', now: () => state.now, ...(ai ? { ai: { chat: async () => ({ text: '', calls: [] }), transcribe: async () => '' } } : {}) };
  return {
    store, sent, edits, toasts, state, deps,
    say: (text) => handleUpdate({ message: { chat: { id: 7, type: 'private' }, text, message_id: 1 } }, deps),
    press: (data) => handleUpdate({ callback_query: { id: 'cb', data, message: { chat: { id: 7 }, message_id: 555 } } }, deps),
    sync: (body) => mod.handleSync(body, { store, tg, now: () => state.now }),
    tick: () => runTick({ store, tg, now: () => state.now, ai }),
    at: (iso) => void (state.now = new Date(iso)),
    last: () => sent[sent.length - 1],
    data: (m) => (m?.buttons ?? []).flat().map((b) => b.data),
  };
}
async function paired(at, ai) {
  const w = world(at, ai);
  await w.say('/start sesame');
  w.sent.length = 0;
  return w;
}

// Tehran is 3½ hours ahead of UTC: 04:30Z is 08:00 on Monday 5 October 2026 (13 Mehr 1405).
const MORNING = '2026-10-05T04:30:00Z';
const tasks = [
  { key: 'A.md|^1|0', title: 'Call the bank', status: 'open', tags: [], plan_date: '2026-10-05', plan_start: '09:00' },
  { key: 'A.md|^2|0', title: 'Send the report', status: 'open', tags: [], deadline: '2026-10-05', priority: 'high' },
  { key: 'A.md|^3|0', title: 'Old errand', status: 'open', tags: [], plan_date: '2026-10-03' },
  { key: 'A.md|^4|0', title: 'Water plants', status: 'open', tags: [], plan_date: '2026-10-06' },
  { key: 'A.md|^5|0', title: 'Tax form', status: 'open', tags: [], deadline: '2026-10-06' },
];

// ── The morning summary ────────────────────────────────────────────────────
{
  const w = await paired('2026-10-05T04:29:00Z');
  await w.sync({ snapshot: tasks });
  await w.tick();
  eq(w.sent.length, 0, 'a minute before the hour, nothing is sent');
  w.at(MORNING);
  eq(await w.tick(), 1, 'at the hour set, one message goes out');
  const brief = w.last();
  const text = plain(brief.text);
  eq(text.startsWith('☀️ صبح بخیر — امروز'), true, 'it says good morning and the day');
  eq(['۱ برنامه برای امروز', '۱ مهلت امروز', '۱ عقب‌افتاده'].every((part) => text.includes(part)), true, 'with what is planned, due and late');
  eq(text.includes('برنامهٔ امروز') && text.includes('Call the bank') && text.includes('اول سراغ این‌ها برو'), true, 'the plan, and what to start with');
  eq(text.indexOf('Old errand') > text.indexOf('اول سراغ این‌ها برو'), true, 'a late task is among the first to start with');
  eq(w.data(brief), ['ls:t:0', 'ov'], 'buttons: today and the overview (no “plan my day” without the assistant)');
  eq(brief.options.rich.markdown.includes('صبح بخیر'), true, 'and the rich message says it too');
  eq(w.store.owner.notified['brief:2026-10-05'] !== undefined, true, 'what was sent is written down');

  eq(await w.tick(), 0, 'the next minute sends nothing more');
  w.at('2026-10-05T05:10:00Z');
  eq(await w.tick(), 0, 'nor half an hour on');
  w.at('2026-10-05T05:40:00Z');
  eq(await w.tick(), 0, 'and after the hour of grace it is let go');
  w.at('2026-10-06T04:30:00Z');
  eq(await w.tick(), 1, 'the next morning it comes again');
}
{
  const w = await paired(MORNING, true);
  await w.sync({ snapshot: tasks });
  await w.tick();
  eq(w.data(w.last()), ['ls:t:0', 'ov', 'pd'], 'with the assistant, it offers to plan the day');
}
{
  const w = await paired(MORNING);
  await w.tick();
  eq(plain(w.last().text).includes('برنامه‌ای نداری'), true, 'with nothing to do it says so, and that it can be filled');
  const late = await paired('2026-10-05T04:55:00Z');
  await late.sync({ snapshot: tasks });
  eq(await late.tick(), 1, 'a ticker that was late still sends it within the hour');
}
{
  const w = await paired(MORNING);
  await w.store.patchOwner({ brief_time: null });
  await w.tick();
  eq(w.sent.length, 0, 'with the summary switched off nothing is sent');
  await w.store.patchOwner({ brief_time: '09:30' });
  w.at('2026-10-05T06:00:00Z');
  await w.tick();
  eq(w.sent.length, 1, 'and another hour can be chosen');
}
{
  // Nowhere to write down what was sent: nothing is sent.
  const w = await paired(MORNING);
  const patch = w.store.patchOwner.bind(w.store);
  w.store.patchOwner = async (p) => { if ('notified' in p) throw new Error('column "notified" does not exist'); return patch(p); };
  eq(await w.tick(), 0, 'when the database cannot remember what was sent, the messages wait rather than repeat every minute');
}

// ── The evening review ─────────────────────────────────────────────────────
{
  const w = await paired('2026-10-05T17:29:00Z');
  await w.sync({ snapshot: tasks });
  await w.tick();
  w.at('2026-10-05T17:30:00Z');
  eq(await w.tick(), 1, 'at nine in the evening the review comes');
  const review = w.last();
  const text = plain(review.text);
  eq(text.startsWith('🌙 مرور شب'), true, 'it is the review');
  eq(['۱ کار امروز هنوز مانده', '۱ عقب‌افتاده', 'Call the bank', 'فردا ۲ برنامه داری.'].every((part) => text.includes(part)), true, 'what is left, what is late, and what tomorrow holds (a plan and a deadline)');
  eq(w.data(review), ['mv', 'dy:2026-10-06', 'ov', 'ls:o:0'], 'with a button to move what is left to tomorrow, one to see tomorrow, the overview, and the late ones');
  eq(review.buttons[0][0].text, '➡️ بریزشان فردا (۱)', 'whose label says how many');
}
{
  const w = await paired('2026-10-05T17:30:00Z');
  await w.sync({ snapshot: [tasks[3]] });
  await w.tick();
  eq([plain(w.last().text).includes('همهٔ برنامهٔ امروز انجام شد'), w.data(w.last()).includes('mv')], [true, false], 'with nothing left it congratulates and offers no move');
}

// ── Before a deadline ──────────────────────────────────────────────────────
{
  const w = await paired('2026-10-05T16:30:00Z');
  await w.sync({ snapshot: tasks });
  await w.store.patchOwner({ review_time: null, brief_time: null });
  eq(await w.tick(), 1, 'at eight in the evening, a nudge for what is due tomorrow');
  const nudge = w.last();
  eq([plain(nudge.text).startsWith('⏳ ۱ مهلت فردا'), plain(nudge.text).includes('Tax form'), plain(nudge.text).includes('Send the report')], [true, true, false], 'it lists what is due tomorrow, and not today’s');
  eq(w.data(nudge), ['t:5'], 'with a button to open each');
  eq(await w.tick(), 0, 'once');
  const none = await paired('2026-10-05T16:30:00Z');
  await none.sync({ snapshot: [tasks[0]] });
  await none.store.patchOwner({ review_time: null, brief_time: null });
  eq(await none.tick(), 0, 'and not at all when nothing is due');
  const off = await paired('2026-10-05T16:30:00Z');
  await off.sync({ snapshot: tasks });
  await off.store.patchOwner({ review_time: null, brief_time: null, deadline_nudge: 'off' });
  eq(await off.tick(), 0, 'or when it is switched off');
}
{
  const w = await paired(MORNING);
  await w.sync({ snapshot: tasks });
  await w.store.patchOwner({ brief_time: null, deadline_nudge: 'morn' });
  eq([await w.tick(), plain(w.last().text).startsWith('⏳ ۱ مهلت امروز')], [1, true], 'the morning nudge lists what is due today');
  const covered = await paired(MORNING);
  await covered.sync({ snapshot: tasks });
  await covered.store.patchOwner({ deadline_nudge: 'morn' });
  eq([await covered.tick(), plain(covered.last().text).startsWith('☀️')], [1, true], 'but with the morning summary on, that already has it, and only it is sent');
}

// ── A reminder that is not answered ────────────────────────────────────────
{
  // 12:00Z is 15:30 in Tehran: clear of every hour above.
  const w = await paired('2026-10-05T11:59:00Z');
  await w.store.patchOwner({ brief_time: null, review_time: null, deadline_nudge: 'off' });
  await w.sync({ snapshot: [{ key: 'A.md|^1|0', title: 'Take the pills', status: 'open', tags: [], remind_at: '2026-10-05T12:00:00Z' }] });
  w.at('2026-10-05T12:00:00Z');
  eq([await w.tick(), plain(w.last().text).startsWith('⏰ یادآوری')], [1, true], 'the reminder comes at its time');
  w.at('2026-10-05T12:05:00Z');
  eq(await w.tick(), 0, 'five minutes on, nothing');
  w.at('2026-10-05T12:10:00Z');
  eq([await w.tick(), plain(w.last().text).startsWith('🔁 هنوز انجام نشده · بار ۱ از ۳')], [1, true], 'ten minutes on, it comes again, and says it is the first time of three');
  eq(w.data(w.last()).slice(0, 2), ['done:1', 'snz:1:10'], 'with the same buttons');
  w.at('2026-10-05T12:20:00Z');
  await w.tick();
  eq(plain(w.last().text).startsWith('🔁 هنوز انجام نشده · بار ۲ از ۳'), true, 'again');
  w.at('2026-10-05T12:30:00Z');
  await w.tick();
  eq(plain(w.last().text).startsWith('🔁 هنوز انجام نشده · بار ۳ از ۳'), true, 'and a third time');
  w.at('2026-10-05T12:40:00Z');
  eq(await w.tick(), 0, 'and no more');
}
{
  const make = async () => {
    const w = await paired('2026-10-05T11:59:00Z');
    await w.store.patchOwner({ brief_time: null, review_time: null, deadline_nudge: 'off' });
    await w.sync({ snapshot: [{ key: 'A.md|^1|0', title: 'Take the pills', status: 'open', tags: [], remind_at: '2026-10-05T12:00:00Z' }] });
    w.at('2026-10-05T12:00:00Z');
    await w.tick();
    return w;
  };
  const done = await make();
  await done.press('done:1');
  done.at('2026-10-05T12:10:00Z');
  eq(await done.tick(), 0, 'a task ticked off is not asked about again');
  const snoozed = await make();
  await snoozed.press('snz:1:60');
  snoozed.at('2026-10-05T12:10:00Z');
  eq(await snoozed.tick(), 0, 'nor one that was snoozed: its new time is what counts');
  const quiet = await make();
  await quiet.store.patchOwner({ nag: false });
  quiet.at('2026-10-05T12:10:00Z');
  eq(await quiet.tick(), 0, 'and with persistent reminders switched off the first one is the only one');
  const off = await paired('2026-10-05T11:59:00Z');
  await off.store.patchOwner({ brief_time: null, review_time: null, deadline_nudge: 'off', nag: false });
  await off.sync({ snapshot: [{ key: 'A.md|^1|0', title: 'Pills', status: 'open', tags: [], remind_at: '2026-10-05T12:00:00Z' }] });
  off.at('2026-10-05T12:00:00Z');
  await off.tick();
  eq(Object.keys(off.store.owner.notified ?? {}).filter((key) => key.startsWith('nag:')), [], 'nothing is even written down for it');
  const late = await make();
  late.at('2026-10-05T13:30:00Z');
  eq(await late.tick(), 0, 'a reminder long past is let go');
}
{
  // What is remembered is not kept for ever.
  const w = await paired(MORNING);
  w.store.owner.notified = { 'brief:2026-09-01': { at: '2026-09-01T04:30:00Z' }, 'brief:2026-10-04': { at: '2026-10-04T04:30:00Z' } };
  await w.tick();
  eq(Object.keys(w.store.owner.notified).sort(), ['brief:2026-10-04', 'brief:2026-10-05'], 'what was sent a month ago is forgotten, what was sent yesterday is not');
}

// ── The settings ───────────────────────────────────────────────────────────
{
  const w = await paired(MORNING);
  await w.say('/settings');
  eq(w.last().buttons.flat().some((b) => b.data === 'nf'), true, 'the settings lead to the notifications');
  await w.press('nf');
  const screen = w.edits.at(-1);
  eq(plain(screen.text), '🔔 اعلان‌ها\n☀️ خلاصهٔ صبح · ۰۸:۰۰\n🌙 مرور شب · ۲۱:۰۰\n⏳ یادآوری مهلت · شب قبل (۲۰:۰۰)\n🔁 یادآوری پافشار · روشن (۱۰ دقیقه، تا ۳ بار)\nبا هر بار زدن یک دکمه، گزینهٔ بعدی انتخاب می‌شود.', 'the screen lists the settings with their values');
  eq(w.data(screen).slice(0, 4), ['nf:brief', 'nf:review', 'nf:nudge', 'nf:nag'], 'a button for each, and none for the assistant that is not set up');
  await w.press('nf:brief');
  eq([w.store.owner.brief_time, plain(w.edits.at(-1).text).includes('خلاصهٔ صبح · ۰۹:۰۰')], ['09:00', true], 'a tap moves the hour on');
  await w.press('nf:brief');
  await w.press('nf:brief');
  eq(w.store.owner.brief_time, null, 'to “off” after the last hour');
  await w.press('nf:brief');
  eq(w.store.owner.brief_time, '06:00', 'and round again');
  await w.press('nf:review');
  eq(w.store.owner.review_time, '22:00', 'the evening review likewise');
  await w.press('nf:nudge');
  await w.press('nf:nudge');
  eq(w.store.owner.deadline_nudge, 'both', 'the deadline reminder steps through its four choices');
  await w.press('nf:nag');
  eq(w.store.owner.nag, false, 'persistent reminders turn off');
  const x = await paired(MORNING);
  x.store.patchOwner = async () => { throw new Error('column "nag" does not exist'); };
  await x.press('nf:nag');
  eq(x.toasts.at(-1).includes('دیتابیس'), true, 'a database without the columns says so');
  const y = await paired(MORNING, true);
  await y.press('nf');
  eq(y.data(y.edits.at(-1)).includes('nf:confirm'), true, 'with the assistant there is a button for how it asks');
  await y.press('nf:confirm');
  await y.press('nf:confirm');
  await y.press('nf:confirm');
  eq(y.store.owner.ai_confirm, 'big', 'cycling through always, big jobs and never');
}

// ── The overview: a week ───────────────────────────────────────────────────
{
  const w = await paired(MORNING);
  await w.sync({ snapshot: [
    ...tasks,
    { key: 'A.md|^6|0', title: 'Dentist', status: 'open', tags: [], plan_date: '2026-10-12', plan_start: '10:00' },
    { key: 'A.md|^7|0', title: 'Think about the trip', status: 'open', tags: [] },
    { key: 'A.md|^8|0', title: 'Call mum', status: 'open', tags: [], remind_at: '2026-10-05T14:30:00Z' },
    ...Array.from({ length: 8 }, (_, i) => ({ key: `B.md|^${i}|0`, title: `Errand ${i + 1}`, status: 'open', tags: [], plan_date: '2026-10-08' })),
  ] });
  w.sent.length = 0;
  await w.say('/overview');
  const view = w.last();
  const text = plain(view.text).replace(/[\n\u2800]+$/, '');
  eq(text.split('\n').slice(0, 18), [
    '🗂 نمای کلی · هفته — شنبه ۱۱ مهر – جمعه ۱۷ مهر',
    '۱۴ تسک در ۴ روز',
    '',
    'شنبه ۱۱ مهر (۱)',
    '• Old errand',
    '',
    'دوشنبه ۱۳ مهر · امروز (۳)',
    '• ۰۹:۰۰ Call the bank',
    '• Send the report 🟠 ⏳',
    '• Call mum 🔔 ۱۸:۰۰',
    '',
    'سه‌شنبه ۱۴ مهر (۲)',
    '• Water plants',
    '• Tax form ⏳',
    '',
    'پنجشنبه ۱۶ مهر (۸)',
    '• Errand 1',
    '• Errand 2',
  ], 'a week by day, Saturday to Friday, under a summary: every task of each busy day (the ones with no hour too, in the order of the day), a heading with how many in brackets, today named');
  eq(text.includes('روزهای آزاد') || text.includes('(۰)'), false, 'the empty days are left out altogether');
  eq(text.includes('• Errand 6\nو ۲ مورد دیگر؛ روز را باز کن.'), true, 'a crowded day shows six and points to its own screen');
  eq(text.includes('Dentist') || text.includes('Think about the trip'), false, 'what is of another week, or of no day, is not in this one');
  const rich = view.options.rich.markdown;
  eq([rich.includes('|'), rich.split('\n').filter((line) => line.startsWith('#')).slice(0, 4)], [false, ['# 🗂 نمای کلی · هفته — شنبه ۱۱ مهر – جمعه ۱۷ مهر', '## شنبه ۱۱ مهر (۱)', '## ==دوشنبه ۱۳ مهر · امروز (۳)==', '## سه‌شنبه ۱۴ مهر (۲)']], 'the rich message is headings and lists, no table; today marked');
  const rows = view.buttons;
  eq(rows[0].map((b) => b.data), ['dy:2026-10-09', 'dy:2026-10-08', 'dy:2026-10-07', 'dy:2026-10-06', 'dy:2026-10-05', 'dy:2026-10-04', 'dy:2026-10-03'], 'a button for each day, Saturday on the right as Persian reads');
  eq([rows[0][4].text, rows[0][4].style, rows[0][1].text, rows[0][5].text], ['•د ۱۳', 'primary', '•پ ۱۶', 'ی ۱۲'], 'each names its weekday and number, today is blue, a day with tasks has a dot (before the letter, away from the digits)');
  eq(rows[1].map((b) => [b.text, b.data]), [['۱۸ – ۲۴ مهر', 'wk:1'], ['🗓 این هفته', 'noop'], ['۴ – ۱۰ مهر', 'wk:-1']], 'the weeks either side are named by their dates, never «next» or «last»; the one shown cannot be chosen again');
  eq(rows[2].map((b) => [b.text, b.data, b.style]), [['🗓 هفته', 'wk:0', 'primary'], ['📅 روز', 'dy:2026-10-05', undefined]], 'week and day are the two ways to see it; the week is blue, the day opens on today');
  eq(rows[3].map((b) => [b.text, b.data]), [['عقب‌افتاده (۱)', 'ls:o:0'], ['بدون برنامه (۱)', 'ls:u:0']], 'the late ones and those with no plan, which a week does not show, are a tap away, counted in brackets');

  await w.press('wk:1');
  const next = w.edits.at(-1);
  eq([plain(next.text).split('\n')[0], plain(next.text).includes('۱۰:۰۰ Dentist'), next.buttons[1].map((b) => [b.text, b.data]), next.buttons[2].map((b) => b.data)], ['🗂 نمای کلی · هفته — شنبه ۱۸ مهر – جمعه ۲۴ مهر', true, [['۲۵ مهر – ۱ آبان', 'wk:2'], ['🗓 این هفته', 'wk:0'], ['۱۱ – ۱۷ مهر', 'wk:0']], ['wk:1', 'dy:2026-10-10']], 'the next week has the dentist, a way back to this week, and the day switch opens on its first day');
  await w.press('wk:-5');
  eq(plain(w.edits.at(-1).text).split('\n')[0], '🗂 نمای کلی · هفته — شنبه ۷ شهریور – جمعه ۱۳ شهریور', 'and several weeks back the headings are dates, as before');
  await w.say('/week');
  eq(plain(w.last().text).startsWith('🗂 نمای کلی · هفته'), true, '/week opens the same');
  await w.say('/start');
  await w.press('ov');
  eq(plain(w.edits.at(-1).text).startsWith('🗂 نمای کلی · هفته — شنبه ۱۱ مهر'), true, 'and so does the menu’s button');
}
{
  const w = await paired(MORNING);
  await w.store.patchOwner({ language: 'en', calendar: 'gregorian' });
  await w.sync({ snapshot: tasks });
  await w.press('ov');
  const week = w.edits.at(-1);
  eq(plain(week.text).split('\n').slice(0, 4), ['🗂 Overview · Week — Mon 5 Oct – Sun 11 Oct', '4 tasks on 2 days', '', 'Mon 5 Oct · Today (2)'], 'a Gregorian week runs from Monday');
  eq(week.buttons[0].map((b) => b.text.split(' ')[0]), ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'], 'with the days in reading order, left to right');
  eq(week.buttons[1].map((b) => b.text), ['‹ 28 Sep – 4 Oct', '🗓 This week', '12 – 18 Oct ›'], 'and arrows in English; a range across two months names both');
}

// ── The overview: a day ────────────────────────────────────────────────────
{
  const w = await paired(MORNING);
  await w.sync({ snapshot: tasks });
  await w.press('dy:2026-10-07');
  const day = w.edits.at(-1);
  eq(plain(day.text).split('\n').slice(0, 2), ['🗂 نمای کلی · روز', '📅 چهارشنبه ۱۵ مهر — خالی'], 'a day’s screen says what it is, and the day');
  await w.press('dy:2026-10-06');
  const tue = w.edits.at(-1);
  eq([plain(tue.text).split('\n')[1], plain(tue.text).includes('۱. Water plants'), plain(tue.text).includes('۲. Tax form')], ['📅 سه‌شنبه ۱۴ مهر — ۲ تسک', true, true], 'it lists what is planned or due that day');
  eq(tue.buttons.slice(0, 2).map((row) => row.map((b) => b.data)), [['t:4@y2026-10-06'], ['t:5@y2026-10-06']], 'a button for each, a row each when they are few, that comes back to the day');
  eq(tue.buttons[2].map((b) => [b.text, b.data]), [['چهارشنبه ۱۵', 'dy:2026-10-07'], ['📅 امروز', 'dy:2026-10-05'], ['دوشنبه ۱۳', 'dy:2026-10-05']], 'the days either side are named by their dates (the month dropped when the names would not fit a button), with a way back to today between them');
  eq(tue.buttons[3].map((b) => [b.data, b.style]), [['wk:0', undefined], ['dy:2026-10-06', 'primary']], 'the two ways to see it: the day is blue, the week opens on this day’s week');
  eq(tue.buttons[4].map((b) => b.data), ['cd:x:0:2026-10-06'], 'and a new task for this day');
  await w.press('t:4@y2026-10-06');
  eq(w.edits.at(-1).buttons.flat().some((b) => b.data === 'dy:2026-10-06'), true, 'a task opened from a day goes back to that day');
  await w.press('dy:2026-10-05');
  eq(w.edits.at(-1).buttons.find((row) => row.some((b) => b.data === 'noop')).map((b) => [b.data, b.disabled]), [['dy:2026-10-06', undefined], ['noop', true], ['dy:2026-10-04', undefined]], 'on today the middle button is only a place-holder');
  // Ten days on, nothing is called «tomorrow» or «yesterday».
  await w.press('dy:2026-10-15');
  eq(w.edits.at(-1).buttons[0].map((b) => b.text), ['جمعه ۲۴', '📅 امروز', 'چهارشنبه ۲۲'], 'ten days on, the days either side are still dates, not «tomorrow» or «yesterday»');
  await w.press('dy:2026-10-15');
  await w.press('wk:' + 1);
  await w.press('dy:2026-11-30');
  eq(plain(w.edits.at(-1).text).includes('برنامه‌ای نیست'), true, 'an empty day says so');
  eq(w.edits.at(-1).buttons.find((row) => row[0].data.startsWith('wk:') || row[1]?.data.startsWith('wk:')).map((b) => b.data), ['wk:8', 'dy:2026-11-30'], 'and the week it is in is eight weeks on');
  await w.press('cd:x:0:2026-10-06');
  eq(w.sent.at(-1).options?.forceReply !== undefined && w.sent.at(-1).text.includes('2026-10-06'), true, '“a task for this day” asks what it is, for that day');
  await w.say('/day');
  eq(plain(w.last().text).split('\n').slice(0, 2), ['🗂 نمای کلی · روز', '📅 دوشنبه ۱۳ مهر — ۲ تسک · امروز'], '/day opens today');
}

// ── Move to tomorrow ───────────────────────────────────────────────────────
{
  const w = await paired('2026-10-05T17:30:00Z');
  await w.sync({ snapshot: [
    { key: 'A.md|^1|0', title: 'Gym', status: 'open', tags: [], plan_date: '2026-10-05', plan_start: '18:00', plan_end: '19:00', remind_at: '2026-10-05T14:20:00Z' },
    { key: 'A.md|^2|0', title: 'Read', status: 'open', tags: [], plan_date: '2026-10-05' },
    { key: 'A.md|^3|0', title: 'Tomorrow already', status: 'open', tags: [], plan_date: '2026-10-06' },
  ] });
  await w.tick();
  await w.press('mv');
  eq(w.store.tasks.map((t) => [t.plan_date, t.plan_start, t.plan_end]), [['2026-10-06', '18:00', '19:00'], ['2026-10-06', null, null], ['2026-10-06', null, null]], 'what was planned for today goes to tomorrow, at the same hours');
  eq(w.store.tasks[0].remind_at, '2026-10-06T14:20:00.000Z', 'the reminder that had gone by is set before tomorrow’s hour');
  eq(w.store.commands.filter((c) => c.kind === 'plan').length, 2, 'through the plan command a tap would queue');
  eq(plain(w.edits.at(-1).text).replace(/[\n\u2800]+$/, ''), '➡️ ۲ تسک به فردا رفت.', 'and it says how many');
  await w.press('mv');
  eq(w.toasts.at(-1), 'چیزی برای جابه‌جا کردن نمانده.', 'pressed again, there is nothing left to move');
}

console.log(`TELEGRAM_SCHEDULE_OK (${checked} checks)`);
