// ── main.ts ───────────────────────────────────────────────────────────────
// TaskPro - Main plugin entry point
// ─────────────────────────────────────────────────────────────────────────────

import { Plugin, Editor, Hotkey, MarkdownFileInfo, MarkdownView, Notice, TFile, requestUrl, setIcon } from 'obsidian';
import { EditorView } from '@codemirror/view';
import {
  TaskProSettings,
  DEFAULT_SETTINGS,
  DEFAULT_REMINDER_SETTINGS,
  DEFAULT_TELEGRAM_SETTINGS,
  DEFAULT_BOARD_PREFERENCES,
  DEFAULT_CALENDAR_SETTINGS,
  CalendarSystem,
  TaskStatus,
  TaskMapping,
  TaskProgress,
  TaskPriority,
  TASK_PRIORITIES,
  PRIORITY_ICON_NAMES,
  PRIORITY_LABELS,
  TaskRepeat,
  TaskSchedule,
  TaskTimer,
  TaskTimerEntry,
} from './src/types';
import { jalaliToGregorian, gregorianToJalali } from './src/date-utils';
import { TaskProSettingTab } from './src/settings';
import { TaskImportModal } from './src/import-modal';
import { SyncManager } from './src/sync-manager';
import { DecorationSettings, WaitingInfo, createTaskBadgePlugin, forceDecorationsRefresh } from './src/decorations';
import { createReadingModeProcessor } from './src/reading-mode-processor';
import {
  extractDeadline,
  extractProgress,
  extractPriority,
  extractRepeat,
  extractSchedule,
  extractTags,
  nextRepeatDate,
  replaceTaskText,
  setDeadline,
  setPriority,
  setRepeat,
  setSchedule,
  setRemind,
  RemindAt,
  setTags,
  setWaiting,
  stripTaskMetadata,
  TaskLink,
} from './src/task-metadata';
import { TaskTimerService, showSystemNotification } from './src/timer-service';
import { getRepeatLabels, getTimerLabels } from './src/timer-localization';
import { ReminderService } from './src/reminders/reminder-service';
import { PlanReminderService } from './src/reminders/plan-reminders';
import { TelegramSync } from './src/telegram/sync-service';
import { TaskCreationRegistry } from './src/task-registry';
import { TaskIndexService } from './src/task-index-service';
import { getReminderLabels } from './src/reminders/reminder-localization';
import { generateBlockId } from './src/task-parser';
import { addPanelButtonRow, addPanelField, openTaskProPanel } from './src/ui/panel';
import { TaskTag, resolveTag, sanitizeTags } from './src/tags';
import { getTagLabels } from './src/tag-localization';
import { openTagPicker } from './src/ui/tag-picker';
import { TagManagerHost, openTagManagerPanel } from './src/ui/tag-manager';
import { pickDeadline } from './src/ui/deadline-editor';
import { NoteSelectionModal } from './src/note-selector-modal';
import { BoardTask, TaskStore } from './src/board/task-store';
import { TaskBoardHost } from './src/board/task-board';
import { TaskBoardView, VIEW_TYPE_TASK_BOARD } from './src/board/task-board-view';
import { TaskBoardModal } from './src/board/task-board-modal';
import { getBoardLabels } from './src/board/board-localization';
import { sanitizeViews } from './src/board/board-views';
import { DailyNoteService, appendTaskLine } from './src/calendar/daily-notes';
import { todayKey } from './src/calendar/calendar-dates';
import { getCalendarLabels } from './src/calendar/calendar-localization';
import { scheduleText } from './src/calendar/schedule-text';
import { openSchedulePanel } from './src/ui/schedule-editor';
import { openRemindPanel } from './src/ui/remind-editor';
import { useKeymapOf } from './src/ui/escape-scope';
import { TaskPropertySuggest } from './src/editor/property-suggest';
import { RemovedBlock, blockEnd, childIndent, indentOf, removeBlock } from './src/task-lines';
import { getActionLabels } from './src/board/task-actions';
import { displayTitle } from './src/board/board-text';
import { descendantsOf, indexFamilies } from './src/calendar/calendar-items';
import { RelationIndex, linkPathOf, newBlockId } from './src/board/task-relations';
import { MoveContext, PreparedBlock, blockIdOf, blockIdsIn, linkAfterMove, prepareBlock, relinkWaiting } from './src/board/task-move';

/**
 * A task as the editing API addresses it. `lineNumber` is a hint: it is used
 * when that line still holds `lineContent`, and the usual block-ID / text
 * lookup takes over when the note has changed underneath it.
 */
export interface TaskRef {
  filePath: string;
  lineContent: string;
  blockId?: string;
  lineNumber?: number;
}

/** What a chip click hands to the task menu. */
interface TaskMenuDetail {
  status: TaskStatus;
  deadline?: string;
  lineContent: string;
  filePath?: string;
  targetElement: HTMLElement;
  blockId?: string;
  tags?: string[];
  priority?: TaskPriority;
}

const NATIVE_TAG_REGEX = /#([a-zA-Z0-9_-]+)/g;

const FLOATING_BOARD_COMMAND = 'toggle-floating-task-board';
const FLOATING_BOARD_HOTKEYS: Hotkey[] = [{ modifiers: ['Mod', 'Shift'], key: 'b' }];

// Module-level regex constants — compiled once, never inside loops
const TASK_LINE_REGEX = /^(\s*)- \[([ /xX!])\] (.+)$/;
const BLOCK_ID_TAIL_REGEX = /\^([a-zA-Z0-9-]+)\s*$/;
const MIGRATE_BLOCK_ID_REGEX = /^(\s*- \[[ \/xX!]\] .+?)\s*\^([a-zA-Z0-9-]+)\s*$/;
const TASK_STATUS_REGEX = /- \[([ \/xX!])\]/;
const TASK_LINE_WITH_CONTENT_REGEX = /^(\s*)- \[([ \/xX!])\] (.+)$/;

export default class TaskProPlugin extends Plugin {
  settings!: TaskProSettings;
  syncManager!: SyncManager;
  reminderService!: ReminderService;
  planReminders!: PlanReminderService;
  telegramSync!: TelegramSync;
  /** Hidden index of when each task was first seen. Never rendered anywhere. */
  taskRegistry!: TaskCreationRegistry;
  taskIndexService!: TaskIndexService;
  /** Every task in the vault, for the board and tag counts. Loaded on first use. */
  taskStore!: TaskStore;
  /** One note per day, for the calendar: found, or made from the template. */
  dailyNotes!: DailyNoteService;
  /** The board's floating window, while it is open. */
  private floatingBoard: TaskBoardModal | null = null;
  private isProcessingSync = false;
  private syncDebounceTimers = new Map<string, NodeJS.Timeout>(); // Debounce timers per file
  private fileTaskStates = new Map<string, Map<string, TaskStatus>>(); // Track task states per file
  private taskBlockIds = new Map<string, Map<string, string>>(); // Store block IDs: filePath -> (taskContent -> blockId)
  private taskProgressCache = new Map<string, TaskProgress>(); // Fast lookup: filePath:blockId -> progress
  timerService!: TaskTimerService;

  // Helper method to check if a file is within the target folder
  private isFileInTargetFolder(filePath: string): boolean {
    // If no target folder is set, allow all files
    if (!this.settings.targetFolder || this.settings.targetFolder.trim() === '') {
      return true;
    }

    // Normalize paths for comparison
    const targetFolder = this.settings.targetFolder.trim().replace(/^\/+|\/+$/g, '');
    const normalizedPath = filePath.replace(/^\/+/, '');

    // Check if file is in target folder or its subfolders
    return normalizedPath.startsWith(targetFolder + '/') || normalizedPath.startsWith(targetFolder);
  }

