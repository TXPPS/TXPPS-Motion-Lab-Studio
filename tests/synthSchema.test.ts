import { describe, expect, it } from 'vitest';
import { PolySynth } from '../src/audio/synth';
import { makePoint } from '../src/model/automation';
import { findAutoParam, listAutoParams } from '../src/model/paramRegistry';
import { SYNTH_PRESETS } from '../src/model/presets';
import { synthLfoOf, synthOscillatorOf, synthSubOf } from '../src/model/synthFace';
import { SCHEMA_VERSION } from '../src/model/types';
import type { ProjectData, SynthParams, Track } from '../src/model/types';
import { validateProject } from '../src/persistence/projectRepo';

/**
 * The oscillator morph, the sub, the portamento and the LFO were added to
 * `SynthParams` without touching `SCHEMA_VERSION`, and this is the file that
 * has to earn that.
 *
 * The claim being made is narrow and checkable: every new field is optional,
 * and every absent field means the voice builds *nothing* — no delay line, no
 * second oscillator, no modulator, no pitch ramp. So a project written before
 * any of it existed is already a valid project now, it comes back off the load
 * path with its patch untouched, and the graph its notes build is the graph
 * they built before. A version bump would have bought nothing and cost every
 * project saved by this build the ability to open in an older one.
 *
 * `tests/synthFace.test.ts` proves the graph half against the real voice
 * engine; this file proves the storage half, and then proves the two agree by
 * playing a note through a patch that has been round-tripped and one that has
 * not, and comparing what the graph was told.
 */

/** A patch exactly as a project written before this change holds one. */
function legacyPatch(): Record<string, unknown> {
  return {
    presetName: 'Warm Keys',
    waveform: 'triangle',
    cutoff: 3800,
    resonance: 0.8,
    attack: 0.012,
    decay: 0.35,
    sustain: 0.45,
    release: 0.5,
    volume: 0.55,
  };
}

function projectWith(synth: Record<string, unknown>, version = SCHEMA_VERSION): ProjectData {
  return {
    schemaVersion: version,
    id: 'p-syn',
    name: 'Synth Schema',
    bpm: 120,
    timeSig: { num: 4, den: 4 },
    loop: { enabled: false, start: 0, end: 16 },
    createdAt: 1,
    modifiedAt: 2,
    tracks: [
      {
        id: 't1',
        type: 'instrument',
        name: 'Keys',
        color: '#888888',
        volume: 1,
        pan: 0,
        mute: false,
        solo: false,
        armed: false,
        collapsed: false,
        output: 'master',
        synth,
      },
    ],
    clips: [],
  } as unknown as ProjectData;
}

const load = (raw: ProjectData): Track =>
  validateProject(JSON.parse(JSON.stringify(raw))).tracks[0];

// ------------------------------------------------------- what a voice is told

interface Told {
  oscillators: { type: string; frequency: number; automation: number }[];
  delays: number[];
  gains: number[];
  filters: { type: string; frequency: number; q: number }[];
  /** Automation calls on the amplifier, which is where the envelope lands. */
  ampCalls: { method: string; value: number; time: number; tau: number }[];
}

interface Stub {
  value: number;
  calls: { method: string; value: number; time: number; tau: number }[];
}

/**
 * Play one note through the real voice engine and record every number it
 * assigns. Two patches that produce the same record produce the same sound:
 * nothing in `Voice` decides anything after these values are written.
 */
function told(params: SynthParams, pitch = 60): Told {
  const gains: Stub[] = [];
  const delays: Stub[] = [];
  const filters: { type: string; frequency: Stub; Q: Stub }[] = [];
  const oscillators: { type: string; frequency: Stub; detune: Stub }[] = [];

  const param = (): Stub => {
    const p: Stub = { value: 0, calls: [] };
    return Object.assign(p, {
      setValueAtTime: (v: number, t: number) =>
        p.calls.push({ method: 'set', value: v, time: t, tau: 0 }),
      linearRampToValueAtTime: (v: number, t: number) =>
        p.calls.push({ method: 'ramp', value: v, time: t, tau: 0 }),
      exponentialRampToValueAtTime: (v: number, t: number) =>
        p.calls.push({ method: 'exp', value: v, time: t, tau: 0 }),
      setTargetAtTime: (v: number, t: number, tau: number) =>
        p.calls.push({ method: 'target', value: v, time: t, tau }),
      cancelScheduledValues: () => {},
    });
  };
  const wire = <T extends object>(node: T): T =>
    Object.assign(node, { connect: (d: unknown) => d, disconnect() {} });

  const ctx = {
    sampleRate: 48000,
    currentTime: 0,
    createGain: () => {
      const gain = param();
      gains.push(gain);
      return wire({ gain });
    },
    createBiquadFilter: () => {
      const f = { type: 'lowpass', frequency: param(), Q: param() };
      filters.push(f);
      return wire(f);
    },
    createDelay: () => {
      const d = { delayTime: param() };
      delays.push(d.delayTime);
      return wire(d);
    },
    createOscillator: () => {
      const o = { type: 'sine', frequency: param(), detune: param() };
      oscillators.push(o);
      return wire(Object.assign(o, { onended: null, start() {}, stop() {} }));
    },
  } as unknown as BaseAudioContext;

  const bus = ctx.createGain();
  gains.length = 0; // the output bus is not part of the voice
  new PolySynth(ctx, bus, 't1', () => params, {
    register: () => {},
    unregister: () => {},
    canAllocate: () => true,
  }).scheduleNote(pitch, 100, 0, 0.5);

  return {
    oscillators: oscillators.map((o) => ({
      type: o.type,
      frequency: o.frequency.value,
      automation: o.frequency.calls.length,
    })),
    delays: delays.map((d) => d.value),
    gains: gains.map((g) => g.value),
    filters: filters.map((f) => ({ type: f.type, frequency: f.frequency.value, q: f.Q.value })),
    // The amplifier is the gain the envelope is written to, which is the only
    // one a voice automates — identifying it by its calls rather than by its
    // place in the list keeps this working whatever else the voice builds.
    ampCalls: gains.find((g) => g.calls.length > 0)?.calls ?? [],
  };
}

