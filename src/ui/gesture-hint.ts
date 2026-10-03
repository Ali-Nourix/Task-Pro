// ── ui/gesture-hint.ts ────────────────────────────────────────────────────
// What shows while two fingers pull down to open the task board: a pill that
// comes down from the top of the screen behind the fingers, saying how far to
// go and then "release to open", so that nothing is a surprise and letting go
// is a choice. It is drawn on the page, outside the board (the gesture works
// from any note), and goes at once when the pull is over.
// ─────────────────────────────────────────────────────────────────────────────

import { setIcon } from 'obsidian';
import type { Language } from '../types';
import type { Pull } from './gestures';

const TEXT: Record<Language, { pull: string; release: string }> = {
  en: { pull: 'Pull down for the Task Board', release: 'Release to open the Task Board' },
  fa: { pull: 'برای صفحهٔ تسک‌ها به پایین بکش', release: 'رها کن تا صفحهٔ تسک‌ها باز شود' },
};

export interface GestureHint {
  /** Shows how the pull stands, or puts the hint away when `pull` is null. */
  update(pull: Pull | null, language: Language): void;
  destroy(): void;
}

export function createGestureHint(doc: Document): GestureHint {
  let el: HTMLElement | null = null;
  let label: HTMLElement | null = null;
  let wasArmed = false;

  const make = () => {
    el = doc.body.createDiv({ cls: 'taskpro-gesture-hint', attr: { 'aria-hidden': 'true' } });
    setIcon(el.createSpan({ cls: 'taskpro-gesture-hint__icon' }), 'list-checks');
    label = el.createSpan({ cls: 'taskpro-gesture-hint__text' });
  };

  return {
    update(pull, language) {
      if (!pull) {
        el?.removeClass('is-visible');
        wasArmed = false;
        return;
      }
      if (!el) make();
      const text = TEXT[language] ?? TEXT.en;
      label!.setText(pull.armed ? text.release : text.pull);
      el!.dir = language === 'fa' ? 'rtl' : 'ltr';
      el!.toggleClass('is-armed', pull.armed);
      el!.style.setProperty('--taskpro-pull', String(pull.progress));
      el!.addClass('is-visible');
      wasArmed = pull.armed;
    },
    destroy() {
      el?.remove();
      el = null;
      label = null;
      void wasArmed;
    },
  };
}
