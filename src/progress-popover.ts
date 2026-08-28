// ── progress-popover.ts ───────────────────────────────────────────────────
// Popover menu for progress bar widget (matches TaskPopover UX)
// ─────────────────────────────────────────────────────────────────────────────

import { App, Menu, Notice } from 'obsidian';
import { Language, TaskProgress } from './types';
import { addPanelButtonRow, addPanelField, openTaskProPanel } from './ui/panel';
import { styleTaskProMenu } from './ui/menu-styling';

export interface ProgressPopoverOptions {
  app: App;
  targetElement: HTMLElement;
  progress: TaskProgress;
  language?: Language;
  onProgressChange: (progress: TaskProgress | null) => void | Promise<void>;
}

export class TaskProgressPopover {
  private menu: Menu;
  private options: ProgressPopoverOptions;
  private infoMenuTitle = '';

  constructor(options: ProgressPopoverOptions) {
    this.options = options;
    this.menu = new Menu();
    this.buildMenu();
  }

  private buildMenu(): void {
    const { progress } = this.options;
    const labels = this.getLabels(this.options.language || 'en');
    const percentage = Math.round((progress.currentSteps / progress.totalSteps) * 100);

    this.infoMenuTitle = `${labels.progressLabel}: ${progress.currentSteps}/${progress.totalSteps} (${percentage}%)`;
    this.menu.addItem((item) => {
      item.setTitle(this.infoMenuTitle).setIcon('bar-chart-2').setDisabled(true);
    });

    this.menu.addSeparator();

    this.menu.addItem((item) => {
      item
        .setTitle(labels.incrementStep)
        .setIcon('plus')
        .setDisabled(progress.currentSteps >= progress.totalSteps)
        .onClick(() => {
          void this.applyChange({
            ...progress,
            currentSteps: Math.min(progress.currentSteps + 1, progress.totalSteps),
          });
        });
    });

    this.menu.addItem((item) => {
      item
        .setTitle(labels.decrementStep)
        .setIcon('minus')
        .setDisabled(progress.currentSteps <= 0)
        .onClick(() => {
          void this.applyChange({
            ...progress,
            currentSteps: Math.max(progress.currentSteps - 1, 0),
          });
        });
    });

    this.menu.addItem((item) => {
      item
        .setTitle(labels.resetProgress)
        .setIcon('rotate-ccw')
        .setDisabled(progress.currentSteps === 0)
        .onClick(() => {
          void this.applyChange({ ...progress, currentSteps: 0 });
          new Notice(labels.progressReset);
        });
    });

    this.menu.addSeparator();

    this.menu.addItem((item) => {
      item
        .setTitle(labels.editSettings)
        .setIcon('settings')
        .onClick(() => {
          this.showProgressEditor(progress);
        });
    });

    this.menu.addItem((item) => {
      item
        .setTitle(labels.disableProgressBar)
        .setIcon('trash-2')
        .onClick(() => {
          void this.applyChange(null);
          new Notice(labels.progressBarDisabled);
        });
    });
  }

  private async applyChange(newProgress: TaskProgress | null): Promise<void> {
    await this.options.onProgressChange(newProgress);
  }

  private showProgressEditor(currentProgress: TaskProgress): void {
    const labels = this.getLabels(this.options.language || 'en');
    const { body, footer, close } = openTaskProPanel(labels.progressBarSettings);

    const totalInput = addPanelField(body, labels.totalSteps, 'number');
    totalInput.min = '1';
    totalInput.value = currentProgress.totalSteps.toString();

    const currentInput = addPanelField(body, labels.currentSteps, 'number');
    currentInput.min = '0';
    currentInput.value = currentProgress.currentSteps.toString();

    totalInput.addEventListener('input', () => {
      const total = parseInt(totalInput.value, 10);
      if (!isNaN(total) && total > 0) {
        currentInput.max = total.toString();
        const current = parseInt(currentInput.value, 10);
        if (!isNaN(current) && current > total) {
          currentInput.value = total.toString();
        }
      }
    });

    addPanelButtonRow(footer, {
      cancelLabel: labels.cancel,
      saveLabel: labels.save,
      onCancel: close,
      onSave: () => {
        const totalSteps = parseInt(totalInput.value, 10);
        const currentSteps = parseInt(currentInput.value, 10);

        if (isNaN(totalSteps) || totalSteps <= 0) {
          new Notice(labels.invalidTotalSteps);
          return;
        }

        if (isNaN(currentSteps) || currentSteps < 0 || currentSteps > totalSteps) {
          new Notice(labels.invalidCurrentSteps);
          return;
        }

        void this.applyChange({ enabled: true, totalSteps, currentSteps });
        new Notice(`${labels.progressBarUpdated} ${currentSteps}/${totalSteps}`);
        close();
      },
    });

    totalInput.focus();
  }

  show(): void {
    this.menu.showAtMouseEvent(
      new MouseEvent('click', {
        clientX: this.options.targetElement.getBoundingClientRect().left,
        clientY: this.options.targetElement.getBoundingClientRect().bottom,
      })
    );
    styleTaskProMenu([this.infoMenuTitle]);
  }

  private getLabels(language: Language) {
    if (language === 'fa') {
      return {
        progressLabel: 'پیشرفت',
        incrementStep: 'افزایش یک مرحله',
        decrementStep: 'کاهش یک مرحله',
        resetProgress: 'بازنشانی پیشرفت',
        progressReset: '↺ پیشرفت بازنشانی شد',
        editSettings: 'تنظیمات نوار پیشرفت',
        disableProgressBar: 'حذف نوار پیشرفت',
        progressBarDisabled: '🧹 نوار پیشرفت حذف شد',
        progressBarSettings: 'تنظیمات نوار پیشرفت',
        totalSteps: 'تعداد کل مراحل',
        currentSteps: 'مراحل انجام‌شده',
        progressBarUpdated: '✓ نوار پیشرفت به‌روز شد:',
        invalidTotalSteps: 'تعداد کل مراحل باید عددی بزرگتر از صفر باشد',
        invalidCurrentSteps: 'مراحل انجام‌شده باید بین 0 و تعداد کل مراحل باشد',
        cancel: 'انصراف',
        save: 'ذخیره',
      };
    }

    return {
      progressLabel: 'Progress',
      incrementStep: 'Increase step',
      decrementStep: 'Decrease step',
      resetProgress: 'Reset progress',
      progressReset: '↺ Progress reset',
      editSettings: 'Edit progress settings',
      disableProgressBar: 'Remove progress bar',
      progressBarDisabled: '🧹 Progress bar removed',
      progressBarSettings: 'Progress Bar Settings',
      totalSteps: 'Total Steps',
      currentSteps: 'Current Steps',
      progressBarUpdated: '✓ Progress bar updated:',
      invalidTotalSteps: 'Total steps must be a number greater than 0',
      invalidCurrentSteps: 'Current steps must be between 0 and total steps',
      cancel: 'Cancel',
      save: 'Save',
    };
  }
}
