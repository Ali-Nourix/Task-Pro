// ── task-popover.ts ───────────────────────────────────────────────────────
// Interactive popover for task management
// ─────────────────────────────────────────────────────────────────────────────

import { App, Menu, Notice } from 'obsidian';
import {
  TaskMapping,
  TaskStatus,
  Language,
  STATUS_LABELS,
  TaskProgress,
  TaskPriority,
  TASK_PRIORITIES,
  PRIORITY_ICON_NAMES,
  PRIORITY_LABELS,
} from './types';
import { jalaliToGregorian, gregorianToJalali } from './date-utils';
import { pickDateWithCalendar, isCalendarPluginAvailable } from './calendar-integration';
import { addPanelButtonRow, addPanelField, openTaskProPanel } from './ui/panel';
import { styleTaskProMenu } from './ui/menu-styling';

export interface PopoverOptions {
  app: App;
  targetElement: HTMLElement;
  taskMapping?: TaskMapping;
  showSourceLink?: boolean;
  deadline?: string;
  status: TaskStatus;
  language?: Language;
  blockId?: string;
  tags?: string[];
  progress?: TaskProgress;
  priority?: TaskPriority;
  onToggleSync?: (enabled: boolean) => void;
  onPriorityChange?: (priority: TaskPriority | null) => void;
  onStatusChange?: (newStatus: TaskStatus) => void;
  onDeadlineChange?: (deadline: string | null) => void;
  onProgressChange?: (progress: TaskProgress | null) => void;
  calendarSystem?: 'gregorian' | 'jalali';
}

export class TaskPopover {
  private menu: Menu;
  private options: PopoverOptions;
  private infoMenuTitles: string[] = [];

  constructor(options: PopoverOptions) {
    this.options = options;
    this.menu = new Menu();
    this.buildMenu();
  }

