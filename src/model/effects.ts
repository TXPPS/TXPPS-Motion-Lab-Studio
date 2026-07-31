/**
 * Insert effect definitions.
 *
 * One declarative spec per effect kind drives everything: default parameters,
 * UI controls, value clamping and display formatting. Adding an effect means
 * adding a spec here and a builder in `audio/effectChain.ts` — no UI changes.
 */
import type { Effect, EffectKind } from './types';

export interface ParamSpec {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  default: number;
  /** How the value reads to a musician. */
  unit?: 'dB' | 'Hz' | 'ms' | '%' | 'x' | ':1' | 's';
  /** Skew the slider so useful ranges are not crammed at one end. */
  curve?: 'linear' | 'log';
}

export interface EffectSpec {
  kind: EffectKind;
  label: string;
  /** One line explaining what it does, shown in the insert picker. */
  blurb: string;
  params: ParamSpec[];
}

export const EFFECT_SPECS: EffectSpec[] = [
  {
    kind: 'trim',
    label: 'Gain',
    blurb: 'Level trim before the rest of the chain.',
    params: [{ key: 'gainDb', label: 'Gain', min: -24, max: 24, step: 0.5, default: 0, unit: 'dB' }],
  },
  {
    kind: 'eq3',
    label: 'EQ',
    blurb: 'Three-band shelving and peaking EQ.',
    params: [
      { key: 'lowDb', label: 'Low', min: -18, max: 18, step: 0.5, default: 0, unit: 'dB' },
      {
        key: 'lowFreq',
        label: 'Low freq',
        min: 40,
        max: 500,
        step: 1,
        default: 160,
        unit: 'Hz',
        curve: 'log',
      },
      { key: 'midDb', label: 'Mid', min: -18, max: 18, step: 0.5, default: 0, unit: 'dB' },
      {
        key: 'midFreq',
        label: 'Mid freq',
        min: 200,
        max: 6000,
        step: 10,
        default: 1000,
        unit: 'Hz',
        curve: 'log',
      },
      { key: 'midQ', label: 'Mid Q', min: 0.3, max: 8, step: 0.1, default: 1, unit: 'x' },
      { key: 'highDb', label: 'High', min: -18, max: 18, step: 0.5, default: 0, unit: 'dB' },
      {
        key: 'highFreq',
        label: 'High freq',
        min: 1500,
        max: 16000,
        step: 50,
        default: 6000,
        unit: 'Hz',
        curve: 'log',
      },
    ],
  },
  {
    kind: 'compressor',
    label: 'Compressor',
    blurb: 'Evens out level. Useful on vocals and bass.',
    params: [
      { key: 'threshold', label: 'Threshold', min: -60, max: 0, step: 1, default: -22, unit: 'dB' },
      { key: 'ratio', label: 'Ratio', min: 1, max: 20, step: 0.5, default: 4, unit: ':1' },
      { key: 'attack', label: 'Attack', min: 0, max: 200, step: 1, default: 5, unit: 'ms' },
      { key: 'release', label: 'Release', min: 10, max: 1000, step: 5, default: 180, unit: 'ms' },
      { key: 'knee', label: 'Knee', min: 0, max: 40, step: 1, default: 12, unit: 'dB' },
      { key: 'makeupDb', label: 'Makeup', min: 0, max: 24, step: 0.5, default: 0, unit: 'dB' },
    ],
  },
  {
    kind: 'delay',
    label: 'Delay',
    blurb: 'Tempo-synced echo with feedback.',
    params: [
      // Expressed in sixteenths so it follows the project tempo.
      { key: 'timeSixteenths', label: 'Time', min: 1, max: 16, step: 1, default: 6, unit: 'x' },
      { key: 'feedback', label: 'Feedback', min: 0, max: 0.9, step: 0.01, default: 0.32, unit: '%' },
      { key: 'tone', label: 'Tone', min: 500, max: 16000, step: 100, default: 4200, unit: 'Hz', curve: 'log' },
      { key: 'mix', label: 'Mix', min: 0, max: 1, step: 0.01, default: 0.25, unit: '%' },
    ],
  },
  {
    kind: 'reverb',
    label: 'Reverb',
    blurb: 'Synthesised room. Best used on a bus via a send.',
    params: [
      { key: 'size', label: 'Size', min: 0.2, max: 6, step: 0.1, default: 1.8, unit: 's' },
      { key: 'damping', label: 'Damping', min: 800, max: 16000, step: 100, default: 5200, unit: 'Hz', curve: 'log' },
      { key: 'predelay', label: 'Pre-delay', min: 0, max: 120, step: 1, default: 18, unit: 'ms' },
      { key: 'mix', label: 'Mix', min: 0, max: 1, step: 0.01, default: 0.3, unit: '%' },
    ],
  },
];

