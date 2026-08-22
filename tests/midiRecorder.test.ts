import { beforeEach, describe, expect, it } from 'vitest';
import { midiRecorder } from '../src/audio/midiRecorder';
import { createEmptyProject } from '../src/model/demoProject';
import { trackClips, useProjectStore } from '../src/state/projectStore';

/** The instrument track a take lands on. */
function instrumentTrack(): string {
  const p = useProjectStore.getState().project;
  const found = p.tracks.find((t) => t.type === 'instrument');
  return found ? found.id : useProjectStore.getState().addTrack('instrument');
}

function notesOf(clipId: string) {
  const clip = useProjectStore.getState().project.clips.find((c) => c.id === clipId);
  return clip && clip.type === 'midi' ? clip.notes : [];
}

describe('midi recording', () => {
  let track = '';

  beforeEach(() => {
    useProjectStore.getState().setProject(createEmptyProject('Rec'), { markClean: true });
    midiRecorder.cancel();
    track = instrumentTrack();
  });

  it('keeps notes at the beat they were played, relative to the clip start', () => {
    midiRecorder.start(track, 8);
    midiRecorder.noteOn(track, 60, 100, 8);
    midiRecorder.noteOff(track, 60, 9);
    midiRecorder.noteOn(track, 64, 80, 10.5);
    midiRecorder.noteOff(track, 64, 11);
    const clipId = midiRecorder.stop(12)!;

    const clip = useProjectStore.getState().project.clips.find((c) => c.id === clipId)!;
    expect(clip.start).toBe(8);
    expect(clip.trackId).toBe(track);

    const notes = [...notesOf(clipId)].sort((a, b) => a.start - b.start);
    expect(notes.map((n) => n.pitch)).toEqual([60, 64]);
    expect(notes[0].start).toBeCloseTo(0, 6);
    expect(notes[0].length).toBeCloseTo(1, 6);
    expect(notes[0].velocity).toBe(100);
    expect(notes[1].start).toBeCloseTo(2.5, 6);
    expect(notes[1].length).toBeCloseTo(0.5, 6);
  });

  it('closes a note still held at the stop instead of dropping it', () => {
    midiRecorder.start(track, 0);
    midiRecorder.noteOn(track, 55, 90, 1);
    const clipId = midiRecorder.stop(3)!;
    const notes = notesOf(clipId);
    expect(notes.length).toBe(1);
    expect(notes[0].pitch).toBe(55);
    expect(notes[0].start).toBeCloseTo(1, 6);
    expect(notes[0].length).toBeCloseTo(2, 6);
  });

  it('closes the previous note when a pitch retriggers without a note-off', () => {
    midiRecorder.start(track, 0);
    midiRecorder.noteOn(track, 60, 100, 0);
    midiRecorder.noteOn(track, 60, 120, 1);
    midiRecorder.noteOff(track, 60, 2);
    const notes = [...notesOf(midiRecorder.stop(4)!)].sort((a, b) => a.start - b.start);
    expect(notes.length).toBe(2);
    expect(notes[0].length).toBeCloseTo(1, 6);
    expect(notes[0].velocity).toBe(100);
    expect(notes[1].start).toBeCloseTo(1, 6);
    expect(notes[1].velocity).toBe(120);
  });

  it('rounds the clip out to a whole bar', () => {
    midiRecorder.start(track, 0);
    midiRecorder.noteOn(track, 60, 100, 0);
    midiRecorder.noteOff(track, 60, 4.5);
    const clipId = midiRecorder.stop(5);
    const clip = useProjectStore.getState().project.clips.find((c) => c.id === clipId)!;
    // 4/4: a take running 4.5 beats occupies two bars.
    expect(clip.length).toBe(8);
  });

  it('gives a silent take no clip at all', () => {
    const before = trackClips(useProjectStore.getState().project, track).length;
    midiRecorder.start(track, 0);
    expect(midiRecorder.stop(8)).toBeNull();
    expect(trackClips(useProjectStore.getState().project, track).length).toBe(before);
    expect(midiRecorder.isRecording).toBe(false);
  });

  it('ignores input from tracks other than the armed one', () => {
    const other = useProjectStore.getState().addTrack('instrument');
    midiRecorder.start(track, 0);
    midiRecorder.noteOn(other, 60, 100, 0);
    midiRecorder.noteOff(other, 60, 1);
    expect(midiRecorder.noteCount).toBe(0);
    expect(midiRecorder.stop(4)).toBeNull();
  });

  it('drops everything on cancel', () => {
    midiRecorder.start(track, 0);
    midiRecorder.noteOn(track, 60, 100, 0);
    midiRecorder.cancel();
    expect(midiRecorder.isRecording).toBe(false);
    expect(midiRecorder.stop(4)).toBeNull();
    expect(trackClips(useProjectStore.getState().project, track).length).toBe(0);
  });
});

