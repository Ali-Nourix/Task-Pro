# 004 — Complete calendar and status filters
Status: executed and deployed in isolated Task-Pro-miniapp worktree. TOUCHES-DS: miniapp/app.css. No unresolved owner choice.
Canon: unavailable; no verified remote UNSLOP canon or canon pass claimed. Local detector plus manual judgement only.

## Contract / evidence
| Requirement | Origin | Role / implementation | Verification |
|---|---|---|---|
| Calendar includes done, not done and other states | Current user instruction | all-status snapshot protocol, store and calendar data source | API/sync/browser tests |
| User chooses visible statuses | Current user instruction | semantic checkbox filter, select all/none, remembered display preference | keyboard focus, counts, reload, empty state |
| Cleaner mobile calendar, preserve existing features | Current user instruction and supplied screenshots | existing vanilla CSS tokens, calendar-specific surface and status roles | FA/EN, light/dark, narrow/wide screenshots |
| Task Pro display name | Latest user instruction | document title and owner-scoped Telegram menu label | bot test, frontend title |
| Existing bot open lists and read-only AI remain | Inherited behavior | openTasks remains separate from allTasks | full regression suite |

## Confirmed findings
1. Open-only plugin snapshot and API cannot supply completed history. Fix at shared protocol, not visual-only fake counts.
2. Calendar counts, agenda, and selected filters must share the same records; preserve actual dates and deduplicate a task matching multiple date roles.
3. The fixed navigation obscured agenda rows. Reserve a separate dock region and scroll the main area, so the navigation never overlays records; verify final row reachability.
4. Checkbox rerender must preserve focused input nodes. Clear selection must be explicit and recoverable.
5. Existing generic colored rows/side accent compete with task status. Calendar now uses neutral bordered rows with explicit status text and semantic indicator; shared CSS source owns variants.

## Execution
1. Add allTasks and paginated storage reads; add optional all-status scope while preserving default legacy open list behavior and authorization.
2. Upload all four note statuses from the plugin with snapshotScope:all. Preserve known closed rows for legacy clients; only authoritative uploads remove missing closed rows.
3. Calendar defaults to all four statuses; add accessible multi-select checkboxes/all/none and undated route. Persist only status preferences, never task/auth/chat data.
4. Match grid counts, markers and agenda to filters. Keep Home/Tasks focused on active tasks. Restore original status on Undo.
5. Update title/menu text to Task Pro, docs and tests.
6. Run build/full regressions/browser cases; inspect actual screenshots. Do not claim an impossible absence of all bugs or recovery of deleted historical records. Existing notes require new plugin sync to populate closed history.

## Verification outcome
Requirement fidelity: all states and selectable filters implemented; historical rows need the new plugin sync. DS consumption: shared CSS variants/tokens used; fixed conflicting old calendar corner rules and dock overlay at source. Runtime: build, 22 suites/2,328 checks, 207 browser checks passed. Visual comparison: individually inspected FA dark calendar/filter/undated/home/status/chat, EN light desktop/calendar/parent picker and dense six-row mobile month; no dock overlap in the reserved scroll layout. Remote canon unavailable: no canon compliance pass is claimed. Source publication commit recorded in plans/README.md.
