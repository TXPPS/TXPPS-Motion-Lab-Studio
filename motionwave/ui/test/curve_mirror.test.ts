/**
 * The drawn curve against the heard one.
 *
 * `curve_model.ts` mirrors `motionwave/core/dsp/curve.h` because the audio's
 * own evaluation runs inside a WebAssembly core inside a worklet, and a path
 * drawn through that boundary would be one message per pixel. CLAUDE.md's rule
 * — a picture is drawn from the same evaluation the audio uses, never a second
 * opinion — is satisfied by this file rather than by the mirror being obviously
 * correct, because the mirror looked obviously correct before it was checked
 * and the interesting disagreements are at the ends of the tension range where
 * `pow` is doing the work.
 *
 * The golden table is emitted by the C++ itself; `npm run curve:check` fails
 * the build if it has gone stale against the header.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { shapeSegment, type CurveNode } from '../render/controls/curve_model';

interface GoldenRow {
  shape: number;
  tension: number;
  values: number[];
}

const SHAPES: readonly CurveNode['shape'][] = ['line', 'arc', 'scurve', 'step'];

function golden(): { samples: number; rows: GoldenRow[] } {
  const here = dirname(fileURLToPath(import.meta.url));
  return JSON.parse(readFileSync(join(here, 'curve_golden.json'), 'utf8'));
}

describe('the curve the editor draws is the curve the DSP evaluates', () => {
  it('matches the C++ at every shape and tension', () => {
    const table = golden();
    let worst = 0;
    let worstAt = '';
    for (const row of table.rows) {
      const shape = SHAPES[row.shape];
      for (let i = 0; i < table.samples; i++) {
        const u = i / (table.samples - 1);
        const mine = shapeSegment(u, shape, row.tension);
        const theirs = row.values[i];
        const delta = Math.abs(mine - theirs);
        if (delta > worst) {
          worst = delta;
          worstAt = `${shape} tension ${row.tension} at u=${u.toFixed(6)}: ${mine} vs ${theirs}`;
        }
      }
    }
    // Both sides are float64 and both evaluate the same closed form, so the only
    // permitted difference is the last bit of a `pow` — which is a library
    // difference, not a law difference. A tolerance loose enough to hide a
    // wrong exponent would make this test decorative.
    expect(worst, worstAt).toBeLessThan(1e-15);
  });

  it('covers the tensions where the two implementations could differ', () => {
    // Zero, where 2^0 is exactly 1 and the arc collapses to a line, and the
    // ends where the exponent is 8 and 1/8. A table sampled only in between
    // would agree everywhere disagreement is impossible.
    const tensions = new Set(golden().rows.map((row) => row.tension));
    expect(tensions.has(0)).toBe(true);
    expect(tensions.has(1)).toBe(true);
    expect(tensions.has(-1)).toBe(true);
  });

  it('has a row for every shape the DSP declares', () => {
    const shapes = new Set(golden().rows.map((row) => row.shape));
    expect([...shapes].sort()).toEqual([0, 1, 2, 3]);
  });
});
