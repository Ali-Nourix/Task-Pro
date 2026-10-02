// ── telegram/sync-service.ts ──────────────────────────────────────────────
// Keeps the Telegram bot and the notes in step. While Obsidian is open it
// uploads the open tasks (so the bot can list them and remind you while the
// computer is off), fetches what was asked for in Telegram, makes those
// changes in the notes, and says that it has.
//
// Safe to repeat: every change from Telegram has an ID, an applied one is
// remembered until the bot has confirmed it, and one the bot sends again is
// not made twice.
// ─────────────────────────────────────────────────────────────────────────────

import type { BoardTask } from '../board/task-store';
import type { TelegramSettings } from '../types';
import { ApplyHost, Command, Result, applyCommands } from './apply';
import { ReminderDefaults, buildSnapshot } from './snapshot';

export interface Reply {
  status: number;
  json: { commands?: Command[]; error?: string } | null;
}

export interface SyncHost {
  settings(): TelegramSettings;
  /** Every task, or null until the notes have been read. */
  tasks(): BoardTask[] | null;
  defaults(): ReminderDefaults;
  post(url: string, token: string, body: unknown): Promise<Reply>;
  apply: ApplyHost;
  save(): Promise<void>;
  /** Told after each sync: how many changes were made, or what went wrong. */
  report(outcome: Outcome): void;
  registerInterval(id: number): void;
  now(): number;
}

export interface Outcome {
  ok: boolean;
  applied: number;
  errors: number;
  message?: string;
}

/** The sync function's address from what the user pasted. */
export function syncEndpoint(url: string): string | null {
  const trimmed = url.trim().replace(/\/+$/, '');
  if (!/^https?:\/\/[^\s/]+/i.test(trimmed)) return null;
  if (/\/functions\/v1\/sync$/.test(trimmed)) return trimmed;
  return /\/functions\/v1$/.test(trimmed) ? `${trimmed}/sync` : `${trimmed}/functions/v1/sync`;
}

const DEBOUNCE_MS = 20_000;
const STARTUP_MS = 4_000;
const KEEP_UNCONFIRMED = 100;

export class TelegramSync {
  private timer: number | null = null;
  private debounce: number | null = null;
  private running = false;
  private lastUploaded = '';

  constructor(private readonly host: SyncHost) {}

  /** Starts (or restarts) the ticker from the settings. */
  start(): void {
    this.stop();
    const settings = this.host.settings();
    if (!settings.enabled || !syncEndpoint(settings.url) || !settings.token) return;
    const every = Math.max(1, Math.min(60, settings.intervalMinutes || 2)) * 60_000;
    this.timer = window.setInterval(() => void this.syncNow(), every);
    this.host.registerInterval(this.timer);
    this.debounce = window.setTimeout(() => void this.syncNow(), STARTUP_MS);
  }

  stop(): void {
    if (this.timer !== null) window.clearInterval(this.timer);
    if (this.debounce !== null) window.clearTimeout(this.debounce);
    this.timer = null;
    this.debounce = null;
  }

  /** The notes changed: tell the bot soon, once the edits have settled. */
  tasksChanged(): void {
    if (this.timer === null) return;
    if (this.debounce !== null) window.clearTimeout(this.debounce);
    this.debounce = window.setTimeout(() => void this.syncNow(), DEBOUNCE_MS);
  }

  async syncNow(): Promise<Outcome> {
    const settings = this.host.settings();
    const endpoint = syncEndpoint(settings.url);
    if (!endpoint || !settings.token) return this.finish({ ok: false, applied: 0, errors: 0, message: 'Enter the project address and the sync token first.' });
    if (this.running) return { ok: true, applied: 0, errors: 0, message: 'A sync is already running.' };
    if (!this.host.tasks()) return { ok: false, applied: 0, errors: 0, message: 'The notes are still being read.' };

    this.running = true;
    try {
      const snapshot = buildSnapshot(this.host.tasks()!, this.host.defaults());
      const json = JSON.stringify(snapshot);
      const sentAcks = [...(settings.unconfirmed ?? [])];
      const first = await this.call(endpoint, settings.token, {
        acks: sentAcks,
        snapshot: json === this.lastUploaded ? undefined : snapshot,
      });
      this.lastUploaded = json;
      this.confirm(sentAcks);

      const commands = Array.isArray(first.commands) ? first.commands : [];
      let applied = 0;
      let errors = 0;
      if (commands.length) {
        const results = await this.applyAll(commands);
        applied = results.filter((r) => !r.error).length;
        errors = results.length - applied;
        settings.unconfirmed = [...(settings.unconfirmed ?? []), ...results].slice(-KEEP_UNCONFIRMED);
        await this.host.save();
        // Tell the bot what has been done, along with the notes as they are now.
        const after = buildSnapshot(this.host.tasks() ?? [], this.host.defaults());
        const acks = [...results];
        await this.call(endpoint, settings.token, { acks, snapshot: after });
        this.lastUploaded = JSON.stringify(after);
        this.confirm(acks);
      }
      return this.finish({ ok: true, applied, errors });
    } catch (error) {
      return this.finish({ ok: false, applied: 0, errors: 0, message: String((error as Error)?.message ?? error) });
    } finally {
      this.running = false;
    }
  }

  private async call(endpoint: string, token: string, body: unknown): Promise<{ commands?: Command[] }> {
    const reply = await this.host.post(endpoint, token, body);
    if (reply.status === 401 || reply.status === 403) throw new Error('The sync token is not right.');
    if (reply.status === 404) throw new Error('The sync function was not found: check the project address.');
    if (reply.status < 200 || reply.status >= 300 || !reply.json) throw new Error(reply.json?.error ?? `The server answered ${reply.status}.`);
    return reply.json;
  }

  /** Makes the commands, skipping any made before whose confirmation was lost. */
  private async applyAll(commands: readonly Command[]): Promise<Result[]> {
    const known = new Map((this.host.settings().unconfirmed ?? []).map((result) => [result.id, result]));
    const aliases = new Map<string, string>();
    for (const result of known.values()) if (result.from && result.key) aliases.set(result.from, result.key);
    const results: Result[] = [];
    for (const command of commands) {
      const before = known.get(command.id);
      if (before) {
        results.push(before);
        continue;
      }
      const [result] = await applyCommands([command], this.host.apply, aliases);
      results.push(result);
    }
    return results;
  }

  private confirm(acks: readonly Result[]): void {
    const settings = this.host.settings();
    const gone = new Set(acks.map((ack) => ack.id));
    settings.unconfirmed = (settings.unconfirmed ?? []).filter((result) => !gone.has(result.id));
  }

  private finish(outcome: Outcome): Outcome {
    const settings = this.host.settings();
    if (outcome.ok) {
      settings.lastSyncAt = new Date(this.host.now()).toISOString();
      delete settings.lastError;
    } else if (outcome.message) {
      settings.lastError = outcome.message;
    }
    void this.host.save();
    this.host.report(outcome);
    return outcome;
  }
}
