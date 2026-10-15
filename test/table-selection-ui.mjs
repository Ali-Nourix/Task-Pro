// Selection uses the existing status slot: no protruding or doubled checkboxes.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { buildHarness } from './harness/build.mjs';
await buildHarness();
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
let checks = 0;
const eq = (a, b, label) => { assert.deepEqual(a, b, label); checks++; };
try {
  for (const lang of ['en', 'fa']) for (const width of [1500, 724]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(new URL(`./board-preview.html?view=embeds&embed-scope=block&lang=${lang}`, import.meta.url).href);
    const host = page.locator('[data-embed="table"]');
    const rows = host.locator('.taskpro-table__row');
    await rows.first().waitFor();
    const row = rows.first();
    const square = row.locator('.taskpro-board__select');
    const completion = row.locator('.taskpro-board__check');
    await row.hover({ position: { x: 150, y: 10 } });
    eq(await square.isVisible(), false, 'normal hover has no second checkbox');
    eq(await completion.isVisible(), true, 'completion remains available');
    const before = await row.locator('.taskpro-table__check').boundingBox();
    const status = await completion.getAttribute('data-status');
    await row.click({ button: 'right', position: { x: 150, y: 10 } });
    await page.locator('.taskpro-menu__item').filter({ hasText: lang === 'fa' ? /^\s*انتخاب\s*$/ : /^\s*Select\s*$/ }).click();
    eq(await square.isVisible(), true, 'selection control appears');
    eq(await completion.isVisible(), false, 'completion does not overlap selection');
    eq(await square.getAttribute('aria-checked'), 'true', 'selected state accessible');
    eq(await completion.getAttribute('data-status'), status, 'selection does not complete a task');
    const cell = await row.locator('.taskpro-table__check').boundingBox();
    const box = await square.boundingBox();
    eq(Math.abs(cell.width - before.width) < 1, true, 'no layout jump');
    eq(box.x >= cell.x && box.x + box.width <= cell.x + cell.width, true, 'checkbox inside column');
    eq(Math.abs(box.x + box.width / 2 - cell.x - cell.width / 2) < 1, true, 'checkbox centered in LTR and RTL');
    eq(box.width, 16, 'checkbox matches status size');
    eq(await square.locator('svg').count(), 0, 'host SVG-button styles cannot enlarge checkbox');
    await page.keyboard.press('Tab');
    await square.focus();
    const focus = await square.evaluate(el => { const s = getComputedStyle(el); return { shadow: s.boxShadow, outline: s.outlineStyle, offset: s.outlineOffset }; });
    eq(focus.shadow === 'none' || focus.shadow.includes('inset'), true, 'no external focus halo');
    eq(focus.outline === 'solid' && parseFloat(focus.offset) < 0, true, 'keyboard focus remains visible inside checkbox');
    // Stickiness during horizontal scrolling must not leave the checkbox in the gutter.
    await host.locator('.taskpro-board__body').evaluate(el => { el.scrollLeft = el.scrollWidth; });
    const scrolledCell = await row.locator('.taskpro-table__check').boundingBox();
    const scrolledBox = await square.boundingBox();
    eq(scrolledBox.x >= scrolledCell.x && scrolledBox.x + scrolledBox.width <= scrolledCell.x + scrolledCell.width, true, 'selection stays in sticky cell');
    await rows.nth(1).locator('.taskpro-board__select').click();
    eq(await host.locator('.taskpro-table__row.is-selected').count(), 2, 'multiple selection preserved');
    if (width === 724) await host.screenshot({ path: `/data/taskpro-table-selection-${lang}.png` });
    await host.locator('.taskpro-selection__btn.is-clear').click();
    eq(await square.isVisible(), false, 'clearing removes selection control');
    eq(await completion.isVisible(), true, 'completion restored');
    eq(await completion.getAttribute('data-status'), status, 'status unchanged');
    await host.locator('.taskpro-board__body').focus();
    await page.keyboard.press('Home');
    await page.keyboard.press('KeyX');
    eq(await host.locator('.taskpro-table__row.is-selected').count(), 1, 'keyboard entry retained');
    await page.keyboard.press('Escape');
    eq(await host.locator('.taskpro-selection').count(), 0, 'keyboard exit retained');
    eq(errors, [], 'no page errors');
    await page.close();
  }
} finally { await browser.close(); }
console.log(`table selection UI: ${checks} checks passed`);
