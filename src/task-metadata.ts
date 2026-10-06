// ── task-metadata.ts ─────────────────────────────────────────────────────
// Shared helpers for parsing and updating task metadata markers.

import { RepeatUnit, TaskPriority, TaskProgress, TaskRepeat, TaskSchedule, PRIORITY_ICONS, TASK_PRIORITIES } from './types';

// Canonical inline form is `@due(2026-08-10)`, matching `@priority(...)`.
//
// The hourglass emoji is no longer written. It stayed visible in plain text
// wherever TaskPro does not render (search results, exports, other plugins,
// mobile previews) and carried no meaning on its own. The legacy emoji and
// `[due:: ...]` forms are still parsed, so existing notes keep working and are
// rewritten to the canonical form on the next edit.
const DEADLINE_PATTERN =
  /@due\(\s*(\d{4}-\d{2}-\d{2})\s*\)|(?:⏳|📅)\s*(\d{4}-\d{2}-\d{2})|\[(?:due|deadline)::\s*(\d{4}-\d{2}-\d{2})\]/;
const DEADLINE_PATTERN_GLOBAL = new RegExp(DEADLINE_PATTERN.source, 'g');
const PROGRESS_PATTERN = /\[progress::\s*(\d+)\/(\d+)\]/;
const PROGRESS_PATTERN_GLOBAL = new RegExp(PROGRESS_PATTERN.source, 'g');
const LEADING_WHITESPACE_PATTERN = /^\s*/;
// Canonical inline form is `@priority(high)`.
//
// Why not `[priority:: high]`? Obsidian renders `[key:: value]` itself as a
// Dataview-style inline field in Live Preview. That native widget wins over our
// replace decoration, so the marker stayed visible while the cursor was away
// and only collapsed when the line was being edited — the exact opposite of
// what we want. `@priority(...)` has no native renderer, so we control it fully.
//
// Both the legacy `[priority:: high]` field and the Obsidian Tasks emoji are
// still parsed for backwards compatibility and are rewritten on the next edit.
// Canonical inline form is `@repeat(1w)`; `daily` / `weekly` / `monthly` and a
// bare unit (`@repeat(w)`) are accepted on the way in and rewritten on the next
// edit. Same reasoning as `@priority(...)`: Obsidian renders `[key:: value]`
// itself, which would fight our replace decoration.
const REPEAT_PATTERN =
  /@repeat\(\s*(?:(\d+)\s*)?(d|w|m|day|days|daily|week|weeks|weekly|month|months|monthly)\s*\)/i;
const REPEAT_PATTERN_GLOBAL = new RegExp(REPEAT_PATTERN.source, 'gi');
const REPEAT_UNIT_BY_TOKEN: Record<string, RepeatUnit> = {
  d: 'day', day: 'day', days: 'day', daily: 'day',
  w: 'week', week: 'week', weeks: 'week', weekly: 'week',
  m: 'month', month: 'month', months: 'month', monthly: 'month',
};
const REPEAT_UNIT_TOKEN: Record<RepeatUnit, string> = { day: 'd', week: 'w', month: 'm' };

const PRIORITY_KEYWORD_PATTERN = /@priority\(\s*(highest|high|medium|low|lowest)\s*\)/i;
const PRIORITY_LEGACY_FIELD_PATTERN = /\[priority::\s*(highest|high|medium|low|lowest)\s*\]/i;
const PRIORITY_EMOJI_PATTERN = /(\uD83D\uDD3A|\u23EB|\uD83D\uDD3C|\uD83D\uDD3D|\u23EC)/;
const PRIORITY_PATTERN_GLOBAL = new RegExp(
  `${PRIORITY_KEYWORD_PATTERN.source}|${PRIORITY_LEGACY_FIELD_PATTERN.source}|${PRIORITY_EMOJI_PATTERN.source}`,
  'gi'
);
const PRIORITY_BY_EMOJI: Record<string, TaskPriority> = TASK_PRIORITIES.reduce(
  (acc, priority) => {
    acc[PRIORITY_ICONS[priority]] = priority;
    return acc;
  },
  {} as Record<string, TaskPriority>
);

