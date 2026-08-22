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
