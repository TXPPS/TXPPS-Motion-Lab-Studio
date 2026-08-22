/**
 * Range and time editing.
 *
 * A time range is a rectangle over the arrangement: a beat span and the tracks
 * it covers. Every operation here takes the clips, returns a complete new clip
 * list, and touches nothing else — no store, no engine, no DOM — so the caller
 * commits one result in one undoable step and a test can assert the exact
 * clips that come out.
 *
 * `splitClipsAtRange` is the primitive. Once both edges are cut, the range is
 * covered by whole clips, and delete / crop / duplicate / fade are all "keep or
 * drop or move these whole clips", which is why they agree with each other at
 * the boundaries.
 *
 * Every function is total. An empty range, a range that touches nothing, a
 * range that exactly meets a clip edge and a locked clip all produce a valid
 * clip list; locked material is never edited and is reported instead, so the
 * caller can say why the edit did less than the musician asked for.
 */
import { newId } from './ids';
import type { PeakData } from './media';
import { dbToLin } from './music';
import { avgSecPerBeat, type TempoMap } from './tempo';
import { beatToSource, type WarpMap } from './warp';
import type { AudioClip, Clip, CompSegment, FadeShape, MidiClip, Note } from './types';

/**
 * Beat comparisons are made to this tolerance. Edits arrive from a pointer and
 * from tempo-map arithmetic, so "the clip starts exactly where the range does"
 * has to survive a float rounding or the tools cut zero-length slivers.
 */
const EPS = 1e-6;

/** A clip may not consume less than this much source, so it stays playable. */
const MIN_SOURCE_SEC = 0.001;

export interface TimeRange {
  fromBeat: number;
  toBeat: number;
  /** Tracks the range covers. A range with no tracks edits nothing. */
  trackIds: readonly string[];
}

/** The part of a track these tools need: identity, and whether it is locked. */
export interface LockableTrack {
  id: string;
  locked?: boolean;
}

export interface RangeEditContext {
  clips: readonly Clip[];
  tracks: readonly LockableTrack[];
  tempoMap: TempoMap;
  /** Id factory, injected so a test can assert exact ids. */
  makeId?: (prefix: string) => string;
}

export interface RangeEditResult {
  /** The complete new clip list, including tracks the range never touched. */
  clips: Clip[];
  /** Clips left untouched because the clip or its track is locked. */
  lockedClipIds: string[];
  /** Tracks that refused new material because they are locked. */
  lockedTrackIds: string[];
  /**
   * Present when the edit moved everything after a point. Events the caller
   * owns — markers, sections, chords, tempo events — should move by the same
   * rule: anything at or after `fromBeat` shifts by `deltaBeats`.
   */
  ripple?: { fromBeat: number; deltaBeats: number };
}

// ---------------------------------------------------------------- internals

interface Internals {
  map: TempoMap;
  makeId: (prefix: string) => string;
  lockedTracks: Set<string>;
}

interface NormalRange {
  from: number;
  to: number;
  length: number;
  tracks: Set<string>;
}

function internals(ctx: RangeEditContext): Internals {
  const lockedTracks = new Set<string>();
  for (const t of ctx.tracks) if (t.locked) lockedTracks.add(t.id);
  return { map: ctx.tempoMap, makeId: ctx.makeId ?? newId, lockedTracks };
}

/** Accepts a range dragged in either direction, and refuses negative beats. */
function normalizeRange(range: TimeRange): NormalRange {
  const a = Number.isFinite(range.fromBeat) ? Math.max(0, range.fromBeat) : 0;
  const b = Number.isFinite(range.toBeat) ? Math.max(0, range.toBeat) : 0;
  const from = Math.min(a, b);
  const to = Math.max(a, b);
  return { from, to, length: to - from, tracks: new Set(range.trackIds) };
}

function cloneClip<T extends Clip>(clip: T): T {
  return structuredClone(clip);
}

function clipEnd(clip: Clip): number {
  return clip.start + clip.length;
}

/** Overlap that ignores a shared boundary: [0,4) does not overlap [4,8). */
function overlapsStrict(clip: Clip, from: number, to: number): boolean {
  return clip.start < to - EPS && clipEnd(clip) > from + EPS;
}

function coveredBy(clip: Clip, r: NormalRange): boolean {
  return clip.start >= r.from - EPS && clipEnd(clip) <= r.to + EPS && clip.length > EPS;
}

function isLocked(io: Internals, clip: Clip): boolean {
  return clip.locked === true || io.lockedTracks.has(clip.trackId);
}

