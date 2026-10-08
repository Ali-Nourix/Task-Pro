/**
 * The bot's assistant: words (or a voice message) become tasks through the commands the
 * model may call. The model is replaced by a script and Cloudflare by a fake `fetch`, so
 * this checks everything on our side of the line: what the model is told, how its fields are
 * read and checked, what is done to the tasks, what the card says, and what happens when
 * Cloudflare says no.
 */
import * as esbuild from 'esbuild';
import { validateV2 } from './md2-validator.mjs';

const build = await esbuild.build({
  stdin: {
    contents: `
      export { handleUpdate } from "../supabase/functions/_shared/bot.ts";
      export { handleSync } from "../supabase/functions/_shared/sync.ts";
      export { MemoryStore } from "../supabase/functions/_shared/memory-store.ts";
      export { htmlToMarkdownV2 } from "../supabase/functions/_shared/markdownv2.ts";
      export * from "../supabase/functions/_shared/ai.ts";
      export { freshMemory } from "../supabase/functions/_shared/assistant.ts";
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
const { handleUpdate, MemoryStore, AiError } = mod;

// The bot logs the failures it is made to handle here; the test expects them.
console.error = () => undefined;

let checked = 0;
function eq(actual, expected, label) {
  checked++;
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${label}:\n  got      ${a}\n  expected ${e}`);
}

// ── Reading a field ────────────────────────────────────────────────────────
eq([mod.readDate('2026-10-06'), mod.readDate('2026/10/06'), mod.readDate('2026-10-06 09:00')], ['2026-10-06', '2026-10-06', '2026-10-06'], 'a day in the forms a model writes it');
eq([mod.readDate('1405-07-14'), mod.readDate('۱۴۰۵/۰۷/۱۴')], ['2026-10-06', '2026-10-06'], 'a Jalali day is converted, in either kind of digits, so the model need not');
eq([mod.readDate('2026-02-30'), mod.readDate('tomorrow'), mod.readDate(5), mod.readDate('1405-13-01')], [null, null, null, null], 'what is not a day is not one');
eq([mod.readTime('9'), mod.readTime('9:30'), mod.readTime('09:30:00'), mod.readTime('9pm'), mod.readTime('12am'), mod.readTime('۱۸:۴۵')], ['09:00', '09:30', '09:30', '21:00', '00:00', '18:45'], 'a time of day');
eq([mod.readTime('25:00'), mod.readTime('noon'), mod.readTime('9:75')], [null, null, null], 'and not an impossible one');
eq([mod.readMoment('2026-10-06 09:30'), mod.readMoment('2026-10-06T21:00'), mod.readMoment('2026-10-06')], [{ date: '2026-10-06', time: '09:30' }, { date: '2026-10-06', time: '21:00' }, null], 'a moment needs both');
eq([mod.readPriority('urgent'), mod.readPriority('High'), mod.readPriority('whatever')], ['highest', 'high', undefined], 'a priority, by its names');

// ── Reading an answer ──────────────────────────────────────────────────────
const known = new Set(['add_task', 'update_task']);
eq(mod.callsInText('{"name":"add_task","arguments":{"title":"x"}}', known), { text: '', calls: [{ name: 'add_task', args: { title: 'x' } }] }, 'a call written as text');
eq(mod.callsInText('Sure!\n```json\n[{"name":"add_task","parameters":{"title":"a"}},{"function":{"name":"update_task","arguments":"{\\"n\\":2}"}}]\n```', known).calls.map((c) => [c.name, c.args]), [['add_task', { title: 'a' }], ['update_task', { n: 2 }]], 'a list in a code fence, with arguments as an object or as a string');
eq(mod.callsInText('{"say":"Done","commands":[{"name":"add_task","args":{"title":"b"}}]}', known), { text: 'Done', calls: [{ name: 'add_task', args: { title: 'b' } }] }, 'an object with its commands and its words');
eq(mod.callsInText('{"name":"launch_missiles","arguments":{}}', known).calls, [], 'a command that is not on the list is not one');
eq(mod.callsInText('Tomorrow you have {two} meetings.', known), { text: 'Tomorrow you have {two} meetings.', calls: [] }, 'an answer in words stays words');
eq(mod.cleanReply('<think>hmm</think>**Done** — I put it on <b>Friday</b>.\n\n\n\nBye'), 'Done — I put it on Friday.\n\nBye', 'thinking, markup and blank runs are taken out');

// ── What the model is told ─────────────────────────────────────────────────
const task = (n, title, extra = {}) => ({ n, key: `k${n}`, title, status: 'open', priority: null, deadline: null, plan_date: null, plan_start: null, plan_end: null, remind_at: null, remind_sent_for: null, repeat: null, parent_key: null, parent_title: null, subs_done: null, subs_total: null, tags: [], note_path: null, origin: 'vault', pending: false, ...extra });
{
  const prompt = mod.systemPrompt({
    language: 'fa', calendar: 'jalali', timezone: 'Asia/Tehran', today: '2026-10-05', minutes: 14 * 60 + 35, leadMinutes: 10,
    tasks: [task(3, 'Report', { plan_date: '2026-10-06', plan_start: '09:00', plan_end: '10:00', tags: ['work'], deadline: '2026-10-09', priority: 'high' }), task(4, 'Later')],
    tags: ['work', 'home'],
  });
  eq(prompt.includes('Monday 2026-10-05 (دوشنبه 13 مهر 1405), 14:35, time zone Asia/Tehran'), true, 'it is told the day in both calendars and the time');
  eq(prompt.includes('Saturday 2026-10-10 (شنبه 18 مهر 1405)'), true, 'and a calendar of the next two weeks, so “Saturday” is a lookup');
  eq(prompt.includes('#3 Report — plan 2026-10-06 09:00-10:00; due 2026-10-09; priority high; tags work'), true, 'each open task, with its number and what is set on it');
  eq(prompt.includes('Tags in use: work, home'), true, 'the tags in use');
  eq(prompt.indexOf('#3 Report') < prompt.indexOf('#4 Later'), true, 'planned tasks first');
  eq(prompt.includes('1405-08-01'), true, 'and that a Jalali date may be written as said');
}

// ── Cloudflare ─────────────────────────────────────────────────────────────
function cloudflare(responses) {
  const requests = [];
  const fetch = async (url, init) => {
    requests.push({ url, headers: init.headers, body: JSON.parse(init.body) });
    const next = responses.shift();
    return new Response(typeof next.body === 'string' ? next.body : JSON.stringify(next.body), { status: next.status ?? 200 });
  };
  return { requests, ai: mod.cloudflareAi({ accountId: 'acc 1', token: 'tok', fetch }) };
}
{
  const reply = { choices: [{ message: { content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'add_task', arguments: '{"title":"Call Sara","plan_date":"2026-10-03"}' } }] } }] };
  const { requests, ai } = cloudflare([{ body: reply }]);
  const answer = await ai.chat([{ role: 'system', content: 's' }, { role: 'user', content: 'u' }], mod.AI_TOOLS);
  eq(answer.calls, [{ name: 'add_task', args: { title: 'Call Sara', plan_date: '2026-10-03' } }], 'a native tool call is read, its arguments parsed from the string');
  eq(requests[0].url, 'https://api.cloudflare.com/client/v4/accounts/acc%201/ai/v1/chat/completions', 'the OpenAI-compatible endpoint of the account');
  eq([requests[0].headers.authorization, requests[0].body.model, requests[0].body.tool_choice, requests[0].body.tools.map((t) => t.function.name)], ['Bearer tok', '@cf/meta/llama-3.3-70b-instruct-fp8-fast', 'auto', mod.AI_TOOLS.map((t) => t.name)], 'with the token, a model that calls functions, and all the commands');
}
{
  const { requests, ai } = cloudflare([{ status: 400, body: { success: false, errors: [{ code: 5006, message: 'tools are not supported for this model' }] } }, { body: { choices: [{ message: { content: '{"name":"add_task","arguments":{"title":"x"}}' } }] } }]);
  const answer = await ai.chat([{ role: 'user', content: 'u' }], mod.AI_TOOLS);
  eq([requests.length, 'tools' in requests[1].body, answer.calls.map((c) => c.name)], [2, false, ['add_task']], 'a model that refuses `tools` is asked again without them, and its written call is read');
}
for (const [status, body, kind] of [
  [401, { success: false, errors: [{ code: 10000, message: 'Authentication error' }] }, 'auth'],
  [403, 'nope', 'auth'],
  [429, 'slow down', 'quota'],
  [400, { success: false, errors: [{ code: 4006, message: 'you have used up your daily free allocation of 10,000 neurons' }] }, 'quota'],
  [503, 'down', 'busy'],
  [404, { success: false, errors: [{ code: 5007, message: 'No such model' }] }, 'bad'],
]) {
  const { ai } = cloudflare([{ status, body }]);
  const error = await ai.chat([{ role: 'user', content: 'u' }], mod.AI_TOOLS).catch((e) => e);
  eq([error instanceof AiError, error.kind], [true, kind], `Cloudflare’s ${status} is “${kind}”`);
}
{
  const { requests, ai } = cloudflare([{ body: { success: true, result: { text: ' فردا ساعت ۹ ' } } }]);
  const text = await ai.transcribe(new Uint8Array([1, 2, 3, 250]), 'fa');
  eq([text, requests[0].url, requests[0].body], ['فردا ساعت ۹', 'https://api.cloudflare.com/client/v4/accounts/acc%201/ai/run/@cf/openai/whisper-large-v3-turbo', { audio: 'AQID+g==', language: 'fa' }], 'a recording is sent as base64 to Whisper, with the language, and the words come back trimmed');
}

