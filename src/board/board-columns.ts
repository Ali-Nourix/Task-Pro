// ── board/board-columns.ts ────────────────────────────────────────────────
// The properties the table shows as columns and a card shows under its
// title: which ones, in what order, and how wide. Like a Notion view's
// properties, they are the board's to arrange: a column is dragged to a new
// place, its edge is dragged to resize it, and a property is shown or hidden
// from the properties menu. The task's title always comes first and fills
// what is left of the width.
// ─────────────────────────────────────────────────────────────────────────────

import type { BoardSortKey } from '../types';

export type BoardPropertyId = 'status' | 'tags' | 'priority' | 'deadline' | 'plan' | 'waiting' | 'repeat' | 'progress' | 'note';

export interface BoardColumnPref {
  id: BoardPropertyId;
  /** Pixels; unset keeps the property's own width. */
  width?: number;
  hidden?: boolean;
}

export interface BoardPropertyInfo {
  icon: string;
  /** The width a column starts at, and the least it can be dragged to. */
  width: number;
  min: number;
  /** What a click on its header sorts by, when it sorts. */
  sortKey?: BoardSortKey;
}

export const BOARD_PROPERTIES: Record<BoardPropertyId, BoardPropertyInfo> = {
  status: { icon: 'circle-dot', width: 136, min: 96, sortKey: 'status' },
  tags: { icon: 'tags', width: 180, min: 90 },
  priority: { icon: 'flag', width: 112, min: 84, sortKey: 'priority' },
  deadline: { icon: 'calendar', width: 196, min: 110, sortKey: 'deadline' },
  plan: { icon: 'clock', width: 196, min: 110, sortKey: 'plan' },
  waiting: { icon: 'hourglass', width: 180, min: 110 },
  repeat: { icon: 'repeat', width: 132, min: 90 },
  progress: { icon: 'pie-chart', width: 112, min: 80, sortKey: 'progress' },
  note: { icon: 'file-text', width: 150, min: 90, sortKey: 'note' },
};

/** The properties in their first order; repeat starts hidden, as few tasks repeat. */
export const DEFAULT_COLUMNS: readonly BoardColumnPref[] = [
  { id: 'status' },
  { id: 'tags' },
  { id: 'priority' },
  { id: 'deadline' },
  { id: 'plan' },
  { id: 'waiting' },
  { id: 'progress' },
  { id: 'note' },
  { id: 'repeat', hidden: true },
];

/** What a card shows under its title; status is left to the columns, which usually are statuses. */
export const DEFAULT_CARD_PROPERTIES: readonly BoardColumnPref[] = [
  { id: 'tags' },
  { id: 'priority' },
  { id: 'deadline' },
  { id: 'plan' },
  { id: 'waiting' },
  { id: 'progress' },
  { id: 'note' },
  { id: 'status', hidden: true },
  { id: 'repeat', hidden: true },
];

/** A board column's width: where it starts, and how far its edge can be dragged. */
export const KANBAN_WIDTH = { initial: 272, min: 220, max: 520 } as const;

export function clampKanbanWidth(width: number): number {
  return Math.round(Math.min(KANBAN_WIDTH.max, Math.max(KANBAN_WIDTH.min, width)));
}

/** Moves `value` so it comes before `before` (or last when that is null), in an order of group values. */
export function moveValue(order: readonly string[], value: string, before: string | null): string[] {
  const rest = order.filter((v) => v !== value);
  const at = before === null ? -1 : rest.indexOf(before);
  rest.splice(at === -1 ? rest.length : at, 0, value);
  return rest;
}

/** The width the title column never goes under. */
export const TITLE_MIN_WIDTH = 240;

const MAX_WIDTH = 640;

/**
 * Saved columns made whole: unknown ids dropped, each id once, widths kept
 * in range, and any property added since the columns were saved put at the
 * end the way it is by default, so a new property shows up without a reset.
 */
export function resolveColumns(
  saved: readonly BoardColumnPref[] | undefined,
  defaults: readonly BoardColumnPref[] = DEFAULT_COLUMNS
): BoardColumnPref[] {
  const seen = new Set<BoardPropertyId>();
  const out: BoardColumnPref[] = [];
  for (const column of saved ?? []) {
    if (!column || !(column.id in BOARD_PROPERTIES) || seen.has(column.id)) continue;
    seen.add(column.id);
    const info = BOARD_PROPERTIES[column.id];
    const width = Number.isFinite(column.width) ? clampWidth(column.id, column.width!) : undefined;
    out.push({ id: column.id, ...(width !== undefined && width !== info.width ? { width } : {}), ...(column.hidden ? { hidden: true } : {}) });
  }
  for (const column of defaults) if (!seen.has(column.id)) out.push({ ...column });
  return out;
}

export function clampWidth(id: BoardPropertyId, width: number): number {
  return Math.round(Math.min(MAX_WIDTH, Math.max(BOARD_PROPERTIES[id].min, width)));
}

export function columnWidth(column: BoardColumnPref): number {
  return column.width ?? BOARD_PROPERTIES[column.id].width;
}

export function visibleColumns(columns: readonly BoardColumnPref[]): BoardColumnPref[] {
  return columns.filter((column) => !column.hidden);
}

/** Moves a column so it lands before `before` (or at the end when that is null). */
export function moveColumn(columns: readonly BoardColumnPref[], id: BoardPropertyId, before: BoardPropertyId | null): BoardColumnPref[] {
  const moving = columns.find((column) => column.id === id);
  if (!moving || id === before) return [...columns];
  const rest = columns.filter((column) => column.id !== id);
  const at = before ? rest.findIndex((column) => column.id === before) : -1;
  rest.splice(at === -1 ? rest.length : at, 0, moving);
  return rest;
}

export function setColumn(columns: readonly BoardColumnPref[], id: BoardPropertyId, patch: Partial<BoardColumnPref>): BoardColumnPref[] {
  return columns.map((column) => {
    if (column.id !== id) return column;
    const next = { ...column, ...patch };
    if (next.width !== undefined) next.width = clampWidth(id, next.width);
    if (next.width === undefined || next.width === BOARD_PROPERTIES[id].width) delete next.width;
    if (!next.hidden) delete next.hidden;
    return next;
  });
}

/**
 * Columns of a board in the order the board keeps for them: the saved order
 * first, then any value it has not seen yet, where the grouping put it.
 */
export function orderGroups<T extends { value: string }>(groups: readonly T[], saved: readonly string[] | undefined): T[] {
  if (!saved?.length) return [...groups];
  const rank = new Map(saved.map((value, index) => [value, index]));
  return groups
    .map((group, index) => ({ group, index }))
    .sort((a, b) => {
      const ra = rank.get(a.group.value);
      const rb = rank.get(b.group.value);
      if (ra !== undefined && rb !== undefined) return ra - rb;
      if (ra !== undefined) return -1;
      if (rb !== undefined) return 1;
      return a.index - b.index;
    })
    .map((entry) => entry.group);
}
