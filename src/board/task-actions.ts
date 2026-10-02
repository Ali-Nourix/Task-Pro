// ── board/task-actions.ts ─────────────────────────────────────────────────
// Everything that can be done to a task, as menu sections: what a right
// click on a task opens, on the board and on the calendar alike, and what the
// property chips of a task's card open one piece of. Each property is one row
// with its value beside it and its choices one step away, so the markers a
// task line can carry are all a click and a hover from any task.
// ─────────────────────────────────────────────────────────────────────────────

import {
  CalendarSystem,
  Language,
  PRIORITY_ICON_NAMES,
  PRIORITY_LABELS,
  REPEAT_PRESETS,
  STATUS_ICON_NAMES,
  STATUS_LABELS,
  TASK_PRIORITIES,
  TaskRepeat,
  TaskSchedule,
  TaskStatus,
  TimeFormat,
} from '../types';
import type { TaskTag } from '../tags';
import { isolate } from '../bidi';
import { resolveTag, resolveTagColor } from '../tags';
import { openContextMenu } from '../ui/context-menu';
import type { MenuEntry, MenuSection } from '../ui/context-menu';
import { RelationIndex } from './task-relations';
import { addPanelButtonRow, addPanelField, openTaskProPanel } from '../ui/panel';
import { openCustomRepeatPanel, openProgressPanel } from '../task-popover';
import { getRepeatLabels } from '../timer-localization';
import { getDeadlineInfo } from '../widget-localization';
import { addDays, formatClock, parseClock, shortDay, todayKey } from '../calendar/calendar-dates';
import { scheduleDayText } from '../calendar/schedule-text';
import { descendantsOf, indexFamilies } from '../calendar/calendar-items';
import { BOARD_STATUS_ORDER } from './board-query';
import { displayTitle } from './board-text';
import type { BoardTask } from './task-store';
import type { TaskBoardHost } from './task-board';

const STATUS_SWATCH: Record<TaskStatus, string> = {
  '[ ]': 'var(--taskpro-accent-notstarted)',
  '[/]': 'var(--taskpro-accent-progress)',
  '[!]': 'var(--taskpro-accent-notdone)',
  '[x]': 'var(--taskpro-accent-done)',
};

interface ActionLabels {
  openInNote: string;
  rename: string;
  properties: string;
  status: string;
  priority: string;
  noPriority: string;
  tags: string;
  noTags: string;
  editTags: string;
  deadline: string;
  plan: string;
  repeat: string;
  progress: string;
  today: string;
  tomorrow: string;
  nextWeek: string;
  pickDate: string;
  pickTime: string;
  removeDeadline: string;
  removePlan: string;
  none: string;
  addProgress: string;
  nextStep: (next: string) => string;
  editSteps: string;
  removeProgress: string;
  create: string;
  addSubtask: string;
  subtaskTitle: string;
  duplicate: string;
  select: string;
  copyLink: string;
  linkCopied: string;
  moveTo: string;
  findNote: string;
  moved: (title: string, note: string) => string;
  movedMany: (count: number, note: string) => string;
  deletedMany: (count: number) => string;
  moveFailed: string;
  deleteTask: string;
  deleteWithSubtasks: (count: number) => string;
  deleted: (title: string, subtasks: number) => string;
  undo: string;
  allActions: string;
  search: string;
  add: string;
  cancel: string;
  waitingOn: string;
  waitOnTask: string;
  findTask: string;
  blockingThis: string;
  missingTask: string;
  stopWaiting: string;
  waitingCount: (count: number) => string;
  remind: string;
  remindDefault: (minutes: number) => string;
  remindAtStart: string;
  remindBefore: (minutes: number) => string;
  remindOff: string;
  remindSettingOff: string;
  remindOnDate: string;
  remindOnDateAt: (when: string) => string;
  fromSubtasks: (done: number, total: number) => string;
}

