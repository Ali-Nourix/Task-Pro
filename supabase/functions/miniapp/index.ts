import { cloudflareAi } from '../_shared/ai.ts';
import { handleMiniApp } from '../_shared/miniapp.ts';
import { MINI_APP_URL } from '../_shared/miniapp-config.ts';
import { supabaseStore } from '../_shared/supabase-store.ts';
Deno.serve(request => {
  const raw=Deno.env.get('ALLOWED_USER_ID')?.trim();
  const accountId=Deno.env.get('CF_ACCOUNT_ID'),aiToken=Deno.env.get('CF_API_TOKEN');
  return handleMiniApp(request, {
    ai:accountId&&aiToken?cloudflareAi({accountId,token:aiToken,model:Deno.env.get('CF_AI_MODEL')||undefined}):undefined,
    store:supabaseStore(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')??Deno.env.get('SUPABASE_SECRET_KEY')!),
    token:Deno.env.get('TELEGRAM_BOT_TOKEN')??'',
    allowedUserId:raw?(/^\d{1,15}$/.test(raw)?Number(raw):Number.NaN):undefined,
    origin:MINI_APP_URL ? new URL(MINI_APP_URL).origin : '',now:()=>new Date(),
  });
});
