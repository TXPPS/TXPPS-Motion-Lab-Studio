#!/usr/bin/env node
/**
 * Emit the curve evaluation's golden table, from the C++ that the audio uses.
 *
 * `motionwave/ui/render/controls/curve_model.ts` has to draw the Motion
 * Shaper's curve on the main thread, because the evaluation the audio runs
 * lives inside a WebAssembly core inside a worklet and a path drawn through
 * that boundary would be one message per pixel. That makes the TypeScript a
 * mirror, and a mirror nobody checks is the second opinion CLAUDE.md's rule is
 * about — the picture would agree with the sound until one of them changed.
 *
 * So the C++ emits, and the TypeScript is measured against what it emitted.
 * Compiled here rather than added to the test suite because it produces data
 * rather than a verdict, which is the same reason the sinc and window tables
 * are generated this way.
 *
 * Run `npm run curve:golden` to regenerate, `--check` to fail on drift.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// See scripts/licence-guard.mjs: `.pathname` is not a filesystem path on
// Windows.
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(ROOT, 'motionwave/ui/test/curve_golden.json');

/**
 * Tensions and shapes to cover.
 *
 * The ends of the tension range and the two places the law changes form: zero,
 * where `2^(3t)` is exactly 1 and the arc is a straight line, and ±1 where the
 * exponent is 8 and 1/8. A table that sampled only the middle would agree
 * everywhere the two implementations cannot disagree.
 */
const TENSIONS = [-1, -0.75, -0.5, -0.25, 0, 0.25, 0.5, 0.75, 1];
const SHAPES = ['Line', 'Arc', 'SCurve', 'Step'];
const SAMPLES = 129;

const source = `
#include "dsp/curve.h"
#include <cstdio>
int main() {
  using namespace mw::dsp;
  const SegmentShape shapes[] = {SegmentShape::Line, SegmentShape::Arc,
                                 SegmentShape::SCurve, SegmentShape::Step};
  const double tensions[] = {${TENSIONS.join(', ')}};
  std::printf("{\\n  \\"samples\\": ${SAMPLES},\\n  \\"rows\\": [\\n");
  bool firstRow = true;
  for (int s = 0; s < 4; ++s) {
    for (double t : tensions) {
      if (!firstRow) std::printf(",\\n");
      firstRow = false;
      std::printf("    {\\"shape\\": %d, \\"tension\\": %.17g, \\"values\\": [", s, t);
      for (int i = 0; i < ${SAMPLES}; ++i) {
        const double u = static_cast<double>(i) / (${SAMPLES} - 1);
        if (i) std::printf(",");
        std::printf("%.17g", shapeSegment(u, shapes[s], t));
      }
      std::printf("]}");
    }
  }
  std::printf("\\n  ]\\n}\\n");
  return 0;
}
`;

const dir = mkdtempSync(join(tmpdir(), 'mw-curve-'));
const cpp = join(dir, 'emit.cpp');
const bin = join(dir, 'emit');
writeFileSync(cpp, source);
execFileSync('g++', ['-std=c++17', '-O2', '-I', join(ROOT, 'motionwave/core'), cpp, '-o', bin]);
const emitted = execFileSync(bin, { encoding: 'utf8', maxBuffer: 1 << 28 });

if (process.argv.includes('--check')) {
  const existing = readFileSync(OUT, 'utf8');
  if (existing !== emitted) {
    console.error(
      'generate-curve-golden: motionwave/ui/test/curve_golden.json is stale.\n' +
        'The C++ curve law changed and the golden table did not. Re-run ' +
        '`npm run curve:golden`,\nthen check whether the TypeScript mirror still passes.',
    );
    process.exit(1);
  }
  console.log('generate-curve-golden: golden table matches the C++ law');
} else {
  writeFileSync(OUT, emitted);
  console.log(`generate-curve-golden: wrote ${SHAPES.length * TENSIONS.length} rows to ${OUT}`);
}
