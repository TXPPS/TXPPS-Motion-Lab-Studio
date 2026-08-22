/**
 * Web Audio measurement taps.
 *
 * This is the only file in the analysis layer that knows Web Audio exists. It
 * owns the nodes, reads them once per animation frame and hands the samples to
 * the pure modules in `model/` — `loudness` for levels, `fft` for the spectrum,
 * `pitch` for the tuner. No React, no store: a meter is a thing you attach to a
 * node, read and dispose of, and it can be driven from anywhere.
 *
 * Two entry points, because the two jobs are genuinely different. A live meter
 * watches a running graph and must not allocate while it does it, so every
 * buffer here is created once and reused; the arrays inside a `TapReading` are
 * the tap's own and are overwritten by the next `sample()`. An offline report
 * reads a finished `AudioBuffer` straight through and can take its time.
 */
import {
  SPECTRUM_FLOOR_DB,
  aggregateBandsDb,
  applyWindow,
  fftInPlace,
  isPowerOfTwo,
  logBands,
  magnitudeInto,
  makeWindow,
} from '../model/fft';
import { LoudnessMeter, dbfsFromAmplitude, measureChannels } from '../model/loudness';
import { PitchDetector } from '../model/pitch';
import type { SpectrumBand, WindowKind } from '../model/fft';
import type { LoudnessMeasurement, LoudnessReading } from '../model/loudness';
import type { PitchOptions, PitchReading } from '../model/pitch';

export type { LoudnessMeasurement, LoudnessReading, PitchReading, SpectrumBand };

export interface MeasurementTapOptions {
  /** Window length in samples; a power of two from 512 to 32768. */
  fftSize?: number;
  /** Analysis window. Blackman-Harris resolves quiet partials next to loud ones. */
  window?: WindowKind;
  /** Number of log-spaced display bands. */
  bandCount?: number;
  /** Lowest and highest band edge, in Hz. */
  minHz?: number;
  maxHz?: number;
  /** How long the peak-hold marker sits still before it starts falling, in seconds. */
  peakHoldSeconds?: number;
  /** How fast the peak-hold marker falls once it lets go, in dB per second. */
  peakFallDbPerSecond?: number;
  /** How fast a spectrum band falls when the energy in it stops, in dB per second. */
  spectrumFallDbPerSecond?: number;
  /** Sample value at or above which the clip indicator latches, linear. */
  clipThreshold?: number;
}

export interface TapReading {
  /** Loudest of the two channels this frame, in dBFS. */
  peakDbfs: number;
  peakLeftDbfs: number;
  peakRightDbfs: number;
  /** Peak-hold marker, in dBFS: holds, then falls at the configured rate. */
  holdDbfs: number;
  /** Unweighted RMS over the meter's recent window, in dBFS. */
  rmsDbfs: number;
  /** Latches once a sample reaches the clip threshold; cleared by `clearClip`. */
  clipped: boolean;
  /** Every loudness figure: momentary, short-term, integrated, LRA, true peak. */
  loudness: LoudnessReading;
  /** Per-band level in dBFS, one entry per `MeasurementTap.bands`. */
  spectrumDb: Float32Array;
  /** Mono sum of the current window, for an oscilloscope. */
  waveform: Float32Array;
  waveformLeft: Float32Array;
  waveformRight: Float32Array;
}

const DEFAULT_FFT_SIZE = 2048;
const MIN_FFT_SIZE = 512;
const MAX_FFT_SIZE = 32768;

/**
 * Measurement tap on any node in a running graph.
 *
 * Attaches in parallel — nothing is inserted into the signal path, so a meter
 * can never colour what it is measuring. Call `sample()` once per animation
 * frame; call `dispose()` when the meter goes off screen.
 */
export class MeasurementTap {
  readonly context: BaseAudioContext;
  readonly fftSize: number;
  readonly bands: readonly SpectrumBand[];

  private readonly source: AudioNode;
  /**
   * Explicit two-channel stage ahead of the splitter. Without it a mono source
   * arrives at the splitter with an empty right channel — the correlation would
   * read 0 and the right meter would sit dead for a perfectly good mono track.
   */
  private readonly stereo: GainNode;
  private readonly splitter: ChannelSplitterNode;
  private readonly analyserLeft: AnalyserNode;
  private readonly analyserRight: AnalyserNode;

  private readonly meter: LoudnessMeter;
  private readonly detector: PitchDetector;

