/**
 * Audio → Note: turn a recording into editable notes.
 *
 * Pure numbers in, note objects out. No DOM, no Web Audio, no React, so the
 * whole pass can be moved to a worker as-is.
 *
 * What this is, plainly:
 *
 * - The monophonic path is a pitch tracker (YIN, from `pitch.ts`) plus an onset
 *   stream (spectral flux, from `transients.ts`), median-filtered and segmented.
 *   On a single sung or played line — voice, bass, lead synth, wind, one string
 *   at a time — it is accurate. Given a chord it will report one note, usually
 *   the loudest, and given two instruments at once it will report nonsense; that
 *   is what "monophonic" means, and there is no cleverness here that hides it.
 *
 * - The polyphonic path is harmonic-sum salience over a MIDI-note grid with
 *   greedy estimate-and-cancel per frame. It resolves chords and simple
 *   polyphony — a piano voicing, a guitar chord, a two- or three-part texture
 *   recorded on its own. It is **not** a transcriber for a dense mix: with
 *   drums, bass, several instruments and reverb in one file it will return a
 *   plausible-looking but musically wrong note list. A neural transcriber is
 *   what does that job, and there is not one in this module.
 *
 * Two further limits worth stating rather than discovering:
 *
 * - The polyphonic path requires a candidate's own fundamental to be present in
 *   the spectrum. That is what stops every note being shadowed by a phantom an
 *   octave below it, and it also means an instrument whose fundamental is weak
 *   (a low piano note, a bass through a small speaker's worth of EQ) can be
 *   reported an octave high.
 * - Time resolution differs between the paths. The monophonic path places note
 *   starts on detected onsets and is good to a few milliseconds; the polyphonic
 *   path resolves to one STFT frame — tens of milliseconds — and only refines a
 *   start when an onset happens to sit nearby.
 */
import { applyWindow, fftInPlace, magnitudeInto, makeWindow, nextPowerOfTwo } from './fft';
import { quantizeNotes } from './midiTools';
import { PitchDetector } from './pitch';
import { beatToSec, secToBeat, type TempoMap } from './tempo';
import { detectTransients, type Transient } from './transients';
import type { Note } from './types';

export type AudioToNotesMode = 'mono' | 'poly';

/** One note as the detector found it, in seconds against the analysed buffer. */
export interface DetectedNote {
  startSec: number;
  durSec: number;
  /** MIDI note number, middle C = 60. */
  pitch: number;
  /** 1..127. */
  velocity: number;
  /** 0..1: how much the detector trusts this note. */
  confidence: number;
}

export interface AudioToNotesOptions {
  mode?: AudioToNotesMode;
  /**
   * The one knob, 0..1. It moves the onset detector's own sensitivity, the
   * confidence a monophonic frame needs to count as voiced, and the salience a
   * polyphonic candidate needs to be kept.
   */
  sensitivity?: number;
  /** Notes shorter than this are dropped as detection debris. */
  minNoteMs?: number;
  /** Lowest fundamental to look for. Also sets the monophonic window length. */
  minHz?: number;
  /** Highest fundamental to look for. */
  maxHz?: number;
  /** Tuning of A4, so a track recorded at 442 Hz still names the right notes. */
  referenceHz?: number;
  /** Pitch move, in cents, that ends the current note when it is sustained. */
  splitCents?: number;
  /**
   * How long a departure has to last before it counts as a new note. This is
   * the hysteresis that keeps vibrato and a scooped entry inside one note.
   */
  hysteresisMs?: number;
  /** Grid in beats to quantize starts to. Needs `tempoMap`; 0 leaves timing alone. */
  quantizeGrid?: number;
  /** 0..1, how far toward the grid. 1 is a hard snap. */
  quantizeStrength?: number;
  /** Required for `quantizeGrid`, and by `detectedNotesToNotes`. */
  tempoMap?: TempoMap;
  /** Timeline position of the first sample, needed when quantizing. */
  clipStartSec?: number;
  /** Polyphonic only: most simultaneous notes reported per frame. */
  maxPolyphony?: number;
  /** Transform length. Rounded up to a power of two. */
  fftSize?: number;
}

