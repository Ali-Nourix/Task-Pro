// Telegram's HTTP API, for the few calls the bot makes.

import type { Button, BotCommand, Telegram } from './types.ts';

const PARSE_ERROR = /can't parse entities|unsupported start tag|can't find end tag/i;

/** Message text as plain words, for the rare case Telegram will not take the markup. */
function plain(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function keyboard(buttons: Button[][], styled: boolean) {
  return {
    inline_keyboard: buttons.map((row) =>
      row.map((b) => ({ text: b.text, callback_data: b.data, ...(styled && b.style ? { style: b.style } : {}) }))
    ),
  };
}

export function telegramApi(token: string): Telegram {
  const call = async (method: string, body: Record<string, unknown>) => {
    const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`Telegram ${method}: ${response.status} ${(await response.text()).slice(0, 200)}`);
  };

  /** Sends or edits a message, taking a step back when Telegram refuses part of it: the colours, then the markup. */
  const deliver = async (method: string, body: Record<string, unknown>, text: string, buttons?: Button[][]) => {
    const attempt = (html: boolean, styled: boolean) =>
      call(method, {
        ...body,
        text: html ? text : plain(text),
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

  return {
    async send(chatId: number, text: string, buttons?: Button[][], options?: { forceReply?: string }) {
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
      await deliver('sendMessage', { chat_id: chatId }, text, buttons);
    },
    async edit(chatId: number, messageId: number, text: string, buttons?: Button[][]) {
      await deliver('editMessageText', { chat_id: chatId, message_id: messageId }, text, buttons ?? []);
    },
    async answer(callbackId: string, text?: string) {
      await call('answerCallbackQuery', { callback_query_id: callbackId, ...(text ? { text: text.slice(0, 190) } : {}) }).catch(() => undefined);
    },
    async setCommands(chatId: number, commands: BotCommand[]) {
      await call('setMyCommands', { commands, scope: { type: 'chat', chat_id: chatId } }).catch(() => undefined);
    },
  };
}
