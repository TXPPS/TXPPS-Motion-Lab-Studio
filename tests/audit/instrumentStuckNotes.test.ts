/**
 * BUG-005 — the other half of the guarantee, at the engine.
 *
 * The input-layer fuzz (`tests/heldNotes.test.ts`) proves every note-on gets a
 * matching note-off dispatched. That is necessary and not sufficient: an
 * instrument that receives note-off and keeps a voice alive is the same stuck
 * note with a different cause. Directive 03 §1 asks for the fuzz "against every
 * instrument, not just the one that reproduced", and §3 makes it DoD item 14
 * for every instrument built from here on.
 *
 * The measure needs care. `activeVoices()` counts what is in the allocation
 * set, and under the probe context a *correctly released* voice stays in it:
 * `onended` never fires without a real graph and `currentTime` never advances,
 * so nothing retires. Asserting that count is zero here would be asserting that
 * jsdom runs an audio thread. It does not, and a test that says otherwise is
 * measuring the harness.
 *
 * `allNotesOff` writing something is no good as a measure either, for the same
 * reason: it re-stops the released-but-not-yet-retired voices, so it writes for
 * any voice ever played.
 *
 * What *is* exactly the thing is `sustainingVoices()` — voices with no
 * scheduled end. A voice whose release was never scheduled sustains until
 * panic, which is BUG-005 in one number, and it is independent of whether
 * anything has retired. That is what these assert, and it is why the
 * instruments grew that probe rather than the test settling for a proxy.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { PolySynth, DrumKit } from '../../src/audio/synth';
import type { ActiveHandle, Instrument, SourceRegistry } from '../../src/audio/synth';
import { SamplerInstrument, RackInstrument } from '../../src/audio/samplerInstrument';
import { SYNTH_PRESETS, DRUM_KIT_PARAMS } from '../../src/model/presets';
import { defaultSamplerParams, makeZone } from '../../src/model/sampler';
import type { SamplerParams } from '../../src/model/sampler';
import type { SynthParams } from '../../src/model/types';
import { cacheBuffer, resetMediaCaches } from '../../src/audio/mediaLibrary';
import { createProbeContext } from './probeContext';

function registry(): SourceRegistry {
  const live = new Set<ActiveHandle>();
  return {
    register: (h) => live.add(h),
    unregister: (h) => live.delete(h),
    canAllocate: () => true,
  };
}

/** The deterministic generator the rest of the suite uses. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PATCH: SynthParams = { ...SYNTH_PRESETS[0] };

/** An instrument, its voice count, and the probe recording what it writes. */
interface Subject {
  name: string;
  inst: Instrument & { activeVoices(): number; sustainingVoices(): number };
  probe: ReturnType<typeof createProbeContext>;
}


/**
 * Every instrument the engine can build, each with whatever it needs to
 * actually make voices, and each able to say how many it holds. Built fresh per
 * call so one test's leftovers cannot pass for another's.
 */
function subjects(): Subject[] {
  // A *looping* zone on purpose. A non-looping sample schedules its own end at
  // spawn — it runs the window out whatever happens — so it cannot sustain
  // indefinitely and cannot be the stuck note this is hunting. The looped voice
  // is the one that plays until something releases it, which makes it the only
  // sampler case worth fuzzing here.
  const samplerParams: SamplerParams = {
    ...defaultSamplerParams('quick'),
    zones: [makeZone({ mediaId: 'm-stuck', rootNote: 60, loop: true, oneShot: false })],
  };
  const probe = createProbeContext();
  const out = probe.ctx.createGain();
  const synth = new PolySynth(probe.ctx, out, 't1', () => PATCH, registry());
  const sampler = new SamplerInstrument(probe.ctx, out, 't1', () => samplerParams, registry());
  const drums = new DrumKit(probe.ctx, out, 't1', () => DRUM_KIT_PARAMS, registry());
  // A rack holds no voices of its own; it is included because the track's
  // instrument *is* the rack, so a stuck note reaches the user through it.
  const rackChild = new PolySynth(probe.ctx, out, 't2', () => PATCH, registry());
  const rack = new RackInstrument(() => [
    { id: 'c1', keyLo: 0, keyHi: 127, muted: false, solo: false, instrument: rackChild },
  ]);
  return [
    { name: 'PolySynth', inst: synth, probe },
    { name: 'SamplerInstrument', inst: sampler, probe },
    { name: 'DrumKit', inst: drums, probe },
    { name: 'RackInstrument', inst: rack, probe },
  ];
}