  private readonly left: Float32Array;
  private readonly right: Float32Array;
  private readonly mono: Float32Array;
  private readonly channels: Float32Array[];
  private readonly window: Float32Array;
  private readonly fftReal: Float32Array;
  private readonly fftImag: Float32Array;
  private readonly magnitude: Float32Array;
  private readonly bandScratch: Float32Array;
  private readonly reading: TapReading;

  private readonly peakHoldSeconds: number;
  private readonly peakFallDbPerSecond: number;
  private readonly spectrumFallDbPerSecond: number;
  private readonly clipThreshold: number;

  private holdTimer = 0;
  private lastTime = -1;
  private disposed = false;

  constructor(source: AudioNode, options: MeasurementTapOptions = {}) {
    const ctx = source.context;
    this.context = ctx;
    this.source = source;

    const requested = options.fftSize ?? DEFAULT_FFT_SIZE;
    if (!isPowerOfTwo(requested) || requested < MIN_FFT_SIZE || requested > MAX_FFT_SIZE) {
      throw new Error(`MeasurementTap: fftSize ${requested} is not a power of two in 512…32768`);
    }
    this.fftSize = requested;

    this.stereo = ctx.createGain();
    this.stereo.channelCount = 2;
    this.stereo.channelCountMode = 'explicit';
    this.stereo.channelInterpretation = 'speakers';
    this.splitter = ctx.createChannelSplitter(2);
    this.analyserLeft = ctx.createAnalyser();
    this.analyserRight = ctx.createAnalyser();
    for (const analyser of [this.analyserLeft, this.analyserRight]) {
      analyser.fftSize = this.fftSize;
      // All smoothing here is ours, applied in dB where it belongs.
      analyser.smoothingTimeConstant = 0;
    }
    source.connect(this.stereo);
    this.stereo.connect(this.splitter);
    this.splitter.connect(this.analyserLeft, 0);
    this.splitter.connect(this.analyserRight, 1);

    this.meter = new LoudnessMeter(ctx.sampleRate, { channelCount: 2 });
    this.detector = new PitchDetector(ctx.sampleRate);

    this.left = new Float32Array(this.fftSize);
    this.right = new Float32Array(this.fftSize);
    this.mono = new Float32Array(this.fftSize);
    this.channels = [this.left, this.right];
    this.window = makeWindow(options.window ?? 'hann', this.fftSize);
    this.fftReal = new Float32Array(this.fftSize);
    this.fftImag = new Float32Array(this.fftSize);
    this.magnitude = new Float32Array(this.fftSize / 2 + 1);

    this.bands = logBands(options.bandCount ?? 48, options.minHz ?? 20, options.maxHz ?? 20000);
    this.peakHoldSeconds = options.peakHoldSeconds ?? 1.5;
    this.peakFallDbPerSecond = options.peakFallDbPerSecond ?? 20;
    this.spectrumFallDbPerSecond = options.spectrumFallDbPerSecond ?? 36;
    this.clipThreshold = options.clipThreshold ?? 1;

    this.bandScratch = new Float32Array(this.bands.length);
    const spectrumDb = new Float32Array(this.bands.length).fill(SPECTRUM_FLOOR_DB);
    this.reading = {
      peakDbfs: SPECTRUM_FLOOR_DB,
      peakLeftDbfs: SPECTRUM_FLOOR_DB,
      peakRightDbfs: SPECTRUM_FLOOR_DB,
      holdDbfs: SPECTRUM_FLOOR_DB,
      rmsDbfs: SPECTRUM_FLOOR_DB,
      clipped: false,
      loudness: this.meter.read(),
      spectrumDb,
      waveform: this.mono,
      waveformLeft: this.left,
      waveformRight: this.right,
    };
  }

