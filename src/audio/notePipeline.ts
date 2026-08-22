/**
 * Note pipeline: the notes a MIDI clip actually plays.
 *
 * A track's note effects (arpeggiator, chorder, repeater, filter, velocity
 * curve) never rewrite the stored performance — switching one off has to give
 * the written notes back exactly. So the expansion happens on the way to the
 * instrument, here, and both the live scheduler and the offline bounce read it
 * through this one function so they cannot disagree.
 *
 * The result is memoised per (clip, effect chain): the scheduler asks for a
 * clip's notes on every 25 ms tick, and an arpeggiator over a 6,000-note clip
 * is not something to recompute forty times a second. Both keys are immutable
 * objects that the store replaces on edit, so a stale entry is impossible.
 */
import { applyNoteFx } from '../model/noteFx';
import { beatsPerBarAt } from '../model/tempo';
import { tempoMapOf } from '../model/music';
import type { MidiClip, Note, NoteFx, ProjectData, Track } from '../model/types';

interface CacheEntry {
  fx: NoteFx[];
  bars: number;
  notes: Note[];
}

const cache = new WeakMap<MidiClip, CacheEntry>();

/** True when this track transforms its notes at all. */
export function hasNoteFx(track: Track | undefined): boolean {
  return !!track?.noteFx?.some((f) => !f.bypass);
}

/**
 * The notes to schedule for a clip, after the track's note effects.
 * Returns the clip's own array when there is nothing to apply, so the common
 * case allocates nothing.
 */
export function playedNotes(project: ProjectData, clip: MidiClip, track?: Track): Note[] {
  const fx = track?.noteFx;
  if (!fx?.length || !fx.some((f) => !f.bypass)) return clip.notes;

  const bars = beatsPerBarAt(tempoMapOf(project), clip.start);
  const hit = cache.get(clip);
  if (hit && hit.fx === fx && hit.bars === bars) return hit.notes;

  const notes = applyNoteFx(clip.notes, fx, { lengthBeats: clip.length, beatsPerBar: bars });
  cache.set(clip, { fx, bars, notes });
  return notes;
}
