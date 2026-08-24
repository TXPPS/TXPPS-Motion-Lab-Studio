/**
 * Motion Wave — the parts every control primitive has in common.
 *
 * The shell owns the accessibility, the value plumbing and the label; the
 * primitive owns the drawing and the gesture. Splitting it here is what stops
 * six primitives from each growing their own idea of what "the value" is.
 *
 * **The hidden native input is deliberate, and is not the range input cell 26
 * failed for.** A custom control has to re-implement focus, arrow keys, page
 * steps, home and end, the accessibility tree, the announced value and its
 * bounds — and most custom controls quietly implement about half of that. A
 * real `<input type="range">`, positioned over the primitive with
 * `pointer-events: none`, gives all of it and receives none of the pointer
 * gestures, which is the half that was wrong before: the *visible* control is a
 * knob with a knob's behaviour, and the keyboard and the screen reader still
 * get a slider, which is what a screen reader wants a knob to be.
 *
 * The behavioural difference is what the cell tests. Dragging a range input
 * vertically does nothing; dragging one of these vertically moves it. Tapping
 * the centre of a range input sets it to the middle; tapping a toggle flips it.
 */
import type { FaceElement, PanelSkin } from '../../harness/types';
import type { ParamSpec } from '../../param/spec';
import { toNormalised, toReal } from '../../param/spec';
import { accessibleValue, formatValue } from '../../param/format';
import { stepCount } from '../primitive';

export type ParamSink = (paramId: number, real: number) => void;

export interface ControlOptions {
  readonly doc: Document;
  readonly element: FaceElement;
  readonly spec: ParamSpec;
  readonly skin: PanelSkin;
  readonly onParam?: ParamSink;
}

export interface ControlHandle {
  readonly node: HTMLElement;
  /** Set the position from outside — a preset load, an automation lane. */
  setNormalised(value: number): void;
  normalised(): number;
  dispose(): void;
}

/** What a primitive gives the shell so the shell can drive it. */
export interface PrimitiveParts {
  /** The drawing, appended inside the control. */
  readonly art: Element;
  /** Redraw for a normalised value. Called on every change, so keep it cheap. */
  redraw(value: number): void;
  /** Attach the primitive's gesture. Returns its detach function. */
  attach(
    node: HTMLElement,
    apply: (value: number, settled: boolean) => void,
    read: () => number,
  ): () => void;
}

/**
 * The default's *position*, not its fraction of the range.
 *
 * Through the taper, because a logarithmic 1 kHz default in a 20 Hz–20 kHz
 * range sits at 0.61 of the sweep and at 0.049 of the arithmetic span. Reading
 * it the second way puts every frequency knob in the product hard against its
 * left stop while the audio runs at the right value, which looks like a
 * drawing bug and is a units bug.
 */
function defaultPosition(spec: ParamSpec): number {
  return toNormalised(spec, spec.def);
}

/**
 * Build the shell around a primitive.
 *
 * `data-mw-primitive` is the attribute cell 26 reads. It says what the user is
 * actually touching, which `data-mw-role` did not: every role rendered a range
 * input, so the role attribute was accurate about the declaration and silent
 * about the product.
 */
export function buildControl(options: ControlOptions, parts: PrimitiveParts): ControlHandle {
  const { doc, element, spec, onParam } = options;
  const steps = stepCount(spec);

  const node = doc.createElement('div');
  node.className = `mw-ctl mw-ctl-${element.role}`;
  node.dataset.mwElement = element.id;
  node.dataset.mwRole = element.role;
  node.dataset.mwPrimitive = element.role;

  const artWrap = doc.createElement('span');
  artWrap.className = 'mw-ctl-art';
  artWrap.appendChild(parts.art);
  node.appendChild(artWrap);

  const input = doc.createElement('input');
  input.type = 'range';
  input.className = 'mw-ctl-a11y';
  input.min = '0';
  input.max = '1';
  // A stepped control's keyboard step is one detent. Leaving it at the
  // continuous step would let an arrow key land between two positions, and the
  // control would then snap somewhere the key press did not ask for.
  input.step = steps > 0 ? String(1 / (steps - 1)) : '0.01';
  input.setAttribute('aria-label', element.accessibleName);
  if (!element.keyboardFocusable) input.tabIndex = -1;
  node.appendChild(input);

  const label = doc.createElement('span');
  label.className = 'mw-ctl-label';
  label.textContent = spec.name;
  node.appendChild(label);

  const readout = doc.createElement('span');
  readout.className = 'mw-ctl-value';
  node.appendChild(readout);

  let current = defaultPosition(spec);

  const apply = (value: number, settled: boolean) => {
    const clamped = value < 0 ? 0 : value > 1 ? 1 : value;
    current = clamped;
    input.value = String(clamped);
    input.setAttribute('aria-valuetext', accessibleValue(spec, clamped));
    readout.textContent = formatValue(spec, clamped);
    parts.redraw(clamped);
    // Every move, not only the settled ones: the audio has to follow the
    // finger, and a control that only committed on release would be a control
    // you cannot hear yourself using.
    onParam?.(spec.id, toReal(spec, clamped));
    // `change` marks the end of a gesture, which is where an undo step and an
    // automation write want their boundary. `input` fires throughout; the two
    // events mean different things and a host that wants one does not want the
    // other fired at 60 Hz.
    if (settled) input.dispatchEvent(new Event('change', { bubbles: true }));
  };

  // The keyboard's own route in. Nothing is dispatched from `apply`, so this
  // cannot loop: a key press moves the input, this reads it back, and `apply`
  // writes the same number to the input it came from.
  const onInput = () => apply(Number(input.value), true);
  input.addEventListener('input', onInput);

  const detach = parts.attach(node, apply, () => current);

  // Focus follows the press, which `pointer-events: none` on the input would
  // otherwise prevent — the primitive would be operable by finger and
  // unreachable by the keyboard immediately afterwards.
  const onDown = () => input.focus();
  node.addEventListener('pointerdown', onDown);

  apply(current, true);

  return {
    node,
    setNormalised: (value) => apply(value, true),
    normalised: () => current,
    dispose() {
      detach();
      input.removeEventListener('input', onInput);
      node.removeEventListener('pointerdown', onDown);
      node.remove();
    },
  };
}
