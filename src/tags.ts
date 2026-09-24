// ── tags.ts ───────────────────────────────────────────────────────────────
// User-defined task tags: a key written into the note, a display name, a
// colour. The note only ever stores the key (`@tag(deep-work)`), so renaming
// a tag or recolouring it is a settings change, never a vault-wide rewrite.
// ─────────────────────────────────────────────────────────────────────────────

import { Language } from './types';
import { normalizeTagKey } from './task-metadata';

/** A palette token (`blue`, `green`, …) or a `#rrggbb` colour. */
export type TagColor = string;

export interface TaskTag {
  /** What the note stores inside `@tag(...)`. Never changes once created. */
  key: string;
  /** Shown on chips and in the board. Free text, any script. */
  name: string;
  color: TagColor;
}

/** A tag as rendered: a known one from the list, or a key nobody defined. */
export interface ResolvedTag extends TaskTag {
  /** True when a note carries a key that is not in the tag list. */
  unknown?: boolean;
}

/**
 * Palette tokens map onto Obsidian's own accent variables, so a tag coloured
 * "blue" is the active theme's blue in light and dark mode alike. The hex is
 * only a fallback for a theme that does not define the variable.
 */
export const TAG_PALETTE: ReadonlyArray<{ id: string; cssVar: string; fallback: string }> = [
  { id: 'red', cssVar: '--color-red', fallback: '#e5484d' },
  { id: 'orange', cssVar: '--color-orange', fallback: '#e8762d' },
  { id: 'yellow', cssVar: '--color-yellow', fallback: '#c9a400' },
  { id: 'green', cssVar: '--color-green', fallback: '#3aa675' },
  { id: 'cyan', cssVar: '--color-cyan', fallback: '#1e8a9c' },
  { id: 'blue', cssVar: '--color-blue', fallback: '#2f6fbd' },
  { id: 'purple', cssVar: '--color-purple', fallback: '#7048b6' },
  { id: 'pink', cssVar: '--color-pink', fallback: '#c2407f' },
  { id: 'gray', cssVar: '--text-muted', fallback: '#75726d' },
];

const PALETTE_BY_ID = new Map(TAG_PALETTE.map((entry) => [entry.id, entry]));
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

export const TAG_COLOR_LABELS: Record<Language, Record<string, string>> = {
  en: {
    red: 'Red',
    orange: 'Orange',
    yellow: 'Yellow',
    green: 'Green',
    cyan: 'Cyan',
    blue: 'Blue',
    purple: 'Purple',
    pink: 'Pink',
    gray: 'Gray',
    custom: 'Custom colour',
  },
  fa: {
    red: 'قرمز',
    orange: 'نارنجی',
    yellow: 'زرد',
    green: 'سبز',
    cyan: 'فیروزه‌ای',
    blue: 'آبی',
    purple: 'بنفش',
    pink: 'صورتی',
    gray: 'خاکستری',
    custom: 'رنگ دلخواه',
  },
};

export function isValidTagColor(color: unknown): color is TagColor {
  return typeof color === 'string' && (PALETTE_BY_ID.has(color) || HEX_COLOR.test(color));
}

/** CSS value for a tag colour, ready for `--taskpro-chip-accent`. */
export function resolveTagColor(color: TagColor | undefined): string {
  if (color && HEX_COLOR.test(color)) return color;
  const entry = PALETTE_BY_ID.get(color ?? '') ?? PALETTE_BY_ID.get('gray')!;
  return `var(${entry.cssVar}, ${entry.fallback})`;
}

/** Sets the chip accent on an element, so every tag uses the shared chip recipe. */
export function applyTagColor(el: HTMLElement, color: TagColor | undefined): void {
  el.style.setProperty('--taskpro-chip-accent', resolveTagColor(color));
}

/** The next palette colour to hand a new tag, so a fresh list is not all one hue. */
export function nextTagColor(existing: readonly TaskTag[]): TagColor {
  const hues = TAG_PALETTE.filter((entry) => entry.id !== 'gray');
  const used = new Set(existing.map((tag) => tag.color));
  const unused = hues.find((entry) => !used.has(entry.id));
  return (unused ?? hues[existing.length % hues.length]).id;
}

/** A key derived from `name` that no existing tag uses yet. */
export function uniqueTagKey(name: string, existing: readonly TaskTag[]): string {
  const base = normalizeTagKey(name) || 'tag';
  const taken = new Set(existing.map((tag) => tag.key));
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** Builds a new tag. The caller adds it to the list and saves. */
export function createTag(name: string, existing: readonly TaskTag[], color?: TagColor): TaskTag {
  const trimmed = name.trim();
  return {
    key: uniqueTagKey(trimmed, existing),
    name: trimmed || 'Tag',
    color: isValidTagColor(color) ? color : nextTagColor(existing),
  };
}

/** Looks a key up in the list, falling back to a neutral chip named after the key. */
export function resolveTag(key: string, tags: readonly TaskTag[]): ResolvedTag {
  const known = tags.find((tag) => tag.key === key);
  return known ?? { key, name: key, color: 'gray', unknown: true };
}

/** Drops malformed entries from saved data, so a hand-edited data.json cannot break rendering. */
export function sanitizeTags(raw: unknown): TaskTag[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const clean: TaskTag[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const key = normalizeTagKey(String((entry as TaskTag).key ?? ''));
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const name = String((entry as TaskTag).name ?? '').trim() || key;
    const color = isValidTagColor((entry as TaskTag).color) ? (entry as TaskTag).color : 'gray';
    clean.push({ key, name, color });
  }
  return clean;
}
