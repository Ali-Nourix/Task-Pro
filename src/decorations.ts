// ── decorations.ts ────────────────────────────────────────────────────────
// Refactored widget rendering with robust state management
// ─────────────────────────────────────────────────────────────────────────────

import {
  EditorView,
  WidgetType,
  Decoration,
  DecorationSet,
  ViewPlugin,
  ViewUpdate,
} from '@codemirror/view';
import { RangeSetBuilder, StateEffect } from '@codemirror/state';

/** Dispatch this effect on any editor to force the decoration plugin to rebuild. */
export const forceDecorationsRefresh = StateEffect.define<null>();
import { App } from 'obsidian';
import {
  TaskStatus,
  Language,
  BlockId,
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
  DEADLINE_MARKER_PATTERN,
  PRIORITY_MARKER_PATTERN,
  REPEAT_MARKER_PATTERN,
  SCHEDULE_MARKER_PATTERN,
  TAG_MARKER_PATTERN_GLOBAL,
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

/** Settings slice the decoration layer depends on. */
export interface DecorationSettings {
  enableBadges: boolean;
  badgeLanguage: Language;
  badgeSize: number;
  targetFolder: string;
  calendarSystem: CalendarSystem;
  showPriorityBadges: boolean;
  showTimerBadges: boolean;
  showRepeatBadges: boolean;
  showTagBadges: boolean;
  showScheduleBadges: boolean;
  timeFormat: TimeFormat;
  /** The user's tag list, read live so a rename or recolour shows at once. */
  tags: TaskTag[];
}

// ── Module-level constants (compiled once, reused on every line) ──────────
const TASK_REGEX = /^(\s*)- \[([ \/xX!])\] (.+)$/;
const BLOCK_ID_INLINE_REGEX = /\^([a-zA-Z0-9-]+)\s*$/;
const TAG_REGEX = /#([a-zA-Z0-9_-]+)/g;
// Shared with the parser so the hidden range always matches what we parse.
const DEADLINE_MATCH_REGEX = DEADLINE_MARKER_PATTERN;
const PROGRESS_MATCH_REGEX = /\[progress::\s*\d+\/\d+\]/;
// Shared with the parser so the hidden range always matches what we parse.
const PRIORITY_MATCH_REGEX = PRIORITY_MARKER_PATTERN;
const REPEAT_MATCH_REGEX = REPEAT_MARKER_PATTERN;
const TAG_MATCH_REGEX = TAG_MARKER_PATTERN_GLOBAL;
const SCHEDULE_MATCH_REGEX = SCHEDULE_MARKER_PATTERN;

// Pre-created stateless decorations — reused instead of allocated per line
const HIDE_DECO = Decoration.replace({});
const HIDE_DECO_NONINCLUSIVE = Decoration.replace({ inclusive: false });

function resolveFilePathFromView(view: EditorView, app: App): string {
  const directPath = (view.state as { file?: { path?: string } }).file?.path;
  if (directPath) return directPath;

  const sourceView = view.dom.closest('.markdown-source-view');
  if (sourceView instanceof HTMLElement) {
    const declaredPath = sourceView.getAttribute('data-path');
    if (declaredPath) return declaredPath;
  }

  const activeLeaf = app.workspace.getMostRecentLeaf();
  const activeView = activeLeaf?.view as { file?: { path?: string } } | null;
  if (activeView?.file?.path) return activeView.file.path;

  const markdownLeaves = app.workspace.getLeavesOfType('markdown');
  for (const leaf of markdownLeaves) {
    const viewInstance = leaf.view as { file?: { path?: string }; containerEl?: HTMLElement } | null;
    if (viewInstance?.file?.path && viewInstance?.containerEl?.contains(view.dom)) {
      return viewInstance.file.path;
    }
  }

  return '';
}

/**
 * Single row widget: progress + status + deadline chips (aligned)
 */
class TaskBadgeWidget extends WidgetType {
  private readonly widgetState: {
    status: TaskStatus;
    deadline: string | undefined;
    progress: TaskProgress | undefined;
    priority: TaskPriority | undefined;
    timer: TaskTimer | undefined;
    repeat: TaskRepeat | undefined;
    language: Language;
    badgeSize: number;
    lineContent: string;
    filePath: string;
    blockId?: BlockId;
    tags?: string[];
    tagChips?: ResolvedTag[];
    schedule?: TaskSchedule;
    calendarSystem: CalendarSystem;
    timeFormat: TimeFormat;
  };

  constructor(
    status: TaskStatus,
    deadline: string | undefined,
    progress: TaskProgress | undefined,
    priority: TaskPriority | undefined,
    timer: TaskTimer | undefined,
    repeat: TaskRepeat | undefined,
    language: Language,
    badgeSize: number,
    lineContent: string,
    filePath: string,
    blockId?: BlockId,
    tags?: string[],
    tagChips?: ResolvedTag[],
    schedule?: TaskSchedule,
    calendarSystem: CalendarSystem = 'gregorian',
    timeFormat: TimeFormat = '24h'
  ) {
    super();
    this.widgetState = Object.freeze({
      status,
      deadline,
      progress,
      priority,
      timer,
      repeat,
      language,
      badgeSize,
      lineContent,
      filePath,
      blockId,
      tags,
      tagChips,
      schedule,
      calendarSystem,
      timeFormat,
    });
  }

  eq(other: TaskBadgeWidget): boolean {
    const p = this.widgetState.progress;
    const op = other.widgetState.progress;
    const progressEq =
      (!p && !op) ||
      (!!p &&
        !!op &&
        p.enabled === op.enabled &&
        p.currentSteps === op.currentSteps &&
        p.totalSteps === op.totalSteps);

    const t = this.widgetState.timer;
    const ot = other.widgetState.timer;
    // The countdown itself is retargeted in place every second by the timer
    // service, so only the fields that change the chip's identity are compared.
    const timerEq =
      (!t && !ot) ||
      (!!t &&
        !!ot &&
        t.enabled === ot.enabled &&
        t.durationSeconds === ot.durationSeconds &&
        t.runningSince === ot.runningSince &&
        !!t.completedAt === !!ot.completedAt);

    const r = this.widgetState.repeat;
    const or = other.widgetState.repeat;
    const repeatEq =
      (!r && !or) || (!!r && !!or && r.every === or.every && r.unit === or.unit);

    // A tag's name or colour can change in settings without the line changing,
    // so the resolved chips are compared, not just the keys in the text.
    const tc = this.widgetState.tagChips ?? [];
    const otc = other.widgetState.tagChips ?? [];
    const tagsEq =
      tc.length === otc.length &&
      tc.every((tag, i) => tag.key === otc[i].key && tag.name === otc[i].name && tag.color === otc[i].color);

    // The chip reads "Today" or "Tomorrow", so a calendar or clock setting
    // changes it as much as the marker does.
    const s = this.widgetState.schedule;
    const os = other.widgetState.schedule;
    const scheduleEq =
      ((!s && !os) || (!!s && !!os && s.date === os.date && s.start === os.start && s.end === os.end)) &&
      this.widgetState.calendarSystem === other.widgetState.calendarSystem &&
      this.widgetState.timeFormat === other.widgetState.timeFormat;

    return (
      this.widgetState.status === other.widgetState.status &&
      this.widgetState.deadline === other.widgetState.deadline &&
      this.widgetState.priority === other.widgetState.priority &&
      progressEq &&
      timerEq &&
      repeatEq &&
      tagsEq &&
      scheduleEq &&
      this.widgetState.language === other.widgetState.language &&
      this.widgetState.badgeSize === other.widgetState.badgeSize &&
      this.widgetState.lineContent === other.widgetState.lineContent &&
      this.widgetState.filePath === other.widgetState.filePath &&
      this.widgetState.blockId === other.widgetState.blockId
    );
  }

  toDOM(): HTMLElement {
    const s = this.widgetState;
    const container = document.createElement('span');
    container.className = 'taskpro-badge-container';
    applyChipScale(container, s.badgeSize);

    // Embed block ID as a hidden element inside the widget — never in file text
    if (s.blockId) {
      container.setAttribute('data-block-id', s.blockId);
      const hiddenId = document.createElement('span');
      hiddenId.className = 'taskpro-block-id';
      hiddenId.textContent = s.blockId;
      container.appendChild(hiddenId);
    }

    // RTL order (right → left): status, priority, repeat, deadline, timer, progress
    container.appendChild(
      createStatusChip({
        status: s.status,
        language: s.language,
        filePath: s.filePath,
        lineContent: s.lineContent,
        blockId: s.blockId,
        tags: s.tags,
        deadline: s.deadline,
        priority: s.priority,
      })
    );

    if (s.priority) {
      container.appendChild(
        createPriorityChip({
          priority: s.priority,
          language: s.language,
          filePath: s.filePath,
          lineContent: s.lineContent,
          blockId: s.blockId,
          status: s.status,
          deadline: s.deadline,
          tags: s.tags,
        })
      );
    }

    if (s.repeat) {
      container.appendChild(
        createRepeatChip({
          repeat: s.repeat,
          language: s.language,
          filePath: s.filePath,
          lineContent: s.lineContent,
          blockId: s.blockId,
          status: s.status,
          deadline: s.deadline,
          priority: s.priority,
          tags: s.tags,
        })
      );
    }

    if (s.deadline) {
      container.appendChild(createDeadlineChip(s.deadline, s.language, s.status));
    }

    if (s.schedule) {
      container.appendChild(
        createScheduleChip({
          schedule: s.schedule,
          language: s.language,
          calendarSystem: s.calendarSystem,
          timeFormat: s.timeFormat,
          filePath: s.filePath,
          lineContent: s.lineContent,
          blockId: s.blockId,
          status: s.status,
          deadline: s.deadline,
          priority: s.priority,
          tags: s.tags,
        })
      );
    }

    if (s.timer?.enabled) {
      container.appendChild(
        createTimerChip({
          timer: s.timer,
          filePath: s.filePath,
          lineContent: s.lineContent,
          blockId: s.blockId,
          language: s.language,
        })
      );
    }

    if (s.progress?.enabled) {
      container.appendChild(
        createProgressChip({
          currentSteps: s.progress.currentSteps,
          totalSteps: s.progress.totalSteps,
          filePath: s.filePath,
          lineContent: s.lineContent,
          blockId: s.blockId,
          language: s.language,
        })
      );
    }

    // Last in the DOM, so with the row reversed the tags sit nearest the text.
    if (s.tagChips?.length) {
      appendTagChips(container, s.tagChips, {
        filePath: s.filePath,
        lineContent: s.lineContent,
        blockId: s.blockId,
      });
    }

    return container;
  }
}

function buildDecorations(
  view: EditorView,
  filePath: string,
  settings: DecorationSettings,
  getProgress: (filePath: string, blockId?: string) => TaskProgress | undefined,
  getTimer: (filePath: string, blockId?: string) => TaskTimer | undefined,
  getBlockId?: (filePath: string, lineContent: string) => string | undefined
): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();

  if (!settings.enableBadges) {
    return builder.finish();
  }

  if (settings.targetFolder && settings.targetFolder.trim() !== '') {
    if (filePath && !isWithinTargetFolder(filePath, settings.targetFolder)) {
      return builder.finish();
    }
  }

  /**
   * Ranges are collected first and sorted before they reach the builder.
   *
   * `RangeSetBuilder.add` requires strictly ascending positions, but the
   * markers are found in a fixed order (deadline, priority, progress, block
   * id) while their *positions* depend on the order the user set them in. Set
   * priority first and a deadline second, and the deadline sits after the
   * priority marker in the text — so the builder received a later range before
   * an earlier one and threw. A throw inside a ViewPlugin tears the plugin
   * down for that editor, which is why every badge in the note disappeared
   * until the pane was recreated by switching notes.
   */
  const ranges: Array<{ from: number; to: number; decoration: Decoration; side: number }> = [];
  const addRange = (from: number, to: number, decoration: Decoration, side = 0) => {
    ranges.push({ from, to, decoration, side });
  };

  for (const { from, to } of view.visibleRanges) {
    for (let pos = from; pos <= to;) {
      const line = view.state.doc.lineAt(pos);
      const lineText = line.text;

      const taskMatch = TASK_REGEX.exec(lineText);

      if (taskMatch) {
        const statusChar = taskMatch[2].toLowerCase();
        const status = `[${statusChar}]` as TaskStatus;
        const content = taskMatch[3];

        const blockIdMatch = BLOCK_ID_INLINE_REGEX.exec(content);
        let blockId = blockIdMatch ? blockIdMatch[1] : undefined;

        // If no inline block ID, check cache
        if (!blockId && getBlockId && filePath) {
          blockId = getBlockId(filePath, lineText);
        }

        // Only allocate tags array when tags are present
        let tags: string[] | undefined;
        if (content.includes('#')) {
          TAG_REGEX.lastIndex = 0;
          const tagArr: string[] = [];
          let tm: RegExpExecArray | null;
          while ((tm = TAG_REGEX.exec(content)) !== null) tagArr.push(tm[1]);
          if (tagArr.length > 0) tags = tagArr;
        }

        const deadline = extractDeadline(content);
        const progress = getProgress(filePath || '', blockId) ?? extractProgress(content);
        const priority = settings.showPriorityBadges ? extractPriority(content) : undefined;
        const timer = settings.showTimerBadges ? getTimer(filePath || '', blockId) : undefined;
        const repeat = settings.showRepeatBadges ? extractRepeat(content) : undefined;
        const tagChips = settings.showTagBadges && content.includes('@tag(')
          ? extractTags(content).map((key) => resolveTag(key, settings.tags))
          : undefined;
        const schedule = settings.showScheduleBadges && content.includes('@schedule(')
          ? extractSchedule(content)
          : undefined;

        if (deadline) {
          const deadlineMatch = DEADLINE_MATCH_REGEX.exec(content);
          if (deadlineMatch) {
            const contentStart = line.from + (lineText.length - taskMatch[3].length);
            const deadlineStart = contentStart + deadlineMatch.index;
            const deadlineEnd = deadlineStart + deadlineMatch[0].length;
            addRange(deadlineStart, deadlineEnd, HIDE_DECO_NONINCLUSIVE);
          }
        }

        // The priority marker is always hidden from the raw line — including
        // while the cursor is on that line — so the task title never "jumps"
        // mid-typing. A non-inclusive replacement keeps the cursor free to move
        // across the boundary and keeps insertions outside the hidden range.
        const priorityMatch = PRIORITY_MATCH_REGEX.exec(content);
        if (priorityMatch) {
          const contentStart = line.from + (lineText.length - taskMatch[3].length);
          const priorityStart = contentStart + priorityMatch.index;
          const priorityEnd = priorityStart + priorityMatch[0].length;
          addRange(priorityStart, priorityEnd, HIDE_DECO_NONINCLUSIVE);
        }

        // Hidden only while the chip is rendering it. With the chip switched
        // off the marker stays visible, so the recurrence never becomes
        // invisible information.
        const repeatMatch = settings.showRepeatBadges ? REPEAT_MATCH_REGEX.exec(content) : null;
        if (repeatMatch) {
          const contentStart = line.from + (lineText.length - taskMatch[3].length);
          const repeatStart = contentStart + repeatMatch.index;
          const repeatEnd = repeatStart + repeatMatch[0].length;
          addRange(repeatStart, repeatEnd, HIDE_DECO_NONINCLUSIVE);
        }

        // Same rule as the repeat marker: hidden only while its chips render.
        if (tagChips) {
          const contentStart = line.from + (lineText.length - taskMatch[3].length);
          TAG_MATCH_REGEX.lastIndex = 0;
          let tagMatch: RegExpExecArray | null;
          while ((tagMatch = TAG_MATCH_REGEX.exec(content)) !== null) {
            const tagStart = contentStart + tagMatch.index;
            addRange(tagStart, tagStart + tagMatch[0].length, HIDE_DECO_NONINCLUSIVE);
          }
        }

        // Same rule again: hidden only while the chip shows the plan.
        const scheduleMatch = schedule ? SCHEDULE_MATCH_REGEX.exec(content) : null;
        if (scheduleMatch) {
          const contentStart = line.from + (lineText.length - taskMatch[3].length);
          const scheduleStart = contentStart + scheduleMatch.index;
          addRange(scheduleStart, scheduleStart + scheduleMatch[0].length, HIDE_DECO_NONINCLUSIVE);
        }

        const progressMatch = PROGRESS_MATCH_REGEX.exec(content);
        if (progressMatch) {
          const contentStart = line.from + (lineText.length - taskMatch[3].length);
          const progressStart = contentStart + progressMatch.index;
          const progressEnd = progressStart + progressMatch[0].length;
          addRange(progressStart, progressEnd, HIDE_DECO);
        }

        if (blockIdMatch) {
          const contentStart = line.from + (lineText.length - taskMatch[3].length);
          const blockIdStart = contentStart + (blockIdMatch.index ?? 0);
          const blockIdEnd = blockIdStart + blockIdMatch[0].length;
          addRange(blockIdStart, blockIdEnd, HIDE_DECO);
        }

        addRange(
          line.to,
          line.to,
          Decoration.widget({
            widget: new TaskBadgeWidget(
              status,
              deadline,
              progress?.enabled ? progress : undefined,
              priority,
              timer?.enabled ? timer : undefined,
              repeat,
              settings.badgeLanguage,
              settings.badgeSize,
              lineText,
              filePath,
              blockId,
              tags,
              tagChips,
              schedule,
              settings.calendarSystem,
              settings.timeFormat
            ),
            side: 1,
          }),
          1
        );
      }

      pos = line.to + 1;
    }
  }

  // Sort by position, then by side, exactly as the builder expects. The widget
  // at the end of a line uses side 1 so it stays after any range ending there.
  ranges.sort((a, b) => a.from - b.from || a.side - b.side || a.to - b.to);

  for (const range of ranges) {
    builder.add(range.from, range.to, range.decoration);
  }

  return builder.finish();
}

