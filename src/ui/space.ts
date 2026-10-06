// ── ui/space.ts ───────────────────────────────────────────────────────────
// Measuring a box the way the layout sees it.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The room a box has for its children, inside its padding. A list that pads
 * itself by the halo (see `--taskpro-halo` in styles.css) reports a
 * `clientHeight` that includes that padding, which is not room anything can
 * fill, so anything counting how many children fit has to ask for this.
 */
export function contentHeight(el: HTMLElement): number {
  const style = (el.ownerDocument.defaultView ?? window).getComputedStyle(el);
  return el.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
}
