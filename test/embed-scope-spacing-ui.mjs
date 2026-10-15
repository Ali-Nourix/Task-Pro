import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { buildHarness } from './harness/build.mjs';
await buildHarness();
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
let checks = 0;
const eq = (a, b, message) => { assert.deepEqual(a, b, message); checks++; };
const rowSelector = '.taskpro-table__row, .taskpro-list__row';
try {
  for (const [width, lang] of [[724, 'en'], [724, 'fa'], [390, 'fa']]) {
    const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: 'reduce', hasTouch: width < 640 });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(new URL(`./board-preview.html?view=embeds&lang=${lang}&embed-scope=target`, import.meta.url).href);
    const table = page.locator('[data-embed="table"]');
    await table.locator(rowSelector).first().waitFor();
    const checkTarget = async () => {
      await table.locator(rowSelector).first().waitFor();
      const ids = await table.locator(rowSelector).evaluateAll(rows => rows.map(row => row.dataset.taskId));
      eq(ids.length > 0 && ids.every(id => id.startsWith('Planner/')), true, 'configured folder, not legacy scope:all');
    };
    await checkTarget();
    const globalScope = await page.evaluate(() => window.embedTest.settings.board.scope);
    // Reopening does not inherit the workspace's whole-vault scope or the old fence's all option.
    await page.evaluate(() => window.embedTest.reopen());
    await checkTarget();
    eq(await page.evaluate(() => window.embedTest.settings.board.scope), globalScope, 'workspace scope is independent');
    const fullCenterDelta = await table.evaluate(el => {
      const option = el.querySelector('.taskpro-embed-options').getBoundingClientRect();
      const other = el.querySelector('.taskpro-board__heading-actions button:not(.taskpro-embed-options)').getBoundingClientRect();
      return Math.abs(option.y + option.height / 2 - other.y - other.height / 2);
    });
    eq(fullCenterDelta < 1, true, 'full-mode settings icon aligned with peers');
    const spacing = await table.evaluate(el => {
      const board = el.querySelector('.taskpro-board');
      const body = getComputedStyle(el.querySelector('.taskpro-board__body'));
      const header = getComputedStyle(el.querySelector('.taskpro-board__header'));
      return [getComputedStyle(board).getPropertyValue('--taskpro-board-gutter').trim(), body.paddingLeft, body.paddingRight, header.paddingLeft, header.paddingRight];
    });
    eq(spacing, ['8px', '8px', '8px', '8px', '8px'], 'one 8px gutter on both sides of full view');
    // Simulate the persisted General setting changing; loaded note views react immediately.
    await page.evaluate(() => { window.embedTest.settings.embedDefaultScope = 'vault'; window.embedTest.refresh(); });
    eq(await table.locator(rowSelector).count() > 8, true, 'whole-vault startup setting works');
    await page.evaluate(() => window.embedTest.reopen());
    await table.locator(rowSelector).first().waitFor();
    eq(await table.locator(rowSelector).count() > 8, true, 'whole-vault setting survives reopen');
    await page.evaluate(() => { window.embedTest.settings.embedDefaultScope = 'block'; window.embedTest.refresh(); });
    eq(await table.locator(rowSelector).count() > 8, true, 'explicit block-policy opt-in respects legacy all');
    await page.evaluate(() => { window.embedTest.settings.embedDefaultScope = 'target'; window.embedTest.refresh(); });
    await checkTarget();
    await page.evaluate(() => { window.embedTest.settings.targetFolder = ''; window.embedTest.refresh(); });
    eq(await table.locator(rowSelector).count() > 8, true, 'no folder falls back safely to vault');
    await page.evaluate(() => { window.embedTest.settings.targetFolder = 'Planner'; window.embedTest.refresh(); });
    await checkTarget();
    eq(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, 'no page overflow');
    await page.screenshot({ path: `/data/taskpro-scope-full-${width}-${lang}.png` });
    await page.close();

    const minimal = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: 'reduce', hasTouch: width < 640 });
    minimal.on('pageerror', e => errors.push(e.message));
    await minimal.goto(new URL(`./board-preview.html?view=minimal-embeds&lang=${lang}&embed-scope=target`, import.meta.url).href);
    const cal = minimal.locator('[data-embed="calendar"]');
    await cal.locator('.taskpro-cal').waitFor();
    eq(await cal.evaluate(el => {
      const button = el.querySelector('.taskpro-embed-options').getBoundingClientRect();
      const today = el.querySelector('.taskpro-cal-nav__today').getBoundingClientRect();
      return Math.abs(button.y + button.height / 2 - today.y - today.height / 2) < 1;
    }), true, 'minimal settings icon aligned with first calendar row');
    eq(await cal.locator('.taskpro-board__body').evaluate(el => [getComputedStyle(el).paddingLeft, getComputedStyle(el).paddingRight]), ['8px', '8px']);
    eq(await cal.locator('.taskpro-cal-nav').evaluate(el => [getComputedStyle(el).paddingLeft, getComputedStyle(el).paddingRight]), ['0px', '0px'], 'no doubled calendar gutter');
    eq(await cal.locator('.taskpro-embed-nav-row').evaluate(el => [getComputedStyle(el).paddingLeft, getComputedStyle(el).paddingRight]), ['8px', '8px']);
    if (width < 640) eq((await cal.locator('.taskpro-cal-nav').boundingBox()).height <= 112, true, 'options do not force an extra navigation row');
    await minimal.evaluate(() => scrollTo(0, document.querySelector('[data-embed="calendar"]').offsetTop - 8));
    await minimal.screenshot({ path: `/data/taskpro-scope-minimal-${width}-${lang}.png` });
    eq(errors, []);
    await minimal.close();
  }
  console.log(`EMBED_SCOPE_SPACING_UI_OK (${checks} checks)`);
} finally { await browser.close(); }
