/**
 * The drawable multi-point curve — the Motion Shaper's hero control.
 *
 * Everything here is geometry and hit-testing, deliberately separate from any
 * drawing or event plumbing, because those are the parts a browser is needed to
 * exercise and this is the part that has to be right whether or not one is
 * available. The arithmetic below is what decides whether a node can be grabbed
 * with a thumb; if it is wrong, no amount of correct rendering saves it.
 *
 * MotionLab's RA-002 is the lesson driving the hit-testing: a control strip was
 * grown to the 44 px touch minimum without growing the row it lived in, so 25
 * of its 44 px were clipped on every touch device. The shape of that mistake is
 * treating a target's *visual* size as its *touchable* size. Here they are
 * separate by construction — a node is drawn small enough not to hide the curve
 * it sits on, and grabbed from a radius that has nothing to do with how it
 * looks.
 */

/** One editable point on the curve, mirroring `dsp::Breakpoint`. */
export interface CurveNode {
  /** Position in the cycle, 0…1. */
  x: number;
  /** Value, 0…1. */
  y: number;
  shape: 'line' | 'arc' | 'scurve' | 'step';
  /** −1…+1, mirror-symmetric about the diagonal. */
  tension: number;
}

/** The editor's box, in CSS pixels, and the device pixel ratio it draws at. */
export interface EditorGeometry {
  width: number;
  height: number;
  /** Padding inside the box so a node at y = 0 or 1 is not half off the edge. */
  inset: number;
}

/**
 * Touch target radius, in CSS pixels.
 *
 * 22, which is half of the 44 pt minimum — a target is a *diameter* of 44 and
 * the hit test is a radius from the node's centre. Getting that factor wrong is
 * the difference between meeting the guideline and halving it, and it is the
 * kind of error that never shows up on a desktop.
 */
export const TOUCH_RADIUS_PX = 22;

/**
 * Pointer radius, in CSS pixels. Smaller because a mouse is precise and a
 * generous radius would make it hard to place two nodes close together — the
 * opposite failure from the touch one, and just as real.
 */
export const POINTER_RADIUS_PX = 9;

/** Where a node sits in the editor's box. */
export function nodeToPixels(node: CurveNode, geometry: EditorGeometry): { x: number; y: number } {
  const usableW = Math.max(1, geometry.width - geometry.inset * 2);
  const usableH = Math.max(1, geometry.height - geometry.inset * 2);
  return {
    x: geometry.inset + node.x * usableW,
    // Inverted: y = 1 is full gain and belongs at the top, where a curve that
    // "goes up" means "gets louder". A face that drew it the other way would be
    // consistent and would still feel wrong to everyone who used it.
    y: geometry.inset + (1 - node.y) * usableH,
  };
}

/** Where a point in the box lands on the curve's coordinates. */
export function pixelsToNode(
  px: number,
  py: number,
  geometry: EditorGeometry,
): { x: number; y: number } {
  const usableW = Math.max(1, geometry.width - geometry.inset * 2);
  const usableH = Math.max(1, geometry.height - geometry.inset * 2);
  const x = (px - geometry.inset) / usableW;
  const y = 1 - (py - geometry.inset) / usableH;
  return { x: clamp01(x), y: clamp01(y) };
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * Which node a press at `(px, py)` grabs, or −1.
 *
 * Nearest-within-radius rather than first-within-radius. With a generous touch
 * radius two nodes drawn close together have overlapping targets, and taking
 * the first in list order would grab whichever happens to be earlier in the
 * array — which is to say, arbitrarily. Nearest is the one the user was aiming
 * at.
 */
export function hitTestNode(
  nodes: readonly CurveNode[],
  px: number,
  py: number,
  geometry: EditorGeometry,
  coarsePointer: boolean,
): number {
  const radius = coarsePointer ? TOUCH_RADIUS_PX : POINTER_RADIUS_PX;
  const limit = radius * radius;
  let best = -1;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let i = 0; i < nodes.length; i++) {
    const at = nodeToPixels(nodes[i], geometry);
    const dx = at.x - px;
    const dy = at.y - py;
    const distance = dx * dx + dy * dy;
    if (distance <= limit && distance < bestDistance) {
      bestDistance = distance;
      best = i;
    }
  }
  return best;
}

/**
 * Smallest editor height at which every node is still separately grabbable.
 *
 * The number a layout has to respect, derived rather than guessed: two nodes at
 * opposite ends of the value range need their targets not to overlap, so the
 * usable height must be at least one target diameter. Anything shorter and the
 * top and bottom of the curve become the same touch.
 *
 * This is RA-002's arithmetic run *before* the layout rather than measured
 * afterwards, which is the whole difference between a constraint and a bug
 * report.
 */
export function minimumEditorHeightPx(coarsePointer: boolean, inset: number): number {
  const radius = coarsePointer ? TOUCH_RADIUS_PX : POINTER_RADIUS_PX;
  return radius * 2 + inset * 2;
}

/**
 * Insert a node at `x`, taking its value from the curve so the shape does not
 * jump when a point is added.
 *
 * Adding a node is meant to give you a handle on the shape you already have,
 * not to change it. A node inserted at its curve value leaves the sound
 * identical until it is dragged, which is what makes adding one a safe thing to
 * try mid-performance.
 */
