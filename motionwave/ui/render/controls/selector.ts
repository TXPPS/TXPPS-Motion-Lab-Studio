/**
 * Motion Wave — the stepped rotary selector.
 *
 * A knob's drawing with a switch's behaviour, which is what the hardware is: a
 * rotary wafer switch has detents, no intermediate positions, and a legend
 * around it rather than a number under it. Before cell 26 it was an
 * `<input type="range">` with four hundredths of travel between positions, so a
 * user could leave a 20/30/60/100 Hz selector at 43 Hz — which the DSP then
 * quantised silently, meaning the control disagreed with the sound.
 *
 * Two behaviours distinguish it from a knob, and both are what its tests check:
 * it lands only on detents, and a tap advances one position. The second matters
 * most on a phone, where a four-position switch is otherwise a drag on a target
 * the finger completely covers.
 */
import type { PanelSkin } from '../../harness/types';
import type { ParamSpec } from '../../param/spec';
import { svgEl, polar } from './svg';
import { SWEEP_DEG, knobParts } from './knob';
import type { ControlHandle, ControlOptions, PrimitiveParts } from './shell';
import { buildControl } from './shell';

/**
 * How far a pointer may travel and still count as a tap.
 *
 * Nine pixels rather than zero because a thumb rolls: a press held for a
 * quarter of a second moves several pixels on every touchscreen, and a
 * zero-tolerance tap test makes the control feel like it ignores every third
 * press.
 */
const TAP_SLOP_PX = 9;

function snapTo(value: number, steps: number): number {
  const last = steps - 1;
  return Math.round(value * last) / last;
}

/**
 * The legend, drawn around the dial rather than under it.
 *
 * Around, because the position of a name relative to the pointer is how a
 * rotary switch is read — the pointer means nothing on its own. Names longer
 * than a few characters are left to the readout below; a legend ring that
 * wrapped text would be a legend ring nobody could align.
 */
function legendGroup(doc: Document, spec: ParamSpec, steps: number): SVGGElement {
  const group = svgEl(doc, 'g', { class: 'mw-selector-legend' });
  if (spec.choices === null) return group;
  for (let i = 0; i < steps; i++) {
    const name = spec.choices[i];
    if (name === undefined || name.length > 7) continue;
    const deg = -SWEEP_DEG / 2 + (SWEEP_DEG * i) / (steps - 1);
    const at = polar(50, 50, 61, deg);
    const text = svgEl(doc, 'text', {
      class: 'mw-selector-name',
      x: at.x.toFixed(2),
      y: at.y.toFixed(2),
      'text-anchor': deg < -12 ? 'end' : deg > 12 ? 'start' : 'middle',
      'dominant-baseline': 'middle',
    });
    text.textContent = name;
    group.appendChild(text);
  }
  return group;
}

export function selectorParts(
  doc: Document,
  skin: PanelSkin,
  spec: ParamSpec,
  steps: number,
): PrimitiveParts {
  const base = knobParts(doc, skin, spec, steps);
  // The legend sits outside the dial, so the drawing has to be given room for
  // it. Widening the viewBox rather than shrinking the dial keeps every rotary
  // on a panel the same size, which is what makes a row of them read as a row.
  (base.art as SVGSVGElement).setAttribute('viewBox', '-16 0 132 100');
  base.art.appendChild(legendGroup(doc, spec, steps));

  return {
    art: base.art,
    redraw: (value) => base.redraw(snapTo(value, steps)),
    attach(node, apply, read) {
      const detachDrag = base.attach(
        node,
        (value, settled) => apply(snapTo(value, steps), settled),
        read,
      );

      let downX = 0;
      let downY = 0;
      let moved = false;
      const onDown = (event: PointerEvent) => {
        downX = event.clientX;
        downY = event.clientY;
        moved = false;
      };
      const onMove = (event: PointerEvent) => {
        if (Math.hypot(event.clientX - downX, event.clientY - downY) > TAP_SLOP_PX) moved = true;
      };
      const onUp = () => {
        if (moved) return;
        // Wrapping, because the alternative on a four-position switch is a
        // control that stops responding to taps at its last position with no
        // indication of why.
        const next = (Math.round(read() * (steps - 1)) + 1) % steps;
        apply(next / (steps - 1), true);
      };
      node.addEventListener('pointerdown', onDown);
      node.addEventListener('pointermove', onMove);
      node.addEventListener('pointerup', onUp);

      return () => {
        detachDrag();
        node.removeEventListener('pointerdown', onDown);
        node.removeEventListener('pointermove', onMove);
        node.removeEventListener('pointerup', onUp);
      };
    },
  };
}

export function buildSelector(options: ControlOptions, steps: number): ControlHandle {
  return buildControl(options, selectorParts(options.doc, options.skin, options.spec, steps));
}
