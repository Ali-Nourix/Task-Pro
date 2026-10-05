// Telegram's MarkdownV2. The bot writes each screen once, as the small HTML it has
// always used (bold, italic, underline, strikethrough, code, quotes, spoilers, links),
// and this turns that into MarkdownV2 for sending. MarkdownV2 is unforgiving: a
// message with one unescaped `.` or `-` in it is refused whole, so every character
// that is not markup goes through an escape (code and link addresses through their
// own, narrower ones), a style is opened only when text comes and closed before a
// line break inside a quote, and a quote's `>` never lands inside an entity.
//
// A date is written <tg-time unix="…" format="…">words</tg-time>: Telegram's own
// date entity, which shows the moment in the reader's clock (`r` as «in 20 minutes»)
// and keeps our words for clients that do not know it.

/** Characters MarkdownV2 reserves: each is written with a backslash in front when it is plain text. */
const RESERVED = /[\\_*[\]()~`>#+\-=|{}.!]/g;

/** Plain text, safe in MarkdownV2. */
export const escapeV2 = (text: string): string => text.replace(RESERVED, '\\$&');

/** Inside `code` and ```pre```: only the backtick and the backslash. */
const escapeCode = (text: string): string => text.replace(/[\\`]/g, '\\$&');

/** Inside the parentheses of a link: only the closing one and the backslash. */
const escapeUrl = (text: string): string => text.replace(/[\\)]/g, '\\$&');

