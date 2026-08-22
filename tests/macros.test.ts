import { describe, expect, it } from 'vitest';
import {
  createMacro,
  describeMacro,
  hasTarget,
  macroWrites,
  targetNorm,
} from '../src/model/macros';
import { useProjectStore } from '../src/state/projectStore';
import type { ProjectData, Track } from '../src/model/types';

function project(tracks: Track[]): ProjectData {
  return {
    schemaVersion: 6,
    id: 'p',
    name: 'p',
    createdAt: 0,
    modifiedAt: 0,
    bpm: 120,
    timeSig: { num: 4, den: 4 },
    loop: { enabled: false, start: 0, end: 16 },
    metronome: false,
    masterVolume: 1,
    tracks,
    clips: [],
    workspace: { pxPerBeat: 26, snap: 0.25 },
  };
}

function track(patch: Partial<Track> = {}): Track {
  return {
    id: 't1',
    type: 'audio',
    name: 'Gtr',
    color: '#37b89a',
    volume: 1,
    pan: 0,
    mute: false,
    solo: false,
    armed: false,
    collapsed: false,
    output: 'master',
    ...patch,
  };
}

describe('macro mapping', () => {
  it('maps the knob across each target’s own range', () => {
    const t = { paramId: 'volume', from: 0.2, to: 0.8 };
    expect(targetNorm(t, 0)).toBeCloseTo(0.2, 9);
    expect(targetNorm(t, 0.5)).toBeCloseTo(0.5, 9);
    expect(targetNorm(t, 1)).toBeCloseTo(0.8, 9);
  });

  it('inverts a target whose range runs backwards', () => {
    const t = { paramId: 'pan', from: 1, to: 0 };
    expect(targetNorm(t, 0)).toBeCloseTo(1, 9);
    expect(targetNorm(t, 1)).toBeCloseTo(0, 9);
  });

  it('clamps a knob pushed past its ends', () => {
    const t = { paramId: 'volume', from: 0, to: 1 };
    expect(targetNorm(t, -3)).toBe(0);
    expect(targetNorm(t, 4)).toBe(1);
  });

  it('writes every resolvable target and skips the rest', () => {
    const tr = track();
    const macro = {
      ...createMacro('m1', 0),
      targets: [
        { paramId: 'volume', from: 0, to: 1 },
        { paramId: 'pan', from: 0.5, to: 1 },
        { paramId: 'fx:gone:threshold', from: 0, to: 1 },
      ],
    };
    const writes = macroWrites(tr, project([tr]), macro, 1);
    expect(writes.map((w) => w.paramId)).toEqual(['volume', 'pan']);
    // Pan's range is -1..1, so its top is hard right.
    expect(writes.find((w) => w.paramId === 'pan')!.value).toBeCloseTo(1, 6);
    expect(hasTarget(macro, 'fx:gone:threshold')).toBe(true);
  });

  it('describes what it drives, and says when it drives nothing', () => {
    const tr = track();
    const empty = createMacro('m', 0);
    expect(describeMacro(empty, tr, project([tr]))).toMatch(/[Nn]ot assigned/);
    const one = { ...empty, targets: [{ paramId: 'volume', from: 0, to: 1 }] };
    expect(describeMacro(one, tr, project([tr]))).toMatch(/Volume/);
  });
});

describe('macros in the store', () => {
  it('assigns, moves and writes the real parameter', () => {
    const store = useProjectStore.getState();
    const trackId = store.addTrack('audio');
    const macroId = useProjectStore.getState().addMacro(trackId)!;
    useProjectStore.getState().assignMacroTarget(trackId, macroId, 'pan');
    useProjectStore.getState().setMacroTargetRange(trackId, macroId, 'pan', 0, 1);

    useProjectStore.getState().setMacroValue(trackId, macroId, 1);
    let t = useProjectStore.getState().project.tracks.find((x) => x.id === trackId)!;
    expect(t.pan).toBeCloseTo(1, 6);

    useProjectStore.getState().setMacroValue(trackId, macroId, 0);
    t = useProjectStore.getState().project.tracks.find((x) => x.id === trackId)!;
    expect(t.pan).toBeCloseTo(-1, 6);
  });

  it('refuses a parameter the track does not have, and never assigns twice', () => {
    const store = useProjectStore.getState();
    const trackId = store.addTrack('audio');
    const macroId = useProjectStore.getState().addMacro(trackId)!;
    useProjectStore.getState().assignMacroTarget(trackId, macroId, 'synth:cutoff');
    useProjectStore.getState().assignMacroTarget(trackId, macroId, 'volume');
    useProjectStore.getState().assignMacroTarget(trackId, macroId, 'volume');
    const macro = useProjectStore
      .getState()
      .project.tracks.find((x) => x.id === trackId)!
      .macros!.find((m) => m.id === macroId)!;
    expect(macro.targets.map((t) => t.paramId)).toEqual(['volume']);
  });

  it('caps the knobs at eight', () => {
    const store = useProjectStore.getState();
    const trackId = store.addTrack('audio');
    for (let i = 0; i < 10; i++) useProjectStore.getState().addMacro(trackId);
    const t = useProjectStore.getState().project.tracks.find((x) => x.id === trackId)!;
    expect(t.macros).toHaveLength(8);
    expect(useProjectStore.getState().addMacro(trackId)).toBeNull();
  });
});
