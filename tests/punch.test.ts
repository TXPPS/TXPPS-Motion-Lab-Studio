import { beforeEach, describe, expect, it } from 'vitest';
import { captureWindow } from '../src/audio/recordingController';
import { midiRecorder } from '../src/audio/midiRecorder';
import { createEmptyProject } from '../src/model/demoProject';
import { useProjectStore } from '../src/state/projectStore';
import type { ProjectData } from '../src/model/types';

function project(patch: Partial<ProjectData> = {}): ProjectData {
  return { ...createEmptyProject('Punch'), ...patch };
}

describe('where a take rolls in and where it starts', () => {
  it('rolls and starts at the playhead when neither is set', () => {
    const plan = captureWindow(project(), 12);
    expect(plan.rollBeat).toBe(12);
    expect(plan.window).toBeNull();
  });

  it('rolls a whole bar early for one bar of pre-roll, without moving the clip', () => {
    const plan = captureWindow(project({ preRoll: 1 }), 12);
    expect(plan.rollBeat).toBe(8);
    // The clip still begins at the playhead: a pre-roll is a run-up, not a
    // longer take.
    expect(plan.window).toEqual({ startBeat: 12, endBeat: Number.POSITIVE_INFINITY });
  });

  it('takes the punch point over the playhead, and carries the drop-out with it', () => {
    const plan = captureWindow(project({ punch: { enabled: true, start: 16, end: 24 } }), 3);
    expect(plan.rollBeat).toBe(16);
    expect(plan.window).toEqual({ startBeat: 16, endBeat: 24 });
  });

  it('rolls in before the punch point when both are set', () => {
    const plan = captureWindow(
      project({ preRoll: 2, punch: { enabled: true, start: 16, end: 24 } }),
      3,
    );
    expect(plan.rollBeat).toBe(8);
    expect(plan.window).toEqual({ startBeat: 16, endBeat: 24 });
  });

  it('never rolls before the start of the song', () => {
    expect(captureWindow(project({ preRoll: 4 }), 2).rollBeat).toBe(0);
  });

  it('ignores a punch region that is empty or backwards', () => {
    expect(
      captureWindow(project({ punch: { enabled: true, start: 8, end: 8 } }), 3).window,
    ).toBeNull();
    expect(
      captureWindow(project({ punch: { enabled: true, start: 9, end: 8 } }), 3).window,
    ).toBeNull();
  });

  it('ignores a punch region that is switched off', () => {
    const plan = captureWindow(project({ punch: { enabled: false, start: 16, end: 24 } }), 3);
    expect(plan.rollBeat).toBe(3);
    expect(plan.window).toBeNull();
  });

  it('measures the pre-roll in bars of the signature in force there', () => {
    // A 3/4 bar is three quarter-note beats, so one bar of pre-roll from beat 9
    // rolls back to 6 rather than to 5.
    const p = project({
      timeSig: { num: 3, den: 4 },
      tempoMap: {
        tempos: [{ id: 't0', beat: 0, bpm: 120 }],
        sigs: [{ id: 's0', bar: 0, num: 3, den: 4 }],
      },
      preRoll: 1,
    });
    expect(captureWindow(p, 9).rollBeat).toBe(6);
  });
});

describe('a punched MIDI take', () => {
  let track = '';

  beforeEach(() => {
    useProjectStore.getState().setProject(createEmptyProject('Punch'), { markClean: true });
    track = useProjectStore.getState().addTrack('instrument');
    midiRecorder.cancel();
  });

  const clipOf = (id: string | null) =>
    useProjectStore.getState().project.clips.find((c) => c.id === id);
  const notesOf = (id: string | null) => {
    const c = clipOf(id);
    return c && c.type === 'midi' ? c.notes : [];
  };

  it('drops what was played during the run-up', () => {
    midiRecorder.start(track, 8, 0, { startBeat: 12, endBeat: 20 });
    midiRecorder.noteOn(track, 60, 100, 9); // run-up
    midiRecorder.noteOff(track, 60, 10);
    midiRecorder.noteOn(track, 64, 100, 13); // inside
    midiRecorder.noteOff(track, 64, 14);
    const id = midiRecorder.stop(20);

    expect(clipOf(id)!.start).toBe(12);
    const notes = notesOf(id);
    expect(notes.map((n) => n.pitch)).toEqual([64]);
    expect(notes[0].start).toBeCloseTo(1, 6);
  });

  it('keeps a note held through the punch point, trimmed to it', () => {
    midiRecorder.start(track, 8, 0, { startBeat: 12, endBeat: 20 });
    midiRecorder.noteOn(track, 55, 90, 11);
    midiRecorder.noteOff(track, 55, 15);
    const notes = notesOf(midiRecorder.stop(20));
    expect(notes.length).toBe(1);
    expect(notes[0].start).toBeCloseTo(0, 6);
    expect(notes[0].length).toBeCloseTo(3, 6);
  });

  it('trims a note still sounding at the punch-out', () => {
    midiRecorder.start(track, 0, 0, { startBeat: 0, endBeat: 8 });
    midiRecorder.noteOn(track, 60, 100, 6);
    const notes = notesOf(midiRecorder.stop(12));
    expect(notes[0].length).toBeCloseTo(2, 6);
  });

  it('writes no clip when everything played fell in the run-up', () => {
    midiRecorder.start(track, 8, 0, { startBeat: 12, endBeat: 20 });
    midiRecorder.noteOn(track, 60, 100, 9);
    midiRecorder.noteOff(track, 60, 10);
    expect(midiRecorder.stop(20)).toBeNull();
  });

  it('behaves exactly as before when there is no window', () => {
    midiRecorder.start(track, 4);
    midiRecorder.noteOn(track, 60, 100, 4);
    midiRecorder.noteOff(track, 60, 6);
    const id = midiRecorder.stop(8);
    expect(clipOf(id)!.start).toBe(4);
    expect(notesOf(id)[0].length).toBeCloseTo(2, 6);
  });
});
