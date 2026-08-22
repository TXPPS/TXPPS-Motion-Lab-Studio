import { beforeEach, describe, expect, it } from 'vitest';
import { projectEndBeat, trackClips, useProjectStore } from '../src/state/projectStore';
import { createDemoProject, createEmptyProject } from '../src/model/demoProject';

function reset(demo = true) {
  useProjectStore
    .getState()
    .setProject(demo ? createDemoProject() : createEmptyProject('Test'), { markClean: true });
}

describe('track operations', () => {
  beforeEach(() => reset());

  it('adds tracks of each type before the bus group', () => {
    const s = useProjectStore.getState();
    const before = s.project.tracks.length;
    const id = s.addTrack('instrument');
    const p = useProjectStore.getState().project;
    expect(p.tracks.length).toBe(before + 1);
    const added = p.tracks.find((t) => t.id === id)!;
    expect(added.type).toBe('instrument');
    expect(added.synth).toBeTruthy();
    // buses remain last
    const firstBusIdx = p.tracks.findIndex((t) => t.type === 'bus');
    const addedIdx = p.tracks.findIndex((t) => t.id === id);
    expect(addedIdx).toBeLessThan(firstBusIdx);
  });

  it('deletes a track and its clips, rerouting outputs off a deleted bus', () => {
    const s = useProjectStore.getState();
    const bus = s.project.tracks.find((t) => t.type === 'bus')!;
    const routed = s.project.tracks.filter((t) => t.output === bus.id);
    expect(routed.length).toBeGreaterThan(0);
    s.deleteTrack(bus.id);
    const p = useProjectStore.getState().project;
    expect(p.tracks.find((t) => t.id === bus.id)).toBeUndefined();
    expect(trackClips(p, bus.id)).toHaveLength(0);
    for (const t of p.tracks) expect(t.output).not.toBe(bus.id);
  });

  it('duplicates a track with copies of its clips (new ids)', () => {
    const s = useProjectStore.getState();
    const src = s.project.tracks.find((t) => t.type === 'instrument')!;
    const srcClipIds = new Set(trackClips(s.project, src.id).map((c) => c.id));
    const newId = s.duplicateTrack(src.id)!;
    const p = useProjectStore.getState().project;
    const copies = trackClips(p, newId);
    expect(copies.length).toBe(srcClipIds.size);
    for (const c of copies) expect(srcClipIds.has(c.id)).toBe(false);
  });
});

describe('mixer / track shared state', () => {
  beforeEach(() => reset());

  it('volume and pan set from one place are visible everywhere (single source)', () => {
    const s = useProjectStore.getState();
    const t = s.project.tracks[0];
    s.setTrack(t.id, { volume: 0.42, pan: -0.5 });
    const after = useProjectStore.getState().project.tracks.find((x) => x.id === t.id)!;
    expect(after.volume).toBeCloseTo(0.42);
    expect(after.pan).toBeCloseTo(-0.5);
  });

  it('solo is reflected on the track object for engine + mixer to read', () => {
    const s = useProjectStore.getState();
    const t = s.project.tracks[0];
    s.setTrack(t.id, { solo: true });
    expect(useProjectStore.getState().project.tracks.find((x) => x.id === t.id)!.solo).toBe(true);
  });
});

