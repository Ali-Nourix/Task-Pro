// ── reminders/reminder-sound.ts ───────────────────────────────────────────
// Reminder audio. Built-in tones are synthesised with the Web Audio API so the
// plugin ships no binary assets; users can also point at an audio file that
// already lives in their vault.
// ─────────────────────────────────────────────────────────────────────────────

import { App, TFile } from 'obsidian';
import { ReminderSettings } from '../types';

interface TonePattern {
  /** [frequency in Hz, start offset in seconds, duration in seconds] */
  notes: Array<[number, number, number]>;
  type: OscillatorType;
  /** Seconds between repetitions when looping. */
  loopInterval: number;
}

const PATTERNS: Record<'chime' | 'bell' | 'alarm', TonePattern> = {
  chime: {
    notes: [
      [880, 0, 0.35],
      [1108, 0.18, 0.35],
      [1318, 0.36, 0.5],
    ],
    type: 'sine',
    loopInterval: 4,
  },
  bell: {
    notes: [
      [660, 0, 1.2],
      [990, 0, 1.2],
    ],
    type: 'triangle',
    loopInterval: 3,
  },
  alarm: {
    notes: [
      [740, 0, 0.18],
      [740, 0.26, 0.18],
      [740, 0.52, 0.18],
    ],
    type: 'square',
    loopInterval: 1.6,
  },
};

/**
 * Plays reminder sounds and guarantees every resource it creates is released
 * by `stop()`, so an alert can never leave an oscillator or timer running.
 */
export class ReminderSoundPlayer {
  private audioContext: AudioContext | null = null;
  private audioElement: HTMLAudioElement | null = null;
  private loopTimer: number | null = null;
  private activeNodes: OscillatorNode[] = [];

  constructor(private readonly app: App) {}

  /**
   * Starts playback for the given settings. Failures are reported through the
   * returned value instead of throwing, because audio must never block an alert.
   */
  play(settings: ReminderSettings): { ok: boolean; reason?: string } {
    this.stop();

    if (!settings.soundEnabled || settings.sound === 'none') return { ok: true };

    const volume = Math.min(1, Math.max(0, settings.soundVolume));
    if (volume === 0) return { ok: true };

    try {
      if (settings.sound === 'custom') {
        return this.playCustomFile(settings, volume);
      }
      return this.playPattern(PATTERNS[settings.sound], volume, settings.soundRepeat);
    } catch (error) {
      console.error('TaskPro: reminder sound failed', error);
      this.stop();
      return { ok: false, reason: String(error) };
    }
  }

  stop(): void {
    if (this.loopTimer !== null) {
      window.clearInterval(this.loopTimer);
      this.loopTimer = null;
    }

    for (const node of this.activeNodes) {
      try {
        node.stop();
        node.disconnect();
      } catch {
        // Node already finished — nothing to release.
      }
    }
    this.activeNodes = [];

    if (this.audioElement) {
      this.audioElement.pause();
      this.audioElement.src = '';
      this.audioElement = null;
    }

    if (this.audioContext) {
      const context = this.audioContext;
      this.audioContext = null;
      void context.close().catch(() => undefined);
    }
  }

  private playCustomFile(settings: ReminderSettings, volume: number): { ok: boolean; reason?: string } {
    const path = settings.customSoundPath.trim();
    if (!path) return { ok: false, reason: 'empty-path' };

    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) return { ok: false, reason: 'file-not-found' };

    const audio = new Audio(this.app.vault.getResourcePath(file));
    audio.volume = volume;
    audio.loop = settings.soundRepeat;
    audio.addEventListener('error', () => {
      console.error(`TaskPro: could not play reminder sound "${path}"`);
    });
    this.audioElement = audio;

    void audio.play().catch((error) => {
      console.error('TaskPro: reminder sound playback rejected', error);
    });

    return { ok: true };
  }

  private playPattern(pattern: TonePattern, volume: number, repeat: boolean): { ok: boolean } {
    const AudioContextCtor: typeof AudioContext | undefined =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) return { ok: false };

    const context = new AudioContextCtor();
    this.audioContext = context;

    const playOnce = () => {
      if (this.audioContext !== context) return; // Stopped meanwhile.
      const startedAt = context.currentTime;

      for (const [frequency, offset, duration] of pattern.notes) {
        const oscillator = context.createOscillator();
        const gain = context.createGain();

        oscillator.type = pattern.type;
        oscillator.frequency.value = frequency;

        // Short fade in/out avoids audible clicks at note boundaries.
        gain.gain.setValueAtTime(0.0001, startedAt + offset);
        gain.gain.exponentialRampToValueAtTime(volume, startedAt + offset + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, startedAt + offset + duration);

        oscillator.connect(gain).connect(context.destination);
        oscillator.start(startedAt + offset);
        oscillator.stop(startedAt + offset + duration + 0.05);

        this.activeNodes.push(oscillator);
        oscillator.addEventListener('ended', () => {
          this.activeNodes = this.activeNodes.filter((node) => node !== oscillator);
          oscillator.disconnect();
        });
      }
    };

    playOnce();

    if (repeat) {
      this.loopTimer = window.setInterval(playOnce, pattern.loopInterval * 1000);
    }

    return { ok: true };
  }
}
