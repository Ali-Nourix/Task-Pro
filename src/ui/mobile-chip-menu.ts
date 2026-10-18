const openMenus = new WeakMap<Document, () => void>();

/** Keep one real chip in mobile notes. Move (never clone) the other controls into
 * a small popover so their original event handlers and task context are retained. */
export function mobileChipMenu(row: HTMLElement, language: 'fa' | 'en' = 'en') {
  const doc = row.ownerDocument, win = doc.defaultView!;
  const query = win.matchMedia('(max-width: 600px)');
  const fa = language === 'fa';
  const more = doc.createElement('button');
  more.type = 'button'; more.className = 'taskpro-chip-more'; more.textContent = '⋯';
  more.setAttribute('aria-haspopup', 'dialog'); more.setAttribute('aria-expanded', 'false');
  let popup: HTMLElement | null = null, moved: HTMLElement[] = [], disposed = false;
  let observer: MutationObserver | undefined, pendingClose = 0;
  const attributes = new Map<HTMLElement, { tab: string | null; role: string | null }>();
  const items = () => (Array.from(row.children) as HTMLElement[]).filter(e => e !== more && !e.classList.contains('taskpro-block-id') && !e.hidden);
  const restore = () => {
    for (const chip of moved) {
      chip.classList.remove('taskpro-chip-in-menu');
      const a = attributes.get(chip);
      if (a) for (const [key, value] of [['tabindex', a.tab], ['role', a.role]] as const) {
        if (value === null) chip.removeAttribute(key); else chip.setAttribute(key, value);
      }
      row.insertBefore(chip, more.parentElement === row ? more : null);
    }
    moved = []; attributes.clear();
  };
  const close = (focus = false) => {
    if (!popup) return;
    if (pendingClose) win.clearTimeout(pendingClose); pendingClose = 0;
    observer?.disconnect(); observer = undefined;
    doc.removeEventListener('pointerdown', outside, true); doc.removeEventListener('keydown', key, true);
    win.removeEventListener('resize', reposition); win.removeEventListener('scroll', reposition, true);
    const active = popup.contains(doc.activeElement);
    restore(); popup.remove(); popup = null; more.setAttribute('aria-expanded', 'false');
    if (openMenus.get(doc) === close) openMenus.delete(doc);
    if ((focus || active) && more.isConnected) more.focus({ preventScroll: true });
  };
  const outside = (e: PointerEvent) => { if (!popup?.contains(e.target as Node) && !more.contains(e.target as Node)) close(); };
  const reposition = () => {
    if (!popup || !more.isConnected) { close(); return; }
    const a = more.getBoundingClientRect(), p = popup.getBoundingClientRect();
    const left = fa ? a.left : a.right - p.width;
    popup.style.left = `${Math.max(8, Math.min(left, win.innerWidth - p.width - 8))}px`;
    const top = a.bottom + 6 + p.height <= win.innerHeight - 8 ? a.bottom + 6 : a.top - p.height - 6;
    popup.style.top = `${Math.max(8, Math.min(top, win.innerHeight - p.height - 8))}px`;
  };
  const key = (e: KeyboardEvent) => {
    if (!popup || !(popup.contains(doc.activeElement) || doc.activeElement === more)) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); close(true); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Home' || e.key === 'End') {
      e.preventDefault(); e.stopPropagation();
      const index = moved.indexOf(doc.activeElement as HTMLElement);
      const next = e.key === 'Home' ? 0 : e.key === 'End' ? moved.length - 1 : (index + (e.key === 'ArrowDown' ? 1 : -1) + moved.length) % moved.length;
      moved[next]?.focus();
    }
    if ((e.key === 'Enter' || e.key === ' ') && moved.includes(doc.activeElement as HTMLElement)) {
      e.preventDefault(); e.stopImmediatePropagation(); (doc.activeElement as HTMLElement).click();
    }
  };
  const open = (e: MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    if (popup) { close(true); return; }
    openMenus.get(doc)?.();
    moved = items().slice(1);
    if (!moved.length) return;
    popup = doc.createElement('div'); popup.className = 'taskpro-mobile-chip-menu'; popup.dir = fa ? 'rtl' : 'ltr';
    popup.setAttribute('role', 'dialog'); popup.setAttribute('aria-modal', 'false');
    popup.setAttribute('aria-label', fa ? 'ویژگی‌های بیشتر تسک' : 'More task properties');
    const heading = doc.createElement('div'); heading.className = 'taskpro-mobile-chip-menu__title';
    heading.textContent = fa ? 'ویژگی‌های تسک' : 'Task properties'; popup.append(heading);
    for (const chip of moved) {
      attributes.set(chip, { tab: chip.getAttribute('tabindex'), role: chip.getAttribute('role') });
      chip.tabIndex = 0; chip.setAttribute('role', 'button'); chip.classList.add('taskpro-chip-in-menu'); popup.append(chip);
    }
    // Async-loaded editors must anchor to the still-visible More control, not
    // a chip that is returned to the hidden row as soon as this menu closes.
    for (const type of ['taskpro-badge-click', 'taskpro-progress-click', 'taskpro-timer-click', 'taskpro-tags-click']) {
      popup.addEventListener(type, event => {
        const detail = (event as CustomEvent).detail;
        if (detail?.targetElement && typeof detail.targetElement.getBoundingClientRect === 'function') detail.targetElement = more;
      }, true);
    }
    // Let the chip's custom task event reach the plugin before returning its node.
    popup.addEventListener('click', event => {
      if (moved.some(chip => chip.contains(event.target as Node))) pendingClose = win.setTimeout(() => close(), 0);
    }, true);
    doc.body.append(popup); openMenus.set(doc, close); more.setAttribute('aria-expanded', 'true'); reposition(); moved[0]?.focus();
    doc.addEventListener('pointerdown', outside, true); doc.addEventListener('keydown', key, true);
    win.addEventListener('resize', reposition); win.addEventListener('scroll', reposition, true);
    observer = new MutationObserver(() => { if (!row.isConnected) close(); });
    observer.observe(doc.body, { childList: true, subtree: true });
  };
  more.addEventListener('click', open);
  more.addEventListener('pointerdown', e => e.stopPropagation());
  const sync = () => {
    if (disposed) return;
    const mobile = query.matches || doc.body.classList.contains('is-mobile');
    if (!mobile) close();
    row.classList.toggle('is-mobile-chip-menu', mobile);
    const chips = items();
    for (const [i, chip] of chips.entries()) chip.classList.toggle('taskpro-chip-collapsed', mobile && i > 0);
    const count = Math.max(0, chips.length - 1) + moved.length;
    more.hidden = !mobile || !count;
    more.setAttribute('aria-label', fa ? `${count} ویژگی دیگر تسک` : `${count} more task properties`);
    if (more.parentElement !== row) row.append(more);
    if (popup) reposition();
  };
  query.addEventListener('change', sync); win.addEventListener('resize', sync);
  return { sync, destroy: () => {
    disposed = true; close(); query.removeEventListener('change', sync); win.removeEventListener('resize', sync);
    more.remove(); row.classList.remove('is-mobile-chip-menu');
    items().forEach(chip => chip.classList.remove('taskpro-chip-collapsed'));
  } };
}
