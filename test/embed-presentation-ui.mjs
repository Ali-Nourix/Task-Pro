// Regression: no corner square, real minimal chrome, and coalesced repaint bursts.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { buildHarness } from './harness/build.mjs';
await buildHarness();
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
let checked = 0;
const eq = (a, b, label) => { assert.deepEqual(a, b, label); checked++; };
try {
  for (const [width, lang] of [[1280, 'en'], [390, 'fa']]) {
    const page = await browser.newPage({ viewport: { width, height: 844 }, reducedMotion: 'no-preference' });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(new URL(`./board-preview.html?view=minimal-embeds&lang=${lang}`, import.meta.url).href);
    await page.waitForSelector('[data-embed="calendar"] .taskpro-cal');
    const calendar = page.locator('[data-embed="calendar"]');
    eq(await calendar.locator('.taskpro-board__header, .taskpro-board__toolbar, .taskpro-tabbar, .taskpro-board__add, .taskpro-board__fab').count(), 0, 'omitted controls are not built');
    eq(await calendar.locator('.taskpro-cal-nav').count(), 1, 'calendar period navigation remains');
    eq(await calendar.locator('.taskpro-cal__sidebar').count(), 0, 'no extra sidebar by default');
    eq(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, 'no mobile page overflow');
    // Loaded store: exactly one initial body paint per embed, not two.
    eq(await page.evaluate(() => window.embedTest.paintStats.body), 2, 'no duplicate mount repaint');
    const paintsBefore = await page.evaluate(() => window.embedTest.paintStats.body);
    await page.evaluate(async () => {
      window.embedTest.burst(50);
      await new Promise(requestAnimationFrame);
    });
    eq(await page.evaluate(() => window.embedTest.paintStats.body) - paintsBefore, 2, '50 notifications repaint each view once');
    const options = calendar.locator('.taskpro-embed-options');
    await options.click();
    await calendar.locator('.taskpro-menu__item').filter({ hasText: lang === 'fa' ? /^\s*همهٔ کنترل‌ها\s*$/ : /^\s*All controls\s*$/ }).click();
    await page.waitForTimeout(60);
    eq(await calendar.locator('.taskpro-board__header').count(), 1, 'full controls recoverable');
    eq(await page.locator('[data-embed="table"] .is-minimal-chrome').count(), 1, 'other embed unchanged');
    await calendar.locator('.taskpro-embed-options').click();
    await calendar.locator('.taskpro-menu__item').filter({ hasText: lang === 'fa' ? /^\s*فقط نمای فعلی\s*$/ : /^\s*Current view only\s*$/ }).click();
    eq(await calendar.locator('.taskpro-board__header').count(), 0);
    eq(await calendar.locator('.taskpro-cal').count(), 1, 'calendar survives mode switch');
    await page.evaluate(() => scrollTo(0, document.querySelector('[data-embed="calendar"]').offsetTop - 12));
    await page.screenshot({ path: `/data/taskpro-minimal-${lang}.png` });
    // Non-reduced motion remains present; we did not replace enter()/CSS animations.
    eq(await calendar.locator('.taskpro-board__body').evaluate((el) => el.classList.contains('is-entering')), false, 'mode change does not replay entrance unnecessarily');
    const beforeDispose = await page.evaluate(() => window.embedTest.paintStats.body);
    await page.evaluate(async () => { window.embedTest.burst(50); window.embedTest.destroy(); await new Promise(requestAnimationFrame); });
    eq(await page.evaluate(() => window.embedTest.paintStats.body), beforeDispose, 'teardown cancels scheduled paints');
    eq(errors, [], 'no browser errors');
    await page.close();
  }
  // Desktop kanban: no stray hover square in either direction, selection still accessible.
  for (const lang of ['en', 'fa']) {
    const page = await browser.newPage({ viewport: { width: 1500, height: 1000 }, reducedMotion: 'no-preference' });
    await page.goto(new URL(`./board-preview.html?layout=board&lang=${lang}`, import.meta.url).href);
    const card = page.locator('.taskpro-card').first();
    await card.waitFor();
    await card.hover();
    const square = card.locator('.taskpro-board__select');
    eq(await square.isVisible(), false, 'no square on hover');
    eq(await card.locator('.taskpro-board__check').isVisible(), true, 'normal completion control remains');
    await card.locator('.taskpro-card__more').last().click();
    await page.locator('.taskpro-menu__item').filter({ hasText: lang === 'fa' ? /^\s*انتخاب\s*$/ : /^\s*Select\s*$/ }).click();
    eq(await page.locator('.taskpro-card.is-selected').count(), 1, 'select action preserved');
    const active = page.locator('.taskpro-card.is-selected').first();
    const cardBox = await active.boundingBox();
    const selectBox = await active.locator('.taskpro-board__select').boundingBox();
    eq(selectBox.x >= cardBox.x && selectBox.x + selectBox.width <= cardBox.x + cardBox.width, true, 'square stays inside card horizontally');
    eq(selectBox.y >= cardBox.y && selectBox.y + selectBox.height <= cardBox.y + cardBox.height, true, 'square stays inside card vertically');
    eq(await active.locator('.taskpro-board__check').isVisible(), false, 'no duplicate completion square');
    await page.locator('.taskpro-selection__btn.is-clear').click();
    eq(await card.locator('.taskpro-board__select').isVisible(), false, 'selection square leaves cleanly');
    eq(await card.locator('.taskpro-board__check').isVisible(), true, 'completion returns');
    await card.hover();
    await page.screenshot({ path: `/data/taskpro-hover-fixed-${lang}.png` });
    await page.close();
  }
  console.log(`EMBED_PRESENTATION_UI_OK (${checked} checks)`);
} finally { await browser.close(); }
