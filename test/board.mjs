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
      export * as columns from "../src/board/board-columns";
      export { moveCursor, moveFor } from "../src/board/board-keys";
      export { nestTasks, hiddenByFold, foldKey } from "../src/board/board-nesting";
      export { snapshotView, viewPatch, sameView, newViewId, uniqueViewName, sanitizeViews, VIEW_KEYS } from "../src/board/board-views";
      export { DEFAULT_BOARD_PREFERENCES } from "../src/types";
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
          contents: 'export const setIcon = () => {}; export class Menu {}; export class App {}; export class Notice {}; export class TFile {}; export class Scope { register() {} }; export const Platform = { isMobile: false, isPhone: false };',
          loader: 'js',
        }));
      },
    },
  ],
});

const mod = await import(
  'data:text/javascript;base64,' + Buffer.from(build.outputFiles[0].text).toString('base64')
);
const { parseBoardTasks, filterTasks, sortTasks, groupTasks, deadlineBucket, summarize, daysUntil, displayTitle, columns, moveCursor, moveFor, nestTasks, hiddenByFold, foldKey, snapshotView, viewPatch, sameView, newViewId, uniqueViewName, sanitizeViews, VIEW_KEYS, DEFAULT_BOARD_PREFERENCES } = mod;

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
eq(parseBoardTasks('a.md', note).length, 6, 'without the cache, code blocks are still skipped');
eq(tasks[1].parentId, tasks[0].id, 'a subtask points at its parent');
eq(tasks[0].parentId, undefined, 'a top-level task has no parent');

// ── subtasks under a parent, with notes between them ──────────────────────
const nested = parseBoardTasks('Plan.md', [
  '- [ ] Figma',
  '    - [ ] Auto layout',
  '        - learn it well enough to try ideas',
  '    - [ ] Prototyping',
  '        - [ ] Smart animate',
  '    - note under the parent',
  '        - [ ] Paid features',
  '',
  '    - [ ] After a blank line',
  'A paragraph ends the list.',
  '    - [ ] Not a child of Figma',
  '- [ ] Next',
].join('\n'));
const byText = Object.fromEntries(nested.map((t) => [t.text, t]));
eq(byText['Auto layout'].parentId, 'Plan.md:0', 'direct child');
eq(byText['Smart animate'].parentId, 'Plan.md:3', 'grandchild points at its own parent');
eq(byText['Paid features'].parentId, 'Plan.md:0', 'a plain bullet in between keeps the nearest task');
eq(byText['After a blank line'].parentId, 'Plan.md:0', 'a blank line does not end the list');
eq(byText['Not a child of Figma'].parentId, undefined, 'a paragraph at the margin does');
eq(byText['Next'].parentId, undefined, 'a sibling at the top level');

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

