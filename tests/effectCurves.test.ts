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
  describeDivision,
  dbToGain,
  eqMagnitudeResponse,
  expanderGain,
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
  EFFECT_SPECS,
  EFFECT_GROUPS,
  defaultParams,
  effectSpec,
  normaliseParams,
} from '../src/model/effects';
import {
  CHAIN_PRESETS,
  EFFECT_PRESETS,
  chainSteps,
  presetParams,
} from '../src/model/effectPresets';
import { InsertChain, buildEffectNode } from '../src/audio/effectChain';
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
    const curve = rectifierCurve(1025);
    expect(curve[0]).toBeCloseTo(1, 6);
    expect(curve[curve.length - 1]).toBeCloseTo(1, 6);
    expect(curve[(curve.length - 1) / 2]).toBeCloseTo(0, 6);
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
      connect(destination) {
        connections.push({ from: self, to: destination });
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
    createOscillator: () =>
      source('oscillator', {
        type: 'sine',
        frequency: param(440),
        detune: param(0),
        setPeriodicWave: () => {},
      }),
    createConstantSource: () => source('constant', { offset: param(1) }),
    createPeriodicWave: () => ({}),
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

    parts.node.setSidechain!(true);
    expect(parts.key.gain.value).toBe(1);
    expect(parts.internalKey.gain.value).toBe(0);

    parts.node.setSidechain!(false);
    expect(parts.key.gain.value).toBe(0);
    expect(parts.internalKey.gain.value).toBe(1);
  });

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