// Canonical inline form is `@tag(work, client-a)`: one marker, comma separated
// tag keys. Several markers on one line are merged on the way in and rewritten
// as one on the next edit. A key is what the note stores; the tag's display
// name and colour live in the plugin's tag list, so renaming a tag or changing
// its colour never has to touch a note. Keys accept any script, so Persian
// keys (including the zero-width non-joiner) work as well as Latin ones.
//
// Built with `new RegExp` so the Unicode property classes are not compiled
// against the ES6 target TypeScript checks regex literals with.
const TAG_PATTERN_SOURCE = String.raw`@tag\(\s*([^()\n]*?)\s*\)`;
const TAG_PATTERN_GLOBAL = new RegExp(TAG_PATTERN_SOURCE, 'gu');
const TAG_KEY_DISALLOWED = new RegExp(String.raw`[^\p{L}\p{N}\p{M}_\-/\u200c]`, 'gu');

// Canonical inline form is `@schedule(2026-09-28 09:00-10:30)`, or
// `@schedule(2026-09-28)` for a day with no set time. A start with no end
// (`@schedule(2026-09-28 09:00)`) is read too; the calendar gives it the
// default block length. Times are 24-hour and local.
const SCHEDULE_PATTERN =
  /@schedule\(\s*(\d{4}-\d{2}-\d{2})(?:[ T]+(\d{1,2}:\d{2})(?:\s*[-\u2013]\s*(\d{1,2}:\d{2}))?)?\s*\)/;
const SCHEDULE_PATTERN_GLOBAL = new RegExp(SCHEDULE_PATTERN.source, 'g');

