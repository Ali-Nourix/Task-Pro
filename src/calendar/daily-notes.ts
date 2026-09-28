// ── calendar/daily-notes.ts ───────────────────────────────────────────────
// One note per day. Where it lives, what it is called and what it starts
// with are settings; this file turns a day into that note.
//
// A day's note is named in one calendar: Gregorian (`2026-09-28`) or Jalali
// (`1405-07-06`), by default whichever the calendar is showing. The other
// calendar's name is always looked for too, before anything is created, so a
// day never ends up with two notes after the calendar is switched.
// ─────────────────────────────────────────────────────────────────────────────

import { App, TFile } from 'obsidian';
import { CalendarSettings, CalendarSystem, Language } from '../types';
import { DayKey, WEEKDAY_NAMES, addDays, formatDay, weekdayOf } from './calendar-dates';

export type DailyNoteSettings = Pick<
  CalendarSettings,
  'dailyNotesFolder' | 'gregorianNoteFormat' | 'jalaliNoteFormat' | 'dailyNoteNaming' | 'templatePath' | 'taskHeading'
>;

const DEFAULT_FORMAT: Record<CalendarSystem, string> = {
  gregorian: 'YYYY-MM-DD',
  jalali: 'jYYYY-jMM-jDD',
};

/** Characters a file name cannot carry on every platform, or that break a wiki link. */
const UNSAFE_NAME_CHARS = /[\\:*?"<>|#^[\]]/g;

/** The calendar that names a new note, given the one the calendar is showing. */
export function namingSystem(settings: DailyNoteSettings, viewSystem: CalendarSystem): CalendarSystem {
  return settings.dailyNoteNaming === 'view' ? viewSystem : settings.dailyNoteNaming;
}

/**
 * Month and weekday names follow the calendar that names the note: English
 * for a Gregorian name, Persian for a Jalali one.
 */
export function namesLanguage(system: CalendarSystem): Language {
  return system === 'jalali' ? 'fa' : 'en';
}

/** A folder setting as a vault path: no leading, trailing or doubled slashes. */
export function cleanFolder(folder: string): string {
  return folder
    .replace(/\\/g, '/')
    .split('/')
    .map((part) => part.trim())
    .filter(Boolean)
    .join('/')
    .normalize('NFC');
}

/** The name pattern a calendar uses, falling back to its default when left empty. */
export function notePattern(settings: DailyNoteSettings, system: CalendarSystem): string {
  const pattern = system === 'jalali' ? settings.jalaliNoteFormat : settings.gregorianNoteFormat;
  return pattern.trim() || DEFAULT_FORMAT[system];
}

/** The day's note path relative to the folder, without `.md`. A `/` in the pattern makes subfolders. */
export function dailyNoteName(day: DayKey, system: CalendarSystem, settings: DailyNoteSettings): string {
  const formatted = formatDay(day, notePattern(settings, system), namesLanguage(system));
  const name = formatted
    .split('/')
    .map((part) => part.replace(UNSAFE_NAME_CHARS, '-').trim())
    .filter(Boolean)
    .join('/');
  return (name || day).normalize('NFC');
}

export function dailyNotePath(day: DayKey, system: CalendarSystem, settings: DailyNoteSettings): string {
  const folder = cleanFolder(settings.dailyNotesFolder);
  return `${folder ? `${folder}/` : ''}${dailyNoteName(day, system, settings)}.md`;
}

/** Every path the day's note may have: the naming calendar's first, then the other's. */
export function dailyNoteCandidates(day: DayKey, settings: DailyNoteSettings, viewSystem: CalendarSystem): string[] {
  const first = namingSystem(settings, viewSystem);
  const other: CalendarSystem = first === 'jalali' ? 'gregorian' : 'jalali';
  return Array.from(new Set([dailyNotePath(day, first, settings), dailyNotePath(day, other, settings)]));
}

function basename(path: string): string {
  return path.split('/').pop()!.replace(/\.md$/i, '');
}

/** `HH`, `H`, `hh`, `h`, `mm`, `ss`, `A` and `a`, from a moment-style time pattern. */
function formatTimeOfDay(date: Date, pattern: string): string {
  const hours = date.getHours();
  const pad = (n: number) => String(n).padStart(2, '0');
  return pattern.replace(/\[([^\]]*)\]|HH|H|hh|h|mm|ss|A|a/g, (token: string, literal?: string) => {
    if (literal !== undefined) return literal;
    switch (token) {
      case 'HH':
        return pad(hours);
      case 'H':
        return String(hours);
      case 'hh':
        return pad(hours % 12 || 12);
      case 'h':
        return String(hours % 12 || 12);
      case 'mm':
        return pad(date.getMinutes());
      case 'ss':
        return pad(date.getSeconds());
      case 'A':
        return hours < 12 ? 'AM' : 'PM';
      case 'a':
        return hours < 12 ? 'am' : 'pm';
      default:
        return token;
    }
  });
}

