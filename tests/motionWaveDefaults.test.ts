/**
 * A Motion Wave insert does something the moment it is inserted.
 *
 * Directive 11 §1.2. The Motion Shaper shipped as a bit-exact no-op: a fresh
 * insert held no shapes, so the host sent no curve, so the core kept the flat
 * curve at 1.0 that `reset()` leaves — and `motion_shaper.h` defines 1.0 as
 * unity gain. The panel showed an empty curve editor above a wire. It was
 * reported as "doesn't really do anything", which was exactly right.
 *
 * The first case is the one that matters: it is stated over *every* unit that
 * declares curves rather than over the Motion Shaper, so the next unit with a
 * drawn mechanism cannot ship inert by being forgotten here. That is the shape
 * of the rule — a matrix that omits a case is why that case ships broken.
 */
import { describe, expect, it } from 'vitest';
import { MOTIONWAVE_UNITS } from '../src/audio/motionwave/registry';
import { defaultShapesFor, fromNodes, toNodes } from '../src/audio/motionwave/shapes';
import { defaultParams } from '../src/model/effects';
import { createEmptyProject } from '../src/model/demoProject';
import { useProjectStore } from '../src/state/projectStore';

/** Units whose mechanism is a drawn curve, from their own declarations. */
const WITH_CURVES = MOTIONWAVE_UNITS.filter((entry) => (entry.unit.shapeCount ?? 0) > 0);

describe('every unit whose mechanism is a curve starts with one', () => {
  it('there is at least one such unit, so the cases below are not vacuous', () => {
    // Without this the file passes by iterating an empty list the day someone
    // renames `shapeCount`.
    expect(WITH_CURVES.length).toBeGreaterThan(0);
  });

  it.each(WITH_CURVES.map((entry) => [entry.label, entry] as const))(
    '%s declares one default curve per shape',
    (_label, entry) => {
      const declared = entry.unit.defaultShapes ?? [];
      expect(declared.length).toBe(entry.unit.shapeCount);
    },
  );

  it.each(WITH_CURVES.map((entry) => [entry.label, entry] as const))(
    '%s: every default curve actually varies',
    (_label, entry) => {
      // A default that is present but flat is the same wire with more steps to
      // it. Two distinct `y` values is the least that can be called a shape.
      for (const nodes of entry.unit.defaultShapes ?? []) {
        const heights = new Set(nodes.map((node) => node.y));
        expect(heights.size, `${_label} has a flat default curve`).toBeGreaterThan(1);
      }
    },
  );

  it.each(WITH_CURVES.map((entry) => [entry.label, entry] as const))(
    '%s: a freshly inserted effect carries them',
    (_label, entry) => {
      // Through the store, because the defect was not in the declaration — it
      // was that `addEffect` never asked for one.
      const store = useProjectStore.getState();
      store.setProject(createEmptyProject('Defaults'));
      const trackId = store.addTrack('audio');
      const effectId = useProjectStore.getState().addEffect(trackId, entry.kind);
      expect(effectId).not.toBeNull();
      const effect = useProjectStore
        .getState()
        .project.tracks.find((t) => t.id === trackId)!
        .effects!.find((e) => e.id === effectId)!;
      expect(effect.shapes, `${_label} inserted with no shapes`).toBeDefined();
      expect(effect.shapes!.length).toBe(entry.unit.shapeCount);
      for (const rows of effect.shapes!) {
        expect(new Set(rows.map((row) => row[1])).size).toBeGreaterThan(1);
      }
    },
  );
});

describe('the curve codec is one codec', () => {
  it('round-trips every shape code the file format has', () => {
    // `fromNodes` and `toNodes` lived privately inside the panel, and seeding a
    // default from elsewhere would have meant a second copy — two encoders for
    // one file format, differing the first time either was corrected.
    const nodes = [
      { x: 0, y: 0, shape: 'line' as const, tension: 0 },
      { x: 0.25, y: 1, shape: 'arc' as const, tension: 0.5 },
      { x: 0.5, y: 0.5, shape: 'scurve' as const, tension: -0.25 },
      { x: 0.75, y: 1, shape: 'step' as const, tension: 0 },
    ];
    expect(toNodes(fromNodes(nodes))).toEqual(nodes);
  });

  it('reads an unknown shape code as a line rather than as a step', () => {
    // The shape that cannot be wrong. A corrupt code falling through to `step`
    // would make a saved session play a curve nobody drew.
    expect(toNodes([[0, 1, 99, 0]])[0].shape).toBe('line');
  });

  it('gives a unit with no curves no shapes at all', () => {
    // Not an empty array: `shapes: []` in a project file is a claim that the
    // unit has curves and they are empty, which is a different thing from a
    // compressor.
    const noCurves = MOTIONWAVE_UNITS.find((entry) => !entry.unit.shapeCount);
    expect(noCurves, 'no curve-less unit to check against').toBeDefined();
    expect(defaultShapesFor(noCurves!.kind)).toBeUndefined();
    expect(defaultParams(noCurves!.kind)).not.toEqual({});
  });
});
