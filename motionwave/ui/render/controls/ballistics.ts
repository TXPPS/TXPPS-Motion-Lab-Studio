/**
 * Motion Wave — VU ballistics, derived rather than chosen.
 *
 * A VU meter is not a level display with a slow filter on it. It is a specified
 * instrument, and its specification is two numbers: applying a sine at 0 VU
 * drives the pointer to 99 % of the reading in 300 ms, and it overshoots by
 * 1.0–1.5 % (ANSI C16.5-1942, carried into IEC 60268-17). Those are the only
 * two facts, and a second-order system has exactly two unknowns, so the
 * instrument's damping and natural frequency follow from them with nothing left
 * over to choose. That is why this file solves rather than declares: a hand-set
 * time constant would be a third opinion about a system that is already fully
 * determined, and CLAUDE.md's rule about re-deriving rather than re-fitting
 * applies to a meter's law as much as to a compressor's.
 *
 * Nothing here touches the DOM, so the derivation is testable in the framework's
 * own node environment against a numerical integration of the same differential
 * equation — which is the check that the closed form below is the closed form
 * of the system it claims to be.
 */

/** The published overshoot band. The midpoint is what the damping is solved from. */
export const OVERSHOOT_MIN = 0.01;
export const OVERSHOOT_MAX = 0.015;

/** The published rise: 99 % of a 0 VU step, in seconds. */
export const RISE_TO_99_S = 0.3;

/**
 * Damping ratio from the overshoot.
 *
 * A second-order step response overshoots by exp(−πζ/√(1−ζ²)), which inverts in
 * closed form. Taken at the band's midpoint because the standard gives a band
 * and an instrument has one value; the ends are 0.797 and 0.827, so the choice
 * moves nothing anyone can see.
 */
export function dampingFor(overshoot: number): number {
  const ln = Math.log(overshoot);
  const ratio = -ln / Math.PI;
  return ratio / Math.sqrt(1 + ratio * ratio);
}

/** Normalised step response of `y'' + 2ζω y' + ω² y = ω² u` from rest. */
export function stepResponse(zeta: number, omega: number, t: number): number {
  const wd = omega * Math.sqrt(1 - zeta * zeta);
  const sigma = zeta * omega;
  return 1 - Math.exp(-sigma * t) * (Math.cos(wd * t) + (sigma / wd) * Math.sin(wd * t));
}

/**
 * Natural frequency from the rise time, by bisection on the first crossing.
 *
 * Bisection rather than a formula because the 99 % point of an underdamped step
 * response has no closed form, and the approximations that do exist (4.6/ζω and
 * friends) are settling-band rules that answer a different question by up to
 * 20 %. The bracket is wide and the tolerance is far below anything a pointer
 * can show.
 */
export function omegaForRise(zeta: number, riseSeconds: number, target = 0.99): number {
  let low = 0.1;
  let high = 1000;
  for (let i = 0; i < 200; i++) {
    const mid = 0.5 * (low + high);
    // A faster instrument reaches the target sooner, so the response at the
    // fixed rise time rises monotonically with omega — which is what makes a
    // bisection on it valid.
    if (stepResponse(zeta, mid, riseSeconds) < target) low = mid;
    else high = mid;
  }
  return 0.5 * (low + high);
}

export interface VuBallistics {
  readonly zeta: number;
  readonly omega: number;
}

export function standardVu(): VuBallistics {
  const zeta = dampingFor(0.5 * (OVERSHOOT_MIN + OVERSHOOT_MAX));
  return { zeta, omega: omegaForRise(zeta, RISE_TO_99_S) };
}

/**
 * One pointer, advanced by an exact state transition.
 *
 * Exact rather than an Euler step, because the frames this is driven from are
 * whatever the display gives — 16.7 ms on most phones, 8.3 ms on a fast one,
 * and a long gap whenever the tab is throttled. A fixed-step integrator turns
 * that into a different instrument on every device, and a 120 Hz display would
 * get a meter that is measurably faster than the standard it claims to meet.
 * Held-constant input over the interval is the only approximation, and it is
 * the same one the drive itself makes.
 */
export class VuPointer {
  private position = 0;
  private velocity = 0;

  constructor(private readonly law: VuBallistics = standardVu()) {}

  /** Where the pointer is, in the same units as the drive. */
  value(): number {
    return this.position;
  }

  reset(): void {
    this.position = 0;
    this.velocity = 0;
  }

  advance(drive: number, dtSeconds: number): number {
    if (!(dtSeconds > 0)) return this.position;
    const { zeta, omega } = this.law;
    const sigma = zeta * omega;
    const wd = omega * Math.sqrt(1 - zeta * zeta);
    const decay = Math.exp(-sigma * dtSeconds);
    const c = Math.cos(wd * dtSeconds);
    const s = Math.sin(wd * dtSeconds);

    const z0 = this.position - drive;
    const v0 = this.velocity;
    const z = decay * (z0 * c + ((v0 + sigma * z0) / wd) * s);
    const v = decay * (v0 * c - ((omega * omega * z0 + sigma * v0) / wd) * s);

    this.position = drive + z;
    this.velocity = v;
    return this.position;
  }
}
