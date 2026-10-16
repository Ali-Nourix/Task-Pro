import * as esbuild from 'esbuild';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const mock = pathToFileURL(new URL('./harness/obsidian-node-mock.mjs', import.meta.url).pathname).href;
const result = await esbuild.build({
  stdin: { contents: `export * from './src/note-embed'; export { TaskCalendar } from './src/calendar/calendar-view';`, resolveDir: process.cwd(), loader: 'ts' },
  bundle: true, write: false, format: 'esm', platform: 'node',
  plugins: [{ name: 'obsidian', setup(b) { b.onResolve({ filter: /^obsidian$/ }, () => ({ path: mock, external: true })); } }],
});
const { createEmbedHost, restoreEmbedPreferences, embedStateKey, TaskCalendar } =
  await import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'));
let checks = 0;
const eq = (a, b) => { assert.deepEqual(a, b); checks++; };
const source = 'view: table\ncalendar-view: week';
const storage = new Map();
const persistence = key => ({ load: () => storage.get(key), save: async state => storage.set(key, JSON.parse(JSON.stringify(state))) });
const prefs = restoreEmbedPreferences(source).prefs;
const global = { board: { layout: 'board', tags: ['main'] } };
let globalSaves = 0;
const base = { getSettings: () => global, savePreferences: async () => { globalSaves++; } };
const host = createEmbedHost(base, prefs, () => persistence('A').save({ source, prefs }));
prefs.layout = 'calendar'; prefs.calendarView = 'day'; prefs.tags.push('work');
await host.savePreferences();
await host.saveCalendarDate('2026-10-19');
const restored = restoreEmbedPreferences(source, persistence('A')).prefs;
eq([restored.layout, restored.calendarView, restored.calendarDate, restored.tags], ['calendar', 'day', '2026-10-19', ['work']]);
restored.tags.push('not-saved');
eq(storage.get('A').prefs.tags, ['work']);
eq(restoreEmbedPreferences(source, persistence('B')).prefs.layout, 'table');
eq(restoreEmbedPreferences('view: calendar', persistence('A')).prefs.calendarDate, undefined);
eq(global.board, { layout: 'board', tags: ['main'] }); eq(globalSaves, 0);
// Loading data.json afresh must restore the same state, without shared object identity.
const disk = JSON.parse(JSON.stringify(Object.fromEntries(storage)));
eq(restoreEmbedPreferences(source, { load: () => disk.A }).prefs.calendarDate, '2026-10-19');
// Stable across prose edits above a block, separate across notes and repeated fences.
const text = 'intro\n```taskpro\nview: table\n```\n\n```taskpro\nview: table\n```';
const key = embedStateKey('A.md', { text, lineStart: 5 });
eq(key, embedStateKey('A.md', { text: 'more prose\n' + text, lineStart: 6 }));
eq(key === embedStateKey('B.md', { text, lineStart: 5 }), false);
eq(key === embedStateKey('A.md', { text, lineStart: 1 }), false);
// Code examples inside a longer fenced code block are not real TaskPro embeds.
eq(embedStateKey('A.md', { text: '````md\n```taskpro\n```\n````\n```taskpro', lineStart: 4 }), '["A.md",0]');
const context = (h, p) => ({ host: h, prefs: () => p, settings: () => ({ calendarSystem: 'gregorian', calendar: { weekStartsOn: 'monday' } }), enter() {}, refresh() {}, updatePrefs: async patch => { Object.assign(p, patch); await h.savePreferences(); } });
const calendar = new TaskCalendar(context(host, prefs));
eq(calendar.anchor, '2026-10-19');
calendar.step(1); eq(prefs.calendarDate, '2026-10-20');
calendar.openDay('2026-11-05'); eq(prefs.calendarDate, '2026-11-05');
eq(new TaskCalendar(context(host, prefs)).anchor, '2026-11-05');
calendar.goToday(); eq(prefs.calendarDate, calendar.anchor);
await host.saveCalendarDate('2026-02-30');
eq(new TaskCalendar(context(host, prefs)).anchor === '2026-02-30', false);
// A host without persistence keeps the old standalone-board behavior.
const transient = createEmbedHost(base, restoreEmbedPreferences(source).prefs);
await transient.savePreferences(); eq(globalSaves, 0);
console.log(`EMBED_STATE_OK (${checks} checks)`);
