// ── ui/schedule-editor.ts ─────────────────────────────────────────────────
// Plans a task for a day, and optionally a time on it, from the command
// palette or the task menu. The calendar does the same by dragging.
// ─────────────────────────────────────────────────────────────────────────────

import { getTaskTimeZone, taskClockParts } from '../task-clock';
import { Notice } from 'obsidian';
import { CalendarSystem, Language, TaskSchedule, TimeFormat } from '../types';
import { formatClock, formatDay, isDayKey, parseClock, parseTypedClock, toClock, todayKey } from '../calendar/calendar-dates';
import { jalaliTextToIso } from './deadline-editor';
import { addPanelButtonRow, openTaskProPanel } from './panel';

/** A schedule to set, `null` to take the task off the calendar, `undefined` when cancelled. */
export type ScheduleChoice = TaskSchedule | null | undefined;

interface ScheduleLabels {
  plan: string;
  changePlan: string;
  date: string;
  from: string;
  to: string;
  allDay: string;
  remove: string;
  cancel: string;
  save: string;
  jalaliPlaceholder: string;
  invalidDate: string;
  invalidTime: string;
}

export function getScheduleEditorLabels(language: Language): ScheduleLabels {
  return language === 'fa'
    ? {
        plan: 'برنامه‌ریزی تسک',
        changePlan: 'تغییر برنامه',
        date: 'روز',
        from: 'از',
        to: 'تا',
        allDay: 'بدون ساعت (تمام روز)',
        remove: 'برداشتن از تقویم',
        cancel: 'انصراف',
        save: 'ذخیره',
        jalaliPlaceholder: 'YYYY/MM/DD (مثلا 1405/07/06)',
        invalidDate: 'این تاریخ درست نیست',
        invalidTime: 'پایان باید بعد از شروع باشد',
      }
    : {
        plan: 'Plan Task',
        changePlan: 'Change Plan',
        date: 'Day',
        from: 'From',
        to: 'To',
        allDay: 'No set time (all day)',
        remove: 'Remove from Calendar',
        cancel: 'Cancel',
        save: 'Save',
        jalaliPlaceholder: 'YYYY/MM/DD (e.g., 1405/07/06)',
        invalidDate: 'That is not a date',
        invalidTime: 'The end has to be after the start',
      };
}

export function openSchedulePanel(options: {
  language: Language;
  calendarSystem: CalendarSystem;
  schedule?: TaskSchedule;
  /** Minutes a new timed plan lasts. */
  defaultDuration?: number;
  timeFormat?: TimeFormat;
}): Promise<ScheduleChoice> {
  const labels = getScheduleEditorLabels(options.language);
  const jalali = options.calendarSystem === 'jalali';
  const current = options.schedule;

  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: ScheduleChoice) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const { panel, body, footer, close } = openTaskProPanel(current ? labels.changePlan : labels.plan, {
      onClose: () => finish(undefined),
    });
    panel.addClass('taskpro-schedule-panel');
    if (getTaskTimeZone()) body.createDiv({ cls: 'taskpro-schedule-zone', text: getTaskTimeZone() });

    const dateField = body.createDiv({ cls: 'taskpro-panel__field' });
    dateField.createEl('label', { text: labels.date, cls: 'taskpro-panel__label' });
    const dateInput = dateField.createEl('input', {
      type: jalali ? 'text' : 'date',
      cls: 'taskpro-panel__input taskpro-panel__input--date',
    });
    const day = current?.date ?? todayKey();
    if (jalali) {
      dateInput.placeholder = labels.jalaliPlaceholder;
      dateInput.setAttribute('dir', 'ltr');
      dateInput.value = formatDay(day, 'jYYYY/jMM/jDD', 'fa');
    } else {
      dateInput.value = day;
    }

    const allDayRow = body.createEl('label', { cls: 'taskpro-schedule-panel__allday' });
    const allDay = allDayRow.createEl('input', { type: 'checkbox' });
    allDayRow.createSpan({ text: labels.allDay });
    allDay.checked = !current?.start;

    const times = body.createDiv({ cls: 'taskpro-schedule-panel__times' });
    // Typed times, shown on TaskPro's clock rather than the computer's locale.
    const format = options.timeFormat ?? '24h';
    const timeField = (label: string, minutes: number) => {
      const field = times.createDiv({ cls: 'taskpro-panel__field' });
      field.createEl('label', { text: label, cls: 'taskpro-panel__label' });
      const input = field.createEl('input', { type: 'text', cls: 'taskpro-panel__input', attr: { dir: 'ltr', autocomplete: 'off' } });
      input.value = formatClock(minutes, format, options.language);
      input.addEventListener('focus', () => input.select());
      return input;
    };
    const duration = options.defaultDuration ?? 60;
    const startMinutes = parseClock(current?.start) ?? Math.min(23 * 60, Math.ceil(taskClockParts().minutes / 15) * 15);
    const startInput = timeField(labels.from, startMinutes);
    const endInput = timeField(labels.to, parseClock(current?.end) ?? Math.min(24 * 60, startMinutes + duration));
    const syncTimes = () => {
      times.toggleClass('is-hidden', allDay.checked);
    };
    syncTimes();
    allDay.addEventListener('change', syncTimes);

    const save = () => {
      const date = jalali ? jalaliTextToIso(dateInput.value) : dateInput.value;
      if (!date || !isDayKey(date)) {
        new Notice(labels.invalidDate);
        return;
      }
      let choice: TaskSchedule = { date };
      if (!allDay.checked) {
        const start = parseTypedClock(startInput.value);
        let end = parseTypedClock(endInput.value);
        if (end === 0) end = 24 * 60;
        if (start === null || end === null || end <= start) {
          new Notice(labels.invalidTime);
          return;
        }
        choice = { date, start: toClock(start), end: toClock(end) };
      }
      // Settle before closing: close() reports a cancel through onClose.
      finish(choice);
      close();
    };

    for (const input of [dateInput, startInput, endInput]) {
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
      clearLabel: current ? labels.remove : undefined,
      onCancel: close,
      onClear: current
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