  async onload() {
    await this.loadSettings();
    // TaskPro's panels and calendar cards claim Escape through Obsidian's keymap.
    useKeymapOf(this.app);

    // Hidden creation-time index. Created before anything can scan tasks.
    this.taskRegistry = new TaskCreationRegistry({
      getIndex: () => this.settings.taskCreationIndex,
      setIndex: (index) => {
        this.settings.taskCreationIndex = index;
      },
      save: () => this.saveSettings(),
    });

    // Watches the vault so "when did this task appear?" is an observation
    // rather than a guess. Started once the layout is ready (below).
    this.taskIndexService = new TaskIndexService({
      app: this.app,
      registry: this.taskRegistry,
      getTargetFolder: () => this.settings.targetFolder,
    });

    this.taskStore = new TaskStore(
      this.app,
      () => new Promise((resolve) => this.app.workspace.onLayoutReady(() => resolve()))
    );
    // Dependencies point into any note, and plan reminders watch every plan,
    // so the store is loaded once the layout is ready rather than when the
    // board is first opened.
    this.taskStore.subscribe(() => this.onTasksChanged());
    this.app.workspace.onLayoutReady(() => {
      void this.taskStore.ensureLoaded().then(() => this.onTasksChanged());
    });
    this.dailyNotes = new DailyNoteService(this.app, () => this.settings.calendar);
    this.registerView(VIEW_TYPE_TASK_BOARD, (leaf) => new TaskBoardView(leaf, this.createBoardHost()));
    this.addRibbonIcon('list-checks', getBoardLabels(this.settings.badgeLanguage).open, () => {
      void this.activateBoard();
    });

    // Apply body class for embed badge visibility
    if (!this.settings.showBadgesInEmbeds) {
      document.body.addClass('taskpro-hide-badges-in-embeds');
    }

    // Initialize sync manager
    this.syncManager = new SyncManager(
      this.app,
      () => this.settings.taskMappings,
      async (mappings) => {
        this.settings.taskMappings = mappings;
        await this.saveSettings();
      }
    );

    // Focus timers. Built before any renderer can ask for one, and given
    // Obsidian's status bar so a running timer stays visible while the user
    // works in another note.
    this.timerService = new TaskTimerService({
      getEntries: () => this.settings.taskTimers,
      setEntries: (entries) => {
        this.settings.taskTimers = entries;
      },
      save: () => this.saveSettings(),
      getLanguage: () => this.settings.badgeLanguage,
      getSettings: () => ({
        showTimerBadges: this.settings.showTimerBadges,
        timerSystemNotification: this.settings.timerSystemNotification,
        timerSound: this.settings.timerSound,
        timerInStatusBar: this.settings.timerInStatusBar,
      }),
      playSound: () => this.reminderService?.playTimerSound(),
      reveal: (filePath) => {
        void this.app.workspace.openLinkText(filePath, filePath, false);
      },
      registerInterval: (id) => this.registerInterval(id),
      statusBarEl: this.addStatusBarItem(),
    });

    // Rebuild block ID cache from saved mappings (survives plugin reload)
    this.rebuildBlockIdCache();

    // After vault is ready: strip any inline block IDs from imported files (runs once)
    if (!this.settings.blockIdMigrationDone) {
      this.app.workspace.onLayoutReady(() => {
        this.migrateStripInlineBlockIds();
      });
    }

    this.app.workspace.onLayoutReady(() => {
      void this.markOverdueTasksAsNotDone();
    });

    // `@` on a task line: every property a task can be given, as suggestions
    this.registerEditorSuggest(
      new TaskPropertySuggest({
        app: this.app,
        settings: () => ({
          enabled: this.settings.propertySuggest,
          language: this.settings.badgeLanguage,
          calendarSystem: this.settings.calendarSystem,
          timeFormat: this.settings.calendar.timeFormat,
          tags: this.settings.tags,
          defaultDuration: this.settings.calendar.defaultDurationMinutes,
        }),
        appliesTo: (file) => !file || this.isFileInTargetFolder(file.path),
        refresh: () => this.refreshDecorations(),
      })
    );

    // Register CodeMirror 6 extension for Live Preview badges
    this.registerEditorExtension(
     createTaskBadgePlugin(
       this.app,
        () => this.badgeSettings(),
        (filePath: string, blockId?: string) => this.getTaskProgress(filePath, blockId),
        (filePath: string, blockId?: string) => this.timerService.get(filePath, blockId),
        (filePath: string, lineContent: string) => this.getStoredBlockId(filePath, lineContent),
        (filePath: string, links: TaskLink[]) => this.waitingInfo(filePath, links)
     )
   );

    // Register Reading Mode processor for badges
    this.registerMarkdownPostProcessor(
     createReadingModeProcessor(
       this.app,
        () => ({ ...this.badgeSettings(), showBadgesInEmbeds: this.settings.showBadgesInEmbeds }),
        (filePath: string, blockId?: string) => this.getTaskProgress(filePath, blockId),
        (filePath: string, blockId?: string) => this.timerService.get(filePath, blockId),
        (filePath: string, lineContent: string) => this.getStoredBlockId(filePath, lineContent),
        (filePath: string, links: TaskLink[]) => this.waitingInfo(filePath, links)
     )
   );

    // A waiting chip opens the task it waits on.
    this.registerDomEvent(document.body, 'taskpro-waiting-click' as keyof HTMLElementEventMap, (evt: Event) => {
      const { filePath, link } = (evt as CustomEvent).detail as { filePath: string; link: TaskLink };
      const target = link.path ? `${link.path}#^${link.blockId}` : `${filePath.replace(/\.md$/i, '')}#^${link.blockId}`;
      void this.app.workspace.openLinkText(target, filePath, false);
    });

    // Listen for badge clicks to open popover
    this.registerDomEvent(document.body, 'taskpro-badge-click' as keyof HTMLElementEventMap, (evt: Event) => {
      this.showTaskMenu((evt as CustomEvent).detail as TaskMenuDetail);
    });

    // Listen for progress badge clicks to open progress popover
    this.registerDomEvent(document.body, 'taskpro-progress-click' as keyof HTMLElementEventMap, (evt: Event) => {
      const { lineContent, filePath, targetElement, blockId, currentSteps, totalSteps, language } = (evt as CustomEvent).detail;
      this.showProgressMenu({
        lineContent,
        filePath: filePath || this.app.workspace.getActiveFile()?.path || '',
        targetElement,
        blockId,
        progress: { enabled: true, currentSteps, totalSteps },
        language,
      });
    });

    // Tag chip clicks open the tag picker for that task
    this.registerDomEvent(document.body, 'taskpro-tags-click' as keyof HTMLElementEventMap, (evt: Event) => {
      const { lineContent, filePath, blockId, tagKeys } = (evt as CustomEvent).detail;
      this.openTagPickerFor(
        { filePath: filePath || this.app.workspace.getActiveFile()?.path || '', lineContent, blockId },
        tagKeys
      );
    });

    // Listen for focus-timer chip clicks to open the timer menu
    this.registerDomEvent(document.body, 'taskpro-timer-click' as keyof HTMLElementEventMap, (evt: Event) => {
      const customEvt = evt as CustomEvent;
      const { lineContent, filePath, targetElement, blockId, language } = customEvt.detail;
      const resolvedFilePath = filePath || this.app.workspace.getActiveFile()?.path || '';
      const timer = this.timerService.get(resolvedFilePath, blockId);
      if (!timer || !blockId) return;

      import('./src/timer-popover').then(({ TaskTimerPopover }) => {
        const popover = new TaskTimerPopover({
          app: this.app,
          targetElement,
          timer,
          language: language || this.settings.badgeLanguage,
          // Every action re-reads the timer: the menu can sit open while the
          // countdown keeps running, so the captured copy above goes stale.
          onStart: async () => {
            const current = this.timerService.get(resolvedFilePath, blockId);
            if (current) await this.timerService.start(resolvedFilePath, blockId, current);
            this.refreshDecorations();
          },
          onPause: async () => {
            const current = this.timerService.get(resolvedFilePath, blockId);
            if (current) await this.timerService.pause(resolvedFilePath, blockId, current);
            this.refreshDecorations();
          },
          onReset: async () => {
            const current = this.timerService.get(resolvedFilePath, blockId);
            if (current) await this.timerService.reset(resolvedFilePath, blockId, current);
            this.refreshDecorations();
          },
          onExtend: async (minutes) => {
            const current = this.timerService.get(resolvedFilePath, blockId);
            if (current) await this.timerService.extend(resolvedFilePath, blockId, current, minutes);
            this.refreshDecorations();
          },
          onChange: async (newTimer) => {
            await this.handleTimerUpdate(resolvedFilePath, lineContent, blockId, newTimer);
          },
        });
        popover.show();
      });
    });

    this.registerDomEvent(document.body, 'change', async (evt) => {
      const target = evt.target;
      if (!(target instanceof HTMLInputElement) || target.type !== 'checkbox') {
        return;
      }

      const taskItem = target.closest('li.task-list-item');
      if (!(taskItem instanceof HTMLElement)) return;

      const activeFile = this.app.workspace.getActiveFile();
      if (!activeFile || !this.isFileInTargetFolder(activeFile.path)) return;

      const taskLine = this.getTaskItemText(taskItem);
      const blockId = this.extractTaskBlockId(taskLine);
      const taskMarker = target.getAttribute('data-task');
      const status = taskMarker === '!'
        ? '[!]'
        : target.checked
          ? '[x]'
          : target.indeterminate
            ? '[/]'
            : '[ ]';

      const mapping = this.syncManager.findMapping(activeFile.path, taskLine, { scope: 'imported', blockId });
      if (!mapping || !mapping.linked) return;

      this.recordTaskState(activeFile.path, taskLine, blockId, status as TaskStatus);
      await this.syncManager.syncTaskStatus(activeFile.path, taskLine, status, { blockId });
    });

    // Command: Import Task
    this.addCommand({
      id: 'sync-telegram',
      name: 'Sync with Telegram now',
      callback: async () => {
        const outcome = await this.telegramSync.syncNow();
        new Notice(outcome.ok ? (outcome.applied ? `Synced; ${outcome.applied} change(s) made.` : 'Synced with Telegram.') : `Telegram sync failed: ${outcome.message ?? 'unknown error'}`);
      },
    });

    this.addCommand({
      id: 'import-task',
      name: 'Import Task from Reference Note',
      editorCallback: (editor: Editor) => {
        const activeFile = this.app.workspace.getActiveFile();
        if (activeFile && !this.isFileInTargetFolder(activeFile.path)) {
          new Notice('This file is outside the target folder restriction');
          return;
        }

        new TaskImportModal(
          this.app,
          editor,
          this.settings.referenceNotePath,
          this.settings.globalInternalTasks,
          this.settings.calendarSystem,
          (mapping: TaskMapping | TaskMapping[]) => {
            this.syncManager.addMapping(mapping);
          },
          (filePath, blockId, lineContent) => this.getTaskProgress(filePath, blockId, lineContent),
          (filePath, blockId, progress) => this.saveTaskProgress(filePath, blockId, progress),
          (filePath, taskContent, blockId) => this.storeBlockId(filePath, taskContent, blockId),
          () => this.refreshDecorations()
        ).open();
      },
    });

    // Command: Toggle Task Status (Tri-State)
    this.addCommand({
      id: 'toggle-task-status',
      name: 'Toggle Task Status (4-State)',
      editorCallback: (editor: Editor, ctx) => {
        const activeFile = this.app.workspace.getActiveFile();
        if (activeFile && !this.isFileInTargetFolder(activeFile.path)) {
          new Notice('This file is outside the target folder restriction');
          return;
        }
        const view = ctx instanceof MarkdownView ? ctx : this.app.workspace.getActiveViewOfType(MarkdownView);
        if (view) this.toggleTaskStatus(editor, view);
      },
      hotkeys: [{ modifiers: ['Ctrl'], key: 't' }],
    });

    // Command: Toggle Task Not Done
    this.addCommand({
      id: 'toggle-task-not-done',
      name: 'Toggle Task Not Done',
      editorCallback: (editor: Editor, ctx) => {
        const activeFile = this.app.workspace.getActiveFile();
        if (activeFile && !this.isFileInTargetFolder(activeFile.path)) {
          new Notice('This file is outside the target folder restriction');
          return;
        }
        const view = ctx instanceof MarkdownView ? ctx : this.app.workspace.getActiveViewOfType(MarkdownView);
        if (view) this.toggleTaskNotDone(editor, view);
      },
      hotkeys: [{ modifiers: ['Ctrl', 'Shift'], key: 'x' }],
    });

    // Command: Move Task Block Up
    this.addCommand({
      id: 'move-task-block-up',
      name: 'Move Task with Subtasks Up',
      editorCallback: (editor: Editor) => {
        const activeFile = this.app.workspace.getActiveFile();
        if (activeFile && !this.isFileInTargetFolder(activeFile.path)) {
          new Notice('This file is outside the target folder restriction');
          return;
        }
        this.moveTaskBlock(editor, 'up');
      },
      hotkeys: [{ modifiers: ['Alt', 'Shift'], key: 'ArrowUp' }],
    });

    // Command: Move Task Block Down
    this.addCommand({
      id: 'move-task-block-down',
      name: 'Move Task with Subtasks Down',
      editorCallback: (editor: Editor) => {
        const activeFile = this.app.workspace.getActiveFile();
        if (activeFile && !this.isFileInTargetFolder(activeFile.path)) {
          new Notice('This file is outside the target folder restriction');
          return;
        }
        this.moveTaskBlock(editor, 'down');
      },
      hotkeys: [{ modifiers: ['Alt', 'Shift'], key: 'ArrowDown' }],
    });

    // Command: Set/Change Task Deadline
    this.addCommand({
      id: 'set-task-deadline',
      name: 'Set/Change Task Deadline',
      editorCallback: (editor: Editor, ctx) => {
        const activeFile = this.app.workspace.getActiveFile();
        if (activeFile && !this.isFileInTargetFolder(activeFile.path)) {
          new Notice('This file is outside the target folder restriction');
          return;
        }
        const view = ctx instanceof MarkdownView ? ctx : this.app.workspace.getActiveViewOfType(MarkdownView);
        if (view) this.setTaskDeadline(editor, view);
      },
      hotkeys: [{ modifiers: ['Ctrl', 'Shift'], key: 'd' }],
    });

    // Command: Set/Change Task Priority
    this.addCommand({
      id: 'set-task-priority',
      name: 'Set/Change Task Priority',
      editorCallback: (editor: Editor) => {
        const activeFile = this.app.workspace.getActiveFile();
        if (activeFile && !this.isFileInTargetFolder(activeFile.path)) {
          new Notice('This file is outside the target folder restriction');
          return;
        }
        this.setTaskPriority(editor);
      },
      hotkeys: [{ modifiers: ['Ctrl', 'Shift'], key: 'p' }],
    });

    // Command: Show reminders on demand
    this.addCommand({
      id: 'show-task-reminders',
      name: 'Show Task Reminders Now',
      callback: () => {
        void this.reminderService.triggerNow();
      },
    });

    // Command: Toggle daily reminders
    this.addCommand({
      id: 'toggle-task-reminders',
      name: 'Toggle Daily Task Reminders',
      callback: async () => {
        this.settings.reminders.enabled = !this.settings.reminders.enabled;
        await this.saveSettings();
        this.reminderService.refresh();
        const labels = getReminderLabels(this.settings.badgeLanguage);
        new Notice(this.settings.reminders.enabled ? labels.remindersEnabled : labels.remindersDisabled);
      },
    });

    // Command: start or pause the focus timer on the task under the cursor
    this.addCommand({
      id: 'toggle-task-focus-timer',
      name: 'Start / Pause Focus Timer on Current Task',
      editorCallback: async (editor: Editor, ctx: MarkdownView | MarkdownFileInfo) => {
        const context = this.taskAtCursor(editor, ctx);
        if (!context) return;

        const labels = getTimerLabels(this.settings.badgeLanguage);
        const blockId = await this.ensureTaskBlockId(
          context.filePath,
          context.line,
          context.blockId,
          true
        );
        if (!blockId) return;

        const existing = this.timerService.get(context.filePath, blockId);
        if (!existing?.enabled) {
          // No timer yet: create one at the configured default and start it.
          await this.timerService.set(context.filePath, blockId, {
            enabled: true,
            durationSeconds: Math.max(1, this.settings.defaultTimerMinutes) * 60,
            elapsedSeconds: 0,
            runningSince: Date.now(),
            label: this.taskTitle(context.line),
          });
          new Notice(labels.start);
        } else if (existing.runningSince > 0) {
          await this.timerService.pause(context.filePath, blockId, existing);
          new Notice(labels.pause);
        } else {
          await this.timerService.start(context.filePath, blockId, existing);
          new Notice(labels.resume);
        }
        this.refreshDecorations();
      },
    });

    // Command: turn recurrence on or off for the task under the cursor
    this.addCommand({
      id: 'toggle-task-repeat',
      name: 'Toggle Weekly Repeat on Current Task',
      editorCallback: async (editor: Editor, ctx: MarkdownView | MarkdownFileInfo) => {
        const context = this.taskAtCursor(editor, ctx);
        if (!context) return;

        const labels = getRepeatLabels(this.settings.badgeLanguage);
        const existing = extractRepeat(context.line);
        const next: TaskRepeat | null = existing ? null : { every: 1, unit: 'week' };
        editor.setLine(context.lineNumber, setRepeat(context.line, next));
        new Notice(next ? labels.chip(next) : labels.repeatRemoved);
        this.refreshDecorations();
      },
    });

    // Command: open the all-tasks board
    this.addCommand({
      id: 'open-task-board',
      name: 'Open Task Board',
      callback: () => {
        void this.activateBoard();
      },
    });

    // Command: the board, opened on its calendar
    this.addCommand({
      id: 'open-task-calendar',
      name: 'Open Task Calendar',
      callback: () => {
        void this.openCalendar();
      },
    });

    // Command: today's daily note, made from the template when it is missing
    this.addCommand({
      id: 'open-todays-daily-note',
      name: 'Open Today’s Daily Note',
      callback: () => {
        void this.openDailyNote(todayKey(), this.settings.board.calendarSystem ?? this.settings.calendarSystem);
      },
    });

    // Command: plan the task under the cursor for a day, and a time on it
    this.addCommand({
      id: 'schedule-current-task',
      name: 'Plan Current Task…',
      editorCallback: async (editor: Editor, ctx: MarkdownView | MarkdownFileInfo) => {
        const context = this.taskAtCursor(editor, ctx);
        if (!context) return;
        const choice = await openSchedulePanel({
          language: this.settings.badgeLanguage,
          calendarSystem: this.settings.calendarSystem,
          schedule: extractSchedule(context.line),
          defaultDuration: this.settings.calendar.defaultDurationMinutes,
          timeFormat: this.settings.calendar.timeFormat,
        });
        if (choice === undefined) return;
        await this.setTaskScheduleFor(
          { filePath: context.filePath, lineContent: context.line, blockId: context.blockId, lineNumber: context.lineNumber },
          choice
        );
        const labels = getCalendarLabels(this.settings.badgeLanguage);
        new Notice(choice ? labels.scheduledNotice(this.scheduleLabel(choice)) : labels.unscheduledNotice);
      },
    });

    // Command: the board as a floating window over the whole app. The same
    // hotkey closes it again; see TaskBoardModal.
    this.addCommand({
      id: FLOATING_BOARD_COMMAND,
      name: 'Toggle Floating Task Board',
      callback: () => this.toggleFloatingBoard(),
      hotkeys: FLOATING_BOARD_HOTKEYS,
    });

    // Command: choose tags for the task under the cursor
    this.addCommand({
      id: 'set-task-tags',
      name: 'Set Tags on Current Task',
      editorCallback: (editor: Editor, ctx: MarkdownView | MarkdownFileInfo) => {
        const context = this.taskAtCursor(editor, ctx);
        if (!context) return;
        this.openTagPickerFor({
          filePath: context.filePath,
          lineContent: context.line,
          blockId: context.blockId,
          lineNumber: context.lineNumber,
        });
      },
    });

    // Command: create, rename, recolour or delete tags
    this.addCommand({
      id: 'manage-task-tags',
      name: 'Manage Tags',
      callback: () => this.openTagManager(),
    });

    // Daily / periodic reminders
    this.reminderService = new ReminderService({
      app: this.app,
      plugin: this,
      getSettings: () => this.settings,
      saveSettings: () => this.saveSettings(),
      getTaskRegistry: () => this.taskRegistry,
    });

    // A notice shortly before a planned task starts. Plans in the target
    // folder and in daily notes count, as they do on the calendar.
    this.planReminders = new PlanReminderService({
      tasks: () => {
        if (!this.taskStore.isLoaded) return null;
        const daily = this.settings.calendar.dailyNotesFolder.trim().replace(/^\/+|\/+$/g, '');
        return this.taskStore
          .all()
          .filter((task) => this.isFileInTargetFolder(task.filePath) || (!!daily && task.filePath.startsWith(`${daily}/`)));
      },
      settings: () => this.settings.reminders,
      language: () => this.settings.badgeLanguage,
      planText: (schedule) => this.scheduleLabel(schedule),
      announced: () => this.settings.reminderState?.firedPlanKeys ?? [],
      setAnnounced: async (keys) => {
        this.settings.reminderState = { ...this.settings.reminderState, firedPlanKeys: keys };
        await this.saveSettings();
      },
      reveal: (task) => void this.revealTask(this.boardTaskRef(task)),
      markDone: (task) => this.setTaskStatusFor(this.boardTaskRef(task), '[x]'),
      playSound: () => this.reminderService?.playTimerSound(),
      systemNotification: (title, body) => showSystemNotification(title, body),
      registerInterval: (id) => this.registerInterval(id),
    });
    // The Telegram bot: tasks and reminders reach it, and what is asked for there reaches the notes.
    this.telegramSync = new TelegramSync({
      settings: () => this.settings.telegram,
      tasks: () => (this.taskStore.isLoaded ? this.syncableTasks() : null),
      defaults: () => ({ enabled: this.settings.reminders.planReminders, leadMinutes: this.settings.reminders.planLeadMinutes }),
      post: async (url, token, body) => {
        const response = await requestUrl({
          url,
          method: 'POST',
          contentType: 'application/json',
          headers: { Authorization: `Bearer ${token}` },
          body: JSON.stringify(body),
          throw: false,
        });
        let json: unknown = null;
        try {
          json = response.json;
        } catch {
          // Not JSON: the caller reads the status.
        }
        return { status: response.status, json: json as { commands?: never[]; error?: string } | null };
      },
      apply: {
        tasks: () => this.syncableTasks(),
        inboxPath: () => this.boardInboxPath() || null,
        appendLine: (path, line) => this.appendTaskLine(path, line),
        dayTarget: (day) => this.dayNoteTarget(day, this.settings.board.calendarSystem ?? this.settings.calendarSystem).path || null,
        addTaskOnDay: (day, line) => this.addTaskOnDay(day, line, this.settings.board.calendarSystem ?? this.settings.calendarSystem),
        setStatus: (task, status) => this.setTaskStatusFor(this.boardTaskRef(task), status),
        setRemind: (task, value) => this.setTaskRemindFor(this.boardTaskRef(task), value),
        setSchedule: (task, schedule) => this.setTaskScheduleFor(this.boardTaskRef(task), schedule),
        setPriority: (task, priority) => this.setTaskPriorityFor(this.boardTaskRef(task), priority),
        setDeadline: (task, deadline) => this.setTaskDeadlineFor(this.boardTaskRef(task), deadline),
        setTags: (task, keys) => this.setTaskTagsFor(this.boardTaskRef(task), keys),
        setRepeat: (task, repeat) =>
          this.handleRepeatUpdate(task.filePath, task.line, this.boardTaskRef(task).blockId, repeat, task.lineNumber),
        setText: (task, text) => this.setTaskTextFor(this.boardTaskRef(task), text),
        deleteTask: async (task) => {
          const nested = descendantsOf(task, indexFamilies(this.taskStore.inFile(task.filePath))).length;
          await this.deleteTaskFor(this.boardTaskRef(task), displayTitle(task.text) || task.text, nested);
        },
        settled: () => this.afterNextRead(),
      },
      save: () => this.saveSettings(),
      report: (outcome) => {
        if (outcome.applied) new Notice(`TaskPro: ${outcome.applied} change${outcome.applied === 1 ? '' : 's'} from Telegram made in your notes.`);
        if (outcome.errors) console.warn(`TaskPro: ${outcome.errors} change(s) from Telegram could not be made.`);
        if (!outcome.ok && outcome.message) console.warn(`TaskPro: Telegram sync: ${outcome.message}`);
      },
      registerInterval: (id) => this.registerInterval(id),
      now: () => Date.now(),
    });
    this.app.workspace.onLayoutReady(() => {
      void this.taskStore.ensureLoaded().then(() => {
        this.planReminders.start();
        this.telegramSync.start();
      });
    });

    // Keep the hidden creation index in step with the vault so task ages
    // survive renames and deleted notes do not leak stale records.
    this.registerEvent(
      this.app.vault.on('rename', (file, oldPath) => {
        if (file instanceof TFile) {
          this.taskIndexService.handleFileRenamed(file, oldPath);
          this.taskStore.handleRenamed(file, oldPath);
        }
      })
    );
    this.registerEvent(
      this.app.vault.on('delete', (file) => {
        if (file instanceof TFile) {
          this.taskIndexService.handleFileDeleted(file.path);
          this.taskStore.handleDeleted(file.path);
        }
      })
    );
    this.registerEvent(
      this.app.vault.on('create', (file) => {
        if (file instanceof TFile) {
          this.taskIndexService.handleFileChanged(file);
        }
      })
    );
    this.app.workspace.onLayoutReady(() => {
      // The baseline pass must finish before the first alert can fire,
      // otherwise pre-existing tasks would be indexed mid-scan and look new.
      void this.taskIndexService.indexAll().finally(() => {
        this.reminderService.start();
      });
    });

    // The board re-reads a note once Obsidian has re-parsed it, from the
    // content the event carries, so an edit never costs an extra disk read.
    this.registerEvent(
      this.app.metadataCache.on('changed', (file, data, cache) => {
        this.taskStore.handleMetadataChanged(file, data, cache);
      })
    );

    // Listen for file modifications to detect task status changes
    this.registerEvent(
      this.app.vault.on('modify', (file) => {
        if (file instanceof TFile) {
          this.handleFileModification(file);
          this.taskIndexService.handleFileChanged(file);
        }
      })
    );

    // Add settings tab
    this.addSettingTab(new TaskProSettingTab(this.app, this));

  }

