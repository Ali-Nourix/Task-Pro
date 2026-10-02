// Dates and clocks for the bot. A day is a `YYYY-MM-DD` string and a time of day
// is `HH:MM`; a moment is an instant, worked out in the owner's time zone.

export const pad2 = (n: number): string => String(n).padStart(2, '0');

export function isoDate(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, '0')}-${pad2(m)}-${pad2(d)}`;
}

export function parseIso(date: string): [number, number, number] {
  const [y, m, d] = date.split('-').map(Number);
  return [y, m, d];
}

export function isRealDate(date: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return false;
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const at = new Date(Date.UTC(y, m - 1, d));
  return at.getUTCFullYear() === y && at.getUTCMonth() === m - 1 && at.getUTCDate() === d;
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = parseIso(date);
  const at = new Date(Date.UTC(y, m - 1, d + days));
  return isoDate(at.getUTCFullYear(), at.getUTCMonth() + 1, at.getUTCDate());
}

/** 0 is Sunday. */
export function weekdayOf(date: string): number {
  const [y, m, d] = parseIso(date);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function daysBetween(from: string, to: string): number {
  const [fy, fm, fd] = parseIso(from);
  const [ty, tm, td] = parseIso(to);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000);
}

export function clockMinutes(clock: string): number {
  const [h, m] = clock.split(':').map(Number);
  return h * 60 + m;
}

export function toClock(minutes: number): string {
  return `${pad2(Math.floor(minutes / 60))}:${pad2(minutes % 60)}`;
}

export function isClock(value: string): boolean {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  return !!match && Number(match[1]) < 24 && Number(match[2]) < 60;
}

/** How far ahead of UTC a zone is at an instant, in minutes. */
export function zoneOffsetMinutes(zone: string, at: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find((part) => part.type === type)!.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60_000);
}

/** The day and the minute of the day it is in a zone. */
export function localNow(zone: string, at: Date): { date: string; minutes: number } {
  const offset = zoneOffsetMinutes(zone, at);
  const shifted = new Date(at.getTime() + offset * 60_000);
  return {
    date: isoDate(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate()),
    minutes: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
  };
}

/** The instant a day and a time of day are in a zone. */
export function localToUtc(zone: string, date: string, time: string): Date {
  const [y, m, d] = parseIso(date);
  const [h, mi] = time.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, h, mi);
  const first = zoneOffsetMinutes(zone, new Date(guess));
  let at = guess - first * 60_000;
  const second = zoneOffsetMinutes(zone, new Date(at));
  if (second !== first) at = guess - second * 60_000;
  return new Date(at);
}

/** The day and the time of day an instant is in a zone. */
export function utcToLocal(zone: string, at: Date): { date: string; time: string } {
  const { date, minutes } = localNow(zone, at);
  return { date, time: toClock(minutes) };
}

export function isZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}
