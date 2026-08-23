/**
 * The Motion Shaper face, against the cells it has to satisfy.
 *
 * The geometry cases are the ones worth having. A face's *declaration* is
 * checked by the harness and would be caught by it anyway; what the harness
 * cannot see is whether a node can actually be grabbed with a thumb, and that
 * is precisely the arithmetic MotionLab's RA-002 got wrong — a strip grown to
 * the 44 px minimum inside a row that was never grown to hold it, so 25 of its
 * 44 px were clipped on every touch device.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The names no shipped string may contain, read from where they are allowed to
 * live. See the note in that file: a list of forbidden names, kept inside
 * `motionwave/`, would itself break the rule.
 */
function forbiddenNames(): string[] {
  const here = dirname(fileURLToPath(import.meta.url));
  const path = join(here, '..', '..', '..', 'docs', 'reference', 'forbidden-names.txt');
  return readFileSync(path, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));
}
import { motionShaperFace, MotionShaperMeter, MotionShaperParam } from '../units/motion_shaper/face';
import {
  POINTER_RADIUS_PX,
  TOUCH_RADIUS_PX,
  hitTestNode,
  insertNode,
  minimumEditorHeightPx,
  moveNode,
  nodeToPixels,
  pixelsToNode,
  removeNode,
  type CurveNode,
  type EditorGeometry,
} from '../units/motion_shaper/curve_editor';

const geometry: EditorGeometry = { width: 480, height: 200, inset: 12 };

const square: CurveNode[] = [
  { x: 0, y: 1, shape: 'step', tension: 0 },
  { x: 0.5, y: 0, shape: 'step', tension: 0 },
];

describe('the face declares what the harness requires', () => {
  it('gives every declared parameter a control', () => {
    // The other side of "a control that does nothing": a parameter with no
    // control is a feature nobody can reach.
    const bound = new Set(
      motionShaperFace.elements.map((e) => e.paramId).filter((id): id is number => id !== null),
    );
    for (const [name, id] of Object.entries(MotionShaperParam)) {
      expect(bound.has(id), `${name} has no control on the face`).toBe(true);
    }
  });

  it('binds every readout to a channel the unit publishes', () => {
    const published = new Set<string>(Object.values(MotionShaperMeter));
    for (const element of motionShaperFace.elements) {
      if (element.role !== 'meter' && element.role !== 'graph') continue;
      expect(element.meterChannel, `${element.id} reads no channel`).toBeDefined();
      expect(published.has(element.meterChannel!), `${element.id} reads an unpublished channel`).toBe(
        true,
      );
    }
  });

  it('declares provenance for every asset, all original', () => {
    // U19 is an IP cell. `original` with an attribution is what lets it pass
    // without a licence note, and an empty attribution fails outright.
    expect(motionShaperFace.artwork.length).toBeGreaterThan(0);
    for (const asset of motionShaperFace.artwork) {
      expect(asset.origin).toBe('original');
      expect(asset.attribution.trim().length).toBeGreaterThan(0);
    }
  });

  it('carries no trademarked reference name anywhere in its declaration', () => {
    // The list is read from `docs/reference/forbidden-names.txt` rather than
    // written here, and that is the whole point rather than tidiness. A guard
    // that scans for forbidden names, living inside `motionwave/`, contains
    // every one of those names — so it breaks the rule it enforces. My first
    // version of this test did exactly that. The framework's own
    // `UiCellOptions.forbiddenNames` takes the list from its caller for the
    // same reason.
    const names = forbiddenNames();
    expect(names.length, 'the forbidden-name list is empty, so this proves nothing').toBeGreaterThan(
      5,
    );
    const text = JSON.stringify(motionShaperFace).toLowerCase();
    for (const forbidden of names) {
      expect(text.includes(forbidden.toLowerCase()), `the face names a reference product`).toBe(
        false,
      );
    }
  });

  it('breaks at em rather than px', () => {
    // RA-007 one layer up: a px media query ignores the root font size, so a
    // face that breaks at px reflows for a small screen and never for a user
    // who has enlarged their text.
    expect(motionShaperFace.breakpointsEm.length).toBeGreaterThan(0);
    for (const at of motionShaperFace.breakpointsEm) expect(at).toBeGreaterThan(0);
  });
});

