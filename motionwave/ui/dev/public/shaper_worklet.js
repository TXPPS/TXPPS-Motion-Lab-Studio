/**
 * Motion Wave — the core, running on the audio thread.
 *
 * This is the browser's real-time thread: `process` is called by the audio
 * device, on a deadline, and anything it waits for is a dropout. It is also the
 * thing Ledger cell U21 exists to measure the face against — "60 fps decoupled"
 * is a claim about two clocks, and without a real audio callback there is no
 * second clock to be decoupled from.
 *
 * Two rules follow from that and are the whole design here:
 *
 *  * **Nothing is posted per block.** `postMessage` from a worklet allocates and
 *    queues, 375 times a second at 128 frames and 48 kHz, for a face that
 *    redraws 60 times a second. The state goes into shared memory instead and
 *    the main thread reads whatever is there when it happens to look.
 *  * **The reader is never waited for.** The sequence counter below is the same
 *    seqlock the C++ `VisualPublisher` uses — odd while writing, even when
 *    settled — so a reader that sees the same even value either side of its
 *    copy knows nothing changed underneath it, and the writer never checks
 *    whether anyone is reading. A lock here would be an audio thread blocked by
 *    a repaint.
 *
 * Loaded after `motionwave.worklet.js`, which puts `createMotionWaveCore` in
 * this scope. A worklet global is not a module scope — no `import`, no
 * `import.meta`, no `fetch` — which is why that build is SINGLE_FILE and
 * classic rather than the ES module the main thread loads.
 */

/** Doubles in a published frame: phase, 3 gains, 3 peaks, in, out. */
const FRAME_DOUBLES = 9;

class ShaperProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const shared = options.processorOptions.shared;
    // Two views over one buffer. The sequence is an Int32Array because
    // `Atomics` works on integers, and the frame is doubles because that is
    // what the bridge hands back.
    this.sequence = new Int32Array(shared, 0, 1);
    this.frame = new Float64Array(shared, 8, FRAME_DOUBLES);
    this.ready = false;
    this.blocks = 0;
    this.sampleRateUsed = sampleRate;
    createMotionWaveCore().then((core) => {
      this.core = core;
      core._mw_shaper_prepare(sampleRate, 128, 2);
      core._mw_shaper_set_bpm(120);
      this.port.onmessage = (event) => this.onCommand(event.data);
      this.ready = true;
      this.port.postMessage({ kind: 'ready' });
    });
  }

  onCommand(message) {
    if (message.kind === 'param') {
      this.core._mw_shaper_set_param(message.id, message.value);
    } else if (message.kind === 'curve') {
      const bytes = message.nodes.length * 4 * 8;
      const ptr = this.core._malloc(bytes);
      const base = ptr / 8;
      for (let i = 0; i < message.nodes.length; i++) {
        for (let k = 0; k < 4; k++) this.core.HEAPF64[base + i * 4 + k] = message.nodes[i][k];
      }
      this.core._mw_shaper_set_curve(message.band, ptr, message.nodes.length);
      this.core._free(ptr);
    }
  }

  process(inputs, outputs) {
    const out = outputs[0];
    const frames = out[0].length;
    if (!this.ready) {
      for (const channel of out) channel.fill(0);
      return true;
    }
    const core = this.core;
    const input = inputs[0];
    const inBase = core._mw_shaper_input() / 4;
    const heap = core.HEAPF32;
    // Interleave in, deinterleave out. The boundary is interleaved because one
    // convention across it is worth more than saving a copy on each side.
    for (let i = 0; i < frames; i++) {
      for (let c = 0; c < 2; c++) {
        const source = input[c] ?? input[0];
        heap[inBase + i * 2 + c] = source ? source[i] : 0;
      }
    }
    core._mw_shaper_process(
      frames,
      this.sampleRateUsed,
      (this.blocks * frames) / this.sampleRateUsed,
      1,
    );
    const outBase = core._mw_shaper_output() / 4;
    const heapOut = core.HEAPF32;
    for (let c = 0; c < out.length; c++) {
      const channel = out[c];
      for (let i = 0; i < frames; i++) channel[i] = heapOut[outBase + i * 2 + (c < 2 ? c : 1)];
    }

    // Publish. Odd, write, even — and the fences are `Atomics.store` with its
    // sequential-consistency ordering, which is what JavaScript has in place of
    // the release fences the C++ side uses.
    const seq = Atomics.load(this.sequence, 0);
    Atomics.store(this.sequence, 0, seq + 1);
    const visualBase = core._mw_shaper_visual() / 8;
    for (let i = 0; i < FRAME_DOUBLES; i++) this.frame[i] = core.HEAPF64[visualBase + i];
    Atomics.store(this.sequence, 0, seq + 2);

    this.blocks++;
    return true;
  }
}

registerProcessor('motion-shaper', ShaperProcessor);
