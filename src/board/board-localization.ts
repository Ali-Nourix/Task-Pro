// ── board/board-localization.ts ───────────────────────────────────────────
// Text for the task board.

import { BoardDensity, BoardGroupBy, BoardSortKey, DeadlineBucket, Language } from '../types';
import { isolate } from '../bidi';

export interface BoardLabels {
  title: string;
  open: string;
  summary: (total: number, done: number, overdue: number) => string;
  loading: string;
  empty: string;
  emptyFiltered: string;
  emptyClear: string;
  scopeTarget: (folder: string) => string;
  scopeVault: string;
  scopeTargetUnset: string;
  layoutTable: string;
  layoutBoard: string;
  search: string;
  group: string;
  groupBy: Record<BoardGroupBy, string>;
  sort: string;
  sortBy: Record<BoardSortKey, string>;
  ascending: string;
  descending: string;
  filter: string;
  filterStatus: string;
  filterPriority: string;
  filterTags: string;
  filterDeadline: string;
  filterPlan: string;
  filterNote: string;
  /** The search field over the filter menu. */
  filterSearch: string;
  clearFilters: string;
  columns: {
    task: string;
    status: string;
    tags: string;
    priority: string;
    deadline: string;
    plan: string;
    waiting: string;
    repeat: string;
    progress: string;
    note: string;
  };
  /** The properties menu: which properties the table or the cards show. */
  properties: string;
  /** The heading over the list of properties in the properties menu. */
  propertiesIn: { tableColumns: string; cardProperties: string };
  resetColumns: string;
  /** The view options at the foot of the properties menu. */
  viewSection: string;
  density: string;
  densities: Record<BoardDensity, string>;
  wrapTitles: string;
  hideEmptyColumns: string;
  /** The board's columns: move one, hide one, show the hidden ones again. */
  columnMenu: string;
  resetColumnWidth: string;
  newTagColumn: string;
  /** The phone layout's bar and sheets. */
  viewOptions: string;
  layoutLabel: string;
  scopeLabel: string;
  tableStyle: string;
  tableStyleList: string;
  tableStyleFull: string;
  openSearch: string;
  closeSearch: string;
  addTaskButton: string;
  columnsLabel: string;
  markDoneSwipe: string;
  moreSwipe: string;
  hideProperty: string;
  moveBefore: string;
  moveAfter: string;
  resetWidth: string;
  sortAscending: string;
  sortDescending: string;
  hideColumn: string;
  hiddenColumns: (count: number) => string;
  showColumn: string;
  showAllColumns: string;
  resetOrder: string;
  noPlan: string;
  noTag: string;
  noPriority: string;
  noDeadline: string;
  buckets: Record<DeadlineBucket, string>;
  /** The same buckets for the day a task is planned for. */
  planBuckets: Record<DeadlineBucket, string>;
  addPlaceholder: string;
  addInto: string;
  chooseInbox: string;
  chooseInboxShort: string;
  added: (note: string) => string;
  addFailed: string;
  openNote: string;
  openCard: string;
  shortcuts: string;
  more: string;
  refresh: string;
  manageTags: string;
  showMore: (count: number) => string;
  markDone: string;
  markOpen: string;
  editTitle: string;
  collapse: string;
  expand: string;
  newInColumn: string;
  outsideScope: string;
  repeats: string;
  subtask: string;
  noteMissing: string;
  float: string;
  dock: string;
  close: string;
}

