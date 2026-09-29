// ── calendar/calendar-view.ts ─────────────────────────────────────────────
// The task board's calendar layout: month, week, day and agenda views, in the
// Gregorian or the Jalali calendar, over the same tasks, search and filters as
// the table and the kanban board.
//
// Planning is direct manipulation. Drag across the time grid to block out
// time, drag a task to move it or its edges to resize it, drag one out of the
// unscheduled list to give it a place. Every change is a `@schedule(...)` on
// the task's own line; a task created on a day goes into that day's note.
//
// Like the board, this file only builds DOM and talks to the host, so it
// renders the same against the preview harness as inside Obsidian.
// ─────────────────────────────────────────────────────────────────────────────

import { Menu, setIcon } from 'obsidian';
import {
  BoardPreferences,
  CHIP_ICON_NAMES,
  CalendarSettings,
  CalendarSystem,
  CalendarView,
  Language,
  PRIORITY_ICON_NAMES,
  PRIORITY_LABELS,
  PRIORITY_RANK,
  STATUS_ICON_NAMES,
  STATUS_LABELS,
  TaskPriority,
  TaskSchedule,
  TaskStatus,
} from '../types';
import type { BoardSettingsView, TaskBoardHost } from '../board/task-board';
import { BoardTask } from '../board/task-store';
import { getBoardLabels } from '../board/board-localization';
import { displayTitle, noteName } from '../board/board-text';
import { applyTagColor, resolveTag, resolveTagColor } from '../tags';
import { setPriority, setSchedule, setTags } from '../task-metadata';
import { getDeadlineInfo } from '../widget-localization';
import { buildChip } from '../ui/chips';
import { jalaliTextToIso } from '../ui/deadline-editor';
import { OWN_ESCAPE_EVENT, claimEscape } from '../ui/escape-scope';
import {
  DayKey,
  WEEKDAY_NAMES,
  WEEKDAY_NAMES_MIN,
  WEEKDAY_NAMES_SHORT,
  addDays,
  addMonths,
  compareDays,
  daysFrom,
  firstOfMonth,
  formatClock,
  formatClockRange,
  formatDay,
  formatHour,
  isDayKey,
  isSameMonth,
  isWeekend,
  isoWeek,
  lastOfMonth,
  longDay,
  mediumDay,
  monthName,
  monthSpan,
  monthTitle,
  monthWeeks,
  parseClock,
  parseTypedClock,
  partsIn,
  rangeTitle,
  resolveWeekStart,
  shortDay,
  toClock,
  todayKey,
  weekOf,
  weekdayOf,
} from './calendar-dates';
import {
  CalendarItem,
  CalendarItemKind,
  FamilyIndex,
  PlacedBlock,
  ancestorsOf,
  collectItems,
  descendantsOf,
  inFamily,
  indexFamilies,
  layoutBlocks,
  rootOf,
  SidebarRow,
  sidebarRows,
  unscheduledTasks,
} from './calendar-items';
import { CalendarLabels, getCalendarLabels } from './calendar-localization';
import { PopoverHandle, openCalendarPopover } from './calendar-popover';
import { scheduleDayText } from './schedule-text';
import { MenuEntry, MenuSection, closeContextMenu, openContextMenu } from '../ui/context-menu';
import { emptyPanel } from '../ui/sheet';
import { autoDirection } from '../ui/fields';
import type { Entrance } from '../ui/motion';
import { contentHeight } from '../ui/space';
import { holdToDrag, onContextPress } from '../ui/touch';
import {
  TaskActionOptions,
  getActionLabels,
  deadlineSections,
  deleteEntries,
  planSections,
  prioritySections,
  remindHint,
  remindSections,
  repeatSections,
  statusSections,
  tagSections,
  waitingSections,
} from '../board/task-actions';
import type { RelationIndex } from '../board/task-relations';
import { getRepeatLabels } from '../timer-localization';

/** Pixels per hour on the week and day grids. */
const HOUR_HEIGHT = 48;
/** How close an hour mark may be to the now label, in minutes, before it gives way. */
const NOW_LABEL_CLEARANCE = 20;
const DAY_MINUTES = 24 * 60;
/** Heights, in pixels, of a block's lines: a line of title or time, the parent's name, the properties. */
const BLOCK_LINE = 15.5;
const BLOCK_CRUMB = 14;
const BLOCK_PROPS = 21;
/** Pixels a press has to travel before it is a drag rather than a click. */
const DRAG_THRESHOLD = 4;
const AGENDA_DAYS = 14;
/** Distance from the grid's top or bottom edge at which a drag scrolls it. */
const EDGE_SCROLL = 44;
/**
 * How long a drag rests in that strip before the grid starts to move. A drag
 * that begins there, or crosses it on its way somewhere, is not asking to
 * scroll; one that stays is.
 */
const EDGE_DWELL = 320;

const STATUS_ACCENT: Record<TaskStatus, string> = {
  '[ ]': 'var(--interactive-accent)',
  '[/]': 'var(--taskpro-accent-progress)',
  '[!]': 'var(--taskpro-accent-notdone)',
  '[x]': 'var(--taskpro-accent-done)',
};

const DEADLINE_ACCENT: Record<string, string> = {
  missed: 'var(--taskpro-accent-overdue)',
  today: 'var(--taskpro-accent-today)',
  tomorrow: 'var(--taskpro-accent-tomorrow)',
  soon: 'var(--taskpro-accent-soon)',
  week: 'var(--taskpro-accent-week)',
  normal: 'var(--taskpro-accent-normal)',
  completed: 'var(--taskpro-accent-done)',
};

/** What the calendar needs from the board it is a layout of. */
export interface CalendarContext {
  readonly host: TaskBoardHost;
  /** The board's root element. Popovers and drag ghosts are placed inside it. */
  readonly root: HTMLElement;
  settings(): BoardSettingsView;
  prefs(): BoardPreferences;
  updatePrefs(patch: Partial<BoardPreferences>): Promise<void>;
  /**
   * The board's scope with its search and filters applied. The given daily
   * notes are included whatever the scope, so a task planned on a day never
   * vanishes from the day it was planned on.
   */
  tasks(dailyNotes: ReadonlySet<string>): BoardTask[];
  /** Holds (and releases) repaints from note changes while a drag or a picker is open. Counted. */
  hold(on: boolean): void;
  /** The task's right-click menu, with the calendar's own rows first. */
  openTaskActions(task: BoardTask, at: { x: number; y: number } | DOMRect, anchor: HTMLElement, lead?: MenuEntry[]): void;
  /** Repaints the navigation bar and the calendar. */
  refresh(): void;
  /** Repaints the calendar only. */
  rerender(): void;
  /** What the next repaint plays: the view coming in, or a page turning forward or back. */
  enter(kind: Entrance): void;
  showSummary(tasks: readonly BoardTask[]): void;
  /** What every task waits on, for the hourglass on a task that cannot start yet. */
  relations(): RelationIndex;
  /** What the board's filters ask a new task to have, so it shows where it was made. */
  newTaskDefaults(): { status: TaskStatus; priority?: TaskPriority; tags: string[] };
  segmented(
    parent: HTMLElement,
    cls: string,
    items: Array<{ value: string; label: string; icon?: string }>,
    current: string,
    onPick: (value: string) => void
  ): void;
}

interface Range {
  from: DayKey;
  to: DayKey;
  days: DayKey[];
  weeks: DayKey[][];
}

type DropKind = 'time' | 'allday' | 'day' | 'sidebar';

interface DropTarget {
  kind: DropKind;
  el: HTMLElement;
  day?: DayKey;
  start?: number;
  end?: number;
}

interface DragState {
  kind: 'item' | 'resize' | 'create';
  pointerId: number;
  x0: number;
  y0: number;
  x: number;
  y: number;
  started: boolean;
  source: HTMLElement;
  /** The time column the drag began in, for creating and resizing. */
  column?: HTMLElement;
  item?: CalendarItem;
  edge?: 'start' | 'end';
  /** Minutes between the pointer and a timed block's start, kept while it moves. */
  grab: number;
  duration: number;
  day?: DayKey;
  from?: number;
  ghost?: HTMLElement;
  ghostOffset?: { x: number; y: number };
  preview?: HTMLElement;
  highlighted?: HTMLElement | null;
  target?: DropTarget | null;
  frame?: number;
  /** Gives Escape back once the drag is over. */
  releaseEscape?: () => void;
}

interface TimeState {
  allDay: boolean;
  start: number;
  end: number;
}

