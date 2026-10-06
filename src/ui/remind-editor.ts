// ── ui/remind-editor.ts ───────────────────────────────────────────────────
// Asks to be reminded of a task at one moment: a day and a time on it. The
// task menu's "Remind me" offers it beside the lead times before a plan.
// ─────────────────────────────────────────────────────────────────────────────

import { Notice } from 'obsidian';
import type { CalendarSystem, Language, TimeFormat } from '../types';
import type { RemindAt } from '../task-metadata';
import { formatClock, formatDay, isDayKey, parseClock, parseTypedClock, toClock, todayKey } from '../calendar/calendar-dates';
import { jalaliTextToIso } from './deadline-editor';
import { addPanelButtonRow, openTaskProPanel } from './panel';

/** A moment to remind at, `null` to take the reminder off, `undefined` when cancelled. */
export type RemindChoice = RemindAt | null | undefined;

const LABELS: Record<Language, {
  title: string;
  date: string;
  time: string;
  remove: string;
  cancel: string;
  save: string;
  jalaliPlaceholder: string;
  invalidDate: string;
  invalidTime: string;
}> = {
  en: {
    title: 'Remind me on a date',
    date: 'Day',
    time: 'Time',
    remove: 'Remove reminder',
    cancel: 'Cancel',
    save: 'Save',
    jalaliPlaceholder: 'YYYY/MM/DD (e.g., 1405/07/06)',
    invalidDate: 'That is not a date',
    invalidTime: 'That is not a time',
  },
  fa: {
    title: 'یادآوری در یک تاریخ',
    date: 'روز',
    time: 'ساعت',
    remove: 'برداشتن یادآوری',
    cancel: 'انصراف',
    save: 'ذخیره',
    jalaliPlaceholder: 'YYYY/MM/DD (مثلا 1405/07/06)',
    invalidDate: 'این تاریخ درست نیست',
    invalidTime: 'این ساعت درست نیست',
  },
};

export function openRemindPanel(options: {
  language: Language;
  calendarSystem: CalendarSystem;
  timeFormat?: TimeFormat;
  /** The moment already chosen, to start from. */
  current?: RemindAt;
  /** Where a new one starts: the task's plan day and start, when it has them. */
  suggest?: RemindAt;
}): Promise<RemindChoice> {
  const labels = LABELS[options.language];
  const jalali = options.calendarSystem === 'jalali';
  const start = options.current ?? options.suggest;

  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: RemindChoice) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const { panel, body, footer, close } = openTaskProPanel(labels.title, { onClose: () => finish(undefined) });
    panel.addClass('taskpro-remind-panel');

    const dateField = body.createDiv({ cls: 'taskpro-panel__field' });
    dateField.createEl('label', { text: labels.date, cls: 'taskpro-panel__label' });
    const dateInput = dateField.createEl('input', {
      type: jalali ? 'text' : 'date',
      cls: 'taskpro-panel__input taskpro-panel__input--date',
    });
    const day = start?.date ?? todayKey();
    if (jalali) {
      dateInput.placeholder = labels.jalaliPlaceholder;
      dateInput.setAttribute('dir', 'ltr');
      dateInput.value = formatDay(day, 'jYYYY/jMM/jDD', 'fa');
    } else {
      dateInput.value = day;
    }

    const format = options.timeFormat ?? '24h';
    const timeField = body.createDiv({ cls: 'taskpro-panel__field' });
    timeField.createEl('label', { text: labels.time, cls: 'taskpro-panel__label' });
    const timeInput = timeField.createEl('input', { type: 'text', cls: 'taskpro-panel__input', attr: { dir: 'ltr', autocomplete: 'off' } });
    timeInput.value = formatClock(parseClock(start?.time) ?? 9 * 60, format, options.language);
    timeInput.addEventListener('focus', () => timeInput.select());

    const save = () => {
      const date = jalali ? jalaliTextToIso(dateInput.value) : dateInput.value;
      if (!date || !isDayKey(date)) {
        new Notice(labels.invalidDate);
        return;
      }
      const minutes = parseTypedClock(timeInput.value);
      if (minutes === null || minutes >= 24 * 60) {
        new Notice(labels.invalidTime);
        return;
      }
      // Settle before closing: close() reports a cancel through onClose.
      finish({ date, time: toClock(minutes) });
      close();
    };
    for (const input of [dateInput, timeInput]) {
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          save();
        }
      });
    }

    addPanelButtonRow(footer, {
      cancelLabel: labels.cancel,
      saveLabel: labels.save,
      clearLabel: options.current ? labels.remove : undefined,
      onCancel: close,
      onClear: options.current
        ? () => {
            finish(null);
            close();
          }
        : undefined,
      onSave: save,
    });

    dateInput.focus();
  });
}
