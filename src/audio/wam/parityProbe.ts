/**
 * The parity probe: does this plugin render offline the way it sounds live?
 *
 * A bounce that matches what was monitored is the product's central guarantee,
 * and `exportMix.ts` earns it by rebuilding the render graph from the same
 * primitives the live engine uses. There is exactly one renderer, and that is
 * why it holds up.
 *
 * A WAM is offline-capable by construction — the API is typed on
 * `BaseAudioContext` throughout, `OfflineAudioContext` inherits `audioWorklet`,
 * and `scheduleEvents` drains against sample position inside the processor, so
 * nothing needs the main thread to be serviced mid-render. That covers the
 * mechanism. It does not cover the plugin's own behaviour: a plugin is free to
 * drive its own parameters from a main-thread `requestAnimationFrame` or
 * `setInterval` tick — a GUI-animated LFO, a meter-driven auto-gain. Offline
 * the render completes faster than wall clock and those ticks never fire in
 * step, so the plugin renders differently from what was monitored. Silently.
 * With no error. Nothing in the WAM API lets a host detect this in advance.
 *
 * So we measure it instead of hoping. One short fixed stimulus, rendered twice
 * — once through an `OfflineAudioContext`, once captured from a live one — and
 * the two envelopes compared. The verdict is cached against the plugin's
 * identifier and version, so it costs a second once per plugin, ever.
 *
 * A plugin that fails becomes `print-required`: the bounce refuses to render it
 * live and asks for the track to be frozen first. Freeze is not a second
 * renderer — `freeze.ts` prints through `renderProject` on a single-track
 * project, so it is the *same* renderer and no drift is possible. The user gets
 * a correct bounce either way; they pay for it with a freeze on the tracks that
 * need one.
 *
 * What this file deliberately is not: a realtime-capture fallback renderer. The
 * capture here runs for half a second, on a fixed stimulus, to answer one
 * question. Turning it into a general export path would give us two renderers
 * that could drift from each other, which is the exact failure the current
 * architecture exists to prevent.
 */
import { diagLog } from '../../state/diagnostics';

/** Probe length. Long enough for a slow main-thread LFO to move — a 60 Hz rAF
 *  tick gets ~45 chances to diverge — short enough that nobody notices it. */
export const PROBE_SECONDS = 0.75;
export const PROBE_SAMPLE_RATE = 44100;
/** How many RMS windows the envelopes are compared over. */
export const PROBE_WINDOWS = 24;

export type ParityVerdict = 'pass' | 'fail' | 'inconclusive';

export interface ParityResult {
  verdict: ParityVerdict;
  /** Largest per-window disagreement, relative to the louder envelope's peak. */
  maxWindowError: number;
  /** Overall level ratio, offline ÷ realtime. 1 is agreement. */
  levelRatio: number;
  note: string;
}

export interface ParityRecord extends ParityResult {
  /** `identifier@version` — a new version is a new plugin as far as this goes. */
  key: string;
  at: number;
}

export interface ParityThresholds {
  /**
   * Per-window tolerance. Realtime capture goes through the device's own clock
   * and buffering, so it is never bit-identical to an offline render even for a
   * perfectly well-behaved plugin; this has to absorb that without absorbing a
   * real divergence. A main-thread-driven modulation changes the envelope
   * *shape*, which is a much larger effect than capture noise.
   */
  window: number;
  /** How far the overall level may differ before we call it a divergence. */
  level: number;
  /** Below this RMS both renders count as silence and nothing is proven. */
  silence: number;
}

export const DEFAULT_THRESHOLDS: ParityThresholds = {
  window: 0.18,
  level: 0.12,
  silence: 1e-4,
};

/**
 * Compare two RMS envelopes and decide.
 *
 * Pure, and separated from everything that needs a browser, because this is the
 * part that has to be right and the part a unit test can actually pin down.
 */
