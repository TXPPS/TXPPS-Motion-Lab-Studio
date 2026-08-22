/**
 * PA-001 — making the reverb tail cheap without making it different.
 *
 * The fix has two parts and only one of them is allowed to be audible. The
 * quantisation of Size and Damping to a sixth-octave grid deliberately changes
 * *when* a new tail is rendered. The decay-curve table deliberately changes
 * nothing at all — it replaces a `Math.pow` per sample with an interpolated
 * lookup purely for speed, so if it moves a sample by more than the buffer can
 * store, the optimisation has quietly become a sound change and this fails.
 */
import { describe, expect, it } from 'vitest';
import { buildEffectNode, octaveStep } from '../src/audio/effectChain';
import { defaultParams } from '../src/model/effects';
import type { Effect } from '../src/model/types';
import { createProbeContext } from './audit/probeContext';

/** The seeded noise generator, transcribed from `effectChain.ts`. */
function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable 32-bit hash of a string, transcribed from `effectChain.ts`. */
function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** The impulse as it was written before the table: a `pow` per sample. */
function referenceImpulse(rate: number, seconds: number, damping: number, seed: number) {
  const len = Math.max(1, Math.floor(rate * Math.min(6, Math.max(0.1, seconds))));
  const out = [new Float32Array(len), new Float32Array(len)];
  const coeff = Math.exp((-2 * Math.PI * Math.min(damping, rate / 2)) / rate);
  for (let ch = 0; ch < 2; ch++) {
    const data = out[ch];
    const rand = seededRandom(seed + ch * 0x9e3779b9);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const white = rand() * 2 - 1;
      last = white * (1 - coeff) + last * coeff;
      data[i] = last * Math.pow(1 - i / len, 2.2);
    }
  }
  return out;
}

/**
 * The impulse the reverb actually installs, for one Size and Damping.
 *
 * Read by intercepting `createBuffer` rather than by reading the write log: the
 * log records a buffer assignment as the string `buffer(2x86400)`, which is the
 * right thing for it to record and no use for comparing samples.
 */
function renderedImpulse(id: string, size: number, damping: number, rate = 48000) {
  const probe = createProbeContext(rate);
  const made: { getChannelData(i: number): Float32Array }[] = [];
  const ctx = probe.ctx as unknown as {
    createBuffer(c: number, l: number, r?: number): { getChannelData(i: number): Float32Array };
  };
  const original = ctx.createBuffer.bind(ctx);
  ctx.createBuffer = (c, l, r) => {
    const buf = original(c, l, r);
    made.push(buf);
    return buf;
  };
  const e: Effect = {
    id,
    kind: 'reverb',
    bypass: false,
    params: { ...defaultParams('reverb'), size, damping },
  };
  const node = buildEffectNode(probe.ctx, e);
  node.update(e, 120, false);
  node.dispose();
  const buf = made.pop();
  return buf ? [buf.getChannelData(0), buf.getChannelData(1)] : null;
}

describe('the tabulated decay curve', () => {
  it('reproduces the impulse it replaced to within one Float32 step', () => {
    // A Float32 mantissa is 24 bits, so 2⁻²³ ≈ 1.19e-7 is one step at full
    // scale. Anything at or below that is not a difference the buffer could
    // have stored in the first place — it is roughly −140 dBFS.
    const ULP = Math.pow(2, -23);
    let worst = 0;
    for (const [size, damping] of [
      [0.2, 800],
      [1.8, 5200],
      [3, 12000],
      [6, 16000],
    ] as const) {
      const got = renderedImpulse('fx-reverb', size, damping);
      expect(got, `${size}s/${damping}Hz`).not.toBeNull();
      const want = referenceImpulse(48000, size, damping, hashSeed('fx-reverb'));
      expect(got![0].length).toBe(want[0].length);
      for (let ch = 0; ch < 2; ch++) {
        for (let i = 0; i < want[ch].length; i++) {
          worst = Math.max(worst, Math.abs(got![ch][i] - want[ch][i]));
        }
      }
    }
    console.log(
      `worst sample difference vs the pow-per-sample original: ${worst.toExponential(2)} ` +
        `(one Float32 step is ${ULP.toExponential(2)})`,
    );
    expect(worst).toBeLessThanOrEqual(ULP);
  });

  it('still gives two reverbs different tails and one reverb the same tail twice', () => {
    // The seed is what makes a bounce reproducible; the table must not have
    // disturbed it.
    const a = renderedImpulse('fx-a', 1.8, 5200)!;
    const again = renderedImpulse('fx-a', 1.8, 5200)!;
    const b = renderedImpulse('fx-b', 1.8, 5200)!;
    expect([...a[0].subarray(0, 64)]).toEqual([...again[0].subarray(0, 64)]);
    expect([...a[0].subarray(0, 64)]).not.toEqual([...b[0].subarray(0, 64)]);
    // And the two channels are decorrelated, or the reverb is mono.
    expect([...a[0].subarray(0, 64)]).not.toEqual([...a[1].subarray(0, 64)]);
  });
});

describe('the sixth-octave tail grid', () => {
  it('treats a proportional change the same at both ends of the control', () => {
    // The failure it replaces: a flat 0.05 s threshold is a quarter of the
    // shortest tail the control offers and under one per cent of the longest.
    expect(octaveStep(0.2, 6)).toBe(octaveStep(0.21, 6));
    expect(octaveStep(6, 6)).toBe(octaveStep(6.3, 6));
    // A sixth of an octave apart is a step in both places.
    expect(octaveStep(0.2 * Math.pow(2, 1 / 6), 6)).toBe(octaveStep(0.2, 6) + 1);
    expect(octaveStep(3 * Math.pow(2, 1 / 6), 6)).toBe(octaveStep(3, 6) + 1);
  });

  it('spans the two controls in the number of steps the budget assumes', () => {
    const sizeSteps = octaveStep(6, 6) - octaveStep(0.2, 6);
    const dampingSteps = octaveStep(16000, 6) - octaveStep(800, 6);
    console.log(`grid spans: Size ${sizeSteps} steps, Damping ${dampingSteps} steps`);
    expect(sizeSteps).toBeLessThanOrEqual(30);
    expect(dampingSteps).toBeLessThanOrEqual(27);
  });

  it('refuses a non-positive value rather than returning -Infinity', () => {
    expect(octaveStep(0, 6)).toBe(0);
    expect(octaveStep(-1, 6)).toBe(0);
    expect(Number.isFinite(octaveStep(Number.NaN, 6))).toBe(true);
  });
});
