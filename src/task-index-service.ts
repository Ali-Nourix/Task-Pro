// ── task-index-service.ts ────────────────────────────────────────────────
// Keeps the hidden creation index up to date while the user works.
//
// Why a dedicated service instead of indexing during reminder scans:
// - A reminder scan happens rarely. If a task is only registered when an alert
//   fires, then a task written today and alerted on today would be indexed for
//   the first time *during* that alert, and could never be distinguished from
//   a task written months ago. That is precisely why the previous attempt
//   showed tasks from every day.
// - Watching the vault instead means "TaskPro saw this line appear at 14:32"
//   is a real observation, not a guess.
//
// Cost control: one debounced pass per changed file (the open editor's text,
// else `cachedRead`), and a single full pass at startup.
// ─────────────────────────────────────────────────────────────────────────────

import { App, TFile } from 'obsidian';
import { isWithinTargetFolder } from './path-utils';
import { taskKeysByLine, taskKeysInContent } from './task-identity';
import { WRITING_WINDOW_MS, completedTaskKeys, taskStatuses, writtenTaskKeys } from './auto-plan';
import type { TaskStatus } from './types';
import { TaskCreationRegistry } from './task-registry';

/** Waits for typing to settle before re-indexing a note. */
const INDEX_DEBOUNCE_MS = 3_000;
/** A note this young, seen for the first time, is one being written: its tasks are new. */
const NEW_NOTE_MS = 5 * 60_000;

export interface TaskIndexServiceOptions {
  app: App;
  registry: TaskCreationRegistry;
  /** Read live so changing the folder setting takes effect immediately. */
  getTargetFolder: () => string;
  /** More folders to watch even when outside the target folder (the daily notes folder). */
  getExtraFolders?: () => string[];
  /**
   * The note as it is in an open editor, when it is open: ahead of what is
   * saved on disk, so a task is seen as soon as it is typed. Null otherwise.
   */
  liveContent?: (file: TFile) => string | null;
  /**
   * Called after an edit to a note with the tasks that were just written into
   * it (not old tasks whose text changed, and never on the startup pass).
   */
  onNewTasks?: (file: TFile, keys: string[]) => void;
  /** Called after an edit to a note with the tasks that were just ticked off in it. */
  onTasksDone?: (file: TFile, keys: string[]) => void;
}

/** What one pass over a note found: the tasks just written into it, and the ones just ticked off. */
export interface IndexChanges {
  fresh: string[];
  done: string[];
}

export class TaskIndexService {
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private stopped = false;
  /** The task keys each note held at its last pass, to tell new tasks from edited ones. */
  private readonly lastKeys = new Map<string, (string | null)[]>();
  /** Notes with a pending pass that should report what was written. */
  private readonly reporting = new Set<string>();
  /** The status each task had at its note's last pass, to see a task being ticked off. */
  private readonly lastStatuses = new Map<string, Map<string, TaskStatus>>();

  /** Tasks written moments ago in each note, with when that stops counting. */
  private readonly writing = new Map<string, Map<string, number>>();

  constructor(private readonly options: TaskIndexServiceOptions) {}

  private get app(): App {
    return this.options.app;
  }

  private get registry(): TaskCreationRegistry {
    return this.options.registry;
  }

  private isTracked(file: TFile): boolean {
    if (file.extension !== 'md') return false;
    const folder = this.options.getTargetFolder();
    if (!folder.trim() || isWithinTargetFolder(file.path, folder)) return true;
    return (this.options.getExtraFolders?.() ?? []).some((extra) => extra.trim() && isWithinTargetFolder(file.path, extra));
  }

  /**
   * Full pass over the vault. Notes seen for the first time get `baseline`
   * records, so pre-existing tasks are marked "age unknown" instead of being
   * mistaken for new ones.
   */
  async indexAll(): Promise<void> {
    const now = Date.now();
    const files = this.app.vault.getMarkdownFiles();
    const tracked = files.filter((file) => this.isTracked(file));

    for (const file of tracked) {
      await this.indexFile(file, now);
      if (this.stopped) return;
    }

    // Pruning compares against every markdown file, not just tracked ones, so
    // narrowing the target folder does not throw away history.
    this.registry.prune(new Set(files.map((file) => file.path)), now);
    await this.registry.flush();
  }

