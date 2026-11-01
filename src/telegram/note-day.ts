// Daily-note identity is independent of where NEW tasks are created. Recognize
// only a whole date-only basename (optionally a calendar emoji), not dates in
// arbitrary titles, folders, headings or creation timestamps. Explicit plans win.
import { dayKey, parseDayKey } from '../calendar/calendar-dates';
import { gregorianToJalali, jalaliToGregorian } from '../date-utils';

export function dailyNoteDay(path: string): string | null {
  const name = (path.replace(/\\/g, '/').split('/').pop() ?? '').replace(/\.md$/i, '').trim()
    .replace(/[۰-۹]/g, n => String(n.charCodeAt(0) - 0x6f0))
    .replace(/[٠-٩]/g, n => String(n.charCodeAt(0) - 0x660));
  const match = /^(?:(?:📅|📆|🗓\uFE0F?)\s*)?(\d{4})-(\d{2})-(\d{2})$/.exec(name);
  if (!match) return null;
  const [year, month, day] = match.slice(1).map(Number);
  // Unambiguous modern daily-note conventions; unsupported/ambiguous years
  // remain undated instead of silently assigning a wrong millennium.
  if (year >= 1900 && year <= 2199) {
    const key = dayKey(year, month, day);
    return parseDayKey(key) ? key : null;
  }
  if (year < 1300 || year > 1599 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const g = jalaliToGregorian(year, month, day);
  const j = gregorianToJalali(...g);
  return j[0] === year && j[1] === month && j[2] === day ? dayKey(...g) : null;
}
