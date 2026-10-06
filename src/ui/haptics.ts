// ── ui/haptics.ts ─────────────────────────────────────────────────────────
// A short buzz where the phone can give one (Android's browser view does; iOS
// has none for web content, and a desktop never will). It confirms something
// the finger did and can hardly see: a swipe that went through, a task added.
// It is never the only sign of anything, and it is quiet for anyone who has
// asked the system for less motion.
// ─────────────────────────────────────────────────────────────────────────────

export type Haptic = 'tick' | 'success' | 'warning';

const PATTERNS: Record<Haptic, number | number[]> = {
  tick: 8,
  success: [10, 40, 12],
  warning: [24, 50, 24],
};

export function haptic(kind: Haptic = 'tick'): void {
  try {
    if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
    if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    navigator.vibrate(PATTERNS[kind]);
  } catch {
    // A browser that refuses is a browser that gets no buzz.
  }
}
