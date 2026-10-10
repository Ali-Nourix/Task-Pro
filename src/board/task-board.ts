// ── board/task-board.ts ───────────────────────────────────────────────────
// The all-tasks board: every task in the vault (or only the target folder)
// in one place, as a table or as a kanban board, and editable in place.
//
// This file only builds DOM and talks to a `TaskBoardHost`. Reading and
// writing notes lives in the plugin, so the board can be rendered against a
// stub host in the preview harness and behaves the same inside Obsidian.
// ─────────────────────────────────────────────────────────────────────────────

import { App, Menu, Platform, setIcon } from 'obsidian';
import {
  BoardDensity,
  BoardGroupBy,
  BoardPreferences,
  BoardPriorityFilter,
  BoardSortKey,
  CalendarSettings,
  CalendarSystem,
  CHIP_ICON_NAMES,
  DEFAULT_BOARD_PREFERENCES,
  Language,
  SavedView,
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
import { RemindAt, extractTags, normalizeTagKey, setDeadline, setPriority, setRemind, setSchedule, setTags } from '../task-metadata';
import { isWithinTargetFolder } from '../path-utils';
import { gregorianToJalali } from '../date-utils';
import { getDeadlineInfo } from '../widget-localization';
import { getRepeatLabels } from '../timer-localization';
import { buildChip } from '../ui/chips';
import {
  BOARD_STATUS_ORDER,
  BoardGroup,
  DEADLINE_BUCKET_ORDER,
  DeadlineBucket,
  filterTasks,
  groupTasks,
  sortTasks,
  summarize,
} from './board-query';
import { BoardLabels, getBoardLabels } from './board-localization';
import { CursorAt, moveCursor, moveFor } from './board-keys';
import { Nesting, foldKey, hiddenByFold, nestTasks } from './board-nesting';
import { BulkContext, renderBulkBar } from './bulk-actions';
import { openShortcuts } from './board-shortcuts';
import { newViewId, sameView, snapshotView, uniqueViewName, viewPatch } from './board-views';
import { addPanelButtonRow, addPanelField, openTaskProPanel } from '../ui/panel';
import { BoardTask, TaskStore } from './task-store';
import { TaskCalendar } from '../calendar/calendar-view';
import { openCalendarPopover } from '../calendar/calendar-popover';
import { autoDirection } from '../ui/fields';
import { ChangeTracker, enter, stagger, type Entrance } from '../ui/motion';
import { claimEscape } from '../ui/escape-scope';
import { swipeStrip } from '../ui/strip-swipe';
import { fingersDown, holdToDrag, onContextPress, readyToCarry, suppressGestureClick } from '../ui/touch';
import { TaskTimeline } from '../timeline/timeline-view';
import { getTimelineLabels } from '../timeline/timeline-localization';
import { getCalendarLabels } from '../calendar/calendar-localization';
import { ContextMenuOptions, MenuChip, MenuEntry, MenuSection, closeContextMenu, openContextMenu } from '../ui/context-menu';
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
import { addDays, resolveWeekStart, todayKey } from '../calendar/calendar-dates';
import { openDaySheet } from './day-sheet';
import { Parsed } from './quick-add';
import { announce } from '../ui/announce';
import { setBackButtonApp } from '../ui/back-button';
import { haptic } from '../ui/haptics';
import { showSnackbar } from '../ui/snackbar';
import { openQuickAddSheet } from './quick-add-sheet';

/** The preferences that change what the board shows, and so bring the new view in. */
const ENTERING_PREFS = new Set<string>([
  'layout',
  'groupBy',
  'scope',
  'sortKey',
  'sortDir',
  'statuses',
  'priorities',
  'tags',
  'calendarView',
  'calendarSystem',
  'calendarSidebar',
  'calendarShowDeadlines',
  'calendarShowDailyNotes',
  'calendarShowDone',
  'timelineZoom',
  'timelineUndated',
  'compactTable',
  'rowStyle',
  'deadlines',
  'plans',
  'notes',
]);
/** The ways to group tasks, in the order the menus list them. */
const GROUPINGS: readonly BoardGroupBy[] = ['none', 'status', 'tag', 'priority', 'deadline', 'plan', 'note'];
/**
 * How long a task that has just arrived stays marked, in milliseconds. It is
 * only the time a second drawing straight after the first can still find it;
 * the flash itself is CSS and runs its own course.
 */
const ARRIVAL_MS = 700;

/** Rows drawn per group before a "Show more" row; keeps a huge vault responsive. */
const ROWS_PER_PAGE = 150;

/** Narrower than this, the board is laid out for a phone: one bar, sheets, a list. */
const COMPACT_WIDTH = 640;

/** What a row of the nested table knows of its place: see nestTasks. */
type TableNest = Nesting & { folded: boolean };

/** The classes of a "+ New" button, its icon (none, when the row draws the plus itself) and the field it turns into. */
interface NewClasses {
  button: string;
  icon?: string;
  input: string;
}
const KANBAN_NEW: NewClasses = {
  button: 'taskpro-board__new taskpro-kanban__add',
  icon: 'taskpro-board__new-icon taskpro-kanban__add-icon',
  input: 'taskpro-board__new-input taskpro-kanban__add-input',
};
const TABLE_NEW: NewClasses = {
  button: 'taskpro-board__new is-row',
  input: 'taskpro-board__new-input is-row',
};
/** How far a row is swiped before letting go acts on it. */
const SWIPE_ACT = 76;

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
   * Deletes several tasks, each with everything nested under it, with one
   * notice that puts them all back. Resolves how many were deleted.
   */
  deleteTasks?(tasks: BoardTask[]): Promise<number>;
  /**
   * The link that points at a task, `[[Note#^id]]`. A task without a block ID
   * is given one, so the link has something to point at. Null when it cannot.
   */
  blockLink?(task: BoardTask): Promise<string | null>;
  /** Every note there is, for choosing where to move a task. Without it the choice is the notes that have tasks. */
  notes?(): Array<{ path: string; name: string }>;
  /**
   * Moves a task, with everything nested under it, to the end of another
   * note, taking what is kept about it (progress, timer, its link to a
   * source, the tasks waiting on it) along. Resolves whether it moved.
   */
  moveTask?(task: BoardTask, targetPath: string): Promise<boolean>;
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
  /**
   * The task's own reminder: minutes before its plan starts, a moment of its own,
   * `null` for none, `undefined` for the setting.
   */
  setRemind?(task: BoardTask, minutes: number | null | RemindAt | undefined): Promise<void>;
  /** Asks for a moment to be reminded at, and sets it. */
  editRemind?(task: BoardTask): Promise<void>;

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
  /** Every task by id, and how the tasks in the table nest: rebuilt with the body. */
  private taskIndex = new Map<string, BoardTask>();
  private nestings = new Map<string, Nesting>();
  /** The parent whose subtasks have just been shown again, and follow one another in. */
  private revealing: string | null = null;
  private relationIndex: RelationIndex | null = null;
  /** Laid out for a phone: narrow, whatever the device. */
  private compact = false;
  /** A touch screen: no hover, and a long press for the right click. */
  private readonly touch: boolean;
  private sizeObserver: ResizeObserver | null = null;
  private headObserver: ResizeObserver | null = null;
  /** The phone bar's search field, open. */
  private searchOpen = false;
  /** A sheet changed a preference the bar shows; the bar is drawn again when it closes. */
  private chromeDirty = false;
  /** Tells which tasks arrived, or changed status, since the board was last drawn. */
  private readonly tracker = new ChangeTracker();
  /** Those tasks, kept for a moment so a second drawing does not lose them. */
  private arrivals = { added: new Set<string>(), changed: new Set<string>(), until: 0 };
  /** What the next drawing of the body plays: a view coming in, or a page turning. */
  private pendingEntrance: Entrance | null = null;
  /** A group that has just been opened, whose rows follow one another in. */
  private expanding: string | null = null;
  /** The last drawing was the loading state, so the tasks coming in are an entrance. */
  private wasLoading = false;
  /** The toolbar's Views button, which says when the board has been changed since the view was applied. */
  private viewsButtonEl: HTMLButtonElement | null = null;
  /** The task the keyboard is on: its id, and where it is among the columns, for when the id is gone. */
  private cursor: { id: string; at: CursorAt } | null = null;
  /** The tasks picked for a bulk change: each id with the key that tells the task again once the notes have moved under it. */
  private readonly selected = new Map<string, string>();
  /** Where a range picked with Shift starts. */
  private selectAnchor: string | null = null;
  private selectionEl: HTMLElement | null = null;
  private releaseSelectionEscape: (() => void) | null = null;

  constructor(
    container: HTMLElement,
    private readonly host: TaskBoardHost,
    private readonly options: TaskBoardOptions = {}
  ) {
    this.el = container.createDiv({ cls: 'taskpro-board' });
    setBackButtonApp(host.app);
    this.el.toggleClass('is-floating', !!options.floating);
    const view = this.el.ownerDocument.defaultView ?? window;
    this.touch = !!Platform.isMobile || !!view.matchMedia?.('(pointer: coarse)').matches;
    this.el.toggleClass('is-touch', this.touch);
    this.el.addEventListener('keydown', (event) => this.onKeyDown(event));
  }

  async mount(): Promise<void> {
    // Before the first finger goes down: see readyToCarry.
    readyToCarry(this.el.ownerDocument);
    this.compact = this.measureCompact();
    this.el.toggleClass('is-compact', this.compact);
    this.observeSize();
    this.watchScroll();
    this.renderChrome();
    this.pendingEntrance = 'view';
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
    this.sizeObserver?.disconnect();
    this.sizeObserver = null;
    this.headObserver?.disconnect();
    this.headObserver = null;
    closeContextMenu();
  }

  /** A phone, or a board narrower than a phone's width of layout. */
  private measureCompact(): boolean {
    if (Platform.isPhone) return true;
    const width = this.el.clientWidth;
    return width > 0 ? width < COMPACT_WIDTH : this.compact;
  }

  /** Lays the board out again when it crosses the phone width, as a pane is resized or the board floats. */
  private observeSize(): void {
    const view = this.el.ownerDocument.defaultView ?? window;
    if (typeof view.ResizeObserver === 'undefined') return;
    this.sizeObserver = new view.ResizeObserver(() => {
      const compact = this.measureCompact();
      if (compact === this.compact) return;
      this.compact = compact;
      this.el.toggleClass('is-compact', compact);
      closeContextMenu();
      this.renderChrome();
      this.renderBody();
    });
    this.sizeObserver.observe(this.el);
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

  /** The interface's direction: where an empty field's placeholder starts. */
  private get direction(): 'ltr' | 'rtl' {
    return this.language === 'fa' ? 'rtl' : 'ltr';
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
      enter: (kind) => this.enterNext(kind),
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
      updatePrefs: (patch, rebuildChrome) => this.updatePrefs(patch, rebuildChrome),
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
      enter: (kind) => this.enterNext(kind),
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
      ...(this.compact ? this.sheetExtras(task) : {}),
      // The calendar brings its own first row; everywhere else it is the card.
      sections: taskActionSections({ ...this.actionOptions(task, anchor), lead: lead ?? (this.isCalendar ? undefined : [this.openCardEntry(task, anchor)]) }),
      onClose: () => this.hold(false),
    });
  }

  /**
   * What a task's sheet puts first on a phone: the days a task is most often
   * moved to, one tap each, and the one thing it is most often opened for, as
   * a large button at its foot: Done, or Not started again.
   */
  private sheetExtras(task: BoardTask): Pick<ContextMenuOptions, 'chips' | 'chipsLabel' | 'footer'> {
    const labels = getActionLabels(this.language);
    const host = this.host;
    const system = this.prefs.calendarSystem ?? this.settings.calendarSystem;
    const planned = !!host.setSchedule;
    const setDay = (day: string) => {
      // A timed plan moved to another day keeps its time.
      if (planned) void host.setSchedule!(task, task.schedule ? { ...task.schedule, date: day } : { date: day });
      else void host.setDeadline?.(task, day);
    };
    const current = planned ? task.schedule?.date : task.deadline;
    const today = todayKey();
    const days: Array<[string, string]> = [
      [labels.today, today],
      [labels.tomorrow, addDays(today, 1)],
      [labels.nextWeek, addDays(today, 7)],
    ];
    const chips: MenuChip[] = days.map(([label, day]) => ({ label, icon: 'calendar', checked: current === day, onSelect: () => (current === day ? undefined : setDay(day)) }));
    chips.push({
      label: labels.pickDate,
      icon: 'calendar-search',
      onSelect: () =>
        openDaySheet({
          container: this.el,
          anchor: this.el.getBoundingClientRect(),
          language: this.language,
          system,
          weekStartsOn: resolveWeekStart(this.settings.calendar.weekStart, system),
          title: planned ? labels.plan : labels.deadline,
          closeLabel: this.labels.qaClose,
          previousLabel: this.labels.qaPrevMonth,
          nextLabel: this.labels.qaNextMonth,
          selected: current ?? null,
          onPick: setDay,
          hold: (on) => this.hold(on),
        }),
    });
    const done = task.status === '[x]';
    return {
      chips: planned || host.setDeadline ? chips : undefined,
      chipsLabel: planned ? labels.plan : labels.deadline,
      footer: {
        label: done ? this.labels.markOpen : this.labels.markDoneSwipe,
        icon: done ? 'rotate-ccw' : 'check',
        onSelect: () => this.changeStatus(task, done ? '[ ]' : '[x]'),
      },
    };
  }

  /**
   * A task's card: every property in one place, its subtasks, and a row to
   * add one. It is the calendar's card, lent to the other layouts.
   */
  openCard(task: BoardTask, anchor: HTMLElement | DOMRect): void {
    this.calendar().openCard(task, anchor);
  }

  private openCardEntry(task: BoardTask, anchor: HTMLElement): MenuEntry {
    return {
      label: this.labels.openCard,
      icon: 'panel-top-open',
      keywords: 'card peek details page',
      // Kept as a rectangle: the row it belongs to may be drawn again before the card opens.
      onSelect: () => this.openCard(task, anchor.isConnected ? anchor.getBoundingClientRect() : this.el.getBoundingClientRect()),
    };
  }

  private actionOptions(task: BoardTask, anchor: HTMLElement): TaskActionOptions {
    const settings = this.settings;
    return {
      select: this.isCalendar || this.isTimeline ? undefined : () => this.toggleSelected(task),
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
  /**
   * Right click on a row or a card, or the context-menu key; on a touch
   * screen a long press too, unless holding the element picks it up to
   * drag it, where a tap opens the menu instead.
   */
  private withTaskActions(el: HTMLElement, task: BoardTask, longPress = true): void {
    if (longPress) {
      onContextPress(el, (at) => this.openTaskActions(task, at, el));
      return;
    }
    el.addEventListener('contextmenu', (event) => {
      if ((event.target as HTMLElement).closest('input, textarea')) return;
      event.preventDefault();
      event.stopPropagation();
      this.openTaskActions(task, { x: event.clientX, y: event.clientY }, el);
    });
  }

  private async updatePrefs(patch: Partial<BoardPreferences>, rebuildChrome = true): Promise<void> {
    Object.assign(this.prefs, patch);
    // A different view of the tasks comes in; resizing a column or folding a group does not.
    if (Object.keys(patch).some((key) => ENTERING_PREFS.has(key))) this.pendingEntrance = 'view';
    if (rebuildChrome) this.renderChrome();
    this.markViewsButton();
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
    if (this.compact) {
      this.renderCompactChrome();
      return;
    }
    const labels = this.labels;
    // Where the bar under the current tab is now, so it can slide to the next.
    const barBefore = this.barPlace();
    // A card or ghost the calendar left open belongs to the old chrome.
    this.calendarView?.destroy();
    this.el.empty();
    this.el.removeClass('is-chrome-collapsible', 'is-chrome-hidden');
    this.headObserver?.disconnect();
    this.headObserver = null;
    this.el.setAttribute('dir', this.language === 'fa' ? 'rtl' : 'ltr');
    this.el.setAttribute('lang', this.language);
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
    if (!this.touch) this.iconButton(actions, 'keyboard', labels.shortcuts, () => openShortcuts(this.language));
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
    this.renderLayoutControl(this.toolbarEl);
    this.slideBar(barBefore);
    this.renderScopeControl(this.toolbarEl);

    const search = this.toolbarEl.createDiv({ cls: 'taskpro-board__search' });
    setIcon(search.createSpan({ cls: 'taskpro-board__search-icon' }), 'search');
    const input = search.createEl('input', {
      type: 'search',
      attr: { placeholder: labels.search, 'aria-label': labels.search, dir: 'auto' },
    });
    input.value = this.search;
    autoDirection(input, this.direction);
    input.addEventListener('input', () => {
      this.search = input.value;
      if (this.searchTimer) clearTimeout(this.searchTimer);
      this.searchTimer = setTimeout(() => this.renderBody(), 120);
    });

    const controls = this.toolbarEl.createDiv({ cls: 'taskpro-board__controls' });
    this.renderViewsControl(controls);
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

    this.bodyEl = this.createBody();
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
    // With no folder set the whole vault is the only scope, and a switch with
    // one live side is only noise; setting a folder brings it back.
    if (!folder) return;
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

  private layoutItems(): Array<{ value: BoardPreferences['layout']; label: string; icon: string }> {
    const labels = this.labels;
    return [
      { value: 'table', label: labels.layoutTable, icon: 'table-2' },
      { value: 'board', label: labels.layoutBoard, icon: 'kanban' },
      { value: 'calendar', label: getCalendarLabels(this.language).layout, icon: 'calendar-days' },
      { value: 'timeline', label: getTimelineLabels(this.language).layout, icon: 'gantt-chart' },
    ];
  }

  /** The current layout tab's bar: its edge on the side the interface starts from, and its width. */
  private barPlace(): { edge: number; width: number } | null {
    const tab = this.toolbarEl?.querySelector<HTMLElement>('.taskpro-board__layout .is-active');
    if (!tab?.isConnected) return null;
    const box = tab.getBoundingClientRect();
    if (!box.width) return null;
    return { edge: this.direction === 'rtl' ? box.right : box.left, width: box.width };
  }

  /**
   * The bar under the tabs slides from the tab it was under to the one it is
   * under now, rather than jumping: the new tab's bar starts where the old
   * one was, at the old one's width, and settles (the animation is in CSS).
   */
  private slideBar(before: { edge: number; width: number } | null): void {
    const after = this.barPlace();
    const tab = this.toolbarEl?.querySelector<HTMLElement>('.taskpro-board__layout .is-active');
    if (!before || !after || !tab) return;
    const shift = before.edge - after.edge;
    if (Math.abs(shift) < 1 && Math.abs(before.width - after.width) < 1) return;
    tab.style.setProperty('--taskpro-bar-shift', `${shift}px`);
    tab.style.setProperty('--taskpro-bar-stretch', String(before.width / after.width));
    tab.addClass('is-sliding');
  }

  private renderLayoutControl(parent: HTMLElement): void {
    this.segmented(
      parent,
      'taskpro-board__layout',
      this.layoutItems(),
      this.prefs.layout,
      (value) => void this.updatePrefs({ layout: value as BoardPreferences['layout'] })
    );
  }

  // ── The phone layout's chrome ────────────────────────────────────────────
  // A slim bar on top (the title, search, filters, the view's options, and a
  // "more" sheet for the rest), what the board shows as tabs along the bottom
  // where a thumb rests, and a round button for a new task above them. Both
  // bars step aside while the list is scrolled down and come back at the
  // first scroll up, so the tasks get the whole screen. Nothing the desktop
  // bar offers is left out; it is one tap further in.

  private renderCompactChrome(): void {
    const labels = this.labels;
    this.calendarView?.destroy();
    this.el.empty();
    this.el.removeClass('is-chrome-hidden');
    this.el.setAttribute('dir', this.language === 'fa' ? 'rtl' : 'ltr');
    this.el.setAttribute('lang', this.language);
    this.el.toggleClass('is-board-layout', this.prefs.layout === 'board');
    this.el.toggleClass('is-calendar-layout', this.isCalendar);
    this.el.toggleClass('is-timeline-layout', this.isTimeline);

    this.headerEl = this.el.createDiv({ cls: 'taskpro-board__header is-compact' });
    // Only the list steps aside: a board's columns and a calendar's grid scroll on their own and keep their bars.
    this.el.toggleClass('is-chrome-collapsible', this.prefs.layout === 'table' && (this.prefs.compactTable ?? 'list') === 'list');
    this.trackHead();
    const heading = this.headerEl.createDiv({ cls: 'taskpro-board__heading' });
    const titles = heading.createDiv({ cls: 'taskpro-board__titles' });
    titles.createEl('h2', { cls: 'taskpro-board__title-text', text: labels.title });
    this.summaryEl = titles.createSpan({ cls: 'taskpro-board__summary' });

    // The toolbar is the heading's actions: search, filters, the view's options, more.
    this.toolbarEl = heading.createDiv({ cls: 'taskpro-board__heading-actions' });
    const searching = this.searchOpen || !!this.search.trim();
    const searchButton = this.iconButton(this.toolbarEl, 'search', searching ? labels.closeSearch : labels.openSearch, () => {
      this.searchOpen = !searching;
      if (!this.searchOpen && this.search) {
        this.search = '';
        this.renderBody();
      }
      this.renderChrome();
      if (this.searchOpen) this.headerEl.querySelector<HTMLInputElement>('.taskpro-board__search input')?.focus();
    });
    searchButton.addClass('taskpro-board__bar-icon-btn');
    searchButton.toggleClass('is-active', searching);
    searchButton.setAttribute('aria-pressed', String(searching));

    const count = this.activeFilterCount();
    const filter = this.toolbarEl.createEl('button', { cls: 'taskpro-board__bar-btn is-filter' });
    filter.type = 'button';
    filter.setAttribute('aria-label', count ? `${labels.filter} (${count})` : labels.filter);
    setIcon(filter.createSpan({ cls: 'taskpro-board__bar-icon' }), 'filter');
    if (count) filter.createSpan({ cls: 'taskpro-board__bar-count', text: String(count) });
    filter.toggleClass('is-active', count > 0);
    filter.addEventListener('click', () => this.openFilterMenu(filter));

    const options = this.iconButton(this.toolbarEl, 'sliders-horizontal', labels.viewOptions, () => this.openViewOptions(options));
    options.addClass('taskpro-board__bar-icon-btn', 'taskpro-board__properties');

    const more = this.iconButton(this.toolbarEl, 'more-horizontal', labels.more, () => this.openMoreSheet(more));
    more.addClass('taskpro-board__bar-icon-btn', 'taskpro-board__more');
    more.setAttribute('aria-haspopup', 'dialog');

    if (searching) {
      const search = this.headerEl.createDiv({ cls: 'taskpro-board__search is-compact' });
      setIcon(search.createSpan({ cls: 'taskpro-board__search-icon' }), 'search');
      const input = search.createEl('input', {
        type: 'search',
        attr: { placeholder: labels.search, 'aria-label': labels.search, dir: 'auto', enterkeyhint: 'search' },
      });
      input.value = this.search;
      autoDirection(input, this.direction);
      input.addEventListener('input', () => {
        this.search = input.value;
        if (this.searchTimer) clearTimeout(this.searchTimer);
        this.searchTimer = setTimeout(() => this.renderBody(), 160);
      });
    }

    this.filtersEl = this.headerEl.createDiv({ cls: 'taskpro-board__filters' });
    this.renderActiveFilters();

    if (this.isCalendar) {
      this.calendarNavEl = this.el.createDiv({ cls: 'taskpro-cal-nav' });
      this.calendar().renderNav(this.calendarNavEl);
    } else if (this.isTimeline) {
      this.calendarNavEl = null;
      this.timeline().renderNav(this.el.createDiv({ cls: 'taskpro-cal-nav taskpro-tl-nav' }));
    } else {
      this.calendarNavEl = null;
    }

    this.bodyEl = this.createBody();
    this.renderFab();
    this.renderTabBar();
  }

  /** The bar's height, kept where the list under it can read it: the search field opens in it, and a language can wrap it. */
  private trackHead(): void {
    this.headObserver?.disconnect();
    this.headObserver = null;
    const head = this.headerEl;
    const measure = () => this.el.style.setProperty('--taskpro-head-h', `${head.offsetHeight}px`);
    measure();
    const view = this.el.ownerDocument.defaultView ?? window;
    if (typeof view.ResizeObserver === 'undefined') return;
    this.headObserver = new view.ResizeObserver(measure);
    this.headObserver.observe(head);
  }

  /** What the board shows, as tabs along the bottom. */
  private renderTabBar(): void {
    const labels = this.labels;
    const bar = this.el.createEl('nav', { cls: 'taskpro-tabbar', attr: { 'aria-label': labels.layoutTabs } });
    const list = bar.createDiv({ cls: 'taskpro-tabbar__list', attr: { role: 'tablist', 'aria-label': labels.layoutTabs } });
    const tabs = this.layoutItems().map((entry) => ({
      ...entry,
      label: entry.value === 'table' && (this.prefs.compactTable ?? 'list') === 'list' ? labels.layoutList : entry.label,
    }));
    const buttons: HTMLButtonElement[] = [];
    for (const entry of tabs) {
      const selected = entry.value === this.prefs.layout;
      const tab = list.createEl('button', { cls: 'taskpro-tabbar__tab' });
      tab.type = 'button';
      tab.dataset.layout = entry.value;
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
      tab.toggleClass('is-active', selected);
      setIcon(tab.createSpan({ cls: 'taskpro-tabbar__icon', attr: { 'aria-hidden': 'true' } }), entry.icon);
      tab.createSpan({ cls: 'taskpro-tabbar__label', text: entry.label });
      tab.addEventListener('click', () => {
        if (!selected) void this.updatePrefs({ layout: entry.value });
      });
      buttons.push(tab);
    }
    // Arrow keys move between the tabs, as a tab list does.
    list.addEventListener('keydown', (event) => {
      const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
      if (at === -1) return;
      const rtl = this.language === 'fa';
      const step = event.key === 'ArrowRight' ? (rtl ? -1 : 1) : event.key === 'ArrowLeft' ? (rtl ? 1 : -1) : 0;
      const to = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : step ? (at + step + buttons.length) % buttons.length : -1;
      if (to === -1) return;
      event.preventDefault();
      buttons[to].focus();
    });
  }

  /** What the bar on top does not carry: the tags, a refresh, the saved views and the floating board. */
  private openMoreSheet(anchor: HTMLElement): void {
    const labels = this.labels;
    const toggleFloating = this.options.onToggleFloating ?? (this.host.openFloating ? () => this.host.openFloating?.() : null);
    this.openSheetMenu(anchor, labels.more, () => {
      const entries: MenuEntry[] = [
        { label: labels.views, icon: 'bookmark', hint: this.activeView()?.name, submenu: () => this.viewSections() },
        { label: labels.manageTags, icon: 'tags', onSelect: () => this.host.manageTags() },
        { label: labels.refresh, icon: 'refresh-cw', onSelect: () => void this.host.store.reload() },
      ];
      if (toggleFloating) {
        entries.push({
          label: this.options.floating ? labels.dock : labels.float,
          icon: this.options.floating ? 'minimize-2' : 'picture-in-picture-2',
          onSelect: () => toggleFloating(),
        });
      }
      if (this.options.floating && this.options.onClose) {
        entries.push({ label: labels.close, icon: 'x', onSelect: () => this.options.onClose?.() });
      }
      return [{ entries }];
    });
  }

  /**
   * Both bars step aside while a list is scrolled down and come back at the
   * first scroll up (or at the top, or when something needs them). Scrolling
   * sideways, as a board of columns does, is not scrolling down.
   */
  private watchScroll(): void {
    const last = new WeakMap<EventTarget, number>();
    this.el.addEventListener(
      'scroll',
      (event) => {
        if (!this.compact || !this.el.hasClass('is-chrome-collapsible')) return;
        const target = event.target;
        if (!(target instanceof HTMLElement) || target.scrollHeight <= target.clientHeight + 1) return;
        const top = target.scrollTop;
        const before = last.get(target) ?? 0;
        last.set(target, top);
        const delta = top - before;
        const needed = this.searchOpen || this.selected.size > 0 || this.holds > 0;
        if (top < 48 || delta < -6 || needed) this.setChromeHidden(false);
        else if (delta > 6) this.setChromeHidden(true);
      },
      { capture: true, passive: true }
    );
    // Reaching for a bar with the keyboard or a switch brings it back.
    this.el.addEventListener('focusin', (event) => {
      const target = event.target as HTMLElement;
      // Keyboard/switch focus reveals the bars. Pointer focus must not move the
      // floating + from under a finger between pointerdown and its click,
      // especially when reduced motion makes the movement instantaneous.
      if (target.matches(':focus-visible') && target.closest('.taskpro-board__header, .taskpro-tabbar, .taskpro-board__fab')) this.setChromeHidden(false);
    });
  }

  private setChromeHidden(hidden: boolean): void {
    if (hidden === this.el.hasClass('is-chrome-hidden')) return;
    this.el.toggleClass('is-chrome-hidden', hidden);
  }

  /**
   * A menu as a sheet: the view's options, the filters, the layouts. A
   * preference changed from one redraws the body at once and the bar when
   * the sheet closes, so the sheet stays in place meanwhile.
   */
  private openSheetMenu(anchor: HTMLElement, header: string, sections: () => MenuSection[], searchPlaceholder?: string): void {
    this.hold(true);
    openContextMenu({
      container: this.el,
      at: anchor.getBoundingClientRect(),
      rtl: this.language === 'fa',
      header,
      searchPlaceholder,
      sections,
      onClose: () => {
        this.hold(false);
        if (!this.chromeDirty) return;
        this.chromeDirty = false;
        this.renderChrome();
        this.renderBody();
      },
    });
  }

  /** A preference changed from a sheet: the body now, the bar when the sheet closes. */
  private quietPrefs(patch: Partial<BoardPreferences>): void {
    this.chromeDirty = true;
    void this.updatePrefs(patch, false);
  }

  /** Scope, grouping, sort, properties and the table's style, in one sheet with a page for each. */
  private openViewOptions(anchor: HTMLElement): void {
    const labels = this.labels;
    const folder = this.settings.targetFolder.trim().replace(/^\/+|\/+$/g, '');
    this.openSheetMenu(anchor, labels.viewOptions, () => {
      const sections: MenuSection[] = [
        {
          title: labels.scopeLabel,
          entries: [
            {
              label: folder ? labels.scopeTarget(folder.split('/').pop() || folder) : labels.scopeTarget('—'),
              icon: 'folder',
              hint: folder || labels.scopeTargetUnset,
              disabled: !folder,
              checked: this.effectiveScope === 'target',
              keepOpen: true,
              onSelect: () => this.quietPrefs({ scope: 'target' }),
            },
            {
              label: labels.scopeVault,
              icon: 'vault',
              checked: this.effectiveScope === 'vault',
              keepOpen: true,
              onSelect: () => this.quietPrefs({ scope: 'vault' }),
            },
          ],
        },
      ];
      sections.unshift({
        entries: [{ label: labels.views, icon: 'bookmark', hint: this.activeView()?.name, submenu: () => this.viewSections() }],
      });
      if (this.isCalendar || this.isTimeline) return sections;

      const board = this.prefs.layout === 'board';
      const grouping = board ? this.kanbanGrouping() : this.prefs.groupBy;
      const groupings = GROUPINGS;
      const keys: BoardSortKey[] = ['document', 'title', 'status', 'priority', 'deadline', 'plan', 'progress', 'note'];
      const rows: MenuEntry[] = [
        {
          label: labels.group,
          icon: 'layers',
          hint: labels.groupBy[grouping],
          submenu: () => [
            {
              entries: groupings
                .filter((option) => !(board && option === 'none'))
                .map((option) => ({
                  label: labels.groupBy[option],
                  checked: (board ? this.kanbanGrouping() : this.prefs.groupBy) === option,
                  keepOpen: true,
                  onSelect: () => this.quietPrefs({ groupBy: option }),
                })),
            },
          ],
        },
        {
          label: labels.sort,
          icon: 'arrow-up-down',
          hint: labels.sortBy[this.prefs.sortKey],
          submenu: () => [
            {
              entries: keys.map((key) => ({
                label: labels.sortBy[key],
                checked: this.prefs.sortKey === key,
                keepOpen: true,
                onSelect: () => this.quietPrefs({ sortKey: key }),
              })),
            },
            {
              entries: [
                { label: labels.ascending, icon: 'arrow-down', checked: this.prefs.sortDir === 'asc', keepOpen: true, onSelect: () => this.quietPrefs({ sortDir: 'asc' }) },
                { label: labels.descending, icon: 'arrow-up', checked: this.prefs.sortDir === 'desc', keepOpen: true, onSelect: () => this.quietPrefs({ sortDir: 'desc' }) },
              ],
            },
          ],
        },
        {
          label: board ? labels.properties : labels.columnsLabel,
          icon: 'sliders-horizontal',
          submenu: () => this.propertySections(board ? 'cardProperties' : 'tableColumns'),
        },
      ];
      if (!board) {
        const style = this.prefs.compactTable ?? 'list';
        rows.push({
          label: labels.tableStyle,
          icon: 'table-2',
          hint: style === 'list' ? labels.tableStyleList : labels.tableStyleFull,
          submenu: () => [
            {
              entries: (['list', 'table'] as const).map((value) => ({
                label: value === 'list' ? labels.tableStyleList : labels.tableStyleFull,
                icon: value === 'list' ? 'list' : 'table-2',
                checked: (this.prefs.compactTable ?? 'list') === value,
                keepOpen: true,
                onSelect: () => this.quietPrefs({ compactTable: value }),
              })),
            },
          ],
        });
      }
      if (!board && (this.prefs.compactTable ?? 'list') === 'list') {
        const rowStyle = this.prefs.rowStyle ?? 'light';
        rows.push({
          label: labels.rowStyle,
          icon: 'rows-3',
          hint: rowStyle === 'light' ? labels.rowStyleLight : labels.rowStyleChips,
          submenu: () => [
            {
              entries: (['light', 'chips'] as const).map((value) => ({
                label: value === 'light' ? labels.rowStyleLight : labels.rowStyleChips,
                checked: (this.prefs.rowStyle ?? 'light') === value,
                keepOpen: true,
                onSelect: () => this.quietPrefs({ rowStyle: value }),
              })),
            },
          ],
        });
      }
      sections.push({ entries: rows });
      return sections;
    });
  }

  /** The filters as switches: several can be flipped before the sheet goes away. */
  /** New tasks on a phone: a round button where the thumb rests, at the bottom on the trailing side. */
  private renderFab(): void {
    const labels = this.labels;
    const fab = this.el.createEl('button', { cls: 'taskpro-board__fab' });
    fab.type = 'button';
    fab.setAttribute('aria-label', labels.addTaskButton);
    setIcon(fab, 'plus');
    fab.addEventListener('click', () => {
      // Reveal only after activation, when moving the control cannot lose the tap.
      this.setChromeHidden(false);
      if (this.isCalendar) this.calendar().addTask();
      else this.openAddSheet(fab);
    });
  }

  /** New tasks as a sheet: one line of words read as it is typed, with what it understood shown under it. */
  private openAddSheet(anchor: HTMLElement): void {
    const labels = this.labels;
    const system = this.prefs.calendarSystem ?? this.settings.calendarSystem;
    const baseName = (path: string) => path.split('/').pop()!.replace(/\.md$/i, '');
    openQuickAddSheet({
      container: this.el,
      anchor,
      language: this.language,
      labels,
      addLabel: getActionLabels(this.language).add,
      system,
      timeFormat: this.settings.calendar.timeFormat,
      weekStartsOn: resolveWeekStart(this.settings.calendar.weekStart, system),
      tags: this.settings.tags,
      direction: this.direction,
      destination: (parsed) => {
        if (parsed.plan && this.host.addTaskOnDay && this.host.dayNoteTarget) {
          const target = this.host.dayNoteTarget(parsed.plan.date, system);
          return { name: target.path ? baseName(target.path) : labels.chooseInboxShort, choosable: target.isDailyNote === false };
        }
        const inbox = this.inboxPath();
        return { name: inbox ? baseName(inbox) : labels.chooseInboxShort, choosable: true };
      },
      chooseNote: (done) =>
        this.host.chooseNote((path) => {
          void this.updatePrefs({ inboxPath: path }, false).then(done);
        }),
      add: (parsed) => this.addParsed(parsed),
      hold: (on) => this.hold(on),
    });
  }

  private controlButton(parent: HTMLElement, icon: string, label: string, value?: string): HTMLButtonElement {
    const button = parent.createEl('button', { cls: 'taskpro-board__control' });
    button.type = 'button';
    // In a narrow pane the words give way to the icon, so the name and the
    // value are also said where a screen reader and a pointer will find them.
    const name = value ? `${label}: ${value}` : label;
    button.setAttribute('aria-label', name);
    button.title = name;
    setIcon(button.createSpan({ cls: 'taskpro-board__control-icon' }), icon);
    button.createSpan({ cls: 'taskpro-board__control-label', text: label });
    if (value) {
      button.addClass('has-value');
      button.createSpan({ cls: 'taskpro-board__control-value', text: value });
    }
    return button;
  }

  private renderGroupControl(parent: HTMLElement): void {
    const labels = this.labels;
    const current = this.prefs.layout === 'board' ? this.kanbanGrouping() : this.prefs.groupBy;
    const button = this.controlButton(parent, 'layers', labels.group, labels.groupBy[current]);
    button.addEventListener('click', (event) => {
      const menu = new Menu();
      const options = GROUPINGS;
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
    const { statuses, priorities, tags, deadlines, plans, notes } = this.prefs;
    return statuses.length + priorities.length + tags.length + (deadlines?.length ?? 0) + (plans?.length ?? 0) + (notes?.length ?? 0);
  }

  /** The preferences that turn every filter off. */
  private clearedFilters(): Partial<BoardPreferences> {
    return { statuses: [], priorities: [], tags: [], deadlines: [], plans: [], notes: [] };
  }

  private renderFilterControl(parent: HTMLElement): void {
    const labels = this.labels;
    const count = this.activeFilterCount();
    const button = this.controlButton(parent, 'filter', labels.filter, count ? String(count) : undefined);
    if (count) button.addClass('is-active');
    button.addEventListener('click', () => this.openFilterMenu(button));
  }

  /**
   * The filters, in the menu the board uses everywhere (a popover on a desktop,
   * a sheet on a phone): sections of switches that stay open while several are
   * flipped, with a search that finds any of them, at any depth.
   */
  private openFilterMenu(anchor: HTMLElement): void {
    const flip = (patch: Partial<BoardPreferences>) => {
      this.quietPrefs(patch);
      this.renderActiveFilters();
    };
    this.openSheetMenu(anchor, this.labels.filter, () => this.filterSections(flip), this.labels.filterSearch);
  }

  private filterSections(flip: (patch: Partial<BoardPreferences>) => void): MenuSection[] {
    const labels = this.labels;
    const toggle = <T,>(list: readonly T[], value: T): T[] =>
      list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
    const priorities: BoardPriorityFilter[] = [...TASK_PRIORITIES, 'none'];
    /** What a submenu's row says of its choices: the one chosen, or how many. */
    const summary = (names: string[]) => (names.length > 1 ? String(names.length) : (names[0] ?? ''));
    const buckets = (names: Record<DeadlineBucket, string>, key: 'deadlines' | 'plans'): MenuEntry[] =>
      DEADLINE_BUCKET_ORDER.map((bucket) => ({
        label: names[bucket],
        icon: key === 'deadlines' ? 'calendar' : 'clock',
        checked: !!this.prefs[key]?.includes(bucket),
        keepOpen: true,
        onSelect: () => flip({ [key]: toggle(this.prefs[key] ?? [], bucket) }),
      }));
    const notes = (): MenuEntry[] => {
      const counts = new Map<string, number>();
      for (const task of this.scopedTasks()) counts.set(task.filePath, (counts.get(task.filePath) ?? 0) + 1);
      // A note that is filtered on stays listed even if the scope no longer has it.
      for (const path of this.prefs.notes ?? []) if (!counts.has(path)) counts.set(path, 0);
      return Array.from(counts, ([path, count]) => ({ path, count }))
        .sort((a, b) => a.path.localeCompare(b.path))
        .map(({ path, count }) => ({
          label: path.split('/').pop()!.replace(/\.md$/i, ''),
          icon: 'file-text',
          hint: String(count),
          keywords: path,
          checked: !!this.prefs.notes?.includes(path),
          keepOpen: true,
          onSelect: () => flip({ notes: toggle(this.prefs.notes ?? [], path) }),
        }));
    };
    const bucketNames = (chosen: DeadlineBucket[] | undefined, names: Record<DeadlineBucket, string>) =>
      (chosen ?? []).map((bucket) => names[bucket]);

    // The three that open a list of their own come first: short, and the ones asked for most.
    const sections: MenuSection[] = [
      {
        entries: [
          {
            label: labels.filterDeadline,
            icon: 'calendar',
            hint: summary(bucketNames(this.prefs.deadlines, labels.buckets)),
            submenu: () => [{ entries: buckets(labels.buckets, 'deadlines') }],
          },
          {
            label: labels.filterPlan,
            icon: 'clock',
            hint: summary(bucketNames(this.prefs.plans, labels.planBuckets)),
            submenu: () => [{ entries: buckets(labels.planBuckets, 'plans') }],
          },
          {
            label: labels.filterNote,
            icon: 'file-text',
            hint: summary((this.prefs.notes ?? []).map((path) => path.split('/').pop()!.replace(/\.md$/i, ''))),
            submenu: () => [{ entries: notes() }],
          },
        ],
      },
      {
        title: labels.filterStatus,
        entries: BOARD_STATUS_ORDER.map((status) => ({
          label: STATUS_LABELS[this.language][status],
          icon: STATUS_ICON_NAMES[status],
          checked: this.prefs.statuses.includes(status),
          keepOpen: true,
          onSelect: () => flip({ statuses: toggle(this.prefs.statuses, status) }),
        })),
      },
      {
        title: labels.filterPriority,
        entries: priorities.map((priority) => ({
          label: priority === 'none' ? labels.noPriority : PRIORITY_LABELS[this.language][priority],
          icon: priority === 'none' ? 'minus' : PRIORITY_ICON_NAMES[priority],
          checked: this.prefs.priorities.includes(priority),
          keepOpen: true,
          onSelect: () => flip({ priorities: toggle(this.prefs.priorities, priority) }),
        })),
      },
      {
        title: labels.filterTags,
        entries: [...this.settings.tags, { key: '', name: labels.noTag, color: 'gray' }].map((tag) => ({
          label: tag.name,
          swatch: tag.key ? resolveTagColor(tag.color) : undefined,
          icon: tag.key ? undefined : 'minus',
          checked: this.prefs.tags.includes(tag.key),
          keepOpen: true,
          onSelect: () => flip({ tags: toggle(this.prefs.tags, tag.key) }),
        })),
      },
    ];
    if (this.activeFilterCount()) {
      sections.push({
        entries: [{ label: labels.clearFilters, icon: 'x', keepOpen: true, onSelect: () => flip(this.clearedFilters()) }],
      });
    }
    return sections;
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

    for (const bucket of this.prefs.deadlines ?? []) {
      pills.push({
        build: (pill) => {
          pill.addClass('taskpro-deadline-badge');
          pill.dataset.state = DEADLINE_BUCKET_STATE[bucket];
          pill.title = `${labels.filterDeadline}: ${labels.buckets[bucket]}`;
          this.chipContent(pill, CHIP_ICON_NAMES.deadline, labels.buckets[bucket]);
        },
        remove: () => void this.updatePrefs({ deadlines: (this.prefs.deadlines ?? []).filter((b) => b !== bucket) }),
      });
    }
    for (const bucket of this.prefs.plans ?? []) {
      pills.push({
        build: (pill) => {
          pill.addClass('taskpro-schedule-badge');
          if (bucket === 'overdue') pill.dataset.state = 'past';
          pill.title = `${labels.filterPlan}: ${labels.planBuckets[bucket]}`;
          this.chipContent(pill, CHIP_ICON_NAMES.scheduleDay, labels.planBuckets[bucket]);
        },
        remove: () => void this.updatePrefs({ plans: (this.prefs.plans ?? []).filter((b) => b !== bucket) }),
      });
    }
    for (const path of this.prefs.notes ?? []) {
      pills.push({
        build: (pill) => {
          pill.title = path;
          this.chipContent(pill, 'file-text', path.split('/').pop()!.replace(/\.md$/i, ''));
        },
        remove: () => void this.updatePrefs({ notes: (this.prefs.notes ?? []).filter((p) => p !== path) }),
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
      clear.addEventListener('click', () => void this.updatePrefs(this.clearedFilters()));
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
    autoDirection(input, this.direction);

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
   * Writes a task read from a line of words. With a plan it goes into that
   * day's note, as a task made on the calendar does; otherwise into the
   * inbox. Resolves the name of the note it went into, or null.
   */
  private async addParsed(parsed: Parsed): Promise<string | null> {
    const labels = this.labels;
    const host = this.host;
    const system = this.prefs.calendarSystem ?? this.settings.calendarSystem;
    const defaults = this.newTaskDefaults({});
    let line = `- ${defaults.status} ${parsed.title.replace(/\s+/g, ' ').trim()}`;
    const priority = parsed.priority ?? defaults.priority;
    if (priority) line = setPriority(line, priority);
    if (parsed.deadline) line = setDeadline(line, parsed.deadline);
    const plan = parsed.plan;
    let path: string | null = null;
    const withTail = (text: string) => {
      let out = text;
      if (parsed.remind) out = setRemind(out, parsed.remind);
      const keys = [...new Set([...defaults.tags, ...parsed.tags.map(normalizeTagKey)].filter(Boolean))];
      return keys.length ? setTags(out, keys) : out;
    };

    if (plan && host.addTaskOnDay) {
      // The note is the day, so an untimed task there needs no marker; one with a time carries it.
      const timed = !!plan.start;
      const target = host.dayNoteTarget?.(plan.date, system);
      const implicit = !timed && this.prefs.calendarShowDailyNotes && target?.isDailyNote !== false;
      line = setSchedule(line, timed ? plan : implicit ? null : { date: plan.date });
      path = await host.addTaskOnDay(plan.date, withTail(line), system);
    } else {
      if (plan) line = setSchedule(line, plan);
      const inbox = this.inboxPath();
      if (!inbox) {
        host.notify(labels.addFailed);
        host.chooseNote((picked) => void this.updatePrefs({ inboxPath: picked }, false));
        return null;
      }
      path = (await host.addTask(inbox, withTail(line))) ? inbox : null;
    }
    if (!path) {
      host.notify(labels.addFailed);
      return null;
    }
    const inScope = this.effectiveScope === 'vault' || isWithinTargetFolder(path, this.settings.targetFolder);
    if (!inScope) host.notify(labels.outsideScope);
    return path.split('/').pop()!.replace(/\.md$/i, '');
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
    this.paintBody();
    this.settleBody();
    // The calendar keeps its own card up to date as it draws; in the other layouts it is lent.
    if (!this.isCalendar) this.calendarView?.syncCard();
    this.restoreCursor();
    this.reconcileSelection();
    this.refreshSelection();
  }

  // ── Saved views ──────────────────────────────────────────────────────────

  private activeView(): SavedView | undefined {
    return (this.prefs.views ?? []).find((view) => view.id === this.prefs.activeView);
  }

  /** Whether the board has been changed since the view last applied. */
  private viewChanged(): boolean {
    const view = this.activeView();
    return !!view && !sameView(this.prefs, view, DEFAULT_BOARD_PREFERENCES);
  }

  private markViewsButton(): void {
    this.viewsButtonEl?.toggleClass('is-modified', this.viewChanged());
  }

  /** The toolbar's Views button: the view in use by name, marked when it has been changed since. */
  private renderViewsControl(parent: HTMLElement): void {
    const button = this.controlButton(parent, 'bookmark', this.labels.views, this.activeView()?.name);
    button.addClass('taskpro-board__views');
    this.viewsButtonEl = button;
    this.markViewsButton();
    button.addEventListener('click', () => {
      this.hold(true);
      openContextMenu({
        container: this.el,
        at: button.getBoundingClientRect(),
        rtl: this.language === 'fa',
        header: this.labels.views,
        sections: () => this.viewSections(),
        onClose: () => this.hold(false),
      });
    });
  }

  /** The saved views to apply, saving this one, managing them, and back to the default. */
  private viewSections(): MenuSection[] {
    const labels = this.labels;
    const views = this.prefs.views ?? [];
    const active = this.activeView();
    const changed = this.viewChanged();
    const sections: MenuSection[] = [];
    if (views.length) {
      sections.push({
        entries: views.map((view) => ({
          label: view.name,
          icon: 'bookmark',
          checked: view.id === active?.id,
          hint: view.id === active?.id && changed ? labels.viewModified : undefined,
          keywords: 'view saved',
          onSelect: () => void this.applyView(view),
        })),
      });
    }
    const actions: MenuEntry[] = [
      {
        label: labels.viewSave,
        icon: 'bookmark-plus',
        onSelect: () => this.askViewName(labels.viewSaveTitle, uniqueViewName(views, labels.viewNewName), (name) => void this.saveView(name)),
      },
    ];
    if (active && changed) {
      actions.push({ label: labels.viewUpdate(active.name), icon: 'save', onSelect: () => void this.updateView(active) });
    }
    sections.push({ entries: actions });
    if (views.length) {
      sections.push({
        entries: [
          {
            label: labels.viewsManage,
            icon: 'settings-2',
            submenu: () => [
              {
                entries: views.map((view) => ({
                  label: view.name,
                  icon: 'bookmark',
                  submenu: () => [
                    {
                      entries: [
                        {
                          label: labels.viewRename,
                          icon: 'pencil',
                          onSelect: () => this.askViewName(labels.viewRenameTitle, view.name, (name) => void this.renameView(view, name)),
                        },
                        { label: labels.viewDuplicate, icon: 'copy', onSelect: () => void this.duplicateView(view) },
                      ],
                    },
                    { entries: [{ label: labels.viewDelete, icon: 'trash-2', warning: true, onSelect: () => void this.deleteView(view) }] },
                  ],
                })),
              },
            ],
          },
        ],
      });
    }
    sections.push({ entries: [{ label: labels.viewReset, icon: 'rotate-ccw', onSelect: () => void this.resetView() }] });
    return sections;
  }

  /** Asks for a view's name in a small panel. */
  private askViewName(title: string, initial: string, onDone: (name: string) => void): void {
    const labels = this.labels;
    const { body, footer, close } = openTaskProPanel(title);
    const input = addPanelField(body, labels.viewNamePlaceholder);
    input.value = initial;
    input.setAttribute('dir', 'auto');
    const save = () => {
      const name = input.value.trim();
      if (!name) return;
      close();
      onDone(name);
    };
    addPanelButtonRow(footer, { cancelLabel: getActionLabels(this.language).cancel, saveLabel: labels.save, onCancel: close, onSave: save });
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.isComposing) {
        event.preventDefault();
        save();
      }
    });
    input.focus();
    input.select();
  }

  /** Saves the board as it is now, and makes it the view in use. */
  private async saveView(name: string): Promise<void> {
    const views = this.prefs.views ?? [];
    const view: SavedView = { id: newViewId(views), name: uniqueViewName(views, name), prefs: snapshotView(this.prefs) };
    await this.updatePrefs({ views: [...views, view], activeView: view.id });
  }

  /** Puts the board as it is now into a view that was changed on the way. */
  private async updateView(view: SavedView): Promise<void> {
    const views = (this.prefs.views ?? []).map((other) => (other.id === view.id ? { ...other, prefs: snapshotView(this.prefs) } : other));
    await this.updatePrefs({ views });
  }

  private async renameView(view: SavedView, name: string): Promise<void> {
    const others = (this.prefs.views ?? []).filter((other) => other.id !== view.id);
    const named = uniqueViewName(others, name);
    await this.updatePrefs({ views: (this.prefs.views ?? []).map((other) => (other.id === view.id ? { ...other, name: named } : other)) });
  }

  private async duplicateView(view: SavedView): Promise<void> {
    const views = this.prefs.views ?? [];
    const copy: SavedView = {
      id: newViewId(views),
      name: uniqueViewName(views, this.labels.viewCopy(view.name)),
      prefs: JSON.parse(JSON.stringify(view.prefs)) as SavedView['prefs'],
    };
    await this.updatePrefs({ views: [...views, copy] }, false);
  }

  private async deleteView(view: SavedView): Promise<void> {
    await this.updatePrefs({
      views: (this.prefs.views ?? []).filter((other) => other.id !== view.id),
      activeView: this.prefs.activeView === view.id ? undefined : this.prefs.activeView,
    });
  }

  /** Sets the board up as a view was: layout, grouping, sorting, filters and options. */
  private async applyView(view: SavedView): Promise<void> {
    await this.updatePrefs(viewPatch(view, DEFAULT_BOARD_PREFERENCES));
  }

  /** Back to the board as it starts: the default layout, no filters, no view in use. */
  private async resetView(): Promise<void> {
    await this.updatePrefs({ ...viewPatch({ id: '', name: '', prefs: {} }, DEFAULT_BOARD_PREFERENCES), activeView: undefined });
  }

  // ── Selecting several ────────────────────────────────────────────────────

  /** A square in the margin of a row or a card that picks it for a bulk change. */
  private selectButton(parent: HTMLElement, task: BoardTask): void {
    const box = parent.createEl('button', { cls: 'taskpro-board__select' });
    box.type = 'button';
    box.setAttribute('role', 'checkbox');
    box.setAttribute('aria-label', this.labels.selectTask);
    box.setAttribute('aria-checked', String(this.selected.has(task.id)));
    box.tabIndex = -1;
    setIcon(box.createSpan({ cls: 'taskpro-board__select-tick' }), 'check');
    box.addEventListener('click', (event) => {
      event.stopPropagation();
      this.toggleSelected(task, event.shiftKey);
    });
  }

  /**
   * Picks a task, or drops it. With `range`, every task between this one and
   * the last one picked is picked; before any has been, the cursor is where a
   * range starts, as a click on a row and then a Shift click on another would
   * expect.
   */
  private toggleSelected(task: BoardTask, range = false): void {
    const els = this.navigable().flat();
    const flat = els.map((el) => el.dataset.taskId!);
    const anchor = this.selectAnchor && flat.includes(this.selectAnchor) ? this.selectAnchor : (this.cursor?.id ?? null);
    const from = anchor ? flat.indexOf(anchor) : -1;
    const to = flat.indexOf(task.id);
    if (range && from !== -1 && to !== -1) {
      for (const id of flat.slice(Math.min(from, to), Math.max(from, to) + 1)) this.setSelected(id, true);
      this.selectAnchor = anchor;
    } else {
      this.setSelected(task.id, !this.selected.has(task.id));
      this.selectAnchor = task.id;
    }
    // The cursor goes where the last pick was, as a click would put it (a tap does not).
    if (to !== -1 && !this.touch) this.placeCursor(els[to], false);
    this.refreshSelection();
  }

  private setSelected(id: string, on: boolean): void {
    const task = this.taskIndex.get(id);
    if (on && task) this.selected.set(id, foldKey(task));
    else this.selected.delete(id);
  }

  private selectAll(): void {
    for (const el of this.navigable().flat()) this.setSelected(el.dataset.taskId!, true);
    this.refreshSelection();
  }

  private clearSelection(): void {
    this.selected.clear();
    this.selectAnchor = null;
    this.refreshSelection();
  }

  /** After the notes changed: a picked task is the same one even if its line moved. */
  private reconcileSelection(): void {
    if (!this.selected.size) return;
    const byKey = new Map<string, BoardTask[]>();
    for (const task of this.taskIndex.values()) {
      const key = foldKey(task);
      byKey.set(key, [...(byKey.get(key) ?? []), task]);
    }
    const kept = new Map<string, string>();
    for (const [id, key] of this.selected) {
      const same = this.taskIndex.get(id);
      if (same && foldKey(same) === key) kept.set(id, key);
    }
    for (const [id, key] of this.selected) {
      if (kept.has(id)) continue;
      const other = (byKey.get(key) ?? []).find((task) => !kept.has(task.id) && !this.selected.has(task.id));
      if (other) kept.set(other.id, key);
    }
    this.selected.clear();
    for (const [id, key] of kept) this.selected.set(id, key);
    if (this.selectAnchor && !this.selected.has(this.selectAnchor)) this.selectAnchor = null;
  }

  /** Marks the rows and cards picked, and shows or puts away the bar. */
  private refreshSelection(): void {
    if (!this.bodyEl) return;
    const picked = this.selected.size > 0 && !this.isCalendar && !this.isTimeline;
    this.el.toggleClass('has-selection', picked);
    for (const el of this.navigable().flat()) {
      const on = picked && this.selected.has(el.dataset.taskId!);
      el.toggleClass('is-selected', on);
      el.querySelector('.taskpro-board__select')?.setAttribute('aria-checked', String(on));
    }
    if (!picked) {
      this.selectionEl?.remove();
      this.selectionEl = null;
      this.releaseSelectionEscape?.();
      this.releaseSelectionEscape = null;
      return;
    }
    if (!this.selectionEl || !this.selectionEl.isConnected) {
      this.selectionEl = this.el.createDiv({ cls: 'taskpro-selection' });
      this.selectionEl.setAttribute('role', 'toolbar');
      this.selectionEl.setAttribute('aria-label', this.labels.selectedCount(this.selected.size));
    }
    // Escape drops the selection first, before anything under it.
    this.releaseSelectionEscape ??= claimEscape(() => this.clearSelection(), this.el.ownerDocument);
    const tasks = [...this.selected.keys()].flatMap((id) => {
      const task = this.taskIndex.get(id);
      return task ? [task] : [];
    });
    tasks.sort((a, b) => (a.filePath === b.filePath ? a.lineNumber - b.lineNumber : a.filePath.localeCompare(b.filePath)));
    this.selectionEl.setAttribute('aria-label', this.labels.selectedCount(tasks.length));
    renderBulkBar(this.selectionEl, tasks, this.bulkContext());
  }

  private bulkContext(): BulkContext {
    const settings = this.settings;
    return {
      host: this.host,
      root: this.el,
      language: settings.language,
      calendarSystem: this.prefs.calendarSystem ?? settings.calendarSystem,
      timeFormat: settings.calendar.timeFormat,
      tags: settings.tags,
      planReminder: settings.planReminder,
      compact: this.compact,
      hold: (on) => this.hold(on),
      lookup: (id) => this.taskIndex.get(id),
      clear: () => this.clearSelection(),
    };
  }

  // ── The keyboard ─────────────────────────────────────────────────────────

  /**
   * The body, which the keyboard moves through: a stop of its own that holds
   * the cursor. A click on a task puts the cursor there, so the keys carry on
   * from where the pointer was.
   */
  private createBody(): HTMLElement {
    const body = this.el.createDiv({ cls: 'taskpro-board__body' });
    body.tabIndex = 0;
    body.setAttribute('aria-label', this.labels.title);
    body.addEventListener('pointerdown', (event) => {
      const item = (event.target as HTMLElement).closest<HTMLElement>('[data-task-id]');
      // A Shift click stretches a pick from where the cursor was, and moves it once it has. A finger has no keys to
      // aim at a task, and a tapped one should not be left framed.
      if (item && !event.shiftKey && event.pointerType !== 'touch') this.placeCursor(item, false);
    });
    // The browser stretches a text selection across everything between two clicks
    // when Shift is down, on the way down; the pick is all that is wanted.
    body.addEventListener(
      'mousedown',
      (event) => {
        const target = event.target as HTMLElement;
        if (!event.shiftKey || !target.closest('[data-task-id]') || target.closest('input, textarea, [contenteditable="true"]')) return;
        event.preventDefault();
        body.focus({ preventScroll: true });
      },
      true
    );
    // A click with Ctrl, ⌘ or Shift picks the task instead of doing what it would; so does a tap while some are picked.
    body.addEventListener(
      'click',
      (event) => {
        const target = event.target as HTMLElement;
        const item = target.closest<HTMLElement>('[data-task-id]');
        if (!item || target.closest('.taskpro-board__select')) return;
        const picking = event.ctrlKey || event.metaKey || event.shiftKey || (this.touch && this.selected.size > 0 && !target.closest('button, input, a'));
        const task = picking ? this.taskIndex.get(item.dataset.taskId!) : undefined;
        if (!task) return;
        event.preventDefault();
        event.stopPropagation();
        this.toggleSelected(task, event.shiftKey);
      },
      true
    );
    // Reached with Tab, the body shows where it is: the cursor is on the first task. (Not on a touch screen, where
    // the focus comes back to the body whenever a sheet closes, and the first task would be framed each time.)
    body.addEventListener('focus', () => {
      if (!this.cursor && !this.touch && body.matches(':focus-visible')) this.placeCursor(this.navigable()[0]?.[0] ?? null, false);
    });
    return body;
  }

  /** The tasks the cursor can be on, by column: a table or a list is one column, a board has many. */
  private navigable(): HTMLElement[][] {
    if (this.isCalendar || this.isTimeline || !this.bodyEl) return [];
    const columns = Array.from(this.bodyEl.querySelectorAll<HTMLElement>('.taskpro-kanban__column'));
    if (columns.length) return columns.map((column) => Array.from(column.querySelectorAll<HTMLElement>('.taskpro-card[data-task-id]')));
    return [Array.from(this.bodyEl.querySelectorAll<HTMLElement>('.taskpro-table__row[data-task-id], .taskpro-list__row[data-task-id]'))];
  }

  /** Puts the cursor on a task's row or card, or takes it off with `null`. */
  private placeCursor(el: HTMLElement | null, reveal = true): void {
    this.bodyEl.querySelectorAll('.has-cursor').forEach((other) => other.removeClass('has-cursor'));
    if (!el) {
      this.cursor = null;
      return;
    }
    const columns = this.navigable();
    for (let column = 0; column < columns.length; column++) {
      const row = columns[column].indexOf(el);
      if (row === -1) continue;
      this.cursor = { id: el.dataset.taskId!, at: { column, row } };
      el.addClass('has-cursor');
      if (reveal) this.reveal(el);
      return;
    }
  }

  /**
   * Scrolls the cursor into view. A table row is wider than the body and would
   * be slid sideways by the browser's own scrolling, so rows and list items only
   * move up or down, clear of the sticky header; a card is scrolled to as it is.
   */
  private reveal(el: HTMLElement): void {
    if (el.hasClass('taskpro-card')) {
      el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      return;
    }
    const body = this.bodyEl;
    const view = body.getBoundingClientRect();
    const box = el.getBoundingClientRect();
    const top = view.top + (body.querySelector<HTMLElement>('thead')?.getBoundingClientRect().height ?? 0) + 4;
    const bottom = view.bottom - 4;
    if (box.top < top) body.scrollTop -= top - box.top;
    else if (box.bottom > bottom) body.scrollTop += box.bottom - bottom;
  }

  /** After a drawing the cursor is on the same task, or as near as its place gets. */
  private restoreCursor(): void {
    if (!this.cursor) return;
    const columns = this.navigable();
    const same = columns.flat().find((el) => el.dataset.taskId === this.cursor!.id);
    const { column, row } = this.cursor.at;
    const near = columns[column]?.[Math.min(row, columns[column].length - 1)] ?? columns.flat()[0] ?? null;
    this.placeCursor(same ?? near, false);
  }

  /**
   * Folds the parent under the cursor, or unfolds it; from a subtask, or a
   * parent already folded, folding steps up to the parent instead. Resolves
   * whether it did anything.
   */
  private walkTree(collapse: boolean): boolean {
    const task = this.cursorTask();
    const nest = task ? this.nestings.get(task.id) : undefined;
    if (!task || !nest) return false;
    const folded = (this.prefs.foldedTasks ?? []).includes(foldKey(task));
    if (collapse) {
      if (nest.children && !folded) {
        this.setFolded(task, true);
        return true;
      }
      const parent = nest.parent && this.bodyEl.querySelector<HTMLElement>(`[data-task-id="${nest.parent.replace(/["\\]/g, '\\$&')}"]`);
      if (parent) {
        this.placeCursor(parent);
        return true;
      }
      return false;
    }
    if (nest.children && folded) {
      this.setFolded(task, false);
      return true;
    }
    return false;
  }

  private cursorTask(): BoardTask | null {
    const id = this.cursor?.id;
    return id ? this.host.store.all().find((task) => task.id === id) ?? null : null;
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (event.defaultPrevented || event.isComposing || this.isCalendar || this.isTimeline) return;
    const target = event.target as HTMLElement;
    // Fields keep their keys, and so do menus, cards and panels.
    if (target.closest('input, textarea, select, [contenteditable="true"], .taskpro-menu, .taskpro-cal-popover, .taskpro-panel-overlay')) return;
    const mod = event.ctrlKey || event.metaKey;
    const plain = !mod && !event.altKey;

    // Board-wide: from anywhere on the board.
    if (plain && event.code === 'Slash') {
      event.preventDefault();
      if (event.shiftKey) openShortcuts(this.language);
      else this.el.querySelector<HTMLInputElement>('.taskpro-board__search input')?.focus();
      return;
    }
    if (plain && !event.shiftKey && event.code === 'KeyN') {
      const add = this.el.querySelector<HTMLInputElement>('.taskpro-board__add-input');
      if (add) {
        event.preventDefault();
        add.focus();
      }
      return;
    }

    // The cursor: only from the body itself, where the focus rests when nothing inside has it.
    if (target !== this.bodyEl) return;
    // In a table the sideways keys work the tree: fold a parent, unfold it, or step up to it from a subtask.
    if (plain && this.prefs.layout !== 'board' && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
      const collapse = event.key === (this.language === 'fa' ? 'ArrowRight' : 'ArrowLeft');
      if (this.walkTree(collapse)) {
        event.preventDefault();
        return;
      }
    }
    const move = plain ? moveFor(event, this.language === 'fa') : null;
    if (move) {
      const columns = this.navigable();
      const next = moveCursor(columns.map((column) => column.length), this.cursor?.at ?? null, move);
      if (!next) return;
      event.preventDefault();
      const previous = this.cursor?.id;
      this.placeCursor(columns[next.column][next.row]);
      // Shift carries the selection along with the cursor.
      if (event.shiftKey && (move === 'up' || move === 'down') && this.cursor) {
        if (previous) this.setSelected(previous, true);
        this.setSelected(this.cursor.id, true);
        this.refreshSelection();
      }
      return;
    }
    if (mod && !event.altKey && event.code === 'KeyA') {
      event.preventDefault();
      this.selectAll();
      return;
    }

    const task = this.cursorTask();
    const el = this.bodyEl.querySelector<HTMLElement>('.has-cursor');
    if (!task || !el) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      if (mod) void this.host.reveal(task);
      else this.openCard(task, el.getBoundingClientRect());
      return;
    }
    if (!plain || event.shiftKey) return;
    if (event.code === 'KeyX') {
      event.preventDefault();
      this.toggleSelected(task);
    } else if (event.code === 'Space') {
      event.preventDefault();
      this.changeStatus(task, task.status === '[x]' ? '[ ]' : '[x]');
    } else if (event.code === 'KeyE' || event.key === 'F2') {
      event.preventDefault();
      el.querySelector<HTMLElement>('.taskpro-board__title')?.click();
    } else if (event.code === 'KeyM') {
      event.preventDefault();
      this.openTaskActions(task, el.getBoundingClientRect(), el);
    } else if ((event.key === 'Delete' || event.key === 'Backspace') && this.host.deleteTask) {
      event.preventDefault();
      void this.host.deleteTask(task);
    }
  }

  /** What has been drawn is brought in, and what has just arrived is marked. */
  private settleBody(): void {
    if (!this.bodyEl) return;
    if (this.pendingEntrance) {
      enter(this.bodyEl, this.pendingEntrance);
      this.pendingEntrance = null;
    }
    this.expanding = null;
    this.revealing = null;
    if (performance.now() > this.arrivals.until) return;
    const arrived = (id: string) => this.arrivals.added.has(id) || this.arrivals.changed.has(id);
    this.bodyEl.querySelectorAll<HTMLElement>('[data-task-id]').forEach((el) => {
      if (arrived(el.dataset.taskId!)) el.addClass('is-arriving');
    });
  }

  /** Draws the body from the tasks and the preferences. */
  private paintBody(): void {
    if (!this.bodyEl) return;
    this.renderQueued = false;
    const labels = this.labels;
    // The view options ride on the root, where the styles read them.
    this.el.dataset.density = this.prefs.density ?? 'comfortable';
    this.el.toggleClass('is-wrapping', !!this.prefs.wrapTitles);
    const scrollTop = this.bodyEl.scrollTop;
    const scrollLeft = this.bodyEl.scrollLeft;
    // On a phone each column scrolls by itself and the strip of columns scrolls sideways: all of it is kept.
    const strip = this.kanbanScroller();
    const stripLeft = strip && strip !== this.bodyEl ? strip.scrollLeft : 0;
    const columnTops = new Map<string, number>();
    if (this.compact) this.bodyEl.querySelectorAll<HTMLElement>('.taskpro-kanban__column').forEach((column) => columnTops.set(column.dataset.group ?? '', column.scrollTop));
    // Read before emptying: a removed element can no longer be the focused one.
    const hadFocus = this.bodyEl.contains(this.el.ownerDocument.activeElement);
    this.bodyEl.empty();

    if (!this.host.store.isLoaded) {
      this.summaryEl.setText('');
      this.loadingState(labels.loading);
      this.wasLoading = true;
      return;
    }
    // The tasks replace the loading rows: they come in.
    if (this.wasLoading) {
      this.wasLoading = false;
      this.pendingEntrance = 'view';
    }

    this.refreshRelations();
    this.noteArrivals();
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
      this.emptyState(
        filtering ? labels.emptyFiltered : labels.empty,
        filtering ? 'search' : 'list-checks',
        // A search that finds nothing is the one empty board with a way out.
        filtering
          ? {
              label: labels.emptyClear,
              run: () => {
                this.search = '';
                void this.updatePrefs(this.clearedFilters());
              },
            }
          : undefined
      );
      return;
    }

    this.bodyEl.toggleClass('is-kanban', this.prefs.layout === 'board');
    this.bodyEl.toggleClass('is-list', false);
    if (this.prefs.layout === 'board') this.renderKanban(sorted, today);
    else if (this.compact && (this.prefs.compactTable ?? 'list') === 'list') this.renderList(sorted, today);
    else this.renderTable(sorted, today);

    this.bodyEl.scrollTop = scrollTop;
    this.bodyEl.scrollLeft = scrollLeft;
    const nextStrip = this.kanbanScroller();
    if (nextStrip && nextStrip !== this.bodyEl) nextStrip.scrollLeft = stripLeft;
    if (this.compact && columnTops.size) this.bodyEl.querySelectorAll<HTMLElement>('.taskpro-kanban__column').forEach((column) => (column.scrollTop = columnTops.get(column.dataset.group ?? '') ?? 0));
  }

  /**
   * What scrolls sideways through the board's columns: the strip of columns on
   * a phone (where every column scrolls up and down by itself), the body
   * elsewhere.
   */
  private kanbanScroller(): HTMLElement | null {
    if (!this.bodyEl) return null;
    if (this.compact) return this.bodyEl.querySelector<HTMLElement>(':scope > .taskpro-kanban');
    return this.bodyEl;
  }

  /** Compares the tasks with the last drawing, and keeps the new and the changed for a moment. */
  private noteArrivals(): void {
    const fresh = this.tracker.update(this.host.store.all());
    if (!fresh.added.size && !fresh.changed.size) return;
    const live = performance.now() <= this.arrivals.until;
    this.arrivals = {
      added: new Set([...(live ? this.arrivals.added : []), ...fresh.added]),
      changed: new Set([...(live ? this.arrivals.changed : []), ...fresh.changed]),
      until: performance.now() + ARRIVAL_MS,
    };
  }

  /** The calendar and the timeline turn a page, or come in, from their own controls. */
  enterNext(kind: Entrance): void {
    this.pendingEntrance = kind;
  }

  private refreshRelations(): void {
    const all = this.host.store.all();
    this.subtasks = subtaskCounts(all);
    this.relationIndex = new RelationIndex(all);
    this.taskIndex = new Map(all.map((task) => [task.id, task]));
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

  /** An empty view: what is missing, and, where there is one, the way out of it. */
  private emptyState(text: string, icon: string, action?: { label: string; run: () => void }): void {
    const empty = this.bodyEl.createDiv({ cls: 'taskpro-board__empty' });
    setIcon(empty.createDiv({ cls: 'taskpro-board__empty-icon' }), icon);
    empty.createDiv({ cls: 'taskpro-board__empty-text', text });
    if (!action) return;
    const button = empty.createEl('button', { cls: 'taskpro-board__empty-action', text: action.label });
    button.type = 'button';
    button.addEventListener('click', action.run);
  }

  /**
   * While the notes are being read: rows in the shape of the ones that are
   * coming, so the page does not jump when they arrive. The sentence stays
   * for anyone who cannot see the rows.
   */
  private loadingState(text: string): void {
    const loading = this.bodyEl.createDiv({ cls: 'taskpro-board__skeleton' });
    loading.setAttribute('role', 'status');
    loading.setAttribute('aria-label', text);
    for (let row = 0; row < 7; row++) {
      const line = loading.createDiv({ cls: 'taskpro-board__skeleton-row' });
      line.createSpan({ cls: 'taskpro-board__skeleton-dot' });
      // Titles of a few different lengths, then a chip or two: a table's rhythm.
      line.createSpan({ cls: 'taskpro-board__skeleton-bar' }).style.setProperty('--w', `${[34, 46, 28, 40, 52, 30, 38][row]}%`);
      line.createSpan({ cls: 'taskpro-board__skeleton-bar is-chip' });
      if (row % 3 !== 1) line.createSpan({ cls: 'taskpro-board__skeleton-bar is-chip' });
    }
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
    // In the order of the notes, a subtask sits under its parent, which can fold it away.
    const nested = this.prefs.sortKey === 'document';
    table.toggleClass('is-document-order', nested);
    this.nestings = new Map();
    const folded = new Set(this.prefs.foldedTasks ?? []);
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
    onContextPress(titleHead, (at) => this.openHeaderMenu(null, at));
    for (const column of columns) this.renderColumnHeader(head, table, column);
    const end = head.createEl('th', { cls: 'taskpro-table__more taskpro-table__add-column' });
    const add = this.iconButton(end, 'plus', labels.properties, () => this.openPropertiesMenu(add, 'tableColumns'));
    add.addClass('taskpro-table__add-btn');

    // A group that stands for a status, a priority or a tag ends with a "+ New"
    // that adds a task with it; any other table has one at its very end.
    const perGroup = groupBy === 'status' || groupBy === 'priority' || groupBy === 'tag';
    const body = table.createEl('tbody');
    for (const group of groups) {
      if (groupBy !== 'none') {
        if (!group.tasks.length && groupBy === 'status') continue;
        this.renderGroupRow(body, group, groupBy, span);
        if (this.prefs.collapsedGroups.includes(group.id)) continue;
      }
      const limit = this.rowLimits.get(group.id) ?? ROWS_PER_PAGE;
      const nesting = nested ? nestTasks(group.tasks, (id) => this.taskIndex.get(id)) : null;
      if (nesting) for (const [id, entry] of nesting) this.nestings.set(id, entry);
      const isFolded = (id: string) => folded.has(foldKey(this.taskIndex.get(id)!));
      const rows = nesting ? group.tasks.filter((task) => !hiddenByFold(task.id, nesting, isFolded)) : group.tasks;
      rows.slice(0, limit).forEach((task, index) => {
        const entry = nesting?.get(task.id);
        const row = this.renderRow(body, task, columns, entry && { ...entry, folded: isFolded(task.id) });
        const revealed = this.revealing !== null && !!nesting && this.underTask(task.id, this.revealing, nesting);
        if (this.expanding === group.id || revealed) {
          row.addClass('is-expanding');
          stagger(row, index);
        }
      });
      if (rows.length > limit) {
        const more = body.createEl('tr', { cls: 'taskpro-table__more-row' });
        const cell = more.createEl('td', { attr: { colspan: span } });
        const button = cell.createEl('button', { text: labels.showMore(Math.min(ROWS_PER_PAGE, rows.length - limit)) });
        button.addEventListener('click', () => {
          this.rowLimits.set(group.id, limit + ROWS_PER_PAGE);
          this.renderBody();
        });
      }
      if (perGroup) this.renderNewRow(body, columns.length + 1, groupBy, group.value);
    }
    if (!perGroup) this.renderNewRow(body, columns.length + 1, groupBy, '');
  }

  /**
   * The row that ends a group: a plus under the checks and "New" under the
   * titles, quiet until the pointer is over it, and one click from a field.
   * Its cells are the check's and the title's, so it stays in view with them
   * when the properties scroll sideways.
   */
  private renderNewRow(body: HTMLElement, restSpan: number, groupBy: BoardGroupBy, value: string): void {
    const row = body.createEl('tr', { cls: 'taskpro-table__new-row' });
    const lead = row.createEl('td', { cls: 'taskpro-table__check' });
    setIcon(lead.createSpan({ cls: 'taskpro-board__new-icon' }), 'plus');
    const cell = row.createEl('td', { cls: 'taskpro-table__task' });
    const button = this.newButton(cell, TABLE_NEW, groupBy, value);
    row.createEl('td', { attr: { colspan: String(restSpan) } });
    // The whole row is the button; the plus is only where the eye starts.
    lead.addEventListener('click', () => {
      if (button.isConnected) button.click();
    });
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
    onContextPress(th, (at) => this.openHeaderMenu(column.id, at));
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
      // A finger moves a column from the header's long-press menu; a swipe here scrolls the table.
      if (event.pointerType === 'touch') return;
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
      // The drop is where the pointer let go, whether or not the browser had
      // delivered its last move by then.
      const onUp = (e: PointerEvent) => {
        onMove(e);
        finish(true);
      };
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
      const onUp = (e: Event) => {
        if (e.type === 'pointerup') onMove(e as PointerEvent);
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
      { title: labels.viewSection, entries: this.viewOptions(key) },
    ];
  }

  /** How the table or the board looks, rather than what it shows: room, wrapping, empty columns. */
  private viewOptions(key: 'tableColumns' | 'cardProperties'): MenuEntry[] {
    const labels = this.labels;
    const density = this.prefs.density ?? 'comfortable';
    const entries: MenuEntry[] = [
      {
        label: labels.density,
        icon: 'rows-3',
        hint: labels.densities[density],
        keywords: 'compact comfortable spacious row height size',
        submenu: () => [
          {
            entries: (['compact', 'comfortable', 'spacious'] as BoardDensity[]).map((value) => ({
              label: labels.densities[value],
              checked: value === (this.prefs.density ?? 'comfortable'),
              onSelect: () => void this.updatePrefs({ density: value }, false),
            })),
          },
        ],
      },
      {
        label: labels.wrapTitles,
        icon: 'wrap-text',
        toggle: !!this.prefs.wrapTitles,
        keepOpen: true,
        keywords: 'long lines multiline ellipsis',
        onSelect: () => void this.updatePrefs({ wrapTitles: !this.prefs.wrapTitles }, false),
      },
    ];
    if (key === 'cardProperties') {
      entries.push({
        label: labels.hideEmptyColumns,
        icon: 'eye-off',
        toggle: !!this.prefs.hideEmptyGroups,
        keepOpen: true,
        onSelect: () => void this.updatePrefs({ hideEmptyGroups: !this.prefs.hideEmptyGroups }, false),
      });
    }
    return entries;
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
      if (collapsed) this.expanding = group.id;
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
      case 'plan': {
        const bucket = value as DeadlineBucket;
        if (bucket === 'none') return muted(labels.planBuckets.none, 'calendar-x');
        const chip = parent.createSpan({ cls: 'taskpro-chip taskpro-schedule-badge taskpro-board__group-chip' });
        if (bucket === 'overdue') chip.dataset.state = 'past';
        this.chipContent(chip, CHIP_ICON_NAMES.scheduleDay, labels.planBuckets[bucket]);
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

  private renderRow(body: HTMLElement, task: BoardTask, columns: readonly BoardColumnPref[], nest?: TableNest): HTMLElement {
    const labels = this.labels;
    const row = body.createEl('tr', { cls: 'taskpro-table__row' });
    row.dataset.status = task.status;
    row.dataset.taskId = task.id;

    const checkCell = row.createEl('td', { cls: 'taskpro-table__check' });
    this.selectButton(checkCell, task);
    this.checkButton(checkCell, task);

    const titleCell = row.createEl('td', { cls: 'taskpro-table__task' });
    this.titleBlock(titleCell, task, true, !columns.some((column) => column.id === 'repeat'), !columns.some((column) => column.id === 'waiting'), nest);
    row.toggleClass('is-waiting', this.relations().isWaiting(task));

    for (const column of columns) this.renderCell(row, task, column.id);

    const moreCell = row.createEl('td', { cls: 'taskpro-table__more' });
    const more = this.iconButton(moreCell, 'more-horizontal', labels.more, () =>
      this.openTaskActions(task, more.getBoundingClientRect(), more)
    );
    this.withTaskActions(row, task);
    return row;
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

  // ── The table on a phone: a list ─────────────────────────────────────────
  // Each task is a row: its checkbox, its title over two lines, and under it
  // the properties the table shows, in the table's order, where they have a
  // value. A tap opens the task's sheet; a swipe toward the trailing side
  // ticks it off, the other way opens its sheet, and the ⋯ and the checkbox
  // do the same for anyone who does not swipe.

  private renderList(tasks: BoardTask[], today: Date): void {
    const labels = this.labels;
    const groupBy = this.prefs.groupBy;
    const groups = groupTasks(tasks, groupBy, { tags: this.settings.tags, today });
    const columns = visibleColumns(this.tableColumns());
    this.bodyEl.addClass('is-list');
    const list = this.bodyEl.createDiv({ cls: 'taskpro-list' });
    list.toggleClass('is-document-order', this.prefs.sortKey === 'document' && (groupBy === 'none' || groupBy === 'note'));

    for (const group of groups) {
      if (groupBy !== 'none') {
        if (!group.tasks.length && groupBy === 'status') continue;
        const collapsed = this.prefs.collapsedGroups.includes(group.id);
        const head = list.createEl('button', { cls: 'taskpro-list__group' });
        head.type = 'button';
        head.toggleClass('is-collapsed', collapsed);
        head.setAttribute('aria-expanded', String(!collapsed));
        setIcon(head.createSpan({ cls: 'taskpro-table__caret' }), 'chevron-down');
        this.groupLabel(head, groupBy, group.value);
        head.createSpan({ cls: 'taskpro-table__group-count', text: String(group.tasks.length) });
        head.addEventListener('click', () => {
          const next = collapsed
            ? this.prefs.collapsedGroups.filter((id) => id !== group.id)
            : [...this.prefs.collapsedGroups, group.id];
          if (collapsed) this.expanding = group.id;
          void this.updatePrefs({ collapsedGroups: next }, false);
        });
        if (collapsed) continue;
      }
      const limit = this.rowLimits.get(group.id) ?? ROWS_PER_PAGE;
      group.tasks.slice(0, limit).forEach((task, index) => {
        const row = this.renderListRow(list, task, columns);
        if (this.expanding === group.id) {
          row.addClass('is-expanding');
          stagger(row, index);
        }
      });
      if (group.tasks.length > limit) {
        const more = list.createEl('button', {
          cls: 'taskpro-kanban__more taskpro-list__more',
          text: labels.showMore(Math.min(ROWS_PER_PAGE, group.tasks.length - limit)),
        });
        more.addEventListener('click', () => {
          this.rowLimits.set(group.id, limit + ROWS_PER_PAGE);
          this.renderBody();
        });
      }
    }
  }

  private renderListRow(list: HTMLElement, task: BoardTask, columns: readonly BoardColumnPref[]): HTMLElement {
    const labels = this.labels;
    const row = list.createDiv({ cls: 'taskpro-list__row' });
    row.dataset.status = task.status;
    row.dataset.taskId = task.id;
    row.toggleClass('is-waiting', this.relations().isWaiting(task));

    // What a swipe uncovers: done on the leading side, the sheet on the trailing one.
    const under = row.createDiv({ cls: 'taskpro-list__under' });
    const done = under.createDiv({ cls: 'taskpro-list__swipe is-done' });
    setIcon(done.createSpan(), task.status === '[x]' ? 'rotate-ccw' : 'check');
    done.createSpan({ text: task.status === '[x]' ? labels.markOpen : labels.markDoneSwipe });
    const more = under.createDiv({ cls: 'taskpro-list__swipe is-more' });
    setIcon(more.createSpan(), 'more-horizontal');
    more.createSpan({ text: labels.moreSwipe });

    const content = row.createDiv({ cls: 'taskpro-list__content' });
    this.checkButton(content, task);
    const main = content.createDiv({ cls: 'taskpro-list__main' });
    main.setAttribute('role', 'button');
    main.tabIndex = 0;
    if (task.depth > 0) {
      main.style.setProperty('--taskpro-depth', String(Math.min(6, Math.round(task.depth / 2))));
      main.addClass('is-subtask');
    }
    const titleLine = main.createDiv({ cls: 'taskpro-list__title-line' });
    titleLine.createSpan({ cls: 'taskpro-list__title', text: displayTitle(task.text) || '—', attr: { dir: 'auto' } });
    if (task.repeat && !columns.some((column) => column.id === 'repeat')) {
      setIcon(titleLine.createSpan({ cls: 'taskpro-board__repeat' }), 'repeat');
    }
    if (!columns.some((column) => column.id === 'waiting') && this.relations().isWaiting(task)) {
      setIcon(titleLine.createSpan({ cls: 'taskpro-board__waiting' }), 'hourglass');
    }

    if ((this.prefs.rowStyle ?? 'light') === 'light') {
      this.lightMeta(main, task, columns);
    } else {
      const props = main.createDiv({ cls: 'taskpro-list__props' });
      for (const { id } of columns) this.listProperty(props, task, id);
      if (!props.childElementCount) props.remove();
    }

    const open = (at: { x: number; y: number } | DOMRect) => this.openTaskActions(task, at, row);
    main.addEventListener('click', () => open(main.getBoundingClientRect()));
    main.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      open(main.getBoundingClientRect());
    });
    const button = this.iconButton(content, 'more-horizontal', labels.more, (event) => {
      event.stopPropagation();
      open(button.getBoundingClientRect());
    });
    button.addClass('taskpro-list__more-btn');
    this.withTaskActions(row, task);
    this.swipeRow(row, content, task);
    return row;
  }

  /**
   * What a row says about a task, as one calm line of small text rather than a
   * wall of chips: when, how urgent, which tags, how far along. Only what is
   * overdue or due today is coloured, so what needs a look stands out. The
   * chips are one tap in (the task's sheet).
   */
  private lightMeta(main: HTMLElement, task: BoardTask, columns: readonly BoardColumnPref[]): void {
    const meta = main.createDiv({ cls: 'taskpro-list__meta' });
    const item = (kind: string, icon: string | null, text: string, state?: string): HTMLElement => {
      const el = meta.createSpan({ cls: `taskpro-meta is-${kind}` });
      if (state) el.dataset.state = state;
      if (icon) setIcon(el.createSpan({ cls: 'taskpro-meta__icon', attr: { 'aria-hidden': 'true' } }), icon);
      el.createSpan({ cls: 'taskpro-meta__text', text, attr: { dir: 'auto' } });
      return el;
    };
    for (const { id } of columns) {
      switch (id) {
        case 'status':
          if (task.status === '[/]') item('status', 'circle-dot', STATUS_LABELS[this.language]['[/]'], 'doing');
          else if (task.status === '[!]') item('status', 'circle-x', STATUS_LABELS[this.language]['[!]'], 'failed');
          break;
        case 'plan':
          if (task.schedule) {
            const options = {
              language: this.language,
              calendarSystem: this.prefs.calendarSystem ?? this.settings.calendarSystem,
              timeFormat: this.settings.calendar.timeFormat,
            };
            const past = task.status !== '[x]' && isSchedulePast(task.schedule);
            item('plan', task.schedule.start ? CHIP_ICON_NAMES.schedule : CHIP_ICON_NAMES.scheduleDay, scheduleText(task.schedule, options), past ? 'past' : undefined);
          }
          break;
        case 'deadline':
          if (task.deadline) {
            const info = getDeadlineInfo(task.deadline, this.language, task.status);
            const text = info.state === 'missed' ? this.labels.buckets.overdue : info.state === 'completed' ? this.formatDate(task.deadline) : info.text;
            item('deadline', CHIP_ICON_NAMES.deadline, text, info.state);
          }
          break;
        case 'priority':
          if (task.priority) {
            const el = item('priority', PRIORITY_ICON_NAMES[task.priority], PRIORITY_LABELS[this.language][task.priority]);
            el.dataset.priority = task.priority;
          }
          break;
        case 'tags':
          if (task.tags.length) {
            const el = meta.createSpan({ cls: 'taskpro-meta is-tags' });
            const shown = task.tags.slice(0, 2).map((key) => resolveTag(key, this.settings.tags));
            for (const tag of shown) {
              const one = el.createSpan({ cls: 'taskpro-meta__tag' });
              one.createSpan({ cls: 'taskpro-meta__dot', attr: { 'aria-hidden': 'true' } }).style.setProperty('--taskpro-dot', resolveTagColor(tag.color));
              one.createSpan({ cls: 'taskpro-meta__text', text: tag.name, attr: { dir: 'auto' } });
            }
            if (task.tags.length > shown.length) el.createSpan({ cls: 'taskpro-meta__more', text: `+${task.tags.length - shown.length}` });
          }
          break;
        case 'waiting':
          if (task.waiting?.length) item('waiting', 'hourglass', String(task.waiting.length));
          break;
        case 'repeat':
          if (task.repeat) item('repeat', CHIP_ICON_NAMES.repeat, getRepeatLabels(this.language).chip(task.repeat));
          break;
        case 'progress': {
          const progress = this.host.getProgress(task);
          const count = this.subtaskProgress(task);
          if (progress?.enabled) {
            const percent = Math.round((progress.currentSteps / progress.totalSteps) * 100);
            this.metaBar(item('progress', null, `${percent}%`), percent);
          } else if (count) {
            this.metaBar(item('progress', null, `${count.done}/${count.total}`), Math.round((count.done / Math.max(1, count.total)) * 100));
          }
          break;
        }
        case 'note':
          if (this.prefs.groupBy !== 'note') item('note', 'file-text', task.fileName);
          break;
      }
    }
    if (!meta.childElementCount) meta.remove();
  }

  /** A thin bar before a progress figure: how far along, at a glance. */
  private metaBar(el: HTMLElement, percent: number): void {
    const bar = createSpan({ cls: 'taskpro-meta__bar', attr: { 'aria-hidden': 'true' } });
    bar.createSpan({ cls: 'taskpro-meta__fill' }).style.setProperty('--taskpro-progress', `${percent}%`);
    el.prepend(bar);
  }

  /** One property under a row's title, when it has a value; each opens its own choices. */
  private listProperty(parent: HTMLElement, task: BoardTask, id: BoardPropertyId): void {
    const cell = () => parent.createDiv({ cls: `taskpro-list__prop is-${id}` });
    switch (id) {
      case 'status':
        // The checkbox already says open or done; the chip says the rest.
        if (task.status === '[/]' || task.status === '[!]') this.statusChip(cell(), task);
        return;
      case 'tags':
        if (task.tags.length) {
          const el = cell();
          this.tagChips(el, task);
          el.addEventListener('click', (event) => {
            event.stopPropagation();
            this.host.editTags(task);
          });
        }
        return;
      case 'priority':
        if (task.priority) this.priorityChip(cell(), task);
        return;
      case 'deadline':
        if (task.deadline) this.deadlineChip(cell(), task);
        return;
      case 'plan':
        if (task.schedule) this.planChip(cell(), task);
        return;
      case 'waiting':
        if (task.waiting?.length) this.waitingChips(cell(), task);
        return;
      case 'repeat':
        if (task.repeat) this.repeatChip(cell(), task);
        return;
      case 'progress':
        if (this.shownProgress(task)) this.progressBar(cell(), task);
        return;
      case 'note':
        this.noteLink(cell(), task);
        return;
    }
  }

  /**
   * A task ticked off, or opened again, from its row. On a phone a tap or a
   * swipe can land by mistake, so the change is announced at the foot of the
   * screen with a way to take it back, and given a short buzz where there is one.
   */
  private changeStatus(task: BoardTask, next: TaskStatus): void {
    const labels = this.labels;
    const before = task.status;
    void this.host.setStatus(task, next);
    if (!this.compact) return;
    haptic(next === '[x]' ? 'success' : 'tick');
    const title = displayTitle(task.text) || task.text;
    // A repeating task starts its next round when it is done; putting this one back would leave that round behind.
    const undoable = !(next === '[x]' && task.repeat);
    showSnackbar({
      container: this.el,
      message: next === '[x]' ? labels.doneToast(title) : labels.reopenedToast(title),
      dismissLabel: labels.qaClose,
      actionLabel: undoable ? labels.undo : undefined,
      onAction: undoable ? () => this.undoStatus(task, before) : undefined,
    });
  }

  private undoStatus(task: BoardTask, before: TaskStatus): void {
    const all = this.host.store.all();
    const fresh = all.find((candidate) => candidate.id === task.id) ?? all.find((candidate) => candidate.filePath === task.filePath && candidate.lineNumber === task.lineNumber);
    if (!fresh) return;
    void this.host.setStatus(fresh, before);
    haptic('tick');
    announce(this.el, this.labels.undoneToast);
  }

  /**
   * A row follows a finger sideways. Let go past the mark on the leading
   * side and the task is ticked off (or opened again); on the trailing side
   * its sheet opens. A finger moving up or down scrolls, as it should.
   */
  private swipeRow(row: HTMLElement, content: HTMLElement, task: BoardTask): void {
    const sign = this.language === 'fa' ? -1 : 1;
    let startX = 0;
    let startY = 0;
    let dx = 0;
    let tracking = false;
    let swiping = false;
    let armed = false;
    /** Puts the row back where it was, and forgets the touch. */
    const cancel = () => {
      tracking = false;
      swiping = false;
      armed = false;
      content.style.transform = '';
      row.removeClass('is-swiping', 'is-armed', 'is-leading', 'is-trailing');
    };
    content.addEventListener('pointerdown', (event) => {
      if (event.pointerType !== 'touch') return;
      // A second finger makes it a gesture of two fingers (the pull to the board, a pinch),
      // and none of them is a swipe on this row.
      if (!event.isPrimary || fingersDown() > 1) {
        if (tracking) cancel();
        return;
      }
      tracking = true;
      swiping = false;
      armed = false;
      dx = 0;
      startX = event.clientX;
      startY = event.clientY;
    });
    content.addEventListener('pointermove', (event) => {
      if (!tracking) return;
      if (fingersDown() > 1) {
        cancel();
        return;
      }
      const mx = event.clientX - startX;
      const my = event.clientY - startY;
      if (!swiping) {
        if (Math.abs(my) > 10 && Math.abs(my) > Math.abs(mx)) {
          tracking = false;
          return;
        }
        if (Math.abs(mx) < 12 || Math.abs(mx) < Math.abs(my) * 1.4) return;
        swiping = true;
        content.setPointerCapture?.(event.pointerId);
        row.addClass('is-swiping');
      }
      dx = mx;
      const lead = dx * sign;
      content.style.transform = `translateX(${Math.round(dx)}px)`;
      row.toggleClass('is-leading', lead > 0);
      row.toggleClass('is-trailing', lead < 0);
      // Past the mark, letting go does it; a tick says so, and going back before letting go changes your mind.
      const now = Math.abs(dx) >= SWIPE_ACT;
      if (now !== armed) {
        armed = now;
        if (armed) haptic('tick');
      }
      row.toggleClass('is-armed', armed);
    });
    const finish = () => {
      if (!tracking) return;
      tracking = false;
      if (!swiping) return;
      const lead = dx * sign;
      cancel();
      // The click this touch ends with is not a tap on the row.
      suppressGestureClick(content, 400);
      if (lead >= SWIPE_ACT) this.changeStatus(task, task.status === '[x]' ? '[ ]' : '[x]');
      else if (lead <= -SWIPE_ACT) this.openTaskActions(task, content.getBoundingClientRect(), row);
    };
    content.addEventListener('pointerup', finish);
    content.addEventListener('pointercancel', cancel);
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
    // A checkbox is named for what it ticks, and its state is said by aria-checked; what a press does is its tooltip.
    button.setAttribute('aria-label', displayTitle(task.text) || task.text);
    button.title = done ? labels.markOpen : labels.markDone;
    // A status that has just changed pops: the tick lands where the row now is.
    if (this.arrivals.changed.has(task.id) && performance.now() <= this.arrivals.until) button.addClass('is-popping');
    // No icon inside: the tick and the cross are CSS masks. A theme's rules
    // for icon buttons key on an <svg> in a <button> and would resize it.
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      this.changeStatus(task, done ? '[ ]' : '[x]');
    });
  }

  /** The title, editable in place; `withRepeat` marks a repeating task when no repeat column says so. */
  private titleBlock(parent: HTMLElement, task: BoardTask, withOpen = true, withRepeat = true, withWaiting = true, nest?: TableNest): void {
    const labels = this.labels;
    const wrap = parent.createDiv({ cls: 'taskpro-board__title-wrap' });
    // In a nested table the depth is what is shown of its ancestors; elsewhere it is how far the line is indented.
    const depth = nest ? nest.depth : task.depth > 0 ? Math.min(6, Math.round(task.depth / 2)) : 0;
    if (depth > 0) {
      wrap.style.setProperty('--taskpro-depth', String(Math.min(6, depth)));
      wrap.addClass('is-subtask');
    }
    const title = wrap.createSpan({ cls: 'taskpro-board__title', text: displayTitle(task.text) || '—' });
    title.setAttribute('dir', 'auto');
    title.setAttribute('role', 'button');
    title.tabIndex = 0;
    title.title = labels.editTitle;
    // On a phone a tap on a title opens the task's sheet, where Rename is; an
    // editor under a finger that only meant to look would be a trap.
    const activate = () => {
      if (this.compact) this.openTaskActions(task, title.getBoundingClientRect(), title);
      else this.startTitleEdit(wrap, title, task);
    };
    title.addEventListener('click', (event) => {
      event.stopPropagation();
      activate();
    });
    title.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        activate();
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

    if (nest?.children) this.foldButton(wrap, task, nest);

    // A card already opens its note from the note link in its footer.
    if (!withOpen) return;
    const card = this.iconButton(wrap, 'maximize-2', labels.openCard, (event) => {
      event.stopPropagation();
      this.openCard(task, card.getBoundingClientRect());
    });
    card.addClass('taskpro-board__open', 'is-card');
    const open = this.iconButton(wrap, 'arrow-up-right', labels.openNote, (event) => {
      event.stopPropagation();
      void this.host.reveal(task);
    });
    open.addClass('taskpro-board__open');
  }

  /** Shows how many subtasks a parent has, and folds them away or brings them back. */
  private foldButton(wrap: HTMLElement, task: BoardTask, nest: TableNest): void {
    const labels = this.labels;
    const fold = wrap.createEl('button', { cls: 'taskpro-board__fold' });
    fold.type = 'button';
    fold.toggleClass('is-folded', nest.folded);
    fold.setAttribute('aria-expanded', String(!nest.folded));
    const text = nest.folded ? labels.showSubtasks(nest.children) : labels.hideSubtasks(nest.children);
    fold.setAttribute('aria-label', text);
    fold.title = text;
    setIcon(fold.createSpan({ cls: 'taskpro-board__fold-caret' }), this.language === 'fa' && nest.folded ? 'chevron-left' : nest.folded ? 'chevron-right' : 'chevron-down');
    fold.createSpan({ cls: 'taskpro-board__fold-count', text: String(nest.children) });
    fold.addEventListener('click', (event) => {
      event.stopPropagation();
      this.setFolded(task, !nest.folded);
    });
  }

  /** Folds a parent's subtasks away, or brings them back; the choice is kept. */
  private setFolded(task: BoardTask, folded: boolean): void {
    const key = foldKey(task);
    const kept = new Set(this.prefs.foldedTasks ?? []);
    if (folded) kept.add(key);
    else {
      kept.delete(key);
      this.revealing = task.id;
    }
    void this.updatePrefs({ foldedTasks: [...kept] }, false);
  }

  /** Whether a task is somewhere below another among the tasks shown. */
  private underTask(id: string, ancestor: string, nesting: ReadonlyMap<string, Nesting>): boolean {
    const seen = new Set<string>([id]);
    let up = nesting.get(id)?.parent;
    while (up && !seen.has(up)) {
      if (up === ancestor) return true;
      seen.add(up);
      up = nesting.get(up)?.parent;
    }
    return false;
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
    const finish = async (save: boolean, refocus = false) => {
      if (done) return;
      done = true;
      const value = input.value.trim();
      const doc = input.ownerDocument;
      if (save && value && value !== task.text) {
        title.setText(displayTitle(value));
        input.replaceWith(title);
        this.editing = false;
        await this.host.setText(task, value);
      } else {
        input.replaceWith(title);
        this.editing = false;
      }
      // Enter or Escape in the field: it held the focus and is gone, so the board's body takes it and the keys go on.
      if (refocus && (!doc.activeElement || doc.activeElement === doc.body)) this.bodyEl.focus({ preventScroll: true });
      if (this.renderQueued) this.renderBody();
    };
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.isComposing) {
        event.preventDefault();
        void finish(true, true);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        void finish(false, true);
      }
    });
    input.addEventListener('blur', () => void finish(true));
  }

  private statusChip(parent: HTMLElement, task: BoardTask): void {
    const chip = buildChip('taskpro-interactive-badge', STATUS_ICON_NAMES[task.status], STATUS_LABELS[this.language][task.status]);
    chip.dataset.status = task.status;
    if (this.arrivals.changed.has(task.id) && performance.now() <= this.arrivals.until) chip.addClass('is-popping');
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
    // Columns nobody hid but that have nothing in them are left out on request; they are not "hidden".
    const groups = all.filter((group) => !hidden.has(group.id) && !(this.prefs.hideEmptyGroups && !group.tasks.length));

    const tabs = this.compact ? this.bodyEl.createDiv({ cls: 'taskpro-kanban-tabs' }) : null;
    const board = this.bodyEl.createDiv({ cls: 'taskpro-kanban' });
    if (tabs) this.renderKanbanTabs(tabs, board, groups, groupBy);
    if (this.prefs.kanbanColumnWidth) board.style.setProperty('--taskpro-kanban-width', `${clampKanbanWidth(this.prefs.kanbanColumnWidth)}px`);
    const droppable = this.canDropInto(groupBy);

    groups.forEach((group, index) => {
      const column = board.createDiv({ cls: 'taskpro-kanban__column' });
      stagger(column, index);
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
      onContextPress(header, (at) => this.openKanbanColumnMenu(group, groupBy, all, at));
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

      if (groupBy !== 'deadline' && groupBy !== 'plan' && groupBy !== 'note') this.renderColumnAdd(column, groupBy, group.value);

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
    });

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

    // On a phone a finger moves the strip of columns one column at a time (see ui/strip-swipe).
    if (this.compact) {
      swipeStrip({
        strip: board,
        panels: () => Array.from(board.querySelectorAll<HTMLElement>(':scope > .taskpro-kanban__column, :scope > .taskpro-kanban__aside')),
        offsetOf: (panel) => this.columnOffset(panel, board),
        rtl: this.language === 'fa',
        enabled: () => !this.bodyEl.hasClass('is-carrying'),
      });
    }
  }

  private kanbanScroll: (() => void) | null = null;
  /** The timer that finishes a tab's scroll to its column, kept so a hand on the board can cancel it. */
  private glideTimer = 0;

  /**
   * On a phone one column fills the screen, so a strip of tabs above says
   * which columns there are, how full each is, and which is in view; a tap
   * scrolls to one.
   */
  private renderKanbanTabs(tabs: HTMLElement, board: HTMLElement, groups: BoardGroup[], groupBy: BoardGroupBy): void {
    const rtl = this.language === 'fa';
    for (const group of groups) {
      const tab = tabs.createEl('button', { cls: 'taskpro-kanban-tabs__tab' });
      tab.type = 'button';
      tab.dataset.group = group.value;
      this.groupLabel(tab, groupBy, group.value);
      tab.createSpan({ cls: 'taskpro-kanban__count', text: String(group.tasks.length) });
      tab.addEventListener('click', () => {
        const column = Array.from(board.querySelectorAll<HTMLElement>(':scope > .taskpro-kanban__column')).find(
          (el) => el.dataset.group === group.value
        );
        if (column) this.scrollToColumn(column, board);
      });
    }
    const mark = () => {
      const view = board.getBoundingClientRect();
      const columns = Array.from(board.querySelectorAll<HTMLElement>(':scope > .taskpro-kanban__column'));
      const current =
        columns.find((el) => {
          const r = el.getBoundingClientRect();
          return rtl ? r.right <= view.right + 24 : r.left >= view.left - 24;
        }) ?? columns[columns.length - 1];
      tabs.querySelectorAll<HTMLElement>('.taskpro-kanban-tabs__tab').forEach((tab) => {
        const active = tab.dataset.group === current?.dataset.group;
        if (active && !tab.hasClass('is-active')) tab.scrollIntoView({ inline: 'nearest', block: 'nearest' });
        tab.toggleClass('is-active', active);
      });
    };
    // The strip of columns scrolls on a phone; the old listener belonged to a strip that has been drawn again.
    this.kanbanScroll = mark;
    board.addEventListener('scroll', mark, { passive: true });
    window.requestAnimationFrame(mark);
  }

  /** Where a scroller's offset puts a column at the leading edge of the board. */
  private columnOffset(column: HTMLElement, scroller: HTMLElement): number {
    const view = scroller.getBoundingClientRect();
    const box = column.getBoundingClientRect();
    const pad = parseFloat(getComputedStyle(scroller).paddingInlineStart) || 0;
    const delta = this.language === 'fa' ? box.right - (view.right - pad) : box.left - (view.left + pad);
    return scroller.scrollLeft + delta;
  }

  /** Brings a column to the leading edge of the board, gliding there where the system allows motion. */
  private scrollToColumn(column: HTMLElement, scroller: HTMLElement = this.bodyEl): void {
    const body = scroller;
    const target = this.columnOffset(column, body);
    const still = this.el.ownerDocument.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    body.scrollTo({ left: target, behavior: still ? 'auto' : 'smooth' });
    // Where a smooth scroll is not honoured, or stops short, it finishes there; unless a hand has taken over meanwhile.
    window.clearTimeout(this.glideTimer);
    const release = () => window.clearTimeout(this.glideTimer);
    body.addEventListener('pointerdown', release, { once: true, passive: true });
    body.addEventListener('wheel', release, { once: true, passive: true });
    this.glideTimer = window.setTimeout(() => {
      body.removeEventListener('pointerdown', release);
      body.removeEventListener('wheel', release);
      if (Math.abs(body.scrollLeft - target) > 2) body.scrollLeft = target;
    }, 400);
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
    header.addEventListener('pointerdown', (down) => {
      if (down.button !== 0 || (down.target as HTMLElement).closest('button, input')) return;
      // A finger holds the header before it drags: a quick swipe scrolls the board.
      if (down.pointerType === 'touch') return;
      this.startColumnDrag(down, header, column, board, drop);
    });
  }

  private startColumnDrag(
    event: PointerEvent,
    header: HTMLElement,
    column: HTMLElement,
    board: HTMLElement,
    drop: (before: string | null) => void
  ): void {
    {
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
        const scroller = this.kanbanScroller() ?? this.bodyEl;
        const view = scroller.getBoundingClientRect();
        if (e.clientX < view.left + 48) scroller.scrollLeft -= 16;
        else if (e.clientX > view.right - 48) scroller.scrollLeft += 16;

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
      // The drop is where the pointer let go, whether or not the browser had
      // delivered its last move by then.
      const onUp = (e: PointerEvent) => {
        onMove(e);
        finish(true);
      };
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
    }
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
      const onUp = (e: Event) => {
        if (e.type === 'pointerup') onMove(e as PointerEvent);
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
    this.newButton(column, KANBAN_NEW, groupBy, value);
  }

  /** What a task added under a group stands for: its status, its priority or its tag. */
  private inheritFrom(groupBy: BoardGroupBy, value: string): { status?: TaskStatus; priority?: TaskPriority; tags?: string[] } {
    if (groupBy === 'status') return { status: value as TaskStatus };
    if (groupBy === 'priority') return { priority: (value || undefined) as TaskPriority | undefined };
    if (groupBy === 'tag') return { tags: value ? [value] : [] };
    return {};
  }

  /**
   * The "+ New" that ends a board column or a group of the table: a quiet
   * button that turns into a field, and adds the task with whatever the group
   * stands for. Enter adds it and keeps the field for the next one, Escape or
   * leaving it empty puts the button back.
   */
  private newButton(parent: HTMLElement, cls: NewClasses, groupBy: BoardGroupBy, value: string): HTMLButtonElement {
    const labels = this.labels;
    const button = parent.createEl('button', { cls: cls.button });
    button.type = 'button';
    if (cls.icon) setIcon(button.createSpan({ cls: cls.icon }), 'plus');
    button.createSpan({ text: labels.newInColumn });
    button.addEventListener('click', () => {
      const input = createEl('input', {
        type: 'text',
        cls: cls.input,
        attr: { placeholder: labels.addPlaceholder, 'aria-label': labels.addPlaceholder, dir: 'auto' },
      });
      autoDirection(input, this.direction);
      button.replaceWith(input);
      this.editing = true;
      input.focus();
      const inherit = this.inheritFrom(groupBy, value);
      // Taking the field out of the page blurs it, which asks to close it again.
      let closed = false;
      const close = () => {
        if (closed) return;
        closed = true;
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
    return button;
  }

  /**
   * Carries a card held on a touch screen: a copy follows the finger, the
   * column under it lights up, the board scrolls sideways near its edges,
   * and letting go over another column moves the task there.
   */
  private carryCard(start: PointerEvent, card: HTMLElement, task: BoardTask, from: string): void {
    const doc = this.el.ownerDocument;
    const groupBy = this.kanbanGrouping();
    const box = this.el.getBoundingClientRect();
    const rect = card.getBoundingClientRect();
    const ghost = card.cloneNode(true) as HTMLElement;
    ghost.addClass('taskpro-card-ghost');
    ghost.style.width = `${rect.width}px`;
    this.el.appendChild(ghost);
    const offsetX = start.clientX - rect.left;
    const offsetY = start.clientY - rect.top;
    card.addClass('is-dragging');
    this.bodyEl.addClass('is-carrying');
    this.hold(true);
    let target: HTMLElement | null = null;
    let lastX = start.clientX;
    let lastY = start.clientY;
    let frame = 0;

    const place = (x: number, y: number) => {
      ghost.style.left = `${Math.round(x - box.left - offsetX)}px`;
      ghost.style.top = `${Math.round(y - box.top - offsetY)}px`;
    };
    const findColumn = (x: number, y: number) => {
      const under = doc.elementFromPoint(x, y) as HTMLElement | null;
      const column = under?.closest<HTMLElement>('.taskpro-kanban__column') ?? null;
      if (column === target) return;
      target?.removeClass('is-drop-target');
      target = column && column.dataset.group !== from ? column : null;
      target?.addClass('is-drop-target');
    };
    // Near an edge the board scrolls on, a little every frame, while the finger rests there.
    const edgeScroll = () => {
      const scroller = this.kanbanScroller() ?? this.bodyEl;
      const view = scroller.getBoundingClientRect();
      const step = lastX < view.left + 40 ? -14 : lastX > view.right - 40 ? 14 : 0;
      if (step) {
        scroller.scrollLeft += step;
        findColumn(lastX, lastY);
      }
      frame = window.requestAnimationFrame(edgeScroll);
    };
    const onMove = (event: PointerEvent) => {
      lastX = event.clientX;
      lastY = event.clientY;
      place(lastX, lastY);
      findColumn(lastX, lastY);
    };
    const finish = (drop: boolean) => {
      doc.removeEventListener('pointermove', onMove, true);
      doc.removeEventListener('pointerup', onUp, true);
      doc.removeEventListener('pointercancel', onCancel, true);
      window.cancelAnimationFrame(frame);
      ghost.remove();
      card.removeClass('is-dragging');
      this.bodyEl.removeClass('is-carrying');
      target?.removeClass('is-drop-target');
      const to = target?.dataset.group;
      if (drop && to !== undefined && to !== from) void this.moveTask(task, groupBy, from, to).finally(() => this.hold(false));
      else this.hold(false);
    };
    const onUp = (event: PointerEvent) => {
      onMove(event);
      finish(true);
    };
    const onCancel = () => finish(false);
    place(start.clientX, start.clientY);
    doc.addEventListener('pointermove', onMove, true);
    doc.addEventListener('pointerup', onUp, true);
    doc.addEventListener('pointercancel', onCancel, true);
    frame = window.requestAnimationFrame(edgeScroll);
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
      // A finger cannot drag and drop the way a mouse does: it holds the card, then carries it.
      card.addEventListener('pointerdown', (event) => {
        if (event.pointerType !== 'touch' || (event.target as HTMLElement).closest('button, input')) return;
        holdToDrag(event, () => this.carryCard(event, card, task, groupValue));
      });
    }

    if (!this.touch) this.selectButton(card, task);
    const shown = visibleColumns(this.cardProperties());
    const top = card.createDiv({ cls: 'taskpro-card__top' });
    this.checkButton(top, task);
    this.titleBlock(top, task, false, !shown.some((column) => column.id === 'repeat'), !shown.some((column) => column.id === 'waiting'));
    card.toggleClass('is-waiting', this.relations().isWaiting(task));
    if (!this.touch) {
      // Raised on hover like the ⋯, Notion's "Open"; a finger opens the card from the sheet's first row.
      const expand = this.iconButton(top, 'maximize-2', labels.openCard, (event) => {
        event.stopPropagation();
        this.openCard(task, card.getBoundingClientRect());
      });
      expand.addClass('taskpro-card__more', 'taskpro-card__open');
    }
    const more = this.iconButton(top, 'more-horizontal', labels.more, () =>
      this.openTaskActions(task, more.getBoundingClientRect(), more)
    );
    more.addClass('taskpro-card__more');
    // Holding a card picks it up, so on a touch screen a tap is what opens its sheet.
    this.withTaskActions(card, task, !draggable);
    card.addEventListener('click', (event) => {
      if ((event.target as HTMLElement).closest('button, input, a, .is-editable, .taskpro-board__title')) return;
      if (this.touch) this.openTaskActions(task, card.getBoundingClientRect(), card);
      else this.openCard(task, card.getBoundingClientRect());
    });

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
