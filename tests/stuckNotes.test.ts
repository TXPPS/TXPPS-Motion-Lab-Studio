/**
 * Every instrument that exists lets go of every note it was given.
 *
 * Directive 10 §5 asks for a stuck-note fuzz "against every instrument that
 * exists", and its standing rule says to enumerate the axis rather than list
 * the cases you thought of. The first attempt here enumerated the wrong axis
 * and the rule caught it within the hour: `Engine.reconcile` chooses between
 * three *kind strings*, but `buildInstrument` splits `'synth'` again at
 * construction — a `drum` track with no sampler params gets a `DrumKit`, not a
 * `PolySynth`. Four classes behind three names, and the fourth was the one with
 * the unusual answer.
 *
 * So the axis is read from the source: every `class X implements Instrument` in
 * the two modules that define them. That cannot go stale, and `the instrument
 * axis` below fails by name if a class appears that this file does not build.
 *
 * The assertion is on `sustainingVoices` and never on `activeVoices`. A voice
 * in its release tail is still audible and still active, so asserting zero
 * active voices after a note-off fails on correct behaviour — and a row that
 * fails on correct behaviour gets calibrated away rather than fixed. A *held*
 * voice is the bug: a note the player let go of that is still sounding.
 *
 * Two instruments here cannot hold a note at all, and that is a fact about them
 * rather than an exemption. A drum kit is a one-shot whose source stops itself
 * at the end of the buffer. A sampler zone that does not loop is the same:
 * `SamplerInstrument.spawn` schedules its release at spawn time from the length
 * of the sample, so `endsAt` is finite before the key is even lifted. Only a
 * looping zone has no end of its own, and only it can therefore stick. Those
 * two take the one-shot rows instead, which assert the thing that *can* go
 * wrong for them: a panic must still reach every voice they started.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DrumKit, PolySynth } from '../src/audio/synth';
import { RackInstrument, SamplerInstrument } from '../src/audio/samplerInstrument';
import { cacheBuffer, resetMediaCaches } from '../src/audio/mediaLibrary';
import { defaultSamplerParams } from '../src/model/sampler';
import type { SampleZone, SamplerParams, SamplerView } from '../src/model/sampler';
import type { Instrument } from '../src/audio/synth';
import type { SynthParams } from '../src/model/types';

/** Every `stop()` the graph was asked for, which is what a panic is made of. */
interface Stops {
  n: number;
}

/**
 * Enough of a graph to run the real code. jsdom has no Web Audio and none of
 * this needs to make a sound — but the instruments must not be able to tell.
 */
