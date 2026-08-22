/**
 * What the instruments actually do, in the terms their faces have to draw.
 *
 * The effect suite learned this the expensive way: seven faces drew a straight
 * 1:1 line for processors that were nothing of the kind, because each face read
 * the parameters and re-decided what they meant. The fix was a descriptor in
 * the model that the audio builder and the face both read (`dynamicsLawOf`,
 * `shaperCurveOf`, `delayLayoutOf` in `effects.ts`), so a picture that does not
 * match the processor stops being expressible.
 *
 * This file is that descriptor for the instruments. Every function here answers
 * a question about the voice `audio/synth.ts` or `audio/samplerInstrument.ts`
 * builds — the filter it hands the node, the envelope it schedules on the gain,
 * the window it starts the buffer in — with the same clamps, in the same units.
 * `tests/synthFace.test.ts` runs the real voice engines against a recording
 * context and asserts the numbers here are the numbers they assign, which is
 * the test that would have caught the seven wrong effect faces.
 */
import {
  biquadCoefficients,
  biquadResponse,
  complexMagnitudeDb,
  type BiquadType,
} from '../audio/dsp/curves';
import { clamp } from './music';
import { matchZones, zonePlaybackRate, type SamplerParams, type SampleZone } from './sampler';
import type { RackItem, SynthParams, Waveform } from './types';

/**
 * Rate the response plots are computed at. Fixed rather than the device's, so
 * a curve does not change shape when a project is opened on other hardware —
 * the same reasoning (and the same number) as the plugin faces use.
 */
export const FACE_PLOT_RATE = 48000;

// ------------------------------------------------------------------ filter

/**
 * The filter a voice hands to its `BiquadFilterNode`.
 *
 * `qDb`, not `q`, and that is not pedantry. Web Audio reads `Q` in **decibels**
 * on `lowpass` and `highpass` and as a plain quality factor on everything else,
 * so the number both instruments assign to `filter.Q.value` is a dB figure
 * whatever their UI has historically called it. It is carried here in the unit
 * it is actually in and passed to `biquadCoefficients` unconverted, because
 * that function takes the pass filters' Q in dB for exactly this reason. A
 * conversion in either direction here would be a second opinion about the
 * gotcha `qToDb` already settles.
 *
 * It also makes one readout honest that would otherwise be a guess: a biquad
 * pass filter's magnitude at its own corner is exactly its Q, so with Q given
 * in decibels the resonance number *is* the decibels of lift at the cutoff.
 */
export interface VoiceFilter {
  type: BiquadType;
  freqHz: number;
  qDb: number;
}

/** The range `Voice` clamps its filter into, in `audio/synth.ts`. */
export const SYNTH_CUTOFF_MIN_HZ = 40;
export const SYNTH_CUTOFF_MAX_HZ = 18000;
export const SYNTH_Q_MIN_DB = 0.05;
export const SYNTH_Q_MAX_DB = 24;

/** The key the synth's cutoff is quoted at: at C4 the tracking factor is 1. */
export const SYNTH_ROOT_KEY = 60;

/**
 * Cutoff multiplier for a note. The voice opens the filter with the key so
 * high notes are not choked — half an octave of cutoff per octave of key.
 */
export function synthKeyTrack(pitch: number): number {
  return Math.pow(2, (pitch - SYNTH_ROOT_KEY) / 24);
}

/** The filter one synth voice builds for one key. */
export function synthVoiceFilter(p: SynthParams, pitch = SYNTH_ROOT_KEY): VoiceFilter {
  return {
    type: 'lowpass',
    freqHz: clamp(p.cutoff * synthKeyTrack(pitch), SYNTH_CUTOFF_MIN_HZ, SYNTH_CUTOFF_MAX_HZ),
    qDb: clamp(p.resonance, SYNTH_Q_MIN_DB, SYNTH_Q_MAX_DB),
  };
}

/**
 * The filter a sampler voice builds, or null when it builds none.
 *
 * Null is the honest answer for `filterType: 'off'` — the voice creates no
 * node at all, so there is no curve to draw and no cutoff to sweep.
 */
export function samplerVoiceFilter(p: SamplerParams): VoiceFilter | null {
  if (p.filterType === 'off') return null;
  return { type: p.filterType, freqHz: p.filterCutoff, qDb: p.filterRes };
}

