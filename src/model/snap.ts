/**
 * Snap.
 *
 * Five modes, all pure. The point of keeping them here rather than in the
 * component that drags things is that the arrangement, the piano roll, the
 * audio editor and the automation lanes have to agree on where a drag lands,
 * and adaptive snap in particular depends on a number — how many pixels apart
 * grid lines have to be before snapping to them means anything — that is a
 * property of the editing model, not of any one view.
 */
import { beatsPerBarAt, type TempoMap } from './tempo';

export type SnapMode = 'off' | 'grid' | 'events' | 'zeroCrossing' | 'adaptive';

/**
 * The finest adaptive grid, in pixels.
 *
 * Below roughly this spacing the grid lines are closer together than a pointer
 * can be aimed, so every position snaps to a different line and the snap does
 * nothing but add jitter. Twelve pixels is about the smallest step that still
 * reads as a deliberate choice on a normal display, and it is what makes
 * adaptive snap usable: zoom out and it gives you bars, zoom in and it gives
 * you sixteenths, without ever handing you a grid you cannot hit.
 */
export const MIN_SNAP_PX = 12;

/**
 * How close, in pixels, an event boundary has to be to win. Snapping to events
 * competes with free positioning, so the pull is deliberately short: a clip
 * edge grabs the pointer near it and lets go everywhere else.
 */
export const EVENT_SNAP_PX = 10;

/** Grid steps adaptive snap chooses from, finest first, in quarter-note beats. */
const NOTE_STEPS = [0.25, 0.5, 1, 2] as const;

/** Coarse steps, in bars, for when even a whole note is too fine to see. */
const BAR_STEPS = [1, 2, 4, 8] as const;

export interface SnapContext {
  /** Grid size in beats, as the workspace stores it. Zero or less is no grid. */
  grid: number;
  tempoMap: TempoMap;
  /** Arrangement zoom; adaptive and the default event tolerance read it. */
  pxPerBeat: number;
  /** Clip and note boundaries in absolute beats. Need not be sorted. */
  events?: readonly number[];
  /** Event pull in beats. Defaults to EVENT_SNAP_PX at the current zoom. */
  eventTolerance?: number;
  /** Audio under the cursor, for zero-crossing snap. */
  zeroCrossing?: ZeroCrossingSource;
}

export interface ZeroCrossingSource {
  samples: Float32Array;
  sampleRate: number;
  /** Song seconds at `samples[0]`, so a beat can be located in the buffer. */
  startSec: number;
  /** Half-width of the search, in milliseconds. */
  searchMs?: number;
  /** Seconds at a beat, and the inverse — the project's tempo map, curried. */
  beatToSec: (beat: number) => number;
  secToBeat: (sec: number) => number;
}

function snapToStep(beat: number, step: number): number {
  if (!(step > 0)) return beat;
  return Math.max(0, Math.round(beat / step) * step);
}

/**
 * The finest step at least MIN_SNAP_PX wide at this zoom, in beats.
 *
 * Bars are asked from the tempo map at the beat in question, so a 3/4 section
 * snaps to three-beat bars while the 4/4 around it snaps to four.
 */
export function adaptiveGridBeats(pxPerBeat: number, map: TempoMap, beat: number): number {
  const px = Number.isFinite(pxPerBeat) && pxPerBeat > 0 ? pxPerBeat : 0;
  const bar = beatsPerBarAt(map, Math.max(0, beat));
  if (px <= 0) return bar;
  for (const step of NOTE_STEPS) {
    if (step * px >= MIN_SNAP_PX) return step;
  }
  for (const bars of BAR_STEPS) {
    if (bars * bar * px >= MIN_SNAP_PX) return bars * bar;
  }
  // Zoomed out past eight bars per twelve pixels: the coarsest step is all
  // that is left, and it is still better than snapping to a line nobody sees.
  return BAR_STEPS[BAR_STEPS.length - 1] * bar;
}

/** The nearest event within `maxDistance` beats, or null when none is close. */
export function nearestEvent(
  beat: number,
  events: readonly number[] | undefined,
  maxDistance: number,
): number | null {
  if (!events || events.length === 0 || !(maxDistance > 0)) return null;
  let best: number | null = null;
  let bestDist = Infinity;
  for (const e of events) {
    if (!Number.isFinite(e)) continue;
    const d = Math.abs(e - beat);
    if (d < bestDist && d <= maxDistance) {
      bestDist = d;
      best = e;
    }
  }
  return best;
}

/**
 * The nearest rising zero crossing to `seconds`, searching ±`searchMs`.
 *
 * Rising rather than any crossing, because a cut placed where the waveform
 * leaves zero going up joins to the start of another such cut without a step,
 * which is the whole reason to snap here. When nothing is found inside the
 * window the input is returned: a bounded search that fails must not move the
 * edit somewhere arbitrary.
 */
export function snapSecondsToZeroCrossing(
  samples: Float32Array,
  sampleRate: number,
  seconds: number,
  searchMs = 10,
): number {
  if (samples.length < 2 || !(sampleRate > 0) || !Number.isFinite(seconds)) return seconds;
  const centre = Math.round(seconds * sampleRate);
  const span = Math.max(1, Math.round((Math.max(0, searchMs) / 1000) * sampleRate));
  const from = Math.max(1, centre - span);
  const to = Math.min(samples.length - 1, centre + span);
  let best = -1;
  let bestDist = Infinity;
  for (let i = from; i <= to; i++) {
    if (samples[i - 1] <= 0 && samples[i] > 0) {
      const d = Math.abs(i - centre);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
  }
  return best >= 0 ? best / sampleRate : seconds;
}

/**
 * Snap a beat position.
 *
 * Modes that need something the caller did not supply — events with no event
 * list, zero crossing with no audio — return the position unchanged rather
 * than quietly falling back to the grid, so a mode never moves an edit for a
 * reason the musician cannot see.
 */
export function snapBeatTo(beat: number, mode: SnapMode, ctx: SnapContext): number {
  if (!Number.isFinite(beat)) return beat;
  switch (mode) {
    case 'off':
      return beat;
    case 'grid':
      return snapToStep(beat, ctx.grid);
    case 'adaptive':
      return snapToStep(beat, adaptiveGridBeats(ctx.pxPerBeat, ctx.tempoMap, beat));
    case 'events': {
      const tolerance =
        ctx.eventTolerance ?? (ctx.pxPerBeat > 0 ? EVENT_SNAP_PX / ctx.pxPerBeat : 0);
      const hit = nearestEvent(beat, ctx.events, tolerance);
      return hit === null ? beat : Math.max(0, hit);
    }
    case 'zeroCrossing': {
      const z = ctx.zeroCrossing;
      if (!z) return beat;
      const intoBuffer = z.beatToSec(Math.max(0, beat)) - z.startSec;
      const snapped = snapSecondsToZeroCrossing(z.samples, z.sampleRate, intoBuffer, z.searchMs);
      if (snapped === intoBuffer) return beat;
      return Math.max(0, z.secToBeat(snapped + z.startSec));
    }
  }
}
