import { pomodoroText } from '../pomodoro';
// ── ui/chips.ts ───────────────────────────────────────────────────────────
// Shared DOM helpers for status / progress / deadline chips
// ─────────────────────────────────────────────────────────────────────────────

import { setIcon } from 'obsidian';
import {
  CalendarSystem,
  Language,
  TaskStatus,
  STATUS_LABELS,
  TaskPriority,
  PRIORITY_ICON_NAMES,
  PRIORITY_LABELS,
  STATUS_ICON_NAMES,
  CHIP_ICON_NAMES,
  TaskRepeat,
  TaskSchedule,
  TaskTimer,
  TimeFormat,
  formatTimerClock,
  timerRemainingSeconds,
  timerState,
} from '../types';
import { ResolvedTag, applyTagColor } from '../tags';
import { getDeadlineInfo } from '../widget-localization';
import { getRepeatLabels, getTimerLabels } from '../timer-localization';
import { isSchedulePast, scheduleText } from '../calendar/schedule-text';

export function applyChipScale(container: HTMLElement, badgeSize: number): void {
  container.style.setProperty('--taskpro-badge-font-size', `${badgeSize}px`);
}

/**
 * Builds a chip as `[icon][label]`.
 *
 * Icons come from Obsidian's own (Lucide) icon set through `setIcon` instead of
 * emoji, so they follow the active theme's colour, weight and font size and
 * render identically on every platform.
 */
export function buildChip(className: string, iconName: string | null, label: string): HTMLElement {
  const badge = document.createElement('span');
  badge.className = `taskpro-chip ${className}`;

  if (iconName) {
    const icon = document.createElement('span');
    icon.className = 'taskpro-chip__icon';
    icon.setAttribute('aria-hidden', 'true');
    setIcon(icon, iconName);
    badge.appendChild(icon);
  }

  if (label) {
    const text = document.createElement('span');
    text.className = 'taskpro-chip__label';
    text.textContent = label;
    badge.appendChild(text);
  }

  return badge;
}

export function createProgressChip(options: {
  currentSteps: number;
  totalSteps: number;
  filePath: string;
  lineContent: string;
  blockId?: string;
  language: Language;
}): HTMLElement {
  const percentage = Math.round((options.currentSteps / options.totalSteps) * 100);
  const badge = buildChip('taskpro-progress-badge', CHIP_ICON_NAMES.progress, `${percentage}%`);
  badge.setAttribute('data-progress', `${options.currentSteps}/${options.totalSteps}`);

  badge.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    badge.dispatchEvent(
      new CustomEvent('taskpro-progress-click', {
        bubbles: true,
        detail: {
          filePath: options.filePath,
          lineContent: options.lineContent,
          blockId: options.blockId,
          currentSteps: options.currentSteps,
          totalSteps: options.totalSteps,
          language: options.language,
          targetElement: badge,
        },
      })
    );
  });

  return badge;
}

/**
 * Priority chip. Clicking it reuses the task popover so priority editing lives
 * in the same place as status / deadline / progress editing.
 */
export function createPriorityChip(options: {
  priority: TaskPriority;
  language: Language;
  filePath: string;
  lineContent: string;
  blockId?: string;
  status: TaskStatus;
  deadline?: string;
  tags?: string[];
}): HTMLElement {
  const label = PRIORITY_LABELS[options.language][options.priority];
  const badge = buildChip(
    'taskpro-priority-badge',
    PRIORITY_ICON_NAMES[options.priority],
    label
  );
  badge.setAttribute('data-priority', options.priority);
  badge.setAttribute('aria-label', label);
  badge.setAttribute('role', 'button');
  badge.tabIndex = 0;

  badge.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    badge.dispatchEvent(
      new CustomEvent('taskpro-badge-click', {
        bubbles: true,
        detail: {
          status: options.status,
          deadline: options.deadline,
          language: options.language,
          lineContent: options.lineContent,
          filePath: options.filePath,
          targetElement: badge,
          blockId: options.blockId,
          tags: options.tags,
          priority: options.priority,
        },
      })
    );
  });

  return badge;
}

