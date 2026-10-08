// ── types.ts ──────────────────────────────────────────────────────────────
// Core type definitions for TaskPro
// ─────────────────────────────────────────────────────────────────────────────

import type { BoardColumnPref } from './board/board-columns';
import type { TimelineZoom } from './timeline/timeline-localization';
import type { TaskCreationIndex } from './task-registry';
import type { TaskTag } from './tags';

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
  timer: 'timer',
  timerRunning: 'timer',
  timerPaused: 'pause',
  timerDone: 'timer-off',
  repeat: 'repeat',
  tag: 'tag',
  schedule: 'clock',
  scheduleDay: 'calendar',
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
  /** A notice shortly before a planned task starts. */
  planReminders: boolean;
  /** How long before the start, in minutes; a task's own `@remind(...)` wins. */
  planLeadMinutes: number;
  /** A chime with the notice. */
  planSound: boolean;
  /** An operating-system notification as well, where there is one (desktop). */
  planSystemNotification: boolean;
}

/** Runtime bookkeeping so restarts don't replay or skip alerts. */
export interface ReminderState {
  lastFiredAt?: number;
  /** "YYYY-MM-DD HH:mm" keys of daily slots already fired. */
  firedDailyKeys?: string[];
  /** Last successful interval check for each selected note. */
  noteLastFiredAt?: Record<string, number>;
  /** Plans already announced, so a restart does not announce them twice. */
  firedPlanKeys?: string[];
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
  planReminders: true,
  planLeadMinutes: 10,
  planSound: true,
  planSystemNotification: true,
};

export interface TaskProgress {
  enabled: boolean;
  totalSteps: number;
  currentSteps: number;
}

// ── Focus timer ────────────────────────────────────────────────────────────
// A per-task countdown. Time is derived from wall-clock stamps rather than
// counted down in memory, so a running timer survives a reload, a window
// close, or Obsidian being quit and reopened.
export type TaskTimerState = 'idle' | 'running' | 'paused' | 'done';

export interface TaskTimer {
  enabled: boolean;
  /** Planned length of the timer, in seconds. */
  durationSeconds: number;
  /** Time already banked by finished runs, in seconds. */
  elapsedSeconds: number;
  /**
   * Epoch ms when the current run started, or 0 when the timer is not running.
   * Remaining time is duration - (elapsed + now - runningSince).
   */
  runningSince: number;
  /** Epoch ms when the timer first hit zero. Set once, kept for the chip. */
  completedAt?: number;
  /** Suppresses a repeat notification after the first one for this run. */
  notifiedAt?: number;
  /**
   * The task's text, captured when the timer is attached. Kept on the timer so
   * the "time is up" notification can name the task without reading the note
   * back from disk at the moment it fires.
   */
  label?: string;
}

export interface TaskTimerEntry {
  filePath: string;
  blockId: string;
  timer: TaskTimer;
}

export const DEFAULT_TIMER_MINUTES = 25;

/** Seconds a timer has left. Negative once it has run past its duration. */
export function timerRemainingSeconds(timer: TaskTimer, now = Date.now()): number {
  return Math.round(timer.durationSeconds - timerSpentSeconds(timer, now));
}

/** Seconds spent on a timer, including the run currently in flight. */
export function timerSpentSeconds(timer: TaskTimer, now = Date.now()): number {
  const live = timer.runningSince > 0 ? Math.max(0, (now - timer.runningSince) / 1000) : 0;
  return timer.elapsedSeconds + live;
}

export function timerState(timer: TaskTimer, now = Date.now()): TaskTimerState {
  if (timer.completedAt) return 'done';
  if (timer.runningSince > 0) return timerRemainingSeconds(timer, now) <= 0 ? 'done' : 'running';
  return timerSpentSeconds(timer, now) > 0 ? 'paused' : 'idle';
}

