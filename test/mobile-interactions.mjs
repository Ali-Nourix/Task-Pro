/**
 * The board on a phone: a 390×844 touch screen, driven with real touch
 * events (taps, swipes, long presses, a held card carried to a column) in
 * the preview harness, in English and in Persian.
 *
 *   node test/harness/build.mjs && node test/mobile-interactions.mjs
 */
import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import path from 'path';

const here = path.dirname(fileURLToPath(import.meta.url));
let checked = 0;
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });

function eq(actual, expected, label) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${label}:\n  got      ${a}\n  expected ${e}`);
  checked++;
}

/**
 * Every page in these tests believes it is 15:00 today unless it is told
 * otherwise. The calendar opens on the hours around the current time and
 * draws a line at it, so a test that takes its coordinates from the screen
 * would otherwise behave differently in the morning and at night.
 */
async function setClock(page, hour) {
  const now = new Date();
  now.setHours(hour, 0, 0, 0);
  await page.clock.setFixedTime(now);
}

async function open(query = '', hour = 15) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  const page = await context.newPage();
  await setClock(page, hour);
  page.errors = [];
  page.on('pageerror', (error) => page.errors.push(error.message));
  await page.goto(`file://${path.join(here, 'board-preview.html')}?mobile=1&scope=vault${query}`);
  await page.waitForSelector('body[data-ready="true"]');
  await page.waitForTimeout(150);
  const cdp = await context.newCDPSession(page);
  const touch = (type, x, y) =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: Math.round(x), y: Math.round(y) }] });
  /** A finger from one point to another, optionally resting first. */
  page.gesture = async (from, to, { hold = 0, steps = 12 } = {}) => {
    await touch('touchStart', from.x, from.y);
    if (hold) await page.waitForTimeout(hold);
    for (let i = 1; i <= steps; i++) {
      await touch('touchMove', from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps);
      await page.waitForTimeout(12);
    }
    await touch('touchEnd');
    await page.waitForTimeout(120);
  };
  page.longPress = async (at, ms = 650) => {
    await touch('touchStart', at.x, at.y);
    await page.waitForTimeout(ms);
    await touch('touchEnd');
    await page.waitForTimeout(150);
  };
  return page;
}

const center = async (locator) => {
  const box = await locator.boundingBox();
  return { x: box.x + box.width / 2, y: box.y + box.height / 2, box };
};
const note = (page, path) => page.evaluate((p) => window.__notes[p], path);
const listRow = (page, title) => page.locator('.taskpro-list__row').filter({ has: page.locator('.taskpro-list__title', { hasText: title }) });

