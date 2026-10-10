// Telegram's HTTP API, for the few calls the bot makes.

import { htmlToMarkdownV2 } from './markdownv2.ts';
import type { BotCommand, Button, Rich, Telegram } from './types.ts';

const PARSE_ERROR = /can't parse entities|unsupported start tag|can't find end tag|can't parse message/i;
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
 * What a plain draft says for a «Thinking…» rich HTML: nothing when only the placeholder is
 * wanted (Telegram then shows its own, in the reader's language), or the paragraph with the
 * placeholder's words under it (what a voice message said, and that the bot is thinking).
 */
function draftText(html: string): string {
  const label = plain(/<tg-thinking>([\s\S]*?)<\/tg-thinking>/.exec(html)?.[1] ?? '').trim();
  const note = plain(html.replace(/<tg-thinking>[\s\S]*?<\/tg-thinking>/, '')).trim();
  return note ? `${note}\n\n${label}`.trim() : '';
}

/** `styled`: with the colours and disabled buttons the newest Bot API has; without, plain buttons every client knows. */
function keyboard(buttons: Button[][], styled: boolean) {
  return {
    inline_keyboard: buttons.map((row) =>
      row.map((b) =>
        styled && b.disabled
          ? { text: b.text, disabled: {} }
          : { text: b.text, callback_data: b.data, ...(styled && b.style ? { style: b.style } : {}) }
      )
    ),
  };
}

const needsNewest = (buttons?: Button[][]): boolean => !!buttons?.some((row) => row.some((b) => b.style || b.disabled));

const richBody = (rich: Rich) => ({ markdown: rich.markdown, is_rtl: rich.rtl, skip_entity_detection: true });

/**
 * `thinking`: how «Thinking…» is shown while the assistant works. `text` (the default) is Telegram's
 * own placeholder, `rich` is a rich draft, `off` is only «typing…».
 */
export function telegramApi(token: string, options: { thinking?: 'text' | 'rich' | 'off' } = {}): Telegram {
  const thinkingStyle = options.thinking ?? 'text';
  const call = async (method: string, body: Record<string, unknown>) => {
    const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`Telegram ${method}: ${response.status} ${(await response.text()).slice(0, 200)}`);
  };

  /**
   * The «Thinking…» draft still on screen in a chat. The answer is streamed into it first (the
   * same draft id: Telegram animates the change) and then sent: the bubble grows into the answer
   * where it stands instead of vanishing and a new one pushing the chat up.
   */
  const drafts = new Map<number, { id: number; at: number }>();
  const DRAFT_LIFE_MS = 28_000;

  /** One try as a rich message, with the coloured buttons and without them. */
  const rich = async (method: string, body: Record<string, unknown>, content: Rich, buttons?: Button[][]) => {
    const hasStyle = needsNewest(buttons);
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

  /**
   * Sends or edits a classic message, taking a step back when Telegram refuses part of it:
   * MarkdownV2 first, then the same text as HTML, then plain words; and, at each, the
   * coloured buttons before the buttons themselves.
   */
  const deliver = async (method: string, body: Record<string, unknown>, text: string, buttons?: Button[][], markup?: Record<string, unknown>) => {
    const hasStyle = needsNewest(buttons);
    const attempt = (mode: 'MarkdownV2' | 'HTML' | 'plain', styled: boolean) =>
      call(method, {
        ...body,
        text: mode === 'MarkdownV2' ? htmlToMarkdownV2(text) : mode === 'HTML' ? text : plain(text),
        ...(mode === 'plain' ? {} : { parse_mode: mode }),
        link_preview_options: { is_disabled: true },
        ...(markup ? { reply_markup: markup } : buttons?.length ? { reply_markup: keyboard(buttons, styled) } : {}),
      });
    const modes = ['MarkdownV2', 'HTML', 'plain'] as const;
    for (let i = 0; i < modes.length; i++) {
      try {
        await attempt(modes[i], true);
        return;
      } catch (error) {
        const message = String(error);
        if (/not modified/i.test(message)) return;
        if (PARSE_ERROR.test(message) && i < modes.length - 1) {
          console.error("[redacted] refused, trying [redacted]");
          continue;
        }
        if (hasStyle && !markup && message.includes(': 400')) return attempt(modes[i], false);
        throw error;
      }
    }
  };

  /** The ladder: rich if asked and not paused, else (or if Telegram says no) the classic message. */
  const show = async (richMethod: string, method: string, body: Record<string, unknown>, text: string, buttons?: Button[][], content?: Rich) => {
    if (content && Date.now() >= richPausedUntil) {
      try {
        return await rich(richMethod, body, content, buttons);
      } catch (error) {
        console.error("rich message refused, sending the classic one");
        if (NO_RICH.test(String(error))) richPausedUntil = Date.now() + RICH_PAUSE_MS;
      }
    }
    return deliver(method, body, text, buttons);
  };

  return {
    async send(chatId: number, text: string, buttons?: Button[][], options?: { forceReply?: string; rich?: Rich; replyTo?: number }) {
      if (options?.forceReply !== undefined) {
        await deliver('sendMessage', { chat_id: chatId }, text, undefined, { force_reply: true, input_field_placeholder: options.forceReply.slice(0, 64) });
        return;
      }
      // An answer to a message hangs from it, so with several in a row each finds its own.
      const reply = options?.replyTo ? { reply_parameters: { message_id: options.replyTo, allow_sending_without_reply: true } } : {};
      const draft = drafts.get(chatId);
      drafts.delete(chatId);
      if (draft && options?.rich && Date.now() - draft.at < DRAFT_LIFE_MS && Date.now() >= richPausedUntil) {
        await call('sendRichMessageDraft', { chat_id: chatId, draft_id: draft.id, rich_message: richBody(options.rich) }).catch(() => undefined);
      }
      await show('sendRichMessage', 'sendMessage', { chat_id: chatId, ...reply }, text, buttons, options?.rich);
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
    async typing(chatId: number) {
      await call('sendChatAction', { chat_id: chatId, action: 'typing' }).catch(() => undefined);
    },
    async thinking(chatId: number, html: string) {
      const typing = () => call('sendChatAction', { chat_id: chatId, action: 'typing' }).catch(() => undefined);
      if (thinkingStyle === 'off') return typing();
      // A draft lives for thirty seconds or until the bot sends a message, whichever is first.
      const draft_id = 1 + Math.floor(Math.random() * 2_000_000_000);
      try {
        if (thinkingStyle === 'rich') {
          await call('sendRichMessageDraft', { chat_id: chatId, draft_id, rich_message: { html } });
          drafts.set(chatId, { id: draft_id, at: Date.now() });
        }
        else await call('sendMessageDraft', { chat_id: chatId, draft_id, text: draftText(html) });
      } catch {
        await typing();
      }
    },
    async react(chatId: number, messageId: number, emoji: string | null) {
      await call('setMessageReaction', { chat_id: chatId, message_id: messageId, reaction: emoji ? [{ type: 'emoji', emoji }] : [] }).catch(() => undefined);
    },
    async download(fileId: string) {
      const info = await fetch(`https://api.telegram.org/bot${token}/getFile`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ file_id: fileId }),
      });
      const path = ((await info.json()) as { result?: { file_path?: string } }).result?.file_path;
      if (!info.ok || !path) throw new Error(`Telegram getFile: ${info.status}`);
      const file = await fetch(`https://api.telegram.org/file/bot${token}/${path}`);
      if (!file.ok) throw new Error(`Telegram file: ${file.status}`);
      return new Uint8Array(await file.arrayBuffer());
    },
  };
}
