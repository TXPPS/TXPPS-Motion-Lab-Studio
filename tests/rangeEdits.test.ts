import { beforeEach, describe, expect, it } from 'vitest';
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
  type RangeEditContext,
} from '../src/model/rangeEdits';
import { DEFAULT_TEMPO_MAP } from '../src/model/tempo';
import type { PeakData } from '../src/model/media';
import type { AudioClip, Clip, MidiClip } from '../src/model/types';

/** Ids have to be predictable for a test to name the piece it is asserting on. */
let ids = 0;
const makeId = (prefix: string): string => `${prefix}${++ids}`;
beforeEach(() => {
  ids = 0;
});

/** The default map is 120 bpm 4/4, so one beat is half a second of source. */
function audio(over: Partial<AudioClip> & Pick<AudioClip, 'id' | 'trackId'>): AudioClip {
  const start = over.start ?? 0;
  const length = over.length ?? 8;
  return {
    type: 'audio',
    name: over.id,
    start,
    length,
    muted: false,
    mediaId: 'm1',
    offset: 0,
    sourceDuration: length * 0.5,
    gain: 1,
    fadeIn: 0,
    fadeOut: 0,
    ...over,
  };
}

function midi(over: Partial<MidiClip> & Pick<MidiClip, 'id' | 'trackId'>): MidiClip {
  return {
    type: 'midi',
    name: over.id,
    start: 0,
    length: 8,
    muted: false,
    notes: [],
    ...over,
  };
}

function ctxOf(clips: Clip[], locked: string[] = []): RangeEditContext {
  return {
    clips,
    tracks: [
      { id: 't1', locked: locked.includes('t1') },
      { id: 't2', locked: locked.includes('t2') },
    ],
    tempoMap: DEFAULT_TEMPO_MAP,
    makeId,
  };
}

const byStart = (a: Clip, b: Clip): number => a.start - b.start;
const onTrack = (clips: Clip[], trackId: string): Clip[] =>
  clips.filter((c) => c.trackId === trackId).sort(byStart);

