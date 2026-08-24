/**
 * Motion Wave — a `UnitFace` rendered into the DOM.
 *
 * Written once, for all fourteen units. A face is a declaration — which
 * controls, which parameters, which meter channels, which panel skin — and this
 * turns that declaration into elements. Nothing here knows what a Motion Shaper
 * is, and nothing here may: the moment this file grows a special case for one
 * unit, the next thirteen faces stop being declarations and start being
 * hand-built panels that happen to have a declaration beside them.
 *
 * That rule survived Directive 09 and is the reason cell 26 was answered by
 * adding `PanelSkin` rather than by adding per-unit drawing code. What did
 * *not* survive is the assumption underneath the old version of this file:
 * that a generic renderer implies a generic appearance. It built an
 * `<input type="range">` for every role — the ternary that chose the type
 * returned `'range'` on both branches — so seven units shipped one panel with
 * one widget on it, and twenty-five ledger cells were satisfied throughout.
 *
 * Layout is `em`-based, which is MotionLab's RA-007 avoided one layer up: a
 * `px` breakpoint is measured against the viewport alone and ignores the root
 * font size, so a panel that reflows for a small screen never reflows for
 * someone who has enlarged their text.
 */
import type { FaceElement, PanelSkin, UnitFace } from '../harness/types';
import type { ParamSpec } from '../param/spec';
import { indexSpecs } from '../param/spec';
import { CONTROL_CSS } from './controlCss';
import { PANEL_CSS } from './panelCss';
import { skinVariables } from './skin';
import { stepCount } from './primitive';
import { buildCurveEditor, type CurveEditorHandle } from './controls/curve';
import type { CurveNode } from './controls/curve_model';
import { buildKnob } from './controls/knob';
import { buildSelector } from './controls/selector';
import { buildSwitch } from './controls/switches';
import { buildFader } from './controls/fader';
import { buildBar, buildDisplay, buildLamp } from './controls/readouts';
import { buildVu, type ReadoutHandle } from './controls/vu';
import type { ControlHandle, ParamSink } from './controls/shell';

/** Roles that take input, and so must meet the touch minimum. */
const INTERACTIVE = new Set<FaceElement['role']>([
  'knob',
  'fader',
  'selector',
  'toggle',
  'rocker',
  'button',
  'curve',
]);

/** Roles that draw engine state, and so are repainted from a published frame. */
const READOUT = new Set<FaceElement['role']>(['meter', 'vu', 'lamp', 'display', 'curve']);

/**
 * The panel a face with no declared skin gets.
 *
 * Deliberately plain and deliberately not neutral-looking: a unit that reaches
 * a user wearing this has not been given an identity, and cell 26 should be
 * able to see that from the panel rather than only from the ledger.
 */
export const DEFAULT_SKIN: PanelSkin = {
  era: 'undeclared — the framework default, which cell 26 fails',
  surface: 'moulded',
  hueDeg: 215,
  chroma: 'neutral',
  value: 'dark',
  knob: 'flat-cap',
  arrangement: 'field',
  lettering: 'silkscreen',
  furniture: 'none',
  lampToken: '--mw-accent',
};

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
  /** Set a control's position from outside — a preset load, an automation lane. */
  setParam(paramId: number, normalised: number): void;
  setShape(index: number, nodes: readonly CurveNode[]): void;
  dispose(): void;
}

export interface PanelOptions {
  readonly container: HTMLElement;
  readonly face: UnitFace;
  readonly specs: readonly ParamSpec[];
  readonly onParam?: ParamSink;
  /** The unit's name, shown once. Never a reference name — see LEGAL_NOTES.md. */
  readonly title: string;
  /** The unit's drawn shapes, if it has any. */
  readonly shapes?: readonly (readonly CurveNode[])[];
  onShape?(index: number, nodes: readonly CurveNode[]): void;
  /** Whether the pointer is a finger. Sizes hit targets, not appearance. */
  readonly coarsePointer?: boolean;
}

/**
 * The panel stylesheet, inserted once per document.
 *
 * Once, because it is identical for every panel — the per-unit half is custom
 * properties on the root, which cost nothing to repeat. Fourteen copies of two
 * hundred rules in a rack would be fourteen times the style recalculation for
 * no difference in the result.
 */
function ensureStylesheet(doc: Document): void {
  if (doc.querySelector('style[data-mw-panel-css]') !== null) return;
  const style = doc.createElement('style');
  style.setAttribute('data-mw-panel-css', '');
  style.textContent = `${PANEL_CSS}${CONTROL_CSS}`;
  (doc.head ?? doc.body ?? doc.documentElement).appendChild(style);
}

/** Breakpoints stay per-face, because the widths a face folds at are its own. */
function breakpointCss(face: UnitFace, id: string): string {
  const fold = face.breakpointsEm[0];
  const wide = face.breakpointsEm[face.breakpointsEm.length - 1];
  return `
[data-mw-panel='${id}'] { min-width: ${face.minWidthRem}rem; }
@media (min-width: ${fold}em) { [data-mw-panel='${id}'] .mw-panel-controls { --mw-ctl-min: calc(var(--mw-ctl-size, 3.5rem) + 1.5rem); } }
@media (min-width: ${wide}em) {
  [data-mw-panel='${id}'] .mw-panel-body { flex-direction: row; align-items: flex-start; }
  [data-mw-panel='${id}'] .mw-panel-body > * { flex: 1 1 0; min-width: 0; }
}
`;
}

