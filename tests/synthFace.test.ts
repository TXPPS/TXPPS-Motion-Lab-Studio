/**
 * The instrument faces draw what the instruments do — proved, not asserted.
 *
 * `tests/voices.test.ts` established the pattern: jsdom has no Web Audio, so a
 * recording stand-in runs the real voice engine and counts what it did to the
 * graph. This file takes that further and records the *values* — the filter
 * type, frequency and Q each voice assigns, and every automation call it makes
 * on its gain — then asserts that `model/synthFace.ts` reports those same
 * numbers, and that the envelope curve a face plots is the automation curve the
 * node will play back.
 *
 * This is the test the seven wrong effect faces did not have. A face here can
 * only be wrong by making the voice engine wrong with it.
 */
import { describe, expect, it } from 'vitest';
import { PolySynth } from '../src/audio/synth';
import { RackInstrument, SamplerInstrument } from '../src/audio/samplerInstrument';
import { cacheBuffer, resetMediaCaches } from '../src/audio/mediaLibrary';
import { dbToGain, eqMagnitudeResponse, logFrequencies, qToDb } from '../src/audio/dsp/curves';
import { defaultSamplerParams, makeZone, type SamplerParams } from '../src/model/sampler';
import { midiToFreq } from '../src/model/music';
import type { RackItem, SynthParams, Waveform } from '../src/model/types';
import {
  ampEnvelopeGain,
  ampEnvelopePoints,
  ampEnvelopeSpan,
  FACE_PLOT_RATE,
  filterResponseDb,
  lfoSweepHz,
  oscillatorSample,
  rackLayersAt,
  samplerAmpEnvelope,
  samplerLfoOf,
  samplerVoiceFilter,
  suggestedHoldSec,
  synthAmpEnvelope,
  synthFilterSweep,
  synthGlideOf,
  synthKeyTrack,
  synthLfoOf,
  synthMorphDelaySec,
  synthOscillatorOf,
  synthOscillatorSample,
  synthSubOf,
  synthVoiceFilter,
  synthWidthSweep,
  SYNTH_LFO_WIDTH_DUTY,
  SYNTH_PW_MAX,
  SYNTH_PW_MIN,
  SYNTH_PW_SWEEP_MAX,
  SYNTH_SUB_WAVE,
  zoneKeyProfile,
  zonePlaySeconds,
  zoneWindowOf,
  type AmpEnvelope,
} from '../src/model/synthFace';

// -------------------------------------------------------- recording context

interface Call {
  method: 'set' | 'ramp' | 'exp' | 'target' | 'cancel';
  value: number;
  time: number;
  tau: number;
}

interface RecParam {
  value: number;
  calls: Call[];
}

interface RecFilter {
  type: string;
  frequency: RecParam;
  Q: RecParam;
}

interface RecOsc {
  type: string;
  frequency: RecParam;
  /** Where a pitch modulator lands, in cents, on the oscillator and its sub. */
  detune: RecParam;
  stopArgs: number[];
}

interface RecSource {
  loop: boolean;
  loopStart: number;
  loopEnd: number;
  playbackRate: RecParam;
  detune: RecParam;
  startArgs: number[][];
  stopArgs: number[];
}

interface RecDelay {
  maxDelayTime: number;
  delayTime: RecParam;
}

interface Recorder {
  gains: RecParam[];
  filters: RecFilter[];
  oscillators: RecOsc[];
  sources: RecSource[];
  delays: RecDelay[];
  /** Everything anything was connected to, so a modulator's reach is checkable. */
  connections: unknown[];
}

const newRecorder = (): Recorder => ({
  gains: [],
  filters: [],
  oscillators: [],
  sources: [],
  delays: [],
  connections: [],
});

const isParam = (x: unknown): x is RecParam =>
  typeof x === 'object' && x !== null && Array.isArray((x as RecParam).calls);

/**
 * Enough of an audio graph to run the real voice engines against.
 *
 * Every node handed back *is* the object the recorder holds, rather than a copy
 * of it — the engine assigns `filter.type` and `source.loopStart` directly, and
 * a spread would have quietly recorded the defaults instead.
 */
function recordingContext(rec: Recorder, currentTime = 0): BaseAudioContext {
  const param = (value: number): RecParam => {
    const p = { value, calls: [] as Call[] };
    return Object.assign(p, {
      setValueAtTime: (v: number, t: number) =>
        p.calls.push({ method: 'set', value: v, time: t, tau: 0 }),
      linearRampToValueAtTime: (v: number, t: number) =>
        p.calls.push({ method: 'ramp', value: v, time: t, tau: 0 }),
      exponentialRampToValueAtTime: (v: number, t: number) =>
        p.calls.push({ method: 'exp', value: v, time: t, tau: 0 }),
      setTargetAtTime: (v: number, t: number, tau: number) =>
        p.calls.push({ method: 'target', value: v, time: t, tau }),
      cancelScheduledValues: (t: number) =>
        p.calls.push({ method: 'cancel', value: 0, time: t, tau: 0 }),
    });
  };
  const wire = <T extends object>(target: T): T =>
    Object.assign(target, {
      connect: (destination: unknown) => {
        rec.connections.push(destination);
        return destination;
      },
      disconnect() {},
    });

  return {
    sampleRate: 44100,
    currentTime,
    createGain: () => {
      const gain = param(1);
      rec.gains.push(gain);
      return wire({ gain });
    },
    createBiquadFilter: () => {
      const f: RecFilter = { type: 'lowpass', frequency: param(350), Q: param(1) };
      rec.filters.push(f);
      return wire(f);
    },
    createStereoPanner: () => wire({ pan: param(0) }),
    createDelay: (maxDelayTime: number) => {
      const d: RecDelay = { maxDelayTime, delayTime: param(0) };
      rec.delays.push(d);
      return wire(d);
    },
    createOscillator: () => {
      const o: RecOsc = { type: 'sine', frequency: param(440), detune: param(0), stopArgs: [] };
      rec.oscillators.push(o);
      return wire(
        Object.assign(o, {
          onended: null,
          start() {},
          stop: (t: number) => o.stopArgs.push(t),
        }),
      );
    },
    createBufferSource: () => {
      const s: RecSource = {
        loop: false,
        loopStart: 0,
        loopEnd: 0,
        playbackRate: param(1),
        detune: param(0),
        startArgs: [],
        stopArgs: [],
      };
      rec.sources.push(s);
      return wire(
        Object.assign(s, {
          buffer: null,
          onended: null,
          start: (...args: number[]) => s.startArgs.push(args),
          stop: (t: number) => s.stopArgs.push(t),
        }),
      );
    },
  } as unknown as BaseAudioContext;
}

