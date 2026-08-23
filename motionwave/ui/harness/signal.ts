/**
 * Motion Wave — test signals and the measurements taken from them.
 *
 * ADR-0005: with no audio device on this host, every DSP claim is verified by
 * rendering offline and measuring the result. That is stronger verification
 * than listening on a device, not weaker — a null test to −120 dBFS is not
 * something an ear can do — but only if the measurements are the same
 * measurements every time. So they live here and are shared by every cell.
 */

/** Full-scale digital silence threshold used across the harness, in dBFS. */
export const FLOOR_DB = -200;

export function dbfs(amplitude: number): number {
  const magnitude = Math.abs(amplitude);
  return magnitude > 0 ? 20 * Math.log10(magnitude) : FLOOR_DB;
}

export function silence(frames: number): Float32Array {
  return new Float32Array(frames);
}

export function sine(
  frames: number,
  hz: number,
  sampleRate: number,
  amplitude = 0.5,
): Float32Array {
  const out = new Float32Array(frames);
  const step = (2 * Math.PI * hz) / sampleRate;
  for (let i = 0; i < frames; i++) out[i] = amplitude * Math.sin(step * i);
  return out;
}

/**
 * A single sample at `at`, and nothing else.
 *
 * Amplitude defaults to a quarter of full scale rather than to one. A full-scale
 * impulse makes a limiter limit and a saturator saturate, so the "latency" it
 * measures is the latency of a device in a state no user puts it in — the
 * mistake PA-010 records having made twice before the measurement was trusted.
 */
export function impulse(frames: number, at = 0, amplitude = 0.25): Float32Array {
  const out = new Float32Array(frames);
  if (at >= 0 && at < frames) out[at] = amplitude;
  return out;
}

/**
 * Deterministic noise. Seeded, because a fuzz failure that cannot be replayed
 * is a rumour: the seed goes in the failure message and the case comes back.
 */
export function noise(frames: number, seed: number, amplitude = 0.5): Float32Array {
  const out = new Float32Array(frames);
  const random = seededRandom(seed);
  for (let i = 0; i < frames; i++) out[i] = (random() * 2 - 1) * amplitude;
  return out;
}

/** xorshift32. Small, fast, and identical on every host — which is the point. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0 || 0x9e3779b9;
  return () => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0x100000000;
  };
}

export function peak(buffer: Float32Array, from = 0, to = buffer.length): number {
  let highest = 0;
  for (let i = from; i < to; i++) {
    const magnitude = Math.abs(buffer[i]);
    if (magnitude > highest) highest = magnitude;
  }
  return highest;
}

export function rms(buffer: Float32Array, from = 0, to = buffer.length): number {
  let sum = 0;
  for (let i = from; i < to; i++) sum += buffer[i] * buffer[i];
  const count = Math.max(1, to - from);
  return Math.sqrt(sum / count);
}

export function peakIndex(buffer: Float32Array): number {
  let best = 0;
  let highest = -1;
  for (let i = 0; i < buffer.length; i++) {
    const magnitude = Math.abs(buffer[i]);
    if (magnitude > highest) {
      highest = magnitude;
      best = i;
    }
  }
  return best;
}

/** The loudest sample of `a - b`, in dBFS. The null test's one number. */
export function differenceDb(a: Float32Array, b: Float32Array): number {
  const count = Math.min(a.length, b.length);
  let highest = 0;
  for (let i = 0; i < count; i++) {
    const difference = Math.abs(a[i] - b[i]);
    if (difference > highest) highest = difference;
  }
  return dbfs(highest);
}

/**
 * The largest jump between neighbouring samples.
 *
 * This is the zipper measurement. A parameter stepped once per block puts a
 * discontinuity at each block boundary, and a discontinuity is audible as a
 * click long before it is visible in a waveform — so the check is on the
 * difference, not on the envelope.
 */
export function maxStep(buffer: Float32Array): number {
  let highest = 0;
  for (let i = 1; i < buffer.length; i++) {
    const step = Math.abs(buffer[i] - buffer[i - 1]);
    if (step > highest) highest = step;
  }
  return highest;
}

/** True if the buffer contains a NaN or an infinity anywhere. */
export function hasNonFinite(buffer: Float32Array): boolean {
  for (let i = 0; i < buffer.length; i++) {
    if (!Number.isFinite(buffer[i])) return true;
  }
  return false;
}

/** True if every sample is bit-identical. Not "close" — identical. */
export function identical(a: Float32Array, b: Float32Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (!Object.is(a[i], b[i])) return false;
  }
  return true;
}
