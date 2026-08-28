// ── timer-localization.ts ─────────────────────────────────────────────────
// Text for the focus-timer and recurrence capabilities.
// ─────────────────────────────────────────────────────────────────────────────

import { Language, RepeatUnit, TaskRepeat, TaskTimerState } from './types';

export interface TimerLabels {
  timerLabel: string;
  doneChip: string;
  chipAria: (clock: string, state: TaskTimerState) => string;
  statusBarAria: (note: string) => string;
  finishedTitle: string;
  finishedBody: (task: string) => string;
  finishedNotice: (task: string) => string;
  start: string;
  resume: string;
  pause: string;
  reset: string;
  extend: (minutes: number) => string;
  changeDuration: string;
  removeTimer: string;
  timerRemoved: string;
  timerSettings: string;
  minutes: string;
  invalidMinutes: string;
  timerUpdated: (clock: string) => string;
  addTimer: string;
  spent: (clock: string) => string;
  cancel: string;
  save: string;
}

export function getTimerLabels(language: Language): TimerLabels {
  if (language === 'fa') {
    return {
      timerLabel: 'تایمر تمرکز',
      doneChip: 'تمام شد',
      chipAria: (clock, state) =>
        state === 'running'
          ? `تایمر در حال اجرا، ${clock} باقی مانده`
          : state === 'paused'
            ? `تایمر متوقف شده، ${clock} باقی مانده`
            : state === 'done'
              ? 'تایمر تمام شد'
              : `تایمر آماده، ${clock}`,
      statusBarAria: (note) => `تایمر فعال در ${note}`,
      finishedTitle: 'تایمر تسک تمام شد',
      finishedBody: (task) => `زمان تعیین‌شده برای «${task}» به پایان رسید.`,
      finishedNotice: (task) => `⏱ تایمر «${task}» تمام شد`,
      start: 'شروع تایمر',
      resume: 'ادامه تایمر',
      pause: 'توقف تایمر',
      reset: 'بازنشانی تایمر',
      extend: (minutes) => `${minutes} دقیقه بیشتر`,
      changeDuration: 'تغییر مدت تایمر',
      removeTimer: 'حذف تایمر',
      timerRemoved: '🧹 تایمر حذف شد',
      timerSettings: 'تنظیمات تایمر تمرکز',
      minutes: 'مدت (دقیقه)',
      invalidMinutes: 'مدت باید عددی بزرگتر از صفر باشد',
      timerUpdated: (clock) => `✓ تایمر تنظیم شد: ${clock}`,
      addTimer: 'افزودن تایمر تمرکز',
      spent: (clock) => `زمان صرف‌شده: ${clock}`,
      cancel: 'انصراف',
      save: 'ذخیره',
    };
  }

  return {
    timerLabel: 'Focus timer',
    doneChip: 'Done',
    chipAria: (clock, state) =>
      state === 'running'
        ? `Timer running, ${clock} left`
        : state === 'paused'
          ? `Timer paused, ${clock} left`
          : state === 'done'
            ? 'Timer finished'
            : `Timer ready, ${clock}`,
    statusBarAria: (note) => `Focus timer running in ${note}`,
    finishedTitle: 'Task timer finished',
    finishedBody: (task) => `Time is up for “${task}”.`,
    finishedNotice: (task) => `⏱ Timer finished for “${task}”`,
    start: 'Start timer',
    resume: 'Resume timer',
    pause: 'Pause timer',
    reset: 'Reset timer',
    extend: (minutes) => `Add ${minutes} minutes`,
    changeDuration: 'Change duration',
    removeTimer: 'Remove timer',
    timerRemoved: '🧹 Timer removed',
    timerSettings: 'Focus Timer Settings',
    minutes: 'Duration (minutes)',
    invalidMinutes: 'Duration must be a number greater than 0',
    timerUpdated: (clock) => `✓ Timer set to ${clock}`,
    addTimer: 'Add Focus Timer',
    spent: (clock) => `Time spent: ${clock}`,
    cancel: 'Cancel',
    save: 'Save',
  };
}

export interface RepeatLabels {
  repeatLabel: string;
  chip: (repeat: TaskRepeat) => string;
  addRepeat: string;
  changeRepeat: string;
  removeRepeat: string;
  repeatRemoved: string;
  rolledForward: (date: string) => string;
  preset: (repeat: TaskRepeat) => string;
  custom: string;
  customTitle: string;
  every: string;
  unit: string;
  units: Record<RepeatUnit, string>;
  invalidEvery: string;
  cancel: string;
  save: string;
}

export function getRepeatLabels(language: Language): RepeatLabels {
  if (language === 'fa') {
    const units: Record<RepeatUnit, string> = { day: 'روز', week: 'هفته', month: 'ماه' };
    const phrase = (repeat: TaskRepeat) =>
      repeat.every === 1 ? `هر ${units[repeat.unit]}` : `هر ${repeat.every} ${units[repeat.unit]}`;
    return {
      repeatLabel: 'تکرار',
      chip: phrase,
      addRepeat: 'تکرار شدن تسک',
      changeRepeat: 'تغییر دوره تکرار',
      removeRepeat: 'حذف تکرار',
      repeatRemoved: '🧹 تکرار حذف شد',
      rolledForward: (date) => `🔁 تکرار شد؛ سررسید بعدی: ${date}`,
      preset: phrase,
      custom: 'دوره دلخواه…',
      customTitle: 'دوره تکرار دلخواه',
      every: 'هر',
      unit: 'واحد',
      units,
      invalidEvery: 'عدد تکرار باید بزرگتر از صفر باشد',
      cancel: 'انصراف',
      save: 'ذخیره',
    };
  }

  const units: Record<RepeatUnit, string> = { day: 'day', week: 'week', month: 'month' };
  const phrase = (repeat: TaskRepeat) =>
    repeat.every === 1 ? `Every ${units[repeat.unit]}` : `Every ${repeat.every} ${units[repeat.unit]}s`;
  return {
    repeatLabel: 'Repeat',
    chip: phrase,
    addRepeat: 'Repeat This Task',
    changeRepeat: 'Change repeat interval',
    removeRepeat: 'Stop repeating',
    repeatRemoved: '🧹 Repeat removed',
    rolledForward: (date) => `🔁 Repeated — next due ${date}`,
    preset: phrase,
    custom: 'Custom interval…',
    customTitle: 'Custom Repeat Interval',
    every: 'Every',
    unit: 'Unit',
    units,
    invalidEvery: 'The interval must be greater than 0',
    cancel: 'Cancel',
    save: 'Save',
  };
}
