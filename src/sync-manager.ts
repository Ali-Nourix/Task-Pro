// ── sync-manager.ts ───────────────────────────────────────────────────────
// Redesigned: Strictly one-way sync (imported → source), action-triggered only
// ─────────────────────────────────────────────────────────────────────────────

import { App } from 'obsidian';
import { TaskMapping, TaskPriority, TaskProgress } from './types';
import {
  setDeadline as setDeadlineInLine,
  stripDeadline,
  setProgress as setProgressInLine,
  stripProgress,
  setPriority as setPriorityInLine,
  stripPriority,
  stripRepeat,
} from './task-metadata';

type MappingScope = 'either' | 'imported' | 'source';
const BLOCK_ID_REGEX = /\^([a-zA-Z0-9-]+)\s*$/;
const TASK_STATUS_REGEX = /- \[([ \/xX!])\]/;

interface FindMappingOptions {
  scope?: MappingScope;
  blockId?: string;
}

export class SyncManager {
  constructor(
    private app: App,
    private getMappings: () => TaskMapping[],
    private saveMappings: (mappings: TaskMapping[]) => Promise<void>
  ) {}

  /**
   * Sync task status from imported file to source file
   * ONLY called when user explicitly toggles a task checkbox
   */
  async syncTaskStatus(
    filePath: string,
    lineContent: string,
    newStatus: string,
    options: FindMappingOptions = {}
  ): Promise<void> {
    await this.syncTaskInSource(filePath, lineContent, options, (line) => {
      return line.replace(TASK_STATUS_REGEX, `- ${newStatus}`);
    });
  }

  /**
   * Sync deadline from imported file to source file
   * ONLY called when user explicitly sets/changes a deadline via the widget
   */
  async syncTaskDeadline(
    filePath: string,
    lineContent: string,
    newDeadline: string | null,
    options: FindMappingOptions = {}
  ): Promise<void> {
    await this.syncTaskInSource(filePath, lineContent, options, (line) => {
      return setDeadlineInLine(line, newDeadline);
    });
  }

  /**
   * Sync progress from imported file to source file
   * ONLY called when user explicitly changes progress via the widget
   */
  async syncTaskProgress(
    filePath: string,
    lineContent: string,
    newProgress: TaskProgress | null,
    options: FindMappingOptions = {}
  ): Promise<void> {
    await this.syncTaskInSource(filePath, lineContent, options, (line) => {
      return setProgressInLine(line, newProgress);
    });
  }

  /**
   * Sync priority from imported file to source file
   * ONLY called when the user explicitly changes the priority via the widget
   */
  async syncTaskPriority(
    filePath: string,
    lineContent: string,
    newPriority: TaskPriority | null,
    options: FindMappingOptions = {}
  ): Promise<void> {
    await this.syncTaskInSource(filePath, lineContent, options, (line) => {
      return setPriorityInLine(line, newPriority);
    });
  }

  /**
   * Add new task mapping(s)
   */
  addMapping(mapping: TaskMapping | TaskMapping[]): void {
    const mappings = this.getMappings();
    const incoming = Array.isArray(mapping) ? mapping : [mapping];

    for (const nextMapping of incoming) {
      const nextKey = this.getImportedIdentityKey(nextMapping);
      const deduped = mappings.filter((m) => this.getImportedIdentityKey(m) !== nextKey);
      deduped.push(nextMapping);
      mappings.length = 0;
      mappings.push(...deduped);
    }

    this.saveMappings(mappings);
  }

