import { chromium } from 'playwright';
import * as esbuild from 'esbuild';
import assert from 'node:assert/strict';
const code = (await esbuild.build({ stdin: { contents: 'import { suppressGestureClick } from "./src/ui/touch"; window.guard = suppressGestureClick;', resolveDir: process.cwd(), loader: 'ts' }, bundle: true, format: 'iife', write: false, logLevel: 'error' })).outputFiles[0].text;
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
let checks = 0;
try {
  for (const scope of ['document', 'element']) {
    const page = await browser.newPage({ hasTouch: true });
    await page.setContent('<div id="scope"><button id="tap">Tap</button></div>');
    await page.addScriptTag({ content: code });
    const results = await page.evaluate(async (scope) => {
      const target = scope === 'document' ? document : document.querySelector('#scope');
      const button = document.querySelector('#tap'); let clicks = 0;
      button.addEventListener('click', () => clicks++);
      const click = () => button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }));
      const values = [];
      window.guard(target); click(); values.push(clicks === 0);
      window.guard(target); button.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, isPrimary: true })); click(); values.push(clicks === 1);
      window.guard(target); button.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, isPrimary: false })); click(); values.push(clicks === 1);
      window.guard(target); button.click(); values.push(clicks === 2);
      window.guard(target, 20); await new Promise(resolve => setTimeout(resolve, 40)); click(); values.push(clicks === 3);
      return values;
    }, scope);
    for (const passed of results) { assert.ok(passed, `${scope}: gesture/next-press/secondary/keyboard/expiry`); checks++; }
    await page.close();
  }
  console.log(`TOUCH_GUARD_OK (${checks} checks)`);
} finally { await browser.close(); }
