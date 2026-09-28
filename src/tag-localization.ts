// ── tag-localization.ts ───────────────────────────────────────────────────
// Text for the tag picker, the tag manager and the tag rows in task menus.

import { Language } from './types';
import { isolate } from './bidi';

export interface TagLabels {
  tags: string;
  pickerTitle: string;
  searchPlaceholder: string;
  create: (name: string) => string;
  createPrefix: string;
  noTagsYet: string;
  noMatches: string;
  cancel: string;
  save: string;
  manage: string;
  editTags: string;
  addTags: string;
  tagsUpdated: string;
  tagsCleared: string;
  managerEmpty: string;
  newTagPlaceholder: string;
  addTag: string;
  namePlaceholder: string;
  colour: string;
  deleteTag: string;
  deleteTitle: (name: string) => string;
  deleteBody: (key: string) => string;
  deleteKeep: string;
  deleteEverywhere: (count: number) => string;
  deleted: (name: string) => string;
  removedFromTasks: (count: number) => string;
  usage: (count: number) => string;
  copyKey: string;
  copied: (marker: string) => string;
  unknownTag: string;
  tagCreated: (name: string) => string;
}

const EN: TagLabels = {
  tags: 'Tags',
  pickerTitle: 'Tags',
  searchPlaceholder: 'Search or create a tag…',
  create: (name) => `Create “${isolate(name)}”`,
  createPrefix: 'Create',
  noTagsYet: 'No tags yet. Type a name above to create the first one.',
  noMatches: 'No tag matches.',
  cancel: 'Cancel',
  save: 'Save',
  manage: 'Manage tags',
  editTags: 'Edit Tags',
  addTags: 'Add Tags',
  tagsUpdated: '✓ Tags updated',
  tagsCleared: '🧹 Tags removed',
  managerEmpty: 'No tags yet. Tags you create here, from a task’s chip menu or from the task board, appear in this list.',
  newTagPlaceholder: 'New tag name',
  addTag: 'Add tag',
  namePlaceholder: 'Tag name',
  colour: 'Colour',
  deleteTag: 'Delete tag',
  deleteTitle: (name) => `Delete “${isolate(name)}”?`,
  deleteBody: (key) =>
    `Tasks that carry @tag(${key}) can keep the marker, in which case they show it as a grey chip until you define the tag again, or have it removed from every note.`,
  deleteKeep: 'Delete, keep markers',
  deleteEverywhere: (count) => (count === 1 ? 'Delete and remove from 1 task' : `Delete and remove from ${count} tasks`),
  deleted: (name) => `Deleted “${isolate(name)}”`,
  removedFromTasks: (count) => (count === 1 ? 'Removed from 1 task' : `Removed from ${count} tasks`),
  usage: (count) => (count === 1 ? '1 task' : `${count} tasks`),
  copyKey: 'Copy marker',
  copied: (marker) => `Copied ${isolate(marker)}`,
  unknownTag: 'Not in your tag list',
  tagCreated: (name) => `Created tag “${isolate(name)}”`,
};

const FA: TagLabels = {
  tags: 'برچسب‌ها',
  pickerTitle: 'برچسب‌ها',
  searchPlaceholder: 'جستجو یا ساخت برچسب…',
  create: (name) => `ساخت «${isolate(name)}»`,
  createPrefix: 'ساخت',
  noTagsYet: 'هنوز برچسبی ندارید. برای ساخت اولین برچسب، نامش را بالا بنویسید.',
  noMatches: 'برچسبی پیدا نشد.',
  cancel: 'انصراف',
  save: 'ذخیره',
  manage: 'مدیریت برچسب‌ها',
  editTags: 'ویرایش برچسب‌ها',
  addTags: 'افزودن برچسب',
  tagsUpdated: '✓ برچسب‌ها به‌روز شد',
  tagsCleared: '🧹 برچسب‌ها حذف شد',
  managerEmpty: 'هنوز برچسبی ندارید. برچسب‌هایی که اینجا، از منوی تسک یا از صفحه تسک‌ها بسازید در این فهرست می‌آیند.',
  newTagPlaceholder: 'نام برچسب جدید',
  addTag: 'افزودن برچسب',
  namePlaceholder: 'نام برچسب',
  colour: 'رنگ',
  deleteTag: 'حذف برچسب',
  deleteTitle: (name) => `«${isolate(name)}» حذف شود؟`,
  deleteBody: (key) =>
    `تسک‌هایی که @tag(${key}) دارند می‌توانند نشانگر را نگه دارند (تا وقتی برچسب دوباره تعریف شود، خاکستری نمایش داده می‌شود) یا نشانگر از همه یادداشت‌ها پاک شود.`,
  deleteKeep: 'حذف، نشانگرها بمانند',
  deleteEverywhere: (count) => `حذف و پاک کردن از ${count} تسک`,
  deleted: (name) => `«${isolate(name)}» حذف شد`,
  removedFromTasks: (count) => `از ${count} تسک پاک شد`,
  usage: (count) => `${count} تسک`,
  copyKey: 'کپی نشانگر',
  copied: (marker) => `${isolate(marker)} کپی شد`,
  unknownTag: 'در فهرست برچسب‌های شما نیست',
  tagCreated: (name) => `برچسب «${isolate(name)}» ساخته شد`,
};

export function getTagLabels(language: Language): TagLabels {
  return language === 'fa' ? FA : EN;
}