try {
  // ── The table as a list ────────────────────────────────────────────────
  let page = await open();
  eq(await page.locator('.taskpro-board.is-compact.is-touch').count(), 1, 'the phone layout, on a touch screen');
  eq(await page.locator('.taskpro-list__row').count(), 12, 'every task is a row of the list');
  eq(await page.locator('.taskpro-table').count(), 0, 'no table');
  eq(await page.locator('.taskpro-board__fab').isVisible(), true, 'a + button in thumb reach');
  const fab = await page.locator('.taskpro-board__fab').boundingBox();
  eq(fab.y + fab.height > 844 - 100 && fab.x + fab.width > 390 - 100, true, 'at the bottom, on the trailing side');
  eq(fab.width >= 44 && fab.height >= 44, true, 'at least 44 by 44');
  for (const selector of ['.taskpro-board__bar-btn.is-layout', '.taskpro-board__bar-btn.is-filter', '.taskpro-board__properties', '.taskpro-list__more-btn']) {
    const box = await page.locator(selector).first().boundingBox();
    eq(box.width >= 40 && box.height >= 40, true, `${selector} fits a finger`);
  }
  eq(await listRow(page, 'Send the quote to Acme').locator('.taskpro-list__prop.is-plan .taskpro-chip__label').textContent(), 'Today, 14:00 – 15:30', 'a row shows its plan with the hours');

  // A tap opens the task's sheet; a submenu is its next page; back returns.
  await page.tap('.taskpro-list__row:has-text("Accessibility pass") .taskpro-list__title');
  eq(await page.locator('.taskpro-menu.is-sheet .taskpro-sheet-grabber').count(), 1, 'the task menu, as a sheet with a handle');
  eq(await page.locator('.taskpro-sheet-backdrop').count(), 1, 'what is behind it is dimmed');
  const itemBox = await page.locator('.taskpro-menu__item', { hasText: 'Priority' }).boundingBox();
  eq(itemBox.height >= 44, true, 'sheet rows are at least 44 high');
  await page.tap('.taskpro-menu__item:has-text("Priority")');
  eq(await page.locator('.taskpro-menu__page-title').textContent(), 'Priority', 'a submenu opens as a page');
  eq(await page.locator('.taskpro-menu.is-submenu').count(), 0, 'not beside its row');
  await page.tap('.taskpro-menu__back');
  eq(await page.locator('.taskpro-menu.is-paged').count(), 0, 'back to the first page');
  await page.tap('.taskpro-menu__item:has-text("Priority")');
  await page.locator('.taskpro-menu__item').filter({ hasText: /^\s*High$/ }).tap();
  await page.waitForTimeout(80);
  eq((await note(page, 'Projects/Website redesign.md')).split('\n').find((l) => l.includes('Accessibility pass')).includes('@priority(high)'), true, 'chosen from the page');
  eq(await page.locator('.taskpro-menu').count(), 0, 'and the sheet closes');

  // Moving a task: the notes to move to come as a sheet of their own, with a search field.
  await page.tap('.taskpro-list__row:has-text("Accessibility pass") .taskpro-list__title');
  await page.tap('.taskpro-menu__item:has-text("Move to note")');
  eq(await page.locator('.taskpro-menu.is-sheet .taskpro-menu__header').textContent(), 'Move to note', 'the notes to move to, as a sheet');
  const noteRow = await page.locator('.taskpro-menu__item', { hasText: 'Inbox' }).boundingBox();
  eq(noteRow.height >= 44, true, 'note rows are at least 44 high');
  await page.locator('.taskpro-menu__search').fill('some');
  await page.tap('.taskpro-menu__item:has-text("Someday")');
  await page.waitForTimeout(120);
  eq((await note(page, 'Projects/Someday.md')).includes('Accessibility pass'), true, 'a tap on a note moves the task there');
  eq(await page.locator('.taskpro-menu').count(), 0, 'and the sheet closes');

  // The card opens from the first row of the sheet, and is a sheet of its own.
  await page.tap('.taskpro-list__row:has-text("Weekly review and planning") .taskpro-list__title');
  eq((await page.locator('.taskpro-menu__item').first().textContent()).trim(), 'Open card', 'the sheet begins with the card');
  await page.tap('.taskpro-menu__item:has-text("Open card")');
  await page.waitForTimeout(250);
  eq(await page.locator('.taskpro-cal-inspector.is-sheet').count(), 1, 'the card rises from the bottom');
  eq(await page.locator('.taskpro-cal-inspector__title').textContent(), 'Weekly review and planning', 'for that task');
  await page.tap('.taskpro-sheet-backdrop', { position: { x: 20, y: 20 } });
  await page.waitForTimeout(300);
  eq(await page.locator('.taskpro-cal-inspector').count(), 0, 'and goes with a tap outside it');

  // Selecting several: Select in the sheet starts it, taps pick the rest, and a bar of icons carries the changes.
  await page.tap('.taskpro-list__row:has-text("Dentist appointment") .taskpro-list__title');
  await page.tap('.taskpro-menu__item:has-text("Select")');
  await page.waitForTimeout(150);
  eq(await page.locator('.taskpro-list__row.is-selected').count(), 1, 'Select picks the task');
  eq(await page.locator('.taskpro-selection').count(), 1, 'and a bar rises');
  eq(await page.locator('.taskpro-selection__label').count(), 0, 'with icons and no words, on a phone');
  const barButton = await page.locator('.taskpro-selection__btn').nth(1).boundingBox();
  eq(barButton.width >= 40 && barButton.height >= 40, true, 'each at least 40 by 40');
  eq(await page.locator('.taskpro-board__fab').isVisible(), false, 'the + steps aside for it');
  await page.tap('.taskpro-list__row:has-text("Accessibility pass") .taskpro-list__title');
  await page.waitForTimeout(100);
  eq(await page.locator('.taskpro-list__row.is-selected').count(), 2, 'a tap on another task picks it, and does not open its sheet');
  eq(await page.locator('.taskpro-menu').count(), 0, 'no sheet');
  await page.tap('.taskpro-selection__btn.is-clear');
  eq(await page.locator('.taskpro-selection').count(), 0, 'the ✕ puts the bar away');
  eq(await page.locator('.taskpro-board__fab').isVisible(), true, 'and the + comes back');

  // Dragging the handle down puts a sheet away.
  await page.tap('.taskpro-list__row:has-text("Groceries") .taskpro-list__title');
  const grabber = await center(page.locator('.taskpro-sheet-grabber'));
  await page.gesture(grabber, { x: grabber.x, y: grabber.y + 220 }, { steps: 8 });
  eq(await page.locator('.taskpro-menu').count(), 0, 'dragged down, the sheet closes');
  await page.waitForTimeout(300);

  // Swipe toward the trailing side to tick a task off, the other way for its sheet.
  const groceries = await center(listRow(page, 'Groceries').locator('.taskpro-list__content'));
  await page.gesture({ x: 60, y: groceries.y }, { x: 260, y: groceries.y });
  eq((await note(page, 'Life/Home.md')).startsWith('- [x] Groceries'), true, 'a swipe to the end ticks it off');
  const dentist = await center(listRow(page, 'Dentist appointment').locator('.taskpro-list__content'));
  await page.gesture({ x: 320, y: dentist.y }, { x: 100, y: dentist.y });
  eq(await page.locator('.taskpro-menu.is-sheet .taskpro-menu__header').textContent(), 'Dentist appointment', 'the other way opens its sheet');
  await page.tap('.taskpro-sheet-backdrop', { position: { x: 20, y: 20 } });
  await page.waitForTimeout(300);
  // A vertical move scrolls, and does nothing to the row.
  const before = await note(page, 'Life/Home.md');
  await page.gesture({ x: 200, y: 600 }, { x: 205, y: 300 });
  eq(await note(page, 'Life/Home.md'), before, 'scrolling is not a swipe');

  // A long press is the right click.
  await page.longPress(await center(listRow(page, 'Chase the missing invoice').locator('.taskpro-list__title')));
  eq(await page.locator('.taskpro-menu.is-sheet .taskpro-menu__header').textContent(), 'Chase the missing invoice', 'a long press opens the menu');
  await page.tap('.taskpro-sheet-backdrop', { position: { x: 20, y: 20 } });
  await page.waitForTimeout(300);

  // The + adds a task from a sheet.
  await page.tap('.taskpro-board__fab');
  await page.locator('.taskpro-add-sheet__input').fill('Call the plumber');
  await page.tap('.taskpro-add-sheet__add');
  await page.waitForTimeout(80);
  eq((await note(page, 'Inbox.md')).trim(), '- [ ] Call the plumber', 'added from the sheet');
  await page.tap('.taskpro-sheet-backdrop', { position: { x: 20, y: 20 } });
  await page.waitForTimeout(300);

  // Filters as switches that stay open.
  await page.tap('.taskpro-board__bar-btn.is-filter');
  await page.tap('.taskpro-menu__item:has-text("Client")');
  await page.tap('.taskpro-menu__item:has-text("Health")');
  eq(await page.locator('.taskpro-menu').count(), 1, 'the filter sheet stays open for the next switch');
  eq(await page.locator('.taskpro-list__row').count(), 3, 'both tags applied');
  await page.tap('.taskpro-sheet-backdrop', { position: { x: 20, y: 20 } });
  await page.waitForTimeout(300);
  eq(await page.locator('.taskpro-board__bar-count').textContent(), '2', 'the filter button counts them');
  eq(page.errors, [], 'no page errors in the list');
  await page.context().close();

  // ── View options, the full table, and the board ────────────────────────
  page = await open();
  await page.tap('.taskpro-board__properties');
  await page.tap('.taskpro-menu__item:has-text("Table style")');
  await page.tap('.taskpro-menu__item:has-text("Full table")');
  await page.tap('.taskpro-sheet-backdrop', { position: { x: 20, y: 20 } });
  await page.waitForTimeout(300);
  eq(await page.locator('.taskpro-table').count(), 1, 'the full table, when asked for');
  eq(await page.locator('.taskpro-table th.taskpro-table__task').evaluate((el) => getComputedStyle(el).position), 'sticky', 'its title column stays in view');
  await page.tap('.taskpro-board__bar-btn.is-layout');
  await page.tap('.taskpro-menu__item:has-text("Board")');
  await page.waitForTimeout(150);
  eq(await page.locator('.taskpro-kanban-tabs__tab').count(), 4, 'a tab for each column');
  const column = await page.locator('.taskpro-kanban__column').first().boundingBox();
  eq(column.width > 300 && column.width < 360, true, 'a column fills most of the screen');
  await page.locator('.taskpro-kanban-tabs__tab[data-group="[x]"]').tap();
  await page.waitForTimeout(700);
  eq(await page.locator('.taskpro-kanban-tabs__tab.is-active').getAttribute('data-group'), '[x]', 'a tab scrolls to its column');

  // A held card is carried to another column.
  await page.locator('.taskpro-kanban-tabs__tab[data-group="[ ]"]').tap();
  await page.waitForTimeout(700);
  const card = await center(page.locator('.taskpro-card', { hasText: 'Dentist appointment' }).locator('.taskpro-card__props'));
  await page.gesture({ x: card.x, y: card.y }, { x: 372, y: card.y }, { hold: 600, steps: 16 });
  eq((await note(page, 'Life/Home.md')).split('\n')[1].startsWith('- [/] Dentist'), true, 'a card carried to the next column takes its status');
  // A quick swipe across a card scrolls the board instead.
  const scrolled = await page.locator('.taskpro-board__body').evaluate((el) => el.scrollLeft);
  eq(await page.locator('.taskpro-menu').count(), 0, 'carrying a card does not open its menu too');
  await page.gesture({ x: 300, y: 520 }, { x: 60, y: 520 }, { steps: 10 });
  await page.waitForTimeout(500);
  eq((await page.locator('.taskpro-board__body').evaluate((el) => el.scrollLeft)) !== scrolled, true, 'a swipe scrolls between columns');
  eq(page.errors, [], 'no page errors on the board');
  await page.context().close();

  // ── The calendar ───────────────────────────────────────────────────────
  page = await open('&layout=calendar&cal=month');
  eq(await page.locator('.taskpro-cal__month.is-dots').count(), 1, 'the month as dots');
  eq(await page.locator('.taskpro-cal__day-list .taskpro-cal__agenda-item').count() > 0, true, "today's tasks listed below it");
  await page.tap('.taskpro-cal__cell[data-day] >> nth=10');
  await page.waitForTimeout(100);
  eq(await page.locator('.taskpro-cal__cell.is-selected').count(), 1, 'a tapped day is chosen');
  await page.tap('.taskpro-cal-nav__free');
  eq(await page.locator('.taskpro-cal-popover.is-sheet .taskpro-cal__sidebar').isVisible(), true, 'the unscheduled tasks, as a sheet');
  await page.tap('.taskpro-sheet-backdrop', { position: { x: 20, y: 20 } });
  await page.waitForTimeout(300);
  await page.tap('.taskpro-cal-nav__views .taskpro-segmented__item:has-text("Week")');
  await page.waitForTimeout(150);
  const days = await page.locator('.taskpro-cal__col').evaluateAll((cols) => cols.filter((c) => {
    const r = c.getBoundingClientRect();
    return r.left >= 0 && r.right <= 391;
  }).length);
  eq(days, 3, 'three days to a screen');
  eq(await page.locator('.taskpro-cal__col.is-today').evaluate((c) => {
    const r = c.getBoundingClientRect();
    return r.left >= 0 && r.right <= 391;
  }), true, 'today in view');
  eq(await page.locator('.taskpro-cal__sticky').evaluate((el) => el.getBoundingClientRect().width >= el.parentElement.querySelector('.taskpro-cal__grid').getBoundingClientRect().width - 1), true, 'the header as wide as the days under it');
  // Hold a block, then drag it down an hour.
  const block = await center(page.locator('.taskpro-cal__block', { hasText: 'Auto layout' }));
  await page.gesture({ x: block.x, y: block.y }, { x: block.x, y: block.y + 48 }, { hold: 600, steps: 10 });
  eq((await note(page, 'Projects/Figma.md')).includes('17:00-18:30'), true, 'a held block moves');
  // Late in the evening the grid opens scrolled to the bottom and the day's
  // first block sits against the header. A finger that picks it up there and
  // moves away must carry it exactly as far as it moved: the grid waits for a
  // drag to rest at its edge before it scrolls.
  await page.context().close();
  page = await open('&layout=calendar&cal=week', 22);
  const early = await center(page.locator('.taskpro-cal__block', { hasText: 'Auto layout' }));
  const scrolledBefore = await page.locator('.taskpro-cal__scroller').evaluate((el) => el.scrollTop);
  await page.gesture({ x: early.x, y: early.y }, { x: early.x, y: early.y + 48 }, { hold: 600, steps: 10 });
  eq((await note(page, 'Projects/Figma.md')).includes('17:00-18:30'), true, 'a block held against the header moves an hour, not less');
  eq(await page.locator('.taskpro-cal__scroller').evaluate((el) => el.scrollTop), scrolledBefore, 'and the grid stayed where it was');
  // A tap on a block opens its card as a sheet.
  await page.tap('.taskpro-cal__block:has-text("Prototyping")');
  eq(await page.locator('.taskpro-cal-inspector.is-sheet, .taskpro-cal-popover.is-sheet').count(), 1, 'its card rises from the bottom');
  eq(page.errors, [], 'no page errors on the calendar');
  await page.context().close();

  // Persian: the week starts on Saturday, and opens on today, first on the right.
  page = await open('&layout=calendar&cal=week&lang=fa');
  const placed = await page.evaluate(() => {
    const scroller = document.querySelector('.taskpro-cal__scroller');
    const cols = [...document.querySelectorAll('.taskpro-cal__col')];
    const index = cols.findIndex((c) => c.classList.contains('is-today'));
    const edge = scroller.getBoundingClientRect().right - document.querySelector('.taskpro-cal__hours').offsetWidth;
    return { index, count: cols.length, off: Math.round(cols[index].getBoundingClientRect().right - edge) };
  });
  // Near the week's end there are not three days left to show from it.
  eq(placed.index > placed.count - 3 || Math.abs(placed.off) <= 1, true, 'RTL: the week opens with today first');
  // Scrolled across, the header still hides what passes under it.
  const covered = await page.evaluate(() => {
    const box = document.querySelector('.taskpro-cal__sticky').getBoundingClientRect();
    return [...document.querySelectorAll('.taskpro-cal__col-head')].every((head) => {
      const r = head.getBoundingClientRect();
      return r.left >= box.left - 1 && r.right <= box.right + 1;
    });
  });
  eq(covered, true, 'RTL: the header covers the week scrolled across');
  eq(page.errors, [], 'no page errors on the Persian week');
  await page.context().close();

  // ── The timeline, in Persian ───────────────────────────────────────────
  page = await open('&layout=timeline&lang=fa');
  eq(await page.locator('.taskpro-tl__row').first().evaluate((el) => el.getBoundingClientRect().height), 44, 'rows a finger can hit');
  eq(await page.locator('.taskpro-tl__today').isVisible(), true, 'today in view');
  const bar = await center(page.locator('.taskpro-tl__row').filter({ has: page.locator('.taskpro-tl__title', { hasText: 'گزارش ماهانه' }) }).locator('.taskpro-tl__bar'));
  await page.gesture({ x: bar.x, y: bar.y }, { x: bar.x - 80, y: bar.y }, { hold: 600, steps: 10 });
  eq((await note(page, 'Planner/Focus.md')).split('\n').find((l) => l.includes('گزارش ماهانه')).includes('14:00-16:00'), true, 'a held bar moves, keeping its time');
  const leftBefore = await page.locator('.taskpro-tl').evaluate((el) => el.scrollLeft);
  const lane = await center(page.locator('.taskpro-tl__lane').nth(1));
  await page.gesture({ x: 80, y: lane.y }, { x: 230, y: lane.y }, { steps: 8 });
  eq((await page.locator('.taskpro-tl').evaluate((el) => el.scrollLeft)) !== leftBefore, true, 'a swipe scrolls the chart');

  // ── The list in Persian: the swipe is mirrored ─────────────────────────
  // A tap while the chart still glides only stops it, as on any phone.
  await page.waitForTimeout(1200);
  await page.tap('.taskpro-board__bar-btn.is-layout');
  await page.tap('.taskpro-menu__item:has-text("جدول")');
  await page.waitForTimeout(150);
  const faRow = await center(page.locator('.taskpro-list__row').filter({ has: page.locator('.taskpro-list__title', { hasText: 'خرید هفتگی' }) }).locator('.taskpro-list__content'));
  await page.gesture({ x: 330, y: faRow.y }, { x: 120, y: faRow.y });
  eq((await note(page, 'Life/Home.md')).startsWith('- [x] خرید هفتگی'), true, 'RTL: a swipe toward the left ticks it off');
  eq(page.errors, [], 'no page errors in Persian');
  await page.context().close();
} finally {
  await browser.close();
}

console.log(`MOBILE_INTERACTIONS_OK (${checked} checks)`);