const OPEN_REGISTRY = { register: () => {}, unregister: () => {}, canAllocate: () => true };

// ------------------------------------------------------- automation replay

type Segment =
  | { kind: 'const'; value: number }
  | { kind: 'target'; t0: number; v0: number; target: number; tau: number };

const segmentAt = (seg: Segment, t: number): number =>
  seg.kind === 'const'
    ? seg.value
    : seg.target + (seg.v0 - seg.target) * Math.exp(-(t - seg.t0) / seg.tau);

/**
 * The value an AudioParam holds at `t`, given the calls it received.
 *
 * The specification's arithmetic, written out: a linear ramp interpolates
 * between its two scheduled points, `setTargetAtTime` approaches its target
 * exponentially from wherever the parameter had got to, and
 * `cancelScheduledValues` drops everything from its own time onwards. The
 * envelope helper is compared against this rather than against a restatement
 * of itself.
 */
function automationValueAt(calls: readonly Call[], t: number): number {
  const events: Call[] = [];
  for (const c of calls) {
    if (c.method === 'cancel') {
      for (let i = events.length - 1; i >= 0; i--)
        if (events[i].time >= c.time) events.splice(i, 1);
      continue;
    }
    events.push(c);
  }
  let seg: Segment = { kind: 'const', value: 0 };
  let prevTime = 0;
  for (const e of events) {
    if (t < e.time) {
      if (e.method !== 'ramp' && e.method !== 'exp') return segmentAt(seg, t);
      const from = segmentAt(seg, prevTime);
      const span = e.time - prevTime;
      if (span <= 0) return e.value;
      const progress = (t - prevTime) / span;
      // An exponential ramp is geometric between its endpoints, which is what
      // makes it the right curve for a pitch and the wrong one for a gain that
      // has to reach zero.
      return e.method === 'exp'
        ? from * Math.pow(e.value / from, progress)
        : from + (e.value - from) * progress;
    }
    const here = segmentAt(seg, e.time);
    seg =
      e.method === 'target'
        ? { kind: 'target', t0: e.time, v0: here, target: e.value, tau: e.tau }
        : { kind: 'const', value: e.value };
    prevTime = e.time;
  }
  return segmentAt(seg, t);
}

/** Sample both the replayed automation and the descriptor across a whole note. */
function envelopeAgrees(calls: readonly Call[], env: AmpEnvelope, hold: number): void {
  const span = ampEnvelopeSpan(env, hold);
  for (let i = 0; i <= 60; i++) {
    const t = (i / 60) * span;
    expect(automationValueAt(calls, t), `at ${t.toFixed(3)} s`).toBeCloseTo(
      ampEnvelopeGain(env, t, hold),
      9,
    );
  }
}

// ------------------------------------------------------------------- synth

const SYNTH: SynthParams = {
  presetName: 'Test',
  waveform: 'sawtooth',
  cutoff: 1200,
  resonance: 6,
  attack: 0.03,
  decay: 0.4,
  sustain: 0.35,
  release: 0.6,
  volume: 0.8,
};

function playSynth(params: SynthParams, pitch: number, velocity: number, hold: number): Recorder {
  const rec = newRecorder();
  const ctx = recordingContext(rec);
  const out = ctx.createGain();
  rec.gains.length = 0; // the output bus is not a voice
  new PolySynth(ctx, out, 't1', () => params, OPEN_REGISTRY).scheduleNote(pitch, velocity, 0, hold);
  return rec;
}

/** Several notes through one instrument, which is what portamento needs. */
function playPhrase(
  params: SynthParams,
  notes: { pitch: number; when: number; clipId?: string }[],
): Recorder {
  const rec = newRecorder();
  const ctx = recordingContext(rec);
  const out = ctx.createGain();
  rec.gains.length = 0;
  const synth = new PolySynth(ctx, out, 't1', () => params, OPEN_REGISTRY);
  for (const n of notes) synth.scheduleNote(n.pitch, 100, n.when, 0.25, n.clipId);
  return rec;
}

