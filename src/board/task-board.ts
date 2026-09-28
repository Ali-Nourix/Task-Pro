// ── board/task-board.ts ───────────────────────────────────────────────────
// The all-tasks board: every task in the vault (or only the target folder)
// in one place, as a table or as a kanban board, and editable in place.
//
// This file only builds DOM and talks to a `TaskBoardHost`. Reading and
// writing notes lives in the plugin, so the board can be rendered against a
// stub host in the preview harness and behaves the same inside Obsidian.
// ─────────────────────────────────────────────────────────────────────────────

import { App, Menu, setIcon } from 'obsidian';
import {
  BoardGroupBy,
  BoardPreferences,
  BoardPriorityFilter,
  BoardSortKey,
  CalendarSettings,
  CalendarSystem,
  CHIP_ICON_NAMES,
  Language,
  PRIORITY_ICON_NAMES,
  PRIORITY_LABELS,
  STATUS_ICON_NAMES,
  STATUS_LABELS,
  TASK_PRIORITIES,
  TaskPriority,
  TaskProgress,
  TaskRepeat,
  TaskSchedule,
  TaskStatus,
} from '../types';
import { TaskTag, applyTagColor, resolveTag, resolveTagColor } from '../tags';
import { extractTags, setPriority, setTags } from '../task-metadata';
import { isWithinTargetFolder } from '../path-utils';
import { gregorianToJalali } from '../date-utils';
import { getDeadlineInfo } from '../widget-localization';
import { getRepeatLabels } from '../timer-localization';
import { buildChip } from '../ui/chips';
import {
  BOARD_STATUS_ORDER,
  BoardGroup,
  DeadlineBucket,
  filterTasks,
  groupTasks,
  sortTasks,
  summarize,
} from './board-query';
import { BoardLabels, getBoardLabels } from './board-localization';
import { BoardTask, TaskStore } from './task-store';
import { TaskCalendar } from '../calendar/calendar-view';
import { TaskTimeline } from '../timeline/timeline-view';
import { getTimelineLabels } from '../timeline/timeline-localization';
import { getCalendarLabels } from '../calendar/calendar-localization';
import { MenuEntry, MenuSection, closeContextMenu, openContextMenu } from '../ui/context-menu';
import {
  TaskActionOptions,
  deadlineSections,
  getActionLabels,
  planSections,
  prioritySections,
  repeatSections,
  statusSections,
  taskActionSections,
  waitingSections,
} from './task-actions';
import { RelationIndex, SubtaskCount, subtaskCounts } from './task-relations';
import {
  BOARD_PROPERTIES,
  BoardColumnPref,
  BoardPropertyId,
  DEFAULT_CARD_PROPERTIES,
  KANBAN_WIDTH,
  TITLE_MIN_WIDTH,
  clampKanbanWidth,
  clampWidth,
  columnWidth,
  moveColumn,
  moveValue,
  orderGroups,
  resolveColumns,
  setColumn,
  visibleColumns,
} from './board-columns';
import { isSchedulePast, scheduleDayText, scheduleText, scheduleTimeText } from '../calendar/schedule-text';

/** Rows drawn per group before a "Show more" row; keeps a huge vault responsive. */
const ROWS_PER_PAGE = 150;

/** The widths of the table's fixed columns: the checkbox, and the ⋯ at the end. */
const CHECK_COLUMN = 34;
const END_COLUMN = 40;

export interface BoardSettingsView {
  language: Language;
  calendarSystem: CalendarSystem;
  targetFolder: string;
  tags: TaskTag[];
  board: BoardPreferences;
  /** Fallback destination for new tasks when the board has none yet. */
  referenceNotePath: string;
  /** Daily notes and the time grid, for the calendar layout. */
  calendar: CalendarSettings;
  /** A parent without a progress bar of its own shows how many subtasks are done. */
  subtaskProgress: boolean;
  /** The reminder before a plan starts: whether it is on, and how early. */
  planReminder: { enabled: boolean; leadMinutes: number };
}

/** Everything the board needs from the plugin. */
export interface TaskBoardHost {
  app: App;
  store: TaskStore;
  getSettings(): BoardSettingsView;
  savePreferences(): Promise<void>;
  getProgress(task: BoardTask): TaskProgress | undefined;
  setStatus(task: BoardTask, status: TaskStatus): Promise<void>;
  setPriority(task: BoardTask, priority: TaskPriority | null): Promise<void>;
  setTags(task: BoardTask, keys: string[]): Promise<void>;
  setText(task: BoardTask, text: string): Promise<void>;
  /** Asks for a deadline and writes it. */
  editDeadline(task: BoardTask): Promise<void>;
  editTags(task: BoardTask): void;
  editProgress(task: BoardTask, anchor: HTMLElement): void;
  openTaskMenu(task: BoardTask, anchor: HTMLElement): void;
  reveal(task: BoardTask): Promise<void>;
  /** Appends a finished task line to a note. Resolves false when the note is missing. */
  addTask(notePath: string, line: string): Promise<boolean>;
  noteExists(path: string): boolean;
  chooseNote(onPick: (path: string) => void): void;
  manageTags(): void;
  notify(message: string): void;
  /** Shows the board as a floating window over the whole app. */
  openFloating?(): void;

  // Quick edits from the right-click menu. Without them the menu leaves the
  // matching rows out, or falls back to the editors above.
  /** Writes a deadline, or removes it with `null`. */
  setDeadline?(task: BoardTask, deadline: string | null): Promise<void>;
  /** Writes a repeat rule, or removes it with `null`. */
  setRepeat?(task: BoardTask, repeat: TaskRepeat | null): Promise<void>;
  /** Sets a progress bar's steps, or removes the bar with `null`. */
  setProgress?(task: BoardTask, progress: TaskProgress | null): Promise<void>;
  /** Asks for a day and a time, and plans the task for them. */
  editSchedule?(task: BoardTask): Promise<void>;
  /**
   * Writes a new task line next to `task`: indented under it as its last
   * subtask, or after it and its subtasks as a sibling. Resolves whether it
   * was written.
   */
  insertTask?(task: BoardTask, line: string, as: 'child' | 'sibling'): Promise<boolean>;
  /**
   * Deletes a task from its note with everything nested under it, offering
   * to undo. Resolves whether it was deleted.
   */
  deleteTask?(task: BoardTask): Promise<boolean>;
  /**
   * Makes the task wait on exactly these tasks; an empty list stops it
   * waiting. A task waited on that has no block ID is given one.
   */
  setWaiting?(task: BoardTask, blockers: BoardTask[]): Promise<void>;
  /**
   * Writes a plan and a deadline in one edit, for the timeline's drags:
   * each is left alone when absent from the patch, and `null` removes it.
   */
  setDates?(task: BoardTask, patch: { schedule?: TaskSchedule | null; deadline?: string | null }): Promise<void>;
  /** The task's own reminder before its plan starts: minutes, `null` for none, `undefined` for the setting. */
  setRemind?(task: BoardTask, minutes: number | null | undefined): Promise<void>;

  // The calendar layout. A host without these still shows the calendar,
  // read-only.
  /** Writes a task's `@schedule(...)`, or removes it with `null`. */
  setSchedule?(task: BoardTask, schedule: TaskSchedule | null): Promise<void>;
  /** The day's daily notes that exist, under either calendar's name. */
  dailyNotesFor?(day: string): string[];
  /** The note a task added on `day` goes into, whether it exists yet, and whether it is the day's own note. */
  dayNoteTarget?(day: string, system: CalendarSystem): { path: string; exists: boolean; isDailyNote: boolean };
  /** Adds a finished task line on a day. Resolves the note it went into, or null. */
  addTaskOnDay?(day: string, line: string, system: CalendarSystem): Promise<string | null>;
  /** Opens the day's note, creating it from the template first when it is missing. */
  openDailyNote?(day: string, system: CalendarSystem): Promise<void>;
}

export interface TaskBoardOptions {
  /** Rendered inside the floating window rather than a workspace tab. */
  floating?: boolean;
  /** Closes the floating window. Only offered when floating. */
  onClose?: () => void;
  /**
   * Switches between the two: floats a tab's board, or sends a floating board
   * back to a tab. Falls back to the host's openFloating in a tab.
   */
  onToggleFloating?: () => void;
}

import { displayTitle } from './board-text';
export { displayTitle };

/** The accent a status column is tinted with; mirrors the chip colours in styles.css. */
const STATUS_ACCENT: Record<TaskStatus, string> = {
  '[ ]': 'var(--taskpro-accent-notstarted)',
  '[/]': 'var(--taskpro-accent-progress)',
  '[!]': 'var(--taskpro-accent-notdone)',
  '[x]': 'var(--taskpro-accent-done)',
};

const PRIORITY_ACCENT: Record<TaskPriority, string> = {
  highest: 'var(--color-red, #c0392b)',
  high: 'var(--color-orange, #c1741f)',
  medium: 'var(--color-yellow, #a8860a)',
  low: 'var(--color-blue, #2f6fbd)',
  lowest: 'var(--text-muted)',
};

const DEADLINE_BUCKET_STATE: Record<DeadlineBucket, string> = {
  overdue: 'missed',
  today: 'today',
  week: 'week',
  later: 'normal',
  past: 'completed',
  none: '',
};

export class TaskBoard {
  readonly el: HTMLElement;
  private headerEl!: HTMLElement;
  private summaryEl!: HTMLElement;
  private toolbarEl!: HTMLElement;
  private filtersEl!: HTMLElement;
  private addEl!: HTMLElement;
  private bodyEl!: HTMLElement;

  private search = '';
  private searchTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly rowLimits = new Map<string, number>();
  /** True while an inline editor is open; store updates wait until it closes. */
  private editing = false;
  private renderQueued = false;
  private unsubscribe: (() => void) | null = null;
  private draggedTaskId: string | null = null;
  private draggedFrom: string | null = null;
  private visible: BoardTask[] = [];
  /** The calendar layout, made the first time it is shown. */
  private calendarView: TaskCalendar | null = null;
  private calendarNavEl: HTMLElement | null = null;
  /** The timeline layout, made the first time it is shown. */
  private timelineView: TaskTimeline | null = null;
  /** Open holds on repaints: a calendar drag or picker in progress. */
  private holds = 0;
  /** Set for the moment between the end of a header drag and the click it makes. */
  private swallowClick = false;
  /** How many of each task's subtasks are done, and what each task waits on; rebuilt with the body. */
  private subtasks = new Map<string, SubtaskCount>();
  private relationIndex: RelationIndex | null = null;

  constructor(
    container: HTMLElement,
    private readonly host: TaskBoardHost,
    private readonly options: TaskBoardOptions = {}
  ) {
    this.el = container.createDiv({ cls: 'taskpro-board' });
    this.el.toggleClass('is-floating', !!options.floating);
  }

  async mount(): Promise<void> {
    this.renderChrome();
    this.renderBody();
    this.unsubscribe = this.host.store.subscribe(() => this.requestRender());
    await this.host.store.ensureLoaded();
    this.renderBody();
  }

  destroy(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.calendarView?.destroy();
    this.calendarView = null;
    this.timelineView?.destroy();
    closeContextMenu();
  }

  /** Settings changed (language, tags, target folder): rebuild everything. */
  refresh(): void {
    this.renderChrome();
    this.renderBody();
  }

  private get settings(): BoardSettingsView {
    return this.host.getSettings();
  }

  private get prefs(): BoardPreferences {
    return this.settings.board;
  }

  private get labels(): BoardLabels {
    return getBoardLabels(this.settings.language);
  }

  private get language(): Language {
    return this.settings.language;
  }

  private requestRender(): void {
    if (this.editing || this.holds > 0) {
      this.renderQueued = true;
      return;
    }
    this.renderBody();
  }

  private get isCalendar(): boolean {
    return this.prefs.layout === 'calendar';
  }

  private get isTimeline(): boolean {
    return this.prefs.layout === 'timeline';
  }

  /** Board and timeline both draw from the board's scope and filters. */
  private filteredTasks(): BoardTask[] {
    return filterTasks(this.scopedTasks(), this.prefs, this.search, { tags: this.settings.tags });
  }