/** Magnitude response of one voice filter, in dB, at each frequency. */
export function filterResponseDb(
  filter: VoiceFilter,
  freqsHz: readonly number[],
  sampleRate = FACE_PLOT_RATE,
): number[] {
  const c = biquadCoefficients(filter.type, filter.freqHz, filter.qDb, 0, sampleRate);
  return freqsHz.map((f) => complexMagnitudeDb(biquadResponse(c, f, sampleRate)));
}

// ---------------------------------------------------------------- envelope

/**
 * The amplitude envelope a voice schedules on its gain, in absolute gain and
 * real seconds.
 *
 * Both instruments schedule the same three-call shape — a ramp to `peak`, then
 * `setTargetAtTime` towards the sustain level, then `setTargetAtTime` towards
 * the floor at note-off — and both pass a time *constant* of a third of the
 * musician's decay and release. That is the reason this exists: an envelope
 * drawn as three straight lines is a different envelope from the one that
 * sounds, and the difference is exactly the part a musician is listening for.
 *
 * The two differ in their clamps and in how long the source runs on past
 * note-off, so each has its own constructor and they share one evaluation.
 */
export interface AmpEnvelope {
  /** Gain the attack ramp reaches, for the velocity this was built at. */
  peak: number;
  /** Where the ramp starts, and what the release aims at. */
  floor: number;
  /** Length of the linear attack ramp. */
  attackSec: number;
  /** `setTargetAtTime` time constant for the decay: a third of the decay knob. */
  decayTau: number;
  /** Fraction of `peak` the decay settles towards. */
  sustain: number;
  /** `setTargetAtTime` time constant for the release. */
  releaseTau: number;
  /** Seconds after note-off at which the source is scheduled to stop. */
  tailSec: number;
}

/** Peak gain of one synth voice: level, velocity curve and the fixed -6 dB. */
export function synthVoicePeak(p: SynthParams, velocity: number): number {
  return clamp(p.volume, 0, 1) * Math.pow(velocity / 127, 1.4) * 0.5;
}

export function synthAmpEnvelope(p: SynthParams, velocity = 100): AmpEnvelope {
  const attackSec = Math.max(0.002, p.attack);
  const releaseTau = Math.max(0.01, p.release) / 3;
  return {
    peak: synthVoicePeak(p, velocity),
    floor: 0,
    attackSec,
    decayTau: Math.max(0.01, p.decay) / 3,
    sustain: clamp(p.sustain, 0, 1),
    releaseTau,
    // `release()` stops the oscillator six time constants past note-off, which
    // is 34 dB down — the point the voice stops costing anything.
    tailSec: releaseTau * 6 + 0.05,
  };
}

/** Velocity's share of a sampler voice's level, at the configured sensitivity. */
export function samplerVelocityGain(p: SamplerParams, velocity: number): number {
  const curve = Math.pow(clamp(velocity, 1, 127) / 127, 1.2);
  return 1 - p.velToGain + p.velToGain * curve;
}

export function samplerAmpEnvelope(
  p: SamplerParams,
  opts: { velocity?: number; zoneGain?: number; xfGain?: number } = {},
): AmpEnvelope {
  const velocity = opts.velocity ?? 100;
  const releaseSec = Math.max(0.005, p.release);
  const peak =
    clamp(opts.zoneGain ?? 1, 0, 4) *
    (opts.xfGain ?? 1) *
    samplerVelocityGain(p, velocity) *
    clamp(p.volume, 0, 1.5);
  return {
    peak,
    // Not zero: the sampler ramps from and releases to a floor, because an
    // exponential approach to silence never arrives and the node would hold a
    // scheduled value forever.
    floor: 0.0001,
    attackSec: Math.max(0.001, p.attack),
    decayTau: Math.max(0.001, p.decay) / 3,
    sustain: clamp(p.sustain, 0, 1),
    releaseTau: releaseSec / 3,
    tailSec: releaseSec + 0.05,
  };
}

/**
 * The envelope's gain `t` seconds after note-on, for a note held `holdSec`.
 *
 * This is the Web Audio automation arithmetic, not an approximation of it: a
 * `linearRampToValueAtTime` is linear between the two scheduled points, and a
 * `setTargetAtTime` approaches its target as `target + (v0 - target)·e^(-Δt/τ)`.
 */
