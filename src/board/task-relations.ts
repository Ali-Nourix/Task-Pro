// ── board/task-relations.ts ───────────────────────────────────────────────
// How tasks relate to one another beyond their own line: a parent's progress
// counted from its subtasks, and the tasks one waits on before it can start.
//
// A dependency is written on the waiting task as a block link to the task it
// waits on (`@waiting([[Planner/Launch#^tp-4k2a]])`), so it survives renames
// and moves the way any Obsidian link does. Everything here is pure, so the
// board, the calendar, the timeline and the note chips all read the same
// answer from the same tasks.
// ─────────────────────────────────────────────────────────────────────────────

import type { TaskLink } from '../task-metadata';
import type { BoardTask } from './task-store';

export interface SubtaskCount {
  done: number;
  total: number;
}

/**
 * How many of each task's direct subtasks are done, by task id. A subtask
 * with subtasks of its own counts once, as done when it is ticked off.
 */
export function subtaskCounts(tasks: Iterable<BoardTask>): Map<string, SubtaskCount> {
  const counts = new Map<string, SubtaskCount>();
  for (const task of tasks) {
    if (!task.parentId) continue;
    const count = counts.get(task.parentId) ?? { done: 0, total: 0 };
    count.total++;
    if (task.status === '[x]') count.done++;
    counts.set(task.parentId, count);
  }
  return counts;
}

const LIST_ITEM = /^(\s*)(?:[-*+]|\d+[.)])(?:\s|$)/;
const TASK_ITEM = /^\s*(?:[-*+]|\d+[.)]) \[([ \/xX!])\]/;

function widthOf(indent: string): number {
  return indent.replace(/\t/g, '    ').length;
}

/**
 * The direct subtasks of the task on line `index`, read from a note's lines:
 * tasks nested under it with no other task in between. A plain bullet in
 * between keeps the link, as it does on the board. Null when it has none.
 */
export function subtaskCountAt(lineAt: (n: number) => string, lineCount: number, index: number): SubtaskCount | null {
  const own = widthOf(/^\s*/.exec(lineAt(index))![0]);
  const stack: Array<{ depth: number; task: boolean }> = [];
  let done = 0;
  let total = 0;
  for (let n = index + 1; n < lineCount; n++) {
    const text = lineAt(n);
    if (!text.trim()) continue;
    const indent = widthOf(/^\s*/.exec(text)![0]);
    if (indent <= own) break;
    const item = LIST_ITEM.exec(text);
    if (!item) continue;
    const depth = widthOf(item[1]);
    while (stack.length && stack[stack.length - 1].depth >= depth) stack.pop();
    const task = TASK_ITEM.exec(text);
    if (task && !stack.some((entry) => entry.task)) {
      total++;
      if (task[1] === 'x' || task[1] === 'X') done++;
    }
    stack.push({ depth, task: !!task });
  }
  return total ? { done, total } : null;
}

// ── Dependencies ───────────────────────────────────────────────────────────

/** A note path as a link writes it: without `.md`. */
export function linkPathOf(filePath: string): string {
  return filePath.replace(/\.md$/i, '');
}

/** One blocker of a task: the link as written, and the task it points at when that still exists. */
export interface Blocker {
  link: TaskLink;
  task?: BoardTask;
}

/**
 * Every task's links resolved once: what each task waits on, and what waits
 * on it. Built from all the tasks there are, since a dependency can point
 * into any note.
 */
export class RelationIndex {
  private readonly byBlock = new Map<string, BoardTask[]>();
  private readonly blockers = new Map<string, Blocker[]>();
  private readonly dependents = new Map<string, BoardTask[]>();

  constructor(tasks: readonly BoardTask[]) {
    for (const task of tasks) {
      if (!task.blockId) continue;
      const list = this.byBlock.get(task.blockId);
      if (list) list.push(task);
      else this.byBlock.set(task.blockId, [task]);
    }
    for (const task of tasks) {
      if (!task.waiting?.length) continue;
      const found = task.waiting.map((link) => ({ link, task: this.resolve(link, task.filePath) }));
      this.blockers.set(task.id, found);
      for (const { task: blocker } of found) {
        if (!blocker) continue;
        const list = this.dependents.get(blocker.id);
        if (list) list.push(task);
        else this.dependents.set(blocker.id, [task]);
      }
    }
  }

  /**
   * The task a link points at. An empty path is the linking note itself; a
   * path is matched in full first, then by its end, then by the note's name,
   * the way Obsidian resolves a short link.
   */
  resolve(link: TaskLink, fromPath: string): BoardTask | undefined {
    const candidates = this.byBlock.get(link.blockId);
    if (!candidates?.length) return undefined;
    if (!link.path) return candidates.find((task) => task.filePath === fromPath);
    const path = link.path.toLowerCase();
    return (
      candidates.find((task) => linkPathOf(task.filePath).toLowerCase() === path) ??
      candidates.find((task) => linkPathOf(task.filePath).toLowerCase().endsWith(`/${path}`)) ??
      candidates.find((task) => task.fileName.toLowerCase() === path.split('/').pop())
    );
  }

  blockersOf(task: BoardTask): Blocker[] {
    return this.blockers.get(task.id) ?? [];
  }

  /** The tasks waiting on this one. */
  dependentsOf(task: BoardTask): BoardTask[] {
    return this.dependents.get(task.id) ?? [];
  }

  /** The blockers that are not done yet. A link to a task that is gone does not hold anything up. */
  openBlockers(task: BoardTask): BoardTask[] {
    return this.blockersOf(task)
      .map((blocker) => blocker.task)
      .filter((blocker): blocker is BoardTask => !!blocker && blocker.status !== '[x]');
  }

  isWaiting(task: BoardTask): boolean {
    return this.openBlockers(task).length > 0;
  }

  /**
   * Whether making `task` wait on `candidate` would close a loop: the
   * candidate is the task itself, or already waits on it, however far back.
   */
  wouldCycle(task: BoardTask, candidate: BoardTask): boolean {
    if (candidate.id === task.id) return true;
    const seen = new Set<string>();
    const walk = (from: BoardTask): boolean => {
      if (seen.has(from.id)) return false;
      seen.add(from.id);
      for (const blocker of this.blockersOf(from)) {
        if (!blocker.task) continue;
        if (blocker.task.id === task.id || walk(blocker.task)) return true;
      }
      return false;
    };
    return walk(candidate);
  }
}

/** A block ID no task uses yet, like `tp-4k2a`: short, and marked as TaskPro's. */
export function newBlockId(taken: (id: string) => boolean, random: () => number = Math.random): string {
  for (let length = 4; ; length++) {
    for (let attempt = 0; attempt < 20; attempt++) {
      let id = 'tp-';
      for (let i = 0; i < length; i++) id += '0123456789abcdefghijklmnopqrstuvwxyz'[Math.floor(random() * 36)];
      if (!taken(id)) return id;
    }
  }
}
