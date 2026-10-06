// ── ui/snackbar.ts ────────────────────────────────────────────────────────
// A line at the foot of the screen that says what just happened and offers to
// take it back ("Done: Call Sara · Undo"). One at a time; it waits six
// seconds, longer while a finger or the keyboard is on it, and what it says is
// also said to a screen reader. It is how a swipe or a tap that was not meant
// is forgiven, so nothing here needs a confirmation dialog first.
// ─────────────────────────────────────────────────────────────────────────────

import { setIcon } from 'obsidian';
import { announce } from './announce';

export interface SnackbarOptions {
  container: HTMLElement;
  message: string;
  /** The button's word, and what it does. Without them the line only informs. */
  actionLabel?: string;
  onAction?: () => void;
  /** What the ✕ is called to a screen reader. */
  dismissLabel: string;
  /** Milliseconds before it goes. */
  timeout?: number;
}

export interface SnackbarHandle {
  close(): void;
}

const CLASS = 'taskpro-snackbar';

export function showSnackbar(options: SnackbarOptions): SnackbarHandle {
  const { container } = options;
  container.querySelectorAll(`:scope > .${CLASS}`).forEach((el) => el.remove());
  const win = container.ownerDocument.defaultView ?? window;

  const el = container.createDiv({ cls: CLASS });
  el.createSpan({ cls: `${CLASS}__text`, text: options.message, attr: { dir: 'auto' } });
  let timer = 0;
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    win.clearTimeout(timer);
    container.removeClass('has-snackbar');
    el.addClass('is-leaving');
    win.setTimeout(() => el.remove(), 200);
  };
  if (options.actionLabel && options.onAction) {
    const action = el.createEl('button', { cls: `${CLASS}__action`, text: options.actionLabel });
    action.type = 'button';
    action.addEventListener('click', () => {
      options.onAction?.();
      close();
    });
  }
  const dismiss = el.createEl('button', { cls: `${CLASS}__close`, attr: { 'aria-label': options.dismissLabel } });
  dismiss.type = 'button';
  setIcon(dismiss, 'x');
  dismiss.addEventListener('click', close);

  const wait = () => {
    win.clearTimeout(timer);
    timer = win.setTimeout(close, options.timeout ?? 6000);
  };
  const hold = () => win.clearTimeout(timer);
  el.addEventListener('pointerenter', hold);
  el.addEventListener('pointerleave', wait);
  el.addEventListener('focusin', hold);
  el.addEventListener('focusout', wait);
  wait();

  container.addClass('has-snackbar');
  announce(container, options.actionLabel ? `${options.message}. ${options.actionLabel}` : options.message);
  return { close };
}