export function ampEnvelopeGain(env: AmpEnvelope, t: number, holdSec: number): number {
  if (t <= 0) return env.floor;
  const sustainGain = env.peak * env.sustain;
  const decayAt = (u: number): number =>
    sustainGain + (env.peak - sustainGain) * Math.exp(-u / env.decayTau);

  if (t < holdSec) {
    if (t < env.attackSec) return env.floor + (env.peak - env.floor) * (t / env.attackSec);
    return decayAt(t - env.attackSec);
  }
  // Note-off cancels the decay and starts from wherever it had got to, which is
  // why a short note releases from a higher level than a long one.
  const atRelease =
    holdSec < env.attackSec
      ? env.floor + (env.peak - env.floor) * (holdSec / env.attackSec)
      : decayAt(holdSec - env.attackSec);
  return env.floor + (atRelease - env.floor) * Math.exp(-(t - holdSec) / env.releaseTau);
}

/**
 * A hold long enough to show the sustain level as a plateau.
 *
 * The graph's axis stays in real seconds; this only decides how much of the
 * held part of a note is worth drawing. Three decay time constants is where
 * the decay has arrived (within 5%), so the plateau starts there and gets a
 * quarter of the moving part again, which is enough to read as a level.
 */
export function suggestedHoldSec(env: AmpEnvelope): number {
  const moving = env.attackSec + env.decayTau * 3;
  return moving + Math.max(0.05, moving * 0.25);
}

/** Seconds the whole envelope occupies, note-on to source stop. */
export function ampEnvelopeSpan(env: AmpEnvelope, holdSec: number): number {
  return holdSec + env.tailSec;
}

/** The envelope sampled evenly across its span, for a plot. */
export function ampEnvelopePoints(
  env: AmpEnvelope,
  holdSec: number,
  count = 120,
): { t: number; gain: number }[] {
  const span = ampEnvelopeSpan(env, holdSec);
  const n = Math.max(2, Math.floor(count));
  const out: { t: number; gain: number }[] = [];
  for (let i = 0; i < n; i++) {
    const t = (i / (n - 1)) * span;
    out.push({ t, gain: ampEnvelopeGain(env, t, holdSec) });
  }
  return out;
}

// -------------------------------------------------------------- oscillator

/**
 * One cycle of an `OscillatorNode`'s waveform, as the Web Audio specification
 * defines it — phase zero at the start of the cycle, unit amplitude.
 *
 * The node band-limits these before it plays them, which rounds the corners at
 * a rate that depends on the note and the sample rate. That is a consequence of
 * synthesising them at a finite rate rather than a choice anybody made, so the
 * ideal shape is the honest thing to draw: it is what the parameter means.
 */
export function oscillatorSample(shape: Waveform, phase: number): number {
  const x = phase - Math.floor(phase);
  switch (shape) {
    case 'sine':
      return Math.sin(2 * Math.PI * x);
    case 'square':
      return x < 0.5 ? 1 : -1;
    case 'sawtooth':
      return x < 0.5 ? 2 * x : 2 * x - 2;
    case 'triangle':
      if (x < 0.25) return 4 * x;
      return x < 0.75 ? 2 - 4 * x : 4 * x - 4;
  }
}

/** `cycles` cycles of a waveform sampled at `count` points, for a scope. */
export function oscillatorPoints(shape: Waveform, count = 160, cycles = 2): number[] {
  const n = Math.max(2, Math.floor(count));
  return Array.from({ length: n }, (_, i) => oscillatorSample(shape, (i / (n - 1)) * cycles));
}

// --------------------------------------------------------------- sampler LFO

/**
 * The modulator a sampler voice builds, or null when it builds none.
 *
 * Null is not a formality. The voice only creates the oscillator when a target
 * is chosen *and* the depth is above zero, and its filter branch needs a filter
 * to reach — so "LFO → filter" with the filter switched off modulates nothing,
 * which the panel used to present as a working pair of controls.
 */
export interface SamplerLfo {
  target: 'pitch' | 'filter';
  rateHz: number;
  /** The depth control itself, 0..1 — the modulator's share of full swing. */
  depth: number;
  /** Peak deviation applied to `detune`, in cents. */
  depthCents?: number;
  /** Peak deviation applied to the filter frequency, in Hz. */
  depthHz?: number;
}

