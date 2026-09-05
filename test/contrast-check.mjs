/**
 * Measures WCAG contrast for every chip label, in every theme and mode the
 * harness can load.
 *
 * Chip labels are 12px semibold, which WCAG counts as normal text, so the AA
 * bar is 4.5:1. The point of the check is that the colour recipe holds up on a
 * theme the plugin has never seen, not just on Obsidian's defaults — a chip
 * whose label mixes toward --text-normal should stay readable either way.
 *
 * Playwright is not a dependency of this plugin. Install it on demand:
 *   npm i --no-save playwright && npx playwright install chromium
 *   node test/contrast-check.mjs
 */
import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import path from 'path';
import { readdir } from 'fs/promises';

const here = path.dirname(fileURLToPath(import.meta.url));
const AA = 4.5;

// Obsidian's own variables, plus every theme dropped into test/themes/.
const themes = [{ name: 'Obsidian default', query: '' }];
try {
  for (const file of (await readdir(path.join(here, 'themes'))).sort()) {
    if (file.endsWith('.css')) {
      const name = file.replace(/\.css$/, '');
      themes.push({ name, query: `?theme=${name}` });
    }
  }
} catch {
  /* no themes folder is fine — the defaults still get checked */
}

const CASES = themes.flatMap(({ name, query }) =>
  ['chips', 'reminder'].flatMap((surface) =>
    [
      { mode: 'dark', suffix: '' },
      { mode: 'light', suffix: query ? '&light' : '?light' },
    ].map(({ mode, suffix }) => ({
      page: `${surface}-preview.html`,
      label: `${surface} · ${name} · ${mode}`,
      query: query + suffix,
    }))
  )
);

const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
let failures = 0;

try {
  for (const testCase of CASES) {
    const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
    await page.goto(`file://${path.join(here, testCase.page)}${testCase.query}`);
    await page.waitForTimeout(200);

    const results = await page.evaluate(() => {
      // Chromium serialises a color-mix() result as `color(srgb r g b / a)`
      // with 0..1 components, and everything else as rgb()/rgba() with 0..255.
      const parse = (value) => {
        const n = value.match(/[\d.]+(?:e-?\d+)?/g)?.map(Number) ?? [0, 0, 0];
        const scale = value.startsWith('color(') ? 255 : 1;
        return { r: n[0] * scale, g: n[1] * scale, b: n[2] * scale, a: n[3] ?? 1 };
      };
      // Walk up for the first opaque backdrop, then composite the chip's own
      // translucent fill over it — that is what the eye actually sees.
      const backdropOf = (el) => {
        for (let node = el.parentElement; node; node = node.parentElement) {
          const c = parse(getComputedStyle(node).backgroundColor);
          if (c.a === 1) return c;
        }
        return { r: 255, g: 255, b: 255, a: 1 };
      };
      const over = (fg, bg) => ({
        r: fg.r * fg.a + bg.r * (1 - fg.a),
        g: fg.g * fg.a + bg.g * (1 - fg.a),
        b: fg.b * fg.a + bg.b * (1 - fg.a),
        a: 1,
      });
      const lum = ({ r, g, b }) => {
        const f = (v) => {
          const s = v / 255;
          return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
        };
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
      };
      const ratio = (a, b) => {
        const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
        return (hi + 0.05) / (lo + 0.05);
      };

      const out = [];
      for (const chip of document.querySelectorAll('.taskpro-chip, .taskpro-reminder-priority')) {
        const label = chip.querySelector('.taskpro-chip__label');
        if (!label) continue;
        const chipStyle = getComputedStyle(chip);
        const effectiveBg = over(parse(chipStyle.backgroundColor), backdropOf(chip));
        const ink = over(parse(getComputedStyle(label).color), effectiveBg);
        const name =
          chip.dataset.status ?? chip.dataset.priority ?? chip.dataset.state ??
          chip.dataset.repeat ?? chip.dataset.progress ?? 'chip';
        const kind = [...chip.classList].find((c) => c.startsWith('taskpro-') && (c.endsWith('-badge') || c.endsWith('-priority')));
        out.push({
          what: `${(kind ?? 'chip').replace('taskpro-', '').replace('-badge', '')}:${name}`,
          text: label.textContent.trim().slice(0, 18),
          ratio: Math.round(ratio(ink, effectiveBg) * 100) / 100,
        });
      }
      return out;
    });

    // One row per distinct chip variant; the strips repeat some of them.
    const seen = new Map();
    for (const r of results) if (!seen.has(r.what)) seen.set(r.what, r);
    const rows = [...seen.values()].sort((a, b) => a.ratio - b.ratio);
    const worst = rows[0];
    const below = rows.filter((r) => r.ratio < AA);
    failures += below.length;

    console.log(`\n${testCase.label}  —  ${rows.length} variants, worst ${worst.ratio}:1`);
    for (const r of below) console.log(`   BELOW AA  ${r.ratio.toFixed(2)}:1  ${r.what}  "${r.text}"`);
    if (!below.length) console.log(`   all ${rows.length} variants pass AA (>= ${AA}:1)`);
    await page.close();
  }
} finally {
  await browser.close();
}

if (failures) {
  console.error(`\n${failures} chip variant(s) below ${AA}:1`);
  process.exit(1);
}
console.log(`\nCONTRAST_OK — every chip variant meets AA on every theme checked`);
