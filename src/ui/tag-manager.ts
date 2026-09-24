// ── ui/tag-manager.ts ─────────────────────────────────────────────────────
// Create, rename, recolour and delete tags. Rendered in the settings tab and
// in a panel opened from the task board, from the same code.
// ─────────────────────────────────────────────────────────────────────────────

import { Notice, setIcon } from 'obsidian';
import { Language } from '../types';
import { TaskTag, applyTagColor, createTag, nextTagColor, resolveTagColor } from '../tags';
import { getTagLabels } from '../tag-localization';
import { openTaskProPanel } from './panel';
import { openColorPopover } from './tag-colors';

export interface TagManagerHost {
  language: Language;
  getTags: () => TaskTag[];
  /** Replaces the tag list, saves, and refreshes every view that shows tags. */
  setTags: (tags: TaskTag[]) => Promise<void>;
  /** How many tasks carry each key. Optional: the counts are a courtesy. */
  countUsage?: () => Promise<Map<string, number>>;
  /** Removes a key from every note. Resolves to the number of tasks changed. */
  removeFromNotes?: (key: string) => Promise<number>;
}

export function renderTagManager(container: HTMLElement, host: TagManagerHost): void {
  const labels = getTagLabels(host.language);
  container.empty();
  container.addClass('taskpro-tag-manager');

  const listEl = container.createDiv({ cls: 'taskpro-tag-manager__list' });
  let usage: Map<string, number> | null = null;

  const update = async (next: TaskTag[]) => {
    await host.setTags(next);
    renderList();
  };

  function renderList(): void {
    listEl.empty();
    const tags = host.getTags();
    if (!tags.length) {
      listEl.createDiv({ cls: 'taskpro-tag-manager__empty', text: labels.managerEmpty });
      return;
    }

    for (const tag of tags) {
      const row = listEl.createDiv({ cls: 'taskpro-tag-manager__row' });
      row.dataset.tag = tag.key;

      const swatch = row.createEl('button', { cls: 'taskpro-swatch taskpro-tag-manager__swatch' });
      swatch.type = 'button';
      swatch.style.setProperty('--taskpro-swatch', resolveTagColor(tag.color));
      swatch.setAttribute('aria-label', labels.colour);
      swatch.title = labels.colour;
      swatch.addEventListener('click', () => {
        openColorPopover(swatch, tag.color, host.language, (color) => {
          void update(host.getTags().map((t) => (t.key === tag.key ? { ...t, color } : t)));
        });
      });

      const name = row.createEl('input', {
        type: 'text',
        cls: 'taskpro-tag-manager__name',
        attr: { placeholder: labels.namePlaceholder, 'aria-label': labels.namePlaceholder, dir: 'auto' },
      });
      name.value = tag.name;
      const commitName = () => {
        const value = name.value.trim();
        if (!value) {
          name.value = tag.name;
          return;
        }
        if (value === tag.name) return;
        void update(host.getTags().map((t) => (t.key === tag.key ? { ...t, name: value } : t)));
      };
      name.addEventListener('change', commitName);
      name.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          name.blur();
        }
      });

      const preview = row.createSpan({ cls: 'taskpro-chip taskpro-tag-chip taskpro-tag-manager__preview', text: tag.name });
      applyTagColor(preview, tag.color);

      const marker = `@tag(${tag.key})`;
      const keyButton = row.createEl('button', { cls: 'taskpro-tag-manager__key', text: marker });
      keyButton.type = 'button';
      keyButton.title = labels.copyKey;
      keyButton.addEventListener('click', async () => {
        await navigator.clipboard.writeText(marker);
        new Notice(labels.copied(marker));
      });

      const count = usage?.get(tag.key);
      row.createSpan({
        cls: 'taskpro-tag-manager__usage',
        text: count === undefined ? '' : labels.usage(count),
      });

      const remove = row.createEl('button', { cls: 'clickable-icon taskpro-tag-manager__delete' });
      remove.type = 'button';
      remove.setAttribute('aria-label', labels.deleteTag);
      remove.title = labels.deleteTag;
      setIcon(remove, 'trash-2');
      remove.addEventListener('click', () => confirmDelete(tag, count ?? 0));
    }
  }

  function confirmDelete(tag: TaskTag, count: number): void {
    const { body, footer, close } = openTaskProPanel(labels.deleteTitle(tag.name));
    body.createEl('p', { cls: 'taskpro-panel__text', text: labels.deleteBody(tag.key) });
    const row = footer.createDiv({ cls: 'taskpro-panel__button-row' });

    const cancel = row.createEl('button', { cls: 'taskpro-panel__btn taskpro-panel__btn--secondary', text: labels.cancel });
    cancel.addEventListener('click', close);

    const drop = async () => update(host.getTags().filter((t) => t.key !== tag.key));

    const keep = row.createEl('button', {
      cls: `taskpro-panel__btn ${host.removeFromNotes && count > 0 ? 'taskpro-panel__btn--secondary' : 'mod-warning'}`,
      text: labels.deleteKeep,
    });
    keep.addEventListener('click', async () => {
      close();
      await drop();
      new Notice(labels.deleted(tag.name));
    });

    if (host.removeFromNotes && count > 0) {
      const everywhere = row.createEl('button', { cls: 'taskpro-panel__btn mod-warning', text: labels.deleteEverywhere(count) });
      everywhere.addEventListener('click', async () => {
        close();
        const changed = await host.removeFromNotes!(tag.key);
        await drop();
        usage?.delete(tag.key);
        new Notice(`${labels.deleted(tag.name)} · ${labels.removedFromTasks(changed)}`);
      });
    }
  }

  // ── Add row ──────────────────────────────────────────────────────────────
  const addRow = container.createDiv({ cls: 'taskpro-tag-manager__add' });
  let pendingColor = nextTagColor(host.getTags());
  const addSwatch = addRow.createEl('button', { cls: 'taskpro-swatch taskpro-tag-manager__swatch' });
  addSwatch.type = 'button';
  addSwatch.setAttribute('aria-label', labels.colour);
  addSwatch.title = labels.colour;
  const paintAddSwatch = () => addSwatch.style.setProperty('--taskpro-swatch', resolveTagColor(pendingColor));
  paintAddSwatch();
  addSwatch.addEventListener('click', () => {
    openColorPopover(addSwatch, pendingColor, host.language, (color) => {
      pendingColor = color;
      paintAddSwatch();
    });
  });

  const addInput = addRow.createEl('input', {
    type: 'text',
    cls: 'taskpro-tag-manager__name',
    attr: { placeholder: labels.newTagPlaceholder, 'aria-label': labels.newTagPlaceholder, dir: 'auto' },
  });
  const addButton = addRow.createEl('button', { cls: 'mod-cta', text: labels.addTag });
  const add = async () => {
    const value = addInput.value.trim();
    if (!value) {
      addInput.focus();
      return;
    }
    const tag = createTag(value, host.getTags(), pendingColor);
    addInput.value = '';
    await update([...host.getTags(), tag]);
    pendingColor = nextTagColor(host.getTags());
    paintAddSwatch();
    addInput.focus();
  };
  addButton.addEventListener('click', () => void add());
  addInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void add();
    }
  });

  renderList();

  if (host.countUsage) {
    void host.countUsage().then((counts) => {
      usage = counts;
      // Only the counts change; keep focus if the user is typing in a row.
      if (!container.contains(document.activeElement) || document.activeElement === addInput) {
        renderList();
      } else {
        listEl.querySelectorAll<HTMLElement>('.taskpro-tag-manager__row').forEach((row) => {
          const key = row.dataset.tag ?? '';
          const cell = row.querySelector('.taskpro-tag-manager__usage');
          if (cell) cell.textContent = labels.usage(counts.get(key) ?? 0);
        });
      }
    });
  }
}

/** Opens the tag manager in a TaskPro panel. */
export function openTagManagerPanel(host: TagManagerHost, onClose?: () => void): void {
  const labels = getTagLabels(host.language);
  const { panel, body, footer, close } = openTaskProPanel(labels.manage);
  panel.addClass('taskpro-panel--wide');
  renderTagManager(body, host);
  const row = footer.createDiv({ cls: 'taskpro-panel__button-row' });
  const done = row.createEl('button', { cls: 'taskpro-panel__btn mod-cta', text: labels.save });
  done.addEventListener('click', () => {
    close();
    onClose?.();
  });
}
