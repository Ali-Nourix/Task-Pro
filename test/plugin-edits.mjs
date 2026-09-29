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
  'Life/Gym.md': '- [ ] Gym @repeat(1w) @schedule(2099-01-05 07:00-08:00)\n',
  'Templates/Day.md': '# {{title}}\n\n{{weekday}}, {{gregorian}}\n\n## Plan\n',
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
eq(plugin.taskStore.all().length, 7, 'every task in the vault is indexed');
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

// ── calendar: daily notes ──────────────────────────────────────────────────
eq(
  ['open-task-calendar', 'schedule-current-task', 'open-todays-daily-note'].every((id) => app.commands.some((c) => c.id === id)),
  true,
  'calendar commands registered'
);
eq([plugin.settings.calendar.dailyNotesFolder, plugin.settings.calendar.jalaliNoteFormat], ['Daily', 'jYYYY-jMM-jDD'], 'calendar settings get their defaults');
Object.assign(plugin.settings.calendar, { dailyNotesFolder: 'Journal/Daily', templatePath: 'Templates/Day', taskHeading: '## Plan' });

const DAY = '2026-09-28';
const JALALI_NOTE = 'Journal/Daily/1405-07-06.md';
eq(host.dayNoteTarget(DAY, 'jalali'), { path: JALALI_NOTE, exists: false, isDailyNote: true }, 'a new note is named in the calendar shown');
eq(await host.addTaskOnDay(DAY, '- [ ] Plan the week', 'jalali'), JALALI_NOTE, 'adding a task makes the day’s note');
eq(app.vault.folders.has('Journal') && app.vault.folders.has('Journal/Daily'), true, 'with its folders');
// Names in a Jalali-named note are Persian, as its title is.
eq(note(JALALI_NOTE), ['# 1405-07-06', '', 'دوشنبه, 2026-09-28', '', '## Plan', '', '- [ ] Plan the week', ''], 'from the template, the task a line under its heading');

// The same day with the Gregorian calendar showing still finds the Jalali-named note.
eq(host.dayNoteTarget(DAY, 'gregorian'), { path: JALALI_NOTE, exists: true, isDailyNote: true }, 'the other calendar’s name is looked for');
await host.addTaskOnDay(DAY, '- [ ] Book flights @schedule(2026-09-28 09:00-10:00)', 'gregorian');
eq(app.vault.files.has('Journal/Daily/2026-09-28.md'), false, 'so a day never gets a second note');
eq(note(JALALI_NOTE).slice(6, 8), ['- [ ] Plan the week', '- [ ] Book flights @schedule(2026-09-28 09:00-10:00)'], 'the next task goes under the first');
eq(host.dailyNotesFor(DAY), [JALALI_NOTE], 'the calendar finds the note for its day');

plugin.settings.calendar.newTaskTarget = 'inbox';
plugin.settings.board.inboxPath = 'Life/Home.md';
eq(host.dayNoteTarget(DAY, 'jalali'), { path: 'Life/Home.md', exists: true, isDailyNote: false }, 'or the inbox, when set so');
plugin.settings.calendar.newTaskTarget = 'daily';

// ── calendar: plans ────────────────────────────────────────────────────────
await wait(200);
const flights = plugin.taskStore.inFile(JALALI_NOTE).find((t) => t.text === 'Book flights');
eq(flights.schedule, { date: DAY, start: '09:00', end: '10:00' }, 'the store reads a new note’s plans');
await host.setSchedule(flights, { date: '2026-09-29', start: '14:00', end: '15:30' });
eq(note(JALALI_NOTE)[7], '- [ ] Book flights @schedule(2026-09-29 14:00-15:30)', 'a plan moved');
await wait(200);
await host.setSchedule(plugin.taskStore.inFile(JALALI_NOTE).find((t) => t.text === 'Book flights'), null);
eq(note(JALALI_NOTE)[7], '- [ ] Book flights', 'and taken off the calendar');

// A plan is not synced to a linked source: it is when this copy gets done.
await wait(200);
const linkedNow = plugin.taskStore.inFile(PLANNER).find((t) => t.lineNumber === 4);
await host.setSchedule(linkedNow, { date: DAY });
eq(note(PLANNER)[4].endsWith(`@schedule(${DAY})`), true, 'the linked copy is planned');
eq(note(SOURCE)[0].includes('@schedule('), false, 'its source is not');

// Ticking off a repeating plan moves it on by its interval, time kept, no deadline added.
const gym = app.vault.getFileByPath('Life/Gym.md');
await app.vault.process(gym, (content) => content.replace('- [ ]', '- [x]'));
await wait(600);
eq(note('Life/Gym.md')[0], '- [ ] Gym @repeat(1w) @schedule(2099-01-12 07:00-08:00)', 'a repeating plan rolls to the next week');

