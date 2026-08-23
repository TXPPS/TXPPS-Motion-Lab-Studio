/**
 * Motion Wave — a whole-sample delay, pre-allocated.
 *
 * Used to hold the dry leg of a blend back to meet a wet leg that has been
 * through something with latency. Nothing here allocates after construction and
 * nothing here branches on the buffer size, because the same code has to be
 * callable from the WASM build inside an audio callback, where either would be
 * a defect rather than a slow path.
 */

export class DelayLine {
  private readonly buffer: Float32Array;
  private readonly delay: number;
  private writeIndex = 0;

  constructor(delayFrames: number) {
    if (!Number.isInteger(delayFrames) || delayFrames < 0) {
      throw new RangeError(
        `delay must be a non-negative whole number of frames, got ${delayFrames}`,
      );
    }
    this.delay = delayFrames;
    // One extra slot so a delay of n can be read before the write of the same
    // sample lands on it; a buffer of exactly n makes the read and the write
    // collide at the wrap and the line returns the current sample instead.
    this.buffer = new Float32Array(delayFrames + 1);
  }

  get delayFrames(): number {
    return this.delay;
  }

  /** Clears the tail. Called when transport relocates, so old audio is not replayed. */
  reset(): void {
    this.buffer.fill(0);
    this.writeIndex = 0;
  }

  /**
   * One sample in, the sample from `delayFrames` ago out.
   *
   * Sample-at-a-time rather than block-at-a-time so that every caller is safe
   * against aliasing without having to think about it: a consumer reads its
   * inputs for sample `i` before it writes its output for sample `i`, so an
   * output buffer that happens to be one of the inputs is correct rather than
   * corrupted. A block-wise version would need a scratch buffer, and a scratch
   * buffer needs a maximum block size declared somewhere, which is one more
   * thing a unit can get wrong.
   *
   * Reading before writing is also what makes a delay of one sample return the
   * previous sample rather than the current one.
   */
  tick(input: number): number {
    if (this.delay === 0) return input;
    const size = this.buffer.length;
    const readIndex = this.writeIndex - this.delay + (this.writeIndex < this.delay ? size : 0);
    const delayed = this.buffer[readIndex];
    this.buffer[this.writeIndex] = input;
    this.writeIndex += 1;
    if (this.writeIndex >= size) this.writeIndex = 0;
    return delayed;
  }

  /** A whole buffer, in place if `input` and `output` are the same array. */
  process(input: Float32Array, output: Float32Array, frames: number): void {
    for (let i = 0; i < frames; i++) output[i] = this.tick(input[i]);
  }
}
