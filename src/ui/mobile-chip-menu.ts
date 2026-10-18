/** Mobile notes keep only the status capsule. Its existing task-menu handler
 * opens all properties in Obsidian's usual menu; no second trigger or popover. */
export function mobileChipMenu(row: HTMLElement, _language: 'fa' | 'en' = 'en') {
  const win = row.ownerDocument.defaultView!;
  const query = win.matchMedia('(max-width: 600px)');
  let disposed = false;
  const chips = () => (Array.from(row.children) as HTMLElement[]).filter(node =>
    !node.classList.contains('taskpro-block-id') && !node.hidden);
  const sync = () => {
    if (disposed) return;
    const mobile = query.matches || row.ownerDocument.body.classList.contains('is-mobile');
    const items = chips();
    const primary = items.find(chip => chip.classList.contains('taskpro-interactive-badge')) ?? items[0];
    row.classList.toggle('is-mobile-single-chip', mobile);
    for (const chip of items) chip.classList.toggle('taskpro-chip-collapsed', mobile && chip !== primary);
  };
  query.addEventListener('change', sync);
  win.addEventListener('resize', sync);
  return { sync, destroy: () => {
    disposed = true;
    query.removeEventListener('change', sync);
    win.removeEventListener('resize', sync);
    row.classList.remove('is-mobile-single-chip');
    chips().forEach(chip => chip.classList.remove('taskpro-chip-collapsed'));
  } };
}
