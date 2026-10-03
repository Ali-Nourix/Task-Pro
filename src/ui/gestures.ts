// ── ui/gestures.ts ────────────────────────────────────────────────────────
// A gesture for getting to the task board from anywhere, with one hand on a
// phone and nothing to find on the screen: put two fingers down together and
// pull them down. Nothing happens while the fingers are on the screen but a
// hint that follows them (how far to go, then "release to open"); the board
// opens when both are lifted, and pulling back up before lifting changes
// your mind. It has to be a clear move to count (both fingers go down the
// same way, a good way, quickly, and mostly straight), so an ordinary scroll,
// a pinch or a stray second finger does not trigger it.
// ─────────────────────────────────────────────────────────────────────────────

/** How the pull stands: how far along (0 to 1), and whether letting go now would open it. */
export interface Pull {
  progress: number;
  armed: boolean;
}

export interface TwoFingerSwipeOptions {
  /** Asked at the start of each gesture, so the setting can change while it is running. */
  enabled(): boolean;
  /** Once, when both fingers have been lifted after a pull that counted. */
  onSwipeDown(): void;
  /** While two fingers pull: how it stands. Null when it is over, one way or the other. */
  onPull?(pull: Pull | null): void;
}

/** Fingers, as the touch events carry them. */
interface Point {
  clientX: number;
  clientY: number;
}
interface TouchLikeEvent {
  touches: ArrayLike<Point>;
  cancelable?: boolean;
  preventDefault?(): void;
}

/** How far both fingers must travel, how straight, and how long (ms) they may take: a pull, not a rest. */
export const SWIPE_DISTANCE = 90;
export const SWIPE_STRAIGHTNESS = 1.6;
export const SWIPE_TIME = 2500;

/** What `document` is, to the extent this needs: a thing that takes listeners. */
interface Target {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  addEventListener(type: string, listener: (event: any) => void, options?: AddEventListenerOptions | boolean): void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  removeEventListener(type: string, listener: (event: any) => void, options?: EventListenerOptions | boolean): void;
}

/**
 * Listens on `target` and calls `onSwipeDown` once per gesture, when the
 * fingers are lifted. Returns what stops it. `now` is a clock in
 * milliseconds, for tests.
 */
export function watchTwoFingerSwipe(target: Target, options: TwoFingerSwipeOptions, now: () => number = () => performance.now()): () => void {
  let from: Point[] | null = null;
  let at = 0;
  let armed = false;
  let shown = false;

  const reset = () => {
    from = null;
    armed = false;
    if (shown) options.onPull?.(null);
    shown = false;
  };

  const start = (event: TouchLikeEvent) => {
    // Exactly two fingers begin one (and two put down again after one was lifted begin it afresh).
    if (event.touches.length === 2 && options.enabled()) {
      reset();
      from = [copy(event.touches[0]), copy(event.touches[1])];
      at = now();
      return;
    }
    // A third finger is another gesture.
    if (event.touches.length > 2) reset();
  };

  const move = (event: TouchLikeEvent) => {
    if (!from || event.touches.length !== 2) return;
    if (now() - at > SWIPE_TIME) {
      reset();
      return;
    }
    const down = [0, 1].map((i) => event.touches[i].clientY - from![i].clientY);
    const across = [0, 1].map((i) => event.touches[i].clientX - from![i].clientX);
    const straight = [0, 1].every((i) => down[i] > Math.abs(across[i]) * SWIPE_STRAIGHTNESS);
    const average = (down[0] + down[1]) / 2;
    // Two fingers coming together or going apart is a pinch, whichever way it also leans.
    const gap = (points: ArrayLike<Point>) => Math.hypot(points[0].clientX - points[1].clientX, points[0].clientY - points[1].clientY);
    const pinched = Math.abs(gap(event.touches) - gap(from)) > SWIPE_DISTANCE * 0.8;
    // Counted afresh at every move, so pulling back up before letting go takes it back.
    armed = down.every((d) => d > SWIPE_DISTANCE * 0.6) && average >= SWIPE_DISTANCE && straight && !pinched;
    if (straight && !pinched && average > 24) {
      // The page under the fingers is not to scroll with them.
      if (event.cancelable) event.preventDefault?.();
      shown = true;
      options.onPull?.({ progress: Math.max(0, Math.min(1, average / SWIPE_DISTANCE)), armed });
    } else if (shown) {
      shown = false;
      options.onPull?.(null);
    }
  };

  const end = (event: TouchLikeEvent) => {
    if (!from) return;
    // One finger up and one still down: it is not over until both are.
    if (event.touches.length > 0) return;
    const open = armed;
    reset();
    if (open) options.onSwipeDown();
  };

  const cancel = () => reset();

  target.addEventListener('touchstart', start, { passive: true, capture: true });
  target.addEventListener('touchmove', move, { passive: false, capture: true });
  target.addEventListener('touchend', end, { passive: true, capture: true });
  target.addEventListener('touchcancel', cancel, { passive: true, capture: true });
  return () => {
    target.removeEventListener('touchstart', start, { capture: true });
    target.removeEventListener('touchmove', move, { capture: true });
    target.removeEventListener('touchend', end, { capture: true });
    target.removeEventListener('touchcancel', cancel, { capture: true });
    reset();
  };
}

function copy(point: Point): Point {
  return { clientX: point.clientX, clientY: point.clientY };
}
