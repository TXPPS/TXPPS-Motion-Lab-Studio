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
}

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

  const peak = Math.max(0, clip.gain);
  const fadeIn = Math.max(0, clip.fadeIn ?? 0);
  const fadeOut = Math.max(0, clip.fadeOut ?? 0);
  const envelope: EnvelopePoint[] = [];

  // Fades are expressed against the clip, so a clip entered part-way starts at
  // the level its envelope had already reached rather than jumping to silence.
  if (fadeIn > 0 && intoClipSec < fadeIn) {
    envelope.push({ t: 0, value: peak * (intoClipSec / fadeIn), ramp: false });
    envelope.push({ t: fadeIn - intoClipSec, value: peak, ramp: true });
  } else {
    envelope.push({ t: 0, value: peak, ramp: false });
  }

  if (fadeOut > 0) {
    const fadeStartInClip = Math.max(0, clipSourceSec - fadeOut);
    const fadeStartAt = Math.max(0, fadeStartInClip - intoClipSec);
    if (fadeStartAt < durSec) {
      // Hold the level reached so far, then ramp down to the clip's end.
      const held = envelope[envelope.length - 1].value;
      envelope.push({ t: fadeStartAt, value: held, ramp: false });
      envelope.push({ t: durSec, value: 0.0001, ramp: true });
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
