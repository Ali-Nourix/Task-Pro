/** Regression: a Unicode-heavy keep list must not turn sync into gateway 400 / HTTP 500. */
import * as esbuild from 'esbuild';
import assert from 'node:assert/strict';
const build = await esbuild.build({
  stdin: { contents: `export { supabaseStore } from '../supabase/functions/_shared/supabase-store.ts'; export { keyBatches } from '../supabase/functions/_shared/key-batches.ts';`, resolveDir: new URL('.', import.meta.url).pathname, loader: 'ts' },
  bundle: true, format: 'esm', platform: 'node', write: false,
  plugins: [{ name: 'mock-client', setup(b) {
    b.onResolve({ filter: /^npm:@supabase\/supabase-js@2$/ }, () => ({ path: 'client', namespace: 'mock' }));
    b.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({ contents: 'export const createClient = () => globalThis.__keyFilterTestClient;' }));
  } }],
});
const { supabaseStore, keyBatches } = await import('data:text/javascript;base64,' + Buffer.from(build.outputFiles[0].text).toString('base64'));
let checked = 0;
const eq = (a, b) => { assert.deepEqual(a, b); checked++; };
const keys = Array.from({ length: 116 }, (_, i) => `Daily/2099-01-01.md|${'تسک فارسی برای آزمایش، عنوان طولانی '.repeat(3)}${i}|0`);
for (const list of [[], ['one'], Array.from({ length: 401 }, (_, i) => String(i)), keys, ['a,"(b)\\c', 'فارسی', 'x'.repeat(600)]]) eq(keyBatches(list).flat(), list);
eq(keyBatches(Array.from({ length: 401 }, (_, i) => String(i))).map(b => b.length), [200, 200, 1]);
const marked = [], sizes = [];
let cleaned = 0;
globalThis.__keyFilterTestClient = {
  from() { return {
    update() { return { in: async (_column, values) => {
      const url = new URL('https://example.supabase.co/rest/v1/tasks');
      url.searchParams.set('key', 'in.(' + values.map(v => '"' + v + '"').join(',') + ')');
      sizes.push(url.toString().length);
      if (url.toString().length > 8000) return { error: { message: 'URI too long' } };
      marked.push(...values);
      return { error: null };
    } }; },
    delete() { return { eq() { return { or: async () => { cleaned++; return { error: null }; } }; } }; },
  }; },
};
try {
  await supabaseStore('url', 'key').replaceSnapshot([], new Set(keys));
  eq(marked, keys);
  eq(cleaned, 1);
  eq(sizes.every(n => n < 8000), true);
  marked.length = 0; cleaned = 0;
  globalThis.__keyFilterTestClient.from = () => ({ update: () => ({ in: async () => ({ error: { message: 'network down' } }) }), delete: () => { cleaned++; throw new Error('cleanup must not run'); } });
  await assert.rejects(() => supabaseStore('url', 'key').replaceSnapshot([], new Set(keys)), /keep tasks/); checked++;
  eq(cleaned, 0);
} finally { delete globalThis.__keyFilterTestClient; }
console.log(`TELEGRAM_KEY_FILTERS_OK (${checked} checks)`);
