/**
 * The task board's data layer: parsing a note into board rows, and the
 * filter / sort / group rules the table and the kanban share. Dates are
 * checked against a fixed "today" so the results do not drift.
 */
import * as esbuild from 'esbuild';

const build = await esbuild.build({
  stdin: {
    contents: `
      export { parseBoardTasks } from "../src/board/task-store";
      export { filterTasks, sortTasks, groupTasks, deadlineBucket, summarize, daysUntil } from "../src/board/board-query";
      export { displayTitle } from "../src/board/task-board";
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
          contents: 'export const setIcon = () => {}; export class Menu {}; export class App {}; export class Notice {}; export class TFile {}; export class Scope { register() {} };',
          loader: 'js',
        }));
      },
    },
  ],
});

const mod = await import(
  'data:text/javascript;base64,' + Buffer.from(build.outputFiles[0].text).toString('base64')
);
const { parseBoardTasks, filterTasks, sortTasks, groupTasks, deadlineBucket, summarize, daysUntil, displayTitle } = mod;

let checked = 0;
const eq = (actual, expected, label) => {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${label}: got ${a}, expected ${e}`);
  checked++;
};

const today = new Date(2026, 8, 24); // 24 Sep 2026

// ── parsing a note ─────────────────────────────────────────────────────────
const note = [
  '# Week',
  '- [/] Draft the launch post @priority(high) @due(2026-09-27) @tag(work, deep-work) ^launch',
  '    - [ ] Pick a typeface @tag(deep-work)',
  '- [x] Book the venue @due(2026-09-23)',
  '- [!] Chase the invoice @due(2026-09-20) @tag(client)',
  '- [ ] ![[Other note#^abc]]',
  '```',
  '- [ ] Not a task, inside a code block',
  '```',
  '- [ ] Groceries @repeat(1w) @due(2026-09-26) @tag(home)',
  '- [ ] Accessibility pass @priority(low)',
].join('\n');

// The metadata cache lists task items by line; the code-block line is not one.
const taskLines = new Set([1, 2, 3, 4, 5, 9, 10]);
const tasks = parseBoardTasks('Planner/W39.md', note, taskLines);

eq(tasks.length, 6, 'embeds and code blocks are not tasks');
eq(tasks.map((t) => t.lineNumber), [1, 2, 3, 4, 9, 10], 'line numbers are kept');
eq(tasks[0].text, 'Draft the launch post', 'title has every marker stripped');
eq(tasks[0].tags, ['work', 'deep-work'], 'tags in note order');
eq(tasks[0].blockId, 'launch', 'block id');
eq(tasks[0].priority, 'high', 'priority');
eq(tasks[0].deadline, '2026-09-27', 'deadline');
eq(tasks[1].depth, 4, 'subtask depth from indentation');
eq(tasks[4].repeat, { every: 1, unit: 'week' }, 'repeat rule');
eq(tasks[0].fileName, 'W39', 'note name without folder or extension');
eq(parseBoardTasks('a.md', note).length, 7, 'without the cache, only the regex decides');

// ── deadline buckets ───────────────────────────────────────────────────────
eq(daysUntil('2026-09-27', today), 3, 'three days out');
eq(deadlineBucket(tasks[0], today), 'week', 'within seven days');
eq(deadlineBucket(tasks[2], today), 'past', 'a done task with a past date is not overdue');
eq(deadlineBucket(tasks[3], today), 'overdue', 'an open task with a past date is overdue');
eq(deadlineBucket(tasks[5], today), 'none', 'no deadline');
eq(summarize(tasks, today), { total: 6, done: 1, overdue: 1 }, 'header summary');

// ── filtering ──────────────────────────────────────────────────────────────
const none = { statuses: [], priorities: [], tags: [] };
const tagList = [{ key: 'work', name: 'Work', color: 'blue' }, { key: 'home', name: 'Household', color: 'green' }];
eq(filterTasks(tasks, none, '', { tags: tagList }).length, 6, 'no filter keeps everything');
eq(filterTasks(tasks, { ...none, statuses: ['[ ]'] }, '', { tags: tagList }).map((t) => t.lineNumber), [2, 9, 10], 'status filter');
eq(filterTasks(tasks, { ...none, priorities: ['none'] }, '', { tags: tagList }).length, 4, '"no priority" is a filter value');
eq(filterTasks(tasks, { ...none, tags: ['deep-work'] }, '', { tags: tagList }).map((t) => t.lineNumber), [1, 2], 'tag filter matches any tag');
eq(filterTasks(tasks, { ...none, tags: [''] }, '', { tags: tagList }).map((t) => t.lineNumber), [3, 10], '"no tag" filter');
eq(filterTasks(tasks, none, 'household', { tags: tagList }).map((t) => t.lineNumber), [9], 'search matches a tag’s display name');
eq(filterTasks(tasks, none, 'launch draft', { tags: tagList }).map((t) => t.lineNumber), [1], 'every search word must match');

// ── sorting ────────────────────────────────────────────────────────────────
const ctx = { getProgress: (t) => (t.blockId === 'launch' ? { enabled: true, currentSteps: 3, totalSteps: 8 } : undefined), today };
eq(sortTasks(tasks, 'priority', 'asc', ctx).map((t) => t.lineNumber), [1, 10, 2, 3, 4, 9], 'most urgent first, unprioritised last in note order');
eq(sortTasks(tasks, 'priority', 'desc', ctx).map((t) => t.lineNumber), [10, 1, 2, 3, 4, 9], 'reversed, and still unprioritised last');
eq(sortTasks(tasks, 'deadline', 'asc', ctx).map((t) => t.lineNumber), [4, 3, 9, 1, 2, 10], 'soonest deadline first');
eq(sortTasks(tasks, 'title', 'asc', ctx)[0].text, 'Accessibility pass', 'title A→Z');
eq(sortTasks(tasks, 'progress', 'asc', ctx)[0].lineNumber, 1, 'tasks with progress before those without');
eq(sortTasks(tasks, 'document', 'desc', ctx)[0].lineNumber, 10, 'note order reversed');

// ── grouping ───────────────────────────────────────────────────────────────
const byStatus = groupTasks(tasks, 'status', { tags: tagList, today });
eq(byStatus.map((g) => [g.value, g.tasks.length]), [['[ ]', 3], ['[/]', 1], ['[!]', 1], ['[x]', 1]], 'status groups in board order');
const byTag = groupTasks(tasks, 'tag', { tags: tagList, today });
eq(byTag.map((g) => g.value), ['work', 'home', 'client', 'deep-work', ''], 'defined tags first, then keys nobody defined, then untagged');
eq(byTag.find((g) => g.value === 'deep-work').tasks.length, 2, 'a task is listed under each of its tags');
eq(groupTasks(tasks, 'priority', { tags: tagList, today }).map((g) => g.value), ['high', 'low', ''], 'empty priority groups are dropped');
eq(groupTasks(tasks, 'deadline', { tags: tagList, today }).map((g) => g.value), ['overdue', 'week', 'past', 'none'], 'deadline buckets in order');
eq(groupTasks(tasks, 'none', { tags: tagList, today })[0].id, 'none:', 'a single group when not grouping');
eq(byStatus[0].id, 'status:[ ]', 'group ids are stable for remembering collapsed groups');

// ── titles in cells ────────────────────────────────────────────────────────
eq(displayTitle('Read [[Books/Deep Work|the book]] and [[Notes/Plan]]'), 'Read the book and Plan', 'wiki links show their alias or name');
eq(displayTitle('See [the spec](https://example.com) **now**'), 'See the spec now', 'markdown links and emphasis');

console.log(`BOARD_OK (${checked} checks)`);
