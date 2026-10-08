/**
 * New tasks planned for the day they were written on, so the calendar and the
 * Telegram bot's week show them. Pure helpers, checked without Obsidian.
 */
import * as esbuild from 'esbuild';

const build = await esbuild.build({
  stdin: {
    contents: `export { localDayKey, planLineIfNew, planNewTasksInContent, freshTaskKeys } from "../src/auto-plan";
export { parseTaskLine, taskKeyFor } from "../src/task-identity";
export { TaskCreationRegistry } from "../src/task-registry";`,
    resolveDir: new URL('.', import.meta.url).pathname,
    loader: 'ts',
  },
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
});

const mod = await import('data:text/javascript;base64,' + Buffer.from(build.outputFiles[0].text).toString('base64'));
const { localDayKey, planLineIfNew, planNewTasksInContent, freshTaskKeys, parseTaskLine, taskKeyFor, TaskCreationRegistry } = mod;

let checked = 0;
const eq = (actual, expected, label) => {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${label}: got ${a}, expected ${e}`);
  checked++;
};

const path = 'Planner/Week.md';
const keyOf = (line) => taskKeyFor(path, parseTaskLine(line));
const day = '2026-10-08';

// ── the day key ────────────────────────────────────────────────────────────
eq(localDayKey(new Date(2026, 9, 8, 23, 59)), '2026-10-08', 'local day, late evening');
eq(localDayKey(new Date(2026, 0, 3, 0, 1)), '2026-01-03', 'local day, padded');

// ── one line ───────────────────────────────────────────────────────────────
const plain = '- [ ] Buy milk';
eq(planLineIfNew(plain, path, new Set([keyOf(plain)]), day), '- [ ] Buy milk @schedule(2026-10-08)', 'a new task is planned for the day');
const withId = '- [ ] Call Sara @priority(high) ^tp-4k2a';
eq(
  planLineIfNew(withId, path, new Set([keyOf(withId)]), day),
  '- [ ] Call Sara @priority(high) @schedule(2026-10-08) ^tp-4k2a',
  'the block id stays last'
);
const nested = '\t- [/] Draft intro';
eq(planLineIfNew(nested, path, new Set([keyOf(nested)]), day), '\t- [/] Draft intro @schedule(2026-10-08)', 'a task in progress keeps its indent');
const planned = '- [ ] Review @schedule(2026-10-10 09:00-10:00)';
eq(planLineIfNew(planned, path, new Set([keyOf(planned)]), day), null, 'a task with a plan keeps it');
const done = '- [x] Already done';
eq(planLineIfNew(done, path, new Set([keyOf(done)]), day), null, 'a ticked task is left alone');
eq(planLineIfNew('- [ ] Old task', path, new Set([keyOf(plain)]), day), null, 'a task that is not new is left alone');
eq(planLineIfNew('Just a sentence', path, new Set(), day), null, 'not a task');

// ── a whole note ───────────────────────────────────────────────────────────
const note = ['# Week', '- [ ] Old task', plain, '- [ ] Review @schedule(2026-10-10)', ''].join('\n');
eq(
  planNewTasksInContent(note, path, new Set([keyOf(plain), keyOf('- [ ] Review @schedule(2026-10-10)')]), day),
  ['# Week', '- [ ] Old task', '- [ ] Buy milk @schedule(2026-10-08)', '- [ ] Review @schedule(2026-10-10)', ''].join('\n'),
  'only new tasks without a plan change'
);
eq(planNewTasksInContent(note, path, new Set(), day), null, 'nothing new, nothing written');
// Planning does not change a task's key, so the edit it makes is not taken as yet another new task.
eq(keyOf('- [ ] Buy milk @schedule(2026-10-08)'), keyOf(plain), 'the plan is not part of the key');

// ── new tasks or edited ones ───────────────────────────────────────────────
eq(freshTaskKeys(undefined, ['a'], ['a']), [], 'the first pass over a note plans nothing');
eq(freshTaskKeys(new Set(['a']), ['a', 'b'], ['b']), ['b'], 'a task added to a note is new');
eq(freshTaskKeys(new Set(['a', 'b']), ['a', 'c'], ['c']), [], 'a task whose text changed is an edit');
eq(freshTaskKeys(new Set(['a', 'b']), ['a', 'c', 'd'], ['c', 'd']), ['c', 'd'], 'more arrived than left');
eq(freshTaskKeys(new Set(['a']), ['a'], []), [], 'nothing appeared');

// ── the registry reports what it saw appear ────────────────────────────────
let index;
const registry = new TaskCreationRegistry({ getIndex: () => index, setIndex: (next) => (index = next), save: async () => {} });
eq(registry.indexFile(path, 0, ['k1'], 1000), [], 'first pass: baseline, nothing reported');
eq(registry.indexFile(path, 0, ['k1', 'k2'], 2000), ['k2'], 'a later pass reports the new key');
eq(registry.indexFile(path, 0, ['k1', 'k2'], 3000), [], 'a known key is not reported again');

console.log(`AUTO_PLAN_OK (${checked} checks)`);
