/**
 * Directive 02 §2.1 — the growing waveform.
 *
 * The requirements that matter are all about *cost*: gap-free for sixty
 * minutes, no memory growth beyond the peak cache, and a redraw that is O(new
 * buckets) rather than O(take length). A waveform that is merely correct is
 * easy; one that is still correct forty minutes in is the thing being built.
 */
import { describe, expect, it } from 'vitest';
import { BASE_SAMPLES_PER_BUCKET, LivePeaks, MIP_FACTOR, MIP_LEVELS } from '../src/audio/livePeaks';
import { appendBatch } from '../src/audio/peakTap';

/** Feed `n` buckets whose values are a known function of their index. */
function fill(peaks: LivePeaks, n: number, f = (i: number) => i): void {
  for (let i = 0; i < n; i++) peaks.append(-f(i), f(i));
}

describe('the live peak envelope', () => {
  it('keeps every level-0 bucket it is given', () => {
    const peaks = new LivePeaks();
    fill(peaks, 1000);
    expect(peaks.count(0)).toBe(1000);
    const min = new Float32Array(4);
    const max = new Float32Array(4);
    expect(peaks.read(0, 10, 14, min, max)).toBe(4);
    expect([...max]).toEqual([10, 11, 12, 13]);
    expect([...min]).toEqual([-10, -11, -12, -13]);
  });

  it('folds four buckets into one at each level above', () => {
    const peaks = new LivePeaks();
    fill(peaks, 64);
    expect(peaks.count(0)).toBe(64);
    expect(peaks.count(1)).toBe(16);
    expect(peaks.count(2)).toBe(4);
    expect(peaks.count(3)).toBe(1);
  });

  it('keeps the extremes when it folds, so a transient survives zooming out', () => {
    // The failure this prevents: a peak that exists at full resolution and
    // vanishes when the view is zoomed out, so the waveform stops showing you
    // where the loud moment was at exactly the zoom you would look for it.
    const peaks = new LivePeaks();
    for (let i = 0; i < 16; i++) peaks.append(i === 6 ? -0.9 : -0.1, i === 6 ? 0.8 : 0.1);
    const min = new Float32Array(4);
    const max = new Float32Array(4);
    peaks.read(1, 0, 4, min, max);
    // Bucket 6 lives in level-1 bucket 1 (buckets 4..7).
    expect(max[1]).toBeCloseTo(0.8, 6);
    expect(min[1]).toBeCloseTo(-0.9, 6);
    // And its neighbours are untouched.
    expect(max[0]).toBeCloseTo(0.1, 6);
    expect(max[2]).toBeCloseTo(0.1, 6);
  });

  it('publishes a level only once it is complete', () => {
    // A half-folded bucket would draw a peak over a span that has not happened
    // yet, so the waveform would run ahead of the performance.
    const peaks = new LivePeaks();
    fill(peaks, 3);
    expect(peaks.count(1)).toBe(0);
    peaks.append(-1, 1);
    expect(peaks.count(1)).toBe(1);
  });

  it('picks a level whose buckets are about a pixel, erring toward more detail', () => {
    const peaks = new LivePeaks();
    // At exactly one level-0 bucket per pixel, use level 0.
    expect(peaks.levelFor(BASE_SAMPLES_PER_BUCKET)).toBe(0);
    // Zoomed further in than the finest level goes, stay at the finest.
    expect(peaks.levelFor(16)).toBe(0);
    // Four times zoomed out is one level up, and so on.
    expect(peaks.levelFor(BASE_SAMPLES_PER_BUCKET * MIP_FACTOR)).toBe(1);
    expect(peaks.levelFor(BASE_SAMPLES_PER_BUCKET * MIP_FACTOR ** 3)).toBe(3);
    // Past the coarsest level, stay at the coarsest rather than reading nothing.
    expect(peaks.levelFor(BASE_SAMPLES_PER_BUCKET * MIP_FACTOR ** 12)).toBe(MIP_LEVELS - 1);
  });

  it('reads a window without touching the rest of the take', () => {
    // This is the O(new) claim in its testable form: a read costs what it
    // returns, not what has been recorded.
    const peaks = new LivePeaks();
    fill(peaks, 200000);
    const min = new Float32Array(64);
    const max = new Float32Array(64);
    const n = peaks.read(0, 199000, 199064, min, max);
    expect(n).toBe(64);
    expect(max[0]).toBe(199000);
    expect(max[63]).toBe(199063);
  });

  it('reads past the end as silence, because the take is still growing', () => {
    const peaks = new LivePeaks();
    fill(peaks, 10);
    const min = new Float32Array(8);
    const max = new Float32Array(8);
    expect(peaks.read(0, 6, 14, min, max)).toBe(4);
  });

  it('holds a sixty-minute take inside a stated memory bound', () => {
    // 48 kHz for an hour is 172.8 million samples, which is 675 000 level-0
    // buckets. The whole chain is that plus a third, at eight bytes a bucket.
    const peaks = new LivePeaks();
    const buckets = Math.ceil((48000 * 60 * 60) / BASE_SAMPLES_PER_BUCKET);
    fill(peaks, buckets, () => 0.5);
    expect(peaks.count(0)).toBe(buckets);
    expect(peaks.seconds(48000)).toBeCloseTo(3600, 0);
    // Under 16 MB, and the point is that it is *bounded* — the cache is the
    // only thing that grows with the take.
    expect(peaks.bytes()).toBeLessThan(16 * 1024 * 1024);
  });

  it('allocates in chunks rather than copying the whole take as it grows', () => {
    // The alternative — one array, doubled and copied when it fills — puts a
    // multi-megabyte memcpy on whichever frame is unlucky, forty minutes in.
    const peaks = new LivePeaks();
    fill(peaks, 70000);
    const before = peaks.bytes();
    fill(peaks, 100);
    expect(peaks.bytes()).toBe(before);
  });

  it('starts empty again when it is reset', () => {
    const peaks = new LivePeaks();
    fill(peaks, 5000);
    peaks.reset();
    expect(peaks.count(0)).toBe(0);
    expect(peaks.count(2)).toBe(0);
    expect(peaks.bytes()).toBe(0);
  });
});