describe('the synth face draws the synth', () => {
  it('reports the filter the voice hands to the node, key tracking included', () => {
    for (const pitch of [36, 60, 84]) {
      const node = playSynth(SYNTH, pitch, 100, 1).filters[0];
      const drawn = synthVoiceFilter(SYNTH, pitch);
      expect(node.type).toBe(drawn.type);
      expect(node.frequency.value).toBeCloseTo(drawn.freqHz, 9);
      expect(node.Q.value).toBeCloseTo(drawn.qDb, 9);
    }
  });

  it('key tracking is half an octave of cutoff per octave of key', () => {
    expect(synthKeyTrack(60)).toBe(1);
    expect(synthKeyTrack(72)).toBeCloseTo(Math.SQRT2, 12);
    expect(synthKeyTrack(48)).toBeCloseTo(Math.SQRT1_2, 12);
  });

  it('honours the clamps the voice applies rather than the knob ranges', () => {
    const wild: SynthParams = { ...SYNTH, cutoff: 40000, resonance: 900 };
    const rec = playSynth(wild, 60, 100, 1);
    expect(rec.filters[0].frequency.value).toBe(18000);
    expect(rec.filters[0].Q.value).toBe(24);
    expect(synthVoiceFilter(wild).freqHz).toBe(18000);
    expect(synthVoiceFilter(wild).qDb).toBe(24);
    // And at the bottom: a low note cannot pull the cutoff below 40 Hz.
    expect(synthVoiceFilter({ ...SYNTH, cutoff: 60 }, 0).freqHz).toBe(40);
  });

  /**
   * The gotcha this whole file exists for. A Web Audio lowpass reads `Q` in
   * decibels, so the number the voice assigns is a dB figure and the response
   * has to be computed from it as one. Read as a plain quality factor — which
   * is what every label on this parameter still implies — it draws a filter
   * with roughly ten decibels of resonance the audio does not have.
   */
  it('computes the response with Q as decibels, the way the node reads it', () => {
    const freqs = logFrequencies(64, 20, 20000);
    const filter = synthVoiceFilter(SYNTH);
    const drawn = filterResponseDb(filter, freqs);
    const throughEq = eqMagnitudeResponse(
      [
        {
          type: 'lowpass',
          freqHz: filter.freqHz,
          q: dbToGain(filter.qDb),
          gainDb: 0,
          enabled: true,
        },
      ],
      freqs,
      FACE_PLOT_RATE,
    );
    for (let i = 0; i < freqs.length; i++) expect(drawn[i]).toBeCloseTo(throughEq[i], 9);
    expect(qToDb(dbToGain(filter.qDb))).toBeCloseTo(filter.qDb, 12);

    const asPlainQ = eqMagnitudeResponse(
      [{ type: 'lowpass', freqHz: filter.freqHz, q: filter.qDb, gainDb: 0, enabled: true }],
      [filter.freqHz],
      FACE_PLOT_RATE,
    );
    expect(asPlainQ[0] - filterResponseDb(filter, [filter.freqHz])[0]).toBeGreaterThan(5);
  });

  it('lifts the corner by exactly the resonance in decibels', () => {
    // A biquad's magnitude at its own corner is its Q, and this Q is in dB —
    // so the resonance number is the lift, which is what the face labels it.
    for (const resonance of [0.7, 6, 9, 14]) {
      const filter = synthVoiceFilter({ ...SYNTH, cutoff: 1000, resonance });
      expect(filterResponseDb(filter, [1000])[0]).toBeCloseTo(resonance, 6);
    }
    const rolloff = filterResponseDb(synthVoiceFilter({ ...SYNTH, cutoff: 1000 }), [2000, 4000]);
    expect(rolloff[0] - rolloff[1]).toBeGreaterThan(12); // two poles, at least
  });

  it('plots the amplitude envelope the voice schedules, not three straight lines', () => {
    const hold = 1;
    const rec = playSynth(SYNTH, 60, 100, hold);
    const env = synthAmpEnvelope(SYNTH, 100);
    envelopeAgrees(rec.gains[0].calls, env, hold);

    // The decay is an exponential approach with a third of the decay time as
    // its constant. A straight line from peak to sustain is well outside it.
    const straight = env.peak + (env.peak * env.sustain - env.peak) * 0.5;
    const real = ampEnvelopeGain(env, env.attackSec + env.decayTau * 1.5, hold);
    expect(Math.abs(real - straight)).toBeGreaterThan(0.02);
  });

  it('places the sustain, the release and the moment the voice stops', () => {
    const env = synthAmpEnvelope(SYNTH, 100);
    // Three time constants is the decay knob, and lands within 5% of sustain.
    expect(ampEnvelopeGain(env, env.attackSec + env.decayTau * 3, 10) / env.peak).toBeCloseTo(
      env.sustain,
      1,
    );
    expect(env.attackSec).toBe(0.03);
    expect(env.decayTau).toBeCloseTo(0.4 / 3, 12);
    expect(env.releaseTau).toBeCloseTo(0.6 / 3, 12);

    const rec = playSynth(SYNTH, 60, 100, 0.5);
    expect(rec.oscillators[0].stopArgs[0]).toBeCloseTo(ampEnvelopeSpan(env, 0.5), 9);
  });

  it('the peak the ramp reaches is level, velocity and the fixed headroom', () => {
    for (const velocity of [1, 64, 127]) {
      const ramp = playSynth(SYNTH, 60, velocity, 0.5).gains[0].calls.find(
        (c) => c.method === 'ramp',
      );
      expect(ramp?.value).toBeCloseTo(synthAmpEnvelope(SYNTH, velocity).peak, 9);
    }
  });

  it('draws the waveform the oscillator is set to', () => {
    for (const waveform of ['sine', 'square', 'sawtooth', 'triangle'] as Waveform[]) {
      expect(playSynth({ ...SYNTH, waveform }, 60, 100, 0.2).oscillators[0].type).toBe(waveform);
    }
  });

  it('draws each waveform as the specification defines it', () => {
    expect(oscillatorSample('sine', 0.25)).toBeCloseTo(1, 12);
    expect(oscillatorSample('square', 0.2)).toBe(1);
    expect(oscillatorSample('square', 0.7)).toBe(-1);
    // A sawtooth rises from zero and drops through the middle of its cycle.
    expect(oscillatorSample('sawtooth', 0)).toBe(0);
    expect(oscillatorSample('sawtooth', 0.49)).toBeCloseTo(0.98, 12);
    expect(oscillatorSample('sawtooth', 0.51)).toBeCloseTo(-0.98, 12);
    expect(oscillatorSample('triangle', 0.25)).toBe(1);
    expect(oscillatorSample('triangle', 0.75)).toBe(-1);
    for (const shape of ['sine', 'square', 'sawtooth', 'triangle'] as Waveform[]) {
      expect(oscillatorSample(shape, 1.3)).toBeCloseTo(oscillatorSample(shape, 0.3), 12);
      let sum = 0;
      for (let i = 0; i < 1000; i++) sum += oscillatorSample(shape, i / 1000);
      expect(Math.abs(sum / 1000), `${shape} is centred`).toBeLessThan(0.002);
    }
  });
});

