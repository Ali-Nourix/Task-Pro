// ── board/board-text.ts ───────────────────────────────────────────────────
// Task text as the board and the calendar show it.

/** Strips link and emphasis syntax so a title reads as text in a cell. */
export function displayTitle(text: string): string {
  return text
    .replace(/!?\[\[([^\]|#]*)(?:#[^\]|]*)?\|([^\]]+)\]\]/g, '$2')
    .replace(/!?\[\[([^\]|#]*)(?:#([^\]|]*))?\]\]/g, (_m, target: string, heading?: string) => {
      const name = target.split('/').pop() || heading || '';
      return name;
    })
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__|~~|==)(.+?)\1/g, '$2')
    .replace(/`([^`]+)`/g, '$1')
    .trim();
}

/** A note path as its name: no folder, no extension. */
export function noteName(path: string): string {
  return path.split('/').pop()!.replace(/\.md$/i, '');
}