  async loadSettings() {
    const saved = await this.loadData();
    this.settings = Object.assign({}, DEFAULT_SETTINGS, saved);

    // Reminder settings are a nested object: merge them field by field so
    // newly added options get their defaults, and always work on a copy so the
    // shared DEFAULT_REMINDER_SETTINGS constant can never be mutated.
    this.settings.reminders = Object.assign({}, DEFAULT_REMINDER_SETTINGS, saved?.reminders);
    // Same for the board's remembered layout, and the tag list is cleaned so a
    // hand-edited data.json cannot break chip rendering.
    this.settings.board = Object.assign({}, DEFAULT_BOARD_PREFERENCES, saved?.board);
    this.settings.calendar = Object.assign({}, DEFAULT_CALENDAR_SETTINGS, saved?.calendar);
    this.settings.tags = sanitizeTags(saved?.tags);
    this.settings.telegram = Object.assign({}, DEFAULT_TELEGRAM_SETTINGS, saved?.telegram);
    this.settings.board.views = sanitizeViews(saved?.board?.views);
    if (!this.settings.board.views.some((view) => view.id === this.settings.board.activeView)) this.settings.board.activeView = undefined;

    // Active-note reminders are enabled by default. Apply this once to existing
    // installs as well; after migration, the user's own toggle is respected.
    if (!this.settings.activeNoteReminderDefaultApplied) {
      this.settings.reminders.enabled = true;
      this.settings.activeNoteReminderDefaultApplied = true;
      await this.saveData(this.settings);
    }

    const dedupedMappings = this.dedupeMappingsByImportedTask(this.settings.taskMappings || []);
    if (dedupedMappings.length !== this.settings.taskMappings.length) {
      this.settings.taskMappings = dedupedMappings;
      await this.saveData(this.settings);
    }

    this.rebuildProgressCache();
    this.timerService?.rebuildCache();
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  private dedupeMappingsByImportedTask(mappings: TaskMapping[]): TaskMapping[] {
    const seen = new Set<string>();
    const dedupedReversed: TaskMapping[] = [];

    for (let i = mappings.length - 1; i >= 0; i--) {
      const mapping = mappings[i];
      const key = mapping.importedBlockId
        ? `id:${mapping.importedFilePath}:${mapping.importedBlockId}`
        : `text:${mapping.importedFilePath}:${this.normalizeTaskContent(mapping.importedLineContent)}`;

      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      dedupedReversed.push(mapping);
    }

    return dedupedReversed.reverse();
  }

  // ── Task menus ───────────────────────────────────────────────────────────

  /**
   * The full task menu, as opened from a status / priority / repeat chip or
   * from a row's "more" button on the board.
   */
  showTaskMenu(detail: TaskMenuDetail): void {
    const { status, deadline, lineContent, filePath, targetElement, blockId, tags } = detail;
    // The chip may not carry the priority (e.g. status chip on an older render),
    // so fall back to re-reading it from the line itself.
    const priority: TaskPriority | undefined = detail.priority ?? extractPriority(lineContent ?? '');
    const resolvedFilePath = filePath || this.app.workspace.getActiveFile()?.path || '';

    // Get progress from stored data
    const progress = this.getTaskProgress(resolvedFilePath, blockId);
    const timer = this.timerService.get(resolvedFilePath, blockId);
    const repeat = extractRepeat(lineContent ?? '');
    const schedule = extractSchedule(lineContent ?? '');
    const customTags = extractTags(lineContent ?? '').map((key) => resolveTag(key, this.settings.tags));

    // Find task mapping if it exists
    const mapping = resolvedFilePath
      ? this.syncManager.findMapping(resolvedFilePath, lineContent, { scope: 'imported', blockId })
      : undefined;
    const ref: TaskRef = { filePath: resolvedFilePath, lineContent, blockId };

    import('./src/task-popover').then(({ TaskPopover }) => {
      const popover = new TaskPopover({
        app: this.app,
        targetElement,
        taskMapping: mapping,
        language: this.settings.badgeLanguage,
        deadline,
        status,
        blockId,
        tags,
        customTags,
        progress,
        priority,
        timer,
        repeat,
        defaultTimerMinutes: this.settings.defaultTimerMinutes,
        calendarSystem: this.settings.calendarSystem,
        schedule,
        timeFormat: this.settings.calendar.timeFormat,
        defaultDuration: this.settings.calendar.defaultDurationMinutes,
        onScheduleChange: (newSchedule) => this.setTaskScheduleFor(ref, newSchedule),
        onToggleSync: async (enabled) => {
          if (mapping) {
            await this.syncManager.setLinkState(resolvedFilePath, lineContent, enabled, { scope: 'imported', blockId });
          }
        },
        onStatusChange: (newStatus) => this.setTaskStatusFor(ref, newStatus),
        onDeadlineChange: (newDeadline) => this.setTaskDeadlineFor(ref, newDeadline),
        onPriorityChange: (newPriority) => this.setTaskPriorityFor(ref, newPriority),
        onEditTags: () => this.openTagPickerFor(ref, customTags.map((tag) => tag.key)),
        onProgressChange: async (newProgress) => {
          await this.handleProgressUpdate(resolvedFilePath, lineContent, blockId, newProgress);
        },
        onTimerChange: async (newTimer) => {
          await this.handleTimerUpdate(resolvedFilePath, lineContent, blockId, newTimer);
        },
        onTimerStart: async () => {
          const effectiveBlockId = blockId || mapping?.importedBlockId;
          if (!effectiveBlockId) return;
          // Re-read: the menu may have been open while the timer ran out.
          const current = this.timerService.get(resolvedFilePath, effectiveBlockId);
          if (!current) return;
          await this.timerService.start(resolvedFilePath, effectiveBlockId, current);
          this.refreshDecorations();
        },
        onTimerPause: async () => {
          const effectiveBlockId = blockId || mapping?.importedBlockId;
          if (!effectiveBlockId) return;
          const current = this.timerService.get(resolvedFilePath, effectiveBlockId);
          if (!current) return;
          await this.timerService.pause(resolvedFilePath, effectiveBlockId, current);
          this.refreshDecorations();
        },
        onRepeatChange: async (newRepeat) => {
          await this.handleRepeatUpdate(resolvedFilePath, lineContent, blockId, newRepeat);
        },
      });
      popover.show();
    });
  }

  /** The step-by-step progress menu, from a progress chip or a board cell. */
  private showProgressMenu(options: {
    lineContent: string;
    filePath: string;
    targetElement: HTMLElement;
    blockId?: string;
    progress: TaskProgress;
    language?: 'en' | 'fa';
  }): void {
    import('./src/progress-popover').then(({ TaskProgressPopover }) => {
      const popover = new TaskProgressPopover({
        app: this.app,
        targetElement: options.targetElement,
        progress: options.progress,
        language: options.language || this.settings.badgeLanguage,
        onProgressChange: async (newProgress) => {
          await this.handleProgressUpdate(options.filePath, options.lineContent, options.blockId, newProgress);
        },
      });
      popover.show();
    });
  }

  // ── Editing a task from anywhere ─────────────────────────────────────────
  // The chip menu and the board both go through these, so a status change
  // from either one records state, refreshes chips and syncs a linked copy in
  // exactly the same way.

  private resolveTaskRef(ref: TaskRef): { mapping?: TaskMapping; blockId?: string; file: TFile | null } {
    const mapping = ref.filePath
      ? this.syncManager.findMapping(ref.filePath, ref.lineContent, { scope: 'imported', blockId: ref.blockId })
      : undefined;
    return {
      mapping,
      blockId: ref.blockId || mapping?.importedBlockId,
      file: ref.filePath ? this.app.vault.getFileByPath(ref.filePath) : null,
    };
  }

  async setTaskStatusFor(ref: TaskRef, newStatus: TaskStatus): Promise<void> {
    const { mapping, blockId, file } = this.resolveTaskRef(ref);
    if (file) {
      const updated = await this.updateTaskLineInFile(
        file,
        ref.lineContent,
        blockId,
        (content) => content.replace(TASK_STATUS_REGEX, `- ${newStatus}`),
        ref.lineNumber
      );
      if (updated) {
        this.recordTaskState(ref.filePath, ref.lineContent, blockId, newStatus);
        this.refreshDecorations();
      }
    }

    // Sync to source if linked
    if (mapping && mapping.linked) {
      await this.syncManager.syncTaskStatus(ref.filePath, ref.lineContent, newStatus, { blockId });
    }
  }

  async setTaskDeadlineFor(ref: TaskRef, newDeadline: string | null): Promise<void> {
    const { mapping, blockId, file } = this.resolveTaskRef(ref);
    if (file) {
      const updated = await this.updateTaskLineInFile(
        file,
        ref.lineContent,
        blockId,
        (content) => this.applyDeadlineToLine(content, newDeadline),
        ref.lineNumber
      );
      if (updated) this.refreshDecorations();
    }

    if (mapping && mapping.linked) {
      await this.syncManager.syncTaskDeadline(ref.filePath, ref.lineContent, newDeadline, { blockId });
    }
  }

  async setTaskPriorityFor(ref: TaskRef, newPriority: TaskPriority | null): Promise<void> {
    const { mapping, blockId, file } = this.resolveTaskRef(ref);
    if (file) {
      const updated = await this.updateTaskLineInFile(
        file,
        ref.lineContent,
        blockId,
        (content) => setPriority(content, newPriority),
        ref.lineNumber
      );
      if (updated) this.refreshDecorations();
    }

    if (mapping && mapping.linked) {
      await this.syncManager.syncTaskPriority(ref.filePath, ref.lineContent, newPriority, { blockId });
    }
  }

  async setTaskTagsFor(ref: TaskRef, keys: string[]): Promise<void> {
    const { mapping, blockId, file } = this.resolveTaskRef(ref);
    if (file) {
      const updated = await this.updateTaskLineInFile(
        file,
        ref.lineContent,
        blockId,
        (content) => setTags(content, keys),
        ref.lineNumber
      );
      if (updated) this.refreshDecorations();
    }

    if (mapping && mapping.linked) {
      await this.syncManager.syncTaskTags(ref.filePath, ref.lineContent, keys, { blockId });
    }
  }

  /**
   * Plans a task for a day (and a time), or takes it off the calendar with
   * `null`. Unlike its status, deadline or tags, a plan is not synced to a
   * linked source task: it says when this copy is to be worked on, and
   * syncing it would put the same task on the calendar twice.
   */
  async setTaskScheduleFor(ref: TaskRef, schedule: TaskSchedule | null): Promise<void> {
    const { blockId, file } = this.resolveTaskRef(ref);
    if (!file) return;
    const updated = await this.updateTaskLineInFile(
      file,
      ref.lineContent,
      blockId,
      (content) => setSchedule(content, schedule),
      ref.lineNumber
    );
    if (updated) this.refreshDecorations();
  }

  /** A plan as the chips write it: "Today, 09:00 – 10:30". */
  private scheduleLabel(schedule: TaskSchedule): string {
    return scheduleText(schedule, {
      language: this.settings.badgeLanguage,
      calendarSystem: this.settings.calendarSystem,
      timeFormat: this.settings.calendar.timeFormat,
    });
  }

  /**
   * Renames a task, keeping every marker and the block ID. Mappings and the
   * block-ID cache are keyed partly by the task's text, so they are moved to
   * the new text as well; otherwise a linked copy would stop syncing.
   */
  async setTaskTextFor(ref: TaskRef, text: string): Promise<void> {
    const { mapping, blockId, file } = this.resolveTaskRef(ref);
    if (!file) return;

    let nextLine = '';
    const updated = await this.updateTaskLineInFile(
      file,
      ref.lineContent,
      blockId,
      (content) => (nextLine = replaceTaskText(content, text)),
      ref.lineNumber
    );
    if (!updated) return;

    const storedId = this.getStoredBlockId(ref.filePath, ref.lineContent);
    if (storedId) {
      this.removeStoredBlockId(ref.filePath, ref.lineContent);
      this.storeBlockId(ref.filePath, nextLine, storedId);
    }

    let mappingsChanged = false;
    if (mapping) {
      mapping.importedLineContent = nextLine.trim();
      mappingsChanged = true;
    }
    const sourceMapping = this.syncManager.findMapping(ref.filePath, ref.lineContent, {
      scope: 'source',
      blockId: ref.blockId,
    });
    if (sourceMapping && sourceMapping.sourceFilePath === ref.filePath) {
      sourceMapping.sourceLineContent = nextLine.trim();
      mappingsChanged = true;
    }
    if (mappingsChanged) await this.saveSettings();

    this.refreshDecorations();
  }

  // ── Tags ─────────────────────────────────────────────────────────────────

  /** Opens the tag picker for one task and writes the result back to its line. */
  openTagPickerFor(ref: TaskRef, currentKeys?: string[]): void {
    const labels = getTagLabels(this.settings.badgeLanguage);
    const selected = currentKeys ?? extractTags(ref.lineContent);
    openTagPicker({
      language: this.settings.badgeLanguage,
      getTags: () => this.settings.tags,
      selected,
      onCreate: async (tag) => {
        await this.setTagList([...this.settings.tags, tag]);
        new Notice(labels.tagCreated(tag.name));
      },
      onSave: async (keys) => {
        const unchanged = keys.length === selected.length && keys.every((key, i) => key === selected[i]);
        if (unchanged) return;
        await this.setTaskTagsFor(ref, keys);
        new Notice(keys.length ? labels.tagsUpdated : labels.tagsCleared);
      },
      onManage: () => this.openTagManager(),
    });
  }

  /** Replaces the tag list, saves it, and repaints everything that shows tags. */
  async setTagList(tags: TaskTag[]): Promise<void> {
    this.settings.tags = tags;
    await this.saveSettings();
    this.refreshDecorations();
    this.refreshReadingViews();
    this.refreshBoards();
  }

  tagManagerHost(): TagManagerHost {
    return {
      language: this.settings.badgeLanguage,
      getTags: () => this.settings.tags,
      setTags: (tags) => this.setTagList(tags),
      countUsage: async () => {
        await this.taskStore.ensureLoaded();
        const counts = new Map<string, number>();
        for (const task of this.taskStore.all()) {
          for (const key of task.tags) counts.set(key, (counts.get(key) ?? 0) + 1);
        }
        return counts;
      },
      removeFromNotes: (key) => this.removeTagEverywhere(key),
    };
  }

  openTagManager(): void {
    openTagManagerPanel(this.tagManagerHost());
  }

  /** Takes one tag key off every task that carries it. Returns how many tasks changed. */
  private async removeTagEverywhere(key: string): Promise<number> {
    await this.taskStore.ensureLoaded();
    const paths = new Set(this.taskStore.all().filter((task) => task.tags.includes(key)).map((task) => task.filePath));
    let changed = 0;

    for (const path of paths) {
      const file = this.app.vault.getFileByPath(path);
      if (!file) continue;
      await this.app.vault.process(file, (content) => {
        const lines = content.split('\n');
        let touched = false;
        for (let i = 0; i < lines.length; i++) {
          if (!TASK_LINE_REGEX.test(lines[i])) continue;
          const keys = extractTags(lines[i]);
          if (!keys.includes(key)) continue;
          lines[i] = setTags(lines[i], keys.filter((k) => k !== key));
          touched = true;
          changed++;
        }
        return touched ? lines.join('\n') : content;
      });
    }

    this.refreshDecorations();
    return changed;
  }

  /**
   * Reading view is post-processed once per render, so a renamed or recoloured
   * tag only shows there after the view renders again.
   */
  refreshReadingViews(): void {
    this.app.workspace.getLeavesOfType('markdown').forEach((leaf) => {
      const view = leaf.view;
      if (view instanceof MarkdownView && view.getMode() === 'preview') {
        view.previewMode.rerender(true);
      }
    });
  }

  // ── Task board ───────────────────────────────────────────────────────────

  /** Opens the board, or brings an already open one to the front. */
  async activateBoard(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_TASK_BOARD)[0];
    if (existing) {
      await this.app.workspace.revealLeaf(existing);
      return;
    }
    const leaf = this.app.workspace.getLeaf('tab');
    await leaf.setViewState({ type: VIEW_TYPE_TASK_BOARD, active: true });
    await this.app.workspace.revealLeaf(leaf);
  }

