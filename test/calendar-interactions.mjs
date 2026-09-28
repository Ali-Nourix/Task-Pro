/**
 * Drives the task board's calendar in a real browser: the calendar is the
 * plugin's own TaskCalendar, run against test/harness/board-preview.ts, whose
 * host edits in-memory notes (and makes daily notes from a template) the way
 * the plugin does in a vault.
 *
 * Needs Playwright and lucide-static, installed on demand:
 *   npm i --no-save playwright lucide-static
 *   node test/calendar-interactions.mjs
 */
import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import path from 'path';
import { buildHarness } from './harness/build.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
await buildHarness();

const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
let checked = 0;
const eq = (actual, expected, label) => {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${label}:\n  got      ${a}\n  expected ${e}`);
  checked++;
};
const ok = (value, label) => eq(!!value, true, label);

/** Same as the harness: days relative to today, so the test runs on any date. */
function inDays(days) {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + days);
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
const HOUR = 48;

async function open(query, width = 1400) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`file://${path.join(here, 'board-preview.html')}?layout=calendar&${query}`);
  await page.waitForSelector('body[data-ready="true"]');
  await page.waitForTimeout(100);
  page.errors = errors;
  return page;
}

const notes = (page) => page.evaluate(() => window.__notes);
const lineWith = async (page, text) => {
  for (const content of Object.values(await notes(page))) {
    const line = content.split('\n').find((l) => l.includes(text));
    if (line) return line;
  }
  return null;
};

/** Scrolls the time grid so `hour` is near the top, and returns a day column's box. */
async function column(page, day, hour = 6) {
  await page.evaluate((top) => {
    document.querySelector('.taskpro-cal__scroller').scrollTop = top;
  }, hour * HOUR);
  await page.waitForTimeout(30);
  return page.locator(`.taskpro-cal__col[data-day="${day}"]`).boundingBox();
}

async function drag(page, from, to, steps = 12) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps });
  await page.mouse.up();
  await page.waitForTimeout(250);
}

const yAt = (box, minutes) => box.y + (minutes / 60) * HOUR;

