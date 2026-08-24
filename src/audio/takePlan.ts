/**
 * Where a take goes, and when it starts.
 *
 * Split out of `recordingController.ts` because it is a different kind of
 * thing: nothing here holds state or opens a device. These are the questions a
 * take must answer before it can begin — which track, from which beat, over
 * what window — and answering them in pure functions is what lets them be
 * tested without a microphone.
 */
import { tempoMapOf } from '../model/music';
import { beatsPerBarAt } from '../model/tempo';
import type { ProjectData, Track } from '../model/types';
import { useProjectStore } from '../state/projectStore';
import { useUiStore } from '../state/uiStore';

/**
 * The count-in is the project's, not this module's.
 *
 * It was both: a field the transport wrote and a module-level number the
 * recorder read, so changing the count-in from the transport changed nothing
 * about a recording. One of them had to go, and the one that survives a save
 * is the project's.
 */
export function setCountInBars(bars: number): void {
  const next = Math.max(0, Math.min(8, Math.round(bars)));
  useProjectStore.getState().update((d) => {
    d.countIn = next;
  });
}

export function getCountInBars(): number {
  return Math.max(0, Math.min(8, Math.round(useProjectStore.getState().project.countIn ?? 1)));
}

/** The track a take will be captured on: armed audio track, else selected. */
export function recordTargetTrack(): Track | null {
  const p = useProjectStore.getState().project;
  const sel = useUiStore.getState().selectedTrackId;
  const audio = p.tracks.filter((t) => t.type === 'audio');
  return audio.find((t) => t.armed) ?? audio.find((t) => t.id === sel) ?? null;
}

/**
 * The instrument track a MIDI take would land on.
 *
 * An armed instrument track wins over an armed audio track: pressing record
 * with a keyboard part armed should record the keyboard, and the audio path
 * needs a microphone permission it should not be asking for in that case.
 */
export function midiRecordTargetTrack(): Track | null {
  const p = useProjectStore.getState().project;
  const sel = useUiStore.getState().selectedTrackId;
  const playable = p.tracks.filter((t) => t.type === 'instrument' || t.type === 'drum');
  return playable.find((t) => t.armed) ?? playable.find((t) => t.id === sel) ?? null;
}

/**
 * Where a take rolls in and where it starts counting.
 *
 * Punch and pre-roll were both stored on the project and read by nobody: the
 * transport's punch button toggled a flag that changed nothing about a
 * recording. They are the same question — from what point does the transport
 * roll, and from what point does the clip begin — so they are answered once,
 * here, and the answer is data the caller can test.
 */
export function captureWindow(
  project: ProjectData,
  playheadBeat: number,
): {
  rollBeat: number;
  window: { startBeat: number; endBeat: number } | null;
} {
  const punch = project.punch;
  const map = tempoMapOf(project);
  const startBeat = punch?.enabled && punch.end > punch.start ? punch.start : playheadBeat;
  const preRollBars = Math.max(0, Math.min(8, project.preRoll ?? 0));
  const preRollBeats = preRollBars * beatsPerBarAt(map, Math.max(0, startBeat - 1e-6));
  return {
    rollBeat: Math.max(0, startBeat - preRollBeats),
    // Only punch fixes an end. A pre-roll moves the start of the roll, not the
    // start of the clip, so it needs no window of its own.
    window:
      punch?.enabled && punch.end > punch.start
        ? { startBeat: punch.start, endBeat: punch.end }
        : preRollBeats > 0
          ? { startBeat, endBeat: Number.POSITIVE_INFINITY }
          : null,
  };
}
