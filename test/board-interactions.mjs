/**
 * Clicks through the task board in a real browser: the board is the plugin's
 * own TaskBoard class, driven against test/harness/board-preview.ts, whose host
 * edits in-memory notes the same way the plugin edits real ones.
 *
 * Needs Playwright and lucide-static, installed on demand:
 *   npm i --no-save playwright lucide-static && npx playwright install chromium
 *   node test/board-interactions.mjs
 */
import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import path from 'path';
import { buildHarness } from './harness/build.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
await buildHarness();

const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
let checked = 0;
const eq = (actual, expected, label) => {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${label}:\n  got      ${a}\n  expected ${e}`);
  checked++;
};
const ok = (value, label) => eq(!!value, true, label);

/**
 * Every page in these tests believes it is 15:00 today. The calendar opens on
 * the hours around the current time and draws a line at it, so a test that
 * takes its coordinates from the screen would otherwise behave differently in
 * the morning and at night.
 */
async function atThreeInTheAfternoon(page) {
  const now = new Date();
  now.setHours(15, 0, 0, 0);
  await page.clock.setFixedTime(now);
}

/**
 * Pages open with reduced motion asked for, so that nothing is mid-flight when a
 * test takes its coordinates from the screen. The motion tests open one that
 * moves (`live`).
 */
async function open(query = '', width = 1280, live = false) {
  const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: live ? 'no-preference' : 'reduce' });
  await atThreeInTheAfternoon(page);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`file://${path.join(here, 'board-preview.html')}${query}`);
  await page.waitForSelector('body[data-ready="true"]');
  page.errors = errors;
  return page;
}

const titles = (page, scope = '.taskpro-table__row') =>
  page.$$eval(`${scope} .taskpro-board__title`, (els) => els.map((el) => el.textContent));
const note = (page, file) => page.evaluate((f) => window.__notes[f], file);
const row = (page, title) => page.locator('.taskpro-table__row', { hasText: title });

