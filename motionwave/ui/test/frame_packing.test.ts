/**
 * Three files agree about how wide each unit's published frame is.
 *
 * `wasm/bridge.cpp` packs it, `worklet/unit_worklet.js` copies that many doubles
 * out of the heap, and the unit's own `meters` list names them. Nothing checked
 * that the three agreed, and two of the seven did not:
 *
 * | unit | packed | named |
 * | --- | --- | --- |
 * | Variable-Mu Limiter | 7 | 6 — `lateralVertical` |
 * | Console EQ | 7 | 6 — `american` |
 *
 * Neither of those panels has ever painted in the app. `MotionWaveFace` compares
 * the frame's length against the meter list and refuses to paint when they
 * disagree — correctly, because a frame read one slot out would mislabel every
 * readout with something plausible — and it logs and returns once per animation
 * frame. A face that draws nothing looks like a face waiting for signal.
 *
 * The count is checked rather than the names, and the reason is worth stating so
 * nobody strengthens this into something that cannot hold: the C++ field names
 * and the channel names are deliberately different vocabularies.
 * `gainReductionDb[0]` and `gainReductionDb[1]` are one field and two channels,
 * `storage[0]` is `storage-a`, and forcing them to match would mean renaming
 * either the DSP or the panel to suit a test. What the length *does* catch is
 * every case where one side gained or lost a value, which is the whole of what
 * went wrong here.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { motionShaperUnit } from '../units/motion_shaper/unit';
import { programEqUnit } from '../units/program_eq/unit';
import { opticalLevellerUnit } from '../units/optical_leveller/unit';
import { fetLimiterUnit } from '../units/fet_limiter/unit';
import { variableMuUnit } from '../units/variable_mu/unit';
import { consoleEqUnit } from '../units/console_eq/unit';
import { granularReverbUnit } from '../units/granular_reverb/unit';
import type { UnitUnderTest } from '../harness/types';

const ROOT = join(import.meta.dirname, '..', '..');

const UNITS: readonly UnitUnderTest[] = [
  motionShaperUnit,
  programEqUnit,
  opticalLevellerUnit,
  fetLimiterUnit,
  variableMuUnit,
  consoleEqUnit,
  granularReverbUnit,
];

/** `{ 'dyn-05': { prefix: 'mw_console_eq', frame: 7, … } }`, from the worklet. */
function workletWidths(): Map<string, { prefix: string; frame: number }> {
  const src = readFileSync(join(ROOT, 'ui', 'worklet', 'unit_worklet.js'), 'utf8');
  const found = new Map<string, { prefix: string; frame: number }>();
  for (const m of src.matchAll(
    /'([a-z]+-\d+)':\s*\{\s*prefix:\s*'([a-z_0-9]+)',\s*frame:\s*(\d+)/g,
  )) {
    found.set(m[1]!, { prefix: m[2]!, frame: Number(m[3]) });
  }
  return found;
}

/**
 * How many doubles each `mw_*_visual()` sizes its buffer to.
 *
 * Two shapes, because the Motion Shaper predates the per-unit bridge and still
 * uses a file-scope vector it `assign`s: `visualScratch(n)` for the six units
 * behind the macro, `g_visual.assign(n, …)` for the shaper. Matching only the
 * first was this test's own first bug, and it reported the shaper's export as
 * missing from a file it is on line 259 of — a probe finding a probe defect,
 * which is the outcome the standing rule expects and the reason it is written
 * down here rather than fixed silently.
 */
function bridgeWidths(): Map<string, number> {
  const src = readFileSync(join(ROOT, 'wasm', 'bridge.cpp'), 'utf8');
  const found = new Map<string, number>();
  for (const m of src.matchAll(
    /const double\* (mw_[a-z_0-9]+)_visual\(\)[\s\S]{0,400}?(?:visualScratch\((\d+)\)|assign\((\d+),)/g,
  )) {
    found.set(m[1]!, Number(m[2] ?? m[3]));
  }
  return found;
}

describe('every unit publishes as many doubles as it names', () => {
  const worklet = workletWidths();
  const bridge = bridgeWidths();

  it('the worklet table lists every unit, so nothing below passes vacuously', () => {
    expect([...worklet.keys()].sort()).toEqual([...UNITS.map((u) => u.id)].sort());
    expect(bridge.size).toBeGreaterThanOrEqual(UNITS.length);
  });

  for (const unit of UNITS) {
    it(`${unit.name} (${unit.id})`, () => {
      const declared = (unit.meters ?? []).length;
      const spec = worklet.get(unit.id);
      expect(spec, `${unit.id} is not in the worklet's unit table`).toBeDefined();
      expect(
        spec!.frame,
        `${unit.name}: the worklet copies ${spec!.frame} double(s) and the unit names ${declared}`,
      ).toBe(declared);

      const packed = bridge.get(spec!.prefix);
      expect(packed, `${spec!.prefix}_visual() is not in bridge.cpp`).toBeDefined();
      expect(
        packed,
        `${unit.name}: bridge.cpp packs ${packed} double(s) and the unit names ${declared}`,
      ).toBe(declared);
    });
  }
});