function buildControlFor(
  doc: Document,
  element: FaceElement,
  spec: ParamSpec,
  skin: PanelSkin,
  onParam: ParamSink | undefined,
): ControlHandle {
  const options = { doc, element, spec, skin, onParam };
  switch (element.role) {
    case 'knob':
      return buildKnob(options);
    case 'fader':
      return buildFader(options);
    case 'selector':
      return buildSelector(options, stepCount(spec));
    case 'toggle':
      return buildSwitch(options, 'toggle');
    case 'rocker':
      return buildSwitch(options, 'rocker');
    case 'button':
      return buildSwitch(options, 'button');
    default:
      // Unreachable through `INTERACTIVE`, and a compile error if the union
      // grows a member without a primitive behind it — which is the whole
      // point of the switch being exhaustive rather than a lookup table.
      throw new Error(`no primitive for control role ${element.role}`);
  }
}

function buildReadoutFor(doc: Document, element: FaceElement): ReadoutHandle {
  switch (element.role) {
    case 'vu':
      return buildVu(doc, element.accessibleName);
    case 'lamp':
      return buildLamp(doc, element.accessibleName, element.lampThreshold ?? 0.9);
    case 'display':
      return buildDisplay(doc, element.accessibleName, '');
    default:
      return buildBar(doc, element.accessibleName, element.meterScale === 'reduction');
  }
}

let panelSerial = 0;

export function renderFace(options: PanelOptions): PanelHandle {
  const doc = options.container.ownerDocument;
  const specs = indexSpecs(options.specs);
  const skin = options.face.skin ?? DEFAULT_SKIN;
  const id = `p${++panelSerial}`;

  ensureStylesheet(doc);
  const style = doc.createElement('style');
  style.textContent = breakpointCss(options.face, id);

  const root = doc.createElement('section');
  root.className = 'mw-panel';
  root.dataset.mwPanel = id;
  root.dataset.mwSurface = skin.surface;
  root.dataset.mwFurniture = skin.furniture;
  root.dataset.mwLettering = skin.lettering;
  root.dataset.mwArrangement = skin.arrangement;
  root.dataset.mwEra = skin.era;
  root.setAttribute('aria-label', options.title);
  for (const [name, value] of Object.entries(skinVariables(skin))) {
    root.style.setProperty(name, value);
  }

  const heading = doc.createElement('h2');
  heading.className = 'mw-panel-title';
  heading.textContent = options.title;
  root.appendChild(heading);

  const body = doc.createElement('div');
  body.className = 'mw-panel-body';
  const readouts = doc.createElement('div');
  readouts.className = 'mw-panel-readouts';
  const controls = doc.createElement('div');
  controls.className = 'mw-panel-controls';

  const painters: { handle: ReadoutHandle; channel: string }[] = [];
  const curves = new Map<number, CurveEditorHandle>();
  const curvePainters: { handle: CurveEditorHandle; channel: string }[] = [];
  const byParam = new Map<number, ControlHandle>();
  const handles: { dispose(): void }[] = [];

  for (const element of options.face.elements) {
    if (element.role === 'curve') {
      const index = element.shapeIndex ?? 0;
      const editor = buildCurveEditor({
        doc,
        accessibleName: element.accessibleName,
        nodes: options.shapes?.[index] ?? [],
        coarsePointer: options.coarsePointer ?? false,
        onChange: (nodes) => options.onShape?.(index, nodes),
      });
      curves.set(index, editor);
      handles.push(editor);
      if (element.meterChannel)
        curvePainters.push({ handle: editor, channel: element.meterChannel });
      // Its own row. A curve is the instrument on the faces that have one, and
      // putting it in the meter row would size it like a level bar.
      body.appendChild(editor.node);
      continue;
    }

    if (READOUT.has(element.role)) {
      const handle = buildReadoutFor(doc, element);
      handles.push(handle);
      readouts.appendChild(handle.node);
      if (element.meterChannel) painters.push({ handle, channel: element.meterChannel });
      continue;
    }

    const spec = specs.get(element.paramId ?? -1);
    if (spec === undefined) continue;
    const control = buildControlFor(doc, element, spec, skin, options.onParam);
    handles.push(control);
    byParam.set(spec.id, control);
    controls.appendChild(control.node);
  }

  body.appendChild(readouts);
  body.appendChild(controls);
  root.appendChild(body);
  options.container.appendChild(style);
  options.container.appendChild(root);

  let paints = 0;
  const clock = () =>
    typeof performance === 'undefined' ? paints * (1000 / 60) : performance.now();

  return {
    root,
    paint(frame) {
      paints++;
      const now = clock();
      for (const { handle, channel } of painters) {
        const value = frame.get(channel);
        if (value !== undefined) handle.paint(value, now);
      }
      for (const { handle, channel } of curvePainters) {
        const value = frame.get(channel);
        if (value !== undefined) handle.paint(value);
      }
    },
    painted: () => paints,
    setParam(paramId, normalised) {
      byParam.get(paramId)?.setNormalised(normalised);
    },
    setShape(index, nodes) {
      curves.get(index)?.setNodes(nodes);
    },
    dispose() {
      for (const handle of handles) handle.dispose();
      root.remove();
      style.remove();
    },
  };
}

/** Interactive elements, for a caller that has to check their geometry. */
export function interactiveElements(face: UnitFace): readonly FaceElement[] {
  return face.elements.filter((element) => INTERACTIVE.has(element.role));
}
