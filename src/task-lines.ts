// ── task-lines.ts ─────────────────────────────────────────────────────────
// A task in a note is its line and everything indented under it: its
// subtasks, and the notes written beneath it. Adding a subtask goes after
// that block, and deleting a task takes the whole block, so a deleted parent
// never leaves its subtasks behind under a task they no longer belong to.
// ─────────────────────────────────────────────────────────────────────────────

const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)]) /;

export function indentOf(text: string): string {
  return /^\s*/.exec(text)![0];
}

/** An indent's width, a tab counting as four spaces. */
export function indentWidth(indent: string): number {
  return indent.replace(/\t/g, '    ').length;
}

/**
 * The last line of the block that starts at `index`: the line itself and
 * every line indented further under it. Blank lines inside the block belong
 * to it; blank lines after it do not.
 */
export function blockEnd(lines: readonly string[], index: number): number {
  const own = indentWidth(indentOf(lines[index]));
  let end = index;
  for (let i = index + 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    if (indentWidth(indentOf(lines[i])) <= own) break;
    end = i;
  }
  return end;
}

/** The indent the direct subtasks under `index` use, if it has any. */
export function childIndent(lines: readonly string[], index: number): string | null {
  let found: string | null = null;
  for (let i = index + 1; i <= blockEnd(lines, index); i++) {
    if (!LIST_ITEM.test(lines[i])) continue;
    const indent = indentOf(lines[i]);
    if (found === null || indentWidth(indent) < indentWidth(found)) found = indent;
  }
  return found;
}

export interface RemovedBlock {
  /** The note without the block. */
  lines: string[];
  /** Where the block was, and what it was, to put it back. */
  at: number;
  removed: string[];
}

/**
 * Takes out the block that starts at `index`. When that leaves two blank
 * lines side by side, one of them goes with it, so the note keeps its
 * spacing; putting `removed` back at `at` restores the note exactly.
 */
export function removeBlock(lines: readonly string[], index: number): RemovedBlock {
  const end = blockEnd(lines, index);
  const next = [...lines];
  const removed = next.splice(index, end - index + 1);
  const before = next[index - 1];
  const after = next[index];
  if (before !== undefined && after !== undefined && !before.trim() && !after.trim()) {
    removed.push(next.splice(index, 1)[0]);
  }
  return { lines: next, at: index, removed };
}
