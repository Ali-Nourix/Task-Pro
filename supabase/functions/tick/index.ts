// Run every minute by the database's scheduler: announces the reminders that are due.

import { hasBearer, json } from '../_shared/http.ts';
import { runTick } from '../_shared/tick.ts';
import { supabaseStore } from '../_shared/supabase-store.ts';
import { telegramApi } from '../_shared/telegram-api.ts';

Deno.serve(async (request) => {
  if (!hasBearer(request, Deno.env.get('SYNC_TOKEN'))) return json({ ok: false, error: 'forbidden' }, 403);
  try {
    const sent = await runTick({
      store: supabaseStore(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SECRET_KEY')!),
      tg: telegramApi(Deno.env.get('TELEGRAM_BOT_TOKEN')!),
      now: () => new Date(),
    });
    return json({ ok: true, sent });
  } catch (error) {
    console.error('tick failed', error);
    return json({ ok: false, error: String((error as Error).message ?? error) }, 500);
  }
});
