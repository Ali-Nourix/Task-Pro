// ── settings.ts ───────────────────────────────────────────────────────────
// Settings tab UI
// ─────────────────────────────────────────────────────────────────────────────

import { App, PluginSettingTab, Setting, Notice, setIcon } from 'obsidian';
import TaskProPlugin from '../main';
import {
  CalendarTaskTarget,
  DailyNoteNaming,
  GlobalInternalTask,
  PRIORITY_ICON_NAMES,
  PRIORITY_LABELS,
  ReminderAgeMode,
  ReminderIntervalUnit,
  UnknownAgePolicy,
  ReminderSound,
  ReminderStrictness,
  STATUS_ICON_NAMES,
  TASK_PRIORITIES,
  TaskStatus,
  TimeFormat,
  WeekStart,
} from './types';
import { ReminderSoundPlayer } from './reminders/reminder-sound';
import { renderTagManager } from './ui/tag-manager';
import { NoteSelectionModal } from './note-selector-modal';
import { dailyNotePath, namingSystem } from './calendar/daily-notes';
import { todayKey } from './calendar/calendar-dates';

/** Tabs shown at the top of the settings screen. */
type SettingsTabId = 'general' | 'appearance' | 'capabilities' | 'tags' | 'calendar' | 'reminders' | 'telegram' | 'tasks';

const SETTINGS_TABS: Array<{ id: SettingsTabId; label: string; icon: string }> = [
  { id: 'general', label: 'General', icon: 'settings' },
  { id: 'appearance', label: 'Badges', icon: 'palette' },
  { id: 'capabilities', label: 'Capabilities', icon: 'sparkles' },
  { id: 'tags', label: 'Tags', icon: 'tags' },
  { id: 'calendar', label: 'Calendar', icon: 'calendar-days' },
  { id: 'reminders', label: 'Reminders', icon: 'bell-ring' },
  { id: 'telegram', label: 'Telegram', icon: 'send' },
  { id: 'tasks', label: 'Internal Tasks', icon: 'list-checks' },
];

/** Obsidian's own Daily notes plugin, whose settings the Calendar tab can copy. */
interface CoreDailyNotes {
  enabled?: boolean;
  instance?: { options?: { folder?: string; format?: string; template?: string } };
}

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
const REMINDER_STATUS_OPTIONS: Array<{ value: TaskStatus; label: string }> = [
  { value: '[ ]', label: 'Not started' },
  { value: '[/]', label: 'In progress' },
  { value: '[!]', label: 'Not done / overdue' },
  { value: '[x]', label: 'Done' },
];

/** Parses a comma separated "HH:mm, HH:mm" list, returning only valid entries. */
function parseDailyTimes(raw: string): { times: string[]; invalid: string[] } {
  const times: string[] = [];
  const invalid: string[] = [];

  for (const part of raw.split(',')) {
    const value = part.trim();
    if (!value) continue;
    if (TIME_PATTERN.test(value)) {
      if (!times.includes(value)) times.push(value);
    } else {
      invalid.push(value);
    }
  }

  times.sort();
  return { times, invalid };
}

export class TaskProSettingTab extends PluginSettingTab {
  plugin: TaskProPlugin;
  /** Remembered across re-renders so editing a field never throws you back to tab one. */
  private activeTab: SettingsTabId = 'general';
  /** Only created when the user previews a sound; disposed when the tab closes. */
  private previewPlayer: ReminderSoundPlayer | null = null;

