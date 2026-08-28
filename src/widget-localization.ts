// ── widget-localization.ts ─────────────────────────────────────────────────
// Shared widget text for supported UI languages.

import { Language, TaskStatus } from './types';

export type DeadlineState = 'completed' | 'missed' | 'today' | 'tomorrow' | 'soon' | 'week' | 'normal';

export interface DeadlineInfo {
  text: string;
  state: DeadlineState;
}

export function getDeadlineInfo(deadline: string, language: Language, status?: TaskStatus): DeadlineInfo {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const deadlineDate = new Date(deadline);
  deadlineDate.setHours(0, 0, 0, 0);

  const diffTime = deadlineDate.getTime() - today.getTime();
  const daysLeft = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  if (daysLeft < 0) {
    if (status === '[x]') {
      return {
        state: 'completed',
        text: language === 'fa'
          ? 'در زمان تعیین شده انجام شد'
          : 'Completed on time'
      };
    }

    return {
      state: 'missed',
      text: language === 'fa'
        ? 'در زمان تعیین شده انجام نشد'
        : 'Not completed on time'
    };
  }

  if (daysLeft === 0) {
    return {
      state: 'today',
      text: language === 'fa' ? 'امروز' : 'Today'
    };
  }

  if (daysLeft === 1) {
    return {
      state: 'tomorrow',
      text: language === 'fa' ? 'فردا' : 'Tomorrow'
    };
  }

  if (daysLeft <= 3) {
    return {
      state: 'soon',
      text: language === 'fa'
        ? `${daysLeft} روز مانده`
        : `${daysLeft}d left`
    };
  }

  if (daysLeft <= 7) {
    return {
      state: 'week',
      text: language === 'fa'
        ? `${daysLeft} روز مانده`
        : `${daysLeft}d left`
    };
  }

  return {
    state: 'normal',
    text: language === 'fa'
      ? `${daysLeft} روز مانده`
      : `${daysLeft}d left`
  };
}