const EN: ActionLabels = {
  openInNote: 'Open in note',
  rename: 'Rename…',
  properties: 'Properties',
  status: 'Status',
  priority: 'Priority',
  noPriority: 'No priority',
  tags: 'Tags',
  noTags: 'Empty',
  editTags: 'Create or edit tags…',
  deadline: 'Deadline',
  plan: 'Plan',
  repeat: 'Repeat',
  progress: 'Progress',
  today: 'Today',
  tomorrow: 'Tomorrow',
  nextWeek: 'Next week',
  pickDate: 'Pick a date…',
  pickTime: 'Pick a day and time…',
  removeDeadline: 'Remove deadline',
  removePlan: 'Remove from calendar',
  none: 'Empty',
  addProgress: 'Add a progress bar…',
  nextStep: (next) => `One step done (${next})`,
  editSteps: 'Edit steps…',
  removeProgress: 'Remove progress bar',
  create: 'Create',
  addSubtask: 'Add a subtask…',
  subtaskTitle: 'New subtask',
  duplicate: 'Duplicate',
  select: 'Select',
  copyLink: 'Copy link',
  linkCopied: 'Link copied',
  moveTo: 'Move to note…',
  findNote: 'Find a note…',
  moved: (title, note) => `Moved “${isolate(title)}” to ${isolate(note)}`,
  movedMany: (count, note) => `Moved ${count} tasks to ${isolate(note)}`,
  deletedMany: (count) => `Deleted ${count} tasks`,
  moveFailed: 'The task could not be moved',
  deleteTask: 'Delete',
  deleteWithSubtasks: (count) => (count === 1 ? 'Delete with its subtask' : `Delete with its ${count} subtasks`),
  deleted: (title, subtasks) => `Deleted “${isolate(title)}”${subtasks ? (subtasks === 1 ? ' and its subtask' : ` and its ${subtasks} subtasks`) : ''}`,
  undo: 'Undo',
  allActions: 'Timer, sync and more…',
  search: 'Search actions…',
  add: 'Add',
  cancel: 'Cancel',
  waitingOn: 'Waiting on',
  waitOnTask: 'Wait on a task…',
  findTask: 'Find a task…',
  blockingThis: 'Waiting on this task',
  missingTask: 'A task that is gone',
  stopWaiting: 'Stop waiting',
  waitingCount: (count) => (count === 1 ? '1 task' : `${count} tasks`),
  remind: 'Remind me',
  remindDefault: (minutes) => `As in settings (${minutes === 0 ? 'at the start' : durationText('en', minutes) + ' before'})`,
  remindAtStart: 'At the start',
  remindBefore: (minutes) => `${durationText('en', minutes)} before`,
  remindOff: 'No reminder',
  remindSettingOff: 'As in settings (off)',
  remindOnDate: 'On a date…',
  remindOnDateAt: (when) => when,
  fromSubtasks: (done, total) => `${done} of ${total} subtasks done`,
};

const FA: ActionLabels = {
  openInNote: 'باز کردن در یادداشت',
  rename: 'تغییر نام…',
  properties: 'ویژگی‌ها',
  status: 'وضعیت',
  priority: 'اولویت',
  noPriority: 'بدون اولویت',
  tags: 'برچسب‌ها',
  noTags: 'خالی',
  editTags: 'ساختن یا ویرایش برچسب‌ها…',
  deadline: 'سررسید',
  plan: 'برنامه',
  repeat: 'تکرار',
  progress: 'پیشرفت',
  today: 'امروز',
  tomorrow: 'فردا',
  nextWeek: 'هفته بعد',
  pickDate: 'انتخاب تاریخ…',
  pickTime: 'انتخاب روز و ساعت…',
  removeDeadline: 'حذف سررسید',
  removePlan: 'برداشتن از تقویم',
  none: 'خالی',
  addProgress: 'افزودن نوار پیشرفت…',
  nextStep: (next) => `یک مرحله انجام شد (${next})`,
  editSteps: 'ویرایش مراحل…',
  removeProgress: 'حذف نوار پیشرفت',
  create: 'ساختن',
  addSubtask: 'افزودن زیرتسک…',
  subtaskTitle: 'زیرتسک جدید',
  duplicate: 'تکثیر',
  select: 'انتخاب',
  copyLink: 'کپی پیوند',
  linkCopied: 'پیوند کپی شد',
  moveTo: 'انتقال به یادداشت…',
  findNote: 'جستجوی یادداشت…',
  moved: (title, note) => `«${isolate(title)}» به ${isolate(note)} منتقل شد`,
  movedMany: (count, note) => `${count} تسک به ${isolate(note)} منتقل شد`,
  deletedMany: (count) => `${count} تسک حذف شد`,
  moveFailed: 'انتقال تسک انجام نشد',
  deleteTask: 'حذف',
  deleteWithSubtasks: (count) => `حذف همراه با ${count} زیرتسک`,
  deleted: (title, subtasks) => `«${isolate(title)}»${subtasks ? ` و ${subtasks} زیرتسکش` : ''} حذف شد`,
  undo: 'بازگردانی',
  allActions: 'تایمر، همگام‌سازی و بیشتر…',
  search: 'جستجوی کارها…',
  add: 'افزودن',
  cancel: 'انصراف',
  waitingOn: 'منتظرِ',
  waitOnTask: 'منتظر یک تسک بمان…',
  findTask: 'پیدا کردن تسک…',
  blockingThis: 'منتظرِ این تسک',
  missingTask: 'تسکی که دیگر نیست',
  stopWaiting: 'دیگر منتظر نمان',
  waitingCount: (count) => `${count} تسک`,
  remind: 'یادآوری',
  remindDefault: (minutes) => `مثل تنظیمات (${minutes === 0 ? 'سر شروع' : durationText('fa', minutes) + ' قبل'})`,
  remindAtStart: 'سر شروع',
  remindBefore: (minutes) => `${durationText('fa', minutes)} قبل`,
  remindOff: 'بدون یادآوری',
  remindSettingOff: 'مثل تنظیمات (خاموش)',
  remindOnDate: 'در یک تاریخ…',
  remindOnDateAt: (when) => when,
  fromSubtasks: (done, total) => `${done} از ${total} زیرتسک انجام شده`,
};

