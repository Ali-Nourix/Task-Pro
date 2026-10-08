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

  // A vertical wheel scrolls the row sideways, but only while there is room
  // to go that way, so the note still scrolls once the row reaches its end.
  const onWheel = (event: WheelEvent) => {
    if (event.ctrlKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
    const max = row.scrollWidth - row.clientWidth;
    if (max <= 1 || !event.deltaY) return;
    const before = row.scrollLeft;
    row.scrollLeft += event.deltaY;
    if (row.scrollLeft !== before) {
      event.preventDefault();
      schedule();
    }
  };

  // Keyboard focus moving onto a chip that is out of view brings it in.
  const onFocus = (event: FocusEvent) => {
    const target = event.target as HTMLElement | null;
    target?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
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
