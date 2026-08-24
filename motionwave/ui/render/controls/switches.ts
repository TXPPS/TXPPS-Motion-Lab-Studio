/**
 * Motion Wave — the two-state primitives: bat toggle, rocker, latching button.
 *
 * Three rather than one because a panel's switch vocabulary is era language as
 * much as its knobs are: a 1950s equaliser carries bat levers, a 1970s console
 * strip carries rockers, and a limiter's metering select is a latching push
 * button with a lamp in it. They behave identically — a tap flips the state —
 * and that shared behaviour is the point: `<input type="range">` flipped
 * nothing, and a "switch" that had to be dragged halfway across its travel to
 * change state is a switch nobody could operate with a thumb.
 *
 * A tap is the gesture, not a drag, and the distinction is what the cell tests:
 * a press and release with no movement changes the value. A range input at rest
 * in the middle of a two-state parameter does not exist — there is no middle —
 * so the old control could only be moved by dragging it to one end.
 */
import { svgEl } from './svg';
import type { ControlHandle, ControlOptions, PrimitiveParts } from './shell';
import { buildControl } from './shell';

/** As in `selector.ts`: a thumb rolls, and a zero-tolerance tap ignores presses. */
const TAP_SLOP_PX = 9;

function tapToFlip(
  node: HTMLElement,
  apply: (value: number, settled: boolean) => void,
  read: () => number,
): () => void {
  let downX = 0;
  let downY = 0;
  let moved = false;
  const onDown = (event: PointerEvent) => {
    downX = event.clientX;
    downY = event.clientY;
    moved = false;
    node.dataset.mwPressed = 'true';
    event.preventDefault();
  };
  const onMove = (event: PointerEvent) => {
    if (Math.hypot(event.clientX - downX, event.clientY - downY) > TAP_SLOP_PX) moved = true;
  };
  const onUp = () => {
    delete node.dataset.mwPressed;
    if (moved) return;
    apply(read() >= 0.5 ? 0 : 1, true);
  };
  node.addEventListener('pointerdown', onDown);
  node.addEventListener('pointermove', onMove);
  node.addEventListener('pointerup', onUp);
  node.addEventListener('pointercancel', onUp);
  return () => {
    node.removeEventListener('pointerdown', onDown);
    node.removeEventListener('pointermove', onMove);
    node.removeEventListener('pointerup', onUp);
    node.removeEventListener('pointercancel', onUp);
  };
}

function surface(doc: Document, viewBox: string, className: string): SVGSVGElement {
  return svgEl(doc, 'svg', {
    viewBox,
    class: className,
    focusable: 'false',
    'aria-hidden': 'true',
  });
}

/**
 * A bat lever. The handle tilts about its bushing rather than sliding, because
 * a lever that translated would read as a fader at a glance and the whole point
 * of carrying three switch bodies is that they are told apart at a glance.
 */
function toggleArt(doc: Document): { art: SVGSVGElement; redraw: (on: number) => void } {
  const svg = surface(doc, '0 0 60 100', 'mw-switch mw-switch-toggle');
  svg.appendChild(
    svgEl(doc, 'rect', { class: 'mw-switch-plate', x: 6, y: 58, width: 48, height: 34, rx: 4 }),
  );
  svg.appendChild(
    svgEl(doc, 'ellipse', { class: 'mw-switch-bush', cx: 30, cy: 66, rx: 15, ry: 7 }),
  );
  const lever = svgEl(doc, 'g', { class: 'mw-switch-lever' });
  lever.appendChild(
    svgEl(doc, 'polygon', { class: 'mw-switch-bat', points: '25,66 35,66 33,22 27,22' }),
  );
  lever.appendChild(svgEl(doc, 'circle', { class: 'mw-switch-tip', cx: 30, cy: 20, r: 8 }));
  svg.appendChild(lever);
  return {
    art: svg,
    redraw(on) {
      lever.setAttribute('transform', `rotate(${on >= 0.5 ? -20 : 20} 30 66)`);
      svg.dataset.mwOn = on >= 0.5 ? 'true' : 'false';
    },
  };
}

/** A rocker: one half stands proud, and the lit half is the one that is engaged. */
function rockerArt(doc: Document): { art: SVGSVGElement; redraw: (on: number) => void } {
  const svg = surface(doc, '0 0 100 68', 'mw-switch mw-switch-rocker');
  svg.appendChild(
    svgEl(doc, 'rect', { class: 'mw-switch-plate', x: 2, y: 2, width: 96, height: 64, rx: 6 }),
  );
  const top = svgEl(doc, 'rect', {
    class: 'mw-rocker-half mw-rocker-top',
    x: 8,
    y: 7,
    width: 84,
    height: 26,
    rx: 3,
  });
  const bottom = svgEl(doc, 'rect', {
    class: 'mw-rocker-half mw-rocker-bottom',
    x: 8,
    y: 35,
    width: 84,
    height: 26,
    rx: 3,
  });
  svg.appendChild(top);
  svg.appendChild(bottom);
  svg.appendChild(
    svgEl(doc, 'rect', { class: 'mw-rocker-lamp', x: 34, y: 15, width: 32, height: 10, rx: 2 }),
  );
  return {
    art: svg,
    redraw(on) {
      svg.dataset.mwOn = on >= 0.5 ? 'true' : 'false';
    },
  };
}

/** A latching push button, with the lamp that says which way it latched. */
function buttonArt(doc: Document): { art: SVGSVGElement; redraw: (on: number) => void } {
  const svg = surface(doc, '0 0 100 100', 'mw-switch mw-switch-button');
  svg.appendChild(svgEl(doc, 'circle', { class: 'mw-switch-plate', cx: 50, cy: 50, r: 44 }));
  svg.appendChild(svgEl(doc, 'circle', { class: 'mw-button-cap', cx: 50, cy: 50, r: 34 }));
  svg.appendChild(svgEl(doc, 'circle', { class: 'mw-button-lamp', cx: 50, cy: 50, r: 13 }));
  return {
    art: svg,
    redraw(on) {
      svg.dataset.mwOn = on >= 0.5 ? 'true' : 'false';
    },
  };
}

export function switchParts(doc: Document, kind: 'toggle' | 'rocker' | 'button'): PrimitiveParts {
  const drawn =
    kind === 'toggle' ? toggleArt(doc) : kind === 'rocker' ? rockerArt(doc) : buttonArt(doc);
  return {
    art: drawn.art,
    redraw: drawn.redraw,
    attach: (node, apply, read) => tapToFlip(node, apply, read),
  };
}

export function buildSwitch(
  options: ControlOptions,
  kind: 'toggle' | 'rocker' | 'button',
): ControlHandle {
  return buildControl(options, switchParts(options.doc, kind));
}