try {
  // ── Month ──────────────────────────────────────────────────────────────
  let page = await open('cal=month');
  const cells = await page.locator('.taskpro-cal__cell').count();
  eq(cells % 7 === 0 && cells >= 28 && cells <= 42, true, 'the month is drawn in whole weeks');
  eq(await page.locator(`.taskpro-cal__cell.is-today[data-day="${inDays(0)}"]`).count(), 1, 'today is marked');
  ok(await page.locator(`.taskpro-cal__cell[data-day="${inDays(0)}"] .taskpro-cal__chip`, { hasText: 'Buy bread' }).count(), 'a task in today’s daily note shows on today');
  ok(
    await page.locator(`.taskpro-cal__cell[data-day="${inDays(0)}"] .taskpro-cal__chip.is-due`, { hasText: 'Send the quote to Acme' }).count(),
    'a task due today shows as a deadline'
  );

  // A day's "+" opens the picker; Enter makes the task in that day's note,
  // created from the template, under its heading.
  const target = inDays(4);
  const cell = page.locator(`.taskpro-cal__cell[data-day="${target}"]`);
  await cell.hover();
  await cell.locator('.taskpro-cal__add').click();
  await page.locator('.taskpro-cal-picker__input').fill('Plan the offsite');
  await page.locator('.taskpro-cal-picker__input').press('Enter');
  await page.waitForTimeout(250);
  const daily = (await notes(page))[`Daily/${target}.md`];
  ok(daily, 'the day’s note was created');
  eq(daily.split('\n').slice(0, 1)[0].startsWith('# '), true, 'from the template');
  ok(/## Tasks\n- \[ \] Plan the offsite\n/.test(daily), 'the task went under the template’s heading');
  eq(daily.includes('@schedule('), false, 'an untimed task in its own day’s note needs no marker');
  ok(await page.locator(`.taskpro-cal__cell[data-day="${target}"] .taskpro-cal__chip`, { hasText: 'Plan the offsite' }).count(), 'and it shows on its day');

  // Dragging a chip to another day plans it there.
  const accountant = page.locator('.taskpro-cal__chip', { hasText: 'Call the accountant' });
  const from = await accountant.boundingBox();
  const to = await page.locator(`.taskpro-cal__cell[data-day="${inDays(5)}"]`).boundingBox();
  await drag(page, { x: from.x + 20, y: from.y + 10 }, { x: to.x + to.width / 2, y: to.y + to.height / 2 });
  eq(await lineWith(page, 'Call the accountant'), `- [ ] Call the accountant @schedule(${inDays(5)})`, 'dragged to another day');

  // Switching to the Jalali calendar redraws the same days by Jalali months.
  await page.locator('.taskpro-cal-nav__systems .taskpro-segmented__item', { hasText: 'Jalali' }).click();
  const jalaliTitle = await page.locator('.taskpro-cal-nav__title').textContent();
  ok(/^(Farvardin|Ordibehesht|Khordad|Tir|Mordad|Shahrivar|Mehr|Aban|Azar|Dey|Bahman|Esfand) 14\d\d$/.test(jalaliTitle), `a Jalali month title (${jalaliTitle})`);
  eq(await page.locator('.taskpro-cal__weekday').first().textContent(), 'Sat', 'a Jalali week starts on Saturday');
  eq(page.errors, [], 'no page errors in the month');
  await page.close();

  // ── Week ───────────────────────────────────────────────────────────────
  page = await open('cal=week');
  const tomorrow = inDays(1);
  const inWeek = await page.locator(`.taskpro-cal__col[data-day="${tomorrow}"]`).count();
  // The week holds today; tomorrow may be next week on the week's last day.
  const day = inWeek ? tomorrow : inDays(0);

  // Drag across the grid to block out 13:00–14:30, then name the new task.
  let box = await column(page, day, 12);
  await drag(page, { x: box.x + box.width / 2, y: yAt(box, 13 * 60) + 3 }, { x: box.x + box.width / 2, y: yAt(box, 14 * 60 + 15) + 3 });
  const times = await page.locator('.taskpro-cal-picker .taskpro-cal-times__input').evaluateAll((inputs) => inputs.map((i) => i.value));
  eq(times, ['13:00', '14:30'], 'the dragged span becomes the picker’s times');
  await page.locator('.taskpro-cal-picker__input').fill('Deep work on the proposal');
  await page.locator('.taskpro-cal-picker__input').press('Enter');
  await page.waitForTimeout(250);
  eq(await lineWith(page, 'Deep work on the proposal'), `- [ ] Deep work on the proposal @schedule(${day} 13:00-14:30)`, 'a timed task is written with its plan');
  ok(await page.locator(`.taskpro-cal__col[data-day="${day}"] .taskpro-cal__block`, { hasText: 'Deep work on the proposal' }).count(), 'and drawn as a block');

  // The picker also plans a task the vault already has.
  box = await column(page, day, 15);
  await drag(page, { x: box.x + box.width / 2, y: yAt(box, 16 * 60) + 3 }, { x: box.x + box.width / 2, y: yAt(box, 16 * 60 + 40) + 3 });
  await page.locator('.taskpro-cal-picker__input').fill('groceries');
  await page.locator('.taskpro-cal-picker__input').press('ArrowDown');
  await page.locator('.taskpro-cal-picker__input').press('Enter');
  await page.waitForTimeout(250);
  eq(await lineWith(page, 'Groceries'), `- [ ] Groceries @repeat(1w) @due(${inDays(2)}) @tag(home) @schedule(${day} 16:00-16:45)`, 'an existing task planned from the picker');

  // Escape closes the picker without writing anything.
  box = await column(page, day, 18);
  await drag(page, { x: box.x + box.width / 2, y: yAt(box, 19 * 60) + 3 }, { x: box.x + box.width / 2, y: yAt(box, 19 * 60 + 50) + 3 });
  await page.locator('.taskpro-cal-picker__input').fill('Not this one');
  await page.keyboard.press('Escape');
  eq(await page.locator('.taskpro-cal-picker').count(), 0, 'Escape closes the picker');
  eq(await lineWith(page, 'Not this one'), null, 'and writes nothing');

  // A click on an empty slot only offers a +; the + opens the picker.
  box = await column(page, day, 18);
  await page.mouse.click(box.x + box.width / 2, yAt(box, 20 * 60) + 5);
  eq([await page.locator('.taskpro-cal__quick-add').count(), await page.locator('.taskpro-cal-picker').count()], [1, 0], 'a click shows the + and not the picker');
  await page.locator('.taskpro-cal__quick-add').click();
  eq(await page.locator('.taskpro-cal-picker').count(), 1, 'the + opens the picker for that slot');
  eq(await page.locator('.taskpro-cal-picker .taskpro-cal-times__input').first().inputValue(), '20:00', 'at the slot that was clicked');
  await page.keyboard.press('Escape');
  await page.mouse.click(box.x + box.width / 2, yAt(box, 21 * 60) + 5);
  await page.keyboard.press('Escape');
  eq(await page.locator('.taskpro-cal__quick-add').count(), 0, 'Escape puts the + away');

  // Moving a block by two hours.
  box = await column(page, day, 12);
  let block = await page.locator('.taskpro-cal__block', { hasText: 'Deep work on the proposal' }).boundingBox();
  await drag(page, { x: block.x + block.width / 2, y: block.y + 20 }, { x: block.x + block.width / 2, y: block.y + 20 + 2 * HOUR });
  eq(await lineWith(page, 'Deep work on the proposal'), `- [ ] Deep work on the proposal @schedule(${day} 15:00-16:30)`, 'moved two hours later, same length');

  // Resizing from the bottom edge.
  box = await column(page, day, 14);
  block = await page.locator('.taskpro-cal__block', { hasText: 'Deep work on the proposal' }).boundingBox();
  await drag(page, { x: block.x + block.width / 2, y: block.y + block.height - 2 }, { x: block.x + block.width / 2, y: block.y + block.height - 2 + HOUR / 2 });
  eq(await lineWith(page, 'Deep work on the proposal'), `- [ ] Deep work on the proposal @schedule(${day} 15:00-17:00)`, 'resized to end half an hour later');

  // Moving to the all-day row drops the time.
  box = await column(page, day, 14);
  block = await page.locator('.taskpro-cal__block', { hasText: 'Deep work on the proposal' }).boundingBox();
  const allDay = await page.locator(`.taskpro-cal__allday-cell[data-day="${day}"]`).boundingBox();
  await drag(page, { x: block.x + block.width / 2, y: block.y + 20 }, { x: allDay.x + allDay.width / 2, y: allDay.y + allDay.height / 2 });
  eq(await lineWith(page, 'Deep work on the proposal'), `- [ ] Deep work on the proposal @schedule(${day})`, 'the all-day row keeps the day and drops the time');

  // From the unscheduled list into the grid: the default length.
  box = await column(page, day, 9);
  const free = await page.locator('.taskpro-cal__free', { hasText: 'Dentist appointment' }).boundingBox();
  await drag(page, { x: free.x + 40, y: free.y + 12 }, { x: box.x + box.width / 2, y: yAt(box, 10 * 60) + 2 }, 20);
  eq(
    await lineWith(page, 'Dentist appointment'),
    `- [ ] Dentist appointment @priority(medium) @due(${inDays(9)}) @tag(health) @schedule(${day} 10:00-11:00)`,
    'planned from the unscheduled list'
  );
  eq(await page.locator('.taskpro-cal__free', { hasText: 'Dentist appointment' }).count(), 0, 'and it leaves the list');

  // Back into the list takes it off the calendar.
  box = await column(page, day, 9);
  block = await page.locator('.taskpro-cal__block', { hasText: 'Dentist appointment' }).boundingBox();
  const sidebar = await page.locator('.taskpro-cal__sidebar').boundingBox();
  await drag(page, { x: block.x + block.width / 2, y: block.y + 15 }, { x: sidebar.x + sidebar.width / 2, y: sidebar.y + 200 }, 20);
  eq((await lineWith(page, 'Dentist appointment')).includes('@schedule('), false, 'dropped on the list: unscheduled');

  // The task card: a click on a block opens it; its fields edit the plan.
  box = await column(page, day, 12);
  await page.locator('.taskpro-cal__block', { hasText: 'Deep work on the proposal' }).count();
  const morning = page.locator('.taskpro-cal__block').first();
  const morningTitle = (await morning.locator('.taskpro-cal__block-title').textContent()).trim();
  await morning.click({ position: { x: 30, y: 12 } });
  ok(await page.locator('.taskpro-cal-inspector').count(), 'a click opens the task card');
  eq((await page.locator('.taskpro-cal-inspector__title').textContent()).trim(), morningTitle, 'for that task');
  await page.locator('.taskpro-cal-inspector .taskpro-cal-times__input').nth(1).evaluate((input) => {
    input.value = '23:00';
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForTimeout(250);
  ok((await lineWith(page, morningTitle)).includes('-23:00)'), 'the card’s end time is written');
  await page.locator('.taskpro-cal-inspector__remove').click();
  await page.waitForTimeout(250);
  eq((await lineWith(page, morningTitle)).includes('@schedule('), false, '“Remove from calendar” unschedules it');
  eq(await page.locator('.taskpro-cal-inspector').count(), 0, 'and closes the card');

  // Keys: arrows move by a week, M/W/D/A switch views.
  const title = await page.locator('.taskpro-cal-nav__title').textContent();
  await page.locator('.taskpro-cal').focus();
  await page.keyboard.press('ArrowRight');
  ok((await page.locator('.taskpro-cal-nav__title').textContent()) !== title, 'the right arrow shows the next week');
  await page.keyboard.press('KeyT');
  eq(await page.locator('.taskpro-cal-nav__title').textContent(), title, 'T comes back to today');
  await page.keyboard.press('KeyA');
  eq(await page.locator('.taskpro-cal--agenda').count(), 1, 'A opens the agenda');
  eq(await page.locator('.taskpro-cal__agenda-day').count(), 14, 'two weeks of days');
  await page.locator(`.taskpro-cal__agenda-day[data-day="${inDays(0)}"] .taskpro-cal__agenda-num`).click();
  eq(await page.locator('.taskpro-cal--day').count(), 1, 'a day’s number opens that day');
  eq(page.errors, [], 'no page errors in the week');
  await page.close();

  // ── Persian, Jalali, right to left ───────────────────────────────────────
  page = await open('cal=month&lang=fa');
  eq(await page.getAttribute('.taskpro-board', 'dir'), 'rtl', 'Persian board is right to left');
  eq(await page.locator('.taskpro-cal__weekday').first().textContent(), 'شنبه', 'the week starts on Saturday');
  const faTitle = await page.locator('.taskpro-cal-nav__title').textContent();
  ok(/^(فروردین|اردیبهشت|خرداد|تیر|مرداد|شهریور|مهر|آبان|آذر|دی|بهمن|اسفند) 14\d\d$/.test(faTitle), `a Persian month title (${faTitle})`);
  const faCell = page.locator(`.taskpro-cal__cell[data-day="${inDays(2)}"]`);
  await faCell.hover();
  await faCell.locator('.taskpro-cal__add').click();
  await page.locator('.taskpro-cal-picker__input').fill('خرید کتاب');
  await page.locator('.taskpro-cal-picker__input').press('Enter');
  await page.waitForTimeout(250);
  const faNotes = await notes(page);
  const faDaily = Object.keys(faNotes).find((p) => p.startsWith('Daily/14') && faNotes[p].includes('خرید کتاب'));
  ok(faDaily && /^Daily\/14\d\d-\d\d-\d\d\.md$/.test(faDaily), `a Jalali calendar names the new note in Jalali (${faDaily})`);
  eq(page.errors, [], 'no page errors in RTL');
  await page.close();

  // ── Right-click menu, subtasks, and times in Persian ────────────────────
  page = await open('cal=week');
  const auto = page.locator('.taskpro-cal__block:has-text("Auto layout")');
  eq((await auto.getAttribute('data-family')) === (await page.locator('.taskpro-cal__block:has-text("Prototyping")').getAttribute('data-family')), true, 'subtasks planned apart share their family');
  ok((await auto.locator('.taskpro-cal__crumb').textContent()).includes('Learn Figma'), 'a long enough block names its parent');
  await auto.hover();
  await page.waitForTimeout(50);
  eq(await page.locator('.taskpro-cal__block:has-text("Prototyping")').evaluate((el) => el.classList.contains('is-family-lit')), true, 'hovering one member rings the others');
  const family = page.locator('.taskpro-cal__family', { hasText: 'Learn Figma' });
  eq(await family.locator('.is-family-head .taskpro-cal__free-title').textContent(), 'Learn Figma', 'the unscheduled list heads a family with its parent');
  eq(await family.locator('.taskpro-cal__family-children .taskpro-cal__free-title').allTextContents(), ['Paid features'], 'and keeps its open subtasks under it');
  await family.locator('.taskpro-cal__fold').click();
  eq(await page.locator('.taskpro-cal__family', { hasText: 'Learn Figma' }).locator('.taskpro-cal__family-children').count(), 0, 'the toggle folds the family');
  await page.locator('.taskpro-cal__family', { hasText: 'Learn Figma' }).locator('.taskpro-cal__fold').click();

  await auto.click({ button: 'right' });
  eq(await page.locator('.taskpro-menu').count(), 1, 'a right click opens the task menu');
  eq(await page.locator('.taskpro-menu__header').textContent(), 'Auto layout', 'titled with the task');
  await page.locator('.taskpro-menu__item:has-text("Priority")').hover();
  await page.waitForTimeout(200);
  await page.locator('.taskpro-menu.is-submenu .taskpro-menu__item:has-text("High")').first().click();
  await page.waitForTimeout(100);
  ok((await lineWith(page, 'Auto layout')).includes('@priority(highest)'), 'a submenu choice is written');
  eq(await page.locator('.taskpro-menu').count(), 0, 'and closes the menu');

  await auto.click({ button: 'right' });
  await page.keyboard.type('every week');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(100);
  ok((await lineWith(page, 'Auto layout')).includes('@repeat(1w)'), 'the menu’s search reaches into submenus');
  await auto.click({ button: 'right' });
  await page.keyboard.press('Escape');
  eq(await page.locator('.taskpro-menu').count(), 0, 'Escape closes it');

  // The parent's card lists its subtasks, and takes a new one.
  await page.locator('.taskpro-cal__free:has-text("Learn Figma")').click();
  eq(await page.locator('.taskpro-cal-inspector__subtask').count(), 3, 'the card lists the subtasks');
  await page.locator('.taskpro-cal-inspector__subtask-add').fill('Components');
  await page.locator('.taskpro-cal-inspector__subtask-add').press('Enter');
  await page.waitForTimeout(150);
  eq((await notes(page))['Projects/Figma.md'].split('\n').pop(), '    - [ ] Components', 'a subtask added from the card goes under its parent');
  eq(await page.locator('.taskpro-cal-inspector__subtask').count(), 4, 'and shows in the card at once');
  await page.locator('.taskpro-cal-inspector__subtask:has-text("Prototyping")').click();
  ok((await page.locator('.taskpro-cal-inspector__parent').textContent()).includes('Learn Figma'), 'a subtask’s card links back to its parent');
  await page.keyboard.press('Escape');

  // Right click on an empty slot offers a task at that time.
  const emptyCol = await column(page, inDays(0), 12);
  await page.mouse.click(emptyCol.x + emptyCol.width / 2, emptyCol.y + 15 * HOUR + 5, { button: 'right' });
  ok((await page.locator('.taskpro-menu__item').first().textContent()).includes('15:00'), 'an empty slot’s menu starts a task at its time');
  await page.locator('.taskpro-menu__item').first().click();
  eq(await page.locator('.taskpro-cal-picker').count(), 1, 'and opens the picker there');
  await page.keyboard.press('Escape');
  eq(page.errors, [], 'no page errors with menus');
  await page.close();

  page = await open('cal=week&lang=fa');
  const faTime = await page.locator('.taskpro-cal__block-time').first().evaluate((el) => getComputedStyle(el).direction);
  eq(faTime, 'ltr', 'a time range reads left to right in Persian');
  eq(page.errors, [], 'no page errors in the Persian week');
  await page.close();
} finally {
  await browser.close();
}

console.log(`CALENDAR_INTERACTIONS_OK (${checked} checks)`);