/** "10 min", "1 h", "1 h 30 min"; in Persian "۱۰ دقیقه". */
export function durationText(language: Language, minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (language === 'fa') {
    const parts = [hours ? `${hours} ساعت` : '', rest ? `${rest} دقیقه` : ''].filter(Boolean);
    return parts.join(' و ') || '0 دقیقه';
  }
  const parts = [hours ? `${hours} h` : '', rest ? `${rest} min` : ''].filter(Boolean);
  return parts.join(' ') || '0 min';
}

export function getActionLabels(language: Language): ActionLabels {
  return language === 'fa' ? FA : EN;
}

export interface TaskActionOptions {
  host: TaskBoardHost;
  task: BoardTask;
  language: Language;
  calendarSystem: CalendarSystem;
  timeFormat: TimeFormat;
  tags: TaskTag[];
  /** What the full task menu opens beside. */
  anchor: HTMLElement;
  /** Rows the caller puts first, such as the calendar's "Open card". */
  lead?: MenuEntry[];
  /** The reminder setting, for what "as in settings" means beside a plan. */
  planReminder?: { enabled: boolean; leadMinutes: number };
  /**
   * The choices are for several tasks at once: rows that need a single task's
   * own picker (a date to pick, the tag editor) are left out, and the rows that
   * take a value away are always offered.
   */
  bulk?: boolean;
  /** Starts a selection with this task; the row is left out without it. */
  select?: () => void;
}

/** The keywords an entry is also found by: its English label, so English typing works in Persian. */
function withKeywords<T extends MenuEntry>(entry: T, english: string): T {
  return { ...entry, keywords: `${entry.keywords ?? ''} ${english}`.trim() };
}

// ── One property each ────────────────────────────────────────────────────

export function statusSections(o: TaskActionOptions): MenuSection[] {
  return [
    {
      entries: BOARD_STATUS_ORDER.map((status) =>
        withKeywords(
          {
            label: STATUS_LABELS[o.language][status],
            swatch: STATUS_SWATCH[status],
            checked: o.task.status === status,
            onSelect: () => (status === o.task.status ? undefined : o.host.setStatus(o.task, status)),
          },
          STATUS_LABELS.en[status]
        )
      ),
    },
  ];
}

export function prioritySections(o: TaskActionOptions): MenuSection[] {
  const labels = getActionLabels(o.language);
  const entries: MenuEntry[] = TASK_PRIORITIES.map((level) =>
    withKeywords(
      {
        label: PRIORITY_LABELS[o.language][level],
        icon: PRIORITY_ICON_NAMES[level],
        checked: o.task.priority === level,
        onSelect: () => (level === o.task.priority ? undefined : o.host.setPriority(o.task, level)),
      },
      PRIORITY_LABELS.en[level]
    )
  );
  const sections: MenuSection[] = [{ entries }];
  if (o.task.priority || o.bulk) {
    sections.push({ entries: [{ label: labels.noPriority, icon: 'x', onSelect: () => o.host.setPriority(o.task, null) }] });
  }
  return sections;
}

/** Every tag, ticked when the task has it; choosing one adds or removes it. */
export function tagSections(o: TaskActionOptions): MenuSection[] {
  const labels = getActionLabels(o.language);
  const { host, task } = o;
  const keys = new Set(o.tags.map((tag) => tag.key));
  // Keys on the task that nobody has defined yet are listed too, so they can be taken off.
  const all = [...o.tags.map((tag) => tag.key), ...task.tags.filter((key) => !keys.has(key))];
  const entries: MenuEntry[] = all.map((key) => {
    const tag = resolveTag(key, o.tags);
    const has = task.tags.includes(key);
    return {
      label: tag.name,
      swatch: resolveTagColor(tag.color),
      checked: has,
      keywords: `tag ${key}`,
      onSelect: () => host.setTags(task, has ? task.tags.filter((k) => k !== key) : [...task.tags, key]),
    };
  });
  if (o.bulk) return [{ entries }];
  return [{ entries }, { entries: [{ label: labels.editTags, icon: 'tags', onSelect: () => host.editTags(task) }] }];
}

