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
import {
  SYNTH_LFO_MAX_HZ,
  SYNTH_LFO_MIN_HZ,
  SYNTH_LFO_PITCH_CENTS,
  SYNTH_PW_MAX,
  SYNTH_PW_MIN,
} from './synthFace';
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
  {
    key: 'volume',
    name: 'Level',
    unit: '%',
    min: 0,
    max: 1.5,
    def: 0.9,
    scale: 'linear',
    format: (v) => `${Math.round(v * 100)}%`,
  },
  {
    key: 'filterCutoff',
    name: 'Cutoff',
    unit: 'Hz',
    min: 40,
    max: 18000,
    def: 12000,
    scale: 'log',
    format: (v) => (v >= 1000 ? `${(v / 1000).toFixed(1)} kHz` : `${Math.round(v)} Hz`),
  },
  {
    // Decibels, for the same reason the synth's `resonance` below is — the
    // number lands in `filter.Q.value` in `samplerInstrument.ts` — and here
    // there is not even a mode where the old `'Q'` label could have been
    // right: `SamplerParams.filterType` offers `lowpass` and `highpass` and
    // nothing else, and Web Audio reads Q as decibels of lift at the corner
    // for both. `SamplerPanel` has displayed the field in dB all along, so a
    // lane on that very field formatting a bare `0.8` left the two disagreeing
    // about what the musician was looking at.
    //
    // `min`/`max`/`scale` stay put: they are the mapping a stored 0..1 lane
    // point goes through, so moving them would change how every saved
    // resonance ride sounds without anyone touching a lane.
    key: 'filterRes',
    name: 'Resonance',
    unit: 'dB',
    min: 0.1,
    max: 20,
    def: 0.8,
    scale: 'log',
    format: (v) => `${v.toFixed(1)} dB`,
  },
  {
    key: 'attack',
    name: 'Attack',
    unit: 's',
    min: 0.001,
    max: 4,
    def: 0.002,
    scale: 'log',
    format: (v) => (v < 0.1 ? `${Math.round(v * 1000)} ms` : `${v.toFixed(2)} s`),
  },
  {
    key: 'release',
    name: 'Release',
    unit: 's',
    min: 0.005,
    max: 8,
    def: 0.12,
    scale: 'log',
    format: (v) => (v < 0.1 ? `${Math.round(v * 1000)} ms` : `${v.toFixed(2)} s`),
  },
  {
    key: 'lfoRate',
    name: 'LFO Rate',
    unit: 'Hz',
    min: 0.05,
    max: 30,
    def: 4,
    scale: 'log',
    format: (v) => `${v.toFixed(1)} Hz`,
  },
  {
    key: 'lfoDepth',
    name: 'LFO Depth',
    unit: '%',
    min: 0,
    max: 1,
    def: 0,
    scale: 'linear',
    format: (v) => `${Math.round(v * 100)}%`,
  },
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
    // Decibels, not Q. Both instruments write this straight into
    // `filter.Q.value` on a lowpass, and Web Audio reads that field as dB for
    // lowpass and highpass — it is the lift at the corner. The label said Q,
    // so the number a musician automated read about ten decibels quieter than
    // it sounded.
    //
    // Only the label and the format are corrected. The range and the log
    // scale decide how a stored 0..1 lane value maps to a real one, so moving
    // them would change how every saved automation lane sounds. The voice
    // clamps 0.05..24; a lane cannot reach the top of that, which is worth
    // widening one day in a change that can be heard for.
    key: 'resonance',
    name: 'Resonance',
    unit: 'dB',
    min: 0.1,
    max: 20,
    def: 1,
    scale: 'log',
    format: (v) => `${v.toFixed(1)} dB`,
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
  // The oscillator, sub and LFO surface. Every one of these is a ride a
  // musician makes by hand on hardware — a filter sweep's companions — and
  // every one of them is read per note by `Voice` through the descriptors in
  // `model/synthFace.ts`, which is what `tests/laneWired.test.ts` checks.
  //
  // `glide` and `pulseWidth`'s partner `waveform` are deliberately absent:
  // portamento is a patch setting rather than a performance one, and a lane
  // per rarely-ridden field turns the add-lane menu into a list nobody reads.
  {
    key: 'shape',
    name: 'Shape',
    unit: '%',
    min: 0,
    max: 1,
    def: 0,
    scale: 'linear',
    format: (v) => (v <= 0 ? 'Saw' : v >= 1 ? 'Square' : `${Math.round(v * 100)}%`),
  },
  {
    key: 'pulseWidth',
    name: 'Width',
    unit: '%',
    min: SYNTH_PW_MIN,
    max: SYNTH_PW_MAX,
    def: 0.5,
    scale: 'linear',
    format: pct,
  },
  {
    key: 'subLevel',
    name: 'Sub',
    unit: '%',
    min: 0,
    max: 1,
    def: 0,
    scale: 'linear',
    format: pct,
  },
  {
    key: 'lfoRate',
    name: 'LFO Rate',
    unit: 'Hz',
    min: SYNTH_LFO_MIN_HZ,
    max: SYNTH_LFO_MAX_HZ,
    def: 5,
    scale: 'log',
    format: (v) => `${v.toFixed(2)} Hz`,
  },
  {
    key: 'lfoToPitch',
    name: 'LFO → Pitch',
    unit: 'cents',
    min: 0,
    max: 1,
    def: 0,
    scale: 'linear',
    format: (v) => `${Math.round(v * SYNTH_LFO_PITCH_CENTS)} cents`,
  },
  {
    key: 'lfoToFilter',
    name: 'LFO → Filter',
    unit: '%',
    min: 0,
    max: 1,
    def: 0,
    scale: 'linear',
    format: pct,
  },
  {
    key: 'lfoToWidth',
    name: 'LFO → Width',
    unit: '%',
    min: 0,
    max: 1,
    def: 0,
    scale: 'linear',
    format: pct,
  },
];

