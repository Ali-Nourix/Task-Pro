// ── task-metadata.ts ─────────────────────────────────────────────────────
// Shared helpers for parsing and updating task metadata markers.

import { TaskPriority, TaskProgress, PRIORITY_ICONS, TASK_PRIORITIES } from './types';

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

export {
  DEADLINE_PATTERN as DEADLINE_REGEX,
  PRIORITY_PATTERN_GLOBAL as PRIORITY_REGEX_GLOBAL,
};

/**
 * Single-match deadline pattern (all supported forms) for decoration ranges.
 * Shared so the hidden range can never drift from what the parser accepts.
 */
export const DEADLINE_MARKER_PATTERN = new RegExp(DEADLINE_PATTERN.source, '');

/** Single-match priority pattern (all supported forms) for decoration ranges. */
export const PRIORITY_MARKER_PATTERN = new RegExp(
  `${PRIORITY_KEYWORD_PATTERN.source}|${PRIORITY_LEGACY_FIELD_PATTERN.source}|${PRIORITY_EMOJI_PATTERN.source}`,
  'i'
);
