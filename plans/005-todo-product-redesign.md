# Task Pro / usable TODO redesign
TOUCHES-DS. Execution in /data/Task-Pro-miniapp, baseline remote c9e233d.

## Decision / evidence contract
| Requirement | Origin | Status | Implementation | Verification |
|---|---|---|---|---|
| A real TODO app, not a calendar demo | Current user message + four references | accepted | Today summary, actionable task rows, compact calendar and useful creation form | FA/EN screenshots + browser tests |
| Peach/teal hierarchy, quiet pastel surfaces, deliberate navigation | User references; exact composition agent proposal | proposed implementation | shared app.css semantic tokens, real status data only | compare home/calendar/create in both themes |
| All statuses, undated tasks, filter persistence | Previous explicit user requirements | protected | existing calendar data/filter functions | browser regressions |
| AI, RTL, owner timezone and Telegram auth | Existing product contracts | protected | existing request/chat/date helpers | full tests |
| Giant olive calendar and repetitive metadata | Current screenshot rejected by user | superseded | compact day cells; one time range per agenda row | dense calendar and long mixed-script text |

Use installed Leonxlnx/taste-skill redesign guide; same vanilla stack. Consolidate CSS at its source instead of accumulating overrides. No new external dependency, decorative imagery, fabricated metrics, avatars or project entities. Keep navigation in a reserved region. Calendar popover must not push the month down. Creation supports atomic existing API plan/priority; deadline editing remains in task details. Preserve keyboard custom pickers. No backend/schema or secret changes. QA all routes plus menus/dialogs/loading/error/empty, 360/390/1100px and FA/EN light/dark. Current task is Taste redesign, not an UNSLOP canon compliance run.

## Execution result
Implemented the shared component roles above, preserved existing API/auth/data contracts. Test fixtures include all statuses, mixed-script titles/tags, 123 tasks on one day and six-week months. Build and all 22 suites passed (2,328 checks); browser suite passed 240 checks. Individually inspected rendered Home FA light/dark + EN desktop, calendar mobile, filter, undated/empty/dense, Tasks, create/edit/parent picker, AI and network-error states. Found and fixed RTL chevron direction and long-sheet header/menu clipping during visual QA. No verified UNSLOP canon pass claimed. Frontend deployment checkpoint is recorded in PR #14.