describe('splitClipsAtRange', () => {
  it('cuts both edges so the range is covered by whole clips', () => {
    const ctx = ctxOf([audio({ id: 'a', trackId: 't1' })]);
    const out = splitClipsAtRange(ctx, { fromBeat: 2, toBeat: 6, trackIds: ['t1'] });
    const pieces = onTrack(out.clips, 't1') as AudioClip[];
    expect(pieces.map((c) => [c.start, c.length])).toEqual([
      [0, 2],
      [2, 4],
      [6, 2],
    ]);
    // Each piece plays its own share of the source, in order and without gaps.
    expect(pieces.map((c) => c.offset)).toEqual([0, 1, 3]);
    expect(pieces.map((c) => c.sourceDuration)).toEqual([1, 2, 1]);
  });

  it('leaves a clip whole when the range only touches its boundary', () => {
    const ctx = ctxOf([audio({ id: 'a', trackId: 't1' })]);
    const out = splitClipsAtRange(ctx, { fromBeat: 8, toBeat: 12, trackIds: ['t1'] });
    expect(out.clips).toHaveLength(1);
    expect(out.clips[0].id).toBe('a');
    expect(out.clips[0].length).toBe(8);
  });

  it('changes nothing for an empty range, a foreign track or a range past the end', () => {
    const ctx = ctxOf([audio({ id: 'a', trackId: 't1' })]);
    for (const range of [
      { fromBeat: 4, toBeat: 4, trackIds: ['t1'] },
      { fromBeat: 2, toBeat: 6, trackIds: ['t2'] },
      { fromBeat: 40, toBeat: 44, trackIds: ['t1'] },
      { fromBeat: 2, toBeat: 6, trackIds: [] },
    ]) {
      const out = splitClipsAtRange(ctx, range);
      expect(out.clips).toHaveLength(1);
      expect(out.clips[0]).toEqual(ctx.clips[0]);
    }
  });

  it('reads a range dragged backwards the same as one dragged forwards', () => {
    const ctx = ctxOf([audio({ id: 'a', trackId: 't1' })]);
    const back = splitClipsAtRange(ctx, { fromBeat: 6, toBeat: 2, trackIds: ['t1'] });
    expect(back.clips.map((c) => c.start).sort((a, b) => a - b)).toEqual([0, 2, 6]);
  });

  it('skips a locked clip and a clip on a locked track, and names both', () => {
    const locked = ctxOf([audio({ id: 'a', trackId: 't1', locked: true })]);
    const out = splitClipsAtRange(locked, { fromBeat: 2, toBeat: 6, trackIds: ['t1'] });
    expect(out.clips).toHaveLength(1);
    expect(out.lockedClipIds).toEqual(['a']);

    const lockedTrack = ctxOf([audio({ id: 'b', trackId: 't1' })], ['t1']);
    const out2 = splitClipsAtRange(lockedTrack, { fromBeat: 2, toBeat: 6, trackIds: ['t1'] });
    expect(out2.clips).toHaveLength(1);
    expect(out2.lockedClipIds).toEqual(['b']);
  });

  it('cuts a note that crosses the edge instead of dropping half of it', () => {
    const ctx = ctxOf([
      midi({
        id: 'm',
        trackId: 't1',
        notes: [{ id: 'n1', start: 1, length: 3, pitch: 60, velocity: 100 }],
      }),
    ]);
    const out = splitClipsAtRange(ctx, { fromBeat: 2, toBeat: 6, trackIds: ['t1'] });
    const pieces = onTrack(out.clips, 't1') as MidiClip[];
    expect(pieces[0].notes).toEqual([{ id: 'n1', start: 1, length: 1, pitch: 60, velocity: 100 }]);
    // The tail is a second note now, so it needs an id of its own.
    expect(pieces[1].notes[0]).toMatchObject({ start: 0, length: 2, pitch: 60, velocity: 100 });
    expect(pieces[1].notes[0].id).not.toBe('n1');
    expect(pieces[2].notes).toEqual([]);
    const sounding = pieces.flatMap((p) => p.notes).reduce((s, n) => s + n.length, 0);
    expect(sounding).toBe(3);
  });
});

describe('deleteRange', () => {
  it('clears the range and leaves the hole when it does not ripple', () => {
    const ctx = ctxOf([audio({ id: 'a', trackId: 't1' })]);
    const out = deleteRange(ctx, { fromBeat: 2, toBeat: 6, trackIds: ['t1'] });
    expect(onTrack(out.clips, 't1').map((c) => [c.start, c.length])).toEqual([
      [0, 2],
      [6, 2],
    ]);
    expect(out.ripple).toBeUndefined();
  });

  it('closes the gap on the range tracks when it ripples', () => {
    const ctx = ctxOf([
      audio({ id: 'a', trackId: 't1' }),
      audio({ id: 'b', trackId: 't1', start: 8, length: 4 }),
      audio({ id: 'c', trackId: 't2', start: 8, length: 4 }),
    ]);
    const out = deleteRange(ctx, { fromBeat: 2, toBeat: 6, trackIds: ['t1'] }, { ripple: true });
    expect(onTrack(out.clips, 't1').map((c) => [c.start, c.length])).toEqual([
      [0, 2],
      [2, 2],
      [4, 4],
    ]);
    // A ripple scoped to the range must not disturb a track outside it.
    expect(onTrack(out.clips, 't2').map((c) => c.start)).toEqual([8]);
    expect(out.ripple).toEqual({ fromBeat: 6, deltaBeats: -4 });
  });

  it('moves every track when the caller asks for a global ripple', () => {
    const ctx = ctxOf([
      audio({ id: 'a', trackId: 't1' }),
      audio({ id: 'c', trackId: 't2', start: 8, length: 4 }),
    ]);
    const out = deleteRange(
      ctx,
      { fromBeat: 2, toBeat: 6, trackIds: ['t1'] },
      { ripple: true, rippleScope: 'global' },
    );
    expect(onTrack(out.clips, 't2').map((c) => c.start)).toEqual([4]);
  });

  it('keeps a locked clip, reports it, and holds its position through a ripple', () => {
    const ctx = ctxOf([
      audio({ id: 'a', trackId: 't1', start: 2, length: 4, locked: true }),
      audio({ id: 'b', trackId: 't1', start: 8, length: 4, locked: true }),
    ]);
    const out = deleteRange(ctx, { fromBeat: 2, toBeat: 6, trackIds: ['t1'] }, { ripple: true });
    expect(onTrack(out.clips, 't1').map((c) => c.start)).toEqual([2, 8]);
    expect([...out.lockedClipIds].sort()).toEqual(['a', 'b']);
  });

  it('is a no-op for an empty range', () => {
    const ctx = ctxOf([audio({ id: 'a', trackId: 't1' })]);
    const out = deleteRange(ctx, { fromBeat: 4, toBeat: 4, trackIds: ['t1'] }, { ripple: true });
    expect(out.clips).toEqual(ctx.clips);
    expect(out.ripple).toBeUndefined();
  });
});

