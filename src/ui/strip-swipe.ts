// ── ui/strip-swipe.ts ─────────────────────────────────────────────────────
// A strip of panels one finger moves from side to side, one panel at a time:
// the board's columns on a phone. The browser's own pan is not asked to do it.
// A column scrolls up and down by itself, and a pan that starts inside a
// scroller of the other direction is handed on to the strip in some engines
// and dropped in others, so what the finger does is read here and the strip
// moved by hand: it follows the finger, and on letting go it comes to rest on
// the panel the swipe pointed at (never past the next), with a short buzz.
// The panels say `touch-action: pan-y` in the stylesheet, which leaves up and
// down to the browser and everything sideways to this.
// ─────────────────────────────────────────────────────────────────────────────

import { haptic } from './haptics';
import { fingersDown } from './touch';

export interface StripSwipe {
  /** The strip that is moved. */
  strip: HTMLElement;
  /** The panels, in reading order. */
  panels(): HTMLElement[];
  /** Where the strip's scroll offset puts a panel at its leading edge. */
  offsetOf(panel: HTMLElement): number;
  /** Whether the panels run from right to left. */
  rtl: boolean;
  /** False while something else (a carried card) has the finger. */
  enabled(): boolean;
  /** A panel has been settled on. */
  onSettle?(panel: HTMLElement, from: HTMLElement): void;
}

/** How far a finger must move before it is read, in pixels. */
const SLOP = 8;
/** A swipe is sideways when it goes this much further across than up or down. */
const SIDEWAYS = 1.2;
/** A swipe this fast (pixels per millisecond) turns the page however short it was. */
const FLICK = 0.35;
/** A slow drag turns the page after this share of the strip's width. */
const DRAG_SHARE = 0.2;
/** How long the strip glides to its panel, at most, in milliseconds. */
const SETTLE_MS = 420;