const EN: BoardLabels = {
  title: 'Tasks',
  open: 'Open task board',
  summary: (total, done, overdue) =>
    [`${total} ${total === 1 ? 'task' : 'tasks'}`, `${done} done`, overdue ? `${overdue} overdue` : '']
      .filter(Boolean)
      .join(' · '),
  loading: 'Reading your notes…',
  empty: 'No tasks here yet. Add one above, or write “- [ ] ” in any note.',
  emptyFiltered: 'No task matches the current search and filters.',
  emptyClear: 'Clear search and filters',
  scopeTarget: (folder) => folder,
  scopeVault: 'Whole vault',
  scopeTargetUnset: 'Set a target folder under TaskPro → General to show only that folder.',
  layoutTable: 'Table',
  layoutBoard: 'Board',
  search: 'Search tasks…',
  group: 'Group',
  groupBy: {
    none: 'No grouping',
    status: 'Status',
    tag: 'Tag',
    priority: 'Priority',
    deadline: 'Deadline',
    plan: 'Plan',
    note: 'Note',
  },
  sort: 'Sort',
  sortBy: {
    document: 'Note order',
    title: 'Title',
    status: 'Status',
    priority: 'Priority',
    deadline: 'Deadline',
    plan: 'Plan',
    progress: 'Progress',
    note: 'Note',
  },
  ascending: 'Ascending',
  descending: 'Descending',
  filter: 'Filter',
  filterStatus: 'Status',
  filterPriority: 'Priority',
  filterTags: 'Tags',
  filterDeadline: 'Deadline',
  filterPlan: 'Plan',
  filterNote: 'Note',
  filterSearch: 'Search filters…',
  clearFilters: 'Clear filters',
  columns: {
    task: 'Task',
    status: 'Status',
    tags: 'Tags',
    priority: 'Priority',
    deadline: 'Deadline',
    plan: 'Plan',
    waiting: 'Waiting on',
    repeat: 'Repeat',
    progress: 'Progress',
    note: 'Note',
  },
  properties: 'Properties',
  propertiesIn: { tableColumns: 'Shown in the table', cardProperties: 'Shown on cards' },
  resetColumns: 'Reset to default',
  viewSection: 'View',
  density: 'Density',
  densities: { compact: 'Compact', comfortable: 'Comfortable', spacious: 'Spacious' },
  wrapTitles: 'Wrap titles',
  hideEmptyColumns: 'Hide empty columns',
  columnMenu: 'Column options',
  resetColumnWidth: 'Reset column width',
  newTagColumn: 'New tag',
  viewOptions: 'View options',
  layoutLabel: 'Layout',
  scopeLabel: 'Show tasks from',
  tableStyle: 'Table style',
  tableStyleList: 'List',
  tableStyleFull: 'Full table',
  openSearch: 'Search',
  closeSearch: 'Close search',
  addTaskButton: 'New task',
  columnsLabel: 'Columns',
  markDoneSwipe: 'Done',
  moreSwipe: 'More',
  hideProperty: 'Hide property',
  moveBefore: 'Move left',
  moveAfter: 'Move right',
  resetWidth: 'Reset width',
  sortAscending: 'Sort ascending',
  sortDescending: 'Sort descending',
  hideColumn: 'Hide column',
  hiddenColumns: (count) => (count === 1 ? '1 hidden column' : `${count} hidden columns`),
  showColumn: 'Show column',
  showAllColumns: 'Show all columns',
  resetOrder: 'Reset column order',
  noPlan: 'Not planned',
  noTag: 'No tag',
  noPriority: 'No priority',
  noDeadline: 'No deadline',
  buckets: {
    overdue: 'Overdue',
    today: 'Today',
    week: 'Next 7 days',
    later: 'Later',
    past: 'Past',
    none: 'No deadline',
  },
  planBuckets: {
    overdue: 'Missed',
    today: 'Today',
    week: 'Next 7 days',
    later: 'Later',
    past: 'Past',
    none: 'Not planned',
  },
  addPlaceholder: 'Add a task…',
  addInto: 'Adds to',
  chooseInbox: 'Choose the note new tasks go into',
  chooseInboxShort: 'Choose note',
  added: (note) => `Task added to ${isolate(note)}`,
  addFailed: 'Choose a note for new tasks first',
  openNote: 'Open in note',
  openCard: 'Open card',
  shortcuts: 'Keyboard shortcuts',
  more: 'More options',
  refresh: 'Rescan notes',
  manageTags: 'Manage tags',
  showMore: (count) => `Show ${count} more`,
  markDone: 'Mark done',
  markOpen: 'Mark not started',
  editTitle: 'Click to edit',
  collapse: 'Collapse group',
  expand: 'Expand group',
  newInColumn: 'New',
  outsideScope: 'Added — the note is outside the current scope, so it is not listed here.',
  repeats: 'Repeats',
  subtask: 'Subtask',
  noteMissing: 'That note no longer exists',
  float: 'Float over Obsidian',
  dock: 'Open in a tab',
  close: 'Close',
};