  private buildMenu() {
    const { taskMapping, deadline, status, blockId, tags, progress, priority, showSourceLink = false } = this.options;
    const language = this.options.language || 'en';
    const labels = this.getLabels(language);
    this.infoMenuTitles = [];

    // Status header
    const statusLabel = this.getStatusLabel(status);
    const statusTitle = `${labels.statusLabel}: ${statusLabel}`;
    this.infoMenuTitles.push(statusTitle);
    this.menu.addItem((item) => {
      item.setTitle(statusTitle).setIcon(this.getStatusIcon(status)).setDisabled(true);
    });

   this.menu.addSeparator();

    // Priority section — always available, since every task can be prioritized
    if (this.options.onPriorityChange) {
      const priorityTitle = priority
        ? `${labels.priorityLabel}: ${PRIORITY_LABELS[language][priority]}`
        : `${labels.priorityLabel}: ${labels.noPriority}`;
      this.infoMenuTitles.push(priorityTitle);
      this.menu.addItem((item) => {
        item
          .setTitle(priorityTitle)
          .setIcon(priority ? PRIORITY_ICON_NAMES[priority] : 'flag')
          .setDisabled(true);
      });

      for (const level of TASK_PRIORITIES) {
        this.menu.addItem((item) => {
          const isCurrent = priority === level;
          item
            .setTitle(`  ${PRIORITY_LABELS[language][level]}`)
            .setIcon(isCurrent ? 'check' : PRIORITY_ICON_NAMES[level])
            .onClick(async () => {
              if (isCurrent) return; // No-op: avoid a pointless file write
              await this.options.onPriorityChange?.(level);
              new Notice(`${labels.priorityUpdated} ${PRIORITY_LABELS[language][level]}`);
            });
        });
      }

      if (priority) {
        this.menu.addItem((item) => {
          item
            .setTitle(`  ${labels.clearPriority}`)
            .setIcon('trash-2')
            .onClick(async () => {
              await this.options.onPriorityChange?.(null);
              new Notice(labels.priorityCleared);
            });
        });
      }

      this.menu.addSeparator();
    }

    // Progress Bar section (if enabled, show controls)
   if (progress && progress.enabled) {
      this.menu.addItem((item) => {
        item
          .setTitle(labels.changeProgressBar)
          .setIcon('edit')
          .onClick(() => {
            this.showProgressEditor(progress);
          });
      });
      
      // Disable progress bar
      this.menu.addItem((item) => {
        item
          .setTitle(labels.disableProgressBar)
          .setIcon('x')
          .onClick(() => {
            if (this.options.onProgressChange) {
              this.options.onProgressChange(null);
            }
            new Notice(labels.progressBarDisabled);
          });
      });
      
      this.menu.addSeparator();
    }

    // Deadline section
    if (deadline) {
      const remainingTime = this.calculateRemainingTime(deadline, status);
      // The row already carries a clock icon; the emoji only duplicated it.
      const deadlineInfoTitle = remainingTime;
      this.infoMenuTitles.push(deadlineInfoTitle);
      this.menu.addItem((item) => {
        item.setTitle(deadlineInfoTitle).setIcon('clock').setDisabled(true);
      });
    }

    // Set/Change deadline
    this.menu.addItem((item) => {
      item
        .setTitle(deadline ? labels.changeDeadline : labels.setDeadline)
        .setIcon('calendar-plus')
        .onClick(() => {
          this.showDeadlinePicker();
        });
    });

    if (deadline) {
      this.menu.addItem((item) => {
        item
          .setTitle(labels.clear)
          .setIcon('trash-2')
          .onClick(async () => {
            if (this.options.onDeadlineChange) {
              await this.options.onDeadlineChange(null);
              new Notice(labels.deadlineCleared);
            }
          });
      });
    }

    this.menu.addSeparator();

    // Add Capability section
    if (!progress || !progress.enabled) {
      this.infoMenuTitles.push(labels.addCapability);
      this.menu.addItem((item) => {
        item.setTitle(labels.addCapability).setIcon('plus-circle').setDisabled(true);
      });
      
      this.menu.addItem((item) => {
        item
          .setTitle(`  ${labels.enableProgressBar}`)
          .setIcon('bar-chart-2')
          .onClick(() => {
            this.showProgressEditor(progress);
          });
      });
      
      this.menu.addSeparator();
    }

    // Link toggle
    if (taskMapping) {
      const syncEnabled = taskMapping.linked !== false;
      this.menu.addItem((item) => {
        item
          .setTitle(syncEnabled ? labels.disableSync : labels.enableSync)
          .setIcon(syncEnabled ? 'link' : 'unlink')
          .onClick(() => {
            const newState = !syncEnabled;
            if (this.options.onToggleSync) {
              this.options.onToggleSync(newState);
            }
            new Notice(newState ? labels.syncEnabled : labels.syncDisabled);
          });
      });

      // Show source file info only on imported task instance
      if (showSourceLink) {
        const linkedTitle = `${labels.linkedTo} ${this.getFileName(taskMapping.sourceFilePath)}`;
        this.infoMenuTitles.push(linkedTitle);
        this.menu.addSeparator();
        this.menu.addItem((item) => {
          item.setTitle(linkedTitle).setIcon('file-text').setDisabled(true);
        });
      }
    }

    if (tags && tags.length > 0) {
      const tagsTitle = `${labels.tags} ${tags.map((t) => `#${t}`).join(', ')}`;
      this.infoMenuTitles.push(tagsTitle);
      this.menu.addSeparator();
      this.menu.addItem((item) => {
        item.setTitle(tagsTitle).setIcon('tag').setDisabled(true);
      });
    }

    // Block ID at the very bottom (metadata info only)
    if (blockId) {
      const blockIdTitle = `${labels.blockId} ${blockId}`;
      this.infoMenuTitles.push(blockIdTitle);
      this.menu.addSeparator();
      this.menu.addItem((item) => {
        item.setTitle(blockIdTitle).setIcon('hash').setDisabled(true);
      });
    }
  }

 private getStatusLabel(status: TaskStatus): string {
    return STATUS_LABELS[this.options.language || 'en'][status];
  }

  private getStatusIcon(status: TaskStatus): string {
    switch (status) {
      case '[ ]':
        return 'circle';
      case '[/]':
        return 'loader';
      case '[x]':
        return 'check-circle';
      case '[!]':
        return 'x-circle';
      default:
        return 'help-circle';
    }
  }

  private async showDeadlinePicker() {
    const labels = this.getLabels(this.options.language || 'en');
    
    // Try to use Calendar plugin first
    if (isCalendarPluginAvailable(this.options.app)) {
      try {
        const selectedDate = await pickDateWithCalendar(this.options.app, {
          calendarSystem: this.options.calendarSystem || 'gregorian',
          initialDate: this.options.deadline,
          title: this.options.deadline ? labels.changeDeadline : labels.setDeadline,
          language: this.options.language,
        });

        // User cancelled
        if (selectedDate === null) {
          return;
        }

        // User selected a date
        if (selectedDate && this.options.onDeadlineChange) {
          await this.options.onDeadlineChange(selectedDate);
          new Notice(`${labels.deadlineUpdated} ${selectedDate}`);
        }
        return;
      } catch (error) {
        console.warn('TaskPro: Calendar plugin failed, falling back to native input:', error);
        // Fall through to native input
      }
    }

    // Fallback to native input if Calendar plugin is not available
    this.showNativeDeadlinePicker();
  }