  /**
   * Read the tap. Returns the same object every time, refilled in place, so
   * hold on to values you need past the next frame rather than to the reading.
   */
  sample(): TapReading {
    const reading = this.reading;
    if (this.disposed) return reading;

    const now = this.context.currentTime;
    const elapsed = this.lastTime < 0 ? 0 : Math.max(0, now - this.lastTime);
    this.lastTime = now;

    this.analyserLeft.getFloatTimeDomainData(this.left);
    this.analyserRight.getFloatTimeDomainData(this.right);

    let peakLeft = 0;
    let peakRight = 0;
    for (let i = 0; i < this.fftSize; i++) {
      const l = this.left[i];
      const r = this.right[i];
      this.mono[i] = (l + r) * 0.5;
      const al = l < 0 ? -l : l;
      const ar = r < 0 ? -r : r;
      if (al > peakLeft) peakLeft = al;
      if (ar > peakRight) peakRight = ar;
    }

    // An analyser always hands back its whole window, so consecutive frames
    // overlap. Feeding the loudness accumulator only the samples that are new
    // since the last frame is what keeps the integrated value honest; a frame
    // late enough to have skipped past a whole window loses the gap, which is
    // the same material a dropped frame lost anyway.
    const fresh = Math.min(this.fftSize, Math.round(elapsed * this.context.sampleRate));
    if (fresh > 0) this.meter.push(this.channels, fresh, this.fftSize - fresh);
    this.meter.read(reading.loudness);

    reading.peakLeftDbfs = dbfsFromAmplitude(peakLeft);
    reading.peakRightDbfs = dbfsFromAmplitude(peakRight);
    const peak = Math.max(peakLeft, peakRight);
    reading.peakDbfs = dbfsFromAmplitude(peak);
    reading.rmsDbfs = reading.loudness.rmsDbfs;
    if (peak >= this.clipThreshold) reading.clipped = true;

    if (reading.peakDbfs >= reading.holdDbfs) {
      reading.holdDbfs = reading.peakDbfs;
      this.holdTimer = this.peakHoldSeconds;
    } else if (this.holdTimer > 0) {
      this.holdTimer -= elapsed;
    } else {
      reading.holdDbfs = Math.max(
        reading.peakDbfs,
        reading.holdDbfs - this.peakFallDbPerSecond * elapsed,
      );
    }

    this.updateSpectrum(elapsed);
    return reading;
  }

  private updateSpectrum(elapsed: number): void {
    applyWindow(this.mono, this.window, this.fftReal, this.fftImag);
    fftInPlace(this.fftReal, this.fftImag);
    magnitudeInto(this.fftReal, this.fftImag, this.magnitude);

    const shown = this.reading.spectrumDb;
    const fresh = aggregateBandsDb(
      this.magnitude,
      this.context.sampleRate,
      this.fftSize,
      this.bands,
      this.bandScratch,
    );
    // Rise instantly, fall at a fixed rate: a band that drops out for a single
    // frame should not make the whole display strobe.
    const fall = this.spectrumFallDbPerSecond * elapsed;
    for (let b = 0; b < shown.length; b++) {
      shown[b] = Math.max(fresh[b], shown[b] - fall, SPECTRUM_FLOOR_DB);
    }
  }

  /**
   * Detect the pitch of the current window. Not part of `sample()`: it costs a
   * multiple of what a frame costs, and a tuner only needs an answer a few times
   * a second. Build the tap with `fftSize: 8192` for a tuner — a shorter window
   * cannot hold two periods of a low note.
   */
  pitch(options?: PitchOptions): PitchReading {
    return this.detector.detect(this.mono, options);
  }

  /** Clear the clip latch without disturbing anything else. */
  clearClip(): void {
    this.reading.clipped = false;
  }

  /** Start the loudness history and the hold markers again, as a new take would. */
  reset(): void {
    this.meter.reset();
    this.meter.read(this.reading.loudness);
    this.reading.clipped = false;
    this.reading.holdDbfs = SPECTRUM_FLOOR_DB;
    this.reading.spectrumDb.fill(SPECTRUM_FLOOR_DB);
    this.holdTimer = 0;
    this.lastTime = -1;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    // The source is the caller's node, not ours. A bare `disconnect()` on it
    // would sever every one of its outputs — including the channel it feeds —
    // so only the one edge this tap added comes out.
    try {
      this.source.disconnect(this.stereo);
    } catch {
      /* already gone */
    }
    for (const node of [this.stereo, this.splitter, this.analyserLeft, this.analyserRight]) {
      try {
        node.disconnect();
      } catch {
        /* already gone */
      }
    }
  }
}

/**
 * Measure a finished buffer end to end: integrated LUFS, loudness range, true
 * peak, sample peak, DC offset and per-channel figures. This is the report a
 * mastering page shows and an export writes out.
 *
 * Works on anything with the `AudioBuffer` shape, so a bounce from an
 * `OfflineAudioContext` and a decoded file are measured by the same code.
 */
export function renderAnalysis(buffer: AudioBuffer): LoudnessMeasurement {
  const channels: Float32Array[] = [];
  for (let c = 0; c < buffer.numberOfChannels; c++) channels.push(buffer.getChannelData(c));
  return measureChannels(channels, buffer.sampleRate);
}
