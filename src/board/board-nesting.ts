// ── board/board-nesting.ts ────────────────────────────────────────────────
// Sub-items in the table: a subtask sits under its parent, one step in, and a
// parent can fold its subtasks away. Only what is on the screen counts. A
// subtask whose parent was filtered out, or sits in another group, has no
// parent to hang under and stands at the edge like any other task; its depth
// is the number of ancestors shown with it.
//
// Pure, so it is tested without a page.
// ─────────────────────────────────────────────────────────────────────────────

import type { BoardTask } from './task-store';

export interface Nesting {
  /** How many of its ancestors are shown with it. */
  depth: number;
  /** The nearest ancestor shown with it. */
  parent?: string;
  /** How many tasks shown have it as their nearest shown ancestor. */
  children: number;
}

/**
 * How the tasks shown nest. `lookup` finds a task by id among all the tasks,
 * shown or not, so a parent that is not shown can be passed over on the way
 * to a grandparent that is.
 */
export function nestTasks(tasks: readonly BoardTask[], lookup: (id: string) => BoardTask | undefined): Map<string, Nesting> {
  const shown = new Set(tasks.map((task) => task.id));
  const nesting = new Map<string, Nesting>();

  const nearestShown = (task: BoardTask): string | undefined => {
    const seen = new Set<string>([task.id]);
    let up = task.parentId ? lookup(task.parentId) : undefined;
    while (up && !seen.has(up.id)) {
      if (shown.has(up.id)) return up.id;
      seen.add(up.id);
      up = up.parentId ? lookup(up.parentId) : undefined;
    }
    return undefined;
  };

  for (const task of tasks) nesting.set(task.id, { depth: 0, parent: nearestShown(task), children: 0 });
  for (const entry of nesting.values()) {
    if (entry.parent) nesting.get(entry.parent)!.children++;
  }

  const depthOf = (id: string, seen = new Set<string>()): number => {
    const entry = nesting.get(id)!;
    if (!entry.parent || seen.has(id)) return 0;
    seen.add(id);
    return depthOf(entry.parent, seen) + 1;
  };
  for (const [id, entry] of nesting) entry.depth = depthOf(id);
  return nesting;
}

/** Whether a folded ancestor hides the task: `folded` says, for a task shown, if it is folded. */
export function hiddenByFold(id: string, nesting: ReadonlyMap<string, Nesting>, folded: (id: string) => boolean): boolean {
  const seen = new Set<string>([id]);
  let up = nesting.get(id)?.parent;
  while (up && !seen.has(up)) {
    if (folded(up)) return true;
    seen.add(up);
    up = nesting.get(up)?.parent;
  }
  return false;
}

/** What a task is folded under: its note and its ID or title, which outlast the line numbers a drawing shifts. */
export function foldKey(task: Pick<BoardTask, 'filePath' | 'blockId' | 'text'>): string {
  return `${task.filePath}\n${task.blockId ?? task.text}`;
}
