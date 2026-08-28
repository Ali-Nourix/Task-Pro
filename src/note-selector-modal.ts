// ── note-selector-modal.ts ────────────────────────────────────────────────
// Modal for visually selecting a reference note
// ─────────────────────────────────────────────────────────────────────────────

import { App, FuzzySuggestModal, TFile } from 'obsidian';

export class NoteSelectionModal extends FuzzySuggestModal<TFile> {
  constructor(
    app: App,
    private onSelect: (file: TFile) => void
  ) {
    super(app);
  }

  getItems(): TFile[] {
    // Get all markdown files in the vault
    return this.app.vault.getMarkdownFiles();
  }

  getItemText(file: TFile): string {
    // Show the full path for clarity
    return file.path;
  }

  onChooseItem(file: TFile): void {
    this.onSelect(file);
  }
}
