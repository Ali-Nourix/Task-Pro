// ── ui/sheet.ts ───────────────────────────────────────────────────────────
// On a phone, what opens beside things on a desktop (a menu, a task's card,
// a picker) rises from the bottom of the screen instead, where a thumb
// reaches: full width, with a handle to drag it down by, the content behind
// dimmed, and a tap on the dimmed part to put it away. One at a time.
//
// The board decides when it is "compact" (narrow, or on a touch screen) and
// marks its root; everything that opens inside it asks the root.
// ─────────────────────────────────────────────────────────────────────────────

/** Whether panels opened inside this element should be sheets. */
export function wantsSheet(container: HTMLElement): boolean {
  return !!container.closest('.taskpro-board.is-compact');
}

/** Travel, in pixels, past which letting go of a dragged sheet closes it. */
const DISMISS_DISTANCE = 80;
/** Or a flick faster than this, in pixels per millisecond. */
const DISMISS_SPEED = 0.6;

/**
 * Turns an element placed in `container` into a bottom sheet: a dimmed
 * backdrop behind it, and a handle at its top that drags it down to close.
 * Returns what undoes it, for when the panel closes some other way.
 */
export function makeSheet(el: HTMLElement, container: HTMLElement, close: () => void): () => void {
  el.addClass('is-sheet');
  const backdrop = container.createDiv({ cls: 'taskpro-sheet-backdrop' });
  // Behind the sheet: placed before it in the board.
  container.insertBefore(backdrop, el);
  const grabber = createDiv({ cls: 'taskpro-sheet-grabber' });
  grabber.createSpan({ cls: 'taskpro-sheet-grabber__bar' });
  el.prepend(grabber);

  let startY = 0;
  let startAt = 0;
  let dragging = false;
  let dy = 0;
  const onDown = (event: PointerEvent) => {
    // The handle, or the sheet's top edge above its scrolled content.
    if (event.button !== 0) return;
    dragging = true;
    startY = event.clientY;
    startAt = performance.now();
    dy = 0;
    el.addClass('is-dragging');
    grabber.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  };
  const onMove = (event: PointerEvent) => {
    if (!dragging) return;
    dy = Math.max(0, event.clientY - startY);
    el.style.transform = `translateY(${dy}px)`;
    backdrop.style.opacity = String(Math.max(0, 1 - dy / 300));
  };
  const onUp = () => {
    if (!dragging) return;
    dragging = false;
    el.removeClass('is-dragging');
    const speed = dy / Math.max(1, performance.now() - startAt);
    if (dy > DISMISS_DISTANCE || speed > DISMISS_SPEED) {
      close();
      return;
    }
    el.style.transform = '';
    backdrop.style.opacity = '';
  };
  grabber.addEventListener('pointerdown', onDown);
  grabber.addEventListener('pointermove', onMove);
  grabber.addEventListener('pointerup', onUp);
  grabber.addEventListener('pointercancel', onUp);
  // A tap on what is behind puts the sheet away.
  backdrop.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    event.stopPropagation();
    close();
  });

  return () => {
    grabber.remove();
    // Left behind for a moment, fading, so the tap that closed the sheet
    // does not land as a click on whatever was under it.
    backdrop.addClass('is-leaving');
    window.setTimeout(() => backdrop.remove(), 260);
  };
}

/** Empties a panel that may be a sheet, keeping the sheet's handle. */
export function emptyPanel(el: HTMLElement): void {
  for (const child of Array.from(el.children)) {
    if (!child.hasClass('taskpro-sheet-grabber')) child.remove();
  }
  for (const node of Array.from(el.childNodes)) if (node.nodeType === Node.TEXT_NODE) node.remove();
}