/** Today, tomorrow and a week from today, each with its date beside it. */
export function nearDays(o: TaskActionOptions): Array<{ label: string; english: string; day: string }> {
  const labels = getActionLabels(o.language);
  const today = todayKey();
  return [
    { label: labels.today, english: EN.today, day: today },
    { label: labels.tomorrow, english: EN.tomorrow, day: addDays(today, 1) },
    { label: labels.nextWeek, english: EN.nextWeek, day: addDays(today, 7) },
  ];
}

export function deadlineSections(o: TaskActionOptions): MenuSection[] {
  const labels = getActionLabels(o.language);
  const { host, task } = o;
  const days = nearDays(o).map(({ label, english, day }) =>
    withKeywords(
      {
        label,
        icon: 'flag',
        hint: shortDay(day, o.calendarSystem, o.language),
        checked: task.deadline === day,
        onSelect: () => (task.deadline === day ? undefined : host.setDeadline?.(task, day) ?? host.editDeadline(task)),
      },
      `${english} deadline due`
    )
  );
  const sections: MenuSection[] = [{ entries: days }];
  if (!o.bulk) sections.push({ entries: [{ label: labels.pickDate, icon: 'calendar-search', onSelect: () => host.editDeadline(task) }] });
  if ((task.deadline || o.bulk) && host.setDeadline) {
    sections.push({ entries: [{ label: labels.removeDeadline, icon: 'x', onSelect: () => host.setDeadline!(task, null) }] });
  }
  return sections;
}

export function planSections(o: TaskActionOptions): MenuSection[] {
  const labels = getActionLabels(o.language);
  const { host, task } = o;
  const setSchedule = host.setSchedule?.bind(host);
  if (!setSchedule) return [];
  const days = nearDays(o).map(({ label, english, day }) => {
    // A timed plan moved to another day keeps its time.
    const next: TaskSchedule = task.schedule ? { ...task.schedule, date: day } : { date: day };
    return withKeywords(
      {
        label,
        icon: 'calendar',
        hint: shortDay(day, o.calendarSystem, o.language),
        checked: task.schedule?.date === day,
        onSelect: () => (task.schedule?.date === day ? undefined : setSchedule(task, next)),
      },
      `${english} plan schedule`
    );
  });
  const sections: MenuSection[] = [{ entries: days }];
  if (host.editSchedule && !o.bulk) {
    sections.push({ entries: [{ label: labels.pickTime, icon: 'calendar-clock', onSelect: () => host.editSchedule!(task) }] });
  }
  const remind = o.bulk ? null : remindEntry(o);
  if (remind) sections.push({ entries: [remind] });
  if (task.schedule || o.bulk) {
    sections.push({ entries: [{ label: labels.removePlan, icon: 'calendar-x', onSelect: () => setSchedule(task, null) }] });
  }
  return sections;
}

const REMIND_CHOICES = [0, 5, 10, 15, 30, 60];

/** What the task's reminder is, in words: its own time, or the setting's. */
export function remindHint(o: TaskActionOptions): string {
  const labels = getActionLabels(o.language);
  const setting = o.planReminder ?? { enabled: true, leadMinutes: 10 };
  const describe = (minutes: number) => (minutes === 0 ? labels.remindAtStart : labels.remindBefore(minutes));
  if (o.task.remindAt) return labels.remindOnDateAt(momentText(o, o.task.remindAt));
  const own = o.task.remind;
  if (own === null) return labels.remindOff;
  if (own !== undefined) return describe(own);
  // Without a timed plan there is nothing for the setting to count back from.
  if (!o.task.schedule?.start) return labels.remindOff;
  return setting.enabled ? describe(setting.leadMinutes) : labels.remindOff;
}

/** A reminder's moment in words: "Tomorrow, 09:30". */
function momentText(o: TaskActionOptions, at: { date: string; time: string }): string {
  const day = scheduleDayText(at.date, { language: o.language, calendarSystem: o.calendarSystem, timeFormat: o.timeFormat });
  const time = formatClock(parseClock(at.time) ?? 0, o.timeFormat, o.language);
  return `${day}${o.language === 'fa' ? '، ' : ', '}${time}`;
}

/**
 * The reminder's choices: the setting, a lead time of its own (both only for
 * a plan with a time of day), a moment of its own, or none.
 */