/**
 * The one `SynthParams` field a classic kit reads, kept next to the list it
 * filters so the two cannot drift apart unnoticed: `DrumKit.trigger` in
 * `audio/synth.ts` starts a buffer and scales it by `volume` and velocity.
 */
const DRUM_KIT_READS: ReadonlySet<string> = new Set(['volume']);

/**
 * The synth parameters the instrument behind this track actually reads.
 *
 * The engine picks an instrument as rack → sampler → drum kit → poly synth
 * (`engine.syncGraph` and `buildInstrument`, mirrored in `exportMix`). The
 * caller keeps every track that has a sampler out of this branch, so what
 * reaches here is a rack, a classic kit or a poly synth. A `RackInstrument`
 * plays its children from their own params and never looks at the track's
 * `synth`, so it honours none of these. A `DrumKit` builds no filter and no
 * envelope, so Cutoff, Resonance, Attack and Release reach nothing on a
 * classic kit — they were offered anyway, and a sweep drawn on a drum track
 * recorded, played back, bounced, and changed no sound.
 */
function readableSynthParams(track: Track): typeof SYNTH_PARAMS {
  if (track.rack?.items.length) return [];
  if (track.type === 'drum') return SYNTH_PARAMS.filter((sp) => DRUM_KIT_READS.has(sp.key));
  return SYNTH_PARAMS;
}

/**
 * Every parameter the track can automate, in display order — the choices the
 * add-lane menu, the macro target picker and the MIDI-link picker are built
 * from.
 *
 * Narrower than what `findAutoParam` resolves, deliberately: see
 * `collectAutoParams`.
 */
export function listAutoParams(track: Track, project: ProjectData): AutoParam[] {
  return collectAutoParams(track, project, false);
}

/**
 * `includeUnread` picks which of the two questions this list is answering.
 *
 * "What may a user bind something new to?" is answered by the parameters the
 * track's instrument reads and by nothing else: a lane that draws, records and
 * plays back while moving no audio is a promise the app does not keep.
 *
 * "What does a parameter id in a saved project mean?" is answered by every
 * parameter the list has ever offered. A project written before a lane stopped
 * being offered still holds that lane, and `Arrangement.trackLanes` hides any
 * lane whose parameter will not resolve — so narrowing resolution as well
 * would leave the points in the file with no row to see them on and no way to
 * delete them. Resolution keeps the wide answer; only the pickers take the
 * narrow one.
 */
function collectAutoParams(
  track: Track,
  project: ProjectData,
  includeUnread: boolean,
): AutoParam[] {
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
    for (const sp of includeUnread ? SYNTH_PARAMS : readableSynthParams(track)) {
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

/**
 * Resolve one parameter id for a track, or undefined when it no longer exists.
 *
 * Resolves the parameters the instrument does not read as well, so a lane a
 * saved project already holds keeps its row, keeps playing back and can be
 * deleted — the reasoning is in `collectAutoParams`.
 */
export function findAutoParam(
  track: Track,
  project: ProjectData,
  paramId: string,
): AutoParam | undefined {
  return collectAutoParams(track, project, true).find((p) => p.id === paramId);
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
    // Wider than what `listAutoParams` offers, and it has to be: this is the
    // predicate `validateProject` keeps or DROPS a lane by, so answering "no"
    // for a classic kit's Cutoff lane would not stop offering it — it would
    // delete a lane the user drew from the project on the next save.
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
