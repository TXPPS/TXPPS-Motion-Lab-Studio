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
/**
 * How much of a note has to be seen before its median means "the centre of this
 * note". Less than one cycle of a slow vibrato and the median can sit at the top
 * or the bottom of the wobble instead of the middle of it.
 */
const REFERENCE_WARMUP_SEC = 0.2;
/**
 * Level rise, in dB, that an onset inside a sounding note has to bring with it
 * before it is treated as a new note. Vibrato and a moving filter both put
 * energy into new bins and so both produce spectral flux; neither is an
 * articulation, and neither raises the level.
 */
const ARTICULATION_RISE_DB = 3;

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

/**
 * Rise in level across an instant, in dB: the loudest moment just after it over
 * the quietest just before. A struck or tongued note shows several dB here; a
 * sustained one that merely changed timbre shows none.
 */
function levelRiseDb(env: Envelope, timeSec: number): number {
  if (env.values.length === 0) return 0;
  const before = envelopeFloor(env, timeSec - 0.03, timeSec + 0.005);
  const after = envelopePeak(env, timeSec, timeSec + 0.025);
  if (!(after > 0)) return 0;
  if (!(before > 0)) return Infinity;
  return 20 * Math.log10(after / before);
}

function envelopeFloor(env: Envelope, fromSec: number, toSec: number): number {
  const from = envelopeIndexAt(env, fromSec);
  const to = envelopeIndexAt(env, toSec);
  let floor = Infinity;
  for (let i = Math.min(from, to); i <= Math.max(from, to); i++) {
    if (env.values[i] < floor) floor = env.values[i];
  }
  return Number.isFinite(floor) ? floor : 0;
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

/** One frame of the pitch track. Shared by the note detector and by Vocal Tune. */
export interface PitchFrame {
  /** Centre of the analysis window, in seconds into the buffer. */
  timeSec: number;
  /** Detected fundamental, or 0 when the frame is unvoiced. */
  hz: number;
  /** The same reading as a fractional MIDI number, or 0 when unvoiced. */
  midi: number;
  /** YIN confidence, 0..1, reported whether or not the frame counts as voiced. */
  confidence: number;
  rms: number;
  voiced: boolean;
}

export interface PitchTrack {
  frames: PitchFrame[];
  /** Length of the analysis window, in seconds. */
  windowSec: number;
  /** Time between frames, in seconds. */
  hopSec: number;
}

export interface PitchTrackOptions {
  minHz?: number;
  maxHz?: number;
  referenceHz?: number;
  /** Confidence a frame needs before it counts as voiced. */
  minConfidence?: number;
}

/**
 * Frame-wise pitch over a whole buffer, median filtered.
 *
 * Exposed because Vocal Tune needs exactly the track the note detector works
 * from — two pitch trackers disagreeing about the same recording would put the
 * tuning curve and the detected notes in different places.
 */
export function analysePitchTrack(
  samples: Float32Array,
  sampleRate: number,
  options: PitchTrackOptions = {},
): PitchTrack {
  const track = analysePitchFrames(
    samples,
    sampleRate,
    options.minHz ?? DEFAULT_MIN_HZ,
    options.maxHz ?? DEFAULT_MAX_HZ,
    options.referenceHz ?? DEFAULT_REFERENCE_HZ,
    options.minConfidence ?? 0.5,
  );
  medianFilterPitch(track.frames, options.referenceHz ?? DEFAULT_REFERENCE_HZ);
  return track;
}

function analysePitchFrames(
  samples: Float32Array,
  sampleRate: number,
  minHz: number,
  maxHz: number,
  referenceHz: number,
  minConfidence: number,
): { frames: PitchFrame[]; windowSec: number; hopSec: number } {
  // YIN compares a window against itself shifted by up to one period, so the
  // window has to hold two periods of the lowest note asked for.
  const size = nextPowerOfTwo(Math.ceil((2 * sampleRate) / minHz));
  const hop = Math.max(1, Math.round(size / PITCH_OVERLAP));
  const frames: PitchFrame[] = [];
  const hopSec = hop / sampleRate;
  if (samples.length < size) return { frames, windowSec: size / sampleRate, hopSec };

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
      hz: voiced ? reading.hz : 0,
      midi: voiced ? hzToMidi(reading.hz, referenceHz) : 0,
      confidence: reading.confidence,
      rms,
      voiced,
    });
  }
  return { frames, windowSec: size / sampleRate, hopSec };
}

