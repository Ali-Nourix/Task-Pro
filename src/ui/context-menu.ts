// ── ui/context-menu.ts ────────────────────────────────────────────────────
// The board's own menu, opened by a right click on a task and by the
// property chips of a task's card. Notion-like rather than Obsidian's plain
// list: rows grouped under small headings, each with its current value on
// the far side, submenus that open beside their row, and a search field that
// finds any action at any depth ("high" finds Priority › High).
//
// It is placed inside the board, like the calendar's cards, so it goes with
// the board when the board floats. Arrow keys move through it, the forward
// arrow opens a submenu and the back arrow closes one (mirrored in Persian),
// Enter chooses, and Escape closes the innermost panel first.
// ─────────────────────────────────────────────────────────────────────────────

import { setIcon } from 'obsidian';
import { claimEscape } from './escape-scope';

export interface MenuEntry {
  label: string;
  icon?: string;
  /** A colour shown as a dot before the label, for tags and statuses. */
  swatch?: string;
  /** The current value, or a key, shown on the far side. */
  hint?: string;
  checked?: boolean;
  /** Destructive, drawn in the error colour. */
  warning?: boolean;
  disabled?: boolean;
  /** More words the search matches, such as the English name of a Persian label. */
  keywords?: string;
  /** Built when the submenu opens, so it reflects the task at that moment. */
  submenu?: () => MenuSection[];
  onSelect?: () => unknown;
}

export interface MenuSection {
  title?: string;
  entries: MenuEntry[];
}

export interface ContextMenuOptions {
  /** Positioned ancestor the menu is placed in; the board's root. */
  container: HTMLElement;
  /** A point (a right click), or a rectangle to open under (a chip). */
  at: { x: number; y: number } | DOMRect;
  sections: MenuSection[];
  /** A title row above the menu, such as the task's name. */
  header?: string;
  /** A placeholder turns the search field on. */
  searchPlaceholder?: string;
  rtl?: boolean;
  onClose?: () => void;
}

export interface ContextMenuHandle {
  close(): void;
  readonly isOpen: boolean;
}

interface Row {
  entry: MenuEntry;
  el: HTMLElement;
}

interface Panel {
  el: HTMLElement;
  rows: Row[];
  active: number;
  /** The row in the parent panel that opened this one. */
  owner?: Row;
}

const GAP = 4;
const SUBMENU_DELAY = 120;
/** Clicks here do not close the menu: what one of its actions opened. */
const KEEP_OPEN = '.taskpro-menu, .menu, .taskpro-panel-overlay, .modal-container, .notice-container, .tooltip, .suggestion-container';

let current: ContextMenuHandle | null = null;

/** Closes the menu that is open, if any. One menu is open at a time. */
export function closeContextMenu(): void {
  current?.close();
}