export function insertNode(
  nodes: readonly CurveNode[],
  x: number,
  valueAt: (x: number) => number,
): CurveNode[] {
  const at = clamp01(x);
  const inserted: CurveNode = {
    x: at,
    y: clamp01(valueAt(at)),
    // Inherits the shape of the segment it lands in, for the same reason: the
    // curve must not change until the user changes it.
    shape: segmentShapeAt(nodes, at),
    tension: segmentTensionAt(nodes, at),
  };
  const out = [...nodes, inserted];
  out.sort((a, b) => a.x - b.x);
  return out;
}

/**
 * Remove a node, refusing to go below two.
 *
 * A curve with one point is a constant and a curve with none is undefined, and
 * either would leave the user with no way back to a shape — the editor would
 * have deleted its own affordance. Two is the fewest that still draws.
 */
export function removeNode(nodes: readonly CurveNode[], index: number): CurveNode[] {
  if (nodes.length <= 2 || index < 0 || index >= nodes.length) return [...nodes];
  return nodes.filter((_, i) => i !== index);
}

/**
 * Move a node, keeping the list ordered and nodes from passing each other.
 *
 * A node dragged past its neighbour would reorder the curve under the user's
 * finger, so the drag would continue on a different node than the one they
 * grabbed. Clamping to the neighbours means the node stops at the crowd rather
 * than swapping with it.
 */
export function moveNode(
  nodes: readonly CurveNode[],
  index: number,
  x: number,
  y: number,
): CurveNode[] {
  if (index < 0 || index >= nodes.length) return [...nodes];
  const out = nodes.map((n) => ({ ...n }));
  // A hair of separation, so two nodes cannot land on exactly the same x and
  // make a zero-width segment. The DSP survives one — it returns the segment's
  // start value rather than dividing by zero — but a shape the user cannot
  // separate again is a trap.
  const epsilon = 1e-4;
  const lower = index === 0 ? 0 : out[index - 1].x + epsilon;
  const upper = index === out.length - 1 ? 1 : out[index + 1].x - epsilon;
  out[index].x = Math.min(Math.max(clamp01(x), lower), Math.max(lower, upper));
  out[index].y = clamp01(y);
  return out;
}

function segmentIndexAt(nodes: readonly CurveNode[], x: number): number {
  if (nodes.length === 0) return -1;
  let index = nodes.length - 1;
  for (let i = 0; i < nodes.length; i++) {
    const end = i + 1 < nodes.length ? nodes[i + 1].x : 1;
    if (x >= nodes[i].x && x < end) {
      index = i;
      break;
    }
  }
  return index;
}

function segmentShapeAt(nodes: readonly CurveNode[], x: number): CurveNode['shape'] {
  const i = segmentIndexAt(nodes, x);
  return i >= 0 ? nodes[i].shape : 'line';
}

function segmentTensionAt(nodes: readonly CurveNode[], x: number): number {
  const i = segmentIndexAt(nodes, x);
  return i >= 0 ? nodes[i].tension : 0;
}

/**
 * The segment law, mirrored from `motionwave/core/dsp/curve.h`.
 *
 * A mirror is the thing CLAUDE.md's rule about second opinions is aimed at, so
 * it needs saying why this one is allowed to exist and what keeps it honest.
 * The curve is evaluated per sample on the audio thread, inside the WebAssembly
 * core, in a worklet. Drawing the same curve on the main thread at 60 Hz cannot
 * go through that boundary — every pixel of the path would be a message and a
 * round trip — so the picture has to be computed here.
 *
 * What stops it becoming a second opinion is `test/curve_mirror.test.ts`, which
 * compares this function against a golden table emitted by the C++ itself at
 * 4644 points across every shape and tension. If the two ever disagree the test
 * fails by name, which is the same arrangement `ParamSpec` already lives under.
 * A drawn curve that disagreed with the audible one is precisely the failure the
 * rule exists to prevent, and the rule's answer is a test, not an intuition.
 */
export function shapeSegment(u: number, shape: CurveNode['shape'], tension: number): number {
  if (u <= 0) return 0;
  if (u >= 1) return shape === 'step' ? 0 : 1;
  switch (shape) {
    case 'step':
      return 0;
    case 'line':
      return u;
    case 'arc':
      return Math.pow(u, Math.pow(2, 3 * tension));
    case 'scurve': {
      const p = Math.pow(2, 3 * tension);
      return u < 0.5 ? 0.5 * Math.pow(2 * u, p) : 1 - 0.5 * Math.pow(2 * (1 - u), p);
    }
  }
}

/**
 * Value at a phase, wrapping — the mirror of `Curve::valueAt`.
 *
 * The wrap matters to the drawing as much as to the audio: the last node's
 * segment runs to x = 1 rather than back to the first node's x, so a curve
 * whose last node sits at 0.6 has a segment from 0.6 to 1 and the editor has to
 * draw it. Drawing to the first node instead would show a shape nobody would
 * hear.
 */
export function curveValueAt(nodes: readonly CurveNode[], phase: number): number {
  if (nodes.length === 0) return 0;
  if (nodes.length === 1) return nodes[0].y;
  const x = phase - Math.floor(phase);

  let index = nodes.length - 1;
  for (let i = 0; i < nodes.length; i++) {
    const end = i + 1 < nodes.length ? nodes[i + 1].x : 1;
    if (x >= nodes[i].x && x < end) {
      index = i;
      break;
    }
  }
  const a = nodes[index];
  const next = (index + 1) % nodes.length;
  const b = nodes[next];
  const endX = next === 0 ? 1 : b.x;
  const span = endX - a.x;
  if (span <= 0) return a.y;
  return a.y + (b.y - a.y) * shapeSegment((x - a.x) / span, a.shape, a.tension);
}
