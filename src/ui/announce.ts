// ── ui/announce.ts ────────────────────────────────────────────────────────
// Says something to a screen reader without showing it: a task ticked off, a
// task added, a sheet opened. The region is made once, kept in the page, and
// cleared before each message so the same words twice are heard twice.
// ─────────────────────────────────────────────────────────────────────────────

export function announce(container: HTMLElement, text: string): void {
  let region = container.querySelector<HTMLElement>(':scope > .taskpro-live');
  if (!region) {
    region = container.createDiv({ cls: 'taskpro-live', attr: { role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' } });
  }
  const live = region;
  live.setText('');
  const win = container.ownerDocument.defaultView ?? window;
  win.setTimeout(() => live.setText(text), 40);
}
