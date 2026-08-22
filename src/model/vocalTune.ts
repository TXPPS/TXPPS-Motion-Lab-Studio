/**
 * Vocal Tune: pitch analysis and the correction curve that drives it.
 *
 * Pure maths. Samples in, a pitch track and a per-frame semitone shift out. No
 * DOM, no Web Audio, no React, so this can run in a worker while the transport
 * plays.
 *
 * What this module does **not** do is resynthesise the audio. The shift curve is
 * a control signal; the thing that actually moves the pitch is the phase-vocoder
 * stretcher on the render side, which owns formant handling, transient
 * preservation and the audio buffers. Keeping the analysis here means the curve
 * can be drawn, edited and stored without a single sample being rendered, and it
 * means Vocal Tune and the stretcher can be worked on separately.
 *
 * Honest limits:
 *
 * - Monophonic only. The detector underneath is YIN, so a double-tracked vocal,
 *   a harmony stacked on the same track, or a guitar chord will produce one
 *   pitch reading that belongs to neither part. Melodyne separates simultaneous
 *   voices; this does not.
 * - The correction is computed against equal temperament from a reference A.
 *   There is no key detection here: the scale is told to it, not inferred.
 * - "Humanise" preserves vibrato by high-pass filtering the deviation before
 *   correcting it. That keeps a wobble that is faster than the filter's corner;
 *   it cannot tell an intentional vibrato from an unsteady note that wobbles at
 *   the same rate, because nothing in the signal distinguishes them.
 */
import { analysePitchTrack, audioToNotes, type PitchFrame } from './audioToMidi';
import { snapToScale } from './scales';

export interface VocalFrame {
  timeSec: number;
  /** Detected fundamental, or 0 when the frame is unvoiced. */
  hz: number;
  confidence: number;
}

export interface VocalNote {
  startSec: number;
  durSec: number;
  /** MIDI note the singer was aiming at, as detected. */
  pitch: number;
  /** Mean distance from that note across the note, in cents. Positive is sharp. */
  centsMean: number;
}

export interface VocalAnalysis {
  frames: VocalFrame[];
  notes: VocalNote[];
  /** Seconds between frames. */
  hopSec: number;
  sampleRate: number;
  referenceHz: number;
}

export interface VocalAnalysisOptions {
  minHz?: number;
  maxHz?: number;
  /** Tuning of A4. A track recorded at 442 Hz is not 8 cents sharp. */
  referenceHz?: number;
  /** Confidence a frame needs before its pitch is used at all. */
  minConfidence?: number;
}

export interface TuneOptions {
  /** Scale id from `scales.ts`. Ignored when `pitchClasses` is given. */
  scaleId?: string;
  /** Tonic pitch class, 0 = C. */
  tonic?: number;
  /** Explicit pitch-class set, 0..11. Overrides `scaleId`. */
  pitchClasses?: number[];
  /** 0..1. 0 leaves the performance alone, 1 puts every note on its target. */
  strength?: number;
  /**
   * Time constant of the move onto the target, in milliseconds. 0 is the hard,
   * obviously-processed snap; a few tens of milliseconds keeps the scoop into a
   * note that a singer actually sang.
   */
  retuneMs?: number;
  /** 0..1. 1 keeps vibrato and expression, 0 flattens everything onto the target. */
  humanise?: number;
  referenceHz?: number;
  /** Confidence under which a frame is left uncorrected. */
  minConfidence?: number;
}

const DEFAULT_REFERENCE_HZ = 440;
const DEFAULT_MIN_CONFIDENCE = 0.5;
/**
 * Corner of the filter that separates drift from expression, in Hz, at
 * humanise 1 and at humanise 0. At 1 Hz a 5 Hz vibrato passes almost untouched
 * and only the note's standing error is corrected; at 25 Hz — far above any
 * vibrato, and above the frame rate's useful band — the filter passes
 * everything, so the whole deviation is corrected.
 */
const HUMANISE_MIN_CORNER_HZ = 1;
const HUMANISE_MAX_CORNER_HZ = 25;

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function hzToMidi(hz: number, referenceHz: number): number {
  return 69 + 12 * Math.log2(hz / referenceHz);
}

function midiToHz(midi: number, referenceHz: number): number {
  return referenceHz * Math.pow(2, (midi - 69) / 12);
}