// ── columns: which properties show, in what order, how wide ──────────────
{
  const { resolveColumns, moveColumn, setColumn, visibleColumns, columnWidth, orderGroups, moveValue, clampKanbanWidth, DEFAULT_CARD_PROPERTIES } = columns;
  const ids = (list) => list.map((column) => column.id);
  eq(ids(resolveColumns(undefined)), ['status', 'tags', 'priority', 'deadline', 'plan', 'waiting', 'progress', 'note', 'repeat'], 'default columns');
  eq(ids(visibleColumns(resolveColumns(undefined))), ['status', 'tags', 'priority', 'deadline', 'plan', 'waiting', 'progress', 'note'], 'repeat starts hidden');
  const saved = resolveColumns([
    { id: 'note', width: 90000 },
    { id: 'status', hidden: true },
    { id: 'nope' },
    { id: 'note' },
    { id: 'tags', width: 10 },
  ]);
  eq(ids(saved).slice(0, 3), ['note', 'status', 'tags'], 'the saved order first; unknown and repeated ids dropped');
  eq(ids(saved).slice(3), ['priority', 'deadline', 'plan', 'waiting', 'progress', 'repeat'], 'properties added since are appended as they are by default');
  eq([saved[0].width, saved[2].width, saved[1].hidden], [640, 90, true], 'widths kept in range, hidden kept');
  eq(resolveColumns([{ id: 'tags', width: 180 }])[0].width, undefined, 'a width equal to the default is not stored');
  eq(ids(moveColumn(resolveColumns(undefined), 'note', 'status')).slice(0, 2), ['note', 'status'], 'move before another column');
  eq(ids(moveColumn(resolveColumns(undefined), 'status', null)).at(-1), 'status', 'move to the end');
  const wide = setColumn(resolveColumns(undefined), 'plan', { width: 260 });
  eq(columnWidth(wide.find((column) => column.id === 'plan')), 260, 'a resized column');
  eq('width' in setColumn(wide, 'plan', { width: undefined }).find((column) => column.id === 'plan'), false, 'resetting drops the width');
  eq('hidden' in setColumn(resolveColumns(undefined), 'repeat', { hidden: false }).find((column) => column.id === 'repeat'), false, 'showing drops the flag');
  eq(ids(visibleColumns(resolveColumns(undefined, DEFAULT_CARD_PROPERTIES))), ['tags', 'priority', 'deadline', 'plan', 'waiting', 'progress', 'note'], 'default card properties');

  const groups = [{ value: '[ ]' }, { value: '[/]' }, { value: '[!]' }, { value: '[x]' }];
  eq(orderGroups(groups, ['[x]', '[ ]']).map((g) => g.value), ['[x]', '[ ]', '[/]', '[!]'], 'saved board columns first, new ones where grouping put them');
  eq(orderGroups(groups, undefined).map((g) => g.value), ['[ ]', '[/]', '[!]', '[x]'], 'no saved order keeps the grouping order');
  eq(moveValue(['a', 'b', 'c'], 'c', 'a'), ['c', 'a', 'b'], 'a board column moved before another');
  eq(moveValue(['a', 'b', 'c'], 'a', null), ['b', 'c', 'a'], 'a board column moved last');
  eq([clampKanbanWidth(10), clampKanbanWidth(300.4), clampKanbanWidth(9999)], [220, 300, 520], 'board column widths kept in range');
}

// ── sorting by plan ───────────────────────────────────────────────────────
{
  const planned = parseBoardTasks(
    'Plan.md',
    ['- [ ] b @schedule(2026-05-03 09:00-10:00)', '- [ ] none', '- [ ] a @schedule(2026-05-03)', '- [ ] c @schedule(2026-05-01 18:00)'].join('\n')
  );
  const order = sortTasks(planned, 'plan', 'asc', { getProgress: () => undefined, today }).map((task) => task.text.split(' ')[0]);
  eq(order, ['c', 'a', 'b', 'none'], 'by day then start, a day plan before timed ones, unplanned last');
}

