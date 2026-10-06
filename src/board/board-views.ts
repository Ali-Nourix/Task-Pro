// ── board/board-views.ts ──────────────────────────────────────────────────
// Saved views: a name for the way the board is set up, so it can be come back
// to. A view remembers what makes the board look as it does (the layout, how
// tasks are grouped and sorted, which are filtered out, which properties
// show, how roomy the rows are) and leaves out what is only where the user
// happens to be: folded groups and parents, the search, and the note new
// tasks go into.
//
// Applying a view sets every one of those preferences, to the view's value or,
// where the view has none, to the default, so a view means the same board
// whatever it was applied over. Pure, so it is tested without a page.
// ─────────────────────────────────────────────────────────────────────────────

import type { BoardPreferences, SavedView } from '../types';

/** The preferences a view remembers. */
export const VIEW_KEYS = [
  'layout',
  'scope',
  'groupBy',
  'sortKey',
  'sortDir',
  'statuses',
  'priorities',
  'tags',
  'deadlines',
  'plans',
  'notes',
  'tableColumns',
  'cardProperties',
  'groupOrder',
  'hiddenGroups',
  'kanbanColumnWidth',
  'density',
  'wrapTitles',
  'hideEmptyGroups',
  'calendarView',
  'calendarSystem',
  'calendarSidebar',
  'calendarShowDeadlines',
  'calendarShowDailyNotes',
  'calendarShowDone',
  'timelineZoom',
  'timelineUndated',
  'compactTable',
  'rowStyle',
] as const satisfies readonly (keyof BoardPreferences)[];

type ViewKey = (typeof VIEW_KEYS)[number];

const copy = <T>(value: T): T => (value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T));

/** The board as it is now, in the words of a view: a copy, so later changes do not reach into it. */
export function snapshotView(prefs: BoardPreferences): Partial<BoardPreferences> {
  const out: Record<string, unknown> = {};
  for (const key of VIEW_KEYS) {
    if (prefs[key] !== undefined) out[key] = copy(prefs[key]);
  }
  return out as Partial<BoardPreferences>;
}

/**
 * What applying a view changes: every preference a view holds, to the view's
 * value, or to the default where the view has none, and the view marked as the
 * one applied.
 */
export function viewPatch(view: SavedView, defaults: BoardPreferences): Partial<BoardPreferences> {
  const patch: Record<string, unknown> = { activeView: view.id };
  for (const key of VIEW_KEYS) {
    patch[key] = copy(view.prefs[key] !== undefined ? view.prefs[key] : defaults[key]);
  }
  return patch as Partial<BoardPreferences>;
}

/** Whether the board still is the view: the same on every preference a view holds, a missing one counting as the default. */
export function sameView(prefs: BoardPreferences, view: SavedView, defaults: BoardPreferences): boolean {
  const value = (source: Partial<BoardPreferences>, key: ViewKey) => JSON.stringify(source[key] ?? defaults[key] ?? null);
  return VIEW_KEYS.every((key) => value(prefs, key) === value(view.prefs, key));
}

/** An ID no view has. */
export function newViewId(views: readonly SavedView[]): string {
  const taken = new Set(views.map((view) => view.id));
  let id: string;
  do id = `v${Math.random().toString(36).slice(2, 8)}`;
  while (taken.has(id));
  return id;
}

/** A name no other view has: "Focus", then "Focus 2", "Focus 3". */
export function uniqueViewName(views: readonly SavedView[], wanted: string): string {
  const base = wanted.replace(/\s+/g, ' ').trim() || 'View';
  const names = new Set(views.map((view) => view.name.toLowerCase()));
  if (!names.has(base.toLowerCase())) return base;
  for (let n = 2; ; n++) {
    if (!names.has(`${base} ${n}`.toLowerCase())) return `${base} ${n}`;
  }
}

/** Views read from saved data, which a hand edit may have broken: only whole ones with a name and an ID stay. */
export function sanitizeViews(saved: unknown): SavedView[] {
  if (!Array.isArray(saved)) return [];
  const seen = new Set<string>();
  const out: SavedView[] = [];
  for (const item of saved) {
    if (!item || typeof item !== 'object') continue;
    const { id, name, prefs } = item as Partial<SavedView>;
    if (typeof id !== 'string' || !id || seen.has(id) || typeof name !== 'string' || !name.trim()) continue;
    seen.add(id);
    // Only keys a view holds, so a stray one can never set something else.
    const kept: Record<string, unknown> = {};
    for (const key of VIEW_KEYS) {
      if (prefs && typeof prefs === 'object' && (prefs as Record<string, unknown>)[key] !== undefined) kept[key] = (prefs as Record<string, unknown>)[key];
    }
    out.push({ id, name: name.trim(), prefs: kept as Partial<BoardPreferences> });
  }
  return out;
}
