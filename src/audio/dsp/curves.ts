/**
 * Pure curve and coefficient maths for the effect suite.
 *
 * Nothing here touches Web Audio. Every routine is numbers in, numbers out, so
 * the same maths drives the node graph, the response plots the UI draws and the
 * unit tests — one implementation, three consumers, no drift between them.
 *
 * The biquad formulas follow the Web Audio specification rather than a generic
 * cookbook, including its one real trap: `lowpass` and `highpass` read `Q` in
 * decibels while every other filter type reads it as a plain quality factor. A
 * response computed here is therefore the response the browser actually
 * produces, which is what makes the crossover flatness test meaningful.
 */

export interface Complex {
  re: number;
  im: number;
}

export type BiquadType =
  'lowpass' | 'highpass' | 'bandpass' | 'notch' | 'allpass' | 'peaking' | 'lowshelf' | 'highshelf';

/** Transfer function numerator/denominator, normalised so a0 is 1. */
export interface BiquadCoefficients {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

export function dbToGain(db: number): number {
  return Math.pow(10, db / 20);
}

export function gainToDb(gain: number): number {
  return 20 * Math.log10(Math.max(gain, 1e-9));
}

/** Butterworth alignment: the flattest response that still sums with its mirror. */
export const BUTTERWORTH_Q = Math.SQRT1_2;

/** The same alignment expressed the way a Web Audio lowpass/highpass wants it. */
export const BUTTERWORTH_Q_DB = 20 * Math.log10(Math.SQRT1_2);

/** Convert a quality factor to the decibel form lowpass/highpass nodes expect. */
export function qToDb(q: number): number {
  return 20 * Math.log10(Math.max(q, 1e-6));
}

/**
 * One-pole cutoff that gives a chosen exponential time constant. Used wherever
 * a smoothing filter has to stand in for an envelope follower's ballistics.
 */
export function timeConstantHz(seconds: number): number {
  return 1 / (2 * Math.PI * Math.max(seconds, 1e-5));
}

export function biquadCoefficients(
  type: BiquadType,
  freqHz: number,
  q: number,
  gainDb: number,
  sampleRate: number,
): BiquadCoefficients {
  const nyquist = sampleRate / 2;
  const f = clamp(freqHz, 1e-3, nyquist * 0.999);
  const w0 = (2 * Math.PI * f) / sampleRate;
  const cos = Math.cos(w0);
  const sin = Math.sin(w0);
  const aQ = sin / (2 * Math.max(q, 1e-6));
  // Only lowpass and highpass take Q in dB; the rest use the plain factor.
  const aQdB = sin / (2 * Math.pow(10, q / 20));
  const amp = Math.pow(10, gainDb / 40);
  // Shelf slope S = 1, which is the value Web Audio fixes for its shelves.
  const aS = (sin / 2) * Math.SQRT2;

  let b0 = 1;
  let b1 = 0;
  let b2 = 0;
  let a0 = 1;
  let a1 = 0;
  let a2 = 0;

  switch (type) {
    case 'lowpass':
      b0 = (1 - cos) / 2;
      b1 = 1 - cos;
      b2 = (1 - cos) / 2;
      a0 = 1 + aQdB;
      a1 = -2 * cos;
      a2 = 1 - aQdB;
      break;
    case 'highpass':
      b0 = (1 + cos) / 2;
      b1 = -(1 + cos);
      b2 = (1 + cos) / 2;
      a0 = 1 + aQdB;
      a1 = -2 * cos;
      a2 = 1 - aQdB;
      break;
    case 'bandpass':
      b0 = aQ;
      b1 = 0;
      b2 = -aQ;
      a0 = 1 + aQ;
      a1 = -2 * cos;
      a2 = 1 - aQ;
      break;
    case 'notch':
      b0 = 1;
      b1 = -2 * cos;
      b2 = 1;
      a0 = 1 + aQ;
      a1 = -2 * cos;
      a2 = 1 - aQ;
      break;
    case 'allpass':
      b0 = 1 - aQ;
      b1 = -2 * cos;
      b2 = 1 + aQ;
      a0 = 1 + aQ;
      a1 = -2 * cos;
      a2 = 1 - aQ;
      break;
    case 'peaking':
      b0 = 1 + aQ * amp;
      b1 = -2 * cos;
      b2 = 1 - aQ * amp;
      a0 = 1 + aQ / amp;
      a1 = -2 * cos;
      a2 = 1 - aQ / amp;
      break;
    case 'lowshelf': {
      const sqrtA = 2 * Math.sqrt(amp) * aS;
      b0 = amp * (amp + 1 - (amp - 1) * cos + sqrtA);
      b1 = 2 * amp * (amp - 1 - (amp + 1) * cos);
      b2 = amp * (amp + 1 - (amp - 1) * cos - sqrtA);
      a0 = amp + 1 + (amp - 1) * cos + sqrtA;
      a1 = -2 * (amp - 1 + (amp + 1) * cos);
      a2 = amp + 1 + (amp - 1) * cos - sqrtA;
      break;
    }
    case 'highshelf': {
      const sqrtA = 2 * Math.sqrt(amp) * aS;
      b0 = amp * (amp + 1 + (amp - 1) * cos + sqrtA);
      b1 = -2 * amp * (amp - 1 + (amp + 1) * cos);
      b2 = amp * (amp + 1 + (amp - 1) * cos - sqrtA);
      a0 = amp + 1 - (amp - 1) * cos + sqrtA;
      a1 = 2 * (amp - 1 - (amp + 1) * cos);
      a2 = amp + 1 - (amp - 1) * cos - sqrtA;
      break;
    }
  }

  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

/** Complex frequency response of one biquad at one frequency. */
export function biquadResponse(c: BiquadCoefficients, freqHz: number, sampleRate: number): Complex {
  const w = (2 * Math.PI * freqHz) / sampleRate;
  const cos1 = Math.cos(-w);
  const sin1 = Math.sin(-w);
  const cos2 = Math.cos(-2 * w);
  const sin2 = Math.sin(-2 * w);

  const nRe = c.b0 + c.b1 * cos1 + c.b2 * cos2;
  const nIm = c.b1 * sin1 + c.b2 * sin2;
  const dRe = 1 + c.a1 * cos1 + c.a2 * cos2;
  const dIm = c.a1 * sin1 + c.a2 * sin2;

  const den = dRe * dRe + dIm * dIm || 1e-30;
  return { re: (nRe * dRe + nIm * dIm) / den, im: (nIm * dRe - nRe * dIm) / den };
}

export function complexMul(a: Complex, b: Complex): Complex {
  return { re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re };
}

export function complexAdd(a: Complex, b: Complex): Complex {
  return { re: a.re + b.re, im: a.im + b.im };
}

export function complexMagnitude(z: Complex): number {
  return Math.hypot(z.re, z.im);
}

export function complexMagnitudeDb(z: Complex): number {
  return gainToDb(complexMagnitude(z));
}

/** Response of a series of biquads: the product of the individual responses. */
export function cascadeResponse(
  coefficients: readonly BiquadCoefficients[],
  freqHz: number,
  sampleRate: number,
): Complex {
  let acc: Complex = { re: 1, im: 0 };
  for (const c of coefficients) acc = complexMul(acc, biquadResponse(c, freqHz, sampleRate));
  return acc;
}

// ---------------------------------------------------------------- EQ response

export interface EqBandSpec {
  type: BiquadType;
  freqHz: number;
  /** Quality factor for every type; converted internally for pass filters. */
  q: number;
  gainDb: number;
  enabled: boolean;
}

/**
 * Combined magnitude response of an EQ, in dB, at each requested frequency.
 * Disabled bands are skipped rather than flattened so a band parked at a silly
 * frequency costs nothing while it is off.
 */
export function eqMagnitudeResponse(
  bands: readonly EqBandSpec[],
  freqsHz: readonly number[],
  sampleRate: number,
): number[] {
  const active = bands.filter((b) => b.enabled);
  const coeffs = active.map((b) =>
    biquadCoefficients(
      b.type,
      b.freqHz,
      b.type === 'lowpass' || b.type === 'highpass' ? qToDb(b.q) : b.q,
      b.gainDb,
      sampleRate,
    ),
  );
  return freqsHz.map((f) => complexMagnitudeDb(cascadeResponse(coeffs, f, sampleRate)));
}

/** Logarithmically spaced analysis points, the spacing an EQ display wants. */
export function logFrequencies(count: number, minHz = 20, maxHz = 20000): number[] {
  const n = Math.max(2, Math.floor(count));
  const ratio = maxHz / minHz;
  return Array.from({ length: n }, (_, i) => minHz * Math.pow(ratio, i / (n - 1)));
}

// -------------------------------------------------------------- LR crossover

/**
 * Three-way Linkwitz-Riley crossover response.
 *
 * Each split is two cascaded Butterworth sections (LR4). An LR4 pair sums to a
 * second-order allpass rather than to unity, so the low band is run through a
 * matching allpass at the upper split frequency; the three bands then sum to
 * `AP(lowSplit) · AP(highSplit)`, whose magnitude is flat everywhere. Phase is
 * not preserved — that is the price of an IIR crossover and the reason the
 * multiband compressor is not bit-transparent when bypassed.
 */
export interface CrossoverResponse {
  low: Complex;
  mid: Complex;
  high: Complex;
  sum: Complex;
}

export function crossoverResponse(
  freqHz: number,
  lowSplitHz: number,
  highSplitHz: number,
  sampleRate: number,
): CrossoverResponse {
  const qdb = BUTTERWORTH_Q_DB;
  const lp1 = biquadCoefficients('lowpass', lowSplitHz, qdb, 0, sampleRate);
  const hp1 = biquadCoefficients('highpass', lowSplitHz, qdb, 0, sampleRate);
  const lp2 = biquadCoefficients('lowpass', highSplitHz, qdb, 0, sampleRate);
  const hp2 = biquadCoefficients('highpass', highSplitHz, qdb, 0, sampleRate);
  const ap2 = biquadCoefficients('allpass', highSplitHz, BUTTERWORTH_Q, 0, sampleRate);

  const low = cascadeResponse([lp1, lp1, ap2], freqHz, sampleRate);
  const mid = cascadeResponse([hp1, hp1, lp2, lp2], freqHz, sampleRate);
  const high = cascadeResponse([hp1, hp1, hp2, hp2], freqHz, sampleRate);
  return { low, mid, high, sum: complexAdd(complexAdd(low, mid), high) };
}

// ------------------------------------------------------------ shaper curves

/** WaveShaper input position for curve index `i` of `size` points: -1 … +1. */
function shaperInput(i: number, size: number): number {
  return (i / (size - 1)) * 2 - 1;
}

function fillCurve(size: number, f: (x: number) => number): Float32Array {
  const n = Math.max(2, Math.floor(size));
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) curve[i] = f(shaperInput(i, n));
  return curve;
}

export type SaturationModel = 'tube' | 'tape' | 'transistor';

export const SATURATION_MODELS: readonly SaturationModel[] = ['tube', 'tape', 'transistor'];

/**
 * Saturation transfer curves, each normalised so full-scale in is full-scale
 * out — drive changes the shape, not the level, which keeps A/B honest.
 *
 * `tube` is deliberately asymmetric (the negative half compresses sooner), so
 * it generates even harmonics and a DC offset; the audio builder pairs it with
 * a DC blocker. `tape` and `transistor` are odd-symmetric.
 */
export function saturationCurve(
  model: SaturationModel,
  driveDb: number,
  size = 2048,
): Float32Array {
  const drive = Math.max(1, dbToGain(driveDb));
  switch (model) {
    case 'tube': {
      const norm = 1 / (1 - Math.exp(-drive));
      const asym = 0.62;
      return fillCurve(size, (x) =>
        x >= 0 ? (1 - Math.exp(-drive * x)) * norm : -(1 - Math.exp(drive * asym * x)) * norm,
      );
    }
    case 'tape': {
      const norm = 1 / Math.tanh(drive);
      return fillCurve(size, (x) => Math.tanh(drive * x) * norm);
    }
    case 'transistor': {
      const norm = 1 / transistorStage(drive);
      return fillCurve(size, (x) => transistorStage(drive * x) * norm);
    }
  }
}

/**
 * Three-region overdrive: linear below a third, a quadratic knee, then the
 * rail at two thirds. Odd-symmetric, continuous at both joins and monotone
 * throughout, which is what keeps it a saturator rather than a fold-back.
 */
function transistorStage(u: number): number {
  const a = Math.abs(u);
  const s = Math.sign(u);
  if (a >= 2 / 3) return s;
  if (a < 1 / 3) return 2 * u;
  const k = 2 - 3 * a;
  return (s * (3 - k * k)) / 3;
}

/**
 * Clipper with an adjustable knee. `hardness` 0 is a gentle bend, 12 is close
 * to a razor. The curve reaches the rail exactly at |drive · x| = 1, so the
 * clipping point is predictable rather than an artefact of the normalisation.
 */
export function clipCurve(driveDb: number, hardness = 8, size = 2048): Float32Array {
  const drive = Math.max(1, dbToGain(driveDb));
  const h = Math.max(0.001, hardness);
  return fillCurve(size, (x) => {
    const u = drive * x;
    return clamp(((1 + h) * u) / (1 + h * Math.abs(u)), -1, 1);
  });
}

/**
 * Mid-tread quantiser. Depth is capped at 12 bit because a WaveShaper
 * interpolates linearly between curve points: past roughly `size / 8` levels
 * the staircase is smoothed back into a straight line and the effect stops
 * being audible for the right reason.
 */
export const MAX_CRUSH_BITS = 12;

export function quantiserCurve(bits: number, size = 32768): Float32Array {
  const b = clamp(Math.round(bits), 1, MAX_CRUSH_BITS);
  const levels = Math.pow(2, b - 1);
  // Round half away from zero. Math.round breaks ties towards +infinity, which
  // would make the quantiser lopsided and put a DC step in the output.
  return fillCurve(size, (x) => {
    const scaled = x * levels;
    return clamp((Math.sign(scaled) * Math.round(Math.abs(scaled))) / levels, -1, 1);
  });
}

/**
 * Exact hard clipper. The curve itself is the identity ramp; the clipping is
 * free, because a WaveShaper holds the first or last curve value for any input
 * outside -1…+1. Inside the rails it is therefore bit-transparent, which is
 * what makes it safe as a limiter's last line of defence.
 */
export function identityCurve(size = 4096): Float32Array {
  return fillCurve(size, (x) => x);
}

/**
 * Full-wave rectifier: the front end of every envelope detector here.
 *
 * The default size is odd on purpose. A WaveShaper interpolates between curve
 * points, and an even-length curve has no entry at exactly zero, so silence
 * would rectify to a small positive floor and hold a gate very slightly open.
 *
 * `headroom` is how far above full scale the rectifier can still measure. A
 * WaveShaper clamps its input to -1…+1, so a plain |x| reads 1 for an input of
 * 1 and 1 again for an input of 4 — a detector in front of any gain stage
 * simply stops responding above full scale. The curve returns `headroom · |x|`
 * instead, so a signal divided by `headroom` on the way in comes back out as
 * its own absolute value and the measurable range widens by that factor. It
 * costs no accuracy at any headroom: |x| is two straight lines meeting at a
 * point the odd size puts exactly on zero, so no interpolated segment ever
 * straddles the kink and every segment is the function itself.
 */
export function rectifierCurve(headroom = 1, size = 2049): Float32Array {
  const scale = Math.max(headroom, 1e-6);
  return fillCurve(size, (x) => scale * Math.abs(x));
}

/**
 * A gain law sampled as a WaveShaper curve: the law applied to |x|, because
 * what the shaper is fed is a rectified envelope.
 *
 * Every dynamics curve here is built through this one function, and every
 * plugin face plots the same law point by point. That is what makes the drawn
 * curve and the filled shaper one thing rather than two that happen to agree.
 */
export function transferCurve(gain: (envelope: number) => number, size = 2048): Float32Array {
  return fillCurve(size, (x) => gain(Math.abs(x)));
}

/**
 * Downward expander / gate law: envelope in (0…1 linear), gain out.
 *
 * Above the threshold the gain is exactly 1, so an open gate is transparent.
 * Below it the signal is pushed down by `(ratio − 1)` dB per dB, floored at
 * `rangeDb` of attenuation.
 */
export function expanderCurve(
  thresholdDb: number,
  ratio: number,
  rangeDb: number,
  size = 2048,
): Float32Array {
  return transferCurve((e) => expanderGain(e, thresholdDb, ratio, rangeDb), size);
}

export function expanderGain(
  envelope: number,
  thresholdDb: number,
  ratio: number,
  rangeDb: number,
): number {
  const envDb = gainToDb(Math.max(envelope, 1e-6));
  if (envDb >= thresholdDb) return 1;
  const below = thresholdDb - envDb;
  const attenuation = Math.min(Math.max(rangeDb, 0), below * Math.max(ratio - 1, 0));
  return dbToGain(-attenuation);
}

/**
 * Compressor law with a soft knee: envelope in (0…1 linear), gain out.
 * Ratio 1 returns unity everywhere, which is what makes bypass free.
 */
export function compressorCurve(
  thresholdDb: number,
  ratio: number,
  kneeDb: number,
  size = 2048,
): Float32Array {
  return transferCurve((e) => compressorGain(e, thresholdDb, ratio, kneeDb), size);
}

export function compressorGain(
  envelope: number,
  thresholdDb: number,
  ratio: number,
  kneeDb: number,
): number {
  const envDb = gainToDb(Math.max(envelope, 1e-6));
  const slope = 1 / Math.max(ratio, 1) - 1;
  const over = envDb - thresholdDb;
  const knee = Math.max(kneeDb, 0);
  if (knee > 0 && over > -knee / 2 && over < knee / 2) {
    const t = over + knee / 2;
    return dbToGain((slope * t * t) / (2 * knee));
  }
  return dbToGain(over <= 0 ? 0 : slope * over);
}

// ------------------------------------------------------------ cabinet models

export interface CabinetMode {
  freqHz: number;
  gainDb: number;
  decayMs: number;
}

export interface CabinetSpec {
  name: string;
  lowCutHz: number;
  highCutHz: number;
  lengthMs: number;
  modes: readonly CabinetMode[];
}

/**
 * Speaker cabinets as a handful of damped resonances rather than a recorded
 * impulse. It is a coarse model, but it is deterministic, weighs nothing and
 * keeps the app usable with no network — a downloaded IR would fail all three.
 */
export const CABINETS: readonly CabinetSpec[] = [
  {
    name: '1x12 Combo',
    lowCutHz: 95,
    highCutHz: 5200,
    lengthMs: 42,
    modes: [
      { freqHz: 118, gainDb: 3, decayMs: 22 },
      { freqHz: 420, gainDb: -3, decayMs: 12 },
      { freqHz: 1650, gainDb: 2, decayMs: 6 },
      { freqHz: 3300, gainDb: -5, decayMs: 3 },
    ],
  },
  {
    name: '2x12 Open Back',
    lowCutHz: 80,
    highCutHz: 5800,
    lengthMs: 48,
    modes: [
      { freqHz: 96, gainDb: 2, decayMs: 26 },
      { freqHz: 250, gainDb: -2, decayMs: 14 },
      { freqHz: 1900, gainDb: 3, decayMs: 5 },
      { freqHz: 4100, gainDb: -6, decayMs: 3 },
    ],
  },
  {
    name: '4x12 Stack',
    lowCutHz: 70,
    highCutHz: 4600,
    lengthMs: 56,
    modes: [
      { freqHz: 82, gainDb: 4, decayMs: 34 },
      { freqHz: 190, gainDb: -1, decayMs: 18 },
      { freqHz: 1250, gainDb: 3, decayMs: 8 },
      { freqHz: 2800, gainDb: -7, decayMs: 4 },
    ],
  },
  {
    name: '8x10 Bass',
    lowCutHz: 38,
    highCutHz: 3400,
    lengthMs: 64,
    modes: [
      { freqHz: 55, gainDb: 5, decayMs: 44 },
      { freqHz: 140, gainDb: 1, decayMs: 22 },
      { freqHz: 700, gainDb: -3, decayMs: 9 },
      { freqHz: 2100, gainDb: -9, decayMs: 4 },
    ],
  },
  {
    name: 'Direct (no cab)',
    lowCutHz: 20,
    highCutHz: 19000,
    lengthMs: 6,
    modes: [],
  },
];

export function cabinetByIndex(index: number): CabinetSpec {
  return CABINETS[clamp(Math.round(index), 0, CABINETS.length - 1)];
}

/**
 * Render a cabinet impulse: a unit spike plus its damped resonances, then a
 * one-pole band limit at each end. Peak-normalised so swapping cabinets does
 * not swap levels.
 */
export function cabinetImpulse(spec: CabinetSpec, sampleRate: number): Float32Array {
  const length = Math.max(8, Math.round((spec.lengthMs / 1000) * sampleRate));
  const out = new Float32Array(length);
  out[0] = 1;
  for (const mode of spec.modes) {
    const amp = dbToGain(mode.gainDb) - 1;
    const tau = Math.max(mode.decayMs, 0.1) / 1000;
    const w = 2 * Math.PI * mode.freqHz;
    for (let i = 0; i < length; i++) {
      const t = i / sampleRate;
      out[i] += amp * Math.exp(-t / tau) * Math.cos(w * t);
    }
  }

  const hp = Math.exp((-2 * Math.PI * spec.lowCutHz) / sampleRate);
  const lp = Math.exp((-2 * Math.PI * Math.min(spec.highCutHz, sampleRate / 2)) / sampleRate);
  let lpState = 0;
  let hpState = 0;
  let hpPrev = 0;
  let peak = 0;
  for (let i = 0; i < length; i++) {
    lpState = out[i] * (1 - lp) + lpState * lp;
    hpState = hp * (hpState + lpState - hpPrev);
    hpPrev = lpState;
    out[i] = hpState;
    peak = Math.max(peak, Math.abs(hpState));
  }
  if (peak > 0) for (let i = 0; i < length; i++) out[i] /= peak;
  return out;
}

// ---------------------------------------------------------------- tempo sync

export type SyncModifier = 'straight' | 'dotted' | 'triplet';

export const SYNC_MODIFIERS: readonly SyncModifier[] = ['straight', 'dotted', 'triplet'];

export function syncModifierByIndex(index: number): SyncModifier {
  return SYNC_MODIFIERS[clamp(Math.round(index), 0, SYNC_MODIFIERS.length - 1)];
}

/**
 * Seconds per beat, with the tempo clamped to the range the transport allows.
 * A project file can arrive with a missing or corrupt tempo, and a NaN reaching
 * a delay time would silence the channel, so it falls back to 120 first.
 */
export function beatSeconds(bpm: number): number {
  return 60 / clamp(Number.isFinite(bpm) ? bpm : 120, 20, 300);
}

/** Length of `sixteenths` sixteenth notes, dotted or tripleted, in seconds. */
export function syncSeconds(sixteenths: number, bpm: number, modifier: SyncModifier): number {
  const base = (beatSeconds(bpm) / 4) * Math.max(sixteenths, 0);
  if (modifier === 'dotted') return base * 1.5;
  if (modifier === 'triplet') return (base * 2) / 3;
  return base;
}

/** The same division expressed as an LFO rate. */
export function syncHz(sixteenths: number, bpm: number, modifier: SyncModifier): number {
  return 1 / Math.max(syncSeconds(sixteenths, bpm, modifier), 1e-4);
}

const DIVISION_NAMES = new Map<number, string>([
  [1, '1/16'],
  [2, '1/8'],
  [4, '1/4'],
  [8, '1/2'],
  [16, '1/1'],
]);

/** How a division reads on a collapsed insert slot: "1/8", "1/4 D", "3/16". */
export function describeDivision(sixteenths: number, modifier: SyncModifier): string {
  const n = clamp(Math.round(sixteenths), 1, 64);
  const name = DIVISION_NAMES.get(n) ?? `${n}/16`;
  if (modifier === 'dotted') return `${name} D`;
  if (modifier === 'triplet') return `${name} T`;
  return name;
}
