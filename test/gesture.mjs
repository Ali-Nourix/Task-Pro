/**
 * The two-finger swipe that opens the task board: what counts as one and what
 * does not (a scroll, a pinch, a third finger, a slow drag), with a fake page
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
  const swipes = [];
  const stop = watchTwoFingerSwipe(target, { enabled: () => enabled, onSwipeDown: () => swipes.push(clock.now) }, () => clock.now);
  const fire = (type, ...fingers) => handlers[type]?.({ touches: fingers.map(([clientX, clientY]) => ({ clientX, clientY })) });
  return { handlers, clock, swipes, stop, fire, setEnabled: (value) => (enabled = value) };
}

// Two fingers pulled straight down, quickly.
let w = world();
w.fire('touchstart', [100, 300], [220, 300]);
w.clock.now = 120;
w.fire('touchmove', [102, 360], [222, 362]);
eq(w.swipes.length, 0, 'not yet far enough');
w.clock.now = 220;
w.fire('touchmove', [104, 420], [224, 424]);
eq(w.swipes, [220], 'two fingers pulled down open it');
w.fire('touchmove', [104, 520], [224, 524]);
eq(w.swipes.length, 1, 'and only once for one gesture');
w.fire('touchend');

// A finger and nothing else is a scroll.
w = world();
w.fire('touchstart', [100, 300]);
w.fire('touchmove', [100, 500]);
eq(w.swipes.length, 0, 'one finger is a scroll');

// Two fingers up is not down.
w = world();
w.fire('touchstart', [100, 500], [220, 500]);
w.clock.now = 150;
w.fire('touchmove', [100, 380], [220, 380]);
eq(w.swipes.length, 0, 'upwards is not it');

// Slanted: mostly across.
w = world();
w.fire('touchstart', [100, 300], [220, 300]);
w.clock.now = 150;
w.fire('touchmove', [260, 420], [380, 420]);
eq(w.swipes.length, 0, 'a slanted drag is not it');

// A pinch that leans down.
w = world();
w.fire('touchstart', [100, 300], [300, 300]);
w.clock.now = 150;
w.fire('touchmove', [190, 420], [210, 420]);
eq(w.swipes.length, 0, 'a pinch is not it');

// Only one finger goes down.
w = world();
w.fire('touchstart', [100, 300], [220, 300]);
w.clock.now = 150;
w.fire('touchmove', [100, 460], [220, 304]);
eq(w.swipes.length, 0, 'both fingers have to go');

// Too slow.
w = world();
w.fire('touchstart', [100, 300], [220, 300]);
w.clock.now = 1000;
w.fire('touchmove', [100, 460], [220, 460]);
eq(w.swipes.length, 0, 'a slow drag is not it');

// A third finger.
w = world();
w.fire('touchstart', [100, 300], [220, 300], [340, 300]);
w.clock.now = 150;
w.fire('touchmove', [100, 460], [220, 460], [340, 460]);
eq(w.swipes.length, 0, 'three fingers are another gesture');

// The setting.
w = world(false);
w.fire('touchstart', [100, 300], [220, 300]);
w.clock.now = 150;
w.fire('touchmove', [100, 460], [220, 460]);
eq(w.swipes.length, 0, 'off, it does nothing');
w.setEnabled(true);
w.clock.now = 0;
w.fire('touchstart', [100, 300], [220, 300]);
w.clock.now = 150;
w.fire('touchmove', [100, 460], [220, 460]);
eq(w.swipes.length, 1, 'and on again, with no restart');

// Stopping it.
w = world();
w.stop();
eq(Object.keys(w.handlers), [], 'stopping takes every listener away');

console.log(`GESTURE_OK (${checked} checks)`);
