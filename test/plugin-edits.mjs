/**
 * Loads the whole plugin against an in-memory vault (test/harness/
 * obsidian-node-mock.mjs) and drives the editing API the chip menu and the task
 * board share: status, priority, deadline, tags and title changes, the tag
 * list, removing a tag everywhere, the board's task index, and tag sync from a
 * linked copy back to its source.
 */
import * as esbuild from 'esbuild';
import { fileURLToPath, pathToFileURL } from 'url';
import path from 'path';
import { rm } from 'fs/promises';

const here = path.dirname(fileURLToPath(import.meta.url));
const mockPath = path.join(here, 'harness', 'obsidian-node-mock.mjs');
const outFile = path.join(here, 'harness', '.plugin-under-test.mjs');

await esbuild.build({
  entryPoints: [path.join(here, '..', 'main.ts')],
  outfile: outFile,
  bundle: true,
  format: 'esm',
  platform: 'node',
  logLevel: 'error',
  plugins: [
    {
      name: 'mock-obsidian',
      setup(b) {
        // External, so the test and the plugin share one instance of the mock.
        // CodeMirror is external in the real build too: Obsidian provides it.
        b.onResolve({ filter: /^(obsidian|@codemirror\/(view|state))$/ }, () => ({
          path: pathToFileURL(mockPath).href,
          external: true,
        }));
      },
    },
  ],
});

const { App, TFile, notices, bodyElement } = await import(pathToFileURL(mockPath).href);
const { default: TaskProPlugin } = await import(pathToFileURL(outFile).href);
await rm(outFile, { force: true });