// ── The bot with an assistant ──────────────────────────────────────────────
/** A model that says what it is told to say: each step is a reply, an error, or a function of what it was asked. */
function scripted(...steps) {
  const asked = [];
  const ai = {
    asked,
    chat: async (messages) => {
      asked.push([...messages]);
      const step = steps.shift();
      if (step === undefined) throw new Error('the model was asked more than the test expected');
      if (step instanceof Error) throw step;
      return typeof step === 'function' ? step(messages) : step;
    },
    transcribe: async (audio, language) => {
      ai.heard = { size: audio.length, language };
      const step = ai.transcripts.shift();
      if (step instanceof Error) throw step;
      return step;
    },
    transcripts: [],
  };
  return ai;
}
const call = (name, args) => ({ name, args });
const says = (text, ...calls) => ({ text, calls });

function world(ai, at = '2026-10-02T12:00:00Z') {
  const store = new MemoryStore();
  const sent = [];
  const edits = [];
  const toasts = [];
  const typed = [];
  const reacted = [];
  const thought = [];
  const state = { now: new Date(at) };
  const vet = (text, buttons) => {
    const problem = validateV2(mod.htmlToMarkdownV2(text));
    if (problem) throw new Error(`a screen Telegram would refuse as MarkdownV2 (${problem}):\n${text}`);
    for (const button of (buttons ?? []).flat()) {
      if (!button.text || Array.from(button.text).length > 64) throw new Error(`a button label that is empty or too long: ${JSON.stringify(button.text)}`);
      if (Buffer.byteLength(button.data) > 64) throw new Error(`a button whose data is over 64 bytes: ${button.data}`);
    }
  };
  const tg = {
    send: async (chat, text, buttons, options) => void (vet(text, buttons), sent.push({ chat, text, buttons, options })),
    edit: async (chat, id, text, buttons, rich) => void (vet(text, buttons), edits.push({ chat, id, text, buttons, rich })),
    answer: async (_id, text) => void toasts.push(text),
    setCommands: async () => undefined,
    typing: async (chat) => void typed.push(chat),
    thinking: async (chat, html) => void thought.push([chat, html]),
    react: async (chat, id, emoji) => void reacted.push([chat, id, emoji]),
    download: async (fileId) => new Uint8Array([fileId.length, 7, 7]),
  };
  const deps = { store, tg, pairingCode: 'sesame', now: () => state.now, ...(ai ? { ai } : {}) };
  let id = 100;
  return {
    store, sent, edits, toasts, typed, reacted, thought, state, deps,
    say: (text) => handleUpdate({ message: { chat: { id: 7, type: 'private' }, text, message_id: id++ } }, deps),
    voice: (duration = 5) => handleUpdate({ message: { chat: { id: 7, type: 'private' }, voice: { file_id: 'abc', duration }, message_id: id++ } }, deps),
    press: (data) => handleUpdate({ callback_query: { id: 'cb', data, message: { chat: { id: 7 }, message_id: 555 } } }, deps),
    last: () => sent[sent.length - 1],
    lastEdit: () => edits[edits.length - 1],
    data: (view) => (view?.buttons ?? []).flat().map((b) => b.data),
    sync: (body) => mod.handleSync(body, { store, tg, now: () => state.now }),
  };
}
async function paired(ai, at) {
  const w = world(ai, at);
  await w.say('/start sesame');
  w.sent.length = 0;
  return w;
}
const plain = (html) => html.replace(/<[^>]+>/g, '');