describe('clip operations', () => {
  beforeEach(() => reset());

  it('moves a clip and clamps to >= 0', () => {
    const s = useProjectStore.getState();
    const clip = s.project.clips[0];
    s.moveClip(clip.id, -5);
    expect(useProjectStore.getState().project.clips.find((c) => c.id === clip.id)!.start).toBe(0);
    s.moveClip(clip.id, 12);
    expect(useProjectStore.getState().project.clips.find((c) => c.id === clip.id)!.start).toBe(12);
  });

  it('resizes with a minimum length', () => {
    const s = useProjectStore.getState();
    const clip = s.project.clips[0];
    s.resizeClip(clip.id, clip.start, 0.01);
    expect(
      useProjectStore.getState().project.clips.find((c) => c.id === clip.id)!.length,
    ).toBeGreaterThanOrEqual(0.25);
  });

  it('only moves a MIDI clip onto a compatible (non-audio) track', () => {
    const s = useProjectStore.getState();
    const midiClip = s.project.clips.find((c) => c.type === 'midi')!;
    const audioTrack = s.project.tracks.find((t) => t.type === 'audio')!;
    s.moveClip(midiClip.id, 0, audioTrack.id);
    // rejected: still on original track
    expect(
      useProjectStore.getState().project.clips.find((c) => c.id === midiClip.id)!.trackId,
    ).not.toBe(audioTrack.id);
  });

  it('duplicates a clip after the original by default', () => {
    const s = useProjectStore.getState();
    const clip = s.project.clips[0];
    const dupId = s.duplicateClip(clip.id)!;
    const dup = useProjectStore.getState().project.clips.find((c) => c.id === dupId)!;
    expect(dup.start).toBeCloseTo(clip.start + clip.length);
  });

  it('deletes clips', () => {
    const s = useProjectStore.getState();
    const clip = s.project.clips[0];
    s.deleteClip(clip.id);
    expect(useProjectStore.getState().project.clips.find((c) => c.id === clip.id)).toBeUndefined();
  });
});

describe('note editing', () => {
  beforeEach(() => reset(false));

  it('adds, updates (clamped), and deletes notes in a MIDI clip', () => {
    const s = useProjectStore.getState();
    const track = s.project.tracks.find((t) => t.type === 'instrument')!;
    const clipId = s.addMidiClip(track.id, 0, 4);
    const nId = s.addNote(clipId, { start: 0, length: 1, pitch: 60, velocity: 100 });
    let clip = useProjectStore.getState().project.clips.find((c) => c.id === clipId)!;
    expect(clip.type === 'midi' && clip.notes).toHaveLength(1);

    s.updateNotes(clipId, [nId], () => ({ pitch: 200, velocity: 999, length: -1 }));
    clip = useProjectStore.getState().project.clips.find((c) => c.id === clipId)!;
    if (clip.type === 'midi') {
      const n = clip.notes[0];
      expect(n.pitch).toBeLessThanOrEqual(127);
      expect(n.velocity).toBeLessThanOrEqual(127);
      expect(n.length).toBeGreaterThan(0);
    }

    s.deleteNotes(clipId, [nId]);
    clip = useProjectStore.getState().project.clips.find((c) => c.id === clipId)!;
    expect(clip.type === 'midi' && clip.notes).toHaveLength(0);
  });
});

describe('undo / redo', () => {
  beforeEach(() => reset());

  it('undoes and redoes a discrete edit', () => {
    const s = useProjectStore.getState();
    const t = s.project.tracks[0];
    const original = t.name;
    s.setTrack(t.id, { name: 'Renamed' });
    expect(useProjectStore.getState().project.tracks.find((x) => x.id === t.id)!.name).toBe(
      'Renamed',
    );
    useProjectStore.getState().undo();
    expect(useProjectStore.getState().project.tracks.find((x) => x.id === t.id)!.name).toBe(
      original,
    );
    useProjectStore.getState().redo();
    expect(useProjectStore.getState().project.tracks.find((x) => x.id === t.id)!.name).toBe(
      'Renamed',
    );
  });

  it('collapses a gesture into a single undo step', () => {
    const s = useProjectStore.getState();
    const clip = s.project.clips[0];
    const startUndo = useProjectStore.getState().undoStack.length;
    s.beginGesture();
    s.moveClip(clip.id, 1);
    s.moveClip(clip.id, 2);
    s.moveClip(clip.id, 3);
    s.endGesture();
    expect(useProjectStore.getState().undoStack.length).toBe(startUndo + 1);
    useProjectStore.getState().undo();
    expect(useProjectStore.getState().project.clips.find((c) => c.id === clip.id)!.start).toBe(
      clip.start,
    );
  });

  it('does not create undo steps for continuous volume changes', () => {
    const s = useProjectStore.getState();
    const t = s.project.tracks[0];
    const startUndo = useProjectStore.getState().undoStack.length;
    s.setTrack(t.id, { volume: 0.5 });
    s.setTrack(t.id, { volume: 0.6 });
    expect(useProjectStore.getState().undoStack.length).toBe(startUndo);
  });
});

