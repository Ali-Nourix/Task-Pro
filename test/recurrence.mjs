/**
 * Date maths for repeating tasks, checked against fixed "today" values so the
 * results do not drift with the calendar.
 */
import * as esbuild from 'esbuild';

const build = await esbuild.build({
  stdin: {
    contents: `export { extractRepeat, setRepeat, stripRepeat, stripRepeatPreserveIndent, nextRepeatDate } from "../src/task-metadata";`,
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
const { extractRepeat, setRepeat, stripRepeat, stripRepeatPreserveIndent, nextRepeatDate } = mod;

let checked = 0;
const eq = (actual, expected, label) => {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${label}: got ${a}, expected ${e}`);
  checked++;
};

// ── parsing ────────────────────────────────────────────────────────────────
eq(extractRepeat('- [ ] Water plants @repeat(1w)'), { every: 1, unit: 'week' }, 'canonical form');
eq(extractRepeat('- [ ] Water plants @repeat(weekly)'), { every: 1, unit: 'week' }, 'weekly alias');
eq(extractRepeat('- [ ] Standup @repeat(daily) @due(2026-09-01)'), { every: 1, unit: 'day' }, 'daily alias beside a deadline');
eq(extractRepeat('- [ ] Rent @repeat(2 months)'), { every: 2, unit: 'month' }, 'plural unit');
eq(extractRepeat('- [ ] Review @repeat(3d) ^abc123'), { every: 3, unit: 'day' }, 'before a block id');
eq(extractRepeat('- [ ] Nothing here'), undefined, 'no marker');
eq(extractRepeat('- [ ] Bad @repeat(0d)'), undefined, 'zero interval is not a rule');

// ── writing ────────────────────────────────────────────────────────────────
eq(setRepeat('- [ ] Water plants', { every: 1, unit: 'week' }), '- [ ] Water plants @repeat(1w)', 'adds a marker');
eq(setRepeat('- [ ] Water plants @repeat(daily) ^abc123', { every: 3, unit: 'day' }), '- [ ] Water plants @repeat(3d) ^abc123', 'rewrites in place, block id stays last');
eq(setRepeat('  - [ ] Nested @repeat(1w)', null), '  - [ ] Nested', 'clearing keeps indentation');
eq(stripRepeat('- [ ] A @repeat(1m) B'), '- [ ] A B', 'strip collapses the gap');
eq(stripRepeatPreserveIndent('\t- [ ] A @repeat(1m)'), '\t- [ ] A', 'indent-preserving strip');

// ── next occurrence ────────────────────────────────────────────────────────
// Counting from the old deadline keeps a weekly task on its weekday even when
// it is ticked off two days late.
eq(nextRepeatDate({ every: 1, unit: 'week' }, '2026-08-26', new Date(2026, 7, 28)), '2026-09-02', 'weekly counts from the deadline');
// A long-neglected daily lands tomorrow, not back in July.
eq(nextRepeatDate({ every: 1, unit: 'day' }, '2026-07-01', new Date(2026, 7, 28)), '2026-08-29', 'stale deadline catches up');
// With no deadline set, today is the starting point.
eq(nextRepeatDate({ every: 1, unit: 'week' }, undefined, new Date(2026, 7, 28)), '2026-09-04', 'weekly from today');
eq(nextRepeatDate({ every: 2, unit: 'week' }, undefined, new Date(2026, 7, 28)), '2026-09-11', 'fortnightly from today');
// Month arithmetic clamps instead of spilling into the following month.
eq(nextRepeatDate({ every: 1, unit: 'month' }, '2026-01-31', new Date(2026, 0, 31)), '2026-02-28', 'month end clamps');
eq(nextRepeatDate({ every: 1, unit: 'month' }, '2026-03-15', new Date(2026, 2, 15)), '2026-04-15', 'month keeps the day');

console.log(`RECURRENCE_OK (${checked} checks)`);