/** Seconds of source a clip plays; v1 clips derive it from their musical length. */
function clipSourceDuration(map: TempoMap, clip: AudioClip): number {
  return clip.sourceDuration ?? clip.length * avgSecPerBeat(map, clip.start, clip.length);
}

/**
 * Source seconds consumed by the first `beats` of a clip.
 *
 * Without a warp map the clip consumes its source at one rate, so the split is
 * proportional — and proportional to the clip's own `sourceDuration`, which is
 * what keeps a stretched or tempo-following clip cutting where it sounds.
 */
function sourceSecondsInto(map: TempoMap, clip: AudioClip, beats: number): number {
  const total = clipSourceDuration(map, clip);
  if (clip.length <= EPS || beats <= 0) return 0;
  if (clip.warp) {
    const consumed = beatToSource(clip.warp, beats) - beatToSource(clip.warp, 0);
    return Math.min(total, Math.max(0, consumed));
  }
  return total * Math.min(1, beats / clip.length);
}

/**
 * Comp segments are beats from the clip start, so the right half starts with
 * whichever take was sounding at the cut and rebases the rest.
 */
function splitComp(comp: readonly CompSegment[], cutBeats: number): [CompSegment[], CompSegment[]] {
  const sorted = [...comp].sort((a, b) => a.at - b.at);
  const left = sorted.filter((s) => s.at < cutBeats - EPS).map((s) => ({ ...s }));
  const right: CompSegment[] = [];
  let active: CompSegment | undefined;
  for (const s of sorted) {
    if (s.at <= cutBeats + EPS) active = s;
    else right.push({ at: s.at - cutBeats, takeId: s.takeId });
  }
  if (active) right.unshift({ at: 0, takeId: active.takeId });
  return [left, right];
}

/**
 * Warp markers pin a media second to a beat measured from the clip start, so
 * the right half keeps its source positions and moves its beats to its own new
 * origin. Markers outside a half are dropped: beyond the last marker the map
 * continues at the source's recorded tempo, which is what a trimmed clip wants.
 */
function splitWarp(warp: WarpMap, cutBeats: number): [WarpMap, WarpMap] {
  return [
    {
      sourceBpm: warp.sourceBpm,
      markers: warp.markers.filter((m) => m.beat <= cutBeats + EPS).map((m) => ({ ...m })),
    },
    {
      sourceBpm: warp.sourceBpm,
      markers: warp.markers
        .filter((m) => m.beat >= cutBeats - EPS)
        .map((m) => ({ sourceSec: m.sourceSec, beat: m.beat - cutBeats })),
    },
  ];
}

function splitAudio(io: Internals, clip: AudioClip, atBeat: number): [AudioClip, AudioClip] {
  const leftLen = atBeat - clip.start;
  const total = clipSourceDuration(io.map, clip);
  const cutSec = sourceSecondsInto(io.map, clip, leftLen);
  const left = cloneClip(clip);
  const right = cloneClip(clip);

  left.length = leftLen;
  left.sourceDuration = Math.max(MIN_SOURCE_SEC, cutSec);
  right.id = io.makeId('c');
  right.name = `${clip.name}.2`;
  right.start = atBeat;
  right.length = clipEnd(clip) - atBeat;
  right.offset = clip.offset + cutSec;
  right.sourceDuration = Math.max(MIN_SOURCE_SEC, total - cutSec);

  // The cut is a butt joint: the fades that survive are the outer ones.
  left.fadeOut = 0;
  right.fadeIn = 0;
  left.fadeIn = Math.min(left.fadeIn, left.sourceDuration);
  right.fadeOut = Math.min(right.fadeOut, right.sourceDuration);

  if (clip.comp && clip.comp.length > 0) {
    const [lc, rc] = splitComp(clip.comp, leftLen);
    left.comp = lc;
    right.comp = rc;
  }
  if (clip.warp) {
    const [lw, rw] = splitWarp(clip.warp, leftLen);
    left.warp = lw;
    right.warp = rw;
  }
  return [left, right];
}

