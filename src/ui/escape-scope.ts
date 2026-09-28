// ── ui/escape-scope.ts ────────────────────────────────────────────────────
// Escape closes the topmost TaskPro layer (a panel, a calendar card, a drag)
// and nothing under it.
//
// Obsidian reads keys through its keymap before a listener on the document
// sees them, so a panel over the floating board could not keep Escape from
// closing the board too. A keymap scope pushed while the layer is open is
// Obsidian's own way of claiming a key: the newest scope is asked first, and a
// handler that returns false ends it there. Menus do the same, so a menu a
// layer opened still closes before the layer does.
// ─────────────────────────────────────────────────────────────────────────────

import { App, Scope } from 'obsidian';

let keymapApp: App | null = null;

/** Called once by the plugin; without it (the preview harness) a document listener stands in. */
export function useKeymapOf(app: App | null): void {
  keymapApp = app;
}

/** Fired at a field that uses Escape itself, such as an inline rename, instead of closing its layer. */
export const OWN_ESCAPE_EVENT = 'taskpro-own-escape';

/**
 * Makes Escape call `onEscape` while the returned release has not been
 * called. A focused field marked `data-own-escape="true"` gets the key
 * instead, as a `taskpro-own-escape` event.
 */
export function claimEscape(onEscape: () => void, doc: Document = document): () => void {
  const handle = () => {
    const owner = (doc.activeElement as HTMLElement | null)?.closest?.('[data-own-escape="true"]');
    if (owner) owner.dispatchEvent(new CustomEvent(OWN_ESCAPE_EVENT));
    else onEscape();
  };

  if (keymapApp) {
    const app = keymapApp;
    const scope = new Scope(app.scope);
    scope.register([], 'Escape', () => {
      handle();
      return false;
    });
    app.keymap.pushScope(scope);
    return () => app.keymap.popScope(scope);
  }

  // Without a keymap: one listener, newest claim first, like the scopes.
  fallbackStack.push(handle);
  if (fallbackStack.length === 1) doc.addEventListener('keydown', onFallbackKey, true);
  return () => {
    const index = fallbackStack.lastIndexOf(handle);
    if (index !== -1) fallbackStack.splice(index, 1);
    if (!fallbackStack.length) doc.removeEventListener('keydown', onFallbackKey, true);
  };
}

const fallbackStack: Array<() => void> = [];

function onFallbackKey(event: KeyboardEvent): void {
  if (event.key !== 'Escape' || !fallbackStack.length) return;
  event.preventDefault();
  event.stopPropagation();
  fallbackStack[fallbackStack.length - 1]();
}