export function compareParity(
  offline: readonly number[],
  realtime: readonly number[],
  thresholds: ParityThresholds = DEFAULT_THRESHOLDS,
): ParityResult {
  const n = Math.min(offline.length, realtime.length);
  if (n === 0) {
    return {
      verdict: 'inconclusive',
      maxWindowError: 0,
      levelRatio: 1,
      note: 'The probe produced no windows to compare.',
    };
  }

  const meanOf = (a: readonly number[]) => a.slice(0, n).reduce((s, v) => s + v, 0) / n;
  const offlineMean = meanOf(offline);
  const realtimeMean = meanOf(realtime);

  // Both silent: the plugin made no sound on this stimulus. That is not
  // evidence of divergence — it is a plugin that needs MIDI, or one whose
  // default state is a hard mute. Refusing to bounce every quiet plugin would
  // be wrong; recording that we learned nothing is right, and the caller
  // deliberately does not cache an inconclusive verdict, so it is retried.
  if (offlineMean < thresholds.silence && realtimeMean < thresholds.silence) {
    return {
      verdict: 'inconclusive',
      maxWindowError: 0,
      levelRatio: 1,
      note: 'The plugin produced no output on the probe signal, so parity could not be measured.',
    };
  }

  // One silent and the other not is the clearest possible divergence: the
  // plugin works in one context and not the other.
  if (offlineMean < thresholds.silence || realtimeMean < thresholds.silence) {
    return {
      verdict: 'fail',
      maxWindowError: 1,
      levelRatio: realtimeMean > 0 ? offlineMean / realtimeMean : 0,
      note:
        offlineMean < thresholds.silence
          ? 'The plugin is silent when rendered offline but not in playback.'
          : 'The plugin is silent in playback but not when rendered offline.',
    };
  }

  const scale = Math.max(...offline.slice(0, n), ...realtime.slice(0, n));
  let maxWindowError = 0;
  for (let i = 0; i < n; i++) {
    maxWindowError = Math.max(maxWindowError, Math.abs(offline[i] - realtime[i]) / scale);
  }
  const levelRatio = offlineMean / realtimeMean;
  const levelError = Math.abs(levelRatio - 1);

  if (maxWindowError <= thresholds.window && levelError <= thresholds.level) {
    return {
      verdict: 'pass',
      maxWindowError,
      levelRatio,
      note: 'Offline and playback renders agree; this plugin bounces through the normal path.',
    };
  }
  return {
    verdict: 'fail',
    maxWindowError,
    levelRatio,
    note:
      levelError > thresholds.level && maxWindowError <= thresholds.window
        ? `Offline renders at ${levelRatio.toFixed(2)}× the level it plays at.`
        : `Offline and playback envelopes diverge by ${(maxWindowError * 100).toFixed(0)}% ` +
          'of peak — the plugin is probably driven from the main thread, which an ' +
          'offline render does not run in step.',
  };
}

/** Does a plugin have to be printed before it can be bounced? */
export function isPrintRequired(record: ParityRecord | undefined): boolean {
  return record?.verdict === 'fail';
}

/** `identifier@version`. A plugin update invalidates its own verdict, which is
 *  the whole of the cache-invalidation story and all it needs to be. */
export function parityKey(identifier: string, version: string): string {
  return `${identifier}@${version}`;
}

// ---------------------------------------------------------------- the cache

const STORE_KEY = 'motionlab.pluginParity.v1';
let cache: Map<string, ParityRecord> | null = null;

function loadCache(): Map<string, ParityRecord> {
  if (cache) return cache;
  cache = new Map();
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
          const r = v as Partial<ParityRecord>;
          if (r && (r.verdict === 'pass' || r.verdict === 'fail')) {
            cache.set(k, {
              key: k,
              verdict: r.verdict,
              maxWindowError: typeof r.maxWindowError === 'number' ? r.maxWindowError : 0,
              levelRatio: typeof r.levelRatio === 'number' ? r.levelRatio : 1,
              note: typeof r.note === 'string' ? r.note : '',
              at: typeof r.at === 'number' ? r.at : 0,
            });
          }
        }
      }
    }
  } catch {
    /* a probe cache that cannot be read is a probe cache that is empty */
  }
  return cache;
}

export function getParityRecord(identifier: string, version: string): ParityRecord | undefined {
  return loadCache().get(parityKey(identifier, version));
}

/** Only decided verdicts are cached. An inconclusive probe is retried, because
 *  "we could not measure" must never harden into "we decided". */