// 12:00Z is 15:30 in Tehran, Friday 2 October 2026; tomorrow is Saturday the 3rd.
{
  const ai = scripted(
    says('', call('add_task', { title: 'تماس با سارا', plan_date: '2026-10-03', plan_start: '09:00', plan_end: '09:30', tags: ['#کار'], priority: 'high' }), call('add_task', { title: 'خرید نان', plan_date: '2026-10-03', plan_start: '18:00' }))
  );
  const w = await paired(ai);
  await w.say('فردا ساعت ۹ با سارا تماس بگیرم و عصر نان بخرم');

  eq(w.thought, [[7, '<tg-thinking>دارم فکر می‌کنم …</tg-thinking>']], 'while the model thinks the chat shows a «Thinking…» placeholder');
  eq(w.reacted, [[7, 101, '👀'], [7, 101, '👌']], 'and the message itself gets a glance at once, and a thumbs-up when the work is done');
  eq(w.last().options.replyTo, 101, 'the answer hangs from the message it answers');
  const system = ai.asked[0][0].content;
  eq([ai.asked[0].map((m) => m.role), ai.asked[0][1].content], [['system', 'user'], 'فردا ساعت ۹ با سارا تماس بگیرم و عصر نان بخرم'], 'the model gets its instructions and the words as they were written');
  eq(system.includes('Friday 2026-10-02 (جمعه 10 مهر 1405), 15:30, time zone Asia/Tehran'), true, 'and is told today in the owner’s zone');

  eq(w.store.tasks.map((t) => [t.n, t.title, t.plan_date, t.plan_start, t.plan_end, t.priority, t.tags, t.pending, t.origin]), [
    [1, 'تماس با سارا', '2026-10-03', '09:00', '09:30', 'high', ['کار'], true, 'telegram'],
    [2, 'خرید نان', '2026-10-03', '18:00', null, null, [], true, 'telegram'],
  ], 'one task for each add_task, planned as the model said and tagged and prioritised');
  eq(w.store.tasks.map((t) => t.remind_at), ['2026-10-03T05:20:00.000Z', '2026-10-03T14:20:00.000Z'], 'each reminded before its plan, as a task typed in would be');
  eq(w.store.commands.map((c) => [c.kind, c.payload.title, c.payload.day]), [['add', 'تماس با سارا', '2026-10-03'], ['add', 'خرید نان', '2026-10-03']], 'and each waits for the plugin, to be written into that day’s note');

  const card = w.last();
  const text = plain(card.text);
  eq(text.includes('انجام شد') && text.includes('تسک تازه') && text.includes('۱. تماس با سارا') && text.includes('۲. خرید نان'), true, 'the card lists what was made, numbered');
  eq(text.includes('فردا ۰۹:۰۰–۰۹:۳۰') && text.includes('فردا ۱۸:۰۰'), true, 'with the plan in the owner’s words, so a wrong day shows at once');
  eq(w.data(card), ['t:1@a0', 't:2@a0', 'ux:1.2', 'home', 'ls:t:0', 'ls:a:0', 'new', 'set'], 'a button to open each task, one to take it all back, and the tab bar');

  // The model may follow up: «no, Friday» is read with what was said before.
  const second = scripted(says('', call('update_task', { n: 2, plan_date: '2026-10-09' })));
  w.deps.ai = second;
  w.state.now = new Date('2026-10-02T12:05:00Z');
  await w.say('نه، نان جمعه');
  eq(second.asked[0].map((m) => m.role), ['system', 'user', 'assistant', 'user'], 'the earlier turns are given to the model');
  eq(second.asked[0][1].content, 'فردا ساعت ۹ با سارا تماس بگیرم و عصر نان بخرم', 'the first words');
  eq(second.asked[0][2].content.includes('Created #2 خرید نان — plan 2026-10-03 18:00'), true, 'and what was done, with the task numbers, so “the bread” can be found');
  eq([w.store.tasks[1].plan_date, w.store.tasks[1].plan_start], ['2026-10-09', '18:00'], 'update_task moves the day and keeps the hour');
  eq(w.store.commands.at(-1).kind, 'plan', 'by the same command a tap would queue');
  eq(plain(w.last().text).includes('تغییر کرد') && plain(w.last().text).includes('جمعه'), true, 'and the card says it changed');
  eq(w.data(w.last()).includes('ux:2'), false, 'a change has no “take it all back”: only new tasks do');

  // After half an hour the conversation is forgotten.
  const third = scripted(says('سلام'));
  w.deps.ai = third;
  w.state.now = new Date('2026-10-02T13:00:00Z');
  await w.say('hi');
  eq(third.asked[0].map((m) => m.role), ['system', 'user'], 'an old conversation is not given to the model');
}