export function createStatusChip(options: {
  status: TaskStatus;
  language: Language;
  filePath: string;
  lineContent: string;
  blockId?: string;
  tags?: string[];
  deadline?: string;
  priority?: TaskPriority;
}): HTMLElement {
  const badge = buildChip(
    'taskpro-interactive-badge',
    STATUS_ICON_NAMES[options.status],
    STATUS_LABELS[options.language][options.status]
  );
  badge.setAttribute('data-status', options.status);
  badge.setAttribute('role', 'button');
  badge.setAttribute('aria-haspopup', 'menu');
  badge.tabIndex = 0;

  badge.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    badge.dispatchEvent(
      new CustomEvent('taskpro-badge-click', {
        bubbles: true,
        detail: {
          status: options.status,
          deadline: options.deadline,
          language: options.language,
          lineContent: options.lineContent,
          filePath: options.filePath,
          targetElement: badge,
          blockId: options.blockId,
          tags: options.tags,
          priority: options.priority,
        },
      })
    );
  });

  badge.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      event.stopPropagation();
      badge.click();
    }
  });

  return badge;
}

export function createDeadlineChip(deadline: string, language: Language, status?: TaskStatus): HTMLElement {
  const deadlineInfo = getDeadlineInfo(deadline, language, status);
  const badge = buildChip('taskpro-deadline-badge', CHIP_ICON_NAMES.deadline, deadlineInfo.text);
  badge.setAttribute('data-state', deadlineInfo.state);
  return badge;
}


/**
 * Focus-timer chip. The label is a live countdown, so it carries a stable
 * `data-timer-key` that the timer service uses to retarget it every second
 * without rebuilding the surrounding decoration.
 */
export function createTimerChip(options: {
  timer: TaskTimer;
  filePath: string;
  lineContent: string;
  blockId?: string;
  language: Language;
}): HTMLElement {
  const labels = getTimerLabels(options.language);
  const now = Date.now();
  const state = timerState(options.timer, now);
  const remaining = timerRemainingSeconds(options.timer, now);
  const icon =
    state === 'paused'
      ? CHIP_ICON_NAMES.timerPaused
      : state === 'done'
        ? CHIP_ICON_NAMES.timerDone
        : CHIP_ICON_NAMES.timer;

  const badge = buildChip(
    'taskpro-timer-badge',
    icon,
    [pomodoroText(options.timer, options.language), state === 'done' ? labels.doneChip : formatTimerClock(remaining)].filter(Boolean).join(' · ')
  );
  badge.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); badge.click(); }
  });
  badge.dataset.state = state;
  if (options.blockId) badge.dataset.timerKey = `${options.filePath}:${options.blockId}`;
  badge.setAttribute('aria-label', `${pomodoroText(options.timer, options.language)} ${labels.chipAria(formatTimerClock(remaining), state)}`.trim());
  badge.setAttribute('role', 'button');
  badge.tabIndex = 0;

  badge.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    badge.dispatchEvent(
      new CustomEvent('taskpro-timer-click', {
        bubbles: true,
        detail: {
          filePath: options.filePath,
          lineContent: options.lineContent,
          blockId: options.blockId,
          language: options.language,
          targetElement: badge,
        },
      })
    );
  });

  return badge;
}

/**
 * A user tag. Colour comes from the tag's own accent through the shared chip
 * recipe, so a "blue" tag is the theme's blue and stays legible in both modes.
 * Clicking it opens the tag picker for the task it sits on.
 */
export function createTagChip(options: {
  tag: ResolvedTag;
  filePath: string;
  lineContent: string;
  blockId?: string;
  tagKeys: string[];
}): HTMLElement {
  const badge = buildChip('taskpro-tag-chip', null, options.tag.name);
  applyTagColor(badge, options.tag.color);
  badge.dataset.tag = options.tag.key;
  if (options.tag.unknown) badge.classList.add('is-unknown');
  badge.setAttribute('aria-label', options.tag.name);
  badge.setAttribute('role', 'button');
  badge.tabIndex = 0;

  badge.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    badge.dispatchEvent(
      new CustomEvent('taskpro-tags-click', {
        bubbles: true,
        detail: {
          filePath: options.filePath,
          lineContent: options.lineContent,
          blockId: options.blockId,
          tagKeys: options.tagKeys,
          targetElement: badge,
        },
      })
    );
  });

  return badge;
}

