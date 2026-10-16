# Note embeds and Pomodoro

## Live views inside a note

Add a fenced `taskpro` code block. It renders in **Reading view and Live Preview**
(when the cursor is outside the block); Source mode keeps the text as code.

````markdown
```taskpro
view: table
scope: all
```

```taskpro
view: calendar
calendar-view: week
calendar-system: jalali
scope: all
```
````

Options (one `key: value` per line, blank lines and `#` comments allowed):

| Key | Values | Default |
| --- | --- | --- |
| `view` | `table`, `calendar` | `table` |
| `scope` | `target`, `all` | `target` (configured TaskPro target folder) |
| `calendar-view` | `month`, `week`, `day`, `agenda` | `month` |
| `calendar-system` | `gregorian`, `jalali` | follows TaskPro settings |

These are the existing interactive views, not copied tasks or a second index.
Editing a task changes its source note and updates the other views. Each embed
has its own layout/filters and shares the plugin's language, tags, calendars and
task store. Toolbar changes and the last visited calendar date are saved separately
for each note block in TaskPro's plugin data. They survive Markdown rerenders and
reopening Obsidian without overwriting the workspace board preferences or another
embed. Editing the code block's options resets that block to the new initial
configuration. Multiple blocks may be used in one note.
Unknown, duplicate or invalid options show an error rather than silently falling
back. The view releases subscriptions and resize observers when unloaded.

## Per-task Pomodoro

Use the task's focus-timer capability (or click an existing timer chip → Change
duration). In the timer settings, enable **Pomodoro** and choose:

- Focus duration (default 25 minutes).
- Short break (5 minutes), long break (15 minutes).
- Long break every N focus rounds (4).
- Target focus rounds for this task (4).
- Auto-start next phase (off by default).

Only a completed **focus** phase increments completed rounds. Intermediate focus
phases lead to a short or long break; a break leads to the next focus phase.
Reaching the target completes the timer without adding an unnecessary final
break. The chip, timer menu and status-bar text identify the current phase and
completed/target rounds. The configured timer sound and notification preferences
apply at phase boundaries too.

When auto-start is off, the next phase is ready; click Start to begin it. When it
is on, the next phase starts when completion is processed. Pause/resume and
adding five/fifteen minutes apply to the current phase only. Reset resets the
whole cycle (focus phase, zero completed rounds, paused). Starting a completed
Pomodoro starts a new cycle. Changing cycle settings starts a fresh paused cycle;
saving unchanged settings keeps the current phase, elapsed time and running state.
Existing countdown-only timers remain countdowns until Pomodoro is enabled.

State is persisted with the existing per-task timers and follows a task moved to
another note. After reopening Obsidian, an expired phase is completed **once**;
missed focus sessions are never invented. A following auto-start phase begins at
reconciliation, not retroactively. Notifications cannot be delivered by a closed
Obsidian process. No Google Calendar integration is included.

## راهنمای فارسی

برای نمایش جدول یا تقویم داخل نوت، کدبلاک‌های بالا را قرار بده. نمایش در حالت
Reading و Live Preview است؛ در حالت Source، متن کد دیده می‌شود. `scope: all`
یعنی تمام Vault و `scope: target` یعنی پوشهٔ هدف تنظیم‌شده در TaskPro.
`calendar-system: jalali` تقویم شمسی را انتخاب می‌کند.

تسک‌ها کپی نمی‌شوند؛ ویرایش از داخل نمایش، همان تسک را در نوت اصلی تغییر می‌دهد.
چند نمایش هم‌زمان می‌توانند باز باشند. نمای انتخاب‌شده، فیلترها و آخرین تاریخ
تقویم برای هر بلاک جداگانه ذخیره می‌شوند و پس از بازسازی نوت یا بستن و بازکردن
Obsidian برمی‌گردند؛ تنظیمات نمای اصلی یا بلاک‌های دیگر تغییر نمی‌کنند. ویرایش
گزینه‌های خود کدبلاک، وضعیت آن بلاک را به تنظیمات اولیهٔ جدید بازمی‌گرداند.

برای پومودورو، از تنظیمات تایمر هر تسک «فعال‌سازی پومودورو» را انتخاب کن.
مدت تمرکز، استراحت کوتاه/بلند، فاصلهٔ استراحت بلند، تعداد دور هدف و شروع خودکار
قابل تنظیم‌اند. شمارنده فقط با پایان مرحلهٔ تمرکز زیاد می‌شود. پس از رسیدن به
هدف، چرخه تمام می‌شود. بازنشانی، کل چرخه و شمارنده را صفر می‌کند.

اگر شروع خودکار خاموش باشد، مرحلهٔ بعد منتظر دکمهٔ شروع می‌ماند. اگر Obsidian
بسته باشد، پس از بازشدن فقط مرحلهٔ منقضی‌شده محاسبه می‌شود؛ دورهای انجام‌نشده
به‌صورت ساختگی ثبت نمی‌شوند. تایمرهای قدیمی بدون تغییر به کارشان ادامه می‌دهند.

## Verification

- `npm run build`: TypeScript checks and production bundle.
- `npm test`: existing checks plus state-machine, persistence and embed-isolation checks.
- `PW_CHROMIUM=/path/to/chromium node test/note-embed-pomodoro-ui.mjs`: real
  desktop/mobile Chromium checks, including Persian labels and editor controls.
- `npm run test:ui`: includes the new checks alongside the existing UI suite.

The browser harness uses the real plugin renderers with a stub Obsidian host.
It is not a replacement for testing a real desktop/mobile Obsidian vault.