{
  // What the model gets wrong is caught.
  const ai = scripted(
    says(
      'Done.',
      call('add_task', { title: 'سررسید مالیات', plan_date: '1405-07-25' }),
      call('add_task', { title: 'بدون روز درست', plan_date: 'next fortnight', plan_start: '25:00' }),
      call('add_task', { title: 'دارو', remind: '2026-09-01 08:00', plan_date: '2026-10-03', plan_start: '08:00' }),
      call('add_task', { title: '  ' }),
      call('add_task', { title: 'ورزش', repeat: '1w', tags: ['health', 'health'], deadline: '2026-10-30' }),
      call('mystery', {})
    )
  );
  const w = await paired(ai);
  await w.say('چند کار');
  eq(w.store.tasks.map((t) => [t.title, t.plan_date, t.plan_start, t.remind_at]), [
    ['سررسید مالیات', '2026-10-17', null, null],
    ['بدون روز درست', '2026-10-02', null, null],
    ['دارو', '2026-10-03', '08:00', '2026-10-03T04:20:00.000Z'],
    ['ورزش', '2026-10-02', null, null],
  ], 'a Jalali day is converted, a day or hour that cannot be read is left out (the task is planned for today, the day it was made), a reminder in the past is dropped (the plan’s own reminder stays)');
  eq([w.store.tasks[3].repeat, w.store.tasks[3].tags, w.store.tasks[3].deadline], ['1w', ['health'], '2026-10-30'], 'a repeat, tags without repeats, and a deadline');
  eq(w.store.commands.filter((c) => c.kind === 'edit').map((c) => c.payload.repeat), ['1w'], 'the repeat is queued as the edit it is');
  const text = plain(w.last().text);
  eq(['next fortnight', '25:00', 'عنوانی نبود', 'یادآوری'].every((part) => text.includes(part)), true, 'every field left out is said, so nothing is silently different');

  // The same task twice is one task.
  w.deps.ai = scripted(says('', call('add_task', { title: 'دارو', plan_date: '2026-10-03' })));
  await w.say('دارو');
  eq([w.store.tasks.length, plain(w.last().text).includes('از قبل هست')], [4, true], 'asking again does not make a second task');
}

{
  // Changing, finishing, deleting, looking up.
  const ai = scripted(
    says('', call('update_task', { n: 1, title: 'Report v2', plan_date: 'none', deadline: '2026-10-20', priority: 'low', add_tags: ['writing'], remove_tags: ['work'], remind: 'default' }), call('set_status', { n: 2, status: 'done' }), call('delete_task', { n: 3 }), call('update_task', { n: 99, title: 'x' }), call('set_status', { n: 1, status: 'asleep' }))
  );
  const w = await paired(ai);
  await w.sync({
    snapshot: [
      { key: 'A.md|^1|0', title: 'Report', status: 'open', tags: ['work'], plan_date: '2026-10-05', plan_start: '09:00' },
      { key: 'A.md|^2|0', title: 'Pay rent', status: 'open', tags: [] },
      { key: 'A.md|^3|0', title: 'Old idea', status: 'open', tags: [] },
    ],
  });
  w.sent.length = 0;
  await w.say('گزارش را عوض کن، اجاره را تیک بزن، ایده را حذف کن');
  const report = w.store.tasks[0];
  eq([report.title, report.plan_date, report.plan_start, report.deadline, report.priority, report.tags], ['Report v2', null, null, '2026-10-20', 'low', ['writing']], 'update_task changes only what it is given, and “none” takes the task off the calendar');
  eq(w.store.commands.map((c) => c.kind), ['edit', 'plan', 'remind', 'status'], 'through the edit, plan, reminder and status commands the buttons use');
  eq([w.store.tasks[1].status, w.store.tasks.length], ['done', 3], 'set_status marks it done');
  eq(w.store.commands.some((c) => c.kind === 'delete'), false, 'delete_task deletes nothing');
  const card = w.last();
  const text = plain(card.text);
  eq(['حذف را تأیید کن', 'Old idea', 'وضعیت', 'Pay rent', 'تغییر کرد', 'Report v2'].every((part) => text.includes(part)), true, 'the card has the change, the status and what waits for a yes');
  eq(['99', 'asleep'].every((part) => text.includes(part)), true, 'a number that is no task, and a status that is none, are named');
  eq(w.data(card).includes('del:3@a0'), true, 'a button asks the usual “delete?”');
  await w.press('del:3@a0');
  eq(w.data(w.lastEdit()).includes('delok:3@a0'), true, 'which still wants its confirmation');
  eq(w.store.tasks.length, 3, 'so the task is still there');

  // A question: the model looks, then answers.
  const asking = scripted(says('', call('find_tasks', { text: 'report' })), (messages) => {
    const results = messages.at(-1).content;
    return says(results.includes('Report') ? 'Tomorrow you have no plan; Report is due Oct 20.' : 'no results seen');
  });
  w.deps.ai = asking;
  w.sent.length = 0;
  await w.say('فردا چه دارم؟');
  eq(asking.asked.length, 2, 'a lookup is followed by a second question to the model, with what was found');
  eq(asking.asked[1].at(-1).content.startsWith('[Results]\nfind_tasks: '), true, 'in a [Results] message');
  eq(plain(w.last().text), '🤖 Tomorrow you have no plan; Report is due Oct 20.', 'and its answer is the card');
  eq(w.data(w.last()), ['home', 'ls:t:0', 'ls:a:0', 'new', 'set'], 'with only the tab bar under it');
}

