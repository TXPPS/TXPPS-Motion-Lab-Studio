import { create } from 'zustand';

/**
 * Appearance and workstation preferences.
 *
 * These are read before the first paint, so they live in localStorage rather
 * than IndexedDB: a theme that arrives one frame late is a visible flash. They
 * are per-device, not per-project — a musician's second machine is allowed to
 * be set up differently.
 */

export type ThemeChoice = 'system' | 'dark' | 'light' | 'contrast';
/**
 * Which reading a channel meter emphasises.
 *
 * Two, not three. A BS.1770 loudness reading needs K-weighting, a gate and a
 * three-second window; the Release page measures that properly and a channel
 * strip does not measure it at all, so a "LUFS" option here could only ever
 * have relabelled the peak meter.
 */
export type MeterScale = 'peak' | 'rms';

export interface Prefs {
  theme: ThemeChoice;
  /** 0.85 – 1.4; multiplies every geometric token. */
  uiScale: number;
  /** Which reading the channel meters emphasise. */
  meterScale: MeterScale;
  /** Ballistics: how fast meters fall, in dB per second. */
  meterFallDbPerSec: number;
  /** Timeline follows the playhead during playback. */
  followPlayhead: boolean;
  /** Primary time display: bars·beats or wall clock. */
  primaryTimeDisplay: 'bbt' | 'clock';
  /** Confirm before deleting tracks or clips. */
  confirmDestructive: boolean;
  /** Reduce motion beyond the OS setting. */
  reduceMotion: boolean;
  /**
   * Arming an audio track opens its input, so the meter reads the device.
   *
   * On by default because an armed track with a dead meter cannot be told apart
   * from a broken microphone, which is how the app was reported. Off restores
   * the older behaviour for anyone who would rather the browser's capture
   * indicator stayed dark until they press the monitor button.
   */
  openInputOnArm: boolean;
  /**
   * Arming an audio track also monitors it.
   *
   * The reference has this as a named option and recommends turning it on;
   * MotionLab has it on out of the box. Implies `openInputOnArm`.
   */
  monitorFollowsArm: boolean;
  /**
   * The input a newly created audio track starts on. Empty means the system
   * default; each track can still choose its own afterwards.
   */
  defaultInputDeviceId: string;
  /**
   * Where the mix is played, when the browser lets a page choose.
   *
   * `AudioContext.setSinkId` is Chromium-only at the time of writing. Empty
   * means the system default, which is the only behaviour anywhere else.
   */
  outputDeviceId: string;
  /**
   * Sample rate the audio engine is created at, or 0 for the browser's own.
   *
   * The browser owns the device, so this is a request rather than a setting,
   * and it can only be made when the context is created — which is why the
   * preferences say so and offer to restart the engine rather than pretending
   * it took effect.
   */
  sampleRate: number;
  /**
   * The nearest thing a browser has to a buffer size.
   *
   * Web Audio has no buffer-size control. `latencyHint` is what it offers
   * instead: 'interactive' asks for the smallest buffer the device can hold,
   * 'playback' for the largest and most robust. Naming it "buffer size" would
   * be a lie about what the platform does.
   */
  latencyHint: 'interactive' | 'balanced' | 'playback';
}

export const DEFAULT_PREFS: Prefs = {
  theme: 'system',
  uiScale: 1,
  meterScale: 'peak',
  meterFallDbPerSec: 26,
  followPlayhead: true,
  primaryTimeDisplay: 'bbt',
  confirmDestructive: true,
  reduceMotion: false,
  openInputOnArm: true,
  monitorFollowsArm: true,
  defaultInputDeviceId: '',
  outputDeviceId: '',
  sampleRate: 0,
  latencyHint: 'interactive',
};

const KEY = 'motionlab.prefs.v1';

/** Rates worth offering. 0 means "whatever the browser and device agree on". */
export const RATES = [0, 44100, 48000, 88200, 96000];

function readStored(): Prefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    const parsed = JSON.parse(raw) as Partial<Prefs>;
    return {
      ...DEFAULT_PREFS,
      ...parsed,
      uiScale: clampScale(parsed.uiScale),
      // A project saved while the third option existed must not load with a
      // meter mode nothing implements.
      meterScale: parsed.meterScale === 'rms' ? 'rms' : 'peak',
      // A stored rate the browser will refuse throws inside the AudioContext
      // constructor, which would leave the app with no engine at all rather
      // than a wrong one.
      sampleRate: RATES.includes(parsed.sampleRate as number) ? (parsed.sampleRate as number) : 0,
      latencyHint: (['interactive', 'balanced', 'playback'] as const).includes(
        parsed.latencyHint as Prefs['latencyHint'],
      )
        ? (parsed.latencyHint as Prefs['latencyHint'])
        : 'interactive',
      theme: (['system', 'dark', 'light', 'contrast'] as const).includes(
        parsed.theme as ThemeChoice,
      )
        ? (parsed.theme as ThemeChoice)
        : 'system',
    };
  } catch {
    // Private mode, disabled storage, corrupt JSON — defaults are always valid.
    return { ...DEFAULT_PREFS };
  }
}

export function clampScale(v: unknown): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : 1;
  return Math.min(1.4, Math.max(0.85, Math.round(n * 100) / 100));
}

interface PrefsStore extends Prefs {
  set: (patch: Partial<Prefs>) => void;
  reset: () => void;
}

export const usePrefsStore = create<PrefsStore>((set, get) => ({
  ...readStored(),
  set: (patch) => {
    const next = { ...get(), ...patch };
    if (patch.uiScale !== undefined) next.uiScale = clampScale(patch.uiScale);
    set(next);
    persist(next);
    applyAppearance(next);
  },
  reset: () => {
    set({ ...DEFAULT_PREFS });
    persist(DEFAULT_PREFS);
    applyAppearance(DEFAULT_PREFS);
  },
}));

function persist(p: Prefs): void {
  try {
    const { theme, uiScale, meterScale, meterFallDbPerSec } = p;
    localStorage.setItem(
      KEY,
      JSON.stringify({
        theme,
        uiScale,
        meterScale,
        meterFallDbPerSec,
        followPlayhead: p.followPlayhead,
        primaryTimeDisplay: p.primaryTimeDisplay,
        confirmDestructive: p.confirmDestructive,
        reduceMotion: p.reduceMotion,
      }),
    );
  } catch {
    /* storage disabled — the session still works, it just will not persist */
  }
}

/**
 * Write appearance to the document root. Called once at boot (before React
 * mounts, so there is no flash) and on every preference change.
 */
export function applyAppearance(p: Prefs = usePrefsStore.getState()): void {
  const root = document.documentElement;
  if (p.theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', p.theme);
  root.style.setProperty('--ui-scale', String(clampScale(p.uiScale)));
  root.toggleAttribute('data-reduce-motion', p.reduceMotion);
}
