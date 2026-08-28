// ── reminders/reminder-service.ts ──────────────────────────────────────
// Scheduler for daily / periodic task reminders.
//
// Design notes:
// - A single low-frequency ticker (one timer for the whole plugin) checks
//   whether an alert is due. This survives laptop sleep far better than
//   `setTimeout(nextOccurrence)` and costs almost nothing.
// - Fired daily slots are persisted so a restart cannot replay the same alert,
//   and a missed slot is not silently skipped while Obsidian was closed on the
//   same day.
// - Scanning only happens when an alert is actually due, never on every tick.
// ─────────────────────────────────────────────────────────────────────────────

import { App, MarkdownView, Notice, Plugin, TFile } from 'obsidian';
import { Language, ReminderIntervalUnit, ReminderSettings, ReminderState, TaskProSettings } from '../types';
import { collectReminderTasks, ReminderTask } from './reminder-scanner';
import { TaskCreationRegistry } from '../task-registry';
import { ReminderOverlay } from './reminder-overlay';
import { ReminderSoundPlayer } from './reminder-sound';
import { getReminderLabels } from './reminder-localization';

/** How often the scheduler wakes up. Coarse on purpose: alerts are minute-grained. */
const TICK_INTERVAL_MS = 20_000;
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

export interface ReminderServiceHost {
  app: App;
  plugin: Plugin;
  getSettings: () => TaskProSettings;
  saveSettings: () => Promise<void>;
  /** Hidden creation-time index, used by the "created within N days" filter. */
  getTaskRegistry?: () => TaskCreationRegistry | undefined;
}

