/**
 * The maths behind the effect suite, and a structural check on every builder.
 *
 * The curve tests are pure: they compare `dsp/curves` against closed-form
 * results a textbook gives (a peaking filter is exactly its gain at its centre,
 * a Butterworth is exactly −3.01 dB at cutoff, an allpass is exactly flat), so
 * a coefficient typo cannot pass. The builder tests run against a recording
 * stand-in for BaseAudioContext, which is enough to prove a graph is wired,
 * updated and torn down without throwing — and, for the measurement inserts,
 * that nothing sits in the signal path at all.
 */
import { describe, expect, it } from 'vitest';
import {
  BUTTERWORTH_Q,
  CABINETS,
  MAX_CRUSH_BITS,
  biquadCoefficients,
  biquadResponse,
  cabinetImpulse,
  cabinetByIndex,
  clipCurve,
  complexMagnitude,
  complexMagnitudeDb,
  compressorCurve,
  compressorGain,
  crossoverResponse,
  crusherGroupDelaySamples,
  describeDivision,
  dbToGain,
  eqMagnitudeResponse,
  expanderGain,
  gainToDb,
  identityCurve,
  logFrequencies,
  qToDb,
  quantiserCurve,
  rectifierCurve,
  saturationCurve,
  syncHz,
  syncModifierByIndex,
  syncSeconds,
} from '../src/audio/dsp/curves';
import type { SaturationModel } from '../src/audio/dsp/curves';
import {
  CHAIN_PRESETS,
  EFFECT_PRESETS,
  chainSteps,
  presetParams,
} from '../src/model/effectPresets';
import {
  AMP_MODELS,
  BASS_MONO_OFF_HZ,
  CRUSH_FACTORS,
  DEESSER_KNEE_DB,
  EFFECT_SPECS,
  EFFECT_GROUPS,
  LIMITER_KNEE_DB,
  LIMITER_RATIO,
  deesserBand,
  defaultParams,
  dynamicsCurve,
  dynamicsGain,
  dynamicsLawOf,
  effectSpec,
  multibandSplits,
  normaliseParams,
  paramOf,
  shaperCurveKey,
  shaperCurveOf,
  REVERB_DECAY_EXPONENT,
  delayLayoutOf,
  reverbTailOf,
  widthFieldOf,
} from '../src/model/effects';
import type { DynamicsLaw } from '../src/model/effects';
import { DETECTOR_HEADROOM, InsertChain, buildEffectNode } from '../src/audio/effectChain';
import type { EffectNode } from '../src/audio/effectChain';
import { renderModulationClock } from '../src/audio/exportMix';
import type { Effect, EffectKind } from '../src/model/types';

const SR = 48000;

function curveValues(curve: Float32Array): number[] {
  return Array.from(curve);
}

function isNonDecreasing(curve: Float32Array, tolerance = 1e-6): boolean {
  for (let i = 1; i < curve.length; i++) {
    if (curve[i] < curve[i - 1] - tolerance) return false;
  }
  return true;
}

/**
 * What a WaveShaper does with a curve: clamp the input to -1…+1, then read the
 * curve at that position, interpolating linearly between its two nearest
 * points. Reimplemented from the specification rather than measured, because
 * jsdom has no Web Audio — but it is the rule the browser follows, and it is
 * the rule that decides whether a rectifier is exact or merely close.
 */
function readShaper(curve: Float32Array, x: number): number {
  const n = curve.length;
  const clamped = x < -1 ? -1 : x > 1 ? 1 : x;
  const position = ((clamped + 1) / 2) * (n - 1);
  const i = Math.floor(position);
  if (i >= n - 1) return curve[n - 1];
  return curve[i] + (position - i) * (curve[i + 1] - curve[i]);
}

function isOddSymmetric(curve: Float32Array, tolerance = 1e-6): boolean {
  for (let i = 0; i < curve.length; i++) {
    if (Math.abs(curve[i] + curve[curve.length - 1 - i]) > tolerance) return false;
  }
  return true;
}

describe('biquad magnitude response', () => {
  it('gives a peaking filter exactly its gain at its centre frequency', () => {
    for (const gainDb of [-12, -3, 3, 9]) {
      const c = biquadCoefficients('peaking', 1000, 1.4, gainDb, SR);
      expect(complexMagnitudeDb(biquadResponse(c, 1000, SR))).toBeCloseTo(gainDb, 4);
    }
  });

  it('puts a Butterworth lowpass exactly 3.01 dB down at its cutoff', () => {
    // Web Audio reads lowpass Q in decibels; qToDb is what makes that explicit.
    const c = biquadCoefficients('lowpass', 1000, qToDb(BUTTERWORTH_Q), 0, SR);
    expect(complexMagnitudeDb(biquadResponse(c, 1000, SR))).toBeCloseTo(-3.0103, 3);
    // Two octaves up, a second-order slope is 24 dB down.
    expect(complexMagnitudeDb(biquadResponse(c, 4000, SR))).toBeLessThan(-23);
    expect(complexMagnitudeDb(biquadResponse(c, 100, SR))).toBeCloseTo(0, 1);
  });

  it('keeps an allpass flat at every frequency while it turns the phase', () => {
    const c = biquadCoefficients('allpass', 1200, BUTTERWORTH_Q, 0, SR);
    for (const f of logFrequencies(60, 20, 20000)) {
      expect(complexMagnitude(biquadResponse(c, f, SR))).toBeCloseTo(1, 6);
    }
    // Flat magnitude but a real phase shift, or it would be a plain wire:
    // exactly 180° at the centre, and something in between on the way there.
    const atCentre = biquadResponse(c, 1200, SR);
    expect(atCentre.re).toBeCloseTo(-1, 6);
    expect(Math.abs(biquadResponse(c, 600, SR).im)).toBeGreaterThan(0.5);
  });

  it('reaches the shelf gain well inside the shelf and unity well outside', () => {
    const c = biquadCoefficients('lowshelf', 200, BUTTERWORTH_Q, 6, SR);
    expect(complexMagnitudeDb(biquadResponse(c, 20, SR))).toBeCloseTo(6, 1);
    expect(complexMagnitudeDb(biquadResponse(c, 8000, SR))).toBeCloseTo(0, 1);
  });

  it('is silent at DC for a highpass and unity for a bandpass at centre', () => {
    const hp = biquadCoefficients('highpass', 500, qToDb(BUTTERWORTH_Q), 0, SR);
    expect(complexMagnitudeDb(biquadResponse(hp, 1, SR))).toBeLessThan(-90);
    const bp = biquadCoefficients('bandpass', 500, 2, 0, SR);
    expect(complexMagnitudeDb(biquadResponse(bp, 500, SR))).toBeCloseTo(0, 6);
  });
});

describe('eqMagnitudeResponse', () => {
  it('matches the single-band maths and leaves other frequencies alone', () => {
    const response = eqMagnitudeResponse(
      [{ type: 'peaking', freqHz: 1000, q: 1, gainDb: 6, enabled: true }],
      [20, 1000, 18000],
      SR,
    );
    expect(response[1]).toBeCloseTo(6, 4);
    expect(response[0]).toBeCloseTo(0, 1);
    expect(response[2]).toBeCloseTo(0, 1);
  });

  it('adds bands in dB, because a cascade multiplies magnitudes', () => {
    const bands = [
      { type: 'peaking' as const, freqHz: 1000, q: 1, gainDb: 4, enabled: true },
      { type: 'peaking' as const, freqHz: 1000, q: 1, gainDb: 3, enabled: true },
    ];
    expect(eqMagnitudeResponse(bands, [1000], SR)[0]).toBeCloseTo(7, 4);
  });

  it('ignores disabled bands entirely', () => {
    const bands = [
      { type: 'peaking' as const, freqHz: 1000, q: 1, gainDb: 12, enabled: false },
      { type: 'highpass' as const, freqHz: 5000, q: 0.7, gainDb: 0, enabled: false },
    ];
    for (const db of eqMagnitudeResponse(bands, logFrequencies(40), SR)) {
      expect(db).toBeCloseTo(0, 9);
    }
  });
});

describe('Linkwitz-Riley crossover', () => {
  it('sums to unity within 0.5 dB across the whole audio band', () => {
    for (const [low, high] of [
      [220, 3200],
      [80, 900],
      [500, 8000],
    ]) {
      for (const f of logFrequencies(600, 20, 20000)) {
        const db = complexMagnitudeDb(crossoverResponse(f, low, high, SR).sum);
        expect(Math.abs(db), `${f.toFixed(0)} Hz on ${low}/${high}`).toBeLessThan(0.5);
      }
    }
  });

  it('actually splits the band instead of passing everything three times', () => {
    const low = complexMagnitudeDb(crossoverResponse(50, 220, 3200, SR).low);
    const midAtLow = complexMagnitudeDb(crossoverResponse(50, 220, 3200, SR).mid);
    const high = complexMagnitudeDb(crossoverResponse(12000, 220, 3200, SR).high);
    expect(low).toBeCloseTo(0, 1);
    expect(midAtLow).toBeLessThan(-24);
    expect(high).toBeCloseTo(0, 1);
  });

  it('hands each band half the power at its own split frequency', () => {
    const at = crossoverResponse(220, 220, 3200, SR);
    expect(complexMagnitudeDb(at.low)).toBeCloseTo(-6.02, 1);
    expect(complexMagnitudeDb(at.mid)).toBeCloseTo(-6.02, 1);
  });
});

describe('shaper curves', () => {
  const models: SaturationModel[] = ['tube', 'tape', 'transistor'];

  it('keeps every saturation curve monotone and inside the rails', () => {
    for (const model of models) {
      for (const drive of [0, 6, 18, 36]) {
        const curve = saturationCurve(model, drive, 1025);
        expect(isNonDecreasing(curve), `${model} @ ${drive} dB monotone`).toBe(true);
        for (const v of curveValues(curve)) expect(Math.abs(v)).toBeLessThanOrEqual(1 + 1e-6);
        expect(curve[curve.length - 1]).toBeCloseTo(1, 5);
      }
    }
  });

  it('makes tape and transistor odd-symmetric and tube deliberately not', () => {
    expect(isOddSymmetric(saturationCurve('tape', 12, 1025))).toBe(true);
    expect(isOddSymmetric(saturationCurve('transistor', 12, 1025))).toBe(true);
    const tube = saturationCurve('tube', 12, 1025);
    expect(isOddSymmetric(tube)).toBe(false);
    // The asymmetry is the point: the negative half clips earlier.
    expect(Math.abs(tube[0])).toBeLessThan(tube[tube.length - 1]);
  });

  it('clips exactly at the rails and stays odd-symmetric', () => {
    const curve = clipCurve(12, 8, 1025);
    expect(isNonDecreasing(curve)).toBe(true);
    expect(isOddSymmetric(curve)).toBe(true);
    expect(curve[0]).toBeCloseTo(-1, 6);
    expect(curve[curve.length - 1]).toBeCloseTo(1, 6);
  });

  it('leaves the identity curve transparent, so clipping comes only from the rails', () => {
    const curve = identityCurve(4096);
    for (let i = 0; i < curve.length; i++) {
      expect(curve[i]).toBeCloseTo((i / (curve.length - 1)) * 2 - 1, 6);
    }
  });

  it('rectifies both halves of the wave', () => {
    const curve = rectifierCurve(1, 1025);
    expect(curve[0]).toBeCloseTo(1, 6);
    expect(curve[curve.length - 1]).toBeCloseTo(1, 6);
    expect(curve[(curve.length - 1) / 2]).toBeCloseTo(0, 6);
  });

  it('stays exactly |x| at any headroom, being two straight lines through zero', () => {
    for (const headroom of [1, 4, DETECTOR_HEADROOM]) {
      const curve = rectifierCurve(headroom);
      const kink = (curve.length - 1) / 2;
      // The kink is a curve point, so no interpolated segment straddles it...
      expect(curve[kink], `${headroom}x`).toBe(0);
      // ...and each half is one constant slope, so every segment the shaper
      // interpolates over IS the function rather than a chord across a bend.
      const falling = curve[0] - curve[1];
      const rising = curve[curve.length - 1] - curve[curve.length - 2];
      expect(falling, `${headroom}x`).toBe(rising);
      for (let i = 0; i < kink; i++) expect(curve[i] - curve[i + 1]).toBe(falling);
      for (let i = kink; i < curve.length - 1; i++) expect(curve[i + 1] - curve[i]).toBe(rising);
    }
  });

  it('measures a hot signal instead of flattening it at full scale', () => {
    const curve = rectifierCurve(DETECTOR_HEADROOM);
    // Ordinary levels are still read exactly — the headroom buys range, not
    // an approximation — and so now are levels well above full scale.
    for (const db of [-60, -18, -6, 0, 6, 12, 20]) {
      const level = dbToGain(db);
      for (const sign of [1, -1]) {
        const read = readShaper(curve, (sign * level) / DETECTOR_HEADROOM);
        expect(read, `${db} dB`).toBeCloseTo(level, 12);
      }
    }
    // What it used to do to anything hotter than full scale, in one line: a
    // detector that reads 1.0 for an input of 4.0 has stopped detecting.
    expect(readShaper(rectifierCurve(), 4)).toBe(1);
    expect(readShaper(rectifierCurve(), 1)).toBe(1);
  });
});

