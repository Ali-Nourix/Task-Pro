// ── timeline/timeline-view.ts ─────────────────────────────────────────────
// The board's timeline layout: each task a bar from the day it is planned to
// the day it is due, on a scale of days, weeks or months, in either calendar.
// A deadline alone is a diamond; a parent's family is spanned by a thin
// bracket; an arrow runs from a task to each task waiting on it, red when
// the one waiting is planned to start before the other ends.
//
// A bar is dragged to move the task's plan and deadline together, by its
// start to move only the plan, by its end to move (or set) the deadline. The
// task list stays put on the leading side while the chart scrolls, and in
// Persian the chart runs right to left like the rest of the board.
// ─────────────────────────────────────────────────────────────────────────────

import { setIcon } from 'obsidian';
import type { BoardPreferences, CalendarSystem, Language, TaskSchedule } from '../types';
import { STATUS_ICON_NAMES } from '../types';
import type { BoardSettingsView, TaskBoardHost } from '../board/task-board';
import type { BoardTask } from '../board/task-store';
import type { RelationIndex } from '../board/task-relations';
import type { MenuEntry } from '../ui/context-menu';
import { displayTitle } from '../board/board-text';
import { resolveTag, resolveTagColor } from '../tags';
import {
  DayKey,
  MONTH_NAMES_SHORT,
  WEEKDAY_NAMES_MIN,
  addDays,
  compareDays,
  daysBetween,
  daysFrom,
  isWeekend,
  mediumDay,
  monthTitle,
  partsIn,
  resolveWeekStart,
  startOfWeek,
  todayKey,
  weekdayOf,
} from '../calendar/calendar-dates';
import { getCalendarLabels } from '../calendar/calendar-localization';
import { TimelineRow, buildTimeline, finishesAfterStart } from './timeline-model';
import { TimelineLabels, TimelineZoom, getTimelineLabels } from './timeline-localization';
import { holdToDrag } from '../ui/touch';
import { stagger, type Entrance } from '../ui/motion';

export type { TimelineZoom };

/** Pixels per day, days drawn, days shown before today, and days a step moves, per zoom. */
const ZOOMS: Record<TimelineZoom, { px: number; days: number; lead: number; step: number }> = {
  day: { px: 40, days: 70, lead: 7, step: 28 },
  week: { px: 15, days: 7 * 30, lead: 21, step: 7 * 8 },
  month: { px: 4, days: 7 * 80, lead: 45, step: 7 * 26 },
};
const ROW_HEIGHT = 34;
/** Rows a finger can hit, on a touch screen. */
const TOUCH_ROW_HEIGHT = 44;
/** Pixels a press travels before it is a drag. */
const DRAG_THRESHOLD = 4;

const STATUS_ACCENT: Record<string, string> = {
  '[ ]': 'var(--interactive-accent)',
  '[/]': 'var(--taskpro-accent-progress)',
  '[!]': 'var(--taskpro-accent-notdone)',
  '[x]': 'var(--taskpro-accent-done)',
};

export interface TimelineContext {
  readonly host: TaskBoardHost;
  /** The board's root: menus and drag labels are placed inside it. */
  readonly root: HTMLElement;
  settings(): BoardSettingsView;
  prefs(): BoardPreferences;
  updatePrefs(patch: Partial<BoardPreferences>): Promise<void>;
  /** The board's scope, with its search and filters applied. */
  tasks(): BoardTask[];
  hold(on: boolean): void;
  openTaskActions(task: BoardTask, at: { x: number; y: number } | DOMRect, anchor: HTMLElement, lead?: MenuEntry[]): void;
  relations(): RelationIndex;
  /** How far along a task is, 0 to 1, from its progress bar or its subtasks. */
  progress(task: BoardTask): number | null;
  showSummary(tasks: readonly BoardTask[]): void;
  rerender(): void;
  /** What the next repaint plays: the view coming in, or a page turning forward or back. */
  enter(kind: Entrance): void;
  segmented(
    parent: HTMLElement,
    cls: string,
    items: Array<{ value: string; label: string; icon?: string }>,
    current: string,
    onPick: (value: string) => void
  ): void;
}

/** How round the bends of a dependency line are, in pixels. */
const LINK_CORNER = 8;

/**
 * A line through `points` with its bends rounded: each is cut short by the
 * radius (or by half of the shorter segment beside it, so two bends close
 * together do not overlap) and joined by a curve that has the bend itself as
 * its control point.
 */
function roundedPath(points: Array<[number, number]>, radius: number): string {
  let d = `M${points[0][0]} ${points[0][1]}`;
  for (let i = 1; i < points.length - 1; i++) {
    const [px, py] = points[i - 1];
    const [cx, cy] = points[i];
    const [nx, ny] = points[i + 1];
    const before = Math.hypot(cx - px, cy - py);
    const after = Math.hypot(nx - cx, ny - cy);
    const r = Math.min(radius, before / 2, after / 2);
    if (r < 0.5) {
      d += ` L${cx} ${cy}`;
      continue;
    }
    const ax = cx + ((px - cx) / before) * r;
    const ay = cy + ((py - cy) / before) * r;
    const bx = cx + ((nx - cx) / after) * r;
    const by = cy + ((ny - cy) / after) * r;
    d += ` L${ax} ${ay} Q${cx} ${cy} ${bx} ${by}`;
  }
  const last = points[points.length - 1];
  return `${d} L${last[0]} ${last[1]}`;
}

