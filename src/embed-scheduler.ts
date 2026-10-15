/** Paint placeholders first, then mount at most one visible embed per frame. */
const queues = new WeakMap<Window, { jobs: Set<() => void>; pending: boolean }>();
export function scheduleEmbed(view: Window, job: () => void): () => void {
  let queue = queues.get(view);
  if (!queue) { queue = { jobs: new Set(), pending: false }; queues.set(view, queue); }
  const state = queue;
  const drain = () => {
    const next = state.jobs.values().next().value;
    try { if (next) { state.jobs.delete(next); next(); } }
    finally { if (state.jobs.size) tick(); else state.pending = false; }
  };
  const tick = () => view.requestAnimationFrame(() => view.setTimeout(drain, 0));
  state.jobs.add(job);
  if (!state.pending) { state.pending = true; tick(); }
  return () => { state.jobs.delete(job); };
}