  /**
   * Native deadline picker (fallback when Calendar plugin is not available)
   */
  private showNativeDeadlinePicker() {
    const labels = this.getLabels(this.options.language || 'en');
    const { body, footer, close } = openTaskProPanel(labels.setDeadline);

    let useJalali = this.options.calendarSystem === 'jalali';

    if (this.options.calendarSystem === 'jalali') {
      const calendarToggle = body.createDiv({ cls: 'taskpro-panel__toggle-row' });

      const jalaliBtn = calendarToggle.createEl('button', { text: labels.jalali, cls: useJalali ? 'mod-cta' : '' });
      const gregorianBtn = calendarToggle.createEl('button', { text: labels.gregorian, cls: !useJalali ? 'mod-cta' : '' });

      jalaliBtn.addEventListener('click', () => {
        useJalali = true;
        jalaliBtn.addClass('mod-cta');
        gregorianBtn.removeClass('mod-cta');
        input.type = 'text';
        input.placeholder = labels.jalaliPlaceholder;
      });

      gregorianBtn.addEventListener('click', () => {
        useJalali = false;
        gregorianBtn.addClass('mod-cta');
        jalaliBtn.removeClass('mod-cta');
        input.type = 'date';
        input.placeholder = '';
      });
    }

    const input = addPanelField(body, labels.setDeadline, useJalali ? 'text' : 'date');
    input.classList.add('taskpro-panel__input--date');
    if (useJalali) {
      input.placeholder = labels.jalaliPlaceholder;
    }

    if (this.options.deadline) {
      if (useJalali) {
        const [y, m, d] = this.options.deadline.split('-').map(Number);
        const [jy, jm, jd] = gregorianToJalali(y, m, d);
        input.value = `${jy}/${String(jm).padStart(2, '0')}/${String(jd).padStart(2, '0')}`;
      } else {
        input.value = this.options.deadline;
      }
    }

    addPanelButtonRow(footer, {
      cancelLabel: labels.cancel,
      saveLabel: labels.save,
      clearLabel: this.options.deadline ? labels.clear : undefined,
      onCancel: close,
      onClear: this.options.deadline
        ? async () => {
            if (this.options.onDeadlineChange) {
              await this.options.onDeadlineChange(null);
              new Notice(labels.deadlineCleared);
            }
            close();
          }
        : undefined,
      onSave: async () => {
        if (input.value && this.options.onDeadlineChange) {
          let gregorianDate = input.value;
          if (useJalali) {
            const jalaliMatch = input.value.match(/(\d{4})\/(\d{1,2})\/(\d{1,2})/);
            if (jalaliMatch) {
              const [, jy, jm, jd] = jalaliMatch.map(Number);
              const [gy, gm, gd] = jalaliToGregorian(jy, jm, jd);
              gregorianDate = `${gy}-${String(gm).padStart(2, '0')}-${String(gd).padStart(2, '0')}`;
            } else {
              new Notice(labels.invalidJalali);
              return;
            }
          }
          await this.options.onDeadlineChange(gregorianDate);
          new Notice(`${labels.deadlineUpdated} ${gregorianDate}`);
        }
        close();
      },
    });

    input.focus();
  }