describe('bit-depth quantiser', () => {
  it('quantises to the right number of levels and never inverts', () => {
    for (const bits of [2, 4, 8, MAX_CRUSH_BITS]) {
      const curve = quantiserCurve(bits, 32768);
      const step = 1 / Math.pow(2, bits - 1);
      expect(isNonDecreasing(curve), `${bits} bit monotone`).toBe(true);
      // Sampled rather than exhaustive: the monotone check above already
      // walked every point, and 130k assertions buy nothing over 4k.
      for (let i = 0; i < curve.length; i += 7) {
        const x = (i / (curve.length - 1)) * 2 - 1;
        // Mid-tread rounding never errs by more than half a step.
        expect(Math.abs(curve[i] - x)).toBeLessThanOrEqual(step / 2 + 1e-6);
        expect(Math.abs(curve[i] / step - Math.round(curve[i] / step))).toBeLessThan(1e-4);
      }
    }
  });

  it('collapses one bit to three states and stays symmetric', () => {
    const curve = quantiserCurve(1, 4097);
    const distinct = [...new Set(curveValues(curve))].sort((a, b) => a - b);
    expect(distinct).toEqual([-1, 0, 1]);
    expect(isOddSymmetric(curve)).toBe(true);
  });

  it('clamps a silly bit depth instead of producing an unusable curve', () => {
    expect(curveValues(quantiserCurve(0, 1025)).every(Number.isFinite)).toBe(true);
    expect(curveValues(quantiserCurve(64, 1025)).every(Number.isFinite)).toBe(true);
  });
});

describe('dynamics laws', () => {
  it('leaves an open gate at unity and closes it by exactly the range', () => {
    expect(expanderGain(0.5, -40, 8, 40)).toBe(1);
    expect(expanderGain(1e-4, -40, 8, 40)).toBeCloseTo(0.01, 6);
    // Ratio 1 is no expansion at all, which is what makes bypass free.
    expect(expanderGain(1e-6, -40, 1, 40)).toBe(1);
    // Range 0 means the gate is armed but attenuates nothing.
    expect(expanderGain(1e-6, -40, 8, 0)).toBe(1);
  });

  it('expands monotonically between the rails', () => {
    let previous = 0;
    for (let db = -90; db <= 0; db += 1) {
      const gain = expanderGain(Math.pow(10, db / 20), -40, 4, 40);
      expect(gain).toBeGreaterThanOrEqual(previous - 1e-9);
      previous = gain;
    }
  });

  it('compresses only above the threshold and honours the ratio', () => {
    expect(compressorGain(0.001, -20, 4, 0)).toBe(1);
    // 12 dB over a 4:1 threshold comes out 9 dB down.
    const overDb = -8;
    const gain = compressorGain(Math.pow(10, overDb / 20), -20, 4, 0);
    expect(20 * Math.log10(gain)).toBeCloseTo(12 * (1 / 4 - 1), 6);
    expect(compressorGain(0.9, -20, 1, 6)).toBeCloseTo(1, 9);
  });

  it('joins the soft knee onto both straight sections', () => {
    const knee = 12;
    const below = compressorGain(Math.pow(10, (-20 - knee / 2) / 20), -20, 4, knee);
    const above = compressorGain(Math.pow(10, (-20 + knee / 2) / 20), -20, 4, knee);
    expect(20 * Math.log10(below)).toBeCloseTo(0, 3);
    expect(20 * Math.log10(above)).toBeCloseTo((knee / 2) * (1 / 4 - 1), 3);
  });
});

describe('cabinet impulses', () => {
  it('renders a finite, peak-normalised impulse that decays', () => {
    for (let i = 0; i < CABINETS.length; i++) {
      const spec = cabinetByIndex(i);
      const impulse = cabinetImpulse(spec, SR);
      expect(impulse.length).toBe(Math.round((spec.lengthMs / 1000) * SR));
      let peak = 0;
      let head = 0;
      let tail = 0;
      const half = impulse.length >> 1;
      for (let s = 0; s < impulse.length; s++) {
        expect(Number.isFinite(impulse[s])).toBe(true);
        peak = Math.max(peak, Math.abs(impulse[s]));
        if (s < half) head += impulse[s] * impulse[s];
        else tail += impulse[s] * impulse[s];
      }
      expect(peak).toBeCloseTo(1, 5);
      expect(tail).toBeLessThan(head);
    }
  });

  it('clamps a cabinet index rather than returning undefined', () => {
    expect(cabinetByIndex(-5)).toBe(CABINETS[0]);
    expect(cabinetByIndex(99)).toBe(CABINETS[CABINETS.length - 1]);
  });
});

describe('tempo sync', () => {
  it('converts divisions to seconds at the project tempo', () => {
    expect(syncSeconds(4, 120, 'straight')).toBeCloseTo(0.5, 9);
    expect(syncSeconds(16, 120, 'straight')).toBeCloseTo(2, 9);
    expect(syncSeconds(1, 60, 'straight')).toBeCloseTo(0.25, 9);
  });

  it('lengthens a dotted division by half and shortens a triplet by a third', () => {
    expect(syncSeconds(4, 120, 'dotted')).toBeCloseTo(0.75, 9);
    expect(syncSeconds(4, 120, 'triplet')).toBeCloseTo(1 / 3, 9);
    // Three triplets fill the same time as two straight divisions.
    expect(syncSeconds(4, 120, 'triplet') * 3).toBeCloseTo(syncSeconds(4, 120, 'straight') * 2, 9);
  });

  it('expresses the same division as an LFO rate', () => {
    expect(syncHz(16, 120, 'straight')).toBeCloseTo(0.5, 9);
    expect(syncHz(4, 120, 'straight')).toBeCloseTo(2, 9);
  });

  it('clamps an impossible tempo instead of dividing by zero', () => {
    // A zero tempo clamps to the transport's 20 bpm floor: a beat is 3 s.
    expect(syncSeconds(4, 0, 'straight')).toBeCloseTo(3, 9);
    expect(Number.isFinite(syncHz(1, Number.NaN, 'straight'))).toBe(true);
  });

  it('names divisions the way a musician reads them', () => {
    expect(describeDivision(1, 'straight')).toBe('1/16');
    expect(describeDivision(4, 'straight')).toBe('1/4');
    expect(describeDivision(16, 'straight')).toBe('1/1');
    expect(describeDivision(3, 'straight')).toBe('3/16');
    expect(describeDivision(4, 'dotted')).toBe('1/4 D');
    expect(describeDivision(2, 'triplet')).toBe('1/8 T');
  });

  it('clamps a modifier index to a real modifier', () => {
    expect(syncModifierByIndex(-1)).toBe('straight');
    expect(syncModifierByIndex(99)).toBe('triplet');
  });
});

describe('parameter normalisation across every kind', () => {
  it('produces a complete, in-range map from nothing', () => {
    for (const spec of EFFECT_SPECS) {
      const params = normaliseParams(spec.kind, undefined);
      expect(Object.keys(params).sort()).toEqual(spec.params.map((p) => p.key).sort());
      for (const p of spec.params) {
        expect(params[p.key], `${spec.kind}.${p.key}`).toBe(p.default);
      }
    }
  });

  it('clamps every parameter of every kind from both directions', () => {
    for (const spec of EFFECT_SPECS) {
      const tooLow = Object.fromEntries(spec.params.map((p) => [p.key, -1e9]));
      const tooHigh = Object.fromEntries(spec.params.map((p) => [p.key, 1e9]));
      const low = normaliseParams(spec.kind, tooLow);
      const high = normaliseParams(spec.kind, tooHigh);
      for (const p of spec.params) {
        expect(low[p.key], `${spec.kind}.${p.key} low`).toBe(p.choices ? Math.round(p.min) : p.min);
        expect(high[p.key], `${spec.kind}.${p.key} high`).toBe(
          p.choices ? Math.round(p.max) : p.max,
        );
      }
    }
  });

  it('replaces junk with defaults for every kind', () => {
    for (const spec of EFFECT_SPECS) {
      const junk: Record<string, unknown> = {};
      for (const p of spec.params) junk[p.key] = ['nonsense', NaN, Infinity, null][0];
      const params = normaliseParams(spec.kind, junk);
      for (const p of spec.params) expect(params[p.key]).toBe(p.default);
    }
  });

  it('snaps choice parameters to whole indices inside the list', () => {
    for (const spec of EFFECT_SPECS) {
      for (const p of spec.params) {
        if (!p.choices) continue;
        const value = normaliseParams(spec.kind, { [p.key]: 1.4 })[p.key];
        expect(Number.isInteger(value), `${spec.kind}.${p.key}`).toBe(true);
        expect(p.choices[value], `${spec.kind}.${p.key} names a setting`).toBeTruthy();
      }
    }
  });
});

describe('factory presets', () => {
  it('names every preset for a kind the app knows', () => {
    for (const preset of EFFECT_PRESETS) {
      expect(effectSpec(preset.kind), preset.id).toBeTruthy();
    }
    expect(new Set(EFFECT_PRESETS.map((p) => p.id)).size).toBe(EFFECT_PRESETS.length);
  });

  it('sets only parameters that exist, so nothing is silently dropped', () => {
    for (const preset of EFFECT_PRESETS) {
      const keys = new Set(effectSpec(preset.kind)!.params.map((p) => p.key));
      for (const key of Object.keys(preset.params)) {
        expect(keys.has(key), `${preset.id} sets unknown "${key}"`).toBe(true);
      }
    }
  });

  it('expands to a complete parameter map that keeps what the preset asked for', () => {
    for (const preset of EFFECT_PRESETS) {
      const params = presetParams(preset);
      const spec = effectSpec(preset.kind)!;
      expect(Object.keys(params).sort()).toEqual(spec.params.map((p) => p.key).sort());
      for (const [key, value] of Object.entries(preset.params)) {
        const p = spec.params.find((x) => x.key === key)!;
        expect(value, `${preset.id}.${key} is outside its range`).toBeGreaterThanOrEqual(p.min);
        expect(value, `${preset.id}.${key} is outside its range`).toBeLessThanOrEqual(p.max);
        expect(params[key]).toBe(p.choices ? Math.round(value) : value);
      }
    }
  });

  it('gives the headline effects at least four presets each', () => {
    for (const kind of [
      'compressor',
      'eq8',
      'reverb',
      'delay',
      'saturator',
      'ampsim',
    ] as EffectKind[]) {
      expect(EFFECT_PRESETS.filter((p) => p.kind === kind).length, kind).toBeGreaterThanOrEqual(4);
    }
  });

  it('expands every chain preset into buildable steps', () => {
    expect(CHAIN_PRESETS.map((c) => c.name)).toEqual([
      'Vocal Bus',
      'Drum Glue',
      'Bass DI',
      'Acoustic Sparkle',
      'Master Polish',
    ]);
    for (const chain of CHAIN_PRESETS) {
      const steps = chainSteps(chain);
      expect(steps.length).toBe(chain.steps.length);
      for (const step of steps) {
        const spec = effectSpec(step.kind)!;
        expect(spec).toBeTruthy();
        expect(Object.keys(step.params).sort()).toEqual(spec.params.map((p) => p.key).sort());
        for (const p of spec.params) {
          expect(step.params[p.key]).toBeGreaterThanOrEqual(p.min);
          expect(step.params[p.key]).toBeLessThanOrEqual(p.max);
        }
        expect(typeof step.bypass).toBe('boolean');
      }
    }
  });
});

