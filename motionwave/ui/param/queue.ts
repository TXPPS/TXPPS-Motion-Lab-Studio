/**
 * Motion Wave — the producer side of the parameter ring.
 *
 * ADR-0004 puts exactly two lock-free rings between the UI and the audio
 * thread, both pre-allocated. This is the producer half of the down ring, and
 * it holds the two properties the ADR names: it refuses to overfill rather than
 * blocking or growing, and it coalesces repeated writes to the same parameter,
 * because the newest value is the only one that matters.
 *
 * Coalescing is not an optimisation. A knob dragged across a screen at 120 Hz
 * for two seconds is 240 messages for one parameter; without coalescing the
 * ring fills, the writes at the end of the gesture are the ones dropped, and
 * the control ends up somewhere other than where the finger left it. That is
 * the failure this class exists to prevent, and `param_queue.test.ts` asserts
 * the value that survives is always the last one posted.
 *
 * The backing arrays are allocated once. Nothing here allocates per post, so
 * the same code is safe to run from an automation pass that is itself running
 * under a deadline.
 */

import type { ParamId } from './spec';

export interface ParamChange {
  readonly id: ParamId;
  readonly normalised: number;
  /**
   * Where in the coming buffer the change lands. Reserved for sample-accurate
   * automation; the block-rate path applies everything at the top of the block.
   */
  readonly sampleOffset: number;
}

/** Matches `kParamRingDepth` in `core/param/param_set.h`. */
export const DEFAULT_QUEUE_DEPTH = 256;

export class ParamQueue {
  private readonly ids: Uint32Array;
  private readonly values: Float64Array;
  private readonly offsets: Int32Array;
  private pending = 0;
  private refused = 0;

  constructor(capacity: number = DEFAULT_QUEUE_DEPTH) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new RangeError(`ParamQueue capacity must be a positive integer, got ${capacity}`);
    }
    this.ids = new Uint32Array(capacity);
    this.values = new Float64Array(capacity);
    this.offsets = new Int32Array(capacity);
  }

  get capacity(): number {
    return this.ids.length;
  }

  get size(): number {
    return this.pending;
  }

  /** How many posts have been refused since construction, for diagnostics. */
  get refusedCount(): number {
    return this.refused;
  }

  /**
   * Posts a change. Returns false when the value was not accepted.
   *
   * A non-finite value is refused rather than clamped. The C++ clamp leaves a
   * NaN alone by design so it stays a bit-for-bit mirror of the same arithmetic
   * on both sides of the boundary; this is the boundary, and a NaN that reaches
   * a filter coefficient does not produce a wrong sound, it produces silence
   * for the rest of the session on that channel.
   */
  post(id: ParamId, normalised: number, sampleOffset = 0): boolean {
    if (!Number.isFinite(normalised)) return false;
    const clamped = normalised < 0 ? 0 : normalised > 1 ? 1 : normalised;

    // Linear scan over what is pending. Parameter counts are tens and the
    // pending set is smaller still, so this beats a hash for the sizes that
    // actually occur — the same reasoning `ParamSet::indexOf` records in C++.
    for (let i = 0; i < this.pending; i++) {
      if (this.ids[i] === id) {
        this.values[i] = clamped;
        this.offsets[i] = sampleOffset;
        return true;
      }
    }

    if (this.pending >= this.ids.length) {
      this.refused += 1;
      return false;
    }
    this.ids[this.pending] = id;
    this.values[this.pending] = clamped;
    this.offsets[this.pending] = sampleOffset;
    this.pending += 1;
    return true;
  }

  /**
   * Hands every pending change to `sink` and empties the queue.
   *
   * The sink is called rather than an array returned, because returning one
   * would allocate on every block — on the consumer's side of the seam, which
   * is the side that cannot afford it.
   */
  drain(sink: (id: ParamId, normalised: number, sampleOffset: number) => void): number {
    const count = this.pending;
    for (let i = 0; i < count; i++) {
      sink(this.ids[i], this.values[i], this.offsets[i]);
    }
    this.pending = 0;
    return count;
  }

  /** Drops everything pending. Used when a graph is rebuilt under the UI. */
  clear(): void {
    this.pending = 0;
  }

  /** A copy of what is pending, for tests and diagnostics only. */
  peek(): ParamChange[] {
    const out: ParamChange[] = [];
    for (let i = 0; i < this.pending; i++) {
      out.push({ id: this.ids[i], normalised: this.values[i], sampleOffset: this.offsets[i] });
    }
    return out;
  }
}
