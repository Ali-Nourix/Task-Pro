/**
 * How tasks relate beyond their own line: a parent's subtasks counted, the
 * tasks one waits on (written as block links, resolved across notes, with no
 * loops allowed), and the reminder before a plan starts.
 */
import * as esbuild from 'esbuild';

const build = await esbuild.build({
  stdin: {
    contents: `
      export { parseBoardTasks } from "../src/board/task-store";
      export * from "../src/board/task-relations";
      export { extractWaiting, setWaiting, extractRemind, setRemind, stripTaskMetadata, replaceTaskText, setSchedule } from "../src/task-metadata";
      export { dueReminders, planStartsAt, reminderKey } from "../src/reminders/plan-reminders";
      export { taskSpan, buildTimeline } from "../src/timeline/timeline-model";
    `,
    resolveDir: new URL('.', import.meta.url).pathname,
    loader: 'ts',
  },
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
  plugins: [
    {
      name: 'mock-obsidian',
      setup(b) {
        b.onResolve({ filter: /^obsidian$/ }, () => ({ path: 'obsidian', namespace: 'mock' }));
        b.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({
          contents:
            'export const setIcon = () => {}; export class Menu {}; export class App {}; export class Notice {}; export class TFile {}; export class Modal {}; export class Scope { register() {} }; export const Platform = { isMobile: false, isPhone: false };',
          loader: 'js',
        }));
      },
    },
  ],
});

const mod = await import('data:text/javascript;base64,' + Buffer.from(build.outputFiles[0].text).toString('base64'));
const {
  parseBoardTasks,
  subtaskCounts,
  subtaskCountAt,
  RelationIndex,
  newBlockId,
  extractWaiting,
  setWaiting,
  extractRemind,
  setRemind,
  stripTaskMetadata,
  replaceTaskText,
  setSchedule,
  dueReminders,
  planStartsAt,
  taskSpan,
  buildTimeline,
} = mod;