/** mm:ss, or h:mm:ss once an hour is involved. */
export function formatTimerClock(totalSeconds: number): string {
  const sign = totalSeconds < 0 ? '-' : '';
  const abs = Math.abs(Math.round(totalSeconds));
  const hours = Math.floor(abs / 3600);
  const minutes = Math.floor((abs % 3600) / 60);
  const seconds = abs % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return hours > 0
    ? `${sign}${hours}:${pad(minutes)}:${pad(seconds)}`
    : `${sign}${minutes}:${pad(seconds)}`;
}

// ── Recurrence ─────────────────────────────────────────────────────────────
// Unlike progress and timers, a recurrence rule belongs to the task itself, so
// it lives in the note as `@repeat(1w)` next to `@due(...)` and `@priority(...)`
// and travels with the line when it is moved, synced, or shared.
export type RepeatUnit = 'day' | 'week' | 'month';

export interface TaskRepeat {
  every: number;
  unit: RepeatUnit;
}

export const REPEAT_PRESETS: ReadonlyArray<TaskRepeat> = [
  { every: 1, unit: 'day' },
  { every: 1, unit: 'week' },
  { every: 2, unit: 'week' },
  { every: 1, unit: 'month' },
] as const;

// ── Schedule ───────────────────────────────────────────────────────────────
// When a task is planned to be worked on, which is not when it is due: a task
// can be due on Friday and planned for Tuesday morning. Like a deadline it
// belongs to the task, so it is written into the line as
// `@schedule(2026-09-28 09:00-10:30)`, or `@schedule(2026-09-28)` for a day
// with no set time.
export interface TaskSchedule {
  /** `YYYY-MM-DD`, Gregorian, like every date TaskPro stores. */
  date: string;
  /** `HH:mm`, 24-hour. Absent when the task is planned for the day, with no time. */
  start?: string;
  /** `HH:mm`, later than `start` on the same day; `24:00` is the midnight that ends it. */
  end?: string;
}

// ── Calendar ───────────────────────────────────────────────────────────────
export type CalendarView = 'month' | 'week' | 'day' | 'agenda';
/** `auto` starts a Jalali week on Saturday and a Gregorian one on Monday. */
export type WeekStart = 'auto' | 'saturday' | 'sunday' | 'monday';
/** Which calendar names a new daily note: the one the calendar is showing, or always one of them. */
export type DailyNoteNaming = 'view' | 'gregorian' | 'jalali';
/** Where a task created on a day in the calendar is written. */
export type CalendarTaskTarget = 'daily' | 'inbox';
export type TimeFormat = '24h' | '12h';

export interface CalendarSettings {
  /** Folder daily notes live in. Empty is the vault root. */
  dailyNotesFolder: string;
  /** File name for a day when the Gregorian calendar names it. `/` makes subfolders. */
  gregorianNoteFormat: string;
  /** File name for a day when the Jalali calendar names it. */
  jalaliNoteFormat: string;
  dailyNoteNaming: DailyNoteNaming;
  /** Note whose content a new daily note starts from. Empty for a blank note. */
  templatePath: string;
  /** Heading new tasks go under, e.g. `## Tasks`. Empty adds them at the end of the note. */
  taskHeading: string;
  newTaskTarget: CalendarTaskTarget;
  weekStart: WeekStart;
  /** The hour the week and day grids open at. */
  dayStartHour: number;
  /** Minutes a drag snaps to in the time grid. */
  slotMinutes: number;
  /** Length of a block made by a click rather than a drag, in minutes. */
  defaultDurationMinutes: number;
  timeFormat: TimeFormat;
}

export const DEFAULT_CALENDAR_SETTINGS: CalendarSettings = {
  dailyNotesFolder: 'Daily',
  gregorianNoteFormat: 'YYYY-MM-DD',
  jalaliNoteFormat: 'jYYYY-jMM-jDD',
  dailyNoteNaming: 'view',
  templatePath: '',
  taskHeading: '',
  newTaskTarget: 'daily',
  weekStart: 'auto',
  dayStartHour: 7,
  slotMinutes: 15,
  defaultDurationMinutes: 60,
  timeFormat: '24h',
};

