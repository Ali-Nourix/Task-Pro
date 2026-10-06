// ── board/day-picker.ts ───────────────────────────────────────────────────
// A month to pick a day from, drawn for a thumb: cells at least 44 high, the
// month's name between two arrows, the calendar the board uses (Gregorian or
// Jalali) and the week starting where it starts there. It is a grid for
// assistive technology too: the arrows move between days, Page Up and Page
// Down between months, and every day is named in full ("Saturday, 3 October
// 2026").
// ─────────────────────────────────────────────────────────────────────────────

import { setIcon } from 'obsidian';
import {
  DayKey,
  WEEKDAY_NAMES_MIN,
  addDays,
  addMonths,
  compareDays,
  firstOfMonth,
  longDay,
  monthTitle,
  monthWeeks,
  partsIn,
} from '../calendar/calendar-dates';
import type { CalendarSystem, Language } from '../types';

export interface DayPickerOptions {
  selected?: DayKey | null;
  today: DayKey;
  system: CalendarSystem;
  language: Language;
  weekStartsOn: number;
  previousLabel: string;
  nextLabel: string;
  onPick(day: DayKey): void;
}

export interface DayPickerHandle {
  el: HTMLElement;
  /** Puts the focus on the selected day, or on today. */
  focus(): void;
}

export function renderDayPicker(parent: HTMLElement, options: DayPickerOptions): DayPickerHandle {
  const { system, language } = options;
  const rtl = language === 'fa';
  const el = parent.createDiv({ cls: 'taskpro-daypick' });
  let month = firstOfMonth(options.selected ?? options.today, system);
  let focused: DayKey = options.selected ?? options.today;

  const draw = () => {
    el.empty();
    const head = el.createDiv({ cls: 'taskpro-daypick__head' });
    const arrow = (delta: number, label: string) => {
      const button = head.createEl('button', { cls: 'taskpro-daypick__arrow', attr: { 'aria-label': label } });
      button.type = 'button';
      // "Back" points where the text comes from.
      setIcon(button, (delta < 0) === rtl ? 'chevron-right' : 'chevron-left');
      button.addEventListener('click', () => {
        month = addMonths(month, system, delta);
        focused = month;
        draw();
      });
      return button;
    };
    arrow(-1, options.previousLabel);
    head.createDiv({ cls: 'taskpro-daypick__title', text: monthTitle(month, system, language), attr: { 'aria-live': 'polite' } });
    arrow(1, options.nextLabel);

    const grid = el.createDiv({ cls: 'taskpro-daypick__grid', attr: { role: 'grid', 'aria-label': monthTitle(month, system, language) } });
    const names = grid.createDiv({ cls: 'taskpro-daypick__row', attr: { role: 'row' } });
    for (let i = 0; i < 7; i++) {
      const weekday = (options.weekStartsOn + i) % 7;
      names.createDiv({ cls: 'taskpro-daypick__weekday', text: WEEKDAY_NAMES_MIN[language][weekday], attr: { role: 'columnheader' } });
    }

    const inMonth = monthWeeks(month, system, options.weekStartsOn);
    const visible = inMonth.flat();
    // The one day the keyboard enters on: the one last focused, else the first of the month.
    const entry = visible.includes(focused) ? focused : month;
    for (const week of inMonth) {
      const row = grid.createDiv({ cls: 'taskpro-daypick__row', attr: { role: 'row' } });
      for (const day of week) {
        const outside = partsIn(day, system).month !== partsIn(month, system).month;
        const cell = row.createEl('button', {
          cls: 'taskpro-daypick__day',
          text: String(partsIn(day, system).day),
          attr: { role: 'gridcell', 'aria-label': longDay(day, system, language), 'aria-selected': String(day === options.selected) },
        });
        cell.type = 'button';
        cell.dataset.day = day;
        cell.tabIndex = day === entry ? 0 : -1;
        cell.toggleClass('is-outside', outside);
        cell.toggleClass('is-today', day === options.today);
        cell.toggleClass('is-selected', day === options.selected);
        if (day === options.today) cell.setAttribute('aria-current', 'date');
        cell.addEventListener('click', () => options.onPick(day));
      }
    }

    grid.addEventListener('keydown', (event) => {
      const target = (event.target as HTMLElement).closest<HTMLElement>('.taskpro-daypick__day');
      if (!target?.dataset.day) return;
      const day = target.dataset.day;
      const next = rtl ? -1 : 1;
      let to: DayKey | null = null;
      switch (event.key) {
        case 'ArrowRight':
          to = addDays(day, next);
          break;
        case 'ArrowLeft':
          to = addDays(day, -next);
          break;
        case 'ArrowDown':
          to = addDays(day, 7);
          break;
        case 'ArrowUp':
          to = addDays(day, -7);
          break;
        case 'PageDown':
          to = addMonths(day, system, 1);
          break;
        case 'PageUp':
          to = addMonths(day, system, -1);
          break;
        case 'Home':
          to = visible[visible.indexOf(day) - (visible.indexOf(day) % 7)];
          break;
        case 'End':
          to = visible[visible.indexOf(day) - (visible.indexOf(day) % 7) + 6];
          break;
        default:
          return;
      }
      event.preventDefault();
      focusDay(to);
    });
  };

  const focusDay = (day: DayKey) => {
    focused = day;
    if (partsIn(day, system).month !== partsIn(month, system).month || partsIn(day, system).year !== partsIn(month, system).year) {
      month = firstOfMonth(day, system);
      draw();
    } else {
      el.querySelectorAll<HTMLElement>('.taskpro-daypick__day').forEach((cell) => (cell.tabIndex = cell.dataset.day === day ? 0 : -1));
    }
    el.querySelector<HTMLElement>(`.taskpro-daypick__day[data-day="${day}"]`)?.focus();
  };

  draw();
  return {
    el,
    focus: () => focusDay(compareDays(focused, month) < 0 ? month : focused),
  };
}
