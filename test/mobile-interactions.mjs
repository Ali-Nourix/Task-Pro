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

/** Text without the marks that keep a name's direction apart from the words around it. */
const plain = (text) => text.replace(/[\u2066-\u2069\u200e\u200f]/g, '').trim();
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
  const tabbar = await page.locator('.taskpro-tabbar').boundingBox();
  eq(fab.y + fab.height <= tabbar.y && fab.x + fab.width > 390 - 100, true, 'above the tab bar, on the trailing side');
  eq(fab.width >= 44 && fab.height >= 44, true, 'at least 44 by 44');
  eq(Math.round(tabbar.y + tabbar.height), 844, 'the tab bar rests on the bottom edge');
  for (const selector of ['.taskpro-board__bar-btn.is-filter', '.taskpro-board__properties', '.taskpro-board__more', '.taskpro-list__more-btn', '.taskpro-board__bar-icon-btn >> nth=0']) {
    const box = await page.locator(selector).first().boundingBox();
    eq(box.width >= 40 && box.height >= 40, true, `${selector} fits a finger`);
  }
  // The tab bar is a tab list, one tab per layout, and says which one is open.
  eq(await page.locator('.taskpro-tabbar [role="tablist"] [role="tab"]').count(), 4, 'a tab for each layout');
  eq(await page.locator('.taskpro-tabbar__tab[aria-selected="true"]').getAttribute('data-layout'), 'table', 'the open one is marked');
  eq(await page.locator('.taskpro-tabbar__tab[tabindex="0"]').count(), 1, 'one stop for the keyboard, arrows for the rest');
  for (const tab of await page.locator('.taskpro-tabbar__tab').all()) {
    const box = await tab.boundingBox();
    eq(box.width >= 44 && box.height >= 44, true, 'a tab is at least 44 by 44');
    eq((await tab.textContent()).trim().length > 0, true, 'a tab has a name');
  }
  // A row says what matters in one calm line.
  eq(await listRow(page, 'Send the quote to Acme').locator('.taskpro-meta.is-plan .taskpro-meta__text').textContent(), 'Today, 14:00 – 15:30', 'a row shows its plan with the hours');
  eq(await page.locator('.taskpro-list__props').count(), 0, 'and no wall of chips');

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

  // The sheet puts the days a task is moved to first, and Done at its foot.
  await page.tap('.taskpro-list__row:has-text("Dentist appointment") .taskpro-list__title');
  eq(await page.locator('.taskpro-menu__chips[role="group"] .taskpro-menu__chip').allTextContents().then((all) => all.map((t) => t.trim())), ['Today', 'Tomorrow', 'Next week', 'Pick a date…'], 'quick days under the title');
  eq((await page.locator('.taskpro-menu__chip').first().boundingBox()).height >= 44, true, 'each a finger tall');
  const footer = await page.locator('.taskpro-menu__primary').boundingBox();
  eq(footer.height >= 48 && footer.y + footer.height <= 844, true, 'Done is a large button inside the screen, at the foot');
  await page.locator('.taskpro-menu__chip', { hasText: 'Tomorrow' }).tap();
  await page.waitForTimeout(120);
  eq(await page.locator('.taskpro-menu').count(), 0, 'a day chosen, the sheet goes');
  const planned = await page.evaluate(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return [d.toLocaleDateString('en-CA'), Object.values(window.__notes).join('\n').split('\n').find((l) => l.includes('Dentist appointment'))];
  });
  eq(planned[1].includes(`@schedule(${planned[0]}`), true, 'the task is planned for tomorrow');
  await page.tap('.taskpro-list__row:has-text("Dentist appointment") .taskpro-list__title');
  eq(await page.locator('.taskpro-menu__chip.is-active').textContent().then((t) => t.trim()), 'Tomorrow', 'and its sheet shows the day in use');
  await page.locator('.taskpro-menu__chip', { hasText: 'Pick a date' }).tap();
  await page.waitForTimeout(200);
  eq(await page.locator('.taskpro-day-sheet .taskpro-daypick__day').count() >= 28, true, 'a month for any other day');
  await page.tap('.taskpro-qa__close');
  await page.waitForTimeout(300);
  await page.tap('.taskpro-list__row:has-text("Dentist appointment") .taskpro-list__title');
  await page.tap('.taskpro-menu__primary');
  await page.waitForTimeout(120);
  eq((await note(page, 'Life/Home.md')).includes('- [x] Dentist appointment'), true, 'Done ticks the task off');
  eq(plain(await page.locator('.taskpro-snackbar__text').textContent()), 'Done: Dentist appointment', 'with the line at the foot, and its Undo');
  await page.tap('.taskpro-snackbar__action');
  await page.waitForTimeout(150);
  eq((await note(page, 'Life/Home.md')).includes('- [ ] Dentist appointment'), true, 'which puts it back');
  await page.tap('.taskpro-list__row:has-text("Dentist appointment") .taskpro-list__title');
  eq(await page.locator('.taskpro-menu__primary').textContent().then((t) => t.trim()), 'Done', 'an open task offers Done');
  await page.tap('.taskpro-sheet-backdrop', { position: { x: 20, y: 20 } });
  await page.waitForTimeout(300);

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
  // A row is drawn on its content layer, which covers the row: the pick has to be seen on that.
  const layer = (title) =>
    listRow(page, title)
      .locator('.taskpro-list__content')
      .evaluate((el) => ({ fill: getComputedStyle(el).backgroundColor, bar: getComputedStyle(el).boxShadow }));
  const picked = await layer('Dentist appointment');
  const other = await layer('Groceries');
  eq(picked.fill !== other.fill, true, 'the picked row is tinted');
  eq(picked.bar.includes('inset') && other.bar === 'none', true, 'and has a bar at its start that the others have not');
  eq(await page.locator('.has-cursor').count(), 0, 'a tap leaves no keyboard cursor framing the task');
  eq(await page.locator('.taskpro-selection').count(), 1, 'and a bar rises');
  eq(await page.locator('.taskpro-selection__label').count(), 0, 'with icons and no words, on a phone');
  const barButton = await page.locator('.taskpro-selection__btn').nth(1).boundingBox();
  eq(barButton.width >= 38 && barButton.height >= 40, true, 'each a finger wide');
  const barBox = await page.locator('.taskpro-selection').boundingBox();
  eq(await page.locator('.taskpro-selection').evaluate((el) => el.scrollWidth <= el.clientWidth + 1), true, 'and all of them fit the width, none behind a scroll');
  eq(barBox.x >= 0 && barBox.x + barBox.width <= 390, true, 'inside the screen');
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
  eq(plain(await page.locator('.taskpro-snackbar__text').textContent()), 'Done: Groceries', 'and says so at the foot of the screen');
  eq(await page.locator('.taskpro-live').getAttribute('aria-live'), 'polite', 'to a screen reader too');
  await page.waitForTimeout(120);
  eq(plain(await page.locator('.taskpro-live').textContent()).includes('Done: Groceries'), true, 'in words');
  const snack = await page.locator('.taskpro-snackbar').boundingBox();
  const tabs = await page.locator('.taskpro-tabbar').boundingBox();
  eq(snack.y + snack.height <= tabs.y && snack.height >= 48, true, 'above the tab bar');
  eq(await page.locator('.taskpro-snackbar__action').count(), 0, 'a repeating task has no Undo: its next round would stay behind');
  // The circle is big enough to see, and a 44px target is made around it.
  const circle = await listRow(page, 'Pick the display typeface').locator('.taskpro-board__check').boundingBox();
  eq(circle.width >= 22 && circle.height >= 22, true, 'the checkbox is at least 22 across');
  const edge = await page.evaluate(({ x, y }) => !!document.elementFromPoint(x, y)?.closest('.taskpro-list__row .taskpro-board__check'), { x: circle.x + circle.width + 8, y: circle.y - 8 });
  eq(edge, true, 'and answers a touch 8px outside it');
  eq(await listRow(page, 'Pick the display typeface').locator('.taskpro-board__check').getAttribute('role'), 'checkbox', 'it is a checkbox to a screen reader');
  // A tap on it ticks the task off, with an Undo that puts it back.
  await page.tap('.taskpro-list__row:has-text("Pick the display typeface") .taskpro-board__check');
  await page.waitForTimeout(100);
  eq((await note(page, 'Projects/Website redesign.md')).includes('- [x] Pick the display typeface'), true, 'a tap on the circle ticks it off');
  eq((await page.locator('.taskpro-snackbar__action').boundingBox()).height >= 44, true, 'with an Undo a finger can hit');
  await page.tap('.taskpro-snackbar__action');
  await page.waitForTimeout(150);
  eq((await note(page, 'Projects/Website redesign.md')).includes('- [ ] Pick the display typeface'), true, 'Undo puts it back');
  eq(await page.locator('.taskpro-snackbar:not(.is-leaving)').count(), 0, 'and the line goes');
  await page.tap('.taskpro-list__row:has-text("Pick the display typeface") .taskpro-board__check');
  await page.waitForTimeout(100);
  await page.tap('.taskpro-snackbar__close');
  eq(await page.locator('.taskpro-snackbar:not(.is-leaving)').count(), 0, 'and it can be put away');
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

  // The + opens the quick-add sheet: one line of words, read as it is typed.
  await page.tap('.taskpro-board__fab');
  await page.waitForTimeout(150);
  eq(await page.locator('.taskpro-qa[role="dialog"][aria-modal="true"]').count(), 1, 'the quick-add sheet is a dialog');
  eq(await page.locator('.taskpro-qa').getAttribute('aria-labelledby'), 'taskpro-qa-title', 'named by its title');
  eq(await page.evaluate(() => document.activeElement?.classList.contains('taskpro-qa__input')), true, 'the line has the keyboard');
  const input = page.locator('.taskpro-qa__input');
  const inputBox = await input.boundingBox();
  eq(inputBox.height >= 48, true, 'a line a finger can hit');
  eq(await input.evaluate((el) => parseFloat(getComputedStyle(el).fontSize) >= 16), true, 'at a size a phone does not zoom into');
  eq((await page.locator('.taskpro-qa__read').textContent()).includes('Try:'), true, 'an example, until something is understood');

  await input.fill('Call Sara tomorrow 9 #work !high');
  eq(await page.locator('.taskpro-qa__chip-text').allTextContents(), ['Tomorrow, 09:00', 'High', 'Work'], 'what it understood: the plan, the priority, the tag');
  eq(await page.locator('.taskpro-qa__read').getAttribute('aria-live'), 'polite', 'announced as it changes');
  eq(await page.locator('.taskpro-qa__chip-x').first().getAttribute('aria-label'), 'Keep as words in the title: Tomorrow, 09:00', 'each reading can be kept as words, and says so');
  const where = (await page.locator('.taskpro-qa__dest-name').textContent()).trim();
  eq(where.startsWith('Goes to '), true, 'and says where the task goes');
  eq(where.includes('Inbox'), false, 'a task with a day goes into that day, not the inbox');
  await page.tap('.taskpro-qa__add');
  await page.waitForTimeout(100);
  const tomorrow = await page.evaluate(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toLocaleDateString('en-CA');
  });
  const written = await page.evaluate(() => {
    for (const text of Object.values(window.__notes)) {
      const line = text.split('\n').find((l) => l.includes('Call Sara'));
      if (line) return line;
    }
    return null;
  });
  eq(written.startsWith('- [ ] Call Sara'), true, 'written with the title alone');
  eq([written.includes('@priority(high)'), written.includes(`@schedule(${tomorrow} 09:00`), written.includes('work')], [true, true, true], 'with its priority, its day and hour, and its tag');
  eq(await input.inputValue(), '', 'the line is cleared for the next');
  eq(await page.locator('.taskpro-qa').count(), 1, 'and the sheet stays open');
  eq((await page.locator('.taskpro-qa__status').textContent()).includes('Call Sara'), true, 'what was added is said');
  eq(await page.evaluate(() => document.activeElement?.classList.contains('taskpro-qa__input')), true, 'and the keyboard stays');

  // A reading the owner did not mean is kept as words.
  await input.fill('Pay rent friday');
  eq(await page.locator('.taskpro-qa__chip').count(), 1, 'a weekday is read as the plan');
  await page.tap('.taskpro-qa__chip-x');
  eq([await page.locator('.taskpro-qa__chip').count(), await input.inputValue()], [0, 'Pay rent friday'], 'leaving it as words keeps the line as it was');
  await page.tap('.taskpro-qa__add');
  await page.waitForTimeout(100);
  eq((await note(page, 'Inbox.md')).trim().endsWith('- [ ] Pay rent friday'), true, 'and the task is only words, in the inbox');

  // The buttons write into the line, so the line says everything.
  await input.fill('Water the plants');
  await page.tap('.taskpro-qa__tool:has-text("Tomorrow")');
  eq(await input.inputValue(), 'Water the plants tomorrow', 'a day is written in');
  eq(await page.locator('.taskpro-qa__tool:has-text("Tomorrow")').getAttribute('aria-pressed'), 'true', 'and the button shows it is on');
  await page.tap('.taskpro-qa__tool:has-text("Today")');
  eq(await input.inputValue(), 'Water the plants today', 'another day replaces it');
  await page.tap('.taskpro-qa__chip-x');
  eq(await input.inputValue(), 'Water the plants', 'a day a button wrote is taken out of the line altogether');
  await page.tap('.taskpro-qa__tool:has-text("Priority")');
  await page.tap('.taskpro-qa__tool:has-text("Highest")');
  eq(await input.inputValue(), 'Water the plants !highest', 'a priority is written in');
  eq(await page.locator('.taskpro-qa__tool:has-text("Today")').count(), 1, 'and back at the first buttons');
  await page.tap('.taskpro-qa__tool:has-text("Tags")');
  await page.tap('.taskpro-qa__tool:has-text("Home")');
  eq((await input.inputValue()).endsWith('#home'), true, 'a tag is written in');
  eq(await page.locator('.taskpro-qa__chip.is-tag').count(), 1, 'and read');
  eq(await page.locator('.taskpro-qa__tool:has-text("Home")').getAttribute('aria-pressed'), 'true', 'tags stay on the page, so several can be picked');
  await page.tap('.taskpro-qa__back');
  await page.tap('.taskpro-qa__tool:has-text("Remind")');
  await page.tap('.taskpro-qa__tool:has-text("In 1 hour")');
  eq((await page.locator('.taskpro-qa__chip.is-remind .taskpro-qa__chip-text').textContent()).includes('16:00'), true, 'a reminder an hour on, from the clock of 15:00');

  // A day from a month.
  await input.fill('Book the dentist');
  await page.tap('.taskpro-qa__tool:has-text("Date")');
  eq(await page.locator('.taskpro-daypick [role="gridcell"]').count() >= 28, true, 'a month to pick from');
  const cell = await page.locator('.taskpro-daypick__day:not(.is-outside)').nth(14).boundingBox();
  eq(cell.height >= 44 && cell.width >= 44, true, 'days a finger can hit');
  eq((await page.locator('.taskpro-daypick__day.is-today').getAttribute('aria-label')).length > 10, true, 'each day is named in full');
  const pickedDay = await page.locator('.taskpro-daypick__day:not(.is-outside)').nth(14).getAttribute('data-day');
  await page.tap('.taskpro-daypick__day:not(.is-outside) >> nth=14');
  eq(await input.inputValue(), `Book the dentist ${pickedDay}`, 'the picked day is written in');
  eq(await page.locator('.taskpro-qa__chip.is-plan').count(), 1, 'and read as the plan');
  await page.tap('.taskpro-qa__close');
  await page.waitForTimeout(300);
  eq(await page.locator('.taskpro-qa').count(), 0, 'the sheet has a way out of its own');
  eq(await page.evaluate(() => document.activeElement?.classList.contains('taskpro-board__fab')), true, 'and the focus goes back to the +');

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

  // ── The bars: the top bar and the tab bar step aside, and the list never moves for it ──
  page = await open();
  eq(await page.locator('.taskpro-board.is-chrome-collapsible').count(), 1, 'the list lets its bars go');
  const listHeight = () => page.locator('.taskpro-board__body').evaluate((el) => Math.round(el.getBoundingClientRect().height));
  const heightBefore = await listHeight();
  await page.locator('.taskpro-board__body').evaluate((el) => (el.scrollTop = 260));
  await page.waitForTimeout(350);
  eq(await page.locator('.taskpro-board.is-chrome-hidden').count(), 1, 'scrolled down, the bars go');
  eq(await listHeight(), heightBefore, 'and the list is the size it was');
  eq((await page.locator('.taskpro-tabbar').boundingBox()).y >= 844, true, 'the tab bar is below the screen');
  eq((await page.locator('.taskpro-board__header').boundingBox()).y + (await page.locator('.taskpro-board__header').boundingBox()).height <= 1, true, 'the top bar is above it');
  const stuck = await page.locator('.taskpro-list__group').first().boundingBox();
  eq(stuck.y <= 0, true, 'a group title rises to the top while the bar is away');
  await page.locator('.taskpro-board__body').evaluate((el) => (el.scrollTop = 180));
  await page.waitForTimeout(350);
  eq(await page.locator('.taskpro-board.is-chrome-hidden').count(), 0, 'a scroll back up brings them back');
  await page.locator('.taskpro-board__body').evaluate((el) => (el.scrollTop = 0));
  eq(await page.locator('.taskpro-tabbar').isVisible(), true, 'and at the top they are there');

  // Each thing the bar on top does not carry is in the "more" sheet.
  await page.tap('.taskpro-board__more');
  eq(await page.locator('.taskpro-menu.is-sheet .taskpro-menu__header').textContent(), 'More options', 'the more sheet');
  const moreItems = (await page.locator('.taskpro-menu__item').allTextContents()).map((t) => t.trim().replace(/\s+/g, ' '));
  eq([moreItems[0].startsWith('Views'), moreItems.includes('Manage tags'), moreItems.includes('Rescan notes')], [true, true, true], 'its entries: the views, the tags, a refresh');
  await page.tap('.taskpro-sheet-backdrop', { position: { x: 20, y: 20 } });
  await page.waitForTimeout(300);

  // Rows are light by default; the chips are one choice away.
  eq(await page.locator('.taskpro-list__meta').count() > 0, true, 'a row has one calm line under its title');
  await page.tap('.taskpro-board__properties');
  await page.tap('.taskpro-menu__item:has-text("Row style")');
  await page.tap('.taskpro-menu__item:has-text("Chips")');
  await page.tap('.taskpro-sheet-backdrop', { position: { x: 20, y: 20 } });
  await page.waitForTimeout(300);
  eq([await page.locator('.taskpro-list__meta').count(), (await page.locator('.taskpro-list__props').count()) > 0], [0, true], 'chips for whoever wants them');
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
  await page.tap('.taskpro-tabbar__tab[data-layout="board"]');
  await page.waitForTimeout(150);
  eq(await page.locator('.taskpro-tabbar__tab[aria-selected="true"]').getAttribute('data-layout'), 'board', 'the tab bar follows');
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
  // A quick swipe across a card scrolls the board instead. A finger that rests 420ms is a hold, so on a
  // machine too busy to deliver the first move in time the swipe is tried once more, from a quiet page.
  eq(await page.locator('.taskpro-menu').count(), 0, 'carrying a card does not open its menu too');
  const scrollLeft = () => page.locator('.taskpro-board__body').evaluate((el) => el.scrollLeft);
  let swiped = false;
  for (let attempt = 0; attempt < 2 && !swiped; attempt++) {
    await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
    const scrolled = await scrollLeft();
    await page.gesture({ x: 300, y: 520 }, { x: 60, y: 520 }, { steps: 10 });
    await page.waitForTimeout(500);
    swiped = (await scrollLeft()) !== scrolled;
  }
  eq(swiped, true, 'a swipe scrolls between columns');
  eq(page.errors, [], 'no page errors on the board');
  await page.context().close();

  // ── The calendar ───────────────────────────────────────────────────────
  page = await open('&layout=calendar&cal=month');
  eq(await page.locator('.taskpro-cal__month.is-dots').count(), 1, 'the month as dots');
  eq(await page.locator('.taskpro-cal__day-list .taskpro-cal__agenda-item').count() > 0, true, "today's tasks listed below it");
  // The + floats over the calendar: no band is kept free for it, the calendar runs down to the tab bar.
  const calendarEnd = await page.locator('.taskpro-cal').evaluate((el) => el.getBoundingClientRect().bottom);
  const barTop = await page.locator('.taskpro-tabbar').evaluate((el) => el.getBoundingClientRect().top);
  eq(barTop - calendarEnd <= 16, true, 'the calendar fills the screen down to the tab bar');
  // The bar is two lines: the period with its arrows, and the views.
  const navBox = await page.locator('.taskpro-cal-nav.is-phone').boundingBox();
  eq(navBox.height <= 110, true, 'the calendar bar takes two lines, not three');
  eq(await page.locator('.taskpro-cal-nav__title').getAttribute('aria-live'), 'polite', 'the period is announced as it changes');
  for (const selector of ['.taskpro-cal-nav__today', '.taskpro-cal-nav__free', '.taskpro-cal-nav__more', '.taskpro-cal-nav__top .taskpro-board__icon-btn']) {
    const box = await page.locator(selector).first().boundingBox();
    eq(box.width >= 40 && box.height >= 40, true, `${selector} fits a finger`);
  }
  const monthTitle = async () => plain(await page.locator('.taskpro-cal-nav__title').textContent());
  const thisMonth = await monthTitle();
  // A swipe across the month turns its page, and the arrows do the same.
  await page.gesture({ x: 320, y: 420 }, { x: 60, y: 420 });
  const nextMonth = await monthTitle();
  eq(nextMonth !== thisMonth, true, 'a swipe toward the start turns to the next month');
  await page.gesture({ x: 60, y: 420 }, { x: 320, y: 420 });
  eq(await monthTitle(), thisMonth, 'and back');
  await page.tap('.taskpro-cal-nav__top .taskpro-board__icon-btn >> nth=1');
  eq((await monthTitle()) === nextMonth, true, 'the forward arrow, for anyone who does not swipe');
  await page.tap('.taskpro-cal-nav__today');
  eq(await monthTitle(), thisMonth, 'Today comes back');
  // What the bar does not carry is in its sheet, whose switches stay open.
  await page.tap('.taskpro-cal-nav__more');
  eq(await page.locator('.taskpro-menu.is-sheet .taskpro-menu__header').textContent(), 'View options', 'the calendar’s sheet');
  await page.tap('.taskpro-menu__item:has-text("Jalali")');
  eq(await page.locator('.taskpro-menu').count(), 1, 'a switch leaves the sheet open');
  await page.tap('.taskpro-sheet-backdrop', { position: { x: 20, y: 20 } });
  await page.waitForTimeout(300);
  eq((await monthTitle()) !== thisMonth, true, 'and the bar follows the calendar chosen');
  await page.tap('.taskpro-cal-nav__more');
  await page.tap('.taskpro-menu__item:has-text("Gregorian")');
  await page.tap('.taskpro-sheet-backdrop', { position: { x: 20, y: 20 } });
  await page.waitForTimeout(300);
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
  eq(
    await page.evaluate(() => document.querySelector('.taskpro-tabbar').getBoundingClientRect().top - document.querySelector('.taskpro-tl').getBoundingClientRect().bottom <= 16),
    true,
    'the timeline fills the screen down to the tab bar, the + floating over it'
  );
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
  await page.tap('.taskpro-tabbar__tab[data-layout="table"]');
  await page.waitForTimeout(150);
  const faRow = await center(page.locator('.taskpro-list__row').filter({ has: page.locator('.taskpro-list__title', { hasText: 'خرید هفتگی' }) }).locator('.taskpro-list__content'));
  await page.gesture({ x: 330, y: faRow.y }, { x: 120, y: faRow.y });
  eq((await note(page, 'Life/Home.md')).startsWith('- [x] خرید هفتگی'), true, 'RTL: a swipe toward the left ticks it off');
  eq(page.errors, [], 'no page errors in Persian');
  await page.context().close();
  // ── Quick add, in Persian ──────────────────────────────────────────────
  page = await open('&lang=fa');
  await page.tap('.taskpro-board__fab');
  await page.waitForTimeout(150);
  await page.locator('.taskpro-qa__input').fill('خرید نان فردا ساعت ۹ #کار !بالا');
  eq(await page.locator('.taskpro-qa__chip').count(), 3, 'RTL: the plan, the priority and the tag are read from Persian words');
  eq(await page.locator('.taskpro-qa__chip.is-priority .taskpro-qa__chip-text').textContent(), 'زیاد', 'RTL: the priority, under the name the plugin gives it');
  const firstTool = await page.locator('.taskpro-qa__tool').first().boundingBox();
  const lastTool = await page.locator('.taskpro-qa__tool').last().boundingBox();
  eq(firstTool.x > lastTool.x, true, 'RTL: the first button is on the right');
  await page.tap('.taskpro-qa__add');
  await page.waitForTimeout(100);
  const faTomorrow = await page.evaluate(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toLocaleDateString('en-CA');
  });
  const faLine = await page.evaluate(() => {
    for (const text of Object.values(window.__notes)) {
      const line = text.split('\n').find((l) => l.includes('خرید نان') && l.includes('@schedule'));
      if (line) return line;
    }
    return null;
  });
  eq(faLine !== null && faLine.includes('@priority(high)') && faLine.includes(`@schedule(${faTomorrow} 09:00`), true, 'RTL: written for tomorrow at nine, high priority');
  eq(page.errors, [], 'no page errors adding in Persian');
  await page.context().close();
} finally {
  await browser.close();
}

console.log(`MOBILE_INTERACTIONS_OK (${checked} checks)`);
