// ── board/bulk-actions.ts ─────────────────────────────────────────────────
// Changing several tasks at once. The bar that rises while tasks are selected
// offers the same choices a single task's menu does (status, priority, tags,
// deadline, plan, where to move it, deleting it), built by the same code: the
// menus are asked for a stand-in task that has only what all the selected have
// in common, and a host that does each change to every one of them in turn.
// ─────────────────────────────────────────────────────────────────────────────

import { setIcon } from 'obsidian';
import type { CalendarSystem, Language, TaskStatus, TimeFormat } from '../types';
import type { TaskTag } from '../tags';
import { openContextMenu } from '../ui/context-menu';
import type { MenuSection } from '../ui/context-menu';
import { getBoardLabels } from './board-localization';
import {
  deadlineSections,
  getActionLabels,
  openNotePicker,
  planSections,
  prioritySections,
  statusSections,
  tagSections,
} from './task-actions';
import type { TaskActionOptions } from './task-actions';
import { displayTitle } from './board-text';
import type { TaskBoardHost } from './task-board';
import type { BoardTask } from './task-store';

/**
 * The selected tasks that no other selected task is nested under. A move or a
 * delete takes a task's subtasks with it, so the subtasks it would find already
 * gone are left out. `lookup` finds any task by id, selected or not, so a
 * parent that was not picked is passed over on the way to a grandparent that was.
 */
export function outermost(tasks: readonly BoardTask[], lookup: (id: string) => BoardTask | undefined): BoardTask[] {
  const picked = new Set(tasks.map((task) => task.id));
  return tasks.filter((task) => {
    const seen = new Set<string>([task.id]);
    let up = task.parentId ? lookup(task.parentId) : undefined;
    while (up && !seen.has(up.id)) {
      if (picked.has(up.id)) return false;
      seen.add(up.id);
      up = up.parentId ? lookup(up.parentId) : undefined;
    }
    return true;
  });
}

/**
 * One task standing for all: what they have in common is kept (a status all
 * share is ticked in the menu; tags all carry are ticked), what differs is
 * left empty, so nothing in the menu claims a value only some have.
 */
export function commonTask(tasks: readonly BoardTask[]): BoardTask {
  const first = tasks[0];
  const same = (pick: (task: BoardTask) => unknown) => tasks.every((task) => JSON.stringify(pick(task)) === JSON.stringify(pick(first)));
  return {
    ...first,
    status: same((task) => task.status) ? first.status : ('' as TaskStatus),
    priority: same((task) => task.priority) ? first.priority : undefined,
    deadline: same((task) => task.deadline) ? first.deadline : undefined,
    schedule: same((task) => task.schedule) ? first.schedule : undefined,
    tags: first.tags.filter((key) => tasks.every((task) => task.tags.includes(key))),
    repeat: undefined,
    waiting: undefined,
  };
}

/**
 * A host whose edits go to every selected task, one after another: sequential,
 * since two writes to one note at once would leave the second to read a note
 * the first has already changed.
 */
export function bulkHost(host: TaskBoardHost, tasks: readonly BoardTask[], stand: BoardTask): TaskBoardHost {
  const each = async (apply: (task: BoardTask) => Promise<unknown> | undefined): Promise<void> => {
    for (const task of tasks) await apply(task);
  };
  return {
    ...host,
    setStatus: (_task, status) => each((task) => (task.status === status ? undefined : host.setStatus(task, status))),
    setPriority: (_task, priority) => each((task) => host.setPriority(task, priority)),
    // The menu asks for the stand-in's tags with one added or taken off: do that to each.
    setTags: (_task, keys) => {
      const added = keys.filter((key) => !stand.tags.includes(key));
      const removed = stand.tags.filter((key) => !keys.includes(key));
      return each((task) =>
        host.setTags(task, [...task.tags.filter((key) => !removed.includes(key)), ...added.filter((key) => !task.tags.includes(key))])
      );
    },
    setDeadline: host.setDeadline && ((_task, deadline) => each((task) => host.setDeadline!(task, deadline))),
    // A day chosen moves each plan to it and keeps its own hours.
    setSchedule:
      host.setSchedule &&
      ((_task, schedule) =>
        each((task) => host.setSchedule!(task, schedule && task.schedule ? { ...task.schedule, date: schedule.date } : schedule))),
  };
}

export interface BulkContext {
  host: TaskBoardHost;
  /** The board's root, where menus are placed. */
  root: HTMLElement;
  language: Language;
  calendarSystem: CalendarSystem;
  timeFormat: TimeFormat;
  tags: TaskTag[];
  planReminder?: { enabled: boolean; leadMinutes: number };
  /** Set on the phone: the bar shows icons only and its menus are sheets. */
  compact: boolean;
  hold(on: boolean): void;
  lookup(id: string): BoardTask | undefined;
  /** The selection is over: called after a move or a delete has taken the tasks out of it. */
  clear(): void;
}

