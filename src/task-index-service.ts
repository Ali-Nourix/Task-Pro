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
// Cost control: one debounced pass per changed file, `cachedRead` only, and a
// single full pass at startup.
// ─────────────────────────────────────────────────────────────────────────────

import { App, TFile } from 'obsidian';
import { isWithinTargetFolder } from './path-utils';
import { taskKeysInContent } from './task-identity';
import { TaskCreationRegistry } from './task-registry';

/** Waits for typing to settle before re-indexing a note. */
const INDEX_DEBOUNCE_MS = 1_500;

export interface TaskIndexServiceOptions {
  app: App;
  registry: TaskCreationRegistry;
  /** Read live so changing the folder setting takes effect immediately. */
  getTargetFolder: () => string;
}

export class TaskIndexService {
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private stopped = false;

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
    return !folder.trim() || isWithinTargetFolder(file.path, folder);
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

  /** Indexes a single note. Read failures are logged, never swallowed. */
  async indexFile(file: TFile, now: number = Date.now()): Promise<void> {
    if (!this.isTracked(file)) return;

    let content: string;
    try {
      content = await this.app.vault.cachedRead(file);
    } catch (error) {
      console.error(`TaskPro: failed to read "${file.path}" while indexing task ages`, error);
      return;
    }

    this.registry.indexFile(file.path, file.stat.ctime, taskKeysInContent(file.path, content), now);
  }

  /** Debounced entry point for vault `create` / `modify` events. */
  handleFileChanged(file: TFile): void {
    if (this.stopped || !this.isTracked(file)) return;

    const existing = this.timers.get(file.path);
    if (existing) clearTimeout(existing);

    this.timers.set(
      file.path,
      setTimeout(() => {
        this.timers.delete(file.path);
        void this.indexFile(file).then(() => this.registry.flush());
      }, INDEX_DEBOUNCE_MS)
    );
  }

  handleFileRenamed(file: TFile, oldPath: string): void {
    this.registry.renameFile(oldPath, file.path);
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
    void this.registry.flush();
  }

  /** Cancels pending work. Called from the plugin's onunload. */
  stop(): void {
    this.stopped = true;
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }
}
