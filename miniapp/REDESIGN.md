# Daily folio redesign · PR #16

The user rejected the achromatic ledger and requested a real visual replacement using the supplied skill repositories and successful products. This supersedes the earlier visual direction in REFINEMENT.md; the Persian editorial policy and all backend contracts are retained.

## Repository workflows actually used
- Taste: read the skill and app-screen workflow; draw --app --kind workspace --options 3. Chose editorial-greeting (seed1935848389), explicitly rejecting achromatic-ledger for this brief. Kept the embedded Persian font, not a Latin-only recommendation. Full output recorded locally in references/taste-direction.md.
- UI UX Pro Max: ran the design-system search for “personal productivity planner mobile”. Flat app and teal focus recommendations fit. Rejected its marketing landing sequence, English-only typography and scroll reveals as inapplicable to an operated Persian app.
- Impeccable: loaded context, new-work, Operate, bolder and craft-floor. Wrote PRODUCT.md and replacement DESIGN.md. Mechanical detector returned [].
- Emil: implemented prompt controls, 120ms press feedback, capability-based hover, reduced-motion, 16px inputs, safe areas and native date controls. No decorative page entrances or new dependencies.
- Persian writing: kept respectful written Persian, preserved user content, extracted the new UI literals and ran fa_lint: 0issues. IDs/dates/time values remain ASCII in API requests.

## Product references and adaptations
- https://culturedcode.com/things/ : downloaded and visually read the actual product screenshot. Applied heading-first list rows, subordinate metadata, quiet navigation and separate check/open targets.
- https://www.todoist.com/help/articles/plan-your-day-with-the-today-view-UVUXaiSs : loaded the authoritative Today explanation. Kept overdue and selected-day queues separate; no date rewriting.
- https://structured.app/ : read product page and actual timeline screenshot. Existing task times remain visible in calendar agenda; no invented duration, draggable timeline or unsupplied functionality.

Reference screenshots are research only. No third-party product artwork, screenshots, customer data or code is shipped.

## Before / After
| Before | After | Why |
| --- | --- | --- |
| Stretched single-column desktop | 12-column folio: 8 work +4 planning, persistent224px labeled rail | Tasks and context are simultaneously visible without a long dashboard scroll. |
| Same desktop and mobile geometry | Single-column mobile with reserved bottom navigation; two-pane desktop calendar | Each width has an authored composition. |
| Achromatic admin chrome | Pine ink, mineral-green ground, deep teal action/selection, blue in-progress, amber overdue | Color carries navigation and task meaning rather than arbitrary decoration. |
| Every region is an outlined box | Tonal context, white task workspace, restrained row dividers | Stronger hierarchy with fewer borders. |
| Generic product label | Custom double-check TaskPro mark and destination-specific heading icons | Recognizable product identity with a consistent icon language. |
| Create only in header | Header plus contextual add row | Add where the user is already working; same authenticated real form. |
| Blank assistant composer | Two editable starter prompts | Help a user begin without automatically sending a message. |
| Faint form boundaries | Separate contrast-safe control-border token | Input boundaries remain distinct from subtle row dividers. |

## Verification and limitations
-49 Chromium UI/regression checks passed on built/minified app, synthetic local fixtures only. Includes create, undo, filters, details, errors/draft retention, calendar/status/undated, assistant actual response, new add/prompt controls, long text, XSS-as-text, 200%text, English/LTR, dark, unauthenticated no-write behavior.
-Widths360/390/768/1440; mobile/desktop/calendar/form/error/assistant/empty/dark/long-content/text-zoom screenshots inspected. Small alignment issue fixed in the look-and-fix pass. Capture helper found no clipped overflow or overlay intersections on initial mobile view.
-3 Worker checks passed: exact dist HTML, HEAD empty, POST405.
-Impeccable detector: no findings. Taste source lint:0FAIL/0WARN. Taste full runtime inspector did not finish: its CDP Page.captureScreenshot timed out after producing the desktop captures. It is NOT reported as passed; Playwright and the required artifact capture helper provide the recorded runtime/visual checks.
-Persian extracted literal lint:0issues. Contrast pairs checked separately; user-written text is not normalized.
-No Supabase/DB/plugin deployment, no task data mutation, no merge to main. Prior2098 backend/plugin checks are historical and not rerun by this UI pass.
-Real Telegram phone WebView keyboard, sticky hover and hardware safe-area behavior still require a device check; desktop emulation is not that check.

Rollback before this redesign: Cloudflare version00d7cedc-7eb4-4e05-8f14-0e94a7b420b5. Security headers, API origin, worker bindings and compatibility date are preserved.