  private timeline(): TaskTimeline {
    if (this.timelineView) return this.timelineView;
    this.timelineView = new TaskTimeline({
      host: this.host,
      root: this.el,
      settings: () => this.settings,
      prefs: () => this.prefs,
      updatePrefs: (patch) => this.updatePrefs(patch),
      tasks: () => this.filteredTasks(),
      hold: (on) => this.hold(on),
      openTaskActions: (task, at, anchor, lead) => this.openTaskActions(task, at, anchor, lead),
      relations: () => this.relations(),
      progress: (task) => {
        const shown = this.shownProgress(task);
        return shown?.enabled && shown.totalSteps ? shown.currentSteps / shown.totalSteps : null;
      },
      showSummary: (tasks) => {
        const counts = summarize(tasks, this.today());
        this.summaryEl.setText(this.labels.summary(counts.total, counts.done, counts.overdue));
      },
      rerender: () => this.renderBody(),
      segmented: (parent, cls, items, current, onPick) => this.segmented(parent, cls, items, current, onPick),
    });
    return this.timelineView;
  }

  /** The calendar, which draws itself into the board's nav bar and body. */
  private calendar(): TaskCalendar {
    if (this.calendarView) return this.calendarView;
    this.calendarView = new TaskCalendar({
      host: this.host,
      root: this.el,
      settings: () => this.settings,
      prefs: () => this.prefs,
      updatePrefs: (patch) => this.updatePrefs(patch),
      tasks: (dailyNotes) => {
        const all = this.host.store.all();
        const folder = this.settings.targetFolder;
        const scoped =
          this.effectiveScope === 'vault'
            ? all
            : all.filter((task) => isWithinTargetFolder(task.filePath, folder) || dailyNotes.has(task.filePath));
        return filterTasks(scoped, this.prefs, this.search, { tags: this.settings.tags });
      },
      hold: (on) => this.hold(on),
      openTaskActions: (task, at, anchor, lead) => this.openTaskActions(task, at, anchor, lead),
      refresh: () => {
        if (this.calendarNavEl) this.calendarView?.renderNav(this.calendarNavEl);
        this.renderBody();
      },
      rerender: () => this.renderBody(),
      showSummary: (tasks) => {
        const counts = summarize(tasks, this.today());
        this.summaryEl.setText(this.labels.summary(counts.total, counts.done, counts.overdue));
      },
      newTaskDefaults: () => this.newTaskDefaults({}),
      relations: () => this.relations(),
      segmented: (parent, cls, items, current, onPick) => this.segmented(parent, cls, items, current, onPick),
    });
    return this.calendarView;
  }

  private hold(on: boolean): void {
    this.holds = Math.max(0, this.holds + (on ? 1 : -1));
    if (!this.holds && this.renderQueued) this.renderBody();
  }

  /**
   * The right-click menu of a task, at a point or under a button. Repaints
   * wait while it is open, so the row it belongs to stays where it was.
   */
  openTaskActions(task: BoardTask, at: { x: number; y: number } | DOMRect, anchor: HTMLElement, lead?: MenuEntry[]): void {
    const language = this.settings.language;
    this.hold(true);
    openContextMenu({
      container: this.el,
      at,
      rtl: language === 'fa',
      header: displayTitle(task.text) || '—',
      searchPlaceholder: getActionLabels(language).search,
      sections: taskActionSections({ ...this.actionOptions(task, anchor), lead }),
      onClose: () => this.hold(false),
    });
  }

  private actionOptions(task: BoardTask, anchor: HTMLElement): TaskActionOptions {
    const settings = this.settings;
    return {
      host: this.host,
      task,
      language: settings.language,
      calendarSystem: this.prefs.calendarSystem ?? settings.calendarSystem,
      timeFormat: settings.calendar.timeFormat,
      tags: settings.tags,
      anchor,
      planReminder: settings.planReminder,
    };
  }

  /** One property's choices, opened right under its cell or chip. */
  private dropdown(anchor: HTMLElement, sections: MenuSection[]): void {
    this.hold(true);
    openContextMenu({
      container: this.el,
      at: anchor.getBoundingClientRect(),
      rtl: this.language === 'fa',
      sections,
      onClose: () => this.hold(false),
    });
  }

  /** Right click, or the context-menu key, on a row or a card. */
  private withTaskActions(el: HTMLElement, task: BoardTask): void {
    el.addEventListener('contextmenu', (event) => {
      if ((event.target as HTMLElement).closest('input, textarea')) return;
      event.preventDefault();
      event.stopPropagation();
      this.openTaskActions(task, { x: event.clientX, y: event.clientY }, el);
    });
  }

  private async updatePrefs(patch: Partial<BoardPreferences>, rebuildChrome = true): Promise<void> {
    Object.assign(this.prefs, patch);
    if (rebuildChrome) this.renderChrome();
    this.renderBody();
    await this.host.savePreferences();
  }

  /** Target-folder scope only means something when a target folder is set. */
  private get effectiveScope(): 'target' | 'vault' {
    return this.prefs.scope === 'target' && this.settings.targetFolder.trim() ? 'target' : 'vault';
  }

  private kanbanGrouping(): BoardGroupBy {
    return this.prefs.groupBy === 'none' ? 'status' : this.prefs.groupBy;
  }

  // ── Chrome: title, toolbar, filters, quick add ──────────────────────────

  private renderChrome(): void {
    const labels = this.labels;
    // A card or ghost the calendar left open belongs to the old chrome.
    this.calendarView?.destroy();
    this.el.empty();
    this.el.setAttribute('dir', this.language === 'fa' ? 'rtl' : 'ltr');
    this.el.toggleClass('is-board-layout', this.prefs.layout === 'board');
    this.el.toggleClass('is-calendar-layout', this.isCalendar);
    this.el.toggleClass('is-timeline-layout', this.isTimeline);

    this.headerEl = this.el.createDiv({ cls: 'taskpro-board__header' });
    const heading = this.headerEl.createDiv({ cls: 'taskpro-board__heading' });
    const titleIcon = heading.createSpan({ cls: 'taskpro-board__heading-icon' });
    setIcon(titleIcon, 'list-checks');
    heading.createEl('h2', { cls: 'taskpro-board__title-text', text: labels.title });
    this.summaryEl = heading.createSpan({ cls: 'taskpro-board__summary' });

    const actions = heading.createDiv({ cls: 'taskpro-board__heading-actions' });
    this.iconButton(actions, 'tags', labels.manageTags, () => this.host.manageTags());
    this.iconButton(actions, 'refresh-cw', labels.refresh, () => void this.host.store.reload());
    const toggleFloating =
      this.options.onToggleFloating ?? (this.host.openFloating ? () => this.host.openFloating?.() : null);
    if (toggleFloating) {
      this.iconButton(
        actions,
        this.options.floating ? 'minimize-2' : 'picture-in-picture-2',
        this.options.floating ? labels.dock : labels.float,
        () => toggleFloating()
      ).addClass('taskpro-board__float-toggle');
    }
    if (this.options.floating && this.options.onClose) {
      this.iconButton(actions, 'x', labels.close, () => this.options.onClose?.()).addClass('taskpro-board__close');
    }

    this.toolbarEl = this.headerEl.createDiv({ cls: 'taskpro-board__toolbar' });
    this.renderScopeControl(this.toolbarEl);
    this.renderLayoutControl(this.toolbarEl);

    const search = this.toolbarEl.createDiv({ cls: 'taskpro-board__search' });
    setIcon(search.createSpan({ cls: 'taskpro-board__search-icon' }), 'search');
    const input = search.createEl('input', {
      type: 'search',
      attr: { placeholder: labels.search, 'aria-label': labels.search, dir: 'auto' },
    });
    input.value = this.search;
    input.addEventListener('input', () => {
      this.search = input.value;
      if (this.searchTimer) clearTimeout(this.searchTimer);
      this.searchTimer = setTimeout(() => this.renderBody(), 120);
    });

    const controls = this.toolbarEl.createDiv({ cls: 'taskpro-board__controls' });
    // Days are the calendar's grouping and time its order; the timeline's rows follow the dates.
    if (!this.isCalendar && !this.isTimeline) {
      this.renderGroupControl(controls);
      this.renderSortControl(controls);
      this.renderPropertiesControl(controls);
    }
    this.renderFilterControl(controls);

    this.filtersEl = this.headerEl.createDiv({ cls: 'taskpro-board__filters' });
    this.renderActiveFilters();

    // The calendar adds tasks on the day they are for, so its bar takes the
    // place of the quick-add row.
    if (this.isCalendar) {
      this.calendarNavEl = this.el.createDiv({ cls: 'taskpro-cal-nav' });
      this.calendar().renderNav(this.calendarNavEl);
    } else if (this.isTimeline) {
      this.calendarNavEl = null;
      this.timeline().renderNav(this.el.createDiv({ cls: 'taskpro-cal-nav taskpro-tl-nav' }));
    } else {
      this.calendarNavEl = null;
      this.addEl = this.el.createDiv({ cls: 'taskpro-board__add' });
      this.renderQuickAdd(this.addEl);
    }

    this.bodyEl = this.el.createDiv({ cls: 'taskpro-board__body' });
  }

  private iconButton(parent: HTMLElement, icon: string, label: string, onClick: (e: MouseEvent) => void): HTMLButtonElement {
    const button = parent.createEl('button', { cls: 'clickable-icon taskpro-board__icon-btn' });
    button.type = 'button';
    button.setAttribute('aria-label', label);
    setIcon(button, icon);
    button.addEventListener('click', onClick);
    return button;
  }

  segmented(
    parent: HTMLElement,
    cls: string,
    items: Array<{ value: string; label: string; icon?: string; disabled?: boolean; title?: string }>,
    current: string,
    onPick: (value: string) => void
  ): void {
    const group = parent.createDiv({ cls: `taskpro-segmented ${cls}` });
    group.setAttribute('role', 'radiogroup');
    for (const item of items) {
      const button = group.createEl('button', { cls: 'taskpro-segmented__item' });
      button.type = 'button';
      button.setAttribute('role', 'radio');
      button.setAttribute('aria-checked', String(item.value === current));
      if (item.value === current) button.addClass('is-active');
      if (item.icon) setIcon(button.createSpan({ cls: 'taskpro-segmented__icon' }), item.icon);
      button.createSpan({ cls: 'taskpro-segmented__label', text: item.label });
      if (item.title) button.title = item.title;
      if (item.disabled) {
        button.disabled = true;
        button.addClass('is-disabled');
      }
      button.addEventListener('click', () => {
        if (item.value !== current && !item.disabled) onPick(item.value);
      });
    }
  }

  private renderScopeControl(parent: HTMLElement): void {
    const labels = this.labels;
    const folder = this.settings.targetFolder.trim().replace(/^\/+|\/+$/g, '');
    this.segmented(
      parent,
      'taskpro-board__scope',
      [
        {
          value: 'target',
          label: folder ? labels.scopeTarget(folder.split('/').pop() || folder) : labels.scopeTarget('—'),
          icon: 'folder',
          disabled: !folder,
          title: folder || labels.scopeTargetUnset,
        },
        { value: 'vault', label: labels.scopeVault, icon: 'vault' },
      ],
      this.effectiveScope,
      (value) => void this.updatePrefs({ scope: value as BoardPreferences['scope'] })
    );
  }

  private renderLayoutControl(parent: HTMLElement): void {
    const labels = this.labels;
    this.segmented(
      parent,
      'taskpro-board__layout',
      [
        { value: 'table', label: labels.layoutTable, icon: 'table-2' },
        { value: 'board', label: labels.layoutBoard, icon: 'kanban' },
        { value: 'calendar', label: getCalendarLabels(this.language).layout, icon: 'calendar-days' },
        { value: 'timeline', label: getTimelineLabels(this.language).layout, icon: 'gantt-chart' },
      ],
      this.prefs.layout,
      (value) => void this.updatePrefs({ layout: value as BoardPreferences['layout'] })
    );
  }