// --------------------------------------------------------------- graph checks

interface Connection {
  from: RecordingNode;
  to: RecordingNode | RecordingParam;
  /**
   * The output and input channel indices of `connect`, kept because a
   * splitter/merger pair carries the two sides of the stereo image down two
   * routes that must not be read as two copies of one signal.
   */
  output?: number;
  input?: number;
}

interface RecordingParam {
  value: number;
  setTargetAtTime(value: number, when: number, timeConstant: number): void;
  setValueAtTime(value: number, when: number): void;
  cancelScheduledValues(when: number): void;
}

interface RecordingNode {
  kind: string;
  connect(
    destination: RecordingNode | RecordingParam,
    output?: number,
    input?: number,
  ): RecordingNode | undefined;
  disconnect(): void;
  [key: string]: unknown;
}

/**
 * A recording stand-in for BaseAudioContext. jsdom has no Web Audio, and the
 * point here is not to render audio — it is to prove that every builder wires a
 * graph, survives an update in both bypass states and tears itself down.
 */
function recordingContext(): { ctx: BaseAudioContext; connections: Connection[] } {
  const connections: Connection[] = [];

  const param = (value = 0): RecordingParam => ({
    value,
    setTargetAtTime(v) {
      this.value = v;
    },
    setValueAtTime(v) {
      this.value = v;
    },
    cancelScheduledValues() {},
  });

  const isParam = (x: RecordingNode | RecordingParam): x is RecordingParam =>
    typeof (x as RecordingParam).setTargetAtTime === 'function';

  const node = (kind: string, extra: Record<string, unknown> = {}): RecordingNode => {
    const self: RecordingNode = {
      kind,
      ...extra,
      connect(destination, output, input) {
        connections.push({ from: self, to: destination, output, input });
        return isParam(destination) ? undefined : destination;
      },
      disconnect() {},
    };
    return self;
  };

  const source = (kind: string, extra: Record<string, unknown> = {}) =>
    node(kind, { ...extra, start: () => {}, stop: () => {} });

  const ctx = {
    sampleRate: SR,
    currentTime: 0,
    createGain: () =>
      node('gain', {
        gain: param(1),
        channelCount: 2,
        channelCountMode: 'max',
        channelInterpretation: 'speakers',
      }),
    createBiquadFilter: () =>
      node('biquad', {
        type: 'lowpass',
        frequency: param(350),
        Q: param(1),
        gain: param(0),
        detune: param(0),
      }),
    createWaveShaper: () => node('waveshaper', { curve: null, oversample: 'none' }),
    createDelay: () => node('delay', { delayTime: param(0) }),
    createConvolver: () => node('convolver', { buffer: null, normalize: true }),
    createDynamicsCompressor: () =>
      node('compressor', {
        threshold: param(-24),
        knee: param(30),
        ratio: param(12),
        attack: param(0.003),
        release: param(0.25),
        reduction: 0,
      }),
    createChannelSplitter: () => node('splitter'),
    createChannelMerger: () => node('merger'),
    createStereoPanner: () => node('panner', { pan: param(0) }),
    createAnalyser: () =>
      node('analyser', {
        fftSize: 2048,
        smoothingTimeConstant: 0.8,
        getFloatTimeDomainData: (buffer: Float32Array) => buffer.fill(0),
      }),
    createOscillator: () => {
      // The wave and the start time are kept because they are the whole of a
      // modulator's phase: an oscillator's output at any instant is its series
      // evaluated at the time since it started, and nothing else.
      const osc = source('oscillator', {
        type: 'sine',
        frequency: param(440),
        detune: param(0),
        wave: null,
        startedAt: null,
      });
      osc.setPeriodicWave = (w: unknown) => {
        osc.wave = w;
      };
      osc.start = (when?: number) => {
        osc.startedAt = when ?? 0;
      };
      return osc;
    },
    createConstantSource: () => source('constant', { offset: param(1) }),
    createPeriodicWave: (real: Float32Array, imag: Float32Array) => ({ real, imag }),
    createBuffer: (channels: number, length: number) => ({
      length,
      numberOfChannels: channels,
      sampleRate: SR,
      getChannelData: () => new Float32Array(length),
    }),
  };

  return { ctx: ctx as unknown as BaseAudioContext, connections };
}

function effectOf(kind: EffectKind): Effect {
  return { id: `fx-${kind}`, kind, bypass: false, params: defaultParams(kind) };
}

// -------------------------------------------------------- bypass transparency

const isNode = (end: RecordingNode | RecordingParam): end is RecordingNode => 'kind' in end;

/**
 * The value a control connection holds a parameter at, or NaN if something can
 * still move it.
 *
 * A ConstantSource contributes its offset and an oscillator contributes
 * anything at all, which is the distinction that matters: the DC of an LFO is
 * zero whether or not it is switched on, so summing values would call a
 * running tremolo still. What proves a modulation path shut is a gain of
 * exactly zero standing in it, and that is the one case walked no further.
 *
 * The walk needs no loop guard. Web Audio mutes any cycle that does not
 * contain a DelayNode, so every cycle in a working graph has one, and a delay
 * is not a constant.
 */
function heldAt(node: RecordingNode, connections: Connection[]): number {
  if (node.kind === 'constant') return (node.offset as RecordingParam).value;
  if (node.kind !== 'gain') return NaN;
  const g = gainOf(node, connections);
  if (g === 0) return 0;
  const sources = connections.filter((c) => c.to === node);
  if (sources.length === 0) return NaN;
  return g * sources.reduce((sum, c) => sum + heldAt(c.from, connections), 0);
}

/** What a parameter is pinned to: its own value plus everything driving it. */
function settledAt(param: RecordingParam, connections: Connection[]): number {
  return connections
    .filter((c) => c.to === param)
    .reduce((total, c) => total + heldAt(c.from, connections), param.value);
}

/** The constant a gain node multiplies by, driven gain included. */
function gainOf(node: RecordingNode, connections: Connection[]): number {
  return settledAt(node.gain as RecordingParam, connections);
}

/**
 * Connections out of, and into, one node.
 *
 * The node is `unknown` on purpose. What is being asked is identity — is this
 * the very object the builder wired? — and a built `EffectNode` hands its ends
 * back typed as `AudioNode` while the recorder deals in stand-ins, so a typed
 * comparison is one TypeScript can prove is always false. Narrowing the
 * parameter instead of casting the argument keeps the question honest: a lookup
 * that finds nothing still finds nothing, rather than being told it cannot.
 */
function fedBy(connections: Connection[], node: unknown): Connection[] {
  return connections.filter((c) => c.from === node);
}

function feeding(connections: Connection[], node: unknown): Connection[] {
  return connections.filter((c) => c.to === node);
}

/** Every DelayNode anywhere in a recorded graph. */
function delayNodesIn(connections: Connection[]): RecordingNode[] {
  const found = new Set<RecordingNode>();
  for (const c of connections) {
    for (const end of [c.from, c.to]) {
      if ('kind' in end && end.kind === 'delay') found.add(end as RecordingNode);
    }
  }
  return [...found];
}

/**
 * What an oscillator is putting out at context time `t`.
 *
 * The Web Audio definition of a `PeriodicWave`, evaluated: harmonic k
 * contributes real[k]·cos(k·φ) + imag[k]·sin(k·φ) with φ measured from the
 * instant the oscillator was started, and nothing at all before that instant.
 * Reimplemented from the specification for the same reason `readShaper` is —
 * jsdom has no Web Audio — and it is what lets a modulator be compared sample
 * by sample rather than by the numbers that were handed to it.
 */
function oscillatorAt(node: RecordingNode, t: number): number {
  const wave = node.wave as { real: Float32Array; imag: Float32Array } | null;
  const startedAt = node.startedAt as number | null;
  if (!wave || startedAt === null || t < startedAt) return 0;
  const phase = 2 * Math.PI * (node.frequency as RecordingParam).value * (t - startedAt);
  let sum = 0;
  for (let k = 1; k < wave.real.length; k++) {
    sum += wave.real[k] * Math.cos(k * phase) + wave.imag[k] * Math.sin(k * phase);
  }
  return sum;
}

/**
 * The signal one node carries at context time `t`, over a graph of oscillators,
 * constant sources and gains — which is the whole of any modulation path here.
 */
function signalAt(node: RecordingNode, connections: Connection[], t: number): number {
  if (node.kind === 'oscillator') return oscillatorAt(node, t);
  if (node.kind === 'constant') return (node.offset as RecordingParam).value;
  if (node.kind !== 'gain') return NaN;
  const feeds = connections.filter((c) => c.to === node);
  return (
    gainOf(node, connections) * feeds.reduce((sum, c) => sum + signalAt(c.from, connections, t), 0)
  );
}

/** What a parameter is driven to at context time `t`, its own value included. */
function paramAt(param: RecordingParam, connections: Connection[], t: number): number {
  return connections
    .filter((c) => c.to === param)
    .reduce((total, c) => total + signalAt(c.from, connections, t), param.value);
}

/**
 * Whether a node passes audio through unaltered as it is currently set.
 *
 * Splitters and mergers only move channels about; a delay of zero and a panner
 * at centre are wires; a peaking or shelving biquad at 0 dB is the identity
 * exactly, because at unit gain its numerator and denominator are the same
 * polynomial. Everything else — a pass filter, a convolver, a compressor, and
 * above all a WaveShaper, whose `oversample` switches on resampling filters
 * that are neither flat nor latency-free — colours or delays what it is given.
 */
function isTransparent(node: RecordingNode, connections: Connection[]): boolean {
  switch (node.kind) {
    case 'gain':
    case 'splitter':
    case 'merger':
      return true;
    case 'delay':
      return settledAt(node.delayTime as RecordingParam, connections) === 0;
    case 'panner':
      return settledAt(node.pan as RecordingParam, connections) === 0;
    case 'biquad':
      return (
        ['peaking', 'lowshelf', 'highshelf'].includes(node.type as string) &&
        settledAt(node.gain as RecordingParam, connections) === 0
      );
    default:
      return false;
  }
}

/** How a node is named in a complaint: enough to find it in the builder. */
function nameOf(node: RecordingNode): string {
  if (node.kind === 'biquad') return `${node.kind} ${node.type}`;
  if (node.kind === 'waveshaper') return `${node.kind} ${node.oversample}`;
  return node.kind;
}

interface Route {
  /** The nodes that are not wires, named — empty for a route that adds nothing. */
  through: string;
  /** The channel indices the route was connected on, empty for the usual case. */
  channels: string;
  /** The product of the gains along it, counting every other node as unity. */
  scale: number;
}

/**
 * Every route audio can take from one node to another.
 *
 * Simple paths only: a route that arrives back at a node it has already
 * visited is a feedback loop going round again, and what it does on the second
 * pass is what it did on the first, scaled. Since a bypassed insert has to
 * hold every loop at zero gain anyway, the first pass is enough to see it.
 */
function routesBetween(connections: Connection[], from: RecordingNode, to: RecordingNode): Route[] {
  const routes: Route[] = [];
  const walk = (at: RecordingNode, visited: RecordingNode[], route: Route) => {
    if (at === to) {
      routes.push(route);
      return;
    }
    for (const c of connections) {
      if (c.from !== at || !isNode(c.to) || visited.includes(c.to)) continue;
      const next = c.to;
      const added = route.through ? `${route.through} → ${nameOf(next)}` : nameOf(next);
      walk(next, [...visited, next], {
        through: isTransparent(next, connections) ? route.through : added,
        channels:
          c.output === undefined && c.input === undefined
            ? route.channels
            : `${route.channels}${c.output}:${c.input},`,
        scale: next.kind === 'gain' ? route.scale * gainOf(next, connections) : route.scale,
      });
    }
  };
  walk(from, [from], { through: '', channels: '', scale: 1 });
  return routes;
}