{
  // Taking it back.
  const ai = scripted(says('', call('add_task', { title: 'الف' }), call('add_task', { title: 'ب', plan_date: '2026-10-04' })));
  const w = await paired(ai);
  await w.sync({ snapshot: [{ key: 'A.md|^1|0', title: 'Mine from the notes', status: 'open', tags: [] }] });
  await w.say('الف و ب');
  eq(w.store.tasks.map((t) => t.n), [1, 2, 3], 'numbers go on from the notes’ tasks');
  eq(w.data(w.last()).filter((d) => d.startsWith('ux:')), ['ux:2.3'], 'undo is for the two new ones');
  await w.press('ux:1.2.3');
  eq(w.store.tasks.map((t) => t.title), ['Mine from the notes'], 'undo removes what the bot made and never a task from the notes, even when its number is in the data');
  eq((await w.store.pendingCommands()).filter((c) => c.kind === 'add').length, 0, 'the wish to add them is cancelled before the plugin sees it');
  eq(plain(w.lastEdit().text).includes('۲ تسک برگردانده شد'), true, 'and it says how many');
}

{
  // A model that gives one command to a reply is asked again until it has done what was asked.
  const ai = scripted(
    says('', call('add_task', { title: 'اول', plan_date: '2026-10-03' })),
    says('', call('add_task', { title: 'دوم', plan_date: '2026-10-04' })),
    says('هر دو را گذاشتم.')
  );
  const w = await paired(ai);
  await w.say('اول و دوم');
  eq([ai.asked.length, w.store.tasks.map((t) => t.title)], [3, ['اول', 'دوم']], 'a lone command is followed by another question, and that by a last one');
  eq(ai.asked[1].at(-1).content.includes('[Results]\nadd_task: created\n[End of results]') && ai.asked[1].at(-1).content.includes('never repeat one that is done'), true, 'which carries what was done and the warning not to do it twice');
  eq(plain(w.last().text).includes('هر دو را گذاشتم.'), true, 'the model’s last sentence is on the card');

  // A model that repeats the first command is not obeyed twice.
  const again = scripted(says('', call('add_task', { title: 'کار', plan_date: '2026-10-03' })), says('', call('add_task', { title: 'کار', plan_date: '2026-10-03' })), says('تمام'));
  const x = await paired(again);
  await x.say('کار');
  eq([x.store.tasks.length, plain(x.last().text).includes('از قبل هست')], [1, true], 'repeating itself makes no second task');

  // A model that stops partway still keeps what it did.
  const dies = scripted(says('', call('add_task', { title: 'یک' })), new AiError('busy', 'gone'));
  const y = await paired(dies);
  await y.say('یک و دو');
  eq([y.store.tasks.length, plain(y.last().text).includes('تسک تازه')], [1, true], 'if the second question fails, the first answer’s work stands and is shown');
}

{
  // Slips of the model's: a wrong year, digits in Persian.
  const ai = scripted(says('', call('add_task', { title: 'سال غلط', plan_date: '2025-10-03' }), call('add_task', { title: 'خیلی دور', deadline: '2040-01-01' }), call('add_task', { title: 'دیروز', plan_date: '2026-10-01' })), says('', call('set_status', { n: '۱', status: 'doing' })));
  const w = await paired(ai);
  await w.say('سه چیز');
  eq(w.store.tasks.map((t) => [t.title, t.plan_date, t.deadline]), [['سال غلط', '2026-10-02', null], ['خیلی دور', '2026-10-02', null], ['دیروز', '2026-10-01', null]], 'a day a year back or years ahead is a slip and is left out (the task is planned for today instead); yesterday is fine');
  eq(plain(w.last().text).includes('2025-10-03') && plain(w.last().text).includes('2040-01-01'), true, 'and named');
  w.deps.ai = scripted(says('', call('set_status', { n: '۱', status: 'doing' })), says(''));
  await w.say('شروع کردم');
  eq(w.store.tasks[0].status, 'doing', 'a task number written in Persian digits is understood');
}

{
  // A model that cannot be given functions is told the commands in words.
  const sent = [];
  const fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    sent.push(body);
    return body.tools
      ? new Response(JSON.stringify({ success: false, errors: [{ code: 5006, message: 'bad input' }] }), { status: 400 })
      : new Response(JSON.stringify({ choices: [{ message: { content: 'Here: {"say":"ok","commands":[{"name":"add_task","arguments":{"title":"x"}},{"name":"add_task","arguments":{"title":"y"}}]}' } }] }));
  };
  const ai = mod.cloudflareAi({ accountId: 'a', token: 't', fetch });
  const answer = await ai.chat([{ role: 'system', content: 'S' }, { role: 'user', content: 'u' }], mod.AI_TOOLS);
  eq([sent.length, 'tools' in sent[1], sent[1].messages[0].content.startsWith('S\n\nYou have no function-calling interface')], [2, false, true], 'a refused request is repeated without functions, the commands described in the instructions');
  eq([answer.text, answer.calls.map((c) => c.args.title)], ['ok', ['x', 'y']], 'and several commands in one JSON reply are all read');
}

{
  // Decoration never stops the work: a reaction or a placeholder that fails changes nothing, and a Telegram without them still works.
  const ai = scripted(says('', call('add_task', { title: 'الف' }), call('add_task', { title: 'ب' })));
  const w = await paired(ai);
  w.deps.tg.react = async () => { throw new Error('REACTION_INVALID'); };
  w.deps.tg.thinking = async () => { throw new Error('method not found'); };
  await w.say('الف و ب');
  eq([w.store.tasks.length, plain(w.last().text).includes('تسک تازه')], [2, true], 'a reaction and a placeholder that fail change nothing');

  const bare = scripted(says('', call('add_task', { title: 'ج' }), call('add_task', { title: 'د' })));
  const x = await paired(bare);
  delete x.deps.tg.react;
  delete x.deps.tg.thinking;
  await x.say('ج و د');
  eq([x.store.tasks.length, x.typed], [2, [7]], 'and without them it falls back to «typing…»');

  const answer = scripted(says('امروز کاری نداری.'));
  const y = await paired(answer);
  await y.say('چه دارم؟');
  eq(y.reacted.map((r) => r[2]), ['👀', '👍'], 'an answer in words ends with a thumbs-up, not the “done” sign');
}

