/**
 * The bot against a real database: the Supabase store (supabase-js through
 * PostgREST) over the real migration, for the parts an in-memory store cannot
 * vouch for - upserts that keep a task's number, the filters, the JSON path
 * match, re-keying. Optional: it needs a local Postgres with
 * supabase/migrations applied and PostgREST in front of it, so `npm test`
 * leaves it out.
 *
 *   TP_REST=http://localhost:3111          PostgREST
 *   TP_SERVICE_KEY=<a JWT with role service_role>
 *   TP_PSQL="psql -h /path -p 54329 -U postgres -d tp -tA"
 *   TP_SUPABASE_JS=/path/to/node_modules   where @supabase/supabase-js is
 *
 *   node test/telegram-supabase.mjs
 */
import * as esbuild from 'esbuild';
import http from 'http';
import { execSync } from 'child_process';
import fs from 'fs';
import { createRequire } from 'module';
import path from 'path';

const { TP_REST, TP_SERVICE_KEY, TP_PSQL, TP_SUPABASE_JS } = process.env;
if (!TP_REST || !TP_SERVICE_KEY || !TP_PSQL || !TP_SUPABASE_JS) {
  console.log('TELEGRAM_SUPABASE_SKIPPED (set TP_REST, TP_SERVICE_KEY, TP_PSQL and TP_SUPABASE_JS to run it)');
  process.exit(0);
}
const require = createRequire(path.join(TP_SUPABASE_JS, 'x.js'));

const build = await esbuild.build({
  stdin: {
    contents: `
      export { handleUpdate } from "../supabase/functions/_shared/bot.ts";
      export { handleSync } from "../supabase/functions/_shared/sync.ts";
      export { runTick } from "../supabase/functions/_shared/tick.ts";
      export { supabaseStore } from "../supabase/functions/_shared/supabase-store.ts";
    `,
    resolveDir: new URL('.', import.meta.url).pathname,
    loader: 'ts',
  },
  bundle: true,
  format: 'cjs',
  platform: 'node',
  write: false,
  logLevel: 'error',
  plugins: [{ name: 'supabase-js', setup: (b) => b.onResolve({ filter: /^npm:@supabase\/supabase-js@2$/ }, () => ({ path: require.resolve('@supabase/supabase-js') })) }],
});
const mod = { exports: {} };
new Function('module', 'exports', 'require', build.outputFiles[0].text)(mod, mod.exports, require);
const { handleUpdate, handleSync, runTick, supabaseStore } = mod.exports;

// supabase-js talks to /rest/v1; PostgREST serves from the root.
const proxy = http.createServer((req, res) => {
  const upstream = http.request(TP_REST + req.url.replace(/^\/rest\/v1/, ''), { method: req.method, headers: req.headers }, (up) => {
    res.writeHead(up.statusCode, up.headers);
    up.pipe(res);
  });
  req.pipe(upstream);
});
await new Promise((resolve) => proxy.listen(0, resolve));
const url = `http://localhost:${proxy.address().port}`;