// ------------------------------------------- oscillator, sub, glide and LFO

/** The morph at its square end: the oscillator minus half a cycle of itself. */
const MORPH: SynthParams = { ...SYNTH, waveform: 'sawtooth', shape: 1, pulseWidth: 0.5 };

/** Whichever gain inverts the delayed copy, which is the only negative one. */
const morphGainOf = (rec: Recorder): number => rec.gains.find((g) => g.value < 0)!.value;

describe('the oscillator the face draws is the one the voice sums', () => {
  /**
   * The load-bearing test for the whole schema decision: a patch written before
   * any of this existed builds the graph it always did — one oscillator, no
   * delay line, no second gain, and a frequency assigned rather than automated.
   * Anything else would mean an old project came back sounding different.
   */
  it('builds nothing new for a patch that predates the morph, the sub and the LFO', () => {
    const rec = playSynth(SYNTH, 60, 100, 0.5);
    expect(rec.oscillators).toHaveLength(1);
    expect(rec.delays).toHaveLength(0);
    expect(rec.gains).toHaveLength(1);
    expect(rec.oscillators[0].type).toBe(SYNTH.waveform);
    expect(rec.oscillators[0].frequency.calls).toEqual([]);
    expect(rec.oscillators[0].frequency.value).toBeCloseTo(midiToFreq(60), 9);
    expect(rec.connections.filter(isParam)).toEqual([]);

    expect(synthOscillatorOf(SYNTH).morph).toBeNull();
    expect(synthSubOf(SYNTH)).toBeNull();
    expect(synthLfoOf(SYNTH)).toBeNull();
    expect(synthGlideOf(SYNTH, 55, 60)).toBeNull();
  });

  it('subtracts a delayed copy of itself, at the depth and delay the face reports', () => {
    const rec = playSynth(MORPH, 60, 100, 0.5);
    const osc = synthOscillatorOf(MORPH);
    const freqHz = midiToFreq(60);

    expect(rec.delays).toHaveLength(1);
    expect(rec.delays[0].delayTime.value).toBeCloseTo(synthMorphDelaySec(osc, freqHz), 12);
    expect(rec.delays[0].delayTime.value).toBeCloseTo(0.5 / freqHz, 12);
    expect(rec.delays[0].maxDelayTime).toBeGreaterThan(rec.delays[0].delayTime.value);
    expect(morphGainOf(rec)).toBeCloseTo(-osc.morph!.shape, 12);

    // The wave the face plots, against the sum the graph makes — computed from
    // the delay and the gain the *nodes* were given, not from the parameters
    // again. Away from the two discontinuities, which is where a plot lives.
    const delayCycles = rec.delays[0].delayTime.value * freqHz;
    for (let i = 0; i < 40; i++) {
      const phase = 0.013 + i / 17;
      const summed =
        oscillatorSample(MORPH.waveform, phase) +
        morphGainOf(rec) * oscillatorSample(MORPH.waveform, phase - delayCycles);
      expect(synthOscillatorSample(osc, phase), `at ${phase.toFixed(3)} cycles`).toBeCloseTo(
        summed,
        12,
      );
    }
  });

  it('is exactly the sawtooth at one end of the morph and exactly the square at the other', () => {
    const saw = { ...SYNTH, waveform: 'sawtooth' as const, shape: 0 };
    expect(synthOscillatorOf(saw).morph).toBeNull();
    expect(playSynth(saw, 60, 100, 0.3).delays).toHaveLength(0);

    const square = synthOscillatorOf(MORPH);
    for (const phase of [0.01, 0.2, 0.49, 0.51, 0.8, 0.99]) {
      expect(synthOscillatorSample(square, phase)).toBeCloseTo(
        oscillatorSample('square', phase),
        12,
      );
    }
  });

  it('sets the duty from the width, and holds the peak-to-peak of a square while it moves', () => {
    for (const width of [0.15, 0.35, 0.5, 0.9]) {
      const p = { ...MORPH, pulseWidth: width };
      const rec = playSynth(p, 60, 100, 0.3);
      expect(rec.delays[0].delayTime.value * midiToFreq(60)).toBeCloseTo(1 - width, 12);

      // Two levels, a full cycle apart in amplitude and zero-mean between them:
      // the duty is what moves, which is what a pulse-width control means.
      const osc = synthOscillatorOf(p);
      const samples = Array.from({ length: 2000 }, (_, i) =>
        synthOscillatorSample(osc, (i + 0.5) / 2000),
      );
      const high = Math.max(...samples);
      const low = Math.min(...samples);
      expect(high - low, `peak to peak at width ${width}`).toBeCloseTo(2, 6);
      expect(samples.reduce((a, b) => a + b, 0) / samples.length, `mean at ${width}`).toBeCloseTo(
        0,
        6,
      );
      expect(samples.filter((v) => v > 0).length / samples.length, `duty at ${width}`).toBeCloseTo(
        width,
        2,
      );
    }
    // Outside the range a pulse is a click, so the control does not go there.
    expect(synthOscillatorOf({ ...MORPH, pulseWidth: 0 }).morph!.width).toBe(SYNTH_PW_MIN);
    expect(synthOscillatorOf({ ...MORPH, pulseWidth: 1 }).morph!.width).toBe(SYNTH_PW_MAX);
  });

  it('adds the sub an octave under at its own level, and nothing at all at zero', () => {
    const withSub = { ...SYNTH, subLevel: 0.6 };
    const rec = playSynth(withSub, 60, 100, 0.3);
    const sub = synthSubOf(withSub, 60)!;

    expect(rec.oscillators).toHaveLength(2);
    expect(rec.oscillators[1].type).toBe(SYNTH_SUB_WAVE);
    expect(rec.oscillators[1].frequency.value).toBeCloseTo(sub.freqHz, 12);
    expect(rec.oscillators[1].frequency.value * 2).toBeCloseTo(rec.oscillators[0].frequency.value, 12);
    expect(rec.gains.some((g) => g.value === sub.gain)).toBe(true);

    expect(synthSubOf({ ...SYNTH, subLevel: 0 })).toBeNull();
    expect(playSynth({ ...SYNTH, subLevel: 0 }, 60, 100, 0.3).oscillators).toHaveLength(1);
  });
});

