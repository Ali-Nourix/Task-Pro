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