const DEFAULT_MIN_HZ = 65;
const DEFAULT_MAX_HZ = 1600;
const DEFAULT_MIN_NOTE_MS = 50;
const DEFAULT_SPLIT_CENTS = 100;
const DEFAULT_HYSTERESIS_MS = 55;
const DEFAULT_REFERENCE_HZ = 440;
const DEFAULT_MAX_POLYPHONY = 6;

/** Level that maps to velocity 1. Below it a note is too quiet to be played back. */
const VELOCITY_FLOOR_DB = -48;
/** Window over which a note's attack level is measured for its velocity. */
const VELOCITY_WINDOW_SEC = 0.04;

/** Analysis hop as a fraction of the pitch window: eight-fold overlap. */
const PITCH_OVERLAP = 8;
/** Width of the median filter on the pitch track, in frames. Odd by construction. */
const PITCH_MEDIAN_FRAMES = 5;
/** Frames of the note used to fix the reference its splits are measured against. */
const REFERENCE_FRAMES = 128;
/** A note start within this of a detected onset is moved onto the onset. */
const ONSET_SNAP_SEC = 0.045;
/** Fine envelope used for velocity and for refining starts and ends. */
const ENVELOPE_WINDOW_SEC = 0.012;
const ENVELOPE_HOP_SEC = 0.003;
/** Fraction of a note's own peak level that counts as the note having stopped. */
const RELEASE_FRACTION = 0.12;

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function clamp01(v: number): number {
  return clamp(v, 0, 1);
}

function hzToMidi(hz: number, referenceHz: number): number {
  return 69 + 12 * Math.log2(hz / referenceHz);
}

function midiToHz(midi: number, referenceHz: number): number {
  return referenceHz * Math.pow(2, (midi - 69) / 12);
}

function levelToVelocity(rms: number): number {
  if (!(rms > 0)) return 1;
  const db = 20 * Math.log10(rms);
  const t = clamp01((db - VELOCITY_FLOOR_DB) / -VELOCITY_FLOOR_DB);
  return clamp(Math.round(1 + t * 126), 1, 127);
}

/** Median of a copy; the caller's array is left alone. */
function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Weighted median: the value where half the weight lies either side. Used for a
 * note's pitch instead of a mean because one badly-tracked frame at a note
 * boundary must not drag the whole note a semitone, and unlike a plain median it
 * lets a confident, loud frame count for more than a doubtful one.
 */
function weightedMedian(values: readonly number[], weights: readonly number[]): number {
  if (values.length === 0) return 0;
  const order = values.map((v, i) => ({ v, w: weights[i] > 0 ? weights[i] : 0 }));
  order.sort((a, b) => a.v - b.v);
  let total = 0;
  for (const item of order) total += item.w;
  if (total <= 0) return median(values);
  let acc = 0;
  for (const item of order) {
    acc += item.w;
    if (acc >= total / 2) return item.v;
  }
  return order[order.length - 1].v;
}

interface Envelope {
  values: Float32Array;
  hopSec: number;
  /** Time of value 0: the centre of the first window. */
  startSec: number;
}

/**
 * Short-window RMS at a much finer hop than the pitch analysis. The pitch window
 * is tens of milliseconds long and therefore cannot say where inside itself a
 * note began; this can, and it is what turns a "somewhere in this frame" start
 * into a start a musician would agree with.
 */
function rmsEnvelope(samples: Float32Array, sampleRate: number): Envelope {
  const win = Math.max(8, Math.round(ENVELOPE_WINDOW_SEC * sampleRate));
  const hop = Math.max(1, Math.round(ENVELOPE_HOP_SEC * sampleRate));
  const frames = samples.length < win ? 0 : Math.floor((samples.length - win) / hop) + 1;
  const values = new Float32Array(Math.max(0, frames));
  for (let f = 0; f < frames; f++) {
    const start = f * hop;
    let sum = 0;
    for (let i = 0; i < win; i++) {
      const s = samples[start + i];
      sum += s * s;
    }
    values[f] = Math.sqrt(sum / win);
  }
  return { values, hopSec: hop / sampleRate, startSec: win / 2 / sampleRate };
}