/** Nearest member of an explicit pitch-class set; ties resolve downward. */
function snapToPitchClasses(pitch: number, classes: readonly number[]): number {
  if (classes.length === 0) return pitch;
  const allowed = new Set(classes.map((c) => ((c % 12) + 12) % 12));
  for (let d = 0; d <= 6; d++) {
    if (pitch - d >= 0 && allowed.has(((Math.round(pitch - d) % 12) + 12) % 12)) return pitch - d;
    if (pitch + d <= 127 && allowed.has(((Math.round(pitch + d) % 12) + 12) % 12)) return pitch + d;
  }
  return pitch;
}

/**
 * The note a pitch should be pulled to. `scales.ts` owns the tie-break, so a
 * pitch exactly between two scale degrees — C sharp in C major, say — goes to
 * the lower one, here and everywhere else in the program.
 */
export function targetPitch(pitch: number, opts: TuneOptions): number {
  const rounded = Math.round(pitch);
  if (opts.pitchClasses && opts.pitchClasses.length > 0) {
    return snapToPitchClasses(rounded, opts.pitchClasses);
  }
  return snapToScale(rounded, opts.tonic ?? 0, opts.scaleId ?? 'chromatic');
}

/**
 * Pitch track plus note segmentation for one monophonic take.
 *
 * The segmentation is the same one Audio → Note uses, so the notes Vocal Tune
 * draws and the notes a conversion would produce are the same notes.
 */
export function analyzeVocal(
  samples: Float32Array,
  sampleRate: number,
  options: VocalAnalysisOptions = {},
): VocalAnalysis {
  const referenceHz = options.referenceHz ?? DEFAULT_REFERENCE_HZ;
  const minConfidence = options.minConfidence ?? DEFAULT_MIN_CONFIDENCE;
  const track = analysePitchTrack(samples, sampleRate, {
    minHz: options.minHz,
    maxHz: options.maxHz,
    referenceHz,
    minConfidence,
  });
  const detected = audioToNotes(samples, sampleRate, {
    mode: 'mono',
    minHz: options.minHz,
    maxHz: options.maxHz,
    referenceHz,
  });

  const notes: VocalNote[] = detected.map((note) => {
    let sum = 0;
    let count = 0;
    for (const frame of track.frames) {
      if (!frame.voiced) continue;
      if (frame.timeSec < note.startSec) continue;
      if (frame.timeSec > note.startSec + note.durSec) break;
      sum += (frame.midi - note.pitch) * 100;
      count++;
    }
    return {
      startSec: note.startSec,
      durSec: note.durSec,
      pitch: note.pitch,
      centsMean: count > 0 ? sum / count : 0,
    };
  });

  return {
    frames: track.frames.map((f) => ({ timeSec: f.timeSec, hz: f.hz, confidence: f.confidence })),
    notes,
    hopSec: track.hopSec,
    sampleRate,
    referenceHz,
  };
}

/** Which note of the analysis a frame belongs to, or -1 between notes. */
function noteIndexAt(analysis: VocalAnalysis, timeSec: number, from: number): number {
  for (let i = from; i < analysis.notes.length; i++) {
    const note = analysis.notes[i];
    if (timeSec < note.startSec) return -1;
    if (timeSec <= note.startSec + note.durSec) return i;
  }
  return -1;
}

/** Time constant of a one-pole, expressed as its per-frame coefficient. */
function poleCoefficient(hopSec: number, tauSec: number): number {
  if (!(tauSec > 0)) return 1;
  return 1 - Math.exp(-hopSec / tauSec);
}

/**
 * Per-frame semitone shift, aligned one-for-one with `analysis.frames`.
 *
 * Positive means "sing this frame higher". Unvoiced frames get 0: there is no
 * pitch there to move, and a shifter fed a number would only smear noise.
 *
 * Three controls, each doing one thing:
 *
 * - `humanise` splits the deviation from the target into a slow part (the note
 *   being flat) and a fast part (vibrato, scoops, the singer's own inflection)
 *   with a one-pole filter, and only ever corrects the slow part in full.
 * - `strength` scales how much of that gets applied.
 * - `retuneMs` is a one-pole on the applied shift itself, restarted at every
 *   note, so a slow setting lets the entrance of a note keep its natural
 *   approach before the correction takes hold.
 */
