/**
 * Sampler model — ONE zone-based representation drives the Quick Sampler,
 * the Drum Rack and the Multisample instrument (the `view` field is a UI
 * hint, never an engine branch). Pure data + pure lookup math; the voice
 * engine lives in audio/samplerInstrument.ts.
 */
import { newId } from './ids';
import { TRACK_COLORS } from './types';

export interface SampleZone {
  id: string;
  name: string;
  mediaId: string;
  /** MIDI key range this zone answers to (inclusive) */
  keyLo: number;
  keyHi: number;
  /** velocity range (inclusive, 1..127) */
  velLo: number;
  velHi: number;
  /** the key at which the sample plays untransposed */
  rootNote: number;
  /** false: always play at root pitch (drum pads) */
  keyTrack: boolean;
  /** playback window in seconds into the source */
  startSec: number;
  /** undefined = to the end */
  endSec?: number;
  loop: boolean;
  loopStartSec?: number;
  loopEndSec?: number;
  reverse: boolean;
  /** one-shots ignore note-off and play out */
  oneShot: boolean;
  gain: number;
  pan: number;
  /** semitones / cents */
  tuneCoarse: number;
  tuneFine: number;
  /** zones sharing a choke group cut each other (hi-hats) */
  chokeGroup?: number;
  /** round-robin group: overlapping zones in one group alternate */
  rrGroup?: number;
  /** pad UI */
  color?: string;
  muted?: boolean;
  solo?: boolean;
  /** slice markers in seconds (quick-sampler slicing), non-destructive */
  slices?: number[];
}

export type SamplerView = 'quick' | 'drum' | 'multi';

export interface SamplerParams {
  view: SamplerView;
  zones: SampleZone[];
  /** master envelope (seconds / 0..1 sustain) */
  attack: number;
  decay: number;
  sustain: number;
  release: number;
  /** master level 0..1.5 */
  volume: number;
  filterType: 'off' | 'lowpass' | 'highpass';
  filterCutoff: number;
  filterRes: number;
  lfoTarget: 'off' | 'pitch' | 'filter';
  lfoRate: number;
  lfoDepth: number;
  /** velocity → gain sensitivity 0..1 */
  velToGain: number;
  presetName?: string;
}

/**
 * Pad 0 sits at MIDI key 24 (C1), so a rack can hold 104 MIDI-addressable
 * pads (24..127) — keys above 127 would be untriggerable.
 */
export const DRUM_PAD_BASE = 24;
export const MAX_DRUM_PADS = 128 - DRUM_PAD_BASE;

export function defaultSamplerParams(view: SamplerView): SamplerParams {
  return {
    view,
    zones: [],
    attack: 0.002,
    decay: 0.08,
    sustain: 1,
    release: view === 'drum' ? 0.25 : 0.12,
    volume: 0.9,
    filterType: 'off',
    filterCutoff: 12000,
    filterRes: 0.8,
    lfoTarget: 'off',
    lfoRate: 4,
    lfoDepth: 0,
    velToGain: 0.7,
  };
}

export function makeZone(patch: Partial<SampleZone> & Pick<SampleZone, 'mediaId'>): SampleZone {
  return {
    id: newId('z'),
    name: patch.name ?? 'Zone',
    keyLo: 0,
    keyHi: 127,
    velLo: 1,
    velHi: 127,
    rootNote: 60,
    keyTrack: true,
    startSec: 0,
    loop: false,
    reverse: false,
    oneShot: false,
    gain: 1,
    pan: 0,
    tuneCoarse: 0,
    tuneFine: 0,
    ...patch,
  };
}

/** A drum pad = a fixed-key one-shot zone that does not key-track. */
export function makePadZone(
  mediaId: string,
  padIndex: number,
  name: string,
  color?: string,
): SampleZone {
  const key = DRUM_PAD_BASE + padIndex;
  return makeZone({
    mediaId,
    name,
    keyLo: key,
    keyHi: key,
    rootNote: key,
    keyTrack: false,
    oneShot: true,
    color: color ?? TRACK_COLORS[padIndex % TRACK_COLORS.length],
  });
}

export interface ZoneHit {
  zone: SampleZone;
  /** key/velocity crossfade gain 0..1 applied on top of the zone gain */
  xfGain: number;
}

/**
 * Zones that sound for (key, velocity). Mute/solo aware; round-robin groups
 * pick one member per trigger via the caller-owned counter map; overlapping
 * key ranges crossfade linearly through the overlap so multisample joins do
 * not step.
 */
