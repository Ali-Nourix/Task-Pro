// ── calendar/calendar-popover.ts ──────────────────────────────────────────
// A small card anchored beside a day, a time slot or a task, like the ones a
// calendar app opens next to what you clicked. It lives inside the board, so
// it sits in the floating window when the board floats and goes when it goes.
// ─────────────────────────────────────────────────────────────────────────────

import { claimEscape } from '../ui/escape-scope';
import { makeSheet, wantsSheet } from '../ui/sheet';

export interface PopoverHandle {
  readonly el: HTMLElement;
  close(): void;
  /** Places the card again, after its content changed size. */
  reposition(): void;
  readonly isOpen: boolean;
}

export interface PopoverOptions {
  /** Positioned ancestor the card is placed in; the board's root. */
  container: HTMLElement;
  /** What the card points at. A rectangle is kept when the element may be re-rendered away. */
  anchor: HTMLElement | DOMRect;
  cls?: string;
  /** Opens beside the anchor on this side first, when there is room. */
  rtl?: boolean;
  onClose?: () => void;
  build: (el: HTMLElement, handle: PopoverHandle) => void;
}

const GAP = 8;

/** Things a click can land on without meaning "close the card": menus and panels it opened. */
const KEEP_OPEN = '.taskpro-menu, .menu, .taskpro-panel-overlay, .notice-container, .tooltip, .suggestion-container';

export function openCalendarPopover(options: PopoverOptions): PopoverHandle {
  const { container } = options;
  const anchorRect = options.anchor instanceof HTMLElement ? options.anchor.getBoundingClientRect() : options.anchor;
  const el = container.createDiv({ cls: `taskpro-cal-popover${options.cls ? ` ${options.cls}` : ''}` });
  el.setAttribute('role', 'dialog');

  let open = true;
  const doc = container.ownerDocument;
  const win = doc.defaultView ?? window;
  // Where the focus was, so putting the card away gives it back and the keys carry on there.
  const returnFocus = doc.activeElement instanceof HTMLElement ? doc.activeElement : null;
  // On a phone the card is a sheet from the bottom of the board.
  const sheet = wantsSheet(container);
  let undoSheet: (() => void) | null = null;

  const place = () => {
    if (!open || sheet) return;
    const box = container.getBoundingClientRect();
    const width = el.offsetWidth;
    const height = el.offsetHeight;
    const roomAfter = box.right - anchorRect.right - GAP;
    const roomBefore = anchorRect.left - box.left - GAP;
    const fitsRight = roomAfter >= width + GAP;
    const fitsLeft = roomBefore >= width + GAP;

    let x: number;
    let y = anchorRect.top;
    if (fitsRight && (!options.rtl || !fitsLeft)) x = anchorRect.right + GAP;
    else if (fitsLeft) x = anchorRect.left - GAP - width;
    else {
      // No room on either side: below the anchor, or above it near the bottom.
      x = anchorRect.left + anchorRect.width / 2 - width / 2;
      y = anchorRect.bottom + GAP;
      if (y + height > box.bottom - GAP) y = anchorRect.top - GAP - height;
    }

    x = Math.min(Math.max(x, box.left + GAP), box.right - GAP - width);
    y = Math.min(Math.max(y, box.top + GAP), box.bottom - GAP - height);
    el.style.left = `${Math.round(x - box.left)}px`;
    el.style.top = `${Math.round(y - box.top)}px`;
  };

  const onPointerDown = (event: PointerEvent) => {
    const target = event.target as HTMLElement | null;
    if (!target || el.contains(target) || target.closest(KEEP_OPEN)) return;
    handle.close();
  };

  const handle: PopoverHandle = {
    el,
    get isOpen() {
      return open;
    },
    close: () => {
      if (!open) return;
      open = false;
      doc.removeEventListener('pointerdown', onPointerDown, true);
      releaseEscape();
      win.removeEventListener('resize', place);
      undoSheet?.();
      el.remove();
      if (returnFocus?.isConnected && (!doc.activeElement || doc.activeElement === doc.body)) returnFocus.focus({ preventScroll: true });
      options.onClose?.();
    },
    reposition: place,
  };

  // Escape closes this card and not the floating window around the board; a
  // menu or panel the card opens claims it after this, so closes first.
  const releaseEscape = claimEscape(() => handle.close(), doc);
  options.build(el, handle);
  if (sheet) undoSheet = makeSheet(el, container, () => handle.close());
  place();
  // Registered after the click that opened the card has finished.
  win.setTimeout(() => {
    if (!open) return;
    doc.addEventListener('pointerdown', onPointerDown, true);
  }, 0);
  win.addEventListener('resize', place);
  return handle;
}