function envelopeIndexAt(env: Envelope, timeSec: number): number {
  if (env.values.length === 0) return -1;
  const i = Math.round((timeSec - env.startSec) / env.hopSec);
  return clamp(i, 0, env.values.length - 1);
}

function envelopePeak(env: Envelope, fromSec: number, toSec: number): number {
  if (env.values.length === 0) return 0;
  const from = envelopeIndexAt(env, fromSec);
  const to = envelopeIndexAt(env, toSec);
  let peak = 0;
  for (let i = Math.min(from, to); i <= Math.max(from, to); i++) {
    if (env.values[i] > peak) peak = env.values[i];
  }
  return peak;
}

/** Walk back from `fromSec` to where the level last came up through the threshold. */
function refineStart(env: Envelope, fromSec: number, limitSec: number, threshold: number): number {
  if (env.values.length === 0 || !(threshold > 0)) return fromSec;
  const from = envelopeIndexAt(env, fromSec);
  const limit = envelopeIndexAt(env, limitSec);
  for (let i = from; i > limit; i--) {
    if (env.values[i] < threshold) return env.startSec + (i + 1) * env.hopSec;
  }
  return Math.max(limitSec, 0);
}

/** Walk forward from `fromSec` to where the level falls through the threshold. */
function refineEnd(env: Envelope, fromSec: number, limitSec: number, threshold: number): number {
  if (env.values.length === 0 || !(threshold > 0)) return fromSec;
  const from = envelopeIndexAt(env, fromSec);
  const limit = envelopeIndexAt(env, limitSec);
  for (let i = from; i < limit; i++) {
    if (env.values[i] < threshold) return env.startSec + i * env.hopSec;
  }
  return limitSec;
}

function nearestOnset(onsets: readonly Transient[], timeSec: number, toleranceSec: number): number {
  let best = -1;
  let bestDistance = toleranceSec;
  for (const onset of onsets) {
    const d = Math.abs(onset.timeSec - timeSec);
    if (d <= bestDistance) {
      bestDistance = d;
      best = onset.timeSec;
    }
  }
  return best;
}

interface PitchFrame {
  timeSec: number;
  /** Fractional MIDI number, or 0 when the frame is unvoiced. */
  midi: number;
  confidence: number;
  rms: number;
  voiced: boolean;
}

function analysePitchFrames(
  samples: Float32Array,
  sampleRate: number,
  minHz: number,
  maxHz: number,
  referenceHz: number,
  minConfidence: number,
): { frames: PitchFrame[]; windowSec: number } {
  // YIN compares a window against itself shifted by up to one period, so the
  // window has to hold two periods of the lowest note asked for.
  const size = nextPowerOfTwo(Math.ceil((2 * sampleRate) / minHz));
  const hop = Math.max(1, Math.round(size / PITCH_OVERLAP));
  const frames: PitchFrame[] = [];
  if (samples.length < size) return { frames, windowSec: size / sampleRate };

  const detector = new PitchDetector(sampleRate);
  const window = new Float32Array(size);
  const count = Math.floor((samples.length - size) / hop) + 1;
  for (let f = 0; f < count; f++) {
    const start = f * hop;
    window.set(samples.subarray(start, start + size));
    let energy = 0;
    for (let i = 0; i < size; i++) energy += window[i] * window[i];
    const rms = Math.sqrt(energy / size);
    const reading = detector.detect(window, { minHz, maxHz, minConfidence: 0 });
    const voiced = reading.hz > 0 && reading.confidence >= minConfidence;
    frames.push({
      timeSec: (start + size / 2) / sampleRate,
      midi: voiced ? hzToMidi(reading.hz, referenceHz) : 0,
      confidence: reading.confidence,
      rms,
      voiced,
    });
  }
  return { frames, windowSec: size / sampleRate };
}