describe('insertSilence', () => {
  it('splits the clip the insertion point falls inside and pushes the rest later', () => {
    const ctx = ctxOf([audio({ id: 'a', trackId: 't1' })]);
    const out = insertSilence(ctx, 4, 2, ['t1']);
    const pieces = onTrack(out.clips, 't1') as AudioClip[];
    expect(pieces.map((c) => [c.start, c.length])).toEqual([
      [0, 4],
      [6, 4],
    ]);
    expect(pieces[1].offset).toBe(2);
    expect(out.ripple).toEqual({ fromBeat: 4, deltaBeats: 2 });
  });

  it('pushes without splitting when the point falls on a clip boundary', () => {
    const ctx = ctxOf([audio({ id: 'a', trackId: 't1', start: 4, length: 4 })]);
    const out = insertSilence(ctx, 4, 2, ['t1']);
    expect(out.clips).toHaveLength(1);
    expect(out.clips[0].start).toBe(6);
    expect(out.clips[0].id).toBe('a');
  });

  it('does nothing for zero length, an untouched track, or a point past the end', () => {
    const ctx = ctxOf([audio({ id: 'a', trackId: 't1' })]);
    expect(insertSilence(ctx, 4, 0, ['t1']).clips).toEqual(ctx.clips);
    expect(insertSilence(ctx, 4, 2, ['t2']).clips).toEqual(ctx.clips);
    expect(insertSilence(ctx, 40, 2, ['t1']).clips).toEqual(ctx.clips);
  });

  it('leaves a locked clip where it is and reports it', () => {
    const ctx = ctxOf([audio({ id: 'a', trackId: 't1', locked: true })]);
    const out = insertSilence(ctx, 4, 2, ['t1']);
    expect(out.clips[0].start).toBe(0);
    expect(out.clips[0].length).toBe(8);
    expect(out.lockedClipIds).toEqual(['a']);
  });
});