export function remindSections(o: TaskActionOptions): MenuSection[] {
  const { host, task } = o;
  const setRemind = host.setRemind?.bind(host);
  if (!setRemind) return [];
  const labels = getActionLabels(o.language);
  const setting = o.planReminder ?? { enabled: true, leadMinutes: 10 };
  const describe = (minutes: number) => (minutes === 0 ? labels.remindAtStart : labels.remindBefore(minutes));
  const timed = !!task.schedule?.start;
  const own = task.remind;
  const moment = task.remindAt;
  const offNow = own === null && !moment;
  const sections: MenuSection[] = [];
  if (timed) {
    sections.push({
      entries: [
        {
          label: setting.enabled ? labels.remindDefault(setting.leadMinutes) : labels.remindSettingOff,
          icon: 'settings',
          checked: own === undefined && !moment,
          onSelect: () => (own === undefined && !moment ? undefined : setRemind(task, undefined)),
        },
      ],
    });
    sections.push({
      entries: REMIND_CHOICES.map((minutes) => ({
        label: describe(minutes),
        icon: minutes === 0 ? 'bell-ring' : 'bell',
        checked: own === minutes && !moment,
        onSelect: () => (own === minutes && !moment ? undefined : setRemind(task, minutes)),
      })),
    });
  }
  const tail: MenuEntry[] = [];
  if (host.editRemind) {
    tail.push({
      label: moment ? labels.remindOnDateAt(momentText(o, moment)) : labels.remindOnDate,
      icon: 'calendar-clock',
      checked: !!moment,
      onSelect: () => host.editRemind!(task),
    });
  }
  tail.push({ label: labels.remindOff, icon: 'bell-off', checked: offNow, onSelect: () => (offNow ? undefined : setRemind(task, null)) });
  sections.push({ entries: tail });
  return sections;
}

/** "Remind me", as a row of the plan's menu: before a plan that has a time, or on a date. */
function remindEntry(o: TaskActionOptions): MenuEntry | null {
  if (!o.host.setRemind) return null;
  const labels = getActionLabels(o.language);
  return withKeywords(
    { label: labels.remind, icon: 'bell', hint: remindHint(o), submenu: () => remindSections(o) },
    'remind reminder alert notify bell'
  );
}

// ── Waiting on other tasks ─────────────────────────────────────────────────

/** The relations of every task there is, built when a menu asks. */
function relations(o: TaskActionOptions): RelationIndex {
  return new RelationIndex(o.host.store.all());
}

/**
 * What the task waits on, each a click away from being dropped, a way to
 * add one, and the tasks that wait on it in turn.
 */
export function waitingSections(o: TaskActionOptions): MenuSection[] {
  const { host, task } = o;
  const setWaiting = host.setWaiting?.bind(host);
  if (!setWaiting) return [];
  const labels = getActionLabels(o.language);
  const index = relations(o);
  const blockers = index.blockersOf(task);
  const keep = (without: number) =>
    blockers.filter((_, i) => i !== without).map((blocker) => blocker.task).filter((t): t is BoardTask => !!t);

  const sections: MenuSection[] = [];
  if (blockers.length) {
    sections.push({
      entries: blockers.map((blocker, i) => ({
        label: blocker.task ? displayTitle(blocker.task.text) || '—' : labels.missingTask,
        icon: blocker.task ? STATUS_ICON_NAMES[blocker.task.status] : 'link-2-off',
        hint: blocker.task?.fileName ?? blocker.link.path,
        checked: true,
        keywords: 'remove stop waiting',
        onSelect: () => setWaiting(task, keep(i)),
      })),
    });
  }
  sections.push({
    entries: [
      {
        label: labels.waitOnTask,
        icon: 'plus',
        onSelect: () =>
          openTaskPicker(o, index, (picked) => void setWaiting(task, [...keep(-1), picked])),
      },
    ],
  });
  const dependents = index.dependentsOf(task);
  if (dependents.length) {
    sections.push({
      title: labels.blockingThis,
      entries: dependents.map((dependent) => ({
        label: displayTitle(dependent.text) || '—',
        icon: STATUS_ICON_NAMES[dependent.status],
        hint: dependent.fileName,
        onSelect: () => host.reveal(dependent),
      })),
    });
  }
  if (blockers.length > 1) {
    sections.push({ entries: [{ label: labels.stopWaiting, icon: 'x', onSelect: () => setWaiting(task, []) }] });
  }
  return sections;
}

/**
 * A searchable list of the tasks this one could wait on: every task that is
 * not done and would not close a loop. The ones in the same note come first
 * until something is typed.
 */
export function openTaskPicker(o: TaskActionOptions, index: RelationIndex, onPick: (task: BoardTask) => void): void {
  const { task } = o;
  const labels = getActionLabels(o.language);
  const already = new Set(index.blockersOf(task).map((blocker) => blocker.task?.id));
  const candidates = o.host.store
    .all()
    .filter((candidate) => candidate.status !== '[x]' && !already.has(candidate.id) && !index.wouldCycle(task, candidate));
  const entry = (candidate: BoardTask): MenuEntry => ({
    label: displayTitle(candidate.text) || '—',
    icon: STATUS_ICON_NAMES[candidate.status],
    hint: candidate.fileName,
    keywords: `${candidate.fileName} ${candidate.tags.join(' ')}`,
    onSelect: () => onPick(candidate),
  });
  const near = [
    ...candidates.filter((candidate) => candidate.filePath === task.filePath),
    ...candidates.filter((candidate) => candidate.filePath !== task.filePath),
  ];
  const container = (o.anchor.closest('.taskpro-board') as HTMLElement | null) ?? o.anchor.ownerDocument.body;
  openContextMenu({
    container,
    at: o.anchor.getBoundingClientRect(),
    rtl: o.language === 'fa',
    header: labels.waitOnTask.replace(/…$/, ''),
    searchPlaceholder: labels.findTask,
    sections: [{ entries: candidates.map(entry) }],
    idleSections: () => [{ entries: near.slice(0, 12).map(entry) }],
  });
}