// Canonical inline form is `@waiting([[Planner/Launch#^tp-4k2a]])`: the tasks
// this one waits on, as Obsidian block links, comma separated. Links rather
// than bare IDs, so Obsidian keeps them pointing at the right note when a
// note is renamed or moved, and a dependency shows up among a note's links.
// A link to the same note may leave the path out: `[[#^tp-4k2a]]`.
const WAITING_PATTERN = /@waiting\(((?:\s*\[\[[^\]\n]+\]\]\s*,?)+)\s*\)/;
const WAITING_PATTERN_GLOBAL = new RegExp(WAITING_PATTERN.source, 'g');
const WAITING_LINK_PATTERN = /\[\[([^\]#|\n]*)#\^([a-zA-Z0-9-]+)(?:\|[^\]\n]*)?\]\]/g;

// Canonical inline form is `@remind(10m)`: how long before its planned start a
// task asks for attention, in minutes (`m`) or hours (`h`); `@remind(0m)` is
// at the start, and `@remind(off)` turns the reminder off for this task. A
// task without one uses the reminder setting. `@remind(2026-10-05 09:30)` is a
// reminder at one moment of its own, planned or not.
const REMIND_PATTERN = /@remind\(\s*(?:(off|\d{1,4}\s*[mh]?)|(\d{4}-\d{2}-\d{2})[ T]+(\d{1,2}:\d{2}))\s*\)/i;
const REMIND_PATTERN_GLOBAL = new RegExp(REMIND_PATTERN.source, 'gi');

function normalizeAfterMarkerRemovalPreserveIndent(line: string): string {
  const indent = line.match(LEADING_WHITESPACE_PATTERN)?.[0] ?? '';
  const withoutIndent = line.slice(indent.length);
  const normalizedContent = withoutIndent.replace(/[ \t]{2,}/g, ' ').trimEnd();
  return indent + normalizedContent;
}

/**
 * Extracts a deadline date string from a task line.
 */
export function extractDeadline(line: string): string | undefined {
  const match = line.match(DEADLINE_PATTERN);
  if (!match) {
    return undefined;
  }

  return (match[1] || match[2] || match[3])?.trim();
}

/**
 * Removes all deadline markers from a task line.
 */
export function stripDeadline(line: string): string {
  return line.replace(DEADLINE_PATTERN_GLOBAL, '').replace(/\s{2,}/g, ' ').trim();
}

/**
 * Removes all deadline markers while preserving leading indentation.
 * Use this in file write/sync paths to avoid breaking task nesting.
 */
export function stripDeadlinePreserveIndent(line: string): string {
  return normalizeAfterMarkerRemovalPreserveIndent(line.replace(DEADLINE_PATTERN_GLOBAL, ''));
}

/**
 * Replaces existing deadline markers with a new deadline, or removes them.
 */
export function setDeadline(line: string, deadline: string | null): string {
  const withoutDeadline = stripDeadlinePreserveIndent(line);
  if (!deadline) return withoutDeadline;

  const normalizedDeadline = deadline.trim();
  if (!normalizedDeadline) return withoutDeadline;

  const marker = `@due(${normalizedDeadline})`;
  const blockIdMatch = withoutDeadline.match(/\s*\^([a-zA-Z0-9-]+)\s*$/);
  if (blockIdMatch) {
    return withoutDeadline.replace(
      /\s*\^([a-zA-Z0-9-]+)\s*$/,
      ` ${marker} ^${blockIdMatch[1]}`
    );
  }

  return `${withoutDeadline} ${marker}`;
}

/**
 * Extracts progress information from a task line.
 */
export function extractProgress(line: string): TaskProgress | undefined {
  const match = line.match(PROGRESS_PATTERN);
  if (!match) {
    return undefined;
  }

  const currentSteps = parseInt(match[1], 10);
  const totalSteps = parseInt(match[2], 10);

  if (isNaN(currentSteps) || isNaN(totalSteps) || totalSteps <= 0) {
    return undefined;
  }

  return {
    enabled: true,
    currentSteps: Math.max(0, Math.min(currentSteps, totalSteps)),
    totalSteps
  };
}

/**
 * Removes all progress markers from a task line.
 */
export function stripProgress(line: string): string {
  return line.replace(PROGRESS_PATTERN_GLOBAL, '').replace(/\s{2,}/g, ' ').trim();
}

/**
 * Removes all progress markers while preserving leading indentation.
 * Use this in file write/sync paths to avoid breaking task nesting.
 */
export function stripProgressPreserveIndent(line: string): string {
  return normalizeAfterMarkerRemovalPreserveIndent(line.replace(PROGRESS_PATTERN_GLOBAL, ''));
}

/**
 * Replaces existing progress markers with new progress, or removes them.
 */
export function setProgress(line: string, progress: TaskProgress | null): string {
  const withoutProgress = stripProgressPreserveIndent(line);
  
  // Don't write progress marker to file - progress is stored separately
  // Just return the line without progress marker
  return withoutProgress;
}

/**
 * Extracts the priority level from a task line, if any.
 * Accepts both the canonical `[priority:: high]` form and Tasks-style emoji.
 */
export function extractPriority(line: string): TaskPriority | undefined {
  const keywordMatch = line.match(PRIORITY_KEYWORD_PATTERN);
  if (keywordMatch) {
    return keywordMatch[1].toLowerCase() as TaskPriority;
  }

  const legacyMatch = line.match(PRIORITY_LEGACY_FIELD_PATTERN);
  if (legacyMatch) {
    return legacyMatch[1].toLowerCase() as TaskPriority;
  }

  const emojiMatch = line.match(PRIORITY_EMOJI_PATTERN);
  if (emojiMatch) {
    return PRIORITY_BY_EMOJI[emojiMatch[1]];
  }

  return undefined;
}

/**
 * Removes all priority markers from a task line.
 */
export function stripPriority(line: string): string {
  return line.replace(PRIORITY_PATTERN_GLOBAL, '').replace(/\s{2,}/g, ' ').trim();
}

/**
 * Removes all priority markers while preserving leading indentation.
 * Use this in file write/sync paths to avoid breaking task nesting.
 */
export function stripPriorityPreserveIndent(line: string): string {
  return normalizeAfterMarkerRemovalPreserveIndent(line.replace(PRIORITY_PATTERN_GLOBAL, ''));
}

/**
 * Replaces existing priority markers with a new priority, or removes them.
 * The marker is inserted before a trailing block ID so the ID stays last.
 */
export function setPriority(line: string, priority: TaskPriority | null): string {
  const withoutPriority = stripPriorityPreserveIndent(line);
  if (!priority) return withoutPriority;

  const marker = `@priority(${priority})`;
  const blockIdMatch = withoutPriority.match(/\s*\^([a-zA-Z0-9-]+)\s*$/);
  if (blockIdMatch) {
    return withoutPriority.replace(/\s*\^([a-zA-Z0-9-]+)\s*$/, ` ${marker} ^${blockIdMatch[1]}`);
  }

  return `${withoutPriority} ${marker}`;
}

/**
 * Extracts the recurrence rule from a task line, if any.
 */
export function extractRepeat(line: string): TaskRepeat | undefined {
  const match = line.match(REPEAT_PATTERN);
  if (!match) return undefined;

  const unit = REPEAT_UNIT_BY_TOKEN[match[2].toLowerCase()];
  if (!unit) return undefined;

  const every = match[1] ? parseInt(match[1], 10) : 1;
  if (!Number.isFinite(every) || every < 1) return undefined;

  return { every, unit };
}

/**
 * Removes all recurrence markers from a task line.
 */
export function stripRepeat(line: string): string {
  return line.replace(REPEAT_PATTERN_GLOBAL, '').replace(/\s{2,}/g, ' ').trim();
}

/**
 * Removes all recurrence markers while preserving leading indentation.
 */
export function stripRepeatPreserveIndent(line: string): string {
  return normalizeAfterMarkerRemovalPreserveIndent(line.replace(REPEAT_PATTERN_GLOBAL, ''));
}

/**
 * Replaces existing recurrence markers with a new rule, or removes them.
 * The marker is inserted before a trailing block ID so the ID stays last.
 */
export function setRepeat(line: string, repeat: TaskRepeat | null): string {
  const withoutRepeat = stripRepeatPreserveIndent(line);
  if (!repeat || repeat.every < 1) return withoutRepeat;

  const marker = `@repeat(${repeat.every}${REPEAT_UNIT_TOKEN[repeat.unit]})`;
  const blockIdMatch = withoutRepeat.match(/\s*\^([a-zA-Z0-9-]+)\s*$/);
  if (blockIdMatch) {
    return withoutRepeat.replace(/\s*\^([a-zA-Z0-9-]+)\s*$/, ` ${marker} ^${blockIdMatch[1]}`);
  }

  return `${withoutRepeat} ${marker}`;
}

/**
 * Reduces free text to a tag key: lowercase, spaces become hyphens, anything a
 * marker could not hold is dropped. Used for keys typed into a note by hand as
 * well as for keys derived from a new tag's name.
 */
export function normalizeTagKey(raw: string): string {
  return raw
    .normalize('NFC')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(TAG_KEY_DISALLOWED, '')
    .replace(/-{2,}/g, '-')
    .replace(/^[-\/]+|[-\/]+$/g, '');
}

/** Tag keys on a task line, in the order they were written, without duplicates. */
export function extractTags(line: string): string[] {
  const keys: string[] = [];
  TAG_PATTERN_GLOBAL.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TAG_PATTERN_GLOBAL.exec(line)) !== null) {
    for (const part of match[1].split(',')) {
      const key = normalizeTagKey(part);
      if (key && !keys.includes(key)) keys.push(key);
    }
  }
  return keys;
}

/** Removes every tag marker from a task line. */
export function stripTags(line: string): string {
  return line.replace(TAG_PATTERN_GLOBAL, '').replace(/\s{2,}/g, ' ').trim();
}

/** Removes every tag marker while preserving leading indentation. */
export function stripTagsPreserveIndent(line: string): string {
  return normalizeAfterMarkerRemovalPreserveIndent(line.replace(TAG_PATTERN_GLOBAL, ''));
}

/**
 * Replaces the line's tags with `keys`, written as a single marker before a
 * trailing block ID. An empty list removes the marker.
 */
export function setTags(line: string, keys: readonly string[] | null): string {
  const withoutTags = stripTagsPreserveIndent(line);
  const clean: string[] = [];
  for (const key of keys ?? []) {
    const normalized = normalizeTagKey(key);
    if (normalized && !clean.includes(normalized)) clean.push(normalized);
  }
  if (!clean.length) return withoutTags;

  const marker = `@tag(${clean.join(', ')})`;
  const blockIdMatch = withoutTags.match(/\s*\^([a-zA-Z0-9-]+)\s*$/);
  if (blockIdMatch) {
    return withoutTags.replace(/\s*\^([a-zA-Z0-9-]+)\s*$/, ` ${marker} ^${blockIdMatch[1]}`);
  }

  return `${withoutTags} ${marker}`;
}

/** `9:05` → `09:05`; null for anything that is not a time of day. `24:00` only as an end. */
function normalizeClock(value: string | undefined, isEnd: boolean): string | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value ?? '');
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (minutes > 59) return null;
  if (hours > 23 && !(isEnd && hours === 24 && minutes === 0)) return null;
  return `${String(hours).padStart(2, '0')}:${match[2]}`;
}