/**
 * Appends one chip per tag. The chip row is laid out reversed (see
 * .taskpro-badge-container), so the tags go in back to front: that way they
 * read in note order outward from the task text, in LTR and RTL notes alike.
 */
export function appendTagChips(
  container: HTMLElement,
  tags: ResolvedTag[],
  context: { filePath: string; lineContent: string; blockId?: string }
): void {
  const tagKeys = tags.map((tag) => tag.key);
  for (const tag of [...tags].reverse()) {
    container.appendChild(createTagChip({ tag, tagKeys, ...context }));
  }
}

/**
 * When the task is planned: "Today, 09:00 – 10:30". Clicking it opens the task
 * menu, where the plan is changed or removed beside every other edit.
 */
export function createScheduleChip(options: {
  schedule: TaskSchedule;
  language: Language;
  calendarSystem: CalendarSystem;
  timeFormat: TimeFormat;
  filePath: string;
  lineContent: string;
  blockId?: string;
  status: TaskStatus;
  deadline?: string;
  priority?: TaskPriority;
  tags?: string[];
}): HTMLElement {
  const label = scheduleText(options.schedule, options);
  const badge = buildChip(
    'taskpro-schedule-badge',
    options.schedule.start ? CHIP_ICON_NAMES.schedule : CHIP_ICON_NAMES.scheduleDay,
    label
  );
  badge.dataset.schedule = options.schedule.date;
  // A plan whose day went by with the task still open.
  if (options.status !== '[x]' && isSchedulePast(options.schedule)) badge.dataset.state = 'past';
  badge.setAttribute('aria-label', label);
  badge.setAttribute('role', 'button');
  badge.tabIndex = 0;

  badge.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    badge.dispatchEvent(
      new CustomEvent('taskpro-badge-click', {
        bubbles: true,
        detail: {
          status: options.status,
          deadline: options.deadline,
          language: options.language,
          lineContent: options.lineContent,
          filePath: options.filePath,
          targetElement: badge,
          blockId: options.blockId,
          tags: options.tags,
          priority: options.priority,
        },
      })
    );
  });

  return badge;
}

/**
 * Recurrence chip. Clicking it reuses the task popover, so changing the
 * interval lives beside every other task edit.
 */
export function createRepeatChip(options: {
  repeat: TaskRepeat;
  language: Language;
  filePath: string;
  lineContent: string;
  blockId?: string;
  status: TaskStatus;
  deadline?: string;
  priority?: TaskPriority;
  tags?: string[];
}): HTMLElement {
  const labels = getRepeatLabels(options.language);
  const label = labels.chip(options.repeat);
  const badge = buildChip('taskpro-repeat-badge', CHIP_ICON_NAMES.repeat, label);
  badge.setAttribute('data-repeat', `${options.repeat.every}${options.repeat.unit[0]}`);
  badge.setAttribute('aria-label', label);
  badge.setAttribute('role', 'button');
  badge.tabIndex = 0;

  badge.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    badge.dispatchEvent(
      new CustomEvent('taskpro-badge-click', {
        bubbles: true,
        detail: {
          status: options.status,
          deadline: options.deadline,
          language: options.language,
          lineContent: options.lineContent,
          filePath: options.filePath,
          targetElement: badge,
          blockId: options.blockId,
          tags: options.tags,
          priority: options.priority,
        },
      })
    );
  });

  return badge;
}

const RELATION_LABELS: Record<Language, {
  subtasks: (done: number, total: number) => string;
  waitingOn: string;
  waitedOn: string;
  gone: string;
  tasks: (count: number) => string;
  remindAt: (minutes: number) => string;
  remindOff: string;
  remindMoment: string;
}> = {
  en: {
    subtasks: (done, total) => `${done} of ${total} subtasks done`,
    waitingOn: 'Waiting on',
    waitedOn: 'Was waiting on (done)',
    gone: 'a task that is gone',
    tasks: (count) => `${count} tasks`,
    remindAt: (minutes) => (minutes === 0 ? 'Reminder at the start' : `Reminder ${minutes} min before`),
    remindOff: 'No reminder',
    remindMoment: 'Reminder',
  },
  fa: {
    subtasks: (done, total) => `${done} از ${total} زیرتسک انجام شده`,
    waitingOn: 'منتظرِ',
    waitedOn: 'منتظرِ این‌ها بود (انجام شد)',
    gone: 'تسکی که دیگر نیست',
    tasks: (count) => `${count} تسک`,
    remindAt: (minutes) => (minutes === 0 ? 'یادآوری سر شروع' : `یادآوری ${minutes} دقیقه قبل`),
    remindOff: 'بدون یادآوری',
    remindMoment: 'یادآوری',
  },
};