/** The row's hint: the one task it waits on, or how many. */
function waitingHint(o: TaskActionOptions): string {
  const labels = getActionLabels(o.language);
  const blockers = relations(o).blockersOf(o.task);
  if (!blockers.length) return labels.none;
  if (blockers.length > 1) return labels.waitingCount(blockers.length);
  const only = blockers[0].task;
  return only ? displayTitle(only.text) || '—' : labels.missingTask;
}

export function repeatSections(o: TaskActionOptions): MenuSection[] {
  const repeatLabels = getRepeatLabels(o.language);
  const { host, task } = o;
  const setRepeat = host.setRepeat?.bind(host);
  if (!setRepeat) return [];
  const same = (a: TaskRepeat | undefined, b: TaskRepeat) => !!a && a.every === b.every && a.unit === b.unit;
  const sections: MenuSection[] = [
    {
      entries: REPEAT_PRESETS.map((preset) =>
        withKeywords(
          {
            label: repeatLabels.preset(preset),
            icon: 'repeat',
            checked: same(task.repeat, preset),
            onSelect: () => (same(task.repeat, preset) ? undefined : setRepeat(task, { ...preset })),
          },
          `${getRepeatLabels('en').preset(preset)} repeat`
        )
      ),
    },
    {
      entries: [
        {
          label: repeatLabels.custom,
          icon: 'settings-2',
          onSelect: () => openCustomRepeatPanel(o.language, task.repeat, (repeat) => void setRepeat(task, repeat)),
        },
      ],
    },
  ];
  if (task.repeat) {
    sections.push({ entries: [{ label: repeatLabels.removeRepeat, icon: 'x', onSelect: () => setRepeat(task, null) }] });
  }
  return sections;
}

function progressEntry(o: TaskActionOptions): MenuEntry | null {
  const labels = getActionLabels(o.language);
  const { host, task } = o;
  const setProgress = host.setProgress?.bind(host);
  if (!setProgress) return null;
  const progress = host.getProgress(task);
  const edit = () => openProgressPanel(o.language, progress, (next) => void setProgress(task, next));
  if (!progress?.enabled) return withKeywords({ label: labels.addProgress, icon: 'bar-chart-horizontal', onSelect: edit }, EN.addProgress);
  const { currentSteps, totalSteps } = progress;
  return withKeywords(
    {
      label: labels.progress,
      icon: 'bar-chart-horizontal',
      hint: `${currentSteps}/${totalSteps}`,
      submenu: () => [
        {
          entries: [
            {
              label: labels.nextStep(`${Math.min(totalSteps, currentSteps + 1)}/${totalSteps}`),
              icon: 'plus',
              disabled: currentSteps >= totalSteps,
              onSelect: () => setProgress(task, { ...progress, currentSteps: Math.min(totalSteps, currentSteps + 1) }),
            },
            { label: labels.editSteps, icon: 'pencil', onSelect: edit },
          ],
        },
        { entries: [{ label: labels.removeProgress, icon: 'x', onSelect: () => setProgress(task, null) }] },
      ],
    },
    EN.progress
  );
}

/** Asks for a new title, the markers kept. */
function renameTask(o: TaskActionOptions): void {
  const labels = getActionLabels(o.language);
  const { body, footer, close } = openTaskProPanel(labels.rename.replace(/…$/, ''));
  const input = addPanelField(body, displayTitle(o.task.text) || '');
  input.value = o.task.text;
  input.setAttribute('dir', 'auto');
  const save = () => {
    const text = input.value.replace(/\s+/g, ' ').trim();
    close();
    if (text && text !== o.task.text) void o.host.setText(o.task, text);
  };
  addPanelButtonRow(footer, { cancelLabel: labels.cancel, saveLabel: labels.rename.replace(/…$/, ''), onCancel: close, onSave: save });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.isComposing) {
      event.preventDefault();
      save();
    }
  });
  input.focus();
  input.select();
}

