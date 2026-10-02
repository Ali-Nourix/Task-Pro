/**
 * The plugin's side of the Telegram bot: how tasks are named and reported, how
 * the changes asked for in Telegram are made in the notes, and the whole round
 * trip - a message to the bot, the sync, the notes, the sync back - against the
 * bot's real logic on an in-memory store and notes held as lines of text.
 */
import * as esbuild from 'esbuild';

globalThis.window = globalThis;

const build = await esbuild.build({
  stdin: {
    contents: `
      export { parseBoardTasks } from "../src/board/task-store";
      export { keyTasks, keyForNewTask, reminderAt, buildSnapshot } from "../src/telegram/snapshot";
      export { applyCommands, lineForNewTask } from "../src/telegram/apply";
      export { TelegramSync, syncEndpoint } from "../src/telegram/sync-service";
      export { setSchedule, setRemind, setPriority, setDeadline, setTags, setRepeat, replaceTaskText } from "../src/task-metadata";
      export { handleUpdate } from "../supabase/functions/_shared/bot.ts";
      export { handleSync } from "../supabase/functions/_shared/sync.ts";
      export { runTick } from "../supabase/functions/_shared/tick.ts";
      export { MemoryStore } from "../supabase/functions/_shared/memory-store.ts";
    `,
    resolveDir: new URL('.', import.meta.url).pathname,
    loader: 'ts',
  },
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
  logLevel: 'error',
  plugins: [
    {
      name: 'mock-obsidian',
      setup(b) {
        b.onResolve({ filter: /^obsidian$/ }, () => ({ path: 'obsidian', namespace: 'mock' }));
        b.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({ contents: 'export const setIcon = () => {};', loader: 'js' }));
      },
    },
  ],
});
const mod = await import('data:text/javascript;base64,' + Buffer.from(build.outputFiles[0].text).toString('base64'));
const { parseBoardTasks, keyTasks, keyForNewTask, reminderAt, buildSnapshot, applyCommands, lineForNewTask, TelegramSync, syncEndpoint, setSchedule, setRemind, setPriority, setDeadline, setTags, setRepeat, replaceTaskText } = mod;

