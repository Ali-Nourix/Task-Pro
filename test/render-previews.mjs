/**
 * Screenshots the preview harnesses in this folder into docs/images/.
 *
 * The harnesses load the plugin's own styles.css over Obsidian's default theme
 * variables and reproduce the DOM the chip renderers build, so these are
 * renders of the real stylesheet rather than mock-ups — but they are produced
 * in a plain Chromium, not inside Obsidian.
 *
 * The board, tag picker, tag manager and tag chips are rendered by the
 * plugin's own code through test/harness/board-preview.ts, so those shots show
 * the real DOM as well as the real stylesheet.
 *
 * Playwright and Lucide are not dependencies of this plugin, because they would
 * pull a browser and an icon set into every install. Install them on demand:
 *
 *   npm i --no-save playwright lucide-static && npx playwright install chromium
 *   node test/render-previews.mjs
 */
import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import path from 'path';
import { mkdir, access } from 'fs/promises';
import { buildHarness } from './harness/build.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(here, '..', 'docs', 'images');

/** Each shot: the harness page, the element to capture, and the output name. */
const SHOTS = [
  { file: 'chips-preview.html', query: '', selector: '.note', out: 'task-chips-dark.png' },
  { file: 'chips-preview.html', query: '?light', selector: '.note', out: 'task-chips-light.png' },
  { file: 'chips-preview.html', query: '', selector: '#states', out: 'chip-states.png' },
  { file: 'chips-preview.html', query: '', selector: '#checkboxes', out: 'task-checkboxes.png' },
  { file: 'chips-preview.html', query: '', selector: '.statusbar', out: 'status-bar-timer.png' },
  // Same chips under a real community theme, to prove they follow the vault
  // rather than the plugin's own idea of what a colour should be.
  { file: 'chips-preview.html', query: '?theme=bookcloth', selector: '.note', out: 'task-chips-bookcloth-dark.png' },
  { file: 'chips-preview.html', query: '?theme=bookcloth&light', selector: '.note', out: 'task-chips-bookcloth-light.png' },
  { file: 'reminder-preview.html', query: '?theme=bookcloth', selector: 'body', out: 'reminder-overlay-dark.png' },
  { file: 'reminder-preview.html', query: '?theme=bookcloth&light', selector: 'body', out: 'reminder-overlay-light.png' },
  // The task board and tags, rendered from the plugin's own classes.
  { file: 'board-preview.html', query: '', selector: 'body', out: 'task-board-table-dark.png', board: true },
  { file: 'board-preview.html', query: '?theme=bookcloth&light', selector: 'body', out: 'task-board-table-bookcloth-light.png', board: true },
  { file: 'board-preview.html', query: '?layout=board', selector: 'body', out: 'task-board-kanban-dark.png', board: true },
  { file: 'board-preview.html', query: '?layout=board&lang=fa&theme=bookcloth', selector: 'body', out: 'task-board-kanban-fa.png', board: true },
  { file: 'board-preview.html', query: '?view=note', selector: '#root', out: 'task-tags-dark.png', board: true },
  { file: 'board-preview.html', query: '?view=note&theme=bookcloth&light', selector: '#root', out: 'task-tags-bookcloth-light.png', board: true },
  { file: 'board-preview.html', query: '?view=picker', selector: '.taskpro-panel', out: 'tag-picker.png', board: true },
  { file: 'board-preview.html', query: '?view=picker&query=Planning', selector: '.taskpro-panel', out: 'tag-picker-create.png', board: true },
  { file: 'board-preview.html', query: '?view=manager', selector: '#root', out: 'tag-manager.png', board: true },
];

/** The board needs a desktop-sized pane; the chip strips do not. */
const VIEWPORTS = { board: { width: 1280, height: 760 }, default: { width: 900, height: 820 } };

let boardReady = false;
try {
  await buildHarness();
  boardReady = true;
} catch (error) {
  console.log(`board shots skipped — ${error.message}`);
}

await mkdir(outDir, { recursive: true });

/** Shots that need a theme in test/themes/ are skipped when it is not there. */
const themeOf = (query) => query.match(/[?&]theme=([a-z0-9-]+)/)?.[1] ?? null;
const available = async (query) => {
  const theme = themeOf(query);
  if (!theme) return true;
  try {
    await access(path.join(here, 'themes', `${theme}.css`));
    return true;
  } catch {
    return false;
  }
};

const browser = await chromium.launch({
  // Set PW_CHROMIUM to reuse a browser that is already on the machine.
  executablePath: process.env.PW_CHROMIUM || undefined,
});

try {
  for (const shot of SHOTS) {
    if (!(await available(shot.query))) {
      console.log(`skipped ${shot.out} — test/themes/${themeOf(shot.query)}.css is not present`);
      continue;
    }
    if (shot.board && !boardReady) continue;
    const viewport = shot.board ? VIEWPORTS.board : VIEWPORTS.default;
    const page = await browser.newPage({ deviceScaleFactor: 2, viewport });
    await page.goto(`file://${path.join(here, shot.file)}${shot.query}`);
    if (shot.board) await page.waitForSelector('body[data-ready="true"]');
    await page.waitForTimeout(250);
    const target = await page.locator(shot.selector).first();
    await target.screenshot({ path: path.join(outDir, shot.out), scale: 'css' });
    console.log(`rendered ${shot.out}`);
    await page.close();
  }
} finally {
  await browser.close();
}

console.log(`\n${SHOTS.length} previews written to docs/images/`);
