import { newPomodoro, pomodoroDuration, pomodoroLabels, pomodoroText } from './pomodoro';
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

    const headline = `${pomodoroText(timer, this.options.language ?? 'en')} ${labels.timerLabel}: ${formatTimerClock(timerRemainingSeconds(timer))}`.trim();
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
  const { panel, body, footer, close } = openTaskProPanel(labels.timerSettings);
  panel.addClass('taskpro-timer-panel');
  panel.setAttribute('dir', options.language === 'fa' ? 'rtl' : 'ltr');

  const minutesInput = addPanelField(body, labels.minutes, 'number');
  minutesInput.min = '1';
  minutesInput.value = String(
    options.timer
      ? Math.max(1, options.timer.pomodoro?.focusMinutes ?? Math.round(options.timer.durationSeconds / 60))
      : (options.defaultMinutes ?? 25)
  );

  const pLabels = pomodoroLabels(options.language);
  const defaults = options.timer?.pomodoro ?? newPomodoro();
  const checkbox = (text: string, checked: boolean): HTMLInputElement => {
    const label = body.createEl('label', { cls: 'taskpro-panel__field taskpro-timer-panel__toggle' });
    const input = label.createEl('input', { type: 'checkbox' });
    input.checked = checked;
    label.createSpan({ text });
    return input;
  };
  const enabled = checkbox(pLabels.enabled, !!options.timer?.pomodoro);
  const cycleFields = body.createDiv({ cls: 'taskpro-timer-panel__cycle' });
  const numberField = (text: string, value: number) => {
    const input = addPanelField(cycleFields, text, 'number');
    input.min = '1'; input.max = '1440'; input.step = '1'; input.value = String(value);
    return input;
  };
  const short = numberField(pLabels.short, defaults.shortBreakMinutes);
  const long = numberField(pLabels.long, defaults.longBreakMinutes);
  const every = numberField(pLabels.every, defaults.longBreakEvery);
  const target = numberField(pLabels.target, defaults.targetRounds);
  const autoLabel = cycleFields.createEl('label', { cls: 'taskpro-panel__field taskpro-timer-panel__toggle' });
  const auto = autoLabel.createEl('input', { type: 'checkbox' });
  auto.checked = defaults.autoStart;
  autoLabel.createSpan({ text: pLabels.auto });
  cycleFields.hidden = !enabled.checked;
  enabled.addEventListener('change', () => { cycleFields.hidden = !enabled.checked; });
  minutesInput.max = '1440'; minutesInput.step = '1';

  addPanelButtonRow(footer, {
    cancelLabel: labels.cancel,
    saveLabel: labels.save,
    onCancel: close,
    onSave: () => {
      const minutes = Number(minutesInput.value);
      if (!Number.isInteger(minutes) || minutes <= 0 || minutes > 1440) {
        new Notice(labels.invalidMinutes);
        return;
      }
      const existing = options.timer;
      const values = [short, long, every, target].map((input) => Number(input.value));
      if (enabled.checked && values.some((n) => !Number.isInteger(n) || n < 1 || n > 1440)) {
        new Notice(pLabels.invalid);
        return;
      }
      const pomodoro = enabled.checked ? {
        ...defaults, focusMinutes: minutes, shortBreakMinutes: values[0],
        longBreakMinutes: values[1], longBreakEvery: values[2], targetRounds: values[3], autoStart: auto.checked,
      } : undefined;
      // A changed cycle starts fresh; saving unchanged settings preserves a running phase.
      const cycleChanged = JSON.stringify(existing?.pomodoro) !== JSON.stringify(pomodoro);
      if (pomodoro && cycleChanged) {
        pomodoro.phase = 'focus'; pomodoro.completedRounds = 0;
      }
      options.onSave({
        ...existing,
        enabled: true,
        pomodoro,
        durationSeconds: pomodoro ? (cycleChanged ? pomodoroDuration(pomodoro) : existing!.durationSeconds) : minutes * 60,
        elapsedSeconds: cycleChanged ? 0 : existing?.elapsedSeconds ?? 0,
        runningSince: cycleChanged ? 0 : existing?.runningSince ?? 0,
        completedAt: cycleChanged || !pomodoro ? undefined : existing?.completedAt,
        notifiedAt: cycleChanged || !pomodoro ? undefined : existing?.notifiedAt,
      });
      close();
    },
  });

  minutesInput.focus();
  minutesInput.select();
}
