/**
 * An in-memory Obsidian for loading the whole plugin under Node.
 *
 * Only what TaskPro's load path and editing paths touch is implemented. The
 * vault keeps notes in a Map; `process` rewrites a note and then fires the
 * same `modify` and metadata `changed` events Obsidian would, with a metadata
 * cache that lists task items the way Obsidian's does.
 */

/** Accepts any property access or call, for DOM the tests never inspect. */
const inert = new Proxy(function () {}, {
  get: (_target, prop) => (prop === Symbol.toPrimitive ? () => '' : prop === 'then' ? undefined : inert),
  apply: () => inert,
});

globalThis.window ??= globalThis;
globalThis.document ??= {
  body: inert,
  querySelectorAll: () => [],
  createElement: () => inert,
  addEventListener() {},
  removeEventListener() {},
};

export const notices = [];

export class Notice {
  constructor(message) {
    notices.push(String(message));
  }
}

export class TFile {
  constructor(path, vault) {
    this.path = path;
    this.name = path.split('/').pop();
    this.basename = this.name.replace(/\.md$/i, '');
    this.extension = this.name.split('.').pop();
    this.stat = { ctime: 0, mtime: 0, size: 0 };
    this.vault = vault;
  }
}

class Events {
  constructor() {
    this.handlers = new Map();
  }
  on(name, callback) {
    if (!this.handlers.has(name)) this.handlers.set(name, []);
    this.handlers.get(name).push(callback);
    return { name, callback };
  }
  trigger(name, ...args) {
    for (const callback of this.handlers.get(name) ?? []) callback(...args);
  }
}

/** Task list items, as Obsidian's metadata cache reports them. */
export function cacheFor(content) {
  const listItems = [];
  content.split('\n').forEach((line, index) => {
    const match = /^\s*(?:[-*+]|\d+[.)]) \[(.)\]/.exec(line);
    if (match) listItems.push({ task: match[1], position: { start: { line: index } } });
  });
  return { listItems };
}

export class Vault extends Events {
  constructor(files, metadataCache) {
    super();
    this.files = new Map(Object.entries(files));
    this.metadataCache = metadataCache;
    this.writes = 0;
  }
  file(path) {
    return this.files.has(path) ? new TFile(path, this) : null;
  }
  getFileByPath(path) {
    return this.file(path);
  }
  getAbstractFileByPath(path) {
    return this.file(path);
  }
  getMarkdownFiles() {
    return [...this.files.keys()].filter((p) => p.endsWith('.md')).map((p) => new TFile(p, this));
  }
  async read(file) {
    return this.files.get(file.path) ?? '';
  }
  async cachedRead(file) {
    return this.files.get(file.path) ?? '';
  }
  async process(file, fn) {
    const before = this.files.get(file.path) ?? '';
    const after = fn(before);
    if (after !== before) {
      this.files.set(file.path, after);
      this.writes++;
      this.trigger('modify', file);
      this.metadataCache.trigger('changed', file, after, cacheFor(after));
    }
    return after;
  }
  getResourcePath() {
    return '';
  }
}

export class MetadataCache extends Events {
  constructor() {
    super();
    this.vault = null;
  }
  getFileCache(file) {
    const content = this.vault?.files.get(file.path);
    return content === undefined ? null : cacheFor(content);
  }
}

export class App {
  constructor(files = {}) {
    this.metadataCache = new MetadataCache();
    this.vault = new Vault(files, this.metadataCache);
    this.metadataCache.vault = this.vault;
    this.workspace = {
      // Callbacks queued before `ready` is set are kept, not run: a test turns
      // the layout on after onload, so startup passes (overdue marking, the
      // one-time migration) stay out of the way unless it runs them itself.
      ready: false,
      layoutReady: [],
      onLayoutReady: (callback) => (this.workspace.ready ? callback() : this.workspace.layoutReady.push(callback)),
      getActiveFile: () => null,
      getActiveViewOfType: () => null,
      getMostRecentLeaf: () => null,
      getLeavesOfType: () => [],
      iterateAllLeaves: () => {},
      getLeaf: () => inert,
      revealLeaf: async () => {},
      openLinkText: async () => {},
      on: () => ({}),
    };
    this.data = null;
    this.commands = [];
    this.views = {};
  }
}

export class Component {
  registerEvent() {}
  registerDomEvent() {}
  registerInterval(id) {
    return id;
  }
  register() {}
  addChild(child) {
    return child;
  }
}

export class Plugin extends Component {
  constructor(app, manifest) {
    super();
    this.app = app;
    this.manifest = manifest;
  }
  async loadData() {
    return this.app.data ? JSON.parse(JSON.stringify(this.app.data)) : null;
  }
  async saveData(data) {
    this.app.data = JSON.parse(JSON.stringify(data));
  }
  addCommand(command) {
    this.app.commands.push(command);
    return command;
  }
  registerView(type, factory) {
    this.app.views[type] = factory;
  }
  addRibbonIcon() {
    return inert;
  }
  addSettingTab() {}
  addStatusBarItem() {
    return inert;
  }
  registerEditorExtension() {}
  registerMarkdownPostProcessor() {}
}

export class ItemView extends Component {
  constructor(leaf) {
    super();
    this.leaf = leaf;
    this.contentEl = inert;
  }
}
export class MarkdownView {}
export class PluginSettingTab {}
export class Setting {}

/** Records what a modal does to its container and to <body>. */
export const modalLog = [];
class FakeElement {
  constructor(name) {
    this.name = name;
    this.classes = new Set();
  }
  get ownerDocument() {
    return { body: bodyElement };
  }
  addClass(...names) {
    names.forEach((n) => this.classes.add(n));
    modalLog.push(`${this.name} +${names.join(' +')}`);
  }
  removeClass(...names) {
    names.forEach((n) => this.classes.delete(n));
    modalLog.push(`${this.name} -${names.join(' -')}`);
  }
  empty() {}
  querySelector() {
    return null;
  }
  // What the board builds inside the modal is not inspected here.
  createDiv() {
    return inert;
  }
  createEl() {
    return inert;
  }
  createSpan() {
    return inert;
  }
}
const bodyElement = new FakeElement('body');
export { bodyElement };

export class Modal {
  constructor(app) {
    this.app = app;
    this.containerEl = new FakeElement('container');
    this.modalEl = new FakeElement('modal');
    this.contentEl = new FakeElement('content');
    this.scope = { registered: [], register: (mods, key) => this.scope.registered.push([mods.join('+'), key]) };
  }
  open() {
    this.isOpen = true;
    this.onOpen();
  }
  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.onClose();
  }
}
export class FuzzySuggestModal {}
export class Menu {}
export class WorkspaceLeaf {}
export const setIcon = () => {};

// ── CodeMirror, which the plugin also takes from the host at runtime ─────────
export class EditorView {}
export class WidgetType {}
export class RangeSetBuilder {
  add() {}
  finish() {
    return {};
  }
}
export const Decoration = { replace: () => ({}), widget: () => ({}), none: {} };
export const ViewPlugin = { fromClass: () => ({}) };
export const StateEffect = { define: () => ({ of: () => ({}), is: () => false }) };