// ── the keyboard's cursor ─────────────────────────────────────────────────
{
  const table = [5];
  eq(moveCursor(table, null, 'down'), { column: 0, row: 0 }, 'no cursor yet: the first task');
  eq(moveCursor(table, null, 'last'), { column: 0, row: 4 }, 'End with no cursor: the last');
  eq(moveCursor(table, { column: 0, row: 2 }, 'down'), { column: 0, row: 3 }, 'down');
  eq(moveCursor(table, { column: 0, row: 4 }, 'down'), { column: 0, row: 4 }, 'stops at the last');
  eq(moveCursor(table, { column: 0, row: 0 }, 'up'), { column: 0, row: 0 }, 'and at the first');
  eq(moveCursor(table, { column: 0, row: 3 }, 'first'), { column: 0, row: 0 }, 'Home');
  eq(moveCursor(table, { column: 0, row: 1 }, 'next'), { column: 0, row: 1 }, 'a table has no other column');
  eq(moveCursor([], null, 'down'), null, 'nothing to move through');
  eq(moveCursor([0, 0], { column: 0, row: 0 }, 'down'), null, 'or only empty columns');

  const board = [3, 0, 5, 1];
  eq(moveCursor(board, { column: 0, row: 2 }, 'next'), { column: 2, row: 2 }, 'across, passing over an empty column, keeping the row');
  eq(moveCursor(board, { column: 2, row: 4 }, 'next'), { column: 3, row: 0 }, 'a shorter column: as far down as it goes');
  eq(moveCursor(board, { column: 3, row: 0 }, 'next'), { column: 3, row: 0 }, 'the last column stays');
  eq(moveCursor(board, { column: 2, row: 3 }, 'previous'), { column: 0, row: 2 }, 'and back');
  eq(moveCursor(board, null, 'next'), { column: 0, row: 0 }, 'across with no cursor starts at the first');
  eq(moveCursor(board, { column: 1, row: 0 }, 'down'), { column: 0, row: 0 }, 'a cursor left in a column that emptied starts again');
  eq(moveCursor(board, { column: 0, row: 9 }, 'up'), { column: 0, row: 1 }, 'a row that is gone counts from the end');

  eq(['ArrowUp', 'ArrowDown', 'Home', 'End'].map((key) => moveFor({ key, code: '' }, false)), ['up', 'down', 'first', 'last'], 'the keys');
  eq([moveFor({ key: 'ArrowRight', code: '' }, false), moveFor({ key: 'ArrowLeft', code: '' }, false)], ['next', 'previous'], 'left to right: right goes on');
  eq([moveFor({ key: 'ArrowRight', code: '' }, true), moveFor({ key: 'ArrowLeft', code: '' }, true)], ['previous', 'next'], 'right to left: left goes on');
  eq([moveFor({ key: 'ج', code: 'KeyJ' }, false), moveFor({ key: 'ل', code: 'KeyK' }, true), moveFor({ key: 'x', code: 'KeyX' }, false)], ['down', 'up', null], 'J and K by the physical key, in any layout');
}

// ── sub-items in the table ────────────────────────────────────────────────
{
  const all = parseBoardTasks(
    'Projects/Launch.md',
    ['- [ ] Launch', '    - [ ] Write', '        - [ ] Draft', '    - [ ] Design', '- [ ] Ship', '    - [ ] Package'].join('\n')
  );
  const byId = new Map(all.map((task) => [task.id, task]));
  const lookup = (id) => byId.get(id);
  const named = (nesting) => Object.fromEntries(all.filter((t) => nesting.has(t.id)).map((t) => [t.text, [nesting.get(t.id).depth, nesting.get(t.id).children]]));

  eq(named(nestTasks(all, lookup)), { Launch: [0, 2], Write: [1, 1], Draft: [2, 0], Design: [1, 0], Ship: [0, 1], Package: [1, 0] }, 'every task under its parent, one step in each');
  eq(named(nestTasks(all.filter((t) => t.text !== 'Write'), lookup)), { Launch: [0, 2], Draft: [1, 0], Design: [1, 0], Ship: [0, 1], Package: [1, 0] }, 'a parent that is not shown is passed over: the subtask hangs from its grandparent');
  eq(named(nestTasks(all.filter((t) => t.text !== 'Launch'), lookup)), { Write: [0, 1], Draft: [1, 0], Design: [0, 0], Ship: [0, 1], Package: [1, 0] }, 'with no ancestor shown a task stands at the edge');
  eq(named(nestTasks(all.filter((t) => ['Draft', 'Package'].includes(t.text)), lookup)), { Draft: [0, 0], Package: [0, 0] }, 'as does a subtask shown alone, or in another group');

  const nesting = nestTasks(all, lookup);
  const idOf = (text) => all.find((t) => t.text === text).id;
  const foldedSet = (...texts) => (id) => texts.includes(byId.get(id).text);
  const hidden = (folded) => all.filter((t) => hiddenByFold(t.id, nesting, folded)).map((t) => t.text);
  eq(hidden(foldedSet()), [], 'nothing folded, nothing hidden');
  eq(hidden(foldedSet('Write')), ['Draft'], 'folding a subtask hides its own');
  eq(hidden(foldedSet('Launch')), ['Write', 'Draft', 'Design'], 'folding a parent hides everything under it');
  eq(hidden(foldedSet('Launch', 'Write')), ['Write', 'Draft', 'Design'], 'a fold inside a fold changes nothing');
  eq(hidden(foldedSet('Design')), [], 'a fold on a task with no subtasks hides nothing');
  eq(foldKey(all[0]), 'Projects/Launch.md\nLaunch', 'a fold is remembered by note and title');
  eq(foldKey({ filePath: 'A.md', text: 'x', blockId: 'id1' }), 'A.md\nid1', 'or by block ID when it has one');
}