describe('a node can be grabbed with a thumb', () => {
  it('uses half the 44 pt minimum as its radius, not the whole of it', () => {
    // A target is a diameter of 44 and the hit test is a radius from the
    // centre. Getting that factor wrong halves the target and never shows up on
    // a desktop.
    expect(TOUCH_RADIUS_PX * 2).toBe(44);
    expect(POINTER_RADIUS_PX).toBeLessThan(TOUCH_RADIUS_PX);
  });

  it('grabs a node from anywhere inside its touch target', () => {
    const at = nodeToPixels(square[0], geometry);
    for (const [dx, dy] of [
      [0, 0],
      [TOUCH_RADIUS_PX - 1, 0],
      [0, TOUCH_RADIUS_PX - 1],
      [15, 15],
    ]) {
      expect(hitTestNode(square, at.x + dx, at.y + dy, geometry, true)).toBe(0);
    }
    // And not from outside it.
    expect(hitTestNode(square, at.x + TOUCH_RADIUS_PX + 2, at.y, geometry, true)).toBe(-1);
  });

  it('grabs the nearest node when two targets overlap, not the first', () => {
    // With a generous touch radius two nodes drawn close together have
    // overlapping targets. Taking the first in list order grabs whichever
    // happens to be earlier in the array — which is to say, arbitrarily.
    const close: CurveNode[] = [
      { x: 0.5, y: 0.5, shape: 'line', tension: 0 },
      { x: 0.52, y: 0.5, shape: 'line', tension: 0 },
    ];
    const second = nodeToPixels(close[1], geometry);
    expect(hitTestNode(close, second.x, second.y, geometry, true)).toBe(1);
  });

  it('states the height a layout must give it', () => {
    // Derived rather than guessed: two nodes at opposite ends of the value
    // range need their targets not to overlap, so the usable height is at least
    // one target diameter. Run before the layout rather than measured after it,
    // which is the difference between a constraint and a bug report.
    expect(minimumEditorHeightPx(true, 12)).toBe(44 + 24);
    expect(minimumEditorHeightPx(false, 12)).toBeLessThan(minimumEditorHeightPx(true, 12));
  });

  it('puts a higher value nearer the top', () => {
    // A curve that "goes up" has to mean "gets louder". Consistent and inverted
    // would still feel wrong to everyone who used it.
    const loud = nodeToPixels({ x: 0.5, y: 1, shape: 'line', tension: 0 }, geometry);
    const quiet = nodeToPixels({ x: 0.5, y: 0, shape: 'line', tension: 0 }, geometry);
    expect(loud.y).toBeLessThan(quiet.y);
  });

  it('round-trips a position through pixels and back', () => {
    for (const node of [
      { x: 0, y: 0 },
      { x: 0.5, y: 0.5 },
      { x: 1, y: 1 },
      { x: 0.37, y: 0.82 },
    ]) {
      const px = nodeToPixels({ ...node, shape: 'line', tension: 0 }, geometry);
      const back = pixelsToNode(px.x, px.y, geometry);
      expect(back.x).toBeCloseTo(node.x, 9);
      expect(back.y).toBeCloseTo(node.y, 9);
    }
  });
});

describe('editing a curve does not surprise the person doing it', () => {
  it('inserts a node without changing the shape', () => {
    // Adding a node gives you a handle on the shape you already have. A node
    // inserted at its curve value leaves the sound identical until it is
    // dragged, which is what makes adding one safe mid-performance.
    const valueAt = (x: number) => (x < 0.5 ? 1 : 0);
    const grown = insertNode(square, 0.25, valueAt);
    expect(grown.length).toBe(3);
    const added = grown.find((n) => Math.abs(n.x - 0.25) < 1e-9)!;
    expect(added.y).toBe(1);
    expect(added.shape).toBe('step');
  });

  it('keeps nodes ordered after an insert', () => {
    const grown = insertNode(square, 0.25, () => 0.5);
    for (let i = 1; i < grown.length; i++) expect(grown[i].x).toBeGreaterThanOrEqual(grown[i - 1].x);
  });

  it('refuses to delete below two nodes', () => {
    // One point is a constant and none is undefined; either leaves the user with
    // no way back to a shape, so the editor would have deleted its own
    // affordance.
    const two = removeNode(square, 0);
    expect(two.length).toBe(2);
  });

  it('stops a dragged node at its neighbour rather than swapping with it', () => {
    // A node dragged past its neighbour would reorder the curve under the
    // finger, so the drag would continue on a different node than the one that
    // was grabbed.
    const three = insertNode(square, 0.25, () => 0.5);
    const dragged = moveNode(three, 1, 0.99, 0.5);
    expect(dragged[1].x).toBeLessThan(dragged[2].x);
    for (let i = 1; i < dragged.length; i++) {
      expect(dragged[i].x).toBeGreaterThan(dragged[i - 1].x);
    }
  });

  it('keeps a dragged node inside the box', () => {
    const dragged = moveNode(square, 1, 5, -3);
    expect(dragged[1].x).toBeLessThanOrEqual(1);
    expect(dragged[1].y).toBeGreaterThanOrEqual(0);
  });
});