  /** Opens the board on its calendar layout. A floating board switches in place. */
  async openCalendar(): Promise<void> {
    if (this.settings.board.layout !== 'calendar') {
      this.settings.board.layout = 'calendar';
      await this.saveSettings();
      this.refreshBoards();
    }
    if (!this.floatingBoard) await this.activateBoard();
  }

  /** The note the board's quick add writes to, if it still exists. */
  private boardInboxPath(): string {
    const { inboxPath } = this.settings.board;
    if (inboxPath && this.app.vault.getFileByPath(inboxPath)) return inboxPath;
    const reference = this.settings.referenceNotePath;
    if (reference && this.app.vault.getFileByPath(reference)) return reference;
    return '';
  }

  /** Where a task added on a day goes: that day's note, or the inbox when set so. */
  private dayNoteTarget(day: string, system: CalendarSystem): { path: string; exists: boolean; isDailyNote: boolean } {
    if (this.settings.calendar.newTaskTarget === 'inbox') {
      const path = this.boardInboxPath();
      return { path, exists: !!path, isDailyNote: false };
    }
    return { ...this.dailyNotes.target(day, system), isDailyNote: true };
  }

  /** Writes a task line on a day. Resolves the note it went into, or null. */
  private async addTaskOnDay(day: string, line: string, system: CalendarSystem): Promise<string | null> {
    try {
      if (this.settings.calendar.newTaskTarget === 'inbox') {
        const path = this.boardInboxPath();
        return path && (await this.appendTaskLine(path, line)) ? path : null;
      }
      return (await this.dailyNotes.addTask(day, system, line)).path;
    } catch (error) {
      console.error('TaskPro: could not add the task to its day', error);
      return null;
    }
  }

  /** Opens a day's note, making it from the template first when it does not exist. */
  async openDailyNote(day: string, system: CalendarSystem): Promise<void> {
    let file: TFile;
    try {
      file = await this.dailyNotes.ensure(day, system);
    } catch (error) {
      console.error('TaskPro: could not create the daily note', error);
      new Notice(getCalendarLabels(this.settings.badgeLanguage).addFailed);
      return;
    }
    // A note opened from the floating board is opened to be read: step aside.
    this.floatingBoard?.close();
    const leaf =
      this.app.workspace
        .getLeavesOfType('markdown')
        .find((candidate) => candidate.view instanceof MarkdownView && candidate.view.file?.path === file.path) ??
      this.app.workspace.getLeaf('tab');
    await leaf.openFile(file, { active: true });
    await this.app.workspace.revealLeaf(leaf);
  }