/**
 * Directive 02 §2.2 — the take, while it is still being played.
 *
 * A note is drawn from the moment it starts, not from the moment it ends.
 * Waiting for the note-off would make the longest notes appear last and a held
 * chord draw nothing at all, which is precisely backwards: the long notes are
 * the ones a player is watching.
 */
describe('the in-progress take', () => {
  let t1 = '';
  beforeEach(() => {
    useProjectStore.getState().setProject(createEmptyProject('Live'), { markClean: true });
    t1 = instrumentTrack();
  });

  it('shows a note the instant it starts, before it is released', () => {
    midiRecorder.start(t1, 0);
    midiRecorder.noteOn(t1, 60, 100, 4);
    const at = midiRecorder.snapshot(4);
    expect(at.closed).toHaveLength(0);
    expect(at.open).toHaveLength(1);
    expect(at.open[0].pitch).toBe(60);
    expect(at.open[0].start).toBe(4);
  });

  it('extends a held note as the transport moves, without a note-off', () => {
    midiRecorder.start(t1, 0);
    midiRecorder.noteOn(t1, 60, 100, 2);
    expect(midiRecorder.snapshot(3).open[0].length).toBeCloseTo(1, 6);
    expect(midiRecorder.snapshot(6).open[0].length).toBeCloseTo(4, 6);
    expect(midiRecorder.snapshot(10).open[0].length).toBeCloseTo(8, 6);
  });

  it('closes the note at its real length when it is released', () => {
    midiRecorder.start(t1, 0);
    midiRecorder.noteOn(t1, 64, 90, 1);
    midiRecorder.noteOff(t1, 64, 3);
    const after = midiRecorder.snapshot(8);
    expect(after.open).toHaveLength(0);
    expect(after.closed).toHaveLength(1);
    // It stops growing once it is closed — the take is what was played, not
    // what the playhead has passed.
    expect(after.closed[0].length).toBeCloseTo(2, 6);
    expect(midiRecorder.snapshot(99).closed[0].length).toBeCloseTo(2, 6);
  });

  it('draws every note of a held chord', () => {
    midiRecorder.start(t1, 0);
    for (const pitch of [60, 64, 67, 72]) midiRecorder.noteOn(t1, pitch, 100, 0);
    const held = midiRecorder.snapshot(2);
    expect(held.open.map((n) => n.pitch).sort((a, b) => a - b)).toEqual([60, 64, 67, 72]);
    for (const note of held.open) expect(note.length).toBeCloseTo(2, 6);
  });

  it('carries velocity live, so a quiet note looks quiet as it is played', () => {
    midiRecorder.start(t1, 0);
    midiRecorder.noteOn(t1, 60, 20, 0);
    midiRecorder.noteOn(t1, 67, 120, 0);
    const byPitch = new Map(midiRecorder.snapshot(1).open.map((n) => [n.pitch, n.velocity]));
    expect(byPitch.get(60)).toBe(20);
    expect(byPitch.get(67)).toBe(120);
  });

  it('places notes where the committed clip will place them', () => {
    // The drawing and the finished clip have to use one coordinate system, or
    // the take visibly jumps at the moment the transport stops.
    midiRecorder.start(t1, 8);
    midiRecorder.noteOn(t1, 60, 100, 10);
    midiRecorder.noteOff(t1, 60, 12);
    const drawn = midiRecorder.snapshot(12).closed[0];
    const clipId = midiRecorder.stop(12);
    const clip = useProjectStore.getState().project.clips.find((c) => c.id === clipId);
    const committed = clip?.type === 'midi' ? clip.notes[0] : undefined;
    expect(committed).toBeDefined();
    expect(committed!.start).toBeCloseTo(drawn.start, 6);
    expect(committed!.length).toBeCloseTo(drawn.length, 6);
    expect(committed!.pitch).toBe(drawn.pitch);
  });

  it('does not allocate a fresh array per frame', () => {
    // Read sixty times a second: a new array per call is sixty allocations a
    // second, and the garbage they make is paid for on the frame that collects.
    midiRecorder.start(t1, 0);
    midiRecorder.noteOn(t1, 60, 100, 0);
    expect(midiRecorder.snapshot(1).open).toBe(midiRecorder.snapshot(2).open);
  });

  it('reports nothing once the take is cancelled', () => {
    midiRecorder.start(t1, 0);
    midiRecorder.noteOn(t1, 60, 100, 0);
    midiRecorder.cancel();
    const after = midiRecorder.snapshot(4);
    expect(after.closed).toHaveLength(0);
    expect(after.open).toHaveLength(0);
  });
});
