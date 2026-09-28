// ── editor/property-suggest.ts ────────────────────────────────────────────
// Typing `@` on a task line lists everything a task can be given — a status,
// a priority, a deadline, a plan, a repeat rule, a tag — the way Notion's
// `@` and `/` do. Picking one writes the canonical marker (`@priority(high)`,
// `@due(2026-10-01)` …) through the same writers the menus use, so a marker
// that was already there is replaced, not doubled, and the typed `@query` is
// taken out again.
// ─────────────────────────────────────────────────────────────────────────────

import { App, Editor, EditorPosition, EditorSuggest, EditorSuggestContext, EditorSuggestTriggerInfo, TFile, setIcon } from 'obsidian';
import {
  CalendarSystem,
  Language,
  PRIORITY_ICON_NAMES,
  PRIORITY_LABELS,
  REPEAT_PRESETS,
  STATUS_ICON_NAMES,
  STATUS_LABELS,
  TASK_PRIORITIES,
  TaskStatus,
  TimeFormat,
} from '../types';
import {
  extractSchedule,
  extractTags,
  setDeadline,
  setPriority,
  setRepeat,
  setSchedule,
  setTags,
} from '../task-metadata';
import { TaskTag, resolveTagColor } from '../tags';
import { getActionLabels } from '../board/task-actions';
import { getRepeatLabels } from '../timer-localization';
import { addDays, shortDay, todayKey } from '../calendar/calendar-dates';
import { pickDeadline } from '../ui/deadline-editor';
import { openSchedulePanel } from '../ui/schedule-editor';

/** A task line with the cursor after its checkbox. */
const TASK_PREFIX = /^\s*- \[[ \/xX!]\] /;
/** `@` at the start of a word, and what has been typed after it; Persian words keep their zero-width non-joiner. */
const TOKEN = /(?:^|\s)@([\p{L}\p{M}\p{N}_\u200c-]*)$/u;
const STATUS_ORDER: TaskStatus[] = ['[ ]', '[/]', '[x]', '[!]'];

export interface PropertySuggestion {
  group: 'status' | 'priority' | 'deadline' | 'plan' | 'repeat' | 'tag';
  groupLabel: string;
  label: string;
  icon?: string;
  swatch?: string;
  /** What is written, shown faintly beside the label. */
  preview?: string;
  keywords: string;
  /** Rewrites the line; absent when a picker has to ask first. */
  apply?: (line: string) => string;
  ask?: 'deadline' | 'plan';
}

export interface SuggestContext {
  language: Language;
  calendarSystem: CalendarSystem;
  timeFormat: TimeFormat;
  tags: readonly TaskTag[];
  /** The line as it is, for what it already has. */
  line: string;
}

