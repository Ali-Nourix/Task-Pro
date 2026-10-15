// Real board/calendar views inside Markdown, backed by the shared task store.
import { MarkdownRenderChild } from 'obsidian';
import { BoardPreferences, BoardScope, EmbedScopeMode, DEFAULT_BOARD_PREFERENCES } from './types';
import { TaskBoard, TaskBoardHost } from './board/task-board';

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

/** Keep every embedded view's filters/layout separate from workspace settings. */
export function createEmbedHost(host: TaskBoardHost, prefs: BoardPreferences): TaskBoardHost {
  return {
    ...host,
    getSettings: () => ({ ...host.getSettings(), board: prefs }),
    savePreferences: async () => { /* Local to this rendering; never overwrite global preferences. */ },
  };
}

export class TaskProNoteEmbed extends MarkdownRenderChild {
  private board: TaskBoard | null = null;
  private disposed = false;
  private config: EmbedConfig | null = null;
  private scopePolicy = '';
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
    private readonly host: TaskBoardHost, private readonly detached: () => void) {
    super(container);
  }
  onload(): void {
    this.containerEl.addClass('taskpro-note-embed');
    this.containerEl.setAttribute('role', 'region');
    this.containerEl.setAttribute('aria-label', 'TaskPro');
    try {
      const config = this.config = parseEmbedConfig(this.source);
      this.applyScopePolicy();
      this.board = new TaskBoard(this.containerEl, createEmbedHost(this.host, config.prefs), { embedded: true, chrome: config.chrome });
      void this.board.mount().catch(() => {
        if (this.disposed) return;
        this.board?.destroy();
        this.board = null;
        this.containerEl.empty();
        this.containerEl.createEl('p', { text: 'TaskPro: Could not load tasks. / بارگذاری تسک‌ها ناموفق بود.' });
      });
    } catch (error) {
      this.containerEl.createEl('p', { text: `TaskPro: ${error instanceof Error ? error.message : 'Invalid options'}` });
    }
  }
  refresh(): void { this.applyScopePolicy(); this.board?.refresh(); }
  onunload(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.board?.destroy();
    this.board = null;
    this.containerEl.empty();
    this.detached();
  }
}