// ── Task board ─────────────────────────────────────────────────────────────
// The all-tasks view. Its preferences are remembered between sessions, so the
// board reopens exactly as it was left.
export type BoardScope = 'target' | 'vault';
export type BoardLayout = 'table' | 'board' | 'calendar' | 'timeline';
export type BoardGroupBy = 'none' | 'status' | 'tag' | 'priority' | 'deadline' | 'plan' | 'note';

/** Where a date falls against today: what the board groups and filters deadlines and plans by. */
export type DeadlineBucket = 'overdue' | 'today' | 'week' | 'later' | 'past' | 'none';
/** How much room the table's rows and the board's cards take. */
export type BoardDensity = 'compact' | 'comfortable' | 'spacious';
export type BoardSortKey = 'document' | 'title' | 'status' | 'priority' | 'deadline' | 'plan' | 'progress' | 'note';
export type BoardSortDir = 'asc' | 'desc';
/** A priority filter entry: a level, or tasks that have none. */
export type BoardPriorityFilter = TaskPriority | 'none';

export interface BoardPreferences {
  scope: BoardScope;
  layout: BoardLayout;
  groupBy: BoardGroupBy;
  sortKey: BoardSortKey;
  sortDir: BoardSortDir;
  /** Statuses shown. Empty means every status. */
  statuses: TaskStatus[];
  /** Priorities shown. Empty means every priority. */
  priorities: BoardPriorityFilter[];
  /** Tag keys shown (a task matches if it has any). `''` is "no tag". Empty means all. */
  tags: string[];
  /** Where a deadline may fall for a task to show. Unset or empty means anywhere. */
  deadlines?: DeadlineBucket[];
  /** Where a plan may fall for a task to show; `overdue` is a plan that was missed. Unset or empty means anywhere. */
  plans?: DeadlineBucket[];
  /** The notes (paths) whose tasks show. Unset or empty means every note. */
  notes?: string[];
  /** Group keys the user folded away, per grouping. */
  collapsedGroups: string[];
  /** Note that the quick-add row writes new tasks into. */
  inboxPath: string;
  calendarView: CalendarView;
  /** The calendar the calendar layout shows. Unset follows TaskPro's calendar setting. */
  calendarSystem?: CalendarSystem;
  /** The unscheduled-tasks list beside the week and day grids. */
  calendarSidebar: boolean;
  calendarShowDeadlines: boolean;
  calendarShowDailyNotes: boolean;
  calendarShowDone: boolean;
  /** The table's property columns: order, width, and which are hidden. Unset is the default set. */
  tableColumns?: BoardColumnPref[];
  /** The properties a board card shows, in order. Unset is the default set. */
  cardProperties?: BoardColumnPref[];
  /** The order of a board's columns, per grouping, by group value. */
  groupOrder?: Partial<Record<BoardGroupBy, string[]>>;
  /** Board columns taken off the board, by group id (`status:[x]`). */
  hiddenGroups?: string[];
  /** The width of every column on the board, in pixels. */
  kanbanColumnWidth?: number;
  /** The timeline's scale. Unset is days. */
  timelineZoom?: TimelineZoom;
  /** Whether the timeline lists the tasks that have no dates. */
  timelineUndated?: boolean;
  /** On a phone, the table as a list of rows (the default) or as the full table. */
  compactTable?: 'list' | 'table';
  /** On a phone, a row's properties as one calm line (the default) or as chips. */
  rowStyle?: 'light' | 'chips';
  /** Rows and cards tight, as drawn, or roomy. */
  density?: BoardDensity;
  /** Titles run over as many lines as they need, rather than ending in an ellipsis. */
  wrapTitles?: boolean;
  /** The board leaves out the columns that have no task in them. */
  hideEmptyGroups?: boolean;
  /** Parents in the table whose subtasks are folded away: a note and an ID or title, see foldKey. */
  foldedTasks?: string[];
  /** Views the user saved: a name and how the board was set up. */
  views?: SavedView[];
  /** The view last applied. The board says when it has been changed since. */
  activeView?: string;
}

