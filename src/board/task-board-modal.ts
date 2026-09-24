// ── board/task-board-modal.ts ─────────────────────────────────────────────
// The task board as a floating window over the whole app.
//
// While it is open, <body> carries `taskpro-board-is-floating` and the modal's
// container carries `taskpro-board-float`. The plugin only dims what is behind
// it; a theme that wants the rest of Obsidian blurred does it from those two
// classes (Bookcloth does), so the look belongs to the theme and a vault
// without one still gets a clean, cheap backdrop.
// ─────────────────────────────────────────────────────────────────────────────

import { App, Hotkey, Modal } from 'obsidian';
import { TaskBoard, TaskBoardHost } from './task-board';

export const FLOATING_BODY_CLASS = 'taskpro-board-is-floating';

export class TaskBoardModal extends Modal {
  private board: TaskBoard | null = null;

  constructor(
    app: App,
    private readonly host: TaskBoardHost,
    private readonly options: {
      /** Closes the float and shows the board in a workspace tab instead. */
      onDock: () => void;
      /** Hotkeys of the command that opened it, so the same keys close it. */
      hotkeys: Hotkey[];
      onClosed: () => void;
    }
  ) {
    super(app);
  }

  onOpen(): void {
    this.containerEl.addClass('taskpro-board-float');
    this.modalEl.addClass('taskpro-board-modal');
    this.contentEl.addClass('taskpro-board-float__content');
    this.containerEl.ownerDocument.body.addClass(FLOATING_BODY_CLASS);

    // A modal has its own keymap scope, so the command's hotkey would not
    // reach the command while this is open. Registering it here makes the
    // shortcut a toggle, as it reads.
    for (const hotkey of this.options.hotkeys) {
      this.scope.register(hotkey.modifiers, hotkey.key, () => {
        this.close();
        return false;
      });
    }

    this.board = new TaskBoard(this.contentEl, this.host, {
      floating: true,
      onClose: () => this.close(),
      onToggleFloating: () => {
        this.close();
        this.options.onDock();
      },
    });
    void this.board.mount().then(() => {
      // Ready to type: the search field, rather than whichever icon button
      // happens to come first in the header.
      this.contentEl.querySelector<HTMLInputElement>('.taskpro-board__search input')?.focus();
    });
  }

  onClose(): void {
    this.board?.destroy();
    this.board = null;
    this.contentEl.empty();
    this.containerEl.ownerDocument.body.removeClass(FLOATING_BODY_CLASS);
    this.options.onClosed();
  }

  /** Settings the board depends on changed. */
  refresh(): void {
    this.board?.refresh();
  }
}