  /** Repaints open boards after a setting they depend on changed. */
  refreshBoards(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_TASK_BOARD)) {
      if (leaf.view instanceof TaskBoardView) leaf.view.refresh();
    }
    this.floatingBoard?.refresh();
  }

  /** Opens the board as a floating window, or closes it if it is already open. */
  toggleFloatingBoard(): void {
    if (this.floatingBoard) {
      this.floatingBoard.close();
      return;
    }
    const modal = new TaskBoardModal(this.app, this.createBoardHost(), {
      onDock: () => void this.activateBoard(),
      hotkeys: this.commandHotkeys(FLOATING_BOARD_COMMAND, FLOATING_BOARD_HOTKEYS),
      onClosed: () => {
        if (this.floatingBoard === modal) this.floatingBoard = null;
      },
    });
    this.floatingBoard = modal;
    modal.open();
  }

  /**
   * The keys a command is bound to right now: the user's own binding when they
   * changed it under Settings → Hotkeys, the default otherwise. Obsidian keeps
   * both in a manager it does not document, so every step is optional and the
   * plugin's default is the last resort.
   */
  private commandHotkeys(commandId: string, fallback: Hotkey[]): Hotkey[] {
    const id = `${this.manifest.id}:${commandId}`;
    const manager = (this.app as unknown as {
      hotkeyManager?: {
        getHotkeys?: (id: string) => Hotkey[] | undefined;
        getDefaultHotkeys?: (id: string) => Hotkey[] | undefined;
      };
    }).hotkeyManager;
    try {
      return manager?.getHotkeys?.(id) ?? manager?.getDefaultHotkeys?.(id) ?? fallback;
    } catch {
      return fallback;
    }
  }

  private boardTaskRef(task: BoardTask): TaskRef {
    return {
      filePath: task.filePath,
      lineContent: task.line,
      blockId: task.blockId ?? this.getStoredBlockId(task.filePath, task.line),
      lineNumber: task.lineNumber,
    };
  }

  private createBoardHost(): TaskBoardHost {
    return {
      app: this.app,
      store: this.taskStore,
      getSettings: () => ({
        language: this.settings.badgeLanguage,
        calendarSystem: this.settings.calendarSystem,
        targetFolder: this.settings.targetFolder,
        tags: this.settings.tags,
        board: this.settings.board,
        referenceNotePath: this.settings.referenceNotePath,
        calendar: this.settings.calendar,
        subtaskProgress: this.settings.showSubtaskProgress,
        planReminder: {
          enabled: this.settings.reminders.planReminders,
          leadMinutes: this.settings.reminders.planLeadMinutes,
        },
      }),
      savePreferences: () => this.saveSettings(),
      getProgress: (task) => {
        const ref = this.boardTaskRef(task);
        return this.getTaskProgress(task.filePath, ref.blockId, task.line);
      },
      setStatus: (task, status) => this.setTaskStatusFor(this.boardTaskRef(task), status),
      setPriority: (task, priority) => this.setTaskPriorityFor(this.boardTaskRef(task), priority),
      setTags: (task, keys) => this.setTaskTagsFor(this.boardTaskRef(task), keys),
      setText: (task, text) => this.setTaskTextFor(this.boardTaskRef(task), text),
      editDeadline: async (task) => {
        const choice = await pickDeadline(this.app, {
          language: this.settings.badgeLanguage,
          calendarSystem: this.settings.calendarSystem,
          deadline: task.deadline,
        });
        if (choice !== undefined) await this.setTaskDeadlineFor(this.boardTaskRef(task), choice);
      },
      editTags: (task) => this.openTagPickerFor(this.boardTaskRef(task), task.tags),
      editProgress: (task, anchor) => {
        const ref = this.boardTaskRef(task);
        const progress = this.getTaskProgress(task.filePath, ref.blockId, task.line);
        if (progress?.enabled) {
          this.showProgressMenu({
            lineContent: task.line,
            filePath: task.filePath,
            targetElement: anchor,
            blockId: ref.blockId,
            progress,
          });
        } else {
          this.showTaskMenu(this.boardMenuDetail(task, anchor));
        }
      },
      openTaskMenu: (task, anchor) => this.showTaskMenu(this.boardMenuDetail(task, anchor)),
      reveal: (task) => this.revealTask(this.boardTaskRef(task)),
      addTask: (path, line) => this.appendTaskLine(path, line),
      noteExists: (path) => !!this.app.vault.getFileByPath(path),
      chooseNote: (onPick) => new NoteSelectionModal(this.app, (file) => onPick(file.path)).open(),
      manageTags: () => this.openTagManager(),
      notify: (message) => {
        new Notice(message);
      },
      openFloating: () => {
        if (!this.floatingBoard) this.toggleFloatingBoard();
      },
      setSchedule: (task, schedule) => this.setTaskScheduleFor(this.boardTaskRef(task), schedule),
      // Both calendars' names are looked up whichever is showing, so the view system does not matter here.
      dailyNotesFor: (day) => this.dailyNotes.existing(day, 'gregorian').map((file) => file.path),
      dayNoteTarget: (day, system) => this.dayNoteTarget(day, system),
      addTaskOnDay: (day, line, system) => this.addTaskOnDay(day, line, system),
      openDailyNote: (day, system) => this.openDailyNote(day, system),
      setDeadline: (task, deadline) => this.setTaskDeadlineFor(this.boardTaskRef(task), deadline),
      setRepeat: (task, repeat) =>
        this.handleRepeatUpdate(task.filePath, task.line, this.boardTaskRef(task).blockId, repeat, task.lineNumber),
      setProgress: (task, progress) =>
        this.handleProgressUpdate(task.filePath, task.line, this.boardTaskRef(task).blockId, progress),
      editSchedule: async (task) => {
        const choice = await openSchedulePanel({
          language: this.settings.badgeLanguage,
          calendarSystem: this.settings.board.calendarSystem ?? this.settings.calendarSystem,
          schedule: task.schedule,
          defaultDuration: this.settings.calendar.defaultDurationMinutes,
          timeFormat: this.settings.calendar.timeFormat,
        });
        if (choice !== undefined) await this.setTaskScheduleFor(this.boardTaskRef(task), choice);
      },
      insertTask: (task, line, as) => this.insertTaskNear(this.boardTaskRef(task), line, as),
      deleteTask: (task) => {
        const nested = descendantsOf(task, indexFamilies(this.taskStore.inFile(task.filePath))).length;
        return this.deleteTaskFor(this.boardTaskRef(task), displayTitle(task.text) || task.text, nested);
      },
      blockLink: (task) => this.blockLinkFor(task),
      notes: () => this.app.vault.getMarkdownFiles().map((file) => ({ path: file.path, name: file.basename })),
      moveTask: (task, targetPath) => this.moveTaskTo(task, targetPath),
      deleteTasks: (tasks) => this.deleteTasksFor(tasks),
      setWaiting: (task, blockers) => this.setTaskWaiting(task, blockers),
      setDates: (task, patch) => this.setTaskDatesFor(this.boardTaskRef(task), patch),
      setRemind: (task, minutes) => this.setTaskRemindFor(this.boardTaskRef(task), minutes),
      editRemind: async (task) => {
        const choice = await openRemindPanel({
          language: this.settings.badgeLanguage,
          calendarSystem: this.settings.board.calendarSystem ?? this.settings.calendarSystem,
          timeFormat: this.settings.calendar.timeFormat,
          current: task.remindAt,
          // A new one starts at the plan's start, when there is one.
          suggest: task.schedule?.start ? { date: task.schedule.date, time: task.schedule.start } : undefined,
        });
        if (choice === undefined) return;
        // Taking the moment off leaves the task with the setting's reminder again.
        await this.setTaskRemindFor(this.boardTaskRef(task), choice === null ? undefined : choice);
      },
    };
  }

  /** What the note chips need to know about a line's dependencies, from every task the store holds. */
  private badgeSettings(): DecorationSettings {
    return {
      enableBadges: this.settings.enableBadges,
      badgeLanguage: this.settings.badgeLanguage,
      badgeSize: this.settings.badgeSize,
      targetFolder: this.settings.targetFolder,
      calendarSystem: this.settings.calendarSystem,
      showPriorityBadges: this.settings.showPriorityBadges,
      showTimerBadges: this.settings.showTimerBadges,
      showRepeatBadges: this.settings.showRepeatBadges,
      showTagBadges: this.settings.showTagBadges,
      showScheduleBadges: this.settings.showScheduleBadges,
      showSubtaskProgress: this.settings.showSubtaskProgress,
      showWaitingBadges: this.settings.showWaitingBadges,
      timeFormat: this.settings.calendar.timeFormat,
      tags: this.settings.tags,
    };
  }

  /** The tasks every task waits on, resolved once per change to the notes. */
  private relationsCache: RelationIndex | null = null;
  /** What the waiting chips last showed, so the editors are redrawn only when that changes. */
  private waitingSignature = '';

  private relations(): RelationIndex | null {
    if (!this.taskStore.isLoaded) return null;
    if (!this.relationsCache) this.relationsCache = new RelationIndex(this.taskStore.all());
    return this.relationsCache;
  }

  /** The tasks a line waits on, as its chip names them: their titles, and whether each is done or gone. */
  private waitingInfo(filePath: string, links: TaskLink[]): WaitingInfo[] {
    const index = this.relations();
    return links.map((link) => {
      const task = index?.resolve(link, filePath);
      return task
        ? { link, title: displayTitle(task.text) || task.text, done: task.status === '[x]', missing: false }
        : { link, title: link.path.split('/').pop() || link.blockId, done: false, missing: !!index };
    });
  }

  /**
   * The store changed: forget the resolved links, and redraw the note chips
   * if a task something waits on was renamed, ticked off, or went away.
   */
  /** The tasks the bot knows: the ones plan reminders watch (the target folder and the daily notes). */
  private syncableTasks(): BoardTask[] {
    const daily = this.settings.calendar.dailyNotesFolder.trim().replace(/^\/+|\/+$/g, '');
    return this.taskStore
      .all()
      .filter((task) => this.isFileInTargetFolder(task.filePath) || (!!daily && task.filePath.startsWith(`${daily}/`)));
  }

  /** Resolves once the notes have been read again after an edit, or a moment has gone by. */
  private afterNextRead(): Promise<void> {
    return new Promise((resolve) => {
      let finished = false;
      let off: () => void = () => undefined;
      const finish = () => {
        if (finished) return;
        finished = true;
        off();
        window.clearTimeout(limit);
        window.setTimeout(resolve, 120);
      };
      off = this.taskStore.subscribe(finish);
      const limit = window.setTimeout(finish, 1500);
    });
  }

  private onTasksChanged(): void {
    this.telegramSync?.tasksChanged();
    this.relationsCache = null;
    const index = this.relations();
    if (!index) return;
    const parts: string[] = [];
    for (const task of this.taskStore.all()) {
      for (const blocker of index.blockersOf(task)) {
        parts.push(`${blocker.link.path}#${blocker.link.blockId}=${blocker.task ? `${blocker.task.status}${blocker.task.text}` : '-'}`);
      }
    }
    const signature = parts.join('|');
    if (signature === this.waitingSignature) return;
    this.waitingSignature = signature;
    this.refreshDecorations();
  }

  /**
   * Makes a task wait on exactly these tasks. A task waited on needs a block
   * ID in its line for the link to point at: one it has already is used, the
   * one TaskPro keeps for it out of the note is written in, or a new one is.
   */
  private async setTaskWaiting(task: BoardTask, blockers: BoardTask[]): Promise<void> {
    const links: TaskLink[] = [];
    for (const blocker of blockers) {
      const id = await this.ensureInlineBlockId(blocker);
      if (id) links.push({ path: linkPathOf(blocker.filePath), blockId: id });
    }
    const { blockId, file } = this.resolveTaskRef(this.boardTaskRef(task));
    if (!file) return;
    const updated = await this.updateTaskLineInFile(file, task.line, blockId, (content) => setWaiting(content, links), task.lineNumber);
    if (updated) this.refreshDecorations();
  }

  private async ensureInlineBlockId(task: BoardTask): Promise<string | null> {
    if (task.blockId) return task.blockId;
    const file = this.app.vault.getFileByPath(task.filePath);
    if (!file) return null;
    const stored = this.getStoredBlockId(task.filePath, task.line);
    const blocks = this.app.metadataCache.getFileCache(file)?.blocks ?? {};
    const inNote = new Set(this.taskStore.inFile(task.filePath).map((t) => t.blockId).filter(Boolean));
    const id = stored ?? newBlockId((candidate) => candidate in blocks || inNote.has(candidate));
    let nextLine = '';
    const updated = await this.updateTaskLineInFile(
      file,
      task.line,
      stored,
      (content) => (nextLine = `${content.replace(/\s+$/, '')} ^${id}`),
      task.lineNumber
    );
    if (!updated) return null;
    if (stored) {
      this.removeStoredBlockId(task.filePath, task.line);
      this.storeBlockId(task.filePath, nextLine, stored);
    }
    return id;
  }

  /**
   * A plan and a deadline written in one edit, so a timeline drag that
   * moves both is one change to the note. The deadline goes on to a linked
   * source the way a deadline set anywhere else does; the plan does not.
   */
  async setTaskDatesFor(ref: TaskRef, patch: { schedule?: TaskSchedule | null; deadline?: string | null }): Promise<void> {
    const { mapping, blockId, file } = this.resolveTaskRef(ref);
    if (!file) return;
    const updated = await this.updateTaskLineInFile(
      file,
      ref.lineContent,
      blockId,
      (content) => {
        let next = content;
        if (patch.schedule !== undefined) next = setSchedule(next, patch.schedule);
        if (patch.deadline !== undefined) next = this.applyDeadlineToLine(next, patch.deadline);
        return next;
      },
      ref.lineNumber
    );
    if (updated) this.refreshDecorations();
    if (patch.deadline !== undefined && mapping?.linked) {
      await this.syncManager.syncTaskDeadline(ref.filePath, ref.lineContent, patch.deadline, { blockId });
    }
  }

  /** A task's own reminder before its plan starts, or back to the setting with `undefined`. */
  async setTaskRemindFor(ref: TaskRef, minutes: number | null | RemindAt | undefined): Promise<void> {
    const { blockId, file } = this.resolveTaskRef(ref);
    if (!file) return;
    const updated = await this.updateTaskLineInFile(file, ref.lineContent, blockId, (content) => setRemind(content, minutes), ref.lineNumber);
    if (updated) this.refreshDecorations();
  }

  /**
   * Writes a task line beside another: as its last subtask, indented one step
   * further (by the note's own indent, a tab unless the note uses spaces), or
   * after it and everything nested under it, at its own depth.
   */
  private async insertTaskNear(ref: TaskRef, line: string, as: 'child' | 'sibling'): Promise<boolean> {
    const file = ref.filePath ? this.app.vault.getFileByPath(ref.filePath) : null;
    if (!file) return false;
    let written = false;
    await this.app.vault.process(file, (content) => {
      const lines = content.split('\n');
      const index =
        ref.lineNumber !== undefined && lines[ref.lineNumber] === ref.lineContent
          ? ref.lineNumber
          : this.findTaskLineIndex(lines, ref.lineContent, ref.blockId);
      if (index === -1) return content;

      const own = indentOf(lines[index]);
      const end = blockEnd(lines, index);
      let indent = own;
      if (as === 'child') {
        const existing = childIndent(lines, index);
        if (existing !== null) indent = existing;
        else {
          const spaced = lines.find((text) => /^ +[-*+] /.test(text));
          const tabbed = lines.some((text) => /^\t+[-*+] /.test(text));
          indent = own + (!tabbed && spaced ? ' '.repeat(Math.min(4, indentOf(spaced).length) || 4) : '\t');
        }
      }
      lines.splice(end + 1, 0, indent + line.trimStart());
      written = true;
      return lines.join('\n');
    });
    if (written) this.refreshDecorations();
    return written;
  }

  /**
   * Deletes a task from its note, with everything nested under it, and puts
   * up a notice that can put it all back. Resolves whether anything went.
   */
  private async deleteTaskFor(ref: TaskRef, title: string, subtasks: number): Promise<boolean> {
    const file = ref.filePath ? this.app.vault.getFileByPath(ref.filePath) : null;
    if (!file) return false;
    let taken: RemovedBlock | null = null;
    await this.app.vault.process(file, (content) => {
      const lines = content.split('\n');
      const index =
        ref.lineNumber !== undefined && lines[ref.lineNumber] === ref.lineContent
          ? ref.lineNumber
          : this.findTaskLineIndex(lines, ref.lineContent, ref.blockId);
      if (index === -1) return content;
      taken = removeBlock(lines, index);
      return taken.lines.join('\n');
    });
    const removed = taken as RemovedBlock | null;
    if (!removed) return false;
    this.refreshDecorations();

    const labels = getActionLabels(this.settings.badgeLanguage);
    this.undoNotice(labels.deleted(title, subtasks), () => this.putBack(file, removed));
    return true;
  }

  /**
   * Deletes several tasks, each with what is nested under it, and puts up one
   * notice that puts them all back. Within a note the lower ones go first, so
   * the lines of the ones still to go do not move. Resolves how many went.
   */
  private async deleteTasksFor(tasks: BoardTask[]): Promise<number> {
    const ordered = [...tasks].sort((a, b) => (a.filePath === b.filePath ? b.lineNumber - a.lineNumber : a.filePath.localeCompare(b.filePath)));
    const taken: Array<{ file: TFile; removed: RemovedBlock }> = [];
    for (const task of ordered) {
      const ref = this.boardTaskRef(task);
      const file = ref.filePath ? this.app.vault.getFileByPath(ref.filePath) : null;
      if (!file) continue;
      let cut: RemovedBlock | null = null;
      await this.app.vault.process(file, (content) => {
        const lines = content.split('\n');
        const index =
          ref.lineNumber !== undefined && lines[ref.lineNumber] === ref.lineContent
            ? ref.lineNumber
            : this.findTaskLineIndex(lines, ref.lineContent, ref.blockId);
        if (index === -1) return content;
        cut = removeBlock(lines, index);
        return cut.lines.join('\n');
      });
      const removed = cut as RemovedBlock | null;
      if (removed) taken.push({ file, removed });
    }
    if (!taken.length) return 0;
    this.refreshDecorations();
    const labels = getActionLabels(this.settings.badgeLanguage);
    this.undoNotice(labels.deletedMany(taken.length), async () => {
      // Last out, first back: each block returns to the place it was taken from.
      for (const { file, removed } of [...taken].reverse()) await this.putBack(file, removed);
    });
    return taken.length;
  }

  /** A notice with an Undo in it, which stays a few seconds. */
  private undoNotice(message: string, onUndo: () => void | Promise<void>): void {
    const labels = getActionLabels(this.settings.badgeLanguage);
    const notice = new Notice(message, 8000);
    const messageEl = (notice as unknown as { messageEl?: HTMLElement; noticeEl?: HTMLElement }).messageEl
      ?? (notice as unknown as { noticeEl?: HTMLElement }).noticeEl;
    if (!messageEl?.createEl) return;
    // Obsidian's notices are left to right; a Persian sentence needs its own direction.
    messageEl.setAttribute('dir', this.settings.badgeLanguage === 'fa' ? 'rtl' : 'ltr');
    messageEl.addClass('taskpro-notice-with-action');
    const undo = messageEl.createEl('button', { cls: 'taskpro-notice-undo', text: labels.undo });
    undo.addEventListener('click', (event) => {
      event.stopPropagation();
      notice.hide();
      void onUndo();
    });
  }

  /** Puts a removed block back where it was, exactly. */
  private async putBack(file: TFile, removed: RemovedBlock): Promise<void> {
    await this.app.vault.process(file, (content) => {
      const lines = content.split('\n');
      lines.splice(Math.min(removed.at, lines.length), 0, ...removed.removed);
      return lines.join('\n');
    });
    this.refreshDecorations();
  }

  /**
   * The link that points at a task, `[[Note#^id]]`, the way Obsidian's own
   * "copy block link" writes it. A task without a block ID is given the kind
   * the dependencies use, so the link has something to point at.
   */
  private async blockLinkFor(task: BoardTask): Promise<string | null> {
    const id = await this.ensureInlineBlockId(task);
    return id ? `[[${linkPathOf(task.filePath)}#^${id}]]` : null;
  }

  /**
   * Moves a task, with everything nested under it, to the end of another
   * note. What is kept about a task outside its line goes with it: its
   * progress, its timer, the link between a copy and its source. The links
   * that say a task waits on another are pointed at the note it is in now,
   * whether they are written on the moved tasks or on tasks elsewhere.
   * Resolves whether the task moved.
   */
  private async moveTaskTo(task: BoardTask, targetPath: string): Promise<boolean> {
    const from = task.filePath;
    const source = this.app.vault.getFileByPath(from);
    const target = this.app.vault.getFileByPath(targetPath);
    if (!source || !target || from === targetPath) return false;

    // How the tasks relate now, before anything moves: who moves, who waits on them.
    const family = [task, ...descendantsOf(task, indexFamilies(this.taskStore.inFile(from)))];
    const index = new RelationIndex(this.taskStore.all());
    const ref = this.boardTaskRef(task);

    let cut: RemovedBlock | null = null;
    await this.app.vault.process(source, (content) => {
      const lines = content.split('\n');
      const at =
        ref.lineNumber !== undefined && lines[ref.lineNumber] === ref.lineContent
          ? ref.lineNumber
          : this.findTaskLineIndex(lines, ref.lineContent, ref.blockId);
      if (at === -1) return content;
      cut = removeBlock(lines, at);
      return cut.lines.join('\n');
    });
    const taken = cut as RemovedBlock | null;
    if (!taken) return false;
    // The blank line that went with it to keep the note's spacing is not part of the task.
    const block = [...taken.removed];
    while (block.length && !block[block.length - 1].trim()) block.pop();

    let prepared: PreparedBlock | null = null;
    let context: MoveContext | null = null;
    try {
      await this.app.vault.process(target, (content) => {
        const used = blockIdsIn(content);
        prepared = prepareBlock(block, (id) => used.has(id));
        context = { index, moved: new Set(family.map((t) => t.id)), from, to: targetPath, renamed: prepared.renamed };
        const lines = prepared.lines.map((text) => relinkWaiting(text, (link) => linkAfterMove(link, from, context!, true)));
        return appendTaskLine(content, lines.join('\n'));
      });
    } catch (error) {
      // The other note could not be written: the task goes back where it was.
      console.error('TaskPro: could not move the task', error);
      await this.putBack(source, taken);
      return false;
    }
    const landed = prepared as PreparedBlock | null;
    const linking = context as MoveContext | null;
    if (!landed || !linking) return false;

    // Everything kept by note and block ID follows the block.
    const ids = new Map<string, string>();
    const relocated: Array<{ line: string; blockId?: string; nextBlockId?: string }> = [];
    for (const text of block) {
      const inline = blockIdOf(text);
      if (inline) ids.set(inline, landed.renamed.get(inline) ?? inline);
      if (!TASK_LINE_WITH_CONTENT_REGEX.test(text)) continue;
      // A copy imported from another note keeps its ID with the mapping, out of the line.
      const stored = inline ? undefined : this.getStoredBlockId(from, text);
      relocated.push({ line: text, blockId: inline ?? stored, nextBlockId: inline ? landed.renamed.get(inline) : undefined });
      if (stored) {
        this.removeStoredBlockId(from, text);
        this.storeBlockId(targetPath, text, stored);
      }
    }
    let saved = false;
    for (const entry of this.settings.taskProgress) {
      const next = entry.filePath === from ? ids.get(entry.blockId) : undefined;
      if (next === undefined) continue;
      entry.filePath = targetPath;
      entry.blockId = next;
      saved = true;
    }
    if (saved) {
      this.rebuildProgressCache();
      await this.saveData(this.settings);
    }
    await this.syncManager.relocate(from, targetPath, relocated);
    await this.timerService.move(from, targetPath, ids);

    // Tasks elsewhere that wait on a moved task: their links follow it.
    const seen = new Set(linking.moved);
    for (const moving of family) {
      for (const dependent of index.dependentsOf(moving)) {
        if (seen.has(dependent.id)) continue;
        seen.add(dependent.id);
        const file = this.app.vault.getFileByPath(dependent.filePath);
        if (!file) continue;
        await this.updateTaskLineInFile(
          file,
          dependent.line,
          dependent.blockId,
          (line) => relinkWaiting(line, (link) => linkAfterMove(link, dependent.filePath, linking, false)),
          dependent.lineNumber
        );
      }
    }
    this.refreshDecorations();
    return true;
  }

  private boardMenuDetail(task: BoardTask, anchor: HTMLElement): TaskMenuDetail {
    return {
      status: task.status,
      deadline: task.deadline,
      lineContent: task.line,
      filePath: task.filePath,
      targetElement: anchor,
      blockId: this.boardTaskRef(task).blockId,
      tags: Array.from(task.text.matchAll(NATIVE_TAG_REGEX), (match) => match[1]),
      priority: task.priority,
    };
  }

  /** Opens the task's note with the cursor on the task. Reuses a tab already showing it. */
  async revealTask(ref: TaskRef): Promise<void> {
    const file = this.app.vault.getFileByPath(ref.filePath);
    if (!file) {
      new Notice(getBoardLabels(this.settings.badgeLanguage).noteMissing);
      return;
    }
    // Opened from the floating board, the note would open behind it.
    this.floatingBoard?.close();

    const leaf =
      this.app.workspace
        .getLeavesOfType('markdown')
        .find((candidate) => candidate.view instanceof MarkdownView && candidate.view.file?.path === file.path) ??
      this.app.workspace.getLeaf('tab');
    await leaf.openFile(file, { active: true, eState: { line: ref.lineNumber } });
    await this.app.workspace.revealLeaf(leaf);

    const view = leaf.view;
    if (!(view instanceof MarkdownView) || ref.lineNumber === undefined) return;
    // The line may have moved since the board read it; find it again.
    const lines = view.editor.getValue().split('\n');
    const index =
      lines[ref.lineNumber] === ref.lineContent
        ? ref.lineNumber
        : this.findTaskLineIndex(lines, ref.lineContent, ref.blockId);
    if (index < 0) return;
    const position = { line: index, ch: lines[index].length };
    view.editor.setCursor(position);
    view.editor.scrollIntoView({ from: position, to: position }, true);
  }

  /** Appends a task line at the end of a note. Resolves false when the note is gone. */
  private async appendTaskLine(path: string, line: string): Promise<boolean> {
    const file = this.app.vault.getFileByPath(path);
    if (!file) return false;
    await this.app.vault.process(file, (content) => appendTaskLine(content, line));
    return true;
  }

  refreshDecorations() {
    // Dispatch a targeted effect on every open markdown editor so the decoration
    // plugin rebuilds badges without needing selectionSet or a global updateOptions().
    this.app.workspace.iterateAllLeaves((leaf) => {
      const cm = (leaf.view as any)?.editor?.cm as EditorView | undefined;
      if (cm) {
        cm.dispatch({ effects: forceDecorationsRefresh.of(null) });
      }
    });
  }

  private toggleTaskStatus(editor: Editor, view: MarkdownView) {
    const cursor = editor.getCursor();
    const line = editor.getLine(cursor.line);
    const match = line.match(TASK_LINE_WITH_CONTENT_REGEX);

    if (!match) {
      new Notice('Cursor is not on a task line');
      return;
    }

    const indent = match[1];
    const currentStatus = match[2].toLowerCase();
    const content = match[3];

    // Four-state toggle: [ ] -> [/] -> [x] -> [!] -> [ ]
    let newStatus: string;
    if (currentStatus === ' ') {
      newStatus = '/';
    } else if (currentStatus === '/') {
      newStatus = 'x';
    } else if (currentStatus === 'x') {
      newStatus = '!';
    } else {
      newStatus = ' ';
    }

    const newLine = `${indent}- [${newStatus}] ${content}`;
    editor.setLine(cursor.line, newLine);

    const file = view.file;
    const blockId = this.extractTaskBlockId(line);
    const progress = file ? this.getTaskProgress(file.path, blockId, line) : undefined;

    if (newStatus === 'x' && progress?.enabled && file && blockId) {
      const updatedProgress: TaskProgress = {
        enabled: true,
        totalSteps: progress.totalSteps,
        currentSteps: progress.totalSteps,
      };
      void this.saveTaskProgress(file.path, blockId, updatedProgress);
    }

    // Trigger sync (imported → source only)
    if (file) {
      const mapping = this.syncManager.findMapping(file.path, line, { scope: 'imported', blockId });

      if (mapping && mapping.linked) {
        this.recordTaskState(file.path, newLine, blockId, `[${newStatus}]` as TaskStatus);
        this.syncManager.syncTaskStatus(
          file.path,
          line,
          `[${newStatus}]` as TaskStatus,
          { blockId }
        );

        if (newStatus === 'x' && progress?.enabled) {
          const updatedProgress: TaskProgress = {
            enabled: true,
            totalSteps: progress.totalSteps,
            currentSteps: progress.totalSteps,
          };
          void this.syncManager.syncTaskProgress(file.path, line, updatedProgress, { blockId });
          if (mapping.sourceBlockId) {
            void this.saveTaskProgress(mapping.sourceFilePath, mapping.sourceBlockId, updatedProgress);
          }
        }
      }
    }
  }

  private toggleTaskNotDone(editor: Editor, view: MarkdownView) {
    const cursor = editor.getCursor();
    const line = editor.getLine(cursor.line);
    const match = line.match(TASK_LINE_WITH_CONTENT_REGEX);

    if (!match) {
      new Notice('Cursor is not on a task line');
      return;
    }

    const currentStatus = match[2].toLowerCase();
    const newStatus: TaskStatus = currentStatus === '!' ? '[ ]' : '[!]';
    const newLine = line.replace(TASK_STATUS_REGEX, `- ${newStatus}`);
    editor.setLine(cursor.line, newLine);

    const file = view.file;
    const blockId = this.extractTaskBlockId(line);
    if (file) {
      const mapping = this.syncManager.findMapping(file.path, line, { scope: 'imported', blockId });
      this.recordTaskState(file.path, newLine, blockId, newStatus);
      if (mapping && mapping.linked) {
        void this.syncManager.syncTaskStatus(file.path, line, newStatus, { blockId });
      }
    }
  }

  private moveTaskBlock(editor: Editor, direction: 'up' | 'down') {
    const cursor = editor.getCursor();
    const lines: string[] = [];
    for (let i = 0; i < editor.lineCount(); i++) {
      lines.push(editor.getLine(i));
    }

    const block = this.getTaskBlockRange(lines, cursor.line);
    if (!block) {
      new Notice('Cursor is not on a task line');
      return;
    }

    const sibling = direction === 'up'
      ? this.findPreviousSiblingTaskBlock(lines, block.start, block.indent)
      : this.findNextSiblingTaskBlock(lines, block.end, block.indent);

    if (!sibling) {
      new Notice(direction === 'up' ? 'Task is already at the top' : 'Task is already at the bottom');
      return;
    }

    const taskBlockLines = lines.slice(block.start, block.end + 1);
    const siblingBlockLines = lines.slice(sibling.start, sibling.end + 1);
    const scrollInfo = editor.getScrollInfo();

    if (direction === 'up') {
      const gapLines = lines.slice(sibling.end + 1, block.start);
      this.replaceEditorLines(
        editor,
        sibling.start,
        block.end,
        [...taskBlockLines, ...gapLines, ...siblingBlockLines]
      );
      editor.setCursor({
        line: sibling.start + (cursor.line - block.start),
        ch: cursor.ch,
      });
    } else {
      const gapLines = lines.slice(block.end + 1, sibling.start);
      this.replaceEditorLines(
        editor,
        block.start,
        sibling.end,
        [...siblingBlockLines, ...gapLines, ...taskBlockLines]
      );
      editor.setCursor({
        line: block.start + siblingBlockLines.length + gapLines.length + (cursor.line - block.start),
        ch: cursor.ch,
      });
    }

    editor.scrollTo(scrollInfo.left, scrollInfo.top);
    this.refreshDecorations();
  }

  private replaceEditorLines(editor: Editor, fromLine: number, toLine: number, replacementLines: string[]): void {
    const lineCount = editor.lineCount();
    const to = toLine + 1 < lineCount
      ? { line: toLine + 1, ch: 0 }
      : { line: toLine, ch: editor.getLine(toLine).length };
    const replacement = replacementLines.join('\n') + (toLine + 1 < lineCount ? '\n' : '');

    editor.replaceRange(
      replacement,
      { line: fromLine, ch: 0 },
      to,
      'taskpro-move-task-block'
    );
  }

  private getTaskBlockRange(lines: string[], lineIndex: number): { start: number; end: number; indent: number } | null {
    const line = lines[lineIndex];
    const match = TASK_LINE_WITH_CONTENT_REGEX.exec(line);
    if (!match) return null;

    const indent = match[1].length;
    let end = lineIndex;

    for (let i = lineIndex + 1; i < lines.length; i++) {
      if (this.isBlankLine(lines[i])) {
        const nextMeaningfulLine = this.findNextNonBlankLine(lines, i + 1);
        if (
          nextMeaningfulLine !== -1 &&
          this.getLeadingWhitespaceLength(lines[nextMeaningfulLine]) > indent
        ) {
          end = i;
          continue;
        }
        break;
      }

      const nextIndent = this.getLeadingWhitespaceLength(lines[i]);
      if (nextIndent <= indent) {
        break;
      }

      end = i;
    }

    return { start: lineIndex, end, indent };
  }

  private findPreviousSiblingTaskBlock(lines: string[], blockStart: number, indent: number): { start: number; end: number } | null {
    for (let i = blockStart - 1; i >= 0; i--) {
      const match = TASK_LINE_WITH_CONTENT_REGEX.exec(lines[i]);
      if (!match) continue;

      const candidateIndent = match[1].length;
      if (candidateIndent < indent) return null;
      if (candidateIndent === indent) {
        const range = this.getTaskBlockRange(lines, i);
        return range ? { start: range.start, end: range.end } : null;
      }
    }

    return null;
  }

  private findNextSiblingTaskBlock(lines: string[], blockEnd: number, indent: number): { start: number; end: number } | null {
    for (let i = blockEnd + 1; i < lines.length; i++) {
      const match = TASK_LINE_WITH_CONTENT_REGEX.exec(lines[i]);
      if (!match) continue;

      const candidateIndent = match[1].length;
      if (candidateIndent < indent) return null;
      if (candidateIndent === indent) {
        const range = this.getTaskBlockRange(lines, i);
        return range ? { start: range.start, end: range.end } : null;
      }
    }

    return null;
  }

  private isBlankLine(line: string): boolean {
    return line.trim().length === 0;
  }

  private findNextNonBlankLine(lines: string[], startIndex: number): number {
    for (let i = startIndex; i < lines.length; i++) {
      if (!this.isBlankLine(lines[i])) return i;
    }
    return -1;
  }

  private getLeadingWhitespaceLength(line: string): number {
    const match = /^(\s*)/.exec(line);
    return match ? match[1].length : 0;
  }

  private setTaskDeadline(editor: Editor, view: MarkdownView) {
    const cursor = editor.getCursor();
    const line = editor.getLine(cursor.line);
    const match = line.match(TASK_LINE_WITH_CONTENT_REGEX);

    if (!match) {
      new Notice('Cursor is not on a task line');
      return;
    }

    const content = match[3];

    // Extract existing deadline if present. Uses the shared parser so every
    // supported marker form is understood, including legacy notes.
    const existingDeadline = extractDeadline(content) ?? '';

    const { body, footer, close } = openTaskProPanel(existingDeadline ? 'Change Deadline' : 'Set Deadline');

    let useJalali = this.settings.calendarSystem === 'jalali';
    const input = addPanelField(body, 'Deadline', useJalali ? 'text' : 'date');
    input.classList.add('taskpro-panel__input--date');
    
    if (this.settings.calendarSystem === 'jalali') {
      const calendarToggle = body.createDiv({ cls: 'taskpro-panel__toggle-row' });
      
      const jalaliBtn = calendarToggle.createEl('button', { text: 'Jalali', cls: useJalali ? 'mod-cta' : '' });
      const gregorianBtn = calendarToggle.createEl('button', { text: 'Gregorian', cls: !useJalali ? 'mod-cta' : '' });
      
      jalaliBtn.addEventListener('click', () => {
        useJalali = true;
        jalaliBtn.addClass('mod-cta');
        gregorianBtn.removeClass('mod-cta');
        input.type = 'text';
        input.placeholder = 'YYYY/MM/DD (e.g., 1403/01/15)';
      });
      
      gregorianBtn.addEventListener('click', () => {
        useJalali = false;
        gregorianBtn.addClass('mod-cta');
        jalaliBtn.removeClass('mod-cta');
        input.type = 'date';
        input.placeholder = '';
      });
    }
    
    if (existingDeadline) {
      if (useJalali) {
        const [y, m, d] = existingDeadline.split('-').map(Number);
        const [jy, jm, jd] = gregorianToJalali(y, m, d);
        input.value = `${jy}/${String(jm).padStart(2, '0')}/${String(jd).padStart(2, '0')}`;
        input.placeholder = 'YYYY/MM/DD (e.g., 1403/01/15)';
      } else {
        input.value = existingDeadline;
      }
    }

    addPanelButtonRow(footer, {
      cancelLabel: 'Cancel',
      saveLabel: 'Save',
      clearLabel: existingDeadline ? 'Clear Deadline' : undefined,
      onCancel: close,
      onClear: existingDeadline
        ? () => {
            const newLine = this.applyDeadlineToLine(line, null);
            editor.setLine(cursor.line, newLine);
            new Notice('Deadline removed');
            close();
          }
        : undefined,
      onSave: () => {
        if (input.value) {
          let gregorianDate = input.value;

          // Convert Jalali to Gregorian if needed
          if (useJalali) {
            const jalaliMatch = input.value.match(/(\d{4})\/(\d{1,2})\/(\d{1,2})/);
            if (jalaliMatch) {
              const [_, jy, jm, jd] = jalaliMatch.map(Number);
              const [gy, gm, gd] = jalaliToGregorian(jy, jm, jd);
              gregorianDate = `${gy}-${String(gm).padStart(2, '0')}-${String(gd).padStart(2, '0')}`;
            } else {
              new Notice('Invalid Jalali date format. Use YYYY/MM/DD');
              return;
            }
          }

          const newLine = this.applyDeadlineToLine(line, gregorianDate);
          editor.setLine(cursor.line, newLine);
          new Notice(`✓ Deadline set to ${gregorianDate}`);
        }
        close();
      },
    });

    input.focus();
  }

  private async handleFileModification(file: TFile) {
    // Prevent recursive sync calls
    if (this.isProcessingSync) return;

    // Debounce: Clear existing timer and set new one
    const existingTimer = this.syncDebounceTimers.get(file.path);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // Set debounce timer (300ms)
    const timer = setTimeout(async () => {
      // Recurrence first: rolling a completed repeating task forward changes
      // its status, and the sync pass below should see the rolled state.
      await this.rollCompletedRecurringTasks(file);
      await this.processSyncForFile(file);
      this.syncDebounceTimers.delete(file.path);
    }, 300);

    this.syncDebounceTimers.set(file.path, timer);
  }

  private async processSyncForFile(file: TFile) {
    if (this.isProcessingSync) return;

    // Check folder restriction
    if (!this.isFileInTargetFolder(file.path)) {
      return;
    }

    // Check if this file can be a source of synced imported tasks
    const hasImportedMappings = this.settings.taskMappings.some(m => m.importedFilePath === file.path);
    if (!hasImportedMappings) return;

    // Read current content
    const content = await this.ensureOverdueTasksInFile(file);

    const lines = content.split('\n');
    const previousTaskStates = this.fileTaskStates.get(file.path) || new Map<string, TaskStatus>();
    const currentTaskStates = new Map<string, TaskStatus>();
    const changedTasks: Array<{ line: string; status: TaskStatus; blockId?: string }> = [];

    for (const line of lines) {
      const parsedTask = this.parseTaskLine(line);
      if (!parsedTask) continue;

      currentTaskStates.set(parsedTask.key, parsedTask.status);
      const previousStatus = previousTaskStates.get(parsedTask.key);
      if (previousStatus && previousStatus !== parsedTask.status) {
        changedTasks.push(parsedTask);
      }
    }

    this.fileTaskStates.set(file.path, currentTaskStates);

    if (changedTasks.length === 0) return;

    this.isProcessingSync = true;

    try {
      for (const changedTask of changedTasks) {
        const mapping = this.syncManager.findMapping(file.path, changedTask.line, { scope: 'imported', blockId: changedTask.blockId });
        if (!mapping || !mapping.linked) continue;

        await this.syncManager.syncTaskStatus(
          file.path,
          changedTask.line,
          changedTask.status,
          { blockId: changedTask.blockId }
        );
      }
    } finally {
      this.isProcessingSync = false;
    }
  }

  private parseTaskLine(line: string): { line: string; status: TaskStatus; blockId?: string; key: string } | null {
    const match = TASK_LINE_REGEX.exec(line);
    if (!match) return null;

    const status = `[${match[2].toLowerCase()}]` as TaskStatus;
    const blockId = this.extractTaskBlockId(line);
    const key = blockId ? `id:${blockId}` : `text:${this.normalizeTaskContent(line)}`;

    return { line, status, blockId, key };
  }

  private getTaskItemText(item: HTMLElement): string {
    // Walk the live DOM, skipping badge containers — avoids an expensive deep clone
    let text = '';
    const walk = (node: Node) => {
      if (node.nodeType === Node.ELEMENT_NODE) {
        if ((node as HTMLElement).classList.contains('taskpro-badge-container')) return;
        node.childNodes.forEach(walk);
      } else if (node.nodeType === Node.TEXT_NODE) {
        text += node.textContent;
      }
    };
    item.childNodes.forEach(walk);
    return text.trim();
  }

  private findTaskLineIndex(lines: string[], lineContent: string, blockId?: string): number {
    if (blockId) {
      for (let i = 0; i < lines.length; i++) {
        if (this.hasBlockId(lines[i], blockId)) return i;
      }
    }

    // Normalize target once; compare each line against that single value
    const normalized = this.normalizeTaskContent(lineContent);
    for (let i = 0; i < lines.length; i++) {
      if (this.normalizeTaskContent(lines[i]) === normalized) return i;
    }

    return -1;
  }

  private async updateTaskLineInFile(
    file: TFile,
    lineContent: string,
    blockId: string | undefined,
    transformLine: (line: string) => string,
    lineHint?: number
  ): Promise<boolean> {
    let updated = false;

    await this.app.vault.process(file, (content) => {
      const lines = content.split('\n');
      // The hint wins only while that line is still the one the caller saw,
      // which also tells two identical task lines in one note apart.
      const lineIndex =
        lineHint !== undefined && lines[lineHint] === lineContent
          ? lineHint
          : this.findTaskLineIndex(lines, lineContent, blockId);

      if (lineIndex === -1) {
        return content;
      }

      const nextLine = transformLine(lines[lineIndex]);
      if (nextLine === lines[lineIndex]) {
        return content;
      }

      lines[lineIndex] = nextLine;
      updated = true;

      return lines.join('\n');
    });

    return updated;
  }

  private applyDeadlineToLine(line: string, newDeadline: string | null): string {
    // Delegates to the shared writer so the marker format is defined in exactly
    // one place. This used to keep its own copy of the deadline regex and its
    // own way of writing the marker, which is how the two drifted apart.
    return setDeadline(line, newDeadline);
  }

  private async markOverdueTasksAsNotDone(): Promise<void> {
    const markdownFiles = this.app.vault.getMarkdownFiles();
    for (const file of markdownFiles) {
      if (!this.isFileInTargetFolder(file.path)) continue;
      await this.ensureOverdueTasksInFile(file);
    }
  }

  private async ensureOverdueTasksInFile(file: TFile): Promise<string> {
    let latestContent = '';
    let fileChanged = false;

    await this.app.vault.process(file, (content) => {
      latestContent = content;
      const lines = content.split('\n');
      let changed = false;

      const nextLines = lines.map((line) => {
        const match = TASK_LINE_WITH_CONTENT_REGEX.exec(line);
        if (!match) return line;

        const currentStatus = match[2].toLowerCase();
        if (currentStatus === 'x' || currentStatus === '!') return line;

        const deadline = this.extractDeadlineFromLine(match[3]);
        if (!deadline || !this.isDeadlineOverdue(deadline)) return line;

        changed = true;
        return line.replace(TASK_STATUS_REGEX, '- [!]');
      });

      if (!changed) {
        return content;
      }

      fileChanged = true;
      latestContent = nextLines.join('\n');
      return latestContent;
    });

    if (fileChanged) {
      this.refreshDecorations();
      await this.syncOverdueNotDoneTasks(file, latestContent);
    }

    return latestContent;
  }

  private async syncOverdueNotDoneTasks(file: TFile, content: string): Promise<void> {
    const lines = content.split('\n');

    for (const line of lines) {
      const match = TASK_LINE_WITH_CONTENT_REGEX.exec(line);
      if (!match) continue;

      const currentStatus = match[2].toLowerCase();
      if (currentStatus !== '!') continue;

      const deadline = this.extractDeadlineFromLine(match[3]);
      if (!deadline || !this.isDeadlineOverdue(deadline)) continue;

      const blockId = this.extractTaskBlockId(line);
      const mapping = this.syncManager.findMapping(file.path, line, { scope: 'imported', blockId });
      if (!mapping || !mapping.linked) continue;

      await this.syncManager.syncTaskStatus(file.path, line, '[!]', { blockId });
    }
  }

  private extractDeadlineFromLine(line: string): string | undefined {
    // Shared parser: one definition of what a deadline marker looks like.
    return extractDeadline(line);
  }

  private isDeadlineOverdue(deadline: string): boolean {
    const [year, month, day] = deadline.split('-').map(Number);
    if (!year || !month || !day) return false;

    const deadlineDate = new Date(year, month - 1, day);
    deadlineDate.setHours(0, 0, 0, 0);

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return deadlineDate.getTime() < today.getTime();
  }

  private extractTaskBlockId(lineContent: string): string | undefined {
    const blockIdMatch = BLOCK_ID_TAIL_REGEX.exec(lineContent);
    if (blockIdMatch) return blockIdMatch[1];
    const file = this.app.workspace.getActiveFile();
    return file ? this.getStoredBlockId(file.path, lineContent) : undefined;
  }

  private getStoredBlockId(filePath: string, taskContent: string): string | undefined {
    const fileCache = this.taskBlockIds.get(filePath);
    if (!fileCache) return undefined;
    const normalized = this.normalizeTaskContent(taskContent);
    return fileCache.get(normalized);
  }

  private storeBlockId(filePath: string, taskContent: string, blockId: string): void {
    let fileCache = this.taskBlockIds.get(filePath);
    if (!fileCache) {
      fileCache = new Map<string, string>();
      this.taskBlockIds.set(filePath, fileCache);
    }
    const normalized = this.normalizeTaskContent(taskContent);
    fileCache.set(normalized, blockId);
  }

  private removeStoredBlockId(filePath: string, taskContent: string): void {
    const fileCache = this.taskBlockIds.get(filePath);
    if (fileCache) {
      const normalized = this.normalizeTaskContent(taskContent);
      fileCache.delete(normalized);
    }
  }

  private hasBlockId(lineContent: string, blockId: string): boolean {
    // Block IDs are [a-zA-Z0-9-] — no regex needed, indexOf is O(n) and allocation-free
    const idx = lineContent.indexOf('^' + blockId);
    if (idx === -1) return false;
    const after = lineContent[idx + 1 + blockId.length];
    return after === undefined || after === ' ' || after === '\t';
  }

  /**
   * Opens a priority picker for the task under the cursor.
   * Reuses the shared TaskPro panel so it matches the deadline picker.
   */
  private setTaskPriority(editor: Editor) {
    const cursor = editor.getCursor();
    const line = editor.getLine(cursor.line);
    const match = line.match(TASK_LINE_WITH_CONTENT_REGEX);

    if (!match) {
      new Notice('Cursor is not on a task line');
      return;
    }

    const language = this.settings.badgeLanguage;
    const current = extractPriority(match[3]);
    const { body, footer, close } = openTaskProPanel(
      current ? 'Change Priority' : 'Set Priority'
    );

    const applyPriority = (priority: TaskPriority | null) => {
      editor.setLine(cursor.line, setPriority(line, priority));
      this.refreshDecorations();
      close();
    };

    const options = body.createDiv({ cls: 'taskpro-priority-options' });
    for (const level of TASK_PRIORITIES) {
      const button = options.createEl('button', {
        cls: `taskpro-priority-option${current === level ? ' mod-cta' : ''}`,
      });
      const buttonIcon = button.createSpan({ cls: 'taskpro-chip__icon' });
      buttonIcon.setAttribute('aria-hidden', 'true');
      setIcon(buttonIcon, PRIORITY_ICON_NAMES[level]);
      button.createSpan({ text: PRIORITY_LABELS[language][level] });
      button.setAttribute('data-priority', level);
      button.addEventListener('click', () => applyPriority(level));
    }

    addPanelButtonRow(footer, {
      cancelLabel: 'Cancel',
      saveLabel: 'Close',
      clearLabel: current ? 'Clear Priority' : undefined,
      onCancel: close,
      onSave: close,
      onClear: current ? () => applyPriority(null) : undefined,
    });

    options.querySelector<HTMLElement>('button')?.focus();
  }

  private normalizeTaskContent(content: string): string {
    return stripTaskMetadata(content)
      .replace(/^(\s*)- \[([ \/xX!])\]\s*/, '')
      .replace(/\^[a-zA-Z0-9-]+\s*$/, '')
      .trim()
      .toLowerCase();
  }

  private rebuildBlockIdCache(): void {
    for (const mapping of this.settings.taskMappings) {
      if (mapping.importedBlockId && mapping.importedFilePath && mapping.importedLineContent) {
        this.storeBlockId(mapping.importedFilePath, mapping.importedLineContent, mapping.importedBlockId);
      }
    }
  }

  private async migrateStripInlineBlockIds(): Promise<void> {
    // Build a fast lookup: filePath -> Set<blockId> for O(1) membership checks
    const mappingIds = new Map<string, Set<string>>();
    const mappingsByImportedId = new Map<string, TaskMapping[]>();
    for (const m of this.settings.taskMappings) {
      if (!m.importedBlockId || !m.importedFilePath) continue;
      let ids = mappingIds.get(m.importedFilePath);
      if (!ids) { ids = new Set(); mappingIds.set(m.importedFilePath, ids); }
      ids.add(m.importedBlockId);

      const mappingKey = this.getTaskIdentityKey(m.importedFilePath, m.importedBlockId);
      let mappings = mappingsByImportedId.get(mappingKey);
      if (!mappings) {
        mappings = [];
        mappingsByImportedId.set(mappingKey, mappings);
      }
      mappings.push(m);
    }

    let mappingsChanged = false;

    for (const [filePath, ids] of mappingIds) {
      const file = this.app.vault.getFileByPath(filePath);
      if (!file) continue;

      let fileChanged = false;

      await this.app.vault.process(file, (content) => {
        const lines = content.split('\n');
        const newLines = lines.map((line) => {
          const blockIdMatch = MIGRATE_BLOCK_ID_REGEX.exec(line);
          if (!blockIdMatch) return line;

          const blockId = blockIdMatch[2];
          if (!ids.has(blockId)) return line;

          const strippedLine = blockIdMatch[1];
          fileChanged = true;

          const matchingMappings = mappingsByImportedId.get(this.getTaskIdentityKey(filePath, blockId)) || [];
          for (const m of matchingMappings) {
            m.importedLineContent = strippedLine.trim();
            mappingsChanged = true;
          }

          this.storeBlockId(filePath, strippedLine.trim(), blockId);
          return strippedLine;
        });

        return fileChanged ? newLines.join('\n') : content;
      });
    }

    // Mark done so this never runs again
    this.settings.blockIdMigrationDone = true;
    await this.saveSettings();
  }

  private recordTaskState(filePath: string, lineContent: string, blockId: string | undefined, status: TaskStatus) {
    const states = this.fileTaskStates.get(filePath) || new Map<string, TaskStatus>();
    const key = blockId ? `id:${blockId}` : `text:${this.normalizeTaskContent(lineContent)}`;
    states.set(key, status);
   this.fileTaskStates.set(filePath, states);
 }

  async handleProgressUpdate(
    filePath: string,
    lineContent: string,
    blockId: string | undefined,
    newProgress: TaskProgress | null
  ): Promise<void> {
    const resolvedFilePath = filePath || this.app.workspace.getActiveFile()?.path || '';
    if (!resolvedFilePath) return;

    const mapping = this.syncManager.findMapping(resolvedFilePath, lineContent, {
      scope: 'imported',
      blockId,
    });

    const effectiveBlockId = await this.ensureTaskBlockId(
      resolvedFilePath,
      lineContent,
      blockId,
      newProgress !== null
    );

    if (!effectiveBlockId) {
      if (newProgress) {
        console.warn('TaskPro: Cannot save progress without block ID');
      }
      return;
    }

    await this.saveTaskProgress(resolvedFilePath, effectiveBlockId, newProgress);
    this.refreshDecorations();

    if (newProgress && newProgress.currentSteps === newProgress.totalSteps) {
      const file = this.app.vault.getFileByPath(resolvedFilePath);
      if (file) {
        await this.updateTaskLineInFile(
          file,
          lineContent,
          effectiveBlockId,
          (content) => content.replace(TASK_STATUS_REGEX, `- [x]`)
        );
        this.recordTaskState(resolvedFilePath, lineContent, effectiveBlockId, '[x]');
        if (mapping?.linked) {
          await this.syncManager.syncTaskStatus(resolvedFilePath, lineContent, '[x]', {
            blockId: effectiveBlockId,
          });
        }
      }
    }

    if (mapping?.linked) {
      await this.syncManager.syncTaskProgress(resolvedFilePath, lineContent, newProgress, {
        blockId: effectiveBlockId,
      });
      if (mapping.sourceBlockId) {
        await this.saveTaskProgress(mapping.sourceFilePath, mapping.sourceBlockId, newProgress);
      }
    }
  }

  /**
   * Attaches, edits, or removes a task's focus timer.
   *
   * A timer is keyed by block ID like progress is, so a task that has never
   * been given one gets a block ID written first — otherwise there is nothing
   * stable to hang the timer on when the line's text later changes.
   */
  async handleTimerUpdate(
    filePath: string,
    lineContent: string,
    blockId: string | undefined,
    newTimer: TaskTimer | null
  ): Promise<void> {
    const resolvedFilePath = filePath || this.app.workspace.getActiveFile()?.path || '';
    if (!resolvedFilePath) return;

    const effectiveBlockId = await this.ensureTaskBlockId(
      resolvedFilePath,
      lineContent,
      blockId,
      newTimer !== null
    );
    if (!effectiveBlockId) return;

    // Carry the task's own text so a finished timer can name it.
    const labelled = newTimer
      ? { ...newTimer, label: newTimer.label ?? this.taskTitle(lineContent) }
      : null;

    await this.timerService.set(resolvedFilePath, effectiveBlockId, labelled);
    this.refreshDecorations();
  }

  /**
   * Writes the recurrence rule into the task line itself, so it travels with
   * the task rather than living in plugin storage.
   */
  async handleRepeatUpdate(
    filePath: string,
    lineContent: string,
    blockId: string | undefined,
    newRepeat: TaskRepeat | null,
    lineHint?: number
  ): Promise<void> {
    const resolvedFilePath = filePath || this.app.workspace.getActiveFile()?.path || '';
    if (!resolvedFilePath) return;

    const mapping = this.syncManager.findMapping(resolvedFilePath, lineContent, {
      scope: 'imported',
      blockId,
    });
    const effectiveBlockId = blockId || mapping?.importedBlockId;

    const file = this.app.vault.getFileByPath(resolvedFilePath);
    if (!file) return;

    const updated = await this.updateTaskLineInFile(
      file,
      lineContent,
      effectiveBlockId,
      (content) => setRepeat(content, newRepeat),
      lineHint
    );
    if (updated) this.refreshDecorations();
  }

  /**
   * Rolls every completed repeating task in a file forward: the deadline moves
   * to the next occurrence, the status goes back to "not started", and any
   * progress bar or focus timer on the task resets with it.
   *
   * Runs over the whole file rather than a single line so it also catches a
   * task ticked off by typing `[x]` by hand, which no popover callback sees.
   */
  private async rollCompletedRecurringTasks(file: TFile): Promise<void> {
    if (!this.isFileInTargetFolder(file.path)) return;

    const content = await this.app.vault.cachedRead(file);
    if (!content.includes('@repeat(')) return;

    /**
     * Rewrites one completed repeating line, or returns null to leave it be.
     * A plan moves on with the task, by the same interval, keeping its time:
     * a weekly 09:00 slot stays a weekly 09:00 slot. A task with a plan and no
     * deadline repeats by its plan alone and is not given a deadline.
     */
    const roll = (line: string): { line: string; nextDate: string; nextDeadline?: string } | null => {
      const match = TASK_LINE_REGEX.exec(line);
      if (!match || match[2].toLowerCase() !== 'x') return null;

      const repeat = extractRepeat(line);
      if (!repeat) return null;

      const deadline = extractDeadline(line);
      const schedule = extractSchedule(line);
      let reopened = line.replace(TASK_STATUS_REGEX, '- [ ]');
      let nextDeadline: string | undefined;
      if (deadline || !schedule) {
        nextDeadline = nextRepeatDate(repeat, deadline);
        reopened = setDeadline(reopened, nextDeadline);
      }
      let nextPlan: string | undefined;
      if (schedule) {
        nextPlan = nextRepeatDate(repeat, schedule.date);
        reopened = setSchedule(reopened, { ...schedule, date: nextPlan });
      }
      const nextDate = nextDeadline ?? nextPlan!;
      return reopened === line ? null : { line: reopened, nextDate, nextDeadline };
    };

    // The write below fires another `modify`, which lands back here. That pass
    // finds no completed repeating tasks (they are `[ ]` now) and never reaches
    // vault.process, so the cycle stops after one write. Checking before
    // writing is what keeps it from becoming a ping-pong.
    if (!content.split('\n').some((line) => roll(line) !== null)) return;

    const rolled: Array<{ line: string; blockId?: string; nextDate: string; nextDeadline?: string }> = [];

    await this.app.vault.process(file, (current) => {
      const lines = current.split('\n');
      let changed = false;

      for (let i = 0; i < lines.length; i++) {
        const next = roll(lines[i]);
        if (!next) continue;

        rolled.push({
          line: next.line,
          blockId: this.extractTaskBlockId(next.line),
          nextDate: next.nextDate,
          nextDeadline: next.nextDeadline,
        });
        lines[i] = next.line;
        changed = true;
      }

      return changed ? lines.join('\n') : current;
    });

    if (!rolled.length) return;

    for (const entry of rolled) {
      // Recording the rolled state first stops the sync pass that follows from
      // reading the roll as a status change the user made.
      this.recordTaskState(file.path, entry.line, entry.blockId, '[ ]');
      if (!entry.blockId) continue;

      // A fresh occurrence starts from zero on both of the other capabilities.
      const progress = this.getTaskProgress(file.path, entry.blockId);
      if (progress?.enabled) {
        await this.saveTaskProgress(file.path, entry.blockId, {
          ...progress,
          currentSteps: 0,
        });
      }
      const timer = this.timerService.get(file.path, entry.blockId);
      if (timer?.enabled) await this.timerService.reset(file.path, entry.blockId, timer);

      // A linked copy has to advance with this one; syncing the completion
      // instead would leave the source stuck on a tick that no longer stands.
      const mapping = this.syncManager.findMapping(file.path, entry.line, {
        scope: 'imported',
        blockId: entry.blockId,
      });
      if (mapping?.linked) {
        if (entry.nextDeadline) {
          await this.syncManager.syncTaskDeadline(file.path, entry.line, entry.nextDeadline, {
            blockId: entry.blockId,
          });
        }
        await this.syncManager.syncTaskStatus(file.path, entry.line, '[ ]', {
          blockId: entry.blockId,
        });
        if (mapping.sourceBlockId && progress?.enabled) {
          await this.saveTaskProgress(mapping.sourceFilePath, mapping.sourceBlockId, {
            ...progress,
            currentSteps: 0,
          });
        }
      }
    }

    const labels = getRepeatLabels(this.settings.badgeLanguage);
    new Notice(labels.rolledForward(rolled[0].nextDate));
    this.refreshDecorations();
  }

  /**
   * Returns a block ID for a task, writing a fresh one into the line when the
   * task does not have one yet. Capabilities stored outside the note (progress,
   * timers) need this anchor; callers that are only reading pass create=false.
   */
  /**
   * A task line reduced to its readable title: no marker, no metadata, no block
   * ID. Unlike normalizeTaskContent (which builds a lookup key and lowercases),
   * this preserves the user's own capitalisation because it is shown to them.
   */
  private taskTitle(lineContent: string): string {
    const match = TASK_LINE_WITH_CONTENT_REGEX.exec(lineContent ?? '');
    const body = match ? match[3] : (lineContent ?? '').replace(/^\s*- \[[ \/xX!]\]\s*/, '');
    return stripTaskMetadata(body)
      .replace(BLOCK_ID_TAIL_REGEX, '')
      .trim();
  }

  /** The task line under the cursor, or a Notice explaining why there isn't one. */
  private taskAtCursor(
    editor: Editor,
    ctx: MarkdownView | MarkdownFileInfo
  ): { line: string; lineNumber: number; blockId?: string; filePath: string } | null {
    const lineNumber = editor.getCursor().line;
    const line = editor.getLine(lineNumber);
    if (!TASK_LINE_WITH_CONTENT_REGEX.test(line)) {
      new Notice('Cursor is not on a task line');
      return null;
    }

    const filePath = ctx.file?.path ?? this.app.workspace.getActiveFile()?.path ?? '';
    if (!filePath) return null;
    if (!this.isFileInTargetFolder(filePath)) {
      new Notice('This file is outside the target folder restriction');
      return null;
    }

    return { line, lineNumber, blockId: this.extractTaskBlockId(line), filePath };
  }

  private async ensureTaskBlockId(
    filePath: string,
    lineContent: string,
    blockId: string | undefined,
    create: boolean
  ): Promise<string | undefined> {
    const mapping = this.syncManager.findMapping(filePath, lineContent, {
      scope: 'imported',
      blockId,
    });
    let effectiveBlockId = blockId || mapping?.importedBlockId;
    if (effectiveBlockId || !create) return effectiveBlockId;

    effectiveBlockId = generateBlockId();
    const file = this.app.vault.getFileByPath(filePath);
    if (!file) return undefined;

    const written = await this.updateTaskLineInFile(
      file,
      lineContent,
      undefined,
      (content) => content.trimEnd() + ` ^${effectiveBlockId}`
    );
    return written ? effectiveBlockId : undefined;
  }

  // Get progress for a task (settings storage, with optional inline marker fallback)
  getTaskProgress(filePath: string, blockId?: string, lineContent?: string): TaskProgress | undefined {
    if (blockId) {
      const progress = this.taskProgressCache.get(this.getProgressCacheKey(filePath, blockId));
      if (progress) return progress;
    }

    if (lineContent) {
      return extractProgress(lineContent);
    }

    return undefined;
  }

  // Save progress for a task
  async saveTaskProgress(
    filePath: string, 
    blockId: string | undefined, 
    progress: import('./src/types').TaskProgress | null
  ): Promise<void> {
    if (!blockId) {
      console.warn('TaskPro: Cannot save progress without block ID');
      return;
    }

    // Remove existing entry
    this.settings.taskProgress = this.settings.taskProgress.filter(
      p => !(p.filePath === filePath && p.blockId === blockId)
    );
    this.taskProgressCache.delete(this.getProgressCacheKey(filePath, blockId));

    // Add new entry if progress is not null
    if (progress && progress.enabled) {
      this.settings.taskProgress.push({
        filePath,
        blockId,
        progress
      });
      this.taskProgressCache.set(this.getProgressCacheKey(filePath, blockId), progress);
    }

    // Save settings
    await this.saveData(this.settings);
  }

  onunload() {
    useKeymapOf(null);
    // Clear all debounce timers
    this.syncDebounceTimers.forEach(timer => clearTimeout(timer));
    this.fileTaskStates.clear();
    // The embed-visibility class is set on document.body in onload, so it has
    // to come back off here — otherwise disabling the plugin leaves the vault
    // styled by a plugin that is no longer running.
    document.body.removeClass('taskpro-hide-badges-in-embeds');
    // Release the reminder ticker, overlay and audio nodes
    this.reminderService?.stop();
    this.planReminders?.destroy();
    this.telegramSync?.stop();
    this.taskIndexService?.stop();
    // Closing the float also takes its class back off <body>, so a theme's
    // blur never outlives the plugin.
    this.floatingBoard?.close();
    this.taskStore?.destroy();
    this.timerService?.destroy();
  }

  private rebuildProgressCache(): void {
    this.taskProgressCache.clear();
    for (const entry of this.settings.taskProgress || []) {
      if (entry.filePath && entry.blockId && entry.progress?.enabled) {
        this.taskProgressCache.set(this.getProgressCacheKey(entry.filePath, entry.blockId), entry.progress);
      }
    }
  }

  private getProgressCacheKey(filePath: string, blockId: string): string {
    return `${filePath}:${blockId}`;
  }

  private getTaskIdentityKey(filePath: string, blockId: string): string {
    return `${filePath}:${blockId}`;
  }
}
