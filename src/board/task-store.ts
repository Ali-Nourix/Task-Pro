// ── board/task-store.ts ───────────────────────────────────────────────────
// Every task in the vault, kept current while the board is open.
//
// Cost control:
// - Notes whose metadata cache lists no task items are never read at all.
// - Only the lines the metadata cache calls task list items are parsed, so a
//   `- [ ]` inside a code block or front matter is not mistaken for a task.
// - After the first pass, a note is re-parsed only when Obsidian reports that
//   note changed, from the content the event already carries.
// ─────────────────────────────────────────────────────────────────────────────

import { App, CachedMetadata, TFile } from 'obsidian';
import { TaskPriority, TaskRepeat, TaskSchedule, TaskStatus } from '../types';
import {
  TaskLink,
  extractDeadline,
  extractPriority,
  extractRemind,
  extractRemindAt,
  RemindAt,
  extractRepeat,
  extractSchedule,
  extractTags,
  extractWaiting,
} from '../task-metadata';
import { parseTaskLine } from '../task-identity';

export interface BoardTask {
  /** Unique for this scan: path and line. Not stable across edits. */
  id: string;
  filePath: string;
  /** Note name without the extension. */
  fileName: string;
  lineNumber: number;
  /** The whole line as it is in the note. */
  line: string;
  /** Leading whitespace width, for showing subtasks nested. */
  depth: number;
  status: TaskStatus;
  /** Readable title: TaskPro markers and the block ID removed. */
  text: string;
  blockId?: string;
  deadline?: string;
  priority?: TaskPriority;
  repeat?: TaskRepeat;
  /** TaskPro tag keys, in note order. */
  tags: string[];
  /** When the task is planned to be done, from `@schedule(...)`. */
  schedule?: TaskSchedule;
  /** The tasks this one waits on, from `@waiting(...)`, as written. */
  waiting?: TaskLink[];
  /**
   * Its own reminder before the plan starts, in minutes, from `@remind(...)`:
   * null when turned off, undefined when the setting decides.
   */
  remind?: number | null;
  /** Its reminder at a moment of its own, from `@remind(2026-10-05 09:30)`; it replaces the one before the plan. */
  remindAt?: RemindAt;
  /**
   * The task this one is nested under, as an `id` in the same note: the
   * nearest task among its list ancestors. A plain bullet in between (a note
   * under a task) does not break the link.
   */
  parentId?: string;
}

