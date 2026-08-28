// ── ui/menu-styling.ts ────────────────────────────────────────────────────
// Distinguish informational (blue) vs action-disabled (gray) menu rows

/** Apply after Menu.showAtMouseEvent — info rows stay accent-colored, blocked actions stay muted. */
export function styleTaskProMenu(infoTitles: string[]): void {
  requestAnimationFrame(() => {
    const normalized = infoTitles.map((t) => t.trim()).filter(Boolean);

    document.querySelectorAll('.menu .menu-item.is-disabled').forEach((el) => {
      const title = el.querySelector('.menu-item-title')?.textContent?.trim() ?? '';
      const isInfo = normalized.some((info) => title === info || title.startsWith(info));

      if (isInfo) {
        el.classList.add('taskpro-menu-item--info');
      } else {
        el.classList.add('taskpro-menu-item--disabled');
      }
    });
  });
}
