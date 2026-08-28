// ── reminders/reminder-overlay.ts ──────────────────────────────────────
// Full-screen reminder alert.
// Accessibility: rendered as a modal dialog with a focus trap, keyboard
// support and screen-reader labelling. Strict mode intentionally blocks Esc
// and backdrop clicks, but always leaves a reachable acknowledge button so the
// user is never actually locked out of Obsidian.
// ─────────────────────────────────────────────────────────────────────────────

import { setIcon } from 'obsidian';
import { Language, PRIORITY_ICON_NAMES, PRIORITY_LABELS, ReminderSettings } from '../types';
import { ReminderTask } from './reminder-scanner';
import { getReminderLabels, ReminderLabels } from './reminder-localization';

export interface ReminderOverlayOptions {
  settings: ReminderSettings;
  language: Language;
  tasks: ReminderTask[];
  /** True when at least one note could not be read during the scan. */
  hadScanErrors: boolean;
  onOpenTask: (task: ReminderTask) => void;
  onSnooze: () => void;
  onDismiss: () => void;
}

const FOCUSABLE_SELECTOR = 'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

export class ReminderOverlay {
  private overlay: HTMLElement | null = null;
  private countdownTimer: number | null = null;
  private autoDismissTimer: number | null = null;
  private previouslyFocused: HTMLElement | null = null;
  private closed = false;

  constructor(private readonly options: ReminderOverlayOptions) {}

  get isOpen(): boolean {
    return this.overlay !== null;
  }

