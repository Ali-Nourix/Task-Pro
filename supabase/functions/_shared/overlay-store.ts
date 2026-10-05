// A store that lets the assistant try its commands without keeping anything: what it makes and
// changes lives in memory over the real tasks, what it queues goes nowhere. The owner is shown the
// result, and only if they accept does the same list of commands run again on the real store.

import type { CommandKind, CommandRow, OwnerRow, SnapshotTask, Store, TaskRow } from './types.ts';
import { PROVISIONAL_N, isOpen } from './types.ts';

export class OverlayStore implements Store {
  /** Tasks as the commands have left them: changed ones and new ones, by key. */
  private readonly changed = new Map<string, TaskRow>();
  private readonly removed = new Set<string>();
  private provisional = PROVISIONAL_N;

  constructor(private readonly base: Store) {}

  getOwner(): Promise<OwnerRow | null> {
    return this.base.getOwner();
  }

  // The owner is never written to while trying.
  async setOwner(): Promise<void> {}
  async patchOwner(): Promise<void> {}

  /** The real tasks with the changes laid over them, then the new ones. */
  private async all(): Promise<TaskRow[]> {
    const real = (await this.base.openTasks()).filter((task) => !this.removed.has(task.key)).map((task) => this.changed.get(task.key) ?? task);
    const known = new Set(real.map((task) => task.key));
    const added = [...this.changed.values()].filter((task) => !known.has(task.key) && !this.removed.has(task.key));
    return [...real, ...added];
  }

  async openTasks(): Promise<TaskRow[]> {
    return (await this.all()).filter((task) => isOpen(task.status)).map((task) => ({ ...task }));
  }

  async taskByN(n: number): Promise<TaskRow | null> {
    const own = [...this.changed.values()].find((task) => task.n === n);
    if (own) return this.removed.has(own.key) ? null : { ...own };
    const real = await this.base.taskByN(n);
    return real && !this.removed.has(real.key) ? { ...(this.changed.get(real.key) ?? real) } : null;
  }

  async taskByKey(key: string): Promise<TaskRow | null> {
    if (this.removed.has(key)) return null;
    const own = this.changed.get(key);
    if (own) return { ...own };
    const real = await this.base.taskByKey(key);
    return real ? { ...real } : null;
  }

  async insertTask(task: Omit<TaskRow, 'n' | 'remind_sent_for'>): Promise<TaskRow> {
    const row: TaskRow = { ...task, n: this.provisional++, remind_sent_for: null };
    this.changed.set(row.key, row);
    return { ...row };
  }

  async patchTask(key: string, patch: Partial<Omit<TaskRow, 'n' | 'key'>>): Promise<void> {
    const current = this.changed.get(key) ?? (await this.base.taskByKey(key));
    if (current) this.changed.set(key, { ...current, ...patch });
  }

  async removeTask(key: string): Promise<void> {
    this.removed.add(key);
    this.changed.delete(key);
  }

  async addCommand(kind: CommandKind, payload: object): Promise<CommandRow> {
    return { id: 'preview', kind, payload: { ...payload } as Record<string, unknown>, created_at: new Date().toISOString() };
  }

  async pendingCommands(): Promise<CommandRow[]> {
    return [];
  }

  async finishCommand(): Promise<CommandRow | null> {
    return null;
  }

  // Not for trying: nothing here uploads, re-keys or announces.
  async replaceSnapshot(_rows: SnapshotTask[], _keep: ReadonlySet<string>): Promise<void> {}
  async rekey(): Promise<void> {}
  async dueReminders(): Promise<TaskRow[]> {
    return [];
  }
  async markReminded(): Promise<void> {}
}