/** Where a row's bar is, in days from the chart's first; what the dependency arrows join. */
interface TimelinePosition {
  index: number;
  start: number;
  /** The day after the last it covers. */
  end: number;
  milestone: boolean;
}

interface Drag {
  task: BoardTask;
  mode: 'move' | 'start' | 'end';
  bar: HTMLElement;
  lane: HTMLElement;
  startX: number;
  from: DayKey;
  to: DayKey;
  delta: number;
  moved: boolean;
  label: HTMLElement | null;
}

export class TaskTimeline {
  private anchor: DayKey | null = null;
  private scroll: { left: number; top: number } | null = null;
  private scroller: HTMLElement | null = null;
  private drag: Drag | null = null;
  /** Set for the click a drag ends with, so it does not open the menu. */
  private swallowClick = false;

  constructor(private readonly ctx: TimelineContext) {}

  private get language(): Language {
    return this.ctx.settings().language;
  }

  private get rtl(): boolean {
    return this.language === 'fa';
  }

  private get labels(): TimelineLabels {
    return getTimelineLabels(this.language);
  }

  private get zoom(): TimelineZoom {
    return this.ctx.prefs().timelineZoom ?? 'day';
  }

  private get system(): CalendarSystem {
    return this.ctx.prefs().calendarSystem ?? this.ctx.settings().calendarSystem;
  }

  private get scale() {
    return ZOOMS[this.zoom];
  }

  private get rowHeight(): number {
    return this.ctx.root.hasClass('is-touch') || this.ctx.root.hasClass('is-compact') ? TOUCH_ROW_HEIGHT : ROW_HEIGHT;
  }

  private weekStart(): number {
    return resolveWeekStart(this.ctx.settings().calendar.weekStart, this.system);
  }

  /** The first day drawn: a little before this week, until moved. */
  private from(): DayKey {
    if (!this.anchor) this.anchor = addDays(startOfWeek(todayKey(), this.weekStart()), -this.scale.lead);
    return this.anchor;
  }

  destroy(): void {
    this.endDrag(false);
  }

  // ── Navigation ─────────────────────────────────────────────────────────

  renderNav(nav: HTMLElement): void {
    nav.empty();
    const labels = this.labels;
    const calendarLabels = getCalendarLabels(this.language);
    const from = this.from();
    const to = addDays(from, this.scale.days - 1);

    const start = nav.createDiv({ cls: 'taskpro-cal-nav__start' });
    const today = start.createEl('button', { cls: 'taskpro-cal-nav__today', text: labels.today });
    today.type = 'button';
    today.addEventListener('click', () => this.goToday());
    const steps = start.createDiv({ cls: 'taskpro-cal-nav__steps' });
    this.iconButton(steps, this.rtl ? 'chevron-right' : 'chevron-left', labels.previous, () => this.step(-1));
    this.iconButton(steps, this.rtl ? 'chevron-left' : 'chevron-right', labels.next, () => this.step(1));
    const heading = start.createDiv({ cls: 'taskpro-cal-nav__titles' });
    // A phone has room for the months' short names only.
    const title = this.ctx.root.hasClass('is-compact')
      ? `${MONTH_NAMES_SHORT[this.system][this.language][partsIn(from, this.system).month - 1]} – ${monthTitle(to, this.system, this.language)}`
      : `${monthTitle(from, this.system, this.language)} – ${monthTitle(to, this.system, this.language)}`;
    heading.createEl('h3', { cls: 'taskpro-cal-nav__title', text: title });

    const end = nav.createDiv({ cls: 'taskpro-cal-nav__end' });
    this.ctx.segmented(
      end,
      'taskpro-tl-nav__zooms',
      (['day', 'week', 'month'] as TimelineZoom[]).map((value) => ({ value, label: labels.zooms[value] })),
      this.zoom,
      (value) => this.setZoom(value as TimelineZoom)
    );
    this.ctx.segmented(
      end,
      'taskpro-cal-nav__systems',
      (['gregorian', 'jalali'] as CalendarSystem[]).map((value) => ({ value, label: calendarLabels.systems[value] })),
      this.system,
      (value) => void this.ctx.updatePrefs({ calendarSystem: value as CalendarSystem })
    );
  }

  private iconButton(parent: HTMLElement, icon: string, label: string, onClick: () => void): HTMLButtonElement {
    const button = parent.createEl('button', { cls: 'clickable-icon taskpro-board__icon-btn' });
    button.type = 'button';
    button.setAttribute('aria-label', label);
    setIcon(button, icon);
    button.addEventListener('click', onClick);
    return button;
  }