function clockToMinutes(clock: string): number {
  const [hours, minutes] = clock.split(':').map(Number);
  return hours * 60 + minutes;
}

function isRealIsoDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

/**
 * The schedule on a task line, if any. A time that is not a time, or an end
 * that is not after the start, is dropped rather than guessed at: a task with
 * `@schedule(2026-09-28 10:00-09:00)` is planned for 10:00 with no end.
 */
export function extractSchedule(line: string): TaskSchedule | undefined {
  const match = SCHEDULE_PATTERN.exec(line);
  if (!match || !isRealIsoDate(match[1])) return undefined;
  const date = match[1];
  const start = normalizeClock(match[2], false);
  if (!start) return { date };
  const end = normalizeClock(match[3], true);
  if (end && clockToMinutes(end) > clockToMinutes(start)) return { date, start, end };
  return { date, start };
}

/** The marker text for a schedule: `@schedule(2026-09-28 09:00-10:30)`. */
export function formatScheduleMarker(schedule: TaskSchedule): string {
  const time = schedule.start ? ` ${schedule.start}${schedule.end ? `-${schedule.end}` : ''}` : '';
  return `@schedule(${schedule.date}${time})`;
}

/** Removes every schedule marker from a task line. */
export function stripSchedule(line: string): string {
  return line.replace(SCHEDULE_PATTERN_GLOBAL, '').replace(/\s{2,}/g, ' ').trim();
}

