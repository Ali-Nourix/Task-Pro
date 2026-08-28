// ── types.ts ──────────────────────────────────────────────────────────────
// Core type definitions for TaskPro
// ─────────────────────────────────────────────────────────────────────────────

import type { TaskCreationIndex } from './task-registry';

export type TaskStatus = '[ ]' | '[/]' | '[x]' | '[!]';
export type Language = 'en' | 'fa';
export type BlockId = string;
export type CalendarSystem = 'gregorian' | 'jalali';

// ── Priority ───────────────────────────────────────────────────────────────
// Five ordered levels, mirroring the widely used Obsidian Tasks vocabulary so
// existing vaults stay interoperable.
export type TaskPriority = 'highest' | 'high' | 'medium' | 'low' | 'lowest';

/** Ordered from most to least urgent. Used for pickers and sorting. */
export const TASK_PRIORITIES: readonly TaskPriority[] = [
  'highest',
  'high',
  'medium',
  'low',
  'lowest',
] as const;

/** Higher number = more urgent. Tasks without a priority rank as 0. */
export const PRIORITY_RANK: Record<TaskPriority, number> = {
  highest: 5,
  high: 4,
  medium: 3,
  low: 2,
  lowest: 1,
};

/**
 * Legacy Obsidian Tasks emoji markers.
 * Read-only: used to *parse* existing vaults. Never rendered in the UI.
 */
export const PRIORITY_ICONS: Record<TaskPriority, string> = {
  highest: '🔺',
  high: '⏫',
  medium: '🔼',
  low: '🔽',
  lowest: '⏬',
};

/**
 * Obsidian (Lucide) icon ids used for every priority affordance.
 * Rendered through `setIcon`, so they inherit theme colours and sizing.
 */
export const PRIORITY_ICON_NAMES: Record<TaskPriority, string> = {
  highest: 'chevrons-up',
  high: 'chevron-up',
  medium: 'equal',
  low: 'chevron-down',
  lowest: 'chevrons-down',
};

/** Obsidian (Lucide) icon ids for task statuses. */
export const STATUS_ICON_NAMES: Record<TaskStatus, string> = {
  '[ ]': 'circle',
  '[/]': 'circle-dot',
  '[x]': 'check-circle',
  '[!]': 'alert-triangle',
};

/** Obsidian (Lucide) icon ids for the remaining chips. */
export const CHIP_ICON_NAMES = {
  deadline: 'calendar-clock',
  progress: 'pie-chart',
} as const;

export const PRIORITY_LABELS: Record<Language, Record<TaskPriority, string>> = {
  en: {
    highest: 'Highest',
    high: 'High',
    medium: 'Medium',
    low: 'Low',
    lowest: 'Lowest',
  },
  fa: {
    highest: 'بحرانی',
    high: 'زیاد',
    medium: 'متوسط',
    low: 'کم',
    lowest: 'خیلی کم',
  },
};

// ── Reminders ──────────────────────────────────────────────────────────────
export type ReminderStrictness = 'gentle' | 'normal' | 'strict';
export type ReminderSound = 'none' | 'chime' | 'bell' | 'alarm' | 'custom';
/** How the "created within N days" filter combines with the deadline filters. */
export type ReminderAgeMode = 'only' | 'or' | 'and';
/** What to do with tasks that already existed before TaskPro started tracking. */
export type UnknownAgePolicy = 'exclude' | 'include' | 'noteDate';
export type ReminderIntervalUnit = 'minutes' | 'hours' | 'days' | 'weeks';

export interface NoteReminderSchedule {
  enabled: boolean;
  every: number;
  unit: ReminderIntervalUnit;
}

export interface ReminderSettings {
  enabled: boolean;
  /** Extra notes scanned in addition to the currently active note. */
  notePaths: string[];
  /** Per-note recurring intervals, keyed by vault-relative note path. */
  noteSchedules: Record<string, NoteReminderSchedule>;
  /** Fixed times of day in 24h "HH:mm" form. */
  dailyTimes: string[];
  /** Additionally repeat every N minutes through the day. */
  repeatEnabled: boolean;
  repeatIntervalMinutes: number;
  quietHoursEnabled: boolean;
  quietHoursStart: string;
  quietHoursEnd: string;
  /** gentle = toast only, normal = dismissible fullscreen, strict = forced fullscreen. */
  strictness: ReminderStrictness;
  /** Seconds before a gentle/normal alert closes itself. 0 disables auto-close. */
  autoDismissSeconds: number;
  /** Seconds the strict alert stays locked before it can be acknowledged. */
  strictHoldSeconds: number;
  snoozeMinutes: number;
  /** Custom headline. Supports {count}, {top}, {date} placeholders. */
  message: string;
  soundEnabled: boolean;
  sound: ReminderSound;
  /** Vault-relative path to an audio file, used when sound is 'custom'. */
  customSoundPath: string;
  soundVolume: number;
  /** Keep the sound looping until the alert is acknowledged. */
  soundRepeat: boolean;
  systemNotification: boolean;
  /** Only alert for these priorities. */
  priorities: TaskPriority[];
  includeTasksWithoutPriority: boolean;
  /** Only alert for tasks currently in these statuses. */
  statuses: TaskStatus[];
  includeOverdue: boolean;
  /** Include tasks whose deadline is within this many days (0 = today only). */
  dueWithinDays: number;
  includeTasksWithoutDeadline: boolean;
  /**
   * Only alert for tasks created within this many days (0 = no age filter).
   * Creation time comes from the plugin's hidden registry, never from the note.
   */
  createdWithinDays: number;
  /**
   * only = age decides alone (deadline filters ignored),
   * or   = recent OR deadline match,
   * and  = both must match.
   */
  ageFilterMode: ReminderAgeMode;
  /**
   * Tasks whose creation moment was never observed. The note's file name is
   * never parsed for a date; 'noteDate' uses the note's file creation time.
   */
  unknownAgePolicy: UnknownAgePolicy;
  maxTasksShown: number;
}

