// ── ui/back-button.ts ─────────────────────────────────────────────────────
// The phone's back button (and its back swipe) belong to whatever is open on
// top. Obsidian keeps a stack of those: its menus and dialogs push themselves
// when they open, and a press of back goes to the last one, which closes. A
// sheet of ours is not one of its dialogs, so it takes a place in the stack
// with a dialog that is never drawn: back closes that, and with it the sheet.
// When the sheet closes some other way the dialog is closed too, so the next
// back press goes on to what is under it: the page, and then the note.
// ─────────────────────────────────────────────────────────────────────────────

import { App, Modal, Platform } from 'obsidian';

let host: App | null = null;

/** Said once by the board, which is handed the app. */
export function setBackButtonApp(app: App | null): void {
  host = app;
}

/**
 * Makes `onBack` what the back button does until the returned function is
 * called. Only on a phone, where there is a back button.
 */
export function captureBack(onBack: () => void): () => void {
  if (!host || !Platform.isMobile) return () => undefined;
  let released = false;
  const stack = new BackStop(host, () => {
    if (!released) onBack();
  });
  stack.open();
  return () => {
    if (released) return;
    released = true;
    stack.close();
  };
}

/** A dialog with nothing to show: it is there to be the last thing in Obsidian's stack. */
class BackStop extends Modal {
  constructor(
    app: App,
    private readonly closed: () => void
  ) {
    super(app);
    this.containerEl.addClass('taskpro-back-stop');
    this.modalEl.addClass('taskpro-back-stop');
    // An Obsidian dialog keeps the focus inside itself, and a dialog nobody can see must not take it from
    // the sheet it stands for (a field there would lose the keyboard the moment it was given it).
    (this.scope as unknown as { setTabFocusContainerEl?: (el: HTMLElement | null) => void } | undefined)?.setTabFocusContainerEl?.(null);
  }

  onClose(): void {
    this.closed();
  }
}