/** Removes every schedule marker while preserving leading indentation. */
export function stripSchedulePreserveIndent(line: string): string {
  return normalizeAfterMarkerRemovalPreserveIndent(line.replace(SCHEDULE_PATTERN_GLOBAL, ''));
}

/**
 * Replaces the line's schedule, or removes it. The marker is inserted before a
 * trailing block ID so the ID stays last.
 */
export function setSchedule(line: string, schedule: TaskSchedule | null): string {
  const without = stripSchedulePreserveIndent(line);
  if (!schedule || !isRealIsoDate(schedule.date)) return without;

  const marker = formatScheduleMarker(schedule);
  const blockIdMatch = without.match(/\s*\^([a-zA-Z0-9-]+)\s*$/);
  if (blockIdMatch) {
    return without.replace(/\s*\^([a-zA-Z0-9-]+)\s*$/, ` ${marker} ^${blockIdMatch[1]}`);
  }

  return `${without} ${marker}`;
}

/** A task this one waits on: the note it is in (empty for the same note), and its block ID. */
export interface TaskLink {
  path: string;
  blockId: string;
}

/** The tasks a line waits on, in the order they were written, each once. */
export function extractWaiting(line: string): TaskLink[] {
  const links: TaskLink[] = [];
  WAITING_PATTERN_GLOBAL.lastIndex = 0;
  let marker: RegExpExecArray | null;
  while ((marker = WAITING_PATTERN_GLOBAL.exec(line)) !== null) {
    WAITING_LINK_PATTERN.lastIndex = 0;
    let link: RegExpExecArray | null;
    while ((link = WAITING_LINK_PATTERN.exec(marker[1])) !== null) {
      const path = link[1].trim().replace(/\.md$/i, '');
      const blockId = link[2];
      if (!links.some((l) => l.path === path && l.blockId === blockId)) links.push({ path, blockId });
    }
  }
  return links;
}

/** The link a dependency is written as: `[[Planner/Launch#^tp-4k2a]]`. */
export function formatTaskLink(link: TaskLink): string {
  return `[[${link.path}#^${link.blockId}]]`;
}

export function stripWaiting(line: string): string {
  return line.replace(WAITING_PATTERN_GLOBAL, '').replace(/\s{2,}/g, ' ').trim();
}

export function stripWaitingPreserveIndent(line: string): string {
  return normalizeAfterMarkerRemovalPreserveIndent(line.replace(WAITING_PATTERN_GLOBAL, ''));
}

/** Replaces what the line waits on, as one marker before a trailing block ID. An empty list removes it. */
export function setWaiting(line: string, links: readonly TaskLink[] | null): string {
  const without = stripWaitingPreserveIndent(line);
  if (!links?.length) return without;
  return insertBeforeBlockId(without, `@waiting(${links.map(formatTaskLink).join(', ')})`);
}