const psql = (sql) => execSync(`${TP_PSQL} -c "${sql.replace(/"/g, '\\"')}"`, { encoding: 'utf8' }).trim();
let checked = 0;
function eq(actual, expected, label) {
  checked++;
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${label}:\n  got      ${a}\n  expected ${e}`);
}

// The later migrations (the test below drops their columns once, so a run starts by putting them back).
for (const name of ['20261003000000_task_settings.sql', '20261004000000_subtasks.sql', '20261005000000_rich_messages.sql', '20261006000000_message_width.sql', '20261007000000_tags.sql', '20261008000000_ai_assistant.sql']) {
  const sql = fs.readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8').split('\n').filter((line) => !line.startsWith('--')).join('\n');
  psql(sql);
}
psql("notify pgrst, 'reload schema'");
await new Promise((resolve) => setTimeout(resolve, 600));
psql('truncate public.tasks, public.commands, public.bot_owner restart identity');
psql('alter sequence public.tasks_n_seq restart');
const store = supabaseStore(url, TP_SERVICE_KEY);
const sent = [];
const tg = { send: async (chat, text, buttons) => void sent.push({ chat, text, buttons }), edit: async () => {}, answer: async () => {}, setCommands: async () => {} };
const state = { now: new Date('2026-10-02T12:00:00Z') };
const deps = { store, tg, pairingCode: 'sesame', now: () => state.now };
let id = 1;
const say = (text) => handleUpdate({ message: { chat: { id: 7, type: 'private' }, text, message_id: id++ } }, deps);
const press = (data) => handleUpdate({ callback_query: { id: 'c', data, message: { chat: { id: 7 }, message_id: id++ } } }, deps);
const sync = (body) => handleSync(body, { store, tg, now: () => state.now });

try {
  await say('/start sesame');
  eq(psql('select chat_id, timezone, language from bot_owner'), '7|Asia/Tehran|fa', 'pairing writes the owner');

  await say('Buy bread tomorrow at 9 #home !high');
  eq(psql("select n, title, priority, tags, plan_date, plan_start, remind_at, pending, origin from tasks"), '1|Buy bread|high|{home}|2026-10-03|09:00|2026-10-03 05:20:00+00|t|telegram', 'a message becomes a pending task');
  eq(psql("select kind, payload->>'title' from commands"), 'add|Buy bread', 'and an add command');

  const first = await sync({ snapshot: [{ key: 'Work.md|^a|0', title: 'Report', status: 'open', plan_date: '2026-10-02', plan_start: '17:00', remind_at: '2026-10-02T12:05:00Z', tags: ['work'] }] });
  eq(first.commands.map((c) => c.kind), ['add'], 'the plugin is handed the add');
  eq(psql('select count(*) from tasks'), '2', 'the upload adds its task and keeps the pending one');
  eq(psql("select n from tasks where key = 'Work.md|^a|0'"), '2', 'with the next number');

  await sync({
    snapshot: [
      { key: 'Work.md|^a|0', title: 'Report v2', status: 'open', plan_date: '2026-10-02', plan_start: '17:00', remind_at: '2026-10-02T12:05:00Z', tags: ['work'] },
      { key: 'Inbox.md|Buy bread|0', title: 'Buy bread', status: 'open', plan_date: '2026-10-03', plan_start: '09:00', tags: ['home'] },
    ],
    acks: [{ id: first.commands[0].id, key: 'Inbox.md|Buy bread|0' }],
  });
  eq(psql('select n, key, title, pending, origin from tasks order by n'), '1|Inbox.md|Buy bread|0|Buy bread|f|vault\n2|Work.md|^a|0|Report v2|f|vault', 'the added task takes its note’s key and keeps #1; an upload keeps numbers');
  eq(psql('select count(*) from commands where applied_at is null'), '0', 'the add is finished');

  await say('/done 1');
  eq(psql("select status from tasks where n = 1"), 'done', '/done closes it');
  eq(psql("select kind, payload->>'key' from commands where applied_at is null"), 'status|Inbox.md|Buy bread|0', 'and queues the change under the note’s key');
  await sync({ snapshot: [{ key: 'Work.md|^a|0', title: 'Report v2', status: 'open', remind_at: '2026-10-02T12:05:00Z' }, { key: 'Inbox.md|Buy bread|0', title: 'Buy bread', status: 'open' }] });
  eq(psql("select status from tasks where n = 1"), 'done', 'an upload does not undo a change that is waiting');
  const waiting = (await store.pendingCommands())[0];
  await sync({ acks: [{ id: waiting.id }], snapshot: [{ key: 'Work.md|^a|0', title: 'Report v2', status: 'open', remind_at: '2026-10-02T12:05:00Z' }] });
  eq(psql('select count(*) from tasks'), '1', 'once applied, a task gone from the upload is gone');

  state.now = new Date('2026-10-02T12:06:00Z');
  eq(await runTick({ store, tg, now: () => state.now }), 1, 'a reminder due is sent');
  eq(await runTick({ store, tg, now: () => state.now }), 0, 'once');
  eq(psql("select remind_sent_for = remind_at from tasks"), 't', 'and noted');
  await press('snz:2:10');
  eq(psql("select remind_at from tasks"), '2026-10-02 12:16:00+00', 'snoozed');
  state.now = new Date('2026-10-02T12:17:00Z');
  eq(await runTick({ store, tg, now: () => state.now }), 1, 'and sent again');

  await say('/del 2');
  await press('delok:2');
  eq(psql("select count(*) from tasks"), '0', 'delete removes the row');
  eq(psql("select kind from commands where applied_at is null order by created_at"), 'remind\ndelete', 'and queues a delete after the snooze that was waiting');
  await say('call dentist');
  await press('undo:3');
  eq(psql("select count(*) from tasks where pending"), '0', 'undoing a task not yet in a note drops it');
  eq(psql("select error from commands where kind = 'add' and applied_at is not null order by created_at desc limit 1"), 'cancelled', 'and cancels the add');

  // Every setting of a task: the repeat column and the edit command.
  await sync({ snapshot: [{ key: 'W.md|^b|0', title: 'Weekly', status: 'open', repeat: '1w', tags: [] }] });
  eq(psql("select repeat from tasks where key = 'W.md|^b|0'"), '1w', 'an upload carries how often a task repeats');
  const weekly = Number(psql("select n from tasks where key = 'W.md|^b|0'"));
  await press(`qs:${weekly}:2w`);
  eq([psql(`select repeat from tasks where n = ${weekly}`), psql("select kind, payload->>'repeat' from commands where kind = 'edit'")], ['2w', 'edit|2w'], 'a repeat set in Telegram is kept and queued as an edit');
  await press(`pr:${weekly}:off`);
  eq(psql(`select priority is null from tasks where n = ${weekly}`), 't', 'a priority can be cleared');
  const edit = (await store.pendingCommands()).find((c) => c.kind === 'edit');
  await sync({ acks: [{ id: edit.id, key: 'W.md|Weekly|0' }], snapshot: [{ key: 'W.md|Weekly|0', title: 'Weekly', status: 'open', repeat: '2w', tags: [] }] });
  eq(psql("select n, key from tasks where title = 'Weekly'"), `${weekly}|W.md|Weekly|0`, 'a rename reported by the plugin moves the row to its new key and keeps its number');

  // Subtasks.
  await sync({ acks: (await store.pendingCommands()).map((c) => ({ id: c.id })) });
  await sync({ snapshot: [
    { key: 'W.md|Weekly|0', title: 'Weekly', status: 'open', repeat: '2w', subs_done: 1, subs_total: 2, tags: [] },
    { key: 'W.md|Child|0', title: 'Child', status: 'open', parent_key: 'W.md|Weekly|0', parent_title: 'Weekly', tags: [] },
  ] });
  eq(psql("select title, parent_key, parent_title, subs_done, subs_total from tasks order by title"), 'Child|W.md|Weekly|0|Weekly||\nWeekly|||1|2', 'an upload carries who is under whom and the counts');
  await say('/list');
  eq(sent.at(-1).text.includes('↳') && sent.at(-1).text.includes('<code>۱ از ۲</code>'), true, 'and the list shows the subtask under its parent');

  // A database that has not been given the newer columns yet keeps working.
  psql('alter table tasks drop column repeat, drop column parent_key, drop column parent_title, drop column subs_done, drop column subs_total');
  psql("notify pgrst, 'reload schema'");
  await new Promise((resolve) => setTimeout(resolve, 600));
  await sync({ snapshot: [{ key: 'W.md|Weekly|0', title: 'Weekly', status: 'open', repeat: '2w', tags: [] }] });
  await say('plain task');
  eq(psql("select count(*) from tasks"), '2', 'without the columns, uploads and new tasks still go through');
  await store.patchTask('W.md|Weekly|0', { repeat: '1d', title: 'Weekly!' });
  eq(psql("select title from tasks where key = 'W.md|Weekly|0'"), 'Weekly!', 'and so do changes');

  console.log(`TELEGRAM_SUPABASE_OK (${checked} checks)`);
} finally {
  proxy.close();
}