describe('copy, paste and duplicate', () => {
  it('stores beats relative to the range start and tracks by position', () => {
    const ctx = ctxOf([
      audio({ id: 'a', trackId: 't1', start: 2, length: 2 }),
      audio({ id: 'b', trackId: 't2', start: 4, length: 4 }),
    ]);
    const board = copyRange(ctx, { fromBeat: 2, toBeat: 6, trackIds: ['t1', 't2'] });
    expect(board.lengthBeats).toBe(4);
    expect(board.tracks).toEqual(['t1', 't2']);
    expect(board.clips.map((e) => [e.trackIndex, e.clip.start, e.clip.length])).toEqual([
      [0, 0, 2],
      [1, 2, 2],
    ]);
  });

  it('copies a locked clip, because copying does not edit', () => {
    const ctx = ctxOf([audio({ id: 'a', trackId: 't1', locked: true })]);
    const board = copyRange(ctx, { fromBeat: 2, toBeat: 6, trackIds: ['t1'] });
    expect(board.clips).toHaveLength(1);
    expect(board.clips[0].clip.length).toBe(4);
    expect(ctx.clips[0].length).toBe(8);
  });

  it('pastes over the destination and keeps the relative layout', () => {
    const ctx = ctxOf([
      audio({ id: 'a', trackId: 't1', start: 0, length: 4 }),
      audio({ id: 'b', trackId: 't1', start: 10, length: 4 }),
    ]);
    const board = copyRange(ctx, { fromBeat: 0, toBeat: 4, trackIds: ['t1'] });
    const out = pasteRangeAt(ctx, board, 11, ['t1']);
    expect(onTrack(out.clips, 't1').map((c) => [c.start, c.length])).toEqual([
      [0, 4],
      [10, 1],
      [11, 4],
    ]);
  });

  it('pushes the destination later when asked to insert', () => {
    const ctx = ctxOf([audio({ id: 'a', trackId: 't1', start: 0, length: 4 })]);
    const board = copyRange(ctx, { fromBeat: 0, toBeat: 4, trackIds: ['t1'] });
    const out = pasteRangeAt(ctx, board, 2, ['t1'], { insert: true });
    expect(onTrack(out.clips, 't1').map((c) => [c.start, c.length])).toEqual([
      [0, 2],
      [2, 4],
      [6, 2],
    ]);
  });

  it('gives every pasted clip and note a new id', () => {
    const ctx = ctxOf([
      midi({
        id: 'm',
        trackId: 't1',
        notes: [{ id: 'n1', start: 0, length: 1, pitch: 60, velocity: 90 }],
      }),
    ]);
    const board = copyRange(ctx, { fromBeat: 0, toBeat: 4, trackIds: ['t1'] });
    const out = pasteRangeAt(ctx, board, 8, ['t1']);
    const pasted = onTrack(out.clips, 't1').at(-1) as MidiClip;
    expect(pasted.id).not.toBe('m');
    expect(pasted.notes[0].id).not.toBe('n1');
    expect(pasted.notes[0].pitch).toBe(60);
  });

  it('drops entries with no target track and refuses a locked target', () => {
    const ctx = ctxOf(
      [audio({ id: 'a', trackId: 't1', length: 4 }), audio({ id: 'b', trackId: 't2', length: 4 })],
      ['t2'],
    );
    const board = copyRange(ctx, { fromBeat: 0, toBeat: 4, trackIds: ['t1', 't2'] });

    const narrow = pasteRangeAt(ctx, board, 8, ['t1']);
    expect(onTrack(narrow.clips, 't1')).toHaveLength(2);
    expect(onTrack(narrow.clips, 't2')).toHaveLength(1);

    const onLocked = pasteRangeAt(ctx, board, 8, ['t2', 't1']);
    expect(onLocked.lockedTrackIds).toEqual(['t2']);
    expect(onTrack(onLocked.clips, 't2')).toHaveLength(1);
  });

  it('duplicates a range directly after itself', () => {
    const ctx = ctxOf([audio({ id: 'a', trackId: 't1', start: 0, length: 4 })]);
    const out = duplicateRange(ctx, { fromBeat: 0, toBeat: 4, trackIds: ['t1'] });
    expect(onTrack(out.clips, 't1').map((c) => [c.start, c.length])).toEqual([
      [0, 4],
      [4, 4],
    ]);
  });

  it('duplicates nothing for an empty range', () => {
    const ctx = ctxOf([audio({ id: 'a', trackId: 't1' })]);
    const out = duplicateRange(ctx, { fromBeat: 4, toBeat: 4, trackIds: ['t1'] });
    expect(out.clips).toEqual(ctx.clips);
  });
});