/** Runtime bookkeeping so restarts don't replay or skip alerts. */
export interface ReminderState {
  lastFiredAt?: number;
  /** "YYYY-MM-DD HH:mm" keys of daily slots already fired. */
  firedDailyKeys?: string[];
  /** Last successful interval check for each selected note. */
  noteLastFiredAt?: Record<string, number>;
}

export const DEFAULT_REMINDER_SETTINGS: ReminderSettings = {
  enabled: true,
  notePaths: [],
  noteSchedules: {},
  dailyTimes: ['09:00'],
  repeatEnabled: false,
  repeatIntervalMinutes: 180,
  quietHoursEnabled: false,
  quietHoursStart: '23:00',
  quietHoursEnd: '07:00',
  strictness: 'normal',
  autoDismissSeconds: 0,
  strictHoldSeconds: 5,
  snoozeMinutes: 10,
  message: '',
  soundEnabled: true,
  sound: 'chime',
  customSoundPath: '',
  soundVolume: 0.6,
  soundRepeat: false,
  systemNotification: false,
  priorities: ['highest', 'high', 'medium'],
  includeTasksWithoutPriority: false,
  statuses: ['[ ]', '[/]', '[!]'],
  includeOverdue: true,
  dueWithinDays: 0,
  includeTasksWithoutDeadline: false,
  createdWithinDays: 0,
  ageFilterMode: 'only',
  unknownAgePolicy: 'exclude',
  maxTasksShown: 12,
};

export interface TaskProgress {
  enabled: boolean;
  totalSteps: number;
  currentSteps: number;
}

export interface TaskMapping {
  linked: boolean; // Whether sync is enabled for this task
  importedFilePath: string;
  importedLineContent: string;
  importedBlockId?: BlockId;
  sourceFilePath: string;
  sourceLineContent: string;
  sourceBlockId?: BlockId;
  lastSynced: number;
  customTags?: string[]; // Plugin-managed custom tags
  indentation?: string; // Preserved indentation (tabs/spaces)
  progress?: TaskProgress; // Progress tracking for this task
}

export interface GlobalInternalTask {
  id: string;
  content: string;
  status: TaskStatus;
  subtasks?: GlobalInternalTask[];
  deadline?: string;
  created: number;
  customTags?: string[]; // Plugin-managed custom tags
  progress?: TaskProgress; // Progress tracking
}

// Progress storage entry
export interface TaskProgressEntry {
  filePath: string;
  blockId: string;
  progress: TaskProgress;
}

export interface TaskProSettings {
  referenceNotePath: string;
  enableBadges: boolean;
  badgeLanguage: Language;
  badgeSize: number;
  calendarSystem: CalendarSystem; // Calendar system for date display
  targetFolder: string; // Folder restriction for plugin activity
  globalInternalTasks: GlobalInternalTask[];
  showBadgesInEmbeds: boolean; // Toggle badge visibility in embeds
  taskMappings: TaskMapping[];
  taskProgress: TaskProgressEntry[]; // Store progress data separately
  showPriorityBadges: boolean; // Toggle priority chip rendering
  reminders: ReminderSettings; // Daily reminder configuration
  reminderState?: ReminderState; // Internal scheduler bookkeeping
  blockIdMigrationDone?: boolean; // Guard: skip inline-strip migration after first run
  activeNoteReminderDefaultApplied?: boolean; // One-time migration: active-note reminders default on
  /**
   * Hidden bookkeeping: when TaskPro first saw each task. Never surfaced in the
   * UI and never written into notes. See src/task-registry.ts.
   */
  taskCreationIndex?: TaskCreationIndex;
}

export const DEFAULT_SETTINGS: TaskProSettings = {
  referenceNotePath: 'Weekly Tasks.md',
  enableBadges: true,
  badgeLanguage: 'en',
  badgeSize: 12,
  showBadgesInEmbeds: true,
  calendarSystem: 'gregorian',
  targetFolder: '', // Empty means entire vault
  globalInternalTasks: [],
  taskMappings: [],
  taskProgress: [],
  showPriorityBadges: true,
  reminders: DEFAULT_REMINDER_SETTINGS,
};

export interface ParsedTask {
  content: string;
  status: TaskStatus;
  subtasks: ParsedTask[];
  deadline?: string;
  blockId?: string;
  priority?: TaskPriority; // Plugin-managed priority level
  indentation?: string; // Preserved leading whitespace
  customTags?: string[]; // Plugin-managed custom tags
  lineNumber: number;
  progress?: TaskProgress; // Progress tracking
}

export const STATUS_LABELS = {
  en: {
    '[ ]': 'Not Started',
    '[/]': 'In Progress',
    '[x]': 'Done',
    '[!]': 'Not Done',
    overdue: 'Overdue',
    daysLeft: (days: number) => `${days} Days Left`,
  },
  fa: {
    '[ ]': 'شروع نشده',
    '[/]': 'در حال انجام',
    '[x]': 'انجام شده',
    '[!]': 'انجام نشده',
    overdue: 'عقب افتاده',
    daysLeft: (days: number) => `${days} روز مانده`,
  },
};
