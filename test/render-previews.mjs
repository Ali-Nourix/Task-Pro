/**
 * Screenshots the preview harnesses in this folder into docs/images/.
 *
 * The harnesses load the plugin's own styles.css over Obsidian's default theme
 * variables and reproduce the DOM the chip renderers build, so these are
 * renders of the real stylesheet rather than mock-ups — but they are produced
 * in a plain Chromium, not inside Obsidian.
 *
 * Playwright is not a dependency of this plugin, because it would pull a
 * browser download into every install. Install it on demand:
 *
 *   npm i --no-save playwright && npx playwright install chromium
 *   node test/render-previews.mjs
 */
import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import path from 'path';
import { mkdir } from 'fs/promises';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(here, '..', 'docs', 'images');

/** Each shot: the harness page, the element to capture, and the output name. */
const SHOTS = [
  { file: 'chips-preview.html', query: '', selector: '.note', out: 'task-chips-dark.png' },
  { file: 'chips-preview.html', query: '?light', selector: '.note', out: 'task-chips-light.png' },
  { file: 'chips-preview.html', query: '', selector: '#states', out: 'chip-states.png' },
  { file: 'chips-preview.html', query: '', selector: '.statusbar', out: 'status-bar-timer.png' },
];

await mkdir(outDir, { recursive: true });

const browser = await chromium.launch({
  // Set PW_CHROMIUM to reuse a browser that is already on the machine.
  executablePath: process.env.PW_CHROMIUM || undefined,
});

try {
  for (const shot of SHOTS) {
    const page = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: 900, height: 900 } });
    await page.goto(`file://${path.join(here, shot.file)}${shot.query}`);
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
