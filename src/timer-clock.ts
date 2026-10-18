import { Notice } from 'obsidian';
import type { TimerPopoverOptions } from './timer-popover';
import { formatTimerClock, timerRemainingSeconds, timerState } from './types';
import { pomodoroText } from './pomodoro';
import { getTimerLabels } from './timer-localization';
import { openTaskProPanel } from './ui/panel';

/** Live controls share the service's timer rather than a captured countdown copy. */
export function showTimerClock(options: TimerPopoverOptions, configure: () => void): void {
  const language = options.language ?? 'en';
  const fa = language === 'fa';
  const labels = getTimerLabels(language);
  let unsubscribe: (() => void) | undefined;
  let fallback: ReturnType<typeof setInterval> | undefined;
  let current = options.timer;
  let busy = false;
  const previouslyFocused = document.activeElement as HTMLElement | null;
  const { panel, body, footer, close } = openTaskProPanel(fa ? 'ساعت تمرکز' : 'Focus clock', {
    onClose: () => { unsubscribe?.(); if (fallback) clearInterval(fallback); if (previouslyFocused?.isConnected) previouslyFocused.focus(); },
  });
  panel.addClass('taskpro-clock-panel');
  panel.setAttribute('dir', fa ? 'rtl' : 'ltr');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-label', fa ? 'ساعت تمرکز' : 'Focus clock');
  body.createDiv({ cls: 'taskpro-clock__task', text: current.label ?? labels.timerLabel });
  const phase = body.createDiv({ cls: 'taskpro-clock__phase' });
  const face = body.createDiv({ cls: 'taskpro-clock__face' });
  const time = face.createDiv({ cls: 'taskpro-clock__time', attr: { dir: 'ltr', role: 'timer', 'aria-live': 'off' } });
  const status = face.createDiv({ cls: 'taskpro-clock__status', attr: { role: 'status' } });
  const rounds = body.createDiv({ cls: 'taskpro-clock__rounds' });
  const controls = body.createDiv({ cls: 'taskpro-clock__controls' });
  const button = (parent: HTMLElement, text: string, run: () => void | Promise<void>, primary = false) => {
    const el = parent.createEl('button', { cls: `taskpro-panel__btn${primary ? ' mod-cta' : ''}`, text });
    el.type = 'button';
    el.addEventListener('click', async () => {
      if (busy) return;
      busy = true; redraw();
      try { await run(); }
      catch { new Notice(fa ? 'تغییر تایمر ناموفق بود' : 'Could not update the timer'); }
      finally { busy = false; redraw(); }
    });
    return el;
  };
  const toggle = button(controls, '', () => timerState(current) === 'running' ? options.onPause() : options.onStart(), true);
  button(controls, labels.reset, options.onReset);
  const extras = body.createDiv({ cls: 'taskpro-clock__controls' });
  button(extras, labels.extend(5), () => options.onExtend(5));
  button(extras, labels.changeDuration, () => { close(); configure(); });
  button(footer, fa ? 'بستن' : 'Close', close);
  button(footer, labels.removeTimer, async () => { await options.onChange(null); close(); });
  const redraw = () => {
    const timer = options.getTimer ? options.getTimer() : current;
    if (!timer) { close(); return; }
    current = timer;
    const state = timerState(timer);
    const remaining = Math.max(0, timerRemainingSeconds(timer));
    const progress = Math.min(1, Math.max(0, 1 - remaining / Math.max(1, timer.durationSeconds)));
    face.style.setProperty('--taskpro-clock-progress', `${progress * 360}deg`);
    face.dataset.state = state;
    time.setText(formatTimerClock(remaining));
    phase.setText(pomodoroText(timer, language) || labels.timerLabel);
    const text = state === 'running' ? (fa ? 'در حال اجرا' : 'Running') : state === 'done' ? (fa ? 'تمام شد' : 'Finished') : state === 'paused' ? (fa ? 'متوقف' : 'Paused') : (fa ? 'آمادهٔ شروع' : 'Ready');
    if (status.textContent !== text) status.setText(text);
    toggle.setText(state === 'running' ? labels.pause : state === 'paused' ? labels.resume : labels.start);
    const p = timer.pomodoro;
    rounds.setText(p ? (fa ? `${p.completedRounds} از ${p.targetRounds} دور تمرکز کامل شده` : `${p.completedRounds} of ${p.targetRounds} focus rounds completed`) : '');
    panel.querySelectorAll<HTMLButtonElement>('button').forEach(el => { el.disabled = busy; });
  };
  if (options.subscribe) unsubscribe = options.subscribe(redraw);
  else fallback = setInterval(redraw, 1000);
  redraw();
  panel.addEventListener('keydown', event => {
    if (event.key !== 'Tab') return;
    const enabled = Array.from(panel.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
    const first = enabled[0], last = enabled.at(-1);
    if (event.shiftKey && document.activeElement === first && last) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last && first) { event.preventDefault(); first.focus(); }
  });
  toggle.focus();
}
