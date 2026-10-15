// Pure state transitions. Never invent completed focus sessions while the app is closed.
import { Language, TaskTimer } from './types';

export interface PomodoroConfig {
  phase: 'focus' | 'short-break' | 'long-break';
  focusMinutes: number;
  shortBreakMinutes: number;
  longBreakMinutes: number;
  longBreakEvery: number;
  targetRounds: number;
  completedRounds: number;
  autoStart: boolean;
}
export function newPomodoro(): PomodoroConfig {
  return { phase: 'focus', focusMinutes: 25, shortBreakMinutes: 5, longBreakMinutes: 15,
    longBreakEvery: 4, targetRounds: 4, completedRounds: 0, autoStart: false };
}
export function pomodoroDuration(p: PomodoroConfig): number {
  return 60 * (p.phase === 'focus' ? p.focusMinutes : p.phase === 'short-break' ? p.shortBreakMinutes : p.longBreakMinutes);
}
export function finishPomodoroPhase(timer: TaskTimer, now: number): TaskTimer {
  const p = timer.pomodoro;
  if (!p) return timer;
  const completedRounds = p.completedRounds + (p.phase === 'focus' ? 1 : 0);
  if (p.phase === 'focus' && completedRounds >= p.targetRounds) {
    return { ...timer, elapsedSeconds: timer.durationSeconds, runningSince: 0, completedAt: now,
      notifiedAt: now, pomodoro: { ...p, completedRounds } };
  }
  const phase = p.phase !== 'focus' ? 'focus'
    : completedRounds % p.longBreakEvery === 0 ? 'long-break' : 'short-break';
  const next = { ...p, completedRounds, phase } as PomodoroConfig;
  return { ...timer, pomodoro: next, durationSeconds: pomodoroDuration(next), elapsedSeconds: 0,
    runningSince: p.autoStart ? now : 0, completedAt: undefined, notifiedAt: undefined };
}
export function pomodoroText(timer: TaskTimer, language: Language): string {
  const p = timer.pomodoro;
  if (!p) return '';
  const labels = language === 'fa'
    ? { focus: 'تمرکز', 'short-break': 'استراحت کوتاه', 'long-break': 'استراحت بلند' }
    : { focus: 'Focus', 'short-break': 'Short break', 'long-break': 'Long break' };
  return `${labels[p.phase]} · ${p.completedRounds}/${p.targetRounds}`;
}
export function pomodoroLabels(language: Language) {
  return language === 'fa'
    ? { enabled: 'فعال‌سازی پومودورو', short: 'استراحت کوتاه (دقیقه)', long: 'استراحت بلند (دقیقه)',
      every: 'استراحت بلند بعد از چند دور', target: 'تعداد دور هدف', auto: 'شروع خودکار مرحلهٔ بعد',
      invalid: 'همهٔ مقادیر باید عدد صحیح بین ۱ تا ۱۴۴۰ باشند', phaseDone: 'مرحله تمام شد؛ مرحلهٔ بعد:',
      ready: 'آمادهٔ شروع', running: 'در حال اجرا', finished: 'پومودورو کامل شد' }
    : { enabled: 'Enable Pomodoro', short: 'Short break (minutes)', long: 'Long break (minutes)',
      every: 'Long break every (rounds)', target: 'Target focus rounds', auto: 'Auto-start next phase',
      invalid: 'All values must be whole numbers from 1 to 1440', phaseDone: 'Phase finished; next:',
      ready: 'Ready to start', running: 'Running', finished: 'Pomodoro complete' };
}