// ── quick edits from the right-click menu ─────────────────────────────────
await app.vault.createFolder('Projects');
await app.vault.create('Projects/Figma.md', ['- [ ] Figma', '\t- [ ] Auto layout', '\t\t- a note under it', '- [ ] Next'].join('\n'));
await wait(200);
const figma = () => plugin.taskStore.inFile('Projects/Figma.md');
eq(figma().map((t) => [t.text, t.parentId ?? null]), [['Figma', null], ['Auto layout', 'Projects/Figma.md:0'], ['Next', null]], 'the store links a subtask to its parent');
eq(await host.insertTask(figma()[0], '- [ ] Prototyping', 'child'), true, 'a subtask is written');
eq(note('Projects/Figma.md'), ['- [ ] Figma', '\t- [ ] Auto layout', '\t\t- a note under it', '\t- [ ] Prototyping', '- [ ] Next'], 'as the last child, with the note’s own indent');
await wait(200);
await host.insertTask(figma()[0], figma()[0].line, 'sibling');
eq(note('Projects/Figma.md')[4], '- [ ] Figma', 'a copy goes after the task and everything under it');
await wait(200);
await host.setRepeat(figma()[4], { every: 2, unit: 'week' });
eq(note('Projects/Figma.md')[5], '- [ ] Next @repeat(2w)', 'a repeat rule is written');
await wait(200);
await host.setDeadline(figma()[4], '2026-10-01');
eq(note('Projects/Figma.md')[0], '- [ ] Figma', 'the task it was copied from is left alone');
eq(note('Projects/Figma.md')[5], '- [ ] Next @repeat(2w) @due(2026-10-01)', 'and a deadline, without a picker');
await wait(200);
await host.setRepeat(figma()[3], { every: 1, unit: 'day' });
eq([note('Projects/Figma.md')[0], note('Projects/Figma.md')[4]], ['- [ ] Figma', '- [ ] Figma @repeat(1d)'], 'an edit to the copy lands on the copy, not the identical line above');
eq(app.suggests?.length, 1, 'typing @ on a task line is registered');

// Deleting a task from the board takes it, and what is nested under it, out of the note.
await wait(200);
const before = notices.length;
eq(await host.deleteTask(figma()[0]), true, 'a task is deleted');
eq(note('Projects/Figma.md'), ['- [ ] Figma @repeat(1d)', '- [ ] Next @repeat(2w) @due(2026-10-01)'], 'with its subtasks and the note under them');
eq(notices.slice(before), ['Deleted “\u2068Figma\u2069” and its 2 subtasks'], 'and a notice says what went');

// ── moving a task to another note ──────────────────────────────────────────
await app.vault.createFolder('Move');
await app.vault.create(
  'Move/From.md',
  [
    '# Plan',
    '- [ ] Ship it @priority(high) ^ship',
    '\t- [ ] Write the notes ^notes',
    '\t\t- context under the subtask',
    '\t- [ ] Tag the release @waiting([[#^local]])',
    '- [ ] Announce @waiting([[Move/From#^ship]], [[#^local]])',
    '- [ ] Local one ^local',
    '- [ ] Party',
  ].join('\n')
);
// A note that already uses the ID `notes`, one that waits on both moving tasks, and a source for the linked copy.
await app.vault.create('Move/To.md', '- [ ] Existing ^notes\n');
await app.vault.create('Move/Other.md', '- [ ] Watcher @waiting([[From#^ship]], [[From#^notes]])');
await app.vault.create('Move/Src.md', '- [ ] Party ^srcp');
await app.vault.create('Move/Boom.md', 'nothing yet\n');
plugin.settings.taskMappings.push({
  linked: true,
  importedFilePath: 'Move/From.md',
  importedLineContent: '- [ ] Party',
  sourceFilePath: 'Move/Src.md',
  sourceLineContent: '- [ ] Party ^srcp',
  sourceBlockId: 'srcp',
  lastSynced: 0,
});
await plugin.saveTaskProgress('Move/From.md', 'ship', { enabled: true, currentSteps: 1, totalSteps: 4 });
plugin.settings.taskTimers.push({
  filePath: 'Move/From.md',
  blockId: 'ship',
  timer: { enabled: true, durationSeconds: 1500, elapsedSeconds: 300, runningSince: 0 },
});
plugin.timerService.rebuildCache();
await wait(200);
const inNote = (path, text) => plugin.taskStore.inFile(path).find((t) => t.text === text);

eq(host.notes().map((n) => n.path).filter((p) => p.startsWith('Move/')).sort(), ['Move/Boom.md', 'Move/From.md', 'Move/Other.md', 'Move/Src.md', 'Move/To.md'], 'the host lists every note to move to');

// Not to itself, not to a note that is not there.
eq(await host.moveTask(inNote('Move/From.md', 'Party'), 'Move/From.md'), false, 'a task does not move to the note it is in');
eq(await host.moveTask(inNote('Move/From.md', 'Party'), 'Move/Missing.md'), false, 'nor to a note that does not exist');