let checked = 0;
function eq(actual, expected, label) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${label}:\n  got      ${a}\n  expected ${e}`);
  checked++;
}

// ── Subtasks ───────────────────────────────────────────────────────────────
const figma = [
  '- [ ] Learn Figma',
  '    - [x] Auto layout',
  '        - [ ] a nested step, not a direct subtask',
  '    - a note',
  '        - [x] Prototyping, under a plain bullet',
  '    - [ ] Paid features',
  '- [ ] Something else',
  '    - [x] Its only subtask',
].join('\n');
const tasks = parseBoardTasks('Projects/Figma.md', figma);
const counts = subtaskCounts(tasks);
eq(counts.get(tasks[0].id), { done: 2, total: 3 }, 'direct subtasks, a plain bullet in between keeps the link');
eq(counts.get(tasks[1].id), { done: 0, total: 1 }, 'a subtask with its own subtask');
eq(counts.has(tasks[2].id), false, 'no subtasks, no count');
const lines = figma.split('\n');
eq(subtaskCountAt((n) => lines[n], lines.length, 0), { done: 2, total: 3 }, 'the same count read from the note lines');
eq(subtaskCountAt((n) => lines[n], lines.length, 6), { done: 1, total: 1 }, 'the next family on its own');
eq(subtaskCountAt((n) => lines[n], lines.length, 5), null, 'a leaf has none');

// ── Markers ────────────────────────────────────────────────────────────────
const line = '- [ ] Send the quote @waiting([[Planner/Launch#^tp-4k2a]], [[#^venue|the venue]]) @remind(15m) @tag(work) ^quote';
eq(extractWaiting(line), [{ path: 'Planner/Launch', blockId: 'tp-4k2a' }, { path: '', blockId: 'venue' }], 'links read, an alias ignored');
eq(extractRemind(line), 15, 'own reminder in minutes');
eq(extractRemind('- [ ] x @remind(1h)'), 60, 'hours');
eq(extractRemind('- [ ] x @remind(off)'), null, 'off');
eq(extractRemind('- [ ] x'), undefined, 'none: the setting decides');
eq(stripTaskMetadata(line).includes('@'), false, 'every marker leaves the title');
eq(
  setWaiting('- [ ] Ship it ^ship', [{ path: 'Planner/Launch', blockId: 'tp-4k2a' }]),
  '- [ ] Ship it @waiting([[Planner/Launch#^tp-4k2a]]) ^ship',
  'written before the block ID'
);
eq(setWaiting(line, []).includes('@waiting'), false, 'an empty list removes it');
eq(setRemind('- [ ] x @schedule(2026-09-28 09:00) ^a', 30), '- [ ] x @schedule(2026-09-28 09:00) @remind(30m) ^a', 'reminder written');
eq(setRemind('- [ ] x @remind(30m)', 120), '- [ ] x @remind(2h)', 'whole hours as hours');
eq(setRemind('- [ ] x @remind(30m)', undefined), '- [ ] x', 'back to the setting');
eq(replaceTaskText(line, 'Send the final quote').includes('@waiting([[Planner/Launch#^tp-4k2a]], [[#^venue|the venue]])'), true, 'a rename keeps the dependency');
const parsed = parseBoardTasks('Planner/Week.md', line)[0];
eq([parsed.text, parsed.waiting.length, parsed.remind], ['Send the quote', 2, 15], 'the store reads both');

// ── Dependencies across notes ──────────────────────────────────────────────
const all = [
  ...parseBoardTasks('Planner/Launch.md', ['- [/] Draft the post ^tp-4k2a', '- [x] Book the venue ^venue'].join('\n')),
  ...parseBoardTasks(
    'Planner/Week.md',
    [
      '- [ ] Send the quote @waiting([[Launch#^tp-4k2a]])',
      '- [ ] Pack @waiting([[Planner/Launch#^venue]])',
      '- [ ] Orphan @waiting([[Gone#^nope]])',
      '- [ ] Local @waiting([[#^here]])',
      '- [ ] Here ^here',
    ].join('\n')
  ),
];
const index = new RelationIndex(all);
const [draft, venue, quote, pack, orphan, local, here] = all;
eq(index.blockersOf(quote)[0].task?.id, draft.id, 'a short link resolves by the note name');
eq(index.blockersOf(local)[0].task?.id, here.id, 'an empty path is the same note');
eq(index.blockersOf(orphan)[0].task, undefined, 'a link to nothing stays, unresolved');
eq([index.isWaiting(quote), index.isWaiting(pack), index.isWaiting(orphan)], [true, false, false], 'waiting until done; a gone task holds nothing up');
eq(index.dependentsOf(draft).map((t) => t.text), ['Send the quote'], 'what waits on a task');
eq(index.wouldCycle(draft, quote), true, 'the draft cannot wait on what waits on it');
eq(index.wouldCycle(quote, quote), true, 'nor on itself');
eq(index.wouldCycle(quote, venue), false, 'an unrelated task is fine');
let n = 0;
eq(newBlockId((id) => id === 'tp-aaaa', () => (n++ < 4 ? 10 / 36 : 11 / 36)), 'tp-bbbb', 'a free ID, trying again when taken');

// ── Plan reminders ─────────────────────────────────────────────────────────
const day = '2026-09-28';
const planned = parseBoardTasks(
  'Planner/Day.md',
  [
    `- [ ] Standup @schedule(${day} 09:00-09:15)`,
    `- [ ] Review @schedule(${day} 09:30-10:00) @remind(45m)`,
    `- [ ] Quiet one @schedule(${day} 09:10) @remind(off)`,
    `- [x] Already done @schedule(${day} 09:05)`,
    `- [ ] All day @schedule(${day})`,
  ].join('\n')
);
const at = (clock) => planStartsAt({ date: day, start: clock });
const settings = { planReminders: true, planLeadMinutes: 10 };
eq(dueReminders(planned, at('08:44'), settings, new Set()).length, 0, 'nothing a minute before the earliest window');
eq(dueReminders(planned, at('08:46'), settings, new Set()).map((r) => r.task.text), ['Review'], 'own lead time: 45 minutes early');
eq(dueReminders(planned, at('08:52'), settings, new Set()).map((r) => r.task.text), ['Standup', 'Review'], 'the setting: 10 minutes early');
const first = dueReminders(planned, at('08:52'), settings, new Set());
eq(dueReminders(planned, at('08:53'), settings, new Set(first.map((r) => r.key))).length, 0, 'announced once');
eq(dueReminders(planned, at('09:08'), settings, new Set()).map((r) => r.task.text), ['Standup', 'Review'], 'still announced a few minutes late');
eq(dueReminders(planned, at('09:20'), settings, new Set()).map((r) => r.task.text), ['Review'], 'let go well after the start');
eq(dueReminders(planned, at('08:52'), { planReminders: false, planLeadMinutes: 10 }, new Set()).map((r) => r.task.text), ['Review'], 'the setting off: only tasks with a time of their own');
eq(dueReminders(planned, at('08:46'), { planReminders: false, planLeadMinutes: 10 }, new Set()).map((r) => r.task.text), ['Review'], 'a task’s own time still counts');
eq(setSchedule(`- [ ] x @remind(5m)`, { date: day, start: '10:00' }).includes('@remind(5m)'), true, 'a new plan keeps the reminder');

// ── Timeline ───────────────────────────────────────────────────────────────
eq(taskSpan({ schedule: { date: '2026-10-01' }, deadline: '2026-10-05' }), { start: '2026-10-01', end: '2026-10-05', kind: 'span' }, 'plan to deadline');
eq(taskSpan({ schedule: { date: '2026-10-01' } }), { start: '2026-10-01', end: '2026-10-01', kind: 'day' }, 'a plan alone is a day');
eq(taskSpan({ deadline: '2026-10-05' }), { start: '2026-10-05', end: '2026-10-05', kind: 'milestone' }, 'a deadline alone is a milestone');
eq(taskSpan({ schedule: { date: '2026-10-05' }, deadline: '2026-10-01' }), { start: '2026-10-05', end: '2026-10-05', kind: 'day', late: '2026-10-01' }, 'due before planned: flagged');
eq(taskSpan({}), null, 'no dates, no span');
const family = parseBoardTasks(
  'Projects/Launch.md',
  [
    '- [ ] Launch',
    '    - [ ] Write @schedule(2026-10-03)',
    '    - [ ] Design @schedule(2026-10-01) @due(2026-10-02)',
    '    - [ ] Someday',
    '- [ ] Ship @due(2026-09-30)',
    '- [ ] Loose end',
  ].join('\n')
);
const timeline = buildTimeline(family, family);
eq(timeline.rows.map((r) => `${'  '.repeat(r.depth)}${r.task.text}`), ['Ship', 'Launch', '  Design', '  Write'], 'families together, each level by its first day');
eq(timeline.rows[1].summary, { start: '2026-10-01', end: '2026-10-03' }, 'a parent spans its subtasks');
eq(timeline.rows[1].span, null, 'a parent with no dates of its own has no bar');
eq(timeline.undated.map((t) => t.text), ['Someday', 'Loose end'], 'the rest have no dates');
const filtered = buildTimeline([family[1]], family);
eq(filtered.rows.map((r) => r.task.text), ['Launch', 'Write'], 'a filtered subtask keeps its parent for context');

console.log(`RELATIONS_OK (${checked} checks)`);