describe('portamento', () => {
  const GLIDED: SynthParams = {
    ...SYNTH,
    glide: 0.2,
    subLevel: 0.5,
    waveform: 'sawtooth',
    shape: 1,
    pulseWidth: 0.5,
  };

  it('starts the second note on the first note pitch and ramps it, sub and duty included', () => {
    const rec = playPhrase(GLIDED, [
      { pitch: 48, when: 0, clipId: 'c1' },
      { pitch: 60, when: 1, clipId: 'c1' },
    ]);
    const glide = synthGlideOf(GLIDED, 48, 60)!;
    expect(glide.seconds).toBe(0.2);

    // Nothing to glide from, so the first note is assigned its pitch.
    expect(rec.oscillators[0].frequency.calls).toEqual([]);

    // Voices build main, sub, then modulator — so the second note's pair is 2 and 3.
    const [main, sub] = [rec.oscillators[2], rec.oscillators[3]];
    expect(main.frequency.calls.map((c) => c.method)).toEqual(['set', 'exp']);
    expect(main.frequency.calls[0].value).toBeCloseTo(glide.fromHz, 9);
    expect(main.frequency.calls[0].time).toBe(1);
    expect(main.frequency.calls[1].value).toBeCloseTo(glide.toHz, 12);
    expect(main.frequency.calls[1].time).toBeCloseTo(1 + glide.seconds, 12);
    // The sub glides the same octave below at both ends, so the two never beat.
    expect(sub.frequency.calls[0].value * 2).toBeCloseTo(glide.fromHz, 9);
    expect(sub.frequency.calls[1].value * 2).toBeCloseTo(glide.toHz, 12);

    // And the delay line rides the reciprocal, so the pulse arrives the width
    // it left at rather than half of it.
    const delay = rec.delays[1].delayTime.calls;
    expect(delay[0].value * glide.fromHz).toBeCloseTo(0.5, 12);
    expect(delay[1].value * glide.toHz).toBeCloseTo(0.5, 12);
  });

  it('leaves a repeated note and a glide of zero assigning the pitch outright', () => {
    expect(synthGlideOf(GLIDED, 60, 60)).toBeNull();
    const repeated = playPhrase(GLIDED, [
      { pitch: 60, when: 0, clipId: 'c1' },
      { pitch: 60, when: 1, clipId: 'c1' },
    ]);
    expect(repeated.oscillators[2].frequency.calls).toEqual([]);

    const off = playPhrase({ ...GLIDED, glide: 0 }, [
      { pitch: 48, when: 0, clipId: 'c1' },
      { pitch: 60, when: 1, clipId: 'c1' },
    ]);
    for (const o of off.oscillators) expect(o.frequency.calls).toEqual([]);
  });

  /**
   * The bounce walks `project.clips` and empties each one before starting the
   * next; playback walks a lookahead window across all of them at once. A synth
   * that glided from "the last note played" would therefore glide from a
   * different note in the exported file than it did through the speakers on any
   * track holding two overlapping clips — a difference nobody would find until
   * they listened to the export.
   */
  it('glides within a clip, so the bounce order and the playback order agree', () => {
    const notes = [
      { pitch: 48, when: 0, clipId: 'a' },
      { pitch: 72, when: 1, clipId: 'b' },
      { pitch: 50, when: 2, clipId: 'a' },
      { pitch: 74, when: 3, clipId: 'b' },
    ];
    const byClip = playPhrase(GLIDED, [notes[0], notes[2], notes[1], notes[3]]);
    const byTime = playPhrase(GLIDED, notes);

    /** What each voice's oscillator glided from, keyed by where it glided to. */
    const glides = (rec: Recorder) =>
      rec.oscillators
        .filter((o) => o.type === GLIDED.waveform)
        .map((o) => ({
          to: o.frequency.calls.length ? o.frequency.calls[1].value : o.frequency.value,
          from: o.frequency.calls.length ? o.frequency.calls[0].value : null,
        }))
        .sort((x, y) => x.to - y.to);

    expect(glides(byClip)).toEqual(glides(byTime));
    // And it is the note before it in its own clip, not the nearest in time.
    const toFifty = glides(byTime).find((g) => Math.abs(g.to - midiToFreq(50)) < 1e-6)!;
    expect(toFifty.from).toBeCloseTo(midiToFreq(48), 6);
  });

  it('forgets the phrase when everything is cut, so the next note starts on its own', () => {
    const rec = newRecorder();
    const ctx = recordingContext(rec);
    const out = ctx.createGain();
    rec.gains.length = 0;
    const synth = new PolySynth(ctx, out, 't1', () => GLIDED, OPEN_REGISTRY);
    synth.scheduleNote(48, 100, 0, 0.25, 'c1');
    synth.allNotesOff();
    synth.scheduleNote(60, 100, 1, 0.25, 'c1');
    expect(rec.oscillators[rec.oscillators.length - 3].frequency.calls).toEqual([]);
  });
});