  /**
   * Find mapping for a given file and line content
   */
  findMapping(filePath: string, lineContent: string, options: FindMappingOptions = {}): TaskMapping | undefined {
    const scope = options.scope || 'either';
    const blockId = options.blockId || this.extractBlockId(lineContent);
    const mappings = this.getMappings();
    const normalized = this.normalizeTaskContent(lineContent);
    const normalizedCache = new WeakMap<TaskMapping, { imported: string; source: string }>();

    const getNormalizedMapping = (mapping: TaskMapping) => {
      let cached = normalizedCache.get(mapping);
      if (!cached) {
        cached = {
          imported: this.normalizeTaskContent(mapping.importedLineContent),
          source: this.normalizeTaskContent(mapping.sourceLineContent),
        };
        normalizedCache.set(mapping, cached);
      }
      return cached;
    };

    let bestMatch: TaskMapping | undefined;
    let bestScore = -1;

    for (const m of mappings) {
      let score = -1;

      if (blockId) {
        if (
          (scope === 'imported' || scope === 'either') &&
          m.importedFilePath === filePath &&
          m.importedBlockId === blockId
        ) {
          score = Math.max(score, 100);
        }

        if (
          (scope === 'source' || scope === 'either') &&
          m.sourceFilePath === filePath &&
          m.sourceBlockId === blockId
        ) {
          score = Math.max(score, 90);
        }
      }

      if (scope === 'imported' || scope === 'either') {
        const normalizedImported = getNormalizedMapping(m).imported;
        if (m.importedFilePath === filePath && normalizedImported === normalized) {
          score = Math.max(score, 40);
        }
      }

      if (scope === 'source' || scope === 'either') {
        const normalizedSource = getNormalizedMapping(m).source;
        if (m.sourceFilePath === filePath && normalizedSource === normalized) {
          score = Math.max(score, 30);
        }
      }

      if (score < 0) {
        continue;
      }

      if (
        !bestMatch ||
        score > bestScore ||
        (score === bestScore && (m.lastSynced || 0) >= (bestMatch.lastSynced || 0))
      ) {
        bestMatch = m;
        bestScore = score;
      }
    }

    return bestMatch;
  }

  /**
   * Set link state for a task mapping
   */
  async setLinkState(filePath: string, lineContent: string, enabled: boolean, options: FindMappingOptions = {}): Promise<void> {
    const mappings = this.getMappings();
    const mapping = this.findMapping(filePath, lineContent, options);
    
    if (mapping) {
      mapping.linked = enabled;
      await this.saveMappings(mappings);
    }
  }

  /**
   * Normalize task content for comparison (removes status, deadline, block ID)
   */
  private normalizeTaskContent(line: string): string {
    return stripRepeat(stripPriority(stripProgress(stripDeadline(line))))
      .replace(/^(\s*)- \[([ \/xX!])\]\s*/, '') // Remove task marker and status
      .replace(/\^[a-zA-Z0-9-]+\s*$/, '')
      .trim()
      .toLowerCase();
  }

  private async syncTaskInSource(
    filePath: string,
    lineContent: string,
    options: FindMappingOptions,
    updateLine: (line: string) => string
  ): Promise<void> {
    const mapping = this.findMapping(filePath, lineContent, { ...options, scope: 'imported' });

    if (!mapping || !mapping.linked) {
      return;
    }

    const sourceFile = this.app.vault.getFileByPath(mapping.sourceFilePath);
    if (!sourceFile) return;

    let updated = false;
    const sourceBlockId = mapping.sourceBlockId;

    await this.app.vault.process(sourceFile, (content) => {
      const lines = content.split('\n');
      const targetLineIndex = this.findTargetLineIndex(
        lines,
        mapping.sourceLineContent,
        sourceBlockId
      );

      if (targetLineIndex === -1) {
        return content;
      }

      const currentLine = lines[targetLineIndex];
      const nextLine = updateLine(currentLine);
      if (nextLine === currentLine) {
        return content;
      }

      lines[targetLineIndex] = nextLine;
      updated = true;

      return lines.join('\n');
    });

    if (updated) {
      mapping.lastSynced = Date.now();
      await this.saveMappings(this.getMappings());
    }
  }

  private findTargetLineIndex(lines: string[], sourceLineContent: string, blockId?: string): number {
    // Prefer block ID match when available.
    if (blockId) {
      const withBlockId = lines.findIndex((line) => this.hasBlockId(line, blockId));
      if (withBlockId !== -1) return withBlockId;
    }

    const normalizedSource = this.normalizeTaskContent(sourceLineContent);
    return lines.findIndex((line) => this.normalizeTaskContent(line) === normalizedSource);
  }

  private getImportedIdentityKey(mapping: TaskMapping): string {
    if (mapping.importedBlockId) {
      return `id:${mapping.importedFilePath}:${mapping.importedBlockId}`;
    }

    const normalizedImported = this.normalizeTaskContent(mapping.importedLineContent);
    return `text:${mapping.importedFilePath}:${normalizedImported}`;
  }

  private hasBlockId(lineContent: string, blockId: string): boolean {
    return new RegExp(`\\^${this.escapeRegExp(blockId)}(?=\\s|$)`).test(lineContent);
  }

  private extractBlockId(lineContent: string): string | undefined {
    const match = lineContent.match(BLOCK_ID_REGEX);
    return match ? match[1] : undefined;
  }

  private escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