  constructor(app: App, plugin: TaskProPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  hide(): void {
    // A preview must never outlive the settings screen.
    this.previewPlayer?.stop();
    this.previewPlayer = null;
  }

  /** Section heading with an Obsidian icon, used instead of bare `h3` text. */
  private renderSectionHeader(
    container: HTMLElement,
    icon: string,
    title: string,
    description?: string
  ): void {
    // The icon beside the title, and the description under the title, not under the icon.
    const header = container.createDiv({ cls: 'taskpro-settings-section' });
    const iconEl = header.createSpan({ cls: 'taskpro-settings-section__icon' });
    iconEl.setAttribute('aria-hidden', 'true');
    setIcon(iconEl, icon);
    const text = header.createDiv({ cls: 'taskpro-settings-section__text' });
    text.createEl('h3', { cls: 'taskpro-settings-section__title', text: title });
    if (description) {
      text.createEl('p', {
        cls: 'setting-item-description taskpro-settings-section__desc',
        text: description,
      });
    }
  }

  /** Human wording for the age slider, so "0" never reads as "today only". */
  private describeCreatedWithin(value: number): string {
    if (value <= 0) return 'Off \u2014 tasks of any age can trigger a reminder';
    if (value === 1) return 'Only tasks created in the last 24 hours';
    return `Only tasks created in the last ${value} days`;
  }

  /** Prefixes a setting's name with an Obsidian icon. */
  private withIcon(setting: Setting, icon: string): Setting {
    const iconEl = createSpan({ cls: 'taskpro-settings-item__icon' });
    iconEl.setAttribute('aria-hidden', 'true');
    setIcon(iconEl, icon);
    setting.nameEl.prepend(iconEl);
    return setting;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass('taskpro-settings');

    containerEl.createEl('h2', { text: 'TaskPro' });

    const nav = containerEl.createDiv({ cls: 'taskpro-settings-tabs' });
    nav.setAttribute('role', 'tablist');
    const content = containerEl.createDiv({ cls: 'taskpro-settings-content' });

    for (const tab of SETTINGS_TABS) {
      const button = nav.createEl('button', {
        cls: `taskpro-settings-tab${this.activeTab === tab.id ? ' is-active' : ''}`,
      });
      button.setAttribute('role', 'tab');
      button.setAttribute('aria-selected', String(this.activeTab === tab.id));
      const icon = button.createSpan({ cls: 'taskpro-settings-tab__icon' });
      icon.setAttribute('aria-hidden', 'true');
      setIcon(icon, tab.icon);
      button.createSpan({ text: tab.label });
      button.addEventListener('click', () => {
        if (this.activeTab === tab.id) return;
        this.activeTab = tab.id;
        this.display();
      });
    }

    this.renderActiveTab(content);
  }

  private renderActiveTab(containerEl: HTMLElement): void {
    switch (this.activeTab) {
      case 'appearance':
        this.renderAppearanceTab(containerEl);
        return;
      case 'capabilities':
        this.renderCapabilitiesTab(containerEl);
        return;
      case 'tags':
        this.renderTagsTab(containerEl);
        return;
      case 'calendar':
        this.renderCalendarTab(containerEl);
        return;
      case 'reminders':
        this.renderPlanReminderSettings(containerEl);
        this.renderReminderSettings(containerEl);
        return;
      case 'telegram':
        this.renderTelegramTab(containerEl);
        return;
      case 'tasks':
        this.renderInternalTasksTab(containerEl);
        return;
      case 'general':
      default:
        this.renderGeneralTab(containerEl);
    }
  }

  private renderTelegramTab(containerEl: HTMLElement): void {
    this.renderSectionHeader(
      containerEl,
      'send',
      'Telegram bot',
      'Add and tick off tasks and get reminders in Telegram, even while this computer is off. When Obsidian is open, tasks and reminders go to the bot and what you asked for there is made in your notes. Set up the bot first: supabase/README.md in the plugin’s repository.'
    );
    const settings = this.plugin.settings.telegram;
    const apply = async () => {
      await this.plugin.saveSettings();
      this.plugin.telegramSync.start();
    };

    new Setting(containerEl)
      .setName('Sync with the bot')
      .setDesc('Upload the open tasks and make the changes asked for in Telegram.')
      .addToggle((toggle) =>
        toggle.setValue(settings.enabled).onChange(async (value) => {
          settings.enabled = value;
          await apply();
        })
      );

    new Setting(containerEl)
      .setName('Project address')
      .setDesc('Your Supabase project, like https://abcd1234.supabase.co')
      .addText((text) =>
        text
          .setPlaceholder('https://abcd1234.supabase.co')
          .setValue(settings.url)
          .onChange(async (value) => {
            settings.url = value.trim();
            await apply();
          })
      );

    new Setting(containerEl)
      .setName('Sync token')
      .setDesc('The SYNC_TOKEN you set for the bot. It is kept in this vault’s plugin data.')
      .addText((text) => {
        text.inputEl.type = 'password';
        text.setPlaceholder('SYNC_TOKEN').setValue(settings.token).onChange(async (value) => {
          settings.token = value.trim();
          await apply();
        });
      });

    new Setting(containerEl)
      .setName('Ask for changes every')
      .setDesc('While Obsidian is open: how soon what you ask for in Telegram reaches your notes.')
      .addDropdown((dropdown) => {
        dropdown.addOption('0.5', '30 seconds');
        for (const minutes of [1, 2, 5, 10, 30]) dropdown.addOption(String(minutes), minutes === 1 ? '1 minute' : `${minutes} minutes`);
        dropdown.setValue(String(settings.intervalMinutes)).onChange(async (value) => {
          settings.intervalMinutes = Number(value);
          await apply();
        });
      });

    new Setting(containerEl)
      .setName('Send my edits after I pause for')
      .setDesc('Changes you make in your notes reach the bot this long after you stop typing (and at least once a minute while you keep going).')
      .addDropdown((dropdown) => {
        for (const seconds of [2, 4, 8, 15, 30]) dropdown.addOption(String(seconds), `${seconds} seconds`);
        dropdown.setValue(String(settings.quietSeconds ?? 4)).onChange(async (value) => {
          settings.quietSeconds = Number(value);
          await this.plugin.saveSettings();
        });
      });

    const status = new Setting(containerEl).setName('Status');
    const describe = () => {
      if (settings.lastError) return `Last problem: ${settings.lastError}`;
      return settings.lastSyncAt ? `Last synced ${new Date(settings.lastSyncAt).toLocaleString()}` : 'Not synced yet.';
    };
    status.setDesc(describe());
    status.addButton((button) =>
      button
        .setButtonText('Sync now')
        .setCta()
        .onClick(async () => {
          button.setDisabled(true);
          const outcome = await this.plugin.telegramSync.syncNow();
          new Notice(outcome.ok ? (outcome.applied ? `Synced; ${outcome.applied} change(s) made.` : 'Synced.') : `Sync failed: ${outcome.message ?? 'unknown error'}`);
          status.setDesc(describe());
          button.setDisabled(false);
        })
    );
  }

  private renderGeneralTab(containerEl: HTMLElement): void {
    this.renderSectionHeader(
      containerEl,
      'folder-cog',
      'Sources & Scope',
      'Where TaskPro reads tasks from and where it stays active.'
    );

    // Reference Note Path, with the note chosen shown beside its button
    let pathDisplay: HTMLElement;

    const reference = new Setting(containerEl)
      .setName('Reference Note Path')
      .setDesc('Select the note containing your reference tasks');
    pathDisplay = reference.controlEl.createSpan({ cls: 'taskpro-settings-path' });
    pathDisplay.setText(this.plugin.settings.referenceNotePath || 'No note selected');
    pathDisplay.toggleClass('is-empty', !this.plugin.settings.referenceNotePath);
    reference
      .addButton(button => button
        .setButtonText('Select Note')
        .onClick(() => {
          const modal = new NoteSelectionModal(this.app, async (file) => {
            this.plugin.settings.referenceNotePath = file.path;
            await this.plugin.saveSettings();
            pathDisplay.setText(file.path);
            pathDisplay.removeClass('is-empty');
            new Notice(`Reference note set to: ${file.path}`);
          });
          modal.open();
        }));
    

    // Target Folder Restriction
    new Setting(containerEl)
      .setName('Target Folder')
      .setDesc('Restrict plugin activity to a specific folder (leave empty for entire vault). Changing this also sets the daily-note folder to the same path; you can override it later in Calendar.')
      .addText(text => text
        .setPlaceholder('Example: Projects/Tasks')
        .setValue(this.plugin.settings.targetFolder)
        .onChange(async (value) => {
          this.plugin.settings.targetFolder = value.trim();
          await this.plugin.saveSettings();
          this.plugin.refreshBoards();
          new Notice(value.trim() ? `Plugin restricted to: ${value.trim()}` : 'Plugin active in entire vault');
        }));

    const fa = this.plugin.settings.badgeLanguage === 'fa';
    new Setting(containerEl)
      .setName(fa ? 'محدودهٔ پیش‌فرض نماهای داخل نوت' : 'Default scope for note views')
      .setDesc(fa
        ? 'هر بار نوت باز می‌شود از این محدوده شروع کن. اگر پوشهٔ هدف تعیین نشده باشد، کل والت نمایش داده می‌شود. حالت کدبلاک از scope نوشته‌شده پیروی می‌کند.'
        : 'Start each note view in this scope. Target folder falls back to the whole vault only when no folder is configured. Code block mode follows its explicit scope option.')
      .addDropdown(dropdown => dropdown
        .addOption('target', fa ? 'پوشهٔ هدف، در صورت تعیین‌شدن' : 'Target folder, when configured')
        .addOption('vault', fa ? 'کل والت' : 'Whole vault')
        .addOption('block', fa ? 'پیروی از کدبلاک' : 'Follow code block')
        .setValue(this.plugin.settings.embedDefaultScope)
        .onChange(async value => {
          this.plugin.settings.embedDefaultScope = value === 'vault' || value === 'block' ? value : 'target';
          await this.plugin.saveSettings();
          this.plugin.refreshBoards();
        }));

  }

  private renderAppearanceTab(containerEl: HTMLElement): void {
    this.renderSectionHeader(
      containerEl,
      'badge-check',
      'Badge Settings',
      'How task chips look inside notes.'
    );

    // Enable Badges
    new Setting(containerEl)
      .setName('Enable Status Badges')
      .setDesc('Show dynamic status badges next to tasks')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.enableBadges)
        .onChange(async (value) => {
          this.plugin.settings.enableBadges = value;
          await this.plugin.saveSettings();
          this.plugin.refreshDecorations();
        }));