export interface TemplateContext {
  day: DayKey;
  /** The calendar the note is named in. */
  system: CalendarSystem;
  settings: DailyNoteSettings;
  /** When the note is being created, for `{{time}}`. */
  now: Date;
}

/**
 * Fills a template's variables. The names match Obsidian's daily notes
 * (`{{title}}`, `{{date}}`, `{{date:FORMAT}}`, `{{time}}`), plus
 * `{{weekday}}`, `{{gregorian}}`, `{{jalali}}` and the names of the notes
 * either side, `{{yesterday}}` and `{{tomorrow}}`. A FORMAT may use Jalali
 * tokens. Anything else, Templater's `<% %>` included, is left untouched.
 */
export function renderDailyTemplate(template: string, context: TemplateContext): string {
  const { day, system, settings, now } = context;
  const language = namesLanguage(system);
  const titleOf = (key: DayKey) => basename(dailyNotePath(key, system, settings));

  return template.replace(/\{\{\s*([a-zA-Z]+)\s*(?::([^}]*))?\}\}/g, (whole: string, name: string, arg?: string) => {
    const format = arg?.trim();
    switch (name.toLowerCase()) {
      case 'title':
        return titleOf(day);
      case 'date':
        return formatDay(day, format || notePattern(settings, system), language);
      case 'time':
        return formatTimeOfDay(now, format || 'HH:mm');
      case 'weekday':
        return WEEKDAY_NAMES[language][weekdayOf(day)];
      case 'gregorian':
        return formatDay(day, format || 'YYYY-MM-DD', 'en');
      case 'jalali':
        return formatDay(day, format || 'jYYYY/jMM/jDD', 'fa');
      case 'yesterday':
        return titleOf(addDays(day, -1));
      case 'tomorrow':
        return titleOf(addDays(day, 1));
      default:
        return whole;
    }
  });
}

// ── Where a new task goes inside the note ────────────────────────────────────

interface HeadingSetting {
  level?: number;
  text: string;
}