/**
 * Everything that stops a bypassed insert from being a route around itself,
 * as a list of complaints — empty when the insert is transparent.
 *
 * A route at zero gain carries nothing and is ignored; of the rest, the ones
 * that add nothing must sum to unity, one channel of the image at a time, and
 * the ones that add something must sum to zero. Routes are added up rather
 * than judged one at a time because two of them through the same processing
 * can be the honest way to bypass it — the de-esser subtracts its own band
 * back out, so its band filter is on two live routes at +1 and −1 and is
 * therefore not in circuit at all.
 */
function bypassFaults(kind: EffectKind): string[] {
  const { ctx, connections } = recordingContext();
  const effect = effectOf(kind);
  const node = buildEffectNode(ctx, effect);
  // Once each way round: a builder that only writes a gain on the branch it
  // thinks is active leaves the other one wherever it happened to be.
  node.update(effect, 120, false);
  node.update({ ...effect, bypass: true }, 120, true);
  const input = node.input as unknown as RecordingNode;
  const output = node.output as unknown as RecordingNode;
  const faults: string[] = [];

  if (input === output) {
    const gain = gainOf(input, connections);
    if (gain !== 1) faults.push(`its single node sits at a gain of ${gain}`);
    return faults;
  }

  const routes = routesBetween(connections, input, output).filter((r) => r.scale !== 0);
  if (!routes.some((r) => r.through === '')) {
    faults.push('no live route from input to output avoids its processing');
  }
  for (const channels of new Set(routes.map((r) => r.channels))) {
    for (const through of new Set(routes.map((r) => r.through))) {
      const group = routes.filter((r) => r.channels === channels && r.through === through);
      if (group.length === 0) continue;
      const sum = group.reduce((total, r) => total + r.scale, 0);
      const wanted = through === '' ? 1 : 0;
      if (!(Math.abs(sum - wanted) <= 1e-9)) {
        faults.push(
          through === ''
            ? `its clear route carries ${sum} rather than unity`
            : `${sum} of the signal still passes ${through}`,
        );
      }
    }
  }
  return faults;
}

describe('effect builders', () => {
  it('builds, updates and disposes every declared kind', () => {
    for (const spec of EFFECT_SPECS) {
      const { ctx, connections } = recordingContext();
      const effect = effectOf(spec.kind);
      const node = buildEffectNode(ctx, effect);
      expect(node.id, spec.kind).toBe(effect.id);
      expect(node.input, spec.kind).toBeTruthy();
      expect(node.output, spec.kind).toBeTruthy();
      // Anything that is more than a single node has to wire itself together.
      if (node.input !== node.output) {
        expect(connections.length, `${spec.kind} wired nothing`).toBeGreaterThan(0);
      }
      expect(() => node.update(effect, 120, false)).not.toThrow();
      expect(() => node.update({ ...effect, bypass: true }, 90, true)).not.toThrow();
      expect(() => node.update(effect, 174, false)).not.toThrow();
      expect(() => node.dispose()).not.toThrow();
    }
  });

  it('survives an effect whose parameters are all missing', () => {
    for (const spec of EFFECT_SPECS) {
      const { ctx } = recordingContext();
      const bare: Effect = { id: 'bare', kind: spec.kind, bypass: false, params: {} };
      const node = buildEffectNode(ctx, bare);
      expect(() => node.update(bare, 120, false)).not.toThrow();
      node.dispose();
    }
  });

  it('publishes a gain-reduction readout for exactly the kinds that advertise one', () => {
    for (const spec of EFFECT_SPECS) {
      const { ctx } = recordingContext();
      const effect = effectOf(spec.kind);
      const node = buildEffectNode(ctx, effect);
      node.update(effect, 120, false);
      expect(typeof node.gainReductionDb === 'function', spec.kind).toBe(
        spec.gainReduction === true,
      );
      if (node.gainReductionDb) {
        const reduction = node.gainReductionDb();
        expect(Number.isFinite(reduction), spec.kind).toBe(true);
        expect(reduction, spec.kind).toBeLessThanOrEqual(0);
      }
      node.dispose();
    }
  });

  it('leaves the signal untouched in the measurement-only inserts', () => {
    for (const kind of ['analyser', 'tuner', 'vocaltune'] as EffectKind[]) {
      const { ctx, connections } = recordingContext();
      const effect = effectOf(kind);
      const node = buildEffectNode(ctx, effect);
      // Input and output are one and the same node, so nothing can sit between.
      expect(node.input, kind).toBe(node.output);
      const gain = node.output as unknown as { gain: RecordingParam };
      node.update(effect, 120, false);
      node.update({ ...effect, bypass: true }, 120, true);
      expect(gain.gain.value, `${kind} altered its gain`).toBe(1);
      // Anything it does connect to is a dead-end tap, never a return path.
      for (const c of connections) {
        expect((c.to as RecordingNode).kind, kind).toBe('analyser');
      }
      node.dispose();
    }
  });

  /**
   * The whole contract `WetDry` states: "a bypassed insert is mathematically
   * transparent whatever the wet path does". Twenty-six of the twenty-seven
   * kinds honoured it and the Limiter did not — it returned its scale gains to
   * unity and left the signal running through a `WaveShaperNode` with
   * `oversample: '4x'`, whose resampling filters are neither flat nor
   * latency-free, so switching that insert off comb-filtered the channel it
   * was supposed to leave alone. Checking one insert is what let that sit
   * there; this is over all of them.
   */
  it('routes a bypassed insert around everything it adds, for every declared kind', () => {
    for (const spec of EFFECT_SPECS) {
      expect(bypassFaults(spec.kind).join('; '), spec.kind).toBe('');
    }
  });

  it('gives the analyser insert the window size its parameter names', () => {
    const { ctx } = recordingContext();
    const effect = effectOf('analyser');
    const node = buildEffectNode(ctx, effect);
    node.update({ ...effect, params: { ...effect.params, resolution: 4 } }, 120, false);
    expect((node.tap as unknown as { fftSize: number }).fftSize).toBe(8192);
    node.dispose();
  });
});

/**
 * The compressor is the one processor a mixer expects to key from somewhere
 * else, and for a long time it could not: it was a `DynamicsCompressorNode`,
 * which has no external detector input, so the sidechain menu connected a key
 * to nothing and the plugin face plotted a curve the audio never used. These
 * pin down what replaced it — the key input, the law, the bypass and the meter.
 */
describe('the keyable compressor', () => {
  const params = { threshold: -18, ratio: 6, knee: 9, attack: 5, release: 200, makeupDb: 0 };
  const compressor = (overrides: Record<string, number> = {}, bypass = false): Effect => ({
    id: 'comp',
    kind: 'compressor',
    bypass,
    params: { ...params, ...overrides },
  });

  /**
   * The control VCA's parts, identified by how they are wired rather than by
   * name, because the recording context hands back anonymous nodes.
   */
  function partsOf(effect: Effect) {
    const { ctx, connections } = recordingContext();
    const node = buildEffectNode(ctx, effect);
    const out = (n: unknown) => connections.filter((c) => c.from === n).map((c) => c.to);
    const into = (n: unknown) => connections.filter((c) => c.to === n).map((c) => c.from);
    const key = node.sidechain as unknown as RecordingNode;
    const rect = out(key)[0] as RecordingNode;
    const detector = out(rect)[0] as RecordingNode;
    const constant = connections.find((c) => c.from.kind === 'constant')!.from;
    const lookahead = out(node.input).find(
      (n) => (n as RecordingNode).kind === 'delay',
    ) as RecordingNode;
    return {
      node,
      key: key as unknown as { gain: RecordingParam },
      rect: rect as unknown as { curve: Float32Array },
      internalKey: into(rect).find((n) => n !== key) as unknown as { gain: RecordingParam },
      shaper: out(detector)[0] as unknown as { curve: Float32Array },
      depth: into(node.tap)[0] as unknown as { gain: RecordingParam },
      dry: out(constant)[0] as unknown as { gain: RecordingParam },
      vca: out(lookahead)[0] as unknown as { gain: RecordingParam },
      lookahead: lookahead as unknown as { delayTime: RecordingParam },
      makeup: node.output as unknown as { gain: RecordingParam },
    };
  }

  it('shapes the gain with the exact law the plugin face plots', () => {
    const effect = compressor();
    const parts = partsOf(effect);
    parts.node.update(effect, 120, false);

    // Same array the face's `compressorGain` would produce point for point —
    // the whole reason the drawn knee is now the heard knee.
    expect(parts.shaper.curve).toEqual(compressorCurve(-18, 6, 9));
    const curve = parts.shaper.curve;
    for (let i = 0; i < curve.length; i += 37) {
      const x = (i / (curve.length - 1)) * 2 - 1;
      expect(curve[i]).toBeCloseTo(compressorGain(Math.abs(x), -18, 6, 9), 6);
    }
  });

  it('rebuilds the curve when threshold, ratio or knee move, and only then', () => {
    const effect = compressor();
    const parts = partsOf(effect);
    parts.node.update(effect, 120, false);
    const first = parts.shaper.curve;

    // Ballistics are ramped, not rebuilt: a slower release must not cost a curve.
    parts.node.update(compressor({ release: 600 }), 120, false);
    expect(parts.shaper.curve).toBe(first);

    parts.node.update(compressor({ knee: 0 }), 120, false);
    expect(parts.shaper.curve).not.toBe(first);
    expect(parts.shaper.curve).toEqual(compressorCurve(-18, 6, 0));
  });

  it('switches its detector between its own signal and the key', () => {
    const effect = compressor();
    const parts = partsOf(effect);
    expect(parts.node.sidechain).toBeTruthy();
    // Whichever path is open carries the rectifier's scale-in, which the
    // curve multiplies straight back out: unity into the detector, expressed
    // in the units the shaper in front of it works in.
    const open = 1 / DETECTOR_HEADROOM;

    parts.node.setSidechain!(true);
    expect(parts.key.gain.value).toBe(open);
    expect(parts.internalKey.gain.value).toBe(0);

    parts.node.setSidechain!(false);
    expect(parts.key.gain.value).toBe(0);
    expect(parts.internalKey.gain.value).toBe(open);
  });

  it('reads a level above full scale instead of losing it in the rectifier', () => {
    const effect = compressor();
    const parts = partsOf(effect);
    parts.node.update(effect, 120, false);

    // No node was added for this: the scale into the shaper rides on the key
    // gain that was already there, and the scale back out is in the curve.
    expect(parts.rect.curve).toEqual(rectifierCurve(DETECTOR_HEADROOM));
    expect(parts.internalKey.gain.value).toBe(1 / DETECTOR_HEADROOM);

    // End to end, gain then shaper, the detector reads the level it is given —
    // ordinary ones exactly, and +12 dB, which a limiter's drive alone reaches
    // twice over and which used to arrive at the detector as 0 dBFS.
    for (const db of [-24, -6, 0, 12]) {
      const level = dbToGain(db);
      const seen = readShaper(parts.rect.curve, level * parts.internalKey.gain.value);
      expect(seen, `${db} dB`).toBeCloseTo(level, 12);
    }
  });

  /**
   * Node by node, at settings a general check cannot reach: 12 dB of makeup
   * has to stand down and so does the look-ahead. That every insert routes
   * around itself when bypassed at all is checked over all twenty-seven kinds
   * in `effect builders`, which is where the Limiter's clipper was found still
   * sitting in the signal path while this test passed for the compressor.
   */
  it('is exactly unity gain when bypassed, makeup and lookahead included', () => {
    const effect = compressor({ makeupDb: 12 });
    const parts = partsOf(effect);
    parts.node.update(effect, 120, false);
    expect(parts.makeup.gain.value).toBeCloseTo(dbToGain(12), 9);

    parts.node.update({ ...effect, bypass: true }, 120, true);
    // The VCA's intrinsic gain is zero, so its whole gain comes from the two
    // control paths: with depth shut and dry open it is the constant 1 exactly.
    expect(parts.vca.gain.value).toBe(0);
    expect(parts.depth.gain.value).toBe(0);
    expect(parts.dry.gain.value).toBe(1);
    // 12 dB of makeup sits downstream of that crossfade and has to stand down too.
    expect(parts.makeup.gain.value).toBe(1);
    // Any look-ahead left in circuit would be a delay nothing else in the
    // chain has — the comb filter a bypassed insert must never introduce.
    expect(parts.lookahead.delayTime.value).toBe(0);
  });

  it('reports gain reduction in dB from the control signal itself', () => {
    const effect = compressor();
    const parts = partsOf(effect);
    parts.node.update(effect, 120, false);
    const tap = parts.node.tap as unknown as {
      getFloatTimeDomainData(buffer: Float32Array): void;
    };

    tap.getFloatTimeDomainData = (b) => b.fill(1);
    expect(parts.node.gainReductionDb!()).toBe(0);
    tap.getFloatTimeDomainData = (b) => b.fill(0.5);
    expect(parts.node.gainReductionDb!()).toBeCloseTo(-6.0206, 3);
    // A control signal of zero is a shut VCA, not an infinite reading.
    tap.getFloatTimeDomainData = (b) => b.fill(0);
    expect(parts.node.gainReductionDb!()).toBe(0);
  });

  it('opens a key input on exactly the processors that can use one', () => {
    // The multiband is the deliberate omission: one `EffectNode` carries one
    // key, and one key across three band detectors is not multiband keying.
    const keyable = new Set(['compressor', 'gate', 'limiter', 'deesser']);
    for (const spec of EFFECT_SPECS) {
      const { ctx } = recordingContext();
      const node = buildEffectNode(ctx, effectOf(spec.kind));
      expect(Boolean(node.sidechain), spec.kind).toBe(keyable.has(spec.kind));
      expect(typeof node.setSidechain === 'function', spec.kind).toBe(keyable.has(spec.kind));
      node.dispose();
    }
  });

  it('hands the engine a key input for a chain that is only a compressor', () => {
    // What actually broke: the engine builds a key send and connects it to
    // whatever `sidechainInputs()` returns. For a plain compressor that was an
    // empty list, so the key went nowhere and nothing said so.
    const { ctx } = recordingContext();
    const chain = new InsertChain(ctx);
    chain.sync([compressor()], 120);
    expect(chain.sidechainInputs()).toHaveLength(1);
    chain.dispose();
  });
});

