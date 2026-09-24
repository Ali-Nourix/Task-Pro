// ── board/task-board-view.ts ──────────────────────────────────────────────
// The Obsidian view that hosts the task board in a workspace tab.

import { ItemView, WorkspaceLeaf } from 'obsidian';
import { getBoardLabels } from './board-localization';
import { TaskBoard, TaskBoardHost } from './task-board';

export const VIEW_TYPE_TASK_BOARD = 'taskpro-task-board';

export class TaskBoardView extends ItemView {
  private board: TaskBoard | null = null;

  constructor(leaf: WorkspaceLeaf, private readonly host: TaskBoardHost) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE_TASK_BOARD;
  }

  getDisplayText(): string {
    return getBoardLabels(this.host.getSettings().language).title;
  }

  getIcon(): string {
    return 'list-checks';
  }

  async onOpen(): Promise<void> {
    this.contentEl.empty();
    this.contentEl.addClass('taskpro-board-view');
    this.board = new TaskBoard(this.contentEl, this.host);
    await this.board.mount();
  }

  async onClose(): Promise<void> {
    this.board?.destroy();
    this.board = null;
  }

  /** Called by the plugin when settings the board depends on change. */
  refresh(): void {
    this.board?.refresh();
  }
}
