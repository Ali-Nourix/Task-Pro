// Reading the pieces of a task out of words: a title safe for a note, a repeat, tags.
// Shared by what is typed into the bot and by what the assistant sends.

import { normalize } from './quickadd.ts';

/** Words that mean "none" in answers about a property. */
export const OFF = new Set(['off', 'none', 'no', 'خاموش', 'هیچ', 'نه', 'حذف']);

export const MAX_TAGS = 20;

/** A title safe to write into a note: no markers of ours, no block ID. */
export function cleanTitle(title: string): string {
  return title
    .replace(/\s+/g, ' ')
    .replace(/@(?=[a-z]+\()/gi, '')
    .replace(/\s*\^[\w-]+$/, '')
    .replace(/^[-*+]\s+(\[.\]\s*)?/, '')
    .trim()
    .slice(0, 300);
}

/** The words after "every" as a repeat token: «هر ۳ روز» is 3d. Null for none, undefined when unreadable. */
export function parseRepeat(text: string): string | null | undefined {
  const t = normalize(text).replace(/\s+/g, ' ').trim();
  if (!t) return undefined;
  if (OFF.has(t) || /^(بدون|هیچ|no|none|never)/.test(t)) return null;
  const named: Record<string, string> = { روزانه: '1d', daily: '1d', هفتگی: '1w', weekly: '1w', ماهانه: '1m', monthly: '1m' };
  if (named[t]) return named[t];
  const units: Record<string, string> = { روز: 'd', day: 'd', days: 'd', d: 'd', هفته: 'w', week: 'w', weeks: 'w', w: 'w', ماه: 'm', month: 'm', months: 'm', m: 'm' };
  const match = /^(?:هر|every|each)?\s*(\d{1,3})?\s*([a-z؀-ۿ]+)$/.exec(t);
  const unit = match && units[match[2]];
  const every = match?.[1] ? Number(match[1]) : 1;
  return unit && every >= 1 ? `${every}${unit}` : undefined;
}

/** Tag keys from what was typed: «#کار  خانه, home» is three. */
export function parseTags(text: string): string[] {
  const keys: string[] = [];
  for (const part of text.split(/[\s,،#]+/)) {
    const key = part
      .normalize('NFC')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\p{M}_\-/‌]/gu, '')
      .replace(/-{2,}/g, '-')
      .replace(/^[-/]+|[-/]+$/g, '');
    if (key && !keys.includes(key)) keys.push(key);
  }
  return keys.slice(0, MAX_TAGS);
}
