/**
 * Where a take goes, and when it starts.
 *
 * Split out of `recordingController.ts` because it is a different kind of
 * thing: nothing here holds state or opens a device. These are the questions a
 * take must answer before it can begin — which track, from which beat, over
 * what window — and answering them in pure functions is what lets them be
 * tested without a microphone.
 */
import { projectBeatRangeSec, projectBeatsForSeconds, tempoMapOf } from '../model/music';
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

/**
 * How far into a take the recorded audio for a given moment actually sits.
 *
 * A take arrives late by the whole round trip. The player hears the click
 * through the output buffer and the device — `baseLatency + outputLatency` —
 * plays in response, and their sound then goes back through the interface and
 * the capture path before it reaches `MediaRecorder`. So the sample that belongs
 * at the punch point is not the first sample of the take; it is the one this
 * many seconds in.
 *
 * The output half is measurable and the input half is not: no browser exposes an
 * input latency at all. `offsetMs` is where a user puts what their interface
 * costs, and it is additive on top of the measured figure rather than replacing
 * it — drivers under-report, and a number the platform *did* give is still worth
 * having.
 *
 * Negative is allowed. An interface with direct monitoring can have the player
 * hearing themselves with no output latency at all, in which case the measured
 * output figure is an over-correction and the offset has to take it back off.
 */
export function recordLatencySec(
  measured: { base: number; output: number } | null,
  offsetMs: number,
): number {
  const platform = measured ? measured.base + measured.output : 0;
  // Clamped at zero rather than allowed to go negative: a take cannot start
  // before it was recorded, and a wrong offset should mis-align the audio by the
  // amount the user typed, not send the clip reading off the front of the file.
  return Math.max(0, platform + offsetMs / 1000);
}

/**
 * Where a finished take's clip goes, and how far into the media it starts.
 *
 * Pure, because this is the arithmetic that decides whether a take lands on the
 * grid, and it should be checkable without a microphone, a decoder or a browser.
 * `commitTake` does the decoding and the storage; this decides the placement.
 */
export function takePlacement(opts: {
  project: ProjectData;
  /** Timeline beat where capture began. */
  startBeat: number;
  /** The window the clip should cover, when the take was punched or rolled in. */
  punchWindow?: { startBeat: number; endBeat: number };
  /** Length of the decoded audio. */
  durationSec: number;
  /** Round trip, from `recordLatencySec`. */
  latencySec: number;
}): { clipStart: number; offsetSec: number; lengthBeats: number } {
  const { project, startBeat, punchWindow, durationSec, latencySec } = opts;

  // Never skip past the end of what was captured. A take shorter than the round
  // trip has nothing in it that belongs on the timeline, and reading past the
  // buffer would be a clip of silence rather than an empty one.
  const head = Math.min(latencySec, Math.max(0, durationSec - 0.001));

  const clipStart = Math.max(startBeat, punchWindow?.startBeat ?? startBeat);
  const punchOffset =
    clipStart > startBeat ? projectBeatRangeSec(project, startBeat, clipStart - startBeat) : 0;
  const offsetSec = punchOffset + head;

  // The musical length of what is left, measured from where the clip starts —
  // a take crossing a tempo change is not `seconds x one bpm` beats long.
  const usableSec = Math.max(0, durationSec - offsetSec);
  const available = projectBeatsForSeconds(project, clipStart, usableSec);
  const wanted = punchWindow ? punchWindow.endBeat - clipStart : available;
  const lengthBeats = Math.max(0.25, Math.min(available, wanted));

  return { clipStart, offsetSec, lengthBeats };
}
