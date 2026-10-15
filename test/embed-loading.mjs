import * as esbuild from 'esbuild';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const mock = pathToFileURL(new URL('./harness/obsidian-node-mock.mjs', import.meta.url).pathname).href;
const result = await esbuild.build({
  stdin: { contents: `export { TaskStore } from './src/board/task-store'; export { scheduleEmbed } from './src/embed-scheduler';`, resolveDir: process.cwd(), loader: 'ts' },
  bundle: true, write: false, format: 'esm', platform: 'node',
  plugins: [{ name: 'obsidian', setup(b) { b.onResolve({ filter: /^obsidian$/ }, () => ({ path: mock, external: true })); } }],
});
const { TaskStore, scheduleEmbed } = await import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'));
let checks = 0; const eq = (a,b) => { assert.deepEqual(a,b); checks++; };
const frames = [], jobs = [];
const view = { requestAnimationFrame: fn => frames.push(fn), setTimeout: fn => jobs.push(fn) };
const seen = [];
scheduleEmbed(view, () => seen.push(1));
const cancel = scheduleEmbed(view, () => seen.push(2));
scheduleEmbed(view, () => seen.push(3));
eq(frames.length, 1); eq(seen, []);
frames.shift()(); eq(seen, []); eq(jobs.length, 1);
jobs.shift()(); eq(seen, [1]); eq(frames.length, 1);
cancel(); frames.shift()(); jobs.shift()(); eq(seen, [1,3]); eq(frames.length, 0);
const cancelAll = scheduleEmbed(view, () => seen.push(4)); cancelAll(); frames.shift()(); jobs.shift()(); eq(seen, [1,3]);
const files = Array.from({ length: 80 }, (_,i) => ({ path: `Tasks/${i}.md`, extension: 'md' }));
let reads = 0;
const app = { vault: { getMarkdownFiles: () => files, cachedRead: async () => { reads++; return '- [ ] Hello'; } }, metadataCache: { getFileCache: () => null } };
const store = new TaskStore(app);
let inputTurn = false; setTimeout(() => { inputTurn = true; }, 0);
const load = store.ensureLoaded(); eq(load, store.ensureLoaded()); eq(store.isLoaded, false);
await load;
eq(inputTurn, true); eq(reads, 80); eq(store.all().length, 80); eq(store.isLoaded, true);
await store.ensureLoaded(); eq(reads, 80); // no scan per embed
store.destroy(); eq(store.all().length, 0);
let release;
const stopped = new TaskStore({ ...app, vault: { ...app.vault, cachedRead: () => new Promise(resolve => { release = resolve; }) } });
const pending = stopped.ensureLoaded(); await new Promise(resolve => setTimeout(resolve, 0));
stopped.destroy(); release('- [ ] Stale after destroy'); await pending;
eq(stopped.all().length, 0); eq(stopped.isLoaded, false);
console.log(`EMBED_LOADING_OK (${checks} checks)`);
