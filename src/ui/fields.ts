// ── ui/fields.ts ──────────────────────────────────────────────────────────
// Small helpers for text fields.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A field that takes its direction from what is typed in it (`dir="auto"`),
 * but that rests in the interface's direction while it is empty. With nothing
 * typed there is nothing to go by, and the browser falls back to left to
 * right, which put a Persian placeholder at the wrong end of a Persian
 * board, away from the icon it belongs beside.
 */
export function autoDirection(input: HTMLInputElement, resting: 'ltr' | 'rtl'): void {
  const sync = () => input.setAttribute('dir', input.value.trim() ? 'auto' : resting);
  sync();
  input.addEventListener('input', sync);
}
