/**
 * Tag markers: parsing, writing, stripping, and the tag list helpers. Also
 * checks that adding a tag never changes a task's identity, since the sync
 * manager and the creation index both key on the stripped text.
 */
import * as esbuild from 'esbuild';

const build = await esbuild.build({
  stdin: {
    contents: `
      export { extractTags, setTags, stripTags, normalizeTagKey, replaceTaskText, stripTaskMetadata } from "../src/task-metadata";
      export { parseTaskLine } from "../src/task-identity";
      export { parseTasksWithHierarchy, taskToMarkdown } from "../src/task-parser";
      export { createTag, uniqueTagKey, nextTagColor, resolveTag, resolveTagColor, sanitizeTags } from "../src/tags";
    `,
    resolveDir: new URL('.', import.meta.url).pathname,
    loader: 'ts',
  },
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
  plugins: [
    {
      name: 'mock-obsidian',
      setup(b) {
        b.onResolve({ filter: /^obsidian$/ }, () => ({ path: 'obsidian', namespace: 'mock' }));
        b.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({ contents: 'export const setIcon = () => {};', loader: 'js' }));
      },
    },
  ],
});

const mod = await import(
  'data:text/javascript;base64,' + Buffer.from(build.outputFiles[0].text).toString('base64')
);
const {
  extractTags, setTags, stripTags, normalizeTagKey, replaceTaskText, stripTaskMetadata,
  parseTaskLine, parseTasksWithHierarchy, taskToMarkdown, createTag, uniqueTagKey, nextTagColor, resolveTag, resolveTagColor, sanitizeTags,
} = mod;

let checked = 0;
const eq = (actual, expected, label) => {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${label}: got ${a}, expected ${e}`);
  checked++;
};

// ── keys ───────────────────────────────────────────────────────────────────
eq(normalizeTagKey('Deep Work'), 'deep-work', 'spaces become hyphens, lowercase');
eq(normalizeTagKey('  client/Acme  '), 'client/acme', 'nested keys keep their slash');
eq(normalizeTagKey('کار روزانه'), 'کار-روزانه', 'Persian keys survive');
eq(normalizeTagKey('چک‌لیست'), 'چک‌لیست', 'zero-width non-joiner is kept inside a Persian word');
eq(normalizeTagKey('a(b)c, d'), 'abc-d', 'marker punctuation is dropped');
eq(normalizeTagKey('---'), '', 'nothing left means no key');

// ── parsing ────────────────────────────────────────────────────────────────
eq(extractTags('- [ ] Draft @tag(work)'), ['work'], 'single tag');
eq(extractTags('- [ ] Draft @tag(work, client-a) @due(2026-09-30)'), ['work', 'client-a'], 'list beside a deadline');
eq(extractTags('- [ ] Draft @tag(work) @tag(Work, home) ^abc'), ['work', 'home'], 'several markers merge without duplicates');
eq(extractTags('- [ ] خرید @tag(خانه)'), ['خانه'], 'Persian key');
eq(extractTags('- [ ] Nothing here #work'), [], 'native #tags are not TaskPro tags');
eq(extractTags('- [ ] Empty @tag()'), [], 'empty marker');

// ── writing ────────────────────────────────────────────────────────────────
eq(setTags('- [ ] Draft', ['work']), '- [ ] Draft @tag(work)', 'adds a marker');
eq(setTags('- [ ] Draft @tag(a) @due(2026-09-30) ^abc123', ['a', 'b']), '- [ ] Draft @due(2026-09-30) @tag(a, b) ^abc123', 'rewrites as one marker, block id stays last');
eq(setTags('  - [ ] Nested @tag(a)', []), '  - [ ] Nested', 'clearing keeps indentation');
eq(setTags('- [ ] Draft', ['Deep Work', 'deep-work']), '- [ ] Draft @tag(deep-work)', 'keys are normalised and deduplicated');
eq(stripTags('- [ ] A @tag(x) B'), '- [ ] A B', 'strip collapses the gap');

// ── identity ───────────────────────────────────────────────────────────────
const plain = parseTaskLine('- [ ] Write the report @due(2026-09-30)');
const tagged = parseTaskLine('- [ ] Write the report @due(2026-09-30) @tag(work)');
eq(tagged.text, plain.text, 'a tag does not change the task title');
eq(stripTaskMetadata('Write @priority(high) @repeat(1w) @tag(a) [progress:: 1/3] @due(2026-01-01)'), 'Write', 'one helper strips every marker');

// ── importing ──────────────────────────────────────────────────────────────
const [imported] = parseTasksWithHierarchy('- [ ] Plan the week @tag(work) @due(2026-09-30)\n  - [ ] Book a room @tag(work, home)');
eq(imported.content, 'Plan the week', 'the import list shows the title without the marker');
eq(imported.customTags, ['work'], 'parsed tags');
eq(taskToMarkdown(imported), '- [ ] Plan the week @tag(work)\n  - [ ] Book a room @tag(work, home)\n', 'an imported copy keeps its tags');

// ── replacing the title ────────────────────────────────────────────────────
eq(
  replaceTaskText('\t- [/] Old title @priority(high) @tag(work) ^abc123', 'New title'),
  '\t- [/] New title @priority(high) @tag(work) ^abc123',
  'title changes, markers and block id stay'
);
eq(
  replaceTaskText('- [ ] Old @due(2026-09-30) words @tag(a)', '  Spaced   out  '),
  '- [ ] Spaced out @due(2026-09-30) @tag(a)',
  'markers gathered in order, whitespace collapsed'
);
eq(replaceTaskText('Not a task', 'x'), 'Not a task', 'non-task lines are left alone');

// ── tag list ───────────────────────────────────────────────────────────────
const list = [{ key: 'work', name: 'Work', color: 'blue' }];
eq(uniqueTagKey('Work', list), 'work-2', 'key collision gets a suffix');
eq(createTag('  Home  ', list).key, 'home', 'new tag key from name');
eq(createTag('Home', list).name, 'Home', 'name is trimmed, case kept');
eq(nextTagColor(list), 'red', 'next colour skips ones already used');
eq(createTag('X', list, '#12ab34').color, '#12ab34', 'custom hex colour accepted');
eq(createTag('X', list, 'not-a-colour').color, 'red', 'invalid colour falls back to the palette');
eq(resolveTag('ghost', list), { key: 'ghost', name: 'ghost', color: 'gray', unknown: true }, 'unknown key resolves to a neutral chip');
eq(resolveTagColor('blue'), 'var(--color-blue, #2f6fbd)', 'palette colour maps to the theme variable');
eq(resolveTagColor('#abcdef'), '#abcdef', 'hex passes through');
eq(
  sanitizeTags([{ key: 'Work', name: '', color: 'nope' }, { key: 'work', name: 'Dup', color: 'red' }, null, { name: 'no key' }]),
  [{ key: 'work', name: 'work', color: 'gray' }],
  'saved data is cleaned: key normalised, duplicate and malformed entries dropped'
);

console.log(`TAGS_OK (${checked} checks)`);
