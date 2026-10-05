// The Telegram webhook: every message and button press the bot gets arrives here.

import { handleUpdate } from '../_shared/bot.ts';
import { cloudflareAi } from '../_shared/ai.ts';
import { equal } from '../_shared/http.ts';
import { ensureSchema } from '../_shared/schema.ts';
import { supabaseStore } from '../_shared/supabase-store.ts';
import { telegramApi } from '../_shared/telegram-api.ts';

/** The assistant, when both Cloudflare keys are set as secrets; the bot works without it. */
function assistant() {
  const accountId = Deno.env.get('CF_ACCOUNT_ID');
  const token = Deno.env.get('CF_API_TOKEN');
  if (!accountId || !token) return undefined;
  return cloudflareAi({ accountId, token, model: Deno.env.get('CF_AI_MODEL') || undefined, speechModel: Deno.env.get('CF_STT_MODEL') || undefined });
}

/**
 * The one Telegram user id the bot answers, when ALLOWED_USER_ID is set. A value that is not a
 * number is kept as NaN, which matches nobody: a typo locks the bot rather than opening it.
 */
function allowedUser(): number | undefined {
  const raw = Deno.env.get('ALLOWED_USER_ID')?.trim();
  return raw ? (/^\d{1,15}$/.test(raw) ? Number(raw) : Number.NaN) : undefined;
}

Deno.serve(async (request) => {
  const secret = Deno.env.get('TELEGRAM_WEBHOOK_SECRET') ?? '';
  // Telegram sends the secret it was given when the webhook was set.
  if (!secret || !equal(request.headers.get('x-telegram-bot-api-secret-token') ?? '', secret)) {
    return new Response('forbidden', { status: 403 });
  }
  try {
    await ensureSchema();
    const update = await request.json();
    await handleUpdate(update, {
      store: supabaseStore(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SECRET_KEY')!),
      tg: telegramApi(Deno.env.get('TELEGRAM_BOT_TOKEN')!),
      pairingCode: Deno.env.get('PAIRING_CODE') ?? '',
      allowedUserId: allowedUser(),
      now: () => new Date(),
      ai: assistant(),
    });
  } catch (error) {
    // Answered all the same: Telegram would send the same update again and again.
    console.error('update failed', error);
  }
  return new Response('ok');
});
