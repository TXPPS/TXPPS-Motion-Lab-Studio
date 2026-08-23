/**
 * Motion Wave — a `UnitFace` rendered into the DOM.
 *
 * Written once, for all fourteen units. A face is a declaration — which
 * controls, which parameters, which meter channels, which token pairs — and
 * this turns that declaration into elements. Nothing here knows what a Motion
 * Shaper is, and nothing here may: the moment this file grows a special case
 * for one unit, the next thirteen faces stop being declarations and start being
 * hand-built panels that happen to have a declaration beside them.
 *
 * This exists because two Ledger cells cannot be judged without it. U22 is a
 * claim about geometry and jsdom answers zero for every box; U21 is a claim
 * about frame pacing against a display that jsdom does not have. Both were
 * BLOCKED on "no browser", and that had stopped being the real reason — the
 * host has one. What was missing was something to lay out and something to
 * pace, which is this.
 *
 * Layout is `em`-based throughout, and that is MotionLab's RA-007 avoided one
 * layer up: a `px` breakpoint is measured against the viewport alone and
 * ignores the root font size, so a panel that reflows for a small screen never
 * reflows for someone who has enlarged their text.
 */
import type { FaceElement, UnitFace } from '../harness/types';
import type { ParamSpec } from '../param/spec';
import { indexSpecs, isChoice, toReal } from '../param/spec';

/** Roles that take input, and so must meet the touch minimum. */
const INTERACTIVE = new Set<FaceElement['role']>(['knob', 'fader', 'switch', 'button', 'graph']);

/** Roles that draw engine state, and so are repainted from a published frame. */
const READOUT = new Set<FaceElement['role']>(['meter', 'display', 'graph']);

export interface PanelHandle {
  readonly root: HTMLElement;
  /**
   * Paint one frame of engine state.
   *
   * Takes a snapshot rather than reading anything itself, so the panel has no
   * route to the audio path at all. A readout that could reach in and ask would
   * be a readout that could block the audio thread, and the seqlock exists
   * precisely so that nobody has to.
   */
  paint(frame: ReadonlyMap<string, number>): void;
  /** Number of paints, so pacing can be measured against a display clock. */
  painted(): number;
  dispose(): void;
}

/** How a control's value is reported back. */
export type ParamSink = (paramId: number, real: number) => void;

export interface PanelOptions {
  /** Where the panel is mounted. */
  readonly container: HTMLElement;
  readonly face: UnitFace;
  readonly specs: readonly ParamSpec[];
  readonly onParam?: ParamSink;
  /** The unit's name, shown once. Never a reference name — see LEGAL_NOTES.md. */
  readonly title: string;
}

/**
 * The panel's own stylesheet, built from the face's declared breakpoints.
 *
 * Emitted rather than written as a static file because the breakpoints are the
 * face's data: a second copy in CSS would be a second opinion about where the
 * layout changes, and the first time a face moved one they would disagree
 * silently. `minWidthRem` becomes the panel's floor for the same reason.
 */
