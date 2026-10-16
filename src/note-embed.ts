// Real board/calendar views inside Markdown, backed by the shared task store.
import { MarkdownRenderChild } from 'obsidian';
import { BoardPreferences, BoardScope, EmbedScopeMode, DEFAULT_BOARD_PREFERENCES } from './types';
import { TaskBoard, TaskBoardHost } from './board/task-board';
import { renderBoardSkeleton } from './board/loading-state';
import { scheduleEmbed } from './embed-scheduler';

/** Deliberately small, strict syntax: unknown options should not silently change a view. */
export interface EmbedConfig { prefs: BoardPreferences; chrome: 'full' | 'minimal'; }
export function parseEmbedConfig(source: string): EmbedConfig {
  let chrome: 'full' | 'minimal' = 'minimal';
  const prefs: BoardPreferences = JSON.parse(JSON.stringify(DEFAULT_BOARD_PREFERENCES));
  const seen = new Set<string>();
  for (const raw of source.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const match = /^([a-z-]+)\s*:\s*([a-z]+)\s*$/.exec(line);
    if (!match) throw new Error(`Invalid TaskPro option: ${line}`);
    const [, key, value] = match;
    if (seen.has(key)) throw new Error(`Duplicate TaskPro option: ${key}`);
    seen.add(key);
    switch (key) {
      case 'view':
        if (value !== 'table' && value !== 'calendar') throw new Error('view: table | calendar');
        prefs.layout = value; break;
      case 'calendar-view':
        if (!['month', 'week', 'day', 'agenda'].includes(value)) throw new Error('calendar-view: month | week | day | agenda');
        prefs.calendarView = value as BoardPreferences['calendarView']; break;
      case 'calendar-system':
        if (value !== 'jalali' && value !== 'gregorian') throw new Error('calendar-system: jalali | gregorian');
        prefs.calendarSystem = value; break;
      case 'chrome':
        if (value !== 'minimal' && value !== 'full') throw new Error('chrome: minimal | full');
        chrome = value; break;
      case 'calendar-sidebar':
        if (value !== 'show' && value !== 'hide') throw new Error('calendar-sidebar: show | hide');
        prefs.calendarSidebar = value === 'show'; break;
      case 'scope':
        if (value !== 'all' && value !== 'target') throw new Error('scope: all | target');
        prefs.scope = value === 'all' ? 'vault' : 'target'; break;
      default: throw new Error(`Unknown TaskPro option: ${key}`);
    }
  }
  if (!seen.has('calendar-sidebar') && chrome === 'minimal') prefs.calendarSidebar = false;
  return { prefs, chrome };
}
export function parseEmbedPreferences(source: string): BoardPreferences { return parseEmbedConfig(source).prefs; }

/** Global startup policy intentionally wins over old scope: all examples unless block mode is selected. */
export function resolveEmbedScope(blockScope: BoardScope, mode: EmbedScopeMode = 'target', folder = ''): BoardScope {
  const scope = mode === 'block' ? blockScope : mode;
  return scope === 'target' && !folder.trim() ? 'vault' : scope;
}

/** Durable state supplied by the plugin, separate for each note block. */
export interface EmbedPersistence {
  load(): { source: string; prefs: BoardPreferences } | undefined;
  save(state: { source: string; prefs: BoardPreferences }): Promise<void>;
}

/** Fence ordinal survives edits above a block; source guards changed block options. */
export function embedStateKey(path: string, section: { text: string; lineStart: number }): string {
  let ordinal = 0;
  let fence: { char: string; length: number } | null = null;
  for (const line of section.text.split('\n').slice(0, section.lineStart)) {
    const match = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (!match) continue;
    const [, marks, info] = match;
    if (fence) {
      if (marks[0] === fence.char && marks.length >= fence.length && !info.trim()) fence = null;
    } else {
      fence = { char: marks[0], length: marks.length };
      if (/^taskpro(?:\s|$)/.test(info.trim())) ordinal++;
    }
  }
  return JSON.stringify([path, ordinal]);
}

export function restoreEmbedPreferences(source: string, persistence?: EmbedPersistence): EmbedConfig {
  const config = parseEmbedConfig(source);
  const saved = persistence?.load();
  if (saved?.source === source && saved.prefs && typeof saved.prefs === 'object') {
    Object.assign(config.prefs, JSON.parse(JSON.stringify(saved.prefs)));
  }
  return config;
}