/**
 * Median filter over voiced frames only. A five-frame median removes the single
 * octave slips and half-period errors YIN makes at note boundaries without
 * rounding off a real glide, and skipping unvoiced neighbours stops silence from
 * being averaged into the note either side of it.
 */
function medianFilterPitch(frames: PitchFrame[]): void {
  const radius = (PITCH_MEDIAN_FRAMES - 1) / 2;
  const source = frames.map((f) => (f.voiced ? f.midi : NaN));
  const neighbourhood: number[] = [];
  for (let i = 0; i < frames.length; i++) {
    if (!frames[i].voiced) continue;
    neighbourhood.length = 0;
    for (let j = i - radius; j <= i + radius; j++) {
      if (j < 0 || j >= source.length) continue;
      const v = source[j];
      if (Number.isFinite(v)) neighbourhood.push(v);
    }
    frames[i].midi = median(neighbourhood);
  }
}

interface NoteBuild {
  startSec: number;
  midis: number[];
  weights: number[];
  confidences: number[];
  lastVoicedSec: number;
}

function finishNote(
  build: NoteBuild,
  endSec: number,
  env: Envelope,
  minNoteSec: number,
): DetectedNote | null {
  if (build.midis.length === 0) return null;
  const pitch = clamp(Math.round(weightedMedian(build.midis, build.weights)), 0, 127);
  let confidence = 0;
  for (const c of build.confidences) confidence += c;
  confidence = clamp01(confidence / build.confidences.length);

  const peak = envelopePeak(env, build.startSec, build.startSec + VELOCITY_WINDOW_SEC);
  const stop = Math.max(build.startSec, endSec);
  const durSec = stop - build.startSec;
  if (durSec < minNoteSec) return null;
  return {
    startSec: build.startSec,
    durSec,
    pitch,
    velocity: levelToVelocity(peak > 0 ? peak : envelopePeak(env, build.startSec, stop)),
    confidence,
  };
}