function splitMidi(io: Internals, clip: MidiClip, atBeat: number): [MidiClip, MidiClip] {
  const cut = atBeat - clip.start;
  const left = cloneClip(clip);
  const right = cloneClip(clip);
  left.length = cut;
  right.id = io.makeId('c');
  right.name = `${clip.name}.2`;
  right.start = atBeat;
  right.length = clipEnd(clip) - atBeat;

  const leftNotes: Note[] = [];
  const rightNotes: Note[] = [];
  for (const n of clip.notes) {
    const end = n.start + n.length;
    if (end <= cut + EPS) {
      leftNotes.push({ ...n });
    } else if (n.start >= cut - EPS) {
      rightNotes.push({ ...n, id: io.makeId('n'), start: n.start - cut });
    } else {
      // A range edit cuts time, so a note across the boundary is cut too: the
      // clip tool's "the note goes with its start" would silence half a bar of
      // held material that the musician can still see either side of the cut.
      leftNotes.push({ ...n, length: cut - n.start });
      rightNotes.push({ ...n, id: io.makeId('n'), start: 0, length: end - cut });
    }
  }
  left.notes = leftNotes;
  right.notes = rightNotes;
  return [left, right];
}

/** Split one clip, or return it alone when the beat is not strictly inside it. */
function splitAt(io: Internals, clip: Clip, atBeat: number): Clip[] {
  if (atBeat <= clip.start + EPS || atBeat >= clipEnd(clip) - EPS) return [clip];
  return clip.type === 'audio' ? splitAudio(io, clip, atBeat) : splitMidi(io, clip, atBeat);
}

interface SplitOutcome {
  clips: Clip[];
  locked: string[];
}

function splitCovering(
  ctx: RangeEditContext,
  io: Internals,
  r: NormalRange,
  respectLocks: boolean,
): SplitOutcome {
  const clips: Clip[] = [];
  const locked: string[] = [];
  for (const source of ctx.clips) {
    const clip = cloneClip(source);
    if (r.length <= EPS || !r.tracks.has(clip.trackId) || !overlapsStrict(clip, r.from, r.to)) {
      clips.push(clip);
      continue;
    }
    if (respectLocks && isLocked(io, clip)) {
      locked.push(clip.id);
      clips.push(clip);
      continue;
    }
    for (const piece of splitAt(io, clip, r.from)) clips.push(...splitAt(io, piece, r.to));
  }
  return { clips, locked };
}

// ------------------------------------------------------------------- splits

/**
 * Split every clip the range crosses at both edges, so the range is covered by
 * whole clips. Clips that merely touch an edge are left whole. Locked clips
 * inside the range are left alone and reported.
 */
export function splitClipsAtRange(ctx: RangeEditContext, range: TimeRange): RangeEditResult {
  const io = internals(ctx);
  const r = normalizeRange(range);
  const out = splitCovering(ctx, io, r, true);
  return { clips: out.clips, lockedClipIds: out.locked, lockedTrackIds: [] };
}

// ------------------------------------------------------------------ delete

export interface DeleteRangeOptions {
  /** Close the gap by moving later material earlier. */
  ripple?: boolean;
  /**
   * Which tracks the ripple moves. 'range' (the default) moves only the tracks
   * the range covers; 'global' moves every track, which is what "delete time"
   * means and is only right when the caller knows the range spans the song.
   * The range's own tracks always decide what is *deleted*.
   */
  rippleScope?: 'range' | 'global';
}

export function deleteRange(
  ctx: RangeEditContext,
  range: TimeRange,
  opts: DeleteRangeOptions = {},
): RangeEditResult {
  const io = internals(ctx);
  const r = normalizeRange(range);
  const split = splitCovering(ctx, io, r, true);
  const lockedClipIds = new Set(split.locked);

  const kept: Clip[] = [];
  for (const clip of split.clips) {
    // The length guard matters: an empty range has no inside, and every clip
    // around it would otherwise read as overlapping it.
    const inRange =
      r.length > EPS && r.tracks.has(clip.trackId) && overlapsStrict(clip, r.from, r.to);
    if (inRange && !isLocked(io, clip)) continue;
    kept.push(clip);
  }

  const shift = opts.ripple && r.length > EPS ? -r.length : 0;
  if (shift !== 0) {
    for (const clip of kept) {
      const scoped = opts.rippleScope === 'global' || r.tracks.has(clip.trackId);
      if (!scoped || clip.start < r.to - EPS) continue;
      if (isLocked(io, clip)) {
        // A locked clip holds its position, which is the point of locking it,
        // so the gap does not close on that track.
        lockedClipIds.add(clip.id);
        continue;
      }
      clip.start = Math.max(0, clip.start + shift);
    }
  }

  return {
    clips: kept,
    lockedClipIds: [...lockedClipIds],
    lockedTrackIds: [],
    ...(shift !== 0 ? { ripple: { fromBeat: r.to, deltaBeats: shift } } : {}),
  };
}