describe('cropToRange', () => {
  it('keeps only what the range covers, on the range tracks', () => {
    const ctx = ctxOf([
      audio({ id: 'a', trackId: 't1', start: 0, length: 8 }),
      audio({ id: 'b', trackId: 't1', start: 12, length: 4 }),
      audio({ id: 'c', trackId: 't2', start: 12, length: 4 }),
    ]);
    const out = cropToRange(ctx, { fromBeat: 2, toBeat: 6, trackIds: ['t1'] });
    expect(onTrack(out.clips, 't1').map((c) => [c.start, c.length])).toEqual([[2, 4]]);
    expect(onTrack(out.clips, 't2').map((c) => c.start)).toEqual([12]);
  });

  it('keeps a locked clip outside the range and reports it', () => {
    const ctx = ctxOf([
      audio({ id: 'a', trackId: 't1', start: 0, length: 4 }),
      audio({ id: 'b', trackId: 't1', start: 12, length: 4, locked: true }),
    ]);
    const out = cropToRange(ctx, { fromBeat: 0, toBeat: 4, trackIds: ['t1'] });
    expect(onTrack(out.clips, 't1').map((c) => c.id)).toEqual(['a', 'b']);
    expect(out.lockedClipIds).toEqual(['b']);
  });

  it('crops nothing for an empty range', () => {
    const ctx = ctxOf([audio({ id: 'a', trackId: 't1' })]);
    expect(cropToRange(ctx, { fromBeat: 4, toBeat: 4, trackIds: ['t1'] }).clips).toEqual(ctx.clips);
  });
});

describe('fadeRange', () => {
  it('fades one clip across the whole range and leaves it at full level after', () => {
    const ctx = ctxOf([audio({ id: 'a', trackId: 't1', length: 8 })]);
    const out = fadeRange(
      ctx,
      { fromBeat: 0, toBeat: 4, trackIds: ['t1'] },
      {
        direction: 'in',
        shape: 'equalPower',
      },
    );
    const pieces = onTrack(out.clips, 't1') as AudioClip[];
    expect(pieces[0].fadeIn).toBe(pieces[0].sourceDuration);
    expect(pieces[0].fadeIn).toBe(2);
    expect(pieces[0].gain).toBe(1);
    expect(pieces[0].fadeInShape).toBe('equalPower');
    expect(pieces[1].fadeIn).toBe(0);
    expect(pieces[1].gain).toBe(1);
  });

  it('fades out across the range, silent at the range end', () => {
    const ctx = ctxOf([audio({ id: 'a', trackId: 't1', length: 8 })]);
    const out = fadeRange(ctx, { fromBeat: 4, toBeat: 8, trackIds: ['t1'] }, { direction: 'out' });
    const pieces = onTrack(out.clips, 't1') as AudioClip[];
    expect(pieces[0].fadeOut).toBe(0);
    expect(pieces[1].fadeOut).toBe(pieces[1].sourceDuration);
    expect(pieces[1].gain).toBe(1);
  });

  it('steps the gain down across several clips, the last one reaching silence', () => {
    const ctx = ctxOf([
      audio({ id: 'a', trackId: 't1', start: 0, length: 4 }),
      audio({ id: 'b', trackId: 't1', start: 4, length: 4 }),
    ]);
    const out = fadeRange(ctx, { fromBeat: 0, toBeat: 8, trackIds: ['t1'] }, { direction: 'out' });
    const pieces = onTrack(out.clips, 't1') as AudioClip[];
    expect(pieces[0].gain).toBeCloseTo(0.75, 12);
    expect(pieces[0].fadeOut).toBe(0);
    expect(pieces[1].gain).toBeCloseTo(0.5, 12);
    expect(pieces[1].fadeOut).toBe(pieces[1].sourceDuration);
  });

  it('leaves a locked clip and a MIDI clip alone', () => {
    const ctx = ctxOf([
      audio({ id: 'a', trackId: 't1', length: 4, locked: true }),
      midi({ id: 'm', trackId: 't2', length: 4 }),
    ]);
    const out = fadeRange(
      ctx,
      { fromBeat: 0, toBeat: 4, trackIds: ['t1', 't2'] },
      {
        direction: 'in',
      },
    );
    expect((out.clips.find((c) => c.id === 'a') as AudioClip).fadeIn).toBe(0);
    expect(out.lockedClipIds).toEqual(['a']);
    expect(out.clips.find((c) => c.id === 'm')).toEqual(ctx.clips[1]);
  });

  it('changes nothing for an empty range', () => {
    const ctx = ctxOf([audio({ id: 'a', trackId: 't1' })]);
    expect(
      fadeRange(ctx, { fromBeat: 4, toBeat: 4, trackIds: ['t1'] }, { direction: 'in' }).clips,
    ).toEqual(ctx.clips);
  });
});

