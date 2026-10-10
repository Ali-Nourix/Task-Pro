# TaskPro bot — design brief

## The prompt (goal)

> Make the TaskPro Telegram bot feel like a polished native app, not a chat full of
> text. Every screen must answer «what do I do now?» at a glance, the most common job
> (ticking tasks off) must be one tap, and nothing on a screen may be said twice.
> Respect Telegram: buttons in a row share its width, callback data ≤ 64 bytes, RTL
> Persian with Persian digits, both the classic HTML message and the rich message.
> Keep every existing button and command working, and keep the tests green.

## Principles

1. **One title per screen.** A list whose page holds one section does not repeat it as a heading.
2. **Say only what the context does not.** Under «today», a plan for today shows its hour (🕒), not «📅 today».
3. **One tap for the common job.** «☑️ Quick tick» turns the task buttons into check boxes: a tap ticks the task off and the list stays.
4. **Readable buttons.** A few tasks get a whole row each (long titles); many go two to a row. The separator is «.» — the «·» looked like a Persian zero («۰۱»).
5. **Empty is not content.** The week shows the days that have tasks; the empty ones share one line.
6. **Home is a dashboard.** A greeting for the time of day, what is next, and today's first tasks.

## What changed

| Screen | Before | After |
| --- | --- | --- |
| Today | «📅 امروز — ۱ باز» then «📅 امروز» again; every task «📅 امروز» | Title with the date, no repeated heading, 🕒 hour only |
| Task buttons | «۱ · عنوان…» two to a row, 15 letters | «۱. عنوان» a row each when few (30 letters), two to a row when many |
| Quick tick | — | ☑️ button on every filtered list: ⬜ buttons tick off in place |
| Week | 7 headings, most «(۰)» | Days with tasks only, a summary line; day buttons «•پ ۱۶»; today ==marked== |
| Home | counts only | greeting, «next up» and today's first three tasks |
| Tab bar | ➕ (grey on dark themes) | 📝 |

## Telegram rich messages (Bot API 10.1–10.3), and where they are used

| Feature | Syntax | Used for |
| --- | --- | --- |
| Marked text | `==text==` | next up on home, the overdue heading, today in the week |
| Task lists | `- [ ]` / `- [x]` | every list of tasks, home's today, the assistant's answer |
| Collapsible block | `<details><summary>…</summary>…</details>` | «later» and «no plan» in the full list |
| Footer | `<footer>…</footer>` | sync line, hints, «waiting for Obsidian» |
| Small headings | `###`, `####` | home's today, the assistant's groups |
| Rich draft | `sendRichMessageDraft` + `<tg-thinking>` | «Thinking…», then the answer streamed into the same `draft_id` (no jump) |
| Date entity | `![label](tg://time?unix=…)` | plans and reminders on a task card (countdown) |

Kept for later: in-message buttons (`<tg-button>`, 10.3) for a ✓ beside each task, once
clients show them widely; `is_compact` tables; expandable quotations for long help.

## Taste rules taken from taste-skill (redesign / minimalist), translated to a chat

- Fewer emoji, each one meaning one thing (🕒 hour, 📤 not synced yet), no 🤖 on every line.
- Plain, specific words; no exclamation marks in success messages.
- Progressive disclosure instead of everything at once (details, footers).
- A loading state shaped like the result (the draft the answer grows from) instead of a jump.
- The current place always shown (blue tab, blue filter).
