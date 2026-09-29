// ── ui/motion.ts ──────────────────────────────────────────────────────────
// What moves, and when. The animations themselves are CSS (the motion section
// of styles.css, which a reduced-motion setting switches off); this decides
// which elements get them, so the board can redraw itself on every change to a
// note without everything on it animating each time.
// ─────────────────────────────────────────────────────────────────────────────

/** A view coming in, or a page turning forward or back. */
export type Entrance = 'view' | 'next' | 'prev';

const ENTRANCES: Entrance[] = ['view', 'next', 'prev'];

/** Longer than the longest entrance and its stagger; then the classes come off. */
const ENTRANCE_MS = 700;

/** Rows after this many all arrive together: a long list does not queue up. */
const STAGGER_STEPS = 10;

/** More arrivals than this at once is a reload or an import, not something to point at. */
const BULK = 8;

/** Plays an entrance on a container's content. */
export function enter(container: HTMLElement, kind: Entrance): void {
  const classes = ENTRANCES.map((name) => `is-entering-${name}`);
  container.removeClass('is-entering', ...classes);
  // Take the classes off and put them back a frame later, or an animation
  // that has just run would not run again.
  void container.offsetWidth;
  container.addClass('is-entering', `is-entering-${kind}`);
  const win = container.ownerDocument.defaultView ?? window;
  win.setTimeout(() => container.removeClass('is-entering', `is-entering-${kind}`), ENTRANCE_MS);
}

/** The place in a run of things arriving one after another: `--i`, capped. */
export function stagger(el: HTMLElement, index: number): void {
  el.style.setProperty('--i', String(Math.min(index, STAGGER_STEPS)));
}

/** A task as far as noticing it changing is concerned. */
interface Watched {
  filePath: string;
  text: string;
  status: string;
  id: string;
}

/**
 * Which tasks are new since the last look, and which have changed status.
 * Those are the ones shown arriving: a task just added flashes where it
 * lands, and one just ticked off pops its check in the group it moved to.
 *
 * A task is known by its note and its title, not by its `id`, which is a line
 * number and shifts when a line above it is added. Two tasks with the same
 * title in one note are told apart by their order.
 */
export class ChangeTracker {
  private known: Map<string, string> | null = null;

  update(tasks: readonly Watched[]): { added: Set<string>; changed: Set<string> } {
    const seen = new Map<string, number>();
    const now = new Map<string, string>();
    const ids = new Map<string, string>();
    for (const task of tasks) {
      const base = `${task.filePath}\n${task.text}`;
      const nth = seen.get(base) ?? 0;
      seen.set(base, nth + 1);
      const key = `${base}\n${nth}`;
      now.set(key, task.status);
      ids.set(key, task.id);
    }

    const added = new Set<string>();
    const changed = new Set<string>();
    const before = this.known;
    this.known = now;
    // The first look is the baseline: everything on it was already there.
    if (!before) return { added, changed };
    for (const [key, status] of now) {
      const previous = before.get(key);
      if (previous === undefined) added.add(ids.get(key)!);
      else if (previous !== status) changed.add(ids.get(key)!);
    }
    if (added.size + changed.size > BULK) return { added: new Set(), changed: new Set() };
    return { added, changed };
  }
}
