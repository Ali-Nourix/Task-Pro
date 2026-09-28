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
import type { MenuEntry, MenuSection } from '../ui/context-menu';
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
  deleteTask: string;
  deleteWithSubtasks: (count: number) => string;
  deleted: (title: string, subtasks: number) => string;
  undo: string;
  allActions: string;
  search: string;
  add: string;
  cancel: string;
}

const EN: ActionLabels = {
  openInNote: 'Open in note',
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
  deleteTask: 'Delete',
  deleteWithSubtasks: (count) => (count === 1 ? 'Delete with its subtask' : `Delete with its ${count} subtasks`),
  deleted: (title, subtasks) => `Deleted “${isolate(title)}”${subtasks ? (subtasks === 1 ? ' and its subtask' : ` and its ${subtasks} subtasks`) : ''}`,
  undo: 'Undo',
  allActions: 'Timer, sync and more…',
  search: 'Search actions…',
  add: 'Add',
  cancel: 'Cancel',
};

const FA: ActionLabels = {
  openInNote: 'باز کردن در یادداشت',
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
  deleteTask: 'حذف',
  deleteWithSubtasks: (count) => `حذف همراه با ${count} زیرتسک`,
  deleted: (title, subtasks) => `«${isolate(title)}»${subtasks ? ` و ${subtasks} زیرتسکش` : ''} حذف شد`,
  undo: 'بازگردانی',
  allActions: 'تایمر، همگام‌سازی و بیشتر…',
  search: 'جستجوی کارها…',
  add: 'افزودن',
  cancel: 'انصراف',
};

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
  if (o.task.priority) {
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
  return [{ entries }, { entries: [{ label: labels.editTags, icon: 'tags', onSelect: () => host.editTags(task) }] }];
}

/** Today, tomorrow and a week from today, each with its date beside it. */
function nearDays(o: TaskActionOptions): Array<{ label: string; english: string; day: string }> {
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
  const sections: MenuSection[] = [
    { entries: days },
    { entries: [{ label: labels.pickDate, icon: 'calendar-search', onSelect: () => host.editDeadline(task) }] },
  ];
  if (task.deadline && host.setDeadline) {
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
  if (host.editSchedule) {
    sections.push({ entries: [{ label: labels.pickTime, icon: 'calendar-clock', onSelect: () => host.editSchedule!(task) }] });
  }
  if (task.schedule) {
    sections.push({ entries: [{ label: labels.removePlan, icon: 'calendar-x', onSelect: () => setSchedule(task, null) }] });
  }
  return sections;
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

  return [
    {
      entries: [
        ...(o.lead ?? []),
        withKeywords({ label: labels.openInNote, icon: 'arrow-up-right', onSelect: () => host.reveal(task) }, EN.openInNote),
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