describe('the synth LFO', () => {
  const MODULATED: SynthParams = {
    ...MORPH,
    subLevel: 0.5,
    lfoRate: 3,
    lfoToPitch: 0.5,
    lfoToFilter: 0.4,
    lfoToWidth: 1,
  };

  it('builds one modulator, one gain per destination, and reaches all three', () => {
    const rec = playSynth(MODULATED, 60, 100, 0.4);
    const lfo = synthLfoOf(MODULATED, 60)!;
    const freqHz = midiToFreq(60);

    // Main, sub, modulator — and only one modulator for three destinations.
    expect(rec.oscillators).toHaveLength(3);
    expect(rec.oscillators[2].frequency.value).toBeCloseTo(lfo.rateHz, 12);

    const gains = rec.gains.map((g) => g.value);
    expect(gains).toContain(lfo.toPitchCents);
    expect(gains).toContain(lfo.toFilterHz);
    expect(gains.some((v) => Math.abs(v - lfo.toWidthDuty / freqHz) < 1e-15)).toBe(true);

    const reached = rec.connections.filter(isParam);
    expect(reached).toContain(rec.oscillators[0].detune);
    expect(reached).toContain(rec.oscillators[1].detune);
    expect(reached).toContain(rec.filters[0].frequency);
    expect(reached).toContain(rec.delays[0].delayTime);
  });

  it('sweeps the filter through the band the curve shades', () => {
    const p = { ...SYNTH, cutoff: 2000, lfoToFilter: 0.5 };
    const lfo = synthLfoOf(p, 60)!;
    expect(lfo.toFilterHz).toBeCloseTo(500, 9);
    expect(playSynth(p, 60, 100, 0.3).gains.some((g) => Math.abs(g.value - 500) < 1e-9)).toBe(true);
    expect(synthFilterSweep(synthVoiceFilter(p, 60), lfo)).toEqual({ lowHz: 1500, highHz: 2500 });
    // The key opens the cutoff, and the depth is a share of it, so the band
    // moves up the keyboard with the corner it is centred on.
    expect(synthLfoOf(p, 84)!.toFilterHz).toBeCloseTo(500 * synthKeyTrack(84), 9);
  });

  it('keeps the width sweep inside the pulse rather than driving it through zero', () => {
    const middle = { ...MORPH, pulseWidth: 0.5, lfoToWidth: 1 };
    expect(synthLfoOf(middle)!.toWidthDuty).toBeCloseTo(SYNTH_LFO_WIDTH_DUTY, 12);
    expect(synthWidthSweep(synthOscillatorOf(middle), synthLfoOf(middle))).toEqual({
      lowDuty: 0.5 - SYNTH_LFO_WIDTH_DUTY,
      highDuty: 0.5 + SYNTH_LFO_WIDTH_DUTY,
    });

    // At the end of the width's travel there is almost no room left, and the
    // depth that is left is the depth the face reports and the gain the node
    // holds — a delay driven through zero would cancel the pulse and read as
    // tremolo instead of as a widening pulse.
    const wide = { ...MORPH, pulseWidth: SYNTH_PW_MAX, lfoToWidth: 1 };
    const lfo = synthLfoOf(wide)!;
    expect(lfo.toWidthDuty).toBeCloseTo(SYNTH_PW_SWEEP_MAX - SYNTH_PW_MAX, 12);
    expect(synthWidthSweep(synthOscillatorOf(wide), lfo)!.highDuty).toBeCloseTo(
      SYNTH_PW_SWEEP_MAX,
      12,
    );
    expect(
      playSynth(wide, 60, 100, 0.3).gains.some(
        (g) => Math.abs(g.value - lfo.toWidthDuty / midiToFreq(60)) < 1e-15,
      ),
    ).toBe(true);
  });

  it('reports no modulator where the voice builds none', () => {
    expect(synthLfoOf(SYNTH)).toBeNull();
    expect(playSynth(SYNTH, 60, 100, 0.3).oscillators).toHaveLength(1);

    // A width depth with no pulse to widen: the sampler's "LFO → filter with
    // the filter off" defect, in this instrument's terms. No oscillator is
    // built, and the face says so rather than offering a live-looking dial.
    const noPulse = { ...SYNTH, lfoToWidth: 1 };
    expect(synthLfoOf(noPulse)).toBeNull();
    expect(playSynth(noPulse, 60, 100, 0.3).oscillators).toHaveLength(1);
    expect(synthWidthSweep(synthOscillatorOf(noPulse), synthLfoOf(noPulse))).toBeNull();
  });
});

// ----------------------------------------------------------------- sampler

const MEDIA = 'm-face';
const MEDIA_SEC = 2;

function cacheMedia(): void {
  resetMediaCaches();
  const length = Math.round(44100 * MEDIA_SEC);
  const data = new Float32Array(length);
  cacheBuffer(MEDIA, {
    numberOfChannels: 1,
    length,
    sampleRate: 44100,
    duration: MEDIA_SEC,
    getChannelData: () => data,
  } as unknown as AudioBuffer);
}

