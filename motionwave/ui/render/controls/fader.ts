/**
 * Motion Wave — the linear fader.
 *
 * A knob's sibling for parameters a panel wants read as travel rather than as
 * rotation: a console strip's level, a blend between two paths. The gesture is
 * the same one `gesture.ts` gives the knob, minus the circular mode — there is
 * nothing to rotate about — which also means a fader's whole travel is vertical
 * and its fine-drag axis is still horizontal, so the two feel like the same
 * instrument in the hand.
 */
import type { ParamSpec } from '../../param/spec';
import { attachDrag } from './gesture';
import { svgEl } from './svg';
import type { ControlHandle, ControlOptions, PrimitiveParts } from './shell';
import { buildControl } from './shell';

/** Vertical pixels for full travel. Shorter than a knob's: a fader shows its own. */
const TRAVEL_PX = 160;

const TOP = 10;
const BOTTOM = 126;

export function faderParts(doc: Document, spec: ParamSpec): PrimitiveParts {
  const svg = svgEl(doc, 'svg', {
    viewBox: '0 0 44 136',
    class: 'mw-fader',
    focusable: 'false',
    'aria-hidden': 'true',
  });
  svg.appendChild(
    svgEl(doc, 'rect', {
      class: 'mw-fader-slot',
      x: 19,
      y: TOP,
      width: 6,
      height: BOTTOM - TOP,
      rx: 3,
    }),
  );
  // Scale marks on the left only, as a console strip carries them: a fader
  // flanked by ticks on both sides reads as a centred control, which is a
  // different parameter.
  for (let i = 0; i <= 10; i++) {
    const y = BOTTOM - ((BOTTOM - TOP) * i) / 10;
    svg.appendChild(
      svgEl(doc, 'line', {
        class: i % 5 === 0 ? 'mw-fader-tick mw-fader-tick-major' : 'mw-fader-tick',
        x1: 6,
        y1: y,
        x2: i % 5 === 0 ? 16 : 13,
        y2: y,
      }),
    );
  }
  const travelled = svgEl(doc, 'rect', {
    class: 'mw-fader-travel',
    x: 19,
    y: TOP,
    width: 6,
    height: 0,
    rx: 3,
  });
  svg.appendChild(travelled);
  const cap = svgEl(doc, 'g', { class: 'mw-fader-cap' });
  cap.appendChild(svgEl(doc, 'rect', { x: 6, y: -9, width: 32, height: 18, rx: 3 }));
  cap.appendChild(svgEl(doc, 'line', { class: 'mw-fader-line', x1: 8, y1: 0, x2: 36, y2: 0 }));
  svg.appendChild(cap);

  const bipolar = spec.min < 0 && spec.max > 0;

  return {
    art: svg,
    redraw(value) {
      const y = BOTTOM - (BOTTOM - TOP) * value;
      cap.setAttribute('transform', `translate(0 ${y.toFixed(2)})`);
      // From the centre for a parameter that straddles zero, for the reason the
      // knob's arc does: a cut drawn as a short amount of something reads as a
      // small boost.
      const anchor = bipolar ? (TOP + BOTTOM) / 2 : BOTTOM;
      travelled.setAttribute('y', String(Math.min(anchor, y).toFixed(2)));
      travelled.setAttribute('height', String(Math.abs(anchor - y).toFixed(2)));
    },
    attach(node, apply, read) {
      return attachDrag(node, {
        read,
        write: apply,
        travelPx: TRAVEL_PX,
        circular: false,
        sweepDeg: 270,
      });
    },
  };
}

export function buildFader(options: ControlOptions): ControlHandle {
  return buildControl(options, faderParts(options.doc, options.spec));
}
