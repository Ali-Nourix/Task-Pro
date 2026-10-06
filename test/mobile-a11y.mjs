/**
 * Accessibility of the phone layout, swept over every screen of it: each
 * interactive element has a name a screen reader can say, is big enough to hit,
 * shows where the keyboard is, and a sheet shuts the board behind it away.
 * It reads the page the way a checker would, so it needs no screen reader.
 *
 *   node test/harness/build.mjs && node test/mobile-a11y.mjs
 */
import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import path from 'path';

const here = path.dirname(fileURLToPath(import.meta.url));
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
let checked = 0;
const problems = [];

const INTERACTIVE =
  'button, input, select, textarea, a[href], [role="button"], [role="tab"], [role="checkbox"], [role="menuitem"], [role="menuitemcheckbox"], [role="gridcell"], [tabindex]:not([tabindex="-1"])';

async function open(query = '', hour = 15) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  const page = await context.newPage();
  const now = new Date();
  now.setHours(hour, 0, 0, 0);
  await page.clock.setFixedTime(now);
  page.errors = [];
  page.on('pageerror', (error) => page.errors.push(error.message));
  await page.goto(`file://${path.join(here, 'board-preview.html')}?mobile=1&scope=vault${query}`);
  await page.waitForSelector('body[data-ready="true"]');
  await page.waitForTimeout(200);
  return page;
}

/** What a screen reader would call an element. */
const NAME_OF = `
  (el) => {
    const text = (node) => (node?.textContent ?? '').replace(/\\s+/g, ' ').trim();
    const labelled = el.getAttribute('aria-labelledby');
    if (labelled) return labelled.split(/\\s+/).map((id) => text(document.getElementById(id))).join(' ').trim();
    return (
      el.getAttribute('aria-label') ||
      (el.tagName === 'INPUT' ? el.getAttribute('placeholder') : '') ||
      text(el) ||
      el.getAttribute('title') ||
      ''
    ).trim();
  }`;

async function sweep(page, screen, { minimum = 24, tolerated = ['taskpro-cal__block'] } = {}) {
  const found = await page.evaluate(
    ({ INTERACTIVE, NAME_OF }) => {
      const nameOf = eval(NAME_OF);
      const board = document.querySelector('.taskpro-board');
      const out = [];
      for (const el of board.querySelectorAll(INTERACTIVE)) {
        if (el.closest('[inert]') || el.closest('[aria-hidden="true"]')) continue;
        const box = el.getBoundingClientRect();
        if (box.width === 0 || box.height === 0) continue;
        const style = getComputedStyle(el);
        if (style.visibility === 'hidden' || style.display === 'none') continue;
        // Past the screen's edge (a row scrolled away, a tab out of view): not a target now.
        if (box.bottom < 0 || box.top > innerHeight || box.right < 0 || box.left > innerWidth) continue;
        out.push({
          where: `${el.tagName.toLowerCase()}.${String(el.className).split(/\\s+/).filter(Boolean).slice(0, 2).join('.')}`,
          name: nameOf(el),
          width: Math.round(box.width),
          height: Math.round(box.height),
          // A box drawn smaller than its target, with a bigger touch area made around it.
          hit: (() => {
            const grown = ['::before', '::after'].map((pseudo) => getComputedStyle(el, pseudo)).find((s) => s.position === 'absolute' && s.content !== 'none');
            return grown ? { width: parseFloat(grown.width), height: parseFloat(grown.height) } : null;
          })(),
          role: el.getAttribute('role'),
        });
      }
      return out;
    },
    { INTERACTIVE, NAME_OF }
  );
  checked++;
  for (const item of found) {
    checked++;
    if (!item.name) problems.push(`${screen}: ${item.where} has no name`);
    const width = Math.max(item.width, item.hit?.width ?? 0);
    const height = Math.max(item.height, item.hit?.height ?? 0);
    if (Math.min(width, height) < minimum && !tolerated.some((selector) => item.where.includes(selector))) {
      problems.push(`${screen}: ${item.where} “${item.name.slice(0, 24)}” is ${item.width}×${item.height}, under ${minimum}`);
    }
  }
  return found;
}

/** Whether each focusable thing shows where the keyboard is: an outline or a ring. */
async function sweepFocus(page, screen) {
  await page.keyboard.press('Tab');
  const missing = await page.evaluate(
    async ({ INTERACTIVE }) => {
      const board = document.querySelector('.taskpro-board');
      const bad = [];
      const pause = (ms) => new Promise((done) => setTimeout(done, ms));
      for (const el of board.querySelectorAll(INTERACTIVE)) {
        if (el.closest('[inert]') || el.getClientRects().length === 0) continue;
        if (el.tabIndex < 0 && !el.matches('button, input')) continue;
        // The page's own scroller takes focus to take the keys; it is not a control.
        if (el.matches('.taskpro-board__body')) continue;
        el.focus({ preventScroll: true });
        if (document.activeElement !== el) continue;
        await pause(40);
        const style = getComputedStyle(el);
        // The browser's own ring ("auto"), a drawn outline, or a ring made with a shadow.
        const outlined = style.outlineStyle === 'auto' || (style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0);
        const ringed = style.boxShadow && style.boxShadow !== 'none';
        // A row whose focus is drawn on its cursor.
        const inner = el.matches('.taskpro-list__main') || !!el.closest('.has-cursor');
        if (!outlined && !ringed && !inner) bad.push(`${el.tagName.toLowerCase()}.${String(el.className).split(/\s+/).filter(Boolean).slice(0, 2).join('.')}`);
      }
      return [...new Set(bad)];
    },
    { INTERACTIVE }
  );
  checked++;
  for (const where of missing) problems.push(`${screen}: ${where} shows no focus`);
}

