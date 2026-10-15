import * as esbuild from 'esbuild';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const mock = pathToFileURL(new URL('./harness/obsidian-node-mock.mjs', import.meta.url).pathname).href;
const result = await esbuild.build({
  stdin: { contents: `export * from './src/pomodoro'; export * from './src/note-embed'; export * from './src/timer-service'; export { TaskStore } from './src/board/task-store';`,
    resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'node',
  plugins: [{ name: 'obsidian', setup(b) { b.onResolve({ filter: /^obsidian$/ }, () => ({ path: mock, external: true })); } }],
});
const { newPomodoro, finishPomodoroPhase, pomodoroText, parseEmbedPreferences, createEmbedHost, TaskTimerService, TaskProNoteEmbed, parseEmbedConfig, TaskStore, resolveEmbedScope } =
  await import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'));
const { notices } = await import(mock);
let checks = 0;
const eq = (a, b) => { assert.deepEqual(a, b); checks++; };
const throws = (fn) => { assert.throws(fn); checks++; };
const initial = () => ({ enabled: true, durationSeconds: 1500, elapsedSeconds: 0, runningSince: 1000, label: 'Write', pomodoro: newPomodoro() });
let t = initial();
t = finishPomodoroPhase(t, 1600000);
eq([t.pomodoro.phase, t.pomodoro.completedRounds, t.runningSince, t.durationSeconds, t.completedAt], ['short-break', 1, 0, 300, undefined]);
t = finishPomodoroPhase(t, 1900000);
eq([t.pomodoro.phase, t.pomodoro.completedRounds, t.durationSeconds], ['focus', 1, 1500]);
// Long break is reached before the target, not instead of final completion.
t = { ...initial(), pomodoro: { ...newPomodoro(), completedRounds: 3, targetRounds: 8, autoStart: true } };
t = finishPomodoroPhase(t, 2000);
eq([t.pomodoro.phase, t.pomodoro.completedRounds, t.durationSeconds, t.runningSince], ['long-break', 4, 900, 2000]);
t = finishPomodoroPhase({ ...initial(), pomodoro: { ...newPomodoro(), completedRounds: 3 } }, 3000);
eq([t.pomodoro.completedRounds, t.completedAt, t.runningSince], [4, 3000, 0]);
eq(pomodoroText(t, 'fa').includes('تمرکز'), true);
eq(pomodoroText({ ...t, pomodoro: undefined }, 'en'), '');
// Exhaustive small target/interval combinations: only focus increments the count.
for (let target = 1; target <= 8; target++) {
  for (let every = 1; every <= 5; every++) {
    let timer = { ...initial(), pomodoro: { ...newPomodoro(), targetRounds: target, longBreakEvery: every } };
    for (let round = 1; round <= target; round++) {
      timer = finishPomodoroPhase(timer, round * 10000);
      eq(timer.pomodoro.completedRounds, round);
      if (round === target) { eq(!!timer.completedAt, true); break; }
      eq(timer.pomodoro.phase, round % every === 0 ? 'long-break' : 'short-break');
      timer = finishPomodoroPhase(timer, round * 10000 + 1);
      eq([timer.pomodoro.phase, timer.pomodoro.completedRounds], ['focus', round]);
    }
  }
}
// Config parsing: no evaluation, no silent typos, fresh defaults per block.
const prefs = parseEmbedPreferences('view: calendar\ncalendar-view: week\ncalendar-system: jalali\nscope: all');
eq([prefs.layout, prefs.calendarView, prefs.calendarSystem, prefs.scope], ['calendar', 'week', 'jalali', 'vault']);
eq(parseEmbedPreferences('').layout, 'table');
for (const bad of ['view: board', 'view: table\nview: calendar', 'scope: nope', 'unknown: yes', 'view: <script>', 'calendar-view: year']) throws(() => parseEmbedPreferences(bad));
const global = { board: { layout: 'board', tags: ['private'], views: [{ name: 'Mine' }] }, language: 'fa' };
let saves = 0;
const base = { getSettings: () => global, savePreferences: async () => { saves++; }, store: {} };
const a = createEmbedHost(base, parseEmbedPreferences('view: calendar'));
const b = createEmbedHost(base, parseEmbedPreferences('view: table'));
a.getSettings().board.tags.push('work');
await a.savePreferences();
eq(global.board.tags, ['private']); eq(b.getSettings().board.tags, []); eq(global.board.layout, 'board'); eq(saves, 0); eq(a.store, base.store);
eq(a.getSettings().board.views, undefined);
let disposed = 0;
const child = new TaskProNoteEmbed({ empty() {} }, '', base, () => disposed++);
child.onunload(); eq(disposed, 1);
// Minimal/full composition is explicit and backwards compatible with board preferences.
eq(parseEmbedConfig('view: calendar').chrome, 'minimal');
eq(parseEmbedPreferences('view: calendar').calendarSidebar, false);
eq(parseEmbedConfig('chrome: full').chrome, 'full');
eq(parseEmbedPreferences('chrome: full').calendarSidebar, true);
eq(parseEmbedPreferences('calendar-sidebar: show').calendarSidebar, true);
eq(parseEmbedPreferences('calendar-sidebar: hide\nchrome: full').calendarSidebar, false);
for (const bad of ['chrome: empty', 'calendar-sidebar: yes', 'chrome: full\nchrome: minimal']) throws(() => parseEmbedConfig(bad));
// Startup scope policy: configured target wins over legacy all-vault fences by default.
eq(resolveEmbedScope('vault', undefined, 'Planner'), 'target');
eq(resolveEmbedScope('target', 'vault', 'Planner'), 'vault');
eq(resolveEmbedScope('vault', 'block', 'Planner'), 'vault');
eq(resolveEmbedScope('target', 'block', 'Planner'), 'target');
eq(resolveEmbedScope('vault', 'target', ''), 'vault');
eq(resolveEmbedScope('target', 'target', '  '), 'vault');
// Ordered task snapshots sort once per data revision, not once per consumer/read.
const index = new TaskStore({});
index.setFile('Z.md', [{ id: 'Z:0', text: 'Z' }]);
index.setFile('A.md', [{ id: 'A:0', text: 'A' }]);
const nativeCompare = String.prototype.localeCompare;
let comparisons = 0;
String.prototype.localeCompare = function (...args) { comparisons++; return nativeCompare.apply(this, args); };
try {
  const first = index.all();
  const sortedOnce = comparisons;
  for (let read = 0; read < 50; read++) eq(index.all().map((t) => t.text), ['A', 'Z']);
  eq(comparisons, sortedOnce);
  eq(sortedOnce > 0, true);
  first.reverse(); first.pop();
  eq(index.all().map((t) => t.text), ['A', 'Z']);
  const revision = index.revision;
  index.setFile('B.md', [{ id: 'B:0', text: 'B' }]);
  eq(index.revision > revision, true);
  eq(index.all().map((t) => t.text), ['A', 'B', 'Z']);
  index.loadPromise = Promise.resolve();
  index.handleDeleted('A.md');
  eq(index.all().map((t) => t.text), ['B', 'Z']);
  index.handleRenamed({ path: 'C.md', basename: 'C', extension: 'md' }, 'B.md');
  eq(index.all().map((t) => t.text), ['B', 'Z']);
  eq(index.all()[0].filePath, 'C.md');
  index.handleRenamed({ path: 'C.txt', basename: 'C', extension: 'txt' }, 'C.md');
  eq(index.all().map((t) => t.text), ['Z']);
} finally { String.prototype.localeCompare = nativeCompare; index.destroy(); }
// Exercise the real service (including persistence, completion lock and old timers).
let entries = [];
let clock = 2_000_000;
const realNow = Date.now;
Date.now = () => clock;
const service = new TaskTimerService({ getEntries: () => entries, setEntries: (next) => { entries = next; },
  save: async () => {}, getLanguage: () => 'en',
  getSettings: () => ({ timerSound: false, timerSystemNotification: false, timerInStatusBar: false }),
  registerInterval: () => {} });
try {
  const run = { ...initial(), runningSince: clock - 1500 * 1000, pomodoro: { ...newPomodoro(), autoStart: true, targetRounds: 2 } };
  await service.set('A.md', 'task', run);
  const before = notices.length;
  service.tick(); service.tick();
  await new Promise((resolve) => setImmediate(resolve));
  eq(notices.length, before + 1);
  eq([service.get('A.md', 'task').pomodoro.phase, service.get('A.md', 'task').runningSince], ['short-break', clock]);
  // A reload derives the existing phase from the clock. A long absence credits one phase only.
  entries = JSON.parse(JSON.stringify(entries)); service.rebuildCache();
  clock += 3_600_000;
  service.tick(); await new Promise((resolve) => setImmediate(resolve));
  eq([service.get('A.md', 'task').pomodoro.phase, service.get('A.md', 'task').pomodoro.completedRounds], ['focus', 1]);
  eq(service.get('A.md', 'task').runningSince, clock);
  await service.pause('A.md', 'task', service.get('A.md', 'task'));
  eq(service.get('A.md', 'task').runningSince, 0);
  await service.move('A.md', 'B.md', new Map([['task', 'moved']]));
  eq(service.get('B.md', 'moved').pomodoro.completedRounds, 1);
  await service.start('B.md', 'moved', service.get('B.md', 'moved'));
  clock += 1500 * 1000;
  service.tick(); await new Promise((resolve) => setImmediate(resolve));
  eq([service.get('B.md', 'moved').pomodoro.completedRounds, !!service.get('B.md', 'moved').completedAt], [2, true]);
  await service.start('B.md', 'moved', service.get('B.md', 'moved'));
  eq([service.get('B.md', 'moved').pomodoro.phase, service.get('B.md', 'moved').pomodoro.completedRounds], ['focus', 0]);
  await service.reset('B.md', 'moved', service.get('B.md', 'moved'));
  eq([service.get('B.md', 'moved').runningSince, service.get('B.md', 'moved').elapsedSeconds], [0, 0]);
  const old = { enabled: true, durationSeconds: 60, elapsedSeconds: 0, runningSince: clock - 60000 };
  await service.set('Old.md', 'old', old);
  service.tick(); await new Promise((resolve) => setImmediate(resolve));
  eq([!!service.get('Old.md', 'old').completedAt, service.get('Old.md', 'old').pomodoro], [true, undefined]);
} finally { service.destroy(); Date.now = realNow; }
console.log(`NOTE_EMBED_POMODORO_OK (${checks} checks)`);