export function recordParity(identifier: string, version: string, result: ParityResult): void {
  if (result.verdict === 'inconclusive') return;
  const key = parityKey(identifier, version);
  const rec: ParityRecord = { ...result, key, at: Date.now() };
  loadCache().set(key, rec);
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(Object.fromEntries(loadCache())));
  } catch {
    /* out of quota: the verdict still holds for this session */
  }
  diagLog(
    result.verdict === 'fail' ? 'warn' : 'info',
    `Plugin parity ${result.verdict}: ${key} — ${result.note}`,
  );
}

/** Test seam. */
export function clearParityCache(): void {
  cache = null;
  try {
    localStorage.removeItem(STORE_KEY);
  } catch {
    /* nothing stored */
  }
}

// ------------------------------------------------------------- measurement

/** RMS envelope of one channel, in `windows` equal slices. */
export function rmsEnvelope(data: Float32Array, windows = PROBE_WINDOWS): number[] {
  const out: number[] = [];
  const per = Math.floor(data.length / windows);
  if (per <= 0) return out;
  for (let w = 0; w < windows; w++) {
    let sum = 0;
    const a = w * per;
    const b = a + per;
    for (let i = a; i < b; i++) sum += data[i] * data[i];
    out.push(Math.sqrt(sum / per));
  }
  return out;
}

/**
 * The probe stimulus: a steady tone with a slow amplitude sweep on top.
 *
 * Steady so that a plugin's own modulation is the only thing that can change
 * the envelope; swept so that a level-dependent plugin (a compressor, a
 * waveshaper) is exercised across its range rather than sitting at one point.
 * Deterministic — no noise — because the two renders have to be comparable.
 */
export function probeStimulus(ctx: BaseAudioContext, seconds = PROBE_SECONDS): AudioBuffer {
  const frames = Math.floor(seconds * ctx.sampleRate);
  const buf = ctx.createBuffer(2, frames, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < frames; i++) {
      const t = i / ctx.sampleRate;
      const sweep = 0.15 + 0.75 * (i / frames);
      d[i] = Math.sin(2 * Math.PI * 220 * t) * sweep * 0.8;
    }
  }
  return buf;
}

/**
 * A tiny AudioWorklet that copies its input back to the main thread.
 *
 * This exists so the realtime half of the probe measures the actual output of
 * the audio thread rather than an `AnalyserNode` snapshot, which would miss
 * samples between polls and could not see an envelope at all. It is installed
 * from a Blob URL, exactly the way the WAM SDK installs its own environment.
 */
const CAPTURE_PROCESSOR = `
registerProcessor('motionlab-parity-capture', class extends AudioWorkletProcessor {
  constructor(options) {
    super(options);
    this.limit = options.processorOptions.frames;
    this.buf = new Float32Array(this.limit);
    this.at = 0;
    this.done = false;
  }
  process(inputs) {
    if (this.done) return false;
    const ch = inputs[0] && inputs[0][0];
    if (ch) {
      const n = Math.min(ch.length, this.limit - this.at);
      this.buf.set(ch.subarray(0, n), this.at);
      this.at += n;
    }
    if (this.at >= this.limit) {
      this.done = true;
      this.port.postMessage(this.buf, [this.buf.buffer]);
      return false;
    }
    return true;
  }
});`;

export async function captureRealtime(
  ctx: BaseAudioContext,
  connect: (source: AudioNode) => AudioNode,
  seconds = PROBE_SECONDS,
): Promise<Float32Array> {
  const frames = Math.floor(seconds * ctx.sampleRate);
  const url = URL.createObjectURL(new Blob([CAPTURE_PROCESSOR], { type: 'text/javascript' }));
  try {
    await ctx.audioWorklet.addModule(url);
  } finally {
    URL.revokeObjectURL(url);
  }
  const capture = new AudioWorkletNode(ctx, 'motionlab-parity-capture', {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [1],
    processorOptions: { frames },
  });
  const src = ctx.createBufferSource();
  src.buffer = probeStimulus(ctx, seconds);
  const out = connect(src);
  out.connect(capture);
  // The capture node is not connected onward: the probe must not be audible.
  const done = new Promise<Float32Array>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('realtime capture timed out')),
      Math.max(3000, seconds * 4000),
    );
    capture.port.onmessage = (e: MessageEvent) => {
      clearTimeout(timer);
      resolve(new Float32Array(e.data as ArrayBufferLike));
    };
  });
  src.start();
  try {
    return await done;
  } finally {
    try {
      src.stop();
    } catch {
      /* already stopped */
    }
    src.disconnect();
    capture.disconnect();
  }
}

