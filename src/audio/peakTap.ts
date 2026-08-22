/**
 * The main-thread half of the live waveform.
 *
 * Owns the worklet that reduces the input to min/max buckets, the envelope
 * those buckets are appended to, and the buffer recycling that keeps the audio
 * thread from allocating. Nothing here runs on the audio thread; nothing on the
 * audio thread waits for anything here.
 *
 * One tap per recording track. It attaches to the same source node the take is
 * captured from, so the waveform and the file are the same performance rather
 * than two measurements of it.
 */
import { diagLog } from '../state/diagnostics';
import { BASE_SAMPLES_PER_BUCKET, LivePeaks } from './livePeaks';

/** Where the processor is served from. `public/` is the site root. */
const WORKLET_URL = '/worklets/peak-tap.js';

export interface Batch {
  min: Float32Array;
  max: Float32Array;
  count: number;
  /** Level-0 buckets each posted bucket stands for; >1 under back-pressure. */
  widen: number;
}

/** Loaded once per context — `addModule` on an already-registered name throws. */
const loaded = new WeakSet<BaseAudioContext>();

async function ensureModule(ctx: BaseAudioContext): Promise<boolean> {
  if (loaded.has(ctx)) return true;
  try {
    await ctx.audioWorklet.addModule(WORKLET_URL);
    loaded.add(ctx);
    return true;
  } catch (e) {
    // A missing worklet must not stop a take. The recording is the file; the
    // waveform is a picture of it, and the picture is the part that can fail.
    diagLog('warn', `Live waveform unavailable: ${String(e)}`);
    return false;
  }
}

/**
 * Append one posted batch to an envelope.
 *
 * Exported and separate from the tap because this is where the back-pressure
 * trade is actually paid: a widened bucket stands for several level-0 buckets,
 * so it is appended several times. The envelope keeps its alignment to real
 * time and loses detail instead — if a widened bucket were appended once, the
 * waveform would silently compress, and a take recorded through a stall would
 * end up shorter on screen than it is on disk.
 */
export function appendBatch(peaks: LivePeaks, batch: Batch): void {
  const widen = Math.max(1, batch.widen | 0);
  for (let i = 0; i < batch.count; i++) {
    const min = batch.min[i];
    const max = batch.max[i];
    for (let w = 0; w < widen; w++) peaks.append(min, max);
  }
}

export class PeakTap {
  readonly peaks = new LivePeaks();
  private node: AudioWorkletNode | null = null;
  private source: AudioNode | null = null;
  /** Buckets the worklet had to widen, for the diagnostics report. */
  private widened = 0;

  /**
   * Attach to a source. Returns false when the worklet could not be loaded, in
   * which case the take still records and simply draws nothing.
   */
  async attach(ctx: BaseAudioContext, source: AudioNode): Promise<boolean> {
    this.detach();
    if (!(await ensureModule(ctx))) return false;
    try {
      this.node = new AudioWorkletNode(ctx, 'peak-tap', {
        numberOfInputs: 1,
        numberOfOutputs: 0,
        processorOptions: { samplesPerBucket: BASE_SAMPLES_PER_BUCKET },
      });
    } catch (e) {
      diagLog('warn', `Live waveform node failed: ${String(e)}`);
      return false;
    }
    this.peaks.reset();
    this.widened = 0;
    this.node.port.onmessage = (event: MessageEvent<Batch>) => this.consume(event.data);
    source.connect(this.node);
    this.source = source;
    return true;
  }

  private consume(batch: Batch): void {
    if (!batch || !batch.min) return;
    appendBatch(this.peaks, batch);
    if (batch.widen > 1) this.widened += batch.count;
    // Hand the buffers straight back. Holding them is what empties the pool and
    // forces the worklet to widen.
    this.node?.port.postMessage({ recycle: true, min: batch.min, max: batch.max }, [
      batch.min.buffer,
      batch.max.buffer,
    ]);
  }

  /** Buckets that arrived at reduced resolution because the main thread stalled. */
  get widenedBuckets(): number {
    return this.widened;
  }

  detach(): void {
    if (this.node) {
      try {
        this.node.port.postMessage({ stop: true });
        this.source?.disconnect(this.node);
        this.node.port.onmessage = null;
      } catch {
        /* already torn down */
      }
    }
    this.node = null;
    this.source = null;
  }
}

/**
 * The tap for the take currently being recorded, if any.
 *
 * A module-level single because exactly one take records at a time — the
 * recorder enforces that — and the arrangement needs to reach it from a render
 * without threading it through every component between.
 */
export const livePeakTap = new PeakTap();