    // Badge Language
    new Setting(containerEl)
      .setName('Badge Language')
      .setDesc('Language for badge text')
      .addDropdown(dropdown => dropdown
        .addOption('en', 'English')
        .addOption('fa', 'Persian (فارسی)')
        .setValue(this.plugin.settings.badgeLanguage)
        .onChange(async (value) => {
          this.plugin.settings.badgeLanguage = value as 'en' | 'fa';
          await this.plugin.saveSettings();
          this.plugin.refreshDecorations();
          this.plugin.refreshBoards();
        }));

    // Calendar System
    new Setting(containerEl)
      .setName('Calendar System')
      .setDesc('Choose between Gregorian (Western) and Jalali (Persian) calendar')
      .addDropdown(dropdown => dropdown
        .addOption('gregorian', 'Gregorian (Western)')
        .addOption('jalali', 'Jalali (Persian)')
        .setValue(this.plugin.settings.calendarSystem)
        .onChange(async (value) => {
          this.plugin.settings.calendarSystem = value as 'gregorian' | 'jalali';
          await this.plugin.saveSettings();
        }));

    // Badge Size
    new Setting(containerEl)
      .setName('Badge Text Size')
      .setDesc('Font size for badge text (in pixels)')
      .addSlider(slider => slider
        .setLimits(8, 16, 1)
        .setValue(this.plugin.settings.badgeSize)
        .setDynamicTooltip()
        .onChange(async (value) => {
          this.plugin.settings.badgeSize = value;
          await this.plugin.saveSettings();
          this.plugin.refreshDecorations();
        }));