{
  // The limits.
  const many = Array.from({ length: 30 }, (_, i) => call('add_task', { title: `کار ${i + 1}`, plan_date: '2026-10-04' }));
  const w = await paired(scripted(says('', ...many)));
  await w.store.patchOwner({ ai_confirm: 'auto' });
  await w.say('همه‌اش');
  eq([w.store.tasks.length, plain(w.last().text).includes('فقط چند کار اول')], [25, true], 'at most twenty-five commands a time, and the rest is said');
  eq(w.data(w.last()).find((d) => d.startsWith('ux:')).split(':')[1].split('.').length, 10, 'the undo button reaches ten, what fits in its data');
}

{
  // When the model cannot be had.
  const quota = new AiError('quota', 'limit');
  const w = await paired(scripted(quota, quota, new AiError('auth', 'no'), new AiError('busy', 'slow')));
  await w.say('buy bread tomorrow 9');
  eq(w.reacted.at(-1), [7, 101, '🤔'], 'a failure leaves a puzzled face on the message');
  eq(w.store.tasks.map((t) => [t.title, t.plan_date, t.plan_start]), [['buy bread', '2026-10-03', '09:00']], 'if the assistant fails, what was written still becomes a task, the plain way');
  eq(plain(w.sent.at(-2).text).includes('سهمیهٔ رایگان') && plain(w.sent.at(-2).text).includes('مثل همیشه'), true, 'after saying why');
  await w.say('/ai buy milk');
  eq([w.store.tasks.length, plain(w.last().text).includes('سهمیهٔ رایگان')], [1, true], 'but when it was called by name, only the reason is given');
  await w.say('/ai buy milk');
  eq(plain(w.last().text).includes('CF_API_TOKEN'), true, 'a refused key says which secrets to look at');
  await w.say('/ai buy milk');
  eq(plain(w.last().text).includes('Cloudflare جواب نداد'), true, 'and a Cloudflare that does not answer says so');
}

{
  // The switch.
  const ai = scripted(says('', call('add_task', { title: 'کار با دستیار' })), says('انجام شد'));
  const w = await paired(ai);
  await w.say('/start');
  eq(w.data(w.last()).includes('ai'), true, 'the menu has the assistant when it is set up');
  await w.press('set');
  eq(w.data(w.lastEdit()).includes('set:ai'), true, 'and so do the settings');
  eq(plain(w.lastEdit().text).includes('دستیار هوشمند · روشن'), true, 'on to begin with');
  await w.press('set:ai');
  eq([w.store.owner.ai, plain(w.lastEdit().text).includes('دستیار هوشمند · خاموش')], [false, true], 'a tap turns it off');
  await w.say('کار ساده فردا');
  eq([ai.asked.length, w.store.tasks[0].title, w.store.tasks[0].plan_date], [0, 'کار ساده', '2026-10-03'], 'then words are read the plain way and the model is not asked');
  await w.say('/ai کار با دستیار');
  eq([ai.asked.length, w.store.tasks.length], [2, 2], 'but /ai still asks it (twice: a lone change is followed by a look at whether more was asked)');
  await w.say('/ai');
  eq(plain(w.last().text).includes('الان خاموش است'), true, '/ai alone says what it is and what state it is in');
  await w.press('set:ai');
  eq(w.store.owner.ai, true, 'and a tap turns it on');
}

{
  // Not set up.
  const w = await paired();
  await w.say('/start');
  eq(w.data(w.last()).includes('ai'), false, 'without its keys the menu does not offer it');
  await w.say('/ai');
  eq(plain(w.last().text).includes('هنوز راه‌اندازی نشده'), true, '/ai says how to set it up');
  await w.say('/ai call Sara');
  eq([plain(w.last().text).includes('راه‌اندازی نشده'), w.store.tasks.length], [true, 0], 'and does nothing with words');
  await w.press('set:ai');
  eq(w.toasts.at(-1).includes('راه‌اندازی نشده'), true, 'the switch says so too');
  await w.say('buy bread');
  eq(w.store.tasks.length, 1, 'plain tasks work as they always did');
  await w.voice();
  eq(plain(w.last().text).includes('دستیار هوشمند باید راه‌اندازی شده باشد'), true, 'a voice message says it needs the assistant');
}

{
  // Voice.
  const ai = scripted(says('', call('add_task', { title: 'قرار دکتر', plan_date: '2026-10-04', plan_start: '16:00' })));
  ai.transcripts.push('فردا ساعت چهار قرار دکتر دارم', new AiError('quota', 'x'), '   ', new Error('not audio'));
  const w = await paired(ai);
  await w.voice(8);
  eq(ai.heard, { size: 3, language: 'fa' }, 'the recording is downloaded from Telegram and sent to be read, in the owner’s language');
  eq(ai.asked[0].at(-1).content, 'فردا ساعت چهار قرار دکتر دارم', 'the words go to the assistant as if written');
  eq(plain(w.last().text).startsWith('🎙 «فردا ساعت چهار قرار دکتر دارم»'), true, 'the card starts with what was heard, so a misheard word shows at once');
  eq(w.thought[0][1], '<p>🎙 <i>«فردا ساعت چهار قرار دکتر دارم»</i></p><tg-thinking>دارم فکر می‌کنم …</tg-thinking>', 'and the placeholder shows it already');
  eq(w.reacted[0], [7, 101, '👀'], 'the glance goes on the voice message');
  eq(w.store.tasks[0].plan_start, '16:00', 'and the task is made');

  await w.voice(600);
  eq(plain(w.last().text).includes('خیلی طولانی'), true, 'a long recording is refused');
  await w.voice(5);
  eq(plain(w.last().text).includes('سهمیهٔ رایگان'), true, 'a failure at Cloudflare is explained');
  await w.voice(5);
  eq(plain(w.last().text).includes('چیزی نفهمیدم'), true, 'silence is said to be silence');
  await w.voice(5);
  eq(plain(w.last().text).includes('ویس را نتوانستم بخوانم'), true, 'and anything else is a plain “could not read it”');
  eq(w.store.tasks.length, 1, 'with no task made from nothing');
}

