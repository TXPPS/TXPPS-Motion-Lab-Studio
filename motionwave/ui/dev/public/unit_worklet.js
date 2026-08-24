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
 * **There are two frame transports, and which one is in use is decided by the
 * host rather than by preference.** The shared-memory path above needs
 * `SharedArrayBuffer`, which browsers hide unless the page is cross-origin
 * isolated — and MotionLab Studio is deliberately *not* isolated: `public/_headers`
 * and `src/audio/wam/wamHost.ts` both record that COOP and COEP would break
 * cross-origin assets, complicate the service worker's precache, and make
 * hosting third-party WAM plugins harder. So when no shared buffer is handed in,
 * the frame goes over the port instead, throttled to about 60 Hz.
 *
 * That is not the compromise it looks like. The seqlock exists to stop a reader
 * seeing half of a frame while it is being written; a structured clone cannot
 * tear, so the port path needs no lock at all. What it costs is one small
 * message every sixteen milliseconds instead of a store every block — which is
 * *fewer* allocations than the per-block posting this file's first rule
 * forbids, not more.
 *
 * Loaded after `motionwave.worklet.js`, which puts `createMotionWaveCore` in
 * this scope. A worklet global is not a module scope — no `import`, no
 * `import.meta`, no `fetch` — which is why that build is SINGLE_FILE and
 * classic rather than the ES module the main thread loads.
 */

/**
 * What each unit's boundary is called and how wide its frame is.
 *
 * The worklet used to name one unit's exports directly, which meant cell U21 —
 * "the face repaints from state the audio thread published" — could only ever
 * be measured on that unit. The other four had faces, engines and a boundary
 * and no audio thread to be decoupled from, so the cell stayed open for a
 * reason that was really a missing table.
 *
 * The frame width is per unit because a frame is the unit's own shape. Reading
 * the wrong number of doubles would not fail: it would publish neighbouring
 * heap into a meter, which is the kind of wrong that looks like a plausible
 * signal.
 */
const UNITS = {
  'fx-01': { prefix: 'mw_shaper', frame: 9, curve: true, bpm: true },
  'dyn-01': { prefix: 'mw_program_eq', frame: 6, curve: false, bpm: false },
  'dyn-02': { prefix: 'mw_optical_leveller', frame: 5, curve: false, bpm: false },
  'dyn-03': { prefix: 'mw_fet_limiter', frame: 4, curve: false, bpm: false },
  'dyn-04': { prefix: 'mw_variable_mu', frame: 7, curve: false, bpm: false },
  'dyn-05': { prefix: 'mw_console_eq', frame: 7, curve: false, bpm: false },
  'fx-02': { prefix: 'mw_granular_reverb', frame: 7, curve: false, bpm: false },
};

/** The widest frame any unit publishes, which is what the shared buffer holds. */
const MAX_FRAME_DOUBLES = 9;

class UnitProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const shared = options.processorOptions.shared;
    this.spec = UNITS[options.processorOptions.unit] ?? UNITS['fx-01'];
    if (shared) {
      // Two views over one buffer. The sequence is an Int32Array because
      // `Atomics` works on integers, and the frame is doubles because that is
      // what the bridge hands back.
      this.sequence = new Int32Array(shared, 0, 1);
      this.frame = new Float64Array(shared, 8, MAX_FRAME_DOUBLES);
    } else {
      // The port path. The array is allocated once here and reused, so the
      // per-frame cost is the clone and nothing else.
      this.sequence = null;
      this.frame = new Float64Array(MAX_FRAME_DOUBLES);
      this.framesUntilPublish = 0;
    }
    this.ready = false;
    this.blocks = 0;
    this.sampleRateUsed = sampleRate;
    createMotionWaveCore().then((core) => {
      this.core = core;
      // Bound once, so `process` is a few indexed calls rather than a lookup
      // per block on the audio thread.
      const p = this.spec.prefix;
      this.prepare = core[`_${p}_prepare`];
      this.setParam = core[`_${p}_set_param`];
      this.inputPtr = core[`_${p}_input`];
      this.outputPtr = core[`_${p}_output`];
      this.processCall = core[`_${p}_process`];
      this.visualPtr = core[`_${p}_visual`];
      this.setBypassCall = core[`_${p}_set_bypass`];
      this.prepare(sampleRate, 128, 2);
      if (this.spec.bpm) core._mw_shaper_set_bpm(120);
      this.port.onmessage = (event) => this.onCommand(event.data);
      this.ready = true;
      this.port.postMessage({ kind: 'ready' });
    });
  }

  onCommand(message) {
    if (message.kind === 'param') {
      this.setParam(message.id, message.value);
    } else if (message.kind === 'bypass') {
      /*
       * **The unit's own bypass, not a host-side detour around the node.**
       *
       * Every unit implements bypass as "still in circuit, still metering, wet
       * bus not summed" — X24 found four of them publishing zeros here and it
       * is a graded cell. Routing around the node instead would give the host's
       * answer to a question the unit already answers, and would lose the
       * metering that makes a bypassed insert legible.
       *
       * This case was missing, and every unit therefore rendered identically
       * whether bypassed or not — bit-identical, on all seven. Nothing else
       * caught it: the native suites set bypass through the C++ API directly,
       * the WASM boundary test never sends a message, and cell 24 measures a
       * face against its own DSP without a host to bypass it from. It took a
       * row that renders the same unit twice and requires the two to differ.
       */
      if (this.setBypassCall) this.setBypassCall(message.on ? 1 : 0);
    } else if (message.kind === 'curve' && this.spec.curve) {
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
    const inBase = this.inputPtr() / 4;
    const heap = core.HEAPF32;
    // Interleave in, deinterleave out. The boundary is interleaved because one
    // convention across it is worth more than saving a copy on each side.
    for (let i = 0; i < frames; i++) {
      for (let c = 0; c < 2; c++) {
        const source = input[c] ?? input[0];
        heap[inBase + i * 2 + c] = source ? source[i] : 0;
      }
    }
    this.processCall(frames, this.sampleRateUsed, (this.blocks * frames) / this.sampleRateUsed, 1);
    const outBase = this.outputPtr() / 4;
    const heapOut = core.HEAPF32;
    for (let c = 0; c < out.length; c++) {
      const channel = out[c];
      for (let i = 0; i < frames; i++) channel[i] = heapOut[outBase + i * 2 + (c < 2 ? c : 1)];
    }

    const visualBase = this.visualPtr() / 8;
    if (this.sequence) {
      // Publish. Odd, write, even — and the fences are `Atomics.store` with its
      // sequential-consistency ordering, which is what JavaScript has in place
      // of the release fences the C++ side uses.
      const seq = Atomics.load(this.sequence, 0);
      Atomics.store(this.sequence, 0, seq + 1);
      for (let i = 0; i < this.spec.frame; i++) this.frame[i] = core.HEAPF64[visualBase + i];
      for (let i = this.spec.frame; i < MAX_FRAME_DOUBLES; i++) this.frame[i] = 0;
      Atomics.store(this.sequence, 0, seq + 2);
    } else {
      /*
       * The port path, throttled in *samples* rather than in blocks.
       *
       * Counting blocks would make the publish rate depend on the host's buffer
       * size — 60 Hz at 128 frames and 15 Hz at 512 — which is the defect
       * GE-18 measures one layer down, where the engine's own publish interval
       * had to be counted in samples for the same reason. A face that got
       * slower on a host with a larger buffer would look like a performance
       * problem and be an arithmetic one.
       */
      this.framesUntilPublish -= frames;
      if (this.framesUntilPublish <= 0) {
        this.framesUntilPublish += Math.max(1, Math.round(this.sampleRateUsed / 60));
        for (let i = 0; i < this.spec.frame; i++) this.frame[i] = core.HEAPF64[visualBase + i];
        for (let i = this.spec.frame; i < MAX_FRAME_DOUBLES; i++) this.frame[i] = 0;
        // A copy, because the array is reused: posting the view itself would
        // let the next block overwrite a frame already in flight.
        this.port.postMessage({ kind: 'frame', frame: this.frame.slice(0, this.spec.frame) });
      }
    }

    this.blocks++;
    return true;
  }
}

registerProcessor('motion-wave-unit', UnitProcessor);