function sameSchedule(a: TaskSchedule | undefined, b: TaskSchedule): boolean {
  return !!a && a.date === b.date && (a.start ?? '') === (b.start ?? '') && (a.end ?? '') === (b.end ?? '');
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function settingInt(value: number, min: number, max: number, fallback: number): number {
  return Number.isFinite(value) ? clamp(Math.round(value), min, max) : fallback;
}

export class TaskCalendar {
  private anchor: DayKey = todayKey();
  private rootEl: HTMLElement | null = null;
  private scroller: HTMLElement | null = null;
  private stickyEl: HTMLElement | null = null;
  private savedScroll: number | null = null;
  /** On a phone, how far across the week the finger has moved it, for the week that starts `from`. */
  private savedScrollX: { from: DayKey; left: number } | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private clock: number | null = null;
  private renderedToday = '';
  private drag: DragState | null = null;
  private clickGuard = false;
  private popover: PopoverHandle | null = null;
  private inspected: { task: BoardTask; kind: CalendarItemKind; day: DayKey } | null = null;
  private inspectorStale = false;
  /** The tasks of the last render, for pickers opened from it. */
  private lastTasks: BoardTask[] = [];
  private lastNoteDays = new Map<string, DayKey>();
  /** The day a phone's month view lists under the grid. */
  private selectedDay: DayKey | null = null;
  /** Parents and subtasks in the notes the last render drew from. */
  private families: FamilyIndex = indexFamilies([]);
  /** Families folded shut in the unscheduled list, by their outermost task's id. */
  private readonly foldedFamilies = new Set<string>();
  private fallbackTimer: number | null = null;
  /** The small + a click on an empty slot shows, and what closes it. */
  private quickAdd: { el: HTMLElement; release: () => void } | null = null;

  constructor(private readonly ctx: CalendarContext) {}

  // ── Settings ──────────────────────────────────────────────────────────────

  private get prefs(): BoardPreferences {
    return this.ctx.prefs();
  }

  private get settings(): BoardSettingsView {
    return this.ctx.settings();
  }

  private get cal(): CalendarSettings {
    return this.settings.calendar;
  }

  private get language(): Language {
    return this.settings.language;
  }

  private get labels(): CalendarLabels {
    return getCalendarLabels(this.language);
  }

  private get rtl(): boolean {
    return this.language === 'fa';
  }

  /** The calendar shown: the board's own choice, or TaskPro's calendar setting until one is made. */
  get system(): CalendarSystem {
    return this.prefs.calendarSystem ?? this.settings.calendarSystem;
  }

  private get otherSystem(): CalendarSystem {
    return this.system === 'jalali' ? 'gregorian' : 'jalali';
  }

  private get view(): CalendarView {
    return this.prefs.calendarView;
  }

  private get weekStartsOn(): number {
    return resolveWeekStart(this.cal.weekStart, this.system);
  }

  private get slot(): number {
    return settingInt(this.cal.slotMinutes, 5, 60, 15);
  }

  private get defaultDuration(): number {
    return settingInt(this.cal.defaultDurationMinutes, 5, 12 * 60, 60);
  }

  private get win(): Window {
    return this.ctx.root.ownerDocument.defaultView ?? window;
  }

  private get doc(): Document {
    return this.ctx.root.ownerDocument;
  }

  // ── Navigation ────────────────────────────────────────────────────────────

  private range(): Range {
    let days: DayKey[];
    let weeks: DayKey[][] = [];
    switch (this.view) {
      case 'month':
        weeks = monthWeeks(this.anchor, this.system, this.weekStartsOn);
        days = weeks.flat();
        break;
      case 'week':
        days = weekOf(this.anchor, this.weekStartsOn);
        break;
      case 'day':
        days = [this.anchor];
        break;
      default:
        days = daysFrom(this.anchor, AGENDA_DAYS);
    }
    return { from: days[0], to: days[days.length - 1], days, weeks };
  }

  goToday(): void {
    this.ctx.enter('view');
    this.anchor = todayKey();
    this.savedScroll = null;
    this.savedScrollX = null;
    this.ctx.refresh();
  }

  step(delta: number): void {
    this.ctx.enter(delta > 0 ? 'next' : 'prev');
    switch (this.view) {
      case 'month':
        this.anchor = addMonths(this.anchor, this.system, delta);
        break;
      case 'week':
        this.anchor = addDays(this.anchor, 7 * delta);
        break;
      case 'day':
        this.anchor = addDays(this.anchor, delta);
        break;
      default:
        this.anchor = addDays(this.anchor, AGENDA_DAYS * delta);
    }
    this.ctx.refresh();
  }

  openDay(day: DayKey): void {
    this.anchor = day;
    if (this.view === 'day') this.ctx.refresh();
    else void this.ctx.updatePrefs({ calendarView: 'day' });
  }

  private setView(view: CalendarView): void {
    if (view !== this.view) void this.ctx.updatePrefs({ calendarView: view });
  }

  private setSystem(system: CalendarSystem): void {
    if (system !== this.system) void this.ctx.updatePrefs({ calendarSystem: system });
  }

  private titles(range: Range): { title: string; subtitle: string } {
    const { system, otherSystem: other, language } = this;
    if (this.view === 'month') {
      return {
        title: monthTitle(this.anchor, system, language),
        subtitle: monthSpan(firstOfMonth(this.anchor, system), lastOfMonth(this.anchor, system), other, language),
      };
    }
    if (this.view === 'day') {
      const parts = partsIn(this.anchor, other);
      return {
        title: longDay(this.anchor, system, language),
        subtitle: `${parts.day} ${monthName(this.anchor, other, language)} ${parts.year}`,
      };
    }
    return {
      title: rangeTitle(range.from, range.to, system, language),
      subtitle: rangeTitle(range.from, range.to, other, language),
    };
  }

  /** The bar above the calendar: today, back and forward, the period, and the view switches. */
  renderNav(nav: HTMLElement): void {
    nav.empty();
    const labels = this.labels;
    const range = this.range();

    const start = nav.createDiv({ cls: 'taskpro-cal-nav__start' });
    const today = start.createEl('button', { cls: 'taskpro-cal-nav__today', text: labels.today });
    today.type = 'button';
    today.addEventListener('click', () => this.goToday());
    const steps = start.createDiv({ cls: 'taskpro-cal-nav__steps' });
    this.iconButton(steps, this.rtl ? 'chevron-right' : 'chevron-left', labels.previous, () => this.step(-1));
    this.iconButton(steps, this.rtl ? 'chevron-left' : 'chevron-right', labels.next, () => this.step(1));

    const { title, subtitle } = this.titles(range);
    const heading = start.createDiv({ cls: 'taskpro-cal-nav__titles' });
    heading.createEl('h3', { cls: 'taskpro-cal-nav__title', text: title });
    heading.createSpan({ cls: 'taskpro-cal-nav__subtitle', text: subtitle });

    const end = nav.createDiv({ cls: 'taskpro-cal-nav__end' });
    if (this.view === 'day' && this.ctx.host.openDailyNote) {
      this.iconButton(end, 'file-text', labels.openDailyNote, () => {
        void this.ctx.host.openDailyNote?.(this.anchor, this.system);
      }).addClass('taskpro-cal-nav__daily');
    }
    this.ctx.segmented(
      end,
      'taskpro-cal-nav__views',
      (['month', 'week', 'day', 'agenda'] as CalendarView[]).map((value) => ({ value, label: labels.views[value] })),
      this.view,
      (value) => this.setView(value as CalendarView)
    );
    this.ctx.segmented(
      end,
      'taskpro-cal-nav__systems',
      (['gregorian', 'jalali'] as CalendarSystem[]).map((value) => ({ value, label: labels.systems[value] })),
      this.system,
      (value) => this.setSystem(value as CalendarSystem)
    );
    this.iconButton(end, 'sliders-horizontal', labels.viewOptions, (event) => this.showOptions(event));
    if (this.compact) {
      // No room beside the grid on a phone: the unscheduled tasks are a sheet, in every view.
      const free = this.iconButton(end, 'inbox', labels.unscheduled, () => this.openUnscheduledSheet(free));
      free.addClass('taskpro-cal-nav__free');
    } else if (this.view === 'week' || this.view === 'day') {
      const toggle = this.iconButton(end, this.rtl ? 'panel-left' : 'panel-right', labels.sidebar, () => {
        void this.ctx.updatePrefs({ calendarSidebar: !this.prefs.calendarSidebar });
      });
      toggle.toggleClass('is-active', this.prefs.calendarSidebar);
      toggle.setAttribute('aria-pressed', String(this.prefs.calendarSidebar));
    }
  }

  private showOptions(event: MouseEvent): void {
    const labels = this.labels;
    const prefs = this.prefs;
    const menu = new Menu();
    const option = (title: string, icon: string, key: 'calendarShowDeadlines' | 'calendarShowDailyNotes' | 'calendarShowDone') =>
      menu.addItem((item) =>
        item
          .setTitle(title)
          .setIcon(icon)
          .setChecked(prefs[key])
          .onClick(() => void this.ctx.updatePrefs({ [key]: !prefs[key] }))
      );
    option(labels.showDeadlines, 'flag', 'calendarShowDeadlines');
    option(labels.showDailyNotes, 'file-text', 'calendarShowDailyNotes');
    option(labels.showDone, 'check-circle', 'calendarShowDone');
    menu.showAtMouseEvent(event);
  }

  // ── Body ──────────────────────────────────────────────────────────────────

  /** Draws the current view into the board's body. `refocus` returns focus to it after a repaint. */
  renderBody(body: HTMLElement, refocus = false): void {
    this.teardown();
    body.addClass('is-calendar');

    const range = this.range();
    const noteDays = new Map<string, DayKey>();
    for (const day of range.days) {
      for (const path of this.ctx.host.dailyNotesFor?.(day) ?? []) noteDays.set(path, day);
    }
    const tasks = this.ctx.tasks(new Set(noteDays.keys()));
    this.lastTasks = tasks;
    this.lastNoteDays = noteDays;
    this.families = this.familiesOf(tasks);

    const prefs = this.prefs;
    const items = collectItems(tasks, {
      from: range.from,
      to: range.to,
      showDeadlines: prefs.calendarShowDeadlines,
      showNoteTasks: prefs.calendarShowDailyNotes,
      showDone: prefs.calendarShowDone,
      defaultDuration: this.defaultDuration,
      noteDay: (path) => noteDays.get(path),
    });
    const shown = new Map<string, BoardTask>();
    for (const list of items.values()) for (const item of list) shown.set(item.task.id, item.task);
    this.ctx.showSummary(Array.from(shown.values()));
    this.renderedToday = todayKey();

    const root = body.createDiv({ cls: `taskpro-cal taskpro-cal--${this.view}` });
    root.tabIndex = -1;
    root.addEventListener('keydown', (event) => this.onKey(event));
    this.rootEl = root;

    if (this.view === 'month') this.renderMonth(root, range, items);
    else if (this.view === 'agenda') this.renderAgenda(root, range, items);
    else this.renderGrid(root, range, items, tasks, noteDays);

    if (refocus) root.focus({ preventScroll: true });
    this.startClock();
    this.refreshInspector();
  }

  /**
   * Families read from every task of the notes involved, not only those the
   * search let through, so a subtask still knows its parent when the parent
   * is filtered out.
   */
  private familiesOf(tasks: readonly BoardTask[]): FamilyIndex {
    const store = this.ctx.host.store;
    const paths = new Set(tasks.map((task) => task.filePath));
    return indexFamilies(Array.from(paths).flatMap((path) => store.inFile(path)));
  }

  /** Laid out for a phone: the board says so on its root. */
  private get compact(): boolean {
    return this.ctx.root.hasClass('is-compact');
  }

  /** The unscheduled tasks as a sheet; a tap on one opens its card, where it can be planned. */
  private openUnscheduledSheet(anchor: HTMLElement): void {
    this.closePopover();
    this.ctx.hold(true);
    this.popover = openCalendarPopover({
      container: this.ctx.root,
      anchor: anchor.getBoundingClientRect(),
      cls: 'taskpro-cal-free-sheet',
      rtl: this.rtl,
      onClose: () => {
        this.popover = null;
        this.ctx.hold(false);
      },
      build: (el) => this.renderSidebar(el, this.lastTasks, this.lastNoteDays),
    });
  }

  /** The task a subtask is nested under, if it is one. */
  private parentOf(task: BoardTask): BoardTask | undefined {
    return task.parentId ? this.families.byId.get(task.parentId) : undefined;
  }

  destroy(): void {
    this.closePopover();
    this.cancelDrag(false);
    this.teardown();
    if (this.fallbackTimer !== null) this.win.clearTimeout(this.fallbackTimer);
    this.fallbackTimer = null;
  }

  private teardown(): void {
    this.hideQuickAdd();
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    if (this.clock !== null) this.win.clearInterval(this.clock);
    this.clock = null;
    this.rootEl = null;
    this.scroller = null;
    this.stickyEl = null;
  }

  /** Keeps the now line on time, and moves the calendar on at midnight. */
  private startClock(): void {
    this.clock = this.win.setInterval(() => {
      if (todayKey() !== this.renderedToday) {
        if (!this.drag && !this.popover) this.ctx.rerender();
        return;
      }
      this.syncNow();
    }, 30_000);
  }

  /**
   * The line across today's column and its label in the gutter, both at the
   * time it is now. The hour mark the label would sit on gives way to it.
   */
  private syncNow(): void {
    const root = this.rootEl;
    if (!root) return;
    const minutes = this.nowMinutes();
    root.querySelectorAll<HTMLElement>('.taskpro-cal__now').forEach((line) => {
      line.style.setProperty('--start', String(minutes));
    });
    const label = root.querySelector<HTMLElement>('.taskpro-cal__now-label');
    if (!label) return;
    label.style.setProperty('--start', String(minutes));
    label.setText(formatClock(minutes, this.cal.timeFormat, this.language));
    root.querySelectorAll<HTMLElement>('.taskpro-cal__hour').forEach((mark) => {
      const hour = Number(mark.style.getPropertyValue('--hour'));
      mark.toggleClass('is-covered', Math.abs(hour * 60 - minutes) < NOW_LABEL_CLEARANCE);
    });
  }

  private nowMinutes(): number {
    const now = new Date();
    return now.getHours() * 60 + now.getMinutes();
  }

  /**
   * A phone shows three days of the week at a time: where the finger left
   * them, or from today when the week has it.
   */
  private placeThreeDays(scroller: HTMLElement, days: DayKey[]): void {
    const saved = this.savedScrollX;
    if (saved && saved.from === days[0]) {
      scroller.scrollLeft = saved.left;
    } else {
      const col = scroller.querySelector<HTMLElement>('.taskpro-cal__col.is-today');
      if (col) {
        const gutter = scroller.querySelector<HTMLElement>('.taskpro-cal__hours')?.offsetWidth ?? 0;
        const box = scroller.getBoundingClientRect();
        const at = col.getBoundingClientRect();
        scroller.scrollLeft += this.rtl ? at.right - (box.right - gutter) : at.left - (box.left + gutter);
      }
    }
    scroller.addEventListener(
      'scroll',
      () => {
        this.savedScrollX = { from: days[0], left: scroller.scrollLeft };
      },
      { passive: true }
    );
  }

  private markDay(el: HTMLElement, day: DayKey, today: DayKey): void {
    el.dataset.day = day;
    el.toggleClass('is-today', day === today);
    el.toggleClass('is-past', compareDays(day, today) < 0);
    el.toggleClass('is-weekend', isWeekend(day, this.system));
  }

  /** The day's number in the calendar shown, with the month on the 1st and in the first cell. */
  private dayNumber(parent: HTMLElement, day: DayKey, first: boolean): HTMLButtonElement {
    const parts = partsIn(day, this.system);
    const withMonth = parts.day === 1 || first;
    const button = parent.createEl('button', {
      cls: 'taskpro-cal__daynum',
      text: withMonth ? `${parts.day} ${monthName(day, this.system, this.language, true)}` : String(parts.day),
    });
    button.type = 'button';
    button.toggleClass('has-month', withMonth);
    button.setAttribute('aria-label', longDay(day, this.system, this.language));
    button.addEventListener('pointerdown', (event) => event.stopPropagation());
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      this.openDay(day);
    });
    return button;
  }

  /** The same day in the other calendar, small, with its month on its own 1st. */
  private altDate(parent: HTMLElement, day: DayKey, first: boolean): void {
    const other = this.otherSystem;
    const parts = partsIn(day, other);
    const text = parts.day === 1 || first ? `${parts.day} ${monthName(day, other, this.language, true)}` : String(parts.day);
    parent.createSpan({ cls: 'taskpro-cal__alt', text });
  }

  private addButton(parent: HTMLElement, day: DayKey, anchor: HTMLElement): void {
    const button = parent.createEl('button', { cls: 'taskpro-cal__add' });
    button.type = 'button';
    button.setAttribute('aria-label', this.labels.addOn(mediumDay(day, this.system, this.language)));
    setIcon(button.createSpan({ cls: 'taskpro-cal__add-icon' }), 'plus');
    button.addEventListener('pointerdown', (event) => event.stopPropagation());
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      this.openSlotPicker(day, null, anchor);
    });
  }

  // ── Month ─────────────────────────────────────────────────────────────────

  private renderMonth(root: HTMLElement, range: Range, items: Map<DayKey, CalendarItem[]>): void {
    if (this.compact) {
      this.renderCompactMonth(root, range, items);
      return;
    }
    const system = this.system;
    const today = todayKey();

    const head = root.createDiv({ cls: 'taskpro-cal__weekdays' });
    for (const day of range.days.slice(0, 7)) {
      const cell = head.createDiv({ cls: 'taskpro-cal__weekday', text: WEEKDAY_NAMES_SHORT[this.language][weekdayOf(day)] });
      cell.toggleClass('is-weekend', isWeekend(day, system));
    }

    const grid = root.createDiv({ cls: 'taskpro-cal__month' });
    grid.style.setProperty('--taskpro-cal-rows', String(range.weeks.length));
    range.days.forEach((day, index) => {
      const cell = grid.createDiv({ cls: 'taskpro-cal__cell' });
      this.markDay(cell, day, today);
      cell.dataset.drop = 'day';
      cell.toggleClass('is-outside', !isSameMonth(day, this.anchor, system));

      const top = cell.createDiv({ cls: 'taskpro-cal__cell-head' });
      this.dayNumber(top, day, index === 0);
      this.altDate(top, day, index === 0);
      this.addButton(top, day, cell);

      const list = cell.createDiv({ cls: 'taskpro-cal__cell-items' });
      for (const item of items.get(day) ?? []) this.chip(list, item);

      // A double click on the empty part of a day starts a task there.
      cell.addEventListener('dblclick', (event) => {
        if ((event.target as HTMLElement).closest('.taskpro-cal__chip, button')) return;
        this.openSlotPicker(day, null, cell);
      });
      cell.addEventListener('contextmenu', (event) => this.openDayMenu(event, day));
    });

    this.afterLayout(grid, () => this.fitMonth(grid));
    this.observeSize(grid, () => this.fitMonth(grid));
  }

  /**
   * The month on a phone, the way a phone's calendar shows it: a dot for
   * each task under its day, and the chosen day's tasks listed below the
   * grid, each a tap away from its card. A seventh of a phone is too narrow
   * for a task's name, so the names are in the list rather than the cells.
   */
  private renderCompactMonth(root: HTMLElement, range: Range, items: Map<DayKey, CalendarItem[]>): void {
    const labels = this.labels;
    const system = this.system;
    const today = todayKey();
    root.addClass('is-compact-month');
    const inMonth = (day: DayKey) => isSameMonth(day, this.anchor, system);
    if (!this.selectedDay || !inMonth(this.selectedDay)) this.selectedDay = inMonth(today) ? today : this.anchor;
    const selected = this.selectedDay;

    const head = root.createDiv({ cls: 'taskpro-cal__weekdays' });
    for (const day of range.days.slice(0, 7)) {
      const cell = head.createDiv({ cls: 'taskpro-cal__weekday', text: WEEKDAY_NAMES_MIN[this.language][weekdayOf(day)] });
      cell.toggleClass('is-weekend', isWeekend(day, system));
    }
    const grid = root.createDiv({ cls: 'taskpro-cal__month is-dots' });
    grid.style.setProperty('--taskpro-cal-rows', String(range.weeks.length));
    for (const day of range.days) {
      const cell = grid.createEl('button', { cls: 'taskpro-cal__cell' });
      cell.type = 'button';
      this.markDay(cell, day, today);
      cell.dataset.drop = 'day';
      cell.toggleClass('is-outside', !inMonth(day));
      cell.toggleClass('is-selected', day === selected);
      const dayItems = items.get(day) ?? [];
      cell.setAttribute('aria-label', `${mediumDay(day, system, this.language)}${dayItems.length ? ` · ${dayItems.length}` : ''}`);
      cell.createSpan({ cls: 'taskpro-cal__cell-number', text: String(partsIn(day, system).day) });
      const dots = cell.createSpan({ cls: 'taskpro-cal__dots' });
      for (const item of dayItems.slice(0, 3)) {
        const dot = dots.createSpan({ cls: 'taskpro-cal__dot' });
        dot.style.setProperty('--taskpro-cal-accent', this.accent(item));
        dot.toggleClass('is-done', item.task.status === '[x]');
        dot.toggleClass('is-due', item.kind === 'due');
      }
      if (dayItems.length > 3) dots.createSpan({ cls: 'taskpro-cal__dots-more', text: `+${dayItems.length - 3}` });
      cell.addEventListener('click', () => {
        this.selectedDay = day;
        if (!inMonth(day)) this.anchor = day;
        this.ctx.refresh();
      });
    }

    const list = root.createDiv({ cls: 'taskpro-cal__day-list' });
    const listHead = list.createDiv({ cls: 'taskpro-cal__day-list-head' });
    listHead.createSpan({ cls: 'taskpro-cal__day-list-title', text: longDay(selected, system, this.language) });
    const tools = listHead.createDiv({ cls: 'taskpro-cal__day-list-tools' });
    this.iconButton(tools, 'calendar-clock', labels.views.day, () => this.openDay(selected));
    if (this.ctx.host.openDailyNote) {
      this.iconButton(tools, 'file-text', labels.openDailyNote, () => void this.ctx.host.openDailyNote?.(selected, this.system));
    }
    const add = this.iconButton(tools, 'plus', labels.addOn(mediumDay(selected, system, this.language)), () => this.openSlotPicker(selected, null, add));
    const dayItems = items.get(selected) ?? [];
    if (!dayItems.length) list.createDiv({ cls: 'taskpro-cal__day-list-empty', text: labels.nothingOnDay });
    for (const item of dayItems) this.agendaRow(list, item);
  }

  /**
   * Shows as many chips as a day's cell has room for, and a "N more" link
   * standing in for the rest, which opens the day. Cells share one height, so
   * every cell holds the same number.
   */
  private fitMonth(grid: HTMLElement): void {
    const labels = this.labels;
    for (const list of Array.from(grid.querySelectorAll<HTMLElement>('.taskpro-cal__cell-items'))) {
      list.querySelectorAll('.taskpro-cal__more').forEach((el) => el.remove());
      const chips = Array.from(list.children).filter((el): el is HTMLElement => el.hasClass('taskpro-cal__chip'));
      chips.forEach((chip) => chip.removeClass('is-overflow'));
      if (!chips.length) continue;

      const gap = 2;
      const row = chips[0].offsetHeight + gap;
      const room = contentHeight(list);
      if (row <= gap || room <= 0) continue;
      const capacity = Math.max(1, Math.floor((room + gap) / row));
      if (chips.length <= capacity) continue;

      const visible = capacity - 1;
      chips.slice(visible).forEach((chip) => chip.addClass('is-overflow'));
      const day = list.closest<HTMLElement>('[data-day]')?.dataset.day;
      const more = list.createEl('button', { cls: 'taskpro-cal__more', text: labels.more(chips.length - visible) });
      more.type = 'button';
      more.addEventListener('pointerdown', (event) => event.stopPropagation());
      more.addEventListener('click', (event) => {
        event.stopPropagation();
        if (day) this.openDay(day);
      });
    }
  }

  private afterLayout(el: HTMLElement, fn: () => void): void {
    this.win.requestAnimationFrame(() => {
      if (el.isConnected) fn();
    });
  }

  private observeSize(el: HTMLElement, fn: () => void): void {
    const Observer = (this.win as unknown as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver;
    if (!Observer) return;
    let queued = false;
    let lastHeight = el.clientHeight;
    this.resizeObserver = new Observer(() => {
      if (queued || el.clientHeight === lastHeight) return;
      queued = true;
      this.win.requestAnimationFrame(() => {
        queued = false;
        lastHeight = el.clientHeight;
        if (el.isConnected) fn();
      });
    });
    this.resizeObserver.observe(el);
  }

  // ── Week and day ──────────────────────────────────────────────────────────

  private renderGrid(
    root: HTMLElement,
    range: Range,
    items: Map<DayKey, CalendarItem[]>,
    tasks: BoardTask[],
    noteDays: Map<string, DayKey>
  ): void {
    const labels = this.labels;
    const today = todayKey();
    const days = range.days;
    root.addClass('taskpro-cal--grid');
    root.style.setProperty('--taskpro-cal-days', String(days.length));
    root.style.setProperty('--taskpro-cal-hour', `${HOUR_HEIGHT}px`);

    const main = root.createDiv({ cls: 'taskpro-cal__main' });
    const scroller = main.createDiv({ cls: 'taskpro-cal__scroller' });
    this.scroller = scroller;
    const sticky = scroller.createDiv({ cls: 'taskpro-cal__sticky' });
    this.stickyEl = sticky;

    const heads = sticky.createDiv({ cls: 'taskpro-cal__row taskpro-cal__heads' });
    const corner = heads.createDiv({ cls: 'taskpro-cal__gutter taskpro-cal__corner' });
    if (this.view === 'week' && this.system === 'gregorian') corner.setText(labels.week(isoWeek(days[0]).week));
    for (const day of days) {
      const head = heads.createDiv({ cls: 'taskpro-cal__col-head' });
      this.markDay(head, day, today);
      head.createSpan({ cls: 'taskpro-cal__col-weekday', text: WEEKDAY_NAMES_SHORT[this.language][weekdayOf(day)] });
      this.dayNumber(head, day, false);
      this.altDate(head, day, false);
    }

    const allDay = sticky.createDiv({ cls: 'taskpro-cal__row taskpro-cal__allday' });
    allDay.createDiv({ cls: 'taskpro-cal__gutter taskpro-cal__allday-label', text: labels.allDay });
    for (const day of days) {
      const cell = allDay.createDiv({ cls: 'taskpro-cal__allday-cell' });
      this.markDay(cell, day, today);
      cell.dataset.drop = 'allday';
      for (const item of items.get(day) ?? []) {
        if (item.start === undefined) this.chip(cell, item);
      }
      cell.addEventListener('dblclick', (event) => {
        if ((event.target as HTMLElement).closest('.taskpro-cal__chip, button')) return;
        this.openSlotPicker(day, null, cell);
      });
      cell.addEventListener('contextmenu', (event) => this.openDayMenu(event, day));
    }

    const grid = scroller.createDiv({ cls: 'taskpro-cal__row taskpro-cal__grid' });
    const gutter = grid.createDiv({ cls: 'taskpro-cal__gutter taskpro-cal__hours' });
    for (let hour = 1; hour < 24; hour++) {
      const mark = gutter.createDiv({ cls: 'taskpro-cal__hour', text: formatHour(hour, this.cal.timeFormat, this.language) });
      mark.style.setProperty('--hour', String(hour));
    }
    for (const day of days) {
      const col = grid.createDiv({ cls: 'taskpro-cal__col' });
      this.markDay(col, day, today);
      col.dataset.drop = 'time';
      for (const placed of layoutBlocks(items.get(day) ?? [])) this.block(col, placed);
      if (day === today) {
        col.createDiv({ cls: 'taskpro-cal__now' }).style.setProperty('--start', String(this.nowMinutes()));
        gutter.createDiv({ cls: 'taskpro-cal__now-label' });
      }
      col.addEventListener('pointerdown', (event) => this.onColumnPointerDown(event, col, day));
      col.addEventListener('contextmenu', (event) => {
        if (event.target === col) this.openDayMenu(event, day, col);
      });
      // On a touch screen a tap on an empty slot opens the new task's sheet
      // right there; the small + that follows a mouse is for a pointer.
      col.addEventListener('click', (event) => {
        if (event.target !== col || this.clickGuard || (event as PointerEvent).pointerType !== 'touch') return;
        const start = this.floorSlot(this.minutesAt(event.clientY, col));
        const end = Math.min(DAY_MINUTES, start + this.defaultDuration);
        const preview = this.createPreview(col, start, end);
        this.openSlotPicker(day, { start, end }, preview, () => preview.remove());
      });
    }

    if (this.prefs.calendarSidebar) this.renderSidebar(root, tasks, noteDays);
    this.syncNow();

    scroller.scrollTop = this.savedScroll ?? this.initialScroll(days);
    if (this.compact && this.view === 'week') this.placeThreeDays(scroller, days);
    scroller.addEventListener(
      'scroll',
      () => {
        this.savedScroll = scroller.scrollTop;
      },
      { passive: true }
    );
  }

  /** Opens at the configured start of the day, or near now when now is later than a morning's worth. */
  private initialScroll(days: DayKey[]): number {
    let minutes = settingInt(this.cal.dayStartHour, 0, 23, 7) * 60;
    if (days.includes(todayKey())) {
      const now = this.nowMinutes();
      if (now > minutes + 6 * 60) minutes = now - 120;
    }
    return Math.max(0, (minutes * HOUR_HEIGHT) / 60 - 8);
  }

  private renderSidebar(root: HTMLElement, tasks: BoardTask[], noteDays: Map<string, DayKey>): void {
    const labels = this.labels;
    const free = unscheduledTasks(tasks, (task) => noteDays.has(task.filePath));
    const aside = root.createDiv({ cls: 'taskpro-cal__sidebar' });
    aside.dataset.drop = 'sidebar';
    const head = aside.createDiv({ cls: 'taskpro-cal__sidebar-head' });
    head.createSpan({ cls: 'taskpro-cal__sidebar-title', text: labels.unscheduled });
    head.createSpan({ cls: 'taskpro-cal__sidebar-count', text: String(free.length) });
    aside.createDiv({ cls: 'taskpro-cal__sidebar-hint', text: free.length ? labels.unscheduledHint : labels.noUnscheduled });

    const list = aside.createDiv({ cls: 'taskpro-cal__sidebar-list' });
    // A family is one block: its outermost task with a toggle, and its
    // subtasks in a tree under it, the way Notion lists nested pages.
    let children: HTMLElement | null = null;
    let familyOpen = '';
    for (const entry of sidebarRows(free.slice(0, 300), this.families)) {
      const { task, depth, context, family } = entry;
      let parent: HTMLElement = list;
      if (family && depth === 0) {
        const group = list.createDiv({ cls: 'taskpro-cal__family' });
        this.sidebarRow(group, entry, true);
        const folded = this.foldedFamilies.has(family);
        children = folded ? null : group.createDiv({ cls: 'taskpro-cal__family-children' });
        familyOpen = family;
        continue;
      }
      if (family && family === familyOpen) {
        if (!children) continue;
        parent = children;
      } else {
        children = null;
        familyOpen = '';
      }
      this.sidebarRow(parent, { task, depth, context, family }, false);
    }
  }

  /** One row of the unscheduled list; `head` for a family's outermost task. */
  private sidebarRow(parent: HTMLElement, entry: SidebarRow, head: boolean): void {
    const labels = this.labels;
    const { task, depth, context, family } = entry;
    const row = parent.createDiv({ cls: 'taskpro-cal__free' });
    row.style.setProperty('--depth', String(Math.max(0, depth - 1)));
    row.toggleClass('is-child', depth > 0);
    row.toggleClass('is-family-head', head);

    if (head && family) {
      const folded = this.foldedFamilies.has(family);
      const toggle = row.createEl('button', { cls: 'taskpro-cal__fold' });
      toggle.type = 'button';
      toggle.setAttribute('aria-expanded', String(!folded));
      toggle.setAttribute('aria-label', labels.subtasks);
      this.icon(toggle, folded ? (this.rtl ? 'chevron-left' : 'chevron-right') : 'chevron-down');
      toggle.addEventListener('pointerdown', (event) => event.stopPropagation());
      toggle.addEventListener('click', (event) => {
        event.stopPropagation();
        if (folded) this.foldedFamilies.delete(family);
        else this.foldedFamilies.add(family);
        this.ctx.rerender();
      });
    }

    if (context) {
      // A parent that is planned, or done, placed here only for its subtasks.
      row.addClass('is-context');
      this.markFamily(row, task);
      row.style.setProperty('--taskpro-cal-accent', this.accent({ kind: 'scheduled', task }));
      row.setAttribute('role', 'button');
      row.tabIndex = 0;
      row.addEventListener('click', () => this.openInspector(this.itemFor(task), row));
      this.check(row, task);
    } else {
      this.decorate(row, { id: `free:${task.id}`, kind: 'free', task, day: '' });
      this.check(row, task);
    }

    const text = row.createDiv({ cls: 'taskpro-cal__free-text' });
    text.createDiv({ cls: 'taskpro-cal__free-title', text: displayTitle(task.text) || '—', attr: { dir: 'auto' } });
    const meta = createDiv({ cls: 'taskpro-cal__free-meta' });
    if (context && task.schedule) {
      const plan = meta.createSpan({ cls: 'taskpro-cal__free-plan' });
      this.icon(plan, 'calendar-clock');
      plan.createSpan({ text: this.shortScheduleText(task.schedule) });
    }
    if (task.deadline) {
      const due = meta.createSpan({ cls: 'taskpro-cal__free-due' });
      this.icon(due, 'flag');
      due.createSpan({ text: shortDay(task.deadline, this.system, this.language) });
      due.dataset.state = getDeadlineInfo(task.deadline, this.language, task.status).state;
    }
    if (task.priority) this.icon(meta, PRIORITY_ICON_NAMES[task.priority], 'taskpro-cal__free-priority');
    // Subtasks live in their parent's note, so only the outermost row names it.
    if (depth === 0) meta.createSpan({ cls: 'taskpro-cal__free-note', text: task.fileName, attr: { dir: 'auto' } });
    if (meta.childElementCount) text.appendChild(meta);

    if (head && family) {
      const subtasks = descendantsOf(task, this.families);
      const done = subtasks.filter((sub) => sub.status === '[x]').length;
      const count = row.createSpan({ cls: 'taskpro-cal__family-count', text: labels.subtasksDone(done, subtasks.length) });
      count.style.setProperty('--done', String(subtasks.length ? done / subtasks.length : 0));
    }
  }

  /** A task as the item a card is opened for: planned, or not. */
  private itemFor(task: BoardTask): CalendarItem {
    return task.schedule
      ? { id: `scheduled:${task.id}`, kind: 'scheduled', task, day: task.schedule.date }
      : { id: `free:${task.id}`, kind: 'free', task, day: '' };
  }

  // ── Agenda ────────────────────────────────────────────────────────────────

  private renderAgenda(root: HTMLElement, range: Range, items: Map<DayKey, CalendarItem[]>): void {
    const labels = this.labels;
    const today = todayKey();
    const { system, otherSystem: other, language } = this;

    for (const day of range.days) {
      const section = root.createDiv({ cls: 'taskpro-cal__agenda-day' });
      this.markDay(section, day, today);
      section.dataset.drop = 'day';
      section.addEventListener('contextmenu', (event) => this.openDayMenu(event, day));

      const head = section.createDiv({ cls: 'taskpro-cal__agenda-head' });
      const number = head.createEl('button', { cls: 'taskpro-cal__agenda-num', text: String(partsIn(day, system).day) });
      number.type = 'button';
      number.setAttribute('aria-label', longDay(day, system, language));
      number.addEventListener('click', () => this.openDay(day));
      const label = head.createDiv({ cls: 'taskpro-cal__agenda-label' });
      label.createDiv({
        cls: 'taskpro-cal__agenda-weekday',
        text: day === today ? `${WEEKDAY_NAMES[language][weekdayOf(day)]} · ${labels.today}` : WEEKDAY_NAMES[language][weekdayOf(day)],
      });
      const otherParts = partsIn(day, other);
      label.createDiv({ cls: 'taskpro-cal__agenda-date', text: monthTitle(day, system, language) });
      label.createDiv({
        cls: 'taskpro-cal__agenda-alt',
        text: `${otherParts.day} ${monthName(day, other, language)} ${otherParts.year}`,
      });
      this.addButton(head, day, section);

      const list = section.createDiv({ cls: 'taskpro-cal__agenda-items' });
      const dayItems = items.get(day) ?? [];
      if (!dayItems.length) list.createDiv({ cls: 'taskpro-cal__agenda-empty', text: labels.nothingPlanned });
      for (const item of dayItems) this.agendaRow(list, item);
    }
  }

  // ── Items ─────────────────────────────────────────────────────────────────

  private icon(parent: HTMLElement, name: string, cls = ''): HTMLElement {
    const span = parent.createSpan({ cls: `taskpro-cal__icon${cls ? ` ${cls}` : ''}` });
    span.setAttribute('aria-hidden', 'true');
    setIcon(span, name);
    return span;
  }

  private iconButton(parent: HTMLElement, icon: string, label: string, onClick: (event: MouseEvent) => void): HTMLButtonElement {
    const button = parent.createEl('button', { cls: 'clickable-icon taskpro-board__icon-btn' });
    button.type = 'button';
    button.setAttribute('aria-label', label);
    setIcon(button, icon);
    button.addEventListener('click', onClick);
    return button;
  }

  /**
   * Keys and what they do, as key caps: the caps stay left to right whatever
   * the language, so `Esc` never ends up between two Persian words.
   */
  private keyHints(parent: HTMLElement, hints: Array<[key: string, action: string]>): void {
    const row = parent.createDiv({ cls: 'taskpro-cal-keys' });
    for (const [key, action] of hints) {
      const hint = row.createSpan({ cls: 'taskpro-cal-keys__hint' });
      hint.createEl('kbd', { cls: 'taskpro-cal-keys__key', text: key, attr: { dir: 'ltr' } });
      hint.createSpan({ cls: 'taskpro-cal-keys__action', text: action });
    }
  }

  /** The item's colour: its first tag's, else its status's; a deadline's urgency for a due flag. */
  private accent(item: Pick<CalendarItem, 'kind' | 'task'>): string {
    const task = item.task;
    if (item.kind === 'due' && task.deadline) {
      return DEADLINE_ACCENT[getDeadlineInfo(task.deadline, this.language, task.status).state] ?? STATUS_ACCENT['[ ]'];
    }
    if (task.tags.length) return resolveTagColor(resolveTag(task.tags[0], this.settings.tags).color);
    // A subtask with no tag of its own wears its parent's, so a family reads as one.
    const tagged = ancestorsOf(task, this.families).find((ancestor) => ancestor.tags.length);
    if (tagged) return resolveTagColor(resolveTag(tagged.tags[0], this.settings.tags).color);
    return STATUS_ACCENT[task.status];
  }

  private scheduleText(schedule: TaskSchedule): string {
    const day = mediumDay(schedule.date, this.system, this.language);
    const start = parseClock(schedule.start);
    if (start === null) return day;
    const end = parseClock(schedule.end);
    const format = this.cal.timeFormat;
    return end === null ? `${day}, ${formatClock(start, format, this.language)}` : `${day}, ${formatClockRange(start, end, format, this.language)}`;
  }

  /** "Today 14:00", "Thu 1 Oct": enough to tell a planned task from an unplanned one. */
  private shortScheduleText(schedule: TaskSchedule): string {
    const options = { language: this.language, calendarSystem: this.system, timeFormat: this.cal.timeFormat };
    const start = parseClock(schedule.start);
    const day = scheduleDayText(schedule.date, options);
    return start === null ? day : `${day} ${formatClock(start, this.cal.timeFormat, this.language)}`;
  }

  private describe(item: CalendarItem): string {
    const task = item.task;
    const lines = [displayTitle(task.text) || '—'];
    const parent = this.parentOf(task);
    if (parent) lines.push(`${this.labels.partOf}: ${displayTitle(parent.text) || '—'}`);
    if (task.schedule) lines.push(this.scheduleText(task.schedule));
    if (task.deadline) lines.push(`${this.labels.due} ${mediumDay(task.deadline, this.system, this.language)}`);
    const waiting = this.ctx.relations().openBlockers(task);
    if (waiting.length) {
      lines.push(`${getActionLabels(this.language).waitingOn}: ${waiting.map((blocker) => displayTitle(blocker.text) || '—').join(this.language === 'fa' ? '، ' : ', ')}`);
    }
    lines.push(task.fileName);
    return lines.join('\n');
  }

  /** An hourglass by the title of a task still waiting on another. */
  private waitingMark(parent: HTMLElement, task: BoardTask): void {
    if (this.ctx.relations().isWaiting(task)) this.icon(parent, 'hourglass', 'taskpro-cal__waiting');
  }

  /** What every item shares: its colour and state, the press that drags it, the click that opens it. */
  private decorate(el: HTMLElement, item: CalendarItem): void {
    el.addClass('taskpro-cal__item');
    el.dataset.itemId = item.id;
    el.dataset.taskId = item.task.id;
    el.dataset.kind = item.kind;
    el.dataset.status = item.task.status;
    el.style.setProperty('--taskpro-cal-accent', this.accent(item));
    el.toggleClass('is-done', item.task.status === '[x]');
    el.toggleClass('is-waiting', this.ctx.relations().isWaiting(item.task));
    this.markFamily(el, item.task);
    el.setAttribute('role', 'button');
    el.tabIndex = 0;
    el.title = this.describe(item);
    el.addEventListener('pointerdown', (event) => this.onItemPointerDown(event, item, el));
    el.addEventListener('click', (event) => {
      event.stopPropagation();
      if (this.clickGuard) return;
      this.openInspector(item, el);
    });
    el.addEventListener('keydown', (event) => {
      if (event.key === 'Delete' && this.ctx.host.deleteTask) {
        event.preventDefault();
        event.stopPropagation();
        void this.ctx.host.deleteTask(item.task);
        return;
      }
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      event.stopPropagation();
      this.openInspector(item, el);
    });
    el.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (this.drag?.started) return;
      this.closePopover();
      const openCard: MenuEntry = {
        label: this.labels.openCard,
        icon: 'panel-top-open',
        hint: 'Enter',
        onSelect: () => {
          if (el.isConnected) this.openInspector(item, el);
        },
      };
      this.openActions(item.task, { x: event.clientX, y: event.clientY }, el, [openCard]);
    });
  }

  /**
   * Tags a family's members with their outermost task, and on hover rings
   * every member on screen, so subtasks planned apart are still seen together.
   */
  private markFamily(el: HTMLElement, task: BoardTask): void {
    if (!inFamily(task, this.families)) return;
    const family = rootOf(task, this.families).id;
    el.dataset.family = family;
    el.addEventListener('pointerenter', () => {
      if (this.drag?.started) return;
      this.rootEl?.querySelectorAll<HTMLElement>('[data-family]').forEach((other) => {
        other.toggleClass('is-family-lit', other.dataset.family === family && other !== el);
      });
    });
    el.addEventListener('pointerleave', () => {
      this.rootEl?.querySelectorAll('.is-family-lit').forEach((other) => other.removeClass('is-family-lit'));
    });
  }

  /** The parent's name, small, above a subtask's title. */
  private parentCrumb(parent: HTMLElement, task: BoardTask, cls: string): void {
    const up = this.parentOf(task);
    if (!up) return;
    const crumb = parent.createDiv({ cls: `taskpro-cal__crumb ${cls}` });
    this.icon(crumb, this.rtl ? 'corner-down-left' : 'corner-down-right', 'taskpro-cal__crumb-icon');
    crumb.createSpan({ cls: 'taskpro-cal__crumb-text', text: displayTitle(up.text) || '—', attr: { dir: 'auto' } });
  }

  /**
   * The task menu, as the only panel open: a card, a picker or the + goes
   * first, so the menu never sits over a card. `anchor` is where the full
   * chip menu opens from, so it has to outlive the card.
   */
  private openActions(task: BoardTask, at: { x: number; y: number } | DOMRect, anchor: HTMLElement, lead?: MenuEntry[]): void {
    this.closePopover();
    this.hideQuickAdd();
    this.ctx.openTaskActions(task, at, anchor, lead);
  }

  /** The task's item on screen, or the calendar itself when it has none. */
  private itemElement(task: BoardTask): HTMLElement {
    const items = this.rootEl?.querySelectorAll<HTMLElement>('.taskpro-cal__item') ?? [];
    for (const el of Array.from(items)) {
      if (el.dataset.itemId?.endsWith(`:${task.id}`)) return el;
    }
    return this.rootEl ?? this.ctx.root;
  }

  /** What the task menus need to know, for one task. */
  private actionOptions(task: BoardTask, anchor: HTMLElement): TaskActionOptions {
    return {
      host: this.ctx.host,
      task,
      language: this.language,
      calendarSystem: this.system,
      timeFormat: this.cal.timeFormat,
      tags: this.settings.tags,
      anchor,
      planReminder: this.settings.planReminder,
    };
  }

  /** One property's choices, opened under its chip in the task card. */
  private dropdown(chip: HTMLElement, sections: MenuSection[]): void {
    this.ctx.hold(true);
    openContextMenu({
      container: this.ctx.root,
      at: chip.getBoundingClientRect(),
      rtl: this.rtl,
      sections,
      onClose: () => this.ctx.hold(false),
    });
  }

  /**
   * Right click on an empty slot or day: a task there, the day's note, the
   * day on its own.
   */
  private openDayMenu(event: MouseEvent, day: DayKey, col?: HTMLElement): void {
    event.preventDefault();
    event.stopPropagation();
    if (this.drag?.started) return;
    this.closePopover();
    const labels = this.labels;
    const point = { x: event.clientX, y: event.clientY };
    const entries: MenuEntry[] = [];
    if (col) {
      const start = this.floorSlot(this.minutesAt(event.clientY, col));
      const end = Math.min(DAY_MINUTES, start + this.defaultDuration);
      entries.push({
        label: labels.newTaskAt(formatClock(start, this.cal.timeFormat, this.language)),
        icon: 'plus',
        onSelect: () => {
          if (!col.isConnected) return;
          const preview = this.createPreview(col, start, end);
          this.openSlotPicker(day, { start, end }, preview, () => preview.remove());
        },
      });
    } else {
      entries.push({
        label: labels.newTaskOnDay,
        icon: 'plus',
        onSelect: () => this.openSlotPicker(day, null, new DOMRect(point.x, point.y, 1, 1)),
      });
    }
    const more: MenuEntry[] = [];
    if (this.ctx.host.openDailyNote) {
      more.push({ label: labels.openDailyNote, icon: 'file-text', onSelect: () => this.ctx.host.openDailyNote?.(day, this.system) });
    }
    if (this.view !== 'day') more.push({ label: labels.viewDay, icon: 'calendar-days', onSelect: () => this.openDay(day) });
    this.ctx.hold(true);
    openContextMenu({
      container: this.ctx.root,
      at: point,
      rtl: this.rtl,
      header: longDay(day, this.system, this.language),
      sections: [{ entries }, { entries: more }],
      onClose: () => this.ctx.hold(false),
    });
  }

  /** The round checkbox the board uses, sized for a calendar item. */
  private check(parent: HTMLElement, task: BoardTask): void {
    const board = getBoardLabels(this.language);
    const done = task.status === '[x]';
    const button = parent.createEl('button', { cls: 'taskpro-board__check taskpro-cal__check' });
    button.type = 'button';
    button.dataset.status = task.status;
    button.setAttribute('role', 'checkbox');
    button.setAttribute('aria-checked', task.status === '[/]' ? 'mixed' : String(done));
    button.setAttribute('aria-label', done ? board.markOpen : board.markDone);
    button.addEventListener('pointerdown', (event) => event.stopPropagation());
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      void this.ctx.host.setStatus(task, done ? '[ ]' : '[x]');
    });
  }

  private chip(parent: HTMLElement, item: CalendarItem): HTMLElement {
    const chip = parent.createDiv({ cls: `taskpro-cal__chip is-${item.kind}` });
    this.decorate(chip, item);
    if (item.kind === 'due') this.icon(chip, 'flag', 'taskpro-cal__chip-flag');
    else this.check(chip, item.task);
    if (item.start !== undefined) {
      chip.createSpan({ cls: 'taskpro-cal__chip-time', text: formatClock(item.start, this.cal.timeFormat, this.language) });
    }
    chip.createSpan({ cls: 'taskpro-cal__chip-title', text: displayTitle(item.task.text) || '—', attr: { dir: 'auto' } });
    this.waitingMark(chip, item.task);
    if (item.dueHere) this.icon(chip, 'flag', 'taskpro-cal__chip-flag is-due-here');
    return chip;
  }

  private block(col: HTMLElement, placed: PlacedBlock): void {
    const { item, lane, lanes } = placed;
    const start = item.start!;
    const end = item.end!;
    const el = col.createDiv({ cls: 'taskpro-cal__block' });
    el.style.setProperty('--start', String(start));
    el.style.setProperty('--duration', String(end - start));
    el.style.setProperty('--lane', String(lane));
    el.style.setProperty('--lanes', String(lanes));
    el.toggleClass('is-short', end - start < 45);
    // An hour has room for one line of title and the time under it.
    el.toggleClass('is-compact', end - start >= 45 && end - start < 75);
    this.decorate(el, item);

    // From an hour and a quarter there is room for the parent's name above the title.
    // What fits is worked out from the block's height: the time always, the
    // parent's name and the properties when there is room, and as many lines
    // of title as are left, so nothing is cut through the middle.
    const duration = end - start;
    let room = (duration * HOUR_HEIGHT) / 60 - 2 - 8 - BLOCK_LINE;
    const crumb = duration >= 75 && !!this.parentOf(item.task);
    if (crumb) room -= BLOCK_CRUMB;
    let props = duration >= 90 && this.hasBlockProps(item);
    if (props && room - BLOCK_PROPS < BLOCK_LINE * 2) props = false;
    if (props) room -= BLOCK_PROPS;
    el.style.setProperty('--title-lines', String(clamp(Math.floor(room / BLOCK_LINE), 1, 4)));

    if (crumb) this.parentCrumb(el, item.task, 'taskpro-cal__block-crumb');
    const top = el.createDiv({ cls: 'taskpro-cal__block-top' });
    this.check(top, item.task);
    top.createSpan({ cls: 'taskpro-cal__block-title', text: displayTitle(item.task.text) || '—', attr: { dir: 'auto' } });
    this.waitingMark(top, item.task);
    if (item.dueHere) this.icon(top, 'flag', 'taskpro-cal__chip-flag is-due-here');
    el.createDiv({ cls: 'taskpro-cal__block-time', text: formatClockRange(start, end, this.cal.timeFormat, this.language) });
    if (props) this.blockProps(el, item);
    el.createDiv({ cls: 'taskpro-cal__resize is-start' });
    el.createDiv({ cls: 'taskpro-cal__resize is-end' });
  }

  private hasBlockProps(item: CalendarItem): boolean {
    const task = item.task;
    return !!task.priority || !!task.repeat || (!!task.deadline && !item.dueHere) || task.tags.length > 0;
  }

  private blockProps(el: HTMLElement, item: CalendarItem): void {
    const task = item.task;
    const props = el.createDiv({ cls: 'taskpro-cal__block-props' });
    if (task.priority) this.icon(props, PRIORITY_ICON_NAMES[task.priority], 'taskpro-cal__block-prop').dataset.priority = task.priority;
    if (task.repeat) this.icon(props, 'repeat', 'taskpro-cal__block-prop');
    if (task.deadline && !item.dueHere) {
      const due = props.createSpan({ cls: 'taskpro-cal__block-prop is-due' });
      this.icon(due, 'flag');
      due.createSpan({ text: shortDay(task.deadline, this.system, this.language) });
    }
    for (const key of task.tags.slice(0, 2)) {
      const tag = resolveTag(key, this.settings.tags);
      applyTagColor(props.createSpan({ cls: 'taskpro-chip taskpro-tag-chip taskpro-cal__block-tag', text: tag.name }), tag.color);
    }
    if (!props.childElementCount) props.remove();
  }

  private agendaRow(list: HTMLElement, item: CalendarItem): void {
    const labels = this.labels;
    const task = item.task;
    const row = list.createDiv({ cls: `taskpro-cal__agenda-item is-${item.kind}` });
    this.decorate(row, item);
    const time =
      item.start !== undefined
        ? formatClockRange(item.start, item.end!, this.cal.timeFormat, this.language)
        : item.kind === 'due'
          ? labels.due
          : labels.allDay;
    row.createDiv({ cls: 'taskpro-cal__agenda-time', text: time });
    row.createDiv({ cls: 'taskpro-cal__agenda-bar' });
    if (item.kind === 'due') this.icon(row, 'flag', 'taskpro-cal__chip-flag');
    else this.check(row, task);
    const titles = row.createDiv({ cls: 'taskpro-cal__agenda-titles' });
    this.parentCrumb(titles, task, 'taskpro-cal__agenda-crumb');
    const title = titles.createDiv({ cls: 'taskpro-cal__agenda-title', text: displayTitle(task.text) || '—', attr: { dir: 'auto' } });
    this.waitingMark(title, task);

    const meta = row.createDiv({ cls: 'taskpro-cal__agenda-meta' });
    for (const key of task.tags.slice(0, 3)) {
      const tag = resolveTag(key, this.settings.tags);
      const chip = meta.createSpan({ cls: 'taskpro-chip taskpro-tag-chip', text: tag.name });
      applyTagColor(chip, tag.color);
    }
    if (task.priority) this.icon(meta, PRIORITY_ICON_NAMES[task.priority], 'taskpro-cal__agenda-priority').dataset.priority = task.priority;
    if (item.dueHere) this.icon(meta, 'flag', 'taskpro-cal__chip-flag is-due-here');
    meta.createSpan({ cls: 'taskpro-cal__agenda-note', text: task.fileName, attr: { dir: 'auto' } });
  }

  // ── Dragging ──────────────────────────────────────────────────────────────
  // Pointer events rather than HTML drag and drop: one controller moves chips,
  // blocks and list rows alike, shows where a drop will land while it is
  // dragged, and scrolls the grid at its edges. Touch is left to scroll; a tap
  // opens the same pickers a click does.

  /** Minutes after midnight at a screen height in a time column. */
  private minutesAt(clientY: number, col: HTMLElement): number {
    return ((clientY - col.getBoundingClientRect().top) / HOUR_HEIGHT) * 60;
  }

  private floorSlot(minutes: number): number {
    return clamp(Math.floor(minutes / this.slot) * this.slot, 0, DAY_MINUTES - this.slot);
  }

  private roundSlot(minutes: number): number {
    return clamp(Math.round(minutes / this.slot) * this.slot, 0, DAY_MINUTES);
  }

  private onItemPointerDown(event: PointerEvent, item: CalendarItem, el: HTMLElement): void {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest('button, input')) return;
    // A finger holds a task to pick it up; one that moves at once scrolls the calendar.
    if (event.pointerType === 'touch') {
      holdToDrag(event, () => this.pressItem(event, item, el));
      return;
    }
    this.pressItem(event, item, el);
  }

  private pressItem(event: PointerEvent, item: CalendarItem, el: HTMLElement): void {
    const target = event.target as HTMLElement;
    // No default: that would start a text selection. Focus moves to the
    // calendar itself, so its keys work next.
    event.preventDefault();
    event.stopPropagation();
    this.rootEl?.focus({ preventScroll: true });

    const edge = target.closest('.taskpro-cal__resize');
    const col = el.closest<HTMLElement>('.taskpro-cal__col') ?? undefined;
    const timed = item.start !== undefined && item.end !== undefined;
    const duration = timed ? item.end! - item.start! : this.defaultDuration;
    const grab = timed && col ? clamp(this.minutesAt(event.clientY, col) - item.start!, 0, duration) : 0;
    this.beginDrag(event, {
      kind: edge ? 'resize' : 'item',
      edge: edge?.hasClass('is-start') ? 'start' : 'end',
      item,
      source: el,
      column: col,
      grab,
      duration,
    });
  }

  private onColumnPointerDown(event: PointerEvent, col: HTMLElement, day: DayKey): void {
    if (event.button !== 0 || event.target !== col) return;
    if (event.pointerType === 'touch') {
      holdToDrag(event, () => this.pressColumn(event, col, day));
      return;
    }
    this.pressColumn(event, col, day);
  }

  /** A press on an empty part of a day: dragging it out makes a block. */
  private pressColumn(event: PointerEvent, col: HTMLElement, day: DayKey): void {
    event.preventDefault();
    this.rootEl?.focus({ preventScroll: true });
    this.beginDrag(event, {
      kind: 'create',
      source: col,
      column: col,
      day,
      from: this.floorSlot(this.minutesAt(event.clientY, col)),
      grab: 0,
      duration: this.slot,
    });
  }

  private beginDrag(
    event: PointerEvent,
    state: Omit<DragState, 'pointerId' | 'x0' | 'y0' | 'x' | 'y' | 'started'>
  ): void {
    this.cancelDrag(false);
    this.drag = { ...state, pointerId: event.pointerId, x0: event.clientX, y0: event.clientY, x: event.clientX, y: event.clientY, started: false };
    this.win.addEventListener('pointermove', this.onPointerMove);
    this.win.addEventListener('pointerup', this.onPointerUp);
    this.win.addEventListener('pointercancel', this.onPointerCancel);
  }

  private removeDragListeners(): void {
    this.win.removeEventListener('pointermove', this.onPointerMove);
    this.win.removeEventListener('pointerup', this.onPointerUp);
    this.win.removeEventListener('pointercancel', this.onPointerCancel);
  }

  private readonly onPointerMove = (event: PointerEvent): void => {
    const drag = this.drag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    drag.x = event.clientX;
    drag.y = event.clientY;
    if (!drag.started) {
      if (Math.hypot(drag.x - drag.x0, drag.y - drag.y0) < DRAG_THRESHOLD) return;
      this.startDragging(drag);
    }
    this.updateDrag(drag);
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    const drag = this.drag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    this.removeDragListeners();

    if (!drag.started) {
      this.drag = null;
      // A click on an empty slot offers a task there with a small +, rather
      // than opening the picker at every click on the grid. A click on an
      // item is its own click handler's.
      if (drag.kind === 'create' && drag.column && drag.day && drag.from !== undefined) {
        this.showQuickAdd(drag.column, drag.day, drag.from);
      }
      return;
    }

    this.guardClick();
    // The drop is where the pointer let go, whether or not the browser had
    // delivered its last move by then.
    drag.x = event.clientX;
    drag.y = event.clientY;
    this.updateDrag(drag);
    if (drag.kind === 'create') {
      const target = drag.target;
      const preview = drag.preview;
      drag.preview = undefined;
      // The picker takes its own hold on repaints before the drag lets go of
      // its one, so the block it points at is still on screen when it opens.
      if (target?.day && target.start !== undefined && target.end !== undefined && preview) {
        this.openSlotPicker(target.day, { start: target.start, end: target.end }, preview, () => preview.remove());
      } else {
        preview?.remove();
      }
      this.finishDrag(drag);
      return;
    }
    void this.commitDrag(drag);
  };

  private readonly onPointerCancel = (event: PointerEvent): void => {
    if (this.drag && event.pointerId === this.drag.pointerId) this.cancelDrag(true);
  };

  /** A click fires after the pointer is released; this one belongs to the drag. */
  private guardClick(): void {
    this.clickGuard = true;
    this.win.setTimeout(() => {
      this.clickGuard = false;
    }, 0);
  }

  private startDragging(drag: DragState): void {
    drag.started = true;
    this.hideQuickAdd();
    this.ctx.hold(true);
    this.closePopover();
    // Escape drops the drag where it began, and does not close the floating board.
    drag.releaseEscape = claimEscape(() => this.cancelDrag(true), this.doc);
    this.rootEl?.addClass('is-dragging');
    if (drag.kind === 'create') return;
    drag.source.addClass('is-drag-source');
    if (drag.kind === 'item' && drag.item) {
      const ghost = this.ctx.root.createDiv({ cls: 'taskpro-cal__chip taskpro-cal__ghost' });
      ghost.style.setProperty('--taskpro-cal-accent', this.accent(drag.item));
      if (drag.item.kind === 'due') this.icon(ghost, 'flag', 'taskpro-cal__chip-flag');
      ghost.createSpan({ cls: 'taskpro-cal__chip-title', text: displayTitle(drag.item.task.text) || '—', attr: { dir: 'auto' } });
      const rect = drag.source.getBoundingClientRect();
      ghost.style.width = `${Math.min(260, Math.max(120, rect.width))}px`;
      drag.ghost = ghost;
      drag.ghostOffset = { x: clamp(drag.x0 - rect.left, 0, 40), y: clamp(drag.y0 - rect.top, 0, 14) };
    }
    this.scrollLoop(drag);
  }

  private updateDrag(drag: DragState): void {
    if (drag.kind === 'create') this.updateCreate(drag);
    else if (drag.kind === 'resize') this.updateResize(drag);
    else this.updateMove(drag);
  }

  private updateCreate(drag: DragState): void {
    const col = drag.column!;
    const at = this.floorSlot(this.minutesAt(drag.y, col));
    const start = Math.min(drag.from!, at);
    const end = Math.min(DAY_MINUTES, Math.max(drag.from!, at) + this.slot);
    drag.target = { kind: 'time', el: col, day: drag.day, start, end };
    if (!drag.preview) drag.preview = this.createPreview(col, start, end);
    else this.movePreview(drag.preview, start, end);
  }

  private updateResize(drag: DragState): void {
    const item = drag.item!;
    const col = drag.column!;
    const at = this.roundSlot(this.minutesAt(drag.y, col));
    let start = item.start!;
    let end = item.end!;
    if (drag.edge === 'start') start = clamp(at, 0, end - this.slot);
    else end = clamp(at, start + this.slot, DAY_MINUTES);
    drag.source.style.setProperty('--start', String(start));
    drag.source.style.setProperty('--duration', String(end - start));
    drag.source.toggleClass('is-short', end - start < 45);
    drag.source.toggleClass('is-compact', end - start >= 45 && end - start < 75);
    drag.source.querySelector('.taskpro-cal__block-time')?.setText(formatClockRange(start, end, this.cal.timeFormat, this.language));
    drag.target = { kind: 'time', el: col, day: item.day, start, end };
  }

  private updateMove(drag: DragState): void {
    const zone = this.zoneAt(drag);
    if (drag.highlighted && drag.highlighted !== zone?.el) drag.highlighted.removeClass('is-drop-target');
    drag.highlighted = zone && zone.kind !== 'time' ? zone.el : null;
    drag.highlighted?.addClass('is-drop-target');

    if (drag.ghost) {
      const box = this.ctx.root.getBoundingClientRect();
      drag.ghost.style.left = `${drag.x - box.left - (drag.ghostOffset?.x ?? 0)}px`;
      drag.ghost.style.top = `${drag.y - box.top - (drag.ghostOffset?.y ?? 0)}px`;
      drag.ghost.toggleClass('is-hidden', zone?.kind === 'time');
    }

    if (zone?.kind === 'time' && zone.day) {
      const start = clamp(this.roundSlot(this.minutesAt(drag.y, zone.el) - drag.grab), 0, DAY_MINUTES - drag.duration);
      const end = start + drag.duration;
      drag.target = { kind: 'time', el: zone.el, day: zone.day, start, end };
      if (drag.preview && drag.preview.parentElement === zone.el) this.movePreview(drag.preview, start, end);
      else {
        drag.preview?.remove();
        drag.preview = this.createPreview(zone.el, start, end, drag.item);
      }
    } else {
      drag.preview?.remove();
      drag.preview = undefined;
      drag.target = zone;
    }
  }

  /** The drop zone under the pointer: a time column, an all-day cell, a day, or the unscheduled list. */
  private zoneAt(drag: DragState): DropTarget | null {
    const hit = this.doc.elementFromPoint(drag.x, drag.y) as HTMLElement | null;
    const zone = hit?.closest<HTMLElement>('[data-drop]');
    if (!zone || !this.rootEl?.contains(zone)) return null;
    const kind = zone.dataset.drop as DropKind;
    if (kind === 'sidebar') return drag.item?.kind === 'scheduled' ? { kind, el: zone } : null;
    return { kind, el: zone, day: zone.dataset.day };
  }

  private createPreview(col: HTMLElement, start: number, end: number, item?: CalendarItem): HTMLElement {
    const preview = col.createDiv({ cls: `taskpro-cal__preview${item ? '' : ' is-new'}` });
    if (item) preview.style.setProperty('--taskpro-cal-accent', this.accent(item));
    preview.createDiv({ cls: 'taskpro-cal__preview-title', text: item ? displayTitle(item.task.text) || '—' : this.labels.newTask, attr: { dir: 'auto' } });
    preview.createDiv({ cls: 'taskpro-cal__preview-time' });
    this.movePreview(preview, start, end);
    return preview;
  }

  private movePreview(preview: HTMLElement, start: number, end: number): void {
    preview.style.setProperty('--start', String(start));
    preview.style.setProperty('--duration', String(end - start));
    preview.toggleClass('is-short', end - start < 45);
    preview.querySelector('.taskpro-cal__preview-time')?.setText(formatClockRange(start, end, this.cal.timeFormat, this.language));
  }

  /**
   * The block a task there would be, drawn faintly in the slot that was
   * clicked: the same place and shape as the block, with a + and the time at
   * its start. It is one button, so the pointer is already on it; clicking it
   * opens the picker there. Clicking anywhere else, scrolling or Escape puts
   * it away.
   */
  private showQuickAdd(col: HTMLElement, day: DayKey, start: number): void {
    this.hideQuickAdd();
    this.closePopover();
    const end = Math.min(DAY_MINUTES, start + this.defaultDuration);
    const el = col.createEl('button', { cls: 'taskpro-cal__quick' });
    el.type = 'button';
    el.style.setProperty('--start', String(start));
    el.style.setProperty('--duration', String(this.slot));
    const time = formatClock(start, this.cal.timeFormat, this.language);
    el.setAttribute('aria-label', this.labels.newTaskAt(time));
    el.title = this.labels.newTaskAt(time);
    this.icon(el, 'plus');
    // Times are read left to right whatever the board's direction.
    el.createSpan({ cls: 'taskpro-cal__quick-time', text: time, attr: { dir: 'ltr' } });
    el.createSpan({ cls: 'taskpro-cal__quick-label', text: this.labels.newTask });

    el.addEventListener('pointerdown', (event) => event.stopPropagation());
    el.addEventListener('click', (event) => {
      event.stopPropagation();
      this.hideQuickAdd();
      if (!col.isConnected) return;
      const preview = this.createPreview(col, start, end);
      this.openSlotPicker(day, { start, end }, preview, () => preview.remove());
    });

    const onOutside = (event: PointerEvent) => {
      if (!el.contains(event.target as Node)) this.hideQuickAdd();
    };
    const onScroll = () => this.hideQuickAdd();
    const releaseEscape = claimEscape(() => this.hideQuickAdd(), this.doc);
    // After the press that made it has finished.
    this.win.setTimeout(() => {
      if (this.quickAdd?.el === el) this.doc.addEventListener('pointerdown', onOutside, true);
    }, 0);
    this.scroller?.addEventListener('scroll', onScroll, { passive: true });
    this.quickAdd = {
      el,
      release: () => {
        releaseEscape();
        this.doc.removeEventListener('pointerdown', onOutside, true);
        this.scroller?.removeEventListener('scroll', onScroll);
      },
    };
  }

  private hideQuickAdd(): void {
    const quick = this.quickAdd;
    if (!quick) return;
    this.quickAdd = null;
    quick.release();
    quick.el.remove();
  }

  /** Scrolls the grid while a drag rests near its top or bottom edge. */
  private scrollLoop(drag: DragState): void {
    let restingSince = 0;
    const tick = (now: number) => {
      if (this.drag !== drag) return;
      const scroller = this.scroller;
      if (scroller) {
        const bottom = scroller.getBoundingClientRect().bottom;
        const top = this.stickyEl?.getBoundingClientRect().bottom ?? scroller.getBoundingClientRect().top;
        let speed = 0;
        if (drag.y < top + EDGE_SCROLL) speed = -Math.ceil((top + EDGE_SCROLL - drag.y) / 5);
        else if (drag.y > bottom - EDGE_SCROLL) speed = Math.ceil((drag.y - (bottom - EDGE_SCROLL)) / 5);
        if (!speed) restingSince = 0;
        else if (!restingSince) restingSince = now;
        if (speed && now - restingSince >= EDGE_DWELL) {
          const before = scroller.scrollTop;
          scroller.scrollTop = before + clamp(speed, -24, 24);
          if (scroller.scrollTop !== before) this.updateDrag(drag);
        }
      }
      drag.frame = this.win.requestAnimationFrame(tick);
    };
    drag.frame = this.win.requestAnimationFrame(tick);
  }

  /**
   * Clears what a drag put on screen. The preview is left to its owner (a
   * picker anchored to it, or the repaint that replaces it); `keepSource`
   * leaves the dragged item dimmed until that repaint, so it is never seen in
   * its old place and its new one at once.
   */
  private finishDrag(drag: DragState, keepSource = false): void {
    if (drag.frame !== undefined) this.win.cancelAnimationFrame(drag.frame);
    drag.releaseEscape?.();
    drag.releaseEscape = undefined;
    drag.ghost?.remove();
    drag.highlighted?.removeClass('is-drop-target');
    if (!keepSource) drag.source.removeClass('is-drag-source');
    this.rootEl?.removeClass('is-dragging');
    if (this.drag === drag) this.drag = null;
    if (drag.started) this.ctx.hold(false);
  }

  private cancelDrag(repaint: boolean): void {
    const drag = this.drag;
    if (!drag) return;
    this.removeDragListeners();
    drag.preview?.remove();
    this.finishDrag(drag);
    if (repaint) this.ctx.rerender();
  }

  /** The schedule a drop means, `null` to take a task off the calendar, `undefined` for no change. */
  private scheduleForDrop(item: CalendarItem, target: DropTarget): TaskSchedule | null | undefined {
    const current = item.task.schedule;
    let next: TaskSchedule;
    switch (target.kind) {
      case 'time':
        if (!target.day || target.start === undefined || target.end === undefined) return undefined;
        next = { date: target.day, start: toClock(target.start), end: toClock(target.end) };
        break;
      case 'allday':
      case 'day':
        if (!target.day) return undefined;
        // A task that lives in the day's note is already on that day.
        if (item.kind === 'note' && item.day === target.day) return undefined;
        // In a month or agenda day a timed plan keeps its time; the all-day row drops it.
        next = target.kind === 'day' && item.kind === 'scheduled' && current?.start ? { ...current, date: target.day } : { date: target.day };
        break;
      case 'sidebar':
        return item.kind === 'scheduled' ? null : undefined;
      default:
        return undefined;
    }
    return sameSchedule(current, next) ? undefined : next;
  }

  private async commitDrag(drag: DragState): Promise<void> {
    const item = drag.item;
    const schedule = item && drag.target ? this.scheduleForDrop(item, drag.target) : undefined;
    if (schedule === undefined) {
      drag.preview?.remove();
      this.finishDrag(drag);
      this.ctx.rerender();
      return;
    }
    try {
      await this.writeSchedule(item!.task, schedule);
    } finally {
      // The preview stays where the task went until the note change repaints
      // the calendar, so the task does not flick back to its old place first.
      this.finishDrag(drag, true);
      this.repaintSoon();
    }
  }

  /** A fallback repaint, for a write that changed nothing and so never repaints by itself. */
  private repaintSoon(): void {
    if (this.fallbackTimer !== null) this.win.clearTimeout(this.fallbackTimer);
    this.fallbackTimer = this.win.setTimeout(() => {
      this.fallbackTimer = null;
      if (!this.drag && !this.popover) this.ctx.rerender();
    }, 600);
  }

  // ── Writing ───────────────────────────────────────────────────────────────

  private async writeSchedule(task: BoardTask, schedule: TaskSchedule | null): Promise<void> {
    const host = this.ctx.host;
    if (!host.setSchedule) {
      host.notify(this.labels.noSchedulingHost);
      return;
    }
    await host.setSchedule(task, schedule);
  }

  /**
   * Writes a new task on a day. The note it goes into is the day, so an
   * untimed task there needs no marker; one with a time, or one that goes to
   * the inbox instead, carries its schedule.
   */
  private async createOnDay(day: DayKey, text: string, time: TaskSchedule | null): Promise<void> {
    const host = this.ctx.host;
    const labels = this.labels;
    if (!host.addTaskOnDay) {
      host.notify(labels.noSchedulingHost);
      return;
    }
    const defaults = this.ctx.newTaskDefaults();
    let line = `- ${defaults.status} ${text.replace(/\s+/g, ' ').trim()}`;
    if (defaults.priority) line = setPriority(line, defaults.priority);
    if (defaults.tags.length) line = setTags(line, defaults.tags);
    const target = host.dayNoteTarget?.(day, this.system);
    const implicit = !time && this.prefs.calendarShowDailyNotes && target?.isDailyNote !== false;
    line = setSchedule(line, time ?? (implicit ? null : { date: day }));

    const path = await host.addTaskOnDay(day, line, this.system);
    host.notify(path ? labels.addedTo(noteName(path)) : labels.addFailed);
  }

  // ── Pickers ───────────────────────────────────────────────────────────────

  private closePopover(): void {
    this.popover?.close();
    this.popover = null;
  }

  /** A sensible start for a time on a day: the next full hour today, the start of the day otherwise. */
  private suggestStart(day: DayKey): number {
    const dayStart = settingInt(this.cal.dayStartHour, 0, 23, 7) * 60;
    if (day !== todayKey()) return Math.max(dayStart, 9 * 60);
    return clamp(Math.ceil((this.nowMinutes() + 1) / 60) * 60, 0, DAY_MINUTES - this.defaultDuration);
  }

  /**
   * Start, end and "all day", shared by the picker and the task card. The
   * times are text fields rather than the system's time picker, which follows
   * the computer's locale rather than TaskPro's clock setting: they show the
   * chosen clock, take a time typed any usual way, and step by the grid's
   * snap with the arrow keys.
   */
  private timeFields(parent: HTMLElement, state: TimeState, onChange: () => void): void {
    const labels = this.labels;
    const format = this.cal.timeFormat;
    const row = parent.createDiv({ cls: 'taskpro-cal-times' });
    row.toggleClass('is-12h', format === '12h');
    // The two times read left to right, from and to, as they do on the blocks.
    const range = row.createDiv({ cls: 'taskpro-cal-times__range', attr: { dir: 'ltr' } });
    const field = (label: string) =>
      range.createEl('input', {
        type: 'text',
        cls: 'taskpro-cal-times__input',
        attr: { 'aria-label': label, dir: 'ltr', autocomplete: 'off', spellcheck: 'false' },
      });
    const start = field(labels.from);
    range.createSpan({ cls: 'taskpro-cal-times__sep', text: '–' });
    const end = field(labels.to);
    const allDay = row.createEl('label', { cls: 'taskpro-cal-times__allday' });
    const box = allDay.createEl('input', { type: 'checkbox' });
    allDay.createSpan({ text: labels.allDay });

    const sync = () => {
      start.value = formatClock(state.start, format, this.language);
      end.value = formatClock(state.end, format, this.language);
      box.checked = state.allDay;
      start.disabled = state.allDay;
      end.disabled = state.allDay;
      row.toggleClass('is-all-day', state.allDay);
      row.toggleClass('is-invalid', !state.allDay && state.end <= state.start);
      start.removeClass('is-invalid');
      end.removeClass('is-invalid');
    };
    sync();

    const setStart = (value: number) => {
      // Moving the start keeps the length, as calendar apps do.
      const length = Math.max(this.slot, state.end - state.start);
      state.start = clamp(value, 0, DAY_MINUTES - this.slot);
      state.end = Math.min(DAY_MINUTES, state.start + length);
    };
    const setEnd = (value: number) => {
      // 00:00 typed as an end means the midnight that closes the day.
      state.end = value === 0 ? DAY_MINUTES : clamp(value, 0, DAY_MINUTES);
    };
    const bind = (input: HTMLInputElement, set: (value: number) => void, current: () => number) => {
      const apply = () => {
        const value = parseTypedClock(input.value);
        if (value === null) {
          input.addClass('is-invalid');
          return;
        }
        set(value);
        sync();
        onChange();
      };
      input.addEventListener('focus', () => input.select());
      input.addEventListener('change', apply);
      input.addEventListener('keydown', (event) => {
        if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
          event.preventDefault();
          const step = event.key === 'ArrowUp' ? this.slot : -this.slot;
          set(this.roundSlot(current() + step));
          sync();
          input.select();
          onChange();
        }
      });
    };
    bind(start, setStart, () => state.start);
    bind(end, setEnd, () => state.end);
    box.addEventListener('change', () => {
      state.allDay = box.checked;
      sync();
      onChange();
    });
  }

  private scheduleFrom(day: DayKey, state: TimeState): TaskSchedule | null {
    if (state.allDay) return { date: day };
    if (state.end <= state.start) return null;
    return { date: day, start: toClock(state.start), end: toClock(state.end) };
  }

  /** Open tasks to plan into a slot: unscheduled ones first, then the soonest due. */
  private candidates(query: string): BoardTask[] {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    const open = this.lastTasks.filter((task) => task.status !== '[x]');
    const pool = terms.length
      ? open.filter((task) => {
          const haystack = `${task.text} ${task.fileName}`.toLowerCase();
          return terms.every((term) => haystack.includes(term));
        })
      : open.filter((task) => !task.schedule);
    return pool
      .sort(
        (a, b) =>
          Number(!!a.schedule) - Number(!!b.schedule) ||
          (a.deadline ?? '9999').localeCompare(b.deadline ?? '9999') ||
          (b.priority ? PRIORITY_RANK[b.priority] : 0) - (a.priority ? PRIORITY_RANK[a.priority] : 0) ||
          a.filePath.localeCompare(b.filePath) ||
          a.lineNumber - b.lineNumber
      )
      .slice(0, terms.length ? 8 : 5);
  }

  /**
   * What to do in a slot: type a new task, or pick one the vault already has.
   * Opened by a drag across the grid, a click on an empty slot, a day's "+",
   * or a double click on a day.
   */
  private openSlotPicker(
    day: DayKey,
    time: { start: number; end: number } | null,
    anchor: HTMLElement | DOMRect,
    onClosed?: () => void
  ): void {
    closeContextMenu();
    this.closePopover();
    const suggested = this.suggestStart(day);
    const state: TimeState = {
      allDay: time === null,
      start: time?.start ?? suggested,
      end: time?.end ?? Math.min(DAY_MINUTES, suggested + this.defaultDuration),
    };
    this.ctx.hold(true);
    this.popover = openCalendarPopover({
      container: this.ctx.root,
      anchor: anchor instanceof HTMLElement ? anchor.getBoundingClientRect() : anchor,
      cls: 'taskpro-cal-picker',
      rtl: this.rtl,
      onClose: () => {
        this.popover = null;
        this.ctx.hold(false);
        onClosed?.();
      },
      build: (el, handle) => this.buildPicker(el, handle, day, state),
    });
  }

  private buildPicker(el: HTMLElement, handle: PopoverHandle, day: DayKey, state: TimeState): void {
    const labels = this.labels;
    const host = this.ctx.host;
    const { system, otherSystem: other, language } = this;

    const when = el.createDiv({ cls: 'taskpro-cal-popover__when' });
    this.icon(when, 'calendar', 'taskpro-cal-popover__when-icon');
    const whenText = when.createDiv({ cls: 'taskpro-cal-popover__when-text' });
    whenText.createDiv({ cls: 'taskpro-cal-popover__day', text: mediumDay(day, system, language) });
    const otherParts = partsIn(day, other);
    whenText.createDiv({ cls: 'taskpro-cal-popover__alt', text: `${otherParts.day} ${monthName(day, other, language)} ${otherParts.year}` });
    this.timeFields(el, state, () => handle.reposition());

    const input = el.createEl('input', {
      type: 'text',
      cls: 'taskpro-cal-picker__input',
      attr: { placeholder: labels.searchOrCreate, 'aria-label': labels.searchOrCreate, dir: 'auto', spellcheck: 'false' },
    });
    autoDirection(input, this.rtl ? 'rtl' : 'ltr');
    const list = el.createDiv({ cls: 'taskpro-cal-picker__list' });
    list.setAttribute('role', 'listbox');

    const foot = el.createDiv({ cls: 'taskpro-cal-popover__foot' });
    const target = host.dayNoteTarget?.(day, system);
    if (target) {
      const note = foot.createDiv({ cls: 'taskpro-cal-popover__note' });
      this.icon(note, target.exists ? 'file-text' : 'file-plus');
      note.createSpan({
        cls: 'taskpro-cal-popover__note-text',
        text: target.exists ? labels.addsTo(noteName(target.path)) : labels.createsNote(noteName(target.path)),
      });
      note.title = target.path;
    }
    this.keyHints(foot, [
      ['Enter', labels.keyCreate],
      ['Esc', labels.keyClose],
    ]);

    type Option = { kind: 'create'; text: string } | { kind: 'task'; task: BoardTask };
    let active = 0;
    let navigated = false;
    let busy = false;

    const options = (): Option[] => {
      const query = input.value.trim();
      const result: Option[] = query ? [{ kind: 'create', text: query }] : [];
      for (const task of this.candidates(query)) result.push({ kind: 'task', task });
      return result;
    };

    const activate = async (option: Option | undefined) => {
      if (!option || busy) return;
      const schedule = this.scheduleFrom(day, state);
      if (!schedule) {
        host.notify(labels.invalidTime);
        return;
      }
      busy = true;
      try {
        if (option.kind === 'create') await this.createOnDay(day, option.text, state.allDay ? null : schedule);
        else await this.writeSchedule(option.task, schedule);
      } finally {
        busy = false;
      }
      handle.close();
    };

    const render = () => {
      const opts = options();
      active = clamp(active, 0, Math.max(0, opts.length - 1));
      list.empty();
      // Highlight only once it means something: while typing, or after the arrow keys.
      const showActive = navigated || !!input.value.trim();
      let headed = false;
      opts.forEach((option, index) => {
        if (option.kind === 'task' && !headed) {
          list.createDiv({ cls: 'taskpro-cal-picker__label', text: labels.existing });
          headed = true;
        }
        const row = list.createDiv({ cls: `taskpro-cal-picker__option is-${option.kind}` });
        row.setAttribute('role', 'option');
        row.setAttribute('aria-selected', String(index === active && showActive));
        if (index === active && showActive) row.addClass('is-active');
        if (option.kind === 'create') {
          this.icon(row, 'plus', 'taskpro-cal-picker__option-icon');
          row.createSpan({ cls: 'taskpro-cal-picker__option-title', text: labels.create(option.text), attr: { dir: 'auto' } });
        } else {
          const task = option.task;
          const dot = row.createSpan({ cls: 'taskpro-cal-picker__dot' });
          dot.style.setProperty('--taskpro-cal-accent', this.accent({ kind: 'scheduled', task }));
          row.createSpan({ cls: 'taskpro-cal-picker__option-title', text: displayTitle(task.text) || '—', attr: { dir: 'auto' } });
          const parent = this.parentOf(task);
          const meta = task.schedule
            ? labels.scheduledAt(this.shortScheduleText(task.schedule))
            : task.deadline
              ? `${labels.due} ${shortDay(task.deadline, system, language)}`
              : parent
                ? displayTitle(parent.text) || task.fileName
                : task.fileName;
          row.createSpan({ cls: 'taskpro-cal-picker__option-meta', text: meta, attr: { dir: 'auto' } });
        }
        // Keeps the text field focused, so typing can go on after a click misses.
        row.addEventListener('pointerdown', (event) => event.preventDefault());
        row.addEventListener('click', () => void activate(option));
      });
      list.toggleClass('is-empty', opts.length === 0);
      handle.reposition();
    };

    input.addEventListener('input', () => {
      active = 0;
      navigated = false;
      render();
    });
    input.addEventListener('keydown', (event) => {
      if (event.isComposing) return;
      const opts = options();
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        active = navigated || input.value.trim() ? Math.min(active + 1, opts.length - 1) : 0;
        navigated = true;
        render();
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        navigated = true;
        active = Math.max(active - 1, 0);
        render();
      } else if (event.key === 'Enter') {
        event.preventDefault();
        if (!input.value.trim() && !navigated) return;
        void activate(opts[active]);
      }
    });

    render();
    this.win.setTimeout(() => input.focus(), 0);
  }

  // ── The task card ─────────────────────────────────────────────────────────

  /**
   * Opens a task's card from a layout that is not the calendar. The calendar
   * draws nothing then; it only lends the card, which is the same one, so a
   * task looks the same whichever layout it is opened from.
   */
  openCard(task: BoardTask, anchor: HTMLElement | DOMRect): void {
    this.families = indexFamilies(this.ctx.host.store.inFile(task.filePath));
    this.openInspector(this.itemFor(task), anchor);
  }

  /** Redraws a card lent to another layout after the notes changed; it closes with its task. */
  syncCard(): void {
    const inspected = this.inspected;
    if (!this.popover?.isOpen || !inspected) return;
    this.families = indexFamilies(this.ctx.host.store.inFile(inspected.task.filePath));
    this.refreshInspector();
  }

  private openInspector(item: CalendarItem, anchor: HTMLElement | DOMRect): void {
    const rect = anchor instanceof DOMRect ? anchor : anchor.getBoundingClientRect();
    closeContextMenu();
    this.hideQuickAdd();
    this.closePopover();
    this.inspected = { task: item.task, kind: item.kind, day: item.day };
    this.inspectorStale = false;
    this.popover = openCalendarPopover({
      container: this.ctx.root,
      anchor: rect,
      cls: 'taskpro-cal-inspector',
      rtl: this.rtl,
      onClose: () => {
        this.popover = null;
        this.inspected = null;
      },
      build: (el) => {
        el.addEventListener('focusout', () => {
          this.win.setTimeout(() => {
            if (this.inspectorStale && !el.contains(this.doc.activeElement)) this.refreshInspector();
          }, 0);
        });
        this.buildInspector(el);
      },
    });
  }

  /** The task as it is in the note now; an edit may have moved or renamed it. */
  private freshTask(task: BoardTask): BoardTask | undefined {
    const inFile = this.ctx.host.store.inFile(task.filePath);
    return (
      (task.blockId ? inFile.find((t) => t.blockId === task.blockId) : undefined) ??
      inFile.find((t) => t.lineNumber === task.lineNumber && t.text === task.text) ??
      inFile.find((t) => t.text === task.text) ??
      inFile.find((t) => t.lineNumber === task.lineNumber)
    );
  }

  /** Rebuilds an open card from the task as it now is, unless a field in it is being edited. */
  private refreshInspector(): void {
    const popover = this.popover;
    const inspected = this.inspected;
    if (!popover?.isOpen || !inspected) return;
    const active = this.doc.activeElement;
    // The add-a-subtask field is left empty after each one, so the list can
    // be redrawn under it; any other field is waited for.
    const adding = !!active?.matches('.taskpro-cal-inspector__subtask-add') && !(active as HTMLInputElement).value;
    if (popover.el.contains(active) && active?.matches('input') && !adding) {
      this.inspectorStale = true;
      return;
    }
    this.inspectorStale = false;
    const fresh = this.freshTask(inspected.task);
    if (!fresh) {
      this.closePopover();
      return;
    }
    inspected.task = fresh;
    if (fresh.schedule) {
      inspected.kind = 'scheduled';
      inspected.day = fresh.schedule.date;
    } else if (inspected.kind === 'scheduled') {
      inspected.kind = 'free';
    }
    this.buildInspector(popover.el);
    popover.reposition();
    if (adding) popover.el.querySelector<HTMLInputElement>('.taskpro-cal-inspector__subtask-add')?.focus();
  }

  /**
   * The task card, laid out as a Notion page's properties: where the task
   * sits (its parent), its title with the checkbox and the two actions, then
   * one row per property with the name on one side and the value on the
   * other, then its subtasks. Every value is edited in place or from a
   * dropdown right under it; an empty one says so, faintly.
   */
  private buildInspector(el: HTMLElement): void {
    const inspected = this.inspected;
    if (!inspected) return;
    const task = inspected.task;
    const labels = this.labels;
    const actionLabels = getActionLabels(this.language);
    const language = this.language;
    const host = this.ctx.host;
    emptyPanel(el);
    el.dataset.status = task.status;
    el.style.setProperty('--taskpro-cal-accent', this.accent({ kind: inspected.kind, task }));
    const options = () => this.actionOptions(task, el);

    // Where it sits
    const parent = this.freshParent(task);
    if (parent) {
      const up = el.createEl('button', { cls: 'taskpro-cal-inspector__parent' });
      up.type = 'button';
      up.title = labels.partOf;
      this.icon(up, this.rtl ? 'corner-right-up' : 'corner-left-up');
      up.createSpan({ cls: 'taskpro-cal-inspector__parent-title', text: displayTitle(parent.text) || '—', attr: { dir: 'auto' } });
      up.addEventListener('click', () => this.openInspector(this.itemFor(parent), el.getBoundingClientRect()));
    }

    // Title, and what can be done with the task as a whole
    const head = el.createDiv({ cls: 'taskpro-cal-inspector__head' });
    this.check(head, task);
    const title = head.createDiv({ cls: 'taskpro-cal-inspector__title', text: displayTitle(task.text) || '—', attr: { dir: 'auto' } });
    title.setAttribute('role', 'button');
    title.tabIndex = 0;
    title.title = labels.editTitle;
    title.addEventListener('click', () => this.editTitle(title, task));
    title.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        this.editTitle(title, task);
      }
    });
    const tools = head.createDiv({ cls: 'taskpro-cal-inspector__tools' });
    this.iconButton(tools, 'arrow-up-right', labels.openNote, () => void host.reveal(task));
    const more = this.iconButton(tools, 'more-horizontal', labels.moreActions, () =>
      this.openActions(task, more.getBoundingClientRect(), this.itemElement(task))
    );

    // Properties
    const sheet = el.createDiv({ cls: 'taskpro-cal-inspector__sheet' });
    const property = (icon: string, name: string) => {
      const row = sheet.createDiv({ cls: 'taskpro-cal-prop' });
      const label = row.createDiv({ cls: 'taskpro-cal-prop__name' });
      this.icon(label, icon);
      label.createSpan({ text: name });
      return row.createDiv({ cls: 'taskpro-cal-prop__value' });
    };
    /** A value that opens a dropdown, with a chip or a faint "Empty" in it. */
    const pick = (value: HTMLElement, fill: (button: HTMLElement) => void, sections: () => MenuSection[]) => {
      const button = value.createDiv({ cls: 'taskpro-cal-prop__pick' });
      button.setAttribute('role', 'button');
      button.tabIndex = 0;
      fill(button);
      const open = () => this.dropdown(button, sections());
      button.addEventListener('click', open);
      button.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        open();
      });
    };
    const empty = (button: HTMLElement, text = actionLabels.none) => button.createSpan({ cls: 'taskpro-cal-prop__empty', text });
    const chip = (button: HTMLElement, cls: string, icon: string | null, text: string) => {
      const made = buildChip(cls, icon, text);
      button.appendChild(made);
      return made;
    };

    // When: the plan, edited in place; a task with none offers the quick choices.
    const schedule = task.schedule;
    const when = property('clock', labels.when);
    if (schedule || inspected.kind === 'note') {
      const day = schedule?.date ?? (inspected.day || todayKey());
      const timed = schedule ? this.scheduleTimes(schedule) : null;
      const suggested = this.suggestStart(day);
      const edit = {
        date: day,
        time: {
          allDay: !timed,
          start: timed?.start ?? suggested,
          end: timed?.end ?? Math.min(DAY_MINUTES, suggested + this.defaultDuration),
        } as TimeState,
      };
      const commit = () => {
        const next = this.scheduleFrom(edit.date, edit.time);
        if (!next) {
          host.notify(labels.invalidTime);
          return;
        }
        if (!schedule && inspected.kind === 'note' && edit.time.allDay && edit.date === inspected.day) return;
        if (sameSchedule(schedule, next)) return;
        void this.writeSchedule(task, next);
      };
      when.addClass('is-editor');
      this.dateField(when, day, (next) => {
        edit.date = next;
        commit();
      });
      this.timeFields(when, edit.time, commit);
      if (!schedule) when.createDiv({ cls: 'taskpro-cal-prop__note', text: labels.inDailyNote });
    } else {
      pick(when, (button) => empty(button, labels.notPlanned), () => planSections(options()));
    }

    pick(
      property('circle-dot', actionLabels.status),
      (button) => (chip(button, 'taskpro-interactive-badge', STATUS_ICON_NAMES[task.status], STATUS_LABELS[language][task.status]).dataset.status = task.status),
      () => statusSections(options())
    );

    pick(
      property('flag', actionLabels.priority),
      (button) => {
        if (!task.priority) return empty(button);
        chip(button, 'taskpro-priority-badge', PRIORITY_ICON_NAMES[task.priority], PRIORITY_LABELS[language][task.priority]).dataset.priority = task.priority;
      },
      () => prioritySections(options())
    );

    pick(
      property(CHIP_ICON_NAMES.deadline, actionLabels.deadline),
      (button) => {
        if (!task.deadline) return empty(button);
        const info = getDeadlineInfo(task.deadline, language, task.status);
        chip(button, 'taskpro-deadline-badge', CHIP_ICON_NAMES.deadline, info.text).dataset.state = info.state;
        button.createSpan({ cls: 'taskpro-cal-prop__aside', text: shortDay(task.deadline, this.system, language) });
      },
      () => deadlineSections(options())
    );

    if (host.setRepeat) {
      pick(
        property('repeat', actionLabels.repeat),
        (button) => {
          if (!task.repeat) return empty(button);
          chip(button, 'taskpro-repeat-badge', CHIP_ICON_NAMES.repeat, getRepeatLabels(language).chip(task.repeat));
        },
        () => repeatSections(options())
      );
    }

    if (host.setWaiting) {
      pick(
        property('hourglass', actionLabels.waitingOn),
        (button) => {
          const blockers = this.ctx.relations().blockersOf(task);
          if (!blockers.length) return empty(button);
          button.addClass('has-tags');
          for (const blocker of blockers) {
            const done = !blocker.task || blocker.task.status === '[x]';
            const made = chip(button, 'taskpro-waiting-badge', done ? 'check-check' : 'hourglass', blocker.task ? displayTitle(blocker.task.text) || '—' : actionLabels.missingTask);
            made.dataset.state = done ? 'done' : 'waiting';
            made.querySelector('.taskpro-chip__label')?.setAttribute('dir', 'auto');
          }
        },
        () => waitingSections(options())
      );
    }

    if (host.setRemind && schedule?.start) {
      pick(
        property('bell', actionLabels.remind),
        (button) => button.createSpan({ cls: 'taskpro-cal-prop__text', text: remindHint(options()) }),
        () => remindSections(options())
      );
    }

    pick(
      property('tags', actionLabels.tags),
      (button) => {
        if (!task.tags.length) return empty(button);
        button.addClass('has-tags');
        for (const key of task.tags) {
          const tag = resolveTag(key, this.settings.tags);
          const made = chip(button, 'taskpro-tag-chip', null, tag.name);
          applyTagColor(made, tag.color);
          if (tag.unknown) made.addClass('is-unknown');
        }
      },
      () => tagSections(options())
    );

    const noteValue = property('file-text', labels.note);
    const note = noteValue.createEl('button', { cls: 'taskpro-cal-prop__link' });
    note.type = 'button';
    note.title = task.filePath;
    note.createSpan({ text: task.fileName, attr: { dir: 'auto' } });
    note.addEventListener('click', () => void host.reveal(task));

    this.subtaskList(el, task);

    // Taking it off the calendar keeps the task; deleting takes it out of its note.
    const foot = el.createDiv({ cls: 'taskpro-cal-inspector__foot' });
    if (schedule) {
      const remove = foot.createEl('button', { cls: 'taskpro-cal-inspector__remove' });
      remove.type = 'button';
      this.icon(remove, 'calendar-x');
      remove.createSpan({ text: labels.unschedule });
      remove.addEventListener('click', () => {
        void this.writeSchedule(task, null);
        this.closePopover();
      });
    }
    for (const entry of deleteEntries(options())) {
      const remove = foot.createEl('button', { cls: 'taskpro-cal-inspector__remove is-delete' });
      remove.type = 'button';
      this.icon(remove, 'trash-2');
      remove.createSpan({ text: entry.label });
      remove.addEventListener('click', () => {
        this.closePopover();
        void entry.onSelect?.();
      });
    }
    if (!foot.childElementCount) foot.remove();
  }

  /** A task's parent as it is in the note now. */
  private freshParent(task: BoardTask): BoardTask | undefined {
    if (!task.parentId) return undefined;
    return this.ctx.host.store.inFile(task.filePath).find((candidate) => candidate.id === task.parentId);
  }

  /**
   * The card's subtasks: each with its checkbox and when it is planned, a
   * click away from its own card, and a row to add one more.
   */
  private subtaskList(el: HTMLElement, task: BoardTask): void {
    const labels = this.labels;
    const host = this.ctx.host;
    const subtasks = host.store.inFile(task.filePath).filter((candidate) => candidate.parentId === task.id);
    if (!subtasks.length && !host.insertTask) return;

    const section = el.createDiv({ cls: 'taskpro-cal-inspector__subtasks' });
    const head = section.createDiv({ cls: 'taskpro-cal-inspector__subtasks-head' });
    head.createSpan({ text: labels.subtasks });
    if (subtasks.length) {
      const done = subtasks.filter((sub) => sub.status === '[x]').length;
      head.createSpan({ cls: 'taskpro-cal-inspector__subtasks-count', text: labels.subtasksDone(done, subtasks.length) });
      const bar = head.createSpan({ cls: 'taskpro-cal-inspector__subtasks-bar' });
      bar.style.setProperty('--done', String(done / subtasks.length));
    }

    for (const sub of subtasks) {
      const row = section.createDiv({ cls: 'taskpro-cal-inspector__subtask' });
      row.style.setProperty('--taskpro-cal-accent', this.accent({ kind: 'scheduled', task: sub }));
      row.toggleClass('is-done', sub.status === '[x]');
      this.check(row, sub);
      row.createSpan({ cls: 'taskpro-cal-inspector__subtask-title', text: displayTitle(sub.text) || '—', attr: { dir: 'auto' } });
      if (sub.schedule) {
        row.createSpan({ cls: 'taskpro-cal-inspector__subtask-when', text: this.shortScheduleText(sub.schedule) });
      } else {
        // Not planned: nothing to read, and a way to plan it on hover.
        const plan = row.createEl('button', { cls: 'taskpro-cal-inspector__subtask-plan' });
        plan.type = 'button';
        plan.setAttribute('aria-label', labels.notPlanned);
        plan.title = labels.notPlanned;
        this.icon(plan, 'calendar-plus');
        plan.addEventListener('click', (event) => {
          event.stopPropagation();
          this.dropdown(plan, planSections(this.actionOptions(sub, plan)));
        });
      }
      row.setAttribute('role', 'button');
      row.tabIndex = 0;
      const open = () => this.openInspector(this.itemFor(sub), el.getBoundingClientRect());
      row.addEventListener('click', open);
      row.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        open();
      });
      row.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.openActions(sub, { x: event.clientX, y: event.clientY }, this.itemElement(sub));
      });
    }

    if (!host.insertTask) return;
    const add = section.createEl('input', {
      type: 'text',
      cls: 'taskpro-cal-inspector__subtask-add',
      attr: { placeholder: getActionLabels(this.language).addSubtask, dir: 'auto', spellcheck: 'false' },
    });
    autoDirection(add, this.rtl ? 'rtl' : 'ltr');
    add.dataset.ownEscape = 'true';
    add.addEventListener(OWN_ESCAPE_EVENT, () => {
      add.value = '';
      add.blur();
    });
    add.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' || event.isComposing) return;
      event.preventDefault();
      const text = add.value.replace(/\s+/g, ' ').trim();
      if (!text) return;
      add.value = '';
      void host.insertTask?.(task, `- [ ] ${text}`, 'child');
    });
  }

  private scheduleTimes(schedule: TaskSchedule): { start: number; end: number } | null {
    const start = parseClock(schedule.start);
    if (start === null) return null;
    const end = parseClock(schedule.end);
    return { start, end: end !== null && end > start ? end : Math.min(DAY_MINUTES, start + this.defaultDuration) };
  }

  /** A date in the calendar shown: the system date picker for Gregorian, `1405/07/06` for Jalali. */
  private dateField(parent: HTMLElement, value: DayKey, onChange: (day: DayKey) => void): void {
    const labels = this.labels;
    const row = parent.createDiv({ cls: 'taskpro-cal-date' });
    // The system date field draws its own calendar icon; the Jalali text field has none.
    if (this.system === 'jalali') this.icon(row, 'calendar');
    const weekday = row.createSpan({ cls: 'taskpro-cal-date__weekday', text: WEEKDAY_NAMES_SHORT[this.language][weekdayOf(value)] });
    if (this.system === 'jalali') {
      const input = row.createEl('input', {
        type: 'text',
        cls: 'taskpro-cal-date__input',
        attr: { dir: 'ltr', placeholder: 'YYYY/MM/DD', 'aria-label': labels.date, inputmode: 'numeric' },
      });
      input.value = formatDay(value, 'jYYYY/jMM/jDD', 'fa');
      const apply = () => {
        const iso = jalaliTextToIso(input.value);
        const valid = !!iso && isDayKey(iso);
        input.toggleClass('is-invalid', !valid);
        if (!valid) return;
        weekday.setText(WEEKDAY_NAMES_SHORT[this.language][weekdayOf(iso!)]);
        if (iso !== value) onChange(iso!);
      };
      input.addEventListener('change', apply);
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          apply();
        }
      });
    } else {
      const input = row.createEl('input', { type: 'date', cls: 'taskpro-cal-date__input', attr: { 'aria-label': labels.date } });
      input.value = value;
      input.addEventListener('change', () => {
        if (!isDayKey(input.value) || input.value === value) return;
        weekday.setText(WEEKDAY_NAMES_SHORT[this.language][weekdayOf(input.value)]);
        onChange(input.value);
      });
    }
  }

  private editTitle(title: HTMLElement, task: BoardTask): void {
    const input = createEl('input', { type: 'text', cls: 'taskpro-cal-inspector__title-input' });
    input.value = task.text;
    input.setAttribute('dir', 'auto');
    input.dataset.ownEscape = 'true';
    title.replaceWith(input);
    input.focus();
    input.select();
    let done = false;
    const finish = (save: boolean) => {
      if (done) return;
      done = true;
      const value = input.value.trim();
      input.replaceWith(title);
      if (save && value && value !== task.text) {
        title.setText(displayTitle(value));
        void this.ctx.host.setText(task, value);
      }
    };
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.isComposing) {
        event.preventDefault();
        finish(true);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        finish(false);
      }
    });
    // Escape, as the card's keymap scope hands it on to a field that uses it.
    input.addEventListener(OWN_ESCAPE_EVENT, () => finish(false));
    input.addEventListener('blur', () => finish(true));
  }

  // ── Keys ──────────────────────────────────────────────────────────────────

  /**
   * T for today, the arrows for back and forward, M W D A for the views and
   * N for a new task, while the calendar has focus. Keyed on the physical
   * key, so they work the same on a Persian keyboard layout.
   */
  /** A new task on today, when today is on screen, or else on the day in view: the N key, and the phone's + button. */
  addTask(): void {
    const range = this.range();
    const today = todayKey();
    const day = compareDays(today, range.from) >= 0 && compareDays(today, range.to) <= 0 ? today : this.anchor;
    const box = (this.rootEl ?? this.ctx.root).getBoundingClientRect();
    this.openSlotPicker(day, null, new DOMRect(box.left + box.width / 2 - 1, box.top + 40, 2, 2));
  }

  private onKey(event: KeyboardEvent): void {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
    const target = event.target as HTMLElement;
    if (target.closest('input, textarea, select, [contenteditable="true"]')) return;
    const back = this.rtl ? 'ArrowRight' : 'ArrowLeft';
    const forward = this.rtl ? 'ArrowLeft' : 'ArrowRight';
    switch (event.key === back || event.key === forward ? event.key : event.code) {
      case back:
        this.step(-1);
        break;
      case forward:
        this.step(1);
        break;
      case 'KeyT':
        this.goToday();
        break;
      case 'KeyM':
        this.setView('month');
        break;
      case 'KeyW':
        this.setView('week');
        break;
      case 'KeyD':
        this.setView('day');
        break;
      case 'KeyA':
        this.setView('agenda');
        break;
      case 'KeyN': {
        if (!this.rootEl) return;
        this.addTask();
        break;
      }
      default:
        return;
    }
    event.preventDefault();
  }
}
