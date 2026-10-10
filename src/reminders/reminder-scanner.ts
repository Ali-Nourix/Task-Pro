// ── reminders/reminder-scanner.ts ───────────────────────────────────────
// Collects the tasks a reminder should surface.
//
// Parsing rules live in `task-identity.ts` and creation times live in the
// hidden registry: this file only reads them, it never registers anything.
// That separation matters — if scanning also registered tasks, the very first
// alert would create the records it is filtering against and every task would
// look brand new.
// ─────────────────────────────────────────────────────────────────────────────

import { App, TFile } from 'obsidian';
import { PRIORITY_RANK, ReminderSettings, TaskPriority, TaskStatus } from '../types';
import { extractDeadline, extractPriority } from '../task-metadata';
import { parseTaskLine, taskKeyFor } from '../task-identity';
import { TaskCreationOrigin, TaskCreationRegistry } from '../task-registry';

export interface ReminderTask {
  filePath: string;
  fileName: string;
  /** 0-based line index inside the file. */
  lineNumber: number;
  /** Human readable task text, with plugin metadata markers removed. */
  text: string;
  status: TaskStatus;
  priority?: TaskPriority;
  deadline?: string;
  /** Whole days until the deadline. Negative means overdue. */
  daysLeft?: number;
  /**
   * Whole days since TaskPro observed the task appear, or `undefined` when the
   * task predates tracking. Never shown to the user.
   */
  ageInDays?: number;
  /** How the age was obtained, so the filter knows what it can trust. */
  ageOrigin?: TaskCreationOrigin;
  /** Age derived from the note's own creation time (opt-in fallback only). */
  noteAgeInDays?: number;
}

export interface ReminderScanResult {
  tasks: ReminderTask[];
  scannedFiles: number;
  /** Files that could not be read. Surfaced instead of being swallowed. */
  failedFiles: string[];
}

/** Whole-day difference between a YYYY-MM-DD deadline and today (local time). */
function daysUntil(deadline: string): number | undefined {
  const parsed = new Date(`${deadline}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return undefined;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((parsed.getTime() - today.getTime()) / 86_400_000);
}

/** Whole days between a timestamp and now, floored (0 = within the last 24h). */
function daysSince(timestamp: number, now: number): number {
  return Math.max(0, Math.floor((now - timestamp) / 86_400_000));
}

/** Active means any task that has not been completed. */
function isActiveTask(task: ReminderTask): boolean {
  return task.status !== '[x]';
}

/** Most urgent first: higher priority, then nearer (or more overdue) deadline. */
function compareTasks(a: ReminderTask, b: ReminderTask): number {
  const rankA = a.priority ? PRIORITY_RANK[a.priority] : 0;
  const rankB = b.priority ? PRIORITY_RANK[b.priority] : 0;
  if (rankA !== rankB) return rankB - rankA;

  const daysA = a.daysLeft ?? Number.MAX_SAFE_INTEGER;
  const daysB = b.daysLeft ?? Number.MAX_SAFE_INTEGER;
  if (daysA !== daysB) return daysA - daysB;

  return a.filePath.localeCompare(b.filePath);
}

/**
 * Scans the raw Markdown of only the owning active note and explicitly selected notes.
 * Obsidian transclusions are never expanded, so tasks from `![[embedded notes]]`
 * cannot become tasks of the parent note. Uses `cachedRead` so already-open notes are not re-read
 * from disk.
 */
export async function collectReminderTasks(
  app: App,
  settings: ReminderSettings,
  activeFilePath?: string,
  registry?: TaskCreationRegistry,
  onlyPaths?: string[]
): Promise<ReminderScanResult> {
  const defaultPaths = [
    ...(activeFilePath ? [activeFilePath] : []),
    ...(settings.notePaths ?? []).map((path) => path.trim()).filter(Boolean),
  ];
  const pathsToScan = Array.from(new Set((onlyPaths ?? defaultPaths).map((path) => path.trim()).filter(Boolean)));

  const files: TFile[] = pathsToScan
    .map((path) => app.vault.getAbstractFileByPath(path))
    .filter((file): file is TFile => file instanceof TFile && file.extension.toLowerCase() === 'md');

  const tasks: ReminderTask[] = [];
  const failedFiles: string[] = [];
  // One clock for the whole scan so every age comparison uses the same "now".
  const now = Date.now();

  for (const file of files) {
    let content: string;
    try {
      content = await app.vault.cachedRead(file);
    } catch (error) {
      console.error("TaskPro: failed to read \"[redacted]\" while scanning reminders");
      failedFiles.push(file.path);
      continue;
    }

    const noteAgeInDays = daysSince(Math.min(file.stat.ctime, now), now);
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const parsed = parseTaskLine(lines[i]);
      if (!parsed) continue;

      // An embedded note or embedded block is a reference, not a task owned by
      // this note. Never include it in this note's reminder task list.
      if (/!\[\[[^\]]+\]\]/.test(parsed.rawContent)) continue;

      // Read-only lookup: the background index owns writing to the registry.
      const creation = registry?.getCreation(taskKeyFor(file.path, parsed));

      const deadline = extractDeadline(parsed.rawContent) ?? undefined;
      const task: ReminderTask = {
        filePath: file.path,
        fileName: file.basename,
        lineNumber: i,
        text: parsed.text,
        status: parsed.status,
        priority: extractPriority(parsed.rawContent),
        deadline,
        daysLeft: deadline ? daysUntil(deadline) : undefined,
        ageInDays: creation ? daysSince(creation.createdAt, now) : undefined,
        ageOrigin: creation?.origin,
        noteAgeInDays,
      };

      if (isActiveTask(task)) {
        tasks.push(task);
      }
    }
  }

  tasks.sort(compareTasks);

  return { tasks, scannedFiles: files.length, failedFiles };
}