/**
 * Run the probe for one plugin and cache the verdict.
 *
 * Once per plugin identifier+version, ever. Called after a plugin is first
 * instantiated; failures to run are inconclusive, never a blocked export.
 *
 * `liveCtx` is the engine's own context. Without one there is nothing to
 * compare against — on a page where audio has never been started, or in a
 * browser that will not give us a running context, the probe cannot answer and
 * says so rather than guessing.
 */
export async function runParityProbe(
  ref: { identifier: string; version: string; name: string; source: string },
  liveCtx: BaseAudioContext | null,
): Promise<ParityResult> {
  const cached = getParityRecord(ref.identifier, ref.version);
  if (cached) return cached;

  const { resolveSource } = await import('./shelf');
  const { loadPluginModule, wamHostFor } = await import('./wamHost');
  const resolved = resolveSource(ref.source);
  if (resolved.url === null) {
    return {
      verdict: 'inconclusive',
      maxWindowError: 0,
      levelRatio: 1,
      note: resolved.reason,
    };
  }

  let result: ParityResult;
  try {
    const Ctor = await loadPluginModule(resolved.url);

    // ---- offline half -------------------------------------------------
    const frames = Math.floor(PROBE_SECONDS * PROBE_SAMPLE_RATE);
    const offCtx = new OfflineAudioContext(1, frames, PROBE_SAMPLE_RATE);
    const offGroup = await wamHostFor(offCtx);
    const offInst = await Ctor.createInstance(offGroup, offCtx);
    const offSrc = offCtx.createBufferSource();
    offSrc.buffer = probeStimulus(offCtx);
    offSrc.connect(offInst.audioNode);
    offInst.audioNode.connect(offCtx.destination);
    offSrc.start();
    const rendered = await offCtx.startRendering();
    const offlineEnv = rmsEnvelope(rendered.getChannelData(0));
    offInst.audioNode.destroy();

    // ---- realtime half ------------------------------------------------
    if (!liveCtx || typeof AudioWorkletNode === 'undefined') {
      result = {
        verdict: 'inconclusive',
        maxWindowError: 0,
        levelRatio: 1,
        note: 'No running audio context, so the playback half of the probe could not run.',
      };
    } else {
      const liveGroup = await wamHostFor(liveCtx);
      const liveInst = await Ctor.createInstance(liveGroup, liveCtx);
      try {
        const captured = await captureRealtime(liveCtx, (src) => {
          src.connect(liveInst.audioNode);
          return liveInst.audioNode;
        });
        result = compareParity(offlineEnv, rmsEnvelope(captured));
      } finally {
        try {
          liveInst.audioNode.destroy();
        } catch {
          /* teardown of a plugin that already threw */
        }
      }
    }
  } catch (e) {
    result = {
      verdict: 'inconclusive',
      maxWindowError: 0,
      levelRatio: 1,
      note: `The parity probe could not run: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  recordParity(ref.identifier, ref.version, result);
  return result;
}

/**
 * Which plugins in a project must be printed before the project can be bounced.
 *
 * Read from the cache only — this is called on the export path, which is not
 * the place to start running probes. A plugin nobody has probed yet renders
 * through the normal offline path, which is correct by construction for every
 * plugin that does not drive itself from the main thread.
 */
export function printRequiredPlugins(
  effects: readonly { id: string; plugin?: { identifier: string; version: string; name: string } }[],
): { effectId: string; name: string; note: string }[] {
  const out: { effectId: string; name: string; note: string }[] = [];
  for (const e of effects) {
    if (!e.plugin) continue;
    const rec = getParityRecord(e.plugin.identifier, e.plugin.version);
    if (isPrintRequired(rec)) {
      out.push({ effectId: e.id, name: e.plugin.name, note: rec!.note });
    }
  }
  return out;
}
