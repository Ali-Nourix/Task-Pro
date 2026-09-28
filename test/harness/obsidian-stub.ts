/**
 * The slice of the Obsidian API the board, tag picker and chips touch, for
 * rendering them in a plain browser. Bundled in place of the `obsidian`
 * module by test/harness/build.mjs.
 *
 * Icons are real Lucide paths (the icon set Obsidian ships), injected at build
 * time as `__LUCIDE__`, so a preview shows the same glyphs the app would.
 */

declare const __LUCIDE__: Record<string, string>;

// ── Obsidian's DOM helpers ───────────────────────────────────────────────────
type DomInfo = {
  cls?: string | string[];
  text?: string;
  attr?: Record<string, string | number | boolean>;
  type?: string;
};

function applyInfo(el: HTMLElement, info?: DomInfo | string): void {
  if (!info) return;
  if (typeof info === 'string') {
    el.className = info;
    return;
  }
  if (info.cls) el.className = Array.isArray(info.cls) ? info.cls.join(' ') : info.cls;
  if (info.text !== undefined) el.textContent = info.text;
  if (info.type && 'type' in el) (el as HTMLInputElement).type = info.type;
  for (const [key, value] of Object.entries(info.attr ?? {})) el.setAttribute(key, String(value));
}

const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
proto.createEl = function (this: HTMLElement, tag: string, info?: DomInfo | string) {
  const el = document.createElement(tag);
  applyInfo(el, info);
  this.appendChild(el);
  return el;
};
proto.createDiv = function (this: HTMLElement, info?: DomInfo | string) {
  return (this as unknown as { createEl: (t: string, i?: unknown) => HTMLElement }).createEl('div', info);
};
proto.createSpan = function (this: HTMLElement, info?: DomInfo | string) {
  return (this as unknown as { createEl: (t: string, i?: unknown) => HTMLElement }).createEl('span', info);
};
proto.empty = function (this: HTMLElement) {
  while (this.firstChild) this.removeChild(this.firstChild);
};
proto.addClass = function (this: HTMLElement, ...classes: string[]) {
  this.classList.add(...classes);
};
proto.removeClass = function (this: HTMLElement, ...classes: string[]) {
  this.classList.remove(...classes);
};
proto.toggleClass = function (this: HTMLElement, cls: string, value: boolean) {
  this.classList.toggle(cls, value);
};
proto.hasClass = function (this: HTMLElement, cls: string) {
  return this.classList.contains(cls);
};
proto.setText = function (this: HTMLElement, text: string) {
  this.textContent = text;
};

const globals = globalThis as unknown as Record<string, unknown>;
globals.createEl = (tag: string, info?: DomInfo | string) => {
  const el = document.createElement(tag);
  applyInfo(el, info);
  return el;
};
globals.createDiv = (info?: DomInfo | string) => (globals.createEl as (t: string, i?: unknown) => HTMLElement)('div', info);
globals.createSpan = (info?: DomInfo | string) => (globals.createEl as (t: string, i?: unknown) => HTMLElement)('span', info);

// ── API ──────────────────────────────────────────────────────────────────────
export const missingIcons = new Set<string>();

export function setIcon(parent: HTMLElement, name: string): void {
  const body = __LUCIDE__[name];
  parent.querySelectorAll(':scope > svg').forEach((svg) => svg.remove());
  if (!body) {
    missingIcons.add(name);
    return;
  }
  parent.insertAdjacentHTML(
    'beforeend',
    `<svg xmlns="http://www.w3.org/2000/svg" class="svg-icon lucide-${name}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`
  );
}

/** `?mobile=1` in the preview's address plays Obsidian on a phone. */
const onPhone = typeof location !== 'undefined' && new URLSearchParams(location.search).get('mobile') === '1';
export const Platform = {
  isMobile: onPhone,
  isPhone: onPhone,
  isTablet: false,
  isDesktop: !onPhone,
  isDesktopApp: !onPhone,
  isMobileApp: onPhone,
  isIosApp: false,
  isAndroidApp: false,
  isMacOS: false,
  isWin: false,
  isLinux: true,
  isSafari: false,
};

export class Notice {
  constructor(message: string) {
    console.log(`[Notice] ${message}`);
  }
}

/** Records items; `showAtPosition` draws a static Obsidian-style menu for screenshots. */
export class Menu {
  private items: MenuEntry[] = [];

  addItem(build: (item: MenuItem) => void): this {
    const entry: MenuEntry = { title: '' };
    build(new MenuItem(entry));
    this.items.push(entry);
    return this;
  }

  addSeparator(): this {
    this.items.push({ title: '', separator: true });
    return this;
  }

  showAtMouseEvent(event: MouseEvent): this {
    return this.showAtPosition({ x: event.clientX, y: event.clientY });
  }

  showAtPosition(position: { x: number; y: number }): this {
    document.querySelectorAll('.menu').forEach((el) => el.remove());
    const menu = document.body.createDiv({ cls: 'menu' });
    menu.style.left = `${position.x}px`;
    menu.style.top = `${position.y}px`;
    for (const item of this.items) {
      if (item.separator) {
        menu.createDiv({ cls: 'menu-separator' });
        continue;
      }
      const row = menu.createDiv({ cls: `menu-item${item.label ? ' is-label' : ''}` });
      const icon = row.createDiv({ cls: 'menu-item-icon' });
      if (item.icon) setIcon(icon, item.icon);
      row.createDiv({ cls: 'menu-item-title', text: item.title });
      if (item.checked) setIcon(row.createDiv({ cls: 'menu-item-icon mod-checked' }), 'check');
      row.addEventListener('click', () => {
        menu.remove();
        item.onClick?.();
      });
    }
    return this;
  }
}

type MenuEntry = {
  title: string;
  icon?: string;
  checked?: boolean;
  label?: boolean;
  separator?: boolean;
  onClick?: () => void;
};

class MenuItem {
  constructor(private readonly entry: MenuEntry) {}
  setTitle(title: string): this {
    this.entry.title = title;
    return this;
  }
  setIcon(icon: string | null): this {
    this.entry.icon = icon ?? undefined;
    return this;
  }
  setChecked(checked: boolean | null): this {
    this.entry.checked = !!checked;
    return this;
  }
  setIsLabel(label: boolean): this {
    this.entry.label = label;
    return this;
  }
  setDisabled(): this {
    return this;
  }
  onClick(callback: () => void): this {
    this.entry.onClick = callback;
    return this;
  }
}

/** Only the fallback path runs in the harness: no keymap is handed over. */
export class Scope {
  register(): void {}
}

export class ItemView {}
export class Plugin {}
export class App {}
export class TFile {}
export class FuzzySuggestModal {}
export class EditorSuggest {}