  private controlButton(parent: HTMLElement, icon: string, label: string, value?: string): HTMLButtonElement {
    const button = parent.createEl('button', { cls: 'taskpro-board__control' });
    button.type = 'button';
    setIcon(button.createSpan({ cls: 'taskpro-board__control-icon' }), icon);
    button.createSpan({ cls: 'taskpro-board__control-label', text: label });
    if (value) button.createSpan({ cls: 'taskpro-board__control-value', text: value });
    return button;
  }

  private renderGroupControl(parent: HTMLElement): void {
    const labels = this.labels;
    const current = this.prefs.layout === 'board' ? this.kanbanGrouping() : this.prefs.groupBy;
    const button = this.controlButton(parent, 'layers', labels.group, labels.groupBy[current]);
    button.addEventListener('click', (event) => {
      const menu = new Menu();
      const options: BoardGroupBy[] = ['none', 'status', 'tag', 'priority', 'deadline', 'note'];
      for (const option of options) {
        // A board always has columns, so "no grouping" is a table-only choice.
        if (this.prefs.layout === 'board' && option === 'none') continue;
        menu.addItem((item) =>
          item
            .setTitle(labels.groupBy[option])
            .setChecked(current === option)
            .onClick(() => void this.updatePrefs({ groupBy: option }))
        );
      }
      menu.showAtMouseEvent(event);
    });
  }

  private renderSortControl(parent: HTMLElement): void {
    const labels = this.labels;
    const button = this.controlButton(
      parent,
      'arrow-up-down',
      labels.sort,
      labels.sortBy[this.prefs.sortKey]
    );
    button.addEventListener('click', (event) => {
      const menu = new Menu();
      const keys: BoardSortKey[] = ['document', 'title', 'status', 'priority', 'deadline', 'plan', 'progress', 'note'];
      for (const key of keys) {
        menu.addItem((item) =>
          item
            .setTitle(labels.sortBy[key])
            .setChecked(this.prefs.sortKey === key)
            .onClick(() => void this.updatePrefs({ sortKey: key }))
        );
      }
      menu.addSeparator();
      menu.addItem((item) =>
        item
          .setTitle(labels.ascending)
          .setIcon('arrow-down')
          .setChecked(this.prefs.sortDir === 'asc')
          .onClick(() => void this.updatePrefs({ sortDir: 'asc' }))
      );
      menu.addItem((item) =>
        item
          .setTitle(labels.descending)
          .setIcon('arrow-up')
          .setChecked(this.prefs.sortDir === 'desc')
          .onClick(() => void this.updatePrefs({ sortDir: 'desc' }))
      );
      menu.showAtMouseEvent(event);
    });
  }

  /** Which properties the table's columns, or the board's cards, show, and in what order. */
  private renderPropertiesControl(parent: HTMLElement): void {
    const button = this.controlButton(parent, 'sliders-horizontal', this.labels.properties);
    button.addClass('taskpro-board__properties');
    button.addEventListener('click', () =>
      this.openPropertiesMenu(button, this.prefs.layout === 'board' ? 'cardProperties' : 'tableColumns')
    );
  }

  private activeFilterCount(): number {
    return this.prefs.statuses.length + this.prefs.priorities.length + this.prefs.tags.length;
  }

  private renderFilterControl(parent: HTMLElement): void {
    const labels = this.labels;
    const count = this.activeFilterCount();
    const button = this.controlButton(parent, 'filter', labels.filter, count ? String(count) : undefined);
    if (count) button.addClass('is-active');
    button.addEventListener('click', (event) => {
      const menu = new Menu();
      const toggle = <T,>(list: T[], value: T): T[] =>
        list.includes(value) ? list.filter((v) => v !== value) : [...list, value];

      menu.addItem((item) => item.setTitle(labels.filterStatus).setIsLabel(true));
      for (const status of BOARD_STATUS_ORDER) {
        menu.addItem((item) =>
          item
            .setTitle(STATUS_LABELS[this.language][status])
            .setIcon(STATUS_ICON_NAMES[status])
            .setChecked(this.prefs.statuses.includes(status))
            .onClick(() => void this.updatePrefs({ statuses: toggle(this.prefs.statuses, status) }))
        );
      }

      menu.addSeparator();
      menu.addItem((item) => item.setTitle(labels.filterPriority).setIsLabel(true));
      const priorities: BoardPriorityFilter[] = [...TASK_PRIORITIES, 'none'];
      for (const priority of priorities) {
        menu.addItem((item) =>
          item
            .setTitle(priority === 'none' ? labels.noPriority : PRIORITY_LABELS[this.language][priority])
            .setIcon(priority === 'none' ? 'minus' : PRIORITY_ICON_NAMES[priority])
            .setChecked(this.prefs.priorities.includes(priority))
            .onClick(() => void this.updatePrefs({ priorities: toggle(this.prefs.priorities, priority) }))
        );
      }

      menu.addSeparator();
      menu.addItem((item) => item.setTitle(labels.filterTags).setIsLabel(true));
      for (const tag of [...this.settings.tags, { key: '', name: labels.noTag, color: 'gray' }]) {
        menu.addItem((item) =>
          item
            .setTitle(tag.name)
            .setIcon(tag.key ? 'tag' : 'minus')
            .setChecked(this.prefs.tags.includes(tag.key))
            .onClick(() => void this.updatePrefs({ tags: toggle(this.prefs.tags, tag.key) }))
        );
      }

      if (count) {
        menu.addSeparator();
        menu.addItem((item) =>
          item
            .setTitle(labels.clearFilters)
            .setIcon('x')
            .onClick(() => void this.updatePrefs({ statuses: [], priorities: [], tags: [] }))
        );
      }
      menu.showAtMouseEvent(event);
    });
  }

  /** Active filters as removable pills under the toolbar. */
  private renderActiveFilters(): void {
    const el = this.filtersEl;
    el.empty();
    const labels = this.labels;
    const pills: Array<{ build: (pill: HTMLElement) => void; remove: () => void }> = [];

    for (const status of this.prefs.statuses) {
      pills.push({
        build: (pill) => {
          pill.addClass('taskpro-interactive-badge');
          pill.dataset.status = status;
          this.chipContent(pill, STATUS_ICON_NAMES[status], STATUS_LABELS[this.language][status]);
        },
        remove: () => void this.updatePrefs({ statuses: this.prefs.statuses.filter((s) => s !== status) }),
      });
    }
    for (const priority of this.prefs.priorities) {
      pills.push({
        build: (pill) => {
          if (priority === 'none') {
            this.chipContent(pill, 'minus', labels.noPriority);
            return;
          }
          pill.addClass('taskpro-priority-badge');
          pill.dataset.priority = priority;
          this.chipContent(pill, PRIORITY_ICON_NAMES[priority], PRIORITY_LABELS[this.language][priority]);
        },
        remove: () => void this.updatePrefs({ priorities: this.prefs.priorities.filter((p) => p !== priority) }),
      });
    }
    for (const key of this.prefs.tags) {
      pills.push({
        build: (pill) => {
          if (!key) {
            this.chipContent(pill, 'minus', labels.noTag);
            return;
          }
          const tag = resolveTag(key, this.settings.tags);
          pill.addClass('taskpro-tag-chip');
          applyTagColor(pill, tag.color);
          this.chipContent(pill, null, tag.name);
        },
        remove: () => void this.updatePrefs({ tags: this.prefs.tags.filter((k) => k !== key) }),
      });
    }

    el.toggleClass('is-empty', pills.length === 0);
    for (const entry of pills) {
      const pill = el.createEl('button', { cls: 'taskpro-chip taskpro-board__filter-pill' });
      pill.type = 'button';
      entry.build(pill);
      const x = pill.createSpan({ cls: 'taskpro-board__filter-x' });
      setIcon(x, 'x');
      pill.addEventListener('click', entry.remove);
    }
    if (pills.length > 1) {
      const clear = el.createEl('button', { cls: 'taskpro-board__clear', text: labels.clearFilters });
      clear.type = 'button';
      clear.addEventListener('click', () => void this.updatePrefs({ statuses: [], priorities: [], tags: [] }));
    }
  }

  private chipContent(chip: HTMLElement, icon: string | null, label: string): void {
    if (icon) {
      const iconEl = chip.createSpan({ cls: 'taskpro-chip__icon' });
      iconEl.setAttribute('aria-hidden', 'true');
      setIcon(iconEl, icon);
    }
    chip.createSpan({ cls: 'taskpro-chip__label', text: label });
  }

  // ── Quick add ────────────────────────────────────────────────────────────

  private inboxPath(): string {
    const { board, referenceNotePath } = this.settings;
    if (board.inboxPath && this.host.noteExists(board.inboxPath)) return board.inboxPath;
    if (referenceNotePath && this.host.noteExists(referenceNotePath)) return referenceNotePath;
    return '';
  }