  private goToday(): void {
    this.ctx.enter('view');
    this.anchor = null;
    this.scroll = null;
    this.refresh();
  }

  private step(direction: -1 | 1): void {
    this.ctx.enter(direction > 0 ? 'next' : 'prev');
    this.anchor = addDays(this.from(), direction * this.scale.step);
    this.scroll = { left: 0, top: this.scroller?.scrollTop ?? 0 };
    this.refresh();
  }

  private setZoom(zoom: TimelineZoom): void {
    // Keep the middle of what is on screen where it is.
    const middle = this.middleDay();
    this.scroll = null;
    void this.ctx.updatePrefs({ timelineZoom: zoom }).then(() => {
      this.anchor = addDays(middle, -Math.round(ZOOMS[zoom].days / 3));
      this.refresh();
    });
  }

  private middleDay(): DayKey {
    const el = this.scroller;
    if (!el) return todayKey();
    const visible = Math.max(0, el.clientWidth - this.listWidth());
    return addDays(this.from(), Math.round((Math.abs(el.scrollLeft) + visible / 2) / this.scale.px));
  }

  private refresh(): void {
    const nav = this.ctx.root.querySelector<HTMLElement>('.taskpro-tl-nav');
    if (nav) this.renderNav(nav);
    this.ctx.rerender();
  }

  /** The list's width: the CSS decides it, so a narrow board gets a narrower list. */
  private listWidth(): number {
    const cell = this.scroller?.querySelector<HTMLElement>('.taskpro-tl__corner');
    return cell?.offsetWidth ?? 280;
  }

  // ── Body ─────────────────────────────────────────────────────────────

  renderBody(body: HTMLElement): void {
    const labels = this.labels;
    const tasks = this.ctx.tasks();
    this.ctx.showSummary(tasks);
    const model = buildTimeline(tasks, this.ctx.host.store.all());
    const { px, days: count } = this.scale;
    const from = this.from();
    const days = daysFrom(from, count);
    const to = days[days.length - 1];

    if (!model.rows.length && !model.undated.length) {
      const empty = body.createDiv({ cls: 'taskpro-board__empty' });
      setIcon(empty.createDiv({ cls: 'taskpro-board__empty-icon' }), 'gantt-chart');
      empty.createDiv({ cls: 'taskpro-board__empty-text', text: labels.empty });
      return;
    }

    const scroller = body.createDiv({ cls: 'taskpro-tl' });
    this.scroller = scroller;
    scroller.style.setProperty('--tl-day', `${px}px`);
    scroller.style.setProperty('--tl-days', String(count));
    scroller.style.setProperty('--tl-row', `${this.rowHeight}px`);
    scroller.dataset.zoom = this.zoom;
    const canvas = scroller.createDiv({ cls: 'taskpro-tl__canvas' });

    this.renderHead(canvas, days);

    const rowsEl = canvas.createDiv({ cls: 'taskpro-tl__rows' });
    this.renderGrid(rowsEl, days);
    const today = todayKey();
    if (compareDays(today, from) >= 0 && compareDays(today, to) <= 0) {
      const line = rowsEl.createDiv({ cls: 'taskpro-tl__today' });
      line.style.setProperty('--x', String(daysBetween(from, today) + 0.5));
    }

    const positions = new Map<string, TimelinePosition>();
    model.rows.forEach((row, index) => {
      this.renderRow(rowsEl, row, from, to, index);
      const span = row.span;
      if (span) {
        positions.set(row.task.id, {
          index,
          start: daysBetween(from, span.start),
          end: daysBetween(from, span.end) + 1,
          milestone: span.kind === 'milestone',
        });
      }
    });
    this.renderLinks(rowsEl, model.rows, positions, count);

    if (model.undated.length) this.renderUndated(canvas, model.undated, from);

    if (!model.rows.length) {
      const hint = canvas.createDiv({ cls: 'taskpro-tl__hint' });
      hint.setText(labels.empty);
    }

    if (this.scroll) {
      scroller.scrollLeft = this.rtl ? -this.scroll.left : this.scroll.left;
      scroller.scrollTop = this.scroll.top;
    } else if (compareDays(today, from) > 0 && compareDays(today, to) <= 0) {
      // Fresh: today a day in from the list, however little of the chart there is room for.
      const left = Math.max(0, (daysBetween(from, today) - 1) * px);
      const room = scroller.clientWidth - this.listWidth();
      if ((daysBetween(from, today) + 1) * px > room) scroller.scrollLeft = this.rtl ? -left : left;
    }
    scroller.addEventListener('scroll', () => {
      this.scroll = { left: Math.abs(scroller.scrollLeft), top: scroller.scrollTop };
    });
  }

