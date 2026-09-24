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

async function open(query = '', width = 1280) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
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
  await page.locator('.menu .menu-item', { hasText: 'In Progress' }).click();
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
  await page.locator('.menu .menu-item', { hasText: 'Highest' }).click();
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
  await page.locator('.menu .menu-item', { hasText: 'Client' }).click();
  eq((await titles(page)).sort(), ['Chase the missing invoice', 'Send the quote to Acme'], 'tag filter');
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
} finally {
  await browser.close();
}

console.log(`BOARD_INTERACTIONS_OK (${checked} checks)`);