/**
 * What a plugin face draws.
 *
 * A face has one job: show the processor the musician is listening to. Three
 * of them were not — `faceKindOf` sent the limiter, the multiband and the
 * de-esser to the compressor's drawing, which reads `threshold`, `ratio` and
 * `knee`. The limiter and the multiband declare none of those keys, so all
 * three read back as zero and the face drew a straight 1:1 line for a 20:1
 * brickwall and for a three-band compressor; the de-esser drew a knee of 0
 * over audio with a knee of 6. These tests pin the drawing to the audio: the
 * curve a face plots is the curve the shaper is filled with, or there is no
 * face at all.
 */
describe('the picture a dynamics face draws', () => {
  const VCA_KINDS = ['compressor', 'gate', 'limiter', 'deesser'] as const;

  /**
   * The whole detector of a processor built on the control VCA, found by
   * walking it the way the audio does: key → |x| → detector → curve.
   */
  function detectorOf(effect: Effect) {
    const { ctx, connections } = recordingContext();
    const node = buildEffectNode(ctx, effect);
    node.update(effect, 120, false);
    const out = (n: unknown) => connections.filter((c) => c.from === n).map((c) => c.to);
    const into = (n: unknown) => connections.filter((c) => c.to === n).map((c) => c.from);
    const key = node.sidechain as unknown as RecordingNode;
    const rect = out(key)[0] as RecordingNode;
    const detector = out(rect)[0] as RecordingNode;
    const internalKey = into(rect).find((n) => n !== key) as unknown as { gain: RecordingParam };
    return {
      transfer: (out(detector)[0] as unknown as { curve: Float32Array }).curve,
      rectifier: (rect as unknown as { curve: Float32Array }).curve,
      keyGain: internalKey.gain.value,
    };
  }

  /**
   * The gain a steady input of `level` drives the VCA to, end to end: the key
   * gain scales into the rectifier's headroom, the rectifier reads the
   * envelope back out, and the transfer curve turns it into a gain. The
   * detector between the last two is a lowpass with a DC gain of one, so a
   * steady level crosses it unchanged and can be left out.
   *
   * Reading both shapers rather than either array is the point. A curve that
   * stops short of the level being asked about holds its last value instead of
   * saying so, which is exactly how a limiter came to plot 23 dB of reduction
   * and deliver 0.4 — an array comparison at the same parameters saw nothing
   * wrong, because the array was right and its input was off the end of it.
   */
  function deliveredGain(parts: ReturnType<typeof detectorOf>, level: number): number {
    return readShaper(parts.transfer, readShaper(parts.rectifier, level * parts.keyGain));
  }

  /** Every biquad a built effect wired up, whatever it called them. */
  function biquadsOf(effect: Effect) {
    const { ctx, connections } = recordingContext();
    const node = buildEffectNode(ctx, effect);
    node.update(effect, 120, false);
    const found = new Set<RecordingNode>();
    for (const c of connections) {
      for (const end of [c.from, c.to]) {
        if ('kind' in end && end.kind === 'biquad') found.add(end as RecordingNode);
      }
    }
    return [...found] as unknown as {
      type: string;
      frequency: RecordingParam;
      Q: RecordingParam;
    }[];
  }

  /**
   * The loudest input a processor's transfer curve still answers for, read out
   * of the graph rather than assumed: the curve is indexed by the envelope
   * divided by this, so the level whose envelope reads 1 at the far end of the
   * curve is it.
   */
  function envelopeTopOf(parts: ReturnType<typeof detectorOf>): number {
    return 1 / readShaper(parts.rectifier, parts.keyGain);
  }

  it('delivers, for every processor built on the VCA, the gain its own face plots', () => {
    for (const kind of VCA_KINDS) {
      const effect = effectOf(kind);
      const law = dynamicsLawOf(effect);
      expect(law, kind).not.toBeNull();
      const parts = detectorOf(effect);
      const points = parts.transfer.length;
      const top = envelopeTopOf(parts);
      // The positive half of the curve, point by point, at the input level
      // each point stands for. Landing on the points rather than between them
      // is what makes this exact rather than a tolerance: a WaveShaper returns
      // a curve entry unaltered at its own position, so a difference here is a
      // scale that fails to undo the one in front of it, never interpolation.
      for (let i = Math.ceil((points - 1) / 2); i < points; i += 7) {
        const envelope = ((i / (points - 1)) * 2 - 1) * top;
        const where = `${kind} at ${gainToDb(envelope).toFixed(1)} dBFS`;
        expect(deliveredGain(parts, envelope), where).toBeCloseTo(dynamicsGain(law!, envelope), 6);
      }
    }
  });

  it('leaves the compressor and the de-esser sampled up to full scale only', () => {
    // Both work near full scale, where a linearly indexed curve is dense, and
    // neither has anything above it to gain by stretching: what a compressor is
    // still asked to reduce past 0 dBFS is a few tenths of a dB at a ratio that
    // has already flattened.
    for (const kind of ['compressor', 'deesser'] as const) {
      const parts = detectorOf(effectOf(kind));
      expect(envelopeTopOf(parts), kind).toBe(1);
      // The rectifier therefore still multiplies the whole headroom back out,
      // so the detector reads a hot signal even where the curve stops moving.
      expect(parts.rectifier, kind).toEqual(rectifierCurve(DETECTOR_HEADROOM));
      expect(parts.transfer, kind).toEqual(dynamicsCurve(dynamicsLawOf(effectOf(kind))!));
    }
  });

  /**
   * What the gate's curve used to be spent on, and what it buys instead.
   *
   * A WaveShaper is indexed linearly in amplitude and every law here is written
   * in decibels, so the points crowd towards full scale — the smallest envelope
   * a 2048-point curve has an entry for is −66 dBFS. A compressor never
   * notices. An expander works nowhere else: with the default −45 dB threshold
   * the whole law lived in eleven points, and the numbers below are what that
   * cost. Above its threshold an expander is exactly unity and a WaveShaper
   * holds its last value past the end of the curve, so stopping the curve six
   * decibels above the turn changes no answer it was giving correctly and gives
   * every point to the part that bends.
   */
  const GATE_DRAWN_FLOOR_DB = -60;

  it('spends the gate curve below its threshold, where an expander is the only thing it is', () => {
    const gate = effectOf('gate');
    const parts = detectorOf(gate);
    // Twice the threshold envelope — a shade over six decibels above the turn,
    // and nowhere near full scale.
    expect(envelopeTopOf(parts)).toBeCloseTo(2 * dbToGain(paramOf(gate, 'threshold')), 9);
    expect(gainToDb(envelopeTopOf(parts))).toBeLessThan(-38);
    // Above the sampled range the curve holds its last point, and its last
    // point is unity — so a loud signal still passes a gate untouched.
    for (const db of [-39, -12, 0, 12]) {
      expect(deliveredGain(parts, dbToGain(db)), `${db} dBFS in`).toBeCloseTo(1, 9);
    }
  });

  it('delivers the attenuation the gate face plots, at the level that used to be 2.27 dB out', () => {
    const gate = effectOf('gate');
    const law = dynamicsLawOf(gate)!;
    const parts = detectorOf(gate);
    // The reported case: −45 dB threshold, 8:1, so three dB under the threshold
    // is 21 dB of reduction. The curve used to answer 18.73 there.
    expect(gainToDb(dynamicsGain(law, dbToGain(-48)))).toBeCloseTo(-21, 6);
    expect(gainToDb(deliveredGain(parts, dbToGain(-48)))).toBeCloseTo(-21, 2);
  });

  it('follows the drawn gate curve across the whole axis the face draws', () => {
    // Every tenth of a dB of the plotted −60…0 window, for a spread of gate
    // settings: threshold, ratio and range each move where the law bends and
    // how hard. The worst disagreement across all of it was 57.5 dB — a gate
    // set below −67 dBFS had no curve point under its threshold at all and did
    // nothing whatever, while its face drew a working expander.
    for (const threshold of [-80, -66, -56, -45, -20, -6]) {
      for (const ratio of [1.5, 8, 20]) {
        for (const range of [6, 45, 80]) {
          const gate: Effect = {
            ...effectOf('gate'),
            params: { ...defaultParams('gate'), threshold, ratio, range },
          };
          const law = dynamicsLawOf(gate)!;
          const parts = detectorOf(gate);
          let worst = 0;
          let where = 0;
          for (let db = GATE_DRAWN_FLOOR_DB; db <= 0; db += 0.1) {
            const envelope = dbToGain(db);
            const off = Math.abs(
              gainToDb(deliveredGain(parts, envelope)) - gainToDb(dynamicsGain(law, envelope)),
            );
            if (off > worst) {
              worst = off;
              where = db;
            }
          }
          expect(
            worst,
            `gate ${threshold} dB ${ratio}:1 range ${range} is ${worst.toFixed(2)} dB ` +
              `off its own curve at ${where.toFixed(1)} dBFS`,
          ).toBeLessThan(0.5);
        }
      }
    }
  });

  it('gates at a threshold no curve point used to reach', () => {
    // −80 dB is the parameter's own minimum, and every entry of a full-scale
    // curve stands for a louder envelope than that, so the array was unity
    // start to finish: the quietest setting on the knob turned the gate off.
    const gate: Effect = {
      ...effectOf('gate'),
      params: { ...defaultParams('gate'), threshold: -80 },
    };
    const parts = detectorOf(gate);
    expect(gainToDb(deliveredGain(parts, dbToGain(-90)))).toBeLessThan(-40);
    expect(gainToDb(deliveredGain(parts, dbToGain(-70)))).toBeCloseTo(0, 6);
  });

  /**
   * The limiter's own drive reaches +24 dB and its face plots the law across
   * all of it, but its curve used to stop at an envelope of 1. Above full
   * scale the VCA's gain therefore stopped moving, the hard clipper downstream
   * quietly removed everything the law had asked for and not delivered, and
   * the meter — which reads the VCA — went on reporting the four tenths of a
   * dB the curve had managed while 23 dB was being clipped off. The face was
   * right, the meter was right about the VCA, and the two together said
   * something false about the device.
   */
  it('holds the limiter to the law its face draws, above full scale where its drive puts it', () => {
    const limiter = effectOf('limiter');
    const law = dynamicsLawOf(limiter)!;
    const parts = detectorOf(limiter);
    // The face's input axis runs to +24 dBFS (`axisTopOf` in `PluginFace`),
    // and the curve has to answer for every decibel of it.
    expect(gainToDb(envelopeTopOf(parts))).toBeGreaterThanOrEqual(24);

    for (const db of [-6, 0, 6, 12, 24]) {
      const plotted = gainToDb(dynamicsGain(law, dbToGain(db)));
      const delivered = gainToDb(deliveredGain(parts, dbToGain(db)));
      expect(delivered, `${db} dBFS in`).toBeCloseTo(plotted, 2);
    }

    // The four tenths of a dB the old curve topped out at, named so that a
    // curve that stops at full scale cannot pass this quietly again.
    const stuckAt = gainToDb(dynamicsGain(law, 1));
    expect(stuckAt).toBeCloseTo(-0.4, 1);
    expect(gainToDb(deliveredGain(parts, dbToGain(24)))).toBeLessThan(-20);
  });

  it('never draws a straight line for a processor that is not straight', () => {
    for (const kind of VCA_KINDS) {
      const law = dynamicsLawOf(effectOf(kind))!;
      // 12 dB into the working side of each law. Every one of these processors
      // is pulling the level down there; a 1:1 line returns exactly 1.
      const into = law.law === 'expand' ? law.thresholdDb - 12 : law.thresholdDb + 12;
      expect(dynamicsGain(law, dbToGain(into)), kind).toBeLessThan(0.9);
    }
  });

  it('gives the limiter the law it has, not the parameters it never declared', () => {
    const limiter = effectOf('limiter');
    const law = dynamicsLawOf(limiter)!;
    expect(law).toEqual({
      law: 'compress',
      thresholdDb: paramOf(limiter, 'ceiling'),
      ratio: LIMITER_RATIO,
      kneeDb: LIMITER_KNEE_DB,
    });

    // The three keys the old face read. A limiter has none of them, `paramOf`
    // falls back to zero, and a ratio of zero is the straight line it drew.
    for (const key of ['threshold', 'ratio', 'knee']) expect(paramOf(limiter, key), key).toBe(0);
    const straight: DynamicsLaw = { law: 'compress', thresholdDb: 0, ratio: 0, kneeDb: 0 };
    expect(dynamicsGain(straight, dbToGain(12))).toBe(1);

    // What it actually does: 24 dB of overshoot leaves within a dB of the
    // ceiling, which is the picture a limiter's face owes its user.
    const outDb = 24 + gainToDb(dynamicsGain(law, dbToGain(24)));
    expect(outDb).toBeGreaterThan(law.thresholdDb);
    expect(outDb).toBeLessThan(law.thresholdDb + 1.5);
  });

  it('gives the de-esser the knee its audio uses and the band it works on', () => {
    const deesser = effectOf('deesser');
    const law = dynamicsLawOf(deesser)!;
    const threshold = paramOf(deesser, 'threshold');
    expect(law).toEqual({
      law: 'compress',
      thresholdDb: threshold,
      ratio: paramOf(deesser, 'ratio'),
      kneeDb: DEESSER_KNEE_DB,
    });

    // The difference a knee makes, at the one level that shows it: a 6 dB knee
    // is already half way into its bend at the threshold, a knee of 0 — what
    // the face used to draw — is still exactly unity there.
    const sharp: DynamicsLaw = { ...law, kneeDb: 0 } as DynamicsLaw;
    expect(dynamicsGain(law, dbToGain(threshold))).toBeLessThan(1);
    expect(dynamicsGain(sharp, dbToGain(threshold))).toBe(1);

    // And the band the face draws is the filter the audio put in the path.
    const band = deesserBand(deesser);
    const bandpass = biquadsOf(deesser).find((b) => b.type === 'bandpass')!;
    expect(bandpass.frequency.value).toBe(band.freqHz);
    expect(bandpass.Q.value).toBe(band.q);
  });

  it('draws the multiband as its crossover, at the splits the audio uses', () => {
    // No single static law to draw: three bands, each on a native compressor
    // node whose knee law is the browser's rather than one we fill.
    expect(dynamicsLawOf(effectOf('multiband'))).toBeNull();

    // The builder holds the high split 20 % above the low one, so a face
    // reading the raw parameter marks a split nothing is crossing at.
    const squashed: Effect = {
      ...effectOf('multiband'),
      params: { ...defaultParams('multiband'), lowSplit: 800, highSplit: 800 },
    };
    const splits = multibandSplits(squashed);
    expect(splits.lowHz).toBe(800);
    expect(splits.highHz).toBeCloseTo(960, 9);

    const wired = new Set(biquadsOf(squashed).map((b) => b.frequency.value));
    expect(wired).toEqual(new Set([splits.lowHz, splits.highHz]));
  });
});

