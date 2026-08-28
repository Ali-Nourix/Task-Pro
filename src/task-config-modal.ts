// ── task-config-modal.ts ──────────────────────────────────────────────────
// Modal for configuring task details before insertion
// ─────────────────────────────────────────────────────────────────────────────

import { App, Modal, Setting, Editor } from 'obsidian';
import { ParsedTask, GlobalInternalTask } from './types';
import { pickDateWithCalendar, isCalendarPluginAvailable } from './calendar-integration';

interface TaskConfigOptions {
  task: ParsedTask | GlobalInternalTask;
  isGlobal: boolean;
  sourceFile?: string;
  editor: Editor;
  onImport: (config: { deadline?: string; linked: boolean }) => void;
  allowLinkToggle?: boolean;
  calendarSystem?: 'gregorian' | 'jalali';
}

export class TaskConfigModal extends Modal {
  private deadline: string = '';
  private linked: boolean = true;
  private options: TaskConfigOptions;

  constructor(app: App, options: TaskConfigOptions) {
    super(app);
    this.options = options;

    if ('deadline' in options.task && options.task.deadline) {
      this.deadline = options.task.deadline;
    }
  }

  onOpen() {
    const { contentEl, modalEl } = this;
    contentEl.empty();
    modalEl.addClass('taskpro-config-modal');

    contentEl.createEl('h2', { text: 'Configure Task', cls: 'taskpro-config-modal__title' });

    const preview = contentEl.createDiv({ cls: 'taskpro-config-modal__preview' });
    preview.createEl('span', { text: 'Task', cls: 'taskpro-config-modal__preview-label' });
    preview.createEl('span', { text: this.getTaskDisplayText(), cls: 'taskpro-config-modal__preview-text' });

    if (this.options.allowLinkToggle && !this.options.isGlobal) {
      new Setting(contentEl)
        .setName('Sync with source')
        .setDesc('Keep this task synced with the source note')
        .addToggle((toggle) =>
          toggle.setValue(this.linked).onChange((value) => {
            this.linked = value;
          })
        );
    }

    // Deadline setting with Calendar plugin integration
    new Setting(contentEl)
      .setName('Deadline (optional)')
      .setDesc('Click the calendar button to pick a date, or leave empty')
      .addButton((button) => {
        button
          .setButtonText('📅')
          .setTooltip('Open calendar picker')
          .onClick(async () => {
            // Try to use Calendar plugin
            if (isCalendarPluginAvailable(this.app)) {
              try {
                const selectedDate = await pickDateWithCalendar(this.app, {
                  calendarSystem: this.options.calendarSystem || 'gregorian',
                  initialDate: this.deadline,
                  title: 'Select Deadline',
                });

                if (selectedDate) {
                  this.deadline = selectedDate;
                  // Update the text input if it exists
                  const dateInput = contentEl.querySelector('.taskpro-config-modal__date-input') as HTMLInputElement;
                  if (dateInput) {
                    dateInput.value = selectedDate;
                  }
                }
              } catch (error) {
                console.warn('TaskPro: Calendar plugin failed:', error);
              }
            }
          });
      })
      .addText((text) => {
        // Use date input as fallback or when Calendar plugin is not available
        if (isCalendarPluginAvailable(this.app)) {
          text.setPlaceholder('YYYY-MM-DD or use calendar button');
          text.setValue(this.deadline);
          text.inputEl.classList.add('taskpro-config-modal__date-input');
          text.onChange((value) => {
            this.deadline = value.trim();
          });
        } else {
          text.inputEl.type = 'date';
          text.setValue(this.deadline);
          text.inputEl.classList.add('taskpro-config-modal__date-input');
          text.onChange((value) => {
            this.deadline = value.trim();
          });
        }
      });

    const footer = contentEl.createDiv({ cls: 'taskpro-config-modal__footer' });
    footer.createEl('button', { text: 'Cancel', cls: 'taskpro-panel__btn taskpro-panel__btn--secondary' }).addEventListener('click', () => this.close());
    footer
      .createEl('button', { text: 'Insert Task', cls: 'taskpro-panel__btn taskpro-panel__btn--primary mod-cta' })
      .addEventListener('click', () => {
        this.options.onImport({
          deadline: this.deadline || undefined,
          linked: this.linked,
        });
        this.close();
      });
  }

  private getTaskDisplayText(): string {
    const task = this.options.task;
    if ('lineNumber' in task) {
      return (task as ParsedTask).content;
    }
    return (task as GlobalInternalTask).content;
  }

  onClose() {
    const { contentEl, modalEl } = this;
    contentEl.empty();
    modalEl.removeClass('taskpro-config-modal');
  }
}