// ── saved views ───────────────────────────────────────────────────────────
{
  const defaults = DEFAULT_BOARD_PREFERENCES;
  const board = { ...defaults, layout: 'board', groupBy: 'tag', statuses: ['[/]'], tags: ['work'], density: 'compact', collapsedGroups: ['tag:work'], foldedTasks: ['A.md\nx'], inboxPath: 'Inbox.md' };
  const snap = snapshotView(board);
  eq([snap.layout, snap.groupBy, snap.statuses, snap.tags, snap.density], ['board', 'tag', ['[/]'], ['work'], 'compact'], 'a view keeps how the board is set up');
  eq(['collapsedGroups', 'foldedTasks', 'inboxPath', 'views', 'activeView'].filter((key) => key in snap), [], 'and leaves out folds, the inbox and the views themselves');
  board.statuses.push('[x]');
  eq(snap.statuses, ['[/]'], 'a copy: later changes do not reach into it');

  const view = { id: 'v1', name: 'Doing', prefs: snap };
  eq(sameView(board, view, defaults), false, 'a board changed since is no longer the view');
  board.statuses.pop();
  eq(sameView(board, view, defaults), true, 'until it is put back');
  board.collapsedGroups.push('tag:home');
  eq(sameView(board, view, defaults), true, 'folding a group does not change the view');

  // Applied over a board that is set up differently, it comes out the same on every key.
  const other = { ...defaults, layout: 'calendar', sortKey: 'deadline', sortDir: 'desc', deadlines: ['overdue'], wrapTitles: true };
  Object.assign(other, viewPatch(view, defaults));
  eq(sameView(other, view, defaults), true, 'applying a view over another board gives the view');
  eq([other.sortKey, other.sortDir, other.deadlines, other.wrapTitles, other.activeView], [defaults.sortKey, defaults.sortDir, defaults.deadlines, defaults.wrapTitles, 'v1'], 'what the view did not hold goes back to the default');
  eq(other.layout, 'board', 'and what it did hold is set');
  eq(VIEW_KEYS.every((key) => key in viewPatch(view, defaults)), true, 'every key is set, so none is left over from before');

  eq([newViewId([{ id: 'a' }]) !== 'a', /^v[0-9a-z]+$/.test(newViewId([]))], [true, true], 'an ID no view has');
  eq(uniqueViewName([], '  This   week '), 'This week', 'a name is tidied');
  eq(uniqueViewName([{ name: 'Focus' }, { name: 'focus 2' }], 'focus'), 'focus 3', 'and made different from the others');
  eq(uniqueViewName([], '   '), 'View', 'an empty one is given a word');

  eq(sanitizeViews('nope'), [], 'saved data that is not a list is nothing');
  eq(
    sanitizeViews([
      { id: 'a', name: ' Ok ', prefs: { layout: 'board', inboxPath: 'x.md', bogus: 1 } },
      { id: 'a', name: 'Dup', prefs: {} },
      { id: '', name: 'No id' },
      { id: 'b', name: '  ' },
      null,
      { id: 'c', name: 'Bare' },
    ]),
    [{ id: 'a', name: 'Ok', prefs: { layout: 'board' } }, { id: 'c', name: 'Bare', prefs: {} }],
    'a hand-edited file keeps only whole views, with only the keys a view holds'
  );
}

console.log(`BOARD_OK (${checked} checks)`);