/**
 * Directive 02 §2.1 — what happens when the main thread stalls.
 *
 * The worklet's choice under back-pressure is to widen its buckets rather than
 * drop them, because a dropped bucket leaves a hole and a hole reads as "the
 * recorder missed that". The consequence has to be carried through on this
 * side too, or the trade quietly becomes a different bug.
 */
describe('a batch that arrived at reduced resolution', () => {
  it('keeps the take aligned to real time rather than compressing it', () => {
    // Four buckets that each stand for four is sixteen buckets of elapsed time.
    // Appending them once each would make a take recorded through a stall come
    // out shorter on screen than it is on disk.
    const peaks = new LivePeaks();
    appendBatch(peaks, {
      min: new Float32Array([-0.1, -0.2, -0.3, -0.4]),
      max: new Float32Array([0.1, 0.2, 0.3, 0.4]),
      count: 4,
      widen: 4,
    });
    expect(peaks.count(0)).toBe(16);
  });

  it('repeats the widened value across the span it stands for', () => {
    const peaks = new LivePeaks();
    appendBatch(peaks, {
      min: new Float32Array([-0.5, -0.9]),
      max: new Float32Array([0.5, 0.9]),
      count: 2,
      widen: 2,
    });
    const min = new Float32Array(4);
    const max = new Float32Array(4);
    peaks.read(0, 0, 4, min, max);
    // Compared with a tolerance because the store is Float32: 0.9 is not
    // representable, and asserting exact equality would be testing IEEE 754
    // rather than the widening.
    for (const [i, want] of [0.5, 0.5, 0.9, 0.9].entries()) {
      expect(max[i]).toBeCloseTo(want, 6);
      expect(min[i]).toBeCloseTo(-want, 6);
    }
  });

  it('treats a normal batch as one bucket each', () => {
    const peaks = new LivePeaks();
    appendBatch(peaks, {
      min: new Float32Array([-0.1, -0.2]),
      max: new Float32Array([0.1, 0.2]),
      count: 2,
      widen: 1,
    });
    expect(peaks.count(0)).toBe(2);
  });

  it('survives a nonsense widen rather than appending nothing', () => {
    const peaks = new LivePeaks();
    appendBatch(peaks, {
      min: new Float32Array([-0.1]),
      max: new Float32Array([0.1]),
      count: 1,
      widen: 0,
    });
    expect(peaks.count(0)).toBe(1);
  });
});