const FA: BoardLabels = {
  title: 'تسک‌ها',
  open: 'باز کردن صفحه تسک‌ها',
  summary: (total, done, overdue) =>
    [`${total} تسک`, `${done} انجام شده`, overdue ? `${overdue} عقب افتاده` : ''].filter(Boolean).join(' · '),
  loading: 'در حال خواندن یادداشت‌ها…',
  empty: 'هنوز تسکی اینجا نیست. از بالا یکی اضافه کنید یا در هر یادداشتی «- [ ] » بنویسید.',
  emptyFiltered: 'هیچ تسکی با جستجو و فیلترهای فعلی جور نیست.',
  emptyClear: 'پاک کردن جستجو و فیلترها',
  scopeTarget: (folder) => folder,
  scopeVault: 'کل والت',
  scopeTargetUnset: 'برای نمایش فقط یک پوشه، در تنظیمات TaskPro بخش General پوشه هدف را تعیین کنید.',
  layoutTable: 'جدول',
  layoutBoard: 'بورد',
  search: 'جستجوی تسک‌ها…',
  group: 'گروه‌بندی',
  groupBy: {
    none: 'بدون گروه‌بندی',
    status: 'وضعیت',
    tag: 'برچسب',
    priority: 'اولویت',
    deadline: 'سررسید',
    plan: 'برنامه',
    note: 'یادداشت',
  },
  sort: 'مرتب‌سازی',
  sortBy: {
    document: 'ترتیب یادداشت',
    title: 'عنوان',
    status: 'وضعیت',
    priority: 'اولویت',
    deadline: 'سررسید',
    plan: 'برنامه',
    progress: 'پیشرفت',
    note: 'یادداشت',
  },
  ascending: 'صعودی',
  descending: 'نزولی',
  filter: 'فیلتر',
  filterStatus: 'وضعیت',
  filterPriority: 'اولویت',
  filterTags: 'برچسب‌ها',
  filterDeadline: 'سررسید',
  filterPlan: 'برنامه',
  filterNote: 'یادداشت',
  filterSearch: 'جستجوی فیلترها…',
  clearFilters: 'پاک کردن فیلترها',
  columns: {
    task: 'تسک',
    status: 'وضعیت',
    tags: 'برچسب‌ها',
    priority: 'اولویت',
    deadline: 'سررسید',
    plan: 'برنامه',
    waiting: 'منتظرِ',
    repeat: 'تکرار',
    progress: 'پیشرفت',
    note: 'یادداشت',
  },
  properties: 'ویژگی‌ها',
  propertiesIn: { tableColumns: 'نمایش در جدول', cardProperties: 'نمایش روی کارت‌ها' },
  resetColumns: 'بازگشت به پیش‌فرض',
  viewSection: 'نما',
  density: 'تراکم',
  densities: { compact: 'فشرده', comfortable: 'معمولی', spacious: 'راحت' },
  wrapTitles: 'شکستن عنوان‌ها',
  hideEmptyColumns: 'پنهان کردن ستون‌های خالی',
  columnMenu: 'گزینه‌های ستون',
  resetColumnWidth: 'بازگشت به عرض پیش‌فرض ستون‌ها',
  newTagColumn: 'برچسب تازه',
  viewOptions: 'گزینه‌های نما',
  layoutLabel: 'چیدمان',
  scopeLabel: 'تسک‌ها از',
  tableStyle: 'شکل جدول',
  tableStyleList: 'فهرست',
  tableStyleFull: 'جدول کامل',
  openSearch: 'جستجو',
  closeSearch: 'بستن جستجو',
  addTaskButton: 'تسک تازه',
  columnsLabel: 'ستون‌ها',
  markDoneSwipe: 'انجام شد',
  moreSwipe: 'بیشتر',
  hideProperty: 'پنهان کردن ویژگی',
  moveBefore: 'جابه‌جایی به راست',
  moveAfter: 'جابه‌جایی به چپ',
  resetWidth: 'بازگشت به عرض پیش‌فرض',
  sortAscending: 'مرتب‌سازی صعودی',
  sortDescending: 'مرتب‌سازی نزولی',
  hideColumn: 'پنهان کردن ستون',
  hiddenColumns: (count) => `${count} ستون پنهان`,
  showColumn: 'نمایش ستون',
  showAllColumns: 'نمایش همه ستون‌ها',
  resetOrder: 'بازگشت به ترتیب پیش‌فرض',
  noPlan: 'برنامه‌ریزی نشده',
  noTag: 'بدون برچسب',
  noPriority: 'بدون اولویت',
  noDeadline: 'بدون سررسید',
  buckets: {
    overdue: 'عقب افتاده',
    today: 'امروز',
    week: '۷ روز آینده',
    later: 'بعدتر',
    past: 'گذشته',
    none: 'بدون سررسید',
  },
  planBuckets: {
    overdue: 'از دست رفته',
    today: 'امروز',
    week: '۷ روز آینده',
    later: 'بعدتر',
    past: 'گذشته',
    none: 'برنامه‌ریزی‌نشده',
  },
  addPlaceholder: 'افزودن تسک…',
  addInto: 'افزودن به',
  chooseInbox: 'یادداشتی که تسک‌های جدید در آن نوشته می‌شوند',
  chooseInboxShort: 'انتخاب یادداشت',
  added: (note) => `تسک به ${isolate(note)} اضافه شد`,
  addFailed: 'اول یادداشت مقصد تسک‌های جدید را انتخاب کنید',
  openNote: 'باز کردن در یادداشت',
  openCard: 'باز کردن کارت',
  shortcuts: 'میانبرهای صفحه‌کلید',
  more: 'گزینه‌های بیشتر',
  refresh: 'خواندن دوباره یادداشت‌ها',
  manageTags: 'مدیریت برچسب‌ها',
  showMore: (count) => `نمایش ${count} مورد دیگر`,
  markDone: 'انجام شد',
  markOpen: 'شروع نشده',
  editTitle: 'برای ویرایش کلیک کنید',
  collapse: 'بستن گروه',
  expand: 'باز کردن گروه',
  newInColumn: 'جدید',
  outsideScope: 'اضافه شد — این یادداشت بیرون از محدوده فعلی است و اینجا نمایش داده نمی‌شود.',
  repeats: 'تکرار',
  subtask: 'زیرتسک',
  noteMissing: 'این یادداشت دیگر وجود ندارد',
  float: 'نمایش شناور روی ابسیدین',
  dock: 'باز کردن در تب',
  close: 'بستن',
};

export function getBoardLabels(language: Language): BoardLabels {
  return language === 'fa' ? FA : EN;
}
