# Layout and Persian interface refinement

## Scope and sources

This follow-up refines the existing TaskPro mini app on `design/miniapp-production-ui` (PR #16). It does not migrate the framework, change task dates or statuses, replace the Telegram/Supabase backend, or edit user-written titles, tags or AI responses.

Skills installed and applied in the project workspace:
- `npx impeccable install`: Impeccable 4.8.0, engine 0.1.18; Operate, layout, clarify and craft-floor guidance.
- `npx skills@latest add emilkowalski/skills`: `emil-design-eng` and `mobile-native`.
- `https://github.com/ali2000hos/persian-writing`: full skill plus writing style, orthography, RTL HTML and conservative cleanup guidance.

The source files are the incumbent visual authority. This is a scoped refinement, not a new brand or visual-world replacement. No subagents were used.

## Before / After review

| Before | After | Why |
| --- | --- | --- |
| Large summary card before the task list | Compact, interactive summary row | The daily work is visible sooner on mobile; counts stay available. |
| Date above the main heading | Heading first, supporting date below | The screen's purpose leads the reading order. |
| Overdue notice with a thick accent edge | Quiet notice with an explicit “مشاهده” action | It reads as an actionable review, not a decorative alert. |
| Hover rules apply to every device | Hover rules require hover capability and a fine pointer | Touch devices must not retain a simulated hover state. |
| No explicit press feedback | Short press feedback, excluding keyboard focus and reduced-motion transforms | Feedback without slowing repeated navigation. |
| Fixed pixel type scale | rem-based type scale | Browser text-size preferences are respected. |
| Centered mobile edit dialog | Bottom-aligned mobile sheet with safe-area padding | Content remains scrollable in the available viewport. |
| Generic “no tasks” message | Separate search/day/overdue/open-list/status-filter/undated messages | An empty filter does not imply that every task is complete. |
| Mixed Persian registers and technical snapshot jargon | Consistent plain written Persian and actionable recovery | The user can understand what happened and what to do. |
| Latin display counts and mixed-direction time ranges | Persian display digits and isolated LTR time/code/name runs | Readable RTL without mutating stored values. |

## Editorial policy

The interface uses clear, respectful written Persian, not bureaucratic phrasing or slang. Existing standard labels such as «بستن»، «ذخیره» and «تقویم» remain where they are already clear. All Persian interface literals were reviewed, including accessible names, forms, loading, errors, empty states, sync feedback and assistant/privacy copy.

Terminology:
- Task: «تسک»; parent: «تسک اصلی»; subtask: «زیرتسک».
- Schedule: «زمان‌بندی»; deadline: «سررسید»; reminder: «یادآوری».
- Undated: «بدون تاریخ», meaning no planned date, deadline or reminder.
- Sync time: «آخرین دریافت از Obsidian», a snapshot timestamp, not an online indicator.
- Pending: «در انتظار ارسال به Obsidian», only when the server reports a pending record.

Examples:
- «تسک دیگر در عکس فعلی موجود نیست؛ تازه‌سازی کن.» → «این تسک دیگر در فهرست نیست. فهرست را به‌روز کنید.»
- «چه کاری می‌خواهی انجام بدهی؟» → «مثلاً بازبینی گزارش هفتگی».
- «با هم مرتبش کنیم.» → «برای برنامه‌ریزی کمک بگیرید».

Persian numbers apply only to display. Task IDs, API dates/times, form values, URLs, repetition codes (`1d`, `2w`, `1m`), and user-written content stay unchanged. Latin fragments in system copy use bdi elements created through DOM APIs, not HTML interpolation.

## Verification

- 42 Chromium interaction/regression checks passed on the built/minified app with synthetic fixtures.
- Covers normal flows plus search/empty states, long Persian and mixed-script content, text scaling at 200%, HTML-like user text, numeric display, English/LTR, keyboard Escape, invalid time ranges, retained drafts, and exact ASCII API date/time/title values.
- Widths: 360, 390, 768 and 1440. Representative mobile/desktop, calendar, sheet, error, assistant, empty, long-content, zoom and dark-mode screenshots were visually inspected.
- Three Worker checks: output matches dist.html, HEAD has no body, POST returns 405.
- Impeccable mechanical detector: no remaining findings after removing an obsolete overridden accent border.
- Persian cleanup and fa_lint: no remaining literal orthography changes or flagged issues. Prose was reviewed manually as well; the linter is not a substitute for editorial judgment.
- The existing security headers and Telegram authorization contract are unchanged. Synthetic auth/data hooks are absent from the production build.

Real hardware limitation: sticky hover, software keyboard resizing and safe-area behavior were addressed in code, but cannot be certified from desktop Chromium emulation. The real Telegram WebView on the user's phone remains the device check.

Pre-refinement rollback version: `700ef10f-8008-425e-9d86-6de80f85bbc4`. No Supabase deploy or database writes are needed for this UI-only release.