  /**
   * Indexes a single note. Read failures are logged, never swallowed.
   * Resolves the tasks that were just written into the note (see
   * {@link freshTaskKeys}) and the ones just ticked off; both empty the first
   * time a note is seen.
   */
  async indexFile(file: TFile, now: number = Date.now()): Promise<IndexChanges> {
    const none: IndexChanges = { fresh: [], done: [] };
    if (!this.isTracked(file)) return none;

    let content: string;
    try {
      content = this.options.liveContent?.(file) ?? (await this.app.vault.cachedRead(file));
    } catch (error) {
      console.error(`TaskPro: failed to read "${file.path}" while indexing task ages`, error);
      return none;
    }

    const keys = taskKeysInContent(file.path, content);
    this.registry.indexFile(file.path, file.stat.ctime, keys, now);
    const lines = taskKeysByLine(file.path, content);
    const writing = this.writing.get(file.path) ?? new Map<string, number>();
    for (const [key, until] of writing) if (until <= now) writing.delete(key);
    // Whether a task is new is told from the note's last pass, never from the
    // registry: a text the registry once saw (a task deleted and written
    // again, a half-typed word) would otherwise never count as new.
    let previous = this.lastKeys.get(file.path);
    if (!previous && now - file.stat.ctime < NEW_NOTE_MS) previous = [];
    const fresh = writtenTaskKeys(previous, lines, new Set(writing.keys()));
    for (const key of fresh) writing.set(key, now + WRITING_WINDOW_MS);
    if (writing.size) this.writing.set(file.path, writing);
    else this.writing.delete(file.path);
    this.lastKeys.set(file.path, lines);
    const statuses = taskStatuses(file.path, content);
    const done = completedTaskKeys(this.lastStatuses.get(file.path), statuses);
    this.lastStatuses.set(file.path, statuses);
    return { fresh, done };
  }

  /**
   * Debounced entry point for vault `create` / `modify` events. With
   * `reportNew`, the tasks just written into the note are handed to
   * `onNewTasks`; a note that was only created (a template, a synced copy)
   * is indexed without that.
   */
  handleFileChanged(file: TFile, reportNew = false): void {
    if (this.stopped || !this.isTracked(file)) return;

    const existing = this.timers.get(file.path);
    if (existing) clearTimeout(existing);
    // A note created and then typed into reports what was typed.
    if (reportNew) this.reporting.add(file.path);

    this.timers.set(
      file.path,
      setTimeout(() => {
        this.timers.delete(file.path);
        const report = this.reporting.delete(file.path);
        void this.indexFile(file)
          .then(({ fresh, done }) => {
            if (!report || this.stopped) return;
            if (fresh.length) this.options.onNewTasks?.(file, fresh);
            if (done.length) this.options.onTasksDone?.(file, done);
          })
          .then(() => this.registry.flush());
      }, INDEX_DEBOUNCE_MS)
    );
  }

  handleFileRenamed(file: TFile, oldPath: string): void {
    this.registry.renameFile(oldPath, file.path);
    this.lastKeys.delete(oldPath);
    this.lastStatuses.delete(oldPath);
    this.writing.delete(oldPath);
    // Re-index under the new path so text-hashed keys line up again.
    void this.indexFile(file).then(() => this.registry.flush());
  }

  handleFileDeleted(filePath: string): void {
    const timer = this.timers.get(filePath);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(filePath);
    }

    this.registry.forgetFile(filePath);
    this.lastKeys.delete(filePath);
    this.lastStatuses.delete(filePath);
    this.writing.delete(filePath);
    void this.registry.flush();
  }

  /** Cancels pending work. Called from the plugin's onunload. */
  stop(): void {
    this.stopped = true;
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }
}