// ── Showing first ──────────────────────────────────────────────────────────
{
  // A big job is shown before it is done; the owner decides.
  const many = Array.from({ length: 6 }, (_, i) => call('add_task', { title: `کار ${i + 1}`, plan_date: '2026-10-04', plan_start: `${String(9 + i).padStart(2, '0')}:00` }));
  const w = await paired(scripted(says('این‌ها را چیدم.', ...many)));
  await w.say('شش کار برای یکشنبه');
  eq([w.store.tasks.length, w.store.commands.length], [0, 0], 'nothing is made or queued while the plan is only shown');
  const preview = w.last();
  const text = plain(preview.text);
  eq(text.startsWith('🤖 پیش‌نمایش — هنوز چیزی اعمال نشده\nاین‌ها را چیدم.'), true, 'the card says it is a preview, with the model’s words');
  eq(text.includes('تسک تازه') && text.includes('• کار 1') && text.includes('• کار 6'), true, 'and lists what would be made, with dots for numbers they do not have yet');
  eq(w.data(preview), ['ap', 'ac', 'home', 'ls:t:0', 'ls:a:0', 'new', 'set'], 'with Apply and Cancel, and nothing to open yet');
  eq([w.store.owner.ai_pending.calls.length, w.store.owner.ai_pending.text], [6, 'شش کار برای یکشنبه'], 'the commands wait in the database for an answer');
  eq(w.reacted.map((r) => r[2]), ['👀'], 'the message keeps its glance until the owner decides');
  eq(w.store.owner.ai_memory.at(-1).content.includes('NOT accepted'), true, 'the memory says the plan was only proposed, so the next sentence is not read as if it were done');

  await w.press('ap');
  eq(w.store.tasks.map((t) => [t.n, t.title, t.plan_start]), [[1, 'کار 1', '09:00'], [2, 'کار 2', '10:00'], [3, 'کار 3', '11:00'], [4, 'کار 4', '12:00'], [5, 'کار 5', '13:00'], [6, 'کار 6', '14:00']], 'Apply makes them, numbered, as typed in');
  eq([w.store.commands.filter((c) => c.kind === 'add').length, w.store.owner.ai_pending], [6, null], 'queued for the notes, and the waiting plan is gone');
  const applied = w.edits.at(-1);
  eq([plain(applied.text).startsWith('🤖 انجام شد'), plain(applied.text).includes('۱. کار 1'), w.data(applied).includes('ux:1.2.3.4.5.6')], [true, true, true], 'the same message becomes the card of what was done, with its undo');
  await w.press('ap');
  eq([w.store.tasks.length, w.toasts.at(-1)], [6, 'این پیشنهاد دیگر معتبر نیست؛ دوباره بخواه.'], 'a second tap does nothing twice');
}
{
  // Cancel, expiry, and a database that cannot keep the plan.
  const many = () => says('', ...Array.from({ length: 5 }, (_, i) => call('add_task', { title: `م ${i + 1}` })));
  const w = await paired(scripted(many()));
  await w.say('پنج تا');
  await w.press('ac');
  eq([w.store.tasks.length, w.store.owner.ai_pending, plain(w.edits.at(-1).text).replace(/[\n\u2800]+$/, '')], [0, null, '✖ لغو شد؛ چیزی تغییر نکرد.'], 'Cancel drops the plan');

  const late = await paired(scripted(many()));
  await late.say('پنج تا');
  late.state.now = new Date('2026-10-02T13:00:00Z');
  await late.press('ap');
  eq([late.store.tasks.length, late.toasts.at(-1).includes('معتبر نیست')], [0, true], 'a plan nobody answered for half an hour is too old to apply');

  const stuck = await paired(scripted(many()));
  const patch = stuck.store.patchOwner.bind(stuck.store);
  stuck.store.patchOwner = async (p) => { if ('ai_pending' in p && p.ai_pending) throw new Error('column "ai_pending" does not exist'); return patch(p); };
  await stuck.say('پنج تا');
  eq([stuck.store.tasks.length, plain(stuck.last().text).startsWith('🤖 انجام شد')], [5, true], 'where the plan cannot be kept it is done at once, as before');
}
{
  // The setting: always, only big jobs, never.
  const few = () => scripted(says('', call('add_task', { title: 'یک' }), call('add_task', { title: 'دو' })));
  const small = await paired(few());
  await small.say('دو تا');
  eq([small.store.tasks.length, small.store.owner.ai_pending ?? null], [2, null], 'a small job is done at once, by default');
  const ask = await paired(few());
  await ask.store.patchOwner({ ai_confirm: 'ask' });
  await ask.say('دو تا');
  eq([ask.store.tasks.length, ask.store.owner.ai_pending.calls.length], [0, 2], 'with “always show first” even a small job waits');
  const never = await paired(scripted(says('', ...Array.from({ length: 6 }, (_, i) => call('add_task', { title: `ن ${i}` })))));
  await never.store.patchOwner({ ai_confirm: 'auto' });
  await never.say('شش تا');
  eq(never.store.tasks.length, 6, 'with “never ask” even a big job is done at once');
  const answer = await paired(scripted(says('فردا کاری نداری.')));
  await answer.store.patchOwner({ ai_confirm: 'ask' });
  await answer.say('فردا چه دارم؟');
  eq([plain(answer.last().text).replace(/[\n\u2800]+$/, ''), answer.data(answer.last()).includes('ap')], ['🤖 فردا کاری نداری.', false], 'an answer in words has nothing to apply, whatever the setting');
}