export function openContextMenu(options: ContextMenuOptions): ContextMenuHandle {
  closeContextMenu();
  const { container, rtl = false } = options;
  const doc = container.ownerDocument;
  const win = doc.defaultView ?? window;
  const forwardKey = rtl ? 'ArrowLeft' : 'ArrowRight';
  const backKey = rtl ? 'ArrowRight' : 'ArrowLeft';

  let open = true;
  let hoverTimer: number | null = null;
  const panels: Panel[] = [];

  const rootEl = container.createDiv({ cls: 'taskpro-menu' });
  rootEl.setAttribute('role', 'menu');
  rootEl.dir = rtl ? 'rtl' : 'ltr';
  rootEl.tabIndex = -1;

  if (options.header) rootEl.createDiv({ cls: 'taskpro-menu__header', text: options.header, attr: { dir: 'auto' } });
  let search: HTMLInputElement | null = null;
  if (options.searchPlaceholder) {
    search = rootEl.createEl('input', {
      type: 'text',
      cls: 'taskpro-menu__search',
      attr: { placeholder: options.searchPlaceholder, 'aria-label': options.searchPlaceholder, spellcheck: 'false', dir: 'auto' },
    });
  }
  const rootList = rootEl.createDiv({ cls: 'taskpro-menu__list' });
  const root: Panel = { el: rootEl, rows: [], active: -1 };
  panels.push(root);

  const clearHover = () => {
    if (hoverTimer !== null) win.clearTimeout(hoverTimer);
    hoverTimer = null;
  };

  const deepest = () => panels[panels.length - 1];

  const setActive = (panel: Panel, index: number) => {
    panel.active = index;
    panel.rows.forEach((row, i) => {
      row.el.toggleClass('is-active', i === index);
      if (i === index) row.el.scrollIntoView({ block: 'nearest' });
    });
  };

  const closeFrom = (depth: number) => {
    while (panels.length > depth) {
      const panel = panels.pop()!;
      panel.owner?.el.removeClass('is-open');
      panel.el.remove();
    }
  };

  const renderRows = (panel: Panel, list: HTMLElement, sections: MenuSection[], depth: number) => {
    list.empty();
    panel.rows = [];
    panel.active = -1;
    let first = true;
    for (const section of sections) {
      if (!section.entries.length) continue;
      if (!first) list.createDiv({ cls: 'taskpro-menu__separator' });
      first = false;
      if (section.title) list.createDiv({ cls: 'taskpro-menu__heading', text: section.title });
      for (const entry of section.entries) {
        const el = list.createDiv({ cls: 'taskpro-menu__item' });
        el.setAttribute('role', entry.checked !== undefined ? 'menuitemcheckbox' : 'menuitem');
        if (entry.checked !== undefined) el.setAttribute('aria-checked', String(entry.checked));
        el.toggleClass('is-disabled', !!entry.disabled);
        el.toggleClass('is-warning', !!entry.warning);
        el.toggleClass('has-submenu', !!entry.submenu);
        if (entry.disabled) el.setAttribute('aria-disabled', 'true');

        const icon = el.createSpan({ cls: 'taskpro-menu__icon' });
        if (entry.swatch) icon.createSpan({ cls: 'taskpro-menu__swatch' }).style.setProperty('--taskpro-menu-swatch', entry.swatch);
        else if (entry.icon) setIcon(icon, entry.icon);
        el.createSpan({ cls: 'taskpro-menu__label', text: entry.label, attr: { dir: 'auto' } });
        if (entry.hint) el.createSpan({ cls: 'taskpro-menu__hint', text: entry.hint, attr: { dir: 'auto' } });
        if (entry.checked) setIcon(el.createSpan({ cls: 'taskpro-menu__check' }), 'check');
        if (entry.submenu) setIcon(el.createSpan({ cls: 'taskpro-menu__chevron' }), rtl ? 'chevron-left' : 'chevron-right');

        const row: Row = { entry, el };
        const index = panel.rows.push(row) - 1;
        el.addEventListener('pointerenter', () => {
          setActive(panel, index);
          clearHover();
          hoverTimer = win.setTimeout(() => {
            hoverTimer = null;
            if (!open) return;
            if (entry.submenu && !entry.disabled) openSubmenu(depth, row);
            else closeFrom(depth + 1);
          }, SUBMENU_DELAY);
        });
        // A press does not take focus from the search field.
        el.addEventListener('pointerdown', (event) => event.preventDefault());
        el.addEventListener('click', (event) => {
          event.stopPropagation();
          choose(depth, row);
        });
      }
    }
    if (!panel.rows.length) list.createDiv({ cls: 'taskpro-menu__empty', text: '—' });
  };

  const openSubmenu = (depth: number, row: Row) => {
    if (panels[depth + 1]?.owner === row) return;
    closeFrom(depth + 1);
    const el = container.createDiv({ cls: 'taskpro-menu is-submenu' });
    el.setAttribute('role', 'menu');
    el.dir = rootEl.dir;
    const panel: Panel = { el, rows: [], active: -1, owner: row };
    panels.push(panel);
    row.el.addClass('is-open');
    renderRows(panel, el.createDiv({ cls: 'taskpro-menu__list' }), row.entry.submenu!(), depth + 1);
    placeBeside(el, row.el.getBoundingClientRect());
  };

  const choose = (depth: number, row: Row) => {
    const { entry } = row;
    if (entry.disabled) return;
    if (entry.submenu) {
      openSubmenu(depth, row);
      const panel = panels[depth + 1];
      if (panel) setActive(panel, firstEnabled(panel, 0, 1));
      return;
    }
    handle.close();
    void entry.onSelect?.();
  };

  const firstEnabled = (panel: Panel, from: number, step: 1 | -1): number => {
    const count = panel.rows.length;
    for (let i = 0; i < count; i++) {
      const index = (from + i * step + count * 2) % count;
      if (!panel.rows[index].entry.disabled) return index;
    }
    return -1;
  };

  // ── Search ──
  const flatten = (sections: MenuSection[], path: string[] = []): Array<{ entry: MenuEntry; path: string[] }> => {
    const out: Array<{ entry: MenuEntry; path: string[] }> = [];
    for (const section of sections) {
      for (const entry of section.entries) {
        if (entry.disabled) continue;
        if (entry.submenu) out.push(...flatten(entry.submenu(), [...path, entry.label]));
        else out.push({ entry, path });
      }
    }
    return out;
  };

  const renderRoot = () => {
    closeFrom(1);
    const query = search?.value.trim().toLowerCase() ?? '';
    if (!query) {
      renderRows(root, rootList, options.sections, 0);
    } else {
      const terms = query.split(/\s+/);
      const found = flatten(options.sections).filter(({ entry, path }) => {
        const haystack = `${path.join(' ')} ${entry.label} ${entry.keywords ?? ''}`.toLowerCase();
        return terms.every((term) => haystack.includes(term));
      });
      renderRows(
        root,
        rootList,
        [{ entries: found.slice(0, 30).map(({ entry, path }) => ({ ...entry, hint: path.join(' › ') || entry.hint })) }],
        0
      );
      if (root.rows.length) setActive(root, 0);
    }
    place();
  };

  // ── Placement ──
  const place = () => {
    const box = container.getBoundingClientRect();
    const width = rootEl.offsetWidth;
    const height = rootEl.offsetHeight;
    const at = options.at;
    let x: number;
    let y: number;
    if (at instanceof DOMRect) {
      x = rtl ? at.right - width : at.left;
      y = at.bottom + GAP;
      if (y + height > box.bottom - GAP && at.top - GAP - height >= box.top) y = at.top - GAP - height;
    } else {
      x = rtl ? at.x - width : at.x;
      y = at.y;
      if (x + width > box.right - GAP) x = at.x - width;
      if (x < box.left + GAP) x = at.x;
      if (y + height > box.bottom - GAP) y = Math.max(box.top + GAP, at.y - height);
    }
    x = Math.min(Math.max(x, box.left + GAP), box.right - GAP - width);
    y = Math.min(Math.max(y, box.top + GAP), box.bottom - GAP - height);
    rootEl.style.left = `${Math.round(x - box.left)}px`;
    rootEl.style.top = `${Math.round(y - box.top)}px`;
  };

  const placeBeside = (el: HTMLElement, rowRect: DOMRect) => {
    const box = container.getBoundingClientRect();
    const width = el.offsetWidth;
    const height = el.offsetHeight;
    const after = rtl ? rowRect.left - width + 2 : rowRect.right - 2;
    const before = rtl ? rowRect.right - 2 : rowRect.left - width + 2;
    const fitsAfter = rtl ? after >= box.left + GAP : after + width <= box.right - GAP;
    let x = fitsAfter ? after : before;
    x = Math.min(Math.max(x, box.left + GAP), box.right - GAP - width);
    const y = Math.min(Math.max(rowRect.top - 5, box.top + GAP), box.bottom - GAP - height);
    el.style.left = `${Math.round(x - box.left)}px`;
    el.style.top = `${Math.round(y - box.top)}px`;
  };

  // ── Keys and closing ──
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.isComposing) return;
    const panel = deepest();
    const depth = panels.length - 1;
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp': {
        const step = event.key === 'ArrowDown' ? 1 : -1;
        setActive(panel, firstEnabled(panel, panel.active < 0 ? (step === 1 ? 0 : panel.rows.length - 1) : panel.active + step, step));
        break;
      }
      case 'Enter': {
        const row = panel.rows[panel.active];
        if (row) choose(depth, row);
        break;
      }
      default:
        if (event.key === forwardKey && !(search && doc.activeElement === search && search.value)) {
          const row = panel.rows[panel.active];
          if (!row?.entry.submenu) return;
          choose(depth, row);
          break;
        }
        if (event.key === backKey && depth > 0) {
          closeFrom(depth);
          break;
        }
        return;
    }
    event.preventDefault();
    event.stopPropagation();
  };

  const onPointerDown = (event: PointerEvent) => {
    const target = event.target as HTMLElement | null;
    if (!target || target.closest(KEEP_OPEN)) return;
    handle.close();
  };

  const onContextMenu = (event: MouseEvent) => {
    if ((event.target as HTMLElement | null)?.closest('.taskpro-menu')) event.preventDefault();
  };

  const handle: ContextMenuHandle = {
    get isOpen() {
      return open;
    },
    close: () => {
      if (!open) return;
      open = false;
      clearHover();
      releaseEscape();
      doc.removeEventListener('pointerdown', onPointerDown, true);
      doc.removeEventListener('keydown', onKeyDown, true);
      doc.removeEventListener('contextmenu', onContextMenu, true);
      win.removeEventListener('blur', handle.close);
      closeFrom(1);
      rootEl.remove();
      if (current === handle) current = null;
      options.onClose?.();
    },
  };
  current = handle;

  // The innermost panel closes first, then the menu, before anything under it.
  const releaseEscape = claimEscape(() => {
    if (panels.length > 1) closeFrom(panels.length - 1);
    else handle.close();
  }, doc);

  search?.addEventListener('input', renderRoot);
  renderRoot();
  (search ?? rootEl).focus({ preventScroll: true });
  doc.addEventListener('keydown', onKeyDown, true);
  doc.addEventListener('contextmenu', onContextMenu, true);
  // After the press that opened the menu has finished.
  win.setTimeout(() => {
    if (open) doc.addEventListener('pointerdown', onPointerDown, true);
  }, 0);
  win.addEventListener('blur', handle.close);
  return handle;
}