function monophonicNotes(
  samples: Float32Array,
  sampleRate: number,
  options: AudioToNotesOptions,
): DetectedNote[] {
  const sensitivity = clamp01(options.sensitivity ?? 0.5);
  const minHz = options.minHz ?? DEFAULT_MIN_HZ;
  const maxHz = options.maxHz ?? DEFAULT_MAX_HZ;
  const referenceHz = options.referenceHz ?? DEFAULT_REFERENCE_HZ;
  const minNoteSec = Math.max(0.005, (options.minNoteMs ?? DEFAULT_MIN_NOTE_MS) / 1000);
  const splitSemitones = (options.splitCents ?? DEFAULT_SPLIT_CENTS) / 100;
  const hysteresisSec = Math.max(0, (options.hysteresisMs ?? DEFAULT_HYSTERESIS_MS) / 1000);
  // A confident frame at sensitivity 1 is anything periodic at all; at 0 only a
  // clean, strongly repeating window counts.
  const minConfidence = 0.75 - 0.45 * sensitivity;

  const { frames, windowSec } = analysePitchFrames(
    samples,
    sampleRate,
    minHz,
    maxHz,
    referenceHz,
    minConfidence,
  );
  if (frames.length === 0) return [];
  medianFilterPitch(frames);

  const env = rmsEnvelope(samples, sampleRate);
  const onsets = detectTransients(samples, sampleRate, {
    sensitivity,
    minIntervalSec: minNoteSec,
  });

  const hopSec = frames.length > 1 ? frames[1].timeSec - frames[0].timeSec : windowSec;
  const breakFrames = Math.max(1, Math.round(hysteresisSec / hopSec));
  const notes: DetectedNote[] = [];

  let build: NoteBuild | null = null;
  let reference = 0;
  let breakFrom = -1;
  let forcedStart = -1;
  let i = 0;

  const closeAt = (endSec: number): void => {
    if (!build) return;
    const note = finishNote(build, endSec, env, minNoteSec);
    if (note) notes.push(note);
    build = null;
    reference = 0;
  };

  while (i < frames.length) {
    const frame = frames[i];

    // An onset inside the frame's step is a new note even when the pitch has not
    // moved: a repeated note, or the same note played again, shows up only here.
    if (build) {
      const previousSec = i > 0 ? frames[i - 1].timeSec : frame.timeSec - hopSec;
      const onset = onsets.find(
        (o) => o.timeSec > previousSec && o.timeSec <= frame.timeSec && o.timeSec > build!.startSec,
      );
      if (onset && onset.timeSec - build.startSec >= minNoteSec) {
        closeAt(onset.timeSec);
        forcedStart = onset.timeSec;
        breakFrom = -1;
        continue;
      }
    }

    if (!build) {
      if (!frame.voiced) {
        i++;
        continue;
      }
      let startSec = frame.timeSec;
      if (forcedStart >= 0) {
        startSec = forcedStart;
        forcedStart = -1;
      } else {
        // Nothing was sounding, so the note began where the level came up. The
        // search cannot reach further back than the analysis window that first
        // saw the note.
        const threshold = envelopePeak(env, frame.timeSec, frame.timeSec + VELOCITY_WINDOW_SEC);
        startSec = refineStart(
          env,
          frame.timeSec,
          Math.max(0, frame.timeSec - windowSec / 2),
          threshold * RELEASE_FRACTION,
        );
        const onset = nearestOnset(onsets, startSec, ONSET_SNAP_SEC);
        if (onset >= 0) startSec = onset;
      }
      build = {
        startSec: Math.max(0, startSec),
        midis: [frame.midi],
        weights: [frame.confidence * frame.rms],
        confidences: [frame.confidence],
        lastVoicedSec: frame.timeSec,
      };
      reference = frame.midi;
      breakFrom = -1;
      i++;
      continue;
    }

    const inRange = frame.voiced && Math.abs(frame.midi - reference) <= splitSemitones;
    if (inRange) {
      build.midis.push(frame.midi);
      build.weights.push(frame.confidence * frame.rms);
      build.confidences.push(frame.confidence);
      build.lastVoicedSec = frame.timeSec;
      // The reference stops moving once the note is established, so a step to a
      // new pitch trips the split immediately instead of being tracked into.
      if (build.midis.length <= REFERENCE_FRAMES) reference = median(build.midis);
      breakFrom = -1;
      i++;
      continue;
    }

    if (breakFrom < 0) breakFrom = i;
    if (i - breakFrom + 1 < breakFrames) {
      i++;
      continue;
    }

    // The departure has lasted long enough to be a new note rather than vibrato.
    // The boundary is where it started, not where the hysteresis expired.
    const breakSec = frames[breakFrom].timeSec;
    closeAt(breakSec);
    i = breakFrom;
    breakFrom = -1;
  }

  if (build) {
    const current: NoteBuild = build;
    const peak = envelopePeak(env, current.startSec, current.lastVoicedSec);
    const end = refineEnd(
      env,
      current.lastVoicedSec,
      Math.min(current.lastVoicedSec + windowSec / 2, samples.length / sampleRate),
      peak * RELEASE_FRACTION,
    );
    closeAt(end);
  }
  return notes;
}

interface PolyOptions {
  fftSize: number;
  hop: number;
  midiLow: number;
  midiHigh: number;
  harmonics: number;
  referenceHz: number;
  maxPolyphony: number;
  /** Salience a candidate needs, relative to the frame's strongest candidate. */
  relativeThreshold: number;
}

/** Harmonic weight. 1/h is the usual roll-off and matches most sustained tones. */
function harmonicWeight(h: number): number {
  return 1 / h;
}

/**
 * Strongest magnitude within a semitone-wide neighbourhood of a bin position.
 * A partial never lands exactly on a bin, and vibrato and inharmonicity move it
 * further, so a single-bin read would under-report every real instrument.
 */