export function createTaskBadgePlugin(
  app: App,
  getSettings: () => DecorationSettings,
  getProgress: (filePath: string, blockId?: string) => TaskProgress | undefined,
  getTimer: (filePath: string, blockId?: string) => TaskTimer | undefined,
  getBlockId?: (filePath: string, lineContent: string) => string | undefined
) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      // Cache file path — it never changes while the view is open for the same file.
      // Re-resolved only when the view is first constructed or on viewport change
      // (viewport changes can indicate a pane was recycled for a new file).
      private filePath: string;

      constructor(view: EditorView) {
        this.filePath = resolveFilePathFromView(view, app);
        this.decorations = this.safeBuild(view);
      }

      /**
       * CodeMirror destroys a ViewPlugin that throws, and the editor then
       * renders raw markers until the pane is recreated. Degrading to "no
       * badges for this rebuild" keeps the note usable and leaves a real error
       * in the console instead of a silently dead plugin.
       */
      private safeBuild(view: EditorView): DecorationSet {
        try {
          return buildDecorations(
            view,
            this.filePath,
            getSettings(),
            getProgress,
            getTimer,
            getBlockId
          );
        } catch (error) {
          console.error('TaskPro: failed to build task badges for this view', error);
          return Decoration.none;
        }
      }

      update(update: ViewUpdate) {
        // selectionSet intentionally excluded — cursor moves must NOT trigger rebuilds.
        // forceDecorationsRefresh effect covers progress/settings changes that don't touch the doc.
        const forced = update.transactions.some(
          (tr) => tr.effects.some((e) => e.is(forceDecorationsRefresh))
        );
        if (!update.docChanged && !update.viewportChanged && !forced) return;

        if (update.viewportChanged) {
          // Viewport changes can mean a new file was loaded into this pane
          const resolved = resolveFilePathFromView(update.view, app);
          if (resolved) this.filePath = resolved;
        }

        this.decorations = this.safeBuild(update.view);
      }
    },
    {
      decorations: (v) => v.decorations,
    }
  );
}
