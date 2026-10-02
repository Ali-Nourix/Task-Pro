// Telegram's rich messages (Bot API 10.1): the same screens as Markdown with real
// headings, quotes, task lists and tables. The bot writes its screens as HTML for
// the classic message; this turns that HTML into the rich Markdown, and the
// screens that gain from it (the list, the task) write their own.

/** Characters that mean something in rich Markdown, escaped in text a person wrote. */
const SPECIAL = /[\\*_~`[\]|$^<]/g;

export const mdEscape = (text: string): string => text.replace(SPECIAL, '\\$&');

const ENTITIES: Record<string, string> = { '&lt;': '<', '&gt;': '>', '&amp;': '&' };

/** Inline HTML (b, i, s, code and entities) as Markdown. */
function inline(html: string): string {
  let out = '';
  let code = false;
  const token = /<(\/?)(b|strong|i|em|s|del|code|u|pre|tg-spoiler)>|&(?:lt|gt|amp);|[^<&]+|[<&]/g;
  for (const match of html.matchAll(token)) {
    const [text, closing, tag] = match;
    if (tag) {
      if (tag === 'b' || tag === 'strong') out += '**';
      else if (tag === 'i' || tag === 'em') out += '*';
      else if (tag === 's' || tag === 'del') out += '~~';
      else if (tag === 'code' || tag === 'pre') {
        out += '`';
        code = !closing;
      } else if (tag === 'tg-spoiler') out += '||';
      continue;
    }
    const literal = ENTITIES[text] ?? text;
    out += code ? literal : mdEscape(literal);
  }
  return out;
}

/**
 * A screen's HTML as rich Markdown. A line that is only bold is a heading (the
 * first one the title); a quote becomes a `>` block; line breaks are kept.
 */
export function htmlToRich(html: string): string {
  const lines: string[] = [];
  let heading = 0;
  const parts = html.split(/(<blockquote(?: expandable)?>[\s\S]*?<\/blockquote>)/);
  for (const part of parts) {
    const quote = /^<blockquote(?: expandable)?>([\s\S]*?)<\/blockquote>$/.exec(part);
    if (quote) {
      for (const line of quote[1].split('\n')) {
        const text = inline(line);
        lines.push(text ? `> ${text}  ` : '>');
      }
      lines.push('');
      continue;
    }
    const chunk = part.replace(/^\n+|\n+$/g, '');
    if (!chunk) continue;
    for (const raw of chunk.split('\n')) {
      const text = inline(raw);
      const title = /^\*\*(.+?)\*\*((?:\s+[·—]\s+.*)?)$/.exec(text);
      if (title && /^<b>/.test(raw)) {
        heading++;
        lines.push(`${heading === 1 ? '#' : '##'} ${title[1]}${title[2]}`, '');
      } else lines.push(text ? `${text}  ` : '');
    }
    lines.push('');
  }
  return lines.join('\n').replace(/ {2}\n\n/g, '\n\n').replace(/\n{3,}/g, '\n\n').trim();
}
