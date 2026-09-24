/**
 * Bundles test/harness/board-preview.ts for test/board-preview.html, with the
 * `obsidian` module swapped for test/harness/obsidian-stub.ts and Lucide's
 * icon paths baked in.
 *
 * Lucide is not a dependency of the plugin (Obsidian ships it). Install it on
 * demand next to Playwright:
 *
 *   npm i --no-save lucide-static
 *
 * or point LUCIDE_STATIC_DIR at an existing copy of the package.
 */
import * as esbuild from 'esbuild';
import { createRequire } from 'module';
import { readdir, readFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));

function lucideDir() {
  if (process.env.LUCIDE_STATIC_DIR) return process.env.LUCIDE_STATIC_DIR;
  try {
    return path.dirname(createRequire(import.meta.url).resolve('lucide-static/package.json'));
  } catch {
    throw new Error('lucide-static is not installed. Run `npm i --no-save lucide-static` or set LUCIDE_STATIC_DIR.');
  }
}

async function loadIcons() {
  const dir = path.join(lucideDir(), 'icons');
  const icons = {};
  for (const file of await readdir(dir)) {
    if (!file.endsWith('.svg')) continue;
    const svg = await readFile(path.join(dir, file), 'utf8');
    const body = svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '').replace(/\s+/g, ' ').trim();
    icons[file.slice(0, -4)] = body;
  }
  return icons;
}

export async function buildHarness() {
  const icons = await loadIcons();
  await esbuild.build({
    entryPoints: [path.join(here, 'board-preview.ts')],
    outfile: path.join(here, 'board-preview.bundle.js'),
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2020',
    define: { __LUCIDE__: JSON.stringify(icons) },
    plugins: [
      {
        name: 'obsidian-stub',
        setup(build) {
          build.onResolve({ filter: /^obsidian$/ }, () => ({ path: path.join(here, 'obsidian-stub.ts') }));
        },
      },
    ],
    logLevel: 'warning',
  });
  return Object.keys(icons).length;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const count = await buildHarness();
  console.log(`board-preview.bundle.js built with ${count} Lucide icons`);
}
