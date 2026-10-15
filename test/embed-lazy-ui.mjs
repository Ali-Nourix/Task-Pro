import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { buildHarness } from './harness/build.mjs';
await buildHarness();
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
let checks = 0;
const eq = (a,b,label) => { assert.deepEqual(a,b,label); checks++; };
const until = (page, fn) => page.waitForFunction(fn);
try {
  for (const lang of ['en', 'fa']) {
    const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(new URL(`./board-preview.html?view=embeds&defer=1&cold=1&bulk=1&lang=${lang}`, import.meta.url).href);
    const table = page.locator('[data-embed="table"]'), calendar = page.locator('[data-embed="calendar"]');
    await table.locator('.taskpro-board__body .taskpro-board__skeleton').waitFor();
    eq(await calendar.locator('.taskpro-board__body').count(), 0, 'offscreen calendar has no board/render subscription');
    eq(await calendar.locator('.taskpro-board__skeleton[data-layout="calendar"]').count(), 1, 'calendar-shaped deferred placeholder');
    eq(await table.locator('.taskpro-board__skeleton[data-layout="table"]').count(), 1, 'table-shaped loading placeholder');
    eq(await page.evaluate(() => window.embedTest.listenerCount()), 1, 'only visible view subscribes');
    eq(await table.getAttribute('aria-busy'), 'true', 'accessible actual loading state');
    eq(await calendar.locator('.taskpro-board__skeleton').evaluate(el => getComputedStyle(el, '::after').animationPlayState), 'paused', 'offscreen shimmer paused');
    // One composited sweep, no animated pseudo-element for every placeholder bar.
    eq(await table.locator('.taskpro-board__skeleton-bar').first().evaluate(el => getComputedStyle(el, '::after').animationName), 'none', 'no per-cell animation layers');
    await table.screenshot({ path: `/data/taskpro-loading-${lang}.png` });
    await page.evaluate(() => window.embedTest.finishLoading());
    await table.locator('.taskpro-table__row').first().waitFor();
    eq(await table.locator('.taskpro-board__skeleton').count(), 0, 'loading removed when data is ready');
    await until(page, () => document.querySelector('[data-embed="table"]').getAttribute('aria-busy') === 'false');
    eq(await table.locator('.taskpro-table__row').count(), 46, 'only first 40 per group, not the whole 1000-row data set');
    const more = table.locator('.taskpro-table__more-row button').first();
    await more.click();
    eq(await table.locator('.taskpro-table__row').count(), 86, 'next page remains available on demand');
    // Host/theme tries four thick edges on all cells; plugin must own uniform rules.
    await page.addStyleTag({ content: '.markdown-rendered .block-language-taskpro table th,.markdown-rendered .block-language-taskpro table td {border:3px solid red;}'});
    await table.evaluate(el => { el.classList.add('block-language-taskpro'); el.parentElement.classList.add('markdown-rendered'); });
    const borders = await table.locator('.taskpro-table th, .taskpro-table td').evaluateAll(els => els.map(el => {
      const s = getComputedStyle(el); return [s.borderTopWidth, s.borderBottomWidth, s.borderInlineStartWidth, s.borderInlineEndWidth, s.borderBottomColor];
    }));
    eq(borders.every(([top,bottom,start,end]) => top === '0px' && bottom === '1px' && start === '0px' && ['0px','1px'].includes(end)), true, 'single-owner one-pixel borders even with theme four-sided borders');
    eq(new Set(borders.map(b => b[4])).size, 1, 'header, groups and data share separator color');
    // The second block must still not have fetched/rendered while paging first block.
    eq(await calendar.locator('.taskpro-board__body').count(), 0, 'paging does not activate distant blocks');
    await calendar.scrollIntoViewIfNeeded();
    await calendar.locator('.taskpro-cal').waitFor();
    await page.waitForTimeout(150);
    eq(await page.evaluate(() => window.embedTest.listenerCount()), 2, 'second view mounts only near viewport');
    const before = await page.evaluate(() => window.embedTest.paintStats.body);
    await page.evaluate(async () => { window.embedTest.burst(50); await new Promise(requestAnimationFrame); });
    eq(await page.evaluate(() => window.embedTest.paintStats.body) - before, 1, '50 updates paint only visible calendar, not offscreen table');
    await table.scrollIntoViewIfNeeded();
    await page.waitForTimeout(150);
    eq(await table.locator('.taskpro-table__row').count(), 86, 'paged state survives suspension');
    eq(await table.locator('.taskpro-board__body').evaluate(el => el.classList.contains('is-entering-view')), false, 'no whole-table transform entrance');
    await page.evaluate(() => window.embedTest.destroy());
    eq(await page.evaluate(() => window.embedTest.listenerCount()), 0, 'subscriptions released on teardown');
    eq(errors, [], 'no browser errors');
    await page.close();
  }
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  await page.goto(new URL('./board-preview.html?view=minimal-embeds&cold=1&lang=fa', import.meta.url).href);
  await page.locator('.taskpro-board__skeleton').first().waitFor();
  eq(await page.locator('.taskpro-board__skeleton').first().evaluate(el => getComputedStyle(el, '::after').animationName), 'none', 'reduced motion has static skeleton');
  eq(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'mobile placeholder does not overflow');
  const coldCalendar = page.locator('[data-embed="calendar"]');
  await coldCalendar.scrollIntoViewIfNeeded();
  await coldCalendar.locator('.taskpro-board__body .taskpro-skeleton__calendar').waitFor();
  await coldCalendar.screenshot({ path: '/data/taskpro-loading-calendar-fa.png' });
  await page.evaluate(() => { window.embedTest.reopen(); window.embedTest.destroy(); });
  await page.waitForTimeout(150);
  eq(await page.evaluate(() => window.embedTest.listenerCount()), 0, 'teardown cancels queued or deferred mounts');
  eq(await page.locator('.taskpro-board').count(), 0, 'destroyed placeholders never remount');
  await page.close();
} finally { await browser.close(); }
console.log(`EMBED_LAZY_UI_OK (${checks} checks)`);
