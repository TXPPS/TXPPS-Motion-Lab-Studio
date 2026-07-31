import { describe, expect, it } from 'vitest';
import { computeClipSchedule, type ClipTiming } from '../src/audio/clipSchedule';

/** 120 BPM: one beat is half a second. */
const SPB = 0.5;

function clip(patch: Partial<ClipTiming> = {}): ClipTiming {
  return { offset: 0, length: 8, sourceDuration: 4, gain: 1, fadeIn: 0, fadeOut: 0, ...patch };
}

describe('clip schedule duration', () => {
  it('plays the whole clip from its start', () => {
    const s = computeClipSchedule(clip(), 0, 10, SPB)!;
    expect(s.durSec).toBeCloseTo(4, 6);
    expect(s.offsetSec).toBe(0);
  });

  it('is bounded by the media, not just the clip length', () => {
    // Clip claims 4s of source but the media only holds 1.5s.
    const s = computeClipSchedule(clip(), 0, 1.5, SPB)!;
    expect(s.durSec).toBeCloseTo(1.5, 6);
  });

  it('is bounded by the musical length when that is shorter than the source', () => {
    // 2 beats = 1s of timeline, even though 4s of source is available.
    const s = computeClipSchedule(clip({ length: 2 }), 0, 10, SPB)!;
    expect(s.durSec).toBeCloseTo(1, 6);
  });

  it('shortens correctly when entered part-way through', () => {
    const s = computeClipSchedule(clip(), 1, 10, SPB)!;
    expect(s.durSec).toBeCloseTo(3, 6);
    expect(s.offsetSec).toBe(1);
  });

  it('accounts for a source offset when entering part-way', () => {
    // Clip starts 2s into the media; entering 1s further in.
    const s = computeClipSchedule(clip({ offset: 2 }), 3, 10, SPB)!;
    expect(s.durSec).toBeCloseTo(3, 6);
    expect(s.offsetSec).toBe(3);
  });

  it('returns null when there is nothing left to play', () => {
    expect(computeClipSchedule(clip(), 4, 4, SPB)).toBeNull();
    expect(computeClipSchedule(clip(), 99, 10, SPB)).toBeNull();
  });

  it('returns null for an empty or invalid buffer', () => {
    expect(computeClipSchedule(clip(), 0, 0, SPB)).toBeNull();
    expect(computeClipSchedule(clip(), NaN, 10, SPB)).toBeNull();
  });
});

describe('clip gain envelope', () => {
  it('holds a flat gain when there are no fades', () => {
    const s = computeClipSchedule(clip({ gain: 0.5 }), 0, 10, SPB)!;
    expect(s.envelope).toEqual([{ t: 0, value: 0.5, ramp: false }]);
  });

  it('ramps up over the fade-in from the clip start', () => {
    const s = computeClipSchedule(clip({ fadeIn: 1 }), 0, 10, SPB)!;
    expect(s.envelope[0]).toEqual({ t: 0, value: 0, ramp: false });
    expect(s.envelope[1]).toEqual({ t: 1, value: 1, ramp: true });
  });

  it('starts a mid-fade entry at the level already reached, not at silence', () => {
    // Enter 0.25s into a 1s fade-in: the envelope is a quarter of the way up.
    const s = computeClipSchedule(clip({ fadeIn: 1 }), 0.25, 10, SPB)!;
    expect(s.envelope[0].value).toBeCloseTo(0.25, 6);
    expect(s.envelope[0].ramp).toBe(false);
    // and finishes the remainder of the ramp
    expect(s.envelope[1]).toEqual({ t: 0.75, value: 1, ramp: true });
  });

  it('skips the fade-in entirely once past it', () => {
    const s = computeClipSchedule(clip({ fadeIn: 1 }), 2, 10, SPB)!;
    expect(s.envelope[0]).toEqual({ t: 0, value: 1, ramp: false });
  });

  it('ramps down to the clip end over the fade-out', () => {
    const s = computeClipSchedule(clip({ fadeOut: 1 }), 0, 10, SPB)!;
    const last = s.envelope[s.envelope.length - 1];
    expect(last.ramp).toBe(true);
    expect(last.t).toBeCloseTo(s.durSec, 6);
    expect(last.value).toBeLessThan(0.001);
    // the hold point sits where the fade begins: 4s source - 1s fade
    expect(s.envelope[s.envelope.length - 2].t).toBeCloseTo(3, 6);
  });

  it('starts the fade-out immediately when entering inside it', () => {
    // Enter 3.5s in; the fade-out began at 3s.
    const s = computeClipSchedule(clip({ fadeOut: 1 }), 3.5, 10, SPB)!;
    const holds = s.envelope.filter((p) => !p.ramp);
    expect(holds[holds.length - 1].t).toBe(0);
    expect(s.envelope[s.envelope.length - 1].value).toBeLessThan(0.001);
  });

  it('combines fade-in and fade-out on one clip', () => {
    const s = computeClipSchedule(clip({ fadeIn: 0.5, fadeOut: 0.5 }), 0, 10, SPB)!;
    expect(s.envelope[0].value).toBe(0);
    expect(s.envelope[1].value).toBe(1);
    expect(s.envelope[s.envelope.length - 1].value).toBeLessThan(0.001);
    // envelope times must be non-decreasing, or the ramps cross
    for (let i = 1; i < s.envelope.length; i++) {
      expect(s.envelope[i].t).toBeGreaterThanOrEqual(s.envelope[i - 1].t);
    }
  });

  it('scales the envelope by clip gain', () => {
    const s = computeClipSchedule(clip({ gain: 0.25, fadeIn: 1 }), 0, 10, SPB)!;
    expect(s.envelope[1].value).toBeCloseTo(0.25, 6);
  });

  it('treats a negative gain as silence rather than inverting polarity', () => {
    const s = computeClipSchedule(clip({ gain: -2 }), 0, 10, SPB)!;
    expect(s.envelope[0].value).toBe(0);
  });

  it('falls back to the musical length when no source duration is stored', () => {
    // 8 beats at 120 BPM = 4s
    const s = computeClipSchedule(clip({ sourceDuration: undefined }), 0, 10, SPB)!;
    expect(s.durSec).toBeCloseTo(4, 6);
  });
});
