/**
 * Peak tap — the audio-thread half of the live waveform.
 *
 * Directive 02 §2.1 wants captured frames handed to a background consumer
 * through a lock-free ring, with no display work on the audio thread. On the
 * web that ring needs a `SharedArrayBuffer`, and this application deliberately
 * does not set COOP/COEP (see `src/audio/wam/wamHost.ts` — the plugin host
 * chose the MessagePort transport for the same reason). Without shared memory
 * the only channel to the main thread is `postMessage`, and posting raw frames
 * would mean allocating a buffer per render quantum on the audio thread, which
 * is worse than the thing the rule exists to prevent.
 *
 * So the reduction happens here: two comparisons per sample into a min/max
 * bucket, and a batch of finished buckets posted every few milliseconds. The
 * buffers are pre-allocated and recycled — the main thread posts each one back
 * after reading it — so the steady state allocates nothing.
 *
 * Back-pressure is the interesting case. If the main thread stalls, the pool
 * runs dry, and the choice is to drop buckets or to lose resolution. Dropping
 * leaves a hole in the waveform, and a hole reads as "the recorder missed
 * that", which is the one thing a live waveform must never suggest. So when the
 * pool is empty this widens its buckets instead: the envelope gets coarser and
 * stays continuous, which is the same trade the phone tier makes deliberately.
 */

/** Samples per bucket at full resolution. Matches `livePeaks.ts`. */
const BASE_SAMPLES_PER_BUCKET = 256;
/** Buckets per message. 8 × 256 is about 43 ms at 48 kHz. */
const BUCKETS_PER_POST = 8;
/** Pre-allocated message buffers. Eight of them is ~340 ms of slack. */
const POOL_SIZE = 8;
/** The coarsest the buckets may get under sustained back-pressure. */
const MAX_WIDEN = 16;

class PeakTapProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const opts = (options && options.processorOptions) || {};
    this.samplesPerBucket = opts.samplesPerBucket || BASE_SAMPLES_PER_BUCKET;
    this.pool = [];
    for (let i = 0; i < POOL_SIZE; i++) {
      this.pool.push({
        min: new Float32Array(BUCKETS_PER_POST),
        max: new Float32Array(BUCKETS_PER_POST),
      });
    }
    this.current = this.pool.pop();
    this.filled = 0;
    this.accumulated = 0;
    this.bucketMin = Infinity;
    this.bucketMax = -Infinity;
    /** How many level-0 buckets each posted bucket currently stands for. */
    this.widen = 1;
    this.widenAccumulated = 0;
    this.running = true;

    this.port.onmessage = (event) => {
      const data = event.data;
      if (data && data.recycle) {
        // Returned by the main thread once it has copied the values out.
        this.pool.push({ min: data.min, max: data.max });
      } else if (data && data.stop) {
        this.running = false;
      }
    };
  }

  flush() {
    if (this.filled === 0 || !this.current) return;
    const buffer = this.current;
    this.port.postMessage(
      { min: buffer.min, max: buffer.max, count: this.filled, widen: this.widen },
      [buffer.min.buffer, buffer.max.buffer],
    );
    this.filled = 0;
    this.current = this.pool.pop() || null;
    if (this.current) {
      // Room again: go back to full resolution one step at a time, so a single
      // late frame does not leave the whole take coarse.
      if (this.widen > 1) this.widen = Math.max(1, this.widen >> 1);
    } else if (this.widen < MAX_WIDEN) {
      // No buffer to write into. Widen rather than drop: the envelope loses
      // detail and keeps its continuity, which is the trade the user can live
      // with. Dropping would leave a hole that reads as lost audio.
      this.widen = this.widen << 1;
    }
  }

  process(inputs) {
    if (!this.running) return false;
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    const channel = input[0];
    if (!channel) return true;

    for (let i = 0; i < channel.length; i++) {
      const v = channel[i];
      if (v < this.bucketMin) this.bucketMin = v;
      if (v > this.bucketMax) this.bucketMax = v;
      if (++this.accumulated < this.samplesPerBucket) continue;

      this.accumulated = 0;
      // A widened bucket spans several level-0 buckets, so it keeps
      // accumulating rather than being emitted.
      if (++this.widenAccumulated < this.widen) continue;
      this.widenAccumulated = 0;

      if (this.current) {
        this.current.min[this.filled] = this.bucketMin === Infinity ? 0 : this.bucketMin;
        this.current.max[this.filled] = this.bucketMax === -Infinity ? 0 : this.bucketMax;
        this.filled++;
      }
      this.bucketMin = Infinity;
      this.bucketMax = -Infinity;

      if (this.filled >= BUCKETS_PER_POST || (!this.current && this.pool.length > 0)) {
        if (!this.current) this.current = this.pool.pop() || null;
        else this.flush();
      }
    }
    return true;
  }
}

registerProcessor('peak-tap', PeakTapProcessor);
