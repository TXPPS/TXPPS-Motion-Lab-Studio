/**
 * Motion Wave — the control primitives, in one place.
 *
 * Built once for all fourteen units. Before Directive 09 there was one
 * primitive: `render/facePanel.ts` made an `<input type="range">` for every
 * role, so a stepped selector, a latching button and a continuous dial were the
 * same widget with different labels. Cell 26 is the check that stops that
 * returning, and it is behavioural — a selector snaps, a switch flips on a tap,
 * a knob answers a vertical drag — because a check on appearance alone would
 * have been satisfied by seven identical panels, which is how this got here.
 */
export { attachDrag, CIRCULAR_RADIUS_FACTOR, FINE_RATIO, FINE_SPAN_PX } from './gesture';
export type { DragBehaviour } from './gesture';
export { buildControl } from './shell';
export type { ControlHandle, ControlOptions, ParamSink, PrimitiveParts } from './shell';
export { buildKnob, knobParts, SWEEP_DEG } from './knob';
export { buildSelector, selectorParts } from './selector';
export { buildSwitch, switchParts } from './switches';
export { buildFader, faderParts } from './fader';
export { buildVu, ZERO_VU_DBFS } from './vu';
export type { ReadoutHandle } from './vu';
export { buildBar, buildDisplay, buildLamp } from './readouts';
export { standardVu, VuPointer } from './ballistics';
export { buildCurveEditor } from './curve';
export type { CurveEditorHandle, CurveEditorOptions } from './curve';
export * from './curve_model';
