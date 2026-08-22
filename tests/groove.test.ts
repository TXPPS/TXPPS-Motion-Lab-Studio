import { beforeEach, describe, expect, it } from 'vitest';
import {
  BUILTIN_GROOVES,
  MAX_SAVED_GROOVES,
  applyGroove,
  grooveBeatsPerBar,
  grooveFromNotes,
  normalizeGrooves,
  straightGroove,
  swingGroove,
} from '../src/model/groove';
import { createEmptyProject } from '../src/model/demoProject';
import { useProjectStore } from '../src/state/projectStore';

describe('grooves as data', () => {
  it('reads a swing off eighth notes that were played swung', () => {
    // Every off-beat eighth a sixth of a beat late is roughly 66% swing.
    const notes = [
      { start: 0, velocity: 100 },
      { start: 0.5 + 1 / 6, velocity: 80 },
      { start: 1, velocity: 100 },
      { start: 1.5 + 1 / 6, velocity: 80 },
    ];
    const groove = grooveFromNotes(notes, 2, { beatsPerBar: 4 });
    expect(grooveBeatsPerBar(groove)).toBe(4);
    expect(groove.offsets[0]).toBeCloseTo(0, 3);
    expect(groove.offsets[1]).toBeCloseTo(1 / 6, 3);
    // the softer off-beats come back as a velocity below the mean
    expect(groove.velocities[1]).toBeLessThan(groove.velocities[0]);
  });

  it('leaves a slot nothing landed in on the grid', () => {
    const groove = grooveFromNotes([{ start: 0, velocity: 100 }], 4, { beatsPerBar: 4 });
    expect(groove.offsets.slice(1).every((o) => o === 0)).toBe(true);
  });

  it('does nothing at zero strength and the full deviation at one', () => {
    const swing = swingGroove(66);
    const events = [{ beat: 0.5, velocity: 100 }];
    expect(applyGroove(events, swing, 0)[0].beat).toBeCloseTo(0.5, 6);
    const full = applyGroove(events, swing, 1)[0].beat;
    expect(full).toBeGreaterThan(0.5);
    const half = applyGroove(events, swing, 0.5)[0].beat;
    expect(half).toBeCloseTo(0.5 + (full - 0.5) / 2, 6);
  });

  it('changes nothing under a straight groove', () => {
    const events = [{ beat: 0.5, velocity: 90 }];
    const out = applyGroove(events, straightGroove(), 1)[0];
    expect(out.beat).toBeCloseTo(0.5, 6);
    expect(out.velocity).toBeCloseTo(90, 6);
  });
});

describe('grooves in a project', () => {
  let clipId = '';

  beforeEach(() => {
    useProjectStore.getState().setProject(createEmptyProject('Groove'), { markClean: true });
    const trackId = useProjectStore.getState().addTrack('instrument');
    clipId = useProjectStore.getState().addMidiClip(trackId, 0, 4);
    useProjectStore.getState().addNotes(clipId, [
      { start: 0, length: 0.5, pitch: 60, velocity: 100 },
      { start: 0.5, length: 0.5, pitch: 62, velocity: 100 },
    ]);
  });

  const notesOf = () => {
    const clip = useProjectStore.getState().project.clips.find((c) => c.id === clipId);
    return clip && clip.type === 'midi' ? clip.notes : [];
  };

  it('moves a clip’s notes late without moving the downbeat', () => {
    useProjectStore.getState().applyGrooveToClip(clipId, swingGroove(66), 1);
    const notes = [...notesOf()].sort((a, b) => a.pitch - b.pitch);
    expect(notes[0].start).toBeCloseTo(0, 6);
    expect(notes[1].start).toBeGreaterThan(0.5);
    // the notes keep their identity, so undo and selection still hold
    expect(notes.length).toBe(2);
  });

  it('keeps velocities inside the MIDI range', () => {
    const loud = { ...swingGroove(66), velocities: [4, 4, 4, 4, 4, 4, 4, 4] };
    useProjectStore.getState().applyGrooveToClip(clipId, loud, 1);
    expect(notesOf().every((n) => n.velocity <= 127 && n.velocity >= 1)).toBe(true);
    expect(notesOf().every((n) => Number.isInteger(n.velocity))).toBe(true);
  });

  it('refuses to move a locked clip', () => {
    useProjectStore.getState().setClip(clipId, { locked: true });
    useProjectStore.getState().applyGrooveToClip(clipId, swingGroove(66), 1);
    expect(notesOf().map((n) => n.start)).toEqual([0, 0.5]);
  });

  it('saves a groove under its name, replacing one already saved under it', () => {
    const store = useProjectStore.getState();
    store.saveGroove({ ...straightGroove(), name: 'Mine' });
    store.saveGroove({ ...swingGroove(60), name: 'Mine' });
    const saved = useProjectStore.getState().project.grooves ?? [];
    expect(saved.length).toBe(1);
    expect(saved[0].offsets.some((o) => o !== 0)).toBe(true);
    useProjectStore.getState().removeGroove('Mine');
    expect(useProjectStore.getState().project.grooves).toEqual([]);
  });
});

describe('loading grooves', () => {
  it('drops one whose halves disagree rather than applying half a pattern', () => {
    const ok = { name: 'A', resolution: 2, offsets: [0, 0.1], velocities: [1, 1] };
    const short = { name: 'B', resolution: 2, offsets: [0, 0.1], velocities: [] };
    expect(normalizeGrooves([ok, short]).map((g) => g.name)).toEqual(['A']);
  });

  it('clamps absurd values and caps the list', () => {
    const wild = { name: 'W', resolution: 4, offsets: [99], velocities: [99] };
    const [g] = normalizeGrooves([wild]);
    expect(g.offsets[0]).toBe(1);
    expect(g.velocities[0]).toBe(4);
    const many = Array.from({ length: MAX_SAVED_GROOVES + 10 }, (_, i) => ({
      name: `g${i}`,
      resolution: 4,
      offsets: [0],
      velocities: [1],
    }));
    expect(normalizeGrooves(many).length).toBe(MAX_SAVED_GROOVES);
  });

  it('has a built-in list that all round-trips', () => {
    expect(normalizeGrooves(BUILTIN_GROOVES).length).toBe(BUILTIN_GROOVES.length);
  });
});