describe('stripSilence', () => {
  /** One-channel envelope over 4 seconds, 10 ms per bucket. */
  function peaksWith(loud: [number, number][], duration = 4, buckets = 400): PeakData {
    const min = new Float32Array(buckets);
    const max = new Float32Array(buckets);
    for (const [from, to] of loud) {
      for (let i = from; i < to; i++) {
        max[i] = 0.8;
        min[i] = -0.8;
      }
    }
    return { version: 1, buckets, channels: 1, duration, min, max };
  }

  const opts = {
    thresholdDb: -40,
    minSilenceSec: 0.25,
    minPartSec: 0.1,
    padBeforeSec: 0.02,
    padAfterSec: 0.05,
  };

  it('returns the loud parts in source seconds, padded either side', () => {
    const clip = audio({ id: 'a', trackId: 't1', sourceDuration: 4 });
    const spans = stripSilence(
      clip,
      peaksWith([
        [100, 150],
        [300, 350],
      ]),
      opts,
    );
    expect(spans).toHaveLength(2);
    expect(spans[0].fromSec).toBeCloseTo(0.98, 9);
    expect(spans[0].toSec).toBeCloseTo(1.55, 9);
    expect(spans[1].fromSec).toBeCloseTo(2.98, 9);
    expect(spans[1].toSec).toBeCloseTo(3.55, 9);
  });

  it('keeps a gap shorter than the minimum silence inside one part', () => {
    const clip = audio({ id: 'a', trackId: 't1', sourceDuration: 4 });
    const spans = stripSilence(
      clip,
      peaksWith([
        [100, 150],
        [155, 200],
      ]),
      opts,
    );
    expect(spans).toHaveLength(1);
    expect(spans[0].toSec).toBeCloseTo(2.05, 9);
  });

  it('drops a part shorter than the minimum, padding included', () => {
    const clip = audio({ id: 'a', trackId: 't1', sourceDuration: 4 });
    expect(stripSilence(clip, peaksWith([[100, 101]]), opts)).toEqual([]);
  });

  it('never reaches outside the clip window', () => {
    const clip = audio({ id: 'a', trackId: 't1', offset: 0.9, sourceDuration: 0.4 });
    const spans = stripSilence(clip, peaksWith([[100, 150]]), opts);
    expect(spans).toHaveLength(1);
    expect(spans[0].fromSec).toBeCloseTo(0.98, 9);
    expect(spans[0].toSec).toBeCloseTo(1.3, 9);
  });

  it('is silent about silence: nothing loud yields no parts', () => {
    const clip = audio({ id: 'a', trackId: 't1', sourceDuration: 4 });
    expect(stripSilence(clip, peaksWith([]), opts)).toEqual([]);
  });

  it('keeps the whole window when there is no envelope to read', () => {
    const clip = audio({ id: 'a', trackId: 't1', offset: 1, sourceDuration: 2 });
    const empty: PeakData = {
      version: 1,
      buckets: 0,
      channels: 0,
      duration: 4,
      min: new Float32Array(0),
      max: new Float32Array(0),
    };
    expect(stripSilence(clip, empty, opts)).toEqual([{ fromSec: 1, toSec: 3 }]);
  });

  it('hears a part above the threshold that a higher threshold misses', () => {
    const quiet = peaksWith([]);
    for (let i = 100; i < 150; i++) {
      quiet.max[i] = 0.02; // about -34 dBFS
      quiet.min[i] = -0.02;
    }
    const clip = audio({ id: 'a', trackId: 't1', sourceDuration: 4 });
    expect(stripSilence(clip, quiet, opts)).toHaveLength(1);
    expect(stripSilence(clip, quiet, { ...opts, thresholdDb: -20 })).toEqual([]);
  });
});