// A subtask moves out of its parent, into a note that already uses its block ID.
const beforeFrom = note('Move/From.md').slice();
eq(await host.moveTask(inNote('Move/From.md', 'Write the notes'), 'Move/To.md'), true, 'a subtask moves');
eq(note('Move/From.md'), beforeFrom.filter((_, i) => i !== 2 && i !== 3), 'it and the note under it leave their note');
const landedLines = note('Move/To.md');
const freshId = /\^(tp-[0-9a-z]+)$/.exec(landedLines[landedLines.length - 3] ?? '')?.[1];
eq(landedLines[0], '- [ ] Existing ^notes', 'the other note keeps what it had');
eq(
  landedLines.slice(1).map((l) => l.replace(/\^tp-[0-9a-z]+$/, '^NEW')),
  ['- [ ] Write the notes ^NEW', '\t- context under the subtask', ''],
  'at the end, at the left edge, its note still nested under it'
);
eq(!!freshId && freshId !== 'notes', true, 'the block ID the other note used is swapped for a new one');
await wait(200);
eq(plugin.taskStore.all().filter((t) => t.blockId === 'notes').length, 1, 'no two blocks share an ID');
eq(note('Move/Other.md')[0], `- [ ] Watcher @waiting([[From#^ship]], [[Move/To#^${freshId}]])`, 'a task elsewhere that waited on it follows it');

// A parent moves with its remaining subtask; what is kept about it follows.
const ship = inNote('Move/From.md', 'Ship it');
eq(await host.moveTask(ship, 'Move/To.md'), true, 'a parent moves');
eq(note('Move/From.md').some((l) => l.includes('Tag the release')), false, 'with its subtask');
const shipped = note('Move/To.md');
eq(
  shipped.slice(-3),
  ['- [ ] Ship it @priority(high) ^ship', '\t- [ ] Tag the release @waiting([[Move/From#^local]])', ''],
  'nested as it was; a subtask that waited on a task "here" now names the note it left'
);
eq(note('Move/From.md')[1], '- [ ] Announce @waiting([[Move/To#^ship]], [[#^local]])', 'a task left behind follows what it waited on, and still means its own note by "here"');
eq(note('Move/Other.md')[0], `- [ ] Watcher @waiting([[Move/To#^ship]], [[Move/To#^${freshId}]])`, 'so does one in another note');
eq([plugin.getTaskProgress('Move/From.md', 'ship'), plugin.getTaskProgress('Move/To.md', 'ship')?.currentSteps], [undefined, 1], 'a progress bar goes with its task');
eq(plugin.timerService.get('Move/From.md', 'ship') === undefined && plugin.timerService.get('Move/To.md', 'ship')?.elapsedSeconds === 300, true, 'and so does a timer');
eq(app.data.taskProgress.map((e) => [e.filePath, e.blockId]), [['Move/To.md', 'ship']], 'the saved entry is re-keyed, not duplicated');

// A copy imported from a source keeps syncing from its new note.
await wait(200);
eq(await host.moveTask(inNote('Move/From.md', 'Party'), 'Move/To.md'), true, 'a linked copy moves');
await wait(200);
const party = inNote('Move/To.md', 'Party');
await host.setStatus(party, '[x]');
eq(note('Move/Src.md')[0], '- [x] Party ^srcp', 'and its status still reaches the source');
// Its source can move too, and the copy still reaches it.
await wait(200);
eq(await host.moveTask(inNote('Move/Src.md', 'Party'), 'Move/Boom.md'), true, 'a source moves');
await wait(200);
await host.setStatus(inNote('Move/To.md', 'Party'), '[/]');
eq(note('Move/Boom.md').includes('- [/] Party ^srcp'), true, 'and the copy syncs to it there');

// A block the other note cannot take goes back exactly where it was.
await wait(200);
const stay = note('Move/From.md').slice();
const realProcess = app.vault.process.bind(app.vault);
const realError = console.error;
console.error = () => {};
app.vault.process = async (file, fn) => {
  if (file.path === 'Move/Boom.md') throw new Error('disk full');
  return realProcess(file, fn);
};
eq(await host.moveTask(inNote('Move/From.md', 'Local one'), 'Move/Boom.md'), false, 'a failed write is reported');
app.vault.process = realProcess;
console.error = realError;
eq(note('Move/From.md'), stay, 'and the task is back in its note, untouched');

// Copy link: a task without a block ID is given one.
await wait(200);
const link = await host.blockLink(inNote('Move/From.md', 'Local one'));
eq(link, '[[Move/From#^local]]', 'a task with an ID links to it');
const bare = inNote('Move/To.md', 'Existing');
const bareLink = await host.blockLink(inNote('Move/To.md', 'Party'));
eq(/^\[\[Move\/To#\^[a-zA-Z0-9-]+\]\]$/.test(bareLink), true, 'a task without one gets one written into its line');
eq(note('Move/To.md').find((l) => l.includes('Party')).endsWith(` ^${bareLink.replace(/^.*#\^/, '').replace(']]', '')}`), true, 'the line carries the ID the link names');
eq(bare.blockId, 'notes', 'the others are left alone');

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