/**
 * Median filter over voiced frames only. A five-frame median removes the single
 * octave slips and half-period errors YIN makes at note boundaries without
 * rounding off a real glide, and skipping unvoiced neighbours stops silence from
 * being averaged into the note either side of it.
 */
function medianFilterPitch(frames: PitchFrame[], referenceHz: number): void {
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
    frames[i].hz = midiToHz(frames[i].midi, referenceHz);
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
  medianFilterPitch(frames, referenceHz);

  const env = rmsEnvelope(samples, sampleRate);
  const onsets = detectTransients(samples, sampleRate, {
    sensitivity,
    minIntervalSec: minNoteSec,
  });

  const hopSec = frames.length > 1 ? frames[1].timeSec - frames[0].timeSec : windowSec;
  const breakFrames = Math.max(1, Math.round(hysteresisSec / hopSec));
  const warmupFrames = Math.max(2, Math.round(REFERENCE_WARMUP_SEC / hopSec));
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
      const openedAt = build.startSec;
      const previousSec = i > 0 ? frames[i - 1].timeSec : frame.timeSec - hopSec;
      const onset = onsets.find(
        (o) => o.timeSec > previousSec && o.timeSec <= frame.timeSec && o.timeSec > openedAt,
      );
      if (
        onset &&
        onset.timeSec - openedAt >= minNoteSec &&
        levelRiseDb(env, onset.timeSec) >= ARTICULATION_RISE_DB
      ) {
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

    // Until the reference is built from enough of the note to mean its centre,
    // only a departure too large to be any kind of expression counts as a split.
    const limit = build.midis.length < warmupFrames ? splitSemitones * 2 : splitSemitones;
    const inRange = frame.voiced && Math.abs(frame.midi - reference) <= limit;
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

/** How far off an ideal harmonic a partial may sit and still be counted. */
const HARMONIC_TOLERANCE_CENTS = 45;
/** Fraction of a cancelled partial left behind for whatever else shares the bin. */
const CANCEL_RESIDUE = 0.1;
/** Peaks this far under the loudest one in the frame are the window's own skirts. */
const PEAK_FLOOR_DB = -70;

interface SpectralPeaks {
  /** Interpolated frequencies, ascending. */
  hz: Float64Array;
  /** Amplitudes at those frequencies. Mutated in place by cancellation. */
  amp: Float64Array;
  count: number;
}

/**
 * Local maxima of the magnitude spectrum, each refined by fitting a parabola
 * through the three bins around it.
 *
 * Working in peaks rather than in bins is what makes the note grid usable at
 * all down here: at a 4096-point transform a semitone around middle C is under
 * two bins wide, so a candidate that reads whole bins cannot tell C from C sharp
 * and every chord comes back as a cluster. An interpolated peak resolves the
 * frequency to a small fraction of a bin, and a candidate then has to match it
 * to within a fraction of a semitone.
 */
function findPeaks(
  magnitude: Float32Array,
  sampleRate: number,
  fftSize: number,
  out: SpectralPeaks,
): void {
  out.count = 0;
  let loudest = 0;
  for (let k = 1; k < magnitude.length - 1; k++) if (magnitude[k] > loudest) loudest = magnitude[k];
  if (!(loudest > 0)) return;
  const floor = loudest * Math.pow(10, PEAK_FLOOR_DB / 20);
  const binHz = sampleRate / fftSize;

  for (let k = 1; k < magnitude.length - 1; k++) {
    const b = magnitude[k];
    if (b < floor || b < magnitude[k - 1] || b < magnitude[k + 1]) continue;
    // Parabolic interpolation in dB: the log of a windowed peak is close to a
    // parabola, which is why the vertex lands on the true frequency.
    const a = 20 * Math.log10(Math.max(magnitude[k - 1], 1e-20));
    const c = 20 * Math.log10(Math.max(magnitude[k + 1], 1e-20));
    const bDb = 20 * Math.log10(b);
    const denom = a - 2 * bDb + c;
    const delta = denom === 0 ? 0 : clamp((0.5 * (a - c)) / denom, -0.5, 0.5);
    if (out.count >= out.hz.length) break;
    out.hz[out.count] = (k + delta) * binHz;
    out.amp[out.count] = b * Math.pow(10, (-0.25 * (a - c) * delta) / 20);
    out.count++;
  }
}

/** Index of the loudest peak within `toleranceCents` of `hz`, or -1. */
function matchPeak(peaks: SpectralPeaks, hz: number, binHz: number): number {
  const spread = hz * (Math.pow(2, HARMONIC_TOLERANCE_CENTS / 1200) - 1);
  // Never narrower than a bin: a peak that lands between two bins is only ever
  // located to about that accuracy however good the interpolation is.
  const tolerance = Math.max(spread, binHz * 0.6);
  const lo = hz - tolerance;
  const hi = hz + tolerance;
  let best = -1;
  let bestAmp = 0;
  for (let i = 0; i < peaks.count; i++) {
    if (peaks.hz[i] < lo) continue;
    if (peaks.hz[i] > hi) break;
    if (peaks.amp[i] > bestAmp) {
      bestAmp = peaks.amp[i];
      best = i;
    }
  }
  return best;
}

interface Candidate {
  midi: number;
  salience: number;
}

function frameCandidates(peaks: SpectralPeaks, sampleRate: number, opts: PolyOptions): Candidate[] {
  const binHz = sampleRate / opts.fftSize;
  const nyquist = sampleRate / 2;
  const found: Candidate[] = [];
  const matched: number[] = [];
  let frameBest = 0;

  for (let round = 0; round < opts.maxPolyphony; round++) {
    let bestMidi = -1;
    let bestSalience = 0;
    for (let midi = opts.midiLow; midi <= opts.midiHigh; midi++) {
      const f0 = midiToHz(midi, opts.referenceHz);
      if (f0 >= nyquist) break;
      const fundamental = matchPeak(peaks, f0, binHz);
      // Without the fundamental present every note is shadowed by a candidate an
      // octave or a twelfth below it, scoring on the real note's own partials.
      // Requiring it is also why an instrument with a weak fundamental can be
      // reported an octave high.
      if (fundamental < 0) continue;
      let salience = peaks.amp[fundamental];
      let strongest = salience;
      for (let h = 2; h <= opts.harmonics; h++) {
        const hz = f0 * h;
        if (hz >= nyquist) break;
        const idx = matchPeak(peaks, hz, binHz);
        if (idx < 0) continue;
        if (peaks.amp[idx] > strongest) strongest = peaks.amp[idx];
        salience += harmonicWeight(h) * peaks.amp[idx];
      }
      if (peaks.amp[fundamental] < 0.25 * strongest) continue;
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

    // Estimate and cancel: take this note's partials out of the spectrum so the
    // next round scores what is left rather than the same energy again.
    matched.length = 0;
    const f0 = midiToHz(bestMidi, opts.referenceHz);
    for (let h = 1; h <= opts.harmonics; h++) {
      const hz = f0 * h;
      if (hz >= nyquist) break;
      const idx = matchPeak(peaks, hz, binHz);
      if (idx >= 0) matched.push(idx);
    }
    for (const idx of matched) peaks.amp[idx] *= CANCEL_RESIDUE;
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
  const peaks: SpectralPeaks = {
    hz: new Float64Array(bins),
    amp: new Float64Array(bins),
    count: 0,
  };

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
    findPeaks(magnitude, sampleRate, fftSize, peaks);
    perFrame.push(frameCandidates(peaks, sampleRate, opts));
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
