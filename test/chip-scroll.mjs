/** Wheel, RTL, focus and cleanup on the actual chip-scroll implementation. */
import { chromium } from 'playwright';
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import assert from 'node:assert/strict';
let checks = 0;
const ok = (v, message) => { assert.ok(v, message); checks++; };
const js = (await esbuild.build({ stdin: { contents: 'import * as scroll from "./src/ui/chip-scroll"; window.chipScroll = scroll;', resolveDir: process.cwd(), loader: 'ts' }, bundle: true, format: 'iife', write: false, logLevel: 'error' })).outputFiles[0].text;
const css = fs.readFileSync('styles.css', 'utf8');
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
try {
  for (const direction of ['ltr', 'rtl']) for (const theme of ['light', 'dark']) for (const reducedMotion of ['reduce', 'no-preference']) {
    console.log(`chip matrix: ${direction}/${theme}/${reducedMotion}`);
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion });
    await page.setContent(`<style>${css}\n.row { display:flex; width:260px; max-width:260px !important; direction:${direction}; flex-direction:row; } .chip { width:100px; min-width:100px; height:32px; flex-shrink:0; }</style><body class="theme-${theme}"><div class="taskpro-badge-container row">${Array.from({length:8},(_,i)=>`<button class="chip">Chip ${i}</button>`).join('')}</div></body>`);
    await page.addScriptTag({ content: js });
    await page.evaluate(() => window.chipScroll.makeChipRowScrollable(document.querySelector('.row')));
    const row = page.locator('.row');
    await page.waitForFunction(() => document.querySelector('.row').classList.contains('is-overflowing'));
    ok(await row.evaluate(e=>e.scrollWidth>e.clientWidth), 'mobile chip row really overflows');
    const before = await row.evaluate(e=>e.scrollLeft);
    const box = await row.boundingBox();
    await page.mouse.move(box.x+box.width/2,box.y+box.height/2);
    // Ensure the composited scroll layer exists before sending a native wheel.
    await row.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.mouse.wheel(0,120);
    await page.waitForFunction((before)=>Math.abs(document.querySelector('.row').scrollLeft-before)>1,before,{ timeout:3000 });
    ok(Math.abs(await row.evaluate(e=>e.scrollLeft)-before)>1, `${direction}: downward wheel reaches trailing chips`);
    await row.locator('button').last().focus();
    await page.waitForFunction(() => { const row=document.querySelector('.row').getBoundingClientRect(); const last=document.querySelector('.row button:last-child').getBoundingClientRect(); return last.left>=row.left-1 && last.right<=row.right+1; },undefined,{timeout:3000});
    ok(true, `${direction}: keyboard focus brings the last chip into view`);
    await page.evaluate(()=>window.chipScroll.releaseChipRow(document.querySelector('.row')));
    const clean = await row.evaluate(e=>e.scrollLeft);
    await page.mouse.move(box.x+box.width/2,box.y+box.height/2);
    await page.mouse.wheel(0,-120);
    await page.waitForTimeout(100);
    ok(await row.evaluate(e=>e.scrollLeft)===clean, 'cleanup removes the vertical-wheel handler');
    await page.close();
  }
  console.log(`CHIP_SCROLL_OK (${checks} checks)`);
} finally { await browser.close(); }