function stubContext(stops: Stops): BaseAudioContext {
  const param = (value = 0) => ({
    value,
    setValueAtTime() {},
    linearRampToValueAtTime() {},
    exponentialRampToValueAtTime() {},
    setTargetAtTime() {},
    cancelScheduledValues() {},
    cancelAndHoldAtTime() {},
  });
  const node = (extra: Record<string, unknown> = {}) => ({
    ...extra,
    connect: (destination: unknown) => destination,
    disconnect() {},
  });
  const source = (extra: Record<string, unknown> = {}) =>
    node({
      ...extra,
      onended: null,
      start() {},
      stop() {
        stops.n += 1;
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

const OPEN_REGISTRY = { register: () => {}, unregister: () => {}, canAllocate: () => true };

const SYNTH: SynthParams = {
  waveform: 'sawtooth',
  cutoff: 3000,
  resonance: 1,
  attack: 0.001,
  decay: 0.2,
  sustain: 0.7,
  release: 0.05,
  volume: 0.5,
  presetName: 'Fuzz',
};

/** The sampler's own sub-axis, from its type rather than from memory. */
const VIEWS: readonly SamplerView[] = ['quick', 'drum', 'multi'];

/**
 * A zone wide enough to answer every pitch the fuzz sends.
 *
 * `loop` is the parameter that decides whether this instrument can hold a note
 * at all, so it is passed in rather than defaulted: see the file comment.
 */
function zoned(view: SamplerView, loop: boolean): SamplerParams {
  const zone: SampleZone = {
    id: 'z1',
    name: 'fuzz',
    mediaId: 'm1',
    keyLo: 0,
    keyHi: 127,
    velLo: 1,
    velHi: 127,
    rootNote: 60,
    keyTrack: true,
    startSec: 0,
    loop,
    loopStartSec: loop ? 0 : undefined,
    loopEndSec: loop ? 1 : undefined,
    reverse: false,
    oneShot: false,
    gain: 1,
    pan: 0,
    tuneCoarse: 0,
    tuneFine: 0,
  };
  return { ...defaultSamplerParams(view), zones: [zone] };
}

interface Built {
  readonly inst: Instrument;
  readonly stops: Stops;
}

interface Case {
  readonly name: string;
  /** The concrete class. This is the axis — not the engine's kind string. */
  readonly cls: string;
  /** Whether this instrument has held state at all. See the file comment. */
  readonly holds: boolean;
  readonly build: () => Built;
}

function samplerCase(view: SamplerView, loop: boolean): Case {
  return {
    name: `sampler ${view}${loop ? ' (looping)' : ' (one-shot by length)'}`,
    cls: 'SamplerInstrument',
    holds: loop,
    build: () => {
      const stops: Stops = { n: 0 };
      const ctx = stubContext(stops);
      const params = zoned(view, loop);
      return {
        inst: new SamplerInstrument(ctx, ctx.createGain!(), 't', () => params, OPEN_REGISTRY),
        stops,
      };
    },
  };
}

function buildCases(): Case[] {
  const cases: Case[] = [
    {
      name: 'synth',
      cls: 'PolySynth',
      holds: true,
      build: () => {
        const stops: Stops = { n: 0 };
        const ctx = stubContext(stops);
        return {
          inst: new PolySynth(ctx, ctx.createGain!(), 't', () => SYNTH, OPEN_REGISTRY),
          stops,
        };
      },
    },
    // The class the kind-string axis hid. A `drum` track without sampler params
    // gets this and not a `PolySynth`.
    {
      name: 'drum kit',
      cls: 'DrumKit',
      holds: false,
      build: () => {
        const stops: Stops = { n: 0 };
        const ctx = stubContext(stops);
        return {
          inst: new DrumKit(ctx, ctx.createGain!(), 't', () => SYNTH, OPEN_REGISTRY),
          stops,
        };
      },
    },
  ];
  for (const view of VIEWS) cases.push(samplerCase(view, true));
  // One non-looping zone, so the half of the sampler's behaviour that cannot
  // stick is still swept rather than assumed.
  cases.push(samplerCase('quick', false));
  // A rack of one of each, because a rack forwards to its children and the
  // failure it can add of its own is forwarding a note-on to more children than
  // it forwards the note-off to.
  cases.push({
    name: 'rack (synth + looping sampler)',
    cls: 'RackInstrument',
    holds: true,
    build: () => {
      const stops: Stops = { n: 0 };
      const ctx = stubContext(stops);
      const out = ctx.createGain!();
      const params = zoned('quick', true);
      // Built once and closed over, which is what `Engine.buildInstrument` does
      // ("child instruments are created once per rack shape"). Building them
      // inside the accessor gives note-on, note-off and the voice count three
      // different objects, and every rack row then passes by holding nothing —
      // because nothing was ever played to the instrument being read.
      const kids = [
        {
          id: 'a',
          keyLo: 0,
          keyHi: 127,
          muted: false,
          solo: false,
          instrument: new PolySynth(ctx, out, 't', () => SYNTH, OPEN_REGISTRY),
        },
        {
          id: 'b',
          keyLo: 0,
          keyHi: 127,
          muted: false,
          solo: false,
          instrument: new SamplerInstrument(ctx, out, 't', () => params, OPEN_REGISTRY),
        },
      ];
      return { inst: new RackInstrument(() => kids), stops };
    },
  });
  return cases;
}

const held = (inst: Instrument): number =>
  (inst as Instrument & { sustainingVoices(): number }).sustainingVoices();

beforeEach(async () => {
  resetMediaCaches();
  // A one-second buffer, so the sampler has something to allocate a voice for.
  // A zone over a media id that resolves to nothing never starts a voice, and
  // an instrument that never starts a voice cannot leave one stuck — every row
  // below would pass having tested nothing.
  await cacheBuffer('m1', {
    duration: 1,
    length: 44100,
    numberOfChannels: 1,
    sampleRate: 44100,
    getChannelData: () => new Float32Array(44100),
  } as unknown as AudioBuffer);
});

/** Every `class X implements Instrument`, read out of the modules that hold them. */
function declaredInstruments(): string[] {
  const found = new Set<string>();
  for (const file of ['src/audio/synth.ts', 'src/audio/samplerInstrument.ts']) {
    const src = readFileSync(join(process.cwd(), file), 'utf8');
    for (const m of src.matchAll(/class\s+(\w+)\s+implements\s+Instrument/g)) found.add(m[1]!);
  }
  return [...found].sort();
}

describe('the instrument axis', () => {
  it('builds every instrument the source declares', () => {
    // The row that would have caught `DrumKit` the first time. Derived rather
    // than listed on purpose: a hard-coded expectation here is the same mistake
    // one level up, and it is the mistake this file already made once.
    expect(new Set(buildCases().map((c) => c.cls))).toEqual(new Set(declaredInstruments()));
  });

  it('covers every sampler view, and both sides of its looping switch', () => {
    const sampler = buildCases().filter((c) => c.cls === 'SamplerInstrument');
    expect(new Set(sampler.filter((c) => c.holds).map((c) => c.name)).size).toBe(VIEWS.length);
    expect(sampler.some((c) => !c.holds)).toBe(true);
  });

  it('has something that holds and something that does not', () => {
    // Both halves must be populated. If everything held, the one-shot rows
    // would never run; if nothing did, the pedal row — the only row that proves
    // the probe can see a stuck note at all — would be skipped everywhere, and
    // the file would pass against an instrument that reports zero always.
    const cases = buildCases();
    expect(cases.some((c) => c.holds)).toBe(true);
    expect(cases.some((c) => !c.holds)).toBe(true);
  });
});

describe.each(buildCases().map((c) => [c.name, c] as const))('%s', (_name, testCase) => {
  it('holds nothing after every note is released', () => {
    const { inst } = testCase.build();
    // A storm rather than a scale: overlapping, repeated and out of order, so a
    // note-off matched to the wrong voice shows up as a survivor. One note at a
    // time would let a wrong match land correctly by accident.
    const pitches = [60, 64, 67, 60, 72, 48, 64, 55, 60, 67];
    for (const p of pitches) inst.noteOn(p, 100);
    for (const p of [...pitches].reverse()) inst.noteOff(p);
    expect(held(inst)).toBe(0);
  });

  it('holds nothing after a panic while notes are down', () => {
    const { inst } = testCase.build();
    for (let p = 36; p < 84; p += 1) inst.noteOn(p, 110);
    inst.allNotesOff();
    expect(held(inst)).toBe(0);
  });

  it('survives a note-off for a note that was never on', () => {
    const { inst } = testCase.build();
    inst.noteOn(60, 100);
    inst.noteOff(61);
    inst.noteOff(60);
    inst.noteOff(60);
    expect(held(inst)).toBe(0);
  });

  it.runIf(testCase.holds)('releases what the pedal held, when the pedal lifts', () => {
    const { inst } = testCase.build();
    inst.setSustain(true);
    for (const p of [60, 64, 67]) inst.noteOn(p, 100);
    for (const p of [60, 64, 67]) inst.noteOff(p);
    // The row that proves the probe can see a stuck note at all. Without it, an
    // instrument that reported zero unconditionally would pass everything above.
    expect(held(inst)).toBeGreaterThan(0);
    inst.setSustain(false);
    expect(held(inst)).toBe(0);
  });

  it.runIf(!testCase.holds)('cannot stick, and still stops everything on a panic', () => {
    // This instrument's zero is structural rather than measured, so the pedal
    // row above says nothing about it. What is still worth asserting is that a
    // panic reaches every voice it started: a hit ringing through a stop is the
    // same bug wearing a different coat.
    //
    // Counted as `stop()` calls rather than by watching the active set empty,
    // because that set is emptied from `onended` and nothing fires it here —
    // the offline-retirement trap `tests/voices.test.ts` documents. Asserting
    // on the set would be measuring the stub.
    const { inst, stops } = testCase.build();
    inst.setSustain(true);
    const hits = 16;
    for (let p = 36; p < 36 + hits; p += 1) inst.noteOn(p, 110);
    for (let p = 36; p < 36 + hits; p += 1) inst.noteOff(p);
    expect(held(inst)).toBe(0);
    const before = stops.n;
    inst.allNotesOff();
    expect(stops.n - before).toBeGreaterThanOrEqual(hits);
  });
});
