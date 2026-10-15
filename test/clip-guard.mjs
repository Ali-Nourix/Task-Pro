/**
 * Finds any ring that an ancestor cuts off.
 *
 * A focus ring, the ring that marks a hovered task's family, a drop target's
 * outline: each is drawn outside its element's box, so a list or a scroller
 * that clips (`overflow` other than visible) cuts it wherever the element
 * touches the list's edge. That is what made a lit chip in a month cell lose
 * its sides. The board leaves each such container a halo of room, or draws
 * the ring inside; this test is what keeps that true.
 *
 * It walks the views, puts the board in the states that draw rings (a hovered
 * family, the keyboard on every control in turn), and for each element that
 * shows a hard ring, checks the ring against every clipping ancestor.
 *
 *   node test/clip-guard.mjs
 */
import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import path from 'path';
import { buildHarness } from './harness/build.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
await buildHarness();

const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
let checked = 0;
let states = 0;
const failures = [];

/** In the page: every element showing a hard ring, and where an ancestor cuts it. */
function findCuts() {
  const EDGE = 0.75;
  const name = (el) => {
    const parts = [];
    for (let node = el; node && node.nodeType === 1 && parts.length < 3; node = node.parentElement) {
      const cls = [...node.classList].filter((c) => c.startsWith('taskpro-')).slice(0, 2).join('.');
      parts.push(node.tagName.toLowerCase() + (cls ? '.' + cls : ''));
    }
    return parts.join(' < ');
  };
  /** How far the element's hard rings reach past each side of its border box. */
  const reach = (el) => {
    const cs = getComputedStyle(el);
    const out = { left: 0, right: 0, top: 0, bottom: 0 };
    const grow = (l, r, t, b) => {
      out.left = Math.max(out.left, l);
      out.right = Math.max(out.right, r);
      out.top = Math.max(out.top, t);
      out.bottom = Math.max(out.bottom, b);
    };
    if (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) {
      const w = parseFloat(cs.outlineWidth) + parseFloat(cs.outlineOffset || '0');
      grow(w, w, w, w);
    }
    const shadow = cs.boxShadow;
    if (shadow && shadow !== 'none') {
      let depth = 0;
      let start = 0;
      const layers = [];
      for (let i = 0; i < shadow.length; i++) {
        if (shadow[i] === '(') depth++;
        else if (shadow[i] === ')') depth--;
        else if (shadow[i] === ',' && depth === 0) {
          layers.push(shadow.slice(start, i));
          start = i + 1;
        }
      }
      layers.push(shadow.slice(start));
      for (const layer of layers) {
        if (/\binset\b/.test(layer)) continue;
        const nums = layer.replace(/rgba?\([^)]*\)|color\([^)]*\)|oklab\([^)]*\)|hsla?\([^)]*\)|#[0-9a-f]+/gi, '').match(/-?\d*\.?\d+px/g);
        if (!nums || nums.length < 3) continue;
        const [x, y, blur, spread = 0] = nums.map(parseFloat);
        if (blur > 0) continue;
        grow(spread - x, spread + x, spread - y, spread + y);
      }
    }
    for (const side of Object.keys(out)) out[side] = Math.round(out[side] * 2) / 2;
    return out;
  };
  const clipsOf = (el) => {
    const found = [];
    for (let node = el.parentElement; node && node !== document.documentElement; node = node.parentElement) {
      const cs = getComputedStyle(node);
      const x = cs.overflowX !== 'visible';
      const y = cs.overflowY !== 'visible';
      if (!x && !y) continue;
      const r = node.getBoundingClientRect();
      const bl = parseFloat(cs.borderLeftWidth);
      const br = parseFloat(cs.borderRightWidth);
      const bt = parseFloat(cs.borderTopWidth);
      const bb = parseFloat(cs.borderBottomWidth);
      // What scrolling can still bring into view on each side: a ring is only
      // cut for good where the content itself ends.
      const rtl = cs.direction === 'rtl';
      const scrollX = node.scrollLeft;
      const spanX = node.scrollWidth - node.clientWidth;
      const spanY = node.scrollHeight - node.clientHeight;
      found.push({
        node,
        left: x ? r.left + bl : -Infinity,
        right: x ? r.right - br : Infinity,
        top: y ? r.top + bt : -Infinity,
        bottom: y ? r.bottom - bb : Infinity,
        more: {
          left: rtl ? spanX + scrollX : scrollX,
          right: rtl ? -scrollX : spanX - scrollX,
          top: node.scrollTop,
          bottom: spanY - node.scrollTop,
        },
      });
    }
    return found;
  };
  const cuts = [];
  const seen = new Set();
  for (const el of document.querySelectorAll('.taskpro-board *')) {
    const extent = reach(el);
    if (!extent.left && !extent.right && !extent.top && !extent.bottom) continue;
    const box = el.getBoundingClientRect();
    if (!box.width || !box.height) continue;
    // From the nearest clip outward. A scroller inside another that could still
    // scroll the element away from their shared edge gives the outer one room too.
    const carry = { left: 0, right: 0, top: 0, bottom: 0 };
    for (const clip of clipsOf(el)) {
      const slack = { ...carry };
      for (const side of Object.keys(carry)) carry[side] += clip.more[side];
      // An element the scroller has already cut is cut by scrolling, not by its ring.
      const inside = box.left >= clip.left - 0.5 && box.right <= clip.right + 0.5 && box.top >= clip.top - 0.5 && box.bottom <= clip.bottom + 0.5;
      if (!inside) continue;
      const room = {
        left: box.left - clip.left + clip.more.left + slack.left,
        right: clip.right - box.right + clip.more.right + slack.right,
        top: box.top - clip.top + clip.more.top + slack.top,
        bottom: clip.bottom - box.bottom + clip.more.bottom + slack.bottom,
      };
      const sides = Object.entries(room)
        .filter(([side, gap]) => Number.isFinite(gap) && gap < extent[side] - EDGE)
        .map(([side, gap]) => `${side} ${Math.round(gap)}px of ${extent[side]}px`);
      if (!sides.length) continue;
      const key = name(el) + '|' + name(clip.node);
      if (seen.has(key)) continue;
      seen.add(key);
      cuts.push(`${name(el)} is cut by ${name(clip.node)} (${sides.join(', ')})`);
    }
  }
  return cuts;
}

