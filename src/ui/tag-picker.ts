// ── ui/tag-picker.ts ──────────────────────────────────────────────────────
// Choose a task's tags, or create a new one without leaving the picker.
//
// Works like a Notion multi-select: type to filter, arrow keys to move, Enter
// to toggle the highlighted tag, and a "Create …" row whenever the text does
// not name an existing tag. Nothing is written until Save.
// ─────────────────────────────────────────────────────────────────────────────

import { setIcon } from 'obsidian';
import { Language } from '../types';
import { TaskTag, TagColor, applyTagColor, createTag, nextTagColor, resolveTag } from '../tags';
import { getTagLabels } from '../tag-localization';
import { addPanelButtonRow, openTaskProPanel } from './panel';
import { renderSwatches } from './tag-colors';

export interface TagPickerOptions {
  language: Language;
  /** Read live, so a tag created here appears straight away. */
  getTags: () => TaskTag[];
  /** Keys currently on the task. */
  selected: string[];
  /** Adds a new tag to the list and saves it. */
  onCreate: (tag: TaskTag) => Promise<void>;
  onSave: (keys: string[]) => Promise<void> | void;
  /** Opens the full tag manager. Shown as a link when provided. */
  onManage?: () => void;
}

type PickerOption = { kind: 'tag'; tag: TaskTag & { unknown?: boolean } } | { kind: 'create'; name: string };

