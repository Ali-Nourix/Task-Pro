// ── board/board-shortcuts.ts ──────────────────────────────────────────────
// The list of keys the table and the board answer to, in a panel of its own:
// what "?" opens.
// ─────────────────────────────────────────────────────────────────────────────

import { Platform } from 'obsidian';
import type { Language } from '../types';
import { openTaskProPanel } from '../ui/panel';
import { getBoardLabels } from './board-localization';

interface ShortcutGroup {
  title: string;
  items: Array<{ keys: string[]; label: string }>;
}

function shortcutGroups(language: Language): ShortcutGroup[] {
  const mod = (Platform as { isMacOS?: boolean }).isMacOS ? '⌘' : 'Ctrl';
  if (language === 'fa') {
    return [
      {
        title: 'حرکت',
        items: [
          { keys: ['↑', '↓'], label: 'بین تسک‌ها' },
          { keys: ['←', '→'], label: 'بین ستون‌های بورد' },
          { keys: ['Home', 'End'], label: 'اولین یا آخرین تسک' },
        ],
      },
      {
        title: 'تسک',
        items: [
          { keys: ['Enter'], label: 'باز کردن کارت' },
          { keys: ['Space'], label: 'انجام شد، یا دوباره باز' },
          { keys: ['←', '→'], label: 'بستن یا باز کردن زیرتسک‌ها (جدول)' },
          { keys: ['E'], label: 'تغییر نام' },
          { keys: ['M'], label: 'باز کردن منو' },
          { keys: ['Del'], label: 'حذف' },
          { keys: [mod, 'Enter'], label: 'باز کردن در یادداشت' },
        ],
      },
      {
        title: 'بورد',
        items: [
          { keys: ['N'], label: 'تسک جدید' },
          { keys: ['/'], label: 'جستجو' },
          { keys: ['?'], label: 'همین فهرست' },
        ],
      },
    ];
  }
  return [
    {
      title: 'Move',
      items: [
        { keys: ['↑', '↓'], label: 'Through the tasks' },
        { keys: ['←', '→'], label: 'Between the columns of a board' },
        { keys: ['Home', 'End'], label: 'To the first or last task' },
      ],
    },
    {
      title: 'Task',
      items: [
        { keys: ['Enter'], label: 'Open the card' },
        { keys: ['Space'], label: 'Mark done, or open again' },
        { keys: ['←', '→'], label: 'Fold or unfold subtasks (table)' },
        { keys: ['E'], label: 'Rename' },
        { keys: ['M'], label: 'Open the menu' },
        { keys: ['Del'], label: 'Delete' },
        { keys: [mod, 'Enter'], label: 'Open in the note' },
      ],
    },
    {
      title: 'Board',
      items: [
        { keys: ['N'], label: 'New task' },
        { keys: ['/'], label: 'Search' },
        { keys: ['?'], label: 'This list' },
      ],
    },
  ];
}

/** The keys the board answers to, in a panel of their own. */
export function openShortcuts(language: Language): void {
  const { panel, body, footer, close } = openTaskProPanel(getBoardLabels(language).shortcuts);
  panel.addClass('taskpro-shortcuts');
  panel.setAttribute('dir', language === 'fa' ? 'rtl' : 'ltr');
  for (const group of shortcutGroups(language)) {
    const section = body.createDiv({ cls: 'taskpro-shortcuts__group' });
    section.createDiv({ cls: 'taskpro-shortcuts__heading', text: group.title });
    for (const item of group.items) {
      const row = section.createDiv({ cls: 'taskpro-shortcuts__row' });
      row.createSpan({ cls: 'taskpro-shortcuts__label', text: item.label });
      // Key caps read left to right whatever the language, so "Esc" never lands between Persian words.
      const keys = row.createSpan({ cls: 'taskpro-shortcuts__keys', attr: { dir: 'ltr' } });
      for (const key of item.keys) keys.createEl('kbd', { cls: 'taskpro-shortcuts__key', text: key });
    }
  }
  const done = footer.createEl('button', { cls: 'mod-cta', text: language === 'fa' ? 'بستن' : 'Close' });
  done.type = 'button';
  done.addEventListener('click', close);
  done.focus();
}
