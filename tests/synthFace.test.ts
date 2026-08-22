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
  synthKeyTrack,
  synthVoiceFilter,
  zoneKeyProfile,
  zonePlaySeconds,
  zoneWindowOf,
  type AmpEnvelope,
} from '../src/model/synthFace';

// -------------------------------------------------------- recording context

interface Call {
  method: 'set' | 'ramp' | 'target' | 'cancel';
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

interface Recorder {
  gains: RecParam[];
  filters: RecFilter[];
  oscillators: RecOsc[];
  sources: RecSource[];
  /** Everything anything was connected to, so a modulator's reach is checkable. */
  connections: unknown[];
}

const newRecorder = (): Recorder => ({
  gains: [],
  filters: [],
  oscillators: [],
  sources: [],
  connections: [],
});

const isParam = (x: unknown): x is RecParam =>
  typeof x === 'object' && x !== null && Array.isArray((x as RecParam).calls);

/**
 * jsdom has no `AudioBuffer`, and the sampler constructs one to play a zone
 * backwards. The constructor's options are the whole of what the reverser
 * needs, so a stand-in for it is four fields and an array.
 */
class AudioBufferStub {
  numberOfChannels: number;
  length: number;
  sampleRate: number;
  duration: number;
  private channels: Float32Array[];
  constructor(opts: { numberOfChannels: number; length: number; sampleRate: number }) {
    this.numberOfChannels = opts.numberOfChannels;
    this.length = opts.length;
    this.sampleRate = opts.sampleRate;
    this.duration = opts.length / opts.sampleRate;
    this.channels = Array.from({ length: opts.numberOfChannels }, () => new Float32Array(opts.length));
  }
  getChannelData(i: number): Float32Array {
    return this.channels[i];
  }
}
if (typeof globalThis.AudioBuffer === 'undefined') {
  globalThis.AudioBuffer = AudioBufferStub as unknown as typeof AudioBuffer;
}

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
    createOscillator: () => {
      const o: RecOsc = { type: 'sine', frequency: param(440), stopArgs: [] };
      rec.oscillators.push(o);
      return wire(
        Object.assign(o, {
          detune: param(0),
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
      for (let i = events.length - 1; i >= 0; i--) if (events[i].time >= c.time) events.splice(i, 1);
      continue;
    }
    events.push(c);
  }
  let seg: Segment = { kind: 'const', value: 0 };
  let prevTime = 0;
  for (const e of events) {
    if (t < e.time) {
      if (e.method !== 'ramp') return segmentAt(seg, t);
      const from = segmentAt(seg, prevTime);
      const span = e.time - prevTime;
      return span <= 0 ? e.value : from + (e.value - from) * ((t - prevTime) / span);
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
