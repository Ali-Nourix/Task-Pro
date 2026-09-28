// ── bidi.ts ───────────────────────────────────────────────────────────────
// Keeping mixed Persian and Latin text in order. A sentence that has a note
// name, a task title or a time dropped into it is laid out by the Unicode
// bidi algorithm, which reorders the pieces by their own direction: a Latin
// note name inside a Persian sentence, or `09:00 – 10:30` inside Persian
// text, comes out in the wrong order. Isolating the dropped-in piece makes it
// one unit that keeps its own direction and leaves the sentence alone.
// ─────────────────────────────────────────────────────────────────────────────

/** Text from outside a sentence, isolated in whichever direction its own first letter has. */
export function isolate(text: string): string {
  return `⁨${text}⁩`;
}

/** Text that reads left to right wherever it is put, such as Latin-digit times and dates. */
export function isolateLtr(text: string): string {
  return `⁦${text}⁩`;
}