function stylesheetFor(face: UnitFace): string {
  const [fold, wide] = [face.breakpointsEm[0], face.breakpointsEm[face.breakpointsEm.length - 1]];
  return `
.mw-panel {
  --mw-panel-columns: 1;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: var(--mw-space-5);
  min-width: ${face.minWidthRem}rem;
  padding: var(--mw-space-6);
  background: var(--mw-bg-raised);
  color: var(--mw-fg);
  font-family: var(--mw-font-ui);
  font-size: var(--mw-text-md);
  /* The panel never scrolls sideways. A face that overflows its container is
     the failure U22 is looking for, so it must be visible rather than hidden
     behind an overflow rule that makes it look fine. */
  overflow-x: visible;
}
.mw-panel * { box-sizing: border-box; }
.mw-panel-title { font-size: var(--mw-text-xl); font-weight: var(--mw-weight-medium); margin: 0; }
.mw-panel-body { display: flex; flex-direction: column; gap: var(--mw-space-5); }
.mw-panel-controls {
  display: grid;
  /* The tier says how many columns it *wants*; the touch target says how narrow
     a column may get. Asking for a fixed count instead makes the two collide
     silently — a face whose controls pane is squeezed by a wide readout column
     gets four columns of 46 px, each holding a control that will not go below
     44 plus its own padding, and the grid overflows its container by the
     difference. Measured on the Variable-Mu at 1000 px: 28 px out of a 233 px
     pane, which surfaced as 12 px of horizontal scroll on the document and
     nothing at all wrong with any individual element's box.

     An auto-fit track with the tier's own share as its preferred size gives
     the requested count wherever it fits and fewer where it does not, so the
     count still rises with width — which is what U22 measures — and the floor
     is never breached. */
  grid-template-columns: repeat(
    auto-fit,
    minmax(
      max(
        var(--mw-target-min),
        calc(
          (100% - (var(--mw-panel-columns) - 1) * var(--mw-control-gutter)) /
            var(--mw-panel-columns)
        )
      ),
      1fr
    )
  );
  gap: var(--mw-control-gutter);
}
.mw-control {
  display: flex;
  flex-direction: column;
  /* A label may not widen its column. Without this a control named "Right or
     vertical channel timing network charge" sets its own min-content width from
     the longest word, the grid track grows past its share, and the panel
     overflows the document — measured on the Variable-Mu at 1000 px as 12 px of
     horizontal scroll with every individual element's box inside the viewport,
     which is the hardest shape of this bug to find. A zero min-width lets the
     track shrink, and overflow-wrap lets the word break rather than the
     layout. */
  min-width: 0;
  overflow-wrap: anywhere;
  align-items: stretch;
  gap: var(--mw-space-2);
  /* The touch minimum, applied to the control itself rather than to a wrapper.
     MotionLab's RA-002 was a strip grown to 44 px inside a row that was not,
     so 25 of those pixels were clipped on every touch device: a target's size
     is the size of the box that receives the press, not of the box around it. */
  min-height: var(--mw-target-min);
  min-width: var(--mw-target-min);
  padding: var(--mw-space-2);
  border: var(--mw-hairline) solid var(--mw-border);
  border-radius: var(--mw-radius-md);
  background: var(--mw-bg-raised);
  color: var(--mw-fg-muted);
  font-size: var(--mw-text-xs);
}
.mw-control:focus-visible { outline: var(--mw-hairline-strong) solid var(--mw-accent); }
.mw-control-input { width: 100%; min-height: var(--mw-target-min); }
.mw-readouts { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--mw-space-3); }
.mw-readout {
  min-height: var(--mw-control-row);
  border-radius: var(--mw-radius-sm);
  background: var(--mw-bg-sunken);
  color: var(--mw-fg-muted);
  font-size: var(--mw-text-2xs);
  padding: var(--mw-space-2);
}
.mw-readout-bar { display: block; height: var(--mw-space-2); background: var(--mw-meter-mid); border-radius: var(--mw-radius-pill); }
.mw-graph {
  min-height: var(--mw-target-min);
  aspect-ratio: 2 / 1;
  width: 100%;
  border-radius: var(--mw-radius-md);
  background: var(--mw-bg-sunken);
}
@media (min-width: ${fold}em) { .mw-panel { --mw-panel-columns: 2; } }
@media (min-width: ${wide}em) {
  .mw-panel { --mw-panel-columns: 4; }
  .mw-panel-body { flex-direction: row; align-items: flex-start; }
  .mw-panel-body > * { flex: 1 1 0; min-width: 0; }
}
`;
}

function controlFor(
  element: FaceElement,
  spec: ParamSpec | undefined,
  onParam: ParamSink | undefined,
  doc: Document,
): HTMLElement {
  const wrap = doc.createElement('label');
  wrap.className = 'mw-control';
  wrap.dataset.mwElement = element.id;
  wrap.dataset.mwRole = element.role;

  const name = doc.createElement('span');
  name.textContent = element.accessibleName;
  wrap.appendChild(name);

  // A real input, not a div with handlers. A range input is focusable, arrow-key
  // operable, announced with its value and its bounds, and draggable with a
  // thumb — every one of which a custom knob has to re-implement and most of
  // which a custom knob quietly does not. The knob's *look* is the face's;
  // its behaviour should not be reinvented per unit.
  const input = doc.createElement('input');
  input.className = 'mw-control-input';
  input.type = element.role === 'switch' || element.role === 'button' ? 'range' : 'range';
  input.min = '0';
  input.max = '1';
  input.step = spec && isChoice(spec) ? String(1 / Math.max(1, spec.steps - 1)) : '0.001';
  input.setAttribute('aria-label', element.accessibleName);
  if (spec) {
    input.value = String((spec.def - spec.min) / (spec.max - spec.min || 1));
    input.addEventListener('input', () => {
      onParam?.(spec.id, toReal(spec, Number(input.value)));
    });
  }
  if (!element.keyboardFocusable) input.tabIndex = -1;
  wrap.appendChild(input);
  return wrap;
}