/** Minutes since midnight, or null when the value is not a valid "HH:mm". */
function parseTimeOfDay(value: string): number | null {
  const match = TIME_PATTERN.exec(value.trim());
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function minutesSinceMidnight(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}

function toDateKey(date: Date): string {
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

export class ReminderService {
  private intervalId: number | null = null;
  private overlay: ReminderOverlay | null = null;
  private readonly sound: ReminderSoundPlayer;
  private snoozeUntil = 0;
  private isFiring = false;

  constructor(private readonly host: ReminderServiceHost) {
    this.sound = new ReminderSoundPlayer(host.app);
  }

  /** Starts (or restarts) the ticker. Safe to call repeatedly. */
  start(): void {
    this.stopTicker();
    if (!this.settings.enabled) return;

    // registerInterval ties the timer to the plugin lifecycle, so unloading the
    // plugin can never leave a stray timer behind.
    this.intervalId = window.setInterval(() => {
      void this.tick();
    }, TICK_INTERVAL_MS);
    this.host.plugin.registerInterval(this.intervalId);
  }

  /** Full teardown: timer, overlay and audio. */
  stop(): void {
    this.stopTicker();
    this.sound.stop();
    this.overlay?.close();
    this.overlay = null;
  }

  /**
   * Plays the configured reminder sound once, for callers outside the reminder
   * schedule (a focus timer running out). Never loops, so a timer chime cannot
   * keep sounding with no alert on screen to acknowledge.
   */
  playTimerSound(): void {
    const result = this.sound.play({ ...this.settings, soundRepeat: false });
    if (!result.ok) console.error('TaskPro: timer sound failed', result.reason);
  }

  /** Call after the user edits reminder settings. */
  refresh(): void {
    this.snoozeUntil = 0;
    this.start();
  }

  /** Manual trigger (command palette). Ignores schedule, snooze and quiet hours. */
  async triggerNow(): Promise<void> {
    await this.fire({ respectEmpty: false });
  }

  private get settings(): ReminderSettings {
    return this.host.getSettings().reminders;
  }

  private get language(): Language {
    return this.host.getSettings().badgeLanguage;
  }

  /**
   * Returns the file owned by the active Markdown view. Do not use
   * workspace.getActiveFile() here: focus inside a transcluded `![[note]]`
   * can make that API report the embedded source note instead of its parent.
   */
  private getActiveOwnerNotePath(): string | undefined {
    return this.host.app.workspace.getActiveViewOfType(MarkdownView)?.file?.path;
  }

  private stopTicker(): void {
    if (this.intervalId !== null) {
      window.clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  private async tick(): Promise<void> {
    const settings = this.settings;
    if (!settings.enabled) {
      this.stopTicker();
      return;
    }

    const now = new Date();
    if (this.overlay?.isOpen) return;
    if (this.isFiring) return;
    if (now.getTime() < this.snoozeUntil) return;
    if (this.isQuietHour(now, settings)) return;

    const dueSlot = this.findDueDailySlot(now, settings);
    const globalRepeatDue = this.isRepeatDue(now, settings);
    const dueNotePaths = this.findDueNotePaths(now, settings);

    if (!dueSlot && !globalRepeatDue && dueNotePaths.length === 0) return;

    const pathsToScan = [...dueNotePaths];
    if (dueSlot || globalRepeatDue) {
      const activePath = this.getActiveOwnerNotePath();
      if (activePath) pathsToScan.push(activePath);
    }

    if (dueSlot) await this.markDailySlotFired(now, dueSlot);
    if (dueNotePaths.length > 0) await this.markNoteIntervalsFired(now, dueNotePaths);
    await this.fire({ respectEmpty: true, paths: Array.from(new Set(pathsToScan)) });
  }

  private isQuietHour(now: Date, settings: ReminderSettings): boolean {
    if (!settings.quietHoursEnabled) return false;

    const start = parseTimeOfDay(settings.quietHoursStart);
    const end = parseTimeOfDay(settings.quietHoursEnd);
    if (start === null || end === null || start === end) return false;

    const current = minutesSinceMidnight(now);
    // Ranges that wrap past midnight (e.g. 23:00 → 07:00).
    return start < end ? current >= start && current < end : current >= start || current < end;
  }

  /**
   * Returns the daily slot that should fire now: the latest slot already
   * reached today that has not fired yet. Catching up on a missed slot is
   * intentional — Obsidian may have been closed at the exact minute.
   */
  private findDueDailySlot(now: Date, settings: ReminderSettings): string | null {
    const dateKey = toDateKey(now);
    const fired = new Set(this.host.getSettings().reminderState?.firedDailyKeys ?? []);
    const current = minutesSinceMidnight(now);

    let due: { time: string; minutes: number } | null = null;
    for (const rawTime of settings.dailyTimes) {
      const minutes = parseTimeOfDay(rawTime);
      if (minutes === null) continue; // Invalid entries are ignored, not crashed on.
      if (minutes > current) continue;
      if (fired.has(`${dateKey} ${rawTime.trim()}`)) continue;
      if (!due || minutes > due.minutes) due = { time: rawTime.trim(), minutes };
    }

    return due?.time ?? null;
  }

  private async markDailySlotFired(now: Date, time: string): Promise<void> {
    const settings = this.host.getSettings();
    const dateKey = toDateKey(now);
    const previous = settings.reminderState?.firedDailyKeys ?? [];

    const state: ReminderState = {
      ...settings.reminderState,
      lastFiredAt: now.getTime(),
      // Only today's keys are kept, so this list can never grow unbounded.
      firedDailyKeys: [...previous.filter((key) => key.startsWith(dateKey)), `${dateKey} ${time}`],
    };

    settings.reminderState = state;
    await this.host.saveSettings();
  }

  private isRepeatDue(now: Date, settings: ReminderSettings): boolean {
    if (!settings.repeatEnabled) return false;

    const intervalMinutes = Math.max(5, settings.repeatIntervalMinutes);
    const lastFiredAt = this.host.getSettings().reminderState?.lastFiredAt ?? 0;
    return now.getTime() - lastFiredAt >= intervalMinutes * 60_000;
  }

  private intervalMs(every: number, unit: ReminderIntervalUnit): number {
    const amount = Math.max(1, Math.floor(every || 1));
    const multipliers: Record<ReminderIntervalUnit, number> = {
      minutes: 60_000,
      hours: 3_600_000,
      days: 86_400_000,
      weeks: 604_800_000,
    };
    return amount * multipliers[unit];
  }

  private findDueNotePaths(now: Date, settings: ReminderSettings): string[] {
    const lastByPath = this.host.getSettings().reminderState?.noteLastFiredAt ?? {};
    return (settings.notePaths ?? []).filter((path) => {
      const schedule = settings.noteSchedules?.[path];
      if (!schedule?.enabled) return false;
      const last = lastByPath[path] ?? 0;
      return now.getTime() - last >= this.intervalMs(schedule.every, schedule.unit);
    });
  }

  private async markNoteIntervalsFired(now: Date, paths: string[]): Promise<void> {
    const allSettings = this.host.getSettings();
    const previous = allSettings.reminderState?.noteLastFiredAt ?? {};
    const next = { ...previous };
    for (const path of paths) next[path] = now.getTime();
    allSettings.reminderState = { ...allSettings.reminderState, noteLastFiredAt: next };
    await this.host.saveSettings();
  }

  /** Scans, then shows the alert in the configured strictness mode. */
  private async fire(options: { respectEmpty: boolean; paths?: string[] }): Promise<void> {
    if (this.isFiring || this.overlay?.isOpen) return;
    this.isFiring = true;

    const settings = this.settings;
    const labels = getReminderLabels(this.language);

    try {
      const { tasks, failedFiles } = await collectReminderTasks(
        this.host.app,
        settings,
        this.getActiveOwnerNotePath(),
        this.host.getTaskRegistry?.(),
        options.paths
      );

      if (tasks.length === 0) {
        // Scheduled runs stay silent when there is nothing to nag about;
        // a manual run always gives feedback.
        if (!options.respectEmpty) new Notice(labels.nothingToRemind);
        await this.recordFireTime();
        return;
      }

      await this.recordFireTime();

      if (settings.systemNotification) {
        this.showSystemNotification(tasks.length);
      }

      if (settings.strictness === 'gentle') {
        // Gentle mode never steals focus — an in-app notice is enough.
        new Notice(
          `${labels.overlayTitle}: ${labels.defaultMessage(tasks.length)}`,
          Math.max(5, settings.autoDismissSeconds) * 1000
        );
        this.playSound(labels.soundUnavailable);
        return;
      }

      this.showOverlay(tasks, failedFiles.length > 0);
      this.playSound(labels.soundUnavailable);
    } catch (error) {
      console.error('TaskPro: reminder run failed', error);
      new Notice(labels.scanFailed);
    } finally {
      this.isFiring = false;
    }
  }

  private async recordFireTime(): Promise<void> {
    const settings = this.host.getSettings();
    settings.reminderState = { ...settings.reminderState, lastFiredAt: Date.now() };
    await this.host.saveSettings();
  }

  private playSound(failureMessage: string): void {
    const result = this.sound.play(this.settings);
    if (!result.ok) new Notice(failureMessage);
  }

  private showSystemNotification(count: number): void {
    // Desktop only, and only when the user already granted permission.
    if (typeof Notification === 'undefined') return;
    const labels = getReminderLabels(this.language);

    try {
      if (Notification.permission === 'granted') {
        new Notification(labels.overlayTitle, { body: labels.defaultMessage(count) });
      } else if (Notification.permission === 'default') {
        void Notification.requestPermission();
      }
    } catch (error) {
      console.error('TaskPro: system notification failed', error);
    }
  }

  private showOverlay(tasks: ReminderTask[], hadScanErrors: boolean): void {
    const settings = this.settings;

    this.overlay = new ReminderOverlay({
      settings,
      language: this.language,
      tasks,
      hadScanErrors,
      onOpenTask: (task) => {
        void this.openTask(task);
      },
      onSnooze: () => {
        this.snoozeUntil = Date.now() + Math.max(1, settings.snoozeMinutes) * 60_000;
        new Notice(getReminderLabels(this.language).snoozed(settings.snoozeMinutes));
      },
      onDismiss: () => {
        this.sound.stop();
        this.overlay = null;
      },
    });

    this.overlay.show();
  }

  private async openTask(task: ReminderTask): Promise<void> {
    const file = this.host.app.vault.getAbstractFileByPath(task.filePath);
    if (!(file instanceof TFile)) {
      new Notice(`TaskPro: ${task.filePath}`);
      return;
    }

    const leaf = this.host.app.workspace.getLeaf(false);
    await leaf.openFile(file, { active: true });

    const view = this.host.app.workspace.getActiveViewOfType(MarkdownView);
    if (view) {
      view.editor.setCursor({ line: task.lineNumber, ch: 0 });
      view.editor.scrollIntoView(
        { from: { line: task.lineNumber, ch: 0 }, to: { line: task.lineNumber, ch: 0 } },
        true
      );
    }
  }
}
