// ── board/quick-add-sheet.ts ──────────────────────────────────────────────
// New tasks on a phone: one line of words, read as you type. "call Sara
// tomorrow 9 #work !high" becomes a task for tomorrow at nine, tagged and
// urgent, and what was understood is shown under the line as chips, so there
// is never a surprise. Anyone who would rather tap than type has the same
// things as buttons under it, and what they tap is written into the line, so
// the line is always the whole truth. Adding clears the line and keeps the
// sheet (and the keyboard) open for the next one.
// ─────────────────────────────────────────────────────────────────────────────

import { setIcon } from 'obsidian';
import { openCalendarPopover, PopoverHandle } from '../calendar/calendar-popover';
import { DayKey, addDays, formatClock, mediumDay, parseClock, todayKey, toDayKey } from '../calendar/calendar-dates';
import { scheduleText } from '../calendar/schedule-text';
import { normalizeTagKey } from '../task-metadata';
import { TaskTag, resolveTag, resolveTagColor } from '../tags';
import {
  CalendarSystem,
  CHIP_ICON_NAMES,
  Language,
  PRIORITY_ICON_NAMES,
  PRIORITY_LABELS,
  TASK_PRIORITIES,
  TaskPriority,
  TimeFormat,
} from '../types';
import { autoDirection } from '../ui/fields';
import { haptic } from '../ui/haptics';
import { BoardLabels } from './board-localization';
import { renderDayPicker } from './day-picker';
import { Parsed, Span, SpanKind, appendWord, parseQuickAdd, removeSpan, replaceSpan } from './quick-add';

export interface QuickAddContext {
  container: HTMLElement;
  anchor: HTMLElement;
  language: Language;
  labels: BoardLabels;
  /** The word on the button that adds. */
  addLabel: string;
  system: CalendarSystem;
  timeFormat: TimeFormat;
  weekStartsOn: number;
  tags: readonly TaskTag[];
  /** For the field's text direction. */
  direction: Parameters<typeof autoDirection>[1];
  /** The note this task would go into, and whether the owner may pick another. */
  destination(parsed: Parsed): { name: string; choosable: boolean };
  chooseNote(done: () => void): void;
  /** Writes the task. Resolves the note's name, or null when it could not be written. */
  add(parsed: Parsed): Promise<string | null>;
  hold(on: boolean): void;
}

type Tray = 'main' | 'date' | 'priority' | 'tags' | 'remind';

const PRIORITY_WORDS: Record<Language, Record<TaskPriority, string>> = {
  en: { highest: '!highest', high: '!high', medium: '!medium', low: '!low', lowest: '!lowest' },
  fa: { highest: '!بحرانی', high: '!زیاد', medium: '!متوسط', low: '!کم', lowest: '!خیلی‌کم' },
};

const DAY_WORDS: Record<Language, { today: string; tomorrow: string; nextWeek: string }> = {
  en: { today: 'today', tomorrow: 'tomorrow', nextWeek: 'next week' },
  fa: { today: 'امروز', tomorrow: 'فردا', nextWeek: 'هفته بعد' },
};

const REMIND_WORDS: Record<Language, { hour: string; evening: string; tomorrow: string }> = {
  en: { hour: 'remind in 1 hour', evening: 'remind 18:00', tomorrow: 'remind tomorrow 9' },
  fa: { hour: 'یادآوری ۱ ساعت دیگه', evening: 'یادآوری ۱۸:۰۰', tomorrow: 'یادآوری فردا ساعت ۹' },
};

const KIND_ORDER: SpanKind[] = ['plan', 'remind', 'due', 'priority', 'tag'];

export function openQuickAddSheet(ctx: QuickAddContext): PopoverHandle {
  const { labels, language } = ctx;
  ctx.hold(true);
  return openCalendarPopover({
    container: ctx.container,
    anchor: ctx.anchor,
    cls: 'taskpro-qa',
    rtl: language === 'fa',
    onClose: () => ctx.hold(false),
    build: (el, handle) => build(el, handle, ctx),
  });
}