export function samplerLfoOf(p: SamplerParams): SamplerLfo | null {
  if (p.lfoTarget === 'off' || p.lfoDepth <= 0) return null;
  if (p.lfoTarget === 'pitch') {
    return {
      target: 'pitch',
      rateHz: p.lfoRate,
      depth: p.lfoDepth,
      depthCents: p.lfoDepth * 100,
    };
  }
  if (p.filterType === 'off') return null;
  return {
    target: 'filter',
    rateHz: p.lfoRate,
    depth: p.lfoDepth,
    depthHz: p.lfoDepth * p.filterCutoff * 0.5,
  };
}

/** The band a filter-target LFO sweeps the cutoff through, clamped to audio. */
export function lfoSweepHz(
  filter: VoiceFilter,
  lfo: SamplerLfo,
): { lowHz: number; highHz: number } {
  const depth = lfo.depthHz ?? 0;
  return {
    lowHz: Math.max(20, filter.freqHz - depth),
    highHz: Math.min(20000, filter.freqHz + depth),
  };
}

// -------------------------------------------------------------- zone window

/**
 * The part of a sample a zone actually plays, with the clamps the voice
 * applies before it starts the buffer.
 *
 * The clamps are the point. A loop start authored before the trim, or an end
 * dragged past the source, is silently pulled back inside the window by the
 * voice — so a face drawing the raw fields draws markers where the audio does
 * not put them, which is what the quick sampler used to do with its loop band.
 */
export interface ZoneWindow {
  startSec: number;
  endSec: number;
  /** What the voice bounds playback by; never shorter than 5 ms. */
  windowSec: number;
  loop: boolean;
  loopStartSec: number;
  loopEndSec: number;
  /** Where the buffer is started, mirrored when the zone plays reversed. */
  offsetSec: number;
}

export function zoneWindowOf(zone: SampleZone, durationSec: number): ZoneWindow {
  const dur = Math.max(0, durationSec);
  const startSec = clamp(zone.startSec, 0, dur);
  const endSec = clamp(zone.endSec ?? dur, startSec, dur);
  const loopStartSec = clamp(zone.loopStartSec ?? startSec, startSec, endSec);
  const loopEndSec = clamp(zone.loopEndSec ?? endSec, loopStartSec + 0.003, endSec);
  return {
    startSec,
    endSec,
    windowSec: Math.max(0.005, endSec - startSec),
    loop: zone.loop,
    loopStartSec,
    loopEndSec,
    offsetSec: zone.reverse ? dur - endSec : startSec,
  };
}

/** How long a zone sounds at one key, once its playback rate is accounted for. */
export function zonePlaySeconds(zone: SampleZone, durationSec: number, key: number): number {
  const window = zoneWindowOf(zone, durationSec);
  return window.windowSec / Math.max(0.05, zonePlaybackRate(zone, key));
}

// ------------------------------------------------------------- zone mapping

/**
 * The gain one zone contributes at each key, from the sampler's own zone
 * matcher — mutes, solos, velocity windows and the linear crossfade through an
 * overlap included.
 *
 * Round-robin groups are asked without a counter, so a group reports its first
 * member; the map is showing which keys reach the zone, not which pass of a
 * repeated hit is next.
 */
export function zoneKeyProfile(
  zones: readonly SampleZone[],
  zoneId: string,
  velocity: number,
  keys: readonly number[],
): number[] {
  const list = [...zones];
  return keys.map(
    (key) => matchZones(list, key, velocity).find((h) => h.zone.id === zoneId)?.xfGain ?? 0,
  );
}

// ---------------------------------------------------------------- the rack

/**
 * The layers that answer a key. Mirrors `RackInstrument.targets`: a soloed
 * layer anywhere silences the un-soloed ones, and a muted layer never sounds.
 */
export function rackLayersAt(items: readonly RackItem[], pitch: number): RackItem[] {
  const soloActive = items.some((i) => i.solo);
  return items.filter(
    (i) => !i.muted && (!soloActive || i.solo) && pitch >= i.keyLo && pitch <= i.keyHi,
  );
}

// ---------------------------------------------------------------- readouts

/** Seconds as a musician reads them: milliseconds until it is worth a decimal. */
export function formatSeconds(seconds: number): string {
  if (seconds < 1) return `${Math.round(seconds * 1000)} ms`;
  return `${seconds.toFixed(seconds < 10 ? 2 : 1)} s`;
}
