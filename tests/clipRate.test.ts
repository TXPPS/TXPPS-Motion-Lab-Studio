import { describe, expect, it } from 'vitest';
import { clipRatePlan } from '../src/model/clipRate';
import type { AudioClip, ProjectData } from '../src/model/types';

function project(bpm = 120): ProjectData {
  return {
    schemaVersion: 6,
    id: 'p',
    name: 'p',
    createdAt: 0,
    modifiedAt: 0,
    bpm,
    timeSig: { num: 4, den: 4 },
    loop: { enabled: false, start: 0, end: 16 },
    metronome: false,
    masterVolume: 1,
    tracks: [],
    clips: [],
    workspace: { pxPerBeat: 26, snap: 0.25 },
  };
}

function clip(patch: Partial<AudioClip> = {}): AudioClip {
  return {
    id: 'c',
    trackId: 't',
    type: 'audio',
    name: 'c',
    start: 0,
    length: 4,
    muted: false,
    mediaId: 'm',
    offset: 0,
    gain: 1,
    fadeIn: 0,
    fadeOut: 0,
    ...patch,
  };
}

const SPB_120 = 0.5;

describe('clip rate', () => {
  it('is neutral for an untouched clip', () => {
    const plan = clipRatePlan(project(), clip(), SPB_120);
    expect(plan).toMatchObject({ timeRatio: 1, fallbackRate: 1, preservePitch: false });
  });

  it('doubles the rate for a clip recorded at half the song tempo', () => {
    // Recorded at 60, played in a 120 BPM song: it has to run twice as fast.
    const plan = clipRatePlan(project(120), clip({ followTempo: true, sourceBpm: 60 }), SPB_120);
    expect(plan.timeRatio).toBeCloseTo(0.5, 9);
    expect(plan.fallbackRate).toBeCloseTo(2, 9);
    expect(plan.preservePitch).toBe(true);
  });

  it('slows a clip recorded faster than the song', () => {
    const plan = clipRatePlan(project(120), clip({ followTempo: true, sourceBpm: 180 }), SPB_120);
    expect(plan.fallbackRate).toBeCloseTo(2 / 3, 6);
  });

  it('treats stretch as a speed multiplier', () => {
    // Speed 2 plays twice as fast, so the material lasts half as long.
    expect(clipRatePlan(project(), clip({ stretch: 2 }), SPB_120).fallbackRate).toBeCloseTo(2, 9);
    expect(clipRatePlan(project(), clip({ stretch: 2 }), SPB_120).timeRatio).toBeCloseTo(0.5, 9);
    expect(clipRatePlan(project(), clip({ stretch: 0.5 }), SPB_120).fallbackRate).toBeCloseTo(
      0.5,
      9,
    );
  });

  it('multiplies transposition into the resampled rate', () => {
    const octaveUp = clipRatePlan(project(), clip({ transpose: 12 }), SPB_120);
    expect(octaveUp.fallbackRate).toBeCloseTo(2, 9);
    expect(octaveUp.timeRatio).toBe(1);
    const fifthDown = clipRatePlan(project(), clip({ transpose: -7 }), SPB_120);
    expect(fifthDown.fallbackRate).toBeCloseTo(Math.pow(2, -7 / 12), 9);
  });

  it('combines tempo-follow with transposition', () => {
    const plan = clipRatePlan(
      project(120),
      clip({ followTempo: true, sourceBpm: 60, transpose: 12 }),
      SPB_120,
    );
    // twice as fast for the tempo, twice again for the octave
    expect(plan.fallbackRate).toBeCloseTo(4, 9);
  });

  it('respects an explicit tape mode', () => {
    const plan = clipRatePlan(project(), clip({ stretch: 2, preservePitch: false }), SPB_120);
    expect(plan.preservePitch).toBe(false);
    expect(plan.fallbackRate).toBeCloseTo(2, 9);
  });
});
