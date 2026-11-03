// A scheduling zone changes wall-time interpretation, not the device's UTC clock.
let configuredZone = '';
const formatters = new Map<string, Intl.DateTimeFormat>();
export function validTimeZone(zone: string): boolean {
  if (!zone) return true;
  try { new Intl.DateTimeFormat('en', { timeZone: zone }).format(); return true; } catch { return false; }
}
export function setTaskTimeZone(zone: string): string {
  configuredZone = validTimeZone(zone) ? zone : '';
  return configuredZone;
}
export function getTaskTimeZone(): string { return configuredZone; }
export function taskClockParts(now = Date.now(), zone = configuredZone): { date: string; minutes: number; second: number } {
  if (!zone) {
    const d = new Date(now), pad = (n: number) => String(n).padStart(2, '0');
    return { date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, minutes: d.getHours() * 60 + d.getMinutes(), second: d.getSeconds() };
  }
  let formatter = formatters.get(zone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-CA', { timeZone: zone, calendar: 'gregory', numberingSystem: 'latn', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
    formatters.set(zone, formatter);
  }
  const parts = Object.fromEntries(formatter.formatToParts(now).map(p => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, minutes: Number(parts.hour) * 60 + Number(parts.minute), second: Number(parts.second) };
}
/** A gap in DST has no instant; a repeated wall time chooses its earlier occurrence. */
export function scheduledEpoch(date: string, time: string, zone = configuredZone): number | null {
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date), clock = /^(\d{1,2}):(\d{2})$/.exec(time);
  if (!day || !clock || !validTimeZone(zone)) return null;
  const [year, month, dom] = day.slice(1).map(Number), [hour, minute] = clock.slice(1).map(Number);
  if (hour > 23 || minute > 59) return null;
  const utc = Date.UTC(year, month - 1, dom, hour, minute);
  if (new Date(utc).toISOString().slice(0, 10) !== date) return null;
  if (!zone) {
    const stamp = new Date(year, month - 1, dom, hour, minute).getTime();
    const p = taskClockParts(stamp, '');
    return p.date === date && p.minutes === hour * 60 + minute ? stamp : null;
  }
  const offsets = new Set<number>();
  for (const delta of [-86400000, 0, 86400000]) {
    const sample = utc + delta, p = taskClockParts(sample, zone);
    offsets.add(Date.parse(`${p.date}T00:00:00Z`) + p.minutes * 60000 + p.second * 1000 - sample);
  }
  const matches = [...offsets].map(offset => utc - offset).filter(stamp => {
    const p = taskClockParts(stamp, zone);
    return p.date === date && p.minutes === hour * 60 + minute;
  });
  return matches.length ? Math.min(...matches) : null;
}
