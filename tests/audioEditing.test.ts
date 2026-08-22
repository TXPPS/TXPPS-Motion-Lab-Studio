import { beforeEach, describe, expect, it } from 'vitest';
import {
  computePeaks,
  fromStoredPeaks,
  peaksAreSilent,
  sampleWindow,
  toStoredPeaks,
} from '../src/audio/peaks';
import { PEAKS_VERSION } from '../src/model/media';
import { createEmptyProject } from '../src/model/demoProject';
import { useProjectStore } from '../src/state/projectStore';
import type { AudioClip } from '../src/model/types';

/** A deterministic ramp: channel value rises linearly from -1 to +1. */
function ramp(length: number): Float32Array {
  const d = new Float32Array(length);
  for (let i = 0; i < length; i++) d[i] = (i / (length - 1)) * 2 - 1;
  return d;
}

function silence(length: number): Float32Array {
  return new Float32Array(length);
}

describe('peak computation', () => {
  it('produces the requested bucket count and brackets the signal', () => {
    const p = computePeaks([ramp(4410)], 44100, 128);
    expect(p.buckets).toBe(128);
    expect(p.min.length).toBe(128);
    expect(p.max.length).toBe(128);
    expect(p.version).toBe(PEAKS_VERSION);
    for (let i = 0; i < p.buckets; i++) {
      expect(p.min[i]).toBeLessThanOrEqual(p.max[i]);
      expect(p.min[i]).toBeGreaterThanOrEqual(-1.0001);
      expect(p.max[i]).toBeLessThanOrEqual(1.0001);
    }
    // A rising ramp must have a rising envelope.
    expect(p.max[p.buckets - 1]).toBeGreaterThan(p.max[0]);
  });

  it('detects silence and does not misreport real signal as silent', () => {
    expect(peaksAreSilent(computePeaks([silence(4410)], 44100, 64))).toBe(true);
    expect(peaksAreSilent(computePeaks([ramp(4410)], 44100, 64))).toBe(false);
  });

  it('caps buckets at the frame count rather than inventing empty ones', () => {
    const p = computePeaks([ramp(10)], 0.001, 256);
    expect(p.buckets).toBe(10);
    for (let i = 0; i < p.buckets; i++) {
      expect(Number.isFinite(p.min[i])).toBe(true);
      expect(Number.isFinite(p.max[i])).toBe(true);
    }
  });

  it('brackets the zero line, so an all-positive signal still draws symmetrically', () => {
    const positive = new Float32Array(1000).fill(0.5);
    const p = computePeaks([positive], 0.02, 16);
    // min is pinned at 0 by design: the envelope always spans the centre line.
    expect(Math.min(...p.min)).toBe(0);
    expect(Math.max(...p.max)).toBeCloseTo(0.5, 5);
  });

  it('survives a round trip through the stored representation', () => {
    const p = computePeaks([ramp(2205)], 44100, 64);
    const back = fromStoredPeaks(toStoredPeaks('m1', p));
    expect(back.buckets).toBe(p.buckets);
    expect(back.channels).toBe(p.channels);
    expect(back.duration).toBeCloseTo(p.duration, 6);
    expect(Array.from(back.max)).toEqual(Array.from(p.max));
    expect(Array.from(back.min)).toEqual(Array.from(p.min));
  });
});

describe('windowed peak sampling', () => {
  // 44100 frames at 44.1 kHz = exactly one second of a rising ramp.
  const peaks = computePeaks([ramp(44100)], 1, 1024);

  it('returns exactly the requested output width', () => {
    for (const w of [1, 7, 64, 300]) {
      const win = sampleWindow(peaks, 0, peaks.duration, w);
      expect(win.min.length).toBe(w);
      expect(win.max.length).toBe(w);
    }
  });

  it('a later window of a rising ramp reads higher than an earlier one', () => {
    const early = sampleWindow(peaks, 0, 0.1, 16);
    const late = sampleWindow(peaks, 0.9, 1.0, 16);
    expect(Math.max(...late.max)).toBeGreaterThan(Math.max(...early.max));
  });

  it('clamps out-of-range windows instead of reading past the envelope', () => {
    const win = sampleWindow(peaks, -5, 99, 32);
    expect(win.max.length).toBe(32);
    for (let i = 0; i < 32; i++) {
      expect(Number.isFinite(win.min[i])).toBe(true);
      expect(Number.isFinite(win.max[i])).toBe(true);
    }
  });

  it('returns a finite result for a zero-width window', () => {
    const win = sampleWindow(peaks, 0.5, 0.5, 8);
    expect(win.max.length).toBe(8);
    for (let i = 0; i < 8; i++) expect(Number.isFinite(win.max[i])).toBe(true);
  });
});

