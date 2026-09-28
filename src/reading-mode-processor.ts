// ── reading-mode-processor.ts ─────────────────────────────────────────────
// MarkdownPostProcessor for Reading Mode badges with localization support
// ─────────────────────────────────────────────────────────────────────────────

import { App, MarkdownPostProcessorContext } from 'obsidian';
import {
  TaskStatus,
  Language,
  CalendarSystem,
  TaskProgress,
  TaskPriority,
  TaskRepeat,
  TaskSchedule,
  TaskTimer,
  TimeFormat,
} from './types';
import { isWithinTargetFolder } from './path-utils';
import {
  extractDeadline,
  extractProgress,
  extractPriority,
  extractRepeat,
  extractSchedule,
  extractTags,
  SCHEDULE_MARKER_PATTERN_GLOBAL,
} from './task-metadata';
import { ResolvedTag, TaskTag, resolveTag } from './tags';
import {
  appendTagChips,
  applyChipScale,
  createDeadlineChip,
  createPriorityChip,
  createProgressChip,
  createRepeatChip,
  createScheduleChip,
  createStatusChip,
  createTimerChip,
} from './ui/chips';

/** A pattern that matches nothing, used to switch off an optional strip. */
const NEVER_MATCHES = /(?!)/g;
/** Same shape the parser accepts; see TAG_PATTERN_SOURCE in task-metadata. */
const TAG_MARKER_TEXT = /@tag\(\s*[^()\n]*?\s*\)/g;
const SCHEDULE_MARKER_TEXT = SCHEDULE_MARKER_PATTERN_GLOBAL;

/** Settings slice the reading-mode renderer depends on. */
export interface ReadingModeSettings {
  enableBadges: boolean;
  badgeLanguage: Language;
  badgeSize: number;
  showBadgesInEmbeds: boolean;
  targetFolder: string;
  calendarSystem: CalendarSystem;
  showPriorityBadges: boolean;
  showTimerBadges: boolean;
  showRepeatBadges: boolean;
  showTagBadges: boolean;
  showScheduleBadges: boolean;
  timeFormat: TimeFormat;
  tags: TaskTag[];
}

/**
 * Create reading mode processor
 */