function build(el: HTMLElement, handle: PopoverHandle, ctx: QuickAddContext): void {
  const { labels, language } = ctx;
  el.setAttribute('aria-labelledby', 'taskpro-qa-title');
  el.setAttribute('aria-modal', 'true');

  const skip = new Set<string>();
  /** Readings a button wrote: taking one away takes its words out of the line. */
  const written = new Set<string>();
  let tray: Tray = 'main';
  let added = 0;

  // ── Header ──
  const head = el.createDiv({ cls: 'taskpro-qa__head' });
  head.createEl('h2', { cls: 'taskpro-qa__title', text: labels.qaTitle, attr: { id: 'taskpro-qa-title' } });
  const close = head.createEl('button', { cls: 'taskpro-qa__close', attr: { 'aria-label': labels.qaClose } });
  close.type = 'button';
  setIcon(close, 'x');
  close.addEventListener('click', () => handle.close());

  // ── The line ──
  const input = el.createEl('input', {
    type: 'text',
    cls: 'taskpro-qa__input',
    attr: {
      placeholder: labels.qaHint,
      'aria-label': labels.addPlaceholder,
      dir: 'auto',
      enterkeyhint: 'done',
      autocomplete: 'off',
      autocapitalize: 'sentences',
      spellcheck: 'true',
    },
  });
  autoDirection(input, ctx.direction);

  // ── What was understood ──
  const read = el.createDiv({
    cls: 'taskpro-qa__read',
    attr: { role: 'list', 'aria-label': labels.qaUnderstood, 'aria-live': 'polite', 'aria-relevant': 'additions removals' },
  });

  // ── What can be tapped instead of typed ──
  const trayEl = el.createDiv({ cls: 'taskpro-qa__tray' });

  // ── The foot: where it goes, and Add ──
  const status = el.createDiv({ cls: 'taskpro-qa__status', attr: { role: 'status', 'aria-live': 'polite' } });
  const foot = el.createDiv({ cls: 'taskpro-qa__foot' });
  const dest = foot.createEl('button', { cls: 'taskpro-qa__dest' });
  dest.type = 'button';
  setIcon(dest.createSpan({ cls: 'taskpro-qa__dest-icon', attr: { 'aria-hidden': 'true' } }), 'file-plus');
  const destName = dest.createSpan({ cls: 'taskpro-qa__dest-name', attr: { dir: 'auto' } });
  const add = foot.createEl('button', { cls: 'mod-cta taskpro-qa__add', text: ctx.addLabel });
  add.type = 'button';

  const clock = () => {
    const now = new Date();
    return { today: toDayKey(now), minutes: now.getHours() * 60 + now.getMinutes() };
  };
  const parse = (text = input.value, forget: ReadonlySet<string> = skip): Parsed => parseQuickAdd(text, clock(), forget);
  let parsed = parse();

  const lastOf = (kind: SpanKind, from: Parsed = parsed): Span | undefined => [...(from.spans ?? [])].reverse().find((span) => span.kind === kind);

  /** Writes a line back into the field and reads it again. */
  const setLine = (text: string, kind?: SpanKind) => {
    input.value = text;
    parsed = parse();
    if (kind) {
      const span = lastOf(kind);
      if (span) written.add(span.key);
    }
    draw();
  };

  // ── Chips ──
  let shown = '';
  const drawRead = () => {
    const spans: Array<{ span: Span; kind: SpanKind; text: string; icon: string | null; dot?: string }> = [];
    const timeText = (time: string) => {
      const minutes = parseClock(time);
      return minutes === null ? time : formatClock(minutes, ctx.timeFormat, language);
    };
    for (const kind of KIND_ORDER) {
      const mine = (parsed.spans ?? []).filter((span) => span.kind === kind);
      if (!mine.length) continue;
      if (kind === 'tag') {
        for (const span of mine) {
          const tag = resolveTag(normalizeTagKey(span.text.replace(/^#/, '')), ctx.tags);
          spans.push({ span, kind, text: tag.name, icon: null, dot: resolveTagColor(tag.color) });
        }
        continue;
      }
      const span = mine[mine.length - 1];
      if (kind === 'plan' && parsed.plan) {
        spans.push({
          span,
          kind,
          text: scheduleText(parsed.plan, { language, calendarSystem: ctx.system, timeFormat: ctx.timeFormat }),
          icon: parsed.plan.start ? CHIP_ICON_NAMES.schedule : CHIP_ICON_NAMES.scheduleDay,
        });
      } else if (kind === 'remind' && parsed.remind) {
        spans.push({ span, kind, text: labels.qaReminder(`${mediumDay(parsed.remind.date, ctx.system, language)} ${timeText(parsed.remind.time)}`), icon: 'bell' });
      } else if (kind === 'due' && parsed.deadline) {
        spans.push({ span, kind, text: labels.qaDue(mediumDay(parsed.deadline, ctx.system, language)), icon: CHIP_ICON_NAMES.deadline });
      } else if (kind === 'priority' && parsed.priority) {
        spans.push({ span, kind, text: PRIORITY_LABELS[language][parsed.priority], icon: PRIORITY_ICON_NAMES[parsed.priority] });
      }
    }
    // Only redrawn when something changed, so a screen reader hears what is new and not the whole list again.
    const signature = JSON.stringify(spans.map((one) => [one.kind, one.text, one.span.key, written.has(one.span.key)]));
    if (signature === shown) return;
    shown = signature;
    read.empty();
    read.toggleClass('is-empty', spans.length === 0);
    for (const one of spans) {
      const chip = read.createDiv({ cls: `taskpro-qa__chip is-${one.kind}`, attr: { role: 'listitem' } });
      if (one.dot) chip.createSpan({ cls: 'taskpro-qa__chip-dot', attr: { 'aria-hidden': 'true' } }).style.setProperty('--taskpro-dot', one.dot);
      else if (one.icon) setIcon(chip.createSpan({ cls: 'taskpro-qa__chip-icon', attr: { 'aria-hidden': 'true' } }), one.icon);
      chip.createSpan({ cls: 'taskpro-qa__chip-text', text: one.text, attr: { dir: 'auto' } });
      // Taken out, a reading goes back to being words — unless a button wrote it, and then it goes altogether.
      const wrote = written.has(one.span.key);
      const x = chip.createEl('button', {
        cls: 'taskpro-qa__chip-x',
        attr: { 'aria-label': `${wrote ? labels.qaRemoveFromTask : labels.qaKeepAsWords}: ${one.text}` },
      });
      x.type = 'button';
      setIcon(x, 'x');
      keepFocus(x);
      x.addEventListener('click', () => {
        if (wrote) {
          written.delete(one.span.key);
          setLine(removeSpan(input.value, one.span));
        } else {
          skip.add(one.span.key);
          parsed = parse();
          draw();
        }
        input.focus({ preventScroll: true });
      });
    }
    if (!spans.length) read.createSpan({ cls: 'taskpro-qa__read-hint', text: labels.qaHint });
  };

  // ── The tray ──
  const tool = (parent: HTMLElement, icon: string | null, label: string, active: boolean, onTap: () => void, color?: string, opens = false): HTMLButtonElement => {
    const button = parent.createEl('button', { cls: 'taskpro-qa__tool' });
    button.type = 'button';
    button.toggleClass('is-active', active);
    // A button that opens a tray of choices is not a switch; the others are.
    if (!opens) button.setAttribute('aria-pressed', String(active));
    if (color) button.createSpan({ cls: 'taskpro-qa__chip-dot', attr: { 'aria-hidden': 'true' } }).style.setProperty('--taskpro-dot', color);
    else if (icon) setIcon(button.createSpan({ cls: 'taskpro-qa__tool-icon', attr: { 'aria-hidden': 'true' } }), icon);
    button.createSpan({ cls: 'taskpro-qa__tool-text', text: label, attr: { dir: 'auto' } });
    keepFocus(button);
    button.addEventListener('click', onTap);
    return button;
  };
  const back = (parent: HTMLElement) => {
    const button = parent.createEl('button', { cls: 'taskpro-qa__back', attr: { 'aria-label': labels.qaBack } });
    button.type = 'button';
    setIcon(button, language === 'fa' ? 'chevron-right' : 'chevron-left');
    keepFocus(button);
    button.addEventListener('click', () => go('main'));
    return button;
  };
  const go = (to: Tray) => {
    tray = to;
    drawTray();
    if (to === 'date') input.blur();
    else input.focus({ preventScroll: true });
  };

  /** A day for the plan, keeping the time it already has. */
  const setDay = (word: string) => {
    const plan = parsed.plan;
    const time = plan?.start ? ` ${plan.start}${plan.end ? `-${plan.end}` : ''}` : '';
    setLine(replaceSpan(input.value, lastOf('plan'), `${word}${time}`), 'plan');
  };

  const drawTray = () => {
    trayEl.empty();
    trayEl.dataset.tray = tray;
    const words = DAY_WORDS[language];
    if (tray === 'main') {
      const row = trayEl.createDiv({ cls: 'taskpro-qa__tools' });
      const today = todayKey();
      tool(row, 'sun', labels.qaToday, parsed.plan?.date === today, () => setDay(words.today));
      tool(row, 'sunrise', labels.qaTomorrow, parsed.plan?.date === addDays(today, 1), () => setDay(words.tomorrow));
      tool(row, 'calendar-days', labels.qaPickDate, !!parsed.plan, () => go('date'), undefined, true);
      tool(row, 'flag', labels.qaPriority, !!parsed.priority, () => go('priority'), undefined, true);
      tool(row, 'tag', labels.qaTags, parsed.tags.length > 0, () => go('tags'), undefined, true);
      tool(row, 'bell', labels.qaRemind, !!parsed.remind, () => go('remind'), undefined, true);
      return;
    }
    const header = trayEl.createDiv({ cls: 'taskpro-qa__tools is-sub' });
    back(header);
    if (tray === 'date') {
      tool(header, null, labels.qaToday, false, () => (setDay(words.today), go('main')), undefined, true);
      tool(header, null, labels.qaTomorrow, false, () => (setDay(words.tomorrow), go('main')), undefined, true);
      tool(header, null, labels.qaNextWeek, false, () => (setDay(words.nextWeek), go('main')), undefined, true);
      const picker = renderDayPicker(trayEl, {
        selected: parsed.plan?.date ?? null,
        today: todayKey(),
        system: ctx.system,
        language,
        weekStartsOn: ctx.weekStartsOn,
        previousLabel: labels.qaPrevMonth,
        nextLabel: labels.qaNextMonth,
        onPick: (day: DayKey) => {
          setDay(day);
          status.setText(labels.qaPickedDay(mediumDay(day, ctx.system, language)));
          go('main');
        },
      });
      picker.el.addClass('is-in-qa');
      return;
    }
    if (tray === 'priority') {
      const row = trayEl.createDiv({ cls: 'taskpro-qa__tools is-wrap' });
      for (const level of TASK_PRIORITIES) {
        tool(row, PRIORITY_ICON_NAMES[level], PRIORITY_LABELS[language][level], parsed.priority === level, () => {
          const current = lastOf('priority');
          if (parsed.priority === level && current) {
            written.delete(current.key);
            setLine(removeSpan(input.value, current));
          } else {
            setLine(replaceSpan(input.value, current, PRIORITY_WORDS[language][level]), 'priority');
          }
          go('main');
        });
      }
      return;
    }
    if (tray === 'tags') {
      const row = trayEl.createDiv({ cls: 'taskpro-qa__tools is-wrap' });
      if (!ctx.tags.length) row.createSpan({ cls: 'taskpro-qa__none', text: labels.qaNoTags });
      for (const tag of ctx.tags) {
        const mine = (parsed.spans ?? []).find((span) => span.kind === 'tag' && normalizeTagKey(span.text.replace(/^#/, '')) === tag.key);
        tool(row, null, tag.name, !!mine, () => {
          if (mine) {
            written.delete(mine.key);
            setLine(removeSpan(input.value, mine));
          } else {
            setLine(appendWord(input.value, `#${tag.key}`), 'tag');
          }
        }, resolveTagColor(tag.color));
      }
      return;
    }
    const row = trayEl.createDiv({ cls: 'taskpro-qa__tools is-wrap' });
    const choices: Array<[string, string]> = [
      [labels.qaRemindHour, REMIND_WORDS[language].hour],
      [labels.qaRemindEvening, REMIND_WORDS[language].evening],
      [labels.qaRemindTomorrow, REMIND_WORDS[language].tomorrow],
    ];
    for (const [label, words] of choices) {
      tool(row, 'bell', label, false, () => {
        setLine(replaceSpan(input.value, lastOf('remind'), words), 'remind');
        go('main');
      }, undefined, true);
    }
  };

  // ── Foot ──
  const drawFoot = () => {
    const target = ctx.destination(parsed);
    destName.setText(labels.qaGoesTo(target.name));
    dest.toggleClass('is-fixed', !target.choosable);
    dest.setAttribute('aria-disabled', String(!target.choosable));
    dest.tabIndex = target.choosable ? 0 : -1;
    const ready = parsed.title.trim().length > 0;
    add.toggleClass('is-idle', !ready);
    add.setAttribute('aria-disabled', String(!ready));
  };

  const draw = () => {
    drawRead();
    drawTray();
    drawFoot();
  };

  dest.addEventListener('click', () => {
    if (!ctx.destination(parsed).choosable) return;
    ctx.chooseNote(drawFoot);
  });

  let busy = false;
  const submit = async () => {
    if (busy) return;
    parsed = parse();
    if (!parsed.title.trim()) {
      status.setText(labels.qaNeedsTitle);
      status.addClass('is-error');
      haptic('warning');
      input.focus({ preventScroll: true });
      return;
    }
    busy = true;
    add.setAttribute('aria-busy', 'true');
    const note = await ctx.add(parsed);
    busy = false;
    add.removeAttribute('aria-busy');
    if (!note) return;
    added++;
    haptic('success');
    status.removeClass('is-error');
    // The same line again for a second task would say nothing new to a screen reader: count them.
    status.setText(added > 1 ? `${labels.qaAddedLine(parsed.title, note)} (${added})` : labels.qaAddedLine(parsed.title, note));
    skip.clear();
    written.clear();
    tray = 'main';
    shown = '';
    input.value = '';
    parsed = parse();
    draw();
    input.focus({ preventScroll: true });
  };
  add.addEventListener('click', () => void submit());
  input.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.isComposing) return;
    event.preventDefault();
    void submit();
  });
  input.addEventListener('input', () => {
    status.removeClass('is-error');
    parsed = parse();
    draw();
  });

  draw();
  window.setTimeout(() => input.focus(), 60);
}

/**
 * A button that does not take the keyboard away from the field: on a phone a
 * tap on a button would otherwise close it, and open it again for the next
 * word. A keyboard or a switch still reaches it, and the click still comes.
 */
function keepFocus(button: HTMLElement): void {
  button.addEventListener('mousedown', (event) => event.preventDefault());
  button.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'touch') event.preventDefault();
  });
}
