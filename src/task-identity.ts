// ── task-identity.ts ─────────────────────────────────────────────────────
// Single source of truth for "what is a task line" and "what identifies it".
//
// The reminder scanner and the background index MUST agree on this, otherwise
// the index would register one key while the scanner looks up another and the
// age filter would silently see every task as brand new. Keeping the parsing
// in one file makes that class of bug impossible.
// ─────────────────────────────────────────────────────────────────────────────

import { TaskStatus } from './types';
import { stripTaskMetadata } from './task-metadata';
import { buildTaskKey } from './task-registry';

const TASK_LINE_REGEX = /^(\s*)- \[([ \/xX!])\] (.+)$/;
const BLOCK_ID_TAIL_REGEX = /\s*\^[a-zA-Z0-9-]+\s*$/;
const BLOCK_ID_CAPTURE_REGEX = /\^([a-zA-Z0-9-]+)\s*$/;

export interface ParsedTaskLine {
  /** Raw text after the checkbox, metadata markers still present. */
  rawContent: string;
  /** Display text: plugin metadata and the block id removed. */
  text: string;
  status: TaskStatus;
  blockId?: string;
}

function normalizeStatus(marker: string): TaskStatus {
  switch (marker) {
    case 'x':
    case 'X':
      return '[x]';
    case '/':
      return '[/]';
    case '!':
      return '[!]';
    default:
      return '[ ]';
  }
}

/** Returns null for anything that is not a markdown task line. */
export function parseTaskLine(line: string): ParsedTaskLine | null {
  const match = TASK_LINE_REGEX.exec(line);
  if (!match) return null;

  const rawContent = match[3];
  return {
    rawContent,
    text: stripTaskMetadata(rawContent)
      .replace(BLOCK_ID_TAIL_REGEX, '')
      .trim(),
    status: normalizeStatus(match[2]),
    blockId: BLOCK_ID_CAPTURE_REGEX.exec(rawContent)?.[1],
  };
}

/** Registry key for an already parsed line. */
export function taskKeyFor(filePath: string, parsed: ParsedTaskLine): string {
  return buildTaskKey(filePath, parsed.text, parsed.blockId);
}

/** Every task key in a note, in file order. Duplicates are collapsed. */
export function taskKeysInContent(filePath: string, content: string): string[] {
  const keys: string[] = [];
  const seen = new Set<string>();

  for (const line of content.split('\n')) {
    const parsed = parseTaskLine(line);
    if (!parsed) continue;

    const key = taskKeyFor(filePath, parsed);
    if (seen.has(key)) continue;
    seen.add(key);
    keys.push(key);
  }

  return keys;
}