function peakNear(magnitude: Float32Array, position: number, halfWidthBins: number): number {
  const from = Math.max(0, Math.floor(position - halfWidthBins));
  const to = Math.min(magnitude.length - 1, Math.ceil(position + halfWidthBins));
  let peak = 0;
  for (let k = from; k <= to; k++) if (magnitude[k] > peak) peak = magnitude[k];
  return peak;
}

function suppressNear(
  magnitude: Float32Array,
  position: number,
  halfWidthBins: number,
  amount: number,
): void {
  const from = Math.max(0, Math.floor(position - halfWidthBins));
  const to = Math.min(magnitude.length - 1, Math.ceil(position + halfWidthBins));
  for (let k = from; k <= to; k++) magnitude[k] *= 1 - amount;
}

/** Bins spanned by a quarter tone at this position, never less than one bin. */
function toleranceBins(position: number): number {
  return Math.max(1, position * (Math.pow(2, 1 / 24) - 1));
}

interface Candidate {
  midi: number;
  salience: number;
}

function frameCandidates(
  magnitude: Float32Array,
  residual: Float32Array,
  sampleRate: number,
  opts: PolyOptions,
): Candidate[] {
  residual.set(magnitude);
  const binsPerHz = opts.fftSize / sampleRate;
  const nyquistBin = magnitude.length - 1;
  const found: Candidate[] = [];
  let frameBest = 0;

  for (let round = 0; round < opts.maxPolyphony; round++) {
    let bestMidi = -1;
    let bestSalience = 0;
    for (let midi = opts.midiLow; midi <= opts.midiHigh; midi++) {
      const f0Bin = midiToHz(midi, opts.referenceHz) * binsPerHz;
      if (f0Bin < 1 || f0Bin > nyquistBin) continue;
      const fundamental = peakNear(residual, f0Bin, toleranceBins(f0Bin));
      if (fundamental <= 0) continue;
      let salience = fundamental;
      let strongest = fundamental;
      for (let h = 2; h <= opts.harmonics; h++) {
        const bin = f0Bin * h;
        if (bin > nyquistBin) break;
        const mag = peakNear(residual, bin, toleranceBins(bin));
        if (mag > strongest) strongest = mag;
        salience += harmonicWeight(h) * mag;
      }
      // Without the fundamental present, every note is shadowed by a candidate an
      // octave and a twelfth below it that scores on the real note's partials.
      if (fundamental < 0.25 * strongest) continue;
      if (salience > bestSalience) {
        bestSalience = salience;
        bestMidi = midi;
      }
    }
    if (bestMidi < 0) break;
    if (round === 0) frameBest = bestSalience;
    if (bestSalience < opts.relativeThreshold * frameBest) break;
    if (found.some((c) => c.midi === bestMidi)) break;
    found.push({ midi: bestMidi, salience: bestSalience });

    const f0Bin = midiToHz(bestMidi, opts.referenceHz) * binsPerHz;
    for (let h = 1; h <= opts.harmonics; h++) {
      const bin = f0Bin * h;
      if (bin > nyquistBin) break;
      // Cancelling most, not all, of the partial leaves something behind for a
      // note that genuinely shares the bin instead of erasing it.
      suppressNear(residual, bin, toleranceBins(bin), 0.9);
    }
  }
  return found;
}

