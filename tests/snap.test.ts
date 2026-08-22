import { describe, expect, it } from 'vitest';
import {
  EVENT_SNAP_PX,
  MIN_SNAP_PX,
  adaptiveGridBeats,
  nearestEvent,
  snapBeatTo,
  snapSecondsToZeroCrossing,
  type SnapContext,
} from '../src/model/snap';
import { DEFAULT_TEMPO_MAP, normalizeTempoMap } from '../src/model/tempo';

const SR = 48000;

function ctx(over: Partial<SnapContext> = {}): SnapContext {
  return { grid: 0.25, tempoMap: DEFAULT_TEMPO_MAP, pxPerBeat: 40, ...over };
}

/** 100 Hz sine: a rising zero crossing every 10 ms. */
function sine(seconds = 1, hz = 100): Float32Array {
  const out = new Float32Array(Math.round(seconds * SR));
  for (let i = 0; i < out.length; i++) out[i] = Math.sin((2 * Math.PI * hz * i) / SR);
  return out;
}

describe('snapBeatTo', () => {
  it('is the identity with snap off, whatever else the context offers', () => {
    const c = ctx({ events: [4], zeroCrossing: undefined });
    for (const beat of [0, 0.001, 3.37, 129.9]) {
      expect(snapBeatTo(beat, 'off', c)).toBe(beat);
    }
  });

  it('rounds to the grid, and passes the beat through when there is no grid', () => {
    expect(snapBeatTo(3.37, 'grid', ctx())).toBeCloseTo(3.25, 12);
    expect(snapBeatTo(3.4, 'grid', ctx({ grid: 1 }))).toBe(3);
    expect(snapBeatTo(3.37, 'grid', ctx({ grid: 0 }))).toBe(3.37);
    expect(snapBeatTo(0.1, 'grid', ctx({ grid: 1 }))).toBe(0);
  });
});

describe('adaptive snap', () => {
  const map = DEFAULT_TEMPO_MAP; // 120 bpm, 4/4

  it('picks 1/16 at high zoom, at exactly the pixel threshold', () => {
    // A sixteenth is a quarter of a beat, so MIN_SNAP_PX / 0.25 px per beat is
    // the zoom at which it becomes usable.
    expect(adaptiveGridBeats(MIN_SNAP_PX / 0.25, map, 0)).toBe(0.25);
    expect(adaptiveGridBeats(200, map, 0)).toBe(0.25);
    expect(adaptiveGridBeats(MIN_SNAP_PX / 0.25 - 1, map, 0)).toBe(0.5);
  });

  it('walks out through eighths and halves as the zoom falls', () => {
    expect(adaptiveGridBeats(MIN_SNAP_PX / 0.5, map, 0)).toBe(0.5);
    expect(adaptiveGridBeats(MIN_SNAP_PX / 1, map, 0)).toBe(1);
    expect(adaptiveGridBeats(MIN_SNAP_PX / 2, map, 0)).toBe(2);
  });

  it('picks bars at low zoom, and multiples of a bar lower still', () => {
    // Below six pixels per beat a half note is under the threshold, so a bar
    // (four beats in 4/4) is the finest grid left.
    expect(adaptiveGridBeats(5.9, map, 0)).toBe(4);
    expect(adaptiveGridBeats(4, map, 0)).toBe(4);
    expect(adaptiveGridBeats(2, map, 0)).toBe(8);
    expect(adaptiveGridBeats(1, map, 0)).toBe(16);
    expect(adaptiveGridBeats(0.1, map, 0)).toBe(32);
  });

  it('measures a bar with the signature in force at that beat', () => {
    const map34 = normalizeTempoMap(
      { tempos: [{ id: 't', beat: 0, bpm: 120 }], sigs: [{ id: 's', bar: 0, num: 3, den: 4 }] },
      120,
      { num: 3, den: 4 },
    );
    expect(adaptiveGridBeats(4, map34, 0)).toBe(3);
    expect(snapBeatTo(4.4, 'adaptive', ctx({ tempoMap: map34, pxPerBeat: 4 }))).toBe(3);
  });

  it('snaps through the grid it chose', () => {
    expect(snapBeatTo(3.37, 'adaptive', ctx({ pxPerBeat: 48 }))).toBeCloseTo(3.25, 12);
    expect(snapBeatTo(5.9, 'adaptive', ctx({ pxPerBeat: 4 }))).toBe(4);
  });
});