// ------------------------------------------------------------------ insert

/**
 * Push material at or after `atBeat` later by `lengthBeats`, splitting any clip
 * the insertion point falls inside. Pass every track id for a global insert.
 */
export function insertSilence(
  ctx: RangeEditContext,
  atBeat: number,
  lengthBeats: number,
  trackIds: readonly string[],
): RangeEditResult {
  const io = internals(ctx);
  const at = Number.isFinite(atBeat) ? Math.max(0, atBeat) : 0;
  const len = Number.isFinite(lengthBeats) ? Math.max(0, lengthBeats) : 0;
  const tracks = new Set(trackIds);

  const clips: Clip[] = [];
  const lockedClipIds: string[] = [];
  for (const source of ctx.clips) {
    const clip = cloneClip(source);
    const affected =
      len > EPS && tracks.has(clip.trackId) && (clip.start >= at - EPS || clipEnd(clip) > at + EPS);
    if (!affected) {
      clips.push(clip);
      continue;
    }
    if (isLocked(io, clip)) {
      lockedClipIds.push(clip.id);
      clips.push(clip);
      continue;
    }
    for (const piece of splitAt(io, clip, at)) {
      if (piece.start >= at - EPS) piece.start += len;
      clips.push(piece);
    }
  }

  return {
    clips,
    lockedClipIds,
    lockedTrackIds: [],
    ...(len > EPS ? { ripple: { fromBeat: at, deltaBeats: len } } : {}),
  };
}

// --------------------------------------------------------------- clipboard

/** One clipboard entry: a clip whose `start` is measured from the range start. */
export interface RangeClipboardClip {
  /** Index into the payload's `tracks`, so a paste can map onto other tracks. */
  trackIndex: number;
  clip: Clip;
}

/**
 * A portable range: beats relative to the range start and tracks by position,
 * so the payload survives being pasted at another time, onto other tracks, or
 * into another project.
 */
export interface RangeClipboard {
  kind: 'range';
  lengthBeats: number;
  /** Source track ids in range order; only their order is meaningful on paste. */
  tracks: string[];
  clips: RangeClipboardClip[];
}

export function copyRange(ctx: RangeEditContext, range: TimeRange): RangeClipboard {
  const io = internals(ctx);
  const r = normalizeRange(range);
  const tracks = [...new Set(range.trackIds)];
  const board: RangeClipboard = { kind: 'range', lengthBeats: r.length, tracks, clips: [] };
  if (r.length <= EPS) return board;

  // Locks are ignored here: copying reads the arrangement, it never edits it.
  for (const clip of splitCovering(ctx, io, r, false).clips) {
    const trackIndex = tracks.indexOf(clip.trackId);
    if (trackIndex < 0 || !coveredBy(clip, r)) continue;
    const copy = cloneClip(clip);
    copy.start = clip.start - r.from;
    board.clips.push({ trackIndex, clip: copy });
  }
  return board;
}

export interface PasteOptions {
  /** Push existing material later by the payload length instead of overwriting it. */
  insert?: boolean;
}

/**
 * Paste a payload so its first beat lands on `atBeat`. Entries whose track
 * index has no target are dropped, and a locked target track takes nothing and
 * is reported.
 */
export function pasteRangeAt(
  ctx: RangeEditContext,
  board: RangeClipboard,
  atBeat: number,
  targetTrackIds: readonly string[],
  opts: PasteOptions = {},
): RangeEditResult {
  const io = internals(ctx);
  const at = Number.isFinite(atBeat) ? Math.max(0, atBeat) : 0;
  const len = Math.max(0, board.lengthBeats);

  const cleared = opts.insert
    ? insertSilence(ctx, at, len, targetTrackIds)
    : deleteRange(ctx, { fromBeat: at, toBeat: at + len, trackIds: targetTrackIds }, {});

  const clips = cleared.clips;
  const lockedTrackIds = new Set<string>();
  for (const entry of board.clips) {
    const trackId = targetTrackIds[entry.trackIndex];
    if (trackId === undefined) continue;
    if (io.lockedTracks.has(trackId)) {
      lockedTrackIds.add(trackId);
      continue;
    }
    const clip = cloneClip(entry.clip);
    clip.id = io.makeId('c');
    clip.trackId = trackId;
    clip.start = at + entry.clip.start;
    if (clip.type === 'midi') clip.notes = clip.notes.map((n) => ({ ...n, id: io.makeId('n') }));
    clips.push(clip);
  }

  return {
    clips,
    lockedClipIds: cleared.lockedClipIds,
    lockedTrackIds: [...lockedTrackIds],
    ...(cleared.ripple ? { ripple: cleared.ripple } : {}),
  };
}