  /** The scale: months over days, months over weeks, or years over months. */
  private renderHead(canvas: HTMLElement, days: DayKey[]): void {
    const labels = this.labels;
    const head = canvas.createDiv({ cls: 'taskpro-tl__head' });
    const corner = head.createDiv({ cls: 'taskpro-tl__corner' });
    corner.createSpan({ text: labels.task });
    const scale = head.createDiv({ cls: 'taskpro-tl__scale' });
    const top = scale.createDiv({ cls: 'taskpro-tl__units is-top' });
    const bottom = scale.createDiv({ cls: 'taskpro-tl__units is-bottom' });
    const system = this.system;
    const language = this.language;
    const zoom = this.zoom;
    const weekStart = this.weekStart();

    const monthKey = (day: DayKey) => {
      const parts = partsIn(day, system);
      return `${parts.year}-${parts.month}`;
    };
    const segments = (keyOf: (day: DayKey) => string) => {
      const out: Array<{ at: number; length: number; day: DayKey }> = [];
      days.forEach((day, i) => {
        const key = keyOf(day);
        const last = out[out.length - 1];
        if (last && keyOf(last.day) === key) last.length++;
        else out.push({ at: i, length: 1, day });
      });
      return out;
    };
    const unit = (row: HTMLElement, at: number, length: number, text: string, cls = '') => {
      const el = row.createDiv({ cls: `taskpro-tl__unit ${cls}` });
      el.style.setProperty('--x', String(at));
      el.style.setProperty('--w', String(length));
      el.createSpan({ cls: 'taskpro-tl__unit-label', text });
      return el;
    };

    const topKey = zoom === 'month' ? (day: DayKey) => String(partsIn(day, system).year) : monthKey;
    for (const seg of segments(topKey)) {
      unit(top, seg.at, seg.length, zoom === 'month' ? String(partsIn(seg.day, system).year) : monthTitle(seg.day, system, language));
    }

    const today = todayKey();
    if (zoom === 'day') {
      days.forEach((day, i) => {
        const el = unit(bottom, i, 1, String(partsIn(day, system).day), isWeekend(day, system) ? 'is-weekend' : '');
        el.createSpan({ cls: 'taskpro-tl__unit-sub', text: WEEKDAY_NAMES_MIN[language][weekdayOf(day)] });
        el.toggleClass('is-today', day === today);
      });
    } else if (zoom === 'week') {
      for (const seg of segments((day) => startOfWeek(day, weekStart))) {
        const el = unit(bottom, seg.at, seg.length, String(partsIn(seg.day, system).day));
        el.toggleClass('is-today', compareDays(seg.day, today) <= 0 && compareDays(addDays(seg.day, seg.length - 1), today) >= 0);
      }
    } else {
      for (const seg of segments(monthKey)) {
        unit(bottom, seg.at, seg.length, MONTH_NAMES_SHORT[system][language][partsIn(seg.day, system).month - 1]);
      }
    }
  }

  /** Lines at each unit of the lower scale, and the weekends shaded, behind every row. */
  private renderGrid(rowsEl: HTMLElement, days: DayKey[]): void {
    const grid = rowsEl.createDiv({ cls: 'taskpro-tl__grid' });
    const system = this.system;
    const weekStart = this.weekStart();
    days.forEach((day, i) => {
      const parts = partsIn(day, system);
      const boundary =
        this.zoom === 'day' ? true : this.zoom === 'week' ? weekdayOf(day) === weekStart : parts.day === 1;
      if (boundary) grid.createDiv({ cls: 'taskpro-tl__gridline' }).style.setProperty('--x', String(i));
      if (this.zoom === 'day' && isWeekend(day, system)) {
        grid.createDiv({ cls: 'taskpro-tl__weekend' }).style.setProperty('--x', String(i));
      }
    });
  }

  private accent(task: BoardTask): string {
    const tags = this.ctx.settings().tags;
    if (task.tags.length) return resolveTagColor(resolveTag(task.tags[0], tags).color);
    const parent = task.parentId ? this.ctx.host.store.inFile(task.filePath).find((t) => t.id === task.parentId) : undefined;
    if (parent?.tags.length) return resolveTagColor(resolveTag(parent.tags[0], tags).color);
    return STATUS_ACCENT[task.status] ?? STATUS_ACCENT['[ ]'];
  }

