// ── task-registry.ts ──────────────────────────────────────────────────────
// Hidden, plugin-owned record of *when each task was created*.
//
// Design rules (learned the hard way):
//
// 1. Nothing is written into the user's notes. The data lives in the plugin's
//    own data.json.
// 2. The note's FILE NAME is never parsed for a date. A note called
//    "1405-05-06" is a note about that day, not proof of when a line inside it
//    was typed.
// 3. A timestamp is either OBSERVED or it is UNKNOWN. There is no third,
//    "probably right" category:
//      - exact    → TaskPro watched this task appear. Trustworthy.
//      - baseline → the task already existed when TaskPro first indexed the
//                   note. Its real age is unknowable.
//    The note's own creation time is kept alongside baseline entries, but only
//    as an explicit, opt-in fallback. It is NOT treated as the task's age by
//    default, because copying, syncing or re-saving a vault rewrites it and
//    would make every old task look brand new (exactly the bug this replaces).
//
// Identity: a block id (`^abc123`) survives edits and moves, so it wins.
// Otherwise the normalized task text is hashed. Renaming a task then looks
// like a new task, which errs on the safe side: a task is never reported as
// older than it really is.
// ─────────────────────────────────────────────────────────────────────────────

/** How a creation timestamp was obtained. */
export type TaskCreationOrigin = 'exact' | 'baseline';

export interface TaskCreationRecord {
  /** Epoch millis. For baseline entries this is only the indexing moment. */
  createdAt: number;
  origin: TaskCreationOrigin;
  /** Epoch millis of the last index pass that saw this task (for pruning). */
  seenAt: number;
  /** Note ctime captured at baseline time, for the opt-in fallback only. */
  noteCreatedAt?: number;
}

export interface TaskCreationIndex {
  /** Schema version, so future migrations do not have to guess. */
  version: number;
  /** When TaskPro started tracking. Tasks older than this cannot be dated. */
  baselineAt?: number;
  tasks: Record<string, TaskCreationRecord>;
  /** filePath → epoch millis of the first index pass over that note. */
  files: Record<string, number>;
}

export interface TaskCreationInfo {
  createdAt: number;
  origin: TaskCreationOrigin;
  noteCreatedAt?: number;
}

export interface TaskRegistryHost {
  getIndex: () => TaskCreationIndex | undefined;
  setIndex: (index: TaskCreationIndex) => void;
  save: () => Promise<void>;
}

export const TASK_INDEX_VERSION = 2;

/** Records unseen for this long are dropped so data.json cannot grow forever. */
const STALE_ENTRY_MS = 120 * 24 * 60 * 60 * 1000; // 120 days

/** FNV-1a: tiny, dependency-free, and stable across sessions. */
function hashText(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    // >>> 0 keeps the value an unsigned 32-bit int after the multiply.
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
  }
  return hash.toString(16);
}

