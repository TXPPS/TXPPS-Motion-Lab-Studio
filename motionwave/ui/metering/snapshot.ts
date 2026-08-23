/**
 * Motion Wave — the up path: audio writes, the UI reads, neither waits.
 *
 * ADR-0004 gives the up ring one rule: write-only from audio, never read back,
 * and "a visualiser that blocks the audio thread is a defect". A lock would do
 * that. So this is a seqlock: the producer bumps a sequence word to odd before
 * it writes and to even after, and the reader takes a copy between two even
 * readings of the same value. A reader that catches a write in progress gets
 * nothing and keeps the frame it already had — which is exactly the ADR's other
 * sentence, that a visualiser which misses a frame draws the previous one.
 *
 * The cost of being wrong here is not a wrong picture, it is a dropout. A meter
 * that takes a mutex the audio callback also takes will, one time in some
 * thousands, make the callback wait on the compositor, and the click that comes
 * out of that is the hardest kind of bug to reproduce.
 *
 * The buffers are allocated once, at construction, and never resized. When this
 * moves behind the WASM boundary the arrays become views on a SharedArrayBuffer
 * and nothing else about the algorithm changes — which is the reason the
 * sequence word is already an `Int32Array` read through `Atomics` rather than a
 * plain number field.
 */

/** How many times a reader retries before giving up and keeping its old frame. */
const MAX_READ_ATTEMPTS = 4;

export class MeterSnapshot {
  private readonly values: Float32Array;
  private readonly sequence: Int32Array;

  constructor(slots: number) {
    if (!Number.isInteger(slots) || slots < 1) {
      throw new RangeError(`MeterSnapshot needs at least one slot, got ${slots}`);
    }
    this.values = new Float32Array(slots);
    this.sequence = new Int32Array(1);
  }

  get slots(): number {
    return this.values.length;
  }

  /** The sequence word, for tests that need to observe a write in progress. */
  get version(): number {
    return Atomics.load(this.sequence, 0);
  }

  /**
   * Publishes a whole frame.
   *
   * The odd/even bracket is the entire protocol, and both halves have to happen
   * even if the write between them throws — a sequence left odd makes every
   * later read fail forever, so the meter freezes rather than the frame being
   * skipped once.
   */
  publish(frame: ArrayLike<number>): void {
    Atomics.add(this.sequence, 0, 1);
    try {
      const count = Math.min(frame.length, this.values.length);
      for (let i = 0; i < count; i++) this.values[i] = frame[i];
    } finally {
      Atomics.add(this.sequence, 0, 1);
    }
  }

  /** Publishes one slot, for a producer that updates meters independently. */
  publishSlot(slot: number, value: number): void {
    if (slot < 0 || slot >= this.values.length) return;
    Atomics.add(this.sequence, 0, 1);
    try {
      this.values[slot] = value;
    } finally {
      Atomics.add(this.sequence, 0, 1);
    }
  }

  /**
   * Copies the latest complete frame into `into`, or reports that it could not.
   *
   * Returns false rather than retrying forever or blocking. The reader is the
   * side that can afford to miss; the producer is not, and a reader that spins
   * is a reader that is competing with the audio thread for a core on the
   * phone tier where there are two of them (ADR-0006).
   *
   * On a false return the contents of `into` are unspecified — a seqlock finds
   * out it read a torn frame only after copying it. A caller that has to keep
   * its previous frame reads into a scratch buffer and commits on success,
   * which is what `MeterReader` does and why it owns two arrays.
   */
  read(into: Float32Array): boolean {
    for (let attempt = 0; attempt < MAX_READ_ATTEMPTS; attempt++) {
      const before = Atomics.load(this.sequence, 0);
      if ((before & 1) !== 0) continue;
      const count = Math.min(into.length, this.values.length);
      for (let i = 0; i < count; i++) into[i] = this.values[i];
      const after = Atomics.load(this.sequence, 0);
      if (after === before) return true;
    }
    return false;
  }

  /**
   * Marks a write as begun without writing anything, for tests that need to
   * prove a reader survives a torn frame. Production code uses `publish`.
   */
  beginWriteForTest(): void {
    Atomics.add(this.sequence, 0, 1);
  }

  endWriteForTest(): void {
    Atomics.add(this.sequence, 0, 1);
  }
}