describe('nondestructive audio clip editing', () => {
  let trackId: string;
  let clipId: string;

  const clip = (): AudioClip =>
    useProjectStore.getState().project.clips.find((c) => c.id === clipId) as AudioClip;

  beforeEach(() => {
    useProjectStore.getState().setProject(createEmptyProject('Edit test'), { markClean: true });
    const s = useProjectStore.getState();
    trackId = s.addTrack('audio');
    // 8 beats at 120 BPM = 4 seconds of source.
    useProjectStore.getState().setBpm(120);
    clipId = useProjectStore.getState().addAudioClip(trackId, 'media-1', 4, 8, 'Take', 4);
  });

  it('trimming the start moves the timeline position and the source offset together', () => {
    const before = clip();
    useProjectStore.getState().trimClipStart(clipId, 6);
    const after = clip();
    expect(after.start).toBe(6);
    expect(after.length).toBe(before.length - 2);
    // 2 beats at 120 BPM = 1 second further into the source
    expect(after.offset).toBeCloseTo(before.offset + 1, 5);
  });

  it('refuses a start trim that would consume the whole clip', () => {
    const before = clip();
    useProjectStore.getState().trimClipStart(clipId, before.start + before.length + 4);
    const after = clip();
    expect(after.length).toBeGreaterThan(0);
    expect(after.offset).toBeGreaterThanOrEqual(0);
  });

  it('trimming the end shortens the clip without moving its start', () => {
    useProjectStore.getState().trimClipEnd(clipId, 5);
    const after = clip();
    expect(after.start).toBe(4);
    expect(after.length).toBe(5);
  });

  it('splitting produces two clips whose source offsets stay contiguous', () => {
    const before = clip();
    const rightId = useProjectStore.getState().splitClip(clipId, 8);
    expect(rightId).toBeTruthy();

    const left = clip();
    const right = useProjectStore
      .getState()
      .project.clips.find((c) => c.id === rightId) as AudioClip;

    expect(left.start).toBe(4);
    expect(left.length).toBe(4);
    expect(right.start).toBe(8);
    expect(right.length).toBe(4);
    // 4 beats at 120 BPM = 2 seconds into the source
    expect(right.offset).toBeCloseTo(before.offset + 2, 5);
    // the two halves still cover the original span exactly
    expect(left.length + right.length).toBe(before.length);
  });

  it('does not split outside the clip', () => {
    const countBefore = useProjectStore.getState().project.clips.length;
    expect(useProjectStore.getState().splitClip(clipId, 1)).toBeNull();
    expect(useProjectStore.getState().splitClip(clipId, 99)).toBeNull();
    expect(useProjectStore.getState().project.clips.length).toBe(countBefore);
  });

  it('clamps clip gain to a sane range', () => {
    useProjectStore.getState().setClipGain(clipId, 99);
    expect(clip().gain).toBeLessThanOrEqual(4);
    useProjectStore.getState().setClipGain(clipId, -5);
    expect(clip().gain).toBeGreaterThanOrEqual(0);
  });

  it('keeps fades inside the clip and prevents overlapping ramps', () => {
    const len = clip().length;
    useProjectStore.getState().setClipFades(clipId, len * 2, len * 2);
    const after = clip();
    expect(after.fadeIn).toBeGreaterThanOrEqual(0);
    expect(after.fadeOut).toBeGreaterThanOrEqual(0);
    expect(after.fadeIn + after.fadeOut).toBeLessThanOrEqual(len + 1e-6);
  });
});