/** A named way of looking at the tasks: a layout, its grouping and sorting, its filters and its options. */
export interface SavedView {
  id: string;
  name: string;
  prefs: Partial<BoardPreferences>;
}

export const DEFAULT_BOARD_PREFERENCES: BoardPreferences = {
  scope: 'target',
  layout: 'table',
  groupBy: 'status',
  sortKey: 'document',
  sortDir: 'asc',
  statuses: [],
  priorities: [],
  tags: [],
  collapsedGroups: [],
  inboxPath: '',
  calendarView: 'month',
  calendarSidebar: true,
  calendarShowDeadlines: true,
  calendarShowDailyNotes: true,
  calendarShowDone: true,
};

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

/** The link between the notes and the Telegram bot (see supabase/README.md). */
export interface TelegramSettings {
  enabled: boolean;
  /** The project's address, or the sync function's. */
  url: string;
  token: string;
  /** How often to ask for changes while Obsidian is open, in minutes. */
  intervalMinutes: number;
  /** Seconds the notes must be quiet before an edit is sent to the bot. */
  quietSeconds?: number;
  lastSyncAt?: string;
  lastError?: string;
  /** Changes made in the notes that the bot has not yet confirmed. */
  unconfirmed?: Array<{ id: string; key?: string; from?: string; error?: string }>;
}

export const DEFAULT_TELEGRAM_SETTINGS: TelegramSettings = {
  enabled: false,
  url: '',
  token: '',
  intervalMinutes: 2,
  quietSeconds: 4,
};

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
  taskTimers: TaskTimerEntry[]; // Focus timers, stored per task like progress
  showTimerBadges: boolean; // Toggle focus-timer chip rendering
  showRepeatBadges: boolean; // Toggle recurrence chip rendering
  showTagBadges: boolean; // Toggle tag chip rendering
  showScheduleBadges: boolean; // Toggle schedule chip rendering
  /** A parent task shows how many of its subtasks are done, where it has no progress bar of its own. */
  showSubtaskProgress: boolean;
  /** A task that waits on another shows a chip naming it. */
  showWaitingBadges: boolean;
  /** Typing `@` on a task line lists the properties it can be given. */
  propertySuggest: boolean;
  /**
   * A task written without a plan is planned for the day it was written on,
   * `@schedule(YYYY-MM-DD)`, so the calendar and the Telegram bot show it.
   */
  autoPlanNewTasks: boolean;
  /** On a touch screen, two fingers pulled down anywhere in Obsidian open the task board. */
  boardGesture: boolean;
  /** User-defined tags: key written into notes, name and colour kept here. */
  tags: TaskTag[];
  /** How the all-tasks board was last left. */
  board: BoardPreferences;
  /** Daily notes and the calendar's time grid. */
  calendar: CalendarSettings;
  /** Minutes offered when a focus timer is first added to a task. */
  defaultTimerMinutes: number;
  /** Post a desktop (Windows / macOS / Linux) notification when a timer ends. */
  timerSystemNotification: boolean;
  /** Play the reminder sound when a timer ends. */
  timerSound: boolean;
  /** Show the running timer in Obsidian's status bar. */
  timerInStatusBar: boolean;
  reminders: ReminderSettings; // Daily reminder configuration
  telegram: TelegramSettings;
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
  taskTimers: [],
  showTimerBadges: true,
  showRepeatBadges: true,
  showTagBadges: true,
  showScheduleBadges: true,
  showSubtaskProgress: true,
  showWaitingBadges: true,
  propertySuggest: true,
  autoPlanNewTasks: true,
  boardGesture: true,
  tags: [],
  board: DEFAULT_BOARD_PREFERENCES,
  calendar: DEFAULT_CALENDAR_SETTINGS,
  defaultTimerMinutes: DEFAULT_TIMER_MINUTES,
  timerSystemNotification: true,
  timerSound: true,
  timerInStatusBar: true,
  reminders: DEFAULT_REMINDER_SETTINGS,
  telegram: DEFAULT_TELEGRAM_SETTINGS,
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
  repeat?: TaskRepeat; // Plugin-managed recurrence rule
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
