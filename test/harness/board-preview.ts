/**
 * Renders the real task board, tag picker, tag manager and tag chips against a
 * stub host, for test/board-preview.html. Nothing here is a mock-up of the UI:
 * the DOM comes from the same classes the plugin runs.
 *
 * Query string: ?layout=board, ?group=<none|status|tag|priority|deadline|note>,
 * ?view=<board|picker|manager|note|palette>, ?lang=fa, plus the harness's ?light and
 * ?theme=<name>.
 */
import { TaskBoard, TaskBoardHost } from '../../src/board/task-board';
import { BoardTask, parseBoardTasks } from '../../src/board/task-store';
import { BoardGroupBy, DEFAULT_BOARD_PREFERENCES, Language, TaskProgress } from '../../src/types';
import { TaskTag } from '../../src/tags';
import { openTagPicker } from '../../src/ui/tag-picker';
import { renderTagManager } from '../../src/ui/tag-manager';
import {
  appendTagChips,
  applyChipScale,
  createDeadlineChip,
  createPriorityChip,
  createProgressChip,
  createRepeatChip,
  createStatusChip,
} from '../../src/ui/chips';
import {
  extractDeadline,
  extractPriority,
  extractRepeat,
  extractTags,
  replaceTaskText,
  setDeadline,
  setPriority,
  setTags,
} from '../../src/task-metadata';
import { TAG_PALETTE, applyTagColor, resolveTag } from '../../src/tags';
import { missingIcons } from './obsidian-stub';

const params = new URLSearchParams(location.search);
const language = (params.get('lang') === 'fa' ? 'fa' : 'en') as Language;

/** Dates relative to today, so the deadline chips read the same whenever this runs. */
function inDays(days: number): string {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + days);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

const TAGS: TaskTag[] =
  language === 'fa'
    ? [
        { key: 'work', name: 'کار', color: 'blue' },
        { key: 'client', name: 'مشتری', color: 'purple' },
        { key: 'deep-work', name: 'کار عمیق', color: 'cyan' },
        { key: 'home', name: 'خانه', color: 'green' },
        { key: 'health', name: 'سلامت', color: 'red' },
        { key: 'learning', name: 'یادگیری', color: 'orange' },
      ]
    : [
        { key: 'work', name: 'Work', color: 'blue' },
        { key: 'client', name: 'Client', color: 'purple' },
        { key: 'deep-work', name: 'Deep work', color: 'cyan' },
        { key: 'home', name: 'Home', color: 'green' },
        { key: 'health', name: 'Health', color: 'red' },
        { key: 'learning', name: 'Learning', color: 'orange' },
      ];

const NOTES: Record<string, string> =
  language === 'fa'
    ? {
        'Planner/1405-W27.md': [
          `- [/] نوشتن پست معرفی محصول @priority(high) @due(${inDays(3)}) @tag(work, deep-work) ^launch`,
          `- [ ] آماده کردن پیش‌فاکتور برای شرکت آریا @priority(highest) @due(${inDays(0)}) @tag(client, work)`,
          `- [!] پیگیری فاکتور معوق @priority(highest) @due(${inDays(-2)}) @tag(client)`,
          `- [ ] مرور هفتگی و برنامه‌ریزی @repeat(1w) @due(${inDays(1)}) @tag(work)`,
          `- [x] رزرو سالن جلسه @due(${inDays(-1)}) @tag(work) ^venue`,
        ].join('\n'),
        'Projects/Website redesign.md': [
          `- [/] طراحی صفحه اصلی @priority(medium) @due(${inDays(6)}) @tag(deep-work) ^home`,
          `    - [ ] انتخاب فونت فارسی @tag(deep-work)`,
          `    - [x] جمع‌آوری نمونه‌ها`,
          `- [ ] تست دسترس‌پذیری @priority(low) @due(${inDays(12)})`,
        ].join('\n'),
        'Life/Home.md': [
          `- [ ] خرید هفتگی @repeat(1w) @due(${inDays(2)}) @tag(home)`,
          `- [ ] نوبت دندانپزشکی @priority(medium) @due(${inDays(9)}) @tag(health)`,
          `- [/] فصل ۴ کتاب طراحی سیستم @tag(learning) ^book`,
        ].join('\n'),
      }
    : {
        'Planner/2026-W39.md': [
          `- [/] Draft the launch post @priority(high) @due(${inDays(3)}) @tag(work, deep-work) ^launch`,
          `- [ ] Send the quote to Acme @priority(highest) @due(${inDays(0)}) @tag(client, work)`,
          `- [!] Chase the missing invoice @priority(highest) @due(${inDays(-2)}) @tag(client)`,
          `- [ ] Weekly review and planning @repeat(1w) @due(${inDays(1)}) @tag(work)`,
          `- [x] Book the venue @due(${inDays(-1)}) @tag(work) ^venue`,
        ].join('\n'),
        'Projects/Website redesign.md': [
          `- [/] Design the new home page @priority(medium) @due(${inDays(6)}) @tag(deep-work) ^home`,
          `    - [ ] Pick the display typeface @tag(deep-work)`,
          `    - [x] Collect reference sites`,
          `- [ ] Accessibility pass @priority(low) @due(${inDays(12)})`,
        ].join('\n'),
        'Life/Home.md': [
          `- [ ] Groceries @repeat(1w) @due(${inDays(2)}) @tag(home)`,
          `- [ ] Dentist appointment @priority(medium) @due(${inDays(9)}) @tag(health)`,
          `- [/] Chapter 4 of Designing Data-Intensive Applications @tag(learning) ^book`,
        ].join('\n'),
      };

