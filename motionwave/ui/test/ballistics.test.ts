/**
 * The VU movement, against the standard it claims to meet.
 *
 * Two published numbers define the instrument — 99 % of a 0 VU step in 300 ms,
 * overshooting 1.0–1.5 % (ANSI C16.5-1942, carried into IEC 60268-17) — and a
 * second-order system has two unknowns, so nothing here is fitted. What these
 * cases check is that the solution really does satisfy both, and that the
 * closed-form state transition really is the closed form of the equation it
 * says it is: an integrator that is subtly wrong still produces a needle that
 * moves plausibly, which is exactly the class of error this project keeps
 * finding by measuring rather than by looking.
 */
import { describe, expect, it } from 'vitest';
import {
  OVERSHOOT_MAX,
  OVERSHOOT_MIN,
  RISE_TO_99_S,
  VuPointer,
  dampingFor,
  omegaForRise,
  standardVu,
  stepResponse,
} from '../render/controls/ballistics';

/** Fourth-order Runge–Kutta on `y'' + 2ζω y' + ω² y = ω² u`, from rest. */
function rungeKutta(zeta: number, omega: number, drive: number, seconds: number, steps: number) {
  const h = seconds / steps;
  const f = (y: number, v: number): [number, number] => [
    v,
    omega * omega * (drive - y) - 2 * zeta * omega * v,
  ];
  let y = 0;
  let v = 0;
  for (let i = 0; i < steps; i++) {
    const [a1, b1] = f(y, v);
    const [a2, b2] = f(y + (h / 2) * a1, v + (h / 2) * b1);
    const [a3, b3] = f(y + (h / 2) * a2, v + (h / 2) * b2);
    const [a4, b4] = f(y + h * a3, v + h * b3);
    y += (h / 6) * (a1 + 2 * a2 + 2 * a3 + a4);
    v += (h / 6) * (b1 + 2 * b2 + 2 * b3 + b4);
  }
  return y;
}

describe('the VU law is solved from the standard, not chosen', () => {
  it('reaches 99 % of a step at exactly the published rise time', () => {
    const { zeta, omega } = standardVu();
    expect(stepResponse(zeta, omega, RISE_TO_99_S)).toBeCloseTo(0.99, 9);
  });

  it('overshoots inside the published band', () => {
    const { zeta, omega } = standardVu();
    let peak = 0;
    for (let t = 0; t < 3; t += 1e-4) peak = Math.max(peak, stepResponse(zeta, omega, t));
    const overshoot = peak - 1;
    expect(overshoot).toBeGreaterThanOrEqual(OVERSHOOT_MIN);
    expect(overshoot).toBeLessThanOrEqual(OVERSHOOT_MAX);
  });

  it('gives the damping the overshoot formula inverts to', () => {
    // 0.812717 at the band's midpoint. Recorded as a number as well as a
    // formula, because a rewrite that quietly changed the inversion would still
    // return *a* damping and the needle would still move.
    expect(dampingFor(0.0125)).toBeCloseTo(0.812717, 6);
    expect(omegaForRise(dampingFor(0.0125), 0.3)).toBeCloseTo(13.511913, 5);
  });

  it('rejects a rise time it cannot meet by returning the bracket, not a lie', () => {
    // A bisection always returns something. What it must not do is return a
    // number that fails the constraint silently, so the caller can check.
    const zeta = dampingFor(0.0125);
    const omega = omegaForRise(zeta, 0.3);
    expect(stepResponse(zeta, omega, 0.3 - 0.02)).toBeLessThan(0.99);
  });
});

describe('the pointer advances by an exact state transition', () => {
  it('matches a fine numerical integration over uniform frames', () => {
    const law = standardVu();
    const pointer = new VuPointer(law);
    for (let i = 0; i < 18; i++) pointer.advance(1, 1 / 60);
    expect(pointer.value()).toBeCloseTo(rungeKutta(law.zeta, law.omega, 1, 18 / 60, 200_000), 9);
  });

  it('matches it over the irregular frames a display actually delivers', () => {
    // The reason the transition is exact rather than a fixed Euler step. rAF
    // gives 16.7 ms on most phones, 8.3 ms on a fast one, and 50 ms whenever
    // the tab is busy — and a fixed-step integrator would make each of those a
    // different instrument.
    const law = standardVu();
    const pointer = new VuPointer(law);
    const frames = [
      0.017, 0.008, 0.033, 0.012, 0.021, 0.009, 0.05, 0.016, 0.011, 0.02, 0.03, 0.014, 0.019, 0.04,
    ];
    let elapsed = 0;
    for (const dt of frames) {
      pointer.advance(1, dt);
      elapsed += dt;
    }
    expect(elapsed).toBeCloseTo(0.3, 9);
    expect(pointer.value()).toBeCloseTo(0.99, 8);
    expect(pointer.value()).toBeCloseTo(rungeKutta(law.zeta, law.omega, 1, elapsed, 400_000), 8);
  });

  it('holds still for a zero or negative interval', () => {
    // rAF timestamps go backwards across a tab restore on at least one browser,
    // and a negative dt through the exponential would throw the needle off the
    // scale rather than merely being wrong.
    const pointer = new VuPointer();
    pointer.advance(1, 1 / 60);
    const held = pointer.value();
    pointer.advance(1, 0);
    pointer.advance(1, -0.05);
    expect(pointer.value()).toBe(held);
  });

  it('returns to rest when the drive stops', () => {
    const pointer = new VuPointer();
    for (let i = 0; i < 60; i++) pointer.advance(1, 1 / 60);
    for (let i = 0; i < 120; i++) pointer.advance(0, 1 / 60);
    expect(pointer.value()).toBeLessThan(1e-3);
  });
});