const BY_KIND = new Map(EFFECT_SPECS.map((s) => [s.kind, s]));

export function effectSpec(kind: EffectKind): EffectSpec | undefined {
  return BY_KIND.get(kind);
}

export function isKnownEffect(kind: string): kind is EffectKind {
  return BY_KIND.has(kind as EffectKind);
}

export function defaultParams(kind: EffectKind): Record<string, number> {
  const spec = BY_KIND.get(kind);
  if (!spec) return {};
  return Object.fromEntries(spec.params.map((p) => [p.key, p.default]));
}

/** Clamp to spec range and fill in anything missing. Never throws on bad data. */
export function normaliseParams(
  kind: EffectKind,
  params: Record<string, unknown> | undefined,
): Record<string, number> {
  const spec = BY_KIND.get(kind);
  if (!spec) return {};
  const out: Record<string, number> = {};
  for (const p of spec.params) {
    const raw = params?.[p.key];
    const n = typeof raw === 'number' && Number.isFinite(raw) ? raw : p.default;
    out[p.key] = Math.min(p.max, Math.max(p.min, n));
  }
  return out;
}

/** Read a parameter with the spec default as the fallback. */
export function paramOf(effect: Effect, key: string): number {
  const v = effect.params[key];
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const spec = BY_KIND.get(effect.kind);
  return spec?.params.find((p) => p.key === key)?.default ?? 0;
}

export function formatParam(spec: ParamSpec, value: number): string {
  switch (spec.unit) {
    case 'dB':
      return `${value > 0 ? '+' : ''}${value.toFixed(1)} dB`;
    case 'Hz':
      return value >= 1000 ? `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)} kHz` : `${Math.round(value)} Hz`;
    case 'ms':
      return `${Math.round(value)} ms`;
    case 's':
      return `${value.toFixed(1)} s`;
    case '%':
      return `${Math.round(value * 100)}%`;
    case ':1':
      return `${value.toFixed(1)}:1`;
    case 'x':
      return value.toFixed(1);
    default:
      return value.toFixed(2);
  }
}

/** Short one-line summary shown on a collapsed insert slot. */
export function describeEffect(effect: Effect): string {
  switch (effect.kind) {
    case 'trim': {
      const g = paramOf(effect, 'gainDb');
      return `${g > 0 ? '+' : ''}${g.toFixed(1)} dB`;
    }
    case 'eq3':
      return ['lowDb', 'midDb', 'highDb']
        .map((k) => {
          const v = paramOf(effect, k);
          return `${v > 0 ? '+' : ''}${v.toFixed(0)}`;
        })
        .join(' / ');
    case 'compressor':
      return `${paramOf(effect, 'threshold').toFixed(0)} dB, ${paramOf(effect, 'ratio').toFixed(
        1,
      )}:1`;
    case 'delay':
      return `1/${Math.max(1, Math.round(16 / paramOf(effect, 'timeSixteenths')))} · ${Math.round(
        paramOf(effect, 'mix') * 100,
      )}%`;
    case 'reverb':
      return `${paramOf(effect, 'size').toFixed(1)}s · ${Math.round(paramOf(effect, 'mix') * 100)}%`;
    default:
      return '';
  }
}

export const MAX_INSERTS = 6;
