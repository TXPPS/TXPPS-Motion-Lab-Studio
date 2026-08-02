/**
 * Clip scheduling maths, shared by live playback and offline export.
 *
 * This is the single source of truth for how long a clip plays and what its
 * gain envelope looks like. Live playback and the bounce renderer both call it,
 * so an exported file cannot drift from what the user heard — which is the one
 * way an export silently lies.
 *
 * Pure and synchronous: no AudioContext, no store access.
 */
import type { FadeShape } from '../model/types';

export interface EnvelopePoint {
  /** seconds relative to the clip's start time in the timeline */
  t: number;
  value: number;
  /** true: linear ramp to this value; false: hold from this instant */
  ramp: boolean;
}

export interface ClipSchedule {
  /** seconds of source material to play */
  durSec: number;
  /** where in the source to begin */
  offsetSec: number;
  /** gain automation, ordered, times relative to the clip's start */
  envelope: EnvelopePoint[];
}

export interface ClipTiming {
  /** source offset stored on the clip */
  offset: number;
  /** musical length in beats */
  length: number;
  /** trimmed source length in seconds, when known */
  sourceDuration?: number;
  gain: number;
  fadeIn: number;
  fadeOut: number;
  fadeInShape?: FadeShape;
  fadeOutShape?: FadeShape;
  /** polarity flip: the whole envelope is negated */
  phaseInvert?: boolean;
}

/**
 * Rising gain of a fade at progress t (0 = silent end, 1 = full level).
 * As a crossfade pair, linear/equalGain/s sum to constant amplitude and
 * equalPower to constant power.
 */
export function fadeGain(t: number, shape: FadeShape | undefined): number {
  const x = t <= 0 ? 0 : t >= 1 ? 1 : t;
  switch (shape) {
    case 'equalPower':
      return Math.sin((x * Math.PI) / 2);
    case 's':
      return x * x * (3 - 2 * x);
    case 'linear':
    case 'equalGain':
    default:
      return x;
  }
}

/** Curved fades approximate as short linear ramps; linear stays two points. */
const SHAPE_STEPS = 8;

/**
 * Work out playback duration and the gain envelope for one clip.
 *
 * `offsetSec` is the absolute position in the source at which playback begins,
 * which is the clip's own offset for a normal start and something later when
 * the transport enters part-way through (a loop wrap or a mid-clip seek).
 *
 * Returns null when there is nothing audible to schedule.
 */
export function computeClipSchedule(
  clip: ClipTiming,
  offsetSec: number,
  bufferDuration: number,
  secondsPerBeat: number,
): ClipSchedule | null {
  if (!(bufferDuration > 0) || !Number.isFinite(offsetSec)) return null;

  // How far into the clip's own material playback starts.
  const intoClipSec = Math.max(0, offsetSec - clip.offset);
  const clipSourceSec = clip.sourceDuration ?? clip.length * secondsPerBeat;
  const clipRemainSec = clipSourceSec - intoClipSec;
  const mediaRemainSec = bufferDuration - offsetSec;
  const durSec = Math.min(
    clipRemainSec,
    mediaRemainSec,
    clip.length * secondsPerBeat - intoClipSec,
  );

  if (durSec <= 0.001 || offsetSec >= bufferDuration) return null;

  const sign = clip.phaseInvert ? -1 : 1;
  const peak = Math.max(0, clip.gain) * sign;
  const fadeIn = Math.max(0, clip.fadeIn ?? 0);
  const fadeOut = Math.max(0, clip.fadeOut ?? 0);
  const envelope: EnvelopePoint[] = [];

  // Fades are expressed against the clip, so a clip entered part-way starts at
  // the level its envelope had already reached rather than jumping to silence.
  if (fadeIn > 0 && intoClipSec < fadeIn) {
    const p0 = intoClipSec / fadeIn;
    const shape = clip.fadeInShape;
    envelope.push({ t: 0, value: peak * fadeGain(p0, shape), ramp: false });
    const steps = !shape || shape === 'linear' || shape === 'equalGain' ? 1 : SHAPE_STEPS;
    for (let k = 1; k <= steps; k++) {
      const p = p0 + ((1 - p0) * k) / steps;
      envelope.push({ t: (p - p0) * fadeIn, value: peak * fadeGain(p, shape), ramp: true });
    }
  } else {
    envelope.push({ t: 0, value: peak, ramp: false });
  }

  if (fadeOut > 0) {
    const fadeStartInClip = Math.max(0, clipSourceSec - fadeOut);
    const fadeStartAt = Math.max(0, fadeStartInClip - intoClipSec);
    if (fadeStartAt < durSec) {
      const shape = clip.fadeOutShape;
      // Progress of the fade at its first audible instant (1 when the fade
      // begins inside the schedule, less when entering mid-fade).
      const pStart = Math.min(
        1,
        Math.max(0, (clipSourceSec - Math.max(fadeStartInClip, intoClipSec)) / fadeOut),
      );
      const held = envelope[envelope.length - 1].value;
      envelope.push({ t: fadeStartAt, value: fadeStartAt > 0 ? held : envelope[0].value, ramp: false });
      const steps = !shape || shape === 'linear' || shape === 'equalGain' ? 1 : SHAPE_STEPS;
      const span = durSec - fadeStartAt;
      for (let k = 1; k <= steps; k++) {
        const p = pStart * (1 - k / steps);
        const value = peak * fadeGain(p, shape);
        envelope.push({
          t: fadeStartAt + (span * k) / steps,
          value: Math.abs(value) < 0.0001 ? 0.0001 * sign : value,
          ramp: true,
        });
      }
    }
  }

  return { durSec, offsetSec, envelope };
}

/** Apply a computed envelope to a GainNode starting at absolute time `when`. */
export function applyEnvelope(gain: AudioParam, envelope: EnvelopePoint[], when: number): void {
  for (const p of envelope) {
    const at = when + p.t;
    if (p.ramp) gain.linearRampToValueAtTime(p.value, at);
    else gain.setValueAtTime(p.value, at);
  }
}