export function matchZones(
  zones: SampleZone[],
  key: number,
  velocity: number,
  rrCounters?: Map<number, number>,
): ZoneHit[] {
  const soloActive = zones.some((z) => z.solo);
  const candidates = zones.filter(
    (z) =>
      !z.muted &&
      (!soloActive || z.solo) &&
      key >= z.keyLo &&
      key <= z.keyHi &&
      velocity >= z.velLo &&
      velocity <= z.velHi,
  );
  if (candidates.length === 0) return [];

  // Round robin: within each rr group, only one candidate plays per trigger.
  const byGroup = new Map<number, SampleZone[]>();
  const solo: SampleZone[] = [];
  for (const z of candidates) {
    if (z.rrGroup === undefined) solo.push(z);
    else {
      const list = byGroup.get(z.rrGroup) ?? [];
      list.push(z);
      byGroup.set(z.rrGroup, list);
    }
  }
  const chosen: SampleZone[] = [...solo];
  for (const [group, list] of byGroup) {
    const n = rrCounters?.get(group) ?? 0;
    chosen.push(list[n % list.length]);
    rrCounters?.set(group, n + 1);
  }

  return chosen.map((zone) => {
    // Key crossfade: when another chosen zone overlaps this key range, taper
    // this zone linearly across the shared span.
    let xf = 1;
    for (const other of chosen) {
      if (other === zone) continue;
      const lo = Math.max(zone.keyLo, other.keyLo);
      const hi = Math.min(zone.keyHi, other.keyHi);
      if (lo > hi || key < lo || key > hi || hi === lo) continue;
      const t = (key - lo) / (hi - lo);
      // The zone whose exclusive territory is below the overlap fades out
      // as the key rises; the one above fades in.
      xf *= zone.keyLo < other.keyLo ? 1 - t : t;
    }
    return { zone, xfGain: Math.max(0.02, xf) };
  });
}

/** Playback rate for a zone at a key. */
export function zonePlaybackRate(zone: SampleZone, key: number): number {
  const semis = (zone.keyTrack ? key - zone.rootNote : 0) + zone.tuneCoarse + zone.tuneFine / 100;
  return Math.pow(2, semis / 12);
}