async function scan(page, label) {
  states++;
  const cuts = await page.evaluate(findCuts);
  checked++;
  // One line per view and per cut, however many states show the same one.
  const view = label.split(' · ')[0];
  for (const cut of cuts) failures.push(`${view}: ${cut.replace(/\d+\.\d+px of/g, (m) => m.replace(/\.\d+/, '')) }`);
}

async function open(query, width = 1280, height = 900, touch = false) {
  // Reduced motion, so a ring is there the moment it is asked for and no entrance is mid-flight.
  const context = await browser.newContext({ viewport: { width, height }, hasTouch: touch, reducedMotion: 'reduce' });
  const page = await context.newPage();
  const now = new Date();
  now.setHours(15, 0, 0, 0);
  await page.clock.setFixedTime(now);
  await page.goto(`file://${path.join(here, 'board-preview.html')}${query}`);
  await page.waitForSelector('body[data-ready="true"]');
  page.on('pageerror', (e) => failures.push(`page error: ${e.message}`));
  return page;
}

/** The keyboard on each control in turn: Tab draws the focus ring on whatever it reaches. */
async function tabThrough(page, label, limit = 90) {
  await page.evaluate(() => document.activeElement?.blur());
  for (let i = 0; i < limit; i++) {
    await page.keyboard.press('Tab');
    const done = await page.evaluate(() => !document.activeElement || document.activeElement === document.body || !document.activeElement.closest('.taskpro-board'));
    if (done) break;
    await scan(page, `${label} · focus ${i}`);
  }
}

/** Each member of a family lit in turn, by the pointer. */
async function hoverFamilies(page, label) {
  const items = page.locator('[data-family]');
  const count = Math.min(await items.count(), 24);
  for (let i = 0; i < count; i++) {
    const item = items.nth(i);
    if (!(await item.isVisible())) continue;
    await item.hover({ timeout: 2000 }).catch(() => {});
    await page.waitForTimeout(60);
    await scan(page, `${label} · family ${i}`);
  }
}

