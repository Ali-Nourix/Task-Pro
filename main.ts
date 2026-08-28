// ── main.ts ───────────────────────────────────────────────────────────────
// TaskPro - Main plugin entry point
// ─────────────────────────────────────────────────────────────────────────────

import { Plugin, Editor, MarkdownView, Notice, TFile, setIcon } from 'obsidian';
import { EditorView } from '@codemirror/view';
import {
  TaskProSettings,
  DEFAULT_SETTINGS,
  DEFAULT_REMINDER_SETTINGS,
  TaskStatus,
  TaskMapping,
  TaskProgress,
  TaskPriority,
  TASK_PRIORITIES,
  PRIORITY_ICON_NAMES,
  PRIORITY_LABELS,
} from './src/types';
import { jalaliToGregorian, gregorianToJalali } from './src/date-utils';
import { TaskProSettingTab } from './src/settings';
import { TaskImportModal } from './src/import-modal';
import { SyncManager } from './src/sync-manager';
import { createTaskBadgePlugin, forceDecorationsRefresh } from './src/decorations';
import { createReadingModeProcessor } from './src/reading-mode-processor';
import {
  extractDeadline,
  extractProgress,
  extractPriority,
  setDeadline,
  setPriority,
  stripDeadline,
  stripPriority,
  stripProgress,
} from './src/task-metadata';
import { ReminderService } from './src/reminders/reminder-service';
import { TaskCreationRegistry } from './src/task-registry';
import { TaskIndexService } from './src/task-index-service';
import { getReminderLabels } from './src/reminders/reminder-localization';
import { generateBlockId } from './src/task-parser';
import { addPanelButtonRow, addPanelField, openTaskProPanel } from './src/ui/panel';

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
  /** Hidden index of when each task was first seen. Never rendered anywhere. */
  taskRegistry!: TaskCreationRegistry;
  taskIndexService!: TaskIndexService;
  private isProcessingSync = false;
  private syncDebounceTimers = new Map<string, NodeJS.Timeout>(); // Debounce timers per file
  private fileTaskStates = new Map<string, Map<string, TaskStatus>>(); // Track task states per file
  private taskBlockIds = new Map<string, Map<string, string>>(); // Store block IDs: filePath -> (taskContent -> blockId)
  private taskProgressCache = new Map<string, TaskProgress>(); // Fast lookup: filePath:blockId -> progress

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

    // Register CodeMirror 6 extension for Live Preview badges
    this.registerEditorExtension(
     createTaskBadgePlugin(
       this.app,
        () => ({ enableBadges: this.settings.enableBadges, badgeLanguage: this.settings.badgeLanguage, badgeSize: this.settings.badgeSize, targetFolder: this.settings.targetFolder, calendarSystem: this.settings.calendarSystem, showPriorityBadges: this.settings.showPriorityBadges }),
        (filePath: string, blockId?: string) => this.getTaskProgress(filePath, blockId),
        (filePath: string, lineContent: string) => this.getStoredBlockId(filePath, lineContent)
     )
   );

    // Register Reading Mode processor for badges
    this.registerMarkdownPostProcessor(
     createReadingModeProcessor(
       this.app,
        () => ({ enableBadges: this.settings.enableBadges, badgeLanguage: this.settings.badgeLanguage, badgeSize: this.settings.badgeSize, showBadgesInEmbeds: this.settings.showBadgesInEmbeds, targetFolder: this.settings.targetFolder, calendarSystem: this.settings.calendarSystem, showPriorityBadges: this.settings.showPriorityBadges }),
        (filePath: string, blockId?: string) => this.getTaskProgress(filePath, blockId),
        (filePath: string, lineContent: string) => this.getStoredBlockId(filePath, lineContent)
     )
   );

    // Listen for badge clicks to open popover
    this.registerDomEvent(document.body, 'taskpro-badge-click' as keyof HTMLElementEventMap, (evt: Event) => {
      const customEvt = evt as CustomEvent;
      const { status, deadline, lineContent, filePath, targetElement, blockId, tags } = customEvt.detail;
      // The chip may not carry the priority (e.g. status chip on an older render),
      // so fall back to re-reading it from the line itself.
      const priority: TaskPriority | undefined = customEvt.detail.priority ?? extractPriority(lineContent ?? '');
     const activeFilePath = this.app.workspace.getActiveFile()?.path || '';
     const resolvedFilePath = filePath || activeFilePath;
     
      // Get progress from stored data
      const progress = this.getTaskProgress(resolvedFilePath, blockId);
     
      // Find task mapping if it exists
      const mapping = resolvedFilePath
        ? this.syncManager.findMapping(resolvedFilePath, lineContent, { scope: 'imported', blockId })
        : undefined;
      
      // Import TaskPopover dynamically
      import('./src/task-popover').then(({ TaskPopover }) => {
        const popover = new TaskPopover({
          app: this.app,
          targetElement,
          taskMapping: mapping,
          language: this.settings.badgeLanguage,  // ← این خط رو اضافه کن
          deadline,
          status,
          blockId,
          tags,
          progress,
          priority,
          calendarSystem: this.settings.calendarSystem,
          onToggleSync: async (enabled) => {
            if (mapping) {
              await this.syncManager.setLinkState(resolvedFilePath, lineContent, enabled, { scope: 'imported', blockId });
            }
          },
          onStatusChange: async (newStatus) => {
            const effectiveBlockId = blockId || mapping?.importedBlockId;
            // Update status in current file
            const file = this.app.vault.getAbstractFileByPath(resolvedFilePath);
            if (file instanceof TFile) {
              const updated = await this.updateTaskLineInFile(
                file,
                lineContent,
                effectiveBlockId,
                (content) => content.replace(TASK_STATUS_REGEX, `- ${newStatus}`)
              );
              if (updated) {
                if (resolvedFilePath) {
                  this.recordTaskState(resolvedFilePath, lineContent, effectiveBlockId, newStatus);
                }
                this.refreshDecorations();
              }
            }

            // Sync to source if linked
            if (mapping && mapping.linked) {
              await this.syncManager.syncTaskStatus(resolvedFilePath, lineContent, newStatus, { blockId: effectiveBlockId });
            }
          },
          onDeadlineChange: async (newDeadline: string | null) => {
            const effectiveBlockId = blockId || mapping?.importedBlockId;
            // Update deadline in current file
            const file = this.app.vault.getAbstractFileByPath(resolvedFilePath);
            if (file instanceof TFile) {
              const updated = await this.updateTaskLineInFile(
                file,
                lineContent,
                effectiveBlockId,
                (content) => this.applyDeadlineToLine(content, newDeadline)
              );
              if (updated) {
                this.refreshDecorations();
              }
            }

            // Sync deadline to source if linked
            if (mapping && mapping.linked) {
              await this.syncManager.syncTaskDeadline(resolvedFilePath, lineContent, newDeadline, { blockId: effectiveBlockId });
            }
         },
         onPriorityChange: async (newPriority) => {
            const effectiveBlockId = blockId || mapping?.importedBlockId;
            const file = this.app.vault.getAbstractFileByPath(resolvedFilePath);
            if (file instanceof TFile) {
              const updated = await this.updateTaskLineInFile(
                file,
                lineContent,
                effectiveBlockId,
                (content) => setPriority(content, newPriority)
              );
              if (updated) {
                this.refreshDecorations();
              }
            }

            // Sync priority to source if linked
            if (mapping && mapping.linked) {
              await this.syncManager.syncTaskPriority(resolvedFilePath, lineContent, newPriority, { blockId: effectiveBlockId });
            }
          },
         onProgressChange: async (newProgress) => {
            await this.handleProgressUpdate(resolvedFilePath, lineContent, blockId, newProgress);
          }
        });
        popover.show();
      });
    });

    // Listen for progress badge clicks to open progress popover
    this.registerDomEvent(document.body, 'taskpro-progress-click' as keyof HTMLElementEventMap, (evt: Event) => {
      const customEvt = evt as CustomEvent;
      const { lineContent, filePath, targetElement, blockId, currentSteps, totalSteps, language } = customEvt.detail;
      const resolvedFilePath = filePath || this.app.workspace.getActiveFile()?.path || '';

      const progress: TaskProgress = {
        enabled: true,
        currentSteps,
        totalSteps,
      };

      import('./src/progress-popover').then(({ TaskProgressPopover }) => {
        const popover = new TaskProgressPopover({
          app: this.app,
          targetElement,
          progress,
          language: language || this.settings.badgeLanguage,
          onProgressChange: async (newProgress) => {
            await this.handleProgressUpdate(resolvedFilePath, lineContent, blockId, newProgress);
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

    // Daily / periodic reminders
    this.reminderService = new ReminderService({
      app: this.app,
      plugin: this,
      getSettings: () => this.settings,
      saveSettings: () => this.saveSettings(),
      getTaskRegistry: () => this.taskRegistry,
    });

    // Keep the hidden creation index in step with the vault so task ages
    // survive renames and deleted notes do not leak stale records.
    this.registerEvent(
      this.app.vault.on('rename', (file, oldPath) => {
        if (file instanceof TFile) {
          this.taskIndexService.handleFileRenamed(file, oldPath);
        }
      })
    );
    this.registerEvent(
      this.app.vault.on('delete', (file) => {
        if (file instanceof TFile) {
          this.taskIndexService.handleFileDeleted(file.path);
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

    console.log('TaskPro loaded');
  }

  async loadSettings() {
    const saved = await this.loadData();
    this.settings = Object.assign({}, DEFAULT_SETTINGS, saved);

    // Reminder settings are a nested object: merge them field by field so
    // newly added options get their defaults, and always work on a copy so the
    // shared DEFAULT_REMINDER_SETTINGS constant can never be mutated.
    this.settings.reminders = Object.assign({}, DEFAULT_REMINDER_SETTINGS, saved?.reminders);

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
    transformLine: (line: string) => string
  ): Promise<boolean> {
    let updated = false;

    await this.app.vault.process(file, (content) => {
      const lines = content.split('\n');
      const lineIndex = this.findTaskLineIndex(lines, lineContent, blockId);

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
    return stripPriority(stripProgress(stripDeadline(content)))
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
      const file = this.app.vault.getAbstractFileByPath(filePath);
      if (!(file instanceof TFile)) continue;

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

    let effectiveBlockId = blockId || mapping?.importedBlockId;

    if (!effectiveBlockId && newProgress) {
      effectiveBlockId = generateBlockId();
      const file = this.app.vault.getAbstractFileByPath(resolvedFilePath);
      if (file instanceof TFile) {
        await this.updateTaskLineInFile(
          file,
          lineContent,
          undefined,
          (content) => content.trimEnd() + ` ^${effectiveBlockId}`
        );
      }
    }

    if (!effectiveBlockId) {
      if (newProgress) {
        console.warn('TaskPro: Cannot save progress without block ID');
      }
      return;
    }

    await this.saveTaskProgress(resolvedFilePath, effectiveBlockId, newProgress);
    this.refreshDecorations();

    if (newProgress && newProgress.currentSteps === newProgress.totalSteps) {
      const file = this.app.vault.getAbstractFileByPath(resolvedFilePath);
      if (file instanceof TFile) {
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
    // Clear all debounce timers
    this.syncDebounceTimers.forEach(timer => clearTimeout(timer));
    this.fileTaskStates.clear();
    // Release the reminder ticker, overlay and audio nodes
    this.reminderService?.stop();
    this.taskIndexService?.stop();
    console.log('TaskPro unloaded');
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