const PROGRESS: Record<string, TaskProgress> = {
  launch: { enabled: true, currentSteps: 3, totalSteps: 8 },
  home: { enabled: true, currentSteps: 2, totalSteps: 5 },
  venue: { enabled: true, currentSteps: 4, totalSteps: 4 },
  book: { enabled: true, currentSteps: 7, totalSteps: 12 },
};

let tasks: BoardTask[] = [];
const listeners = new Set<() => void>();
const reparse = () => {
  tasks = Object.entries(NOTES).flatMap(([path, content]) => parseBoardTasks(path, content));
};
reparse();

/** What the plugin does to a note, done to the in-memory notes, then the board is told. */
const edit = async (task: BoardTask, transform: (line: string) => string) => {
  const lines = NOTES[task.filePath].split('\n');
  lines[task.lineNumber] = transform(lines[task.lineNumber]);
  NOTES[task.filePath] = lines.join('\n');
  reparse();
  listeners.forEach((fn) => fn());
};
(window as unknown as { __notes: typeof NOTES }).__notes = NOTES;

const store = {
  isLoaded: true,
  ensureLoaded: async () => undefined,
  reload: async () => undefined,
  all: () => tasks,
  inFile: (path: string) => tasks.filter((task) => task.filePath === path),
  subscribe: (fn: () => void) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};

const layout = params.get('layout') === 'board' ? 'board' : 'table';
const groupBy = (params.get('group') ?? (layout === 'board' ? 'status' : 'status')) as BoardGroupBy;
const settings = {
  language,
  calendarSystem: language === 'fa' ? ('jalali' as const) : ('gregorian' as const),
  targetFolder: params.get('scope') === 'vault' ? '' : 'Planner',
  tags: TAGS,
  board: { ...DEFAULT_BOARD_PREFERENCES, layout, groupBy, scope: 'vault' as const, inboxPath: 'Inbox.md' },
  referenceNotePath: 'Inbox.md',
};

const noop = async () => undefined;
const host = {
  app: {},
  store,
  getSettings: () => settings,
  savePreferences: noop,
  getProgress: (task: BoardTask) => (task.blockId ? PROGRESS[task.blockId] : undefined),
  setStatus: (task: BoardTask, status: string) => edit(task, (line) => line.replace(/- \[[ \/xX!]\]/, `- ${status}`)),
  setPriority: (task: BoardTask, priority: Parameters<typeof setPriority>[1]) => edit(task, (line) => setPriority(line, priority)),
  setTags: (task: BoardTask, keys: string[]) => edit(task, (line) => setTags(line, keys)),
  setText: (task: BoardTask, text: string) => edit(task, (line) => replaceTaskText(line, text)),
  editDeadline: (task: BoardTask) => edit(task, (line) => setDeadline(line, inDays(5))),
  editTags: (task: BoardTask) =>
    openTagPicker({
      language,
      getTags: () => TAGS,
      selected: task.tags,
      onCreate: async (tag) => {
        TAGS.push(tag);
      },
      onSave: (keys) => edit(task, (line) => setTags(line, keys)),
    }),
  editProgress: () => undefined,
  openTaskMenu: () => undefined,
  reveal: noop,
  addTask: async (path: string, line: string) => {
    NOTES[path] = `${NOTES[path] ?? ''}${NOTES[path] ? '\n' : ''}${line}`;
    reparse();
    listeners.forEach((fn) => fn());
    return true;
  },
  noteExists: () => true,
  chooseNote: () => undefined,
  manageTags: () => undefined,
  notify: (message: string) => console.log(message),
} as unknown as TaskBoardHost;

