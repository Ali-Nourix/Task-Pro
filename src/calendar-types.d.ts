// ── calendar-types.d.ts ───────────────────────────────────────────────────
// Type definitions for Persian Ultimate Calendar plugin API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Persian Ultimate Calendar Plugin API
 * 
 * This plugin provides a calendar picker with support for both Jalali (Persian)
 * and Gregorian calendars.
 */
declare module 'obsidian' {
  interface App {
    plugins?: {
      plugins?: {
        'persian-ultimate-calendar'?: {
          api?: PersianCalendarPluginAPI;
        };
      };
    };
  }
}

/**
 * Calendar picker options
 */
export interface CalendarPickerOptions {
  /** Calendar system to use: 'jalali' (Persian) or 'gregorian' (Western) */
  calendar?: 'jalali' | 'gregorian';
  
  /** Output format for the selected date */
  outputFormat?: 'iso' | 'moment-format' | 'object';
  
  /** Custom format string (used with 'moment-format' output) */
  format?: string;
  
  /** Initial date to show in the calendar (YYYY-MM-DD or custom format) */
  initialDate?: string;
  
  /** Title to display in the calendar modal */
  title?: string;
}

/**
 * Date object returned by the calendar picker
 */
export interface CalendarDateObject {
  /** ISO format date string (YYYY-MM-DD) */
  iso: string;
  
  /** Unix timestamp in milliseconds */
  timestamp: number;
  
  /** Gregorian date components */
  gregorian: {
    year: number;
    month: number;
    day: number;
  };
  
  /** Jalali (Persian) date components */
  jalali: {
    year: number;
    month: number;
    day: number;
  };
}

/**
 * Result returned by pickDate method
 */
export interface CalendarPickerResult extends CalendarDateObject {
  /** 
   * Formatted value based on outputFormat:
   * - 'iso': string (YYYY-MM-DD)
   * - 'moment-format': string (custom format)
   * - 'object': CalendarDateObject
   */
  value: string | CalendarDateObject;
}

/**
 * Persian Ultimate Calendar Plugin API interface
 */
export interface PersianCalendarPluginAPI {
  /**
   * Open the calendar picker and return the selected date
   * 
   * @param options - Calendar picker options
   * @returns Promise that resolves to the selected date or null if cancelled
   * 
   * @example
   * ```typescript
   * // Get date in ISO format
   * const result = await api.pickDate({
   *   calendar: 'jalali',
   *   outputFormat: 'iso'
   * });
   * // result.value = "2025-05-15"
   * 
   * // Get date with custom format
   * const result = await api.pickDate({
   *   outputFormat: 'moment-format',
   *   format: 'jYYYY/jMM/jDD'
   * });
   * // result.value = "1404/02/25"
   * 
   * // Get full date object
   * const result = await api.pickDate({
   *   outputFormat: 'object'
   * });
   * // result.value = { iso: "2025-05-15", timestamp: ..., gregorian: {...}, jalali: {...} }
   * ```
   */
  pickDate(options?: CalendarPickerOptions): Promise<CalendarPickerResult | null>;
}