let checked = 0;
function eq(actual, expected, label) {
  checked++;
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${label}:\n  got      ${a}\n  expected ${e}`);
}

// ── Keys and the snapshot ──────────────────────────────────────────────────
const tasksOf = (path, text) => parseBoardTasks(path, text);
const two = tasksOf('A.md', ['- [ ] Same', '- [ ] Same', '- [ ] Own id ^tp-1', '- [x] Finished', '- [/] Doing @priority(high) @tag(work)'].join('\n'));
eq([...keyTasks(two).keys()], ['A.md|Same|0', 'A.md|Same|1', 'A.md|^tp-1|0', 'A.md|Finished|0', 'A.md|Doing|0'], 'a task is named by its note, its block ID or title, and which of the same');
eq(keyForNewTask(two, 'A.md', 'Same'), 'A.md|Same|2', 'a task about to be appended is named the same way');
eq(keyForNewTask(two, 'B.md', 'Same'), 'B.md|Same|0', 'in another note, from the start');

const defaults = { enabled: true, leadMinutes: 10 };
const at = (line) => reminderAt(tasksOf('A.md', line)[0], defaults);
const local = (y, m, d, h, mi) => new Date(y, m - 1, d, h, mi).toISOString();
eq(at('- [ ] x @schedule(2026-10-05 09:30-10:00)'), local(2026, 10, 5, 9, 20), 'a plan with a time reminds ten minutes before, by the setting');
eq(at('- [ ] x @schedule(2026-10-05 09:30) @remind(1h)'), local(2026, 10, 5, 8, 30), 'or by its own lead');
eq(at('- [ ] x @schedule(2026-10-05 09:30) @remind(off)'), null, 'or not at all');
eq(at('- [ ] x @schedule(2026-10-05)'), null, 'a whole-day plan has no reminder');
eq(at('- [ ] x @remind(2026-10-06 18:00)'), local(2026, 10, 6, 18, 0), 'a moment of its own, planned or not');
eq(at('- [ ] x @schedule(2026-10-05 09:30) @remind(2026-10-04 20:00)'), local(2026, 10, 4, 20, 0), 'and it replaces the lead');
eq(reminderAt(tasksOf('A.md', '- [ ] x @schedule(2026-10-05 09:30)')[0], { enabled: false, leadMinutes: 10 }), null, 'with the setting off, a plan alone has none');

const snapshot = buildSnapshot(two, defaults);
eq(snapshot.map((t) => [t.key, t.status]), [['A.md|Same|0', 'open'], ['A.md|Same|1', 'open'], ['A.md|^tp-1|0', 'open'], ['A.md|Doing|0', 'doing']], 'only the open tasks are reported');
eq(snapshot[3], { key: 'A.md|Doing|0', title: 'Doing', status: 'doing', priority: 'high', deadline: null, plan_date: null, plan_start: null, plan_end: null, remind_at: null, repeat: null, tags: ['work'], note_path: 'A.md' }, 'with what is set on them');
eq(buildSnapshot(tasksOf('A.md', '- [ ] Weekly @repeat(2w)\n- [ ] Daily @repeat(daily)'), defaults).map((t) => t.repeat), ['2w', '1d'], 'a repeating task says how often, as 2w');

// ── A task made in Telegram ────────────────────────────────────────────────
const line = lineForNewTask({ title: 'Buy bread', priority: 'high', tags: ['home'], deadline: '2026-10-09', plan: { date: '2026-10-03', start: '09:00', end: '10:00' }, remind: { date: '2026-10-03', time: '08:30' } });
const made = tasksOf('Inbox.md', line)[0];
eq([made.text, made.priority, made.tags, made.deadline, made.schedule, made.remindAt], ['Buy bread', 'high', ['home'], '2026-10-09', { date: '2026-10-03', start: '09:00', end: '10:00' }, { date: '2026-10-03', time: '08:30' }], 'it is written as a task line that reads back as it was asked');
eq(lineForNewTask({ title: 'Plain', tags: [] }), '- [ ] Plain', 'a plain one is just its title');
eq(lineForNewTask({ title: 'x', priority: 'nonsense', plan: { date: 'garbage' }, tags: [1] }), '- [ ] x', 'values that are not what they should be are left out');

// ── Applying changes to notes ──────────────────────────────────────────────
/** Notes as lines of text, with the host the plugin gives applying. */
function notes(initial) {
  const files = new Map(Object.entries(initial).map(([path, text]) => [path, text.split('\n')]));
  const all = () => [...files].flatMap(([path, lines]) => parseBoardTasks(path, lines.join('\n')));
  const edit = (task, change) => {
    const lines = files.get(task.filePath);
    const index = lines.findIndex((l) => l === task.line);
    if (index === -1) throw new Error('line changed');
    lines[index] = change(lines[index]);
  };
  const host = {
    tasks: all,
    inboxPath: () => (files.has('Inbox.md') ? 'Inbox.md' : null),
    appendLine: async (path, text) => (files.has(path) ? (files.get(path).push(text), true) : false),
    setStatus: async (task, status) => edit(task, (l) => l.replace(/- \[.\]/, `- ${status}`)),
    setRemind: async (task, value) => edit(task, (l) => setRemind(l, value)),
    setSchedule: async (task, schedule) => edit(task, (l) => setSchedule(l, schedule)),
    setPriority: async (task, priority) => edit(task, (l) => setPriority(l, priority)),
    setDeadline: async (task, deadline) => edit(task, (l) => setDeadline(l, deadline)),
    setTags: async (task, keys) => edit(task, (l) => setTags(l, keys)),
    setRepeat: async (task, repeat) => edit(task, (l) => setRepeat(l, repeat)),
    setText: async (task, text) => edit(task, (l) => replaceTaskText(l, text)),
    deleteTask: async (task) => files.set(task.filePath, files.get(task.filePath).filter((l) => l !== task.line)),
    settled: async () => {},
  };
  return { files, host, text: (path) => files.get(path).join('\n') };
}

{
  const n = notes({ 'Inbox.md': '- [ ] Existing', 'Work.md': ['- [ ] Report @schedule(2026-10-05 09:00)', '- [ ] Other'].join('\n') });
  const results = await applyCommands([
    { id: 'c1', kind: 'add', payload: { key: 'tg:1', title: 'New one', tags: [], plan: { date: '2026-10-06' } } },
    { id: 'c2', kind: 'status', payload: { key: 'tg:1', status: 'doing' } },
    { id: 'c3', kind: 'status', payload: { key: 'Work.md|Other|0', status: 'done' } },
    { id: 'c4', kind: 'remind', payload: { key: 'Work.md|Report|0', moment: { date: '2026-10-05', time: '08:00' } } },
    { id: 'c5', kind: 'plan', payload: { key: 'Work.md|Report|0', plan: null } },
    { id: 'c6', kind: 'status', payload: { key: 'Work.md|Gone|0', status: 'done' } },
    { id: 'c7', kind: 'delete', payload: { key: 'Inbox.md|Existing|0' } },
    { id: 'c8', kind: 'remind', payload: { key: 'Work.md|Report|0', moment: 'default' } },
  ], n.host);
  eq(results.map((r) => [r.id, r.key ?? null, r.error ?? null]), [
    ['c1', 'Inbox.md|New one|0', null],
    ['c2', null, null],
    ['c3', null, null],
    ['c4', null, null],
    ['c5', null, null],
    ['c6', null, 'the task is not in the notes any more'],
    ['c7', null, null],
    ['c8', null, null],
  ], 'each change is made and answered; one that cannot be says why');
  eq(n.text('Inbox.md'), '- [/] New one @schedule(2026-10-06)', 'the new task is in the inbox, and a later change finds it by the key Telegram gave it');
  eq(n.text('Work.md'), ['- [ ] Report', '- [x] Other'].join('\n'), 'ticked, planned off, reminder set and then given back to the setting');
}
{
  const n = notes({ 'Work.md': ['- [ ] Report @priority(low)', '- [ ] Plain ^tp-9', '- [ ] Report'].join('\n') });
  const results = await applyCommands([
    { id: 'e1', kind: 'edit', payload: { key: 'Work.md|Report|0', priority: 'highest', deadline: '2026-10-09', tags: ['Work Stuff', 'home'], repeat: '2w' } },
    { id: 'e2', kind: 'edit', payload: { key: 'Work.md|^tp-9|0', title: 'Renamed' } },
    { id: 'e3', kind: 'edit', payload: { key: 'Work.md|Report|1', title: 'Report two' } },
    { id: 'e4', kind: 'edit', payload: { key: 'Work.md|Report|0', priority: null, deadline: null, tags: [], repeat: null } },
    { id: 'e5', kind: 'edit', payload: { key: 'Work.md|Report two|0', priority: 'urgent' } },
    { id: 'e6', kind: 'edit', payload: { key: 'Work.md|Report two|0', repeat: 'often' } },
    { id: 'e7', kind: 'edit', payload: { key: 'Work.md|Report two|0', title: '  ' } },
  ], n.host);
  eq(results.map((r) => [r.id, r.key ?? null, r.from ?? null, r.error ?? null]), [
    ['e1', null, null, null],
    ['e2', null, null, null],
    ['e3', 'Work.md|Report two|0', 'Work.md|Report|1', null],
    ['e4', null, null, null],
    ['e5', null, null, 'unknown priority'],
    ['e6', null, null, 'unreadable repeat'],
    ['e7', null, null, 'no title'],
  ], 'an edit is made, a rename reports the new key, a bad value is refused with a reason');
  eq(n.text('Work.md'), ['- [ ] Report', '- [ ] Renamed ^tp-9', '- [ ] Report two'].join('\n'), 'the settings are written and then cleared again; a block ID keeps its place');
  const first = notes({ 'Work.md': '- [ ] Report @priority(low)' });
  await applyCommands([{ id: 'x', kind: 'edit', payload: { key: 'Work.md|Report|0', priority: 'highest', deadline: '2026-10-09', tags: ['Work Stuff', 'home'], repeat: '2w' } }], first.host);
  const read = parseBoardTasks('Work.md', first.text('Work.md'))[0];
  eq([read.text, read.priority, read.deadline, read.tags, read.repeat], ['Report', 'highest', '2026-10-09', ['work-stuff', 'home'], { every: 2, unit: 'week' }], 'all of it reads back from the line');
}
{
  const n = notes({ 'Work.md': '- [ ] Only' });
  const [result] = await applyCommands([{ id: 'a', kind: 'add', payload: { key: 'tg:1', title: 'No inbox', tags: [] } }], n.host);
  eq(result.error, 'no inbox note is set', 'with no inbox note a new task says so');
  const [bad] = await applyCommands([{ id: 'b', kind: 'remind', payload: { key: 'Work.md|Only|0', moment: { date: 'x' } } }], n.host);
  eq(bad.error, 'unreadable reminder', 'a reminder it cannot read is refused');
}

eq([syncEndpoint('https://abc.supabase.co'), syncEndpoint('https://abc.supabase.co/'), syncEndpoint('https://abc.supabase.co/functions/v1'), syncEndpoint('https://abc.supabase.co/functions/v1/sync'), syncEndpoint('abc'), syncEndpoint('')], [
  'https://abc.supabase.co/functions/v1/sync', 'https://abc.supabase.co/functions/v1/sync', 'https://abc.supabase.co/functions/v1/sync', 'https://abc.supabase.co/functions/v1/sync', null, null,
], 'the sync address is worked out from whatever is pasted');

// ── The whole round trip ───────────────────────────────────────────────────
{
  const { handleUpdate, handleSync, runTick, MemoryStore } = mod;
  const store = new MemoryStore();
  const sent = [];
  const tg = { send: async (chat, text, buttons) => void sent.push({ text, buttons }), edit: async () => {}, answer: async () => {}, setCommands: async () => {} };
  const clock = { now: new Date('2026-10-02T12:00:00Z') };
  const say = (text) => handleUpdate({ message: { chat: { id: 7, type: 'private' }, text, message_id: 1 } }, { store, tg, pairingCode: 'k', now: () => clock.now });
  await say('/start k');

  const n = notes({ 'Inbox.md': '- [ ] Existing', 'Work.md': '- [ ] Report @schedule(2026-10-03 11:00)' });
  const dropReply = { next: false };
  const settings = { enabled: true, url: 'https://abc.supabase.co', token: 'secret', intervalMinutes: 2 };
  const posts = [];
  const sync = new TelegramSync({
    settings: () => settings,
    tasks: () => n.host.tasks(),
    defaults: () => defaults,
    post: async (url, token, body) => {
      posts.push({ url, token, body });
      if (token !== 'secret') return { status: 403, json: { ok: false } };
      const reply = await handleSync(body, { store, tg, now: () => clock.now });
      if (dropReply.next && body.acks?.length) {
        dropReply.next = false;
        throw new Error('network down');
      }
      return { status: 200, json: JSON.parse(JSON.stringify(reply)) };
    },
    apply: n.host,
    save: async () => {},
    report: () => {},
    registerInterval: () => {},
    now: () => clock.now.getTime(),
  });

  let outcome = await sync.syncNow();
  eq([outcome.ok, outcome.applied], [true, 0], 'a first sync reports the notes');
  eq(posts[0].url, 'https://abc.supabase.co/functions/v1/sync', 'to the sync function');
  eq(store.tasks.map((t) => t.title).sort(), ['Existing', 'Report'], 'and the bot knows the open tasks');
  eq(store.tasks.find((t) => t.title === 'Report').remind_at, local(2026, 10, 3, 10, 50), 'with a reminder ten minutes before the plan');

  await say('Call the vet tomorrow at 10 #health');
  await say('/done 2');
  outcome = await sync.syncNow();
  eq([outcome.ok, outcome.applied, outcome.errors], [true, 2, 0], 'what was asked for in Telegram is made in the notes');
  eq(n.text('Inbox.md'), ['- [ ] Existing', '- [ ] Call the vet @schedule(2026-10-03 10:00) @tag(health)'].join('\n'), 'the new task is in the inbox, planned and tagged');
  eq(n.text('Work.md'), '- [x] Report @schedule(2026-10-03 11:00)', 'the ticked one is ticked');
  const vet = store.tasks.find((t) => t.title === 'Call the vet');
  eq([vet.key, vet.pending, vet.n], ['Inbox.md|Call the vet|0', false, 3], 'the bot has the new task under its note’s key, and its number did not change');
  eq((await store.pendingCommands()).length, 0, 'nothing is left waiting');
  eq(store.tasks.some((t) => t.title === 'Report'), false, 'a task ticked off is no longer open');

  // A title changed in Telegram renames the task in the notes; the bot keeps its number.
  await handleUpdate({ message: { chat: { id: 7, type: 'private' }, text: 'Existing renamed', message_id: 2, reply_to_message: { text: '✏️ عنوان تازه برای #۱\n«Existing»' } } }, { store, tg, pairingCode: 'k', now: () => clock.now });
  outcome = await sync.syncNow();
  eq(n.text('Inbox.md').split('\n')[0], '- [ ] Existing renamed', 'a new title is written into the note');
  const renamed = store.tasks.find((t) => t.title === 'Existing renamed');
  eq([renamed.n, renamed.key], [1, 'Inbox.md|Existing renamed|0'], 'the task keeps its number and takes its new key');
  eq((await store.pendingCommands()).length, 0, 'and nothing is left waiting');

  // The confirmation is lost on the way back: the changes are not made twice.
  await say('another one');
  await say('/remind 1 tomorrow 8');
  dropReply.next = true;
  outcome = await sync.syncNow();
  eq(outcome.ok, false, 'a sync that fails on the way back says so');
  eq(n.text('Inbox.md').split('\n').filter((l) => l.includes('another one')).length, 1, 'but the change was made once');
  eq(settings.unconfirmed.length > 0, true, 'and is remembered as not yet confirmed');
  outcome = await sync.syncNow();
  eq(outcome.ok, true, 'the next sync gets through');
  eq(n.text('Inbox.md').split('\n').filter((l) => l.includes('another one')).length, 1, 'without making it again');
  eq(n.text('Inbox.md').includes('@remind(2026-10-03 08:00)'), true, 'the reminder was written once');
  eq([settings.unconfirmed.length, (await store.pendingCommands()).length], [0, 0], 'and now everything is confirmed');

  // A wrong token.
  settings.token = 'wrong';
  outcome = await sync.syncNow();
  eq([outcome.ok, outcome.message], [false, 'The sync token is not right.'], 'a wrong token is said so');
  eq(settings.lastError, 'The sync token is not right.', 'and kept for the settings screen');
}

console.log(`TELEGRAM_SYNC_OK (${checked} checks)`);
