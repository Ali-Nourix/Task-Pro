// ── calendar-integration.ts ───────────────────────────────────────────────
// Integration with Persian Ultimate Calendar plugin API
// ─────────────────────────────────────────────────────────────────────────────

import { App } from 'obsidian';
import { CalendarSystem } from './types';

/**
 * Persian Ultimate Calendar Plugin API interface
 */
interface PersianCalendarAPI {
  pickDate(options?: {
    calendar?: 'jalali' | 'gregorian';
    outputFormat?: 'iso' | 'moment-format' | 'object';
    format?: string;
    initialDate?: string;
    title?: string;
  }): Promise<{
    iso: string;
    timestamp: number;
    gregorian: { year: number; month: number; day: number };
    jalali: { year: number; month: number; day: number };
    value: string | object;
  } | null>;
}

/**
 * Check if Persian Ultimate Calendar plugin is available
 */
export function isCalendarPluginAvailable(app: App): boolean {
  const plugin = (app as any).plugins?.plugins?.['persian-ultimate-calendar'];
  return plugin && plugin.api && typeof plugin.api.pickDate === 'function';
}

/**
 * Get the Persian Ultimate Calendar plugin API
 */
function getCalendarAPI(app: App): PersianCalendarAPI | null {
  const plugin = (app as any).plugins?.plugins?.['persian-ultimate-calendar'];
  if (plugin && plugin.api) {
    return plugin.api;
  }
  return null;
}

/**
 * Open the calendar picker and return selected date in ISO format (YYYY-MM-DD)
 * Falls back to native input if calendar plugin is not available
 */
export async function pickDateWithCalendar(
  app: App,
  options: {
    calendarSystem?: CalendarSystem;
    initialDate?: string;
    title?: string;
    language?: 'en' | 'fa';
  } = {}
): Promise<string | null> {
  const api = getCalendarAPI(app);
  
  if (!api) {
    // Fallback: Calendar plugin not available, return null to use native input
    return null;
  }

  try {
    const result = await api.pickDate({
      calendar: options.calendarSystem === 'jalali' ? 'jalali' : 'gregorian',
      outputFormat: 'iso',
      initialDate: options.initialDate,
      title: options.title,
    });

    if (result && result.iso) {
      return result.iso;
    }

    return null;
  } catch (error) {
    console.error('TaskPro: Error calling calendar API:', error);
    return null;
  }
}

/**
 * Open the calendar picker with custom format
 */
export async function pickDateWithFormat(
  app: App,
  options: {
    calendarSystem?: CalendarSystem;
    format?: string;
    initialDate?: string;
    title?: string;
  } = {}
): Promise<string | null> {
  const api = getCalendarAPI(app);
  
  if (!api) {
    return null;
  }

  try {
    const result = await api.pickDate({
      calendar: options.calendarSystem === 'jalali' ? 'jalali' : 'gregorian',
      outputFormat: 'moment-format',
      format: options.format || 'YYYY-MM-DD',
      initialDate: options.initialDate,
      title: options.title,
    });

    if (result && typeof result.value === 'string') {
      return result.value;
    }

    return null;
  } catch (error) {
    console.error('TaskPro: Error calling calendar API:', error);
    return null;
  }
}

/**
 * Open the calendar picker and return full date object
 */
export async function pickDateObject(
  app: App,
  options: {
    calendarSystem?: CalendarSystem;
    initialDate?: string;
    title?: string;
  } = {}
): Promise<{
  iso: string;
  timestamp: number;
  gregorian: { year: number; month: number; day: number };
  jalali: { year: number; month: number; day: number };
} | null> {
  const api = getCalendarAPI(app);
  
  if (!api) {
    return null;
  }

  try {
    const result = await api.pickDate({
      calendar: options.calendarSystem === 'jalali' ? 'jalali' : 'gregorian',
      outputFormat: 'object',
      initialDate: options.initialDate,
      title: options.title,
    });

    if (result) {
      return {
        iso: result.iso,
        timestamp: result.timestamp,
        gregorian: result.gregorian,
        jalali: result.jalali,
      };
    }

    return null;
  } catch (error) {
    console.error('TaskPro: Error calling calendar API:', error);
    return null;
  }
}
