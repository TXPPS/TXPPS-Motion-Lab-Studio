import { describe, expect, it } from 'vitest';
import { PolySynth } from '../src/audio/synth';
import { SamplerInstrument } from '../src/audio/samplerInstrument';
import { cacheBuffer, resetMediaCaches } from '../src/audio/mediaLibrary';
import { defaultSamplerParams } from '../src/model/sampler';
import type { SampleZone, SamplerParams } from '../src/model/sampler';
import type { SynthParams } from '../src/model/types';

/**
 * Voice bookkeeping under an offline render.
 *
 * The whole song is scheduled synchronously before rendering starts, so no
 * `onended` ever fires and `ctx.currentTime` stays at 0. Anything that decides
 * "is this voice still running?" from the set alone, or from the context clock,
 * is wrong there — which is why the instruments retire voices by the schedule
 * time of the note being spawned.
 *
 * jsdom has no Web Audio, so this uses the same kind of recording stand-in
 * `tests/effectCurves.test.ts` does: enough of a graph to run the real code and
 * count what it did to it.
 */
interface Counters {
  /** `cancelScheduledValues` only happens on a steal, a choke or a hard stop. */
  cuts: number;
  stops: number;
}

function recordingContext(counters: Counters): BaseAudioContext {
  const param = (value = 0) => ({
    value,
    setValueAtTime() {},
    linearRampToValueAtTime() {},
    setTargetAtTime() {},
    cancelScheduledValues() {
      counters.cuts++;
    },
  });
  const node = (extra: Record<string, unknown> = {}) => ({
    ...extra,
    connect(destination: unknown) {
      return destination;
    },
    disconnect() {},
  });
  const source = (extra: Record<string, unknown> = {}) =>
    node({
      ...extra,
      onended: null,
      start() {},
      stop() {
        counters.stops++;
      },
    });
  return {
    sampleRate: 44100,
    currentTime: 0,
    createGain: () => node({ gain: param(1), channelCount: 2, channelCountMode: 'max' }),
    createBiquadFilter: () =>
      node({ type: 'lowpass', frequency: param(350), Q: param(1), detune: param(0) }),
    createStereoPanner: () => node({ pan: param(0) }),
    createOscillator: () => source({ type: 'sine', frequency: param(440), detune: param(0) }),
    createBufferSource: () =>
      source({ buffer: null, playbackRate: param(1), detune: param(0), loop: false }),
  } as unknown as BaseAudioContext;
}

const OPEN_REGISTRY = {
  register: () => {},
  unregister: () => {},
  canAllocate: () => true,
};

const SYNTH: SynthParams = {
  waveform: 'triangle',
  cutoff: 3000,
  resonance: 1,
  attack: 0.01,
  decay: 0.2,
  sustain: 0.6,
  release: 0.1,
  volume: 0.5,
  presetName: 'Test',
};

const voiceCount = (inst: object): number => (inst as { voices: Set<unknown> }).voices.size;

describe('synth voice retirement', () => {
  function scheduleMelody(notes: number, spacingSec: number, durSec: number): Counters {
    const counters: Counters = { cuts: 0, stops: 0 };
    const ctx = recordingContext(counters);
    const out = ctx.createGain!();
    const synth = new PolySynth(ctx, out, 't1', () => SYNTH, OPEN_REGISTRY);
    for (let i = 0; i < notes; i++) {
      synth.scheduleNote(60 + (i % 12), 100, i * spacingSec, durSec);
    }
    return counters;
  }

  /**
   * 40 notes, one after another, never two sounding at once. The set only ever
   * shrank on `onended`, so offline it grew to the whole part and from note 25
   * every note stole voice 1 — a held pad cut mid-note in the bounce.
   */
  it('does not steal from a monophonic part longer than the voice cap', () => {
    expect(scheduleMelody(40, 1, 0.25).cuts).toBe(0);
  });

  it('still steals when the notes really do overlap', () => {
    // 40 notes all starting at once: past 24 voices something has to give.
    expect(scheduleMelody(40, 0, 4).cuts).toBeGreaterThan(0);
  });

  it('lets the voice set shrink as the schedule advances', () => {
    const ctx = recordingContext({ cuts: 0, stops: 0 });
    const synth = new PolySynth(ctx, ctx.createGain!(), 't1', () => SYNTH, OPEN_REGISTRY);
    for (let i = 0; i < 40; i++) synth.scheduleNote(60, 100, i * 1, 0.25);
    expect(voiceCount(synth)).toBeLessThanOrEqual(2);
  });
});

describe('sampler voice retirement', () => {
  const MEDIA = 'm-hat';

  function zone(chokeGroup?: number): SampleZone {
    return {
      id: 'z1',
      name: 'Hat',
      mediaId: MEDIA,
      keyLo: 0,
      keyHi: 127,
      velLo: 1,
      velHi: 127,
      rootNote: 60,
      keyTrack: false,
      startSec: 0,
      endSec: 0.05,
      loop: false,
      reverse: false,
      oneShot: false,
      gain: 1,
      pan: 0,
      tuneCoarse: 0,
      tuneFine: 0,
      chokeGroup,
    };
  }

  function params(chokeGroup?: number): SamplerParams {
    return { ...defaultSamplerParams('quick'), zones: [zone(chokeGroup)], release: 0.02 };
  }

  function scheduleHats(hits: number, chokeGroup?: number): number {
    resetMediaCaches();
    const data = new Float32Array(4410);
    cacheBuffer(MEDIA, {
      numberOfChannels: 1,
      length: data.length,
      sampleRate: 44100,
      duration: 0.1,
      getChannelData: () => data,
    } as unknown as AudioBuffer);

    const ctx = recordingContext({ cuts: 0, stops: 0 });
    const p = params(chokeGroup);
    const inst = new SamplerInstrument(ctx, ctx.createGain!(), 't1', () => p, OPEN_REGISTRY);
    for (let i = 0; i < hits; i++) inst.scheduleNote(60, 100, i * 0.25, 0.05);
    const live = voiceCount(inst);
    resetMediaCaches();
    return live;
  }

  /**
   * The choke-group scan walks `this.voices`, so a whole song's worth of dead
   * voices turned a hi-hat part into a quadratic sweep with a `release()` call
   * per pair — silent, but a large offline slowdown.
   */
  it('keeps the choke-group scan proportional to what is actually sounding', () => {
    expect(scheduleHats(400, 1)).toBeLessThanOrEqual(2);
  });

  it('does the same without a choke group', () => {
    expect(scheduleHats(400)).toBeLessThanOrEqual(2);
  });
});
