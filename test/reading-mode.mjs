/**
 * Runs the Reading view's chip processor (src/reading-mode-processor.ts) in
 * Chromium over a list shaped like Obsidian's rendered one, where a parent
 * task's <li> holds its subtasks' list. Each item's chips must come from its
 * own line, sit on that line, and leave its subtasks' markers alone.
 *
 * Needs Playwright and Chromium, like the other UI tests (PW_CHROMIUM).
 */
import * as esbuild from 'esbuild';
import path from 'path';
import fs from 'node:fs';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const here = path.dirname(fileURLToPath(import.meta.url));
const built = await esbuild.build({
  stdin: {
    contents: "import { createReadingModeProcessor } from './src/reading-mode-processor'; window.createReadingModeProcessor = createReadingModeProcessor;",
    resolveDir: path.join(here, '..'),
    loader: 'ts',
  },
  bundle: true,
  write: false,
  format: 'iife',
  platform: 'browser',
  target: 'es2020',
  define: { __LUCIDE__: '{}' },
  plugins: [
    {
      name: 'obsidian-stub',
      setup(build) {
        build.onResolve({ filter: /^obsidian$/ }, () => ({ path: path.join(here, 'harness', 'obsidian-stub.ts') }));
      },
    },
  ],
  logLevel: 'error',
});

const SOURCE = [
  '- [ ] Launch the new site @schedule(2026-09-28) @due(2026-10-02)',
  '    - [x] Write the copy',
  '    - [ ] Design the pages @schedule(2026-09-28 14:53-15:53) @priority(high)',
  '- [ ] Review with the team @schedule(2026-09-29 09:00-09:30)',
  '- [ ] Call the vet @remind(2026-10-05 09:30)',
].join('\n');

// What Obsidian renders for it: the subtasks' list inside the parent's item.
const HTML = `
<div class="markdown-preview-section"><div class="el-ul"><ul class="contains-task-list">
  <li data-line="0" data-task="" class="task-list-item"><input type="checkbox" class="task-list-item-checkbox">Launch the new site @schedule(2026-09-28) @due(2026-10-02)
    <ul class="contains-task-list">
      <li data-line="1" data-task="x" class="task-list-item is-checked"><input type="checkbox" class="task-list-item-checkbox" checked>Write the copy</li>
      <li data-line="2" data-task="" class="task-list-item"><input type="checkbox" class="task-list-item-checkbox">Design the pages @schedule(2026-09-28 14:53-15:53) @priority(high)</li>
    </ul>
  </li>
  <li data-line="3" data-task="" class="task-list-item"><input type="checkbox" class="task-list-item-checkbox">Review with the team @schedule(2026-09-29 09:00-09:30)</li>
  <li data-line="4" data-task="" class="task-list-item"><input type="checkbox" class="task-list-item-checkbox">Call the vet @remind(2026-10-05 09:30)</li>
</ul></div></div>`;

const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.setContent(`<body>${HTML}</body>`);
await page.addScriptTag({ content: built.outputFiles[0].text });

