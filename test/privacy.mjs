/** Redaction regressions: use synthetic canaries, never real credentials. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import * as esbuild from 'esbuild';
let checks = 0;
const ok = (condition, label) => { assert.ok(condition, label); checks++; };
const base = path.resolve(new URL('..', import.meta.url).pathname);
function walk(dir) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, ent.name);
    if (ent.isDirectory()) { if (!['node_modules', 'test', '.git'].includes(ent.name)) walk(file); continue; }
    if (!file.endsWith('.ts')) continue;
    const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    function visit(node) {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
          && node.expression.expression.getText(source) === 'console') {
        ok(node.arguments.length === 1 && (ts.isStringLiteral(node.arguments[0]) || ts.isNoSubstitutionTemplateLiteral(node.arguments[0])), `static diagnostic: ${path.relative(base, file)}`);
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
}
walk(base);
const read = (p) => fs.readFileSync(path.join(base, p), 'utf8');
ok(!/set "REF=[a-z]{20}"/i.test(read('update-bot.bat')), 'no bundled personal deployment target');
ok(!/https:\/\/[a-z]{20}\.supabase\.co/.test(read('supabase/README.md')), 'setup uses a placeholder');
for (const pattern of ['.env', '.env.*', 'data.json', '.obsidian/', 'supabase/.temp/', '*.log']) ok(read('.gitignore').split('\n').includes(pattern), `ignored local state: ${pattern}`);
ok(read('src/settings.ts').includes("text.inputEl.type = 'password'"), 'sync token field is masked');
ok(read('supabase/functions/sync/index.ts').includes("error: 'Sync failed. Check the server configuration.'"), 'server response does not echo exceptions');
ok(read('supabase/functions/tick/index.ts').includes("error: 'Tick failed. Check the server configuration.'"), 'tick response does not echo exceptions');
const bundle = await esbuild.build({ stdin: { contents: 'export { TelegramSync } from "../src/telegram/sync-service"; export { applyCommands } from "../src/telegram/apply";', resolveDir: path.join(base, 'test'), loader: 'ts' }, bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'error' });
const { TelegramSync, applyCommands } = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));
globalThis.window = globalThis;
const canary = 'PRIVATE_DIAGNOSTIC_CANARY';
async function outcome(post) {
  const settings = { enabled: true, url: 'https://example.invalid', token: 'synthetic-test-value', unconfirmed: [] };
  const sync = new TelegramSync({ settings: () => settings, tasks: () => [], defaults: () => ({ enabled: false, leadMinutes: 0 }), post, apply: {}, save: async () => {}, report: () => {}, now: () => 0, registerInterval: () => {} });
  const result = await sync.syncNow();
  ok(!JSON.stringify({ result, settings }).includes(canary), 'private exception/response not persisted or reported');
  return result;
}
assert.equal((await outcome(async () => { throw new Error(canary); })).ok, false); checks++;
assert.equal((await outcome(async () => ({ status: 500, json: { error: canary } }))).message, 'The server answered 500.'); checks++;
assert.equal((await outcome(async () => ({ status: 403, json: { error: canary } }))).message, 'The sync token is not right.'); checks++;
const results = await applyCommands([{ id: 'privacy-command', kind: 'add', payload: { title: 'Synthetic task' } }], { tasks: () => [], inboxPath: () => 'Synthetic.md', appendLine: async () => { throw new Error(canary); } });
assert.equal(results[0].error, 'The change could not be applied.'); checks++;
ok(!JSON.stringify(results).includes(canary), 'command acknowledgement does not upload exception text');
// The real tick HTTP handler must not echo a provider exception (fake dependencies only).
const tickBundle = await esbuild.build({ entryPoints: [path.join(base, 'supabase/functions/tick/index.ts')], bundle: true, platform: 'node', format: 'cjs', write: false, logLevel: 'error', plugins: [{name:'privacy-tick-stubs',setup(b){
  b.onResolve({filter:/_shared\/(schema|supabase-store|telegram-api|tick)\.ts$/},args=>({path:args.path,namespace:'privacy-stub'}));
  b.onLoad({filter:/.*/,namespace:'privacy-stub'},()=>({contents:'export async function ensureSchema() {} export function supabaseStore() { return {}; } export function telegramApi() { return {}; } export async function runTick() { throw Error("PRIVATE_DIAGNOSTIC_CANARY"); }',loader:'js'}));
}}]});
let tickHandler;
const savedDeno = globalThis.Deno;
const savedError = console.error;
try {
  globalThis.Deno = {env:{get:key=>key==='SYNC_TOKEN'?'synthetic-tick-value':undefined},serve:handler=>tickHandler=handler};
  console.error = () => {};
  new Function('module','exports',tickBundle.outputFiles[0].text)({exports:{}},{});
  const reply = await tickHandler(new Request('https://example.invalid/tick',{method:'POST',headers:{Authorization:'Bearer synthetic-tick-value'}}));
  assert.equal(reply.status,500);checks++;
  const text = await reply.text();
  assert.equal(JSON.parse(text).error,'Tick failed. Check the server configuration.');checks++;
  ok(!text.includes(canary),'tick provider exception is not returned');
} finally {globalThis.Deno=savedDeno;console.error=savedError;}
console.log(`PRIVACY_OK (${checks} checks)`);