  private renderRow(rowsEl: HTMLElement, row: TimelineRow, from: DayKey, to: DayKey, index: number): void {
    const { task } = row;
    const el = rowsEl.createDiv({ cls: 'taskpro-tl__row' });
    stagger(el, index);
    el.dataset.taskId = task.id;
    el.dataset.status = task.status;
    el.style.setProperty('--tl-accent', this.accent(task));
    const cell = this.rowCell(el, task, row.depth, row.hasChildren);

    const lane = el.createDiv({ cls: 'taskpro-tl__lane' });
    const shown = (start: DayKey, end: DayKey) => compareDays(end, from) >= 0 && compareDays(start, to) <= 0;

    if (row.summary && shown(row.summary.start, row.summary.end)) {
      const bracket = lane.createDiv({ cls: 'taskpro-tl__summary' });
      this.place(bracket, row.summary.start, row.summary.end, from);
    }
    const span = row.span;
    if (span && shown(span.start, span.end)) {
      if (span.kind === 'milestone') this.milestone(lane, task, span.start, from);
      else this.bar(lane, task, span.start, span.end, from);
    }
    if (span?.late && shown(span.late, span.late)) {
      const flag = lane.createDiv({ cls: 'taskpro-tl__late' });
      flag.style.setProperty('--x', String(daysBetween(from, span.late) + 0.5));
      setIcon(flag, 'flag');
      flag.title = `${this.labels.late}: ${mediumDay(span.late, this.system, this.language)}`;
    }

    // A task whose days are all off screen: a pointer to where it is.
    const range = span ? { start: span.start, end: span.late && compareDays(span.late, span.end) > 0 ? span.late : span.end } : row.summary;
    if (range && !shown(range.start, range.end)) {
      const before = compareDays(range.end, from) < 0;
      const jump = cell.createEl('button', { cls: `taskpro-tl__jump ${before ? 'is-before' : 'is-after'}` });
      jump.type = 'button';
      jump.createSpan({ text: mediumDay(before ? range.end : range.start, this.system, this.language) });
      setIcon(jump.createSpan({ cls: 'taskpro-tl__jump-icon' }), before !== this.rtl ? 'chevron-left' : 'chevron-right');
      jump.title = this.labels.jumpTo;
      jump.addEventListener('click', () => {
        this.anchor = addDays(range.start, -this.scale.lead);
        this.scroll = { left: 0, top: this.scroller?.scrollTop ?? 0 };
        this.refresh();
      });
    }
  }