/** Draws the bar for the tasks selected. */
export function renderBulkBar(bar: HTMLElement, tasks: readonly BoardTask[], ctx: BulkContext): void {
  bar.empty();
  if (!tasks.length) return;
  const { host, language } = ctx;
  const board = getBoardLabels(language);
  const actions = getActionLabels(language);
  const rtl = language === 'fa';
  const stand = commonTask(tasks);
  const shared = bulkHost(host, tasks, stand);

  const options = (anchor: HTMLElement): TaskActionOptions => ({
    host: shared,
    task: stand,
    language,
    calendarSystem: ctx.calendarSystem,
    timeFormat: ctx.timeFormat,
    tags: ctx.tags,
    anchor,
    planReminder: ctx.planReminder,
    bulk: true,
  });

  const button = (icon: string, label: string, onClick: (anchor: HTMLElement) => void, cls = ''): HTMLButtonElement => {
    const el = bar.createEl('button', { cls: `taskpro-selection__btn${cls ? ` ${cls}` : ''}` });
    el.type = 'button';
    el.setAttribute('aria-label', label);
    setIcon(el.createSpan({ cls: 'taskpro-selection__icon' }), icon);
    // Words beside the icons, except on a phone and on the button that only closes the bar.
    if (!ctx.compact && cls !== 'is-clear') el.createSpan({ cls: 'taskpro-selection__label', text: label });
    el.title = label;
    el.addEventListener('click', () => onClick(el));
    return el;
  };
  const menu = (anchor: HTMLElement, sections: MenuSection[]) => {
    ctx.hold(true);
    openContextMenu({
      container: ctx.root,
      at: anchor.getBoundingClientRect(),
      rtl,
      header: board.selectedCount(tasks.length),
      sections,
      onClose: () => ctx.hold(false),
    });
  };

  button('x', board.clearSelection, () => ctx.clear(), 'is-clear');
  // On a phone the number alone: the bar has no room for the words, and says them to a screen reader.
  bar.createSpan({ cls: 'taskpro-selection__count', text: ctx.compact ? String(tasks.length) : board.selectedCount(tasks.length) });
  bar.createSpan({ cls: 'taskpro-selection__sep', attr: { 'aria-hidden': 'true' } });

  button('circle-dot', actions.status, (a) => menu(a, statusSections(options(a))));
  button('flag', actions.priority, (a) => menu(a, prioritySections(options(a))));
  button('tags', actions.tags, (a) => menu(a, tagSections(options(a))));
  if (host.setDeadline) button('calendar', actions.deadline, (a) => menu(a, deadlineSections(options(a))));
  if (host.setSchedule) button('calendar-clock', actions.plan, (a) => menu(a, planSections(options(a))));
  if (host.moveTask) {
    button('folder-input', actions.moveTo.replace(/…$/, ''), (a) => {
      // Where to: the same list of notes a single task offers.
      openNotePicker(options(a), (path) => void moveAll(ctx, tasks, path));
    });
  }
  if (host.deleteTask) {
    button('trash-2', actions.deleteTask, () => void deleteAll(ctx, tasks), 'is-warning');
  }
}

/** Moves the selected tasks, each with what is nested under it, to another note. */
async function moveAll(ctx: BulkContext, tasks: readonly BoardTask[], path: string): Promise<void> {
  const { host } = ctx;
  const labels = getActionLabels(ctx.language);
  ctx.hold(true);
  let moved = 0;
  try {
    // Ones inside another selected task go along with it.
    for (const task of outermost(tasks, ctx.lookup)) {
      if (await host.moveTask!(task, path)) moved++;
    }
  } finally {
    ctx.hold(false);
  }
  const name = (path.split('/').pop() ?? path).replace(/\.md$/i, '');
  host.notify(
    moved === 0
      ? labels.moveFailed
      : moved === 1
        ? labels.moved(displayTitle(tasks[0].text) || tasks[0].text, name)
        : labels.movedMany(moved, name)
  );
  ctx.clear();
}

/** Deletes the selected tasks in one go, with one notice that puts them all back. */
async function deleteAll(ctx: BulkContext, tasks: readonly BoardTask[]): Promise<void> {
  const { host } = ctx;
  ctx.hold(true);
  try {
    const targets = outermost(tasks, ctx.lookup);
    if (host.deleteTasks) await host.deleteTasks(targets);
    else for (const task of targets) await host.deleteTask!(task);
  } finally {
    ctx.hold(false);
  }
  ctx.clear();
}
