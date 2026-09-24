// ── ui/deadline-editor.ts ─────────────────────────────────────────────────
// One deadline picker for every entry point: the chip menu and the board.
// Uses the Calendar plugin when it is installed, a TaskPro panel otherwise.
// ─────────────────────────────────────────────────────────────────────────────

import { App, Notice } from 'obsidian';
import { CalendarSystem, Language } from '../types';
import { gregorianToJalali, jalaliToGregorian } from '../date-utils';
import { isCalendarPluginAvailable, pickDateWithCalendar } from '../calendar-integration';
import { addPanelButtonRow, addPanelField, openTaskProPanel } from './panel';

/** A date to set, `null` to clear the deadline, or `undefined` when cancelled. */
export type DeadlineChoice = string | null | undefined;

interface DeadlineLabels {
  setDeadline: string;
  changeDeadline: string;
  clear: string;
  cancel: string;
  save: string;
  jalali: string;
  gregorian: string;
  jalaliPlaceholder: string;
  invalidJalali: string;
}

export function getDeadlineEditorLabels(language: Language): DeadlineLabels {
  return language === 'fa'
    ? {
        setDeadline: 'تعیین سررسید',
        changeDeadline: 'تغییر سررسید',
        clear: 'حذف سررسید',
        cancel: 'انصراف',
        save: 'ذخیره',
        jalali: 'جلالی',
        gregorian: 'میلادی',
        jalaliPlaceholder: 'YYYY/MM/DD (مثلا 1403/01/15)',
        invalidJalali: 'فرمت تاریخ جلالی نامعتبر است. از YYYY/MM/DD استفاده کنید',
      }
    : {
        setDeadline: 'Set Deadline',
        changeDeadline: 'Change Deadline',
        clear: 'Clear Deadline',
        cancel: 'Cancel',
        save: 'Save',
        jalali: 'Jalali',
        gregorian: 'Gregorian',
        jalaliPlaceholder: 'YYYY/MM/DD (e.g., 1403/01/15)',
        invalidJalali: 'Invalid Jalali date format. Use YYYY/MM/DD',
      };
}

function toJalaliText(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const [jy, jm, jd] = gregorianToJalali(y, m, d);
  return `${jy}/${String(jm).padStart(2, '0')}/${String(jd).padStart(2, '0')}`;
}

/** Parses `YYYY/MM/DD` Jalali into an ISO Gregorian date, or null. */
export function jalaliTextToIso(value: string): string | null {
  const match = value.match(/(\d{4})\/(\d{1,2})\/(\d{1,2})/);
  if (!match) return null;
  const [, jy, jm, jd] = match.map(Number);
  const [gy, gm, gd] = jalaliToGregorian(jy, jm, jd);
  return `${gy}-${String(gm).padStart(2, '0')}-${String(gd).padStart(2, '0')}`;
}

/** The TaskPro panel picker, with a Jalali / Gregorian switch for Jalali users. */
export function openDeadlinePanel(options: {
  language: Language;
  calendarSystem: CalendarSystem;
  deadline?: string;
}): Promise<DeadlineChoice> {
  const labels = getDeadlineEditorLabels(options.language);

  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: DeadlineChoice) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    // Escape and clicking outside close the panel without a choice; `finish`
    // ignores that call when a button already settled it.
    const { body, footer, close } = openTaskProPanel(
      options.deadline ? labels.changeDeadline : labels.setDeadline,
      { onClose: () => finish(undefined) }
    );

    let useJalali = options.calendarSystem === 'jalali';
    let input: HTMLInputElement;

    if (options.calendarSystem === 'jalali') {
      const toggle = body.createDiv({ cls: 'taskpro-panel__toggle-row' });
      const jalaliBtn = toggle.createEl('button', { text: labels.jalali, cls: useJalali ? 'mod-cta' : '' });
      const gregorianBtn = toggle.createEl('button', { text: labels.gregorian, cls: useJalali ? '' : 'mod-cta' });
      jalaliBtn.addEventListener('click', () => {
        if (useJalali) return;
        useJalali = true;
        jalaliBtn.addClass('mod-cta');
        gregorianBtn.removeClass('mod-cta');
        const iso = input.value;
        input.type = 'text';
        input.placeholder = labels.jalaliPlaceholder;
        input.value = iso ? toJalaliText(iso) : '';
      });
      gregorianBtn.addEventListener('click', () => {
        if (!useJalali) return;
        useJalali = false;
        gregorianBtn.addClass('mod-cta');
        jalaliBtn.removeClass('mod-cta');
        const iso = jalaliTextToIso(input.value);
        input.type = 'date';
        input.placeholder = '';
        input.value = iso ?? '';
      });
    }

    input = addPanelField(body, options.deadline ? labels.changeDeadline : labels.setDeadline, useJalali ? 'text' : 'date');
    input.classList.add('taskpro-panel__input--date');
    if (useJalali) input.placeholder = labels.jalaliPlaceholder;
    if (options.deadline) input.value = useJalali ? toJalaliText(options.deadline) : options.deadline;

    const save = () => {
      if (!input.value) {
        close();
        return;
      }
      const iso = useJalali ? jalaliTextToIso(input.value) : input.value;
      if (!iso) {
        new Notice(labels.invalidJalali);
        return;
      }
      // Settle before closing: close() reports a cancel through onClose.
      finish(iso);
      close();
    };

    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        save();
      }
    });

    addPanelButtonRow(footer, {
      cancelLabel: labels.cancel,
      saveLabel: labels.save,
      clearLabel: options.deadline ? labels.clear : undefined,
      onCancel: close,
      onClear: options.deadline
        ? () => {
            finish(null);
            close();
          }
        : undefined,
      onSave: save,
    });

    input.focus();
  });
}

/** Calendar plugin first, the TaskPro panel as the fallback. */
export async function pickDeadline(
  app: App,
  options: { language: Language; calendarSystem: CalendarSystem; deadline?: string }
): Promise<DeadlineChoice> {
  const labels = getDeadlineEditorLabels(options.language);
  if (isCalendarPluginAvailable(app)) {
    try {
      const selected = await pickDateWithCalendar(app, {
        calendarSystem: options.calendarSystem,
        initialDate: options.deadline,
        title: options.deadline ? labels.changeDeadline : labels.setDeadline,
        language: options.language,
      });
      return selected === null ? undefined : selected || undefined;
    } catch (error) {
      console.warn('TaskPro: Calendar plugin failed, falling back to native input:', error);
    }
  }
  return openDeadlinePanel(options);
}