beforeEach(() => {
  resetMediaCaches();
  cacheBuffer('m-stuck', new AudioBuffer({ numberOfChannels: 2, length: 48000, sampleRate: 48000 }));
});

describe('BUG-005 · no instrument keeps a voice after its note-off', () => {
  for (const { name } of subjects()) {
    it(`${name} holds nothing after 2,000 randomised on/off pairs`, () => {
      const subject = subjects().find((s) => s.name === name)!;
      const { inst } = subject;
      const rand = seeded(0xbeef);
      const down = new Set<number>();
      for (let i = 0; i < 2000; i++) {
        const pitch = 36 + Math.floor(rand() * 48);
        if (rand() < 0.5) {
          inst.noteOn(pitch, 100);
          down.add(pitch);
        } else {
          inst.noteOff(pitch);
          down.delete(pitch);
        }
      }
      for (const pitch of down) inst.noteOff(pitch);

      const heldAfterPlay = inst.sustainingVoices();
      console.log(
        `${name}: 2000 events, ${down.size} trailing note-offs → ` +
          `${heldAfterPlay} sustaining, ${inst.activeVoices()} still in the set`,
      );
      expect(
        heldAfterPlay,
        `${name}: voices with no scheduled end — these are the stuck notes`,
      ).toBe(0);

      // And panic, which is the safety net, must therefore have no *held* voice
      // to find. It may still re-stop tails that have not retired; what it may
      // not do is discover something that was never released.
      inst.allNotesOff();
      expect(inst.sustainingVoices(), name).toBe(0);
      inst.dispose();
    });
  }

  it('a released note is not resurrected by a later note-off for the same pitch', () => {
    // Double note-off is normal — the key's own pointerup and the window's both
    // arrive. It must not start anything or throw.
    const probe = createProbeContext();
    const synth = new PolySynth(probe.ctx, probe.ctx.createGain(), 't1', () => PATCH, registry());
    synth.noteOn(60, 100);
    synth.noteOff(60);
    probe.clear();
    synth.noteOff(60);
    synth.noteOff(60);
    const started = probe.writes.filter((w) => /\.start$/.test(w.path));
    expect(started).toEqual([]);
    synth.dispose();
  });

  it('a re-pressed pitch does not orphan the voice already sounding it', () => {
    // Candidate 6 in the directive's list: a second note-on on a live pitch
    // overwriting the stored reference, leaving the first oscillator with no
    // handle able to stop it. One note-off must leave nothing sounding.
    const probe = createProbeContext();
    const synth = new PolySynth(probe.ctx, probe.ctx.createGain(), 't1', () => PATCH, registry());
    synth.noteOn(60, 100);
    synth.noteOn(60, 100);
    synth.noteOn(60, 100);
    synth.noteOff(60);
    expect(synth.sustainingVoices(), 'a re-pressed pitch orphaned a voice').toBe(0);
    synth.dispose();
  });

  it('counts a held note as held, so the assertion above is not vacuous', () => {
    // If `sustainingVoices` were zero whatever happened, every test here would
    // pass while proving nothing. Notes that are pressed and not released must
    // register, and panic must clear them.
    for (const { name, inst } of subjects()) {
      for (let p = 48; p < 60; p++) inst.noteOn(p, 100);
      const expected = name === 'DrumKit' ? 0 : 12;
      expect(inst.sustainingVoices(), `${name} did not count held notes`).toBe(expected);
      inst.allNotesOff();
      expect(inst.sustainingVoices(), `${name} ignored panic`).toBe(0);
      inst.dispose();
    }
  });

  it('transport stop clears everything still held', () => {
    for (const { name, inst } of subjects()) {
      for (let p = 48; p < 60; p++) inst.noteOn(p, 100);
      inst.allNotesOff();
      expect(inst.sustainingVoices(), name).toBe(0);
      inst.dispose();
    }
  });
});