try {
  // Month: the case that was reported. Tall enough that a whole family shows.
  for (const [query, tag] of [
    ['?layout=calendar&cal=month&scope=vault', 'month'],
    ['?layout=calendar&cal=month&scope=vault&lang=fa', 'month fa'],
    ['?layout=calendar&cal=month&scope=vault&light', 'month light'],
  ]) {
    const page = await open(query, 1280, 1500);
    await hoverFamilies(page, tag);
    await tabThrough(page, tag);
    await page.close();
  }

  for (const [query, tag] of [
    ['?layout=calendar&cal=week&scope=vault', 'week'],
    ['?layout=calendar&cal=day&scope=vault', 'day'],
    ['?layout=calendar&cal=agenda&scope=vault', 'agenda'],
    ['?layout=calendar&cal=week&scope=vault&lang=fa', 'week fa'],
  ]) {
    const page = await open(query, 1280, 1000);
    await hoverFamilies(page, tag);
    await tabThrough(page, tag);
    await page.close();
  }

  for (const [query, tag] of [
    ['?scope=vault', 'table'],
    ['?scope=vault&lang=fa', 'table fa'],
    ['?scope=vault&group=none', 'nested table'],
    ['?scope=vault&group=none&density=compact', 'nested table compact'],
    ['?scope=vault&group=none&wrap=on&lang=fa', 'nested table wrapped fa'],
    ['?layout=board&scope=vault&density=compact', 'board compact'],
    ['?layout=board&scope=vault', 'board'],
    ['?layout=board&scope=vault&lang=fa', 'board fa'],
    ['?layout=timeline&scope=vault', 'timeline'],
    ['?layout=timeline&scope=vault&lang=fa', 'timeline fa'],
  ]) {
    const page = await open(query, 1400, 1000);
    await scan(page, tag);
    await tabThrough(page, tag, 120);
    await page.close();
  }

  // Panels that hold lists of their own: the tag picker and the tag manager.
  for (const [query, tag] of [
    ['?view=picker', 'tag picker'],
    ['?view=picker&query=Plan', 'tag picker (typing)'],
    ['?view=manager', 'tag manager'],
  ]) {
    const page = await open(query, 900, 800);
    await scan(page, tag);
    await tabThrough(page, tag, 40);
    await page.close();
  }

  // Menus and the calendar's card, open.
  {
    const page = await open('?scope=vault', 1400, 1000);
    await page.locator('.taskpro-table__row').nth(2).click({ button: 'right', position: { x: 300, y: 10 } });
    await page.waitForTimeout(250);
    await scan(page, 'task menu');
    await page.locator('.taskpro-menu__item', { hasText: 'Priority' }).first().hover();
    await page.waitForTimeout(350);
    await scan(page, 'task menu (submenu)');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await page.locator('.taskpro-table__row').nth(2).click({ button: 'right', position: { x: 300, y: 10 } });
    await page.locator('.taskpro-menu__item', { hasText: 'Move to note' }).click();
    await page.waitForTimeout(250);
    await scan(page, 'note picker');
    await page.keyboard.press('Escape');
    await page.locator('.taskpro-board__properties').click();
    await page.waitForTimeout(250);
    await scan(page, 'properties menu');
    await page.keyboard.press('Escape');
    await page.locator('.taskpro-board__views').click();
    await page.waitForTimeout(250);
    await scan(page, 'views menu');
    await page.keyboard.press('Escape');
    await page.locator('.taskpro-board__properties').click();
    await page.locator('.taskpro-menu__item', { hasText: 'Density' }).hover();
    await page.waitForTimeout(350);
    await scan(page, 'properties menu (density)');
    await page.close();
  }
  {
    const page = await open('?layout=calendar&cal=month&scope=vault', 1280, 1500);
    await page.locator('.taskpro-cal__chip').first().click();
    await page.waitForTimeout(350);
    await scan(page, 'month card');
    await tabThrough(page, 'month card', 30);
    await page.close();
  }

  // The card, lent to the table and the board.
  for (const [query, tag, show] of [
    ['?scope=vault&group=none', 'table card', async (page) => {
      const row = page.locator('.taskpro-table__row').nth(8);
      await row.hover({ position: { x: 100, y: 20 } });
      await row.locator('.taskpro-board__open.is-card').click();
    }],
    ['?layout=board&scope=vault', 'board card', async (page) => {
      const card = page.locator('.taskpro-card').nth(2);
      await card.hover();
      await card.locator('.taskpro-card__open').click();
    }],
  ]) {
    const page = await open(query, 1400, 1000);
    await show(page);
    await page.waitForTimeout(350);
    await scan(page, tag);
    await tabThrough(page, tag, 30);
    await page.close();
  }

  // The keyboard's cursor, on a table and on a board, at each edge.
  for (const [query, tag, keys] of [
    ['?scope=vault&group=none', 'table cursor', ['ArrowDown', 'ArrowDown', 'End', 'Home']],
    ['?layout=board&scope=vault', 'board cursor', ['ArrowDown', 'ArrowRight', 'ArrowRight', 'ArrowRight', 'ArrowDown', 'End', 'ArrowLeft', 'Home']],
    ['?layout=board&scope=vault&lang=fa', 'board cursor fa', ['ArrowDown', 'ArrowLeft', 'ArrowLeft', 'ArrowLeft', 'End', 'ArrowRight', 'Home']],
  ]) {
    const page = await open(query, 1400, 1000);
    await page.locator('.taskpro-board__body').focus();
    await scan(page, tag);
    for (const key of keys) {
      await page.keyboard.press(key);
      await scan(page, `${tag} · ${key}`);
    }
    await page.keyboard.press('Shift+Slash');
    await page.waitForTimeout(200);
    await scan(page, `${tag} · shortcuts`);
    await page.close();
  }

  // Tasks picked: the controls inside the check column, the tint, the rings on cards, the bar and its menus.
  for (const [query, tag, pick] of [
    ['?scope=vault&group=none', 'table selection', async (page) => {
      const rows = page.locator('.taskpro-table__row');
      await rows.nth(1).click({ button: 'right', position: { x: 150, y: 10 } });
      await page.locator('.taskpro-menu__item').filter({ hasText: /^\s*Select\s*$/ }).click();
      await rows.nth(2).locator('.taskpro-board__select').click({ force: true });
    }],
    ['?scope=vault&group=none&lang=fa', 'table selection fa', async (page) => {
      const rows = page.locator('.taskpro-table__row');
      await rows.nth(1).click({ button: 'right', position: { x: 150, y: 10 } });
      await page.locator('.taskpro-menu__item').filter({ hasText: /^\s*انتخاب\s*$/ }).click();
    }],
    ['?layout=board&scope=vault', 'board selection', async (page) => {
      const cards = page.locator('.taskpro-card');
      await cards.nth(0).hover();
      await cards.nth(0).locator('.taskpro-card__more').last().click();
      await page.locator('.taskpro-menu__item').filter({ hasText: /^\s*Select\s*$/ }).click();
      await cards.nth(6).locator('.taskpro-board__select').click({ force: true });
    }],
  ]) {
    const page = await open(query, 1400, 1000);
    await pick(page);
    await page.waitForTimeout(300);
    await scan(page, tag);
    await tabThrough(page, tag, 40);
    await page.locator('.taskpro-selection__btn', { hasText: /Status|وضعیت/ }).click();
    await page.waitForTimeout(300);
    await scan(page, `${tag} · status menu`);
    await page.close();
  }

  // The phone: a narrower pane, and a finger.
  for (const [query, tag] of [
    ['?mobile=1&scope=vault', 'phone list'],
    ['?mobile=1&layout=board&scope=vault', 'phone board'],
    ['?mobile=1&layout=calendar&cal=week&scope=vault', 'phone week'],
    ['?mobile=1&layout=calendar&cal=month&scope=vault', 'phone month'],
  ]) {
    const page = await open(query, 390, 844, true);
    await scan(page, tag);
    await page.close();
  }
} finally {
  await browser.close();
}

if (failures.length) {
  const unique = [...new Set(failures)];
  console.error(`CLIP_GUARD_FAILED — ${unique.length} ring(s) cut off:\n  ` + unique.slice(0, 60).join('\n  '));
  process.exit(1);
}
console.log(`CLIP_GUARD_OK (${states} states scanned)`);
