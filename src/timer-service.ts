// ── timer-service.ts ──────────────────────────────────────────────────────
// Per-task focus timers: one ticker, live chip labels, a status-bar readout,
// and a desktop notification when a timer runs out.
// ─────────────────────────────────────────────────────────────────────────────

import { Notice, setIcon } from 'obsidian';
import {
  CHIP_ICON_NAMES,
  Language,
  TaskTimer,
  TaskTimerEntry,
  formatTimerClock,
  timerRemainingSeconds,
  timerState,
} from './types';
import { getTimerLabels } from './timer-localization';

/** Everything the service needs from the plugin, kept narrow for testability. */
export interface TimerServiceHost {
  getEntries: () => TaskTimerEntry[];
  setEntries: (entries: TaskTimerEntry[]) => void;
  save: () => Promise<void>;
  getLanguage: () => Language;
  getSettings: () => {
    showTimerBadges: boolean;
    timerSystemNotification: boolean;
    timerSound: boolean;
    timerInStatusBar: boolean;
  };
  /** Called once per second so the host can refresh anything it owns. */
  onTick?: () => void;
  /** Plays the configured reminder sound. */
  playSound?: () => void;
  /** Opens the note a timer belongs to. */
  reveal?: (filePath: string, blockId: string) => void;
  /** Registers an interval with the plugin so it is cleared on unload. */
  registerInterval: (id: number) => void;
  /** Obsidian's status bar slot, when the platform provides one. */
  statusBarEl?: HTMLElement;
}

export function timerKey(filePath: string, blockId: string): string {
  return `${filePath}:${blockId}`;
}

export class TaskTimerService {
  private readonly cache = new Map<string, TaskTimer>();
  /**
   * Timers whose completion is mid-flight. `set` writes through an async save,
   * so without this a second tick could read the pre-save entry and announce
   * the same timer twice.
   */
  private readonly completing = new Set<string>();
  private ticker: number | null = null;
  private statusIconEl: HTMLElement | null = null;
  private statusTextEl: HTMLElement | null = null;

  constructor(private readonly host: TimerServiceHost) {
    this.rebuildCache();
    this.buildStatusBar();
  }

  // ============================================================ lifecycle

  /**
   * The ticker only exists while something is actually counting down, so an
   * idle vault pays nothing for the feature.
   */
  private ensureTicker(): void {
    if (this.ticker !== null) return;
    if (!this.hasRunningTimer()) return;
    this.ticker = window.setInterval(() => this.tick(), 1000);
    this.host.registerInterval(this.ticker);
  }

  private stopTicker(): void {
    if (this.ticker === null) return;
    window.clearInterval(this.ticker);
    this.ticker = null;
  }

  /** Call after settings are (re)loaded. Running timers resume from the clock. */
  rebuildCache(): void {
    this.cache.clear();
    for (const entry of this.host.getEntries() ?? []) {
      if (entry.filePath && entry.blockId && entry.timer?.enabled) {
        this.cache.set(timerKey(entry.filePath, entry.blockId), entry.timer);
      }
    }
    this.ensureTicker();
    this.render();
  }

  destroy(): void {
    this.stopTicker();
    this.statusIconEl = null;
    this.statusTextEl = null;
  }

  // ================================================================= state

  get(filePath: string, blockId?: string): TaskTimer | undefined {
    if (!blockId) return undefined;
    return this.cache.get(timerKey(filePath, blockId));
  }

  async set(filePath: string, blockId: string | undefined, timer: TaskTimer | null): Promise<void> {
    if (!blockId) return;
    const key = timerKey(filePath, blockId);
    const entries = (this.host.getEntries() ?? []).filter(
      (entry) => !(entry.filePath === filePath && entry.blockId === blockId)
    );
    this.cache.delete(key);

    if (timer && timer.enabled) {
      entries.push({ filePath, blockId, timer });
      this.cache.set(key, timer);
    }

    this.host.setEntries(entries);
    await this.host.save();
    this.ensureTicker();
    this.render();
  }