export function createReadingModeProcessor(
  app: App,
  getSettings: () => ReadingModeSettings,
  getProgress: (filePath: string, blockId?: string) => TaskProgress | undefined,
  getTimer: (filePath: string, blockId?: string) => TaskTimer | undefined,
  getBlockId?: (filePath: string, lineContent: string) => string | undefined
) {
  return (el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
    const settings = getSettings();
    if (!settings.enableBadges) return;

    // Check target folder restriction
    if (settings.targetFolder && settings.targetFolder.trim() !== '') {
      if (!isWithinTargetFolder(ctx.sourcePath, settings.targetFolder)) {
        return;
      }
    }

    // Check if we're inside an embed
    const isInEmbed = el.closest('.internal-embed') !== null;
    if (isInEmbed && !settings.showBadgesInEmbeds) {
      return;
    }

    const taskItems = el.querySelectorAll('li.task-list-item');

    taskItems.forEach((item) => {
      // The processor root can contain an embed as a descendant even when the
      // root itself is not inside `.internal-embed`; check every task item.
      if (item.closest('.internal-embed')) return;

      const checkbox = item.querySelector('input[type="checkbox"]') as HTMLInputElement;
      if (!checkbox) return;

      // Remove existing badge nodes to avoid duplicates
      item.querySelectorAll('.taskpro-badge-container').forEach((existingBadge) => {
        existingBadge.remove();
      });

      // Determine status. The marker comes first: Obsidian ticks the checkbox
      // for every marker that is not a space, so `[/]` and `[!]` arrive checked
      // and used to read as done.
      let status: TaskStatus;
      const itemText = item.textContent || '';
      const taskMarker = checkbox.getAttribute('data-task') ?? item.getAttribute('data-task');
      if (taskMarker === '!' || (!taskMarker && itemText.includes('[!]'))) {
        status = '[!]';
        checkbox.classList.add('is-not-done');
      } else if (taskMarker === '/' || (!taskMarker && itemText.includes('[/]'))) {
        status = '[/]';
        // Mark checkbox as in-progress for CSS styling
        checkbox.classList.add('is-in-progress');
        checkbox.indeterminate = true;
      } else if (checkbox.checked) {
        status = '[x]';
      } else {
        status = '[ ]';
      }

     // Extract deadline
     const text = item.textContent || '';
     const deadline = extractDeadline(text) || null;

      // Extract block ID - check inline first, then fall back to cache
      const blockIdMatch = text.match(/\^([a-zA-Z0-9-]+)\s*$/);
      let blockId: string | undefined = blockIdMatch ? blockIdMatch[1] : undefined;
      if (!blockId && getBlockId) {
        blockId = getBlockId(ctx.sourcePath, text);
      }

      const progress = getProgress(ctx.sourcePath, blockId) ?? extractProgress(text) ?? null;

      const priority = settings.showPriorityBadges ? extractPriority(text) : undefined;
      const timer = settings.showTimerBadges ? getTimer(ctx.sourcePath, blockId) : undefined;
      const repeat = settings.showRepeatBadges ? extractRepeat(text) : undefined;
      const tagChips = settings.showTagBadges
        ? extractTags(text).map((key) => resolveTag(key, settings.tags))
        : [];
      const schedule = settings.showScheduleBadges ? extractSchedule(text) : undefined;

      // Extract tags
      const tagMatches = text.matchAll(/#([a-zA-Z0-9_-]+)/g);
      const tags = Array.from(tagMatches, m => m[1]);

      // Create badge container
      const badgeContainer = createInteractiveBadgeContainer(
        status,
        deadline,
        progress,
        priority,
        timer?.enabled ? timer : undefined,
        repeat,
        settings,
        text,
        ctx.sourcePath,
        blockId,
        tags,
        tagChips,
        schedule
      );

      hideInlineTaskMetadata(item, settings.showRepeatBadges, settings.showTagBadges, settings.showScheduleBadges);
      
      // Append to the list item
      item.appendChild(badgeContainer);
    });
  };
}

/**
 * Strips the plugin's own inline markers from the rendered line, now that chips
 * carry the same information. The recurrence marker is only stripped while its
 * chip is on — otherwise turning the chip off would hide the rule entirely.
 */
function hideInlineTaskMetadata(root: Element, hideRepeat: boolean, hideTags: boolean, hideSchedule: boolean): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const emptyTextNodes: Text[] = [];

  let currentNode = walker.nextNode();
  while (currentNode) {
    const textNode = currentNode as Text;
    if (!textNode.textContent) {
      currentNode = walker.nextNode();
      continue;
    }

    const cleanedText = textNode.textContent
      .replace(/@due\(\s*\d{4}-\d{2}-\d{2}\s*\)/gi, '')
      .replace(/(?:⏳|📅)\s*\d{4}-\d{2}-\d{2}/g, '')
      .replace(/\[(?:due|deadline)::\s*\d{4}-\d{2}-\d{2}\]/g, '')
      .replace(/\[progress::\s*\d+\/\d+\]/g, '')
      .replace(/@priority\(\s*(?:highest|high|medium|low|lowest)\s*\)/gi, '')
      .replace(/\[priority::\s*(?:highest|high|medium|low|lowest)\s*\]/gi, '')
      .replace(
        hideRepeat
          ? /@repeat\(\s*(?:\d+\s*)?(?:d|w|m|day|days|daily|week|weeks|weekly|month|months|monthly)\s*\)/gi
          : NEVER_MATCHES,
        ''
      )
      .replace(hideTags ? TAG_MARKER_TEXT : NEVER_MATCHES, '')
      .replace(hideSchedule ? SCHEDULE_MARKER_TEXT : NEVER_MATCHES, '')
      .replace(/\uD83D\uDD3A|\u23EB|\uD83D\uDD3C|\uD83D\uDD3D|\u23EC/g, '')
      .replace(/\s*\^[a-zA-Z0-9-]+\s*$/g, '')
      .replace(/\s{2,}/g, ' ');
    if (cleanedText !== textNode.textContent) {
      const hadMetadata = /@due\(/i.test(textNode.textContent)
        || textNode.textContent.includes('⏳')
        || textNode.textContent.includes('📅')
        || textNode.textContent.includes('[due::')
        || textNode.textContent.includes('[deadline::')
        || textNode.textContent.includes('[progress::')
        || /@priority\(/i.test(textNode.textContent)
        || /\[priority::/i.test(textNode.textContent)
        || (hideRepeat && /@repeat\(/i.test(textNode.textContent))
        || (hideTags && textNode.textContent.includes('@tag('))
        || (hideSchedule && textNode.textContent.includes('@schedule('))
        || /\uD83D\uDD3A|\u23EB|\uD83D\uDD3C|\uD83D\uDD3D|\u23EC/.test(textNode.textContent)
        || /\^[a-zA-Z0-9-]+/.test(textNode.textContent);
      if (!cleanedText.trim() && hadMetadata) {
        emptyTextNodes.push(textNode);
      } else {
        textNode.textContent = cleanedText;
      }
    }

    currentNode = walker.nextNode();
  }

  for (const node of emptyTextNodes) {
    node.parentNode?.removeChild(node);
  }
}
/**
 * Create interactive badge container
 */
function createInteractiveBadgeContainer(
  status: TaskStatus,
  deadline: string | null,
  progress: { enabled: boolean; currentSteps: number; totalSteps: number } | null,
  priority: TaskPriority | undefined,
  timer: TaskTimer | undefined,
  repeat: TaskRepeat | undefined,
  settings: { badgeLanguage: Language; badgeSize: number; calendarSystem: CalendarSystem; timeFormat: TimeFormat },
  lineContent: string,
  filePath: string,
  blockId?: string,
  tags?: string[],
  tagChips: ResolvedTag[] = [],
  schedule?: TaskSchedule
): HTMLElement {
  const container = document.createElement('span');
  container.className = 'taskpro-badge-container';
  applyChipScale(container, settings.badgeSize);

  if (blockId) {
    container.setAttribute('data-block-id', blockId);
    const hiddenId = document.createElement('span');
    hiddenId.className = 'taskpro-block-id';
    hiddenId.textContent = blockId;
    container.appendChild(hiddenId);
  }

  container.appendChild(
    createStatusChip({
      status,
      language: settings.badgeLanguage,
      filePath,
      lineContent,
      blockId,
      tags,
      deadline: deadline ?? undefined,
      priority,
    })
  );

  if (priority) {
    container.appendChild(
      createPriorityChip({
        priority,
        language: settings.badgeLanguage,
        filePath,
        lineContent,
        blockId,
        status,
        deadline: deadline ?? undefined,
        tags,
      })
    );
  }

  if (repeat) {
    container.appendChild(
      createRepeatChip({
        repeat,
        language: settings.badgeLanguage,
        filePath,
        lineContent,
        blockId,
        status,
        deadline: deadline ?? undefined,
        priority,
        tags,
      })
    );
  }

  if (deadline) {
    container.appendChild(createDeadlineChip(deadline, settings.badgeLanguage, status));
  }

  if (schedule) {
    container.appendChild(
      createScheduleChip({
        schedule,
        language: settings.badgeLanguage,
        calendarSystem: settings.calendarSystem,
        timeFormat: settings.timeFormat,
        filePath,
        lineContent,
        blockId,
        status,
        deadline: deadline ?? undefined,
        priority,
        tags,
      })
    );
  }

  if (timer?.enabled) {
    container.appendChild(
      createTimerChip({
        timer,
        filePath,
        lineContent,
        blockId,
        language: settings.badgeLanguage,
      })
    );
  }

  if (progress && progress.enabled) {
    container.appendChild(
      createProgressChip({
        currentSteps: progress.currentSteps,
        totalSteps: progress.totalSteps,
        filePath,
        lineContent,
        blockId,
        language: settings.badgeLanguage,
      })
    );
  }

  if (tagChips.length) {
    appendTagChips(container, tagChips, { filePath, lineContent, blockId });
  }

  return container;
}