function samplerParams(patch: Partial<SamplerParams> = {}): SamplerParams {
  return {
    ...defaultSamplerParams('quick'),
    zones: [
      makeZone({
        mediaId: MEDIA,
        name: 'Zone',
        startSec: 0.25,
        endSec: 1.5,
        loop: true,
        loopStartSec: 0.1,
        loopEndSec: 3,
        gain: 0.8,
      }),
    ],
    attack: 0.02,
    decay: 0.3,
    sustain: 0.5,
    release: 0.25,
    volume: 1.1,
    ...patch,
  };
}

function playSampler(params: SamplerParams, key: number, velocity: number, hold: number): Recorder {
  cacheMedia();
  const rec = newRecorder();
  const ctx = recordingContext(rec);
  const out = ctx.createGain();
  rec.gains.length = 0;
  new SamplerInstrument(ctx, out, 't1', () => params, OPEN_REGISTRY).scheduleNote(
    key,
    velocity,
    0,
    hold,
  );
  resetMediaCaches();
  return rec;
}

describe('the sampler face draws the sampler', () => {
  it('reports the filter the voice builds, and none where it builds none', () => {
    const off = samplerParams({ filterType: 'off' });
    expect(samplerVoiceFilter(off)).toBeNull();
    expect(playSampler(off, 60, 100, 0.5).filters).toHaveLength(0);

    const on = samplerParams({ filterType: 'highpass', filterCutoff: 800, filterRes: 3 });
    const node = playSampler(on, 60, 100, 0.5).filters[0];
    const drawn = samplerVoiceFilter(on)!;
    expect(node.type).toBe(drawn.type);
    expect(node.frequency.value).toBeCloseTo(drawn.freqHz, 9);
    // Q in decibels again, because a highpass reads it that way too.
    expect(node.Q.value).toBeCloseTo(drawn.qDb, 9);
  });

  it('plots the sampler envelope the voice schedules', () => {
    const params = samplerParams({ zones: [makeZone({ mediaId: MEDIA, loop: true, gain: 0.8 })] });
    const hold = 0.8;
    const rec = playSampler(params, 60, 90, hold);
    const env = samplerAmpEnvelope(params, { velocity: 90, zoneGain: 0.8 });
    envelopeAgrees(rec.gains[0].calls, env, hold);
    expect(env.tailSec).toBeCloseTo(0.25 + 0.05, 12);
  });

  it('starts the buffer in the window the voice clamps to, loop points included', () => {
    const params = samplerParams();
    const src = playSampler(params, 60, 100, 0.4).sources[0];
    const window = zoneWindowOf(params.zones[0], MEDIA_SEC);

    expect(src.startArgs[0][1]).toBeCloseTo(window.offsetSec, 9);
    expect(src.loop).toBe(true);
    expect(src.loopStart).toBeCloseTo(window.loopStartSec, 9);
    expect(src.loopEnd).toBeCloseTo(window.loopEndSec, 9);
    // Authored at 0.1 s and 3 s; the voice pulls both inside the trim, which is
    // where the face has to draw the loop band.
    expect(window.loopStartSec).toBeCloseTo(0.25, 9);
    expect(window.loopEndSec).toBeCloseTo(1.5, 9);
  });

  it('mirrors the window when the zone plays backwards', () => {
    const params = samplerParams({
      zones: [makeZone({ mediaId: MEDIA, startSec: 0.25, endSec: 1.5, reverse: true })],
    });
    const window = zoneWindowOf(params.zones[0], MEDIA_SEC);
    expect(playSampler(params, 60, 100, 0.4).sources[0].startArgs[0][1]).toBeCloseTo(
      window.offsetSec,
      9,
    );
    expect(window.offsetSec).toBeCloseTo(0.5, 9);
  });

  it('reports how long a one-shot sounds at the key it is played at', () => {
    const zone = makeZone({ mediaId: MEDIA, startSec: 0, endSec: 1, rootNote: 60 });
    expect(zonePlaySeconds(zone, MEDIA_SEC, 60)).toBeCloseTo(1, 9);
    // An octave up plays twice as fast, so it lasts half as long.
    expect(zonePlaySeconds(zone, MEDIA_SEC, 72)).toBeCloseTo(0.5, 9);
  });

  it('builds the modulator the voice builds, at the depth it reaches', () => {
    const pitch = samplerParams({ lfoTarget: 'pitch', lfoRate: 5, lfoDepth: 0.4 });
    const rec = playSampler(pitch, 60, 100, 0.4);
    const lfo = samplerLfoOf(pitch)!;
    expect(rec.oscillators[0].frequency.value).toBeCloseTo(lfo.rateHz, 9);
    // The modulator's gain is its depth in the destination's own unit, and the
    // destination is the parameter the face says it modulates.
    expect(rec.gains.some((g) => g.value === lfo.depthCents)).toBe(true);
    expect(rec.connections.filter(isParam)).toEqual([rec.sources[0].detune]);

    const swept = samplerParams({
      filterType: 'lowpass',
      filterCutoff: 4000,
      lfoTarget: 'filter',
      lfoDepth: 0.5,
    });
    const sweptRec = playSampler(swept, 60, 100, 0.4);
    const sweptLfo = samplerLfoOf(swept)!;
    expect(sweptLfo.depthHz).toBeCloseTo(1000, 9);
    expect(sweptRec.gains.some((g) => g.value === 1000)).toBe(true);
    expect(sweptRec.connections.filter(isParam)).toEqual([sweptRec.filters[0].frequency]);
    expect(lfoSweepHz(samplerVoiceFilter(swept)!, sweptLfo)).toEqual({ lowHz: 3000, highHz: 5000 });
  });

  it('reports no modulator where the voice modulates nothing', () => {
    // Depth zero builds no oscillator at all.
    const zeroDepth = samplerParams({ lfoTarget: 'pitch', lfoDepth: 0 });
    expect(samplerLfoOf(zeroDepth)).toBeNull();
    expect(playSampler(zeroDepth, 60, 100, 0.3).oscillators).toHaveLength(0);

    // "LFO → filter" with the filter switched off builds the oscillator and
    // then connects it to nothing — the panel used to offer a rate and a depth
    // control for exactly this pair, and neither of them did anything.
    const noFilter = samplerParams({ lfoTarget: 'filter', lfoDepth: 0.8, filterType: 'off' });
    expect(samplerLfoOf(noFilter)).toBeNull();
    expect(playSampler(noFilter, 60, 100, 0.3).connections.filter(isParam)).toEqual([]);
  });

  it('draws the crossfade the zone matcher actually applies', () => {
    const low = makeZone({ mediaId: MEDIA, name: 'Low', keyLo: 40, keyHi: 60, rootNote: 48 });
    const high = makeZone({ mediaId: MEDIA, name: 'High', keyLo: 50, keyHi: 80, rootNote: 72 });
    const keys = [40, 50, 55, 60, 70];
    const profile = zoneKeyProfile([low, high], low.id, 100, keys);
    expect(profile[0]).toBe(1); // its own territory
    expect(profile[1]).toBeCloseTo(1, 6); // the overlap starts
    expect(profile[2]).toBeCloseTo(0.5, 6); // half way through it
    expect(profile[3]).toBeCloseTo(0.02, 6); // the matcher's floor, not silence
    expect(profile[4]).toBe(0); // out of range entirely
    // The other zone is the mirror image through the same overlap.
    expect(zoneKeyProfile([low, high], high.id, 100, keys)[2]).toBeCloseTo(0.5, 6);
  });

  it('leaves a muted or out-of-velocity zone off the map', () => {
    const soft = makeZone({ mediaId: MEDIA, name: 'Soft', velLo: 1, velHi: 60 });
    const loud = makeZone({ mediaId: MEDIA, name: 'Loud', velLo: 61, velHi: 127 });
    expect(zoneKeyProfile([soft, loud], soft.id, 100, [60])[0]).toBe(0);
    expect(zoneKeyProfile([soft, loud], loud.id, 100, [60])[0]).toBe(1);
    expect(zoneKeyProfile([{ ...loud, muted: true }], loud.id, 100, [60])[0]).toBe(0);
  });
});