function polyphonicNotes(
  samples: Float32Array,
  sampleRate: number,
  options: AudioToNotesOptions,
): DetectedNote[] {
  const sensitivity = clamp01(options.sensitivity ?? 0.5);
  const fftSize = nextPowerOfTwo(Math.max(1024, Math.min(16384, options.fftSize ?? 4096)));
  const hop = fftSize / 4;
  if (samples.length < fftSize) return [];

  const referenceHz = options.referenceHz ?? DEFAULT_REFERENCE_HZ;
  const minNoteSec = Math.max(0.01, (options.minNoteMs ?? DEFAULT_MIN_NOTE_MS) / 1000);
  const opts: PolyOptions = {
    fftSize,
    hop,
    midiLow: Math.max(12, Math.round(hzToMidi(options.minHz ?? DEFAULT_MIN_HZ, referenceHz))),
    midiHigh: Math.min(127, Math.round(hzToMidi(options.maxHz ?? 4000, referenceHz))),
    harmonics: 8,
    referenceHz,
    maxPolyphony: Math.max(1, options.maxPolyphony ?? DEFAULT_MAX_POLYPHONY),
    relativeThreshold: 0.5 - 0.35 * sensitivity,
  };

  const window = makeWindow('blackmanHarris', fftSize);
  const re = new Float32Array(fftSize);
  const im = new Float32Array(fftSize);
  const frame = new Float32Array(fftSize);
  const bins = fftSize / 2 + 1;
  const magnitude = new Float32Array(bins);
  const residual = new Float32Array(bins);

  const frameCount = Math.floor((samples.length - fftSize) / hop) + 1;
  const perFrame: Candidate[][] = [];
  const frameRms = new Float32Array(frameCount);
  let loudest = 0;
  for (let f = 0; f < frameCount; f++) {
    const start = f * hop;
    frame.set(samples.subarray(start, start + fftSize));
    let energy = 0;
    for (let i = 0; i < fftSize; i++) energy += frame[i] * frame[i];
    frameRms[f] = Math.sqrt(energy / fftSize);
    if (frameRms[f] > loudest) loudest = frameRms[f];
    applyWindow(frame, window, re, im);
    fftInPlace(re, im);
    magnitudeInto(re, im, magnitude);
    perFrame.push(frameCandidates(magnitude, residual, sampleRate, opts));
  }

  // 60 dB below the loudest frame is the noise floor of anything worth
  // transcribing; below it the salience peaks are the room, not the music.
  const floor = loudest * Math.pow(10, -60 / 20);
  for (let f = 0; f < frameCount; f++) {
    if (frameRms[f] < floor) perFrame[f] = [];
  }

  const onsets = detectTransients(samples, sampleRate, {
    sensitivity,
    minIntervalSec: minNoteSec,
  });
  const hopSec = hop / sampleRate;
  const frameTime = (f: number): number => (f * hop + fftSize / 2) / sampleRate;
  const env = rmsEnvelope(samples, sampleRate);

  interface Run {
    pitch: number;
    from: number;
    to: number;
    salience: number;
  }
  const open = new Map<number, Run>();
  const runs: Run[] = [];
  // One frame of tolerance: a partial dipping under the threshold for a single
  // frame is a beat between two voices, not the end of a note.
  const maxGap = 1;
  for (let f = 0; f < frameCount; f++) {
    const present = new Set<number>();
    for (const candidate of perFrame[f]) {
      present.add(candidate.midi);
      const run = open.get(candidate.midi);
      if (run) {
        run.to = f;
        run.salience = Math.max(run.salience, candidate.salience);
      } else {
        open.set(candidate.midi, {
          pitch: candidate.midi,
          from: f,
          to: f,
          salience: candidate.salience,
        });
      }
    }
    for (const [pitch, run] of open) {
      if (!present.has(pitch) && f - run.to > maxGap) {
        runs.push(run);
        open.delete(pitch);
      }
    }
  }
  for (const run of open.values()) runs.push(run);

  const notes: DetectedNote[] = [];
  for (const run of runs) {
    // The frame is centred on its window, so the note started roughly half a
    // window earlier; an onset nearby knows better and wins.
    let startSec = Math.max(0, frameTime(run.from) - fftSize / 2 / sampleRate);
    const onset = nearestOnset(onsets, startSec, fftSize / 2 / sampleRate);
    if (onset >= 0) startSec = onset;
    const endSec = frameTime(run.to) + hopSec;
    const durSec = endSec - startSec;
    if (durSec < minNoteSec) continue;
    const peak = envelopePeak(env, startSec, Math.min(endSec, startSec + VELOCITY_WINDOW_SEC));
    notes.push({
      startSec,
      durSec,
      pitch: run.pitch,
      velocity: levelToVelocity(peak),
      confidence: clamp01(run.salience / (loudest > 0 ? loudest : 1)),
    });
  }
  notes.sort((a, b) => a.startSec - b.startSec || a.pitch - b.pitch);
  return notes;
}

