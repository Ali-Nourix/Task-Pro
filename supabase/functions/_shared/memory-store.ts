// The store in memory: what the tests run against, with the same rules as the database.

import type { CommandKind, CommandRow, OwnerRow, SnapshotTask, Store, TaskRow } from './types.ts';
import { isOpen, sameInstant } from './types.ts';

export class MemoryStore implements Store {
  owner: OwnerRow | null = null;
  tasks: TaskRow[] = [];
  commands: Array<CommandRow & { applied_at: string | null; error: string | null }> = [];
  private next = 1;
  private ids = 1;

  async getOwner() {
    return this.owner ? { ...this.owner } : null;
  }

  async setOwner(owner: Omit<OwnerRow, 'last_sync_at'>) {
    this.owner = { ...owner, last_sync_at: this.owner?.last_sync_at ?? null };
  }

  async patchOwner(patch: Partial<OwnerRow>) {
    if (this.owner) this.owner = { ...this.owner, ...patch };
  }

  async openTasks() {
    return this.tasks.filter((task) => isOpen(task.status)).sort((a, b) => a.n - b.n).map((task) => ({ ...task }));
  }

  async taskByN(n: number) {
    const task = this.tasks.find((candidate) => candidate.n === n);
    return task ? { ...task } : null;
  }

  async taskByKey(key: string) {
    const task = this.tasks.find((candidate) => candidate.key === key);
    return task ? { ...task } : null;
  }

  async insertTask(task: Omit<TaskRow, 'n' | 'remind_sent_for'>) {
    const row: TaskRow = { ...task, n: this.next++, remind_sent_for: null };
    this.tasks.push(row);
    return { ...row };
  }

  async patchTask(key: string, patch: Partial<Omit<TaskRow, 'n' | 'key'>>) {
    const task = this.tasks.find((candidate) => candidate.key === key);
    if (task) Object.assign(task, patch);
  }

  async removeTask(key: string) {
    this.tasks = this.tasks.filter((task) => task.key !== key);
  }

  async replaceSnapshot(rows: SnapshotTask[], keep: ReadonlySet<string>) {
    const seen = new Set<string>();
    for (const row of rows) {
      seen.add(row.key);
      const existing = this.tasks.find((task) => task.key === row.key);
      if (keep.has(row.key) && existing) continue;
      if (existing) Object.assign(existing, row, { origin: 'vault', pending: false });
      else this.tasks.push({ ...row, n: this.next++, remind_sent_for: null, origin: 'vault', pending: false });
    }
    this.tasks = this.tasks.filter((task) => task.pending || seen.has(task.key) || keep.has(task.key));
  }

  async rekey(from: string, to: string) {
    const task = this.tasks.find((candidate) => candidate.key === from);
    if (!task) return;
    if (this.tasks.some((candidate) => candidate.key === to)) {
      this.tasks = this.tasks.filter((candidate) => candidate.key !== from);
    } else {
      task.key = to;
      task.pending = false;
    }
    for (const command of this.commands) {
      if (command.applied_at === null && command.payload.key === from) command.payload = { ...command.payload, key: to };
      if (command.applied_at === null && command.payload.parent === from) command.payload = { ...command.payload, parent: to };
    }
    for (const child of this.tasks) if (child.parent_key === from) child.parent_key = to;
  }

  async addCommand(kind: CommandKind, payload: object) {
    const row = { id: `c${this.ids++}`, kind, payload: { ...payload } as Record<string, unknown>, created_at: new Date().toISOString(), applied_at: null, error: null };
    this.commands.push(row);
    return { id: row.id, kind, payload: row.payload, created_at: row.created_at };
  }

  async pendingCommands() {
    return this.commands
      .filter((command) => command.applied_at === null)
      .map(({ id, kind, payload, created_at }) => ({ id, kind, payload: { ...payload }, created_at }));
  }

  async finishCommand(id: string, error?: string) {
    const command = this.commands.find((candidate) => candidate.id === id);
    if (!command || command.applied_at !== null) return null;
    command.applied_at = new Date().toISOString();
    command.error = error ?? null;
    return { id: command.id, kind: command.kind, payload: command.payload, created_at: command.created_at };
  }

  async dueReminders(from: Date, to: Date) {
    return this.tasks
      .filter(
        (task) =>
          isOpen(task.status) &&
          task.remind_at !== null &&
          new Date(task.remind_at) >= from &&
          new Date(task.remind_at) <= to &&
          !sameInstant(task.remind_sent_for, task.remind_at)
      )
      .map((task) => ({ ...task }));
  }

  async markReminded(key: string, remindAt: string) {
    const task = this.tasks.find((candidate) => candidate.key === key);
    if (task) task.remind_sent_for = remindAt;
  }
}
