/**
 * The calendar's pure layer: dates in both calendars, the schedule marker,
 * daily-note names and templates, what shows on each day, and how clashing
 * blocks share a column.
 */
import * as esbuild from 'esbuild';

const build = await esbuild.build({
  stdin: {
    contents: `
      export * from "../src/calendar/calendar-dates";
      export * from "../src/calendar/calendar-items";
      export {
        dailyNoteName, dailyNotePath, dailyNoteCandidates, namingSystem, renderDailyTemplate, insertTaskLine, cleanFolder,
      } from "../src/calendar/daily-notes";
      export {
        extractSchedule, setSchedule, stripSchedule, formatScheduleMarker, replaceTaskText, stripTaskMetadata, setDeadline,
      } from "../src/task-metadata";
      export { parseBoardTasks } from "../src/board/task-store";
      export { parseTaskLine } from "../src/task-identity";
      export { isolate } from "../src/bidi";
      export { findToken, removeToken, propertySuggestions } from "../src/editor/property-suggest";
      export { parseTasksWithHierarchy } from "../src/task-parser";
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
          contents: 'export const setIcon = () => {}; export class TFile {}; export class App {}; export class EditorSuggest {}; export class Modal {}; export class Notice {}; export class Menu {}; export class Scope {}; export class Setting {}; export class FuzzySuggestModal {}; export const moment = () => ({});',
          loader: 'js',
        }));
      },
    },
  ],
});

const m = await import('data:text/javascript;base64,' + Buffer.from(build.outputFiles[0].text).toString('base64'));

let checked = 0;
const eq = (actual, expected, label) => {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${label}:\n  got      ${a}\n  expected ${e}`);
  checked++;
};

// ── Day keys ───────────────────────────────────────────────────────────────
eq(m.addDays('2026-09-28', 5), '2026-10-03', 'adding days crosses a month');
eq(m.addDays('2026-03-01', -1), '2026-02-28', 'and goes back across one');
eq(m.addDays('2026-10-25', 1), '2026-10-26', 'a daylight-saving weekend is still one day');
eq(m.daysBetween('2026-01-01', '2027-01-01'), 365, 'days between');
eq(m.weekdayOf('2026-09-28'), 1, '28 Sep 2026 is a Monday');
eq(m.parseDayKey('2026-02-30'), null, 'no 30 February');

// ── Jalali ─────────────────────────────────────────────────────────────────
eq(m.partsIn('2026-09-28', 'jalali'), { year: 1405, month: 7, day: 6 }, '28 Sep 2026 is 6 Mehr 1405');
eq(m.partsIn('2026-03-21', 'jalali'), { year: 1405, month: 1, day: 1 }, 'Nowruz 1405');
eq(m.partsIn('2025-03-20', 'jalali'), { year: 1403, month: 12, day: 30 }, '1403 is a leap year, with 30 Esfand');
eq(m.keyFrom('jalali', 1405, 7, 6), '2026-09-28', 'and back');
eq(m.monthLength('jalali', 1403, 12), 30, 'Esfand of a leap year');
eq(m.monthLength('jalali', 1404, 12), 29, 'Esfand of a common year');
eq(m.monthLength('jalali', 1405, 1), 31, 'the first six months have 31 days');
eq(m.monthLength('jalali', 1405, 7), 30, 'the next five have 30');
eq(m.monthLength('gregorian', 2028, 2), 29, 'a Gregorian leap February');
eq(m.firstOfMonth('2026-09-28', 'jalali'), '2026-09-23', '1 Mehr 1405');
eq(m.addMonths('2026-03-31', 'gregorian', 1), '2026-04-30', 'a month on from the 31st lands on the 30th');
eq(m.partsIn(m.addMonths('2026-09-22', 'jalali', 6), 'jalali'), { year: 1405, month: 12, day: 29 }, '31 Shahrivar + 6 months is the end of Esfand');

// ── Weeks and month grids ──────────────────────────────────────────────────
eq(m.resolveWeekStart('auto', 'jalali'), 6, 'a Jalali week starts on Saturday');
eq(m.resolveWeekStart('auto', 'gregorian'), 1, 'a Gregorian one on Monday');
eq(m.weekOf('2026-09-30', 1), ['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04'], 'Monday week');
eq(m.startOfWeek('2026-09-30', 6), '2026-09-26', 'Saturday week');
const mehr = m.monthWeeks('2026-10-01', 'jalali', 6);
eq([mehr.length, mehr[0][0], mehr.at(-1).at(-1)], [5, '2026-09-19', '2026-10-23'], 'Mehr 1405 in whole Saturday weeks');
eq(mehr.flat().includes('2026-09-23') && mehr.flat().includes('2026-10-22'), true, 'from 1 Mehr to 30 Mehr');
const feb = m.monthWeeks('2027-02-10', 'gregorian', 1);
eq([feb.length, feb[0][0]], [4, '2027-02-01'], 'February 2027 fits in exactly four Monday weeks');
eq(m.isWeekend('2026-10-02', 'jalali'), true, 'Friday is the Iranian weekend');
eq(m.isWeekend('2026-10-03', 'jalali'), false, 'Saturday is not');
eq(m.isoWeek('2026-12-31'), { year: 2026, week: 53 }, 'ISO week 53');
eq(m.isoWeek('2027-01-01'), { year: 2026, week: 53 }, 'which the next New Year belongs to');

// ── Formatting ─────────────────────────────────────────────────────────────
eq(m.formatDay('2026-09-28', 'YYYY-MM-DD', 'en'), '2026-09-28', 'ISO pattern');
eq(m.formatDay('2026-09-28', 'jYYYY-jMM-jDD', 'fa'), '1405-07-06', 'Jalali pattern');
eq(m.formatDay('2026-09-28', 'dddd, D MMMM YYYY', 'en'), 'Monday, 28 September 2026', 'names');
eq(m.formatDay('2026-09-28', 'jD jMMMM jYYYY، dddd', 'fa'), '6 مهر 1405، دوشنبه', 'Persian names');
eq(m.formatDay('2026-09-28', '[Week] W [of] GGGG', 'en'), 'Week 40 of 2026', 'escaped text and ISO weeks');
eq(m.formatDay('2026-09-01', 'Do MMM', 'en'), '1st Sep', 'ordinals');
eq(m.monthTitle('2026-09-28', 'jalali', 'fa'), 'مهر 1405', 'month title');
eq(m.rangeTitle('2026-09-28', '2026-10-04', 'gregorian', 'en'), '28 Sep – 4 Oct 2026', 'range across two months');
eq(m.rangeTitle('2026-09-26', '2026-10-02', 'jalali', 'fa'), '4 – 10 مهر 1405', 'range inside one Jalali month');
eq(m.monthSpan('2026-09-28', '2026-10-04', 'jalali', 'en'), 'Mehr 1405', 'the other calendar’s months');
eq(m.longDay('2026-09-28', 'jalali', 'fa'), 'دوشنبه، 6 مهر 1405', 'a long Persian date');

// ── Times ──────────────────────────────────────────────────────────────────
eq([m.parseClock('9:30'), m.parseClock('24:00'), m.parseClock('24:30'), m.parseClock('x')], [570, 1440, null, null], 'clock parsing');
eq(m.formatClock(570, '12h', 'en'), '9:30 AM', '12-hour');
eq(
  ['9', '930', '0930', '9:30', '9.30', '9:30 pm', '12 am', '12:15 PM', '21:30', '24:00', '۹:۳۰', '۲۱:۰۰', '۹ ب.ظ', '25:00', '9:75', '13 pm', 'soon'].map(m.parseTypedClock),
  [540, 570, 570, 570, 570, 1290, 0, 735, 1290, 1440, 570, 1260, 1260, null, null, null, null],
  'times typed any usual way, in any digits'
);
eq(m.formatClock(0, '12h', 'en'), '12:00 AM', 'midnight on a 12-hour clock');
eq(m.formatClock(13 * 60 + 5, '24h', 'fa'), '13:05', '24-hour');
eq(m.formatHour(15, '12h', 'fa'), '3 ب.ظ', 'Persian hour mark');
eq(m.formatClockRange(540, 630, '24h', 'en'), '09:00 – 10:30', 'a range');
eq(m.formatClockRange(540, 630, '24h', 'fa'), '\u206609:00 – 10:30\u2069', 'kept left to right in Persian, so it does not read backwards');
eq(m.formatClockRange(540, 630, '12h', 'fa'), '9:00 ق.ظ – 10:30 ق.ظ', 'a 12-hour Persian range reads with its words');
eq(m.isolate('Daily/1405-07-05'), '\u2068Daily/1405-07-05\u2069', 'outside text is isolated');

// ── The schedule marker ────────────────────────────────────────────────────
eq(m.extractSchedule('- [ ] Write @schedule(2026-09-28 09:00-10:30)'), { date: '2026-09-28', start: '09:00', end: '10:30' }, 'timed');
eq(m.extractSchedule('- [ ] Write @schedule(2026-09-28)'), { date: '2026-09-28' }, 'a day');
eq(m.extractSchedule('- [ ] Write @schedule(2026-09-28 9:05)'), { date: '2026-09-28', start: '09:05' }, 'a start with no end, normalised');
eq(m.extractSchedule('- [ ] Write @schedule(2026-09-28 10:00-09:00)'), { date: '2026-09-28', start: '10:00' }, 'an end before the start is dropped');
eq(m.extractSchedule('- [ ] Write @schedule(2026-09-28 22:00-24:00)'), { date: '2026-09-28', start: '22:00', end: '24:00' }, 'up to midnight');
eq(m.extractSchedule('- [ ] Write @schedule(2026-02-30)'), undefined, 'not a real day');
eq(
  m.setSchedule('- [ ] Write the report @due(2026-10-01) ^abc', { date: '2026-09-28', start: '09:00', end: '10:30' }),
  '- [ ] Write the report @due(2026-10-01) @schedule(2026-09-28 09:00-10:30) ^abc',
  'written before the block id'
);
eq(m.setSchedule('  - [ ] Nested @schedule(2026-09-28)', null), '  - [ ] Nested', 'cleared, indentation kept');
eq(m.setSchedule('- [ ] A @schedule(2026-09-01) @schedule(2026-09-02)', { date: '2026-09-03' }), '- [ ] A @schedule(2026-09-03)', 'one marker left');
eq(m.stripTaskMetadata('Write @schedule(2026-09-28 09:00-10:00) @tag(a)'), 'Write', 'stripped with every other marker');
eq(m.parseTaskLine('- [ ] Write @schedule(2026-09-28 09:00-10:00)').text, 'Write', 'a schedule never changes a task’s title');
eq(
  m.replaceTaskText('- [ ] Old @schedule(2026-09-28 09:00-10:00) ^x', 'New'),
  '- [ ] New @schedule(2026-09-28 09:00-10:00) ^x',
  'renaming keeps the schedule'
);
eq(m.parseTasksWithHierarchy('- [ ] Plan @schedule(2026-09-28)')[0].content, 'Plan', 'an imported copy does not carry the plan');
eq(
  m.parseBoardTasks('a.md', '- [/] Deep work @schedule(2026-09-28 09:00-11:00)')[0].schedule,
  { date: '2026-09-28', start: '09:00', end: '11:00' },
  'the board reads it'
);

// ── Daily notes ────────────────────────────────────────────────────────────
const notes = {
  dailyNotesFolder: '/Journal//Daily/',
  gregorianNoteFormat: 'YYYY-MM-DD',
  jalaliNoteFormat: 'jYYYY-jMM-jDD',
  dailyNoteNaming: 'view',
  templatePath: '',
  taskHeading: '',
};
eq(m.cleanFolder(notes.dailyNotesFolder), 'Journal/Daily', 'folder setting cleaned');
eq(m.dailyNotePath('2026-09-28', 'gregorian', notes), 'Journal/Daily/2026-09-28.md', 'Gregorian name');
eq(m.dailyNotePath('2026-09-28', 'jalali', notes), 'Journal/Daily/1405-07-06.md', 'Jalali name');
eq(
  m.dailyNotePath('2026-09-28', 'jalali', { ...notes, jalaliNoteFormat: 'jYYYY/jMMMM/jD jMMMM, dddd' }),
  'Journal/Daily/1405/مهر/6 مهر, دوشنبه.md',
  'subfolders and Persian names'
);
eq(m.dailyNoteName('2026-09-28', 'gregorian', { ...notes, gregorianNoteFormat: 'YYYY-MM-DD HH:mm' }), '2026-09-28 HH-mm', 'a colon cannot reach a file name');
eq(m.dailyNoteCandidates('2026-09-28', notes, 'jalali'), ['Journal/Daily/1405-07-06.md', 'Journal/Daily/2026-09-28.md'], 'both names are looked for, the naming calendar first');
eq(m.namingSystem({ ...notes, dailyNoteNaming: 'gregorian' }, 'jalali'), 'gregorian', 'naming can be fixed to one calendar');
eq(m.dailyNotePath('2026-09-28', 'gregorian', { ...notes, dailyNotesFolder: '', gregorianNoteFormat: '' }), '2026-09-28.md', 'vault root, default pattern');

const template = [
  '# {{title}}',
  '{{weekday}} · {{jalali}} · {{gregorian}} · {{date:dddd D MMMM}}',
  '[[{{yesterday}}]] ← → [[{{tomorrow}}]] at {{time}}',
  '<% tp.date.now() %> {{unknown}}',
].join('\n');
eq(
  m.renderDailyTemplate(template, { day: '2026-09-28', system: 'jalali', settings: notes, now: new Date(2026, 8, 28, 7, 5) }).split('\n'),
  ['# 1405-07-06', 'دوشنبه · 1405/07/06 · 2026-09-28 · دوشنبه 28 سپتامبر', '[[1405-07-05]] ← → [[1405-07-07]] at 07:05', '<% tp.date.now() %> {{unknown}}'],
  'template variables, Templater left alone'
);

const daily = ['# 2026-09-28', '', '## Tasks', '- [ ] One', '', '## Notes', 'Some text', ''].join('\n');
eq(m.insertTaskLine(daily, '- [ ] Two', '## Tasks').split('\n'), ['# 2026-09-28', '', '## Tasks', '- [ ] One', '- [ ] Two', '', '## Notes', 'Some text', ''], 'goes at the end of its section');
eq(m.insertTaskLine(daily, '- [ ] Two', 'tasks').split('\n')[4], '- [ ] Two', 'a heading setting without #s matches any level');
eq(m.insertTaskLine('# Day\n', '- [ ] Two', '## Plan'), '# Day\n\n## Plan\n- [ ] Two\n', 'a missing heading is added');
eq(m.insertTaskLine('Text', '- [ ] Two', ''), 'Text\n- [ ] Two\n', 'no heading: the end of the note');
eq(m.insertTaskLine('```\n## Tasks\n```\n', '- [ ] Two', '## Tasks'), '```\n## Tasks\n```\n\n## Tasks\n- [ ] Two\n', 'a heading in a code block is not one');
eq(m.insertTaskLine('## Tasks\n### Sub\n- [ ] a\n## Next', '- [ ] b', '## Tasks').split('\n'), ['## Tasks', '### Sub', '- [ ] a', '- [ ] b', '## Next'], 'subsections belong to the section');

// ── What shows on a day ────────────────────────────────────────────────────
const tasks = m.parseBoardTasks('Projects/Site.md', [
  '- [ ] Deep work @schedule(2026-09-28 09:00-11:00)',
  '- [ ] Review @schedule(2026-09-28 10:00-10:30) @due(2026-09-28)',
  '- [ ] Ship @due(2026-09-29) @priority(high)',
  '- [x] Done thing @schedule(2026-09-28)',
  '- [ ] Later @schedule(2026-10-20)',
  '- [ ] Just a start @schedule(2026-09-29 16:00)',
].join('\n'))
  .concat(m.parseBoardTasks('Daily/2026-09-29.md', ['- [ ] From the daily note', '- [ ] Moved away @schedule(2026-09-30)'].join('\n')));
const options = {
  from: '2026-09-28',
  to: '2026-10-04',
  showDeadlines: true,
  showNoteTasks: true,
  showDone: true,
  defaultDuration: 60,
  noteDay: (path) => (path === 'Daily/2026-09-29.md' ? '2026-09-29' : undefined),
};
const byDay = m.collectItems(tasks, options);
const summary = (day) => (byDay.get(day) ?? []).map((i) => `${i.kind}:${i.task.text}${i.start !== undefined ? `@${i.start}-${i.end}` : ''}${i.dueHere ? '!' : ''}`);
eq(summary('2026-09-28'), ['scheduled:Done thing', 'scheduled:Deep work@540-660', 'scheduled:Review@600-630!'], 'untimed first, then by time; due on the same day is a flag');
eq(summary('2026-09-29'), ['note:From the daily note', 'scheduled:Just a start@960-1020', 'due:Ship'], 'daily-note task, default length, deadline');
eq(summary('2026-09-30'), ['scheduled:Moved away'], 'a schedule wins over the note it lives in');
eq(byDay.has('2026-10-20'), false, 'out of range');
eq(m.collectItems(tasks, { ...options, showDone: false, showDeadlines: false }).get('2026-09-28').length, 2, 'done tasks and deadlines can be hidden');
eq(m.collectItems(tasks, { ...options, showNoteTasks: false }).get('2026-09-29').map((i) => i.kind), ['scheduled', 'due'], 'daily-note tasks can be hidden');

const onCalendar = (task) => options.noteDay(task.filePath) !== undefined;
eq(m.unscheduledTasks(tasks, onCalendar).map((t) => t.text), ['Ship'], 'unscheduled: open, no schedule, not in a shown daily note');

// ── Overlapping blocks ─────────────────────────────────────────────────────
const block = (id, start, end) => ({ id, kind: 'scheduled', task: {}, day: 'x', start, end });
const lanes = (items) => m.layoutBlocks(items).map((b) => `${b.item.id}:${b.lane}/${b.lanes}`);
eq(lanes([block('a', 540, 660), block('b', 600, 630), block('c', 700, 760)]), ['a:0/2', 'b:1/2', 'c:0/1'], 'a clash splits in two; a later block has the width back');
eq(lanes([block('a', 540, 600), block('b', 600, 660)]), ['a:0/1', 'b:0/1'], 'back to back is not a clash');
eq(lanes([block('a', 540, 720), block('b', 550, 600), block('c', 610, 650), block('d', 560, 700)]), ['a:0/3', 'b:1/3', 'd:2/3', 'c:1/3'], 'a freed column is reused');
eq(lanes([block('a', 540, 545), block('b', 546, 550)]), ['a:0/2', 'b:1/2'], 'tiny blocks are given room to be seen');

// ── Families: parents and subtasks ────────────────────────────────────────
const fam = m.parseBoardTasks('P.md', [
  '- [ ] Figma',
  '    - [ ] Auto layout @schedule(2026-09-29 10:00-11:30)',
  '    - [ ] Prototyping',
  '        - [ ] Smart animate',
  '    - [x] Pricing',
  '- [ ] Alone',
  '- [ ] Planned parent @schedule(2026-09-30)',
  '    - [ ] Its open subtask',
].join('\n'));
const index = m.indexFamilies(fam);
const t = Object.fromEntries(fam.map((task) => [task.text, task]));
eq(index.children.get(t['Figma'].id).map((x) => x.text), ['Auto layout', 'Prototyping', 'Pricing'], 'direct subtasks in note order');
eq(m.ancestorsOf(t['Smart animate'], index).map((x) => x.text), ['Prototyping', 'Figma'], 'ancestors, nearest first');
eq(m.rootOf(t['Smart animate'], index).text, 'Figma', 'the outermost task');
eq(m.descendantsOf(t['Figma'], index).length, 4, 'descendants at any depth');
eq([m.inFamily(t['Alone'], index), m.inFamily(t['Pricing'], index)], [false, true], 'who belongs to a family');
const free = m.unscheduledTasks(fam, () => false);
eq(
  m.sidebarRows(free, index).map((r) => `${'  '.repeat(r.depth)}${r.task.text}${r.context ? ' (context)' : ''}`),
  ['Figma', '    Prototyping', '        Smart animate', 'Alone', 'Planned parent (context)', '    Its open subtask'].map((x) => x.replace(/^( +)/, (sp) => '  '.repeat(sp.length / 4))),
  'families stay together, a planned parent shows only to place its subtask'
);

// ── @ on a task line ───────────────────────────────────────────────────────
eq(m.findToken('- [ ] Call mom @pri', 19), { start: 15, query: 'pri' }, 'a token after the checkbox');
eq(m.findToken('- [ ] Call @', 12), { start: 11, query: '' }, 'an @ alone opens the list');
eq(m.findToken('- [ ] کار @یادگیری\u200cها', 21), { start: 10, query: 'یادگیری\u200cها' }, 'a Persian word keeps its half-space');
eq(m.findToken('- [ ] mail a@b', 14), null, 'not inside a word');
eq(m.findToken('Just text @pri', 14), null, 'only on task lines');
eq(m.findToken('- [ ] @due(2026', 15), null, 'not while a marker is typed out');
eq(m.removeToken('- [ ] Call mom @pri', 15, 19), { line: '- [ ] Call mom', cursor: 14 }, 'the typed token goes, and its space');
eq(m.removeToken('- [ ] Call @pri mom', 11, 15), { line: '- [ ] Call mom', cursor: 10 }, 'in the middle too');
const sctx = { language: 'en', calendarSystem: 'gregorian', timeFormat: '24h', tags: [{ key: 'work', name: 'Work', color: 'blue' }], line: '- [ ] Call mom' };
const pick = (q) => m.propertySuggestions(q, sctx).map((x) => `${x.group}:${x.label}`);
eq(pick('high'), ['priority:Highest', 'priority:High'], 'finds priorities by name');
eq(pick('work'), ['tag:Work'], 'and tags');
eq(m.propertySuggestions('high', sctx)[1].apply('- [ ] Call mom'), '- [ ] Call mom @priority(high)', 'writes the canonical marker');
eq(m.propertySuggestions('work', { ...sctx, line: '- [ ] Call @tag(work)' })[0].apply('- [ ] Call @tag(work)'), '- [ ] Call', 'a tag it has is taken off');
eq(pick('weekly').length >= 1 && pick('every week').includes('repeat:Every week'), true, 'repeat presets by their words');
eq(m.propertySuggestions('اولویت زیاد', { ...sctx, language: 'fa' }).map((x) => x.label), ['زیاد'], 'Persian words find Persian labels');

console.log(`CALENDAR_OK (${checked} checks)`);
