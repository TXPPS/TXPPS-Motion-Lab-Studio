/**
 * Parameter binding registry — the single place that says what a track can
 * automate. Every automatable control advertises one descriptor: a stable id,
 * a display name, unit, range, default, display scale and formatter, plus how
 * to read its current (static) value from the track.
 *
 * Ids are stable within a track:
 *   volume | pan | mute | send:<busId> | fx:<effectId>:<paramKey> | synth:<key>
 *
 * Lane values are stored normalized 0..1; `denormParam`/`normParam` map through
 * the descriptor (log-scaled where a linear slider would cram the useful range
 * into one end — filter and EQ frequencies).
 */
import { EFFECT_SPECS, formatParam } from './effects';
import { formatDb } from './music';
import type { ParamSpec } from './effects';
import type { ProjectData, SynthParams, Track } from './types';
import type { SamplerParams } from './sampler';

export interface AutoParam {
  id: string;
  /** Display name, e.g. "Volume", "Send → FX Bus", "EQ · Low", "Synth · Cutoff" */
  name: string;
  unit: string;
  min: number;
  max: number;
  default: number;
  /** How normalized 0..1 maps to the value range. */
  scale: 'linear' | 'log';
  /** Stepped parameters snap to 0/1 (mute). */
  stepped?: boolean;
  /** Lane accent color (kept stable per parameter family). */
  color: string;
  format: (value: number) => string;
  /** Current static value from the track (the value automation overrides). */
  get: (track: Track) => number;
}

/** Sampler master parameters (automatable on non-rack sampler tracks). */
const SAMPLER_PARAMS: {
  key: keyof SamplerParams & string;
  name: string;
  unit: string;
  min: number;
  max: number;
  def: number;
  scale: 'linear' | 'log';
  format: (v: number) => string;
}[] = [
  { key: 'volume', name: 'Level', unit: '%', min: 0, max: 1.5, def: 0.9, scale: 'linear', format: (v) => `${Math.round(v * 100)}%` },
  { key: 'filterCutoff', name: 'Cutoff', unit: 'Hz', min: 40, max: 18000, def: 12000, scale: 'log', format: (v) => (v >= 1000 ? `${(v / 1000).toFixed(1)} kHz` : `${Math.round(v)} Hz`) },
  { key: 'filterRes', name: 'Resonance', unit: 'Q', min: 0.1, max: 20, def: 0.8, scale: 'log', format: (v) => v.toFixed(1) },
  { key: 'attack', name: 'Attack', unit: 's', min: 0.001, max: 4, def: 0.002, scale: 'log', format: (v) => (v < 0.1 ? `${Math.round(v * 1000)} ms` : `${v.toFixed(2)} s`) },
  { key: 'release', name: 'Release', unit: 's', min: 0.005, max: 8, def: 0.12, scale: 'log', format: (v) => (v < 0.1 ? `${Math.round(v * 1000)} ms` : `${v.toFixed(2)} s`) },
  { key: 'lfoRate', name: 'LFO Rate', unit: 'Hz', min: 0.05, max: 30, def: 4, scale: 'log', format: (v) => `${v.toFixed(1)} Hz` },
  { key: 'lfoDepth', name: 'LFO Depth', unit: '%', min: 0, max: 1, def: 0, scale: 'linear', format: (v) => `${Math.round(v * 100)}%` },
];

export const PARAM_COLORS = {
  volume: '#d9a13c',
  pan: '#4a90c4',
  mute: '#d97455',
  send: '#37b89a',
  fx: '#9070c9',
  synth: '#c96f9b',
} as const;

const pct = (v: number) => `${Math.round(v * 100)}%`;

/** Synth parameter surface (matches SynthParams ranges used by the synth panel). */
const SYNTH_PARAMS: {
  key: keyof SynthParams & string;
  name: string;
  unit: string;
  min: number;
  max: number;
  def: number;
  scale: 'linear' | 'log';
  format: (v: number) => string;
}[] = [
  {
    key: 'cutoff',
    name: 'Cutoff',
    unit: 'Hz',
    min: 40,
    max: 18000,
    def: 3000,
    scale: 'log',
    format: (v) => (v >= 1000 ? `${(v / 1000).toFixed(1)} kHz` : `${Math.round(v)} Hz`),
  },
  {
    key: 'resonance',
    name: 'Resonance',
    unit: 'Q',
    min: 0.1,
    max: 20,
    def: 1,
    scale: 'log',
    format: (v) => v.toFixed(1),
  },
  {
    key: 'attack',
    name: 'Attack',
    unit: 's',
    min: 0.001,
    max: 2,
    def: 0.01,
    scale: 'log',
    format: (v) => (v < 0.1 ? `${Math.round(v * 1000)} ms` : `${v.toFixed(2)} s`),
  },
  {
    key: 'release',
    name: 'Release',
    unit: 's',
    min: 0.01,
    max: 4,
    def: 0.3,
    scale: 'log',
    format: (v) => (v < 0.1 ? `${Math.round(v * 1000)} ms` : `${v.toFixed(2)} s`),
  },
  {
    key: 'volume',
    name: 'Level',
    unit: '%',
    min: 0,
    max: 1,
    def: 0.5,
    scale: 'linear',
    format: pct,
  },
];

