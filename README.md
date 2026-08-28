# TaskPro

A powerful Obsidian plugin for seamless task management with bi-directional sync, dynamic status badges, and deadline tracking.

## ✨ Features

### 1. Task Import & Bi-directional Sync
- Import tasks from a central "Reference Note" (e.g., `Weekly Tasks.md`)
- Select parent tasks via Command Palette modal
- Automatically sync task status changes between imported tasks and source tasks
- Changes in either location update the other automatically

### 2. Tri-State Task Toggle
- Custom hotkey (default: `Ctrl+T`) to toggle task status
- Three-state loop: `[ ]` → `[/]` → `[x]` → `[ ]`
- Automatically triggers sync mechanism

### 3. Global Internal Tasks
- Create and manage tasks directly within plugin settings
- Independent of any markdown note
- Available in the import modal alongside reference note tasks

### 4. Dynamic Status Badges
- Beautiful capsule-shaped badges rendered dynamically
- Works in both Live Preview and Reading Mode
- No markdown pollution - badges are rendered via CodeMirror decorations
- Customizable size and language

**Badge States:**
- `[x]` → Light Green - "Done" / "انجام شده"
- `[ ]` → Light Gray - "Not Started" / "شروع نشده"
- `[/]` → Light Blue - "In Progress" / "در حال انجام"

### 5. Deadline Management
- Support for deadline syntax: `⏳ YYYY-MM-DD` or `[due:: YYYY-MM-DD]`
- Automatic deadline badge rendering
- Shows "Overdue" in red if past deadline and not completed
- Shows days remaining for future deadlines

## 🚀 Quick Start

### Installation

1. Download the latest release
2. Extract to `.obsidian/plugins/taskpro/`
3. Enable the plugin in Obsidian settings

### Setup

1. Open Settings → TaskPro
2. Set your "Reference Note Path" (e.g., `Weekly Tasks.md`)
3. Configure badge preferences (language, size, enable/disable)

### Usage

**Import a Task:**
1. Open any note
2. Press `Ctrl+P` → "Import Task from Reference Note"
3. Select a task from the modal
4. Task is inserted with sync enabled

**Toggle Task Status:**
1. Place cursor on any task line
2. Press `Ctrl+T`
3. Status cycles: `[ ]` → `[/]` → `[x]` → `[ ]`

## 📖 Documentation

### Task Syntax

```markdown
- [ ] Task name
- [/] Task in progress
- [x] Completed task
- [ ] Task with deadline ⏳ 2024-12-31
- [ ] Task with deadline [due:: 2024-12-31]
```

### Bi-directional Sync

When you import a task from your reference note, TaskPro creates a mapping between the imported task and the source task. Any status change in either location automatically updates the other.

### Settings

- **Reference Note Path**: Path to your central task note
- **Enable Status Badges**: Toggle badges on/off
- **Badge Language**: English or Persian (فارسی)
- **Badge Text Size**: Adjust badge font size (8-16px)
- **Global Internal Tasks**: Manage plugin-stored tasks

## 🛠️ Technical Details

- Uses CodeMirror 6 `ViewPlugin` for Live Preview badges
- Uses `MarkdownPostProcessor` for Reading Mode badges
- Task mappings stored in `data.json` to keep markdown clean
- Safe file writing with `App.vault.process()`
- Supports RTL text for Persian language

## 📝 License

MIT License

## 🙏 Credits

Developed by Ali

## Reminder note sources

Scheduled reminders keep their time, repeat, quiet-hours, sound, strictness, snooze, and system-notification controls. Reminder tasks are read only from the active note plus any additional notes selected in Settings → TaskPro → Reminders. Every unfinished task is included; completed tasks are skipped.

### Per-note intervals

Each selected reminder note has its own enable switch, repeat number, and unit (minutes, hours, days, or weeks). The active note still follows the global daily/repeat schedule; selected notes can also fire independently on their own intervals. Quiet hours, sound, snooze, strictness, and system notifications apply to every reminder.

### Active-note default and embed isolation

Active-note reminders are enabled by default and use the global reminder schedule. Tasks rendered through `![[embedded note]]` references are not counted as tasks belonging to the parent note and are excluded from parent-note reminders.

### Embed owner-note fix

The active reminder now resolves the outer Markdown view's file, not the focused transcluded source. For callouts such as `> [!warning]` followed by `> ![[Other note#Heading]]`, only task lines physically present in the outer note are counted.
