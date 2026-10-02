// Telegram's HTTP API, for the few calls the bot makes.

import type { BotCommand, Button, Rich, Telegram } from './types.ts';

const PARSE_ERROR = /can't parse entities|unsupported start tag|can't find end tag/i;
/** Telegram does not know the rich methods (an older Bot API server): stop trying for a while. */
const NO_RICH = /method not found|unknown method|not implemented|404/i;
const RICH_PAUSE_MS = 10 * 60_000;

let richPausedUntil = 0;

/** Message text as plain words, for the rare case Telegram will not take the markup. */
function plain(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/**
 * A message is as wide as its longest line, and its buttons are as wide as the
 * message: a short text leaves a narrow bubble with cramped buttons hanging under
 * it. A last line of invisible characters (braille blanks, which Telegram keeps)
 * holds the bubble at a width the buttons look right in. Only short texts get it.
 */
const MIN_WIDTH = 30;
const WIDENER = '\u2800'.repeat(MIN_WIDTH);

export function widen(html: string, buttons?: Button[][]): string {
  if (!buttons?.length) return html;
  const longest = Math.max(...plain(html).split('\n').map((line) => Array.from(line).length));
  return longest >= MIN_WIDTH ? html : `${html}\n${WIDENER}`;
}

function keyboard(buttons: Button[][], styled: boolean) {
  return {
    inline_keyboard: buttons.map((row) =>
      row.map((b) => ({ text: b.text, callback_data: b.data, ...(styled && b.style ? { style: b.style } : {}) }))
    ),
  };
}

const richBody = (rich: Rich) => ({ markdown: rich.markdown, is_rtl: rich.rtl, skip_entity_detection: true });

export function telegramApi(token: string): Telegram {
  const call = async (method: string, body: Record<string, unknown>) => {
    const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`Telegram ${method}: ${response.status} ${(await response.text()).slice(0, 200)}`);
  };

  /** One try as a rich message, with the coloured buttons and without them. */
  const rich = async (method: string, body: Record<string, unknown>, content: Rich, buttons?: Button[][]) => {
    const hasStyle = !!buttons?.some((row) => row.some((b) => b.style));
    const attempt = (styled: boolean) =>
      call(method, { ...body, rich_message: richBody(content), ...(buttons?.length ? { reply_markup: keyboard(buttons, styled) } : {}) });
    try {
      await attempt(true);
    } catch (error) {
      if (/not modified/i.test(String(error))) return;
      if (hasStyle && String(error).includes(': 400')) return attempt(false);
      throw error;
    }
  };

  /** Sends or edits a classic message, taking a step back when Telegram refuses part of it: the colours, then the markup. */
  const deliver = async (method: string, body: Record<string, unknown>, text: string, buttons?: Button[][]) => {
    const attempt = (html: boolean, styled: boolean) =>
      call(method, {
        ...body,
        text: html ? widen(text, buttons) : plain(text),
        ...(html ? { parse_mode: 'HTML' } : {}),
        link_preview_options: { is_disabled: true },
        ...(buttons?.length ? { reply_markup: keyboard(buttons, styled) } : {}),
      });
    const hasStyle = !!buttons?.some((row) => row.some((b) => b.style));
    try {
      await attempt(true, true);
    } catch (error) {
      const message = String(error);
      if (/not modified/i.test(message)) return;
      if (PARSE_ERROR.test(message)) return attempt(false, true);
      if (hasStyle && message.includes(': 400')) return attempt(true, false);
      throw error;
    }
  };

  /** The ladder: rich if asked and not paused, else (or if Telegram says no) the classic message. */
  const show = async (richMethod: string, method: string, body: Record<string, unknown>, text: string, buttons?: Button[][], content?: Rich) => {
    if (content && Date.now() >= richPausedUntil) {
      try {
        return await rich(richMethod, body, content, buttons);
      } catch (error) {
        console.error('rich message refused, sending the classic one', error);
        if (NO_RICH.test(String(error))) richPausedUntil = Date.now() + RICH_PAUSE_MS;
      }
    }
    return deliver(method, body, text, buttons);
  };

  return {
    async send(chatId: number, text: string, buttons?: Button[][], options?: { forceReply?: string; rich?: Rich }) {
      if (options?.forceReply !== undefined) {
        const body = { chat_id: chatId, reply_markup: { force_reply: true, input_field_placeholder: options.forceReply.slice(0, 64) } };
        try {
          await call('sendMessage', { ...body, text, parse_mode: 'HTML', link_preview_options: { is_disabled: true } });
        } catch (error) {
          if (!PARSE_ERROR.test(String(error))) throw error;
          await call('sendMessage', { ...body, text: plain(text) });
        }
        return;
      }
      await show('sendRichMessage', 'sendMessage', { chat_id: chatId }, text, buttons, options?.rich);
    },
    async edit(chatId: number, messageId: number, text: string, buttons?: Button[][], content?: Rich) {
      await show('editMessageText', 'editMessageText', { chat_id: chatId, message_id: messageId }, text, buttons ?? [], content);
    },
    async answer(callbackId: string, text?: string) {
      await call('answerCallbackQuery', { callback_query_id: callbackId, ...(text ? { text: text.slice(0, 190) } : {}) }).catch(() => undefined);
    },
    async setCommands(chatId: number, commands: BotCommand[]) {
      await call('setMyCommands', { commands, scope: { type: 'chat', chat_id: chatId } }).catch(() => undefined);
    },
  };
}
