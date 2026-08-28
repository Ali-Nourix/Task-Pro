// ── timer-popover.ts ──────────────────────────────────────────────────────
// Menu for the focus-timer chip, matching the progress popover's shape.
// ─────────────────────────────────────────────────────────────────────────────

import { App, Menu, Notice } from 'obsidian';
import {
  Language,
  TaskTimer,
  formatTimerClock,
  timerRemainingSeconds,
  timerSpentSeconds,
  timerState,
} from './types';
import { getTimerLabels } from './timer-localization';
import { addPanelButtonRow, addPanelField, openTaskProPanel } from './ui/panel';
import { styleTaskProMenu } from './ui/menu-styling';

export interface TimerPopoverOptions {
  app: App;
  targetElement: HTMLElement;
  timer: TaskTimer;
  language?: Language;
  onStart: () => void | Promise<void>;
  onPause: () => void | Promise<void>;
  onReset: () => void | Promise<void>;
  onExtend: (minutes: number) => void | Promise<void>;
  onChange: (timer: TaskTimer | null) => void | Promise<void>;
}

export class TaskTimerPopover {
  private readonly menu = new Menu();
  private readonly infoMenuTitles: string[] = [];

  constructor(private readonly options: TimerPopoverOptions) {
    this.buildMenu();
  }

  private buildMenu(): void {
    const { timer } = this.options;
    const labels = getTimerLabels(this.options.language ?? 'en');
    const state = timerState(timer);

    const headline = `${labels.timerLabel}: ${formatTimerClock(timerRemainingSeconds(timer))}`;
    this.infoMenuTitles.push(headline);
    this.menu.addItem((item) => item.setTitle(headline).setIcon('timer').setDisabled(true));

    const spent = labels.spent(formatTimerClock(timerSpentSeconds(timer)));
    this.infoMenuTitles.push(spent);
    this.menu.addItem((item) => item.setTitle(spent).setIcon('hourglass').setDisabled(true));

    this.menu.addSeparator();

    if (state === 'running') {
      this.menu.addItem((item) =>
        item.setTitle(labels.pause).setIcon('pause').onClick(() => void this.options.onPause())
      );
    } else {
      this.menu.addItem((item) =>
        item
          .setTitle(state === 'paused' ? labels.resume : labels.start)
          .setIcon('play')
          .onClick(() => void this.options.onStart())
      );
    }

    for (const minutes of [5, 15]) {
      this.menu.addItem((item) =>
        item
          .setTitle(labels.extend(minutes))
          .setIcon('plus')
          .onClick(() => void this.options.onExtend(minutes))
      );
    }

    this.menu.addItem((item) =>
      item
        .setTitle(labels.reset)
        .setIcon('rotate-ccw')
        .setDisabled(state === 'idle')
        .onClick(() => void this.options.onReset())
    );

    this.menu.addSeparator();

    this.menu.addItem((item) =>
      item.setTitle(labels.changeDuration).setIcon('settings').onClick(() => this.showEditor())
    );

    this.menu.addItem((item) =>
      item
        .setTitle(labels.removeTimer)
        .setIcon('trash-2')
        .onClick(() => {
          void this.options.onChange(null);
          new Notice(labels.timerRemoved);
        })
    );
  }

  private showEditor(): void {
    const labels = getTimerLabels(this.options.language ?? 'en');
    showTimerEditor({
      language: this.options.language ?? 'en',
      timer: this.options.timer,
      onSave: (timer) => {
        void this.options.onChange(timer);
        new Notice(labels.timerUpdated(formatTimerClock(timer.durationSeconds)));
      },
    });
  }

  show(): void {
    const rect = this.options.targetElement.getBoundingClientRect();
    this.menu.showAtPosition({ x: rect.left, y: rect.bottom });
    styleTaskProMenu(this.infoMenuTitles);
  }
}

/**
 * Duration picker, shared by the chip menu and the "add capability" row on the
 * task popover so a timer is set up the same way wherever it is started.
 */
export function showTimerEditor(options: {
  language: Language;
  timer?: TaskTimer;
  defaultMinutes?: number;
  onSave: (timer: TaskTimer) => void;
}): void {
  const labels = getTimerLabels(options.language);
  const { body, footer, close } = openTaskProPanel(labels.timerSettings);

  const minutesInput = addPanelField(body, labels.minutes, 'number');
  minutesInput.min = '1';
  minutesInput.value = String(
    options.timer
      ? Math.max(1, Math.round(options.timer.durationSeconds / 60))
      : (options.defaultMinutes ?? 25)
  );

  addPanelButtonRow(footer, {
    cancelLabel: labels.cancel,
    saveLabel: labels.save,
    onCancel: close,
    onSave: () => {
      const minutes = parseInt(minutesInput.value, 10);
      if (!Number.isFinite(minutes) || minutes <= 0) {
        new Notice(labels.invalidMinutes);
        return;
      }
      const existing = options.timer;
      options.onSave({
        enabled: true,
        durationSeconds: minutes * 60,
        // Changing the duration keeps time already spent, so extending a timer
        // mid-session does not reset progress toward it.
        elapsedSeconds: existing?.elapsedSeconds ?? 0,
        runningSince: existing?.runningSince ?? 0,
        completedAt: undefined,
        notifiedAt: undefined,
      });
      close();
    },
  });

  minutesInput.focus();
  minutesInput.select();
}
