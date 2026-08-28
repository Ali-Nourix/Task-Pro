// ── ui/panel.ts ───────────────────────────────────────────────────────────
// Shared dialog panel for TaskPro (deadline, progress, etc.)
// ─────────────────────────────────────────────────────────────────────────────

export interface TaskProPanelHandles {
  overlay: HTMLElement;
  panel: HTMLElement;
  body: HTMLElement;
  footer: HTMLElement;
  close: () => void;
}

export function openTaskProPanel(title: string): TaskProPanelHandles {
  const overlay = document.createElement('div');
  overlay.className = 'taskpro-panel-overlay';

  const panel = overlay.createDiv({ cls: 'taskpro-panel' });
  panel.createEl('h3', { text: title, cls: 'taskpro-panel__title' });
  const body = panel.createDiv({ cls: 'taskpro-panel__body' });
  const footer = panel.createDiv({ cls: 'taskpro-panel__footer' });

  document.body.appendChild(overlay);

  const close = () => overlay.remove();
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });

  return { overlay, panel, body, footer, close };
}

export function addPanelField(
  body: HTMLElement,
  label: string,
  inputType = 'text'
): HTMLInputElement {
  const field = body.createDiv({ cls: 'taskpro-panel__field' });
  field.createEl('label', { text: label, cls: 'taskpro-panel__label' });
  const input = field.createEl('input', { type: inputType, cls: 'taskpro-panel__input' });
  return input;
}

export function addPanelButtonRow(
  footer: HTMLElement,
  options: {
    cancelLabel: string;
    saveLabel: string;
    clearLabel?: string;
    onCancel: () => void;
    onSave: () => void;
    onClear?: () => void;
  }
): void {
  const row = footer.createDiv({ cls: 'taskpro-panel__button-row' });

  const cancelBtn = row.createEl('button', {
    text: options.cancelLabel,
    cls: 'taskpro-panel__btn taskpro-panel__btn--secondary',
  });
  cancelBtn.addEventListener('click', options.onCancel);

  if (options.clearLabel && options.onClear) {
    const clearBtn = row.createEl('button', {
      text: options.clearLabel,
      cls: 'taskpro-panel__btn taskpro-panel__btn--secondary',
    });
    clearBtn.addEventListener('click', options.onClear);
  }

  const saveBtn = row.createEl('button', {
    text: options.saveLabel,
    cls: 'taskpro-panel__btn taskpro-panel__btn--primary mod-cta',
  });
  saveBtn.addEventListener('click', options.onSave);
}