/**
 * A task's own reminder: minutes before its planned start, or null when it is
 * turned off. Undefined when the task has none and the setting decides.
 */
export function extractRemind(line: string): number | null | undefined {
  const match = REMIND_PATTERN.exec(line);
  if (!match || match[1] === undefined) return undefined;
  const value = match[1].toLowerCase().replace(/\s+/g, '');
  if (value === 'off') return null;
  const amount = parseInt(value, 10);
  return value.endsWith('h') ? amount * 60 : amount;
}

/** A reminder at one moment: a day and a time on it. */
export interface RemindAt {
  date: string;
  time: string;
}

/** A task's reminder at a moment of its own, when it has one. */
export function extractRemindAt(line: string): RemindAt | undefined {
  const match = REMIND_PATTERN.exec(line);
  if (!match || match[2] === undefined || !isRealIsoDate(match[2])) return undefined;
  const time = normalizeClock(match[3], false);
  return time ? { date: match[2], time } : undefined;
}

export function formatRemindMarker(minutes: number | null | RemindAt): string {
  if (minutes !== null && typeof minutes === 'object') return `@remind(${minutes.date} ${minutes.time})`;
  if (minutes === null) return '@remind(off)';
  return minutes >= 60 && minutes % 60 === 0 ? `@remind(${minutes / 60}h)` : `@remind(${minutes}m)`;
}

export function stripRemind(line: string): string {
  return line.replace(REMIND_PATTERN_GLOBAL, '').replace(/\s{2,}/g, ' ').trim();
}

export function stripRemindPreserveIndent(line: string): string {
  return normalizeAfterMarkerRemovalPreserveIndent(line.replace(REMIND_PATTERN_GLOBAL, ''));
}

/**
 * Sets the task's own reminder: minutes before its plan, a moment of its own,
 * `null` for none, or with `undefined` back to the setting.
 */
export function setRemind(line: string, minutes: number | null | RemindAt | undefined): string {
  const without = stripRemindPreserveIndent(line);
  if (minutes === undefined) return without;
  return insertBeforeBlockId(without, formatRemindMarker(minutes));
}

/** Adds a marker at the end of a line, before its block ID so the ID stays last. */
function insertBeforeBlockId(line: string, marker: string): string {
  const blockIdMatch = line.match(/\s*\^([a-zA-Z0-9-]+)\s*$/);
  if (blockIdMatch) return line.replace(/\s*\^([a-zA-Z0-9-]+)\s*$/, ` ${marker} ^${blockIdMatch[1]}`);
  return `${line} ${marker}`;
}

/**
 * Replaces the readable part of a task line and keeps everything TaskPro put
 * there: the checkbox, the indentation, every marker and the block ID. The
 * markers are hidden in the editor anyway, so they are gathered at the end in
 * the order they were found rather than kept at their old offsets.
 */
export function replaceTaskText(line: string, text: string): string {
  const match = /^(\s*)- \[([ \/xX!])\] ?(.*)$/.exec(line);
  if (!match) return line;

  const [, indent, marker, content] = match;
  const blockId = /\s*\^([a-zA-Z0-9-]+)\s*$/.exec(content)?.[1];
  const body = blockId ? content.replace(/\s*\^([a-zA-Z0-9-]+)\s*$/, '') : content;

  const markers: Array<{ index: number; text: string }> = [];
  for (const pattern of [
    DEADLINE_PATTERN_GLOBAL,
    PROGRESS_PATTERN_GLOBAL,
    PRIORITY_PATTERN_GLOBAL,
    REPEAT_PATTERN_GLOBAL,
    TAG_PATTERN_GLOBAL,
    SCHEDULE_PATTERN_GLOBAL,
    WAITING_PATTERN_GLOBAL,
    REMIND_PATTERN_GLOBAL,
  ]) {
    pattern.lastIndex = 0;
    let found: RegExpExecArray | null;
    while ((found = pattern.exec(body)) !== null) {
      markers.push({ index: found.index, text: found[0] });
      if (found[0].length === 0) pattern.lastIndex++;
    }
  }
  markers.sort((a, b) => a.index - b.index);

  const parts = [text.replace(/\s+/g, ' ').trim(), ...markers.map((m) => m.text)].filter(Boolean);
  const tail = blockId ? ` ^${blockId}` : '';
  return `${indent}- [${marker}] ${parts.join(' ')}${tail}`;
}

