/**
 * Motion Wave — the rotary knob.
 *
 * Six bodies, chosen by the panel's skin, because the knob is most of what a
 * panel reads as from across a room: a 1950s pointer-and-skirt dial and a 1970s
 * collet knob are recognisably different objects long before anyone reads a
 * legend. They are drawn as arithmetic from design tokens — arcs, radii and
 * radial lines — so nothing is traced, matched to a product, or licensed. What
 * they share with the period is *taxonomy and proportion*, which is what an era
 * language is; see `LEGAL_NOTES.md`.
 *
 * The gesture is the same for all six and lives in `gesture.ts`: vertical drag
 * for travel, sideways for resolution, and angle once the finger is well
 * outside the body.
 */
import type { PanelSkin } from '../../harness/types';
import type { ParamSpec } from '../../param/spec';
import { attachDrag } from './gesture';
import { arcPath, polar, rotaryCanvas, svgEl, tickPath } from './svg';
import type { ControlOptions, ControlHandle, PrimitiveParts } from './shell';
import { buildControl } from './shell';

/**
 * The sweep, in degrees either side of twelve o'clock.
 *
 * 270° total is the convention every rotary control in the product uses, and it
 * is the largest sweep that still leaves the two end stops visually distinct —
 * at 300° the minimum and maximum pointers are 30° apart and read as the same
 * position in a thumbnail.
 */
export const SWEEP_DEG = 270;
const HALF = SWEEP_DEG / 2;

/** Vertical pixels for a full sweep. Roughly a phone's height held portrait. */
const TRAVEL_PX = 220;

const CX = 50;
const CY = 50;

function valueAngle(value: number): number {
  return -HALF + value * SWEEP_DEG;
}

/** A parameter that straddles zero is drawn from the centre, not from the stop. */
function isBipolar(spec: ParamSpec): boolean {
  return spec.min < 0 && spec.max > 0;
}

function scaleGroup(doc: Document, steps: number): SVGGElement {
  const group = svgEl(doc, 'g', { class: 'mw-knob-scale' });
  group.appendChild(
    svgEl(doc, 'path', { class: 'mw-knob-track', d: arcPath(CX, CY, 40, -HALF, HALF) }),
  );
  // Ticks around the sweep, at the same count the parameter has positions where
  // it has them and eleven otherwise. A continuous control with no scale at all
  // gives a user no way to return to a setting they liked.
  const count = steps > 0 ? steps : 11;
  for (let i = 0; i < count; i++) {
    const deg = -HALF + (SWEEP_DEG * i) / (count - 1);
    group.appendChild(
      svgEl(doc, 'path', { class: 'mw-knob-tick', d: tickPath(CX, CY, 42, 47, deg) }),
    );
  }
  return group;
}

function rotorFor(doc: Document, style: PanelSkin['knob']): SVGGElement {
  const rotor = svgEl(doc, 'g', { class: 'mw-knob-rotor' });
  switch (style) {
    case 'pointer-skirt': {
      rotor.appendChild(svgEl(doc, 'circle', { class: 'mw-knob-skirt', cx: CX, cy: CY, r: 33 }));
      rotor.appendChild(svgEl(doc, 'circle', { class: 'mw-knob-cap', cx: CX, cy: CY, r: 23 }));
      rotor.appendChild(
        svgEl(doc, 'path', { class: 'mw-knob-pointer', d: tickPath(CX, CY, 14, 32, 0) }),
      );
      break;
    }
    case 'chicken-head': {
      const tip = polar(CX, CY, 34, 0);
      const left = polar(CX, CY, 13, -104);
      const right = polar(CX, CY, 13, 104);
      rotor.appendChild(
        svgEl(doc, 'polygon', {
          class: 'mw-knob-cap',
          points: `${tip.x},${tip.y} ${right.x},${right.y} ${left.x},${left.y}`,
        }),
      );
      rotor.appendChild(svgEl(doc, 'circle', { class: 'mw-knob-hub', cx: CX, cy: CY, r: 11 }));
      break;
    }
    case 'fluted': {
      rotor.appendChild(svgEl(doc, 'circle', { class: 'mw-knob-cap', cx: CX, cy: CY, r: 29 }));
      for (let i = 0; i < 24; i++) {
        rotor.appendChild(
          svgEl(doc, 'path', {
            class: 'mw-knob-flute',
            d: tickPath(CX, CY, 21, 29, (360 * i) / 24),
          }),
        );
      }
      rotor.appendChild(
        svgEl(doc, 'path', { class: 'mw-knob-pointer', d: tickPath(CX, CY, 6, 20, 0) }),
      );
      break;
    }
    case 'bar': {
      rotor.appendChild(
        svgEl(doc, 'rect', { class: 'mw-knob-cap', x: 43, y: 18, width: 14, height: 64, rx: 7 }),
      );
      rotor.appendChild(
        svgEl(doc, 'path', { class: 'mw-knob-pointer', d: tickPath(CX, CY, 24, 32, 0) }),
      );
      break;
    }
    case 'collet': {
      rotor.appendChild(svgEl(doc, 'circle', { class: 'mw-knob-cap', cx: CX, cy: CY, r: 27 }));
      for (let i = 0; i < 16; i++) {
        rotor.appendChild(
          svgEl(doc, 'path', {
            class: 'mw-knob-flute',
            d: tickPath(CX, CY, 23, 27, (360 * i) / 16),
          }),
        );
      }
      rotor.appendChild(
        svgEl(doc, 'path', { class: 'mw-knob-pointer', d: tickPath(CX, CY, 4, 25, 0) }),
      );
      break;
    }
    case 'flat-cap': {
      rotor.appendChild(svgEl(doc, 'circle', { class: 'mw-knob-cap', cx: CX, cy: CY, r: 31 }));
      rotor.appendChild(
        svgEl(doc, 'rect', { class: 'mw-knob-notch', x: 46, y: 19, width: 8, height: 14, rx: 2 }),
      );
      break;
    }
  }
  return rotor;
}

/**
 * Build a knob.
 *
 * `steps` is passed rather than derived so the same drawing serves the stepped
 * selector, which is a knob whose scale has the parameter's own positions and
 * whose gesture snaps to them.
 */
export function knobParts(
  doc: Document,
  skin: PanelSkin,
  spec: ParamSpec,
  steps: number,
): PrimitiveParts {
  const svg = rotaryCanvas(doc, 'mw-knob');
  svg.appendChild(scaleGroup(doc, steps));
  const value = svgEl(doc, 'path', { class: 'mw-knob-value', d: '' });
  svg.appendChild(value);
  const rotor = rotorFor(doc, skin.knob);
  svg.appendChild(rotor);

  const bipolar = isBipolar(spec);

  return {
    art: svg,
    redraw(position) {
      const deg = valueAngle(position);
      rotor.setAttribute('transform', `rotate(${deg.toFixed(3)} ${CX} ${CY})`);
      // From the centre for a parameter that straddles zero, from the left stop
      // otherwise. A boost/cut control whose arc always grew from the left tells
      // a user that −6 dB is a small amount of something rather than a cut.
      const from = bipolar ? 0 : -HALF;
      value.setAttribute('d', Math.abs(deg - from) < 0.01 ? '' : arcPath(CX, CY, 40, from, deg));
    },
    attach(node, apply, read) {
      return attachDrag(node, {
        read,
        write: apply,
        travelPx: TRAVEL_PX,
        circular: true,
        sweepDeg: SWEEP_DEG,
      });
    },
  };
}

export function buildKnob(options: ControlOptions): ControlHandle {
  return buildControl(options, knobParts(options.doc, options.skin, options.spec, 0));
}