/** Copy the range and drop the copy immediately after it, on the same tracks. */
export function duplicateRange(
  ctx: RangeEditContext,
  range: TimeRange,
  opts: PasteOptions = {},
): RangeEditResult {
  const r = normalizeRange(range);
  const board = copyRange(ctx, range);
  return pasteRangeAt(ctx, board, r.to, board.tracks, opts);
}

// -------------------------------------------------------------------- crop

/**
 * Keep only what the range covers on its tracks; everything else on those
 * tracks goes. Other tracks are untouched, and material keeps its position —
 * cropping decides what survives, not where it sits. An empty range crops
 * nothing, as every operation here treats an empty range as no edit at all.
 */
export function cropToRange(ctx: RangeEditContext, range: TimeRange): RangeEditResult {
  const io = internals(ctx);
  const r = normalizeRange(range);
  if (r.length <= EPS) {
    return { clips: ctx.clips.map(cloneClip), lockedClipIds: [], lockedTrackIds: [] };
  }
  const split = splitCovering(ctx, io, r, true);
  const lockedClipIds = new Set(split.locked);

  const kept: Clip[] = [];
  for (const clip of split.clips) {
    if (!r.tracks.has(clip.trackId) || coveredBy(clip, r)) {
      kept.push(clip);
      continue;
    }
    // Everything else on a covered track is outside the crop, so it goes —
    // unless it is locked, which outranks the crop.
    if (isLocked(io, clip)) {
      lockedClipIds.add(clip.id);
      kept.push(clip);
    }
  }
  return { clips: kept, lockedClipIds: [...lockedClipIds], lockedTrackIds: [] };
}

// -------------------------------------------------------------------- fade

export interface FadeRangeOptions {
  direction: 'in' | 'out';
  /** Fade curve; the clip's existing shape is kept when this is absent. */
  shape?: FadeShape;
}

/**
 * Fade across the whole range: silent at the range start for 'in', silent at
 * the range end for 'out'.
 *
 * With one clip under the range — the ordinary case — this is exact: the clip
 * is cut at both edges and the covered piece carries a fade the length of its
 * own source, so the level is 0 at one edge and full at the other.
 *
 * Where several clips tile the range the ramp becomes a staircase: a clip in
 * the middle of the ramp would have to start at a level above silence, and the
 * schema gives a clip one gain plus fades anchored at its own ends, so those
 * clips take a constant gain — the ramp's value at their midpoint — instead.
 * MIDI clips have no fades and are left alone.
 */
export function fadeRange(
  ctx: RangeEditContext,
  range: TimeRange,
  opts: FadeRangeOptions,
): RangeEditResult {
  const io = internals(ctx);
  const r = normalizeRange(range);
  const split = splitCovering(ctx, io, r, true);
  const lockedClipIds = new Set(split.locked);
  if (r.length <= EPS) {
    return { clips: split.clips, lockedClipIds: [...lockedClipIds], lockedTrackIds: [] };
  }

  const ramp = (beat: number): number => {
    const t = Math.min(1, Math.max(0, (beat - r.from) / r.length));
    return opts.direction === 'in' ? t : 1 - t;
  };

  const covered = split.clips
    .filter((c): c is AudioClip => c.type === 'audio' && r.tracks.has(c.trackId) && coveredBy(c, r))
    .sort((a, b) => a.start - b.start);

  for (let i = 0; i < covered.length; i++) {
    const clip = covered[i];
    if (isLocked(io, clip)) {
      lockedClipIds.add(clip.id);
      continue;
    }
    const dur = clipSourceDuration(io.map, clip);
    // The clip at the silent edge is the only one that can carry the ramp.
    const atSilentEdge = opts.direction === 'in' ? i === 0 : i === covered.length - 1;
    if (atSilentEdge) {
      const loud = opts.direction === 'in' ? ramp(clipEnd(clip)) : ramp(clip.start);
      clip.gain *= loud;
      if (opts.direction === 'in') {
        clip.fadeIn = dur;
        clip.fadeOut = 0;
        if (opts.shape) clip.fadeInShape = opts.shape;
      } else {
        clip.fadeOut = dur;
        clip.fadeIn = 0;
        if (opts.shape) clip.fadeOutShape = opts.shape;
      }
    } else {
      clip.gain *= ramp((clip.start + clipEnd(clip)) / 2);
      clip.fadeIn = Math.min(clip.fadeIn, dur);
      clip.fadeOut = Math.min(clip.fadeOut, Math.max(0, dur - clip.fadeIn));
    }
  }

  return { clips: split.clips, lockedClipIds: [...lockedClipIds], lockedTrackIds: [] };
}

