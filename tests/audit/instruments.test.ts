/**
 * PA probe 6 — the instruments: polyphony, note-off, presets and tuning.
 *
 * `PolySynth`, `SamplerInstrument`, `DrumKit` and `RackInstrument` are driven
 * against the recording context, which is enough to count voices, see what each
 * one is told to stop and when, and read the frequency and playback rate each
 * one is assigned. Timbre is not auditioned — nothing here renders. What *is*
 * auditioned per factory preset is its level, through `ampEnvelopeGain`, which
 * is the Web Audio automation arithmetic rather than an approximation of it, so
 * a preset that would come out silent can be found without a renderer.
 */
import { describe, expect, it } from 'vitest';
import { PolySynth, DrumKit } from '../../src/audio/synth';
import type { ActiveHandle, SourceRegistry } from '../../src/audio/synth';
import { SamplerInstrument, RackInstrument } from '../../src/audio/samplerInstrument';
import { SYNTH_PRESETS, DRUM_KIT_PARAMS } from '../../src/model/presets';
import {
  ampEnvelopeGain,
  synthAmpEnvelope,
  synthVoiceFilter,
  filterResponseDb,
  suggestedHoldSec,
} from '../../src/model/synthFace';
import { midiToFreq } from '../../src/model/music';
import {
  defaultSamplerParams,
  makeZone,
  validateSampler,
  zonePlaybackRate,
} from '../../src/model/sampler';
import type { SamplerParams } from '../../src/model/sampler';
import type { SynthParams } from '../../src/model/types';
import { validateProject } from '../../src/persistence/projectRepo';
import { createDemoProject } from '../../src/model/demoProject';
import { cacheBuffer, resetMediaCaches } from '../../src/audio/mediaLibrary';
import { createProbeContext } from './probeContext';

function countingRegistry(): SourceRegistry & { live: Set<ActiveHandle>; peak: number } {
  const live = new Set<ActiveHandle>();
  const r = {
    live,
    peak: 0,
    register: (h: ActiveHandle) => {
      live.add(h);
      r.peak = Math.max(r.peak, live.size);
    },
    unregister: (h: ActiveHandle) => live.delete(h),
    // Uncapped on purpose: the engine's global cap of 128 would mask whether
    // the instrument enforces its own ceiling, which is what is being measured.
    canAllocate: () => true,
  };
  return r;
}

const PATCH: SynthParams = { ...SYNTH_PRESETS[0] };

