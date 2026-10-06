// ── ui/touch.ts ───────────────────────────────────────────────────────────
// Touch has no right click and no hover, and a finger moving across the
// board is scrolling it, not dragging what is under it. So on a touch
// screen a long press stands in for the right click, and anything that can
// be dragged is picked up by holding it still for a moment first; a finger
// that moves right away scrolls, as everywhere else on the phone.
// ─────────────────────────────────────────────────────────────────────────────

/** How long a finger rests before a press becomes a long press, in milliseconds. */
const HOLD_MS = 420;
/** How far it may drift meanwhile, in pixels. */
const SLOP = 9;

function buzz(): void {
  try {
    navigator.vibrate?.(8);
  } catch {
    // Vibration is a nicety; some webviews refuse it.
  }
}

/**
 * Opens a context menu on a right click, and on a touch screen on a long
 * press as well. `open` is told where. The click and the system's own
 * menu that follow a long press are swallowed, so the press does one thing.
 */
export function onContextPress(el: HTMLElement, open: (at: { x: number; y: number }) => void): void {
  let pressedAt = 0;
  el.addEventListener('contextmenu', (event) => {
    if ((event.target as HTMLElement).closest('input, textarea')) return;
    event.preventDefault();
    event.stopPropagation();
    // Android fires its own after our long press; that one is already handled.
    if (Date.now() - pressedAt < 900) return;
    open({ x: event.clientX, y: event.clientY });
  });
  el.addEventListener('pointerdown', (event) => {
    if (event.pointerType !== 'touch' || (event.target as HTMLElement).closest('input, textarea, .taskpro-no-hold')) return;
    const x = event.clientX;
    const y = event.clientY;
    const doc = el.ownerDocument;
    const timer = window.setTimeout(() => {
      cleanup();
      pressedAt = Date.now();
      buzz();
      const swallow = (e: Event) => {
        e.preventDefault();
        e.stopPropagation();
      };
      doc.addEventListener('click', swallow, { capture: true, once: true });
      window.setTimeout(() => doc.removeEventListener('click', swallow, true), 900);
      open({ x, y });
    }, HOLD_MS);
    const onMove = (e: PointerEvent) => {
      if (Math.hypot(e.clientX - x, e.clientY - y) > SLOP || fingers > 1) cleanup();
    };
    const cleanup = () => {
      window.clearTimeout(timer);
      doc.removeEventListener('pointermove', onMove, true);
      doc.removeEventListener('pointerup', cleanup, true);
      doc.removeEventListener('pointercancel', cleanup, true);
      doc.removeEventListener('pointerdown', second, true);
    };
    // A second finger is not a long press.
    const second = (e: PointerEvent) => {
      if (!e.isPrimary) cleanup();
    };
    doc.addEventListener('pointermove', onMove, true);
    doc.addEventListener('pointerup', cleanup, true);
    doc.addEventListener('pointercancel', cleanup, true);
    doc.addEventListener('pointerdown', second, true);
  });
}

/** How many fingers are on the screen. Two fingers are a gesture of their own, and what a finger is doing alone stops. */
let fingers = 0;

export function fingersDown(): number {
  return fingers;
}

/** How many things a finger is carrying: while there is one, the page does not scroll under it. */
let carrying = 0;
const ready = new WeakSet<Document>();

/**
 * A page decides whether a touch may scroll from the touch handlers it has at
 * the moment the finger goes down; one added later, once the finger has
 * rested long enough to pick something up, comes too late for that touch, and
 * the first movement scrolls the page before the handler can stop it. So the
 * handler is put on once, early, and does nothing until something is being
 * carried.
 */
export function readyToCarry(doc: Document): void {
  if (ready.has(doc)) return;
  ready.add(doc);
  const count = (event: TouchEvent) => {
    fingers = event.touches.length;
  };
  doc.addEventListener('touchstart', count, { capture: true, passive: true });
  doc.addEventListener('touchend', count, { capture: true, passive: true });
  doc.addEventListener('touchcancel', () => (fingers = 0), { capture: true, passive: true });
  doc.addEventListener(
    'touchmove',
    (event) => {
      if (carrying > 0 && event.cancelable) event.preventDefault();
    },
    { passive: false }
  );
}

/**
 * Starts a drag the way the input expects: a mouse or pen at once, a finger
 * only once it has been held still. While a finger drag lasts, the page
 * does not scroll under it. `start` is not called for a press that turned
 * into a scroll or ended early.
 */
export function holdToDrag(event: PointerEvent, start: () => void): void {
  if (event.pointerType !== 'touch') {
    start();
    return;
  }
  const doc = (event.target as HTMLElement).ownerDocument;
  readyToCarry(doc);
  const x = event.clientX;
  const y = event.clientY;
  const timer = window.setTimeout(() => {
    cleanup();
    buzz();
    carrying++;
    // The drag may redraw what the finger started on, and a touch whose
    // element has gone ends without telling the page; so the next touch, or
    // the pointer's own end, lets scrolling go as well.
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      carrying = Math.max(0, carrying - 1);
      doc.removeEventListener('touchend', release, true);
      doc.removeEventListener('touchcancel', release, true);
      doc.removeEventListener('touchstart', release, true);
      doc.removeEventListener('pointerup', release, true);
      doc.removeEventListener('pointercancel', release, true);
    };
    doc.addEventListener('touchend', release, true);
    doc.addEventListener('touchcancel', release, true);
    doc.addEventListener('touchstart', release, true);
    doc.addEventListener('pointerup', release, true);
    doc.addEventListener('pointercancel', release, true);
    // The system's long press fires a context menu of its own, which would
    // open the task's menu over the drag; it is stopped before it gets there.
    const noMenu = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
    };
    doc.addEventListener('contextmenu', noMenu, true);
    window.setTimeout(() => doc.removeEventListener('contextmenu', noMenu, true), 1200);
    start();
  }, HOLD_MS);
  const onMove = (e: PointerEvent) => {
    if (Math.hypot(e.clientX - x, e.clientY - y) > SLOP || fingers > 1) cleanup();
  };
  const cleanup = () => {
    window.clearTimeout(timer);
    doc.removeEventListener('pointermove', onMove, true);
    doc.removeEventListener('pointerup', cleanup, true);
    doc.removeEventListener('pointercancel', cleanup, true);
    doc.removeEventListener('pointerdown', second, true);
  };
  // A second finger is not a pick-up.
  const second = (e: PointerEvent) => {
    if (!e.isPrimary) cleanup();
  };
  doc.addEventListener('pointermove', onMove, true);
  doc.addEventListener('pointerup', cleanup, true);
  doc.addEventListener('pointercancel', cleanup, true);
  doc.addEventListener('pointerdown', second, true);
}