/** Collapses whitespace and case so trivial reformatting keeps the identity. */
function normalizeForIdentity(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Stable key for a task line.
 *
 * @param filePath Vault-relative path of the note holding the task.
 * @param text Task text with plugin metadata already stripped.
 * @param blockId Block id without the leading caret, when the task has one.
 */
export function buildTaskKey(filePath: string, text: string, blockId?: string): string {
  return blockId
    ? `${filePath}#^${blockId}`
    : `${filePath}#~${hashText(normalizeForIdentity(text))}`;
}

function emptyIndex(now: number): TaskCreationIndex {
  return { version: TASK_INDEX_VERSION, baselineAt: now, tasks: {}, files: {} };
}

export class TaskCreationRegistry {
  private dirty = false;

  constructor(private readonly host: TaskRegistryHost) {}

  /** Lazily creates (or resets) the index the first time it is needed. */
  private getIndex(now: number): TaskCreationIndex {
    const current = this.host.getIndex();

    if (current && current.tasks && current.files && current.version === TASK_INDEX_VERSION) {
      return current;
    }

    // Older schemas stored guessed timestamps that this version refuses to
    // trust, so they are discarded rather than migrated into new lies.
    const created = emptyIndex(now);
    this.host.setIndex(created);
    this.dirty = true;
    return created;
  }

  /** Epoch millis when tracking began, or undefined before the first pass. */
  get baselineAt(): number | undefined {
    return this.host.getIndex()?.baselineAt;
  }

  hasIndexedFile(filePath: string): boolean {
    return typeof this.host.getIndex()?.files[filePath] === 'number';
  }

  /** Read-only lookup. Never registers anything, so scanning cannot skew ages. */
  getCreation(taskKey: string): TaskCreationInfo | undefined {
    const record = this.host.getIndex()?.tasks[taskKey];
    if (!record) return undefined;
    return {
      createdAt: record.createdAt,
      origin: record.origin,
      noteCreatedAt: record.noteCreatedAt,
    };
  }

  /**
   * Registers the tasks currently present in a note.
   *
   * First pass over a note → every task is `baseline` (age unknown).
   * Later passes → keys that were not there before are `exact`: TaskPro saw
   * them appear, so `now` really is their creation moment.
   *
   * Keys that disappeared are kept until {@link prune} removes them, so
   * temporarily editing a task's text does not reset its age when the edit is
   * undone.
   */
  indexFile(
    filePath: string,
    noteCreatedAt: number,
    taskKeys: string[],
    now: number = Date.now()
  ): void {
    const index = this.getIndex(now);
    const firstPass = typeof index.files[filePath] !== 'number';
    const safeNoteCreatedAt =
      Number.isFinite(noteCreatedAt) && noteCreatedAt > 0 ? Math.min(noteCreatedAt, now) : now;

    for (const key of taskKeys) {
      const existing = index.tasks[key];

      if (existing) {
        if (existing.seenAt !== now) {
          existing.seenAt = now;
          this.dirty = true;
        }
        continue;
      }

      index.tasks[key] = firstPass
        ? {
            createdAt: now,
            origin: 'baseline',
            seenAt: now,
            noteCreatedAt: safeNoteCreatedAt,
          }
        : { createdAt: now, origin: 'exact', seenAt: now };
      this.dirty = true;
    }

    if (firstPass) {
      index.files[filePath] = now;
      this.dirty = true;
    }
  }

  /** Forgets everything about a note. Call when a file is deleted. */
  forgetFile(filePath: string, now: number = Date.now()): void {
    const index = this.getIndex(now);
    let changed = false;

    if (typeof index.files[filePath] === 'number') {
      delete index.files[filePath];
      changed = true;
    }

    const prefix = `${filePath}#`;
    for (const key of Object.keys(index.tasks)) {
      if (key.startsWith(prefix)) {
        delete index.tasks[key];
        changed = true;
      }
    }

    if (changed) this.dirty = true;
  }

  /** Moves records with a file so a rename does not reset task ages. */
  renameFile(oldPath: string, newPath: string, now: number = Date.now()): void {
    const index = this.getIndex(now);
    let changed = false;

    if (typeof index.files[oldPath] === 'number') {
      index.files[newPath] = index.files[newPath] ?? index.files[oldPath];
      delete index.files[oldPath];
      changed = true;
    }

    const prefix = `${oldPath}#`;
    for (const key of Object.keys(index.tasks)) {
      if (!key.startsWith(prefix)) continue;
      const moved = `${newPath}#${key.slice(prefix.length)}`;
      index.tasks[moved] = index.tasks[moved] ?? index.tasks[key];
      delete index.tasks[key];
      changed = true;
    }

    if (changed) this.dirty = true;
  }

  /**
   * Drops records for notes that no longer exist and tasks not seen for a long
   * time. Only safe to call right after a full pass over the vault.
   */
  prune(existingPaths: Set<string>, now: number = Date.now()): void {
    const index = this.getIndex(now);

    for (const path of Object.keys(index.files)) {
      if (!existingPaths.has(path)) {
        delete index.files[path];
        this.dirty = true;
      }
    }

    for (const [key, record] of Object.entries(index.tasks)) {
      const path = key.slice(0, key.lastIndexOf('#'));
      const gone = !existingPaths.has(path);
      const stale = now - record.seenAt > STALE_ENTRY_MS;
      if (gone || stale) {
        delete index.tasks[key];
        this.dirty = true;
      }
    }
  }

  /** Persists pending changes. No-op when nothing changed. */
  async flush(): Promise<void> {
    if (!this.dirty) return;
    this.dirty = false;
    try {
      await this.host.save();
    } catch (error) {
      // Re-arm so the next flush retries instead of losing the data silently.
      this.dirty = true;
      console.error('TaskPro: failed to persist the task creation index', error);
    }
  }
}