const EMBED_PATTERN = /!\[\[[^\]]+\]\]/;
const LIST_ITEM_PATTERN = /^(\s*)(?:[-*+]|\d+[.)])(?:\s|$)/;
const FENCE_PATTERN = /^\s*(```|~~~)/;

function indentWidth(indent: string): number {
  return indent.replace(/\t/g, '    ').length;
}

/** Lines the metadata cache says are task list items, or null when it does not know. */
function taskLinesFromCache(cache: CachedMetadata | null | undefined): Set<number> | null {
  if (!cache) return null;
  const lines = new Set<number>();
  for (const item of cache.listItems ?? []) {
    if (item.task !== undefined) lines.add(item.position.start.line);
  }
  return lines;
}

/** Parses one note's tasks. Pure, so it can be tested without Obsidian. */
export function parseBoardTasks(
  filePath: string,
  content: string,
  onlyLines: Set<number> | null = null
): BoardTask[] {
  const fileName = filePath.split('/').pop()?.replace(/\.md$/i, '') ?? filePath;
  const tasks: BoardTask[] = [];
  const lines = content.split('\n');
  // Open list items above the current line, outermost first, with the task
  // each one is (null for a plain bullet), for linking subtasks to parents.
  const stack: Array<{ depth: number; taskId: string | null }> = [];
  let fence: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fenceMatch = FENCE_PATTERN.exec(line);
    if (fence) {
      if (fenceMatch && fenceMatch[1] === fence) fence = null;
      continue;
    }
    if (fenceMatch) {
      fence = fenceMatch[1];
      continue;
    }

    const listMatch = LIST_ITEM_PATTERN.exec(line);
    if (!listMatch) {
      // A paragraph at the margin ends every list above it; an indented line
      // or a blank one belongs to the item it follows.
      if (line.trim() && !/^\s/.test(line)) stack.length = 0;
      continue;
    }
    const depth = indentWidth(listMatch[1]);
    while (stack.length && stack[stack.length - 1].depth >= depth) stack.pop();
    let parentId: string | undefined;
    for (let s = stack.length - 1; s >= 0; s--) {
      if (stack[s].taskId) {
        parentId = stack[s].taskId!;
        break;
      }
    }

    const parsed = onlyLines && !onlyLines.has(i) ? null : parseTaskLine(line);
    // An embedded task is a reference to a task owned by another note.
    const isTask = !!parsed && !EMBED_PATTERN.test(parsed.rawContent);
    const id = `${filePath}:${i}`;
    stack.push({ depth, taskId: isTask ? id : null });
    if (!parsed || !isTask) continue;

    tasks.push({
      id,
      filePath,
      fileName,
      lineNumber: i,
      line,
      depth,
      status: parsed.status,
      text: parsed.text,
      blockId: parsed.blockId,
      deadline: extractDeadline(parsed.rawContent) ?? undefined,
      priority: extractPriority(parsed.rawContent),
      repeat: extractRepeat(parsed.rawContent),
      tags: extractTags(parsed.rawContent),
      schedule: extractSchedule(parsed.rawContent),
      ...waitingAndRemind(parsed.rawContent),
      parentId,
    });
  }

  return tasks;
}

/** The two markers most tasks do not have, left off the task when absent. */
function waitingAndRemind(content: string): Pick<BoardTask, 'waiting' | 'remind' | 'remindAt'> {
  const out: Pick<BoardTask, 'waiting' | 'remind' | 'remindAt'> = {};
  if (content.includes('@waiting(')) {
    const waiting = extractWaiting(content);
    if (waiting.length) out.waiting = waiting;
  }
  if (content.includes('@remind(')) {
    const remind = extractRemind(content);
    if (remind !== undefined) out.remind = remind;
    const remindAt = extractRemindAt(content);
    if (remindAt) out.remindAt = remindAt;
  }
  return out;
}

export class TaskStore {
  private readonly byFile = new Map<string, BoardTask[]>();
  private readonly listeners = new Set<() => void>();
  private loadPromise: Promise<void> | null = null;
  private notifyTimer: ReturnType<typeof setTimeout> | null = null;
  private loaded = false;
  private orderedSnapshot: BoardTask[] | null = null;
  private generation = 0;

  /** Changes only when indexed task data changes, not on a filter or layout repaint. */
  get revision(): number { return this.generation; }
  private invalidate(): void { this.orderedSnapshot = null; this.generation++; }

  /**
   * @param whenReady Resolves once Obsidian's layout (and with it the metadata
   *   cache) is ready. A board restored with the workspace would otherwise scan
   *   the vault during startup, before the cache can say which notes to skip.
   */
  constructor(
    private readonly app: App,
    private readonly whenReady: () => Promise<void> = async () => undefined
  ) {}

  get isLoaded(): boolean {
    return this.loaded;
  }

  /** First full pass. Later calls reuse it. */
  ensureLoaded(): Promise<void> {
    if (!this.loadPromise) {
      this.loadPromise = this.loadAll().then(() => {
        this.loaded = true;
      });
    }
    return this.loadPromise;
  }

  /** Forgets everything and scans again. */
  async reload(): Promise<void> {
    this.invalidate();
    this.byFile.clear();
    this.loaded = false;
    this.loadPromise = null;
    await this.ensureLoaded();
    this.emit();
  }

  private async loadAll(): Promise<void> {
    await this.whenReady();
    const files = this.app.vault.getMarkdownFiles();
    for (const file of files) {
      const cache = this.app.metadataCache.getFileCache(file);
      const taskLines = taskLinesFromCache(cache);
      // Indexed and task-free: nothing to read.
      if (taskLines && taskLines.size === 0) continue;

      try {
        const content = await this.app.vault.cachedRead(file);
        // Re-read the cache after the await: it is the one that matches `content`.
        const fresh = taskLinesFromCache(this.app.metadataCache.getFileCache(file)) ?? taskLines;
        this.setFile(file.path, parseBoardTasks(file.path, content, fresh));
      } catch (error) {
        console.error("TaskPro: failed to read \"[redacted]\" for the task board");
      }
    }
  }

  private setFile(path: string, tasks: BoardTask[]): void {
    this.invalidate();
    if (tasks.length) this.byFile.set(path, tasks);
    else this.byFile.delete(path);
  }

  /** Every task, in vault order (note path, then line). */
  all(): BoardTask[] {
    if (this.orderedSnapshot === null) {
      const paths = Array.from(this.byFile.keys()).sort((a, b) => a.localeCompare(b));
      this.orderedSnapshot = [];
      for (const path of paths) this.orderedSnapshot.push(...(this.byFile.get(path) ?? []));
    }
    // Keep the old mutable-array contract without letting callers reorder the shared cache.
    return this.orderedSnapshot.slice();
  }

  /** Every task in one note. */
  inFile(path: string): BoardTask[] {
    return this.byFile.get(path) ?? [];
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Batches bursts of changes (a sync touching two notes) into one repaint. */
  private emit(): void {
    if (this.notifyTimer) clearTimeout(this.notifyTimer);
    this.notifyTimer = setTimeout(() => {
      this.notifyTimer = null;
      for (const listener of this.listeners) listener();
    }, 120);
  }

  // ── Vault events, forwarded by the plugin ────────────────────────────────

  /**
   * True once a scan has started. Changes are applied from then on, so a note
   * edited while the first scan is still running is not left stale.
   */
  private get tracking(): boolean {
    return this.loadPromise !== null;
  }

  /** metadataCache `changed`: the note was re-parsed, and `data` is its content. */
  handleMetadataChanged(file: TFile, data: string, cache: CachedMetadata): void {
    if (!this.tracking || file.extension !== 'md') return;
    const before = this.byFile.get(file.path);
    this.setFile(file.path, parseBoardTasks(file.path, data, taskLinesFromCache(cache)));
    if (before || this.byFile.has(file.path)) this.emit();
  }

  handleRenamed(file: TFile, oldPath: string): void {
    if (!this.tracking) return;
    const tasks = this.byFile.get(oldPath);
    this.byFile.delete(oldPath);
    if (tasks) this.invalidate();
    if (tasks && file.extension === 'md') {
      // Re-key rather than re-read: the content did not change with the name.
      const fileName = file.basename;
      this.setFile(
        file.path,
        tasks.map((task) => ({
          ...task,
          id: `${file.path}:${task.lineNumber}`,
          parentId: task.parentId && `${file.path}:${task.parentId.slice(oldPath.length + 1)}`,
          filePath: file.path,
          fileName,
        }))
      );
    }
    if (tasks) this.emit();
  }

  handleDeleted(path: string): void {
    if (!this.tracking) return;
    if (this.byFile.delete(path)) { this.invalidate(); this.emit(); }
  }

  destroy(): void {
    if (this.notifyTimer) clearTimeout(this.notifyTimer);
    this.listeners.clear();
    this.byFile.clear();
    this.invalidate();
  }
}