/**
 * Convert a mono buffer to notes. `samples` must already be a single channel —
 * sum or pick a channel before calling, because which of those is right is a
 * decision about the material, not about the algorithm.
 */
export function audioToNotes(
  samples: Float32Array,
  sampleRate: number,
  options: AudioToNotesOptions = {},
): DetectedNote[] {
  if (samples.length === 0 || !(sampleRate > 0)) return [];
  const notes =
    (options.mode ?? 'mono') === 'poly'
      ? polyphonicNotes(samples, sampleRate, options)
      : monophonicNotes(samples, sampleRate, options);
  if (!options.quantizeGrid || !options.tempoMap) return notes;
  return quantizeDetected(notes, options.tempoMap, options.clipStartSec ?? 0, {
    grid: options.quantizeGrid,
    strength: options.quantizeStrength ?? 1,
  });
}

interface QuantizeSpec {
  grid: number;
  strength: number;
}

/** Quantize in the beat domain, then map back to seconds so the caller keeps time. */
function quantizeDetected(
  notes: readonly DetectedNote[],
  map: TempoMap,
  clipStartSec: number,
  spec: QuantizeSpec,
): DetectedNote[] {
  const clipStartBeat = secToBeat(map, clipStartSec);
  return notes.map((note) => {
    const beat = secToBeat(map, clipStartSec + note.startSec) - clipStartBeat;
    const target = Math.round(beat / spec.grid) * spec.grid;
    const moved = Math.max(0, beat + (target - beat) * clamp01(spec.strength));
    // beatToSec works in absolute timeline beats, so the clip's origin goes back on.
    const startSec = beatToSec(map, clipStartBeat + moved) - clipStartSec;
    return { ...note, startSec: Math.max(0, startSec) };
  });
}

export interface ToProjectNotesOptions {
  tempoMap: TempoMap;
  /** Timeline position, in seconds, of the analysed buffer's first sample. */
  clipStartSec: number;
  /** Grid in beats; 0 or absent leaves the detected timing alone. */
  quantizeGrid?: number;
  /** 0..1, how far toward the grid. */
  quantizeStrength?: number;
  /** Also snap note ends to the grid. */
  quantizeLengths?: boolean;
  /** Prefix for the generated ids, so two conversions never collide. */
  idPrefix?: string;
}

/**
 * Project notes from detected ones: seconds become beats through the tempo map,
 * relative to the clip's own start, which is what `Note.start` means.
 *
 * Ids are derived from position and pitch rather than random, so converting the
 * same audio twice produces the same project and a diff stays readable.
 */
export function detectedNotesToNotes(
  detected: readonly DetectedNote[],
  options: ToProjectNotesOptions,
): Note[] {
  const { tempoMap, clipStartSec } = options;
  const clipStartBeat = secToBeat(tempoMap, clipStartSec);
  const prefix = options.idPrefix ?? 'a2n';
  const notes: Note[] = detected.map((note, index) => {
    const start = secToBeat(tempoMap, clipStartSec + note.startSec) - clipStartBeat;
    const end = secToBeat(tempoMap, clipStartSec + note.startSec + note.durSec) - clipStartBeat;
    return {
      id: `${prefix}-${index}-${note.pitch}`,
      start: Math.max(0, start),
      length: Math.max(1 / 64, end - start),
      pitch: note.pitch,
      velocity: note.velocity,
    };
  });
  if (!options.quantizeGrid) return notes;
  return quantizeNotes(notes, {
    grid: options.quantizeGrid,
    strength: options.quantizeStrength ?? 1,
    swing: 0,
    lengths: options.quantizeLengths,
  });
}
