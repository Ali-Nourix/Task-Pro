import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { buildHarness } from './harness/build.mjs';
await buildHarness();
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
let checks = 0;
const eq = (a, b, label) => { assert.deepEqual(a, b, label); checks++; };
try {
  for (const lang of ['en', 'fa']) {
    const page = await browser.newPage({ viewport: { width: 1200, height: 1000 } });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(new URL(`./board-preview.html?view=embeds&lang=${lang}`, import.meta.url).href);
    await page.evaluate(() => { localStorage.clear(); });
    await page.reload();
    const block = page.locator('[data-embed="table"]');
    await block.locator('.taskpro-table').waitFor();
    const originalMain = await page.evaluate(() => JSON.stringify(window.embedTest.settings.board));
    // Exercise the real board preference path, then the calendar's navigation path.
    await page.evaluate(async () => {
      const board = window.embedTest.children[0].board;
      await board.updatePrefs({ layout: 'calendar', calendarView: 'day', calendarSystem: 'jalali' });
      board.calendarView.openDay('2026-10-20');
    });
    await block.locator('.taskpro-cal').waitFor();
    await block.getByRole('button', { name: lang === 'fa' ? 'بعدی' : 'Next', exact: true }).click();
    const snapshot = () => page.evaluate(() => {
      const board = window.embedTest.children[0].board;
      return [board.prefs.layout, board.prefs.calendarView, board.prefs.calendarSystem, board.calendarView.anchor];
    });
    eq(await snapshot(), ['calendar', 'day', 'jalali', '2026-10-21'], 'navigated state');
    await page.evaluate(() => window.embedTest.refresh());
    eq(await snapshot(), ['calendar', 'day', 'jalali', '2026-10-21'], 'refresh preserves navigation');
    await page.evaluate(() => window.embedTest.reopen());
    await block.locator('.taskpro-cal').waitFor();
    eq(await snapshot(), ['calendar', 'day', 'jalali', '2026-10-21'], 'Markdown rerender restores navigation');
    eq(await page.evaluate(() => JSON.stringify(window.embedTest.settings.board)), originalMain, 'main board unchanged');
    await page.locator('[data-embed="calendar"]').scrollIntoViewIfNeeded();
    await page.locator('[data-embed="calendar"] .taskpro-cal').waitFor();
    eq(await page.evaluate(() => window.embedTest.children[1].board.prefs.calendarView), 'week', 'second block unchanged');
    await page.reload();
    await block.locator('.taskpro-cal').waitFor();
    eq(await snapshot(), ['calendar', 'day', 'jalali', '2026-10-21'], 'fresh page restores serialized state');
    eq(errors, [], 'no runtime errors');
    await page.close();
  }
  console.log(`EMBED_STATE_UI_OK (${checks} checks)`);
} finally { await browser.close(); }
