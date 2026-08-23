/**
 * The WebAssembly boundary, checked against the native golden render.
 *
 * Directive 05 §1.4. ADR-0001 makes the browser target the C++ core compiled to
 * WASM, which means every unit's DSP crosses this boundary before a user hears
 * it. If the two targets disagree about the arithmetic, then the native test
 * suite — which is where cells 1 to 18 are proven — is measuring something the
 * product does not do, and every one of those PASSes is worth nothing on the
 * web.
 *
 * So this asserts a **bit-for-bit** match rather than a tolerance. A tolerance
 * would be the wrong instrument twice over: it would pass a build whose
 * optimiser had reassociated the filter arithmetic, and it would give no signal
 * about how far apart the two had drifted before it finally failed.
 *
 * The golden values are parsed from `core/test/golden_render.h` — the same file
 * the native test compiles against — rather than duplicated here. A second copy
 * is a second thing to update, and the first time somebody regenerates one and
 * not the other, this test starts asserting that WASM matches a render nobody
 * makes any more.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..');
const goldenHeader = join(repoRoot, 'motionwave', 'core', 'test', 'golden_render.h');
const wasmModule = join(repoRoot, 'motionwave', 'wasm', 'dist', 'motionwave.mjs');

/** The float literals the native suite compares against, in order. */
function readGolden(): { frames: number; sampleRate: number; left: number[] } {
  const text = readFileSync(goldenHeader, 'utf8');
  const frames = Number(/kFrames\s*=\s*(\d+)/.exec(text)?.[1]);
  const sampleRate = Number(/kSampleRate\s*=\s*([\d.]+)/.exec(text)?.[1]);
  const body = /kLeft\[kFrames\]\s*=\s*\{([\s\S]*?)\};/.exec(text)?.[1] ?? '';
  // `Math.fround` is load-bearing rather than tidy. The header stores each
  // sample as a decimal literal of a *float32*, and `Number` parses it to a
  // float64 — so comparing a float32 read from the heap against that float64
  // compares two different numbers and reports about 5e-11 of "divergence".
  // That is exactly what the first run of this test measured, and it looked
  // like the two toolchains disagreeing. Rounding the parsed value back to
  // float32 puts both sides in the same precision, which is the only precision
  // the audio ever exists in.
  const left = [...body.matchAll(/(-?[\d.]+e[+-]\d+)f/g)].map((m) => Math.fround(Number(m[1])));
  return { frames, sampleRate, left };
}

interface CoreModule {
  _mw_render_reference(gain: number, frames: number, blockSize: number, rate: number): number;
  _mw_render_length(): number;
  _mw_golden_gain(): number;
  HEAPF32: Float32Array;
}

let core: CoreModule;
const golden = readGolden();

beforeAll(async () => {
  const factory = (await import(/* @vite-ignore */ wasmModule)) as {
    default: () => Promise<CoreModule>;
  };
  core = await factory.default();
}, 60_000);

/** Deinterleave the module's output buffer into one channel. */
function renderChannel(
  gain: number,
  frames: number,
  blockSize: number,
  rate: number,
  channel: number,
): number[] {
  const ptr = core._mw_render_reference(gain, frames, blockSize, rate);
  expect(ptr, 'the render refused — a graph that will not build must say so').not.toBe(0);
  const total = core._mw_render_length();
  const channels = total / frames;
  const heap = core.HEAPF32;
  const base = ptr / Float32Array.BYTES_PER_ELEMENT;
  const out: number[] = [];
  for (let i = 0; i < frames; i++) out.push(heap[base + i * channels + channel]);
  return out;
}

describe('the WebAssembly build agrees with the native one', () => {
  it('parsed a golden render worth comparing against', () => {
    // A guard on the guard. If the header's shape ever changes, the regex above
    // could quietly yield an empty array and every comparison below would
    // trivially pass over nothing.
    expect(golden.frames).toBe(256);
    expect(golden.sampleRate).toBe(48000);
    expect(golden.left.length).toBe(golden.frames);
    expect(golden.left.some((v) => v !== 0)).toBe(true);
  });

  it('exports the gain the golden was made at, rather than leaving it to be guessed', () => {
    expect(core._mw_golden_gain()).toBeCloseTo(0.5, 7);
  });

  it('renders the golden bit-for-bit', () => {
    const got = renderChannel(core._mw_golden_gain(), golden.frames, 128, golden.sampleRate, 0);
    let worst = 0;
    let worstAt = -1;
    for (let i = 0; i < golden.frames; i++) {
      const d = Math.abs(got[i] - golden.left[i]);
      if (d > worst) {
        worst = d;
        worstAt = i;
      }
    }
    console.log(
      `WASM vs native golden: worst difference ${worst.toExponential(3)} at frame ${worstAt}`,
    );
    // Exact. The golden values are decimal literals of binary floats and the
    // module renders in the same float32, so equality is the right assertion —
    // a tolerance here would hide precisely the optimiser divergence this
    // exists to catch.
    expect(worst).toBe(0);
  });

  it('renders identically at every block size, across the boundary', () => {
    // Ledger cell 7 again, on the other side. A per-block bug that the native
    // build does not have but the WASM build does would be an Emscripten
    // difference, and this is where it would show.
    const reference = renderChannel(0.5, 4096, 128, 48000, 0);
    for (const block of [32, 64, 256, 512, 1024]) {
      const got = renderChannel(0.5, 4096, block, 48000, 0);
      let worst = 0;
      for (let i = 0; i < reference.length; i++) {
        worst = Math.max(worst, Math.abs(got[i] - reference[i]));
      }
      expect(worst, `block size ${block}`).toBe(0);
    }
  });

  it('would notice a changed gain, so the match above is not vacuous', () => {
    // A boundary test nobody can fail is a boundary test nobody should trust.
    const got = renderChannel(0.5 * 1.0593, golden.frames, 128, golden.sampleRate, 0);
    let worst = 0;
    for (let i = 0; i < golden.frames; i++)
      worst = Math.max(worst, Math.abs(got[i] - golden.left[i]));
    expect(worst).toBeGreaterThan(1e-6);
  });

  it('inverts the right channel, so a collapse to mono would be visible', () => {
    const left = renderChannel(0.5, 256, 128, 48000, 0);
    const right = renderChannel(0.5, 256, 128, 48000, 1);
    // Asserted on the sum rather than on `right === -left`, because at a zero
    // crossing the right channel holds −0 and `Object.is(-0, 0)` is false. The
    // signal is correct there and the assertion was not: −0 and 0 are the same
    // sample, and a test that distinguishes them is testing IEEE 754.
    for (let i = 0; i < left.length; i++) expect(left[i] + right[i]).toBe(0);
  });
});
