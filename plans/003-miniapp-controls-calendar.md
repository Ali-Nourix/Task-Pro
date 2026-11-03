# Mini App controls and monthly calendar
Status: execution authorized by current user request; isolated worktree /data/Task-Pro-miniapp.
TOUCHES-DS: miniapp/app.css (existing semantic color tokens and shared select/search controls).
No unresolved owner choice. No claim of a canon pass: unslop MCP/canon unavailable in this session. Local detector findings are unbound, not canon findings.

## Contract and verified findings
|Requirement / source|Status|Shared surface|Evidence|
|Fix search focus and native popup / latest screenshots|accepted|.search, select()|Inset input outline; native status popup; screenshot regression tests|
|Monthly calendar with tasks / user current message|accepted|week(), datePart(), calendar route|Only week strip exists; month grid plus day agenda needed|
|Clarify standalone task selector / current user correction|accepted|add(), select()|Parent selection shown for every new task, cryptic label; default should be plain task, reveal parent only on request|
|Keep task features and FA/EN, light/dark / existing app|inherited|tokens, existing forms and API|Do not remove edit/plan/reminder/subtasks|
|Chat + responsive feedback / previous user message|accepted|new chat route, authenticated API|Conversation only; task mutations remain explicit existing controls|

## Mechanical execution plan
1. Preserve vanilla stack, tokens --bg/--surface/--text/--muted/--line. Replace native select with shared keyboard-accessible inline listbox; Escape closes list first. Search container owns focus ring.
2. Calendar route uses full month for owner's chosen calendar, actual open-task counts, month previous/next/today, selectable day and existing agenda below; Home keeps compact week.
3. New task defaults to independent. Add labelled subtask checkbox; only then reveal parent combobox containing eligible top-level tasks. No native popup. Retain preselected parent from task detail action.
4. One mutation request returns snapshot; saving feedback is immediate, no automatic retry. UI navigation stays available. Chat is owner-authenticated, bounded, plain-text, read-only, provider secrets server-side.
5. Verify actual rendered control styles, keyboard, date boundaries including Jalali new year/leap dates, parent submission, FA/EN narrow screens, dark/light, network failures, no XSS/unauthenticated AI.
6. Render and inspect month, parent open/closed, search focus, status menu, chat waiting/reply/error. Do not claim untested real Telegram/AI success.

Detector triage: raw hex in token declarations is DS definition, not bypass. Tight control padding is internal spacing with >=44px external targets; glyph-only arrow line-height is not body text. Review remaining visual findings against user reference, not blanket automated rewrites.