const HEADING_LINE = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const FENCE_LINE = /^\s*(```|~~~)/;

/** `## Tasks` names a level; plain `Tasks` matches a heading of any level. */
function parseHeadingSetting(value: string): HeadingSetting | null {
  const trimmed = value.trim();
  if (!trimmed || /^#+$/.test(trimmed)) return null;
  const match = HEADING_LINE.exec(trimmed);
  if (match) return match[2] ? { level: match[1].length, text: match[2] } : null;
  return { text: trimmed };
}

function appendLine(content: string, line: string): string {
  const separator = content.length === 0 || content.endsWith('\n') ? '' : '\n';
  return `${content}${separator}${line}\n`;
}

/**
 * Adds a task line to a note: as the last line of the section under
 * `heading`, or at the end of the note when no heading is set. A heading the
 * note does not have yet is added at the end, with the task under it.
 * Headings inside code blocks are not headings.
 */
export function insertTaskLine(content: string, line: string, heading: string): string {
  const wanted = parseHeadingSetting(heading);
  if (!wanted) return appendLine(content, line);

  const lines = content.split('\n');
  const levels: Array<number | null> = [];
  let inFence = false;
  for (const text of lines) {
    if (FENCE_LINE.test(text)) {
      inFence = !inFence;
      levels.push(null);
      continue;
    }
    const match = inFence ? null : HEADING_LINE.exec(text);
    levels.push(match ? match[1].length : null);
  }

  const index = lines.findIndex((text, i) => {
    const level = levels[i];
    if (level === null) return false;
    if (wanted.level && wanted.level !== level) return false;
    return HEADING_LINE.exec(text)![2].toLowerCase() === wanted.text.toLowerCase();
  });

  if (index === -1) {
    const headingLine = `${'#'.repeat(wanted.level ?? 2)} ${wanted.text}`;
    if (!content.trim()) return `${headingLine}\n${line}\n`;
    const spacer = content.endsWith('\n\n') ? '' : content.endsWith('\n') ? '\n' : '\n\n';
    return `${content}${spacer}${headingLine}\n${line}\n`;
  }

  const level = levels[index]!;
  let end = lines.length;
  for (let i = index + 1; i < lines.length; i++) {
    const other = levels[i];
    if (other !== null && other <= level) {
      end = i;
      break;
    }
  }

  let insertAt = index + 1;
  for (let i = end - 1; i > index; i--) {
    if (lines[i].trim()) {
      insertAt = i + 1;
      break;
    }
  }
  lines.splice(insertAt, 0, line);
  return lines.join('\n');
}

// ── In the vault ─────────────────────────────────────────────────────────────

interface TemplaterPlugin {
  settings?: { trigger_on_file_creation?: boolean };
  templater?: { overwrite_file_commands?: (file: TFile) => Promise<void> };
}

export class DailyNoteService {
  constructor(
    private readonly app: App,
    private readonly getSettings: () => DailyNoteSettings
  ) {}

  /** The day's notes that exist, under either calendar's name. */
  existing(day: DayKey, viewSystem: CalendarSystem): TFile[] {
    const files: TFile[] = [];
    for (const path of dailyNoteCandidates(day, this.getSettings(), viewSystem)) {
      const file = this.app.vault.getFileByPath(path);
      if (file) files.push(file);
    }
    return files;
  }

  find(day: DayKey, viewSystem: CalendarSystem): TFile | null {
    return this.existing(day, viewSystem)[0] ?? null;
  }

  /** The note a task for the day goes into: the one that exists, or where a new one will be made. */
  target(day: DayKey, viewSystem: CalendarSystem): { path: string; exists: boolean } {
    const found = this.find(day, viewSystem);
    if (found) return { path: found.path, exists: true };
    const settings = this.getSettings();
    return { path: dailyNotePath(day, namingSystem(settings, viewSystem), settings), exists: false };
  }

  /** The day's note, created from the template when it does not exist yet. */
  async ensure(day: DayKey, viewSystem: CalendarSystem): Promise<TFile> {
    return this.find(day, viewSystem) ?? this.create(day, viewSystem, (content) => content);
  }

  /**
   * Adds a task line to the day's note. A note that does not exist yet is
   * created with the line already in it, in a single write, so nothing that
   * reacts to a new file (Templater, a sync client) sees it half made.
   */
  async addTask(day: DayKey, viewSystem: CalendarSystem, line: string): Promise<TFile> {
    const heading = this.getSettings().taskHeading;
    const existing = this.find(day, viewSystem);
    if (!existing) return this.create(day, viewSystem, (content) => insertTaskLine(content, line, heading));
    await this.app.vault.process(existing, (content) => insertTaskLine(content, line, heading));
    return existing;
  }

  private async create(
    day: DayKey,
    viewSystem: CalendarSystem,
    finish: (content: string) => string
  ): Promise<TFile> {
    const settings = this.getSettings();
    const system = namingSystem(settings, viewSystem);
    const path = dailyNotePath(day, system, settings);
    await this.ensureFolder(path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');

    const template = await this.readTemplate(settings.templatePath);
    const content = finish(renderDailyTemplate(template, { day, system, settings, now: new Date() }));
    const file = await this.app.vault.create(path, content);
    if (content.includes('<%')) await this.runTemplater(file);
    return file;
  }

  private async readTemplate(templatePath: string): Promise<string> {
    const trimmed = templatePath.trim();
    if (!trimmed) return '';
    const path = /\.md$/i.test(trimmed) ? trimmed : `${trimmed}.md`;
    const file = this.app.vault.getFileByPath(path);
    if (!file) {
      console.warn(`TaskPro: daily note template "${path}" was not found; the note starts empty.`);
      return '';
    }
    return this.app.vault.cachedRead(file);
  }

  private async ensureFolder(folder: string): Promise<void> {
    let current = '';
    for (const part of folder.split('/').filter(Boolean)) {
      current = current ? `${current}/${part}` : part;
      if (this.app.vault.getAbstractFileByPath(current)) continue;
      try {
        await this.app.vault.createFolder(current);
      } catch (error) {
        // Created by someone else in the meantime is fine; anything else is not.
        if (!this.app.vault.getAbstractFileByPath(current)) throw error;
      }
    }
  }

  /**
   * Runs Templater's commands in a note made from a template that has them.
   * When Templater is set to process every new file itself it is left to do
   * that, so the commands never run twice.
   */
  private async runTemplater(file: TFile): Promise<void> {
    const templater = (this.app as unknown as { plugins?: { plugins?: Record<string, TemplaterPlugin> } }).plugins?.plugins?.[
      'templater-obsidian'
    ];
    if (!templater || templater.settings?.trigger_on_file_creation) return;
    try {
      await templater.templater?.overwrite_file_commands?.(file);
    } catch (error) {
      console.error('TaskPro: Templater could not process the new daily note', error);
    }
  }
}
