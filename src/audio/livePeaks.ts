/**
 * The waveform of a take that is still being recorded.
 *
 * Directive 02 §2.1 wants a waveform that grows as the performance happens,
 * stays gap-free for a sixty-minute take, and costs O(new buckets) to draw
 * rather than O(take length). That last requirement is the whole design: a
 * renderer that rescans the take every frame is fine for ten seconds and
 * unusable at forty minutes, and the failure arrives gradually enough that
 * nobody notices which change caused it.
 *
 * So this is an append-only multi-resolution envelope — a mip chain of min/max
 * pairs. Level 0 is one bucket per 256 samples; each level above folds four
 * buckets of the level below. A renderer asks for the level whose bucket is
 * about one pixel wide and reads only the range it is drawing, so the cost of
 * a frame is set by the width of the viewport and never by the length of the
 * take.
 *
 * Storage is chunked because the alternative is reallocating and copying a
 * multi-megabyte buffer every time it fills, and that copy lands on whichever
 * frame is unlucky.
 */

/** Samples per bucket at level 0. About 5 ms at 48 kHz. */
export const BASE_SAMPLES_PER_BUCKET = 256;
/** How many buckets of one level make a bucket of the next. */
export const MIP_FACTOR = 4;
/** 256, 1 024, 4 096, 16 384, 65 536 samples per bucket. */
export const MIP_LEVELS = 5;
/** Buckets per allocation. Sized so a chunk is 512 KB of floats at level 0. */
const CHUNK = 65536;

/** One resolution of the envelope: min and max per bucket, grown in chunks. */
class Level {
  private minChunks: Float32Array[] = [];
  private maxChunks: Float32Array[] = [];
  private length = 0;

  push(min: number, max: number): void {
    const chunk = (this.length / CHUNK) | 0;
    if (chunk >= this.minChunks.length) {
      this.minChunks.push(new Float32Array(CHUNK));
      this.maxChunks.push(new Float32Array(CHUNK));
    }
    const offset = this.length % CHUNK;
    this.minChunks[chunk][offset] = min;
    this.maxChunks[chunk][offset] = max;
    this.length++;
  }

  get count(): number {
    return this.length;
  }

  min(i: number): number {
    return this.minChunks[(i / CHUNK) | 0][i % CHUNK];
  }

  max(i: number): number {
    return this.maxChunks[(i / CHUNK) | 0][i % CHUNK];
  }

  bytes(): number {
    return (this.minChunks.length + this.maxChunks.length) * CHUNK * 4;
  }

  clear(): void {
    this.minChunks = [];
    this.maxChunks = [];
    this.length = 0;
  }
}

/** Partial fold state for one level: what has accumulated toward its next bucket. */
interface Fold {
  min: number;
  max: number;
  filled: number;
}

export class LivePeaks {
  private levels: Level[] = [];
  private folds: Fold[] = [];

  constructor() {
    this.reset();
  }

  reset(): void {
    this.levels = Array.from({ length: MIP_LEVELS }, () => new Level());
    this.folds = Array.from({ length: MIP_LEVELS }, () => ({
      min: Infinity,
      max: -Infinity,
      filled: 0,
    }));
  }

  /**
   * Add one level-0 bucket. Folding upward is amortised O(1): a bucket reaches
   * level *n* only once every 4ⁿ appends, so the total work across the chain is
   * bounded by 4/3 of the appends.
   */
  append(min: number, max: number): void {
    this.levels[0].push(min, max);
    this.foldUp(1, min, max);
  }

  private foldUp(level: number, min: number, max: number): void {
    if (level >= MIP_LEVELS) return;
    const fold = this.folds[level];
    if (min < fold.min) fold.min = min;
    if (max > fold.max) fold.max = max;
    fold.filled++;
    if (fold.filled < MIP_FACTOR) return;
    this.levels[level].push(fold.min, fold.max);
    const carriedMin = fold.min;
    const carriedMax = fold.max;
    fold.min = Infinity;
    fold.max = -Infinity;
    fold.filled = 0;
    this.foldUp(level + 1, carriedMin, carriedMax);
  }

  count(level = 0): number {
    return this.levels[level].count;
  }

  /** Samples each bucket of a level covers. */
  static samplesPerBucket(level: number): number {
    return BASE_SAMPLES_PER_BUCKET * Math.pow(MIP_FACTOR, level);
  }

  /**
   * The level whose buckets are closest to one pixel wide without going under.
   *
   * Under-shooting would draw several buckets into one pixel — correct, but
   * more reads than the pixel can show. Over-shooting loses peaks, and losing a
   * peak on a waveform is how a transient disappears from a picture that is
   * supposed to be showing you where the transients are. So this rounds toward
   * the finer level and stops at the finest.
   */
  levelFor(samplesPerPixel: number): number {
    if (!(samplesPerPixel > 0)) return 0;
    for (let level = MIP_LEVELS - 1; level > 0; level--) {
      if (LivePeaks.samplesPerBucket(level) <= samplesPerPixel) return level;
    }
    return 0;
  }

  /**
   * Read a bucket range into caller-supplied arrays, which is what keeps a
   * frame from allocating. Out-of-range buckets read as silence rather than
   * as an error: a renderer that asks slightly past the end is drawing the edge
   * of a take that is still growing, which is the normal case here.
   */
  read(level: number, from: number, to: number, outMin: Float32Array, outMax: Float32Array): number {
    const source = this.levels[level];
    const start = Math.max(0, from);
    const end = Math.min(source.count, to);
    const n = Math.min(outMin.length, Math.max(0, end - start));
    for (let i = 0; i < n; i++) {
      outMin[i] = source.min(start + i);
      outMax[i] = source.max(start + i);
    }
    return n;
  }

  /** Total bytes held. The take's whole memory cost, since nothing else grows. */
  bytes(): number {
    let total = 0;
    for (const level of this.levels) total += level.bytes();
    return total;
  }

  /** Seconds captured, given the rate the buckets were built at. */
  seconds(sampleRate: number): number {
    if (!(sampleRate > 0)) return 0;
    return (this.count(0) * BASE_SAMPLES_PER_BUCKET) / sampleRate;
  }
}
