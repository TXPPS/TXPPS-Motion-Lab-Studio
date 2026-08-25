/**
 * How a project stores a Motion Wave curve, and what a fresh insert starts with.
 *
 * A curve is not a parameter — it has no range, no taper and no single value —
 * so it crosses the host boundary as its own thing. The encoding is the host's
 * translation rather than either side's model: Motion Wave thinks in
 * `CurveNode`, a project file holds four numbers per breakpoint, and this is
 * the one place that knows both.
 *
 * One place, because it was two. `MotionWaveFace` carried a private copy of the
 * codec, and seeding a default from anywhere else would have meant a second
 * one — two encoders for one file format, differing the first time either was
 * corrected. The panel now imports these.
 */
import { motionWaveUnitFor } from './registry';
import type { CurveNode } from '../../../motionwave/ui/render/controls/curve_model';

/**
 * The shape codes, by index.
 *
 * Anything out of range reads as a line, which is the shape that cannot be
 * wrong: a corrupt code falling through to `step` would make a saved session
 * play a curve nobody drew.
 */
const SHAPES: readonly CurveNode['shape'][] = ['line', 'arc', 'scurve', 'step'];

export function toNodes(rows: readonly (readonly number[])[] | undefined): CurveNode[] {
  return (rows ?? []).map((row) => ({
    x: row[0] ?? 0,
    y: row[1] ?? 0,
    shape: SHAPES[row[2] ?? 0] ?? 'line',
    tension: row[3] ?? 0,
  }));
}

export function fromNodes(nodes: readonly CurveNode[]): number[][] {
  return nodes.map((node) => [
    node.x,
    node.y,
    Math.max(0, SHAPES.indexOf(node.shape)),
    node.tension,
  ]);
}

/**
 * What a newly inserted unit's curves hold, or `undefined` for a unit with none.
 *
 * Read from the unit's own declaration rather than switched on the kind. The
 * host does not know that the Motion Shaper has three curves or what should be
 * in them — ADR-0007's boundary is that a `switch` on unit id inside `src/` is
 * how a portable unit becomes a MotionLab unit one branch at a time.
 *
 * This exists because the answer used to be "nothing". A unit whose whole
 * mechanism is a drawn shape inserted with no shape, and the core's `reset()`
 * leaves every curve flat at unity, so it was a wire with a control panel.
 */
export function defaultShapesFor(kind: string): number[][][] | undefined {
  const declared = motionWaveUnitFor(kind)?.unit.defaultShapes;
  if (!declared || declared.length === 0) return undefined;
  return declared.map((nodes) => fromNodes(nodes));
}