/**
 * Every TaskPro marker removed: deadline, progress, priority, repeat, tags and
 * schedule. The block ID and the checkbox are left alone; callers that build
 * identity keys or titles strip those themselves. One helper, so a new marker
 * is added in exactly one place instead of in every copy of the strip chain.
 */
export function stripTaskMetadata(line: string): string {
  return stripRemind(stripWaiting(stripSchedule(stripTags(stripRepeat(stripPriority(stripProgress(stripDeadline(line))))))));
}

/**
 * The next occurrence of a repeating task, as `YYYY-MM-DD`.
 *
 * Counting forward from the old deadline keeps a weekly task on its weekday
 * even when it is ticked off a few days late. A deadline already in the past is
 * advanced until it lands in the future, so finishing a month of missed dailies
 * at once leaves one task due tomorrow rather than one due last week.
 */
export function nextRepeatDate(
  repeat: TaskRepeat,
  fromDeadline: string | undefined,
  today = new Date()
): string {
  const base = fromDeadline ? parseIsoDate(fromDeadline) : null;
  const start = startOfDay(today);
  const cursor = base ?? new Date(start);

  do {
    advance(cursor, repeat);
  } while (cursor.getTime() <= start.getTime());

  return toIsoDate(cursor);
}

function advance(date: Date, repeat: TaskRepeat): void {
  if (repeat.unit === 'day') date.setDate(date.getDate() + repeat.every);
  else if (repeat.unit === 'week') date.setDate(date.getDate() + repeat.every * 7);
  else {
    // Keep the day of the month where the target month has one; a task due on
    // the 31st repeats on the 30th in a 30-day month rather than sliding into
    // the next one.
    const day = date.getDate();
    date.setDate(1);
    date.setMonth(date.getMonth() + repeat.every);
    const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
    date.setDate(Math.min(day, lastDay));
  }
}

function parseIsoDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}

function startOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function toIsoDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export {
  DEADLINE_PATTERN as DEADLINE_REGEX,
  PRIORITY_PATTERN_GLOBAL as PRIORITY_REGEX_GLOBAL,
};

/**
 * Single-match deadline pattern (all supported forms) for decoration ranges.
 * Shared so the hidden range can never drift from what the parser accepts.
 */
export const DEADLINE_MARKER_PATTERN = new RegExp(DEADLINE_PATTERN.source, '');

/** Single-match recurrence pattern for decoration ranges. */
export const REPEAT_MARKER_PATTERN = new RegExp(REPEAT_PATTERN.source, 'i');

/** Single-match schedule pattern for decoration ranges. */
export const SCHEDULE_MARKER_PATTERN = new RegExp(SCHEDULE_PATTERN.source, '');

/** Single-match patterns for the dependency and reminder markers, for decoration ranges. */
export const WAITING_MARKER_PATTERN = new RegExp(WAITING_PATTERN.source, '');
export const REMIND_MARKER_PATTERN = new RegExp(REMIND_PATTERN.source, 'i');
export const WAITING_MARKER_PATTERN_GLOBAL = new RegExp(WAITING_PATTERN.source, 'g');
export const REMIND_MARKER_PATTERN_GLOBAL = new RegExp(REMIND_PATTERN.source, 'gi');

/** Global schedule pattern, for reading-mode stripping. */
export const SCHEDULE_MARKER_PATTERN_GLOBAL = new RegExp(SCHEDULE_PATTERN.source, 'g');

/**
 * Global tag-marker pattern for decoration ranges and reading-mode stripping.
 * A line can carry more than one marker, so callers loop over every match.
 */
export const TAG_MARKER_PATTERN_GLOBAL = new RegExp(TAG_PATTERN_SOURCE, 'gu');

/** Single-match priority pattern (all supported forms) for decoration ranges. */
export const PRIORITY_MARKER_PATTERN = new RegExp(
  `${PRIORITY_KEYWORD_PATTERN.source}|${PRIORITY_LEGACY_FIELD_PATTERN.source}|${PRIORITY_EMOJI_PATTERN.source}`,
  'i'
);
