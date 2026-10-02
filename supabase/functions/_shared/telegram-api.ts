// Telegram's HTTP API, for the few calls the bot makes.

import type { Button, Telegram } from './types.ts';

export function telegramApi(token: string): Telegram {
  const call = async (method: string, body: Record<string, unknown>) => {
    const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`Telegram ${method}: ${response.status} ${(await response.text()).slice(0, 200)}`);
  };
  return {
    async send(chatId: number, text: string, buttons?: Button[][]) {
      const body: Record<string, unknown> = { chat_id: chatId, text, disable_web_page_preview: true };
      if (buttons?.length) body.reply_markup = { inline_keyboard: buttons.map((row) => row.map((b) => ({ text: b.text, callback_data: b.data }))) };
      await call('sendMessage', body);
    },
    async answer(callbackId: string, text?: string) {
      await call('answerCallbackQuery', { callback_query_id: callbackId, ...(text ? { text } : {}) }).catch(() => undefined);
    },
    async clearButtons(chatId: number, messageId: number) {
      await call('editMessageReplyMarkup', { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [] } }).catch(() => undefined);
    },
  };
}