/** A parent's subtasks as a count, "2/4", where it has no progress bar of its own. */
export function createSubtaskChip(done: number, total: number, language: Language): HTMLElement {
  const badge = buildChip('taskpro-subtask-badge', 'list-checks', `${done}/${total}`);
  badge.dataset.state = done === total ? 'done' : 'open';
  badge.style.setProperty('--taskpro-subtask-done', String(total ? done / total : 0));
  const text = RELATION_LABELS[language].subtasks(done, total);
  badge.setAttribute('aria-label', text);
  badge.title = text;
  return badge;
}

/** One task a line waits on, as its chip reads it. */
export interface WaitingChipItem {
  title: string;
  done: boolean;
  missing: boolean;
}

/**
 * What a task waits on: the task's name when it is one, a count when there
 * are more. Amber while any of them is open; quiet once they are all done.
 * A click opens the first one still open. `onOpen` gets its index.
 */
export function createWaitingChip(items: readonly WaitingChipItem[], language: Language, onOpen: (index: number) => void): HTMLElement {
  const labels = RELATION_LABELS[language];
  const open = items.findIndex((item) => !item.done && !item.missing);
  const settled = open === -1;
  const name = (item: WaitingChipItem) => (item.missing ? labels.gone : item.title);
  const text = items.length === 1 ? name(items[0]) : labels.tasks(items.length);
  const badge = buildChip('taskpro-waiting-badge', settled ? 'check-check' : 'hourglass', text);
  badge.dataset.state = settled ? 'done' : 'waiting';
  const tip = `${settled ? labels.waitedOn : labels.waitingOn}: ${items.map(name).join(language === 'fa' ? '، ' : ', ')}`;
  badge.setAttribute('aria-label', tip);
  badge.title = tip;
  badge.setAttribute('role', 'button');
  badge.tabIndex = 0;
  const label = badge.querySelector('.taskpro-chip__label');
  label?.setAttribute('dir', 'auto');
  badge.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    onOpen(settled ? 0 : open);
  });
  return badge;
}

/** A reminder at a moment of its own: a bell and when, "Tomorrow, 09:30". It turns quiet once the moment has gone. */
export function createRemindChip(
  at: { date: string; time: string },
  options: { language: Language; calendarSystem: CalendarSystem; timeFormat: TimeFormat; status: TaskStatus }
): HTMLElement {
  const label = scheduleText({ date: at.date, start: at.time }, options);
  const badge = buildChip('taskpro-remind-badge', 'bell', label);
  badge.dataset.remind = `${at.date} ${at.time}`;
  const [hours, minutes] = at.time.split(':').map(Number);
  const [year, month, day] = at.date.split('-').map(Number);
  const gone = options.status === '[x]' || new Date(year, month - 1, day, hours, minutes).getTime() < Date.now();
  if (gone) badge.dataset.state = 'past';
  const text = `${RELATION_LABELS[options.language].remindMoment}: ${label}`;
  badge.setAttribute('aria-label', text);
  badge.title = text;
  return badge;
}

/** A small bell on a plan chip, for a task with a reminder time of its own. */
export function addRemindMark(badge: HTMLElement, minutes: number | null, language: Language): void {
  const mark = document.createElement('span');
  mark.className = 'taskpro-chip__remind';
  setIcon(mark, minutes === null ? 'bell-off' : 'bell');
  const text = minutes === null ? RELATION_LABELS[language].remindOff : RELATION_LABELS[language].remindAt(minutes);
  mark.setAttribute('aria-label', text);
  mark.title = text;
  badge.appendChild(mark);
}
