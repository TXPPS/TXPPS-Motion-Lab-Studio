/**
 * Motion Wave — which primitive a parameter is allowed to wear.
 *
 * Cell 26's first requirement is that every control is the correct primitive
 * for what it represents. That reads like a matter of taste and is not: a
 * parameter's own `ParamSpec` already says whether it is continuous, stepped or
 * two-state, so "correct" is decidable and a face that dresses a four-position
 * selector as a toggle is wrong in the same way a wrong range is wrong.
 *
 * What the spec does *not* decide is which of the suitable primitives a face
 * picks — knob or fader for a continuous parameter, toggle or rocker or
 * latching button for a two-state one. That is the face's choice and part of
 * its identity, so the face declares it and this checks it. Deriving it
 * entirely would make every panel's control vocabulary identical again, which
 * is the failure cell 26 exists for.
 */
import type { ControlPrimitive } from '../harness/types';
import type { ParamSpec } from '../param/spec';
import { Taper, Unit } from '../param/units';

/** What kind of thing a parameter is, read from its own declaration. */
export type PrimitiveClass = 'continuous' | 'stepped' | 'binary';

/**
 * A two-state parameter is one with two positions, whatever it calls itself.
 *
 * Counted rather than typed, because the manifests express on/off two ways — a
 * `Choice` of two strings and a `Stepped` taper with `steps: 2` — and a check
 * that recognised only one of them would accept a slider for the other without
 * complaint.
 */
export function primitiveClassOf(spec: ParamSpec): PrimitiveClass {
  const stepped = spec.taper === Taper.Stepped || spec.unit === Unit.Choice;
  if (!stepped) return 'continuous';
  return spec.steps <= 2 ? 'binary' : 'stepped';
}

/** The primitives each class may wear. */
const SUITABLE: Record<PrimitiveClass, readonly ControlPrimitive[]> = {
  continuous: ['knob', 'fader'],
  stepped: ['selector'],
  binary: ['toggle', 'rocker', 'button'],
};

export function suitablePrimitives(spec: ParamSpec): readonly ControlPrimitive[] {
  return SUITABLE[primitiveClassOf(spec)];
}

export function primitiveSuits(primitive: ControlPrimitive, spec: ParamSpec): boolean {
  return suitablePrimitives(spec).includes(primitive);
}

/**
 * How many positions a stepped primitive has, or 0 for a continuous one.
 *
 * A selector needs this to place its detents and to snap between them; drawing
 * from `choices.length` instead would go wrong on the stepped parameters that
 * carry no choice strings, and those are exactly the ones whose detents matter
 * most because there is no legend to read the position off.
 */
export function stepCount(spec: ParamSpec): number {
  const kind = primitiveClassOf(spec);
  if (kind === 'continuous') return 0;
  return kind === 'binary' ? 2 : Math.max(2, spec.steps);
}

/**
 * The primitive a parameter gets when its face has not said otherwise.
 *
 * A default rather than the answer: which of the suitable primitives a face
 * picks is part of its identity, and a framework that chose for every unit
 * would give fourteen units one control vocabulary — which is most of how seven
 * panels came to be one panel.
 */
export function defaultPrimitiveFor(spec: ParamSpec): ControlPrimitive {
  const kind = primitiveClassOf(spec);
  return kind === 'continuous' ? 'knob' : kind === 'stepped' ? 'selector' : 'toggle';
}
