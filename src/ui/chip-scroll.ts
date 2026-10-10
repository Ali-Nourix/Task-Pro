// ── ui/chip-scroll.ts ─────────────────────────────────────────────────────
// A task's chip row scrolls sideways once it has more chips than room.
//
// The row keeps its size, the scrollbar stays hidden, and an edge that has
// chips beyond it fades out softly instead of cutting a chip in half, so a
// long row reads as "there is more this way" rather than as clutter. The
// mouse wheel scrolls it too, so a desktop without a trackpad can reach the
// chips at the end; on a touch screen it is an ordinary swipe.
// ─────────────────────────────────────────────────────────────────────────────

const SCROLLER_CLASS = 'taskpro-chip-scroll';
const FADE_START = 'is-fade-left';
const FADE_END = 'is-fade-right';

/** How much of the remaining distance a glide covers each frame: an ease-out. */
const EASE = 0.2;

const cleanups = new WeakMap<HTMLElement, () => void>();

/** Which sides have chips beyond the visible part. Works for either writing direction. */
function updateFades(row: HTMLElement): void {
  const box = row.getBoundingClientRect();
  if (!box.width) return;
  let left = Infinity;
  let right = -Infinity;
  for (const child of Array.from(row.children) as HTMLElement[]) {
    if (child.offsetParent === null && getComputedStyle(child).display === 'none') continue;
    const rect = child.getBoundingClientRect();
    if (!rect.width) continue;
    left = Math.min(left, rect.left);
    right = Math.max(right, rect.right);
  }
  const overflowing = row.scrollWidth > row.clientWidth + 1;
  row.classList.toggle('is-overflowing', overflowing);
  row.classList.toggle(FADE_START, overflowing && left < box.left - 1);
  row.classList.toggle(FADE_END, overflowing && right > box.right + 1);
}

/**
 * Makes a chip row scroll sideways when it overflows. Safe to call on a row
 * that is not in the document yet: the fades are worked out once it is laid
 * out. Call {@link releaseChipRow} when the row is thrown away.
 */
export function makeChipRowScrollable(row: HTMLElement): void {
  if (cleanups.has(row)) return;
  row.classList.add(SCROLLER_CLASS);

  let frame = 0;
  const schedule = () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      updateFades(row);
    });
  };

  // A wheel scrolls the row sideways with an eased glide rather than in
  // notches: each turn moves a target, and the row eases towards it frame by
  // frame. Only while there is room to go that way, so the note still scrolls
  // once the row reaches its end. A trackpad's own sideways swipe is already
  // smooth and is left to the browser.
  let target: number | null = null;
  let glide = 0;
  const range = (): [number, number] => {
    // Where the row can scroll to depends on its direction (row-reverse, RTL),
    // so the two ends are read rather than assumed.
    const at = row.scrollLeft;
    row.scrollLeft = -1e7;
    const min = row.scrollLeft;
    row.scrollLeft = 1e7;
    const max = row.scrollLeft;
    row.scrollLeft = at;
    return [min, max];
  };
  const step = () => {
    if (target === null) return void (glide = 0);
    const current = row.scrollLeft;
    const gap = target - current;
    if (Math.abs(gap) < 0.5) {
      row.scrollLeft = target;
      target = null;
      glide = 0;
      schedule();
      return;
    }
    // At least a pixel a frame, so the last of the glide is not lost to rounding.
    const move = Math.sign(gap) * Math.min(Math.abs(gap), Math.max(1, Math.abs(gap) * EASE));
    row.scrollLeft = current + move;
    // A row that cannot move any further (resized, end reached) stops gliding.
    if (row.scrollLeft === current) {
      target = null;
      glide = 0;
      return;
    }
    glide = requestAnimationFrame(step);
  };
  const onWheel = (event: WheelEvent) => {
    if (event.ctrlKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
    if (row.scrollWidth - row.clientWidth <= 1 || !event.deltaY) return;
    const delta = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaMode === 2 ? event.deltaY * row.clientWidth : event.deltaY;
    const [min, max] = range();
    const from = target ?? row.scrollLeft;
    const next = Math.min(max, Math.max(min, from + delta));
    if (Math.abs(next - from) < 0.5) return;
    event.preventDefault();
    if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) {
      row.scrollLeft = next;
      return;
    }
    target = next;
    if (!glide) glide = requestAnimationFrame(step);
  };

  // Keyboard focus moving onto a chip that is out of view brings it in.
  const onFocus = (event: FocusEvent) => {
    const target = event.target as HTMLElement | null;
    const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    target?.scrollIntoView?.({ block: 'nearest', inline: 'nearest', behavior: reduce ? 'auto' : 'smooth' });
    schedule();
  };

  row.addEventListener('scroll', schedule, { passive: true });
  row.addEventListener('wheel', onWheel, { passive: false });
  row.addEventListener('focusin', onFocus);

  const resize = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(schedule) : null;
  resize?.observe(row);
  const mutations = typeof MutationObserver !== 'undefined' ? new MutationObserver(schedule) : null;
  mutations?.observe(row, { childList: true });

  cleanups.set(row, () => {
    if (frame) cancelAnimationFrame(frame);
    if (glide) cancelAnimationFrame(glide);
    row.removeEventListener('scroll', schedule);
    row.removeEventListener('wheel', onWheel);
    row.removeEventListener('focusin', onFocus);
    resize?.disconnect();
    mutations?.disconnect();
  });
  schedule();
}

/** Stops watching a chip row. */
export function releaseChipRow(row: HTMLElement): void {
  cleanups.get(row)?.();
  cleanups.delete(row);
}
