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
export type MeterScale = 'peak' | 'rms' | 'lufs';

export interface Prefs {
  theme: ThemeChoice;
  /** 0.85 – 1.4; multiplies every geometric token. */
  uiScale: number;
  /** Show the numeric value on every control, not just on hover. */
  alwaysShowValues: boolean;
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
}

export const DEFAULT_PREFS: Prefs = {
  theme: 'system',
  uiScale: 1,
  alwaysShowValues: false,
  meterScale: 'peak',
  meterFallDbPerSec: 26,
  followPlayhead: true,
  primaryTimeDisplay: 'bbt',
  confirmDestructive: true,
  reduceMotion: false,
};

const KEY = 'motionlab.prefs.v1';

function readStored(): Prefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    const parsed = JSON.parse(raw) as Partial<Prefs>;
    return {
      ...DEFAULT_PREFS,
      ...parsed,
      uiScale: clampScale(parsed.uiScale),
      theme: (['system', 'dark', 'light', 'contrast'] as const).includes(parsed.theme as ThemeChoice)
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
    const { theme, uiScale, alwaysShowValues, meterScale, meterFallDbPerSec } = p;
    localStorage.setItem(
      KEY,
      JSON.stringify({
        theme,
        uiScale,
        alwaysShowValues,
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
  root.toggleAttribute('data-show-values', p.alwaysShowValues);
}