/** Asks for a subtask's title and writes it under the task. */
function addSubtask(o: TaskActionOptions): void {
  const labels = getActionLabels(o.language);
  const { body, footer, close } = openTaskProPanel(labels.subtaskTitle);
  const input = addPanelField(body, displayTitle(o.task.text) || labels.subtaskTitle);
  input.setAttribute('dir', 'auto');
  const save = () => {
    const text = input.value.replace(/\s+/g, ' ').trim();
    if (!text) return;
    close();
    void o.host.insertTask?.(o.task, `- [ ] ${text}`, 'child');
  };
  addPanelButtonRow(footer, { cancelLabel: labels.cancel, saveLabel: labels.add, onCancel: close, onSave: save });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.isComposing) {
      event.preventDefault();
      save();
    }
  });
  input.focus();
}

// ── Copy a link, move to another note ─────────────────────────────────────

/** The link to a task on the clipboard, `[[Note#^id]]`, the block ID written into the note if it had none. */
async function copyLink(o: TaskActionOptions): Promise<void> {
  const link = await o.host.blockLink?.(o.task);
  if (!link) return;
  try {
    await navigator.clipboard.writeText(link);
    o.host.notify(getActionLabels(o.language).linkCopied);
  } catch {
    // A clipboard that refuses (a browser without permission): show the link to copy by hand.
    o.host.notify(link);
  }
}

const NOTE_ORDER = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
const NEAR_NOTES = 12;

function folderOf(path: string): string {
  return path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
}

/**
 * A searchable list of the notes a task could move to. Before anything is
 * typed it shows the inbox, then the notes beside the task's own, then the
 * ones that hold tasks; typing finds any note in the vault by its name or its
 * folder. A host that cannot list its notes offers the notes that have tasks.
 */
export function openNotePicker(o: TaskActionOptions, onPick: (path: string) => void): void {
  const { host, task } = o;
  const labels = getActionLabels(o.language);

  const withTasks = new Map<string, string>();
  for (const other of host.store.all()) withTasks.set(other.filePath, other.fileName);
  const notes = new Map<string, string>();
  for (const note of host.notes?.() ?? Array.from(withTasks, ([path, name]) => ({ path, name }))) notes.set(note.path, note.name);
  notes.delete(task.filePath);

  const byName = (a: string, b: string) => NOTE_ORDER.compare(notes.get(a)!, notes.get(b)!);
  const entry = (path: string): MenuEntry => ({
    label: notes.get(path)!,
    icon: 'file-text',
    hint: folderOf(path) || undefined,
    keywords: path,
    onSelect: () => onPick(path),
  });

  const inbox = host.getSettings().board.inboxPath;
  const first = inbox && notes.has(inbox) ? [inbox] : [];
  const beside = [...notes.keys()].filter((path) => path !== inbox && folderOf(path) === folderOf(task.filePath)).sort(byName);
  const busy = [...notes.keys()].filter((path) => path !== inbox && withTasks.has(path) && !beside.includes(path)).sort(byName);
  const near = [...first, ...beside, ...busy].slice(0, NEAR_NOTES);

  const container = (o.anchor.closest('.taskpro-board') as HTMLElement | null) ?? o.anchor.ownerDocument.body;
  openContextMenu({
    container,
    at: o.anchor.getBoundingClientRect(),
    rtl: o.language === 'fa',
    header: labels.moveTo.replace(/…$/, ''),
    searchPlaceholder: labels.findNote,
    sections: [{ entries: [...notes.keys()].sort(byName).map(entry) }],
    idleSections: () => [{ entries: near.map(entry) }],
  });
}

/** Asks where to, and moves the task with what is nested under it. */
function moveTask(o: TaskActionOptions): void {
  const labels = getActionLabels(o.language);
  const move = async (path: string) => {
    const moved = await o.host.moveTask!(o.task, path);
    o.host.notify(moved ? labels.moved(displayTitle(o.task.text) || o.task.text, noteName(path)) : labels.moveFailed);
  };
  if (o.host.notes) openNotePicker(o, (path) => void move(path));
  else o.host.chooseNote((path) => void move(path));
}

function noteName(path: string): string {
  return (path.split('/').pop() ?? path).replace(/\.md$/i, '');
}

// ── The whole menu ───────────────────────────────────────────────────────

