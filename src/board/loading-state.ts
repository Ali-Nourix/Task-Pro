/** A layout-shaped placeholder, with one composited shimmer per view, not per cell. */
export function renderBoardSkeleton(parent: HTMLElement, layout: string, text: string, calendarView = 'week'): HTMLElement {
  const loading = parent.createDiv({ cls: 'taskpro-board__skeleton' });
  loading.dataset.layout = layout;
  loading.dataset.calendarView = calendarView;
  loading.setAttribute('role', 'status');
  loading.setAttribute('aria-label', text);
  const shape = loading.createDiv({ cls: 'taskpro-skeleton__shape', attr: { 'aria-hidden': 'true' } });
  const bar = (el: HTMLElement, width = '60%', chip = false) => {
    el.createSpan({ cls: `taskpro-board__skeleton-bar${chip ? ' is-chip' : ''}` }).style.setProperty('--w', width);
  };
  const nav = shape.createDiv({ cls: 'taskpro-skeleton__nav' });
  bar(nav, '28%'); bar(nav, '20%', true);
  if ((layout === 'calendar' && calendarView !== 'agenda') || layout === 'timeline') {
    const grid = shape.createDiv({ cls: 'taskpro-skeleton__calendar' });
    const cells = calendarView === 'month' ? 42 : calendarView === 'day' ? 3 : 21;
    for (let i = 0; i < cells; i++) {
      const cell = grid.createDiv();
      if (i < 7) bar(cell, '35%');
      if (i % 4 === 1) bar(cell, '78%', true);
    }
  } else {
    for (let row = 0; row < 9; row++) {
      const line = shape.createDiv({ cls: 'taskpro-board__skeleton-row' });
      line.createSpan({ cls: 'taskpro-board__skeleton-dot' });
      bar(line, `${[34, 46, 28, 40, 52][row % 5]}%`);
      bar(line, '68px', true);
      bar(line, '54px', true);
    }
  }
  return loading;
}
