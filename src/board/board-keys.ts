// ── board/board-keys.ts ───────────────────────────────────────────────────
// The keyboard for the table and the board. A cursor moves through the tasks
// the way the eye does, and the keys that act on the task under it are the
// ones a list app answers to. Where the cursor goes is pure, so it is tested
// without a page.
//
// Letters are read from the physical key (`event.code`), so E, M and N work on
// a Persian layout as they do on a Latin one.
// ─────────────────────────────────────────────────────────────────────────────

/** A step of the cursor: through a column, between columns, or to an end of one. */
export type CursorMove = 'up' | 'down' | 'previous' | 'next' | 'first' | 'last';

export interface CursorAt {
  column: number;
  row: number;
}

/**
 * Where the cursor goes. `lengths` is how many tasks each column holds; the
 * table is one column. Without a cursor yet, any move starts at the first task
 * (at the last for End). A move between columns keeps the row as far as the
 * next column reaches, and passes over a column with nothing in it.
 */
export function moveCursor(lengths: readonly number[], at: CursorAt | null, move: CursorMove): CursorAt | null {
  const filled = lengths.flatMap((count, column) => (count > 0 ? [column] : []));
  if (!filled.length) return null;
  if (!at || !(lengths[at.column] > 0)) {
    const column = move === 'last' ? filled[filled.length - 1] : filled[0];
    return { column, row: move === 'last' ? lengths[column] - 1 : 0 };
  }
  const { column } = at;
  const row = Math.min(at.row, lengths[column] - 1);
  switch (move) {
    case 'up':
      return { column, row: Math.max(0, row - 1) };
    case 'down':
      return { column, row: Math.min(lengths[column] - 1, row + 1) };
    case 'first':
      return { column, row: 0 };
    case 'last':
      return { column, row: lengths[column] - 1 };
    default: {
      const next = filled[filled.indexOf(column) + (move === 'next' ? 1 : -1)];
      return next === undefined ? { column, row } : { column: next, row: Math.min(row, lengths[next] - 1) };
    }
  }
}

/**
 * The step a key asks for. Across is mirrored in a right to left board, where
 * the next column is the one on the left.
 */
export function moveFor(event: { key: string; code: string }, rtl: boolean): CursorMove | null {
  switch (event.key) {
    case 'ArrowUp':
      return 'up';
    case 'ArrowDown':
      return 'down';
    case 'ArrowRight':
      return rtl ? 'previous' : 'next';
    case 'ArrowLeft':
      return rtl ? 'next' : 'previous';
    case 'Home':
      return 'first';
    case 'End':
      return 'last';
  }
  if (event.code === 'KeyJ') return 'down';
  if (event.code === 'KeyK') return 'up';
  return null;
}