/**
 * The core every dynamics processor here is built on. Its one hard promise is
 * that the control signal driving the VCA never exceeds one — every transfer
 * curve only ever attenuates — and the smoothers are where that promise was
 * being broken: a release of 180 ms asks a biquad for a 0.9 Hz corner, and at
 * audio rates those coefficients have no precision left, so the "smoothed"
 * control signal settled well above unity and a wide-open gate amplified.
 */
describe('the dynamics control VCA', () => {
  /**
   * Both ballistics smoothers of a built processor, found by the cycle that
   * makes them: output → delay → feedback → output.
   */
  function smoothersOf(effect: Effect) {
    const { ctx, connections } = recordingContext();
    const node = buildEffectNode(ctx, effect);
    const out = (n: unknown) => connections.filter((c) => c.from === n).map((c) => c.to);
    const into = (n: unknown) => connections.filter((c) => c.to === n).map((c) => c.from);
    const found: {
      biquad: { frequency: RecordingParam };
      tap: { gain: RecordingParam };
      feedback: { gain: RecordingParam };
    }[] = [];
    for (const c of connections) {
      const delay = c.to as RecordingNode;
      if (delay.kind !== 'delay') continue;
      const feedback = out(delay)[0] as RecordingNode | undefined;
      if (!feedback || !out(feedback).includes(c.from)) continue;
      const tap = into(c.from).find((n) => n !== feedback)!;
      found.push({
        biquad: into(tap)[0] as unknown as { frequency: RecordingParam },
        tap: tap as unknown as { gain: RecordingParam },
        feedback: feedback as unknown as { gain: RecordingParam },
      });
    }
    return { node, found };
  }

  const dynamics = (params: Record<string, number>): Effect => ({
    id: 'dyn',
    kind: 'compressor',
    bypass: false,
    params: { threshold: -20, ratio: 4, knee: 6, makeupDb: 0, ...params },
  });

  it('carries a long time constant on a pole that passes DC at exactly one', () => {
    const effect = dynamics({ attack: 50, release: 800 });
    const { node, found } = smoothersOf(effect);
    node.update(effect, 120, false);

    expect(found, 'attack and release each get a smoother').toHaveLength(2);
    for (const s of found) {
      // y = (1 - g)·x + g·y[-T] sums to one at DC for any g, which is the
      // whole reason the pole exists — and the two halves are set as exact
      // complements so a ballistics change cannot break it mid-ramp either.
      expect(s.tap.gain.value + s.feedback.gain.value).toBeCloseTo(1, 12);
      expect(s.feedback.gain.value).toBeGreaterThan(0);
      expect(s.feedback.gain.value).toBeLessThan(1);
      // The biquad is never asked for a corner it cannot compute.
      expect(s.biquad.frequency.value).toBeGreaterThanOrEqual(60);
    }
  });

  it('leaves the pole out of it when a biquad can hold the whole time constant', () => {
    const effect = dynamics({ attack: 0.5, release: 1 });
    const { node, found } = smoothersOf(effect);
    node.update(effect, 120, false);

    for (const s of found) {
      expect(s.feedback.gain.value).toBe(0);
      expect(s.tap.gain.value).toBe(1);
      expect(s.biquad.frequency.value).toBeGreaterThan(60);
    }
  });

  it('lengthens the pole as the release lengthens', () => {
    const short = dynamics({ attack: 5, release: 50 });
    const long = dynamics({ attack: 5, release: 900 });
    const a = smoothersOf(short);
    a.node.update(short, 120, false);
    const b = smoothersOf(long);
    b.node.update(long, 120, false);

    const slowest = (xs: { feedback: { gain: RecordingParam } }[]) =>
      Math.max(...xs.map((x) => x.feedback.gain.value));
    expect(slowest(b.found)).toBeGreaterThan(slowest(a.found));
    expect(slowest(b.found)).toBeLessThan(1);
  });
});

describe('the two EQ8 bands that have no quality factor', () => {
  it('gives a shelf the same response whatever Q it is handed', () => {
    // The fact the whole finding rests on, in our own coefficients: the shelf
    // cases build from the fixed slope S = 1 and never touch `q`, which is
    // exactly what a `BiquadFilterNode` does with a shelf's `Q` — nothing.
    for (const type of ['lowshelf', 'highshelf'] as const) {
      const base = biquadCoefficients(type, 800, BUTTERWORTH_Q, 6, SR);
      for (const q of [0.2, 1, 4, 40]) {
        expect(biquadCoefficients(type, 800, q, 6, SR), `${type} at Q ${q}`).toEqual(base);
      }
    }
    // A peaking band is the control: there, Q is the whole shape.
    expect(biquadCoefficients('peaking', 800, 4, 6, SR)).not.toEqual(
      biquadCoefficients('peaking', 800, 1, 6, SR),
    );
  });

  it('never writes Q on a shelf node, and keeps writing it on the peaking bands', () => {
    const effect: Effect = {
      id: 'eq',
      kind: 'eq8',
      bypass: false,
      params: { ...defaultParams('eq8'), b1Q: 7.5, b2Q: 3.25 },
    };
    const { ctx, connections } = recordingContext();
    const node = buildEffectNode(ctx, effect);
    node.update(effect, 120, false);
    const filters = new Map<string, RecordingNode[]>();
    for (const c of connections) {
      for (const end of [c.from, c.to]) {
        if (!('kind' in end) || end.kind !== 'biquad') continue;
        const type = end.type as string;
        const list = filters.get(type) ?? [];
        if (!list.includes(end as RecordingNode)) list.push(end as RecordingNode);
        filters.set(type, list);
      }
    }
    // The shelves are left at the Q their constructor gave them — untouched,
    // because a value the platform discards is not worth ramping.
    for (const type of ['lowshelf', 'highshelf']) {
      for (const filter of filters.get(type)!) {
        expect((filter.Q as RecordingParam).value, `${type} Q was written`).toBe(1);
      }
    }
    const peaking = filters.get('peaking')!.map((f) => (f.Q as RecordingParam).value);
    expect(peaking).toContain(7.5);
    expect(peaking).toContain(3.25);
  });
});

describe("the tremolo's three-position stereo phase", () => {
  /** The gains the right channel's three phase taps are held at. */
  function taps(phaseOffset: number): number[] {
    const effect: Effect = {
      id: 'trem',
      kind: 'tremolo',
      bypass: false,
      params: { ...defaultParams('tremolo'), phaseOffset },
    };
    const { ctx, connections } = recordingContext();
    const node = buildEffectNode(ctx, effect);
    node.update(effect, 120, false);
    // The right channel's summing node is fed by exactly the three taps.
    const right = feeding(connections, node.output).find(
      (c) => c.output === 0 && c.input === 1,
    )!.from;
    const depth = connections.find((c) => c.to === (right.gain as RecordingParam))!.from;
    const sum = connections.find((c) => c.to === depth)!.from;
    return connections
      .filter((c) => c.to === sum)
      .map((c) => gainOf(c.from as RecordingNode, connections));
  }

  it('opens one tap per position, and inverts for 180°', () => {
    expect(taps(0)).toEqual([1, 0, 0]);
    expect(taps(1)).toEqual([0, 1, 0]);
    // 180° is the quadrature pair's own sine, subtracted rather than added.
    expect(taps(2)).toEqual([0, 0, -1]);
  });

  it('clamps a value from outside the list rather than opening nothing', () => {
    expect(taps(99)).toEqual([0, 0, -1]);
    expect(taps(-4)).toEqual([1, 0, 0]);
  });
});