export function openTagPicker(options: TagPickerOptions): void {
  const labels = getTagLabels(options.language);
  const { panel, body, footer, close } = openTaskProPanel(labels.pickerTitle);
  panel.addClass('taskpro-tag-picker');

  const selected = [...options.selected];
  let active = 0;
  /** Arrow keys were used, so Enter on an empty field means "toggle", not "save". */
  let navigated = false;
  let newColor: TagColor = nextTagColor(options.getTags());

  const search = body.createEl('input', {
    type: 'text',
    cls: 'taskpro-panel__input taskpro-tag-picker__search',
    attr: { placeholder: labels.searchPlaceholder, 'aria-label': labels.searchPlaceholder },
  });
  const list = body.createDiv({ cls: 'taskpro-tag-picker__list' });
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-multiselectable', 'true');
  const createArea = body.createDiv({ cls: 'taskpro-tag-picker__create' });

  const currentOptions = (): PickerOption[] => {
    const query = search.value.trim().toLowerCase();
    const tags = options.getTags();
    // Keys on the task that nobody defined still need to be removable.
    const unknown = selected
      .filter((key) => !tags.some((tag) => tag.key === key))
      .map((key) => resolveTag(key, tags));
    const all = [...unknown, ...tags];
    const matches = query
      ? all.filter((tag) => tag.name.toLowerCase().includes(query) || tag.key.includes(query))
      : all;
    const result: PickerOption[] = matches.map((tag) => ({ kind: 'tag', tag }));
    const exact = all.some((tag) => tag.name.toLowerCase() === query || tag.key === query);
    if (query && !exact) result.push({ kind: 'create', name: search.value.trim() });
    return result;
  };

  const toggle = (key: string) => {
    const index = selected.indexOf(key);
    if (index === -1) selected.push(key);
    else selected.splice(index, 1);
  };

  const createFromQuery = async (name: string) => {
    const tag = createTag(name, options.getTags(), newColor);
    await options.onCreate(tag);
    selected.push(tag.key);
    search.value = '';
    newColor = nextTagColor(options.getTags());
    active = 0;
    render();
    search.focus();
  };

  const activate = async (option: PickerOption | undefined) => {
    if (!option) return;
    if (option.kind === 'create') {
      await createFromQuery(option.name);
      return;
    }
    toggle(option.tag.key);
    render();
  };

  function render(): void {
    const opts = currentOptions();
    active = Math.max(0, Math.min(active, opts.length - 1));
    list.empty();
    createArea.empty();

    const tagOptions = opts.filter((o): o is Extract<PickerOption, { kind: 'tag' }> => o.kind === 'tag');
    const canCreate = opts.some((o) => o.kind === 'create');
    // Highlight only once it means something: while filtering, or after arrow keys.
    const showActive = navigated || !!search.value.trim();
    list.toggleClass('is-empty', !tagOptions.length);
    if (!tagOptions.length && !canCreate) {
      list.createDiv({
        cls: 'taskpro-tag-picker__empty',
        text: options.getTags().length || selected.length ? labels.noMatches : labels.noTagsYet,
      });
    }

    opts.forEach((option, index) => {
      if (option.kind === 'create') {
        const button = createArea.createEl('button', { cls: 'taskpro-tag-picker__create-btn' });
        button.type = 'button';
        if (index === active && showActive) button.addClass('is-active');
        const icon = button.createSpan({ cls: 'taskpro-tag-picker__create-icon' });
        setIcon(icon, 'plus');
        const preview = button.createSpan({ cls: 'taskpro-chip taskpro-tag-chip', text: option.name });
        applyTagColor(preview, newColor);
        button.insertBefore(createSpan({ text: labels.createPrefix }), preview);
        button.addEventListener('click', () => void activate(option));

        const swatches = createArea.createDiv();
        renderSwatches(swatches, newColor, options.language, (color) => {
          newColor = color;
          render();
          search.focus();
        });
        return;
      }

      const isSelected = selected.includes(option.tag.key);
      const pill = list.createEl('button', { cls: 'taskpro-chip taskpro-tag-chip taskpro-tag-option' });
      pill.type = 'button';
      pill.setAttribute('role', 'option');
      pill.setAttribute('aria-selected', String(isSelected));
      applyTagColor(pill, option.tag.color);
      if (isSelected) pill.addClass('is-selected');
      if (index === active && showActive) pill.addClass('is-active');
      if (option.tag.unknown) {
        pill.addClass('is-unknown');
        pill.title = labels.unknownTag;
      }
      if (isSelected) {
        const check = pill.createSpan({ cls: 'taskpro-chip__icon' });
        check.setAttribute('aria-hidden', 'true');
        setIcon(check, 'check');
      }
      pill.createSpan({ cls: 'taskpro-chip__label', text: option.tag.name });
      pill.addEventListener('click', () => {
        active = index;
        void activate(option);
      });
    });
  }

  search.addEventListener('input', () => {
    active = 0;
    navigated = false;
    render();
  });
  search.addEventListener('keydown', (event) => {
    const opts = currentOptions();
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
      if (event.key === 'ArrowRight' && search.selectionStart !== search.value.length) return;
      event.preventDefault();
      navigated = true;
      active = Math.min(active + 1, opts.length - 1);
      render();
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
      if (event.key === 'ArrowLeft' && search.selectionStart !== 0) return;
      event.preventDefault();
      navigated = true;
      active = Math.max(active - 1, 0);
      render();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      // Ctrl/Cmd+Enter always saves; so does Enter on an empty field unless
      // the arrow keys picked something to toggle.
      if (event.metaKey || event.ctrlKey || (!search.value.trim() && !navigated)) {
        void save();
        return;
      }
      void activate(opts[active]);
    } else if (event.key === 'Backspace' && !search.value && selected.length) {
      // Same as a Notion multi-select: backspace on an empty field drops the last tag.
      selected.pop();
      render();
    }
  });

  const save = async () => {
    await options.onSave(selected);
    close();
  };

  if (options.onManage) {
    const manage = footer.createEl('button', { cls: 'taskpro-panel__link', text: labels.manage });
    manage.type = 'button';
    manage.addEventListener('click', () => {
      close();
      options.onManage?.();
    });
  }

  addPanelButtonRow(footer, {
    cancelLabel: labels.cancel,
    saveLabel: labels.save,
    onCancel: close,
    onSave: () => void save(),
  });

  render();
  search.focus();
}