  private showProgressEditor(currentProgress?: TaskProgress) {
    const labels = this.getLabels(this.options.language || 'en');
    const { body, footer, close } = openTaskProPanel(labels.progressBarSettings);

    const totalInput = addPanelField(body, labels.totalSteps, 'number');
    totalInput.min = '1';
    totalInput.value = currentProgress?.totalSteps.toString() || '10';

    const currentInput = addPanelField(body, labels.currentSteps, 'number');
    currentInput.min = '0';
    currentInput.value = currentProgress?.currentSteps.toString() || '0';

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
        if (this.options.onProgressChange) {
          this.options.onProgressChange({ enabled: true, totalSteps, currentSteps });
        }
        new Notice(`${labels.progressBarUpdated} ${currentSteps}/${totalSteps}`);
        close();
      },
    });

    totalInput.focus();
  }

  private calculateRemainingTime(deadline: string, status: TaskStatus): string {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const deadlineDate = new Date(deadline);
    deadlineDate.setHours(0, 0, 0, 0);

    const diffTime = deadlineDate.getTime() - today.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    const labels = this.getLabels(this.options.language || 'en');

    if (diffDays < 0) {
      return status === '[x]' ? labels.completedOnTime : labels.notCompletedOnTime;
    } else if (diffDays === 0) {
      return labels.dueToday;
    } else if (diffDays === 1) {
      return labels.dueTomorrow;
    } else {
      return labels.daysRemaining(diffDays);
    }
  }

  private getFileName(path: string): string {
    const parts = path.split('/');
    return parts[parts.length - 1];
  }

  private getLabels(language: Language) {
    if (language === 'fa') {
      return {
        statusLabel: 'وضعیت',
        setDeadline: 'تعیین سررسید',
        changeDeadline: 'تغییر سررسید',
        enableSync: 'فعال‌سازی همگام‌سازی',
        disableSync: 'غیرفعال‌سازی همگام‌سازی',
        syncEnabled: '🔗 همگام‌سازی فعال شد',
        syncDisabled: '🔓 همگام‌سازی غیرفعال شد',
        linkedTo: 'متصل‌شده به:',
        tags: 'برچسب‌ها:',
        blockId: 'شناسه بلاک:',
        clear: 'حذف سررسید',
        jalali: 'جلالی',
        gregorian: 'میلادی',
        jalaliPlaceholder: 'YYYY/MM/DD (مثلا 1403/01/15)',
        cancel: 'انصراف',
        save: 'ذخیره',
        invalidJalali: 'فرمت تاریخ جلالی نامعتبر است. از YYYY/MM/DD استفاده کنید',
        deadlineUpdated: '✓ سررسید به',
        deadlineCleared: '🧹 سررسید حذف شد',
        completedOnTime: 'در زمان تعیین شده انجام شد',
        notCompletedOnTime: 'در زمان تعیین شده انجام نشد',
        dueToday: 'تا امروز',
        dueTomorrow: 'فردا',
        daysRemaining: (days: number) => `${days} روز باقی‌مانده`,
        progressBar: 'نوار پیشرفت',
        addCapability: 'افزودن قابلیت',
        enableProgressBar: 'فعال‌سازی نوار پیشرفت',
        changeProgressBar: 'تغییر نوار پیشرفت',
        disableProgressBar: 'غیرفعال‌سازی نوار پیشرفت',
        progressBarSettings: 'تنظیمات نوار پیشرفت',
        totalSteps: 'تعداد کل مراحل',
        currentSteps: 'مراحل انجام‌شده',
        progressBarUpdated: '✓ نوار پیشرفت به‌روز شد:',
        progressBarDisabled: '🧹 نوار پیشرفت غیرفعال شد',
        invalidTotalSteps: 'تعداد کل مراحل باید عددی بزرگتر از صفر باشد',
        invalidCurrentSteps: 'مراحل انجام‌شده باید بین 0 و تعداد کل مراحل باشد',
        priorityLabel: 'اولویت',
        noPriority: 'تعیین‌نشده',
        clearPriority: 'حذف اولویت',
        priorityUpdated: '✓ اولویت تغییر کرد به',
        priorityCleared: '🧹 اولویت حذف شد',
      };
    }

    return {
      statusLabel: 'Status',
      setDeadline: 'Set Deadline',
      changeDeadline: 'Change Deadline',
      enableSync: 'Enable Sync',
      disableSync: 'Disable Sync',
      syncEnabled: '🔗 Sync enabled',
      syncDisabled: '🔓 Sync disabled',
      linkedTo: 'Linked to:',
      tags: 'Tags:',
      blockId: 'Block ID:',
      clear: 'Clear Deadline',
      jalali: 'Jalali',
      gregorian: 'Gregorian',
      jalaliPlaceholder: 'YYYY/MM/DD (e.g., 1403/01/15)',
      cancel: 'Cancel',
      save: 'Save',
      invalidJalali: 'Invalid Jalali date format. Use YYYY/MM/DD',
      deadlineUpdated: '✓ Deadline set to',
      deadlineCleared: '🧹 Deadline removed',
      completedOnTime: 'Completed on time',
      notCompletedOnTime: 'Not completed on time',
      dueToday: 'Due today',
      dueTomorrow: 'Due tomorrow',
      daysRemaining: (days: number) => `${days} days remaining`,
      progressBar: 'Progress Bar',
      addCapability: 'Add Capability',
      enableProgressBar: 'Enable Progress Bar',
      changeProgressBar: 'Change Progress Bar',
      disableProgressBar: 'Disable Progress Bar',
      progressBarSettings: 'Progress Bar Settings',
      totalSteps: 'Total Steps',
      currentSteps: 'Current Steps',
      progressBarUpdated: '✓ Progress bar updated:',
      progressBarDisabled: '🧹 Progress bar disabled',
      invalidTotalSteps: 'Total steps must be a number greater than 0',
      invalidCurrentSteps: 'Current steps must be between 0 and total steps',
      priorityLabel: 'Priority',
      noPriority: 'Not set',
      clearPriority: 'Clear Priority',
      priorityUpdated: '✓ Priority set to',
      priorityCleared: '🧹 Priority removed',
    };
  }

  show() {
    this.menu.showAtMouseEvent(
      new MouseEvent('click', {
        clientX: this.options.targetElement.getBoundingClientRect().left,
        clientY: this.options.targetElement.getBoundingClientRect().bottom,
      })
    );
    styleTaskProMenu(this.infoMenuTitles);
  }
}