/** Snap a time to the nearest zero crossing within ±windowSec. */
export function snapToZeroCrossing(
  data: Float32Array,
  sampleRate: number,
  timeSec: number,
  windowSec = 0.01,
): number {
  const center = Math.round(timeSec * sampleRate);
  const span = Math.max(1, Math.round(windowSec * sampleRate));
  const from = Math.max(1, center - span);
  const to = Math.min(data.length - 1, center + span);
  let best = -1;
  let bestDist = Infinity;
  for (let i = from; i <= to; i++) {
    if ((data[i - 1] <= 0 && data[i] > 0) || (data[i - 1] >= 0 && data[i] < 0)) {
      const d = Math.abs(i - center);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
  }
  return best >= 0 ? best / sampleRate : timeSec;
}

/**
 * Transient detection over an energy envelope: a marker lands where the
 * short-window RMS jumps by `ratio` over the previous window and at least
 * `minGapSec` has passed. Deterministic and intentionally simple — reliable
 * on percussive material, honest about being an assistant, not an oracle.
 */
export function detectTransients(
  data: Float32Array,
  sampleRate: number,
  opts: { ratio?: number; minGapSec?: number; windowSec?: number; maxMarkers?: number } = {},
): number[] {
  const win = Math.max(16, Math.round((opts.windowSec ?? 0.01) * sampleRate));
  const ratio = opts.ratio ?? 2.2;
  const minGap = (opts.minGapSec ?? 0.05) * sampleRate;
  const maxMarkers = opts.maxMarkers ?? 128;
  const out: number[] = [];
  let prevRms = 0;
  let lastHit = -Infinity;
  for (let i = 0; i + win <= data.length; i += win) {
    let sum = 0;
    for (let j = i; j < i + win; j++) sum += data[j] * data[j];
    const rms = Math.sqrt(sum / win);
    if (rms > 0.02 && rms > prevRms * ratio && i - lastHit >= minGap) {
      out.push(i / sampleRate);
      lastHit = i;
      if (out.length >= maxMarkers) break;
    }
    prevRms = Math.max(rms, prevRms * 0.7);
  }
  return out;
}

/** Built-in kits/presets (procedural media only — repository-safe). */
export function buildDrumKit(name = '808-ish Kit'): SamplerParams {
  const p = defaultSamplerParams('drum');
  const pads: [string, string][] = [
    ['hit-kick', 'Kick'],
    ['hit-snare', 'Snare'],
    ['hit-clap', 'Clap'],
    ['hit-hat', 'Hat'],
    ['hit-openhat', 'Open Hat'],
    ['hit-kick', 'Kick 2'],
    ['hit-snare', 'Rim'],
    ['hit-hat', 'Hat 2'],
  ];
  p.zones = pads.map(([mediaId, label], i) => {
    const z = makePadZone(mediaId, i, label);
    if (label === 'Hat' || label === 'Hat 2') z.chokeGroup = 1;
    if (label === 'Open Hat') {
      z.chokeGroup = 1;
      z.oneShot = true;
    }
    if (label === 'Kick 2') z.tuneCoarse = -3;
    if (label === 'Rim') {
      z.tuneCoarse = 7;
      z.gain = 0.7;
    }
    return z;
  });
  p.presetName = name;
  return p;
}

export function buildQuickSampler(mediaId: string, name: string): SamplerParams {
  const p = defaultSamplerParams('quick');
  p.zones = [makeZone({ mediaId, name, rootNote: 60 })];
  p.presetName = name;
  return p;
}

/** A small multisample: the same source mapped in octave bands around roots. */
export function buildMultiSampler(mediaId: string, name: string): SamplerParams {
  const p = defaultSamplerParams('multi');
  const roots = [36, 48, 60, 72, 84];
  p.zones = roots.map((root, i) =>
    makeZone({
      mediaId,
      name: `${name} ${i + 1}`,
      rootNote: root,
      keyLo: i === 0 ? 0 : root - 6,
      keyHi: i === roots.length - 1 ? 127 : root + 6,
    }),
  );
  p.presetName = name;
  return p;
}

const VIEWS = new Set(['quick', 'drum', 'multi']);
const FILTERS = new Set(['off', 'lowpass', 'highpass']);
const LFO_TARGETS = new Set(['off', 'pitch', 'filter']);

/** Defensive validation for stored sampler params. Returns null when unusable. */
export function validateSampler(raw: unknown): SamplerParams | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.zones)) return null;
  const base = defaultSamplerParams(
    typeof r.view === 'string' && VIEWS.has(r.view) ? (r.view as SamplerView) : 'quick',
  );
  const num = (v: unknown, d: number, lo: number, hi: number) =>
    typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d;
  const zones: SampleZone[] = [];
  for (const z of r.zones) {
    if (typeof z !== 'object' || z === null) continue;
    const q = z as Record<string, unknown>;
    if (typeof q.mediaId !== 'string') continue;
    const zone = makeZone({ mediaId: q.mediaId });
    zone.id = typeof q.id === 'string' ? q.id : zone.id;
    zone.name = typeof q.name === 'string' ? q.name : 'Zone';
    zone.keyLo = num(q.keyLo, 0, 0, 127);
    zone.keyHi = num(q.keyHi, 127, zone.keyLo, 127);
    zone.velLo = num(q.velLo, 1, 1, 127);
    zone.velHi = num(q.velHi, 127, zone.velLo, 127);
    zone.rootNote = num(q.rootNote, 60, 0, 127);
    zone.keyTrack = q.keyTrack !== false;
    zone.startSec = num(q.startSec, 0, 0, 60 * 60);
    if (typeof q.endSec === 'number') zone.endSec = num(q.endSec, 0, zone.startSec, 60 * 60);
    zone.loop = q.loop === true;
    if (typeof q.loopStartSec === 'number') zone.loopStartSec = num(q.loopStartSec, 0, 0, 3600);
    if (typeof q.loopEndSec === 'number') zone.loopEndSec = num(q.loopEndSec, 0, 0, 3600);
    zone.reverse = q.reverse === true;
    zone.oneShot = q.oneShot === true;
    zone.gain = num(q.gain, 1, 0, 4);
    zone.pan = num(q.pan, 0, -1, 1);
    zone.tuneCoarse = num(q.tuneCoarse, 0, -48, 48);
    zone.tuneFine = num(q.tuneFine, 0, -100, 100);
    if (typeof q.chokeGroup === 'number') zone.chokeGroup = q.chokeGroup;
    if (typeof q.rrGroup === 'number') zone.rrGroup = q.rrGroup;
    if (typeof q.color === 'string') zone.color = q.color;
    if (q.muted === true) zone.muted = true;
    if (q.solo === true) zone.solo = true;
    if (Array.isArray(q.slices)) {
      zone.slices = (q.slices as unknown[])
        .filter((s): s is number => typeof s === 'number' && Number.isFinite(s) && s >= 0)
        .sort((a, b) => a - b);
    }
    zones.push(zone);
  }
  return {
    view: base.view,
    zones,
    attack: num(r.attack, base.attack, 0, 4),
    decay: num(r.decay, base.decay, 0, 4),
    sustain: num(r.sustain, base.sustain, 0, 1),
    release: num(r.release, base.release, 0.005, 8),
    volume: num(r.volume, base.volume, 0, 1.5),
    filterType:
      typeof r.filterType === 'string' && FILTERS.has(r.filterType)
        ? (r.filterType as SamplerParams['filterType'])
        : 'off',
    filterCutoff: num(r.filterCutoff, base.filterCutoff, 40, 18000),
    filterRes: num(r.filterRes, base.filterRes, 0.1, 20),
    lfoTarget:
      typeof r.lfoTarget === 'string' && LFO_TARGETS.has(r.lfoTarget)
        ? (r.lfoTarget as SamplerParams['lfoTarget'])
        : 'off',
    lfoRate: num(r.lfoRate, base.lfoRate, 0.05, 30),
    lfoDepth: num(r.lfoDepth, base.lfoDepth, 0, 1),
    velToGain: num(r.velToGain, base.velToGain, 0, 1),
    ...(typeof r.presetName === 'string' ? { presetName: r.presetName } : {}),
  };
}