  /**
   * Carries the timers of tasks that moved to another note, so a running one
   * keeps counting. `ids` maps each block ID the moved tasks had to the one
   * they have now.
   */
  async move(from: string, to: string, ids: ReadonlyMap<string, string>): Promise<void> {
    let changed = false;
    const entries = (this.host.getEntries() ?? []).map((entry) => {
      const blockId = entry.filePath === from ? ids.get(entry.blockId) : undefined;
      if (blockId === undefined) return entry;
      changed = true;
      return { ...entry, filePath: to, blockId };
    });
    if (!changed) return;
    this.host.setEntries(entries);
    this.rebuildCache();
    await this.host.save();
  }

  // ============================================================== commands

  async start(filePath: string, blockId: string, timer: TaskTimer): Promise<void> {
    if (timer.runningSince > 0) return;
    await this.set(filePath, blockId, {
      ...timer,
      runningSince: Date.now(),
      completedAt: undefined,
      notifiedAt: undefined,
    });
  }

  async pause(filePath: string, blockId: string, timer: TaskTimer): Promise<void> {
    if (timer.runningSince <= 0) return;
    const banked = timer.elapsedSeconds + Math.max(0, (Date.now() - timer.runningSince) / 1000);
    await this.set(filePath, blockId, {
      ...timer,
      elapsedSeconds: Math.round(banked),
      runningSince: 0,
    });
  }

  async reset(filePath: string, blockId: string, timer: TaskTimer): Promise<void> {
    await this.set(filePath, blockId, {
      ...timer,
      elapsedSeconds: 0,
      runningSince: 0,
      completedAt: undefined,
      notifiedAt: undefined,
    });
  }

  /** Extends the planned duration, e.g. the classic "just five more minutes". */
  async extend(filePath: string, blockId: string, timer: TaskTimer, minutes: number): Promise<void> {
    await this.set(filePath, blockId, {
      ...timer,
      durationSeconds: Math.max(60, timer.durationSeconds + minutes * 60),
      completedAt: undefined,
      notifiedAt: undefined,
    });
  }

  // ================================================================= ticking

  private hasRunningTimer(): boolean {
    for (const timer of this.cache.values()) if (timer.runningSince > 0) return true;
    return false;
  }

  private tick(): void {
    const now = Date.now();
    const finished: Array<{ filePath: string; blockId: string; timer: TaskTimer }> = [];

    for (const entry of this.host.getEntries() ?? []) {
      const timer = entry.timer;
      if (!timer?.enabled || timer.runningSince <= 0) continue;
      if (timerRemainingSeconds(timer, now) > 0) continue;
      if (this.completing.has(timerKey(entry.filePath, entry.blockId))) continue;
      finished.push({ filePath: entry.filePath, blockId: entry.blockId, timer });
    }

    for (const { filePath, blockId, timer } of finished) {
      void this.complete(filePath, blockId, timer, now);
    }

    this.render();
    this.host.onTick?.();
    if (!this.hasRunningTimer()) this.stopTicker();
  }

  /** Banks the full duration, announces it, and leaves the timer in "done". */
  private async complete(
    filePath: string,
    blockId: string,
    timer: TaskTimer,
    now: number
  ): Promise<void> {
    if (timer.notifiedAt) return;
    const key = timerKey(filePath, blockId);
    this.completing.add(key);
    try {
      await this.set(filePath, blockId, {
        ...timer,
        elapsedSeconds: timer.durationSeconds,
        runningSince: 0,
        completedAt: now,
        notifiedAt: now,
      });
    } finally {
      this.completing.delete(key);
    }

    const labels = getTimerLabels(this.host.getLanguage());
    const taskName =
      timer.label?.trim() ||
      (filePath.split('/').pop() ?? filePath).replace(/\.md$/, '');
    const settings = this.host.getSettings();

    new Notice(labels.finishedNotice(taskName), 8000);
    if (settings.timerSound) this.host.playSound?.();
    if (settings.timerSystemNotification) {
      showSystemNotification(labels.finishedTitle, labels.finishedBody(taskName));
    }
  }

