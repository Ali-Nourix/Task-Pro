// Message width. A message is as wide as its longest line, and the buttons under
// it are as wide as the message or wider: a short text leaves a narrow bubble with
// a keyboard hanging out from under it. A last line of invisible characters (braille
// blanks, which Telegram keeps) holds the bubble at the width of a full card. How
// many it takes depends on the screen and the font, so the owner can change it
// (Settings → Message width), and 0 turns it off.

/** The choices the setting steps through. */
export const PADS = [0, 40, 60, 80, 100] as const;
export const DEFAULT_PAD = 60;
/** A line this long already fills a card. */
const FULL_LINE = 34;
const BLANK = '⠀';

export const padOf = (value: number | null | undefined): number => (typeof value === 'number' && value >= 0 && value <= 200 ? value : DEFAULT_PAD);

const visible = (html: string): string[] =>
  html
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .split('\n');

const longestLine = (lines: string[]): number => Math.max(0, ...lines.map((line) => Array.from(line.trim()).length));

/** A classic (HTML) message with its last line widened, when it has buttons and is short. */
export function widenHtml(html: string, hasButtons: boolean, pad: number): string {
  if (!hasButtons || pad <= 0 || longestLine(visible(html)) >= FULL_LINE) return html;
  return `${html}\n${BLANK.repeat(pad)}`;
}

/** The same for a rich message; `html` is the classic text of the same screen, for measuring. */
export function widenMarkdown(markdown: string, html: string, hasButtons: boolean, pad: number): string {
  if (!hasButtons || pad <= 0 || longestLine(visible(html)) >= FULL_LINE) return markdown;
  return `${markdown}\n\n${BLANK.repeat(pad)}`;
}