    // Show Badges in Embeds
    new Setting(containerEl)
      .setName('Show Badges in Embeds')
      .setDesc('Display task badges inside embedded blocks')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.showBadgesInEmbeds)
        .onChange(async (value) => {
          this.plugin.settings.showBadgesInEmbeds = value;
          await this.plugin.saveSettings();
          
          // Toggle body class for CSS control
          if (value) {
            document.body.removeClass('taskpro-hide-badges-in-embeds');
          } else {
            document.body.addClass('taskpro-hide-badges-in-embeds');
          }
          
          this.plugin.refreshDecorations();
        }));

    // Show Priority Badges
    new Setting(containerEl)
      .setName('Show Priority Badges')
      .setDesc('Display a priority chip next to tasks and hide the raw priority marker')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.showPriorityBadges)
        .onChange(async (value) => {
          this.plugin.settings.showPriorityBadges = value;
          await this.plugin.saveSettings();
          this.plugin.refreshDecorations();
        }));

    // Show Focus Timer Badges
    new Setting(containerEl)
      .setName('Show Focus Timer Badges')
      .setDesc('Display the live countdown chip on tasks that have a focus timer')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.showTimerBadges)
        .onChange(async (value) => {
          this.plugin.settings.showTimerBadges = value;
          await this.plugin.saveSettings();
          this.plugin.refreshDecorations();
        }));

    // Show Repeat Badges
    new Setting(containerEl)
      .setName('Show Repeat Badges')
      .setDesc('Display a recurrence chip next to repeating tasks and hide the raw @repeat marker')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.showRepeatBadges)
        .onChange(async (value) => {
          this.plugin.settings.showRepeatBadges = value;
          await this.plugin.saveSettings();
          this.plugin.refreshDecorations();
        }));

    // Show Plan Badges
    new Setting(containerEl)
      .setName('Show Plan Badges')
      .setDesc('Display when a task is planned ("Today, 09:00 – 10:30") and hide the raw @schedule marker')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.showScheduleBadges)
        .onChange(async (value) => {
          this.plugin.settings.showScheduleBadges = value;
          await this.plugin.saveSettings();
          this.plugin.refreshDecorations();
          this.plugin.refreshReadingViews();
        }));

    new Setting(containerEl)
      .setName('Show Subtask Progress')
      .setDesc('A parent task with no progress bar of its own shows how many of its subtasks are done ("2/4"), in notes and on the board')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.showSubtaskProgress)
        .onChange(async (value) => {
          this.plugin.settings.showSubtaskProgress = value;
          await this.plugin.saveSettings();
          this.plugin.refreshDecorations();
          this.plugin.refreshReadingViews();
          this.plugin.refreshBoards();
        }));

    new Setting(containerEl)
      .setName('Show Waiting Badges')
      .setDesc('A task that waits on another names it in a chip, and hides the raw @waiting marker')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.showWaitingBadges)
        .onChange(async (value) => {
          this.plugin.settings.showWaitingBadges = value;
          await this.plugin.saveSettings();
          this.plugin.refreshDecorations();
          this.plugin.refreshReadingViews();
        }));

    new Setting(containerEl)
      .setName('Suggest Properties After @')
      .setDesc('On a task line, typing @ lists priorities, deadlines, plans, repeats, tags and statuses; picking one writes its marker.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.propertySuggest)
        .onChange(async (value) => {
          this.plugin.settings.propertySuggest = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Two-Finger Swipe Opens the Task Board')
      .setDesc('On a touch screen, put two fingers down together anywhere in Obsidian and pull them down to go straight to the task board.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.boardGesture)
        .onChange(async (value) => {
          this.plugin.settings.boardGesture = value;
          await this.plugin.saveSettings();
        }));

    this.renderSectionHeader(
      containerEl,
      'paintbrush',
      'Appearance Customization',
      'Install the "Style Settings" plugin to customize badge colors, padding, border radius, and opacity.'
    );
  }

  /**
   * Per-task capabilities. Each one is added to an individual task from its
   * chip menu; this tab only holds the defaults and the alerting behaviour.
   */
  private renderCapabilitiesTab(containerEl: HTMLElement): void {
    this.renderSectionHeader(
      containerEl,
      'timer',
      'Focus Timer',
      'A countdown you can attach to any task from its status chip. Timers keep counting while Obsidian is closed, because the remaining time is read from the clock rather than ticked down in memory.'
    );

    new Setting(containerEl)
      .setName('Default Duration')
      .setDesc('Minutes pre-filled when a focus timer is added to a task')
      .addSlider(slider => slider
        .setLimits(5, 120, 5)
        .setValue(this.plugin.settings.defaultTimerMinutes)
        .setDynamicTooltip()
        .onChange(async (value) => {
          this.plugin.settings.defaultTimerMinutes = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Desktop Notification')
      .setDesc('Post a system notification when a timer runs out. On Windows this appears as a toast and stays in the Action Center; permission is asked for once.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.timerSystemNotification)
        .onChange(async (value) => {
          this.plugin.settings.timerSystemNotification = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Play Sound')
      .setDesc('Play the reminder sound once when a timer runs out. Uses the sound chosen under Reminders.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.timerSound)
        .onChange(async (value) => {
          this.plugin.settings.timerSound = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Show in Status Bar')
      .setDesc('Keep the running timer visible in Obsidian\u2019s status bar. Click it to open the note the task lives in.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.timerInStatusBar)
        .onChange(async (value) => {
          this.plugin.settings.timerInStatusBar = value;
          await this.plugin.saveSettings();
          this.plugin.timerService.render();
        }));

    const runningTimers = (this.plugin.settings.taskTimers ?? []).filter(
      (entry) => entry.timer?.enabled
    );
    new Setting(containerEl)
      .setName('Attached Timers')
      .setDesc(
        runningTimers.length
          ? `${runningTimers.length} task${runningTimers.length === 1 ? '' : 's'} currently carry a focus timer.`
          : 'No task has a focus timer yet. Click a task\u2019s status chip and choose "Add Focus Timer".'
      )
      .addButton(button => button
        .setButtonText('Clear all')
        .setDisabled(runningTimers.length === 0)
        .onClick(async () => {
          this.plugin.settings.taskTimers = [];
          await this.plugin.saveSettings();
          this.plugin.timerService.rebuildCache();
          this.plugin.refreshDecorations();
          new Notice('All focus timers removed');
          this.display();
        }));

    this.renderSectionHeader(
      containerEl,
      'repeat',
      'Repeating Tasks',
      'Ticking off a repeating task rolls it forward instead of closing it: the deadline moves to the next occurrence, the status returns to "not started", and any progress bar or focus timer on the task resets. The rule is written into the task line as @repeat(1w), so it travels with the task.'
    );

    containerEl.createEl('p', {
      cls: 'setting-item-description',
      text:
        'The next occurrence is counted from the task\u2019s own deadline, so a weekly task keeps its weekday even when it is ticked off late. A deadline already in the past is advanced until it lands in the future.',
    });

    new Setting(containerEl)
      .setName('Add a Repeat Rule')
      .setDesc('Click a task\u2019s status chip and choose "Repeat This Task", or run "Toggle Weekly Repeat on Current Task" from the Command Palette.')
      .addButton(button => button
        .setButtonText('Copy marker')
        .setTooltip('Copies @repeat(1w) so you can paste it onto a task by hand')
        .onClick(async () => {
          await navigator.clipboard.writeText('@repeat(1w)');
          new Notice('Copied @repeat(1w)');
        }));
  }

  /**
   * The tag list. A note stores only a tag's key, so everything edited here
   * (name, colour) shows up on every task at once without touching a note.
   */
  private renderTagsTab(containerEl: HTMLElement): void {
    this.renderSectionHeader(
      containerEl,
      'tags',
      'Tags',
      'Your own labels for tasks, each with a name and a colour. A task stores only the tag\u2019s key, written as @tag(key), so renaming or recolouring a tag here updates every task that carries it. Add a tag to a task from its status chip, with "Set Tags on Current Task", or from the task board.'
    );

    new Setting(containerEl)
      .setName('Show Tag Chips')
      .setDesc('Display a coloured chip for each tag and hide the raw @tag marker')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.showTagBadges)
        .onChange(async (value) => {
          this.plugin.settings.showTagBadges = value;
          await this.plugin.saveSettings();
          this.plugin.refreshDecorations();
          this.plugin.refreshReadingViews();
        }));

    renderTagManager(containerEl.createDiv(), this.plugin.tagManagerHost());

    this.renderSectionHeader(
      containerEl,
      'list-checks',
      'Task Board',
      'Every task in one place, as a table or a board, grouped and filtered by status, tag, priority, deadline or note. Choose the whole vault or only the target folder from the board itself.'
    );

    new Setting(containerEl)
      .setName('Open the Task Board')
      .setDesc('Also available from the ribbon and as "Open Task Board" in the Command Palette.')
      .addButton(button => button
        .setButtonText('Open')
        .setCta()
        .onClick(() => void this.plugin.activateBoard()));
  }

  /**
   * Daily notes and the calendar layout of the task board. The name preview
   * is recomputed on every keystroke, so a pattern can be tried out here
   * without creating a single note.
   */
  private renderCalendarTab(containerEl: HTMLElement): void {
    const calendar = this.plugin.settings.calendar;
    const save = async (options: { decorations?: boolean } = {}) => {
      await this.plugin.saveSettings();
      this.plugin.refreshBoards();
      if (options.decorations) {
        this.plugin.refreshDecorations();
        this.plugin.refreshReadingViews();
      }
    };

    this.renderSectionHeader(
      containerEl,
      'calendar-days',
      'Daily Notes',
      'Each day in the calendar has its own note. A task made on a day is written into that day’s note, which is created the first time it is needed. Before one is created, TaskPro looks for the day’s note under both calendars’ names, so switching the calendar never gives a day two notes.'
    );

    // Placed under the name settings below; built first so they can redraw it.
    const preview = createDiv({ cls: 'taskpro-settings-preview' });
    const renderPreview = () => {
      preview.empty();
      const today = todayKey();
      const shown = this.plugin.settings.board.calendarSystem ?? this.plugin.settings.calendarSystem;
      const naming = namingSystem(calendar, shown);
      const iconEl = preview.createSpan({ cls: 'taskpro-settings-preview__icon' });
      setIcon(iconEl, 'file-text');
      const text = preview.createDiv({ cls: 'taskpro-settings-preview__text' });
      text.createDiv({ cls: 'taskpro-settings-preview__label', text: 'Today’s note' });
      text.createDiv({ cls: 'taskpro-settings-preview__path', text: dailyNotePath(today, naming, calendar), attr: { dir: 'auto' } });
      if (calendar.dailyNoteNaming === 'view') {
        const other = naming === 'jalali' ? 'gregorian' : 'jalali';
        text.createDiv({
          cls: 'taskpro-settings-preview__alt',
          text: `With the ${other === 'jalali' ? 'Jalali' : 'Gregorian'} calendar showing: ${dailyNotePath(today, other, calendar)}`,
          attr: { dir: 'auto' },
        });
      }
    };

    new Setting(containerEl)
      .setName('Folder')
      .setDesc('Where daily notes are kept. Changing Target Folder sets this to the same path; you can edit it independently afterward. Leave empty for the vault root. Telegram task destinations must stay inside Target Folder when it is set.')
      .addText(text => text
        .setPlaceholder('Daily')
        .setValue(calendar.dailyNotesFolder)
        .onChange(async (value) => {
          calendar.dailyNotesFolder = value.trim();
          renderPreview();
          await save();
        }));

    new Setting(containerEl)
      .setName('Gregorian name')
      .setDesc('YYYY, MM and DD for the year, month and day; MMMM for the month’s name and dddd for the weekday. Text in [brackets] is kept as it is, and a / makes subfolders.')
      .addText(text => text
        .setPlaceholder('YYYY-MM-DD')
        .setValue(calendar.gregorianNoteFormat)
        .onChange(async (value) => {
          calendar.gregorianNoteFormat = value;
          renderPreview();
          await save();
        }));

    new Setting(containerEl)
      .setName('Jalali name')
      .setDesc('The same with a j: jYYYY, jMM and jDD, jMMMM for the Persian month’s name. Names are written in Persian.')
      .addText(text => text
        .setPlaceholder('jYYYY-jMM-jDD')
        .setValue(calendar.jalaliNoteFormat)
        .onChange(async (value) => {
          calendar.jalaliNoteFormat = value;
          renderPreview();
          await save();
        }));

    new Setting(containerEl)
      .setName('Name new notes with')
      .setDesc('Which calendar names a day’s note when it is created.')
      .addDropdown(dropdown => dropdown
        .addOption('view', 'The calendar being shown')
        .addOption('gregorian', 'Always Gregorian')
        .addOption('jalali', 'Always Jalali')
        .setValue(calendar.dailyNoteNaming)
        .onChange(async (value) => {
          calendar.dailyNoteNaming = value as DailyNoteNaming;
          renderPreview();
          await save();
        }));

    let templateText: { setValue: (value: string) => unknown } | null = null;
    new Setting(containerEl)
      .setName('Template')
      .setDesc('A note a new daily note starts from. {{title}}, {{date}}, {{date:FORMAT}}, {{time}}, {{weekday}}, {{gregorian}}, {{jalali}}, {{yesterday}} and {{tomorrow}} are filled in; Templater commands run too.')
      .addText(text => {
        templateText = text;
        text
          .setPlaceholder('Templates/Daily.md')
          .setValue(calendar.templatePath)
          .onChange(async (value) => {
            calendar.templatePath = value.trim();
            await save();
          });
      })
      .addButton(button => button
        .setButtonText('Choose')
        .onClick(() => {
          new NoteSelectionModal(this.app, async (file) => {
            calendar.templatePath = file.path;
            templateText?.setValue(file.path);
            await save();
          }).open();
        }));

    new Setting(containerEl)
      .setName('Put new tasks under')
      .setDesc('A heading in the daily note, such as "## Tasks". It is added when the note does not have it yet. Leave empty to add tasks at the end of the note.')
      .addText(text => text
        .setPlaceholder('## Tasks')
        .setValue(calendar.taskHeading)
        .onChange(async (value) => {
          calendar.taskHeading = value;
          await save();
        }));

    const core = (this.app as unknown as { internalPlugins?: { getPluginById?: (id: string) => CoreDailyNotes | null } })
      .internalPlugins?.getPluginById?.('daily-notes');
    const coreOptions = core?.enabled ? core.instance?.options : undefined;
    if (coreOptions) {
      new Setting(containerEl)
        .setName('Use Obsidian’s Daily notes settings')
        .setDesc('Copies the folder, the name format (as the Gregorian name) and the template from the core Daily notes plugin.')
        .addButton(button => button
          .setButtonText('Copy')
          .onClick(async () => {
            calendar.dailyNotesFolder = coreOptions.folder?.trim() ?? '';
            if (coreOptions.format?.trim()) calendar.gregorianNoteFormat = coreOptions.format.trim();
            if (coreOptions.template?.trim()) calendar.templatePath = coreOptions.template.trim();
            await save();
            new Notice('Daily notes settings copied');
            this.display();
          }));
    }

    renderPreview();
    containerEl.appendChild(preview);

    this.renderSectionHeader(
      containerEl,
      'calendar-clock',
      'Planning',
      'Open the task board and choose Calendar. Drag across the week or day grid to block out time, drag a task to move it or its edge to change its length, and drag one out of the unscheduled list to give it a time. A plan is written into the task line as @schedule(2026-09-28 09:00-10:30).'
    );

    new Setting(containerEl)
      .setName('Tasks made on a day go into')
      .setDesc('The day’s note, or the note the board’s quick add uses, with the day written on the task.')
      .addDropdown(dropdown => dropdown
        .addOption('daily', 'The day’s note')
        .addOption('inbox', 'The board’s inbox note')
        .setValue(calendar.newTaskTarget)
        .onChange(async (value) => {
          calendar.newTaskTarget = value as CalendarTaskTarget;
          await save();
        }));

    new Setting(containerEl)
      .setName('Plan new tasks for today')
      .setDesc('A task written without a plan is planned for the day it is made, as @schedule(2026-10-08), so it shows on the calendar and in the Telegram bot’s week. A task that already has a plan, or that is ticked off, is left as it is.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.autoPlanNewTasks)
        .onChange(async (value) => {
          this.plugin.settings.autoPlanNewTasks = value;
          await save();
        }));

    new Setting(containerEl)
      .setName('Track start and end time')
      .setDesc('A new task’s plan starts at the moment it is written, and ends at the moment it is ticked off the same day: @schedule(2026-10-08 09:12-10:40). Works on its own too: a new task is then planned with its start time even when the option above is off.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.autoTrackTaskTime)
        .onChange(async (value) => {
          this.plugin.settings.autoTrackTaskTime = value;
          await save();
        }));

    new Setting(containerEl)
      .setName('Week starts on')
      .setDesc('Automatic starts a Jalali week on Saturday and a Gregorian one on Monday.')
      .addDropdown(dropdown => dropdown
        .addOption('auto', 'Automatic')
        .addOption('saturday', 'Saturday')
        .addOption('sunday', 'Sunday')
        .addOption('monday', 'Monday')
        .setValue(calendar.weekStart)
        .onChange(async (value) => {
          calendar.weekStart = value as WeekStart;
          await save();
        }));

    new Setting(containerEl)
      .setName('Clock')
      .addDropdown(dropdown => dropdown
        .addOption('24h', '24-hour (14:30)')
        .addOption('12h', '12-hour (2:30 PM)')
        .setValue(calendar.timeFormat)
        .onChange(async (value) => {
          calendar.timeFormat = value as TimeFormat;
          await save({ decorations: true });
        }));

    new Setting(containerEl)
      .setName('Day starts at')
      .setDesc('The hour the week and day grids open at. The rest of the day is a scroll away.')
      .addSlider(slider => slider
        .setLimits(0, 12, 1)
        .setValue(calendar.dayStartHour)
        .setDynamicTooltip()
        .onChange(async (value) => {
          calendar.dayStartHour = value;
          await save();
        }));

    new Setting(containerEl)
      .setName('Snap to')
      .setDesc('Minutes a drag on the time grid moves in.')
      .addDropdown(dropdown => {
        for (const minutes of [5, 10, 15, 30, 60]) dropdown.addOption(String(minutes), `${minutes} minutes`);
        dropdown
          .setValue(String(calendar.slotMinutes))
          .onChange(async (value) => {
            calendar.slotMinutes = Number(value);
            await save();
          });
      });

    new Setting(containerEl)
      .setName('New block length')
      .setDesc('How long a block made with a click, rather than a drag, lasts.')
      .addDropdown(dropdown => {
        for (const minutes of [15, 30, 45, 60, 90, 120]) {
          dropdown.addOption(String(minutes), minutes < 60 ? `${minutes} minutes` : `${minutes / 60} hour${minutes === 60 ? '' : 's'}`);
        }
        dropdown
          .setValue(String(calendar.defaultDurationMinutes))
          .onChange(async (value) => {
            calendar.defaultDurationMinutes = Number(value);
            await save();
          });
      });

    new Setting(containerEl)
      .setName('Open the Calendar')
      .setDesc('Also "Open Task Calendar" in the Command Palette, and "Open Today’s Daily Note" for today’s note.')
      .addButton(button => button
        .setButtonText('Open')
        .setCta()
        .onClick(() => void this.plugin.openCalendar()));
  }

  private renderInternalTasksTab(containerEl: HTMLElement): void {
    this.renderSectionHeader(
      containerEl,
      'list-checks',
      'Global Internal Tasks',
      'Tasks stored directly in the plugin, independent of any note.'
    );

    // Display existing global tasks
    const tasksContainer = containerEl.createDiv('global-tasks-container');
    this.renderGlobalTasks(tasksContainer);

    // Add new global task button
    new Setting(containerEl)
      .setName('Add Global Task')
      .setDesc('Create a new internal task')
      .addButton(button => button
        .setButtonText('Add Task')
        .onClick(() => {
          const newTask: GlobalInternalTask = {
            id: Date.now().toString(),
            content: 'New Task',
            status: '[ ]',
            created: Date.now(),
          };
          this.plugin.settings.globalInternalTasks.push(newTask);
          this.plugin.saveSettings();
          this.renderGlobalTasks(tasksContainer);
        }));
  }

  /**
   * Daily reminder settings. Rendered into a dedicated container so the
   * strictness-dependent fields can be re-rendered without rebuilding the whole tab.
   */
  /** A notice shortly before a planned task starts, independent of the daily reminders. */
  private renderPlanReminderSettings(containerEl: HTMLElement): void {
    const reminders = this.plugin.settings.reminders;
    const save = async () => {
      await this.plugin.saveSettings();
      this.plugin.planReminders.refresh();
    };

    this.renderSectionHeader(
      containerEl,
      'alarm-clock',
      'Plan Reminders',
      'A notice shortly before a planned task starts. A task can set its own time from its plan’s menu.'
    );

    const enable = new Setting(containerEl)
      .setName('Remind Before a Plan Starts')
      .setDesc('For tasks planned at a time of day, not whole-day plans or tasks already done');
    this.withIcon(enable, 'bell');
    const details = containerEl.createDiv('taskpro-reminder-settings');
    const renderDetails = () => {
      details.empty();
      if (!reminders.planReminders) return;
      const lead = new Setting(details).setName('How Early').setDesc('Tasks with a time of their own keep it');
      this.withIcon(lead, 'timer');
      lead.addDropdown((dropdown) => {
        for (const minutes of [0, 5, 10, 15, 30, 60]) {
          dropdown.addOption(String(minutes), minutes === 0 ? 'At the start' : minutes === 60 ? '1 hour before' : `${minutes} minutes before`);
        }
        dropdown.setValue(String(reminders.planLeadMinutes)).onChange(async (value) => {
          reminders.planLeadMinutes = Number(value);
          await save();
        });
      });
      const sound = new Setting(details).setName('Play a Sound').setDesc('Uses the reminder sound chosen under Daily Reminders');
      this.withIcon(sound, 'volume-2');
      sound.addToggle((toggle) =>
        toggle.setValue(reminders.planSound).onChange(async (value) => {
          reminders.planSound = value;
          await save();
        })
      );
      const system = new Setting(details).setName('System Notification').setDesc('Also notify through the operating system (desktop only)');
      this.withIcon(system, 'monitor');
      system.addToggle((toggle) =>
        toggle.setValue(reminders.planSystemNotification).onChange(async (value) => {
          reminders.planSystemNotification = value;
          await save();
        })
      );
    };
    enable.addToggle((toggle) =>
      toggle.setValue(reminders.planReminders).onChange(async (value) => {
        reminders.planReminders = value;
        await save();
        renderDetails();
      })
    );
    renderDetails();
  }

  private renderReminderSettings(containerEl: HTMLElement): void {
    const reminders = this.plugin.settings.reminders;

    this.renderSectionHeader(
      containerEl,
      'bell-ring',
      'Daily Reminders',
      'Periodic full-screen alerts for the tasks you care about.'
    );

    const enableSetting = new Setting(containerEl)
      .setName('Enable Daily Reminders')
      .setDesc('Turn the whole reminder system on or off');
    this.withIcon(enableSetting, 'power');

    const detailsEl = containerEl.createDiv('taskpro-reminder-settings');

    enableSetting
      .addToggle(toggle => toggle
        .setValue(reminders.enabled)
        .onChange(async (value) => {
          reminders.enabled = value;
          await this.plugin.saveSettings();
          this.plugin.reminderService.refresh();
          this.renderReminderDetails(detailsEl);
        }));

    this.renderReminderDetails(detailsEl);
  }

  private renderReminderDetails(container: HTMLElement): void {
    container.empty();

    const reminders = this.plugin.settings.reminders;
    const language = this.plugin.settings.badgeLanguage;

    if (!reminders.enabled) {
      container.createEl('p', {
        text: 'Reminders are disabled. Enable them to configure schedule, sound and filters.',
        cls: 'setting-item-description',
      });
      return;
    }

    const save = async () => {
      await this.plugin.saveSettings();
      this.plugin.reminderService.refresh();
    };

    // ── Note sources ──────────────────────────────────────────────────────
    reminders.notePaths ??= [];
    reminders.noteSchedules ??= {};
    container.createEl('h4', { text: 'Reminder Notes' });
    container.createEl('p', {
      cls: 'setting-item-description',
      text: 'The active note is reminded by default using the global schedule below. Add other notes for independent intervals. Tasks rendered from embedded notes are excluded.',
    });

    const noteList = container.createDiv({ cls: 'taskpro-reminder-note-list' });
    const renderNoteList = () => {
      noteList.empty();
      if (reminders.notePaths.length === 0) {
        noteList.createEl('p', {
          cls: 'setting-item-description',
          text: 'No extra notes selected. Only the active note will be scanned.',
        });
        return;
      }

      for (const path of reminders.notePaths) {
        const schedule = reminders.noteSchedules[path] ?? {
          enabled: true,
          every: 1,
          unit: 'days' as ReminderIntervalUnit,
        };
        reminders.noteSchedules[path] = schedule;

        const row = new Setting(noteList)
          .setName(path)
          .setDesc(`Repeat every ${schedule.every} ${schedule.unit}`);
        this.withIcon(row, 'file-text');
        row.addToggle((toggle) => toggle
          .setTooltip('Enable this note schedule')
          .setValue(schedule.enabled)
          .onChange(async (value) => {
            schedule.enabled = value;
            await save();
          }));
        row.addText((text) => {
          text.inputEl.type = 'number';
          text.inputEl.min = '1';
          text.inputEl.step = '1';
          text.inputEl.addClass('taskpro-settings-number-input');
          text.setPlaceholder('1')
            .setValue(String(schedule.every))
            .onChange(async (value) => {
              const parsed = Math.max(1, Math.floor(Number(value) || 1));
              schedule.every = parsed;
              await save();
              row.setDesc(`Repeat every ${schedule.every} ${schedule.unit}`);
            });
        });
        row.addDropdown((dropdown) => dropdown
          .addOption('minutes', 'Minutes')
          .addOption('hours', 'Hours')
          .addOption('days', 'Days')
          .addOption('weeks', 'Weeks')
          .setValue(schedule.unit)
          .onChange(async (value) => {
            schedule.unit = value as ReminderIntervalUnit;
            await save();
            row.setDesc(`Repeat every ${schedule.every} ${schedule.unit}`);
          }));
        row.addButton((button) => button
          .setIcon('trash-2')
          .setTooltip('Remove note')
          .setWarning()
          .onClick(async () => {
            reminders.notePaths = reminders.notePaths.filter((item) => item !== path);
            delete reminders.noteSchedules[path];
            if (this.plugin.settings.reminderState?.noteLastFiredAt) {
              delete this.plugin.settings.reminderState.noteLastFiredAt[path];
            }
            await save();
            renderNoteList();
          }));
      }
    };
    renderNoteList();

    const addNoteSetting = new Setting(container)
      .setName('Add Reminder Note')
      .setDesc('Select another note. You can add multiple notes.');
    this.withIcon(addNoteSetting, 'files');
    addNoteSetting.addButton((button) => button
      .setCta()
      .setButtonText('Select Note')
      .onClick(() => {
        new NoteSelectionModal(this.app, async (file) => {
          if (reminders.notePaths.includes(file.path)) {
            new Notice('This note is already selected');
            return;
          }
          reminders.notePaths = [...reminders.notePaths, file.path];
          reminders.noteSchedules[file.path] = { enabled: true, every: 1, unit: 'days' };
          const lastByPath = this.plugin.settings.reminderState?.noteLastFiredAt ?? {};
          this.plugin.settings.reminderState = {
            ...this.plugin.settings.reminderState,
            noteLastFiredAt: { ...lastByPath, [file.path]: Date.now() },
          };
          await save();
          renderNoteList();
        }).open();
      }));

    // ── Schedule ──────────────────────────────────────────────────────────
    container.createEl('h4', { text: 'Schedule' });

    new Setting(container)
      .setName('Daily Times')
      .setDesc('Comma separated 24h times, e.g. 09:00, 14:30. Invalid entries are ignored.')
      .addText(text => text
        .setPlaceholder('09:00, 18:00')
        .setValue(reminders.dailyTimes.join(', '))
        .onChange(async (value) => {
          const { times, invalid } = parseDailyTimes(value);
          reminders.dailyTimes = times;
          await save();
          if (invalid.length > 0) {
            new Notice(`Ignored invalid time(s): ${invalid.join(', ')}`);
          }
        }));

    new Setting(container)
      .setName('Repeat During the Day')
      .setDesc('Also remind again after a fixed interval')
      .addToggle(toggle => toggle
        .setValue(reminders.repeatEnabled)
        .onChange(async (value) => {
          reminders.repeatEnabled = value;
          await save();
          this.renderReminderDetails(container);
        }));

    if (reminders.repeatEnabled) {
      new Setting(container)
        .setName('Repeat Interval (minutes)')
        .setDesc('Minimum time between two repeated reminders')
        .addSlider(slider => slider
          .setLimits(15, 480, 15)
          .setValue(reminders.repeatIntervalMinutes)
          .setDynamicTooltip()
          .onChange(async (value) => {
            reminders.repeatIntervalMinutes = value;
            await save();
          }));
    }

    new Setting(container)
      .setName('Quiet Hours')
      .setDesc('Never show reminders inside this time range')
      .addToggle(toggle => toggle
        .setValue(reminders.quietHoursEnabled)
        .onChange(async (value) => {
          reminders.quietHoursEnabled = value;
          await save();
          this.renderReminderDetails(container);
        }));

    if (reminders.quietHoursEnabled) {
      new Setting(container)
        .setName('Quiet Hours Range')
        .setDesc('Start and end time (24h). Ranges may cross midnight.')
        .addText(text => text
          .setPlaceholder('23:00')
          .setValue(reminders.quietHoursStart)
          .onChange(async (value) => {
            const trimmed = value.trim();
            if (!TIME_PATTERN.test(trimmed)) return;
            reminders.quietHoursStart = trimmed;
            await save();
          }))
        .addText(text => text
          .setPlaceholder('07:00')
          .setValue(reminders.quietHoursEnd)
          .onChange(async (value) => {
            const trimmed = value.trim();
            if (!TIME_PATTERN.test(trimmed)) return;
            reminders.quietHoursEnd = trimmed;
            await save();
          }));
    }

    // ── Strictness ────────────────────────────────────────────────────────
    container.createEl('h4', { text: 'Strictness' });

    new Setting(container)
      .setName('Alert Strictness')
      .setDesc('Gentle: a toast. Normal: dismissible full-screen alert. Strict: must be acknowledged.')
      .addDropdown(dropdown => dropdown
        .addOption('gentle', 'Gentle (toast)')
        .addOption('normal', 'Normal (full screen)')
        .addOption('strict', 'Strict (forced)')
        .setValue(reminders.strictness)
        .onChange(async (value) => {
          reminders.strictness = value as ReminderStrictness;
          await save();
          this.renderReminderDetails(container);
        }));

    if (reminders.strictness === 'strict') {
      new Setting(container)
        .setName('Acknowledge Delay (seconds)')
        .setDesc('How long the acknowledge button stays locked')
        .addSlider(slider => slider
          .setLimits(0, 30, 1)
          .setValue(reminders.strictHoldSeconds)
          .setDynamicTooltip()
          .onChange(async (value) => {
            reminders.strictHoldSeconds = value;
            await save();
          }));
    } else {
      new Setting(container)
        .setName('Auto Dismiss (seconds)')
        .setDesc('Close the alert automatically. 0 keeps it open until dismissed.')
        .addSlider(slider => slider
          .setLimits(0, 120, 5)
          .setValue(reminders.autoDismissSeconds)
          .setDynamicTooltip()
          .onChange(async (value) => {
            reminders.autoDismissSeconds = value;
            await save();
          }));

      new Setting(container)
        .setName('Snooze Duration (minutes)')
        .setDesc('0 hides the snooze button')
        .addSlider(slider => slider
          .setLimits(0, 120, 5)
          .setValue(reminders.snoozeMinutes)
          .setDynamicTooltip()
          .onChange(async (value) => {
            reminders.snoozeMinutes = value;
            await save();
          }));
    }

    new Setting(container)
      .setName('Custom Message')
      .setDesc('Leave empty for the default text. Placeholders: {count}, {top}, {date}')
      .addText(text => text
        .setPlaceholder('{count} tasks need your attention today')
        .setValue(reminders.message)
        .onChange(async (value) => {
          reminders.message = value;
          await save();
        }));

    new Setting(container)
      .setName('System Notification')
      .setDesc('Also send an OS level notification (desktop only)')
      .addToggle(toggle => toggle
        .setValue(reminders.systemNotification)
        .onChange(async (value) => {
          reminders.systemNotification = value;
          await save();
        }));

    // ── Sound ─────────────────────────────────────────────────────────────
    container.createEl('h4', { text: 'Sound' });

    new Setting(container)
      .setName('Play Sound')
      .addToggle(toggle => toggle
        .setValue(reminders.soundEnabled)
        .onChange(async (value) => {
          reminders.soundEnabled = value;
          await save();
          this.renderReminderDetails(container);
        }));

    if (reminders.soundEnabled) {
      new Setting(container)
        .setName('Sound')
        .setDesc('Built-in tones are generated locally. "Custom" uses an audio file from your vault.')
        .addDropdown(dropdown => dropdown
          .addOption('chime', 'Chime')
          .addOption('bell', 'Bell')
          .addOption('alarm', 'Alarm')
          .addOption('custom', 'Custom file')
          .addOption('none', 'Silent')
          .setValue(reminders.sound)
          .onChange(async (value) => {
            reminders.sound = value as ReminderSound;
            await save();
            this.renderReminderDetails(container);
          }));

      if (reminders.sound === 'custom') {
        new Setting(container)
          .setName('Custom Sound Path')
          .setDesc('Vault-relative path, e.g. Assets/alarm.mp3')
          .addText(text => text
            .setPlaceholder('Assets/alarm.mp3')
            .setValue(reminders.customSoundPath)
            .onChange(async (value) => {
              reminders.customSoundPath = value.trim();
              await save();
            }));
      }

      new Setting(container)
        .setName('Volume')
        .addSlider(slider => slider
          .setLimits(0, 100, 5)
          .setValue(Math.round(reminders.soundVolume * 100))
          .setDynamicTooltip()
          .onChange(async (value) => {
            reminders.soundVolume = value / 100;
            await save();
          }));

      new Setting(container)
        .setName('Repeat Sound Until Dismissed')
        .setDesc('Keeps playing while the alert is open')
        .addToggle(toggle => toggle
          .setValue(reminders.soundRepeat)
          .onChange(async (value) => {
            reminders.soundRepeat = value;
            await save();
          }));
    }

    // ── Which tasks ───────────────────────────────────────────────────────
    this.renderSectionHeader(
      container,
      'list-checks',
      'Task Selection',
      'All unfinished tasks ([ ], [/], [!]) are read directly from the active note and your selected notes. Completed tasks are skipped.'
    );

    new Setting(container)
      .setName('Maximum Tasks Shown')
      .setDesc('Longer lists are summarised with a "and N more" line')
      .addSlider(slider => slider
        .setLimits(3, 40, 1)
        .setValue(reminders.maxTasksShown)
        .setDynamicTooltip()
        .onChange(async (value) => {
          reminders.maxTasksShown = value;
          await save();
        }));

    const previewSetting = new Setting(container)
      .setName('Preview')
      .setDesc('Try the alert or just the sound, using the current settings');
    this.withIcon(previewSetting, 'play-circle');
    previewSetting
      .addButton(button => button
        .setButtonText('Test Sound')
        .onClick(() => {
          this.previewSound();
        }))
      .addButton(button => button
        .setButtonText('Stop Sound')
        .onClick(() => {
          this.previewPlayer?.stop();
        }))
      .addButton(button => button
        .setCta()
        .setButtonText('Test Reminder')
        .onClick(() => {
          this.previewPlayer?.stop();
          void this.plugin.reminderService.triggerNow();
        }));
  }

  /**
   * Plays the configured reminder sound once so the user can judge it without
   * opening a full alert. Failures are surfaced instead of silently ignored.
   */
  private previewSound(): void {
    const reminders = this.plugin.settings.reminders;

    if (!reminders.soundEnabled || reminders.sound === 'none') {
      new Notice('Sound is turned off for reminders');
      return;
    }

    this.previewPlayer ??= new ReminderSoundPlayer(this.app);
    // Never loop a preview, however the reminder itself is configured.
    const result = this.previewPlayer.play({ ...reminders, soundRepeat: false });

    if (!result.ok) {
      const reason =
        result.reason === 'file-not-found'
          ? `Audio file not found: ${reminders.customSoundPath}`
          : result.reason === 'empty-path'
            ? 'Set a custom sound path first'
            : 'Could not play the reminder sound';
      new Notice(reason);
    }
  }

  private renderGlobalTasks(container: HTMLElement): void {
    container.empty();

    for (const task of this.plugin.settings.globalInternalTasks) {
      const taskSetting = new Setting(container)
        .setName(task.content)
        .setDesc(`Status: ${task.status}`)
        .addText(text => text
          .setPlaceholder('Task content')
          .setValue(task.content)
          .onChange(async (value) => {
            task.content = value;
            await this.plugin.saveSettings();
          }))
        .addDropdown(dropdown => dropdown
          .addOption('[ ]', 'Not Started')
          .addOption('[/]', 'In Progress')
          .addOption('[x]', 'Done')
          .setValue(task.status)
          .onChange(async (value) => {
            task.status = value as '[ ]' | '[/]' | '[x]';
            await this.plugin.saveSettings();
            this.renderGlobalTasks(container);
          }))
        .addButton(button => button
          .setButtonText('Delete')
          .setWarning()
          .onClick(async () => {
            const index = this.plugin.settings.globalInternalTasks.indexOf(task);
            if (index > -1) {
              this.plugin.settings.globalInternalTasks.splice(index, 1);
              await this.plugin.saveSettings();
              this.renderGlobalTasks(container);
            }
          }));
    }
  }
}
