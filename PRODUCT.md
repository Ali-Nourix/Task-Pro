# TaskPro
Persian-first Telegram miniapp for tasks synchronized with an Obsidian vault. Users read their daily plan, complete tasks, edit/add tasks, select days in a Jalali calendar, review overdue tasks and ask a read-only assistant. Existing English, Telegram theme and keyboard support must survive.

## Truth and constraints
- Preserve all API contracts, auth validation, IDs and Gregorian input values.
- Today and overdue are separate, never backdate tasks to make a view look full.
- Last received snapshot is not evidence that Obsidian is online.
- No invented task data, timelines, percentages or recommendations in production.
- Existing vanilla JS, embedded Vazirmatn font and CSP; no framework migration.

## Design brief
Replace the rejected achromatic admin-panel appearance. A personable, high-craft daily planner: clear task hierarchy, purposeful color, much stronger desktop composition, a mobile-specific layout and responsive tactile controls. Use the supplied repositories, not just installation. Study Things, Todoist and Structured without copying assets or representing unimplemented interactions.
