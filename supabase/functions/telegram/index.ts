// The Telegram webhook: every message and button press the bot gets arrives here.

import { handleUpdate } from '../_shared/bot.ts';
import { equal } from '../_shared/http.ts';
import { ensureSchema } from '../_shared/schema.ts';
import { supabaseStore } from '../_shared/supabase-store.ts';
import { telegramApi } from '../_shared/telegram-api.ts';

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
      now: () => new Date(),
    });
  } catch (error) {
    // Answered all the same: Telegram would send the same update again and again.
    console.error('update failed', error);
  }
  return new Response('ok');
});