export function taskActionSections(o: TaskActionOptions): MenuSection[] {
  const labels = getActionLabels(o.language);
  const { host, task, language } = o;

  const tagNames = task.tags.map((key) => resolveTag(key, o.tags).name);
  const deadlineHint = task.deadline ? getDeadlineInfo(task.deadline, language, task.status).text : labels.none;
  // The day and the start are enough beside the row: "Today 16:00".
  const planStart = parseClock(task.schedule?.start);
  const planHint = task.schedule
    ? `${scheduleDayText(task.schedule.date, { language, calendarSystem: o.calendarSystem, timeFormat: o.timeFormat })}${
        planStart === null ? '' : ` ${formatClock(planStart, o.timeFormat, language)}`
      }`
    : labels.none;
  const firstTag = task.tags.length ? resolveTag(task.tags[0], o.tags) : null;

  const properties: MenuEntry[] = [
    withKeywords(
      {
        label: labels.status,
        swatch: STATUS_SWATCH[task.status],
        hint: STATUS_LABELS[language][task.status],
        submenu: () => statusSections(o),
      },
      EN.status
    ),
    withKeywords(
      {
        label: labels.priority,
        icon: task.priority ? PRIORITY_ICON_NAMES[task.priority] : 'flag',
        hint: task.priority ? PRIORITY_LABELS[language][task.priority] : labels.none,
        submenu: () => prioritySections(o),
      },
      EN.priority
    ),
    withKeywords(
      {
        label: labels.tags,
        icon: firstTag ? undefined : 'tags',
        swatch: firstTag ? resolveTagColor(firstTag.color) : undefined,
        hint: tagNames.length ? tagNames.join(language === 'fa' ? '، ' : ', ') : labels.noTags,
        submenu: () => tagSections(o),
      },
      EN.tags
    ),
    withKeywords(
      { label: labels.deadline, icon: 'flag', hint: deadlineHint, submenu: () => deadlineSections(o) },
      EN.deadline
    ),
  ];
  if (host.setSchedule) {
    properties.push(
      withKeywords({ label: labels.plan, icon: 'calendar-clock', hint: planHint, submenu: () => planSections(o) }, `${EN.plan} schedule`)
    );
  }
  if (host.setRepeat) {
    properties.push(
      withKeywords(
        {
          label: labels.repeat,
          icon: 'repeat',
          hint: task.repeat ? getRepeatLabels(language).chip(task.repeat) : labels.none,
          submenu: () => repeatSections(o),
        },
        EN.repeat
      )
    );
  }
  if (host.setWaiting) {
    properties.push(
      withKeywords(
        { label: labels.waitingOn, icon: 'hourglass', hint: waitingHint(o), submenu: () => waitingSections(o) },
        'waiting on blocked by depends dependency after'
      )
    );
  }
  const progress = progressEntry(o);
  if (progress) properties.push(progress);

  const create: MenuEntry[] = [];
  if (host.insertTask) {
    create.push(withKeywords({ label: labels.addSubtask, icon: 'list-tree', onSelect: () => addSubtask(o) }, `${EN.addSubtask} child`));
    create.push(
      withKeywords(
        {
          label: labels.duplicate,
          icon: 'copy',
          // The copy is a new task: it does not take the block ID that names this one.
          onSelect: () => host.insertTask!(task, task.line.replace(/\s*\^[a-zA-Z0-9-]+\s*$/, ''), 'sibling'),
        },
        EN.duplicate
      )
    );
  }
  if (host.blockLink) {
    create.push(withKeywords({ label: labels.copyLink, icon: 'link', onSelect: () => void copyLink(o) }, `${EN.copyLink} block reference url`));
  }
  if (host.moveTask) {
    create.push(withKeywords({ label: labels.moveTo, icon: 'folder-input', onSelect: () => moveTask(o) }, `${EN.moveTo} transfer note file`));
  }

  return [
    {
      entries: [
        ...(o.lead ?? []),
        withKeywords({ label: labels.openInNote, icon: 'arrow-up-right', onSelect: () => host.reveal(task) }, EN.openInNote),
        withKeywords({ label: labels.rename, icon: 'pencil', onSelect: () => renameTask(o) }, 'rename title edit'),
        ...(o.select ? [withKeywords({ label: labels.select, icon: 'square-check', onSelect: o.select }, 'select several bulk multiple')] : []),
      ],
    },
    { title: labels.properties, entries: properties },
    { entries: create },
    { entries: [withKeywords({ label: labels.allActions, icon: 'more-horizontal', onSelect: () => host.openTaskMenu(task, o.anchor) }, 'timer focus sync more')] },
    { entries: deleteEntries(o) },
  ];
}

/**
 * Delete, last and in the warning colour. The label says when subtasks go
 * with it, since a task's subtasks are nested under it in the note.
 */
export function deleteEntries(o: TaskActionOptions): MenuEntry[] {
  const { host, task } = o;
  if (!host.deleteTask) return [];
  const labels = getActionLabels(o.language);
  const subtasks = descendantsOf(task, indexFamilies(host.store.inFile(task.filePath))).length;
  return [
    withKeywords(
      {
        label: subtasks ? labels.deleteWithSubtasks(subtasks) : labels.deleteTask,
        icon: 'trash-2',
        hint: 'Del',
        warning: true,
        onSelect: () => host.deleteTask!(task),
      },
      'delete remove trash'
    ),
  ];
}
