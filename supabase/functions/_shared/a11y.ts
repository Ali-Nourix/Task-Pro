// The accessible display. A screen reader reads an emoji by its name ("red circle",
// "memo"), a bar of ▰▱ as a row of geometric shapes and a line of braille blanks as
// "blank" over and over. This is what takes those out: the words around them already
// say what they stood for, and where they did not (a priority that was only a colour)
// the screens write the word when the display is accessible.

import type { Button, Language, Telegram } from './types.ts';

/** Pictures, flags, keycaps, the joiners and selectors that hold them together, and the shapes the bars are drawn with. */
const DECOR = /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}⃣️‍▰▱⠀]|[↳⬅➡↩⬆]/gu;

/** The comma of the language a screen reader reads in. */
const commaOf = (language: Language): string => (language === 'fa' ? '،' : ',');

/**
 * A line of text (or HTML) without decoration, and without the gap the decoration leaves.
 * The dots that separated a label from its value ("Plan · tomorrow") become a colon, the ones
 * that separated facts ("a • b") a comma: said aloud, they are a pause, not a symbol.
 */
function cleanLine(line: string, language: Language = 'en'): string {
  let first = true;
  return line
    .replace(DECOR, '')
    .replace(/ • (?=[^\s<])/g, `${commaOf(language)} `)
    .replace(/ · (?=[^\s<])/g, () => {
      const at = first ? ': ' : `${commaOf(language)} `;
      first = false;
      return at;
    })
    .replace(/^((?:<[^>]+>)*)[ \t]+/, '$1')
    .replace(/[ \t]+((?:<\/[^>]+>)*)$/, '$1')
    .replace(/[ \t]{2,}/g, ' ');
}

/** A screen's HTML for a screen reader: no emoji, bars or invisible padding; a line that was only decoration is dropped. */
export function accessibleHtml(html: string, language: Language = 'en'): string {
  const lines = html.split('\n').map((line) => {
    const before = line.replace(/<[^>]+>/g, '').trim();
    const cleaned = cleanLine(line, language);
    // A line that held nothing but decoration goes; an empty line that was empty stays.
    return before && !cleaned.replace(/<[^>]+>/g, '').trim() ? null : cleaned;
  });
  return lines.filter((line): line is string => line !== null).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** A button's label without decoration; one that was only decoration keeps it. */
export function accessibleLabel(text: string, language: Language = 'en'): string {
  const cleaned = cleanLine(text, language).trim();
  return cleaned || text;
}

export function accessibleButtons(buttons: Button[][], language: Language = 'en'): Button[][] {
  return buttons.map((row) => row.map((button) => ({ ...button, text: accessibleLabel(button.text, language) })));
}

/** A line over the chat, without decoration. */
export const accessibleToast = (text: string | undefined, language: Language = 'en'): string | undefined => (text ? accessibleLabel(text, language) : text);

/**
 * Telegram as the accessible display sends it: every message and label without decoration, no
 * rich messages. A question that asks for a reply is left as it is, because the bot knows which
 * question an answer belongs to by the picture it starts with.
 */
export function accessibleTelegram(tg: Telegram, language: Language = 'en'): Telegram {
  return {
    send: (chatId, text, buttons, options) =>
      options?.forceReply !== undefined
        ? tg.send(chatId, text, buttons, options)
        : tg.send(chatId, accessibleHtml(text, language), buttons && accessibleButtons(buttons, language), options && { ...options, rich: undefined }),
    edit: (chatId, messageId, text, buttons) => tg.edit(chatId, messageId, accessibleHtml(text, language), buttons && accessibleButtons(buttons, language)),
    answer: (callbackId, text) => tg.answer(callbackId, accessibleToast(text, language)),
    setCommands: (chatId, commands) => tg.setCommands(chatId, commands),
  };
}
