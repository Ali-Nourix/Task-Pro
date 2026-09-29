// ── board/task-move.ts ────────────────────────────────────────────────────
// Moving a task to another note: its block (the line and everything nested
// under it) is cut from one note and set down in another. What the text of
// the block says about where it is has to follow it. A block ID the other
// note already uses is swapped for a new one, the block lands at the left
// edge whatever it was nested under, and the links that say "waiting on"
// are pointed at the note the task is in now: the moved tasks' own, and the
// ones written on tasks elsewhere that wait on a moved task.
//
// Pure, so the whole of it is tested without a vault.
// ─────────────────────────────────────────────────────────────────────────────

import { extractWaiting, setWaiting } from '../task-metadata';
import type { TaskLink } from '../task-metadata';
import { indentOf, indentWidth } from '../task-lines';
import { RelationIndex, linkPathOf, newBlockId } from './task-relations';

/** Block IDs are marked by a caret after a space, at the very end of a line. */
const BLOCK_ID_TAIL = /(?:^|\s)\^([a-zA-Z0-9-]+)\s*$/;

/** The block ID a line ends with, if it has one. */
export function blockIdOf(line: string): string | undefined {
  return BLOCK_ID_TAIL.exec(line)?.[1];
}

/** Every block ID a note's lines end with. */
export function blockIdsIn(content: string): Set<string> {
  const ids = new Set<string>();
  for (const line of content.split('\n')) {
    const id = blockIdOf(line);
    if (id) ids.add(id);
  }
  return ids;
}

/** Takes up to `width` columns of leading whitespace off a line, a tab counting as four. */
function trimIndent(text: string, width: number): string {
  let taken = 0;
  let at = 0;
  while (at < text.length && taken < width && (text[at] === ' ' || text[at] === '\t')) {
    taken += text[at] === '\t' ? 4 : 1;
    at++;
  }
  return text.slice(at);
}

/**
 * The block at the left edge: the indent of its first line comes off every
 * line, so a subtask moved out of its parent is a task of its own, with its
 * own subtasks still nested under it by the same steps.
 */
export function dedentBlock(lines: readonly string[]): string[] {
  const lead = indentOf(lines[0] ?? '');
  if (!lead) return [...lines];
  const width = indentWidth(lead);
  return lines.map((text) => (text.startsWith(lead) ? text.slice(lead.length) : trimIndent(text, width)));
}

export interface PreparedBlock {
  /** The lines to write into the other note. */
  lines: string[];
  /** Block IDs that had to change because the note they land in already uses them: old to new. */
  renamed: Map<string, string>;
}

/**
 * The block as it is written into the other note: at the left edge, its block
 * IDs kept, except where the note already has the same one. Two blocks with
 * one ID in a note would make every link to either of them go to the first.
 */
export function prepareBlock(
  block: readonly string[],
  taken: (id: string) => boolean,
  random?: () => number
): PreparedBlock {
  const lines = dedentBlock(block);
  const own = new Set<string>();
  for (const line of lines) {
    const id = blockIdOf(line);
    if (id) own.add(id);
  }
  const renamed = new Map<string, string>();
  for (let i = 0; i < lines.length; i++) {
    const id = blockIdOf(lines[i]);
    if (!id || !taken(id)) continue;
    let next = renamed.get(id);
    if (!next) {
      next = newBlockId((candidate) => taken(candidate) || own.has(candidate), random);
      renamed.set(id, next);
      own.add(next);
    }
    lines[i] = lines[i].replace(/(^|\s)\^[a-zA-Z0-9-]+(\s*)$/, `$1^${next}$2`);
  }
  return { lines, renamed };
}

/**
 * A line with the tasks it waits on relinked by `map`, or the line itself when
 * no link changed. The alias a link might have had is not kept.
 */
export function relinkWaiting(line: string, map: (link: TaskLink) => TaskLink): string {
  const links = extractWaiting(line);
  if (!links.length) return line;
  const next: TaskLink[] = [];
  let changed = false;
  for (const link of links) {
    const to = map(link);
    if (to.path !== link.path || to.blockId !== link.blockId) changed = true;
    if (!next.some((seen) => seen.path === to.path && seen.blockId === to.blockId)) next.push(to);
  }
  return changed ? setWaiting(line, next) : line;
}

/** What a move needs to know to point links at the right place. */
export interface MoveContext {
  /** Every task's relations as they were before the move. */
  index: RelationIndex;
  /** The ids of the tasks that move. */
  moved: ReadonlySet<string>;
  from: string;
  to: string;
  renamed: ReadonlyMap<string, string>;
}

/**
 * Where a link written in `note` points once the move is done. A link to a
 * task that moved goes to its new note, and under its new block ID if it got
 * one. A link with no note named meant the note it was written in; on a line
 * that moves (`moves`), that note is named, since the line is somewhere else
 * now. On a line that stays, the link still means the note it is in.
 */
export function linkAfterMove(link: TaskLink, note: string, context: MoveContext, moves: boolean): TaskLink {
  const target = context.index.resolve(link, note);
  if (target && context.moved.has(target.id)) {
    return { path: linkPathOf(context.to), blockId: context.renamed.get(link.blockId) ?? link.blockId };
  }
  if (moves && !link.path) return { path: linkPathOf(context.from), blockId: link.blockId };
  return link;
}
