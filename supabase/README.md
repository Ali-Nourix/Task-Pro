# ربات تلگرام TaskPro

با این ربات از تلگرام تسک می‌سازی، یادآوری می‌گیری و کارها را تیک می‌زنی؛
حتی وقتی کامپیوترت خاموش است. وقتی Obsidian را روشن کنی، پلاگین تغییرها را در
یادداشت‌هایت اعمال می‌کند و فهرست تسک‌ها را برای ربات به‌روز می‌کند.

```
تلگرام ──► تابع telegram ──► Supabase (tasks, commands) ◄── تابع sync ◄── پلاگین Obsidian
                                      ▲
                          تابع tick (هر دقیقه) ──► یادآوری در تلگرام
```

- **یادداشت‌ها مرجع می‌مانند.** Supabase فقط یک عکس از تسک‌های باز و یک صف از
  تغییرهای تلگرام را نگه می‌دارد.
- **کسی جز تو** به داده نمی‌رسد: جدول‌ها قفل‌اند (RLS روشن و بدون policy)، فقط
  توابع با کلید سرویس به آن‌ها دست می‌زنند؛ ربات فقط به chat خودت جواب می‌دهد؛
  پلاگین با یک توکن جدا وارد می‌شود.

## راه‌اندازی (یک بار، حدود ۱۰ دقیقه)

### ۱. ساختن ربات
در تلگرام به [@BotFather](https://t.me/BotFather) پیام بده: `/newbot`، یک نام و یک
username بده. توکنی که می‌دهد (`123456:ABC...`) را نگه دار.

### ۲. سه رمز بساز
هر کدام یک رشتهٔ تصادفی و بلند باشد (فقط حرف و عدد):

```bash
openssl rand -hex 24   # سه بار؛ برای PAIRING_CODE ،SYNC_TOKEN ،TELEGRAM_WEBHOOK_SECRET
```

- `PAIRING_CODE` — با `/start <کد>` ربات را به chat خودت وصل می‌کنی.
- `SYNC_TOKEN` — پلاگین و زمان‌بند با این وارد می‌شوند.
- `TELEGRAM_WEBHOOK_SECRET` — تلگرام با این ثابت می‌کند پیام از اوست.

### ۳. وصل کردن Supabase CLI

```bash
npm i -g supabase          # یا هر بار با npx supabase ...
supabase login
supabase link --project-ref YOUR_PROJECT_REF
```

### ۴. جدول‌ها و توابع

```bash
supabase db push                                  # جدول‌ها (supabase/migrations)
supabase secrets set \
  TELEGRAM_BOT_TOKEN='توکن-بات-فادر' \
  TELEGRAM_WEBHOOK_SECRET='...' \
  PAIRING_CODE='...' \
  SYNC_TOKEN='...'
supabase functions deploy telegram sync tick --no-verify-jwt
```

(`SUPABASE_URL` و کلید سرویس را خود Supabase به توابع می‌دهد.)

### ۵. وصل کردن وب‌هوک تلگرام

```bash
curl -sS "https://api.telegram.org/bot<TOKEN>/setWebhook" \
  -d "url=https://YOUR_PROJECT_REF.supabase.co/functions/v1/telegram" \
  -d "secret_token=<TELEGRAM_WEBHOOK_SECRET>"
```

باید `"ok":true` ببینی.

### ۶. زمان‌بند یادآوری (هر دقیقه)
در Supabase → SQL Editor این را اجرا کن (مقدار `SYNC_TOKEN` را بگذار):

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

select cron.schedule('taskpro-tick', '* * * * *', $$
  select net.http_post(
    url     := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/tick',
    headers := jsonb_build_object('Authorization', 'Bearer SYNC_TOKEN_را_اینجا_بگذار', 'Content-Type', 'application/json'),
    body    := '{}'::jsonb
  );
$$);
```

### ۷. وصل شدن
- در تلگرام به ربات خودت بنویس: `/start <PAIRING_CODE>`
- در Obsidian: **Settings → TaskPro → Telegram** : آدرس پروژه
  (`https://YOUR_PROJECT_REF.supabase.co`) و `SYNC_TOKEN` را بگذار و
  «Sync now» را بزن.

## استفاده

هر چیزی که بنویسی تسک می‌شود. فارسی و انگلیسی:

| بنویس | چه می‌شود |
|---|---|
| `خرید نان فردا ساعت ۹ #خانه !بالا` | تسک، برنامه فردا ۹، برچسب، اولویت |
| `یادم بنداز ۲۰ دقیقه دیگه چایی` | یادآوری ۲۰ دقیقه بعد |
| `یادآوری جمعه ۸ داروها` | یادآوری جمعه ساعت ۸ |
| `گزارش مهلت شنبه` | مهلت (deadline) |
| `call vet tomorrow 9:30-10 #health` | برنامه با بازه |
| `/today` `/list` | فهرست امروز، همهٔ باز |
| `/done ۱۲` | انجام شد |
| `/remind ۱۲ فردا ۸` · `/remind ۱۲ off` | یادآوری |
| `/plan ۱۲ شنبه ۹-۱۰` | برنامه |
| `/del ۱۲` | حذف (با تأیید) |
| `/status` | وضعیت همگام‌سازی |
| `/lang fa\|en` `/tz Asia/Tehran` `/cal jalali\|gregorian` `/lead ۱۰` | تنظیمات |

وقتی یادآوری برسد، پیام با دکمه‌های «انجام شد» و «۱۰ دقیقه بعد / ۱ ساعت / فردا ۹» می‌آید.

## آزمایش

```bash
node test/telegram-bot.mjs      # منطق ربات؛ جزو npm test است
npx tsc -p supabase/tsconfig.json
```

آزمایش روی دیتابیس واقعی (Postgres + PostgREST محلی) در
`test/telegram-supabase.mjs` است؛ بالای فایل نوشته چه چیزهایی لازم است.
