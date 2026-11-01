// Inherit a daily note's day only after the plugin's configured resolver confirms
// the complete path. A date-looking title in an ordinary note is not a plan.
import { dayKey, parseDayKey } from '../calendar/calendar-dates';
import { gregorianToJalali, jalaliToGregorian } from '../date-utils';

export function dailyNoteDay(path: string, target?: (day: string) => string | null): string | null {
  if (!target) return null;
  const name = path.split('/').pop()?.replace(/\.md$/i, '') ?? '';
  const normalize = (value: string) => value.replace(/[۰-۹]/g, n => String(n.charCodeAt(0) - 0x6f0)).replace(/[٠-٩]/g, n => String(n.charCodeAt(0) - 0x660));
  const dates = [...normalize(name).matchAll(/(?:^|[^\d])(\d{4})-(\d{2})-(\d{2})(?!\d)/g)];
  const candidates = new Set<string>();
  for (const match of dates) {
    const [y, m, d] = match.slice(1).map(Number);
    const g = dayKey(y, m, d);
    if (parseDayKey(g)) candidates.add(g);
    if (y >= 1 && y <= 3177 && m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      const converted = jalaliToGregorian(y, m, d);
      const roundtrip = gregorianToJalali(...converted);
      if (roundtrip[0] === y && roundtrip[1] === m && roundtrip[2] === d) candidates.add(dayKey(...converted));
    }
  }
  const confirmed = [...candidates].filter(day => {
    if (target(day) !== path) return false;
    // An inbox destination can be the same file for every day. It cannot
    // establish that this is a daily note, even if its name contains a date.
    const date = new Date(day + 'T12:00:00Z');
    date.setUTCDate(date.getUTCDate() + 1);
    return target(date.toISOString().slice(0, 10)) !== path;
  });
  return confirmed.length === 1 ? confirmed[0] : null;
}