const ENTITIES: Record<string, string> = { '&lt;': '<', '&gt;': '>', '&amp;': '&', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ' };

type Style = 'b' | 'i' | 'u' | 's' | 'spoiler';
const MARK: Record<Style, string> = { b: '*', i: '_', u: '__', s: '~', spoiler: '||' };
const STYLE_OF: Record<string, Style> = { b: 'b', strong: 'b', i: 'i', em: 'i', u: 'u', ins: 'u', s: 's', strike: 's', del: 's', 'tg-spoiler': 'spoiler' };

interface Block {
  out: string;
  quote?: 'plain' | 'expandable';
  /** The styles whose marks are written and not yet closed in this block. */
  emitted: Style[];
  /** A quote just ended here: what comes next starts on a new line. */
  afterQuote: boolean;
}

const TOKEN = /<(\/?)([a-z][a-z0-9-]*)((?:\s+[a-z-]+(?:="[^"]*"|='[^']*')?)*)\s*\/?>|&(?:lt|gt|amp|quot|nbsp|#39);|[^<&]+|[<&]/gi;

/** The address of a date entity from the tag's attributes: `tg://time?unix=…&format=…`, or null when they are not a date Telegram takes. */
function timeUrl(attributes: string): string | null {
  const unix = /unix=["'](\d{1,12})["']/.exec(attributes)?.[1];
  const format = /format=["']([^"']*)["']/.exec(attributes)?.[1] ?? '';
  if (!unix || !/^(r|w?[dD]?[tT]?)$/.test(format)) return null;
  return `tg://time?unix=${unix}${format ? `&format=${format}` : ''}`;
}

/**
 * The HTML of a screen as MarkdownV2. Understands b/strong, i/em, u/ins, s/strike/del,
 * code, pre, a, blockquote (and `expandable`), tg-spoiler and span.tg-spoiler; any
 * other tag is dropped and its text kept.
 */
export function htmlToMarkdownV2(html: string): string {
  const blocks: Block[] = [{ out: '', emitted: [], afterQuote: false }];
  /** The styles in force, in the order they were opened. */
  const stack: Style[] = [];
  const depth: Partial<Record<Style, number>> = {};
  const spans: boolean[] = [];
  const links: Array<{ url: string; base: number }> = [];
  /** Which of the open links are dates: they are written `![…](…)`. */
  const dates: boolean[] = [];
  let code: '`' | '```' | null = null;
  let codeText = '';

  const top = () => blocks[blocks.length - 1];
  /** `_` next to `_` would be read as `__`: they are kept apart by an empty bold entity, as Telegram's formatting notes say. */
  const put = (piece: string) => {
    const block = top();
    block.out = block.out.endsWith('_') && !block.out.endsWith('\\_') && piece.startsWith('_') ? `${block.out}**${piece}` : block.out + piece;
  };

  /** Makes the marks written match the styles in force: closes the ones that ended, opens the ones that began. */
  const sync = () => {
    const block = top();
    let common = 0;
    while (common < block.emitted.length && common < stack.length && block.emitted[common] === stack[common]) common++;
    for (let i = block.emitted.length - 1; i >= common; i--) put(MARK[block.emitted[i]]);
    block.emitted.length = common;
    for (let i = common; i < stack.length; i++) {
      put(MARK[stack[i]]);
      block.emitted.push(stack[i]);
    }
  };

  /** Closes the marks of styles that have ended, without opening any: before a line break, so that it falls outside them. */
  const settle = () => {
    const block = top();
    let common = 0;
    while (common < block.emitted.length && common < stack.length && block.emitted[common] === stack[common]) common++;
    for (let i = block.emitted.length - 1; i >= common; i--) put(MARK[block.emitted[i]]);
    block.emitted.length = common;
  };

  /** Closes every mark written in this block (a styled text carries on after the break, opened again). */
  const closeWritten = (to = 0) => {
    const block = top();
    for (let i = block.emitted.length - 1; i >= to; i--) put(MARK[block.emitted[i]]);
    block.emitted.length = to;
  };

  /** What comes after a quote starts on a new line, using the break the text already has if it has one. */
  const startContent = (text: string): string => {
    const block = top();
    if (!block.afterQuote) return text;
    block.afterQuote = false;
    if (text.startsWith('\n')) return text;
    return `\n${text}`;
  };

  const write = (text: string) => {
    if (!text) return;
    const parts = text.split('\n');
    parts.forEach((part, i) => {
      settle();
      if (i > 0) {
        // Inside a quote each line stands alone: a style is closed before the break and opened again after it.
        if (blocks.length > 1) closeWritten();
        put(startContent('\n'));
      }
      if (!part) return;
      sync();
      put(startContent(escapeV2(part)));
    });
  };

  const openQuote = (expandable: boolean) => {
    closeWritten();
    const parent = top();
    if (parent.out && !parent.out.endsWith('\n')) parent.out += '\n';
    // Two quotes in a row would be read as one: a blank line keeps them apart.
    if (parent.afterQuote && parent.out.endsWith('\n')) parent.out += '\n';
    parent.afterQuote = false;
    blocks.push({ out: '', quote: expandable ? 'expandable' : 'plain', emitted: [], afterQuote: false });
  };

  const closeQuote = () => {
    closeWritten();
    const block = blocks.pop()!;
    const lines = block.out.replace(/^\n+|\n+$/g, '').split('\n');
    const expandable = block.quote === 'expandable';
    const quoted = lines.map((line, i) => (expandable && i === 0 ? `**>${line}` : `>${line}`));
    if (expandable) quoted[quoted.length - 1] += '||';
    const parent = top();
    parent.out += quoted.join('\n');
    parent.afterQuote = true;
  };

  const startStyle = (style: Style) => {
    depth[style] = (depth[style] ?? 0) + 1;
    if (depth[style] === 1) stack.push(style);
  };

  const endStyle = (style: Style) => {
    if (!depth[style]) return;
    depth[style]!--;
    if (depth[style] === 0) stack.splice(stack.lastIndexOf(style), 1);
  };

  for (const match of html.matchAll(TOKEN)) {
    const [raw, slash, tagName, attributes] = match;
    if (tagName) {
      const name = tagName.toLowerCase();
      const closes = slash === '/';
      if (code) {
        // Inside code only its own closing tag means anything.
        if (closes && (name === 'code' || name === 'pre')) {
          const fence = code;
          code = null;
          if (codeText.trim()) {
            sync();
            put(startContent(fence === '`' ? `\`${escapeCode(codeText)}\`` : `\`\`\`\n${escapeCode(codeText.replace(/^\n|\n$/g, ''))}\n\`\`\``));
          }
          codeText = '';
        }
        continue;
      }
      if (name === 'span') {
        const spoiler = /class=["']tg-spoiler["']/.test(attributes ?? '');
        if (closes) {
          if (spans.pop()) endStyle('spoiler');
        } else {
          spans.push(spoiler);
          if (spoiler) startStyle('spoiler');
        }
        continue;
      }
      if (name in STYLE_OF) {
        if (closes) endStyle(STYLE_OF[name]);
        else startStyle(STYLE_OF[name]);
        continue;
      }
      if (name === 'code' || name === 'pre') {
        if (!closes) {
          code = name === 'pre' ? '```' : '`';
          codeText = '';
        }
        continue;
      }
      if (name === 'tg-time') {
        if (closes) {
          const link = links.pop();
          if (dates.pop() && link?.url) {
            closeWritten(link.base);
            put(`](${escapeUrl(link.url)})`);
          }
        } else {
          const url = timeUrl(attributes ?? '');
          dates.push(!!url);
          if (url) {
            sync();
            put(startContent('!['));
            links.push({ url, base: top().emitted.length });
          } else links.push({ url: '', base: 0 });
        }
        continue;
      }
      if (name === 'a') {
        if (closes) {
          const link = links.pop();
          if (link?.url) {
            closeWritten(link.base);
            put(`](${escapeUrl(link.url)})`);
          }
        } else {
          const href = /href="([^"]*)"|href='([^']*)'/.exec(attributes ?? '');
          const url = (href?.[1] ?? href?.[2] ?? '').replace(/&amp;/g, '&');
          if (url) {
            sync();
            put(startContent('['));
            links.push({ url, base: top().emitted.length });
          } else links.push({ url: '', base: 0 });
        }
        continue;
      }
      if (name === 'blockquote') {
        if (closes) {
          if (blocks.length > 1) closeQuote();
        } else openQuote(/\sexpandable\b/.test(attributes ?? ''));
        continue;
      }
      continue; // an unknown tag: its text stays
    }

    const literal = ENTITIES[raw] ?? raw;
    if (code) {
      codeText += literal;
      continue;
    }
    write(literal);
  }

  while (blocks.length > 1) closeQuote();
  closeWritten();
  return blocks[0].out.replace(/\n+$/, '');
}