/** Everything `@` offers, in the order it lists them. */
export function allPropertySuggestions(ctx: SuggestContext): PropertySuggestion[] {
  const { language } = ctx;
  const labels = getActionLabels(language);
  const english = getActionLabels('en');
  const repeatLabels = getRepeatLabels(language);
  const out: PropertySuggestion[] = [];
  const today = todayKey();
  const days: Array<[string, string, string]> = [
    [labels.today, english.today, today],
    [labels.tomorrow, english.tomorrow, addDays(today, 1)],
    [labels.nextWeek, english.nextWeek, addDays(today, 7)],
  ];

  for (const level of TASK_PRIORITIES) {
    out.push({
      group: 'priority',
      groupLabel: labels.priority,
      label: PRIORITY_LABELS[language][level],
      icon: PRIORITY_ICON_NAMES[level],
      preview: `@priority(${level})`,
      keywords: `priority ${english.priority} ${PRIORITY_LABELS.en[level]} ${level}`,
      apply: (line) => setPriority(line, level),
    });
  }

  for (const [label, en, day] of days) {
    out.push({
      group: 'deadline',
      groupLabel: labels.deadline,
      label: `${label} · ${shortDay(day, ctx.calendarSystem, language)}`,
      icon: 'flag',
      preview: `@due(${day})`,
      keywords: `due deadline ${english.deadline} ${en}`,
      apply: (line) => setDeadline(line, day),
    });
  }
  out.push({
    group: 'deadline',
    groupLabel: labels.deadline,
    label: labels.pickDate,
    icon: 'calendar-search',
    keywords: `due deadline ${english.deadline} ${english.pickDate} date`,
    ask: 'deadline',
  });

  const plan = extractSchedule(ctx.line);
  for (const [label, en, day] of days) {
    out.push({
      group: 'plan',
      groupLabel: labels.plan,
      label: `${label} · ${shortDay(day, ctx.calendarSystem, language)}`,
      icon: 'calendar-clock',
      preview: `@schedule(${day})`,
      keywords: `plan schedule calendar ${english.plan} ${en}`,
      // A planned time stays with the plan when only its day changes.
      apply: (line) => setSchedule(line, plan ? { ...plan, date: day } : { date: day }),
    });
  }
  out.push({
    group: 'plan',
    groupLabel: labels.plan,
    label: labels.pickTime,
    icon: 'calendar-clock',
    keywords: `plan schedule calendar time ${english.plan} ${english.pickTime}`,
    ask: 'plan',
  });

  for (const preset of REPEAT_PRESETS) {
    out.push({
      group: 'repeat',
      groupLabel: labels.repeat,
      label: repeatLabels.preset(preset),
      icon: 'repeat',
      preview: `@repeat(${preset.every}${preset.unit[0]})`,
      keywords: `repeat recur ${english.repeat} ${getRepeatLabels('en').preset(preset)} ${preset.every === 1 ? `${preset.unit === 'day' ? 'dai' : preset.unit}ly` : ''}`,
      apply: (line) => setRepeat(line, { ...preset }),
    });
  }

  const current = extractTags(ctx.line);
  for (const tag of ctx.tags) {
    const has = current.includes(tag.key);
    out.push({
      group: 'tag',
      groupLabel: labels.tags,
      label: tag.name,
      swatch: resolveTagColor(tag.color),
      preview: has ? '✓' : `@tag(${tag.key})`,
      keywords: `tag ${english.tags} ${tag.key}`,
      // Picking a tag the task has takes it off again.
      apply: (line) => setTags(line, has ? current.filter((key) => key !== tag.key) : [...current, tag.key]),
    });
  }

  for (const status of STATUS_ORDER) {
    out.push({
      group: 'status',
      groupLabel: labels.status,
      label: STATUS_LABELS[language][status],
      icon: STATUS_ICON_NAMES[status],
      preview: status,
      keywords: `status ${english.status} ${STATUS_LABELS.en[status]}`,
      apply: (line) => line.replace(/^(\s*)- \[[ \/xX!]\]/, `$1- ${status}`),
    });
  }
  return out;
}

