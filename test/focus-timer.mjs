/**
 * Focus-timer bookkeeping. The point of these checks is that remaining time is
 * always derived from wall-clock stamps, so a timer survives a reload instead
 * of being counted down in memory.
 */
import * as esbuild from 'esbuild';

const build = await esbuild.build({
  stdin: {
    contents: `export { timerRemainingSeconds, timerSpentSeconds, timerState, formatTimerClock } from "../src/types";`,
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

const { timerRemainingSeconds, timerSpentSeconds, timerState, formatTimerClock } = await import(
  'data:text/javascript;base64,' + Buffer.from(build.outputFiles[0].text).toString('base64')
);

let checked = 0;
const eq = (actual, expected, label) => {
  if (actual !== expected) throw new Error(`${label}: got ${actual}, expected ${expected}`);
  checked++;
};

const MINUTE = 60_000;
const now = Date.UTC(2026, 7, 28, 12, 0, 0);

// A timer that has never been started.
const fresh = { enabled: true, durationSeconds: 25 * 60, elapsedSeconds: 0, runningSince: 0 };
eq(timerState(fresh, now), 'idle', 'never started');
eq(timerRemainingSeconds(fresh, now), 1500, 'full duration remains');
eq(timerSpentSeconds(fresh, now), 0, 'nothing spent');

// Running for ten minutes: the elapsed time comes from the clock, not a counter.
const running = { ...fresh, runningSince: now - 10 * MINUTE };
eq(timerState(running, now), 'running', 'running');
eq(timerRemainingSeconds(running, now), 900, '15 minutes left');
eq(timerSpentSeconds(running, now), 600, '10 minutes spent');

// Paused after those ten minutes, then resumed five minutes later.
const paused = { ...fresh, elapsedSeconds: 600, runningSince: 0 };
eq(timerState(paused, now), 'paused', 'paused');
eq(timerRemainingSeconds(paused, now), 900, 'paused time does not drain');
const resumed = { ...paused, runningSince: now - 5 * MINUTE };
eq(timerRemainingSeconds(resumed, now), 600, 'resumed run adds to the banked time');

// Obsidian was closed for an hour with the timer running: it comes back expired
// rather than picking up where the in-memory counter left off.
const acrossRestart = { ...fresh, runningSince: now - 60 * MINUTE };
eq(timerState(acrossRestart, now), 'done', 'expired while the app was closed');
eq(timerRemainingSeconds(acrossRestart, now) < 0, true, 'overrun is negative');

// A completed timer stays completed even if its stamps would say otherwise.
eq(timerState({ ...fresh, completedAt: now }, now), 'done', 'completedAt wins');

// Clock formatting
eq(formatTimerClock(1500), '25:00', 'mm:ss');
eq(formatTimerClock(59), '0:59', 'under a minute');
eq(formatTimerClock(3661), '1:01:01', 'h:mm:ss');
eq(formatTimerClock(-90), '-1:30', 'overrun is signed');
eq(formatTimerClock(0), '0:00', 'zero');

console.log(`FOCUS_TIMER_OK (${checked} checks)`);
