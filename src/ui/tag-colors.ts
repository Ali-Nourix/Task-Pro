// ── ui/tag-colors.ts ──────────────────────────────────────────────────────
// Colour swatches for tags: the theme palette plus one custom colour.

import { Language } from '../types';
import { TAG_COLOR_LABELS, TAG_PALETTE, TagColor, resolveTagColor } from '../tags';

/**
 * Renders a swatch row. Palette swatches are painted with the theme variable
 * itself, so what the user picks is exactly what the chip will show in the
 * current theme.
 */
export function renderSwatches(
  container: HTMLElement,
  current: TagColor,
  language: Language,
  onPick: (color: TagColor) => void
): void {
  container.empty();
  container.addClass('taskpro-swatches');
  container.setAttribute('role', 'radiogroup');
  const names = TAG_COLOR_LABELS[language];

  for (const entry of TAG_PALETTE) {
    const swatch = container.createEl('button', { cls: 'taskpro-swatch' });
    swatch.type = 'button';
    swatch.style.setProperty('--taskpro-swatch', resolveTagColor(entry.id));
    swatch.setAttribute('role', 'radio');
    swatch.setAttribute('aria-checked', String(current === entry.id));
    swatch.setAttribute('aria-label', names[entry.id] ?? entry.id);
    swatch.title = names[entry.id] ?? entry.id;
    if (current === entry.id) swatch.addClass('is-selected');
    swatch.addEventListener('click', (event) => {
      event.preventDefault();
      onPick(entry.id);
    });
  }

  // A native colour input, wrapped so it looks like one more swatch.
  const isCustom = current.startsWith('#');
  const custom = container.createEl('label', { cls: 'taskpro-swatch taskpro-swatch--custom' });
  custom.title = names.custom;
  custom.setAttribute('aria-label', names.custom);
  if (isCustom) {
    custom.addClass('is-selected');
    custom.style.setProperty('--taskpro-swatch', current);
  }
  const input = custom.createEl('input', { type: 'color' });
  input.value = isCustom ? current : '#7a7a7a';
  input.addEventListener('change', () => onPick(input.value.toLowerCase()));
}

/**
 * A small floating swatch picker anchored to an element. Closes on pick, on
 * Escape, or on any pointer press outside it.
 */
export function openColorPopover(
  anchor: HTMLElement,
  current: TagColor,
  language: Language,
  onPick: (color: TagColor) => void
): void {
  document.querySelectorAll('.taskpro-color-popover').forEach((el) => el.remove());

  const popover = document.body.createDiv({ cls: 'taskpro-color-popover' });
  const rect = anchor.getBoundingClientRect();
  popover.style.setProperty('--taskpro-popover-top', `${Math.round(rect.bottom + 6)}px`);
  popover.style.setProperty('--taskpro-popover-left', `${Math.round(rect.left)}px`);

  const close = () => {
    document.removeEventListener('pointerdown', onPointer, true);
    document.removeEventListener('keydown', onKey, true);
    popover.remove();
  };
  const onPointer = (event: PointerEvent) => {
    if (!popover.contains(event.target as Node)) close();
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    close();
  };

  renderSwatches(popover.createDiv(), current, language, (color) => {
    onPick(color);
    close();
  });

  // Keep it on screen when the anchor sits near the right edge.
  const overflow = popover.getBoundingClientRect().right - window.innerWidth + 8;
  if (overflow > 0) {
    popover.style.setProperty('--taskpro-popover-left', `${Math.max(8, Math.round(rect.left - overflow))}px`);
  }

  document.addEventListener('pointerdown', onPointer, true);
  document.addEventListener('keydown', onKey, true);
  popover.querySelector<HTMLElement>('.is-selected, .taskpro-swatch')?.focus();
}
