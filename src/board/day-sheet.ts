// ── board/day-sheet.ts ────────────────────────────────────────────────────
// A month to pick one day from, as a sheet of its own: the task's sheet
// offers "Pick a date…" for the days the quick choices do not reach.
// ─────────────────────────────────────────────────────────────────────────────

import { setIcon } from 'obsidian';
import { openCalendarPopover, PopoverHandle } from '../calendar/calendar-popover';
import { DayKey, todayKey } from '../calendar/calendar-dates';
import type { CalendarSystem, Language } from '../types';
import { renderDayPicker } from './day-picker';

export interface DaySheetOptions {
  container: HTMLElement;
  anchor: HTMLElement | DOMRect;
  language: Language;
  system: CalendarSystem;
  weekStartsOn: number;
  title: string;
  closeLabel: string;
  previousLabel: string;
  nextLabel: string;
  selected?: DayKey | null;
  onPick(day: DayKey): void;
  hold(on: boolean): void;
}

export function openDaySheet(options: DaySheetOptions): PopoverHandle {
  options.hold(true);
  return openCalendarPopover({
    container: options.container,
    anchor: options.anchor,
    cls: 'taskpro-day-sheet',
    rtl: options.language === 'fa',
    onClose: () => options.hold(false),
    build: (el, handle) => {
      el.setAttribute('aria-labelledby', 'taskpro-day-sheet-title');
      el.setAttribute('aria-modal', 'true');
      const head = el.createDiv({ cls: 'taskpro-qa__head' });
      head.createEl('h2', { cls: 'taskpro-qa__title', text: options.title, attr: { id: 'taskpro-day-sheet-title' } });
      const close = head.createEl('button', { cls: 'taskpro-qa__close', attr: { 'aria-label': options.closeLabel } });
      close.type = 'button';
      setIcon(close, 'x');
      close.addEventListener('click', () => handle.close());
      const picker = renderDayPicker(el, {
        selected: options.selected ?? null,
        today: todayKey(),
        system: options.system,
        language: options.language,
        weekStartsOn: options.weekStartsOn,
        previousLabel: options.previousLabel,
        nextLabel: options.nextLabel,
        onPick: (day) => {
          handle.close();
          options.onPick(day);
        },
      });
      window.setTimeout(() => picker.focus(), 60);
    },
  });
}