async function main(): Promise<void> {
  const root = document.getElementById('root')!;
  const view = params.get('view') ?? 'board';

  if (view === 'board') {
    root.addClass('workspace-leaf-content');
    const content = root.createDiv({ cls: 'view-content taskpro-board-view' });
    await new TaskBoard(content, host).mount();
  } else if (view === 'picker') {
    openTagPicker({
      language,
      getTags: () => TAGS,
      selected: ['work', 'deep-work'],
      onCreate: async (tag) => {
        TAGS.push(tag);
      },
      onSave: () => undefined,
      onManage: () => undefined,
    });
    const search = document.querySelector<HTMLInputElement>('.taskpro-tag-picker__search');
    if (search && params.get('query')) {
      search.value = params.get('query')!;
      search.dispatchEvent(new Event('input'));
    }
  } else if (view === 'manager') {
    root.addClass('manager-host');
    const counts = new Map<string, number>();
    for (const task of tasks) for (const key of task.tags) counts.set(key, (counts.get(key) ?? 0) + 1);
    renderTagManager(root.createDiv(), {
      language,
      getTags: () => TAGS,
      setTags: async () => undefined,
      countUsage: async () => counts,
      removeFromNotes: async () => 0,
    });
  } else if (view === 'note') {
    root.addClass('note-host');
    root.setAttribute('dir', language === 'fa' ? 'rtl' : 'ltr');
    root.createEl('h2', { text: language === 'fa' ? 'این هفته' : 'This week' });
    const [firstPath] = Object.keys(NOTES);
    for (const task of tasks.filter((t) => t.filePath === firstPath)) {
      const line = root.createDiv({ cls: `line${task.status === '[x]' ? ' done' : ''}` });
      line.createSpan({ cls: `cb ${{ '[x]': 'done', '[/]': 'doing', '[!]': 'blocked', '[ ]': '' }[task.status]}` });
      line.createSpan({ cls: 'txt', text: task.text });
      const container = line.createSpan({ cls: 'taskpro-badge-container' });
      applyChipScale(container, 12);
      const common = { filePath: task.filePath, lineContent: task.line, blockId: task.blockId };
      const priority = extractPriority(task.line);
      const deadline = extractDeadline(task.line);
      const repeat = extractRepeat(task.line);
      container.appendChild(createStatusChip({ ...common, status: task.status, language }));
      if (priority) container.appendChild(createPriorityChip({ ...common, priority, status: task.status, language }));
      if (repeat) container.appendChild(createRepeatChip({ ...common, repeat, status: task.status, language }));
      if (deadline) container.appendChild(createDeadlineChip(deadline, language, task.status));
      const progress = task.blockId ? PROGRESS[task.blockId] : undefined;
      if (progress) container.appendChild(createProgressChip({ ...common, ...progress, language }));
      appendTagChips(container, extractTags(task.line).map((key) => resolveTag(key, TAGS)), common);
    }
  }

  else if (view === 'palette') {
    // One tag chip per palette colour, for the contrast check.
    root.addClass('note-host');
    const row = root.createDiv({ cls: 'line' });
    for (const entry of TAG_PALETTE) {
      const chip = row.createSpan({ cls: 'taskpro-chip taskpro-tag-chip' });
      applyTagColor(chip, entry.id);
      chip.dataset.tag = entry.id;
      chip.createSpan({ cls: 'taskpro-chip__label', text: entry.id });
    }
  }

  if (missingIcons.size) console.warn(`Missing icons: ${Array.from(missingIcons).join(', ')}`);
  document.body.dataset.ready = 'true';
}

void main();