  private renderQuickAdd(parent: HTMLElement): void {
    const labels = this.labels;
    setIcon(parent.createSpan({ cls: 'taskpro-board__add-icon' }), 'plus');
    const input = parent.createEl('input', {
      type: 'text',
      cls: 'taskpro-board__add-input',
      attr: { placeholder: labels.addPlaceholder, 'aria-label': labels.addPlaceholder, dir: 'auto' },
    });

    const inbox = this.inboxPath();
    const target = parent.createEl('button', { cls: 'taskpro-board__inbox' });
    target.type = 'button';
    target.title = `${labels.addInto}: ${inbox || '—'}\n${labels.chooseInbox}`;
    setIcon(target.createSpan({ cls: 'taskpro-board__inbox-icon' }), 'file-plus');
    target.createSpan({
      cls: 'taskpro-board__inbox-label',
      text: inbox ? inbox.split('/').pop()!.replace(/\.md$/i, '') : labels.chooseInboxShort,
      attr: { dir: 'auto' },
    });
    target.addEventListener('click', () =>
      this.host.chooseNote((path) => void this.updatePrefs({ inboxPath: path }))
    );

    input.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' || event.isComposing) return;
      event.preventDefault();
      const text = input.value.trim();
      if (!text) return;
      void this.addTask(text, {}).then((added) => {
        if (added) input.value = '';
      });
    });
  }

  /**
   * Writes a new task. Like a new row in a filtered Notion view, it inherits
   * whatever the filters (or the column it was added to) ask for, so it does
   * not vanish from the board the moment it is created.
   */
  private async addTask(
    text: string,
    inherit: { status?: TaskStatus; priority?: TaskPriority; tags?: string[] }
  ): Promise<boolean> {
    const labels = this.labels;
    const path = this.inboxPath();
    if (!path) {
      // Ask where new tasks go, then add this one there rather than dropping it.
      this.host.notify(labels.addFailed);
      this.host.chooseNote((picked) => {
        void this.updatePrefs({ inboxPath: picked }).then(() => this.addTask(text, inherit));
      });
      return false;
    }

    const { status, priority, tags } = this.newTaskDefaults(inherit);
    let line = `- ${status} ${text.replace(/\s+/g, ' ')}`;
    if (priority) line = setPriority(line, priority);
    if (tags.length) line = setTags(line, tags);

    const added = await this.host.addTask(path, line);
    if (!added) {
      this.host.notify(labels.addFailed);
      return false;
    }
    const noteName = path.split('/').pop()!.replace(/\.md$/i, '');
    const inScope = this.effectiveScope === 'vault' || isWithinTargetFolder(path, this.settings.targetFolder);
    this.host.notify(inScope ? labels.added(noteName) : labels.outsideScope);
    return true;
  }

  /**
   * What a new task starts with: the column it was added in, else whatever a
   * single status, priority or tag filter asks for, so it stays in view.
   */
  private newTaskDefaults(inherit: { status?: TaskStatus; priority?: TaskPriority; tags?: string[] }): {
    status: TaskStatus;
    priority?: TaskPriority;
    tags: string[];
  } {
    const onlyStatus = this.prefs.statuses.length === 1 ? this.prefs.statuses[0] : undefined;
    const filterPriorities = this.prefs.priorities.filter((p): p is TaskPriority => p !== 'none');
    const onlyPriority = filterPriorities.length === 1 ? filterPriorities[0] : undefined;
    return {
      status: inherit.status ?? onlyStatus ?? '[ ]',
      priority: inherit.priority ?? onlyPriority,
      tags: inherit.tags ?? this.prefs.tags.filter(Boolean),
    };
  }

  // ── Body ─────────────────────────────────────────────────────────────────

  private scopedTasks(): BoardTask[] {
    const all = this.host.store.all();
    if (this.effectiveScope === 'vault') return all;
    const folder = this.settings.targetFolder;
    return all.filter((task) => isWithinTargetFolder(task.filePath, folder));
  }

  private today(): Date {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return today;
  }

  renderBody(): void {
    if (!this.bodyEl) return;
    this.renderQueued = false;
    const labels = this.labels;
    const scrollTop = this.bodyEl.scrollTop;
    const scrollLeft = this.bodyEl.scrollLeft;
    // Read before emptying: a removed element can no longer be the focused one.
    const hadFocus = this.bodyEl.contains(this.el.ownerDocument.activeElement);
    this.bodyEl.empty();

    if (!this.host.store.isLoaded) {
      this.summaryEl.setText('');
      this.emptyState(labels.loading, 'loader');
      return;
    }

    this.refreshRelations();
    this.bodyEl.toggleClass('is-calendar', this.isCalendar);
    this.bodyEl.toggleClass('is-timeline', this.isTimeline);
    if (this.isCalendar) {
      this.calendar().renderBody(this.bodyEl, hadFocus);
      return;
    }
    if (this.isTimeline) {
      this.timeline().renderBody(this.bodyEl);
      return;
    }

    const today = this.today();
    const scoped = this.scopedTasks();
    const filtered = filterTasks(scoped, this.prefs, this.search, { tags: this.settings.tags });
    const sorted = sortTasks(filtered, this.prefs.sortKey, this.prefs.sortDir, {
      getProgress: (task) => this.shownProgress(task),
      today,
    });
    this.visible = sorted;

    const counts = summarize(filtered, today);
    this.summaryEl.setText(labels.summary(counts.total, counts.done, counts.overdue));

    if (!sorted.length) {
      const filtering = this.search.trim() || this.activeFilterCount();
      this.emptyState(filtering ? labels.emptyFiltered : labels.empty, filtering ? 'search' : 'list-checks');
      return;
    }

    if (this.prefs.layout === 'board') this.renderKanban(sorted, today);
    else this.renderTable(sorted, today);

    this.bodyEl.scrollTop = scrollTop;
    this.bodyEl.scrollLeft = scrollLeft;
  }

  private refreshRelations(): void {
    const all = this.host.store.all();
    this.subtasks = subtaskCounts(all);
    this.relationIndex = new RelationIndex(all);
  }

  /** What every task waits on, for the calendar and the timeline as well. */
  relations(): RelationIndex {
    if (!this.relationIndex) this.refreshRelations();
    return this.relationIndex!;
  }

  /** The subtasks of a task that has no progress bar of its own, when that is switched on. */
  private subtaskProgress(task: BoardTask): SubtaskCount | undefined {
    if (!this.settings.subtaskProgress) return undefined;
    return this.subtasks.get(task.id);
  }

  /** The progress a task shows: its own bar, else its subtasks. */
  private shownProgress(task: BoardTask): TaskProgress | undefined {
    const own = this.host.getProgress(task);
    if (own?.enabled) return own;
    const count = this.subtaskProgress(task);
    return count ? { enabled: true, currentSteps: count.done, totalSteps: count.total } : undefined;
  }

  private emptyState(text: string, icon: string): void {
    const empty = this.bodyEl.createDiv({ cls: 'taskpro-board__empty' });
    setIcon(empty.createDiv({ cls: 'taskpro-board__empty-icon' }), icon);
    empty.createDiv({ text });
  }

  // ── Table ────────────────────────────────────────────────────────────────

  private tableColumns(): BoardColumnPref[] {
    return resolveColumns(this.prefs.tableColumns);
  }

  private cardProperties(): BoardColumnPref[] {
    return resolveColumns(this.prefs.cardProperties, DEFAULT_CARD_PROPERTIES);
  }

  /** Keeps a new arrangement of the properties and draws the body again; the toolbar stays. */
  private saveColumns(key: 'tableColumns' | 'cardProperties', columns: BoardColumnPref[]): void {
    void this.updatePrefs({ [key]: columns }, false);
  }

  private renderTable(tasks: BoardTask[], today: Date): void {
    const labels = this.labels;
    const groupBy = this.prefs.groupBy;
    const groups = groupTasks(tasks, groupBy, { tags: this.settings.tags, today });
    const columns = visibleColumns(this.tableColumns());
    // The check, the title, the properties and the ⋯ column.
    const span = String(columns.length + 3);

    const table = this.bodyEl.createEl('table', { cls: 'taskpro-table' });
    table.toggleClass('is-document-order', this.prefs.sortKey === 'document' && (groupBy === 'none' || groupBy === 'note'));
    const colgroup = table.createEl('colgroup');
    colgroup.createEl('col', { cls: 'taskpro-table__col--check' });
    colgroup.createEl('col', { cls: 'taskpro-table__col--task' });
    for (const column of columns) {
      const col = colgroup.createEl('col', { cls: `taskpro-table__col--${column.id}` });
      col.dataset.column = column.id;
      col.style.width = `${columnWidth(column)}px`;
    }
    colgroup.createEl('col', { cls: 'taskpro-table__col--more' });
    this.fitTable(table);

    const head = table.createEl('thead').createEl('tr');
    head.createEl('th', { cls: 'taskpro-table__check' });
    const titleHead = this.headerCell(head, 'task', 'text', labels.columns.task, 'title');
    this.onHeaderActivate(titleHead, () => this.sortBy('title'));
    titleHead.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.openHeaderMenu(null, { x: event.clientX, y: event.clientY });
    });
    for (const column of columns) this.renderColumnHeader(head, table, column);
    const end = head.createEl('th', { cls: 'taskpro-table__more taskpro-table__add-column' });
    const add = this.iconButton(end, 'plus', labels.properties, () => this.openPropertiesMenu(add, 'tableColumns'));
    add.addClass('taskpro-table__add-btn');

    const body = table.createEl('tbody');
    for (const group of groups) {
      if (groupBy !== 'none') {
        if (!group.tasks.length && groupBy === 'status') continue;
        this.renderGroupRow(body, group, groupBy, span);
        if (this.prefs.collapsedGroups.includes(group.id)) continue;
      }
      const limit = this.rowLimits.get(group.id) ?? ROWS_PER_PAGE;
      for (const task of group.tasks.slice(0, limit)) this.renderRow(body, task, columns);
      if (group.tasks.length > limit) {
        const more = body.createEl('tr', { cls: 'taskpro-table__more-row' });
        const cell = more.createEl('td', { attr: { colspan: span } });
        const button = cell.createEl('button', { text: labels.showMore(Math.min(ROWS_PER_PAGE, group.tasks.length - limit)) });
        button.addEventListener('click', () => {
          this.rowLimits.set(group.id, limit + ROWS_PER_PAGE);
          this.renderBody();
        });
      }
    }
  }

  /** The table is never narrower than its columns, with room left for a title of a few words. */
  private fitTable(table: HTMLElement): void {
    let width = CHECK_COLUMN + TITLE_MIN_WIDTH + END_COLUMN;
    table.querySelectorAll<HTMLElement>('col[data-column]').forEach((col) => (width += parseFloat(col.style.width) || 0));
    table.style.minWidth = `${width}px`;
  }

  private headerCell(head: HTMLElement, cls: string, icon: string, label: string, sortKey?: BoardSortKey): HTMLElement {
    const th = head.createEl('th', { cls: `taskpro-table__${cls}` });
    th.setAttribute('role', 'button');
    th.tabIndex = 0;
    const inner = th.createDiv({ cls: 'taskpro-table__th' });
    setIcon(inner.createSpan({ cls: 'taskpro-table__th-icon' }), icon);
    inner.createSpan({ cls: 'taskpro-table__th-label', text: label });
    if (sortKey) {
      th.addClass('is-sortable');
      if (this.prefs.sortKey === sortKey) {
        th.addClass('is-sorted');
        setIcon(inner.createSpan({ cls: 'taskpro-table__sort' }), this.prefs.sortDir === 'desc' ? 'arrow-up' : 'arrow-down');
      }
    }
    return th;
  }

  /** A click, Enter or Space; not the click that ends a drag. */
  private onHeaderActivate(th: HTMLElement, activate: () => void): void {
    th.addEventListener('click', () => {
      if (this.swallowClick) return;
      activate();
    });
    th.addEventListener('keydown', (event) => {
      if (event.target !== th || (event.key !== 'Enter' && event.key !== ' ')) return;
      event.preventDefault();
      activate();
    });
  }

  /** Click once to sort, again to flip, a third time to go back to note order. */
  private sortBy(key: BoardSortKey): void {
    if (this.prefs.sortKey !== key) void this.updatePrefs({ sortKey: key, sortDir: 'asc' });
    else if (this.prefs.sortDir === 'asc') void this.updatePrefs({ sortDir: 'desc' });
    else void this.updatePrefs({ sortKey: 'document', sortDir: 'asc' });
  }

  private renderColumnHeader(head: HTMLElement, table: HTMLElement, column: BoardColumnPref): void {
    const info = BOARD_PROPERTIES[column.id];
    const th = this.headerCell(head, column.id, info.icon, this.labels.columns[column.id], info.sortKey);
    th.dataset.column = column.id;
    th.addClass('is-movable');
    // A property that does not sort opens its menu instead.
    this.onHeaderActivate(th, () =>
      info.sortKey ? this.sortBy(info.sortKey) : this.openHeaderMenu(column.id, th.getBoundingClientRect())
    );
    th.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.openHeaderMenu(column.id, { x: event.clientX, y: event.clientY });
    });
    th.addEventListener('keydown', (event) => {
      if (!event.altKey || event.target !== th || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return;
      event.preventDefault();
      const earlier = (event.key === 'ArrowLeft') !== (this.language === 'fa');
      this.shiftColumn(column.id, earlier ? -1 : 1, true);
    });
    this.columnDrag(th, table, column.id);

    const handle = th.createSpan({ cls: 'taskpro-table__resize' });
    handle.setAttribute('aria-hidden', 'true');
    this.columnResize(handle, table, column);
  }

  /** Moves a column one place earlier or later among the columns that show. */
  private shiftColumn(id: BoardPropertyId, step: -1 | 1, refocus = false): void {
    const all = this.tableColumns();
    const shown = visibleColumns(all);
    const index = shown.findIndex((column) => column.id === id);
    const to = index + step;
    if (index === -1 || to < 0 || to >= shown.length) return;
    this.saveColumns('tableColumns', moveColumn(all, id, step === -1 ? shown[to].id : shown[to + 1]?.id ?? null));
    if (refocus) this.bodyEl.querySelector<HTMLElement>(`th[data-column="${id}"]`)?.focus();
  }

  /**
   * Dragging a header moves its column. A copy of the header follows the
   * pointer and a line shows where the column will land; Escape puts it back.
   */
  private columnDrag(th: HTMLElement, table: HTMLElement, id: BoardPropertyId): void {
    th.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || (event.target as HTMLElement).closest('.taskpro-table__resize')) return;
      const doc = this.el.ownerDocument;
      const rtl = this.language === 'fa';
      const startX = event.clientX;
      const startY = event.clientY;
      let dragging = false;
      let before: BoardPropertyId | null = null;
      let changes = false;
      let ghost: HTMLElement | null = null;
      let line: HTMLElement | null = null;

      const heads = () => Array.from(table.querySelectorAll<HTMLElement>('thead th[data-column]'));
      const begin = () => {
        dragging = true;
        this.hold(true);
        table.addClass('is-moving-column');
        th.addClass('is-dragging');
        ghost = this.el.createDiv({ cls: 'taskpro-table__ghost' });
        ghost.appendChild(th.querySelector('.taskpro-table__th')!.cloneNode(true));
        ghost.style.width = `${th.offsetWidth}px`;
        line = this.el.createDiv({ cls: 'taskpro-table__drop' });
      };
      const onMove = (e: PointerEvent) => {
        if (!dragging) {
          if (Math.abs(e.clientX - startX) < 5 && Math.abs(e.clientY - startY) < 5) return;
          begin();
        }
        const box = this.el.getBoundingClientRect();
        const view = this.bodyEl.getBoundingClientRect();
        // Near an edge of a table wider than the view, the view scrolls along.
        if (e.clientX < view.left + 36) this.bodyEl.scrollLeft -= 14;
        else if (e.clientX > view.right - 36) this.bodyEl.scrollLeft += 14;

        const cells = heads();
        const target = cells.find((cell) => {
          const r = cell.getBoundingClientRect();
          const mid = (r.left + r.right) / 2;
          return rtl ? e.clientX > mid : e.clientX < mid;
        });
        before = (target?.dataset.column as BoardPropertyId | undefined) ?? null;
        const order = cells.map((cell) => cell.dataset.column);
        const at = order.indexOf(id);
        changes = before !== id && (order[at + 1] ?? null) !== before;

        const edge = (target ?? cells[cells.length - 1]).getBoundingClientRect();
        const x = target ? (rtl ? edge.right : edge.left) : rtl ? edge.left : edge.right;
        const rect = table.getBoundingClientRect();
        const top = Math.max(rect.top, view.top);
        const bottom = Math.min(rect.bottom, view.bottom);
        line!.toggleClass('is-idle', !changes);
        line!.style.left = `${Math.round(x - box.left - 1)}px`;
        line!.style.top = `${Math.round(top - box.top)}px`;
        line!.style.height = `${Math.max(0, Math.round(bottom - top))}px`;
        const head = th.getBoundingClientRect();
        ghost!.style.left = `${Math.round(e.clientX - box.left - ghost!.offsetWidth / 2)}px`;
        ghost!.style.top = `${Math.round(head.top - box.top)}px`;
      };
      const finish = (drop: boolean) => {
        doc.removeEventListener('pointermove', onMove, true);
        doc.removeEventListener('pointerup', onUp, true);
        doc.removeEventListener('pointercancel', onCancel, true);
        doc.removeEventListener('keydown', onKey, true);
        if (!dragging) return;
        ghost?.remove();
        line?.remove();
        table.removeClass('is-moving-column');
        th.removeClass('is-dragging');
        // The click that ends the drag is not a sort.
        this.swallowClick = true;
        window.setTimeout(() => (this.swallowClick = false), 0);
        if (drop && changes) this.saveColumns('tableColumns', moveColumn(this.tableColumns(), id, before));
        this.hold(false);
      };
      const onUp = () => finish(true);
      const onCancel = () => finish(false);
      const onKey = (e: KeyboardEvent) => {
        if (e.key !== 'Escape') return;
        e.preventDefault();
        e.stopPropagation();
        finish(false);
      };
      doc.addEventListener('pointermove', onMove, true);
      doc.addEventListener('pointerup', onUp, true);
      doc.addEventListener('pointercancel', onCancel, true);
      doc.addEventListener('keydown', onKey, true);
    });
  }

  /** Dragging a header's edge resizes its column; a double click puts its width back. */
  private columnResize(handle: HTMLElement, table: HTMLElement, column: BoardColumnPref): void {
    const id = column.id;
    handle.addEventListener('click', (event) => event.stopPropagation());
    handle.addEventListener('dblclick', (event) => {
      event.stopPropagation();
      if (column.width !== undefined) this.saveColumns('tableColumns', setColumn(this.tableColumns(), id, { width: undefined }));
    });
    handle.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      const col = table.querySelector<HTMLElement>(`col[data-column="${id}"]`);
      if (!col) return;
      const doc = this.el.ownerDocument;
      // The edge is on the column's far side: to the left in Persian.
      const sign = this.language === 'fa' ? -1 : 1;
      const startX = event.clientX;
      const start = columnWidth(column);
      let width = start;
      this.hold(true);
      this.el.addClass('is-resizing-column');
      handle.addClass('is-active');
      const onMove = (e: PointerEvent) => {
        width = clampWidth(id, start + (e.clientX - startX) * sign);
        col.style.width = `${width}px`;
        this.fitTable(table);
      };
      const onUp = () => {
        doc.removeEventListener('pointermove', onMove, true);
        doc.removeEventListener('pointerup', onUp, true);
        doc.removeEventListener('pointercancel', onUp, true);
        this.el.removeClass('is-resizing-column');
        handle.removeClass('is-active');
        if (width !== start) this.saveColumns('tableColumns', setColumn(this.tableColumns(), id, { width }));
        this.hold(false);
      };
      doc.addEventListener('pointermove', onMove, true);
      doc.addEventListener('pointerup', onUp, true);
      doc.addEventListener('pointercancel', onUp, true);
    });
  }

  private sortEntries(key: BoardSortKey): MenuEntry[] {
    const labels = this.labels;
    const sorted = this.prefs.sortKey === key;
    return [
      {
        label: labels.sortAscending,
        icon: 'arrow-down',
        checked: sorted && this.prefs.sortDir === 'asc',
        onSelect: () => void this.updatePrefs({ sortKey: key, sortDir: 'asc' }),
      },
      {
        label: labels.sortDescending,
        icon: 'arrow-up',
        checked: sorted && this.prefs.sortDir === 'desc',
        onSelect: () => void this.updatePrefs({ sortKey: key, sortDir: 'desc' }),
      },
    ];
  }

  /** A column header's menu: sort, move, width, hide. The title column only sorts. */
  private openHeaderMenu(id: BoardPropertyId | null, at: { x: number; y: number } | DOMRect): void {
    const labels = this.labels;
    const rtl = this.language === 'fa';
    const sections: MenuSection[] = [];
    if (!id) {
      sections.push({ entries: this.sortEntries('title') });
      sections.push({ entries: [{ label: labels.properties, icon: 'sliders-horizontal', submenu: () => this.propertySections('tableColumns') }] });
    } else {
      const info = BOARD_PROPERTIES[id];
      const all = this.tableColumns();
      const shown = visibleColumns(all);
      const index = shown.findIndex((column) => column.id === id);
      if (info.sortKey) sections.push({ entries: this.sortEntries(info.sortKey) });
      sections.push({
        entries: [
          { label: labels.moveBefore, icon: rtl ? 'arrow-right' : 'arrow-left', disabled: index <= 0, onSelect: () => this.shiftColumn(id, -1) },
          {
            label: labels.moveAfter,
            icon: rtl ? 'arrow-left' : 'arrow-right',
            disabled: index >= shown.length - 1,
            onSelect: () => this.shiftColumn(id, 1),
          },
        ],
      });
      sections.push({
        entries: [
          {
            label: labels.resetWidth,
            icon: 'move-horizontal',
            disabled: all[all.findIndex((column) => column.id === id)]?.width === undefined,
            onSelect: () => this.saveColumns('tableColumns', setColumn(this.tableColumns(), id, { width: undefined })),
          },
          {
            label: labels.hideProperty,
            icon: 'eye-off',
            onSelect: () => this.saveColumns('tableColumns', setColumn(this.tableColumns(), id, { hidden: true })),
          },
        ],
      });
    }
    this.hold(true);
    openContextMenu({
      container: this.el,
      at,
      rtl,
      header: id ? labels.columns[id] : labels.columns.task,
      sections,
      onClose: () => this.hold(false),
    });
  }

  /**
   * Every property with a switch that shows or hides it, in the order it
   * shows; a grip beside each one drags it to another place.
   */
  private propertySections(key: 'tableColumns' | 'cardProperties'): MenuSection[] {
    const labels = this.labels;
    const read = () => (key === 'tableColumns' ? this.tableColumns() : this.cardProperties());
    const columns = read();
    return [
      {
        title: labels.propertiesIn[key],
        reorder: (from, before) => this.saveColumns(key, moveColumn(read(), columns[from].id, columns[before]?.id ?? null)),
        entries: columns.map((column) => ({
          label: labels.columns[column.id],
          icon: BOARD_PROPERTIES[column.id].icon,
          toggle: !column.hidden,
          keepOpen: true,
          onSelect: () => this.saveColumns(key, setColumn(read(), column.id, { hidden: !column.hidden })),
        })),
      },
      {
        entries: [
          {
            label: labels.resetColumns,
            icon: 'rotate-ccw',
            disabled: this.prefs[key] === undefined,
            keepOpen: true,
            onSelect: () => void this.updatePrefs({ [key]: undefined }, false),
          },
        ],
      },
    ];
  }

  /** The properties menu, under the table's + or the toolbar's Properties button. */
  private openPropertiesMenu(anchor: HTMLElement, key: 'tableColumns' | 'cardProperties'): void {
    this.hold(true);
    openContextMenu({
      container: this.el,
      at: anchor.getBoundingClientRect(),
      rtl: this.language === 'fa',
      header: this.labels.properties,
      sections: () => this.propertySections(key),
      onClose: () => this.hold(false),
    });
  }

  private renderGroupRow(body: HTMLElement, group: BoardGroup, groupBy: BoardGroupBy, span: string): void {
    const labels = this.labels;
    const collapsed = this.prefs.collapsedGroups.includes(group.id);
    const row = body.createEl('tr', { cls: 'taskpro-table__group' });
    row.toggleClass('is-collapsed', collapsed);
    const cell = row.createEl('td', { attr: { colspan: span } });
    const toggle = cell.createEl('button', { cls: 'taskpro-table__group-toggle' });
    toggle.type = 'button';
    toggle.setAttribute('aria-expanded', String(!collapsed));
    toggle.setAttribute('aria-label', collapsed ? labels.expand : labels.collapse);
    setIcon(toggle.createSpan({ cls: 'taskpro-table__caret' }), 'chevron-down');
    this.groupLabel(toggle, groupBy, group.value);
    toggle.createSpan({ cls: 'taskpro-table__group-count', text: String(group.tasks.length) });
    toggle.addEventListener('click', () => {
      const next = collapsed
        ? this.prefs.collapsedGroups.filter((id) => id !== group.id)
        : [...this.prefs.collapsedGroups, group.id];
      void this.updatePrefs({ collapsedGroups: next }, false);
    });
  }

  /** The chip or text that names a group, shared by table headers and board columns. */
  private groupLabel(parent: HTMLElement, groupBy: BoardGroupBy, value: string): void {
    const labels = this.labels;
    const muted = (text: string, icon: string) => {
      const chip = parent.createSpan({ cls: 'taskpro-chip taskpro-board__group-chip' });
      this.chipContent(chip, icon, text);
    };

    switch (groupBy) {
      case 'status': {
        const status = value as TaskStatus;
        const chip = parent.createSpan({ cls: 'taskpro-chip taskpro-interactive-badge taskpro-board__group-chip' });
        chip.dataset.status = status;
        this.chipContent(chip, STATUS_ICON_NAMES[status], STATUS_LABELS[this.language][status]);
        return;
      }
      case 'priority': {
        if (!value) return muted(labels.noPriority, 'minus');
        const priority = value as TaskPriority;
        const chip = parent.createSpan({ cls: 'taskpro-chip taskpro-priority-badge taskpro-board__group-chip' });
        chip.dataset.priority = priority;
        this.chipContent(chip, PRIORITY_ICON_NAMES[priority], PRIORITY_LABELS[this.language][priority]);
        return;
      }
      case 'tag': {
        if (!value) return muted(labels.noTag, 'minus');
        const tag = resolveTag(value, this.settings.tags);
        const chip = parent.createSpan({ cls: 'taskpro-chip taskpro-tag-chip taskpro-board__group-chip' });
        applyTagColor(chip, tag.color);
        if (tag.unknown) chip.addClass('is-unknown');
        this.chipContent(chip, null, tag.name);
        return;
      }
      case 'deadline': {
        const bucket = value as DeadlineBucket;
        if (bucket === 'none') return muted(labels.buckets.none, 'calendar-x');
        const chip = parent.createSpan({ cls: 'taskpro-chip taskpro-deadline-badge taskpro-board__group-chip' });
        chip.dataset.state = DEADLINE_BUCKET_STATE[bucket];
        this.chipContent(chip, CHIP_ICON_NAMES.deadline, labels.buckets[bucket]);
        return;
      }
      case 'note': {
        const name = parent.createSpan({ cls: 'taskpro-board__group-note' });
        name.title = value;
        setIcon(name.createSpan({ cls: 'taskpro-board__group-note-icon' }), 'file-text');
        name.createSpan({
          cls: 'taskpro-board__group-note-name',
          text: value.split('/').pop()!.replace(/\.md$/i, ''),
          attr: { dir: 'auto' },
        });
        const folder = this.folderHint(value);
        if (folder) name.createSpan({ cls: 'taskpro-board__group-folder', text: folder, attr: { dir: 'auto' } });
        return;
      }
      default:
        return;
    }
  }

  /**
   * The folder a note group names beside the note: only the parent folder's
   * own name, and nothing at all when that is the scope's target folder. A
   * full path repeated on every group was most of what a column header said.
   * The full path is still the group's tooltip.
   */
  private folderHint(path: string): string {
    const folder = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
    if (!folder) return '';
    const target = this.settings.targetFolder.trim().replace(/^\/+|\/+$/g, '');
    if (target && folder.toLowerCase() === target.toLowerCase()) return '';
    return folder.split('/').pop() ?? '';
  }

  private renderRow(body: HTMLElement, task: BoardTask, columns: readonly BoardColumnPref[]): void {
    const labels = this.labels;
    const row = body.createEl('tr', { cls: 'taskpro-table__row' });
    row.dataset.status = task.status;
    row.dataset.taskId = task.id;

    this.checkButton(row.createEl('td', { cls: 'taskpro-table__check' }), task);

    const titleCell = row.createEl('td', { cls: 'taskpro-table__task' });
    this.titleBlock(titleCell, task, true, !columns.some((column) => column.id === 'repeat'), !columns.some((column) => column.id === 'waiting'));
    row.toggleClass('is-waiting', this.relations().isWaiting(task));

    for (const column of columns) this.renderCell(row, task, column.id);

    const moreCell = row.createEl('td', { cls: 'taskpro-table__more' });
    const more = this.iconButton(moreCell, 'more-horizontal', labels.more, () =>
      this.openTaskActions(task, more.getBoundingClientRect(), more)
    );
    this.withTaskActions(row, task);
  }

  private renderCell(row: HTMLElement, task: BoardTask, id: BoardPropertyId): void {
    const cell = row.createEl('td', { cls: `taskpro-table__${id}` });
    cell.dataset.column = id;
    switch (id) {
      case 'status':
        return this.statusChip(cell, task);
      case 'tags':
        cell.addClass('is-editable');
        this.tagChips(cell, task);
        cell.addEventListener('click', () => this.host.editTags(task));
        return;
      case 'priority':
        cell.addClass('is-editable');
        return this.priorityChip(cell, task);
      case 'deadline':
        cell.addClass('is-editable');
        return this.deadlineChip(cell, task);
      case 'plan':
        cell.toggleClass('is-editable', !!this.host.setSchedule);
        return this.planChip(cell, task, true);
      case 'repeat':
        cell.toggleClass('is-editable', !!this.host.setRepeat);
        return this.repeatChip(cell, task);
      case 'waiting':
        cell.toggleClass('is-editable', !!this.host.setWaiting);
        return this.waitingChips(cell, task);
      case 'progress':
        return this.progressBar(cell, task);
      case 'note':
        return this.noteLink(cell, task);
    }
  }

  // ── Cells, shared by rows and cards ──────────────────────────────────────

  private checkButton(parent: HTMLElement, task: BoardTask): void {
    const labels = this.labels;
    const done = task.status === '[x]';
    const button = parent.createEl('button', { cls: 'taskpro-board__check' });
    button.type = 'button';
    button.dataset.status = task.status;
    button.setAttribute('role', 'checkbox');
    button.setAttribute('aria-checked', task.status === '[/]' ? 'mixed' : String(done));
    button.setAttribute('aria-label', done ? labels.markOpen : labels.markDone);
    // No icon inside: the tick and the cross are CSS masks. A theme's rules
    // for icon buttons key on an <svg> in a <button> and would resize it.
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      void this.host.setStatus(task, done ? '[ ]' : '[x]');
    });
  }

  /** The title, editable in place; `withRepeat` marks a repeating task when no repeat column says so. */
  private titleBlock(parent: HTMLElement, task: BoardTask, withOpen = true, withRepeat = true, withWaiting = true): void {
    const labels = this.labels;
    const wrap = parent.createDiv({ cls: 'taskpro-board__title-wrap' });
    if (task.depth > 0) {
      wrap.style.setProperty('--taskpro-depth', String(Math.min(6, Math.round(task.depth / 2))));
      wrap.addClass('is-subtask');
    }
    const title = wrap.createSpan({ cls: 'taskpro-board__title', text: displayTitle(task.text) || '—' });
    title.setAttribute('dir', 'auto');
    title.setAttribute('role', 'button');
    title.tabIndex = 0;
    title.title = labels.editTitle;
    title.addEventListener('click', (event) => {
      event.stopPropagation();
      this.startTitleEdit(wrap, title, task);
    });
    title.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        this.startTitleEdit(wrap, title, task);
      }
    });

    const blocking = withWaiting ? this.relations().openBlockers(task) : [];
    if (blocking.length) {
      const mark = wrap.createSpan({ cls: 'taskpro-board__waiting' });
      setIcon(mark, 'hourglass');
      const text = `${this.labels.columns.waiting}: ${blocking.map((blocker) => displayTitle(blocker.text)).join(this.language === 'fa' ? '، ' : ', ')}`;
      mark.setAttribute('aria-label', text);
      mark.title = text;
    }

    if (task.repeat && withRepeat) {
      const repeat = wrap.createSpan({ cls: 'taskpro-board__repeat' });
      setIcon(repeat, 'repeat');
      const text = getRepeatLabels(this.language).chip(task.repeat);
      repeat.setAttribute('aria-label', text);
      repeat.title = text;
    }

    // A card already opens its note from the note link in its footer.
    if (!withOpen) return;
    const open = this.iconButton(wrap, 'arrow-up-right', labels.openNote, (event) => {
      event.stopPropagation();
      void this.host.reveal(task);
    });
    open.addClass('taskpro-board__open');
  }

  private startTitleEdit(wrap: HTMLElement, title: HTMLElement, task: BoardTask): void {
    if (this.editing) return;
    this.editing = true;
    const input = createEl('input', { type: 'text', cls: 'taskpro-board__title-input' });
    input.value = task.text;
    input.setAttribute('dir', 'auto');
    title.replaceWith(input);
    input.focus();
    input.select();

    let done = false;
    const finish = async (save: boolean) => {
      if (done) return;
      done = true;
      const value = input.value.trim();
      if (save && value && value !== task.text) {
        title.setText(displayTitle(value));
        input.replaceWith(title);
        this.editing = false;
        await this.host.setText(task, value);
      } else {
        input.replaceWith(title);
        this.editing = false;
      }
      if (this.renderQueued) this.renderBody();
    };
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.isComposing) {
        event.preventDefault();
        void finish(true);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        void finish(false);
      }
    });
    input.addEventListener('blur', () => void finish(true));
  }

  private statusChip(parent: HTMLElement, task: BoardTask): void {
    const chip = buildChip('taskpro-interactive-badge', STATUS_ICON_NAMES[task.status], STATUS_LABELS[this.language][task.status]);
    chip.dataset.status = task.status;
    chip.setAttribute('role', 'button');
    chip.tabIndex = 0;
    parent.appendChild(chip);
    chip.addEventListener('click', (event) => {
      event.stopPropagation();
      this.dropdown(chip, statusSections(this.actionOptions(task, chip)));
    });
  }

  private tagChips(parent: HTMLElement, task: BoardTask): void {
    const wrap = parent.createDiv({ cls: 'taskpro-board__tags' });
    if (!task.tags.length) {
      setIcon(wrap.createSpan({ cls: 'taskpro-board__placeholder' }), 'plus');
      return;
    }
    for (const key of task.tags) {
      const tag = resolveTag(key, this.settings.tags);
      const chip = wrap.createSpan({ cls: 'taskpro-chip taskpro-tag-chip' });
      applyTagColor(chip, tag.color);
      if (tag.unknown) chip.addClass('is-unknown');
      chip.createSpan({ cls: 'taskpro-chip__label', text: tag.name });
    }
  }

  private priorityChip(parent: HTMLElement, task: BoardTask): void {
    if (task.priority) {
      const chip = buildChip(
        'taskpro-priority-badge',
        PRIORITY_ICON_NAMES[task.priority],
        PRIORITY_LABELS[this.language][task.priority]
      );
      chip.dataset.priority = task.priority;
      parent.appendChild(chip);
    } else {
      setIcon(parent.createSpan({ cls: 'taskpro-board__placeholder' }), 'plus');
    }
    parent.addEventListener('click', (event) => {
      event.stopPropagation();
      this.dropdown(parent, prioritySections(this.actionOptions(task, parent)));
    });
  }

  private formatDate(iso: string): string {
    if (this.settings.calendarSystem !== 'jalali') return iso;
    const [y, m, d] = iso.split('-').map(Number);
    if (!y || !m || !d) return iso;
    const [jy, jm, jd] = gregorianToJalali(y, m, d);
    return `${jy}/${String(jm).padStart(2, '0')}/${String(jd).padStart(2, '0')}`;
  }

  private deadlineChip(parent: HTMLElement, task: BoardTask): void {
    if (task.deadline) {
      const labels = this.labels;
      const info = getDeadlineInfo(task.deadline, this.language, task.status);
      const date = this.formatDate(task.deadline);
      // The note chips say "Not completed on time" in full; a cell has room
      // for a word. A past deadline on a finished task is just its date.
      const text = info.state === 'missed' ? labels.buckets.overdue : info.state === 'completed' ? date : info.text;
      const wrap = parent.createDiv({ cls: 'taskpro-board__deadline' });
      const chip = buildChip('taskpro-deadline-badge', CHIP_ICON_NAMES.deadline, text);
      chip.dataset.state = info.state;
      chip.title = `${info.text} · ${date}`;
      wrap.appendChild(chip);
      if (info.state !== 'completed') {
        wrap.createSpan({ cls: 'taskpro-board__date', text: date, attr: { dir: 'ltr' } });
      }
    } else {
      setIcon(parent.createSpan({ cls: 'taskpro-board__placeholder' }), 'plus');
    }
    parent.addEventListener('click', (event) => {
      event.stopPropagation();
      this.dropdown(parent, deadlineSections(this.actionOptions(task, parent)));
    });
  }

  /**
   * When the task is planned. A card says it the way the chip in a note
   * does ("Today, 09:00 – 10:30"); a table cell puts the day in the chip and
   * the hours beside it, so a narrow column still shows from when to when.
   */
  private planChip(parent: HTMLElement, task: BoardTask, split = false): void {
    const schedule = task.schedule;
    if (schedule) {
      const options = {
        language: this.language,
        calendarSystem: this.prefs.calendarSystem ?? this.settings.calendarSystem,
        timeFormat: this.settings.calendar.timeFormat,
      };
      const full = scheduleText(schedule, options);
      const time = scheduleTimeText(schedule, options);
      const wrap = split ? parent.createDiv({ cls: 'taskpro-board__plan' }) : parent;
      const chip = buildChip(
        'taskpro-schedule-badge',
        schedule.start ? CHIP_ICON_NAMES.schedule : CHIP_ICON_NAMES.scheduleDay,
        split ? scheduleDayText(schedule.date, options) : full
      );
      if (task.status !== '[x]' && isSchedulePast(schedule)) chip.dataset.state = 'past';
      chip.title = full;
      wrap.appendChild(chip);
      if (split && time) wrap.createSpan({ cls: 'taskpro-board__time', text: time });
    } else {
      setIcon(parent.createSpan({ cls: 'taskpro-board__placeholder' }), 'plus');
    }
    if (!this.host.setSchedule) return;
    parent.addEventListener('click', (event) => {
      event.stopPropagation();
      this.dropdown(parent, planSections(this.actionOptions(task, parent)));
    });
  }

  private repeatChip(parent: HTMLElement, task: BoardTask): void {
    if (task.repeat) {
      const text = getRepeatLabels(this.language).chip(task.repeat);
      parent.appendChild(buildChip('taskpro-repeat-badge', CHIP_ICON_NAMES.repeat, text));
    } else {
      setIcon(parent.createSpan({ cls: 'taskpro-board__placeholder' }), 'plus');
    }
    if (!this.host.setRepeat) return;
    parent.addEventListener('click', (event) => {
      event.stopPropagation();
      this.dropdown(parent, repeatSections(this.actionOptions(task, parent)));
    });
  }

  private progressBar(parent: HTMLElement, task: BoardTask): void {
    const progress = this.host.getProgress(task);
    if (!progress?.enabled) {
      const count = this.subtaskProgress(task);
      if (count) this.subtaskBar(parent, count);
      return;
    }
    const percent = Math.round((progress.currentSteps / progress.totalSteps) * 100);
    const button = parent.createEl('button', { cls: 'taskpro-board__progress' });
    button.type = 'button';
    button.setAttribute('aria-label', `${progress.currentSteps}/${progress.totalSteps}`);
    const bar = button.createSpan({ cls: 'taskpro-board__progress-bar' });
    bar.createSpan({ cls: 'taskpro-board__progress-fill' }).style.setProperty('--taskpro-progress', `${percent}%`);
    button.createSpan({ cls: 'taskpro-board__progress-text', text: `${percent}%` });
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      this.host.editProgress(task, button);
    });
  }

  /** A parent's subtasks as a bar that fills as they are ticked off, and "2/4" beside it. */
  private subtaskBar(parent: HTMLElement, count: SubtaskCount): void {
    const text = getActionLabels(this.language).fromSubtasks(count.done, count.total);
    const wrap = parent.createDiv({ cls: 'taskpro-board__progress is-subtasks' });
    wrap.setAttribute('role', 'img');
    wrap.setAttribute('aria-label', text);
    wrap.title = text;
    setIcon(wrap.createSpan({ cls: 'taskpro-board__progress-icon' }), 'list-checks');
    const bar = wrap.createSpan({ cls: 'taskpro-board__progress-bar' });
    bar.createSpan({ cls: 'taskpro-board__progress-fill' }).style.setProperty('--taskpro-progress', `${Math.round((count.done / count.total) * 100)}%`);
    wrap.createSpan({ cls: 'taskpro-board__progress-text', text: `${count.done}/${count.total}` });
    wrap.toggleClass('is-complete', count.done === count.total);
  }

  /** What a task waits on: a chip for each (two at most, then a count), or a + to add one. */
  private waitingChips(parent: HTMLElement, task: BoardTask): void {
    const labels = this.labels;
    const actionLabels = getActionLabels(this.language);
    const blockers = this.relations().blockersOf(task);
    if (!blockers.length) {
      setIcon(parent.createSpan({ cls: 'taskpro-board__placeholder' }), 'plus');
    } else {
      const wrap = parent.createDiv({ cls: 'taskpro-board__waiting-list' });
      for (const blocker of blockers.slice(0, 2)) {
        const done = !blocker.task || blocker.task.status === '[x]';
        const name = blocker.task ? displayTitle(blocker.task.text) || '—' : actionLabels.missingTask;
        const chip = buildChip('taskpro-waiting-badge', done ? 'check-check' : 'hourglass', name);
        chip.dataset.state = done ? 'done' : 'waiting';
        chip.querySelector('.taskpro-chip__label')?.setAttribute('dir', 'auto');
        chip.title = `${labels.columns.waiting}: ${name}${blocker.task ? ` · ${blocker.task.fileName}` : ''}`;
        wrap.appendChild(chip);
      }
      if (blockers.length > 2) wrap.createSpan({ cls: 'taskpro-board__more-count', text: `+${blockers.length - 2}` });
    }
    if (!this.host.setWaiting) return;
    parent.addEventListener('click', (event) => {
      event.stopPropagation();
      this.dropdown(parent, waitingSections(this.actionOptions(task, parent)));
    });
  }

  private noteLink(parent: HTMLElement, task: BoardTask): void {
    const link = parent.createEl('button', { cls: 'taskpro-board__note' });
    link.type = 'button';
    link.title = task.filePath;
    setIcon(link.createSpan({ cls: 'taskpro-board__note-icon' }), 'file-text');
    // dir=auto: a name like "1405-W27" must not be reordered by an RTL board.
    link.createSpan({ cls: 'taskpro-board__note-name', text: task.fileName, attr: { dir: 'auto' } });
    link.addEventListener('click', (event) => {
      event.stopPropagation();
      void this.host.reveal(task);
    });
  }

  // ── Kanban ───────────────────────────────────────────────────────────────

  private canDropInto(groupBy: BoardGroupBy): boolean {
    return groupBy === 'status' || groupBy === 'priority' || groupBy === 'tag';
  }

  private renderKanban(tasks: BoardTask[], today: Date): void {
    const labels = this.labels;
    const groupBy = this.kanbanGrouping();
    const all = orderGroups(
      this.kanbanColumns(groupTasks(tasks, groupBy, { tags: this.settings.tags, today }), groupBy),
      this.prefs.groupOrder?.[groupBy]
    );
    const hidden = new Set(this.prefs.hiddenGroups ?? []);
    const groups = all.filter((group) => !hidden.has(group.id));

    const board = this.bodyEl.createDiv({ cls: 'taskpro-kanban' });
    if (this.prefs.kanbanColumnWidth) board.style.setProperty('--taskpro-kanban-width', `${clampKanbanWidth(this.prefs.kanbanColumnWidth)}px`);
    const droppable = this.canDropInto(groupBy);

    for (const group of groups) {
      const column = board.createDiv({ cls: 'taskpro-kanban__column' });
      column.dataset.group = group.value;
      const accent = this.columnAccent(groupBy, group.value);
      if (accent) column.style.setProperty('--taskpro-column-accent', accent);
      const header = column.createDiv({ cls: 'taskpro-kanban__header' });
      this.groupLabel(header, groupBy, group.value);
      header.createSpan({ cls: 'taskpro-kanban__count', text: String(group.tasks.length) });
      const menu = this.iconButton(header, 'more-horizontal', labels.columnMenu, () =>
        this.openKanbanColumnMenu(group, groupBy, all, menu.getBoundingClientRect())
      );
      menu.addClass('taskpro-kanban__menu');
      header.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.openKanbanColumnMenu(group, groupBy, all, { x: event.clientX, y: event.clientY });
      });
      this.kanbanColumnDrag(header, column, board, (before) =>
        this.moveKanbanColumn(all, groupBy, group.value, before)
      );
      const handle = column.createDiv({ cls: 'taskpro-kanban__resize' });
      handle.setAttribute('aria-hidden', 'true');
      this.kanbanResize(handle, board, column);

      const cards = column.createDiv({ cls: 'taskpro-kanban__cards' });
      const limit = this.rowLimits.get(group.id) ?? ROWS_PER_PAGE;
      for (const task of group.tasks.slice(0, limit)) this.renderCard(cards, task, group.value, droppable);
      if (group.tasks.length > limit) {
        const more = cards.createEl('button', {
          cls: 'taskpro-kanban__more',
          text: labels.showMore(Math.min(ROWS_PER_PAGE, group.tasks.length - limit)),
        });
        more.addEventListener('click', () => {
          this.rowLimits.set(group.id, limit + ROWS_PER_PAGE);
          this.renderBody();
        });
      }

      if (groupBy !== 'deadline' && groupBy !== 'note') this.renderColumnAdd(column, groupBy, group.value);

      if (droppable) {
        column.addEventListener('dragover', (event) => {
          if (!this.draggedTaskId) return;
          event.preventDefault();
          if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
          column.addClass('is-drop-target');
        });
        column.addEventListener('dragleave', (event) => {
          if (!column.contains(event.relatedTarget as Node)) column.removeClass('is-drop-target');
        });
        column.addEventListener('drop', (event) => {
          event.preventDefault();
          column.removeClass('is-drop-target');
          const task = this.visible.find((t) => t.id === this.draggedTaskId);
          const from = this.draggedFrom;
          this.draggedTaskId = null;
          this.draggedFrom = null;
          if (task && from !== null && from !== group.value) void this.moveTask(task, groupBy, from, group.value);
        });
      }
    }

    const aside = all.filter((group) => hidden.has(group.id));
    if (aside.length || groupBy === 'tag') {
      const end = board.createDiv({ cls: 'taskpro-kanban__aside' });
      if (groupBy === 'tag') {
        const add = end.createEl('button', { cls: 'taskpro-kanban__new-column' });
        add.type = 'button';
        setIcon(add.createSpan({ cls: 'taskpro-kanban__add-icon' }), 'plus');
        add.createSpan({ text: labels.newTagColumn });
        add.addEventListener('click', () => this.host.manageTags());
      }
      if (aside.length) this.renderHiddenColumns(end, aside, groupBy);
    }
  }

  /** The columns taken off the board, listed at its end; a click puts one back. */
  private renderHiddenColumns(parent: HTMLElement, groups: BoardGroup[], groupBy: BoardGroupBy): void {
    const labels = this.labels;
    const list = parent.createDiv({ cls: 'taskpro-kanban__hidden' });
    const head = list.createDiv({ cls: 'taskpro-kanban__hidden-head' });
    setIcon(head.createSpan({ cls: 'taskpro-kanban__hidden-icon' }), 'eye-off');
    head.createSpan({ text: labels.hiddenColumns(groups.length) });
    for (const group of groups) {
      const item = list.createEl('button', { cls: 'taskpro-kanban__hidden-item' });
      item.type = 'button';
      item.dataset.group = group.value;
      item.setAttribute('aria-label', labels.showColumn);
      item.title = labels.showColumn;
      this.groupLabel(item, groupBy, group.value);
      item.createSpan({ cls: 'taskpro-kanban__count', text: String(group.tasks.length) });
      setIcon(item.createSpan({ cls: 'taskpro-kanban__hidden-show' }), 'eye');
      item.addEventListener('click', () => this.setGroupHidden([group.id], false));
    }
    if (groups.length > 1) {
      const all = list.createEl('button', { cls: 'taskpro-kanban__hidden-all', text: labels.showAllColumns });
      all.type = 'button';
      all.addEventListener('click', () => this.setGroupHidden(groups.map((group) => group.id), false));
    }
  }

  private setGroupHidden(ids: string[], hidden: boolean): void {
    const list = (this.prefs.hiddenGroups ?? []).filter((id) => !ids.includes(id));
    if (hidden) list.push(...ids);
    void this.updatePrefs({ hiddenGroups: list.length ? list : undefined }, false);
  }

  private moveKanbanColumn(all: BoardGroup[], groupBy: BoardGroupBy, value: string, before: string | null): void {
    const order = moveValue(all.map((group) => group.value), value, before);
    void this.updatePrefs({ groupOrder: { ...this.prefs.groupOrder, [groupBy]: order } }, false);
  }

  private openKanbanColumnMenu(group: BoardGroup, groupBy: BoardGroupBy, all: BoardGroup[], at: { x: number; y: number } | DOMRect): void {
    const labels = this.labels;
    const rtl = this.language === 'fa';
    const hidden = new Set(this.prefs.hiddenGroups ?? []);
    const shown = all.filter((g) => !hidden.has(g.id));
    const index = shown.findIndex((g) => g.id === group.id);
    const sections: MenuSection[] = [
      {
        entries: [
          {
            label: labels.moveBefore,
            icon: rtl ? 'arrow-right' : 'arrow-left',
            disabled: index <= 0,
            onSelect: () => this.moveKanbanColumn(all, groupBy, group.value, shown[index - 1].value),
          },
          {
            label: labels.moveAfter,
            icon: rtl ? 'arrow-left' : 'arrow-right',
            disabled: index >= shown.length - 1,
            onSelect: () => this.moveKanbanColumn(all, groupBy, group.value, shown[index + 2]?.value ?? null),
          },
          { label: labels.hideColumn, icon: 'eye-off', onSelect: () => this.setGroupHidden([group.id], true) },
        ],
      },
      {
        entries: [
          {
            label: labels.resetColumnWidth,
            icon: 'move-horizontal',
            disabled: this.prefs.kanbanColumnWidth === undefined,
            onSelect: () => void this.updatePrefs({ kanbanColumnWidth: undefined }, false),
          },
          {
            label: labels.resetOrder,
            icon: 'rotate-ccw',
            disabled: !this.prefs.groupOrder?.[groupBy]?.length,
            onSelect: () => {
              const next = { ...this.prefs.groupOrder };
              delete next[groupBy];
              void this.updatePrefs({ groupOrder: next }, false);
            },
          },
        ],
      },
      { entries: [{ label: labels.properties, icon: 'sliders-horizontal', submenu: () => this.propertySections('cardProperties') }] },
    ];
    this.hold(true);
    openContextMenu({ container: this.el, at, rtl, header: labels.columnMenu, sections, onClose: () => this.hold(false) });
  }

  /** Dragging a column by its header moves it; a line between columns shows where it will go. */
  private kanbanColumnDrag(header: HTMLElement, column: HTMLElement, board: HTMLElement, drop: (before: string | null) => void): void {
    header.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || (event.target as HTMLElement).closest('button, input')) return;
      const doc = this.el.ownerDocument;
      const rtl = this.language === 'fa';
      const startX = event.clientX;
      const startY = event.clientY;
      let dragging = false;
      let before: string | null = null;
      let changes = false;
      let line: HTMLElement | null = null;
      const columns = () => Array.from(board.querySelectorAll<HTMLElement>(':scope > .taskpro-kanban__column'));

      const onMove = (e: PointerEvent) => {
        if (!dragging) {
          if (Math.abs(e.clientX - startX) < 5 && Math.abs(e.clientY - startY) < 5) return;
          dragging = true;
          this.hold(true);
          column.addClass('is-moving');
          board.addClass('is-moving-column');
          line = this.el.createDiv({ cls: 'taskpro-kanban__drop' });
        }
        const box = this.el.getBoundingClientRect();
        const view = this.bodyEl.getBoundingClientRect();
        if (e.clientX < view.left + 48) this.bodyEl.scrollLeft -= 16;
        else if (e.clientX > view.right - 48) this.bodyEl.scrollLeft += 16;

        const list = columns();
        const target = list.find((el) => {
          const r = el.getBoundingClientRect();
          const mid = (r.left + r.right) / 2;
          return rtl ? e.clientX > mid : e.clientX < mid;
        });
        before = target?.dataset.group ?? null;
        const at = list.indexOf(column);
        const next = list[at + 1];
        changes = target !== column && (next ? target !== next : target !== undefined);

        const gap = parseFloat(getComputedStyle(board).columnGap) || 12;
        const edge = (target ?? list[list.length - 1]).getBoundingClientRect();
        const x = target ? (rtl ? edge.right + gap / 2 : edge.left - gap / 2) : rtl ? edge.left - gap / 2 : edge.right + gap / 2;
        const rect = board.getBoundingClientRect();
        const top = Math.max(rect.top, view.top);
        const bottom = Math.min(Math.max(...list.map((el) => el.getBoundingClientRect().bottom)), view.bottom);
        line!.toggleClass('is-idle', !changes);
        line!.style.left = `${Math.round(x - box.left - 1)}px`;
        line!.style.top = `${Math.round(top - box.top)}px`;
        line!.style.height = `${Math.max(0, Math.round(bottom - top))}px`;
      };
      const finish = (ok: boolean) => {
        doc.removeEventListener('pointermove', onMove, true);
        doc.removeEventListener('pointerup', onUp, true);
        doc.removeEventListener('pointercancel', onCancel, true);
        doc.removeEventListener('keydown', onKey, true);
        if (!dragging) return;
        line?.remove();
        column.removeClass('is-moving');
        board.removeClass('is-moving-column');
        if (ok && changes) drop(before);
        this.hold(false);
      };
      const onUp = () => finish(true);
      const onCancel = () => finish(false);
      const onKey = (e: KeyboardEvent) => {
        if (e.key !== 'Escape') return;
        e.preventDefault();
        e.stopPropagation();
        finish(false);
      };
      doc.addEventListener('pointermove', onMove, true);
      doc.addEventListener('pointerup', onUp, true);
      doc.addEventListener('pointercancel', onCancel, true);
      doc.addEventListener('keydown', onKey, true);
    });
  }

  /** Every column is as wide as the others; dragging one's edge resizes them all, a double click resets them. */
  private kanbanResize(handle: HTMLElement, board: HTMLElement, column: HTMLElement): void {
    handle.addEventListener('dblclick', (event) => {
      event.stopPropagation();
      if (this.prefs.kanbanColumnWidth !== undefined) void this.updatePrefs({ kanbanColumnWidth: undefined }, false);
    });
    handle.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      const doc = this.el.ownerDocument;
      const sign = this.language === 'fa' ? -1 : 1;
      const startX = event.clientX;
      const start = Math.round(column.getBoundingClientRect().width);
      let width = start;
      this.hold(true);
      this.el.addClass('is-resizing-column');
      handle.addClass('is-active');
      const onMove = (e: PointerEvent) => {
        width = clampKanbanWidth(start + (e.clientX - startX) * sign);
        board.style.setProperty('--taskpro-kanban-width', `${width}px`);
      };
      const onUp = () => {
        doc.removeEventListener('pointermove', onMove, true);
        doc.removeEventListener('pointerup', onUp, true);
        doc.removeEventListener('pointercancel', onUp, true);
        this.el.removeClass('is-resizing-column');
        handle.removeClass('is-active');
        if (width !== start) void this.updatePrefs({ kanbanColumnWidth: width === KANBAN_WIDTH.initial ? undefined : width }, false);
        this.hold(false);
      };
      doc.addEventListener('pointermove', onMove, true);
      doc.addEventListener('pointerup', onUp, true);
      doc.addEventListener('pointercancel', onUp, true);
    });
  }

  /** A faint tint that ties a column to its chip colour. */
  private columnAccent(groupBy: BoardGroupBy, value: string): string | null {
    if (groupBy === 'status') return STATUS_ACCENT[value as TaskStatus] ?? null;
    if (groupBy === 'priority') return value ? PRIORITY_ACCENT[value as TaskPriority] : null;
    if (groupBy === 'tag') return value ? resolveTagColor(resolveTag(value, this.settings.tags).color) : null;
    return null;
  }

  /**
   * A drop target has to exist to be dropped on, so the board keeps a column
   * for every priority and every defined tag even while it is empty.
   */
  private kanbanColumns(groups: BoardGroup[], groupBy: BoardGroupBy): BoardGroup[] {
    const byValue = new Map(groups.map((group) => [group.value, group]));
    const column = (value: string): BoardGroup =>
      byValue.get(value) ?? { id: `${groupBy}:${value}`, value, tasks: [] };

    if (groupBy === 'priority') return [...TASK_PRIORITIES, ''].map(column);
    if (groupBy === 'tag') {
      const known = this.settings.tags.map((tag) => tag.key);
      const unknown = groups.filter((group) => group.value && !known.includes(group.value));
      return [...known.map(column), ...unknown, column('')];
    }
    return groups;
  }

  /** Dropping a card on another column changes the property the columns stand for. */
  private async moveTask(task: BoardTask, groupBy: BoardGroupBy, from: string, to: string): Promise<void> {
    if (groupBy === 'status') {
      await this.host.setStatus(task, to as TaskStatus);
    } else if (groupBy === 'priority') {
      await this.host.setPriority(task, (to || null) as TaskPriority | null);
    } else if (groupBy === 'tag') {
      // Moving between tag columns swaps one tag for the other and keeps the rest.
      const keys = extractTags(task.line).filter((key) => key !== from);
      if (to && !keys.includes(to)) keys.push(to);
      await this.host.setTags(task, to ? keys : []);
    }
  }

  private renderColumnAdd(column: HTMLElement, groupBy: BoardGroupBy, value: string): void {
    const labels = this.labels;
    const button = column.createEl('button', { cls: 'taskpro-kanban__add' });
    button.type = 'button';
    setIcon(button.createSpan({ cls: 'taskpro-kanban__add-icon' }), 'plus');
    button.createSpan({ text: labels.newInColumn });
    button.addEventListener('click', () => {
      const input = createEl('input', {
        type: 'text',
        cls: 'taskpro-kanban__add-input',
        attr: { placeholder: labels.addPlaceholder, dir: 'auto' },
      });
      button.replaceWith(input);
      this.editing = true;
      input.focus();
      const inherit =
        groupBy === 'status'
          ? { status: value as TaskStatus }
          : groupBy === 'priority'
            ? { priority: (value || undefined) as TaskPriority | undefined }
            : groupBy === 'tag'
              ? { tags: value ? [value] : [] }
              : {};
      const close = () => {
        input.replaceWith(button);
        this.editing = false;
        if (this.renderQueued) this.renderBody();
      };
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && !event.isComposing) {
          event.preventDefault();
          const text = input.value.trim();
          if (!text) return close();
          void this.addTask(text, inherit).then((added) => {
            if (added) input.value = '';
          });
        } else if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          close();
        }
      });
      input.addEventListener('blur', () => {
        if (!input.value.trim()) close();
      });
    });
  }

  private renderCard(parent: HTMLElement, task: BoardTask, groupValue: string, draggable: boolean): void {
    const labels = this.labels;
    const card = parent.createDiv({ cls: 'taskpro-card' });
    card.dataset.status = task.status;
    card.dataset.taskId = task.id;

    if (draggable) {
      card.draggable = true;
      card.addEventListener('dragstart', (event) => {
        this.draggedTaskId = task.id;
        this.draggedFrom = groupValue;
        card.addClass('is-dragging');
        event.dataTransfer?.setData('text/plain', task.text);
        if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
      });
      card.addEventListener('dragend', () => {
        card.removeClass('is-dragging');
        this.draggedTaskId = null;
        this.draggedFrom = null;
        this.bodyEl.querySelectorAll('.is-drop-target').forEach((el) => el.removeClass('is-drop-target'));
      });
    }

    const shown = visibleColumns(this.cardProperties());
    const top = card.createDiv({ cls: 'taskpro-card__top' });
    this.checkButton(top, task);
    this.titleBlock(top, task, false, !shown.some((column) => column.id === 'repeat'), !shown.some((column) => column.id === 'waiting'));
    card.toggleClass('is-waiting', this.relations().isWaiting(task));
    const more = this.iconButton(top, 'more-horizontal', labels.more, () =>
      this.openTaskActions(task, more.getBoundingClientRect(), more)
    );
    more.addClass('taskpro-card__more');
    this.withTaskActions(card, task);

    const props = card.createDiv({ cls: 'taskpro-card__props' });
    let withNote = false;
    for (const { id } of shown) {
      switch (id) {
        case 'status':
          this.statusChip(props.createDiv({ cls: 'is-editable' }), task);
          break;
        case 'tags':
          if (task.tags.length) {
            const tags = props.createDiv({ cls: 'is-editable taskpro-card__tags' });
            this.tagChips(tags, task);
            tags.addEventListener('click', () => this.host.editTags(task));
          }
          break;
        case 'priority':
          if (task.priority) this.priorityChip(props.createDiv({ cls: 'is-editable' }), task);
          break;
        case 'deadline':
          if (task.deadline) this.deadlineChip(props.createDiv({ cls: 'is-editable' }), task);
          break;
        case 'plan':
          if (task.schedule) this.planChip(props.createDiv({ cls: 'is-editable' }), task);
          break;
        case 'repeat':
          if (task.repeat) this.repeatChip(props.createDiv({ cls: 'is-editable' }), task);
          break;
        case 'waiting':
          if (task.waiting?.length) this.waitingChips(props.createDiv({ cls: 'is-editable taskpro-card__waiting' }), task);
          break;
        case 'progress':
          this.progressBar(props, task);
          break;
        case 'note':
          withNote = true;
          break;
      }
    }
    if (!props.childElementCount) props.remove();

    if (withNote) this.noteLink(card.createDiv({ cls: 'taskpro-card__foot' }), task);
  }
}
