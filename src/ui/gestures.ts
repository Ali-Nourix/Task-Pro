// ── ui/gestures.ts ────────────────────────────────────────────────────────
// A gesture for getting to the task board from anywhere, with one hand on a
// phone and nothing to find on the screen: put two fingers down together and
// pull them down. It has to be a clear move to count (both fingers go down
// the same way, a good way, quickly, and mostly straight), so an ordinary
// scroll, a pinch or a stray second finger does not trigger it.
// ─────────────────────────────────────────────────────────────────────────────

export interface TwoFingerSwipeOptions {
  /** Asked at the start of each gesture, so the setting can change while it is running. */
  enabled(): boolean;
  onSwipeDown(): void;
}

/** Fingers, as the touch events carry them. */
interface Point {
  clientX: number;
  clientY: number;
}
interface TouchLikeEvent {
  touches: ArrayLike<Point>;
}

/** How far both fingers must travel, how straight, and how long they may take. */
export const SWIPE_DISTANCE = 90;
export const SWIPE_STRAIGHTNESS = 1.6;
export const SWIPE_TIME = 900;

/** What `document` is, to the extent this needs: a thing that takes listeners. */
interface Target {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  addEventListener(type: string, listener: (event: any) => void, options?: AddEventListenerOptions | boolean): void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  removeEventListener(type: string, listener: (event: any) => void, options?: EventListenerOptions | boolean): void;
}

/**
 * Listens on `target` and calls `onSwipeDown` once per gesture. Returns what
 * stops it. `now` is a clock in milliseconds, for tests.
 */
export function watchTwoFingerSwipe(
  target: Target,
  options: TwoFingerSwipeOptions,
  now: () => number = () => performance.now()
): () => void {
  let from: Point[] | null = null;
  let at = 0;

  const start = (event: TouchLikeEvent) => {
    // Exactly two fingers; a third, or a pinch that began as one, is not this.
    if (event.touches.length !== 2 || !options.enabled()) {
      from = null;
      return;
    }
    from = [copy(event.touches[0]), copy(event.touches[1])];
    at = now();
  };

  const move = (event: TouchLikeEvent) => {
    if (!from) return;
    if (event.touches.length !== 2) {
      from = null;
      return;
    }
    if (now() - at > SWIPE_TIME) {
      from = null;
      return;
    }
    const down = [0, 1].map((i) => event.touches[i].clientY - from![i].clientY);
    const across = [0, 1].map((i) => event.touches[i].clientX - from![i].clientX);
    const bothDown = down.every((d) => d > SWIPE_DISTANCE * 0.6) && (down[0] + down[1]) / 2 >= SWIPE_DISTANCE;
    const straight = [0, 1].every((i) => down[i] > Math.abs(across[i]) * SWIPE_STRAIGHTNESS);
    // Two fingers coming together or going apart is a pinch, whichever way it also leans.
    const gap = (points: ArrayLike<Point> | Point[]) => Math.hypot(points[0].clientX - points[1].clientX, points[0].clientY - points[1].clientY);
    const pinched = Math.abs(gap(event.touches) - gap(from)) > SWIPE_DISTANCE * 0.8;
    if (bothDown && straight && !pinched) {
      from = null;
      options.onSwipeDown();
    }
  };

  const end = () => {
    from = null;
  };

  target.addEventListener('touchstart', start, { passive: true, capture: true });
  target.addEventListener('touchmove', move, { passive: true, capture: true });
  target.addEventListener('touchend', end, { passive: true, capture: true });
  target.addEventListener('touchcancel', end, { passive: true, capture: true });
  return () => {
    target.removeEventListener('touchstart', start, { capture: true });
    target.removeEventListener('touchmove', move, { capture: true });
    target.removeEventListener('touchend', end, { capture: true });
    target.removeEventListener('touchcancel', end, { capture: true });
  };
}

function copy(point: Point): Point {
  return { clientX: point.clientX, clientY: point.clientY };
}
