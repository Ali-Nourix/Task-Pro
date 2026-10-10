// ── import-modal.ts ───────────────────────────────────────────────────────
// Modal for importing tasks from reference note
// ─────────────────────────────────────────────────────────────────────────────

import { App, Editor, FuzzySuggestModal, Notice } from 'obsidian';
import { ParsedTask, GlobalInternalTask, TaskMapping, TaskProgress } from './types';
import { parseTasksWithHierarchy, flattenTasks, taskToMarkdown, generateBlockId } from './task-parser';
import { CalendarSystem } from './types';
import { extractProgress, setDeadline } from './task-metadata';
import { TaskConfigModal } from './task-config-modal';

interface TaskOption {
  task: ParsedTask | GlobalInternalTask;
  displayText: string;
  isGlobal: boolean;
  sourceFile?: string;
}

export class TaskImportModal extends FuzzySuggestModal<TaskOption> {
  private allItems: TaskOption[] = [];

  constructor(
    app: App,
    private editor: Editor,
    private referenceNotePath: string,
    private globalTasks: GlobalInternalTask[],
    private calendarSystem: CalendarSystem,
    private onImport: (mapping: TaskMapping) => void,
    private getTaskProgress?: (filePath: string, blockId?: string, lineContent?: string) => TaskProgress | undefined,
    private saveTaskProgress?: (filePath: string, blockId: string, progress: TaskProgress | null) => Promise<void>,
    private storeBlockId?: (filePath: string, taskContent: string, blockId: string) => void,
    private onAfterImport?: () => void
  ) {
    super(app);
    this.loadItems();
  }

  async onOpen() {
    super.onOpen();
    // Wait for items to load before showing
    await this.loadItems();
    // Trigger a refresh of the suggestions
    this.inputEl.dispatchEvent(new Event('input'));
  }

  private async loadItems() {
    const items: TaskOption[] = [];

    // Add global internal tasks
    for (const task of this.globalTasks) {
      items.push({
        task,
        displayText: `[Global] ${task.content}`,
        isGlobal: true,
      });
    }

    // Parse reference note
    const refFile = this.app.vault.getFileByPath(this.referenceNotePath);
    
    if (!refFile) {
      new Notice(`Reference note not found: ${this.referenceNotePath}`);
      this.allItems = items;
      return;
    }
    
    if (refFile) {
      const content = await this.app.vault.read(refFile);
      const tasks = parseTasksWithHierarchy(content);
      
      console.log("TaskPro: Parsed tasks from reference note:");

      for (const task of tasks) {
        items.push({
          task,
          displayText: task.content,
          isGlobal: false,
          sourceFile: this.referenceNotePath,
        });
      }
    } else {
      new Notice(`Reference path is not a file: ${this.referenceNotePath}`);
    }

    this.allItems = items;
  }

  getItems(): TaskOption[] {
    return this.allItems;
  }

  getItemText(item: TaskOption): string {
    return item.displayText;
  }

  async onChooseItem(item: TaskOption): Promise<void> {
    // Open unified config modal
    const task = item.task;
    const isGlobal = item.isGlobal;
    const sourceFile = item.sourceFile;

    const configModal = new TaskConfigModal(this.app, {
      task,
      isGlobal,
      sourceFile,
      editor: this.editor,
      allowLinkToggle: !item.isGlobal,
      calendarSystem: this.calendarSystem,
      onImport: async (config) => {
        await this.handleImport(config, item);
      },
    });
    
    configModal.open();
  }

