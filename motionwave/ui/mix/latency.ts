/**
 * Motion Wave — a latency that has been declared, as a type.
 *
 * A number of samples is not a declaration. `192` can be a guess, a copied
 * constant, or the answer to a different question — MotionLab Studio's Amp Sim
 * declares 192 for its shaper while the renderer measures 397 because a cabinet
 * convolver was never counted, and the number looks exactly as authoritative
 * either way. So the framework does not accept a number. It accepts a
 * `DeclaredLatency`, which can only be produced by `declareLatency`, and which
 * carries how the figure was arrived at and by what.
 *
 * The type is branded so a plain number cannot be passed where one is required.
 * That is what makes the wet/dry mixer's contract enforceable at compile time
 * rather than by review: there is no expression that produces a mixer without
 * first producing one of these.
 */

declare const latencyBrand: unique symbol;

/** How the figure was arrived at. Recorded because "192" alone does not say. */
export type LatencySource =
  /** An impulse was rendered through the path and its peak located. */
  | 'measured'
  /** Computed in closed form from the path's structure — an FIR's (n−1)/2. */
  | 'derived'
  /** The path genuinely adds none. Only valid with zero frames. */
  | 'none';

export interface DeclaredLatency {
  readonly frames: number;
  readonly source: LatencySource;
  /** What was measured or derived, in one line. Ends up in the unit ledger. */
  readonly note: string;
  readonly [latencyBrand]: true;
}

export class LatencyDeclarationError extends Error {
  constructor(problem: string) {
    super(`declared latency: ${problem}`);
    this.name = 'LatencyDeclarationError';
  }
}

/**
 * The only way to produce a `DeclaredLatency`.
 *
 * A fractional figure is refused rather than rounded. A path whose delay is
 * 192.5 samples has a half-sample of misalignment that no integer delay line
 * can remove, and rounding it here would hide that behind a number that looks
 * exact — the fix is a fractional-delay filter in the path, and the way to make
 * somebody build one is to refuse the declaration.
 */
export function declareLatency(
  frames: number,
  source: LatencySource,
  note: string,
): DeclaredLatency {
  if (!Number.isFinite(frames)) throw new LatencyDeclarationError('frames must be finite');
  if (!Number.isInteger(frames)) {
    throw new LatencyDeclarationError(
      `frames must be a whole number of samples, got ${frames} — a fractional delay needs a fractional-delay filter in the path, not a rounded declaration`,
    );
  }
  if (frames < 0) throw new LatencyDeclarationError('frames must not be negative');
  if (source === 'none' && frames !== 0) {
    throw new LatencyDeclarationError(`source "none" cannot declare ${frames} frames`);
  }
  if (source !== 'none' && frames === 0) {
    throw new LatencyDeclarationError('zero frames must be declared with source "none"');
  }
  if (note.trim().length === 0) {
    throw new LatencyDeclarationError('a declaration must say what was measured or derived');
  }
  return { frames, source, note } as DeclaredLatency;
}

/**
 * A path that adds nothing. Still a declaration: a unit that adds no latency
 * has to say so, because "did not declare" and "declared zero" look identical
 * downstream and only one of them has been thought about.
 */
export const NO_LATENCY: DeclaredLatency = declareLatency(
  0,
  'none',
  'the path is sample-aligned end to end',
);

/** Sums the latencies of paths in series, keeping the provenance readable. */
export function sumLatency(...parts: readonly DeclaredLatency[]): DeclaredLatency {
  const frames = parts.reduce((total, part) => total + part.frames, 0);
  if (frames === 0) return NO_LATENCY;
  const notes = parts.filter((part) => part.frames > 0).map((part) => `${part.frames}: ${part.note}`);
  const source: LatencySource = parts.some((part) => part.source === 'derived')
    ? 'derived'
    : 'measured';
  return declareLatency(frames, source, notes.join('; '));
}