async function sheetIsModal(page, screen) {
  const state = await page.evaluate(() => {
    const board = document.querySelector('.taskpro-board');
    const sheet = board.querySelector(':scope > .is-sheet');
    if (!sheet) return { sheet: false };
    const behind = ['.taskpro-board__header', '.taskpro-board__body', '.taskpro-tabbar'].map((selector) => board.querySelector(`:scope > ${selector}`));
    return {
      sheet: true,
      dialog: sheet.getAttribute('role'),
      modal: sheet.getAttribute('aria-modal'),
      named: !!(sheet.getAttribute('aria-label') || sheet.getAttribute('aria-labelledby')),
      inert: behind.filter(Boolean).every((el) => el.hasAttribute('inert')),
    };
  });
  checked++;
  if (!state.sheet) problems.push(`${screen}: no sheet is open`);
  else {
    if (state.modal !== 'true') problems.push(`${screen}: the sheet is not aria-modal`);
    if (!state.named) problems.push(`${screen}: the sheet has no name`);
    if (!state.inert) problems.push(`${screen}: the board behind the sheet is not inert`);
    if (!['dialog', 'menu'].includes(state.dialog)) problems.push(`${screen}: the sheet has no dialog or menu role`);
  }
}

try {
  // ── The list ───────────────────────────────────────────────────────────
  let page = await open();
  eq(await page.locator('.taskpro-board').getAttribute('lang'), 'en', 'the board says its language');
  await sweep(page, 'list');
  await sweepFocus(page, 'list');
  const tabs = await page.evaluate(() => {
    const list = document.querySelector('.taskpro-tabbar [role="tablist"]');
    const all = [...list.querySelectorAll('[role="tab"]')];
    return {
      selected: all.filter((tab) => tab.getAttribute('aria-selected') === 'true').length,
      stops: all.filter((tab) => tab.tabIndex === 0).length,
      named: !!list.getAttribute('aria-label'),
    };
  });
  checked++;
  if (tabs.selected !== 1 || tabs.stops !== 1 || !tabs.named) problems.push(`the tab bar: ${JSON.stringify(tabs)}`);
  // A checkbox is named for its task, and says whether it is ticked.
  const check = await page.evaluate(() => {
    const row = [...document.querySelectorAll('.taskpro-list__row')].find((r) => r.textContent.includes('Groceries'));
    const box = row.querySelector('.taskpro-board__check');
    return [box.getAttribute('role'), box.getAttribute('aria-label'), box.getAttribute('aria-checked')];
  });
  eq(check, ['checkbox', 'Groceries', 'false'], 'a checkbox is named for its task');
  const ids = await page.evaluate(() => {
    const seen = new Map();
    for (const el of document.querySelectorAll('[id]')) seen.set(el.id, (seen.get(el.id) ?? 0) + 1);
    return [...seen].filter(([, count]) => count > 1).map(([id]) => id);
  });
  eq(ids, [], 'no id is used twice');
  eq(page.errors, [], 'no page errors');

  // Sheets shut the board behind them away.
  await page.tap('.taskpro-list__row:has-text("Groceries") .taskpro-list__title');
  await sheetIsModal(page, 'task sheet');
  await sweep(page, 'task sheet', { minimum: 24 });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  eq(await page.evaluate(() => document.querySelectorAll('.taskpro-board [inert]').length), 0, 'closed, nothing stays inert');
  await page.tap('.taskpro-board__more');
  await sheetIsModal(page, 'more sheet');
  await sweep(page, 'more sheet');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  await page.tap('.taskpro-board__properties');
  await sheetIsModal(page, 'view options');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  // Quick add.
  await page.tap('.taskpro-board__fab');
  await page.waitForTimeout(200);
  await sheetIsModal(page, 'quick add');
  await page.locator('.taskpro-qa__input').fill('Call Sara tomorrow 9 #work !high');
  await sweep(page, 'quick add');
  await sweepFocus(page, 'quick add');
  await page.tap('.taskpro-qa__tool:has-text("Date")');
  await sweep(page, 'quick add dates');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  // The line at the foot.
  await page.tap('.taskpro-list__row:has-text("Pick the display typeface") .taskpro-board__check');
  await page.waitForTimeout(150);
  await sweep(page, 'snackbar');
  eq(page.errors, [], 'no page errors in the sheets');
  await page.context().close();

  // ── The other layouts ──────────────────────────────────────────────────
  for (const [name, query] of [
    ['board', '&layout=board'],
    ['month', '&layout=calendar&cal=month'],
    ['week', '&layout=calendar&cal=week'],
    ['day', '&layout=calendar&cal=day'],
    ['agenda', '&layout=calendar&cal=agenda'],
    ['timeline', '&layout=timeline'],
    ['list in Persian', '&lang=fa'],
    ['month in Persian', '&layout=calendar&cal=month&lang=fa'],
  ]) {
    page = await open(query);
    await sweep(page, name);
    await sweepFocus(page, name);
    eq(page.errors, [], `no page errors on ${name}`);
    await page.context().close();
  }
  page = await open('&lang=fa');
  eq(await page.locator('.taskpro-board').getAttribute('lang'), 'fa', 'Persian says so');
  await page.context().close();
} finally {
  await browser.close();
}

function eq(actual, expected, label) {
  checked++;
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) problems.push(`${label}: got ${a}, expected ${e}`);
}

if (problems.length) {
  const unique = [...new Set(problems)];
  console.error(unique.join('\n'));
  console.error(`\n${unique.length} accessibility problems`);
  process.exit(1);
}
console.log(`MOBILE_A11Y_OK (${checked} checks)`);
