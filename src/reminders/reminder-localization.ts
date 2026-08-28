// ── reminders/reminder-localization.ts ────────────────────────────────────
// All user facing strings for the reminder feature (en / fa).
// Kept separate from widget-localization.ts because reminders own a much
// larger string surface (overlay, settings, notices).
// ─────────────────────────────────────────────────────────────────────────────

import { Language } from '../types';

export interface ReminderLabels {
  overlayTitle: string;
  defaultMessage: (count: number) => string;
  noTasks: string;
  scanFailed: string;
  dismiss: string;
  acknowledge: string;
  acknowledgeIn: (seconds: number) => string;
  snooze: (minutes: number) => string;
  openTask: string;
  overdue: string;
  dueToday: string;
  dueTomorrow: string;
  daysLeft: (days: number) => string;
  noDeadline: string;
  andMore: (count: number) => string;
  snoozed: (minutes: number) => string;
  remindersDisabled: string;
  remindersEnabled: string;
  nothingToRemind: string;
  soundUnavailable: string;
  strictHint: string;
}

const EN: ReminderLabels = {
  overlayTitle: 'Task reminder',
  defaultMessage: (count) =>
    count === 1 ? 'You have 1 task that needs attention' : `You have ${count} tasks that need attention`,
  noTasks: 'No matching tasks right now.',
  scanFailed: 'Some notes could not be read while scanning for tasks.',
  dismiss: 'Dismiss',
  acknowledge: 'I understand',
  acknowledgeIn: (seconds) => `I understand (${seconds}s)`,
  snooze: (minutes) => `Snooze ${minutes} min`,
  openTask: 'Open',
  overdue: 'Overdue',
  dueToday: 'Due today',
  dueTomorrow: 'Due tomorrow',
  daysLeft: (days) => `${days} days left`,
  noDeadline: 'No deadline',
  andMore: (count) => `and ${count} more…`,
  snoozed: (minutes) => `Reminder snoozed for ${minutes} minutes`,
  remindersDisabled: 'Daily reminders disabled',
  remindersEnabled: 'Daily reminders enabled',
  nothingToRemind: 'Nothing to remind you about right now',
  soundUnavailable: 'Reminder sound could not be played',
  strictHint: 'Strict mode: this alert must be acknowledged.',
};

const FA: ReminderLabels = {
  overlayTitle: 'یادآوری تسک‌ها',
  defaultMessage: (count) => `${count} تسک نیاز به رسیدگی دارد`,
  noTasks: 'در حال حاضر تسکی مطابق فیلترها وجود ندارد.',
  scanFailed: 'خواندن بعضی از یادداشت‌ها هنگام بررسی تسک‌ها ممکن نشد.',
  dismiss: 'بستن',
  acknowledge: 'متوجه شدم',
  acknowledgeIn: (seconds) => `متوجه شدم (${seconds} ثانیه)`,
  snooze: (minutes) => `${minutes} دقیقه بعد`,
  openTask: 'باز کردن',
  overdue: 'عقب‌افتاده',
  dueToday: 'مهلت امروز',
  dueTomorrow: 'مهلت فردا',
  daysLeft: (days) => `${days} روز باقی‌مانده`,
  noDeadline: 'بدون سررسید',
  andMore: (count) => `و ${count} مورد دیگر…`,
  snoozed: (minutes) => `یادآوری برای ${minutes} دقیقه به تعویق افتاد`,
  remindersDisabled: 'یادآوری روزانه غیرفعال شد',
  remindersEnabled: 'یادآوری روزانه فعال شد',
  nothingToRemind: 'در حال حاضر چیزی برای یادآوری وجود ندارد',
  soundUnavailable: 'پخش صدای یادآوری ممکن نشد',
  strictHint: 'حالت سخت‌گیرانه: این هشدار باید تأیید شود.',
};

export function getReminderLabels(language: Language): ReminderLabels {
  return language === 'fa' ? FA : EN;
}