try {
  // ── Table ────────────────────────────────────────────────────────────────
  let page = await open();
  eq((await titles(page)).length, 12, 'every task is listed');

  // The round checkbox marks a task done, and the row moves to the Done group.
  await row(page, 'Groceries').locator('.taskpro-board__check').click();
  await page.waitForTimeout(50);
  eq((await note(page, 'Life/Home.md')).split('\n')[0].startsWith('- [x] Groceries'), true, 'check writes [x] into the note');
  const doneGroup = await page.$$eval('.taskpro-table__group, .taskpro-table__row', (els) => {
    let group = '';
    for (const el of els) {
      if (el.classList.contains('taskpro-table__group')) group = el.textContent.trim();
      else if (el.textContent.includes('Groceries')) return group;
    }
    return null;
  });
  eq(doneGroup?.startsWith('Done'), true, 'the row now sits under Done');

  // Status from the status chip's menu.
  await row(page, 'Accessibility pass').locator('.taskpro-table__status .taskpro-chip').click();
  await page.locator('.taskpro-menu__item', { hasText: 'In Progress' }).click();
  await page.waitForTimeout(50);
  eq((await note(page, 'Projects/Website redesign.md')).includes('- [/] Accessibility pass'), true, 'status menu writes the status');

  // Inline title editing keeps every marker on the line.
  await row(page, 'Dentist appointment').locator('.taskpro-board__title').click();
  const input = page.locator('.taskpro-board__title-input');
  await input.fill('Dentist check-up');
  await input.press('Enter');
  await page.waitForTimeout(50);
  const home = (await note(page, 'Life/Home.md')).split('\n');
  eq(home[1].startsWith('- [ ] Dentist check-up @priority(medium) @due('), true, 'title renamed, markers kept');
  eq(home[1].endsWith('@tag(health)'), true, 'tag marker kept');

  // Escape cancels an edit.
  await row(page, 'Dentist check-up').locator('.taskpro-board__title').click();
  await page.locator('.taskpro-board__title-input').fill('Something else');
  await page.locator('.taskpro-board__title-input').press('Escape');
  eq((await note(page, 'Life/Home.md')).includes('Something else'), false, 'Escape discards the edit');

  // Priority from the cell's menu.
  await row(page, 'Pick the display typeface').locator('.taskpro-table__priority').click();
  await page.locator('.taskpro-menu__item', { hasText: 'Highest' }).click();
  await page.waitForTimeout(50);
  eq((await note(page, 'Projects/Website redesign.md')).includes('Pick the display typeface @tag(deep-work) @priority(highest)'), true, 'priority written');

  // Tags from the cell: the picker opens with the task's tags selected.
  await row(page, 'Accessibility pass').locator('.taskpro-table__tags').click();
  await page.locator('.taskpro-tag-option', { hasText: 'Learning' }).click();
  await page.locator('.taskpro-tag-picker__search').fill('Research');
  await page.locator('.taskpro-tag-picker__search').press('Enter');
  eq(await page.locator('.taskpro-tag-option.is-selected').allTextContents(), ['Learning', 'Research'], 'picked one, created one');
  await page.locator('.taskpro-panel__btn--primary').click();
  await page.waitForTimeout(50);
  eq((await note(page, 'Projects/Website redesign.md')).includes('Accessibility pass @priority(low) @due('), true, 'markers kept');
  eq((await note(page, 'Projects/Website redesign.md')).includes('@tag(learning, research)'), true, 'new and existing tag written');

  // Search.
  await page.locator('.taskpro-board__search input').fill('invoice');
  await page.waitForTimeout(200);
  eq(await titles(page), ['Chase the missing invoice'], 'search narrows the list');
  await page.locator('.taskpro-board__search input').fill('');
  await page.waitForTimeout(200);

  // Filter by a tag through the menu, then remove it from its pill.
  await page.locator('.taskpro-board__control', { hasText: 'Filter' }).click();
  await page.locator('.taskpro-menu__item', { hasText: 'Client' }).click();
  eq((await titles(page)).sort(), ['Chase the missing invoice', 'Send the quote to Acme'], 'tag filter');
  eq(await page.locator('.taskpro-menu').count(), 1, 'the filter menu stays open for the next switch');
  await page.keyboard.press('Escape');
  eq(await page.locator('.taskpro-menu').count(), 0, 'and Escape closes it');
  eq(await page.locator('.taskpro-board__filter-pill').count(), 1, 'active filter shown as a pill');

  // Quick add inherits the tag filter, so the new task stays visible.
  await page.locator('.taskpro-board__add-input').fill('Prepare the kickoff deck');
  await page.locator('.taskpro-board__add-input').press('Enter');
  await page.waitForTimeout(50);
  eq((await note(page, 'Inbox.md')).trim(), '- [ ] Prepare the kickoff deck @tag(client)', 'quick add writes a task with the filtered tag');
  eq((await titles(page)).includes('Prepare the kickoff deck'), true, 'and it shows up under the filter');

  await page.locator('.taskpro-board__filter-pill').click();
  eq((await titles(page)).length, 13, 'removing the pill clears the filter');

  // Sorting from the header: once ascending, again descending, a third time back to note order.
  const priorityHeader = page.locator('th.taskpro-table__priority');
  await page.locator('.taskpro-board__control', { hasText: 'Group' }).click();
  await page.locator('.menu .menu-item', { hasText: 'No grouping' }).click();
  await priorityHeader.click();
  const byPriority = await titles(page);
  eq(byPriority.slice(0, 3).sort(), ['Chase the missing invoice', 'Pick the display typeface', 'Send the quote to Acme'], 'highest priority first');
  await priorityHeader.click();
  eq((await titles(page))[0], 'Accessibility pass', 'descending puts the lowest priority first');
  await priorityHeader.click();
  eq(await page.locator('th.is-sorted').count(), 0, 'third click returns to note order');

  // Collapsing a group hides its rows and is remembered.
  await page.locator('.taskpro-board__control', { hasText: 'Group' }).click();
  await page.locator('.menu .menu-item', { hasText: 'Status' }).click();
  const before = (await titles(page)).length;
  await page.locator('.taskpro-table__group-toggle', { hasText: 'Not Done' }).click();
  eq((await titles(page)).length, before - 1, 'collapsed group hides its rows');
  eq(await page.evaluate(() => document.querySelector('.taskpro-table__group.is-collapsed') !== null), true, 'group marked collapsed');

  eq(page.errors, [], 'no page errors in the table');
  await page.close();

  // ── Kanban ───────────────────────────────────────────────────────────────
  // Wide enough that every tag column is on screen: Playwright's drag does not
  // scroll the board sideways the way a person dragging to the edge would.
  page = await open('?layout=board', 2200);
  eq(await page.locator('.taskpro-kanban__column').count(), 4, 'one column per status');
  const card = page.locator('.taskpro-card', { hasText: 'Groceries' });
  await card.dragTo(page.locator('.taskpro-kanban__column[data-group="[/]"]'));
  await page.waitForTimeout(50);
  eq((await note(page, 'Life/Home.md')).startsWith('- [/] Groceries'), true, 'dragging a card to a column changes its status');

  // A column's "New" row adds a task with that column's status.
  await page.locator('.taskpro-kanban__column[data-group="[/]"] .taskpro-kanban__add').click();
  await page.locator('.taskpro-kanban__add-input').fill('Review the pull request');
  await page.locator('.taskpro-kanban__add-input').press('Enter');
  await page.waitForTimeout(50);
  eq((await note(page, 'Inbox.md')).trim(), '- [/] Review the pull request', 'column add inherits the column status');

  // Grouped by tag, dropping a card on another tag swaps the tag.
  await page.locator('.taskpro-board__control', { hasText: 'Group' }).click();
  await page.locator('.menu .menu-item', { hasText: 'Tag' }).click();
  eq(await page.locator('.taskpro-kanban__column').count(), 7, 'a column per defined tag, plus "No tag"');
  await page
    .locator('.taskpro-kanban__column[data-group="home"] .taskpro-card', { hasText: 'Groceries' })
    .dragTo(page.locator('.taskpro-kanban__column[data-group="health"]'));
  await page.waitForTimeout(50);
  eq((await note(page, 'Life/Home.md')).split('\n')[0].endsWith('@tag(health)'), true, 'tag swapped by drag');

  eq(page.errors, [], 'no page errors on the board');
  await page.close();

  // ── RTL ──────────────────────────────────────────────────────────────────
  page = await open('?lang=fa');
  eq(await page.getAttribute('.taskpro-board', 'dir'), 'rtl', 'Persian board is right-to-left');
  eq(await page.locator('.taskpro-board__title-text').textContent(), 'تسک‌ها', 'Persian labels');
  eq(page.errors, [], 'no page errors in RTL');
  await page.close();

  // ── Right-click on a row ─────────────────────────────────────────────────
  page = await open('?scope=vault');
  const menuRow = page.locator('.taskpro-table__row', { hasText: 'Accessibility pass' });
  await menuRow.click({ button: 'right', position: { x: 300, y: 10 } });
  eq(await page.locator('.taskpro-menu').count(), 1, 'a right click on a row opens the task menu');
  await page.locator('.taskpro-menu__item', { hasText: 'Repeat' }).hover();
  await page.waitForTimeout(200);
  await page.locator('.taskpro-menu.is-submenu .taskpro-menu__item', { hasText: 'Every month' }).click();
  await page.waitForTimeout(100);
  eq((await note(page, 'Projects/Website redesign.md')).split('\n')[3].includes('@repeat(1m)'), true, 'a repeat set from the row menu');
  await menuRow.locator('.taskpro-table__more button').click();
  eq(await page.locator('.taskpro-menu').count(), 1, 'the ⋯ button opens the same menu');
  await page.keyboard.press('Escape');
  eq(page.errors, [], 'no page errors with the row menu');
  await page.close();

  // ── Table columns: the plan's hours, and moving, resizing, hiding columns ─
  page = await open('?scope=vault&group=none', 1700);
  const headers = () => page.$$eval('thead th[data-column]', (els) => els.map((el) => el.dataset.column));
  eq(await headers(page), ['status', 'tags', 'priority', 'deadline', 'plan', 'waiting', 'progress', 'note'], 'default columns, repeat hidden');
  const planCell = row(page, 'Send the quote to Acme').locator('.taskpro-table__plan');
  eq(await planCell.locator('.taskpro-chip__label').textContent(), 'Today', 'the plan cell names the day');
  eq(await planCell.locator('.taskpro-board__time').textContent(), '14:00 – 15:30', 'and the hours, from when to when');

  // Sorting by plan puts the earliest plan first.
  await page.locator('th[data-column="plan"]').click();
  eq((await titles(page)).slice(0, 3), ['Send the quote to Acme', 'Draft the launch post', 'Weekly review and planning'], 'sorted by plan');
  await page.locator('th[data-column="plan"]').click();
  await page.locator('th[data-column="plan"]').click();

  // Drag a header onto another place.
  const drag = async (from, to, steps = 8) => {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps });
    await page.mouse.up();
    await page.waitForTimeout(50);
  };
  const center = async (selector) => {
    const box = await page.locator(selector).boundingBox();
    return { x: box.x + box.width / 2, y: box.y + box.height / 2, box };
  };
  const noteHead = await center('th[data-column="note"]');
  const status = await center('th[data-column="status"]');
  await drag(noteHead, { x: status.box.x + 6, y: status.y });
  eq(await headers(page), ['note', 'status', 'tags', 'priority', 'deadline', 'plan', 'waiting', 'progress'], 'a dragged header moves its column');
  eq((await page.$$eval('tbody .taskpro-table__row:first-child td[data-column]', (els) => els.map((el) => el.dataset.column)))[0], 'note', 'and its cells move with it');
  eq(await page.locator('th.is-sorted').count(), 0, 'the drop is not a click that sorts');

  // Drag an edge to resize; a double click puts the width back.
  const colWidth = (id) => page.$eval(`col[data-column="${id}"]`, (el) => el.style.width);
  const edge = await page.locator('th[data-column="tags"] .taskpro-table__resize').boundingBox();
  await drag({ x: edge.x + edge.width / 2, y: edge.y + 10 }, { x: edge.x + edge.width / 2 + 60, y: edge.y + 10 });
  eq(await colWidth('tags'), '240px', 'dragging the edge widens the column');
  eq(await page.locator('th.is-sorted').count(), 0, 'resizing does not sort');
  await page.locator('th[data-column="tags"] .taskpro-table__resize').dblclick();
  await page.waitForTimeout(50);
  eq(await colWidth('tags'), '180px', 'a double click resets the width');

  // The header's menu hides a column; the + menu shows it again and adds another.
  await page.locator('th[data-column="priority"]').click({ button: 'right' });
  await page.locator('.taskpro-menu__item', { hasText: 'Hide property' }).click();
  eq((await headers(page)).includes('priority'), false, 'hidden from the header menu');
  await page.locator('.taskpro-table__add-btn').click();
  eq(await page.locator('.taskpro-menu__item', { hasText: 'Priority' }).getAttribute('aria-checked'), 'false', 'the properties menu shows it off');
  await page.locator('.taskpro-menu__item', { hasText: 'Priority' }).click();
  await page.locator('.taskpro-menu__item', { hasText: 'Repeat' }).click();
  eq(await page.locator('.taskpro-menu').count(), 1, 'the menu stays open while switching properties');
  eq((await headers(page)).includes('priority') && (await headers(page)).includes('repeat'), true, 'shown again, and a new column added');
  eq(await row(page, 'Weekly review and planning').locator('.taskpro-table__repeat .taskpro-chip__label').textContent(), 'Every week', 'the repeat column');
  eq(await row(page, 'Weekly review and planning').locator('.taskpro-board__title-wrap .taskpro-board__repeat').count(), 0, 'no repeat mark by the title while the column says it');

  // The properties list reorders by its grips.
  const items = () => page.$$eval('.taskpro-menu__item', (els) => els.map((el) => el.querySelector('.taskpro-menu__label').textContent));
  const grip = await page.locator('.taskpro-menu__item', { hasText: 'Progress' }).locator('.taskpro-menu__grip').boundingBox();
  const target = await page.locator('.taskpro-menu__item', { hasText: 'Tags' }).boundingBox();
  await drag({ x: grip.x + grip.width / 2, y: grip.y + grip.height / 2 }, { x: grip.x + grip.width / 2, y: target.y + 3 });
  eq((await items()).slice(0, 4), ['Note', 'Status', 'Progress', 'Tags'], 'a property dragged in the list');
  eq((await headers(page)).slice(0, 4), ['note', 'status', 'progress', 'tags'], 'and in the table');
  await page.locator('.taskpro-menu__item', { hasText: 'Reset to default' }).click();
  eq(await headers(page), ['status', 'tags', 'priority', 'deadline', 'plan', 'waiting', 'progress', 'note'], 'reset to the default columns');
  await page.keyboard.press('Escape');

  // A header moves with Alt and the arrow keys too.
  await page.locator('th[data-column="tags"]').focus();
  await page.keyboard.press('Alt+ArrowRight');
  eq((await headers(page)).slice(0, 3), ['status', 'priority', 'tags'], 'Alt+→ moves a column later');
  eq(page.errors, [], 'no page errors with the table columns');
  await page.close();

  // Persian: the far edge is on the left, so dragging it left widens the column.
  page = await open('?scope=vault&group=none&lang=fa', 1700);
  const faEdge = await page.locator('th[data-column="tags"] .taskpro-table__resize').boundingBox();
  await drag({ x: faEdge.x + faEdge.width / 2, y: faEdge.y + 10 }, { x: faEdge.x + faEdge.width / 2 - 40, y: faEdge.y + 10 });
  eq(await page.$eval('col[data-column="tags"]', (el) => el.style.width), '220px', 'RTL resize follows the edge');
  const faNote = await center('th[data-column="note"]');
  const faStatus = await center('th[data-column="status"]');
  await drag(faNote, { x: faStatus.box.x + faStatus.box.width - 6, y: faStatus.y });
  eq((await headers(page))[0], 'note', 'RTL drag lands where the line showed');
  eq(page.errors, [], 'no page errors with RTL columns');
  await page.close();

  // ── Copy a link, move to another note ────────────────────────────────────
  page = await open('?scope=vault&group=none', 1700);
  await page.evaluate(() => {
    window.__clip = '';
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (text) => (window.__clip = text) }, configurable: true });
  });
  const bare = 'Accessibility pass';
  await row(page, bare).click({ button: 'right', position: { x: 300, y: 10 } });
  await page.locator('.taskpro-menu__item', { hasText: 'Copy link' }).click();
  await page.waitForTimeout(80);
  eq(await page.evaluate(() => window.__clip), '[[Projects/Website redesign#^tp-link]]', 'Copy link puts a block link on the clipboard');
  ok((await note(page, 'Projects/Website redesign.md')).split('\n').some((line) => line.startsWith('- [ ] Accessibility pass') && line.endsWith(' ^tp-link')), 'and the task is given the ID it names');
  eq((await page.evaluate(() => window.__notices)).at(-1), 'Link copied', 'a notice says so');

  const total = (await titles(page)).length;
  const family = 'Design the new home page';
  await row(page, family).click({ button: 'right', position: { x: 300, y: 10 } });
  await page.locator('.taskpro-menu__item', { hasText: 'Move to note' }).click();
  eq(await page.locator('.taskpro-menu__header').textContent(), 'Move to note', 'the picker is titled');
  eq(await page.locator('.taskpro-menu__search').getAttribute('placeholder'), 'Find a note…', 'with a search field');
  const noteRows = () => page.$$eval('.taskpro-menu__item', (els) => els.map((el) => [el.querySelector('.taskpro-menu__label').textContent, el.querySelector('.taskpro-menu__hint')?.textContent ?? '']));
  eq(await noteRows(), [['Inbox', ''], ['Someday', 'Projects'], ['2026-W39', 'Planner'], ['Home', 'Life']], 'the inbox first, then notes beside this one, then the others that hold tasks; not the note it is in');
  await page.locator('.taskpro-menu__search').fill('life');
  eq(await noteRows(), [['Home', 'Life']], 'typing finds a note by its folder');
  await page.locator('.taskpro-menu__search').fill('som');
  eq(await noteRows(), [['Someday', 'Projects']], 'or by its name, a note with no tasks included');
  await page.locator('.taskpro-menu__item', { hasText: 'Someday' }).click();
  await page.waitForTimeout(120);
  eq((await note(page, 'Projects/Someday.md')).split('\n').map((l) => l.replace(/ @\S+/g, '')), ['- [/] Design the new home page ^home', '    - [ ] Pick the display typeface', '    - [x] Collect reference sites'], 'the task and its subtasks land in the other note');
  ok(!(await note(page, 'Projects/Website redesign.md')).includes(family), 'and leave the one they were in');
  eq((await titles(page)).length, total, 'the board lists every task still');
  eq((await page.evaluate(() => window.__notices)).at(-1).replace(/[⁦-⁩]/g, ''), 'Moved “Design the new home page” to Someday', 'a notice names where it went');
  eq(page.errors, [], 'no page errors moving a task');
  await page.close();

  page = await open('?scope=vault&group=none&lang=fa', 1700);
  await page.locator('.taskpro-table__row').first().click({ button: 'right', position: { x: 300, y: 10 } });
  await page.locator('.taskpro-menu__item', { hasText: 'انتقال به یادداشت' }).click();
  eq([await page.locator('.taskpro-menu__header').textContent(), await page.locator('.taskpro-menu__search').getAttribute('placeholder')], ['انتقال به یادداشت', 'جستجوی یادداشت…'], 'the picker speaks Persian');
  eq(await page.locator('.taskpro-menu').getAttribute('dir'), 'rtl', 'and reads right to left');
  await page.keyboard.press('Escape');
  await page.close();

  // ── The task's card, from every layout ───────────────────────────────────
  page = await open('?scope=vault&group=none', 1700);
  const peek = () => page.locator('.taskpro-cal-inspector');
  const propRow = (name) => peek().locator('.taskpro-cal-prop', { hasText: name });
  const familyRow = row(page, 'Design the new home page');
  await familyRow.hover({ position: { x: 120, y: 20 } });
  eq(await familyRow.locator('.taskpro-board__open').count(), 2, 'a row offers its card and its note on hover');
  await familyRow.locator('.taskpro-board__open.is-card').click();
  await page.waitForTimeout(150);
  eq(await peek().count(), 1, 'the card opens beside the row');
  eq(await peek().locator('.taskpro-cal-inspector__title').textContent(), 'Design the new home page', 'with the task’s title');
  eq((await peek().locator('.taskpro-cal-prop__name').allTextContents()).map((t) => t.trim()), ['When', 'Status', 'Priority', 'Deadline', 'Repeat', 'Waiting on', 'Remind me', 'Tags', 'Note'], 'and one row for every property');
  eq(await peek().locator('.taskpro-cal-inspector__subtask-title').allTextContents(), ['Pick the display typeface', 'Collect reference sites'], 'and its subtasks');
  eq((await peek().locator('.taskpro-cal-inspector__subtasks-count').textContent()).trim(), '1/2', 'counted');
  // Choosing a value in the card writes it into the note, and the card follows the note.
  await propRow('Priority').locator('.taskpro-cal-prop__pick').click();
  await page.locator('.taskpro-menu__item', { hasText: 'Highest' }).click();
  await page.waitForTimeout(150);
  ok((await note(page, 'Projects/Website redesign.md')).split('\n')[0].includes('@priority(highest)'), 'a value chosen in the card lands in the note');
  ok((await propRow('Priority').textContent()).includes('Highest'), 'and the card shows it');
  // A subtask is added from the card and is listed in it at once.
  await peek().locator('.taskpro-cal-inspector__subtask-add').fill('Check the contrast');
  await peek().locator('.taskpro-cal-inspector__subtask-add').press('Enter');
  await page.waitForTimeout(150);
  ok((await note(page, 'Projects/Website redesign.md')).split('\n').some((line) => /^\s+- \[ \] Check the contrast/.test(line)), 'a subtask added in the card is written under the task');
  eq((await peek().locator('.taskpro-cal-inspector__subtask-title').allTextContents()).at(-1), 'Check the contrast', 'and listed in it');
  eq((await peek().locator('.taskpro-cal-inspector__subtasks-count').textContent()).trim(), '1/3', 'and counted');
  // Escape leaves a field first, then puts the card away; so does a click outside.
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  eq(await peek().count(), 0, 'Escape puts the card away');
  await familyRow.hover({ position: { x: 120, y: 20 } });
  await familyRow.locator('.taskpro-board__open.is-card').click();
  await page.waitForTimeout(100);
  await page.locator('.taskpro-board__title-text').click();
  eq(await peek().count(), 0, 'and so does a click outside it');

  // The task menu starts with the card, wherever the menu is opened.
  await row(page, 'Groceries').click({ button: 'right', position: { x: 300, y: 10 } });
  eq((await page.locator('.taskpro-menu__item').first().textContent()).trim(), 'Open card', 'the task menu begins with the card');
  await page.locator('.taskpro-menu__item', { hasText: 'Open card' }).click();
  await page.waitForTimeout(150);
  eq(await peek().locator('.taskpro-cal-inspector__title').textContent(), 'Groceries', 'and it opens that task’s');
  await page.keyboard.press('Escape');
  eq(page.errors, [], 'no page errors with the card in the table');
  await page.close();

  page = await open('?layout=board&scope=vault', 1400);
  const kanban = page.locator('.taskpro-card', { hasText: 'Design the new home page' });
  await kanban.hover();
  eq(await kanban.locator('.taskpro-card__open').count(), 1, 'a board card offers its card on hover');
  await kanban.locator('.taskpro-card__open').click();
  await page.waitForTimeout(150);
  eq(await peek().locator('.taskpro-cal-inspector__title').textContent(), 'Design the new home page', 'and it opens');
  await page.keyboard.press('Escape');
  await kanban.click({ position: { x: 60, y: 3 } });
  await page.waitForTimeout(150);
  eq(await peek().count(), 1, 'a click on the card itself opens it too');
  await page.keyboard.press('Escape');
  await kanban.locator('.taskpro-card__props .is-editable').first().click();
  await page.waitForTimeout(150);
  eq(await peek().count(), 0, 'while a click on one of its properties edits that property');
  await page.keyboard.press('Escape');
  eq(page.errors, [], 'no page errors with the card on the board');
  await page.close();

  page = await open('?scope=vault&group=none&lang=fa', 1700);
  await page.locator('.taskpro-table__row').nth(4).hover({ position: { x: 1500, y: 20 } });
  await page.locator('.taskpro-table__row').nth(4).locator('.taskpro-board__open.is-card').click();
  await page.waitForTimeout(150);
  eq(await peek().evaluate((el) => getComputedStyle(el).direction), 'rtl', 'the card reads right to left in Persian');
  eq((await peek().locator('.taskpro-cal-prop__name').first().textContent()).trim(), 'زمان', 'in Persian');
  await page.keyboard.press('Escape');
  await page.close();

  // ── The keyboard ─────────────────────────────────────────────────────────
  page = await open('?scope=vault&group=none', 1700);
  const under = () => page.evaluate(() => document.querySelector('.has-cursor .taskpro-board__title')?.textContent ?? null);
  await page.locator('.taskpro-board__body').focus();
  eq(await under(), 'Groceries', 'the body, reached with the keyboard, shows the cursor on the first task');
  ok(await page.locator('.taskpro-table__row.has-cursor td.taskpro-table__check').evaluate((el) => getComputedStyle(el).boxShadow.includes('inset')), 'which is marked by a bar at its start');
  await page.keyboard.press('ArrowDown');
  eq(await under(), 'Dentist appointment', 'down');
  await page.keyboard.press('KeyJ');
  eq(await under(), 'Chapter 4 of Designing Data-Intensive Applications', 'and J does the same');
  await page.keyboard.press('KeyK');
  eq(await under(), 'Dentist appointment', 'K goes back');
  await page.keyboard.press('End');
  eq(await under(), 'Accessibility pass', 'End: the last task');
  await page.keyboard.press('Home');
  eq(await under(), 'Groceries', 'Home: the first');
  await page.keyboard.press('ArrowUp');
  eq(await under(), 'Groceries', 'and no further up');

  // Space ticks the task off and back; the cursor stays on it as the table is drawn again.
  await page.keyboard.press('Space');
  await page.waitForTimeout(80);
  ok((await note(page, 'Life/Home.md')).startsWith('- [x] Groceries'), 'Space marks it done');
  eq(await under(), 'Groceries', 'the cursor is still on it');
  await page.keyboard.press('Space');
  await page.waitForTimeout(80);
  ok((await note(page, 'Life/Home.md')).startsWith('- [ ] Groceries'), 'and open again');

  // Enter opens the card; putting it away gives the keys back.
  await page.keyboard.press('Enter');
  await page.waitForTimeout(150);
  eq(await page.locator('.taskpro-cal-inspector .taskpro-cal-inspector__title').textContent(), 'Groceries', 'Enter opens the task’s card');
  await page.keyboard.press('Escape');
  await page.keyboard.press('ArrowDown');
  eq(await under(), 'Dentist appointment', 'and the keys carry on where they were');

  // E renames in place; Enter ends it and the keys carry on.
  await page.keyboard.press('KeyE');
  await page.locator('.taskpro-board__title-input').fill('Dentist visit');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(100);
  ok((await note(page, 'Life/Home.md')).includes('- [ ] Dentist visit'), 'E renames the task');
  await page.keyboard.press('ArrowDown');
  eq(await under(), 'Chapter 4 of Designing Data-Intensive Applications', 'and the keys still work after it');
  await page.keyboard.press('ArrowUp');

  // M opens the menu, and Escape gives the keys back.
  await page.keyboard.press('KeyM');
  eq(await page.locator('.taskpro-menu__header').textContent(), 'Dentist visit', 'M opens the task’s menu');
  await page.keyboard.press('Escape');
  await page.keyboard.press('ArrowDown');
  eq(await under(), 'Chapter 4 of Designing Data-Intensive Applications', 'and closing it gives the keys back');
  await page.keyboard.press('ArrowUp');

  // Delete takes the task out; the cursor stays where it was, on the next one.
  const rowsBefore = (await titles(page)).length;
  await page.keyboard.press('Delete');
  await page.waitForTimeout(100);
  eq((await titles(page)).length, rowsBefore - 1, 'Delete removes the task');
  eq(await under(), 'Chapter 4 of Designing Data-Intensive Applications', 'and the cursor is on the next');

  // Board-wide keys; a field keeps the letters typed into it.
  await page.keyboard.press('KeyN');
  eq(await page.evaluate(() => document.activeElement?.className ?? ''), 'taskpro-board__add-input', 'N: a new task');
  await page.keyboard.type('need a new keyboard');
  eq(await page.locator('.taskpro-board__add-input').inputValue(), 'need a new keyboard', 'letters typed there are typed');
  await page.locator('.taskpro-board__add-input').fill('');
  await page.locator('.taskpro-board__body').focus();
  await page.keyboard.press('Slash');
  eq(await page.evaluate(() => document.activeElement?.closest('.taskpro-board__search') !== null), true, '/ goes to the search');
  await page.locator('.taskpro-board__body').focus();
  await page.keyboard.press('Shift+Slash');
  eq(await page.locator('.taskpro-shortcuts').count(), 1, '? shows the keys');
  eq(await page.locator('.taskpro-shortcuts__group').count(), 4, 'in four groups');
  await page.keyboard.press('Escape');
  eq(await page.locator('.taskpro-shortcuts').count(), 0, 'Escape puts the list away');
  await page.locator('button[aria-label="Keyboard shortcuts"]').click();
  eq(await page.locator('.taskpro-shortcuts').count(), 1, 'the header button shows it too');
  await page.keyboard.press('Escape');
  eq(page.errors, [], 'no page errors with the keyboard');
  await page.close();

  // The board moves between columns; in Persian the next column is on the left.
  page = await open('?layout=board&scope=vault', 1500);
  const cardUnder = () => page.evaluate(() => document.querySelector('.taskpro-card.has-cursor .taskpro-board__title')?.textContent ?? null);
  await page.locator('.taskpro-board__body').focus();
  eq(await cardUnder(), 'Groceries', 'a board: the cursor starts on the first card of the first column');
  await page.keyboard.press('ArrowRight');
  eq(await cardUnder(), 'Chapter 4 of Designing Data-Intensive Applications', 'right: the next column');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  eq(await cardUnder(), 'Book the venue', 'to the last');
  await page.keyboard.press('ArrowLeft');
  eq(await cardUnder(), 'Chase the missing invoice', 'and back');
  ok(await page.locator('.taskpro-card.has-cursor').evaluate((el) => getComputedStyle(el).boxShadow !== 'none'), 'the card wears a ring');
  eq(page.errors, [], 'no page errors on the board');
  await page.close();

  page = await open('?layout=board&scope=vault&lang=fa', 1500);
  await page.locator('.taskpro-board__body').focus();
  const first = await page.evaluate(() => document.querySelector('.taskpro-card.has-cursor')?.getBoundingClientRect().left ?? 0);
  await page.keyboard.press('ArrowLeft');
  const second = await page.evaluate(() => document.querySelector('.taskpro-card.has-cursor')?.getBoundingClientRect().left ?? 0);
  ok(second < first, 'right to left: the left arrow goes to the next column, which is on the left');
  await page.close();

  // ── Saved views ──────────────────────────────────────────────────────────
  page = await open('?layout=board&scope=vault&group=priority&density=compact', 1500);
  const prefsNow = () => page.evaluate(() => ({ layout: window.__prefs.layout, groupBy: window.__prefs.groupBy, density: window.__prefs.density, active: window.__prefs.activeView, views: (window.__prefs.views ?? []).map((v) => v.name) }));
  const viewsButton = () => page.locator('.taskpro-board__views');
  const viewItem = (name) => page.locator('.taskpro-menu__item', { hasText: name });
  eq((await viewsButton().textContent()).trim(), 'Views', 'a Views button in the toolbar');
  await viewsButton().click();
  eq(await page.locator('.taskpro-menu__item').allTextContents().then((all) => all.map((t) => t.trim())), ['Save this view…', 'Default view'], 'with nothing saved: save this one, or the default');
  await viewItem('Save this view').click();
  eq(await page.locator('.taskpro-panel__title').textContent(), 'Save this view', 'saving asks for a name');
  eq(await page.locator('.taskpro-panel input').inputValue(), 'New view', 'suggesting one');
  await page.locator('.taskpro-panel input').fill('Board by priority');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(120);
  const firstView = await page.evaluate(() => window.__prefs.views[0]);
  eq(await prefsNow(), { layout: 'board', groupBy: 'priority', density: 'compact', active: firstView.id, views: ['Board by priority'] }, 'the view is saved and in use');
  eq([firstView.prefs.layout, firstView.prefs.groupBy, firstView.prefs.density, 'inboxPath' in firstView.prefs], ['board', 'priority', 'compact', false], 'holding how the board was set up');
  eq((await viewsButton().textContent()).trim(), 'ViewsBoard by priority', 'the button names it');
  eq(await viewsButton().evaluate((el) => el.classList.contains('is-modified')), false, 'and does not say it is changed');

  // Change the board; the button says so, and the menu can put the view back or take the change in.
  await page.locator('.taskpro-layout-tab, .taskpro-board__layout button', { hasText: 'Table' }).first().click();
  await page.waitForTimeout(120);
  eq((await prefsNow()).layout, 'table', 'the layout is changed');
  eq(await viewsButton().evaluate((el) => el.classList.contains('is-modified')), true, 'a dot says the view has been changed');
  await viewsButton().click();
  eq(await viewItem('Board by priority').locator('.taskpro-menu__hint').textContent(), 'Changed', 'and so does the menu');
  ok(await viewItem('Update “Board by priority”').count(), 'which offers to take the change in');
  await viewItem('Board by priority').first().click();
  await page.waitForTimeout(150);
  eq(await prefsNow().then((p) => [p.layout, p.groupBy, p.density]), ['board', 'priority', 'compact'], 'choosing the view puts the board back as it was saved');
  eq(await viewsButton().evaluate((el) => el.classList.contains('is-modified')), false, 'unchanged again');

  // A second view, from a changed board; Update takes a change into a view.
  await page.locator('.taskpro-layout-tab, .taskpro-board__layout button', { hasText: 'Table' }).first().click();
  await page.waitForTimeout(100);
  await viewsButton().click();
  await viewItem('Save this view').click();
  await page.locator('.taskpro-panel input').fill('Board by priority');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(120);
  eq((await prefsNow()).views, ['Board by priority', 'Board by priority 2'], 'a name is made different from the others');
  await page.locator('.taskpro-board__properties').click();
  await viewItem('Density').click();
  await page.locator('.taskpro-menu.is-submenu .taskpro-menu__item', { hasText: 'Spacious' }).click();
  await page.waitForTimeout(100);
  eq(await viewsButton().evaluate((el) => el.classList.contains('is-modified')), true, 'a change made without redrawing the toolbar is noticed too');
  await viewsButton().click();
  await viewItem('Update “Board by priority 2”').click();
  await page.waitForTimeout(100);
  eq(await viewsButton().evaluate((el) => el.classList.contains('is-modified')), false, 'Update takes it in');
  eq(await page.evaluate(() => window.__prefs.views[1].prefs.density), 'spacious', 'into the view');

  // Renaming, duplicating and deleting are under Manage views.
  await viewsButton().click();
  await viewItem('Manage views').click();
  await page.locator('.taskpro-menu.is-submenu .taskpro-menu__item', { hasText: 'Board by priority 2' }).hover();
  await page.waitForTimeout(300);
  await page.locator('.taskpro-menu.is-submenu').last().locator('.taskpro-menu__item', { hasText: 'Rename' }).click();
  await page.locator('.taskpro-panel input').fill('Roomy');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(120);
  eq((await prefsNow()).views, ['Board by priority', 'Roomy'], 'a view is renamed');
  await viewsButton().click();
  await viewItem('Manage views').click();
  await page.locator('.taskpro-menu.is-submenu .taskpro-menu__item', { hasText: 'Roomy' }).hover();
  await page.waitForTimeout(300);
  await page.locator('.taskpro-menu.is-submenu').last().locator('.taskpro-menu__item', { hasText: 'Duplicate' }).click();
  await page.waitForTimeout(120);
  eq((await prefsNow()).views, ['Board by priority', 'Roomy', 'Roomy copy'], 'and duplicated');
  await viewsButton().click();
  await viewItem('Manage views').click();
  await page.locator('.taskpro-menu.is-submenu .taskpro-menu__item', { hasText: 'Roomy' }).first().hover();
  await page.waitForTimeout(300);
  await page.locator('.taskpro-menu.is-submenu').last().locator('.taskpro-menu__item', { hasText: 'Delete' }).click();
  await page.waitForTimeout(120);
  const afterDelete = await prefsNow();
  eq([afterDelete.views, afterDelete.active], [['Board by priority', 'Roomy copy'], undefined], 'and deleted, which leaves none in use when it was the one');

  // Back to the default view.
  await viewsButton().click();
  await viewItem('Default view').click();
  await page.waitForTimeout(150);
  eq(await prefsNow().then((p) => [p.layout, p.groupBy, p.density]), ['table', 'status', undefined], 'the default view: the table, grouped by status, nothing changed');
  eq(page.errors, [], 'no page errors with saved views');
  await page.close();

  page = await open('?scope=vault&lang=fa', 1500);
  await page.locator('.taskpro-board__views').click();
  eq(await page.locator('.taskpro-menu__header').textContent(), 'نماها', 'in Persian');
  eq((await page.locator('.taskpro-menu__item').first().textContent()).trim(), 'ذخیرهٔ این نما…', 'and its entries');
  await page.keyboard.press('Escape');
  await page.close();

  // The floating board is an Obsidian modal: a press inside it, away from the menu, puts the menu away as it does in a tab.
  page = await open('?scope=vault&group=none&float=1', 1700);
  await row(page, 'Groceries').click({ button: 'right', position: { x: 150, y: 10 } });
  eq(await page.locator('.taskpro-menu').count(), 1, 'a right click opens the menu in the floating board');
  await page.waitForTimeout(60);
  await row(page, 'Chapter 4 of Designing Data-Intensive Applications').locator('td.taskpro-table__more').click({ position: { x: 2, y: 2 } });
  eq(await page.locator('.taskpro-menu').count(), 0, 'and a left click elsewhere puts it away');
  await row(page, 'Groceries').click({ button: 'right', position: { x: 150, y: 10 } });
  await page.locator('.taskpro-board__body').click({ position: { x: 5, y: 5 } });
  eq(await page.locator('.taskpro-menu').count(), 0, 'as does a click on the empty part of the board');
  await page.close();

  // ── Selecting several tasks and changing them together ────────────────────
  page = await open('?scope=vault&group=none', 1700);
  const bar = () => page.locator('.taskpro-selection');
  const picked = () => page.locator('.taskpro-table__row.is-selected .taskpro-board__title').allTextContents();
  const squareOf = (title) => row(page, title).locator('.taskpro-board__select');
  eq(await page.locator('.taskpro-board__select').count(), 12, 'every row has a selection control in its check cell');
  eq(await bar().count(), 0, 'and no bar until something is picked');
  await row(page, 'Dentist appointment').hover({ position: { x: 150, y: 10 } });
  await page.waitForTimeout(250);
  eq(await squareOf('Dentist appointment').isVisible(), false, 'hover never adds a second checkbox');
  const startSelection = async (target, fa = false) => {
    await target.click({ button: 'right', position: { x: 150, y: 10 } });
    await page.locator('.taskpro-menu__item').filter({ hasText: fa ? /^\s*انتخاب\s*$/ : /^\s*Select\s*$/ }).click();
  };
  await startSelection(row(page, 'Dentist appointment'));
  eq(await picked(), ['Dentist appointment'], 'a click on it picks the row');
  eq((await bar().locator('.taskpro-selection__count').textContent()).trim(), '1 selected', 'and a bar counts what is picked');
  await page
    .locator('.taskpro-table__row')
    .filter({ has: page.locator('.taskpro-board__title', { hasText: 'Draft the launch post' }) })
    .locator('td.taskpro-table__more')
    .click({ position: { x: 2, y: 2 }, modifiers: ['Shift'] });
  eq(await picked(), ['Dentist appointment', 'Chapter 4 of Designing Data-Intensive Applications', 'Draft the launch post'], 'Shift-click picks every row from the last one picked to it');
  await row(page, 'Weekly review and planning').locator('td.taskpro-table__more').click({ position: { x: 2, y: 2 }, modifiers: ['Control'] });
  eq((await picked()).length, 4, 'Ctrl-click picks one more, without opening anything');
  await row(page, 'Weekly review and planning').locator('td.taskpro-table__more').click({ position: { x: 2, y: 2 }, modifiers: ['Control'] });
  eq((await picked()).length, 3, 'and again drops it');
  await page.locator('.taskpro-selection__btn.is-clear').click();
  eq(await bar().count(), 0, 'the ✕ drops the selection and the bar goes');

  // With nothing picked yet, a Shift click starts from the cursor; and the browser is not left with a text selection over the rows between.
  await row(page, 'Groceries').locator('td.taskpro-table__more').click({ position: { x: 2, y: 2 } });
  await row(page, 'Chapter 4 of Designing Data-Intensive Applications')
    .locator('td.taskpro-table__more')
    .click({ position: { x: 2, y: 2 }, modifiers: ['Shift'] });
  eq(await picked(), ['Groceries', 'Dentist appointment', 'Chapter 4 of Designing Data-Intensive Applications'], 'a click and then a Shift click picks the run between them');
  eq(await page.evaluate(() => getSelection().isCollapsed), true, 'with no text left selected across it');
  eq(await page.locator('.taskpro-table__row.has-cursor .taskpro-board__title').textContent(), 'Chapter 4 of Designing Data-Intensive Applications', 'and the cursor on the last');
  await page.locator('.taskpro-selection__btn.is-clear').click();

  // The keyboard picks too: X, Shift with the arrows, Ctrl or ⌘ with A; Escape drops them.
  await page.locator('.taskpro-board__body').focus();
  await page.keyboard.press('Home');
  await page.keyboard.press('KeyX');
  eq(await picked(), ['Groceries'], 'X picks the task under the cursor');
  await page.keyboard.press('Shift+ArrowDown');
  await page.keyboard.press('Shift+ArrowDown');
  eq(await picked(), ['Groceries', 'Dentist appointment', 'Chapter 4 of Designing Data-Intensive Applications'], 'Shift with the arrows extends it');
  await page.keyboard.press('Escape');
  eq(await bar().count(), 0, 'Escape drops it');
  await page.keyboard.press('Control+KeyA');
  eq((await picked()).length, 12, 'Ctrl+A picks every task shown');
  await page.keyboard.press('Escape');

  // Changes to all of them at once, each written into its own note.
  await startSelection(row(page, 'Groceries'));
  await squareOf('Dentist appointment').click({ force: true });
  await bar().locator('.taskpro-selection__btn', { hasText: 'Status' }).click();
  eq(await page.locator('.taskpro-menu__header').textContent(), '2 selected', 'a menu from the bar says what it is for');
  await page.locator('.taskpro-menu__item', { hasText: 'In Progress' }).click();
  await page.waitForTimeout(150);
  ok((await note(page, 'Life/Home.md')).split('\n').slice(0, 2).every((line) => line.startsWith('- [/]')), 'status is set on all of them');
  eq((await picked()).length, 2, 'and they stay picked');
  await bar().locator('.taskpro-selection__btn', { hasText: 'Priority' }).click();
  await page.locator('.taskpro-menu__item', { hasText: 'Highest' }).click();
  await page.waitForTimeout(150);
  ok((await note(page, 'Life/Home.md')).split('\n').slice(0, 2).every((line) => line.includes('@priority(highest)')), 'so is a priority');
  // A tag is added to each, and taken off each once they all have it.
  await bar().locator('.taskpro-selection__btn', { hasText: 'Tags' }).click();
  ok(!(await page.locator('.taskpro-menu__item', { hasText: 'Client' }).getAttribute('aria-checked') === 'true'), 'a tag not all have is not ticked');
  await page.locator('.taskpro-menu__item', { hasText: 'Client' }).click();
  await page.waitForTimeout(150);
  ok((await note(page, 'Life/Home.md')).split('\n').slice(0, 2).every((line) => /@tag\([^)]*client/.test(line)), 'a tag chosen is added to each, keeping their own');
  ok((await note(page, 'Life/Home.md')).split('\n')[0].includes('home'), 'and what they had');
  await bar().locator('.taskpro-selection__btn', { hasText: 'Tags' }).click();
  eq(await page.locator('.taskpro-menu__item', { hasText: 'Client' }).getAttribute('aria-checked'), 'true', 'once all have it, it is ticked');
  await page.locator('.taskpro-menu__item', { hasText: 'Client' }).click();
  await page.waitForTimeout(150);
  ok((await note(page, 'Life/Home.md')).split('\n').slice(0, 2).every((line) => !/client/.test(line)), 'and choosing it again takes it off each');
  await bar().locator('.taskpro-selection__btn', { hasText: 'Deadline' }).click();
  eq(await page.locator('.taskpro-menu__item', { hasText: 'Pick a date' }).count(), 0, 'a date to pick is left out of a bulk menu: it is for one task');
  await page.locator('.taskpro-menu__item', { hasText: 'Tomorrow' }).click();
  await page.waitForTimeout(150);
  eq(new Set((await note(page, 'Life/Home.md')).split('\n').slice(0, 2).map((line) => /@due\(([^)]+)\)/.exec(line)?.[1])).size, 1, 'a deadline is one date on both');

  // Moving takes the parent's subtasks along once, though they are picked too.
  await page.locator('.taskpro-selection__btn.is-clear').click();
  await startSelection(row(page, 'Design the new home page'));
  await squareOf('Pick the display typeface').click({ force: true });
  await bar().locator('.taskpro-selection__btn', { hasText: 'Move to note' }).click();
  await page.locator('.taskpro-menu__search').fill('some');
  await page.locator('.taskpro-menu__item', { hasText: 'Someday' }).click();
  await page.waitForTimeout(200);
  eq((await note(page, 'Projects/Someday.md')).split('\n').length, 3, 'a parent and its two subtasks arrive once, not twice');
  eq(await bar().count(), 0, 'and the selection is over');
  eq((await page.evaluate(() => window.__notices)).at(-1).replace(/[⁦-⁩]/g, ''), 'Moved “Design the new home page” to Someday', 'with a notice');

  // Deleting them all at once.
  const remaining = (await titles(page)).length;
  await startSelection(row(page, 'Groceries'));
  await squareOf('Accessibility pass').click({ force: true });
  await bar().locator('.taskpro-selection__btn', { hasText: 'Delete' }).click();
  await page.waitForTimeout(150);
  eq((await titles(page)).length, remaining - 2, 'Delete takes them out');
  eq(await bar().count(), 0, 'and the bar goes with them');
  eq(page.errors, [], 'no page errors selecting several');
  await page.close();

  // On a board the cards are picked the same way, and follow a status change to its new column.
  page = await open('?layout=board&scope=vault', 1500);
  await page.locator('.taskpro-card', { hasText: 'Groceries' }).hover();
  eq(await page.locator('.taskpro-card', { hasText: 'Groceries' }).locator('.taskpro-board__select').isVisible(), false, 'hover does not reveal a stray square');
  await page.locator('.taskpro-card', { hasText: 'Groceries' }).locator('.taskpro-card__more').last().click();
  await page.locator('.taskpro-menu__item', { hasText: /^\s*Select\s*$/ }).click();
  await page.locator('.taskpro-card', { hasText: 'Dentist appointment' }).locator('.taskpro-board__select').click({ force: true });
  eq(await page.locator('.taskpro-card.is-selected').count(), 2, 'two cards are picked');
  await page.locator('.taskpro-selection__btn', { hasText: 'Status' }).click();
  await page.locator('.taskpro-menu__item').filter({ hasText: /^\s*Done\s*$/ }).click();
  await page.waitForTimeout(200);
  eq(await page.locator('.taskpro-kanban__column').nth(3).locator('.taskpro-card.is-selected').count(), 2, 'and stay picked in the column they went to');
  eq(page.errors, [], 'no page errors on the board');
  await page.close();

  page = await open('?scope=vault&group=none&lang=fa', 1700);
  await startSelection(page.locator('.taskpro-table__row').nth(1), true);
  eq((await page.locator('.taskpro-selection__count').textContent()).trim(), '1 انتخاب شده', 'in Persian');
  eq(await page.locator('.taskpro-selection__btn.is-warning').getAttribute('aria-label'), 'حذف', 'and the delete button');
  await page.close();

  // ── Sub-items: nested under their parent, and folded away ────────────────
  page = await open('?scope=vault&group=none', 1700);
  const parentRow = () => row(page, 'Design the new home page');
  eq(await parentRow().locator('.taskpro-board__fold .taskpro-board__fold-count').textContent(), '2', 'a parent says how many subtasks it has');
  eq(await parentRow().locator('.taskpro-board__fold').getAttribute('aria-expanded'), 'true', 'and that they are shown');
  eq(await row(page, 'Pick the display typeface').locator('.taskpro-board__title-wrap.is-subtask').count(), 1, 'a subtask is one step in');
  eq(await row(page, 'Groceries').locator('.taskpro-board__fold').count(), 0, 'a task with none has no fold');
  const allRows = (await titles(page)).length;
  await parentRow().locator('.taskpro-board__fold').click();
  await page.waitForTimeout(80);
  eq((await titles(page)).length, allRows - 2, 'folding takes its subtasks out of the table');
  eq(await parentRow().locator('.taskpro-board__fold').getAttribute('aria-expanded'), 'false', 'and says so');
  eq(await parentRow().locator('.taskpro-board__fold').getAttribute('aria-label'), 'Show 2 subtasks', 'in words');
  // A change to the notes draws the table again; the fold stays.
  await row(page, 'Groceries').locator('.taskpro-board__check').click();
  await page.waitForTimeout(80);
  eq((await titles(page)).length, allRows - 2, 'it stays folded as the table is drawn again');
  await parentRow().locator('.taskpro-board__fold').click();
  await page.waitForTimeout(40);
  eq((await titles(page)).length, allRows, 'unfolding brings them back');
  eq(await page.locator('.taskpro-table__row.is-expanding').count(), 2, 'and they follow one another in');

  // The keyboard walks the tree: Left folds, Right unfolds, Left again steps up from a subtask.
  await parentRow().locator('td.taskpro-table__more').click({ position: { x: 2, y: 2 } });
  await page.keyboard.press('ArrowLeft');
  await page.waitForTimeout(60);
  eq((await titles(page)).length, allRows - 2, 'Left folds the parent under the cursor');
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(60);
  eq((await titles(page)).length, allRows, 'Right unfolds it');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowLeft');
  eq(await page.evaluate(() => document.querySelector('.has-cursor .taskpro-board__title')?.textContent), 'Design the new home page', 'Left from a subtask goes up to its parent');

  // Grouped, a subtask whose parent is in another group stands on its own; sorted otherwise, nothing nests.
  await page.close();
  page = await open('?scope=vault&group=status', 1700);
  eq(await page.locator('.taskpro-board__fold').count(), 0, 'grouped by status the parent and its subtasks are apart: no fold');
  eq(await row(page, 'Pick the display typeface').locator('.taskpro-board__title-wrap.is-subtask').count(), 0, 'and the subtask is not indented under nothing');
  await page.close();
  page = await open('?scope=vault&group=none', 1700);
  await page.locator('.taskpro-table th.taskpro-table__task').click();
  await page.waitForTimeout(80);
  eq(await page.locator('.taskpro-board__fold').count(), 0, 'sorted by title the table does not nest');
  eq(page.errors, [], 'no page errors with sub-items');
  await page.close();

  page = await open('?scope=vault&group=none&lang=fa', 1700);
  await page.locator('.taskpro-board__fold').first().click();
  await page.waitForTimeout(80);
  eq(await page.locator('.taskpro-board__fold.is-folded').getAttribute('aria-label'), 'نمایش 2 زیرتسک', 'in Persian');
  await page.close();

  // ── View options: density, wrapping, empty columns ───────────────────────
  page = await open('?scope=vault&group=none', 1700);
  const rowHeight = () => page.locator('.taskpro-table__row').first().evaluate((el) => Math.round(el.getBoundingClientRect().height));
  const comfortable = await rowHeight();
  await page.locator('.taskpro-board__properties').click();
  eq(await page.locator('.taskpro-menu__heading').last().textContent(), 'View', 'the properties menu ends with the view options');
  const density = page.locator('.taskpro-menu__item', { hasText: 'Density' });
  eq((await density.locator('.taskpro-menu__hint').textContent()).trim(), 'Comfortable', 'density starts as drawn');
  await density.click();
  await page.locator('.taskpro-menu.is-submenu .taskpro-menu__item', { hasText: 'Compact' }).click();
  await page.waitForTimeout(100);
  eq(await page.locator('.taskpro-board').getAttribute('data-density'), 'compact', 'the board carries the choice');
  ok((await rowHeight()) < comfortable, 'compact rows are shorter');
  await page.locator('.taskpro-board__properties').click();
  await page.locator('.taskpro-menu__item', { hasText: 'Density' }).click();
  await page.locator('.taskpro-menu.is-submenu .taskpro-menu__item', { hasText: 'Spacious' }).click();
  await page.waitForTimeout(100);
  ok((await rowHeight()) > comfortable, 'spacious rows are taller');
  eq(await page.locator('.taskpro-menu').count(), 0, 'choosing a density closes the menu');
  // Wrapping is a switch; the menu stays for the next one.
  await page.locator('.taskpro-board__properties').click();
  const longTitle = page.locator('.taskpro-table__row', { hasText: 'Chapter 4 of' }).locator('.taskpro-board__title');
  const oneLine = (await longTitle.boundingBox()).height;
  await page.locator('.taskpro-menu__item', { hasText: 'Wrap titles' }).click();
  await page.waitForTimeout(100);
  eq(await page.locator('.taskpro-menu__item', { hasText: 'Wrap titles' }).getAttribute('aria-checked'), 'true', 'the switch is on');
  ok((await longTitle.boundingBox()).height > oneLine * 1.8, 'a long title runs over several lines');
  await page.keyboard.press('Escape');
  eq(page.errors, [], 'no page errors with view options');
  await page.close();

  // A board leaves out the columns with nothing in them, when asked.
  page = await open('?layout=board&scope=vault&group=priority', 1500);
  const columns = () => page.locator('.taskpro-kanban__column').count();
  const withEmpty = await columns();
  await page.locator('.taskpro-board__properties').click();
  await page.locator('.taskpro-menu__item', { hasText: 'Hide empty columns' }).click();
  await page.waitForTimeout(100);
  const withoutEmpty = await columns();
  ok(withoutEmpty < withEmpty, 'empty columns are left out');
  eq(await page.locator('.taskpro-kanban__column .taskpro-kanban__cards').evaluateAll((els) => els.filter((el) => !el.querySelector('.taskpro-card')).length), 0, 'and every column left has a task');
  eq(await page.locator('.taskpro-kanban__hidden').count(), 0, 'they are not listed as hidden ones');
  await page.locator('.taskpro-menu__item', { hasText: 'Hide empty columns' }).click();
  await page.waitForTimeout(100);
  eq(await columns(), withEmpty, 'and come back when it is switched off');
  await page.keyboard.press('Escape');
  await page.close();

  // ── Waiting on another task, and a parent's subtasks ─────────────────────
  page = await open('?scope=vault&group=none', 1700);
  const waitingCell = () => row(page, 'Send the quote to Acme').locator('.taskpro-table__waiting');
  eq(await waitingCell().locator('.taskpro-chip__label').allTextContents(), ['Draft the launch post'], 'the task it waits on, by name');
  eq(await waitingCell().locator('.taskpro-waiting-badge').getAttribute('data-state'), 'waiting', 'still open, so still waiting');
  await waitingCell().click();
  await page.locator('.taskpro-menu__item', { hasText: 'Wait on a task' }).click();
  eq(await page.locator('.taskpro-menu__search').getAttribute('placeholder'), 'Find a task…', 'a task picker, with search');
  eq((await page.locator('.taskpro-menu__item').allTextContents()).some((text) => text.startsWith('Send the quote')), false, 'a task cannot wait on itself');
  await page.locator('.taskpro-menu__search').fill('invoice');
  await page.locator('.taskpro-menu__item', { hasText: 'Chase the missing invoice' }).click();
  await page.waitForTimeout(80);
  const week = (await note(page, 'Planner/2026-W39.md')).split('\n');
  const invoiceId = /\^(tp-[a-z0-9]+)$/.exec(week[2])?.[1];
  eq(!!invoiceId, true, 'the task waited on is given a block ID');
  eq(week[1].includes(`@waiting([[Planner/2026-W39#^launch]], [[Planner/2026-W39#^${invoiceId}]])`), true, 'both written as block links');
  eq(await waitingCell().locator('.taskpro-chip__label').allTextContents(), ['Draft the launch post', 'Chase the missing invoice'], 'both shown');
  // The launch post can no longer wait on the quote: that would be a loop.
  await page
    .locator('.taskpro-table__row')
    .filter({ has: page.locator('.taskpro-board__title', { hasText: 'Draft the launch post' }) })
    .locator('.taskpro-table__waiting')
    .click();
  await page.locator('.taskpro-menu__item', { hasText: 'Wait on a task' }).click();
  eq((await page.locator('.taskpro-menu__item').allTextContents()).some((text) => text.startsWith('Send the quote')), false, 'no loops offered');
  await page.keyboard.press('Escape');
  await waitingCell().click();
  await page.locator('.taskpro-menu__item', { hasText: 'Draft the launch post' }).click();
  await page.waitForTimeout(80);
  eq((await note(page, 'Planner/2026-W39.md')).split('\n')[1].includes('#^launch'), false, 'a click on a ticked one stops waiting on it');
  await page
    .locator('.taskpro-table__row')
    .filter({ has: page.locator('.taskpro-board__title', { hasText: 'Chase the missing invoice' }) })
    .locator('.taskpro-board__check')
    .click();
  await page.waitForTimeout(80);
  eq(await waitingCell().locator('.taskpro-waiting-badge').getAttribute('data-state'), 'done', 'once it is done, the chip steps back');
  eq(page.errors, [], 'no page errors with dependencies');
  await page.close();

  page = await open('?layout=calendar&scope=vault', 1700);
  await page.locator('.taskpro-board__layout .taskpro-segmented__item', { hasText: 'Table' }).click();
  await page.locator('.taskpro-board__control', { hasText: 'Group' }).click();
  await page.locator('.menu .menu-item', { hasText: 'No grouping' }).click();
  const figma = row(page, 'Learn Figma').locator('.taskpro-table__progress .is-subtasks');
  eq(await figma.locator('.taskpro-board__progress-text').textContent(), '0/3', "a parent's progress, from its subtasks");
  await row(page, 'Auto layout').locator('.taskpro-board__check').click();
  await page.waitForTimeout(80);
  eq(await figma.locator('.taskpro-board__progress-text').textContent(), '1/3', 'and it follows them');
  eq(page.errors, [], 'no page errors with subtask progress');
  await page.close();

  // ── Timeline ────────────────────────────────────────────────────────────
  page = await open('?layout=timeline&scope=vault', 1500);
  const tlRow = (title) => page.locator('.taskpro-tl__row').filter({ has: page.locator('.taskpro-tl__title', { hasText: title }) });
  const lineOf = async (path, text) => (await note(page, path)).split('\n').find((l) => l.includes(text));
  const iso = (days) => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + days);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  eq(await tlRow('Draft the launch post').locator('.taskpro-tl__bar').count(), 1, 'planned and due later: a bar');
  eq(await tlRow('Dentist appointment').locator('.taskpro-tl__milestone').count(), 1, 'only a deadline: a milestone');
  eq(await tlRow('Weekly review and planning').locator('.taskpro-tl__late').count(), 1, 'due before it is planned: flagged');
  eq(await page.locator('.taskpro-tl__links .taskpro-tl__link').count(), 1, 'an arrow for the dependency');
  eq(await tlRow('Learn Figma').locator('.taskpro-tl__summary').count(), 1, 'a parent spans its family');
  eq(await tlRow('Auto layout').locator('.taskpro-tl__cell').evaluate((el) => getComputedStyle(el).getPropertyValue('--depth').trim()), '1', 'subtasks indented');

  // Drag the monthly report two days later: plan moves, and so would a deadline.
  const px = 40;
  const report = await tlRow('Write the monthly report').locator('.taskpro-tl__bar').boundingBox();
  await drag({ x: report.x + report.width / 2, y: report.y + report.height / 2 }, { x: report.x + report.width / 2 + px * 2, y: report.y + report.height / 2 });
  eq((await lineOf('Planner/Focus.md', 'monthly report')).includes(`@schedule(${iso(4)} 14:00-16:00)`), true, 'a dragged bar moves the plan, keeping its time');
  // Drag its end three days on: that gives it a deadline.
  const moved = await tlRow('Write the monthly report').locator('.taskpro-tl__handle.is-end').boundingBox();
  await drag({ x: moved.x + moved.width / 2, y: moved.y + moved.height / 2 }, { x: moved.x + moved.width / 2 + px * 3, y: moved.y + moved.height / 2 });
  eq((await lineOf('Planner/Focus.md', 'monthly report')).includes(`@due(${iso(7)})`), true, 'dragging the end sets the deadline');
  eq(await tlRow('Write the monthly report').locator('.taskpro-tl__bar').evaluate((el) => el.style.getPropertyValue('--w')), '4', 'now a four-day bar');
  // A milestone drags as its deadline.
  const dentist = await tlRow('Dentist appointment').locator('.taskpro-tl__milestone').boundingBox();
  await drag({ x: dentist.x + dentist.width / 2, y: dentist.y + dentist.height / 2 }, { x: dentist.x + dentist.width / 2 - px, y: dentist.y + dentist.height / 2 });
  eq((await lineOf('Life/Home.md', 'Dentist')).includes(`@due(${iso(8)})`), true, 'a milestone moves its deadline');
  // A click opens the task menu; the drag above did not.
  await tlRow('Call the accountant').locator('.taskpro-tl__bar').click();
  eq(await page.locator('.taskpro-menu__header').textContent(), 'Call the accountant', 'a click on a bar opens its menu');
  eq((await page.locator('.taskpro-menu__item').first().textContent()).trim(), 'Open card', 'which begins with the card');
  await page.locator('.taskpro-menu__item', { hasText: 'Open card' }).click();
  await page.waitForTimeout(150);
  eq(await page.locator('.taskpro-cal-inspector .taskpro-cal-inspector__title').textContent(), 'Call the accountant', 'and the card opens over the timeline');
  await page.keyboard.press('Escape');

  // Tasks with no dates: folded away, then a click on a day plans one.
  await page.locator('.taskpro-tl__undated-toggle').click();
  const typeface = tlRow('Pick the display typeface').locator('.taskpro-tl__lane');
  const laneBox = await typeface.boundingBox();
  const todayX = await page.locator('.taskpro-tl__today').evaluate((el) => el.getBoundingClientRect().left);
  await page.mouse.click(todayX + px * 2, laneBox.y + laneBox.height / 2);
  await page.waitForTimeout(80);
  eq((await lineOf('Projects/Website redesign.md', 'typeface')).includes(`@schedule(${iso(2)})`), true, 'a click on a day plans an undated task');

  // Zoom and calendar.
  await page.locator('.taskpro-tl-nav__zooms .taskpro-segmented__item', { hasText: 'Months' }).click();
  eq(await page.locator('.taskpro-tl').getAttribute('data-zoom'), 'month', 'zoomed out to months');
  await page.locator('.taskpro-cal-nav__systems .taskpro-segmented__item', { hasText: 'Jalali' }).click();
  eq((await page.locator('.taskpro-tl__units.is-bottom .taskpro-tl__unit-label').allTextContents()).includes('Meh'), true, 'Jalali months on the scale');
  eq(page.errors, [], 'no page errors on the timeline');
  await page.close();

  // Persian: the chart runs right to left, and so do drags.
  page = await open('?layout=timeline&scope=vault&lang=fa', 1500);
  const faReport = await page.locator('.taskpro-tl__row').filter({ has: page.locator('.taskpro-tl__title', { hasText: 'گزارش ماهانه' }) }).locator('.taskpro-tl__bar').boundingBox();
  await drag({ x: faReport.x + faReport.width / 2, y: faReport.y + faReport.height / 2 }, { x: faReport.x + faReport.width / 2 - 40, y: faReport.y + faReport.height / 2 });
  // Date writes are asynchronous; wait for the resulting note, not a fixed 50 ms.
  await page.waitForFunction((expected) => window.__notes['Planner/Focus.md'].split('\n').find((l) => l.includes('گزارش ماهانه'))?.includes(expected), `@schedule(${iso(3)} 14:00-16:00)`);
  eq((await note(page, 'Planner/Focus.md')).split('\n').find((l) => l.includes('گزارش ماهانه')).includes(`@schedule(${iso(3)} 14:00-16:00)`), true, 'RTL: dragging left is later');
  // A name out beside its bar follows it in time, to its left, whatever script the name is in.
  await page.evaluate((line) => (window.__notes['Planner/Focus.md'] += `\n${line}`), `- [ ] Pick the colors @schedule(${iso(1)})`);
  await page.locator('.taskpro-board button:has(svg.lucide-refresh-cw)').first().click();
  await page.waitForTimeout(120);
  for (const title of ['Pick the colors', 'ورزش صبحگاهی']) {
    const faBar = page.locator('.taskpro-tl__row').filter({ has: page.locator('.taskpro-tl__title', { hasText: title }) }).locator('.taskpro-tl__bar');
    const [barBox, labelBox] = [await faBar.boundingBox(), await faBar.locator('.taskpro-tl__bar-label').boundingBox()];
    eq(labelBox.x + labelBox.width <= barBox.x, true, `RTL: "${title}" is named to the left of its bar`);
  }
  eq(page.errors, [], 'no page errors on the Persian timeline');
  await page.close();

  // ── Board: what cards show, and the columns' order, width and hiding ─────
  page = await open('?layout=board&scope=vault', 1800);
  const cardOf = (title) => page.locator('.taskpro-card', { hasText: title });
  eq(await cardOf('Send the quote to Acme').locator('.taskpro-schedule-badge .taskpro-chip__label').textContent(), 'Today, 14:00 – 15:30', 'a card shows its plan with the hours');
  await page.locator('.taskpro-board__properties').click();
  await page.locator('.taskpro-menu__item', { hasText: 'Plan' }).click();
  await page.locator('.taskpro-menu__item', { hasText: 'Status' }).click();
  await page.keyboard.press('Escape');
  eq(await cardOf('Send the quote to Acme').locator('.taskpro-schedule-badge').count(), 0, 'a property switched off leaves the cards');
  eq(await cardOf('Send the quote to Acme').locator('.taskpro-interactive-badge').count(), 1, 'one switched on joins them');

  const groups = () => page.$$eval('.taskpro-kanban__column', (els) => els.map((el) => el.dataset.group));
  eq(await groups(), ['[ ]', '[/]', '[!]', '[x]'], 'status columns');
  const doneHead = await page.locator('.taskpro-kanban__column[data-group="[x]"] .taskpro-kanban__header').boundingBox();
  const openHead = await page.locator('.taskpro-kanban__column[data-group="[ ]"] .taskpro-kanban__header').boundingBox();
  await drag({ x: doneHead.x + 60, y: doneHead.y + doneHead.height / 2 }, { x: openHead.x + 10, y: openHead.y + 10 }, 12);
  eq(await groups(), ['[x]', '[ ]', '[/]', '[!]'], 'a column dragged by its header');

  const width = () => page.$eval('.taskpro-kanban__column', (el) => Math.round(el.getBoundingClientRect().width));
  eq(await width(), 272, 'columns start at their width');
  const handle = await page.locator('.taskpro-kanban__column[data-group="[x]"] .taskpro-kanban__resize').boundingBox();
  await drag({ x: handle.x + 4, y: handle.y + 20 }, { x: handle.x + 84, y: handle.y + 20 });
  eq(await width(), 352, 'dragging an edge widens every column');
  await page.locator('.taskpro-kanban__column[data-group="[x]"] .taskpro-kanban__resize').dblclick();
  await page.waitForTimeout(50);
  eq(await width(), 272, 'a double click puts the width back');

  await page.locator('.taskpro-kanban__column[data-group="[!]"] .taskpro-kanban__header').hover();
  await page.locator('.taskpro-kanban__column[data-group="[!]"] .taskpro-kanban__menu').click();
  await page.locator('.taskpro-menu__item', { hasText: 'Hide column' }).click();
  eq(await groups(), ['[x]', '[ ]', '[/]'], 'a column hidden from its menu');
  eq(await page.locator('.taskpro-kanban__hidden-item').count(), 1, 'and listed at the end of the board');
  await page.locator('.taskpro-kanban__hidden-item').click();
  eq(await groups(), ['[x]', '[ ]', '[/]', '[!]'], 'a click puts it back');
  await page.locator('.taskpro-kanban__column[data-group="[x]"] .taskpro-kanban__header').click({ button: 'right' });
  await page.locator('.taskpro-menu__item', { hasText: 'Reset column order' }).click();
  eq(await groups(), ['[ ]', '[/]', '[!]', '[x]'], 'the order reset');
  eq(page.errors, [], 'no page errors with the board columns');
  await page.close();

  // ── Filters by deadline, plan and note; grouping by plan ─────────────────
  page = await open('?scope=vault');
  const pickFilter = async (row, choice) => {
    await page.locator('.taskpro-board__control', { hasText: 'Filter' }).click();
    await page.locator('.taskpro-menu__item', { hasText: row }).first().click();
    await page.locator('.taskpro-menu.is-submenu .taskpro-menu__item', { hasText: choice }).first().click();
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(60);
  };
  await pickFilter('Deadline', 'Overdue');
  eq(await titles(page), ['Chase the missing invoice'], 'a deadline filter keeps what is overdue');
  eq(await page.locator('.taskpro-board__filter-pill').count(), 1, 'as one pill');
  await page.locator('.taskpro-board__filter-pill').click();
  eq((await titles(page)).length, 12, 'and the pill takes it off');

  await pickFilter('Plan', 'Today');
  eq(await titles(page), ['Send the quote to Acme'], 'a plan filter keeps what is planned for today');
  await page.locator('.taskpro-board__filter-pill').click();

  await pickFilter('Plan', 'Not planned');
  const unplanned = await titles(page);
  ok(unplanned.length > 5 && !unplanned.includes('Send the quote to Acme'), 'and what is not planned at all');
  await page.locator('.taskpro-board__filter-pill').click();

  await pickFilter('Note', 'Home');
  const inHome = (await note(page, 'Life/Home.md')).split('\n').filter((line) => /^\s*- \[.\]/.test(line)).length;
  eq((await titles(page)).length, inHome, 'a note filter keeps that note\'s tasks');
  eq((await page.locator('.taskpro-board__filter-pill').textContent()).trim(), 'Home', 'named on its pill');
  eq(await page.locator('.taskpro-board__control.has-value, .taskpro-board__control.is-active').count() > 0, true, 'the filter button counts it');

  // Filters together narrow further; Clear filters takes all of them off.
  await pickFilter('Deadline', 'Later');
  eq(await page.locator('.taskpro-board__filter-pill').count(), 2, 'two filters, two pills');
  await page.locator('.taskpro-board__clear').click();
  eq(await page.locator('.taskpro-board__filter-pill').count(), 0, 'Clear filters takes them all off');
  eq((await titles(page)).length, 12, 'and the list is whole again');

  // Grouped by plan, the table has a group for each day range, and one for what is not planned.
  await page.locator('.taskpro-board__control', { hasText: 'Group' }).click();
  await page.locator('.menu .menu-item', { hasText: 'Plan' }).click();
  await page.waitForTimeout(60);
  const planGroups = await page.$$eval('.taskpro-table__group', (els) => els.map((el) => el.textContent.trim().replace(/\d+$/, '').trim()));
  ok(planGroups.includes('Today') && planGroups.includes('Not planned'), `groups by plan (${planGroups.join(', ')})`);
  eq(page.errors, [], 'no page errors with the new filters');
  await page.close();

  // ── The marks of Notion's own views ──────────────────────────────────────
  page = await open('?scope=vault');
  // The layout tabs: a 2px bar under the current one and under no other.
  eq(await page.$eval('.taskpro-board__layout .is-active', (el) => getComputedStyle(el, '::after').height), '2px', 'the current tab is marked by a bar');
  eq(await page.$eval('.taskpro-board__layout button:not(.is-active)', (el) => getComputedStyle(el, '::after').content), 'none', 'and no other tab is');

  // Status is the one capsule; a tag is a rounded rectangle.
  const shape = (selector) =>
    page.$eval(selector, (el) => ({ radius: parseFloat(getComputedStyle(el).borderTopLeftRadius), height: el.getBoundingClientRect().height }));
  const capsule = await shape('.taskpro-table__row .taskpro-interactive-badge');
  eq(capsule.radius >= capsule.height / 2, true, 'a status is a capsule');
  const rectangle = await shape('.taskpro-table__row .taskpro-tag-chip');
  eq(rectangle.radius < rectangle.height / 2, true, 'a tag is a rounded rectangle');

  // A tag takes its colour from the theme, which keeps its colours on <body>.
  const colours = await page.evaluate(() => {
    const chip = [...document.querySelectorAll('.taskpro-table__row .taskpro-tag-chip')].find((el) => el.textContent === 'Home');
    return {
      chip: getComputedStyle(chip).getPropertyValue('--taskpro-chip-accent').trim(),
      theme: getComputedStyle(document.body).getPropertyValue('--color-green').trim(),
    };
  });
  eq(colours.chip !== '' && colours.chip === colours.theme, true, "a tag is the theme's own green");

  // Every group ends with a New row, and its field adds a task with the group's status.
  eq(
    await page.locator('.taskpro-table__new-row').count(),
    await page.locator('.taskpro-table__group').count(),
    'every group ends with a New row'
  );
  await page.locator('.taskpro-table__new-row').nth(1).locator('.taskpro-board__new').click();
  await page.locator('.taskpro-board__new-input').fill('Ship the release notes');
  await page.locator('.taskpro-board__new-input').press('Enter');
  await page.waitForTimeout(50);
  eq((await note(page, 'Inbox.md')).trim(), '- [/] Ship the release notes', 'a group\'s New row adds a task with its status');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(50);
  eq(await page.locator('.taskpro-board__new-input').count(), 0, 'Escape puts the New row back');
  eq(page.errors, [], 'no page errors with the New rows');
  await page.close();

  // With the properties scrolled sideways, the check and the title stay where they are.
  page = await open('?scope=vault', 900);
  const titleLeft = () => page.$eval('.taskpro-table__row td.taskpro-table__task', (el) => Math.round(el.getBoundingClientRect().left));
  const statusLeft = () => page.$eval('.taskpro-table__row td.taskpro-table__status', (el) => Math.round(el.getBoundingClientRect().left));
  const [titleAtRest, statusAtRest] = [await titleLeft(), await statusLeft()];
  await page.evaluate(() => (document.querySelector('.taskpro-board__body').scrollLeft = 260));
  await page.waitForTimeout(50);
  eq(await titleLeft(), titleAtRest, 'the title column is frozen');
  eq(await statusLeft() < statusAtRest, true, 'while the properties move');
  await page.close();

  // A search that finds nothing offers to clear itself, and Persian fields rest at the right.
  page = await open('?scope=vault&lang=fa');
  eq(await page.$eval('.taskpro-board__search input', (el) => el.getAttribute('dir')), 'rtl', 'an empty Persian field rests right to left');
  await page.locator('.taskpro-board__search input').fill('zzzz');
  await page.waitForTimeout(250);
  eq(await page.$eval('.taskpro-board__search input', (el) => el.getAttribute('dir')), 'auto', 'and follows what is typed');
  await page.locator('.taskpro-board__empty-action').click();
  await page.waitForTimeout(100);
  eq(await page.locator('.taskpro-table__row').count() > 0, true, 'the empty state clears the search');
  eq(await page.$eval('.taskpro-board__search input', (el) => el.value), '', 'and the field');
  await page.close();

  // A person who asks for less motion gets none.
  const calm = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
  await calm.goto(`file://${path.join(here, 'board-preview.html')}?scope=vault`);
  await calm.waitForSelector('body[data-ready="true"]');
  eq(await calm.$eval('.taskpro-board__layout button', (el) => parseFloat(getComputedStyle(el).transitionDuration) < 0.001), true, 'transitions are gone under reduced motion');
  await calm.close();

  // ── Motion: what moves says what happened ────────────────────────────────
  page = await open('?scope=vault', 1280, true);
  const moving = () =>
    page.evaluate(() => [...new Set(document.getAnimations().map((a) => a.animationName).filter((name) => name?.startsWith('taskpro-')))].sort());
  // Opening is an entrance in itself; then the board is still.
  ok((await moving()).includes('taskpro-rise'), 'a board opening comes in');
  await page.waitForTimeout(1000);
  eq(await moving(), [], 'a board at rest plays nothing');
  eq(await page.locator('.is-arriving').count(), 0, 'and nothing on it has just arrived');

  // A new layout comes in, and the bar under the tabs travels to the tab it was moved to.
  await page.locator('.taskpro-board__layout button', { hasText: 'Board' }).click();
  await page.waitForTimeout(40);
  ok((await moving()).includes('taskpro-rise'), 'a layout comes in');
  ok((await moving()).includes('taskpro-bar'), 'the bar slides to its tab');
  eq(await page.locator('.taskpro-board__body').evaluate((el) => el.classList.contains('is-entering-view')), true, 'the entrance is marked while it plays');
  await page.waitForTimeout(1000);
  eq(await moving(), [], 'and it is over within a second');
  eq(await page.locator('.taskpro-board__body').evaluate((el) => el.classList.contains('is-entering')), false, 'leaving nothing marked');

  // A task ticked off pops its check where the card lands, and the card flashes.
  await page.locator('.taskpro-card', { hasText: 'Dentist appointment' }).locator('.taskpro-board__check').click();
  await page.waitForTimeout(60);
  const played = await moving();
  ok(played.includes('taskpro-pop') && played.includes('taskpro-arrive'), 'a ticked task pops and flashes');
  eq(await page.locator('.taskpro-kanban__column[data-group="[x]"] .taskpro-card.is-arriving').count(), 1, 'in the column it moved to');
  await page.waitForTimeout(1700);

  // Any other redraw plays nothing: typing in the search redraws the board.
  await page.locator('.taskpro-board__search input').fill('den');
  await page.waitForTimeout(300);
  eq(await moving(), [], 'a search redraws without animating');
  eq(page.errors, [], 'no page errors with the motion');
  await page.close();

  // A person who asks for less motion gets none: whatever starts runs out at once.
  const still = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
  await still.goto(`file://${path.join(here, 'board-preview.html')}?scope=vault`);
  await still.waitForSelector('body[data-ready="true"]');
  await still.locator('.taskpro-board__layout button', { hasText: 'Board' }).click();
  await still.waitForTimeout(40);
  const longest = await still.evaluate(() =>
    Math.max(0, ...document.getAnimations().filter((a) => a.animationName?.startsWith('taskpro-')).map((a) => Number(a.effect.getComputedTiming().endTime)))
  );
  ok(longest < 5, `animations are over at once under reduced motion (${longest}ms)`);
  await still.close();

  // Beside a target folder the scope switch is there; without one it is not.
  page = await open('');
  eq(await page.locator('.taskpro-board__scope').count(), 1, 'a target folder brings the scope switch');
  await page.close();
  page = await open('?scope=vault');
  eq(await page.locator('.taskpro-board__scope').count(), 0, 'and with none there is nothing to switch');
  await page.close();
} finally {
  await browser.close();
}

console.log(`BOARD_INTERACTIONS_OK (${checked} checks)`);
