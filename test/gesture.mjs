/**
 * The two-finger pull that opens the task board: nothing happens while the
 * fingers are down but a hint, the board opens when both are lifted, pulling
 * back before lifting changes your mind, and what is not the pull (a scroll, a
 * pinch, one finger going, a slow rest, a third finger) is not it. A fake page
 * and a fake clock.
 */
import * as esbuild from 'esbuild';

const build = await esbuild.build({
  stdin: { contents: `export { watchTwoFingerSwipe } from "../src/ui/gestures";`, resolveDir: new URL('.', import.meta.url).pathname, loader: 'ts' },
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
  logLevel: 'error',
});
const { watchTwoFingerSwipe } = await import('data:text/javascript;base64,' + Buffer.from(build.outputFiles[0].text).toString('base64'));

let checked = 0;
function eq(actual, expected, label) {
  checked++;
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${label}:\n  got      ${a}\n  expected ${e}`);
}

function world(enabled = true) {
  const handlers = {};
  const target = {
    addEventListener: (type, listener) => (handlers[type] = listener),
    removeEventListener: (type) => delete handlers[type],
  };
  const clock = { now: 0 };
  const opened = [];
  const pulls = [];
  const prevented = [];
  const stop = watchTwoFingerSwipe(target, { enabled: () => enabled, onSwipeDown: () => opened.push(clock.now), onPull: (pull) => pulls.push(pull) }, () => clock.now);
  const fire = (type, ...fingers) => handlers[type]?.({ touches: fingers.map(([clientX, clientY]) => ({ clientX, clientY })), cancelable: true, preventDefault: () => prevented.push(type) });
  return { handlers, clock, opened, pulls, prevented, stop, fire, setEnabled: (value) => (enabled = value) };
}

// Two fingers pulled straight down: it opens when they are lifted, not before.
let w = world();
w.fire('touchstart', [100, 300], [220, 300]);
w.clock.now = 120;
w.fire('touchmove', [102, 360], [222, 362]);
eq([w.opened.length, w.pulls.at(-1)?.armed], [0, false], 'part of the way: a hint, nothing opened');
w.clock.now = 220;
w.fire('touchmove', [104, 420], [224, 424]);
eq([w.opened.length, w.pulls.at(-1)?.armed], [0, true], 'far enough: it says it is ready, and still opens nothing');
w.fire('touchmove', [104, 520], [224, 524]);
eq(w.opened.length, 0, 'however far, nothing opens while the fingers are down');
w.fire('touchend', [224, 524]);
eq(w.opened.length, 0, 'one finger lifted, one still down: not yet');
w.clock.now = 400;
w.fire('touchend');
eq(w.opened, [400], 'both lifted: it opens, once');
eq(w.pulls.at(-1), null, 'and the hint goes');
w.fire('touchend');
eq(w.opened.length, 1, 'a stray end opens nothing more');
eq(w.prevented.includes('touchmove'), true, 'the page under the fingers is kept from scrolling while they pull');

// Changing your mind: pulled back before lifting.
w = world();
w.fire('touchstart', [100, 300], [220, 300]);
w.clock.now = 200;
w.fire('touchmove', [100, 440], [220, 440]);
eq(w.pulls.at(-1).armed, true, 'ready');
w.clock.now = 400;
w.fire('touchmove', [100, 330], [220, 330]);
eq(w.pulls.at(-1)?.armed, false, 'pulled back, it is no longer ready');
w.fire('touchend');
eq(w.opened.length, 0, 'and letting go then opens nothing');

// One finger and nothing else is a scroll.
w = world();
w.fire('touchstart', [100, 300]);
w.fire('touchmove', [100, 500]);
w.fire('touchend');
eq([w.opened.length, w.pulls.length], [0, 0], 'one finger is a scroll');

// Two fingers up is not down.
w = world();
w.fire('touchstart', [100, 500], [220, 500]);
w.clock.now = 150;
w.fire('touchmove', [100, 380], [220, 380]);
w.fire('touchend');
eq([w.opened.length, w.pulls.length], [0, 0], 'upwards is not it');

// Slanted: mostly across.
w = world();
w.fire('touchstart', [100, 300], [220, 300]);
w.clock.now = 150;
w.fire('touchmove', [260, 420], [380, 420]);
w.fire('touchend');
eq(w.opened.length, 0, 'a slanted drag is not it');

// A pinch that leans down.
w = world();
w.fire('touchstart', [100, 300], [300, 300]);
w.clock.now = 150;
w.fire('touchmove', [190, 420], [210, 420]);
w.fire('touchend');
eq(w.opened.length, 0, 'a pinch is not it');

// Only one finger goes down.
w = world();
w.fire('touchstart', [100, 300], [220, 300]);
w.clock.now = 150;
w.fire('touchmove', [100, 460], [220, 304]);
w.fire('touchend');
eq(w.opened.length, 0, 'both fingers have to go');

// Too slow: a rest that drifts down.
w = world();
w.fire('touchstart', [100, 300], [220, 300]);
w.clock.now = 3000;
w.fire('touchmove', [100, 460], [220, 460]);
w.fire('touchend');
eq(w.opened.length, 0, 'a drift that takes seconds is not it');

// A third finger.
w = world();
w.fire('touchstart', [100, 300], [220, 300]);
w.clock.now = 100;
w.fire('touchmove', [100, 420], [220, 420]);
w.fire('touchstart', [100, 420], [220, 420], [340, 300]);
w.fire('touchend');
eq(w.opened.length, 0, 'three fingers are another gesture');

// The setting.
w = world(false);
w.fire('touchstart', [100, 300], [220, 300]);
w.clock.now = 150;
w.fire('touchmove', [100, 460], [220, 460]);
w.fire('touchend');
eq([w.opened.length, w.pulls.length], [0, 0], 'off, it does nothing, not even a hint');
w.setEnabled(true);
w.clock.now = 0;
w.fire('touchstart', [100, 300], [220, 300]);
w.clock.now = 150;
w.fire('touchmove', [100, 460], [220, 460]);
w.fire('touchend');
eq(w.opened.length, 1, 'and on again, with no restart');

// Cancelled by the system.
w = world();
w.fire('touchstart', [100, 300], [220, 300]);
w.clock.now = 150;
w.fire('touchmove', [100, 460], [220, 460]);
w.fire('touchcancel');
w.fire('touchend');
eq([w.opened.length, w.pulls.at(-1)], [0, null], 'a touch the system cancels opens nothing');

// Stopping it.
w = world();
w.stop();
eq(Object.keys(w.handlers), [], 'stopping takes every listener away');

console.log(`GESTURE_OK (${checked} checks)`);
