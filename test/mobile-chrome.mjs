/** A pointer must not move the floating + between press and activation.
 * Keyboard focus must still reveal collapsed chrome. */
import { chromium } from 'playwright';
import { buildHarness } from './harness/build.mjs';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
await buildHarness();
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
let checks = 0;
try {
  for (const language of ['en', 'fa']) for (const mode of ['light', 'dark']) for (const reducedMotion of ['reduce', 'no-preference']) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, reducedMotion });
    const page = await context.newPage();
    await page.goto(`${pathToFileURL(path.resolve('test/board-preview.html'))}?mobile=1&scope=vault&lang=${language}${mode === 'light' ? '&light=1' : ''}`);
    await page.waitForSelector('body[data-ready="true"]');
    assert.equal(await page.locator('body').evaluate(el => el.classList.contains('theme-light')), mode === 'light'); checks++;
    const collapse = async () => {
      await page.locator('.taskpro-board__body').evaluate(el => el.scrollTop = 0);
      await page.waitForTimeout(50);
      await page.locator('.taskpro-board__body').evaluate(el => el.scrollTop = 260);
      await page.waitForSelector('.taskpro-board.is-chrome-hidden');
      await page.waitForTimeout(250);
    };
    await collapse();
    await page.locator('.taskpro-board__fab').tap();
    await page.locator('.taskpro-qa[role="dialog"]').waitFor({ state: 'visible' });
    assert.equal(await page.locator('.taskpro-qa[aria-modal="true"]').count(), 1); checks++;
    await page.locator('.taskpro-qa__close').tap();
    await page.waitForTimeout(300);
    await collapse();
    await page.keyboard.press('Tab');
    await page.locator('.taskpro-board__fab').focus();
    await page.waitForFunction(() => !document.querySelector('.taskpro-board').classList.contains('is-chrome-hidden'));
    assert.equal(await page.locator('.taskpro-board__fab').evaluate(el => el.matches(':focus-visible')), true); checks++;
    await context.close();
  }
  console.log(`MOBILE_CHROME_OK (${checks} checks)`);
} finally { await browser.close(); }