  show(): void {
    if (this.overlay) return;

    const { settings, language, tasks } = this.options;
    const labels = getReminderLabels(language);
    const strict = settings.strictness === 'strict';

    this.previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const overlay = document.createElement('div');
    overlay.className = 'taskpro-reminder-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'taskpro-reminder-title');
    overlay.setAttribute('data-strictness', settings.strictness);
    if (language === 'fa') overlay.setAttribute('dir', 'rtl');

    const dialog = overlay.createDiv({ cls: 'taskpro-reminder-dialog' });

    const header = dialog.createDiv({ cls: 'taskpro-reminder-header' });
    const title = header.createEl('h2', {
      cls: 'taskpro-reminder-title',
      text: labels.overlayTitle,
    });
    title.id = 'taskpro-reminder-title';
    header.createDiv({
      cls: 'taskpro-reminder-message',
      text: this.buildMessage(labels),
    });
    if (strict) {
      header.createDiv({ cls: 'taskpro-reminder-hint', text: labels.strictHint });
    }

    this.renderTaskList(dialog, labels);

    if (this.options.hadScanErrors) {
      dialog.createDiv({ cls: 'taskpro-reminder-error', text: labels.scanFailed });
    }

    const actions = dialog.createDiv({ cls: 'taskpro-reminder-actions' });
    this.renderActions(actions, labels, strict);

    document.body.appendChild(overlay);
    this.overlay = overlay;
    document.body.classList.add('taskpro-reminder-active');

    overlay.addEventListener('mousedown', this.handleBackdropClick);
    overlay.addEventListener('keydown', this.handleKeyDown);

    // Focus the primary action so keyboard users land somewhere useful.
    const firstAction = overlay.querySelector<HTMLElement>('.taskpro-reminder-primary, ' + FOCUSABLE_SELECTOR);
    firstAction?.focus();

    if (!strict && settings.autoDismissSeconds > 0) {
      this.autoDismissTimer = window.setTimeout(() => this.close(), settings.autoDismissSeconds * 1000);
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;

    if (this.countdownTimer !== null) window.clearInterval(this.countdownTimer);
    if (this.autoDismissTimer !== null) window.clearTimeout(this.autoDismissTimer);
    this.countdownTimer = null;
    this.autoDismissTimer = null;

    if (this.overlay) {
      this.overlay.removeEventListener('mousedown', this.handleBackdropClick);
      this.overlay.removeEventListener('keydown', this.handleKeyDown);
      this.overlay.remove();
      this.overlay = null;
    }

    document.body.classList.remove('taskpro-reminder-active');
    this.previouslyFocused?.focus();
    this.options.onDismiss();
  }

  private buildMessage(labels: ReminderLabels): string {
    const { settings, tasks } = this.options;
    const template = settings.message.trim();
    if (!template) return labels.defaultMessage(tasks.length);

    const top = tasks[0]?.text ?? '';
    return template
      .replace(/\{count\}/g, String(tasks.length))
      .replace(/\{top\}/g, top)
      .replace(/\{date\}/g, new Date().toLocaleDateString());
  }

  private renderTaskList(dialog: HTMLElement, labels: ReminderLabels): void {
    const { tasks, settings, language } = this.options;

    if (tasks.length === 0) {
      dialog.createDiv({ cls: 'taskpro-reminder-empty', text: labels.noTasks });
      return;
    }

    const list = dialog.createEl('ul', { cls: 'taskpro-reminder-list' });
    const shown = tasks.slice(0, Math.max(1, settings.maxTasksShown));

    for (const task of shown) {
      const item = list.createEl('li', { cls: 'taskpro-reminder-item' });

      if (task.priority) {
        const badge = item.createSpan({ cls: 'taskpro-reminder-priority' });
        badge.setAttribute('data-priority', task.priority);
        const icon = badge.createSpan({ cls: 'taskpro-chip__icon' });
        icon.setAttribute('aria-hidden', 'true');
        setIcon(icon, PRIORITY_ICON_NAMES[task.priority]);
        badge.createSpan({ cls: 'taskpro-chip__label' }).setText(PRIORITY_LABELS[language][task.priority]);
      }

      // textContent assignment (via setText) keeps note content from being
      // interpreted as HTML.
      item.createSpan({ cls: 'taskpro-reminder-text' }).setText(task.text);
      item.createSpan({ cls: 'taskpro-reminder-meta' }).setText(this.describeDeadline(task, labels));

      const openButton = item.createEl('button', {
        cls: 'taskpro-reminder-open',
        text: labels.openTask,
      });
      openButton.setAttribute('aria-label', `${labels.openTask}: ${task.text}`);
      openButton.addEventListener('click', () => {
        this.options.onOpenTask(task);
        // Opening a task counts as acting on the reminder, even in strict mode.
        this.close();
      });
    }

    if (tasks.length > shown.length) {
      dialog.createDiv({
        cls: 'taskpro-reminder-more',
        text: labels.andMore(tasks.length - shown.length),
      });
    }
  }

  private describeDeadline(task: ReminderTask, labels: ReminderLabels): string {
    if (task.daysLeft === undefined) return `${task.fileName} · ${labels.noDeadline}`;
    if (task.daysLeft < 0) return `${task.fileName} · ${labels.overdue}`;
    if (task.daysLeft === 0) return `${task.fileName} · ${labels.dueToday}`;
    if (task.daysLeft === 1) return `${task.fileName} · ${labels.dueTomorrow}`;
    return `${task.fileName} · ${labels.daysLeft(task.daysLeft)}`;
  }

  private renderActions(actions: HTMLElement, labels: ReminderLabels, strict: boolean): void {
    const { settings } = this.options;

    if (!strict && settings.snoozeMinutes > 0) {
      const snooze = actions.createEl('button', {
        cls: 'taskpro-reminder-button taskpro-reminder-secondary',
        text: labels.snooze(settings.snoozeMinutes),
      });
      snooze.addEventListener('click', () => {
        this.options.onSnooze();
        this.close();
      });
    }

    const primary = actions.createEl('button', {
      cls: 'taskpro-reminder-button taskpro-reminder-primary',
      text: strict ? labels.acknowledge : labels.dismiss,
    });
    primary.addEventListener('click', () => this.close());

    if (!strict) return;

    // Strict mode: the acknowledge button unlocks after a short hold so the
    // alert cannot be dismissed reflexively.
    let remaining = Math.max(0, settings.strictHoldSeconds);
    if (remaining === 0) return;

    primary.disabled = true;
    primary.setText(labels.acknowledgeIn(remaining));
    this.countdownTimer = window.setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        if (this.countdownTimer !== null) window.clearInterval(this.countdownTimer);
        this.countdownTimer = null;
        primary.disabled = false;
        primary.setText(labels.acknowledge);
        primary.focus();
        return;
      }
      primary.setText(labels.acknowledgeIn(remaining));
    }, 1000);
  }

  private handleBackdropClick = (event: MouseEvent): void => {
    if (this.options.settings.strictness === 'strict') return;
    if (event.target === this.overlay) this.close();
  };

  private handleKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      if (this.options.settings.strictness === 'strict') {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      event.preventDefault();
      this.close();
      return;
    }

    if (event.key !== 'Tab' || !this.overlay) return;

    // Focus trap — keeps keyboard navigation inside the dialog.
    const focusable = Array.from(this.overlay.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
      (el) => !el.hasAttribute('disabled')
    );
    if (focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;

    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };
}
