import { setIcon } from 'obsidian';
import { claimEscape } from './escape-scope';

// Position is shared by clock openings in this window, never written into a note.
const positions = new WeakMap<Document, { x: number; y: number }>();
const openWindows = new WeakMap<Document, () => void>();

/** Non-modal, movable panel. No backdrop, outside-click dismissal or focus trap. */
export function openFloatingClock(title: string, fa: boolean, onClose: () => void) {
  const doc = document, win = doc.defaultView!;
  openWindows.get(doc)?.();
  const panel = doc.body.createDiv({ cls: 'taskpro-panel taskpro-clock-panel taskpro-floating-panel' });
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'false');
  panel.setAttribute('aria-label', title);
  const header = panel.createDiv({ cls: 'taskpro-clock__handle', attr: { tabindex: '0', role: 'button', 'aria-label': fa ? 'جابجایی ساعت؛ بکشید یا از کلیدهای جهت استفاده کنید' : 'Move clock: drag or use arrow keys' } });
  header.createEl('h3', { cls: 'taskpro-panel__title', text: title });
  const grip = header.createSpan({ cls: 'taskpro-clock__grip', attr: { 'aria-hidden': 'true' } });
  setIcon(grip, 'grip-horizontal');
  const body = panel.createDiv({ cls: 'taskpro-panel__body' });
  const footer = panel.createDiv({ cls: 'taskpro-panel__footer' });
  let closed = false, releaseEscape: (() => void) | undefined;
  let drag: { id: number; x: number; y: number; left: number; top: number } | undefined;
  const bounds = () => {
    const v = win.visualViewport;
    return { x: (v?.offsetLeft ?? 0) + 8, y: (v?.offsetTop ?? 0) + 8, width: v?.width ?? win.innerWidth, height: v?.height ?? win.innerHeight };
  };
  const place = (x: number, y: number) => {
    const b = bounds(), rect = panel.getBoundingClientRect();
    const point = { x: Math.max(b.x, Math.min(x, b.x + b.width - rect.width - 16)), y: Math.max(b.y, Math.min(y, b.y + b.height - rect.height - 16)) };
    panel.style.left = `${point.x}px`; panel.style.top = `${point.y}px`;
    positions.set(doc, point);
  };
  const fit = () => {
    const b = bounds();
    panel.style.maxHeight = `${Math.max(44, b.height - 16)}px`;
    panel.style.maxWidth = `${Math.max(44, b.width - 16)}px`;
    const p = positions.get(doc);
    const r = panel.getBoundingClientRect();
    place(p?.x ?? b.x + (b.width - 16 - r.width) / 2, p?.y ?? b.y + (b.height - 16 - r.height) / 2);
  };
  const stopDrag = () => {
    const id = drag?.id; drag = undefined;
    panel.classList.remove('is-dragging');
    if (id !== undefined && header.hasPointerCapture(id)) header.releasePointerCapture(id);
  };
  const down = (e: PointerEvent) => {
    if (e.button !== 0 || !e.isPrimary) return;
    const r = panel.getBoundingClientRect();
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, left: r.left, top: r.top };
    header.setPointerCapture(e.pointerId); header.focus({ preventScroll: true });
    panel.classList.add('is-dragging'); e.preventDefault();
  };
  const move = (e: PointerEvent) => {
    if (!drag || drag.id !== e.pointerId) return;
    place(drag.left + e.clientX - drag.x, drag.top + e.clientY - drag.y);
  };
  const key = (e: KeyboardEvent) => {
    const step = e.shiftKey ? 40 : 10;
    const delta: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (!delta[e.key]) return;
    e.preventDefault(); e.stopPropagation();
    const r = panel.getBoundingClientRect(), [x, y] = delta[e.key]; place(r.left + x, r.top + y);
  };
  const deactivate = () => { releaseEscape?.(); releaseEscape = undefined; };
  const activate = () => { if (!releaseEscape) releaseEscape = claimEscape(close, doc); };
  const outside = (e: PointerEvent) => { if (!panel.contains(e.target as Node)) deactivate(); };
  const blur = (e: FocusEvent) => { if (!panel.contains(e.relatedTarget as Node | null)) deactivate(); };
  const close = () => {
    if (closed) return;
    closed = true; stopDrag(); deactivate(); cancelAnimationFrame(frame); observer.disconnect();
    win.removeEventListener('resize', fit); win.visualViewport?.removeEventListener('resize', fit); win.visualViewport?.removeEventListener('scroll', fit);
    doc.removeEventListener('pointerdown', outside, true);
    panel.remove(); if (openWindows.get(doc) === close) openWindows.delete(doc);
    onClose();
  };
  header.addEventListener('pointerdown', down);
  header.addEventListener('pointermove', move);
  header.addEventListener('pointerup', stopDrag);
  header.addEventListener('pointercancel', stopDrag);
  header.addEventListener('lostpointercapture', stopDrag);
  header.addEventListener('keydown', key);
  panel.addEventListener('focusin', activate); panel.addEventListener('focusout', blur);
  doc.addEventListener('pointerdown', outside, true);
  win.addEventListener('resize', fit); win.visualViewport?.addEventListener('resize', fit); win.visualViewport?.addEventListener('scroll', fit);
  const observer = new ResizeObserver(fit); observer.observe(panel);
  const frame = requestAnimationFrame(fit);
  openWindows.set(doc, close);
  return { panel, body, footer, close };
}
