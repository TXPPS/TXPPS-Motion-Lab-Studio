/**
 * Range editing, committed.
 *
 * `model/rangeEdits.ts` decides what a range edit produces; this commits it in
 * one undoable step, moves the song-level events the edit implies, and reports
 * anything a lock refused. Keeping the decision pure is what lets the awkward
 * cases — a locked clip, a range that exactly touches a boundary, a ripple that
 * has to move markers too — be tested without a store.
 */
import {
  copyRange,
  cropToRange,
  deleteRange,
  duplicateRange,
  fadeRange,
  insertSilence,
  pasteRangeAt,
  splitClipsAtRange,
  stripSilence,
  DEFAULT_STRIP_SILENCE,
  type RangeClipboard,
  type RangeEditResult,
  type TimeRange,
} from '../model/rangeEdits';
import { getPeaksSync } from '../audio/mediaLibrary';
import { newId } from '../model/ids';
import { tempoMapOf } from '../model/music';
import { normalizeChords, normalizeMarkers, normalizeSections } from '../model/arrangement';
import type { AudioClip, ProjectData } from '../model/types';
import { useProjectStore } from '../state/projectStore';
import { useUiStore } from '../state/uiStore';

function contextOf(project: ProjectData) {
  return {
    clips: project.clips,
    tracks: project.tracks,
    tempoMap: tempoMapOf(project),
    makeId: (prefix: string) => newId(prefix),
  };
}

/** Report what a lock refused, once, rather than silently doing less. */
function reportLocks(result: RangeEditResult): void {
  const n = result.lockedClipIds.length + result.lockedTrackIds.length;
  if (n === 0) return;
  useUiStore
    .getState()
    .toast('error', `${n} locked ${n === 1 ? 'item was' : 'items were'} left alone.`);
}

/**
 * Apply a result, and move the song-level events a ripple implies.
 *
 * A ripple that moved the clips but left the markers behind would be worse than
 * no ripple at all: the map would no longer describe the song.
 */
function commit(result: RangeEditResult, label: string): void {
  useProjectStore.getState().update((d) => {
    d.clips = result.clips;
    const ripple = result.ripple;
    if (ripple) {
      const shift = (beat: number) =>
        beat >= ripple.fromBeat - 1e-9 ? Math.max(0, beat + ripple.deltaBeats) : beat;
      for (const m of d.markers ?? []) m.beat = shift(m.beat);
      for (const c of d.chords ?? []) c.beat = shift(c.beat);
      for (const s of d.sections ?? []) s.start = shift(s.start);
      for (const t of d.tracks) {
        for (const lane of t.automation ?? []) {
          for (const p of lane.points) p.beat = shift(p.beat);
        }
      }
      d.markers = normalizeMarkers(d.markers);
      d.chords = normalizeChords(d.chords);
      d.sections = normalizeSections(d.sections);
    }
  });
  reportLocks(result);
  useUiStore.getState().toast('info', label);
}

let clipboard: RangeClipboard | null = null;

export function rangeSplit(range: TimeRange): void {
  const project = useProjectStore.getState().project;
  commit(splitClipsAtRange(contextOf(project), range), 'Split at the range edges');
}

export function rangeDelete(range: TimeRange, ripple = false): void {
  const project = useProjectStore.getState().project;
  const global = range.trackIds.length >= project.tracks.length;
  commit(
    deleteRange(contextOf(project), range, {
      ripple,
      rippleScope: global ? 'global' : 'range',
    }),
    ripple ? 'Deleted the range and closed the gap' : 'Cleared the range',
  );
}

export function rangeInsertSilence(range: TimeRange): void {
  const project = useProjectStore.getState().project;
  const length = range.toBeat - range.fromBeat;
  commit(
    insertSilence(contextOf(project), range.fromBeat, length, range.trackIds),
    `Inserted ${length.toFixed(2)} beats of silence`,
  );
}

export function rangeCopy(range: TimeRange): void {
  const project = useProjectStore.getState().project;
  clipboard = copyRange(contextOf(project), range);
  useUiStore
    .getState()
    .toast(
      'info',
      `Copied ${clipboard.clips.length} clip${clipboard.clips.length === 1 ? '' : 's'}`,
    );
}

export function rangeCut(range: TimeRange): void {
  rangeCopy(range);
  rangeDelete(range, false);
}

export function rangePaste(atBeat: number, trackIds: readonly string[], insert = false): void {
  if (!clipboard) {
    useUiStore.getState().toast('error', 'Nothing copied yet.');
    return;
  }
  const project = useProjectStore.getState().project;
  commit(
    pasteRangeAt(contextOf(project), clipboard, atBeat, trackIds, { insert }),
    insert ? 'Pasted and pushed the rest later' : 'Pasted',
  );
}

export function rangeDuplicate(range: TimeRange): void {
  const project = useProjectStore.getState().project;
  commit(duplicateRange(contextOf(project), range), 'Duplicated the range');
}

export function rangeCrop(range: TimeRange): void {
  const project = useProjectStore.getState().project;
  commit(cropToRange(contextOf(project), range), 'Cropped to the range');
}

export function rangeFade(range: TimeRange, direction: 'in' | 'out'): void {
  const project = useProjectStore.getState().project;
  commit(
    fadeRange(contextOf(project), range, { direction }),
    direction === 'in' ? 'Faded in across the range' : 'Faded out across the range',
  );
}

export function hasRangeClipboard(): boolean {
  return clipboard !== null;
}

/**
 * Split an audio clip into the parts that are actually loud.
 *
 * The peak envelope is what decides — it is already computed for drawing, and
 * using it means the parts the musician was shown are the parts they get.
 */
export function stripSilenceFromClip(clipId: string): void {
  const project = useProjectStore.getState().project;
  const clip = project.clips.find((c) => c.id === clipId && c.type === 'audio') as
    AudioClip | undefined;
  if (!clip) return;
  const peaks = getPeaksSync(clip.mediaId);
  if (!peaks) {
    useUiStore.getState().toast('error', 'That clip’s waveform is not ready yet.');
    return;
  }
  const spans = stripSilence(clip, peaks, DEFAULT_STRIP_SILENCE);
  if (spans.length === 0) {
    useUiStore.getState().toast('error', 'That clip is silent all the way through.');
    return;
  }
  if (spans.length === 1 && spans[0].fromSec <= clip.offset + 1e-6) {
    useUiStore.getState().toast('info', 'Nothing quiet enough to strip.');
    return;
  }

  const secPerBeat = (clip.sourceDuration ?? peaks.duration) / Math.max(1e-6, clip.length);
  useProjectStore.getState().update((d) => {
    const index = d.clips.findIndex((c) => c.id === clipId);
    if (index < 0) return;
    const parts = spans.map((span, i) => ({
      ...structuredClone(clip),
      id: newId('clip'),
      name: `${clip.name} ${i + 1}`,
      start: clip.start + (span.fromSec - clip.offset) / secPerBeat,
      length: Math.max(1 / 64, (span.toSec - span.fromSec) / secPerBeat),
      offset: span.fromSec,
      sourceDuration: span.toSec - span.fromSec,
    }));
    d.clips.splice(index, 1, ...parts);
  });
  useUiStore.getState().toast('info', `Kept ${spans.length} part${spans.length === 1 ? '' : 's'}`);
}
