/**
 * How fast a clip plays, and at what pitch.
 *
 * Three settings can change an audio clip's rate — a fixed `stretch`, a
 * `transpose` in semitones, and `followTempo`, which derives the ratio from the
 * song's tempo against the clip's own recorded tempo. They interact, and both
 * the live engine and the offline bounce have to reach the same number, so the
 * decision lives here rather than in either of them.
 */
import { projectBpmAt } from './music';
import type { AudioClip, ProjectData } from './types';

export interface ClipRatePlan {
  /** How much longer the material becomes; 2 = half speed. */
  timeRatio: number;
  /** Semitones of transposition. */
  semitones: number;
  /** Resample rate for the plain path (pitch follows the rate). */
  fallbackRate: number;
  /** The rate to use when the pre-rendered stretch is available. */
  rate: number;
  preservePitch: boolean;
}

const NEUTRAL: ClipRatePlan = {
  timeRatio: 1,
  semitones: 0,
  fallbackRate: 1,
  rate: 1,
  preservePitch: false,
};

/**
 * `secondsPerBeat` is the clip's own span from the tempo map; it is passed in
 * rather than recomputed so a caller that already has it does not pay twice.
 */
export function clipRatePlan(
  project: ProjectData,
  clip: AudioClip,
  secondsPerBeat: number,
): ClipRatePlan {
  const semitones = clip.transpose ?? 0;
  // `stretch` is a SPEED: 2 plays twice as fast, so the material lasts half as
  // long, which is what timeRatio measures.
  let timeRatio = clip.stretch && clip.stretch > 0 ? 1 / clip.stretch : 1;

  if (clip.followTempo && clip.sourceBpm && clip.sourceBpm > 0) {
    // The clip was played at sourceBpm; the song is at songBpm here. Playing it
    // faster by that factor is what makes it line up, so the material has to be
    // compressed by the same factor.
    const songBpm = secondsPerBeat > 0 ? 60 / secondsPerBeat : projectBpmAt(project, clip.start);
    timeRatio *= clip.sourceBpm / songBpm;
  }

  if (Math.abs(timeRatio - 1) < 1e-4 && Math.abs(semitones) < 1e-4) return NEUTRAL;

  const pitchFactor = Math.pow(2, semitones / 12);
  return {
    timeRatio,
    semitones,
    // Resampling: one control does both jobs, so they multiply.
    fallbackRate: (1 / timeRatio) * pitchFactor,
    rate: 1,
    preservePitch: clip.preservePitch !== false && Math.abs(timeRatio - 1) > 1e-4,
  };
}