describe('snap to events', () => {
  it('takes the nearer of two boundaries', () => {
    const c = ctx({ events: [4, 4.9], eventTolerance: 0.5 });
    expect(snapBeatTo(4.8, 'events', c)).toBe(4.9);
    expect(snapBeatTo(4.2, 'events', c)).toBe(4);
  });

  it('refuses a boundary further away than the tolerance', () => {
    const c = ctx({ events: [4, 4.9], eventTolerance: 0.5 });
    expect(snapBeatTo(6, 'events', c)).toBe(6);
    expect(snapBeatTo(4.55, 'events', c)).toBe(4.9);
  });

  it('derives the tolerance from the zoom when the caller gives none', () => {
    // At 100 px per beat, EVENT_SNAP_PX is a tenth of a beat.
    const c = ctx({ events: [4], pxPerBeat: 100 });
    expect(EVENT_SNAP_PX / 100).toBeCloseTo(0.1, 12);
    expect(snapBeatTo(4.05, 'events', c)).toBe(4);
    expect(snapBeatTo(4.2, 'events', c)).toBe(4.2);
  });

  it('leaves the beat alone when there is nothing to snap to', () => {
    expect(snapBeatTo(4.2, 'events', ctx({ events: [] }))).toBe(4.2);
    expect(snapBeatTo(4.2, 'events', ctx())).toBe(4.2);
    expect(nearestEvent(4, [4], 0)).toBeNull();
    expect(nearestEvent(4, undefined, 1)).toBeNull();
    expect(nearestEvent(4, [Number.NaN, 4.5], 1)).toBe(4.5);
  });
});

describe('zero-crossing snap', () => {
  it('lands where the signal crosses zero going up', () => {
    const samples = sine();
    const snapped = snapSecondsToZeroCrossing(samples, SR, 0.0123, 10);
    expect(snapped).toBeCloseTo(0.01, 4);
    const i = Math.round(snapped * SR);
    expect(samples[i - 1]).toBeLessThanOrEqual(0);
    expect(samples[i]).toBeGreaterThan(0);
  });

  it('takes the nearest crossing, not the first one it meets', () => {
    const samples = sine();
    expect(snapSecondsToZeroCrossing(samples, SR, 0.0187, 20)).toBeCloseTo(0.02, 4);
  });

  it('returns the input when the bounded search finds nothing', () => {
    const samples = sine();
    expect(snapSecondsToZeroCrossing(samples, SR, 0.0123, 1)).toBe(0.0123);
    expect(snapSecondsToZeroCrossing(new Float32Array(0), SR, 0.5, 10)).toBe(0.5);
    expect(snapSecondsToZeroCrossing(new Float32Array(SR), SR, 0.5, 10)).toBe(0.5);
  });

  it('converts through the tempo map and back when snapping a beat', () => {
    const samples = sine();
    // 120 bpm: half a second per beat, and the buffer starts at the song start.
    const c = ctx({
      zeroCrossing: {
        samples,
        sampleRate: SR,
        startSec: 0,
        searchMs: 10,
        beatToSec: (beat) => beat * 0.5,
        secToBeat: (sec) => sec / 0.5,
      },
    });
    expect(snapBeatTo(0.0246, 'zeroCrossing', c)).toBeCloseTo(0.02, 4);
  });

  it('leaves the beat alone when no audio is under the cursor', () => {
    expect(snapBeatTo(3.37, 'zeroCrossing', ctx())).toBe(3.37);
  });
});