  private async handleImport(
   config: { deadline?: string; linked: boolean },
   item: TaskOption
 ) {
   const { task, isGlobal, sourceFile } = item;
   const activeFile = this.app.workspace.getActiveFile();
   if (!activeFile) {
     new Notice('No active file');
     return;
   }

   const cursor = this.editor.getCursor();
   let markdown = '';
   const mappings: TaskMapping[] = [];

   if ('lineNumber' in task) {
     const parsedTask = task as ParsedTask;

     // Capture source block IDs before generating imported IDs.
     const sourceBlockIdByLine = new Map<number, string | undefined>();
     for (const t of flattenTasks([parsedTask])) {
       sourceBlockIdByLine.set(t.lineNumber, t.blockId);
     }
     
     // Ensure block IDs exist for parent and all subtasks
     this.ensureBlockIds(parsedTask);
     
      // Store deadline separately - don't embed in markdown
      const userDeadline = config.deadline;
     
     markdown = taskToMarkdown(parsedTask, '', false); // Don't include block IDs inline
      
      // If user provided a deadline, append it to the first line only
      if (userDeadline) {
        const lines = markdown.split('\n');
        if (lines[0]) {
          lines[0] = setDeadline(lines[0], userDeadline);
        }
        markdown = lines.join('\n');
      }

      // Block IDs are now stored in cache, not inline
      
      // Create mappings for parent and ALL subtasks
    if (!isGlobal && sourceFile) {
       // Read source file to get original line content
       const sourceFileObj = this.app.vault.getFileByPath(sourceFile);
       let sourceContent = '';
       if (sourceFileObj) {
         sourceContent = await this.app.vault.read(sourceFileObj);
       }
       const sourceLines = sourceContent.split('\n');
       
      const allTasks = flattenTasks([parsedTask]);
      
      for (const t of allTasks) {
         // Build the actual line content that will be in the file
         let taskLine = taskToMarkdown(t, '', false).split('\n')[0].trim(); // Don't include block IDs inline
         
         // Add deadline to first task (parent) if user provided one
         if (t === parsedTask && userDeadline) {
           taskLine = setDeadline(taskLine, userDeadline);
         }

         // Store block ID in cache instead of inline
         if (t.blockId && this.storeBlockId) {
           this.storeBlockId(activeFile.path, taskLine, t.blockId);
         }
         
         // Get original source line from source file
         let sourceLineContent = taskLine; // fallback
         if (t.lineNumber !== undefined && sourceLines[t.lineNumber]) {
           sourceLineContent = sourceLines[t.lineNumber].trim();
         }
        
        mappings.push({
          linked: config.linked,
          importedFilePath: activeFile.path,
          importedLineContent: taskLine,
          importedBlockId: t.blockId,
          sourceFilePath: sourceFile,
           sourceLineContent: sourceLineContent,
          sourceBlockId: sourceBlockIdByLine.get(t.lineNumber),
          lastSynced: Date.now(),
          indentation: t.indentation,
        });
      }
    }
    } else {
      // Global task
      const globalTask = task as GlobalInternalTask;
      markdown = `- ${globalTask.status} ${globalTask.content}`;
      
      const finalDeadline = config.deadline || globalTask.deadline;
      if (finalDeadline) {
        markdown = setDeadline(markdown, finalDeadline);
      }
      
      markdown += '\n';
      
      if (globalTask.subtasks) {
        for (const subtask of globalTask.subtasks) {
          markdown += `  - ${subtask.status} ${subtask.content}\n`;
        }
      }
    }

    

    // Insert at cursor
    this.editor.replaceRange(markdown, cursor);

    // Copy progress from source tasks into imported file storage
    if (this.saveTaskProgress && !isGlobal && sourceFile && 'lineNumber' in task) {
      const parsedTask = task as ParsedTask;
      const sourceFileObj = this.app.vault.getFileByPath(sourceFile);
      let sourceLines: string[] = [];
      if (sourceFileObj) {
        sourceLines = (await this.app.vault.read(sourceFileObj)).split('\n');
      }

      for (const t of flattenTasks([parsedTask])) {
        if (!t.blockId) continue;

        let sourceLine = '';
        if (t.lineNumber !== undefined && sourceLines[t.lineNumber]) {
          sourceLine = sourceLines[t.lineNumber].trim();
        }

        const prog =
          (t.progress?.enabled ? t.progress : undefined) ??
          this.getTaskProgress?.(sourceFile, t.blockId, sourceLine) ??
          (sourceLine ? extractProgress(sourceLine) : undefined);

        if (prog?.enabled) {
          await this.saveTaskProgress(activeFile.path, t.blockId, prog);
        }
      }
    }
    
    // Add all mappings
    if (mappings.length > 0) {
      for (const mapping of mappings) {
        this.onImport(mapping);
      }
    }

    this.onAfterImport?.();
    new Notice(`Imported task${mappings.length > 1 ? ' with ' + (mappings.length - 1) + ' subtask(s)' : ''}`);
  }

  private ensureBlockIds(task: ParsedTask) {
    if (!task.blockId) {
      task.blockId = generateBlockId();
    }
    for (const subtask of task.subtasks) {
      this.ensureBlockIds(subtask);
    }
  }

  private ensureTaskBlockId(lineContent: string, blockId: string | undefined): string {
    const withoutId = lineContent.replace(/\s*\^([a-zA-Z0-9-]+)\s*$/, '').trim();
    if (!blockId) return withoutId;
    return `${withoutId} ^${blockId}`;
  }


}