function readoutFor(element: FaceElement, doc: Document): HTMLElement {
  const box = doc.createElement('div');
  box.className = element.role === 'graph' ? 'mw-graph' : 'mw-readout';
  box.dataset.mwElement = element.id;
  box.dataset.mwRole = element.role;
  if (element.meterChannel) box.dataset.mwChannel = element.meterChannel;
  box.setAttribute('role', 'img');
  box.setAttribute('aria-label', element.accessibleName);
  if (element.role === 'graph') {
    box.tabIndex = element.keyboardFocusable ? 0 : -1;
  } else {
    const bar = doc.createElement('span');
    bar.className = 'mw-readout-bar';
    bar.style.width = '0%';
    box.appendChild(bar);
  }
  return box;
}

/**
 * Build the panel.
 *
 * Every element the face declares becomes exactly one node, keyed by the face's
 * own id. Nothing is added that the face did not declare, which is what lets
 * U20's binding check and U22's geometry check be about the same set of things.
 */
export function renderFace(options: PanelOptions): PanelHandle {
  const doc = options.container.ownerDocument;
  const specs = indexSpecs(options.specs);

  const style = doc.createElement('style');
  style.textContent = stylesheetFor(options.face);
  const root = doc.createElement('section');
  root.className = 'mw-panel';
  root.setAttribute('aria-label', options.title);

  const heading = doc.createElement('h2');
  heading.className = 'mw-panel-title';
  heading.textContent = options.title;
  root.appendChild(heading);

  const body = doc.createElement('div');
  body.className = 'mw-panel-body';
  const readouts = doc.createElement('div');
  readouts.className = 'mw-readouts';
  const controls = doc.createElement('div');
  controls.className = 'mw-panel-controls';

  const painters: { node: HTMLElement; channel: string; role: FaceElement['role'] }[] = [];
  for (const element of options.face.elements) {
    if (READOUT.has(element.role)) {
      const node = readoutFor(element, doc);
      // A graph is its own row: it is the instrument on faces that have one,
      // and putting it in the meter grid would size it like a level bar.
      (element.role === 'graph' ? body : readouts).appendChild(node);
      if (element.meterChannel) {
        painters.push({ node, channel: element.meterChannel, role: element.role });
      }
    } else {
      controls.appendChild(
        controlFor(element, specs.get(element.paramId ?? -1), options.onParam, doc),
      );
    }
  }
  body.appendChild(readouts);
  body.appendChild(controls);
  root.appendChild(body);
  options.container.appendChild(style);
  options.container.appendChild(root);

  let paints = 0;
  return {
    root,
    paint(frame) {
      paints++;
      for (const { node, channel, role } of painters) {
        const value = frame.get(channel);
        if (value === undefined) continue;
        if (role === 'graph') {
          // The playhead, positioned from the published phase. A transform
          // rather than a layout property so a repaint costs no reflow — at
          // 60 Hz across a dozen readouts that is the difference between a
          // panel that paces and one that stutters under its own drawing.
          node.style.setProperty('--mw-playhead', String(value));
          node.dataset.mwValue = value.toFixed(6);
        } else {
          const bar = node.firstElementChild as HTMLElement | null;
          const clamped = value < 0 ? 0 : value > 1 ? 1 : value;
          if (bar) bar.style.width = `${(clamped * 100).toFixed(2)}%`;
          node.dataset.mwValue = value.toFixed(6);
        }
      }
    },
    painted: () => paints,
    dispose() {
      root.remove();
      style.remove();
    },
  };
}

/** Interactive elements, for a caller that has to check their geometry. */
export function interactiveElements(face: UnitFace): readonly FaceElement[] {
  return face.elements.filter((element) => INTERACTIVE.has(element.role));
}