export function tuningCurve(analysis: VocalAnalysis, opts: TuneOptions = {}): Float32Array {
  const frames = analysis.frames;
  const out = new Float32Array(frames.length);
  const strength = clamp01(opts.strength ?? 1);
  if (frames.length === 0 || strength === 0) return out;

  const humanise = clamp01(opts.humanise ?? 0);
  const minConfidence = opts.minConfidence ?? DEFAULT_MIN_CONFIDENCE;
  const referenceHz = opts.referenceHz ?? analysis.referenceHz;
  const cornerHz = HUMANISE_MAX_CORNER_HZ * (1 - humanise) + HUMANISE_MIN_CORNER_HZ * humanise;
  const humaniseCoefficient = poleCoefficient(analysis.hopSec, 1 / (2 * Math.PI * cornerHz));
  const retuneCoefficient = poleCoefficient(analysis.hopSec, (opts.retuneMs ?? 0) / 1000);

  const noteTargets = analysis.notes.map((note) => targetPitch(note.pitch, opts));

  let noteCursor = 0;
  let currentNote = -2;
  let slow = 0;
  let applied = 0;

  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];
    const voiced = frame.hz > 0 && frame.confidence >= minConfidence;
    if (!voiced) {
      // Nothing sounding: forget both filter states so the next note starts from
      // its own scoop rather than from the last note's correction.
      currentNote = -2;
      applied = 0;
      out[i] = 0;
      continue;
    }

    const noteIndex = noteIndexAt(analysis, frame.timeSec, noteCursor);
    if (noteIndex >= 0) noteCursor = noteIndex;
    const exact = hzToMidi(frame.hz, referenceHz);
    const target = noteIndex >= 0 ? noteTargets[noteIndex] : targetPitch(exact, opts);
    const deviation = exact - target;

    if (noteIndex !== currentNote) {
      currentNote = noteIndex;
      slow = deviation;
      applied = 0;
    } else {
      slow += humaniseCoefficient * (deviation - slow);
    }

    // At humanise 0 this is exactly the whole deviation whatever the corner is.
    const removed = slow + (1 - humanise) * (deviation - slow);
    const desired = -removed * strength;
    applied += retuneCoefficient * (desired - applied);
    out[i] = applied;
  }
  return out;
}

export interface CorrectedFrame {
  timeSec: number;
  /** What was sung, in Hz; 0 when unvoiced. */
  inputHz: number;
  /** What the correction produces, in Hz; equals `inputHz` where nothing is done. */
  outputHz: number;
  /** The scale degree being aimed at, in Hz; 0 when the frame is uncorrected. */
  targetHz: number;
  /** Applied shift in cents, for a readout. */
  shiftCents: number;
  confidence: number;
}

/**
 * Before and after, per frame, ready to draw as two lines over the waveform.
 * The output line is what the shifter will produce if it does its job exactly.
 */
export function correctedTrack(analysis: VocalAnalysis, opts: TuneOptions = {}): CorrectedFrame[] {
  const curve = tuningCurve(analysis, opts);
  const referenceHz = opts.referenceHz ?? analysis.referenceHz;
  const minConfidence = opts.minConfidence ?? DEFAULT_MIN_CONFIDENCE;
  let noteCursor = 0;

  return analysis.frames.map((frame, i) => {
    const voiced = frame.hz > 0 && frame.confidence >= minConfidence;
    if (!voiced) {
      return {
        timeSec: frame.timeSec,
        inputHz: 0,
        outputHz: 0,
        targetHz: 0,
        shiftCents: 0,
        confidence: frame.confidence,
      };
    }
    const noteIndex = noteIndexAt(analysis, frame.timeSec, noteCursor);
    if (noteIndex >= 0) noteCursor = noteIndex;
    const exact = hzToMidi(frame.hz, referenceHz);
    const target =
      noteIndex >= 0
        ? targetPitch(analysis.notes[noteIndex].pitch, opts)
        : targetPitch(exact, opts);
    return {
      timeSec: frame.timeSec,
      inputHz: frame.hz,
      outputHz: frame.hz * Math.pow(2, curve[i] / 12),
      targetHz: midiToHz(target, referenceHz),
      shiftCents: curve[i] * 100,
      confidence: frame.confidence,
    };
  });
}

/**
 * Cents each detected note sits away from its correction target, before any
 * correction is applied. This is the column the note list shows so a singer can
 * see which note was the problem.
 */
export function noteErrorsCents(analysis: VocalAnalysis, opts: TuneOptions = {}): number[] {
  return analysis.notes.map((note) => {
    const target = targetPitch(note.pitch, opts);
    return (note.pitch - target) * 100 + note.centsMean;
  });
}

/** Re-export for callers that want the frame type the analysis came from. */
export type { PitchFrame };
