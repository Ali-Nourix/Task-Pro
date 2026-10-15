// Real rendering and editor controls in Chromium; no remote services or live vault writes.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { buildHarness } from './harness/build.mjs';
await buildHarness();
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined, args: ['--no-sandbox'] });
let checks = 0;
const eq = (a, b, label) => { assert.deepEqual(a, b, label); checks++; };
try {
  for (const [width, language] of [[1280, 'en'], [390, 'fa']]) {
    const page = await browser.newPage({ viewport: { width, height: width < 640 ? 667 : 900 }, reducedMotion: 'reduce' });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(new URL('./board-preview.html', import.meta.url).href + `?view=embeds&lang=${language}`);
    await page.waitForSelector('[data-embed="table"] .taskpro-board__summary');
    await page.waitForSelector('[data-embed="calendar"] .taskpro-cal');
    eq(await page.locator('.taskpro-note-embed').count(), 2, 'both embeds mount');
    const globalLayout = await page.evaluate(() => window.embedTest.settings.board.layout);
    // The table and calendar are independent even when they share notes/store.
    eq(await page.locator('[data-embed="table"] .taskpro-board__summary').count() > 0, true);
    eq(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, 'no page overflow');
    eq(await page.evaluate(() => window.embedTest.listenerCount()), 2, 'one subscription per embed');
    if (width > 640) {
      const calendarSummary = await page.locator('[data-embed="calendar"] .taskpro-board__summary').innerText();
      await page.locator('[data-embed="table"] .taskpro-table__row', { hasText: 'Send the quote to Acme' }).locator('.taskpro-board__check').click();
      await page.waitForFunction(() => window.__notes['Planner/2026-W39.md'].includes('- [x] Send the quote'));
      await page.waitForTimeout(100);
      eq((await page.locator('[data-embed="calendar"] .taskpro-board__summary').innerText()) !== calendarSummary, true, 'calendar reacts to table edit');
    }
    await page.locator('#configure-timer').click();
    const panel = page.locator('.taskpro-panel');
    eq(await panel.isVisible(), true);
    eq(await panel.locator('input[type="checkbox"]').first().isChecked(), true);
    const numbers = panel.locator('input[type="number"]');
    eq(await numbers.count(), 5);
    await numbers.nth(0).fill('30');
    await numbers.nth(1).fill('7');
    await numbers.nth(2).fill('20');
    await numbers.nth(3).fill('3');
    await numbers.nth(4).fill('6');
    await panel.locator('input[type="checkbox"]').nth(1).check();
    await panel.locator('button.mod-cta').click();
    const configured = await page.evaluate(() => window.embedTest.getTimer());
    eq([configured.durationSeconds, configured.pomodoro.shortBreakMinutes, configured.pomodoro.longBreakMinutes,
      configured.pomodoro.longBreakEvery, configured.pomodoro.targetRounds, configured.pomodoro.autoStart], [1800, 7, 20, 3, 6, true]);
    eq(await page.locator('.taskpro-timer-badge').innerText().then((s) => s.includes('0/6')), true, 'chip round progress');
    await page.evaluate(async () => {
      const api = window.embedTest;
      await api.service.start('Inbox.md', 'demo', api.getTimer());
    });
    const runningSince = await page.evaluate(() => window.embedTest.getTimer().runningSince);
    await page.locator('#configure-timer').click();
    await panel.locator('button.mod-cta').click();
    eq(await page.evaluate(() => window.embedTest.getTimer().runningSince), runningSince, 'unchanged settings preserve active run');
    // Invalid values do not save or close the editor.
    await page.locator('#configure-timer').click();
    await panel.locator('input[type="number"]').nth(1).fill('0');
    await panel.locator('button.mod-cta').click();
    eq(await panel.isVisible(), true, 'invalid break rejected');
    eq(await page.evaluate(() => window.embedTest.getTimer().pomodoro.shortBreakMinutes), 7);
    await panel.locator('input[type="number"]').nth(1).fill('7');
    // Switching off cycles returns to a plain timer without losing the label.
    await panel.locator('input[type="checkbox"]').first().uncheck();
    await panel.locator('button.mod-cta').click();
    eq(await page.evaluate(() => [window.embedTest.getTimer().pomodoro, window.embedTest.getTimer().label]), [undefined, 'Write']);
    eq(await page.evaluate(() => window.embedTest.settings.board.layout), globalLayout, 'no global layout mutation');
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({ path: `/data/taskpro-embeds-${language}.png`, fullPage: false });
    await page.evaluate(() => window.embedTest.destroy());
    eq(await page.evaluate(() => window.embedTest.listenerCount()), 0, 'unload unsubscribes both embeds');
    eq(errors, [], 'no browser exceptions');
    await page.close();
  }
  console.log(`NOTE_EMBED_POMODORO_UI_OK (${checks} checks)`);
} finally { await browser.close(); }