// -------------------------------------------------------------------- rack

describe('the rack face draws the rack', () => {
  const layer = (patch: Partial<RackItem>): RackItem => ({
    id: 'l',
    name: 'Layer',
    color: '#888888',
    keyLo: 0,
    keyHi: 127,
    muted: false,
    solo: false,
    kind: 'synth',
    ...patch,
  });

  /** A child whose only job is to say whether the rack reached it. */
  function stub() {
    const hits: number[] = [];
    return {
      hits,
      instrument: {
        scheduleNote() {},
        noteOn: (pitch: number) => hits.push(pitch),
        noteOff() {},
        setSustain() {},
        allNotesOff() {},
        dispose() {},
      },
    };
  }

  it('marks exactly the layers the rack sends a key to', () => {
    const cases: RackItem[][] = [
      [layer({ id: 'a', keyLo: 0, keyHi: 59 }), layer({ id: 'b', keyLo: 60, keyHi: 127 })],
      [layer({ id: 'a' }), layer({ id: 'b', muted: true })],
      [layer({ id: 'a' }), layer({ id: 'b', solo: true })],
      [layer({ id: 'a', solo: true, muted: true }), layer({ id: 'b', solo: true })],
    ];
    for (const items of cases) {
      const stubs = items.map(() => stub());
      const rack = new RackInstrument(() =>
        items.map((item, i) => ({ ...item, instrument: stubs[i].instrument })),
      );
      for (const pitch of [0, 30, 59, 60, 90, 127]) {
        for (const s of stubs) s.hits.length = 0;
        rack.noteOn(pitch, 100);
        const reached = items.filter((_, i) => stubs[i].hits.length > 0).map((i) => i.id);
        expect(rackLayersAt(items, pitch).map((i) => i.id)).toEqual(reached);
      }
    }
  });
});

// ---------------------------------------------------------------- plotting

describe('envelope plotting', () => {
  it('samples the whole note, note-on to the moment the source stops', () => {
    const env = synthAmpEnvelope(SYNTH, 100);
    const hold = suggestedHoldSec(env);
    const points = ampEnvelopePoints(env, hold, 50);
    expect(points).toHaveLength(50);
    expect(points[0].t).toBe(0);
    expect(points[49].t).toBeCloseTo(ampEnvelopeSpan(env, hold), 12);
    for (const p of points) expect(p.gain).toBeCloseTo(ampEnvelopeGain(env, p.t, hold), 12);
  });

  it('shows a plateau even when the envelope is instant, and never clips a slow one', () => {
    const snappy = synthAmpEnvelope({ ...SYNTH, attack: 0.001, decay: 0.01 }, 100);
    expect(suggestedHoldSec(snappy)).toBeGreaterThan(snappy.attackSec + snappy.decayTau);
    const slow = synthAmpEnvelope({ ...SYNTH, attack: 1.5, decay: 2 }, 100);
    expect(suggestedHoldSec(slow)).toBeGreaterThan(slow.attackSec);
  });
});