/** The suggestions that match what was typed after `@`: every word has to be found. */
export function propertySuggestions(query: string, ctx: SuggestContext): PropertySuggestion[] {
  const all = allPropertySuggestions(ctx);
  const terms = query.toLowerCase().split(/[\s_-]+/).filter(Boolean);
  if (!terms.length) return all;
  return all.filter((item) => {
    const haystack = `${item.groupLabel} ${item.label} ${item.keywords}`.toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}

/** Where a typed `@query` starts, if the cursor is at the end of one on a task line. */
export function findToken(line: string, ch: number): { start: number; query: string } | null {
  const prefix = TASK_PREFIX.exec(line);
  if (!prefix || ch < prefix[0].length) return null;
  const before = line.slice(0, ch);
  const match = TOKEN.exec(before);
  if (!match) return null;
  const start = ch - match[1].length - 1;
  if (start < prefix[0].length) return null;
  return { start, query: match[1] };
}

/** The line without the typed `@query` and the space it left behind. */
export function removeToken(line: string, start: number, end: number): { line: string; cursor: number } {
  let head = line.slice(0, start);
  let tail = line.slice(end);
  if (head.endsWith(' ') && (tail.startsWith(' ') || !tail)) head = head.slice(0, -1);
  if (!tail.trim()) tail = '';
  return { line: head + tail, cursor: head.length };
}

export interface PropertySuggestHost {
  app: App;
  settings(): { enabled: boolean; language: Language; calendarSystem: CalendarSystem; timeFormat: TimeFormat; tags: readonly TaskTag[]; defaultDuration: number };
  /** Whether TaskPro works in this note (the target folder). */
  appliesTo(file: TFile | null): boolean;
  /** Redraws chips after the line changed. */
  refresh(): void;
}

export class TaskPropertySuggest extends EditorSuggest<PropertySuggestion> {
  constructor(private readonly host: PropertySuggestHost) {
    super(host.app);
    this.limit = 40;
  }

  onTrigger(cursor: EditorPosition, editor: Editor, file: TFile | null): EditorSuggestTriggerInfo | null {
    if (!this.host.settings().enabled || !this.host.appliesTo(file)) return null;
    const token = findToken(editor.getLine(cursor.line), cursor.ch);
    if (!token) return null;
    return { start: { line: cursor.line, ch: token.start }, end: cursor, query: token.query };
  }

  getSuggestions(context: EditorSuggestContext): PropertySuggestion[] {
    const settings = this.host.settings();
    return propertySuggestions(context.query, { ...settings, line: context.editor.getLine(context.start.line) });
  }

  renderSuggestion(item: PropertySuggestion, el: HTMLElement): void {
    el.addClass('taskpro-suggest');
    const icon = el.createSpan({ cls: 'taskpro-suggest__icon' });
    if (item.swatch) icon.createSpan({ cls: 'taskpro-suggest__swatch' }).style.setProperty('--taskpro-suggest-swatch', item.swatch);
    else if (item.icon) setIcon(icon, item.icon);
    el.createSpan({ cls: 'taskpro-suggest__group', text: item.groupLabel });
    el.createSpan({ cls: 'taskpro-suggest__label', text: item.label, attr: { dir: 'auto' } });
    if (item.preview) el.createSpan({ cls: 'taskpro-suggest__preview', text: item.preview, attr: { dir: 'ltr' } });
  }

  selectSuggestion(item: PropertySuggestion): void {
    const context = this.context;
    if (!context) return;
    const { editor, start, end } = context;
    const lineNumber = start.line;
    const original = editor.getLine(lineNumber);
    const removed = removeToken(original, start.ch, end.ch);
    this.close();

    const write = (next: string, cursor: number) => {
      const current = editor.getLine(lineNumber);
      editor.replaceRange(next, { line: lineNumber, ch: 0 }, { line: lineNumber, ch: current.length });
      editor.setCursor({ line: lineNumber, ch: Math.min(cursor, next.length) });
      this.host.refresh();
    };

    if (item.apply) {
      write(item.apply(removed.line), removed.cursor);
      return;
    }

    // A picker first: the typed `@query` goes now, the marker once it is answered.
    write(removed.line, removed.cursor);
    const settings = this.host.settings();
    void (async () => {
      const line = editor.getLine(lineNumber);
      if (item.ask === 'deadline') {
        const choice = await pickDeadline(this.host.app, { language: settings.language, calendarSystem: settings.calendarSystem });
        if (choice !== undefined) write(setDeadline(editor.getLine(lineNumber), choice), removed.cursor);
      } else {
        const choice = await openSchedulePanel({
          language: settings.language,
          calendarSystem: settings.calendarSystem,
          schedule: extractSchedule(line),
          defaultDuration: settings.defaultDuration,
          timeFormat: settings.timeFormat,
        });
        if (choice !== undefined) write(setSchedule(editor.getLine(lineNumber), choice), removed.cursor);
      }
    })();
  }
}