/** Keep every embedded view's filters/layout separate from workspace settings. */
export function createEmbedHost(host: TaskBoardHost, prefs: BoardPreferences, save: () => Promise<void> = async () => {}): TaskBoardHost {
  return {
    ...host,
    getSettings: () => ({ ...host.getSettings(), board: prefs }),
    savePreferences: save,
    getCalendarDate: () => prefs.calendarDate,
    saveCalendarDate: async (day) => { prefs.calendarDate = day; await save(); },
  };
}

export class TaskProNoteEmbed extends MarkdownRenderChild {
  private board: TaskBoard | null = null;
  private disposed = false;
  private config: EmbedConfig | null = null;
  private scopePolicy = '';
  private observer: IntersectionObserver | null = null;
  private cancelMount: (() => void) | null = null;
  private nearViewport = false;
  private applyScopePolicy(): void {
    if (!this.config) return;
    const settings = this.host.getSettings();
    const mode = settings.embedDefaultScope ?? 'target';
    const folder = settings.targetFolder ?? '';
    const policy = JSON.stringify([mode, folder]);
    if (policy === this.scopePolicy) return;
    this.scopePolicy = policy;
    this.config.prefs.scope = resolveEmbedScope(parseEmbedPreferences(this.source).scope, mode, folder);
  }
  constructor(container: HTMLElement, private readonly source: string,
    private readonly host: TaskBoardHost, private readonly detached: () => void,
    private readonly persistence?: EmbedPersistence) {
    super(container);
  }
  onload(): void {
    this.containerEl.addClass('taskpro-note-embed');
    this.containerEl.setAttribute('role', 'region');
    this.containerEl.setAttribute('aria-label', 'TaskPro');
    try {
      const config = this.config = restoreEmbedPreferences(this.source, this.persistence);
      this.applyScopePolicy();
      const placeholder = this.containerEl.createDiv({ cls: 'taskpro-board taskpro-embed-placeholder is-suspended' });
      placeholder.setAttribute('dir', this.host.getSettings().language === 'fa' ? 'rtl' : 'ltr');
      this.containerEl.setAttribute('aria-busy', 'true');
      renderBoardSkeleton(placeholder, config.prefs.layout, this.host.getSettings().language === 'fa' ? 'در حال بارگذاری…' : 'Loading tasks…', config.prefs.calendarView);
      const view = this.containerEl.ownerDocument.defaultView ?? window;
      const fail = () => {
        if (this.disposed) return;
        this.board?.destroy();
        this.board = null;
        this.containerEl.setAttribute('aria-busy', 'false');
        this.containerEl.empty();
        this.containerEl.createEl('p', { text: 'TaskPro: Could not load tasks. / بارگذاری تسک‌ها ناموفق بود.' });
      };
      const mount = () => {
        this.cancelMount = null;
        if (this.disposed || !this.nearViewport) return;
        try {
          this.applyScopePolicy();
          placeholder.remove();
          this.board = new TaskBoard(this.containerEl, createEmbedHost(this.host, config.prefs, async () => {
            await this.persistence?.save({ source: this.source, prefs: JSON.parse(JSON.stringify(config.prefs)) });
          }), { embedded: true, chrome: config.chrome });
          void this.board.mount().then(() => {
            if (!this.disposed) this.containerEl.setAttribute('aria-busy', 'false');
          }).catch(fail);
        } catch { fail(); }
      };
      const activate = (active: boolean) => {
        if (this.disposed) return;
        this.nearViewport = active;
        placeholder.toggleClass('is-suspended', !active);
        if (this.board) this.board.setViewportActive(active);
        else if (active && !this.cancelMount) this.cancelMount = scheduleEmbed(view, mount);
        else if (!active) { this.cancelMount?.(); this.cancelMount = null; }
      };
      if (typeof view.IntersectionObserver === 'function') {
        this.observer = new view.IntersectionObserver(entries => {
          for (const entry of entries) activate(entry.isIntersecting);
        }, { rootMargin: '160px 0px' });
        this.observer.observe(this.containerEl);
      } else activate(true);
    } catch (error) {
      this.containerEl.createEl('p', { text: `TaskPro: ${error instanceof Error ? error.message : 'Invalid options'}` });
    }
  }
  refresh(): void { this.applyScopePolicy(); this.board?.refresh(); }
  onunload(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.observer?.disconnect();
    this.observer = null;
    this.cancelMount?.();
    this.cancelMount = null;
    this.board?.destroy();
    this.board = null;
    this.containerEl.empty();
    this.detached();
  }
}
