// The plugin's side: it uploads the open tasks and is handed Telegram's changes.

import { hasBearer, json } from '../_shared/http.ts';
import { handleSync } from '../_shared/sync.ts';
import { supabaseStore } from '../_shared/supabase-store.ts';
import { telegramApi } from '../_shared/telegram-api.ts';

const MAX_BODY = 5_000_000;

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ ok: false, error: 'POST only' }, 405);
  if (!hasBearer(request, Deno.env.get('SYNC_TOKEN'))) return json({ ok: false, error: 'forbidden' }, 403);
  try {
    const text = await request.text();
    if (text.length > MAX_BODY) return json({ ok: false, error: 'too large' }, 413);
    const response = await handleSync(JSON.parse(text || '{}'), {
      store: supabaseStore(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SECRET_KEY')!),
      tg: telegramApi(Deno.env.get('TELEGRAM_BOT_TOKEN')!),
      now: () => new Date(),
    });
    return json(response);
  } catch (error) {
    console.error('sync failed', error);
    return json({ ok: false, error: String((error as Error).message ?? error) }, 500);
  }
});