describe('PA-003 · polyphony and voice stealing', () => {
  it('needs to steal nothing when notes are spaced far enough apart to retire', () => {
    const probe = createProbeContext();
    const reg = countingRegistry();
    const out = probe.ctx.createGain();
    const synth = new PolySynth(probe.ctx, out, 't1', () => PATCH, reg);
    // Four-second notes half a second apart: `retireBy` drops each voice about
    // eleven notes after it started, so the set never reaches the ceiling.
    for (let i = 0; i < 60; i++) synth.scheduleNote(40 + (i % 40), 100, i * 0.5, 4);
    const steals = probe.writes.filter((w) => w.how === 'cancel');
    console.log(`60 staggered notes → ${steals.length} voices cut short`);
    expect(steals.length).toBe(0);
  });

  it('does not hold the synth to 24 voices when the notes share a start time', () => {
    const probe = createProbeContext();
    const reg = countingRegistry();
    const out = probe.ctx.createGain();
    const synth = new PolySynth(probe.ctx, out, 't1', () => PATCH, reg);
    // One `when` for every note, which is what a dense chord, a strummed guitar
    // part quantised hard, or a MIDI file with a stacked orchestral hit gives
    // the scheduler.
    for (let i = 0; i < 60; i++) synth.scheduleNote(40 + i, 100, 1, 4);
    const cut = new Set(probe.writes.filter((w) => w.how === 'cancel').map((w) => w.path));
    const built = new Set(
      probe.writes.filter((w) => /^oscillator#\d+\.start$/.test(w.path)).map((w) => w.path),
    );
    console.log(
      `60 notes at one instant → ${built.size} oscillators started, ` +
        `${cut.size} voice(s) cut short (the cap is 24 voices)`,
    );
    expect(cut.size).toBe(1);
  });

  it('does not hold the sampler to its stated 48 voices either', () => {
    resetMediaCaches();
    // A one-second stereo buffer, so `spawn` gets past `getBufferSync` and
    // actually builds voices. The stub `AudioBuffer` in `tests/setup.ts` is
    // enough: nothing here reads a sample.
    cacheBuffer(
      'm-sampler',
      new AudioBuffer({ numberOfChannels: 2, length: 48000, sampleRate: 48000 }),
    );
    const probe = createProbeContext();
    const reg = countingRegistry();
    const out = probe.ctx.createGain();
    const p: SamplerParams = {
      ...defaultSamplerParams('quick'),
      zones: [makeZone({ mediaId: 'm-sampler', rootNote: 60 })],
    };
    const sampler = new SamplerInstrument(probe.ctx, out, 't1', () => p, reg);
    for (let i = 0; i < 80; i++) sampler.scheduleNote(60 + (i % 24), 100, 1, 4);
    // The steal itself cannot be counted here the way it can on the synth: a
    // sampler voice's ordinary `release` also cancels before it ramps, so a
    // cancel no longer separates the two. What the voice set says is enough —
    // eighty voices are live against a ceiling of forty-eight.
    console.log(
      `80 sampler notes at one instant → ${sampler.activeVoices()} live voices ` +
        `(the cap is 48)`,
    );
    expect(sampler.activeVoices()).toBe(80);
    resetMediaCaches();
  });

  it('steals the same voice repeatedly instead of the next oldest', () => {
    // The mechanism behind the row above, isolated: `spawn` picks the voice with
    // the smallest `startedAt`, stops it, and leaves it in the set. Stopping is
    // not removing, so the next spawn finds the same voice and stops it again.
    const probe = createProbeContext();
    const reg = countingRegistry();
    const out = probe.ctx.createGain();
    const synth = new PolySynth(probe.ctx, out, 't1', () => PATCH, reg);
    for (let i = 0; i < 30; i++) synth.scheduleNote(40 + i, 100, 1, 4);
    // A steal is the one place a voice's gain is cancelled before being ramped
    // down; a release ramps without cancelling. If stealing rotated, six
    // different voices would carry six cancels between them.
    const cancels = probe.writes.filter((w) => w.how === 'cancel');
    const paths = new Set(cancels.map((w) => w.path));
    console.log(
      `30 simultaneous notes, cap 24 → ${cancels.length} steals landing on ${paths.size} voice(s)`,
    );
    expect(cancels.length).toBe(6);
    expect(paths.size).toBe(1);
  });
});

describe('PA · all-notes-off and transport stop', () => {
  it('stops every synth voice and forgets the glide origin', () => {
    const probe = createProbeContext();
    const reg = countingRegistry();
    const out = probe.ctx.createGain();
    const synth = new PolySynth(probe.ctx, out, 't1', () => PATCH, reg);
    for (let i = 0; i < 8; i++) synth.noteOn(60 + i, 100);
    probe.clear();
    synth.allNotesOff();
    const stops = probe.writes.filter((w) => w.how === 'setTarget' && w.value === 0);
    expect(stops.length).toBeGreaterThanOrEqual(8);
    // A second all-notes-off must be idle: nothing is still holding a voice.
    probe.clear();
    synth.noteOff(60);
    expect(probe.writes.length).toBe(0);
  });

  it('stops every drum hit', () => {
    const probe = createProbeContext();
    const reg = countingRegistry();
    const out = probe.ctx.createGain();
    const kit = new DrumKit(probe.ctx, out, 't1', () => DRUM_KIT_PARAMS, reg);
    for (const pitch of [36, 38, 42]) kit.noteOn(pitch, 110);
    probe.clear();
    kit.allNotesOff();
    const stops = probe.writes.filter((w) => w.how === 'setTarget' && w.value === 0);
    expect(stops.length).toBe(3);
  });

  it('passes all-notes-off to every rack child, muted or not', () => {
    const calls: string[] = [];
    const child = (id: string) => ({
      id,
      keyLo: 0,
      keyHi: 127,
      muted: id === 'b',
      solo: false,
      instrument: {
        scheduleNote: () => {},
        noteOn: () => {},
        noteOff: () => {},
        setSustain: () => {},
        allNotesOff: () => calls.push(id),
        dispose: () => {},
      },
    });
    const rack = new RackInstrument(() => [child('a'), child('b')]);
    rack.allNotesOff();
    expect(calls).toEqual(['a', 'b']);
  });
});

describe('PA · factory presets audition', () => {
  it('gives every synth preset a level a listener would hear', () => {
    const rows: string[] = [];
    for (const preset of SYNTH_PRESETS) {
      const env = synthAmpEnvelope(preset, 100);
      const hold = suggestedHoldSec(env);
      let peak = 0;
      let sum = 0;
      const steps = 2000;
      const span = hold + env.tailSec;
      for (let i = 0; i <= steps; i++) {
        const g = ampEnvelopeGain(env, (i / steps) * span, hold);
        expect(Number.isFinite(g), `${preset.presetName} envelope`).toBe(true);
        peak = Math.max(peak, g);
        sum += g * g;
      }
      const rms = Math.sqrt(sum / (steps + 1));
      // The filter is the other half of "is it audible": a lowpass parked below
      // the note's own fundamental is a preset that plays nothing.
      const filter = synthVoiceFilter(preset, 60);
      const atC4 = filterResponseDb(filter, [midiToFreq(60)])[0];
      rows.push(
        `${preset.presetName.padEnd(14)} peak ${(20 * Math.log10(peak)).toFixed(1)} dBFS, ` +
          `rms ${(20 * Math.log10(rms)).toFixed(1)} dBFS, filter at C4 ${atC4.toFixed(1)} dB`,
      );
      expect(peak, preset.presetName).toBeGreaterThan(0.05);
      expect(rms, preset.presetName).toBeGreaterThan(0.005);
      expect(atC4, preset.presetName).toBeGreaterThan(-24);
    }
    console.log(`Synth factory presets (velocity 100, C4):\n  ${rows.join('\n  ')}`);
  });

  it('builds a voice for every preset without throwing, and starts every source', () => {
    for (const preset of SYNTH_PRESETS) {
      const probe = createProbeContext();
      const reg = countingRegistry();
      const out = probe.ctx.createGain();
      const synth = new PolySynth(probe.ctx, out, 't1', () => preset, reg);
      expect(() => synth.scheduleNote(60, 100, 0.5, 1), preset.presetName).not.toThrow();
      expect(() => synth.scheduleNote(67, 100, 0.7, 1), preset.presetName).not.toThrow();
      const nonFinite = probe.writes.filter(
        (w) => typeof w.value === 'number' && !Number.isFinite(w.value),
      );
      expect(nonFinite, preset.presetName).toEqual([]);
      const starts = probe.writes.filter((w) => w.path.endsWith('.start'));
      expect(starts.length, preset.presetName).toBeGreaterThan(0);
      synth.dispose();
    }
  });
});

describe('PA · tuning and transpose against a reference pitch', () => {
  it('puts the synth oscillator on the equal-tempered frequency of the key', () => {
    for (const pitch of [21, 45, 60, 69, 96, 108]) {
      const probe = createProbeContext();
      const reg = countingRegistry();
      const out = probe.ctx.createGain();
      const synth = new PolySynth(probe.ctx, out, 't1', () => PATCH, reg);
      synth.scheduleNote(pitch, 100, 0, 1);
      const assigned = probe.writes.filter((w) => /oscillator#\d+\.frequency/.test(w.path));
      expect(assigned.length, `pitch ${pitch}`).toBeGreaterThan(0);
      const hz = assigned[0].value as number;
      const cents = 1200 * Math.log2(hz / midiToFreq(pitch));
      expect(Math.abs(cents), `pitch ${pitch} is ${cents} cents out`).toBeLessThan(1e-9);
      synth.dispose();
    }
    // A = 440 by construction, so the whole scale is anchored there.
    expect(midiToFreq(69)).toBe(440);
  });

  it('transposes a sampler zone by root note, key tracking and tune, exactly', () => {
    const zone = makeZone({ mediaId: 'm', rootNote: 60 });
    expect(zonePlaybackRate(zone, 60)).toBeCloseTo(1, 12);
    expect(zonePlaybackRate(zone, 72)).toBeCloseTo(2, 12);
    expect(zonePlaybackRate(zone, 48)).toBeCloseTo(0.5, 12);
    expect(zonePlaybackRate({ ...zone, keyTrack: false }, 72)).toBeCloseTo(1, 12);
    expect(zonePlaybackRate({ ...zone, tuneCoarse: 7 }, 60)).toBeCloseTo(Math.pow(2, 7 / 12), 12);
    expect(zonePlaybackRate({ ...zone, tuneFine: 50 }, 60)).toBeCloseTo(Math.pow(2, 0.5 / 12), 12);
    // A quarter-tone up, expressed in cents, is a quarter-tone up.
    const cents = 1200 * Math.log2(zonePlaybackRate({ ...zone, tuneFine: 50 }, 60));
    expect(cents).toBeCloseTo(50, 9);
  });
});

describe('PA-007 · a non-finite instrument parameter reaches the node unguarded', () => {
  it('carries a NaN cutoff all the way to the value the voice assigns', () => {
    // `normaliseParams` clamps every insert parameter on load and `setParam`
    // refuses a non-finite write; neither guard covers `track.synth`, which
    // `validateProject` copies through untouched. This is the value the voice
    // hands `filter.frequency`.
    const broken: SynthParams = { ...PATCH, cutoff: NaN };
    expect(Number.isFinite(synthVoiceFilter(broken, 60).freqHz)).toBe(false);
    const infinite: SynthParams = { ...PATCH, resonance: Infinity };
    console.log(
      `synthVoiceFilter with cutoff NaN → freqHz ${synthVoiceFilter(broken, 60).freqHz}; ` +
        `with resonance Infinity → qDb ${synthVoiceFilter(infinite, 60).qDb}`,
    );
    // Infinity is clamped by `clamp`'s comparison; NaN is not, and that is the
    // asymmetry: one of the two is caught by accident rather than by design.
    expect(synthVoiceFilter(infinite, 60).qDb).toBe(24);
  });

  it('carries a NaN volume into the envelope the voice schedules', () => {
    const env = synthAmpEnvelope({ ...PATCH, volume: NaN }, 100);
    expect(Number.isFinite(env.peak)).toBe(false);
    expect(Number.isFinite(ampEnvelopeGain(env, 0.1, 1))).toBe(false);
  });
});

describe('PA · instrument preset round-trip', () => {
  it('reloads every synth factory preset field for field', () => {
    const base = createDemoProject('p-synth');
    const track = base.tracks.find((t) => t.type === 'instrument');
    expect(track).toBeTruthy();
    for (const preset of SYNTH_PRESETS) {
      const project = {
        ...base,
        tracks: base.tracks.map((t) => (t.id === track!.id ? { ...t, synth: { ...preset } } : t)),
      };
      const back = validateProject(JSON.parse(JSON.stringify(project)));
      const reloaded = back.tracks.find((t) => t.id === track!.id)?.synth;
      expect(reloaded, preset.presetName).toEqual(preset);
    }
  });

  it('reloads a synth patch with a non-finite field as a patch with a missing field', () => {
    // `validateProject` normalises through JSON first, and JSON has no NaN — it
    // becomes null. Nothing then clamps or drops it, so the field arrives at the
    // voice as `null`, which is not a number and not the default either.
    const base = createDemoProject('p-nan');
    const track = base.tracks.find((t) => t.type === 'instrument')!;
    const project = {
      ...base,
      tracks: base.tracks.map((t) =>
        t.id === track.id ? { ...t, synth: { ...SYNTH_PRESETS[0], cutoff: NaN } } : t,
      ),
    };
    const back = validateProject(JSON.parse(JSON.stringify(project)));
    const reloaded = back.tracks.find((t) => t.id === track.id)?.synth as unknown as Record<
      string,
      unknown
    >;
    console.log(`a NaN cutoff reloads as ${JSON.stringify(reloaded.cutoff)}`);
    expect(reloaded.cutoff).toBe(null);
    // And that is what `synthVoiceFilter` multiplies by the key-track factor.
    const filter = synthVoiceFilter(reloaded as unknown as SynthParams, 60);
    expect(filter.freqHz).toBe(40);
  });
});

describe('PA · sampler and drum-rack state round-trip', () => {
  it('reloads a sampler patch in all three views, zones and all', () => {
    const base = createDemoProject('p-smp');
    const track = base.tracks.find((t) => t.type === 'instrument')!;
    for (const view of ['quick', 'drum', 'multi'] as const) {
      const sampler: SamplerParams = {
        ...defaultSamplerParams(view),
        filterType: 'lowpass',
        filterCutoff: 4321.5,
        filterRes: 6.25,
        lfoTarget: 'pitch',
        lfoRate: 3.75,
        lfoDepth: 0.42,
        zones: [
          makeZone({ mediaId: 'hit-kick', rootNote: 36, keyLo: 36, keyHi: 36, tuneFine: -17 }),
          makeZone({ mediaId: 'hit-snare', rootNote: 38, keyLo: 38, keyHi: 40, chokeGroup: 1 }),
        ],
      };
      const project = {
        ...base,
        tracks: base.tracks.map((t) => (t.id === track.id ? { ...t, sampler } : t)),
      };
      const back = validateProject(JSON.parse(JSON.stringify(project)));
      const reloaded = back.tracks.find((t) => t.id === track.id)?.sampler;
      expect(reloaded, view).toEqual(sampler);
      // And the validator is a fixpoint, so a second save cannot drift.
      expect(validateSampler(JSON.parse(JSON.stringify(reloaded))), view).toEqual(reloaded);
    }
  });
});