// ── Breaking a task into steps ─────────────────────────────────────────────
{
  const ai = scripted(
    says('', call('add_task', { title: 'Read chapters 1–3', parent_n: 1 }), call('add_task', { title: 'Solve past papers', parent_n: '۱', plan_date: '2026-10-04' }), call('add_task', { title: 'Sleep early', parent_n: 2 }), call('add_task', { title: 'Orphan', parent_n: 99 }))
  );
  const w = await paired(ai);
  await w.sync({ snapshot: [
    { key: 'A.md|^1|0', title: 'Prepare for the exam', status: 'open', tags: [] },
    { key: 'A.md|^2|0', title: 'Already a step', status: 'open', tags: [], parent_key: 'A.md|^1|0', parent_title: 'Prepare for the exam' },
  ] });
  w.sent.length = 0;
  await w.say('درس را به مرحله بشکن');
  eq(ai.asked[0][0].content.includes('#2 Already a step — subtask of «Prepare for the exam»') && ai.asked[0][0].content.includes('To break a task into steps'), true, 'the model is shown which tasks are subtasks, and how to break one into steps');
  const steps = w.store.tasks.filter((t) => t.origin === 'telegram');
  eq(steps.map((t) => [t.title, t.parent_key, t.parent_title, t.plan_date]), [['Read chapters 1–3', 'A.md|^1|0', 'Prepare for the exam', '2026-10-02'], ['Solve past papers', 'A.md|^1|0', 'Prepare for the exam', '2026-10-04']], 'each step is a subtask of the task, Persian digits in its number understood');
  eq(w.store.commands.map((c) => [c.kind, c.payload.parent ?? null]), [['add', 'A.md|^1|0'], ['add', 'A.md|^1|0']], 'queued to be written under it');
  eq([w.store.tasks[0].subs_total, w.store.tasks[0].subs_done], [2, 0], 'and its count shows them at once');
  const text = plain(w.last().text);
  eq(['↳', 'Read chapters 1–3', 'Solve past papers'].every((part) => text.includes(part)), true, 'the card lists the steps, each saying whose it is');
  eq(['Sleep early', 'Orphan'].some((title) => w.store.tasks.some((t) => t.title === title)), false, 'a step under a subtask, or under a task that does not exist, is not made');
  eq(text.includes('99'), true, 'and the number that is no task is named');
}

// ── Plan my day ────────────────────────────────────────────────────────────
{
  // 12:00Z is 15:30 on Friday 2 October.
  const plan = (messages) => {
    const system = messages[0].content;
    return says(
      'چیدم.',
      call('update_task', { n: 1, plan_date: '2026-10-02', plan_start: '16:00', plan_end: '16:45' }),
      call('update_task', { n: 2, plan_date: '2026-10-02', plan_start: '17:00', plan_end: '17:30' }),
      call('update_task', { n: 3, plan_date: '2026-10-03', plan_start: '09:00' }),
      call('update_task', { n: 4, plan_date: '2026-10-03', plan_start: '10:00' }),
      call('update_task', { n: 5, plan_date: '2026-10-03', plan_start: '11:00' })
    );
  };
  const ai = scripted(plan);
  const w = await paired(ai);
  await w.sync({ snapshot: [
    { key: 'A.md|^1|0', title: 'Write report', status: 'open', tags: [] },
    { key: 'A.md|^2|0', title: 'Call the bank', status: 'open', tags: [], plan_date: '2026-10-01' },
    { key: 'A.md|^3|0', title: 'Laundry', status: 'open', tags: [] },
    { key: 'A.md|^4|0', title: 'Read', status: 'open', tags: [] },
    { key: 'A.md|^5|0', title: 'Email Sara', status: 'open', tags: [] },
    { key: 'A.md|^6|0', title: 'Meeting', status: 'open', tags: [], plan_date: '2026-10-02', plan_start: '18:00', plan_end: '19:00' },
  ] });
  w.sent.length = 0;
  await w.say('/planday');
  eq(ai.asked[0].at(-1).content.startsWith('روز من را بچین'), true, '/planday asks the assistant to plan the day');
  eq(ai.asked[0][0].content.includes('#6 Meeting — plan 2026-10-02 18:00-19:00') && ai.asked[0][0].content.includes('When asked to plan or organise the day'), true, 'which sees the hours already taken, and has been told how to plan');
  eq(w.store.tasks.filter((t) => t.plan_start === '16:00').length, 0, 'nothing is changed while the plan waits');
  eq(w.store.owner.ai_pending.calls.length, 5, 'five changes are a big job: the plan waits');
  const preview = plain(w.last().text);
  eq(preview.includes('تغییر می‌کند') || preview.includes('تغییر کرد'), true, 'the card lists the changes');
  eq(['Write report', 'Call the bank', 'Laundry'].every((title) => preview.includes(title)), true, 'with the tasks it would move');
  await w.press('ap');
  eq(w.store.tasks.slice(0, 5).map((t) => [t.plan_date, t.plan_start]), [['2026-10-02', '16:00'], ['2026-10-02', '17:00'], ['2026-10-03', '09:00'], ['2026-10-03', '10:00'], ['2026-10-03', '11:00']], 'Apply sets the hours');
  eq(w.store.tasks[5].plan_start, '18:00', 'and the meeting that had its hour is where it was');
  eq(w.store.commands.filter((c) => c.kind === 'plan').length, 5, 'by the plan command');
  const button = await paired(scripted(plan));
  await button.sync({ snapshot: [{ key: 'A.md|^1|0', title: 'Write report', status: 'open', tags: [] }] });
  await button.press('pd');
  eq(button.store.owner.ai_pending !== null, true, 'the “plan my day” button does the same');
  const without = await paired();
  await without.press('pd');
  eq(without.toasts.at(-1).includes('راه‌اندازی نشده'), true, 'and says so when the assistant is not set up');
}

console.log(`TELEGRAM_ASSISTANT_OK (${checked} checks)`);