let checked = 0;
const eq = (actual, expected, label) => {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${label}:\n  got      ${a}\n  expected ${e}`);
  checked++;
};
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const PLANNER = 'Planner/W39.md';
const SOURCE = 'Weekly Tasks.md';
const app = new App({
  [PLANNER]: [
    '# This week',
    '- [ ] Draft the launch post @priority(high) ^launch',
    '- [ ] Call the printer',
    '- [ ] Call the printer',
    '- [/] Linked copy of a weekly task',
  ].join('\n'),
  [SOURCE]: '- [/] Linked copy of a weekly task ^src1',
  'Life/Home.md': '- [ ] Groceries @tag(home, work)\nplain text, no newline at the end',
});

// Saved data as a user might have it: one tag with a bad colour, a duplicate,
// and a mapping from the planner's copy back to the weekly source note.
app.data = {
  tags: [
    { key: 'Work', name: 'Work', color: 'not-a-colour' },
    { key: 'work', name: 'Duplicate', color: 'red' },
    { key: 'home', name: 'Home', color: 'green' },
  ],
  board: { layout: 'board' },
  taskMappings: [
    {
      linked: true,
      importedFilePath: PLANNER,
      importedLineContent: '- [/] Linked copy of a weekly task',
      sourceFilePath: SOURCE,
      sourceLineContent: '- [/] Linked copy of a weekly task ^src1',
      sourceBlockId: 'src1',
      lastSynced: 0,
    },
  ],
};

const plugin = new TaskProPlugin(app, { id: 'taskpro', version: 'test' });
await plugin.onload();
app.workspace.ready = true;
const note = (p) => app.vault.files.get(p).split('\n');

// ── settings on load ───────────────────────────────────────────────────────
eq(plugin.settings.tags, [{ key: 'work', name: 'Work', color: 'gray' }, { key: 'home', name: 'Home', color: 'green' }], 'saved tags are cleaned');
eq([plugin.settings.board.layout, plugin.settings.board.groupBy, plugin.settings.board.scope], ['board', 'status', 'target'], 'board prefs merge with defaults');
eq(!!app.views['taskpro-task-board'], true, 'board view registered');
eq(['open-task-board', 'set-task-tags', 'manage-task-tags'].every((id) => app.commands.some((c) => c.id === id)), true, 'new commands registered');

// ── the board's index ──────────────────────────────────────────────────────
await plugin.taskStore.ensureLoaded();
eq(plugin.taskStore.all().length, 6, 'every task in the vault is indexed');
let notified = 0;
plugin.taskStore.subscribe(() => notified++);

// ── tags ───────────────────────────────────────────────────────────────────
const launch = { filePath: PLANNER, lineContent: note(PLANNER)[1], blockId: 'launch', lineNumber: 1 };
await plugin.setTaskTagsFor(launch, ['work', 'deep-work']);
eq(note(PLANNER)[1], '- [ ] Draft the launch post @priority(high) @tag(work, deep-work) ^launch', 'tags written before the block id');

// ── title, keeping every marker ────────────────────────────────────────────
await plugin.setTaskTextFor({ ...launch, lineContent: note(PLANNER)[1] }, 'Draft and publish the launch post');
eq(note(PLANNER)[1], '- [ ] Draft and publish the launch post @priority(high) @tag(work, deep-work) ^launch', 'renamed, markers and block id kept');

// ── status, priority, deadline ─────────────────────────────────────────────
await plugin.setTaskStatusFor({ filePath: PLANNER, lineContent: note(PLANNER)[1], lineNumber: 1 }, '[/]');
await plugin.setTaskPriorityFor({ filePath: PLANNER, lineContent: note(PLANNER)[1], lineNumber: 1 }, 'highest');
await plugin.setTaskDeadlineFor({ filePath: PLANNER, lineContent: note(PLANNER)[1], lineNumber: 1 }, '2026-10-01');
eq(note(PLANNER)[1], '- [/] Draft and publish the launch post @tag(work, deep-work) @priority(highest) @due(2026-10-01) ^launch', 'status, priority and deadline all land on the same line');

// Two identical lines: the line hint picks the second one, not the first match.
await plugin.setTaskStatusFor({ filePath: PLANNER, lineContent: '- [ ] Call the printer', lineNumber: 3 }, '[x]');
eq([note(PLANNER)[2], note(PLANNER)[3]], ['- [ ] Call the printer', '- [x] Call the printer'], 'the line hint tells duplicate lines apart');

// A stale hint (the line moved) falls back to finding the task by its text.
await plugin.setTaskStatusFor({ filePath: PLANNER, lineContent: '- [ ] Call the printer', lineNumber: 1 }, '[/]');
eq(note(PLANNER)[2], '- [/] Call the printer', 'a stale hint falls back to the text lookup');

// ── the index follows the edits ────────────────────────────────────────────
await wait(200);
eq(notified > 0, true, 'board subscribers are told about changes');
const indexed = plugin.taskStore.inFile(PLANNER).find((t) => t.blockId === 'launch');
eq([indexed.text, indexed.tags, indexed.priority, indexed.status], ['Draft and publish the launch post', ['work', 'deep-work'], 'highest', '[/]'], 'the index re-parses changed notes');

// ── sync: tags on a linked copy reach the source note ──────────────────────
const linked = { filePath: PLANNER, lineContent: note(PLANNER)[4], lineNumber: 4 };
await plugin.setTaskTagsFor(linked, ['work']);
eq(note(PLANNER)[4], '- [/] Linked copy of a weekly task @tag(work)', 'tags on the linked copy');
eq(note(SOURCE)[0], '- [/] Linked copy of a weekly task @tag(work) ^src1', 'and synced to the source task');

// Renaming the copy moves the mapping with it, so sync keeps working afterwards.
await plugin.setTaskTextFor({ ...linked, lineContent: note(PLANNER)[4] }, 'Weekly task, renamed');
await plugin.setTaskStatusFor({ filePath: PLANNER, lineContent: note(PLANNER)[4], lineNumber: 4 }, '[x]');
eq(note(SOURCE)[0], '- [x] Linked copy of a weekly task @tag(work) ^src1', 'a renamed copy still syncs its status');

// ── the tag list ───────────────────────────────────────────────────────────
await plugin.setTagList([...plugin.settings.tags, { key: 'deep-work', name: 'Deep work', color: 'cyan' }]);
eq(app.data.tags.map((t) => t.key), ['work', 'home', 'deep-work'], 'tag list saved');

const counts = await plugin.tagManagerHost().countUsage();
eq(Object.fromEntries([...counts].sort()), { 'deep-work': 1, home: 1, work: 4 }, 'usage counts over the whole vault');

const removed = await plugin.tagManagerHost().removeFromNotes('work');
eq(removed, 4, 'removed from every task that had it');
eq(note(PLANNER)[1].includes('@tag(deep-work)'), true, 'other tags on the line stay');
eq(note('Life/Home.md')[0], '- [ ] Groceries @tag(home)', 'removed in other notes too');
eq(note(SOURCE)[0], '- [x] Linked copy of a weekly task ^src1', 'and a line left with no tags loses the marker');

// ── quick add ──────────────────────────────────────────────────────────────
eq(await plugin.appendTaskLine('Life/Home.md', '- [ ] Water the plants @tag(home)'), true, 'append succeeds');
eq(note('Life/Home.md').slice(-2), ['- [ ] Water the plants @tag(home)', ''], 'appended on its own line with a trailing newline');
eq(note('Life/Home.md')[1], 'plain text, no newline at the end', 'existing last line left intact');
eq(await plugin.appendTaskLine('Missing.md', '- [ ] x'), false, 'a missing note is reported, not created');

// ── board host ─────────────────────────────────────────────────────────────
const host = plugin.createBoardHost();
eq(host.getSettings().board.layout, 'board', 'the host reads live board prefs');
await wait(200);
const groceries = plugin.taskStore.inFile('Life/Home.md')[0];
await host.setTags(groceries, ['home', 'deep-work']);
eq(note('Life/Home.md')[0], '- [ ] Groceries @tag(home, deep-work)', 'the board edits through the same path');

// ── floating board ─────────────────────────────────────────────────────────
const floatCommand = app.commands.find((c) => c.id === 'toggle-floating-task-board');
eq(floatCommand?.hotkeys, [{ modifiers: ['Mod', 'Shift'], key: 'b' }], 'the float has a default shortcut');
// The board inside the modal renders into the mock's inert DOM; what matters
// here is the toggle and the hooks a theme reads.
floatCommand.callback();
const floating = plugin.floatingBoard;
eq(!!floating, true, 'the command opens the float');
eq(bodyElement.classes.has('taskpro-board-is-floating'), true, 'body carries the hook a theme blurs from');
eq(floating.containerEl.classes.has('taskpro-board-float'), true, 'and so does the modal container');
eq(floating.scope.registered, [['Mod+Shift', 'b']], 'the same keys close it from inside the modal');
floatCommand.callback();
eq([plugin.floatingBoard, bodyElement.classes.has('taskpro-board-is-floating')], [null, false], 'the command toggles it closed and the hook comes off');
floatCommand.callback();
plugin.onunload();
eq(bodyElement.classes.has('taskpro-board-is-floating'), false, 'unloading the plugin never leaves the blur behind');

console.log(`PLUGIN_EDITS_OK (${checked} checks)${notices.length ? ` · ${notices.length} notices` : ''}`);