const result = await page.evaluate((source) => {
  const settings = {
    enableBadges: true,
    badgeLanguage: 'en',
    badgeSize: 12,
    showBadgesInEmbeds: true,
    targetFolder: '',
    calendarSystem: 'gregorian',
    showPriorityBadges: true,
    showTimerBadges: true,
    showRepeatBadges: true,
    showTagBadges: true,
    showScheduleBadges: true,
    showSubtaskProgress: true,
    showWaitingBadges: true,
    timeFormat: '24h',
    tags: [],
  };
  const process = window.createReadingModeProcessor({}, () => settings, () => undefined, () => undefined);
  const root = document.querySelector('.markdown-preview-section');
  const children = [];
  const ctx = { sourcePath: 'Planner/Launch.md', getSectionInfo: () => ({ text: source, lineStart: 0, lineEnd: 4 }), addChild: child => children.push(child) };
  window.readingHarness = { settings, children, process, root, ctx };
  process(root, ctx);

  const item = (line) => document.querySelector(`li[data-line="${line}"]`);
  const chips = (line) => item(line).querySelector(':scope > .taskpro-badge-container');
  const own = (line) =>
    Array.from(item(line).childNodes)
      .filter((n) => n.nodeType === Node.TEXT_NODE)
      .map((n) => n.textContent)
      .join('')
      .trim();
  const has = (line, cls) => !!chips(line)?.querySelector(`.${cls}`);
  const text = (line, cls) => chips(line)?.querySelector(`.${cls}`)?.textContent ?? null;
  return {
    containers: document.querySelectorAll('.taskpro-badge-container').length,
    parentChipsBeforeSubtasks: chips(0)?.nextElementSibling?.tagName ?? null,
    parentSubtasks: text(0, 'taskpro-subtask-badge'),
    parentPlan: text(0, 'taskpro-schedule-badge'),
    parentDeadline: has(0, 'taskpro-deadline-badge'),
    parentPriority: has(0, 'taskpro-priority-badge'),
    parentText: own(0),
    childPlan: text(2, 'taskpro-schedule-badge'),
    childPriority: has(2, 'taskpro-priority-badge'),
    childText: own(2),
    doneChildStatus: chips(1)?.textContent ?? null,
    siblingPlan: text(3, 'taskpro-schedule-badge'),
    remindChip: text(4, 'taskpro-remind-badge'),
    remindText: own(4),
  };
}, SOURCE);
// Exercise the same real Reading renderer in a mobile note, not only a mock row.
await page.addStyleTag({content: fs.readFileSync(path.join(here,'obsidian-theme.css'),'utf8')});
await page.addStyleTag({content: fs.readFileSync(path.join(here,'../styles.css'),'utf8')});
await page.addStyleTag({content:'body{margin:0;padding:20px;background:var(--background-primary);color:var(--text-normal);font:16px/1.8 Arial;}ul{padding-inline-start:20px;}li{padding-block:8px;} .markdown-preview-section{max-width:100%;}'});
await page.evaluate(()=>{document.body.classList.add('is-mobile','theme-dark');document.querySelector('.markdown-preview-section').classList.add('markdown-preview-view');});
await page.setViewportSize({width:390,height:844});
const first=page.locator('li[data-line="0"] > .taskpro-badge-container');
const more=first.locator('.taskpro-chip-more');await more.waitFor();
const mobile = {};
mobile.visible = await first.locator('.taskpro-chip:visible').count();
await page.evaluate(()=>document.addEventListener('taskpro-badge-click',e=>{window.clickedAnchor=e.detail.targetElement;window.clickedTask={file:e.detail.filePath,targetConnected:e.detail.targetElement.isConnected};}));
await more.click();const pop=page.locator('.taskpro-mobile-chip-menu');await pop.waitFor();
mobile.plan = await pop.locator('.taskpro-schedule-badge').count();
await page.screenshot({path:'/data/taskpro-mobile-reading-more.png'});
await pop.locator('.taskpro-schedule-badge').click();await pop.waitFor({state:'detached'});
mobile.context = await page.evaluate(()=>window.clickedTask);
mobile.anchor = await page.evaluate(()=>clickedAnchor.isConnected && clickedAnchor.classList.contains('taskpro-chip-more') && clickedAnchor.getBoundingClientRect().width > 0);
await more.click();await page.evaluate(()=>readingHarness.children.forEach(child=>child.unload()));
mobile.unloaded = await page.locator('.taskpro-mobile-chip-menu, .taskpro-chip-more').count();
await browser.close();

let checked = 0;
function eq(actual, expected, label) {
  checked++;
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${label}:\n  got      ${a}\n  expected ${e}`);
}

eq(errors, [], 'no page errors');
eq(mobile.visible, 1, 'real mobile note has one visible capsule');
eq(mobile.plan, 1, 'real plan chip is reachable in More');
eq(mobile.context, {file:'Planner/Launch.md',targetConnected:true}, 'real chip retains task event and usable anchor');
eq(mobile.anchor, true, 'async editor anchor stays visible after More closes');
eq(mobile.unloaded, 0, 'Reading lifecycle unload removes menus and listeners');
eq(result.containers, 5, 'one row of chips per task');
eq(result.parentChipsBeforeSubtasks, 'UL', "a parent's chips on its own line, before its subtasks");
eq(result.parentSubtasks, '1/2', "a parent's subtask progress");
eq(result.parentPlan?.includes('14:53') ?? null, false, "a parent's plan is its own, not a subtask's time");
eq(result.parentDeadline, true, "a parent's deadline");
eq(result.parentPriority, false, "a subtask's priority is not the parent's");
eq(result.parentText, 'Launch the new site', "the parent's markers hidden");
eq(result.childPlan?.includes('14:53') ?? null, true, "a subtask's plan chip, though its parent was read first");
eq(result.childPriority, true, "a subtask's own priority");
eq(result.childText, 'Design the pages', "the subtask's markers hidden");
eq(result.doneChildStatus?.includes('Done') ?? null, true, 'a done subtask reads as done');
eq(result.siblingPlan?.includes('09:00') ?? null, true, 'the next task keeps its plan');

eq(result.remindChip?.includes('09:30') ?? null, true, 'a reminder at a moment is a chip with its time, though the task has no plan');
eq(result.remindText, 'Call the vet', 'and its marker is hidden');

console.log(`READING_MODE_OK (${checked} checks)`);