  // ============================================================== rendering

  /**
   * Chips are updated in place rather than through a decoration rebuild: a
   * countdown changes every second, and rebuilding the editor's decorations at
   * that rate would fight the user's cursor.
   */
  render(): void {
    const now = Date.now();
    const labels = getTimerLabels(this.host.getLanguage());

    document.querySelectorAll<HTMLElement>('.taskpro-timer-badge').forEach((badge) => {
      const key = badge.dataset.timerKey;
      if (!key) return;
      const timer = this.cache.get(key);
      const label = badge.querySelector<HTMLElement>('.taskpro-chip__label');
      if (!timer) {
        badge.remove();
        return;
      }
      const state = timerState(timer, now);
      const remaining = timerRemainingSeconds(timer, now);
      if (label) label.textContent = state === 'done' ? labels.doneChip : formatTimerClock(remaining);
      badge.dataset.state = state;
      badge.setAttribute('aria-label', labels.chipAria(formatTimerClock(remaining), state));
    });

    this.renderStatusBar(now, labels);
  }

  private buildStatusBar(): void {
    const host = this.host.statusBarEl;
    if (!host) return;
    host.addClass('taskpro-status-timer');
    host.setAttribute('role', 'button');
    host.tabIndex = 0;
    this.statusIconEl = host.createSpan({ cls: 'taskpro-status-timer__icon' });
    setIcon(this.statusIconEl, CHIP_ICON_NAMES.timer);
    this.statusTextEl = host.createSpan({ cls: 'taskpro-status-timer__text' });
    host.addEventListener('click', () => {
      const active = this.activeEntry();
      if (active) this.host.reveal?.(active.filePath, active.blockId);
    });
  }

  /** The running timer with the least time left — the one the user cares about. */
  private activeEntry(): TaskTimerEntry | null {
    const now = Date.now();
    let best: TaskTimerEntry | null = null;
    let bestRemaining = Number.POSITIVE_INFINITY;
    for (const entry of this.host.getEntries() ?? []) {
      if (!entry.timer?.enabled || entry.timer.runningSince <= 0) continue;
      const remaining = timerRemainingSeconds(entry.timer, now);
      if (remaining < bestRemaining) {
        bestRemaining = remaining;
        best = entry;
      }
    }
    return best;
  }

  private renderStatusBar(now: number, labels: ReturnType<typeof getTimerLabels>): void {
    const host = this.host.statusBarEl;
    if (!host || !this.statusTextEl) return;

    const active = this.host.getSettings().timerInStatusBar ? this.activeEntry() : null;
    host.toggleClass('is-active', active !== null);
    if (!active) {
      this.statusTextEl.textContent = '';
      return;
    }

    const remaining = timerRemainingSeconds(active.timer, now);
    const note = active.filePath.split('/').pop()?.replace(/\.md$/, '') ?? active.filePath;
    this.statusTextEl.textContent = `${formatTimerClock(remaining)} · ${note}`;
    host.setAttribute('aria-label', labels.statusBarAria(note));
  }
}

/**
 * Desktop toast. On Windows this surfaces as a native notification in the
 * Action Center; permission is requested once and never re-prompted.
 */
export function showSystemNotification(title: string, body: string): void {
  if (typeof Notification === 'undefined') return;
  try {
    if (Notification.permission === 'granted') {
      new Notification(title, { body });
    } else if (Notification.permission === 'default') {
      void Notification.requestPermission().then((permission) => {
        if (permission === 'granted') new Notification(title, { body });
      });
    }
  } catch (error) {
    console.error('TaskPro: system notification failed', error);
  }
}
