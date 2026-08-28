// ── task-parser.ts ────────────────────────────────────────────────────────
// Parse and manipulate task structures
// ─────────────────────────────────────────────────────────────────────────────

import { ParsedTask, TaskStatus } from './types';
import {
  extractDeadline,
  stripDeadline,
  extractProgress,
  stripProgress,
  extractPriority,
  extractRepeat,
  stripPriority,
  stripRepeat,
} from './task-metadata';

const TASK_REGEX = /^(\s*)- \[([ /xX!])\]\s*(.*)$/;
const BLOCK_ID_REGEX = /\^([a-zA-Z0-9-]+)\s*$/;

/**
 * Parse tasks from content, correctly identifying parent tasks and their subtasks
 * Returns a flat array of all tasks (parents and children) for easier mapping
 */
export function parseTasksFromContent(content: string): ParsedTask[] {
  const lines = content.split('\n');
  const tasks: ParsedTask[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(TASK_REGEX);

    if (!match) continue;

    const indentStr = match[1]; // Preserve exact whitespace
    const indent = indentStr.length;
    // Normalize status (handle uppercase X)
    const statusChar = match[2].toLowerCase();
    const status = `[${statusChar}]` as TaskStatus;
    let taskContent = match[3];

   // Extract deadline
   const deadline = extractDeadline(taskContent);
    // Remove deadline from content to avoid duplication
    taskContent = stripDeadline(taskContent);

   // Extract progress
   const progress = extractProgress(taskContent);
    // Remove progress from content to avoid duplication
    taskContent = stripProgress(taskContent);

   // Extract priority
   const priority = extractPriority(taskContent);
    // Remove priority from content to avoid duplication
    taskContent = stripPriority(taskContent);

   const repeat = extractRepeat(taskContent);
    // Remove the recurrence marker from content to avoid duplication
    taskContent = stripRepeat(taskContent);

   // Extract block ID
    const blockIdMatch = taskContent.match(BLOCK_ID_REGEX);
    const blockId = blockIdMatch ? blockIdMatch[1] : undefined;
    if (blockId) {
      taskContent = taskContent.replace(BLOCK_ID_REGEX, '').trim();
    }

    const task: ParsedTask = {
      content: taskContent,
      status,
      subtasks: [],
      indentation: indentStr, // Store the exact indentation
      deadline,
      progress,
      priority,
      repeat,
      blockId,
      lineNumber: i,
    };

    tasks.push(task);
  }

  return tasks;
}

/**
 * Parse tasks with proper parent-child relationships
 * This is used for display purposes in the import modal
 */
export function parseTasksWithHierarchy(content: string): ParsedTask[] {
 const lines = content.split('\n');
 const tasks: ParsedTask[] = [];
 const stack: { task: ParsedTask; indent: number }[] = [];

 for (let i = 0; i < lines.length; i++) {
   const line = lines[i];
   const match = line.match(TASK_REGEX);

   if (!match) continue;

   const indentStr = match[1];
   const indent = indentStr.length;
   const statusChar = match[2].toLowerCase();
   const status = `[${statusChar}]` as TaskStatus;
   let taskContent = match[3];

   const deadline = extractDeadline(taskContent);
    // Remove deadline from content to avoid duplication
    taskContent = stripDeadline(taskContent);

   const progress = extractProgress(taskContent);
    // Remove progress from content to avoid duplication
    taskContent = stripProgress(taskContent);

   const priority = extractPriority(taskContent);
    // Remove priority from content to avoid duplication
    taskContent = stripPriority(taskContent);

   const repeat = extractRepeat(taskContent);
    // Remove the recurrence marker from content to avoid duplication
    taskContent = stripRepeat(taskContent);

   const blockIdMatch = taskContent.match(BLOCK_ID_REGEX);
    const blockId = blockIdMatch ? blockIdMatch[1] : undefined;
    if (blockId) {
      taskContent = taskContent.replace(BLOCK_ID_REGEX, '').trim();
    }

    const task: ParsedTask = {
      content: taskContent,
      status,
      subtasks: [],
      indentation: indentStr,
      deadline,
      progress,
      priority,
      repeat,
      blockId,
      lineNumber: i,
    };

    // Handle nesting
    while (stack.length > 0 && stack[stack.length - 1].indent >= indent) {
      stack.pop();
    }

    if (stack.length === 0) {
      tasks.push(task);
    } else {
      stack[stack.length - 1].task.subtasks.push(task);
    }

    stack.push({ task, indent });
  }

  return tasks;
}

/**
 * Flatten a hierarchical task tree into a flat array
 * Used to create mappings for all tasks including subtasks
 */
export function flattenTasks(tasks: ParsedTask[]): ParsedTask[] {
  const result: ParsedTask[] = [];
  
  function traverse(task: ParsedTask) {
    result.push(task);
    for (const subtask of task.subtasks) {
      traverse(subtask);
    }
  }
  
  for (const task of tasks) {
    traverse(task);
  }
  
  return result;
}

export function taskToMarkdown(
  task: ParsedTask,
  parentIndent: string = '',
  includeBlockIds = false
): string {
  const indentStr = task.indentation || parentIndent;
  const blockIdStr = includeBlockIds && task.blockId ? ` ^${task.blockId}` : '';

  let result = `${indentStr}- ${task.status} ${task.content}${blockIdStr}\n`;

  for (const subtask of task.subtasks) {
    result += taskToMarkdown(subtask, indentStr + '  ', includeBlockIds);
  }

  return result;
}

export function generateBlockId(): string {
  return 'task-' + Math.random().toString(36).substr(2, 9);
}