describe('a project written before the morph, the sub and the LFO', () => {
  it('loads with its patch byte for byte, gaining no fields it did not have', () => {
    const before = legacyPatch();
    const after = load(projectWith(before)).synth as unknown as Record<string, unknown>;
    expect(after).toEqual(before);
    expect(Object.keys(after).sort()).toEqual(Object.keys(before).sort());
    for (const key of ['shape', 'pulseWidth', 'subLevel', 'glide', 'lfoRate']) {
      expect(after, key).not.toHaveProperty(key);
    }
  });

  it('loads the same way when it is stamped at an older version', () => {
    // The load path is a fixpoint for this patch at every version it could
    // have been written at, because nothing about the synth changed shape.
    for (const version of [1, 5, 6, SCHEMA_VERSION]) {
      expect(load(projectWith(legacyPatch(), version)).synth).toEqual(legacyPatch());
    }
  });

  it('and the voice it builds is the voice it always built', () => {
    const loaded = load(projectWith(legacyPatch())).synth!;
    expect(told(loaded)).toEqual(told(legacyPatch() as unknown as SynthParams));

    // Which is: one oscillator of its own waveform, one filter, one amplifier,
    // and no delay line, no sub, no modulator and no pitch automation anywhere.
    const graph = told(loaded);
    expect(graph.oscillators).toHaveLength(1);
    expect(graph.oscillators[0].type).toBe('triangle');
    expect(graph.oscillators[0].automation).toBe(0);
    expect(graph.delays).toEqual([]);
    expect(graph.gains).toHaveLength(1);
    expect(synthOscillatorOf(loaded).morph).toBeNull();
    expect(synthSubOf(loaded)).toBeNull();
    expect(synthLfoOf(loaded)).toBeNull();
  });

  it('is unchanged by every stock preset that predates the new voice', () => {
    // The six original patches are stored in projects that already exist, so a
    // change to any of them is a change to a sound somebody has made.
    for (const name of [
      'Warm Keys',
      'Deep Saw Bass',
      'Sine Lead',
      'Bright Pluck',
      'Soft Pad',
      'Acid Squelch',
    ]) {
      const preset = SYNTH_PRESETS.find((p) => p.presetName === name)!;
      expect(preset, name).toBeDefined();
      for (const key of ['shape', 'pulseWidth', 'subLevel', 'glide', 'lfoRate', 'lfoToPitch']) {
        expect(preset, `${name}.${key}`).not.toHaveProperty(key);
      }
      expect(told(preset).delays, name).toEqual([]);
      expect(told(preset).oscillators, name).toHaveLength(1);
    }
  });
});

describe('a project written with the new voice', () => {
  const modern: SynthParams = {
    ...SYNTH_PRESETS[0],
    presetName: 'Modern',
    waveform: 'sawtooth',
    shape: 0.6,
    pulseWidth: 0.35,
    subLevel: 0.4,
    glide: 0.12,
    lfoRate: 2.5,
    lfoToPitch: 0.2,
    lfoToFilter: 0.3,
    lfoToWidth: 0.5,
  };

  it('keeps every field through the load path', () => {
    expect(load(projectWith(modern as unknown as Record<string, unknown>)).synth).toEqual(modern);
  });

  it('and builds the same voice after a round trip as before one', () => {
    const loaded = load(projectWith(modern as unknown as Record<string, unknown>)).synth!;
    expect(told(loaded)).toEqual(told(modern));
    // Not a vacuous comparison: this patch really does build the extra nodes.
    expect(told(modern).delays).toHaveLength(1);
    expect(told(modern).oscillators).toHaveLength(3);
  });

  it('keeps automation drawn on the new parameters, which the load path could have dropped', () => {
    const raw = projectWith(modern as unknown as Record<string, unknown>);
    const ids = listAutoParams(raw.tracks[0], raw).map((p) => p.id);
    const added = [
      'synth:shape',
      'synth:pulseWidth',
      'synth:subLevel',
      'synth:lfoRate',
      'synth:lfoToPitch',
      'synth:lfoToFilter',
      'synth:lfoToWidth',
    ];
    for (const id of added) expect(ids, id).toContain(id);

    raw.tracks[0].automation = added.map((paramId, i) => ({
      id: `al-${i}`,
      paramId,
      points: [makePoint(0, 0.25)],
      enabled: true,
    }));
    const kept = load(raw).automation;
    expect(kept?.map((l) => l.paramId)).toEqual(added);
    // And each one still resolves to a descriptor, so its row can be drawn.
    for (const id of added) expect(findAutoParam(load(raw), raw, id), id).toBeDefined();
  });
});