describe('projectEndBeat', () => {
  it('is the end of the last clip, at least 16', () => {
    reset(false);
    expect(projectEndBeat(useProjectStore.getState().project)).toBe(16);
    const s = useProjectStore.getState();
    const track = s.project.tracks[0];
    s.addMidiClip(track.id, 40, 8);
    expect(projectEndBeat(useProjectStore.getState().project)).toBe(48);
  });
});

describe('transport-adjacent settings', () => {
  beforeEach(() => reset());
  it('clamps bpm and loop', () => {
    const s = useProjectStore.getState();
    // The tempo range matches the tempo map's (20-999 BPM): a drum-and-bass
    // half-time feel and a 20 BPM ambient pulse are both real tempi.
    s.setBpm(9999);
    expect(useProjectStore.getState().project.bpm).toBeLessThanOrEqual(999);
    s.setBpm(1);
    expect(useProjectStore.getState().project.bpm).toBeGreaterThanOrEqual(20);
    s.setLoop({ start: 4, end: 4 });
    const loop = useProjectStore.getState().project.loop;
    expect(loop.end).toBeGreaterThan(loop.start);
  });
});

describe('gesture nesting', () => {
  it('commits one undo step for two overlapping drags and never strands the window', () => {
    const s = useProjectStore.getState();
    const trackId = s.addTrack('instrument');
    useProjectStore.getState().update((d) => {
      d.name = 'baseline';
    });
    const before = useProjectStore.getState().undoStack.length;

    // Two simultaneous touch drags: both open, both close.
    useProjectStore.getState().beginGesture();
    useProjectStore.getState().beginGesture();
    useProjectStore.getState().setTrack(trackId, { volume: 0.5 });
    useProjectStore.getState().setTrack(trackId, { pan: 0.5 });
    useProjectStore.getState().endGesture();
    // The first release must NOT commit — the second drag is still running.
    expect(useProjectStore.getState().gestureSnapshot).not.toBeNull();
    useProjectStore.getState().setTrack(trackId, { pan: -0.5 });
    useProjectStore.getState().endGesture();

    expect(useProjectStore.getState().gestureSnapshot).toBeNull();
    expect(useProjectStore.getState().undoStack.length).toBe(before + 1);

    useProjectStore.getState().undo();
    const t = useProjectStore.getState().project.tracks.find((x) => x.id === trackId)!;
    expect(t.volume).not.toBe(0.5);
    expect(t.pan).not.toBe(-0.5);
  });

  it('flushGestures closes a gesture whose drag never ended', () => {
    const s = useProjectStore.getState();
    const trackId = s.addTrack('audio');
    useProjectStore.getState().beginGesture();
    useProjectStore.getState().setTrack(trackId, { volume: 0.25 });
    const before = useProjectStore.getState().undoStack.length;
    useProjectStore.getState().flushGestures();
    expect(useProjectStore.getState().gestureSnapshot).toBeNull();
    expect(useProjectStore.getState().gestureDepth).toBe(0);
    expect(useProjectStore.getState().undoStack.length).toBe(before + 1);
    // Edits after the flush are undoable again (a rename is a discrete edit;
    // continuous ones like volume deliberately fold into their gesture).
    useProjectStore.getState().setTrack(trackId, { name: 'Renamed' });
    expect(useProjectStore.getState().undoStack.length).toBe(before + 2);
  });
});