/** Wires the swipe up; the returned function takes it down again. */
export function swipeStrip(swipe: StripSwipe): () => void {
  const { strip } = swipe;
  const doc = strip.ownerDocument;
  const win = doc.defaultView ?? window;
  let settleTimer = 0;

  /** The snap the stylesheet sets is given back once the strip has come to rest. */
  const restoreSnap = () => {
    win.clearTimeout(settleTimer);
    strip.style.removeProperty('scroll-snap-type');
  };

  /** Where each panel rests: its offset, kept to what the strip can scroll (the last panels cannot reach the edge). */
  const restingPlaces = (): number[] => {
    const reach = Math.max(0, strip.scrollWidth - strip.clientWidth);
    return swipe.panels().map((panel) => {
      const offset = swipe.offsetOf(panel);
      return swipe.rtl ? Math.max(-reach, Math.min(0, offset)) : Math.max(0, Math.min(reach, offset));
    });
  };

  const nearest = (offsets: number[], at: number): number => {
    let best = 0;
    offsets.forEach((offset, index) => {
      if (Math.abs(offset - at) < Math.abs(offsets[best] - at)) best = index;
    });
    return best;
  };

  const settle = (from: number, dx: number, velocity: number) => {
    const panels = swipe.panels();
    if (!panels.length) return restoreSnap();
    const offsets = restingPlaces();
    const share = Math.abs(dx) / Math.max(1, strip.clientWidth);
    // A finger moving left carries a left-to-right strip on to its next panel; right to left, the other way.
    const forward = swipe.rtl ? dx > 0 : dx < 0;
    const quick = Math.abs(velocity) >= FLICK && Math.abs(dx) > SLOP * 2;
    // Never further than the next panel, whatever the finger travelled.
    const to = Math.max(0, Math.min(panels.length - 1, quick || share >= DRAG_SHARE ? from + (forward ? 1 : -1) : from));
    const reduced = !!win.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    strip.scrollTo({ left: offsets[to], behavior: reduced ? 'auto' : 'smooth' });
    if (to !== from) {
      haptic('tick');
      swipe.onSettle?.(panels[to], panels[from]);
    }
    win.clearTimeout(settleTimer);
    settleTimer = win.setTimeout(() => {
      // Where a glide stops short, or is not honoured, it finishes here.
      if (Math.abs(strip.scrollLeft - offsets[to]) > 1) strip.scrollLeft = offsets[to];
      restoreSnap();
    }, reduced ? 0 : SETTLE_MS);
  };

  const onDown = (down: PointerEvent) => {
    if (down.pointerType === 'mouse' || !down.isPrimary || down.button !== 0 || !swipe.enabled()) return;
    // A glide still going on is taken over by the finger.
    restoreSnap();
    const startX = down.clientX;
    const startY = down.clientY;
    const startLeft = strip.scrollLeft;
    const offsets = restingPlaces();
    const from = offsets.length ? nearest(offsets, startLeft) : 0;
    let mode: 'pending' | 'sideways' | 'other' = 'pending';
    let samples: { x: number; t: number }[] = [{ x: startX, t: down.timeStamp }];

    const end = (settleNow: boolean, dx: number) => {
      doc.removeEventListener('pointermove', onMove, true);
      doc.removeEventListener('pointerup', onUp, true);
      doc.removeEventListener('pointercancel', onCancel, true);
      doc.removeEventListener('pointerdown', onSecond, true);
      if (mode !== 'sideways') return;
      // The tap that would follow a swipe is not one.
      const swallow = (event: Event) => {
        event.preventDefault();
        event.stopPropagation();
      };
      doc.addEventListener('click', swallow, { capture: true, once: true });
      win.setTimeout(() => doc.removeEventListener('click', swallow, true), 350);
      if (!settleNow) return restoreSnap();
      const last = samples[samples.length - 1];
      const first = samples.find((sample) => last.t - sample.t <= 100) ?? last;
      const span = last.t - first.t;
      settle(from, dx, span > 0 ? (last.x - first.x) / span : 0);
    };

    const onMove = (event: PointerEvent) => {
      if (event.pointerId !== down.pointerId) return;
      if (fingersDown() > 1) return end(true, event.clientX - startX);
      if (mode === 'other') return;
      const dx = event.clientX - startX;
      const dy = event.clientY - startY;
      if (mode === 'pending') {
        if (Math.abs(dx) < SLOP && Math.abs(dy) < SLOP) return;
        // Up and down is the column's own; a card being carried is not a swipe at all.
        if (Math.abs(dx) < Math.abs(dy) * SIDEWAYS || !swipe.enabled()) {
          mode = 'other';
          return;
        }
        mode = 'sideways';
        strip.style.setProperty('scroll-snap-type', 'none');
      }
      samples.push({ x: event.clientX, t: event.timeStamp });
      if (samples.length > 12) samples = samples.slice(-12);
      strip.scrollLeft = startLeft - dx;
    };
    const onUp = (event: PointerEvent) => {
      if (event.pointerId !== down.pointerId) return;
      samples.push({ x: event.clientX, t: event.timeStamp });
      end(true, event.clientX - startX);
    };
    const onCancel = (event: PointerEvent) => {
      if (event.pointerId !== down.pointerId) return;
      // The browser took the touch for a pan of its own (up and down): nothing sideways is left to finish.
      end(false, 0);
    };
    // A second finger turns this into something else (a two-finger gesture, a pinch): the strip comes to rest.
    const onSecond = (event: PointerEvent) => {
      if (event.isPrimary) return;
      end(true, 0);
    };
    doc.addEventListener('pointermove', onMove, true);
    doc.addEventListener('pointerup', onUp, true);
    doc.addEventListener('pointercancel', onCancel, true);
    doc.addEventListener('pointerdown', onSecond, true);
  };

  strip.addEventListener('pointerdown', onDown);
  return () => {
    strip.removeEventListener('pointerdown', onDown);
    restoreSnap();
  };
}