/**
 * Where a modulator sits in its cycle, and whether two renders agree about it.
 *
 * Every LFO here used to be started by its own constructor, with no time
 * argument: the phase at any bar was whatever the wall clock had left it at.
 * Live that only made a device unreproducible. Offline it made a bounce
 * disagree with itself — the graph is built at t = 0 and the delivered audio
 * begins `preRoll` seconds later, so bars 5-8 bounced on their own met the
 * modulator `preRoll` seconds into its run while the same bars inside a
 * full-song bounce met it eight seconds further on.
 */
describe('a modulator that prints the phase it was monitored at', () => {
  const BPM = 120;
  /** One 4/4 bar at 120 bpm. */
  const BAR_SEC = 2;
  const BAR_5_SEC = 4 * BAR_SEC;
  /**
   * A run-up that is deliberately not a whole number of modulator cycles.
   *
   * `preRollForProject` returns whatever five times the session's slowest
   * release comes to, so this is an ordinary length — and it is the length that
   * makes the difference visible, because a modulator started at t = 0 arrives
   * at the first bar line this far into its cycle rather than at the top of it.
   */
  const PRE_ROLL = 2.3;

  function tremolo(params: Record<string, number>): Effect {
    return {
      id: 'trem',
      kind: 'tremolo',
      bypass: false,
      params: { ...defaultParams('tremolo'), ...params },
    };
  }

  /**
   * One bounce of `effect`, as a function from song time to the gain its left
   * channel is riding at.
   *
   * The clock the graph is built with comes from the renderer, because "which
   * song second is context time zero" is the thing that was wrong. The clock
   * emphatically does *not* decide where a song second is *read back*: that is
   * the renderer's own scheduling rule — every clip and every note in a range
   * bounce is placed at `preRoll + (songSec - rangeStart)` — and reading the
   * modulator anywhere else would let a clock that lies about the song time
   * agree with itself.
   */
  function bounce(effect: Effect, rangeStartSec: number): (songSec: number) => number {
    const { ctx, connections } = recordingContext();
    const node = buildEffectNode(ctx, effect, renderModulationClock(rangeStartSec, PRE_ROLL));
    node.update(effect, BPM, false);
    // The left channel's VCA, identified by the merger input it feeds.
    const left = feeding(connections, node.output).find(
      (c) => c.output === 0 && c.input === 0,
    )!.from;
    return (songSec) =>
      paramAt(left.gain as RecordingParam, connections, PRE_ROLL + songSec - rangeStartSec);
  }

  /**
   * How closely two renders of one modulator can be asked to agree.
   *
   * Not exactly, and the reason is `PeriodicWave`: its coefficients are a
   * `Float32Array`, so the two renders — which reach the same phase by
   * different arithmetic — round the rotated harmonics to slightly different
   * single-precision numbers. About 1e-8 of full scale, which is a thousandth
   * of one 16-bit LSB and some 60 dB below the dither the WAV writer adds.
   */
  const AGREEMENT = 7;

  it('bounces bars 5-8 to the samples they have inside a full-song bounce', () => {
    // 3.7 Hz divides no bar and no pre-roll, so nothing here lines up by luck:
    // under the old behaviour the two renders met this modulator 8 seconds —
    // 29.6 cycles — apart.
    const fx = tremolo({ sync: 0, rate: 3.7, depth: 0.8, shape: 0 });
    const whole = bounce(fx, 0);
    const range = bounce(fx, BAR_5_SEC);

    let low = Infinity;
    let high = -Infinity;
    for (let i = 0; i < 512; i++) {
      const songSec = BAR_5_SEC + i / SR;
      const fromRange = range(songSec);
      expect(fromRange, `sample ${i} of bar 5`).toBeCloseTo(whole(songSec), AGREEMENT);
      low = Math.min(low, fromRange);
      high = Math.max(high, fromRange);
    }
    // Not a pair of flat lines agreeing about nothing: at 80 % depth the gain
    // swings between 0.2 and 1, and 512 samples at 3.7 Hz is a fortieth of a
    // cycle, so a good part of that swing has to show up inside the window.
    expect(high - low).toBeGreaterThan(0.05);
  });

  it('is the same modulator whatever the range was cut at, for every start', () => {
    const fx = tremolo({ sync: 0, rate: 3.7, depth: 0.8, shape: 1 });
    const whole = bounce(fx, 0);
    // Bar starts and a deliberately off-grid one, because song time is what
    // decides the phase and the phase must not care where a range began.
    for (const startSec of [BAR_SEC, BAR_5_SEC, 13 * BAR_SEC, 5.37]) {
      const range = bounce(fx, startSec);
      for (let i = 0; i < 64; i++) {
        const songSec = startSec + i / SR;
        expect(range(songSec), `range from ${startSec}s, sample ${i}`).toBeCloseTo(
          whole(songSec),
          AGREEMENT,
        );
      }
    }
  });

  it('locks a tempo-synced modulator to the bar and not only to the rate', () => {
    // Sync always locked the rate: a division of 4 is a quarter note, four
    // cycles to the bar, and consecutive bars therefore agreed with each other
    // even before any of this. What it did not lock is where the cycle *starts*
    // — the tremolo arrived at bar 1 `preRoll` seconds into its run, at
    // whatever point that came to. Locked to the bar means the bar line is the
    // top of the cycle, so a sine tremolo sits exactly at its midpoint there
    // and rises out of it.
    const depth = 0.9;
    const fx = tremolo({ sync: 1, division: 4, modifier: 0, depth, shape: 0 });
    const whole = bounce(fx, 0);
    const midpoint = 1 - depth / 2;
    for (const bar of [0, 1, 4, 8, 32]) {
      expect(whole(bar * BAR_SEC), `bar ${bar + 1}`).toBeCloseTo(midpoint, AGREEMENT);
      // Rising out of it, so the bar line is the start of the cycle and not the
      // half-way point, which sits at the same gain going the other way.
      expect(whole(bar * BAR_SEC + 0.01), `just after bar ${bar + 1}`).toBeGreaterThan(midpoint);
    }
    // And it is a modulator, not a constant: a quarter of its cycle — a
    // sixteenth note at this division — is the far side of the swing.
    expect(whole(BAR_SEC / 16)).toBeCloseTo(midpoint + depth / 2, AGREEMENT);
  });

  it('starts every modulator it builds, in all six kinds that carry one', () => {
    // The oscillators used to start themselves in their constructor. Now a
    // builder has to ask, and a builder that forgot would leave a device
    // silently unmodulated — an LFO that never starts puts out nothing at all.
    for (const kind of ['chorus', 'flanger', 'phaser', 'tremolo', 'rotary', 'autopan'] as const) {
      const { ctx, connections } = recordingContext();
      const effect = effectOf(kind);
      const node = buildEffectNode(ctx, effect, { startAt: 0, songSec: 0 });
      node.update(effect, BPM, false);
      const oscillators = new Set<RecordingNode>();
      for (const c of connections) {
        for (const end of [c.from, c.to]) {
          if ('kind' in end && end.kind === 'oscillator') oscillators.add(end as RecordingNode);
        }
      }
      expect(oscillators.size, `${kind} built no modulator`).toBeGreaterThan(0);
      for (const osc of oscillators) {
        expect(osc.startedAt, `${kind} left an oscillator unstarted`).not.toBeNull();
        expect(osc.wave, `${kind} left an oscillator with no waveform`).not.toBeNull();
      }
    }
  });

  it('keeps the quadrature twin exactly a quarter cycle away at any phase', () => {
    // The phase is baked into the waveform, and a shape that is not a sine is
    // only still that shape if every harmonic is rotated by its own multiple.
    // Get that wrong and the chorus's two voices stop being a quarter cycle
    // apart the moment a render does not begin at song time zero.
    const chorus = effectOf('chorus');
    const { ctx, connections } = recordingContext();
    const node = buildEffectNode(ctx, chorus, { startAt: 0, songSec: 7.31 });
    node.update(chorus, BPM, false);
    const oscillators: RecordingNode[] = [];
    for (const c of connections) {
      if ('kind' in c.from && c.from.kind === 'oscillator' && !oscillators.includes(c.from)) {
        oscillators.push(c.from);
      }
    }
    const [sine, cosine] = oscillators;
    const hz = (sine.frequency as RecordingParam).value;
    for (const t of [0, 0.13, 0.9]) {
      expect(oscillatorAt(cosine, t), `t=${t}`).toBeCloseTo(oscillatorAt(sine, t + 0.25 / hz), 9);
    }
  });
});

describe("Stereo Width's mono bass, off at the bottom of its own range", () => {
  const width = (bassMono: number): Effect => ({
    id: 'w',
    kind: 'width',
    bypass: false,
    params: { ...defaultParams('width'), bassMono },
  });

  /** The crossfade gain the mono-bass highpass is mixed in through. */
  function highpassMix(effect: Effect, bypass: boolean): number {
    const { ctx, connections } = recordingContext();
    const node = buildEffectNode(ctx, effect);
    node.update(effect, 120, bypass);
    const filter = connections
      .map((c) => c.to)
      .find(
        (n): n is RecordingNode => 'kind' in n && n.kind === 'biquad' && n.type === 'highpass',
      )!;
    const wet = connections.find((c) => c.from === filter)!.to as RecordingNode;
    return gainOf(wet, connections);
  }

  it('takes the filter out of circuit at the minimum and puts it back above it', () => {
    // 20 Hz is the parameter's minimum and the face already declined to draw
    // the line there, while the side channel went on through a Butterworth
    // highpass — which turns the phase of the bottom octave whatever else it
    // does. "Off" now means off.
    expect(highpassMix(width(BASS_MONO_OFF_HZ), false)).toBe(0);
    expect(highpassMix(width(120), false)).toBe(1);
    expect(highpassMix(width(120), true)).toBe(0);
  });

  it('leaves nothing colouring the signal at the minimum', () => {
    const { ctx, connections } = recordingContext();
    const effect = width(BASS_MONO_OFF_HZ);
    const node = buildEffectNode(ctx, effect);
    node.update(effect, 120, false);
    const live = routesBetween(
      connections,
      node.input as unknown as RecordingNode,
      node.output as unknown as RecordingNode,
    ).filter((r) => r.scale !== 0);
    expect(live.length).toBeGreaterThan(0);
    for (const route of live) {
      expect(route.through, 'a route still passes something at the minimum').toBe('');
    }
  });

  it('tells the face the same thing it told the audio', () => {
    // Two independent thresholds is how the picture and the processor came to
    // disagree in the first place.
    expect(widthFieldOf(width(BASS_MONO_OFF_HZ))!.bassMonoOn).toBe(false);
    expect(widthFieldOf(width(BASS_MONO_OFF_HZ + 1))!.bassMonoOn).toBe(true);
    expect(widthFieldOf(width(400))!.bassMonoOn).toBe(true);
  });
});