// ------------------------------------------------------------ strip silence

export interface StripSilenceOptions {
  /** Envelope below this level counts as silence, in dBFS. */
  thresholdDb: number;
  /** Silence shorter than this is not worth a cut, and is kept. */
  minSilenceSec: number;
  /** Kept parts shorter than this are dropped as noise. */
  minPartSec: number;
  /** Seconds kept before a part, so an attack is never clipped. */
  padBeforeSec: number;
  /** Seconds kept after a part, so a decay is not cut off. */
  padAfterSec: number;
}

/** A part of the source worth keeping, in SOURCE seconds. */
export interface KeptSpan {
  fromSec: number;
  toSec: number;
}

export const DEFAULT_STRIP_SILENCE: StripSilenceOptions = {
  thresholdDb: -40,
  minSilenceSec: 0.25,
  minPartSec: 0.1,
  padBeforeSec: 0.02,
  padAfterSec: 0.05,
};

/**
 * Split an audio clip into the parts that are actually loud.
 *
 * The peak envelope decides, not the samples: it is already computed for
 * drawing, one bucket is far finer than any musical silence, and using it means
 * the parts the musician is shown are the parts they get. The returned spans
 * are in source seconds within the clip's own window — the caller turns them
 * into clips, which is where locking, ids and undo belong.
 *
 * With no envelope to read, the whole window is kept: silence detection that
 * cannot see the audio must never be the thing that deletes it.
 */
export function stripSilence(
  clip: AudioClip,
  peaks: PeakData,
  opts: StripSilenceOptions = DEFAULT_STRIP_SILENCE,
): KeptSpan[] {
  const winFrom = Math.max(0, clip.offset);
  const sourceDur = clip.sourceDuration ?? peaks.duration - winFrom;
  const winTo = Math.min(peaks.duration, winFrom + Math.max(0, sourceDur));
  if (winTo - winFrom <= 0) return [];
  if (peaks.buckets <= 0 || peaks.channels <= 0 || peaks.duration <= 0) {
    return [{ fromSec: winFrom, toSec: winTo }];
  }

  const bucketSec = peaks.duration / peaks.buckets;
  const threshold = dbToLin(opts.thresholdDb);
  const first = Math.max(0, Math.floor(winFrom / bucketSec));
  const last = Math.min(peaks.buckets - 1, Math.ceil(winTo / bucketSec) - 1);

  const loudAt = (bucket: number): boolean => {
    for (let ch = 0; ch < peaks.channels; ch++) {
      const i = ch * peaks.buckets + bucket;
      if (Math.max(Math.abs(peaks.min[i]), Math.abs(peaks.max[i])) >= threshold) return true;
    }
    return false;
  };

  // Runs of loud buckets, with short gaps swallowed: a gap under minSilenceSec
  // is a rest inside a phrase, not a place to cut.
  const runs: KeptSpan[] = [];
  let runFrom = -1;
  let runTo = -1;
  for (let b = first; b <= last; b++) {
    if (!loudAt(b)) continue;
    const from = b * bucketSec;
    const to = from + bucketSec;
    if (runFrom < 0) {
      runFrom = from;
      runTo = to;
    } else if (from - runTo < Math.max(0, opts.minSilenceSec)) {
      runTo = to;
    } else {
      runs.push({ fromSec: runFrom, toSec: runTo });
      runFrom = from;
      runTo = to;
    }
  }
  if (runFrom >= 0) runs.push({ fromSec: runFrom, toSec: runTo });

  const padded: KeptSpan[] = [];
  for (const run of runs) {
    const span = {
      fromSec: Math.max(winFrom, run.fromSec - Math.max(0, opts.padBeforeSec)),
      toSec: Math.min(winTo, run.toSec + Math.max(0, opts.padAfterSec)),
    };
    const prev = padded[padded.length - 1];
    // Padding can make two parts meet; a joined pair is one part, not two.
    if (prev && span.fromSec <= prev.toSec) prev.toSec = Math.max(prev.toSec, span.toSec);
    else padded.push(span);
  }

  return padded.filter((s) => s.toSec - s.fromSec >= Math.max(0, opts.minPartSec));
}