  /** The list side of a row: the checkbox, the title (indented under its parent), and an hourglass while it waits. */
  private rowCell(el: HTMLElement, task: BoardTask, depth: number, parent: boolean): HTMLElement {
    const cell = el.createDiv({ cls: 'taskpro-tl__cell' });
    cell.style.setProperty('--depth', String(Math.min(depth, 6)));
    cell.toggleClass('is-parent', parent);
    const check = cell.createEl('button', { cls: 'taskpro-board__check' });
    check.type = 'button';
    check.dataset.status = task.status;
    check.setAttribute('role', 'checkbox');
    check.setAttribute('aria-checked', task.status === '[/]' ? 'mixed' : String(task.status === '[x]'));
    check.addEventListener('click', (event) => {
      event.stopPropagation();
      void this.ctx.host.setStatus(task, task.status === '[x]' ? '[ ]' : '[x]');
    });
    const title = cell.createSpan({ cls: 'taskpro-tl__title', text: displayTitle(task.text) || '—', attr: { dir: 'auto' } });
    title.setAttribute('role', 'button');
    title.tabIndex = 0;
    const open = (at: { x: number; y: number } | DOMRect) => this.ctx.openTaskActions(task, at, title);
    title.addEventListener('click', () => open(title.getBoundingClientRect()));
    title.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      open(title.getBoundingClientRect());
    });
    if (this.ctx.relations().isWaiting(task)) {
      const mark = cell.createSpan({ cls: 'taskpro-board__waiting' });
      setIcon(mark, 'hourglass');
    }
    el.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      event.stopPropagation();
      open({ x: event.clientX, y: event.clientY });
    });
    return cell;
  }

  /** Sets an element's start and length from its days; `--x` and `--w` are in days. */
  private place(el: HTMLElement, start: DayKey, end: DayKey, from: DayKey): void {
    el.style.setProperty('--x', String(daysBetween(from, start)));
    el.style.setProperty('--w', String(daysBetween(start, end) + 1));
  }

  private describe(task: BoardTask): string {
    const lines = [displayTitle(task.text) || '—'];
    if (task.schedule) lines.push(`${this.labels.plan}: ${mediumDay(task.schedule.date, this.system, this.language)}${task.schedule.start ? ` ${task.schedule.start}${task.schedule.end ? `–${task.schedule.end}` : ''}` : ''}`);
    if (task.deadline) lines.push(`${this.labels.deadline}: ${mediumDay(task.deadline, this.system, this.language)}`);
    const waiting = this.ctx.relations().openBlockers(task);
    if (waiting.length) lines.push(`${this.labels.waitingOn}: ${waiting.map((t) => displayTitle(t.text)).join(', ')}`);
    lines.push(task.fileName);
    return lines.join('\n');
  }

  private bar(lane: HTMLElement, task: BoardTask, start: DayKey, end: DayKey, from: DayKey): void {
    const bar = lane.createDiv({ cls: 'taskpro-tl__bar' });
    this.place(bar, start, end, from);
    bar.toggleClass('is-done', task.status === '[x]');
    bar.toggleClass('is-waiting', this.ctx.relations().isWaiting(task));
    bar.toggleClass('is-narrow', (daysBetween(start, end) + 1) * this.scale.px < 64);
    bar.title = this.describe(task);
    const progress = this.ctx.progress(task);
    if (progress !== null) bar.createDiv({ cls: 'taskpro-tl__bar-fill' }).style.setProperty('--progress', String(progress));
    // The board's direction places the name; the name's own script only orders its letters.
    const label = bar.createSpan({ cls: 'taskpro-tl__bar-label' });
    if (task.status !== '[ ]') setIcon(label.createSpan({ cls: 'taskpro-tl__bar-icon' }), STATUS_ICON_NAMES[task.status]);
    label.createSpan({ text: displayTitle(task.text) || '—', attr: { dir: 'auto' } });
    const canPlan = !!this.ctx.host.setDates || !!this.ctx.host.setSchedule;
    if (canPlan) {
      bar.createDiv({ cls: 'taskpro-tl__handle is-start' });
      bar.createDiv({ cls: 'taskpro-tl__handle is-end' });
    }
    this.draggable(bar, lane, task, start, end);
  }

  private milestone(lane: HTMLElement, task: BoardTask, day: DayKey, from: DayKey): void {
    const diamond = lane.createDiv({ cls: 'taskpro-tl__milestone' });
    diamond.style.setProperty('--x', String(daysBetween(from, day) + 0.5));
    diamond.toggleClass('is-done', task.status === '[x]');
    diamond.title = this.describe(task);
    const label = diamond.createSpan({ cls: 'taskpro-tl__milestone-label' });
    label.createSpan({ text: displayTitle(task.text) || '—', attr: { dir: 'auto' } });
    label.toggleClass('is-hidden', this.zoom === 'month');
    this.draggable(diamond, lane, task, day, day);
  }

  // ── Dragging ─────────────────────────────────────────────────────────

  private draggable(el: HTMLElement, lane: HTMLElement, task: BoardTask, start: DayKey, end: DayKey): void {
    el.setAttribute('role', 'button');
    el.tabIndex = 0;
    el.addEventListener('click', (event) => {
      event.stopPropagation();
      if (this.swallowClick) return;
      this.ctx.openTaskActions(task, el.getBoundingClientRect(), el);
    });
    el.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      this.ctx.openTaskActions(task, el.getBoundingClientRect(), el);
    });
    el.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.ctx.openTaskActions(task, { x: event.clientX, y: event.clientY }, el);
    });
    el.addEventListener('pointerdown', (down) => {
      if (down.button !== 0 || (!this.ctx.host.setDates && !this.ctx.host.setSchedule)) return;
      // A finger holds a bar to pick it up; one that moves at once scrolls the chart.
      holdToDrag(down, () => this.pressBar(down, el, lane, task, start, end));
    });
  }

  private pressBar(event: PointerEvent, el: HTMLElement, lane: HTMLElement, task: BoardTask, start: DayKey, end: DayKey): void {
    {
      const handle = (event.target as HTMLElement).closest('.taskpro-tl__handle');
      // A diamond is one day: it moves, whichever part of it is pressed.
      const mode: Drag['mode'] = el.hasClass('taskpro-tl__milestone')
        ? 'move'
        : handle?.hasClass('is-start')
          ? 'start'
          : handle?.hasClass('is-end')
            ? 'end'
            : 'move';
      this.drag = { task, mode, bar: el, lane, startX: event.clientX, from: start, to: end, delta: 0, moved: false, label: null };
      const doc = el.ownerDocument;
      const onMove = (e: PointerEvent) => this.moveDrag(e);
      const onUp = (e: PointerEvent) => {
        // Where it let go, whether or not its last move had been delivered.
        this.moveDrag(e);
        doc.removeEventListener('pointermove', onMove, true);
        doc.removeEventListener('pointerup', onUp, true);
        doc.removeEventListener('pointercancel', onCancel, true);
        doc.removeEventListener('keydown', onKey, true);
        this.endDrag(true);
      };
      const onCancel = () => {
        doc.removeEventListener('pointermove', onMove, true);
        doc.removeEventListener('pointerup', onUp, true);
        doc.removeEventListener('pointercancel', onCancel, true);
        doc.removeEventListener('keydown', onKey, true);
        this.endDrag(false);
      };
      const onKey = (e: KeyboardEvent) => {
        if (e.key !== 'Escape') return;
        e.preventDefault();
        e.stopPropagation();
        onCancel();
      };
      doc.addEventListener('pointermove', onMove, true);
      doc.addEventListener('pointerup', onUp, true);
      doc.addEventListener('pointercancel', onCancel, true);
      doc.addEventListener('keydown', onKey, true);
    }
  }

  /** The days a drag has reached so far, kept in order: a start never passes the end. */
  private dragged(drag: Drag): { start: DayKey; end: DayKey } {
    if (drag.mode === 'move') return { start: addDays(drag.from, drag.delta), end: addDays(drag.to, drag.delta) };
    if (drag.mode === 'start') {
      const start = addDays(drag.from, drag.delta);
      return { start: compareDays(start, drag.to) > 0 ? drag.to : start, end: drag.to };
    }
    const end = addDays(drag.to, drag.delta);
    return { start: drag.from, end: compareDays(end, drag.from) < 0 ? drag.from : end };
  }

  private moveDrag(event: PointerEvent): void {
    const drag = this.drag;
    if (!drag) return;
    const dx = (event.clientX - drag.startX) * (this.rtl ? -1 : 1);
    if (!drag.moved && Math.abs(dx) < DRAG_THRESHOLD) return;
    if (!drag.moved) {
      drag.moved = true;
      this.ctx.hold(true);
      drag.bar.addClass('is-dragging');
      this.scroller?.addClass('is-dragging');
      drag.label = drag.lane.createDiv({ cls: 'taskpro-tl__drag-label' });
    }
    drag.delta = Math.round(dx / this.scale.px);
    const { start, end } = this.dragged(drag);
    const from = this.from();
    if (drag.bar.hasClass('taskpro-tl__milestone')) drag.bar.style.setProperty('--x', String(daysBetween(from, end) + 0.5));
    else this.place(drag.bar, start, end, from);
    if (drag.label) {
      drag.label.style.setProperty('--x', String(daysBetween(from, start)));
      const first = mediumDay(start, this.system, this.language);
      drag.label.setText(start === end ? first : `${first} → ${mediumDay(end, this.system, this.language)}`);
    }
    this.edgeScroll(event.clientX);
  }

  /** Near the chart's edge, a drag scrolls it along. */
  private edgeScroll(clientX: number): void {
    const el = this.scroller;
    if (!el) return;
    const box = el.getBoundingClientRect();
    const list = this.listWidth();
    const startEdge = this.rtl ? box.right - list : box.left + list;
    const endEdge = this.rtl ? box.left : box.right;
    const towardStart = this.rtl ? clientX > startEdge - 30 : clientX < startEdge + 30;
    const towardEnd = this.rtl ? clientX < endEdge + 30 : clientX > endEdge - 30;
    if (towardStart) el.scrollLeft += this.rtl ? 12 : -12;
    else if (towardEnd) el.scrollLeft += this.rtl ? -12 : 12;
  }

  private endDrag(commit: boolean): void {
    const drag = this.drag;
    this.drag = null;
    if (!drag) return;
    drag.label?.remove();
    drag.bar.removeClass('is-dragging');
    this.scroller?.removeClass('is-dragging');
    if (!drag.moved) return;
    this.swallowClick = true;
    window.setTimeout(() => (this.swallowClick = false), 0);
    const done = () => this.ctx.hold(false);
    if (!commit || drag.delta === 0) {
      done();
      this.ctx.rerender();
      return;
    }
    void this.commit(drag).finally(done);
  }

  /**
   * Writes what a drag did. Moving shifts the plan and the deadline by the
   * same days, keeping the plan's time; the start moves the plan; the end
   * moves the deadline, or gives the task one.
   */
  private async commit(drag: Drag): Promise<void> {
    const { task } = drag;
    const { start, end } = this.dragged(drag);
    const plan = task.schedule;
    const patch: { schedule?: TaskSchedule | null; deadline?: string | null } = {};
    if (drag.mode === 'move') {
      if (plan) patch.schedule = { ...plan, date: addDays(plan.date, drag.delta) };
      if (task.deadline) patch.deadline = addDays(task.deadline, drag.delta);
    } else if (drag.mode === 'start') {
      if (plan) patch.schedule = { ...plan, date: start };
    } else {
      patch.deadline = end;
    }
    await this.writeDates(task, patch);
  }

  private async writeDates(task: BoardTask, patch: { schedule?: TaskSchedule | null; deadline?: string | null }): Promise<void> {
    const host = this.ctx.host;
    if (host.setDates) {
      await host.setDates(task, patch);
      return;
    }
    // A host that can only write one at a time: the plan, then the deadline on the line as it is now.
    if (patch.schedule !== undefined) await host.setSchedule?.(task, patch.schedule);
    if (patch.deadline !== undefined) {
      const fresh = host.store.inFile(task.filePath).find((t) => t.lineNumber === task.lineNumber) ?? task;
      await host.setDeadline?.(fresh, patch.deadline);
    }
  }

  // ── Dependencies ─────────────────────────────────────────────────────

  /**
   * An arrow from the end of each task waited on to the start of the task
   * waiting, both on screen. It leaves through the bar's top or bottom edge
   * rather than past its end, where the names of bars ending that day sit,
   * and runs behind any bar it crosses on the way.
   */
  private renderLinks(
    rowsEl: HTMLElement,
    rows: TimelineRow[],
    positions: Map<string, TimelinePosition>,
    count: number
  ): void {
    const relations = this.ctx.relations();
    const px = this.scale.px;
    const ROW_HEIGHT = this.rowHeight;
    // Bars stand 6px in from their row's edges; a milestone's diamond is about 16px across.
    const reach = (pos: TimelinePosition) => (pos.milestone ? 8 : ROW_HEIGHT / 2 - 6);
    const paths: Array<{ d: string; late: boolean }> = [];
    for (const row of rows) {
      const to = positions.get(row.task.id);
      if (!to) continue;
      for (const blocker of relations.blockersOf(row.task)) {
        const from = blocker.task ? positions.get(blocker.task.id) : undefined;
        if (!from || from.index === to.index) continue;
        const down = to.index > from.index;
        const exitX = from.milestone ? (from.start + 0.5) * px : from.end * px - Math.min(8, ((from.end - from.start) * px) / 2);
        const exitY = from.index * ROW_HEIGHT + ROW_HEIGHT / 2 + (down ? reach(from) : -reach(from));
        const tipX = to.milestone ? (to.start + 0.5) * px - 9 : to.start * px;
        const y = to.index * ROW_HEIGHT + ROW_HEIGHT / 2;
        const late = blocker.task!.status !== '[x]' && finishesAfterStart(blocker.task!, row.task);
        // Starting before the other ends: round by the line between the rows, to come in from before.
        const gap = down ? to.index * ROW_HEIGHT : (to.index + 1) * ROW_HEIGHT;
        const d = roundedPath(
          tipX - exitX >= 10
            ? [[exitX, exitY], [exitX, y], [tipX, y]]
            : [[exitX, exitY], [exitX, gap], [tipX - 10, gap], [tipX - 10, y], [tipX, y]],
          LINK_CORNER
        );
        paths.push({ d, late });
      }
    }
    if (!paths.length) return;
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.classList.add('taskpro-tl__links');
    svg.setAttribute('width', String(count * px));
    svg.setAttribute('height', String(rows.length * ROW_HEIGHT));
    const defs = document.createElementNS(ns, 'defs');
    for (const id of ['taskpro-tl-arrow', 'taskpro-tl-arrow-late']) {
      const marker = document.createElementNS(ns, 'marker');
      marker.setAttribute('id', id);
      marker.setAttribute('viewBox', '0 0 8 8');
      marker.setAttribute('refX', '7');
      marker.setAttribute('refY', '4');
      marker.setAttribute('markerWidth', '6');
      marker.setAttribute('markerHeight', '6');
      marker.setAttribute('orient', 'auto');
      const tip = document.createElementNS(ns, 'path');
      tip.setAttribute('d', 'M0 0 L8 4 L0 8 z');
      tip.classList.add(id === 'taskpro-tl-arrow' ? 'taskpro-tl__link-tip' : 'taskpro-tl__link-tip-late');
      marker.appendChild(tip);
      defs.appendChild(marker);
    }
    svg.appendChild(defs);
    for (const { d, late } of paths) {
      const path = document.createElementNS(ns, 'path');
      path.setAttribute('d', d);
      path.classList.add('taskpro-tl__link');
      if (late) path.classList.add('is-late');
      path.setAttribute('marker-end', `url(#${late ? 'taskpro-tl-arrow-late' : 'taskpro-tl-arrow'})`);
      svg.appendChild(path);
    }
    rowsEl.appendChild(svg);
  }

  // ── Tasks with no dates ──────────────────────────────────────────────

  /** Folded away until asked for; a click on a day in a row plans the task for that day. */
  private renderUndated(canvas: HTMLElement, tasks: BoardTask[], from: DayKey): void {
    const labels = this.labels;
    const open = !!this.ctx.prefs().timelineUndated;
    const section = canvas.createDiv({ cls: 'taskpro-tl__undated' });
    section.toggleClass('is-open', open);
    const head = section.createDiv({ cls: 'taskpro-tl__undated-head' });
    const toggle = head.createEl('button', { cls: 'taskpro-tl__undated-toggle' });
    toggle.type = 'button';
    toggle.setAttribute('aria-expanded', String(open));
    setIcon(toggle.createSpan({ cls: 'taskpro-table__caret' }), 'chevron-down');
    toggle.createSpan({ text: labels.undated(tasks.length) });
    toggle.addEventListener('click', () => void this.ctx.updatePrefs({ timelineUndated: !open }));
    if (!open) return;
    if (this.ctx.host.setSchedule) head.createSpan({ cls: 'taskpro-tl__undated-hint', text: labels.planOnDay });

    const rowsEl = section.createDiv({ cls: 'taskpro-tl__rows is-undated' });
    for (const task of tasks) {
      const el = rowsEl.createDiv({ cls: 'taskpro-tl__row is-undated' });
      el.dataset.taskId = task.id;
      el.dataset.status = task.status;
      el.style.setProperty('--tl-accent', this.accent(task));
      this.rowCell(el, task, 0, false);
      const lane = el.createDiv({ cls: 'taskpro-tl__lane' });
      if (!this.ctx.host.setSchedule) continue;
      const ghost = lane.createDiv({ cls: 'taskpro-tl__ghost' });
      const dayAt = (clientX: number): number => {
        const box = lane.getBoundingClientRect();
        const offset = this.rtl ? box.right - clientX : clientX - box.left;
        return Math.max(0, Math.floor(offset / this.scale.px));
      };
      lane.addEventListener('pointermove', (event) => ghost.style.setProperty('--x', String(dayAt(event.clientX))));
      lane.addEventListener('click', (event) => {
        const day = addDays(from, dayAt(event.clientX));
        void this.ctx.host.setSchedule?.(task, { date: day });
      });
    }
  }
}