/** Every parameter the track can automate, in display order. */
export function listAutoParams(track: Track, project: ProjectData): AutoParam[] {
  const out: AutoParam[] = [
    {
      id: 'volume',
      name: 'Volume',
      unit: 'dB',
      min: 0,
      max: 1.5,
      default: 0.85,
      scale: 'linear',
      color: PARAM_COLORS.volume,
      format: (v) => formatDb(v),
      get: (t) => t.volume,
    },
    {
      id: 'pan',
      name: 'Pan',
      unit: 'LR',
      min: -1,
      max: 1,
      default: 0,
      scale: 'linear',
      color: PARAM_COLORS.pan,
      format: (v) =>
        Math.abs(v) < 0.01 ? 'C' : v < 0 ? `L${Math.round(-v * 100)}` : `R${Math.round(v * 100)}`,
      get: (t) => t.pan,
    },
    {
      id: 'mute',
      name: 'Mute',
      unit: '',
      min: 0,
      max: 1,
      default: 0,
      scale: 'linear',
      stepped: true,
      color: PARAM_COLORS.mute,
      format: (v) => (v >= 0.5 ? 'Muted' : 'Open'),
      get: (t) => (t.mute ? 1 : 0),
    },
  ];

  for (const send of track.sends ?? []) {
    const bus = project.tracks.find((t) => t.id === send.busId);
    if (!bus) continue;
    out.push({
      id: `send:${send.busId}`,
      name: `Send → ${bus.name}`,
      unit: '%',
      min: 0,
      max: 1.5,
      default: 0.3,
      scale: 'linear',
      color: PARAM_COLORS.send,
      format: pct,
      get: (t) => t.sends?.find((s) => s.busId === send.busId)?.amount ?? 0,
    });
  }

  for (const fx of track.effects ?? []) {
    const spec = EFFECT_SPECS.find((s) => s.kind === fx.kind);
    if (!spec) continue;
    for (const p of spec.params) {
      out.push(fxParam(fx.id, spec.label, p));
    }
  }

  if (track.sampler && !track.rack?.items.length) {
    for (const sp of SAMPLER_PARAMS) {
      out.push({
        id: `smp:${sp.key}`,
        name: `Sampler · ${sp.name}`,
        unit: sp.unit,
        min: sp.min,
        max: sp.max,
        default: sp.def,
        scale: sp.scale,
        color: PARAM_COLORS.synth,
        format: sp.format,
        get: (t) => {
          const v = t.sampler?.[sp.key];
          return typeof v === 'number' ? v : sp.def;
        },
      });
    }
  }
  if ((track.type === 'instrument' || track.type === 'drum') && track.synth && !track.sampler) {
    for (const sp of SYNTH_PARAMS) {
      out.push({
        id: `synth:${sp.key}`,
        name: `Synth · ${sp.name}`,
        unit: sp.unit,
        min: sp.min,
        max: sp.max,
        default: sp.def,
        scale: sp.scale,
        color: PARAM_COLORS.synth,
        format: sp.format,
        get: (t) => {
          const v = t.synth?.[sp.key];
          return typeof v === 'number' ? v : sp.def;
        },
      });
    }
  }
  return out;
}

function fxParam(effectId: string, fxLabel: string, p: ParamSpec): AutoParam {
  return {
    id: `fx:${effectId}:${p.key}`,
    name: `${fxLabel} · ${p.label}`,
    unit: p.unit ?? '',
    min: p.min,
    max: p.max,
    default: p.default,
    scale: p.curve === 'log' ? 'log' : 'linear',
    color: PARAM_COLORS.fx,
    format: (v) => formatParam(p, v),
    get: (t) => {
      const fx = t.effects?.find((e) => e.id === effectId);
      const raw = fx?.params[p.key];
      return typeof raw === 'number' && Number.isFinite(raw) ? raw : p.default;
    },
  };
}

/** Resolve one parameter id for a track, or undefined when it no longer exists. */
export function findAutoParam(
  track: Track,
  project: ProjectData,
  paramId: string,
): AutoParam | undefined {
  // Fast paths for the fixed ids; list-and-find covers the dynamic ones.
  return listAutoParams(track, project).find((p) => p.id === paramId);
}

/** Map normalized 0..1 to the parameter's real value. */
export function denormParam(p: AutoParam, n: number): number {
  const x = n < 0 ? 0 : n > 1 ? 1 : n;
  let v: number;
  if (p.scale === 'log' && p.min > 0) {
    v = p.min * Math.pow(p.max / p.min, x);
  } else {
    v = p.min + (p.max - p.min) * x;
  }
  if (p.stepped) return v >= 0.5 ? 1 : 0;
  return v;
}

/** Map a real value into normalized 0..1. */
export function normParam(p: AutoParam, value: number): number {
  const v = Math.min(p.max, Math.max(p.min, value));
  if (p.scale === 'log' && p.min > 0) {
    return Math.log(v / p.min) / Math.log(p.max / p.min);
  }
  return (v - p.min) / (p.max - p.min || 1);
}

/**
 * Parameter-id sanity used by persistence validation: does the id refer to
 * something that still exists on this track? (Effects and sends can be
 * deleted after a lane was written.)
 */
export function paramIdExists(track: Track, paramId: string): boolean {
  if (paramId === 'volume' || paramId === 'pan' || paramId === 'mute') return true;
  if (paramId.startsWith('send:')) {
    const busId = paramId.slice(5);
    return (track.sends ?? []).some((s) => s.busId === busId);
  }
  if (paramId.startsWith('fx:')) {
    const [, effectId, key] = paramId.split(':');
    const fx = (track.effects ?? []).find((e) => e.id === effectId);
    if (!fx) return false;
    const spec = EFFECT_SPECS.find((s) => s.kind === fx.kind);
    return !!spec?.params.some((p) => p.key === key);
  }
  if (paramId.startsWith('synth:')) {
    if (track.type !== 'instrument' && track.type !== 'drum') return false;
    const key = paramId.slice(6);
    return SYNTH_PARAMS.some((s) => s.key === key);
  }
  if (paramId.startsWith('smp:')) {
    if (!track.sampler || track.rack?.items.length) return false;
    const key = paramId.slice(4);
    return SAMPLER_PARAMS.some((s) => s.key === key);
  }
  return false;
}