describe('the Mix control as a blend rather than a comb', () => {
  it('gives the hold cascade the group delay a boxcar has', () => {
    // Each stage is two taps of equal weight 2^i apart, so half of 2^i; the
    // cascade sums to the (N - 1) / 2 of the N-point boxcar it is.
    expect(crusherGroupDelaySamples(0)).toBe(0);
    expect(crusherGroupDelaySamples(1)).toBe(0.5);
    expect(crusherGroupDelaySamples(6)).toBe(31.5);
    for (let k = 0; k <= 6; k++) {
      let sum = 0;
      for (let i = 0; i < k; i++) sum += Math.pow(2, i) / 2;
      expect(crusherGroupDelaySamples(k), `${k} stages`).toBeCloseTo(sum, 12);
    }
    // The comb this used to put in the Mix: at 64x and 48 kHz the first null
    // landed at 48000 / 63, right through the middle of the band.
    expect(SR / (2 * crusherGroupDelaySamples(6))).toBeCloseTo(761.9, 1);
  });

  /**
   * The delay the crusher's own cascade imposes, measured off the graph it
   * built rather than recomputed: a two-tap stage of weights a and b that are
   * D samples apart delays by b·D / (a + b), and a stage that is switched off
   * has b = 0 and delays by nothing.
   */
  function cascadeDelaySamples(node: EffectNode, connections: Connection[]): number {
    const out = (n: unknown) => connections.filter((c) => c.from === n).map((c) => c.to);
    let cursor = out(node.input).find(
      (n): n is RecordingNode => 'kind' in n && n.kind === 'waveshaper',
    )!;
    let total = 0;
    for (;;) {
      const fed = out(cursor).filter((n): n is RecordingNode => 'kind' in n);
      const delay = fed.find((n) => n.kind === 'delay');
      const direct = fed.find((n) => n.kind === 'gain');
      if (!delay || !direct) return total;
      const delayed = out(delay)[0] as RecordingNode;
      const a = gainOf(direct, connections);
      const b = gainOf(delayed, connections);
      total += (b * (delay.delayTime as RecordingParam).value * SR) / (a + b);
      cursor = out(direct)[0] as RecordingNode;
    }
  }

  it('holds the bitcrusher dry leg back by exactly what the wet path costs', () => {
    const spec = effectSpec('bitcrusher')!.params.find((p) => p.key === 'downsample')!;
    for (let choice = 0; choice <= spec.max; choice++) {
      const effect: Effect = {
        id: 'crush',
        kind: 'bitcrusher',
        bypass: false,
        params: { ...defaultParams('bitcrusher'), downsample: choice, mix: 0.5 },
      };
      const { ctx, connections } = recordingContext();
      const node = buildEffectNode(ctx, effect);
      node.update(effect, 120, false);
      const align = fedBy(connections, node.input).find(
        (c) => 'kind' in c.to && c.to.kind === 'delay',
      )!.to as RecordingNode;
      const dry = (align.delayTime as RecordingParam).value * SR;
      const wet = cascadeDelaySamples(node, connections);
      expect(dry, `${CRUSH_FACTORS[choice]}x dry leg`).toBeCloseTo(wet, 9);
      expect(dry, `${CRUSH_FACTORS[choice]}x`).toBeCloseTo(crusherGroupDelaySamples(choice), 9);

      // Bypass hands back a wire, and a wire does not delay by half a
      // millisecond — the bypass-transparency check counts on it.
      node.update({ ...effect, bypass: true }, 120, true);
      expect((align.delayTime as RecordingParam).value, 'bypassed').toBe(0);
    }
  });

  it('compensates the oversampled shapers, now that their latency has been measured', () => {
    // This test used to assert the opposite, and the reasoning was sound at the
    // time: a '4x' WaveShaper's resampling filters delay by an amount no
    // specification states, and a dry delay of the wrong length moves the comb
    // rather than removing it. So the saturator and the distortion combed at
    // every Mix below 100 % and the test recorded that as deliberate.
    //
    // What changed is that the number stopped being unknowable. An impulse
    // rendered through an identity shaper, with the parameter ramps allowed to
    // settle first, peaks a constant **192 samples** late at 44 100, 48 000,
    // 96 000 and 192 000 Hz — constant in samples, which is what an internal
    // FIR at the oversampled rate gives. `src/audio/latencyProbe.ts` is that
    // measurement and `e2e/latency.spec.ts` re-runs it against a real browser,
    // so this constant cannot drift from the engine it describes without the
    // suite saying so.
    //
    // 192 samples is 4 ms at 48 kHz: a comb with a notch every 250 Hz, which is
    // not a subtle colouration.
    for (const kind of ['saturator', 'distortion'] as EffectKind[]) {
      const { ctx, connections } = recordingContext();
      const effect = effectOf(kind);
      const node = buildEffectNode(ctx, effect);
      node.update(effect, 120, false);
      expect(fedBy(connections, node.input).length, `${kind} wired nothing`).toBeGreaterThan(0);
      const delays = delayNodesIn(connections);
      expect(delays.length, `${kind} dry alignment`).toBe(1);
      expect(
        (delays[0].delayTime as RecordingParam).value * SR,
        `${kind} holds the dry leg by the shaper's delay`,
      ).toBeCloseTo(192, 6);

      // And bypass hands back a wire, delay included.
      node.update({ ...effect, bypass: true }, 120, true);
      expect((delays[0].delayTime as RecordingParam).value, `${kind} bypassed`).toBe(0);
      expect(node.latencySamples?.(), `${kind} declares nothing when bypassed`).toBe(0);
    }

    const { ctx, connections } = recordingContext();
    const crusher = effectOf('bitcrusher');
    buildEffectNode(ctx, crusher).update(crusher, 120, false);
    // Six hold stages and the one dry leg that lines up with them.
    expect(delayNodesIn(connections).length).toBe(7);
  });
});

describe('effect groups', () => {
  it('puts every effect in exactly one known picker group', () => {
    for (const spec of EFFECT_SPECS) {
      expect(EFFECT_GROUPS, spec.kind).toContain(spec.group);
    }
    for (const group of EFFECT_GROUPS) {
      expect(EFFECT_SPECS.filter((s) => s.group === group).length, group).toBeGreaterThan(0);
    }
  });
});

describe('the picture a waveshaping face draws', () => {
  /** A default-parameter effect of one kind, as the rest of this file builds them. */
  const make = effectOf;

  it('gives every waveshaping effect a curve, and nothing else one', () => {
    for (const kind of ['saturator', 'distortion', 'ampsim', 'bitcrusher'] as EffectKind[]) {
      expect(shaperCurveOf(make(kind)), `${kind} has no curve`).not.toBeNull();
    }
    for (const kind of ['compressor', 'reverb', 'eq3', 'delay'] as EffectKind[]) {
      expect(shaperCurveOf(make(kind)), `${kind} should not claim a shaper curve`).toBeNull();
    }
  });

  it('draws a staircase for the bitcrusher, not a smooth curve', () => {
    // The face used to read `model` and `drive`, which a bitcrusher does not
    // declare, so it drew a tube saturation curve for a quantiser. A staircase
    // is exactly the thing a smooth curve is not: consecutive samples are
    // equal for long runs and then jump.
    const crusher = make('bitcrusher');
    crusher.params.bits = 4;
    const curve = shaperCurveOf(crusher)!;
    let equalRuns = 0;
    let jumps = 0;
    for (let i = 1; i < curve.length; i++) {
      if (curve[i] === curve[i - 1]) equalRuns++;
      else if (Math.abs(curve[i] - curve[i - 1]) > 0.05) jumps++;
    }
    expect(equalRuns / curve.length, 'a quantiser holds its value between steps').toBeGreaterThan(
      0.9,
    );
    expect(jumps, 'a 4-bit quantiser has steps to jump between').toBeGreaterThan(4);
  });

  it('follows the amp sim through its own model list, including the last one', () => {
    // Selecting the fourth model used to throw while rendering the face,
    // because the face indexed a list carrying a name saturationCurve has no
    // case for.
    const amp = make('ampsim');
    const curves = AMP_MODELS.map((_, i) => {
      amp.params.model = i;
      const c = shaperCurveOf(amp);
      expect(c, `amp model ${i} has no curve`).not.toBeNull();
      return c!;
    });
    // The models are voiced differently, so no two draw the same line.
    for (let i = 1; i < curves.length; i++) {
      expect(curves[i]).not.toEqual(curves[0]);
    }
  });

  it('moves the distortion curve with hardness, which its face never read', () => {
    const soft = make('distortion');
    soft.params.hardness = 1;
    const hard = make('distortion');
    hard.params.hardness = 20;
    expect(shaperCurveOf(hard)).not.toEqual(shaperCurveOf(soft));
  });

  it('rebuilds a curve only when the values it is built from move', () => {
    const sat = make('saturator');
    const before = shaperCurveKey(sat);
    sat.params.output = (sat.params.output ?? 0) - 6;
    expect(shaperCurveKey(sat), 'output level does not change the curve').toBe(before);
    sat.params.drive = (sat.params.drive ?? 0) + 6;
    expect(shaperCurveKey(sat)).not.toBe(before);
  });
});

describe('the picture a time or stereo face draws', () => {
  const make = (kind: EffectKind): Effect => ({
    id: `e-${kind}`,
    kind,
    bypass: false,
    params: Object.fromEntries(effectSpec(kind)!.params.map((p) => [p.key, p.default])),
  });

  it('gives delay, reverb and width a description, and nothing else one', () => {
    expect(delayLayoutOf(make('delay'), 120)).not.toBeNull();
    expect(delayLayoutOf(make('pingpong'), 120)).not.toBeNull();
    expect(reverbTailOf(make('reverb'))).not.toBeNull();
    expect(widthFieldOf(make('width'))).not.toBeNull();
    // These four had no face at all, which is why they are the ones tested.
    expect(delayLayoutOf(make('reverb'), 120)).toBeNull();
    expect(reverbTailOf(make('delay'))).toBeNull();
    expect(widthFieldOf(make('delay'))).toBeNull();
  });

  it('spaces the echoes by the same conversion the audio uses', () => {
    const d = make('delay');
    d.params.timeSixteenths = 4; // one quarter note
    // At 120 bpm a quarter note is half a second, and that is syncSeconds' job
    // — the face must not do its own tempo maths.
    expect(delayLayoutOf(d, 120)!.timeSec).toBeCloseTo(syncSeconds(4, 120, 'straight'), 9);
    expect(delayLayoutOf(d, 120)!.timeSec).toBeCloseTo(0.5, 6);
    expect(delayLayoutOf(d, 60)!.timeSec).toBeCloseTo(1, 6);
  });

  it('stops drawing repeats once they fall under the noise floor', () => {
    const quiet = make('delay');
    quiet.params.feedback = 0.1;
    const long = make('delay');
    long.params.feedback = 0.85;
    const few = delayLayoutOf(quiet, 120)!.taps;
    const many = delayLayoutOf(long, 120)!.taps;
    expect(few.length).toBeLessThan(many.length);
    // Each repeat is the previous one times the feedback — that is what makes
    // the picture a promise rather than a decoration.
    expect(few[1] / few[0]).toBeCloseTo(0.1, 6);
    expect(many[1] / many[0]).toBeCloseTo(0.85, 6);
    expect(few.every((t) => t > 0.001 || t === few[few.length - 1])).toBe(true);
  });

  it('draws one repeat and no tail when there is no feedback', () => {
    const dry = make('delay');
    dry.params.feedback = 0;
    expect(delayLayoutOf(dry, 120)!.taps).toEqual([1]);
  });

  it('honours the clamp the builder applies to feedback', () => {
    const runaway = make('delay');
    runaway.params.feedback = 5;
    // buildDelay clamps at 0.9; a face showing an endless tail would be
    // promising a runaway the audio refuses to make.
    expect(delayLayoutOf(runaway, 120)!.feedback).toBe(0.9);
  });

  it('marks a ping-pong as alternating and a plain delay as not', () => {
    expect(delayLayoutOf(make('pingpong'), 120)!.pingPong).toBe(true);
    expect(delayLayoutOf(make('delay'), 120)!.pingPong).toBe(false);
  });

  it('shapes the reverb tail with the exponent the impulse generator uses', () => {
    const tail = reverbTailOf(make('reverb'), 8)!;
    expect(tail.envelope[0]).toBeCloseTo(1, 6);
    // renderImpulse shapes its noise by (1 - i/len) ** 2.2.
    expect(tail.envelope[4]).toBeCloseTo(Math.pow(1 - 4 / 8, REVERB_DECAY_EXPONENT), 9);
    expect(tail.envelope.every((v, i, a) => i === 0 || v <= a[i - 1])).toBe(true);
  });

  it('reports the pre-delay in seconds, because the parameter is in milliseconds', () => {
    const r = make('reverb');
    r.params.predelay = 40;
    expect(reverbTailOf(r)!.preDelaySec).toBeCloseTo(0.04, 9);
  });

  it('reads width as the mid/side gain it is', () => {
    const w = make('width');
    w.params.width = 0;
    expect(widthFieldOf(w)!.width).toBe(0); // mono
    w.params.width = 2;
    expect(widthFieldOf(w)!.width).toBe(2); // sides doubled
  });
});
