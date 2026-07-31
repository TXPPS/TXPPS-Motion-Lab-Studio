/**
 * Waveform peak generation.
 *
 * Peaks are computed ONCE per media item and cached (in memory and in
 * IndexedDB). Rendering never decodes audio and never walks raw samples — it
 * reads the min/max envelope, which is what keeps many clips cheap to draw.
 */
import { PEAKS_VERSION, type PeakData } from '../model/media';

/** Default envelope resolution. ~1000 buckets is plenty for on-screen clips. */
export const DEFAULT_BUCKETS = 1024;

/** Build a min/max envelope from decoded audio. Pure — safe to unit test. */
export function computePeaks(
  channels: Float32Array[],
  durationSec: number,
  buckets = DEFAULT_BUCKETS,
): PeakData {
  const chCount = Math.max(1, channels.length);
  const frames = channels[0]?.length ?? 0;
  const b = Math.max(1, Math.min(buckets, Math.max(1, frames)));
  const min = new Float32Array(chCount * b);
  const max = new Float32Array(chCount * b);
  const per = frames / b;

  for (let c = 0; c < chCount; c++) {
    const data = channels[c] ?? channels[0];
    for (let i = 0; i < b; i++) {
      const start = Math.floor(i * per);
      const end = Math.min(frames, Math.max(start + 1, Math.floor((i + 1) * per)));
      let lo = 0;
      let hi = 0;
      for (let s = start; s < end; s++) {
        const v = data[s];
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      min[c * b + i] = lo;
      max[c * b + i] = hi;
    }
  }
  return { version: PEAKS_VERSION, buckets: b, channels: chCount, duration: durationSec, min, max };
}

export function peaksFromAudioBuffer(buf: AudioBuffer, buckets = DEFAULT_BUCKETS): PeakData {
  const chans: Float32Array[] = [];
  for (let c = 0; c < buf.numberOfChannels; c++) chans.push(buf.getChannelData(c));
  return computePeaks(chans, buf.duration, buckets);
}

/**
 * Sample the envelope over a source time window, downsampled to `outBuckets`
 * screen columns. Returns interleaved [min,max] pairs of the mixed channels.
 * This is what the clip renderer calls on every draw — O(outBuckets).
 */
export function sampleWindow(
  peaks: PeakData,
  startSec: number,
  endSec: number,
  outBuckets: number,
): { min: Float32Array; max: Float32Array } {
  const outMin = new Float32Array(outBuckets);
  const outMax = new Float32Array(outBuckets);
  if (peaks.duration <= 0 || outBuckets <= 0) return { min: outMin, max: outMax };

  const clampedStart = Math.max(0, Math.min(startSec, peaks.duration));
  const clampedEnd = Math.max(clampedStart, Math.min(endSec, peaks.duration));
  const startBucket = (clampedStart / peaks.duration) * peaks.buckets;
  const endBucket = (clampedEnd / peaks.duration) * peaks.buckets;
  const span = Math.max(1e-9, endBucket - startBucket);

  for (let i = 0; i < outBuckets; i++) {
    const a = startBucket + (i / outBuckets) * span;
    const bEnd = startBucket + ((i + 1) / outBuckets) * span;
    const from = Math.max(0, Math.floor(a));
    const to = Math.min(peaks.buckets, Math.max(from + 1, Math.ceil(bEnd)));
    let lo = 0;
    let hi = 0;
    for (let c = 0; c < peaks.channels; c++) {
      const base = c * peaks.buckets;
      for (let k = from; k < to; k++) {
        const mn = peaks.min[base + k];
        const mx = peaks.max[base + k];
        if (mn < lo) lo = mn;
        if (mx > hi) hi = mx;
      }
    }
    outMin[i] = lo;
    outMax[i] = hi;
  }
  return { min: outMin, max: outMax };
}

/** True when the envelope contains any non-zero sample (used to reject silence). */
export function peaksAreSilent(peaks: PeakData, threshold = 0.0005): boolean {
  for (let i = 0; i < peaks.max.length; i++) {
    if (Math.abs(peaks.max[i]) > threshold || Math.abs(peaks.min[i]) > threshold) return false;
  }
  return true;
}

/** Plain-object form for IndexedDB (structured clone handles typed arrays). */
export interface StoredPeaks {
  id: string;
  version: number;
  buckets: number;
  channels: number;
  duration: number;
  min: Float32Array;
  max: Float32Array;
}

export function toStoredPeaks(id: string, p: PeakData): StoredPeaks {
  return {
    id,
    version: p.version,
    buckets: p.buckets,
    channels: p.channels,
    duration: p.duration,
    min: p.min,
    max: p.max,
  };
}

export function fromStoredPeaks(s: StoredPeaks): PeakData {
  return {
    version: s.version,
    buckets: s.buckets,
    channels: s.channels,
    duration: s.duration,
    min: s.min instanceof Float32Array ? s.min : new Float32Array(s.min),
    max: s.max instanceof Float32Array ? s.max : new Float32Array(s.max),
  };
}
