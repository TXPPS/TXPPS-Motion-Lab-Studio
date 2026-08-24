/**
 * Motion Wave — turning a unit's generated control table into face elements.
 *
 * Every face was doing this by hand, and every one of them was doing it the
 * same wrong way: `c.role === 'switch' ? selector(...) : knob(...)`. The
 * manifest's `control` field says "switch" for a four-position wafer and for an
 * on/off lever alike, so both became the same element, and the renderer then
 * made both an `<input type="range">` anyway. Two layers of the same mistake,
 * seven times over.
 *
 * The fix is not a better hand-written ternary. The `ParamSpec` already knows
 * whether a parameter is continuous, stepped or two-state, so the primitive is
 * decidable from it — and a face that wants a rocker where the default gives a
 * toggle says so, once, rather than restating the whole mapping.
 */
import type { ControlPrimitive, FaceElement } from '../harness/types';
import type { ParamSpec } from '../param/spec';
import { indexSpecs } from '../param/spec';
import { defaultPrimitiveFor, primitiveSuits } from './primitive';

/** One row of a generated `*Controls` table. */
export interface GeneratedControl {
  readonly id: string;
  readonly role: string;
  readonly paramId: number;
  readonly accessibleName: string;
}

export interface ControlElementOptions {
  /** Per-parameter overrides. Anything absent takes the spec's default. */
  readonly choose?: (spec: ParamSpec, id: string) => ControlPrimitive | undefined;
  /** Token pairs each control puts together, for `U23`'s contrast check. */
  readonly colours?: readonly { readonly foreground: string; readonly background: string }[];
}

/** Thrown when a face asks for a primitive its parameter cannot wear. */
export class PrimitiveMismatchError extends Error {
  constructor(id: string, primitive: ControlPrimitive, spec: ParamSpec) {
    super(
      `face element "${id}" asks for a ${primitive}, but parameter ${spec.id} ` +
        `("${spec.name}") has ${spec.steps} position(s) and cannot wear one`,
    );
    this.name = 'PrimitiveMismatchError';
  }
}

/**
 * Build the control elements for a unit.
 *
 * The mismatch throws at module load, where the face's table is first
 * evaluated, rather than at the moment a user reaches for the control. A
 * four-position selector rendered as a toggle is a bug of exactly the class
 * cell 26 is about, and finding it in a browser would mean finding it after it
 * shipped.
 */
export function controlElements(
  table: readonly GeneratedControl[],
  specs: readonly ParamSpec[],
  options: ControlElementOptions = {},
): FaceElement[] {
  const byId = indexSpecs(specs);
  return table.map((row) => {
    const spec = byId.get(row.paramId);
    if (spec === undefined)
      throw new Error(`face names parameter ${row.paramId}, which has no spec`);
    const primitive = options.choose?.(spec, row.id) ?? defaultPrimitiveFor(spec);
    if (!primitiveSuits(primitive, spec)) throw new PrimitiveMismatchError(row.id, primitive, spec);
    return {
      id: row.id,
      role: primitive,
      paramId: row.paramId,
      accessibleName: row.accessibleName,
      keyboardFocusable: true,
      colours: options.colours,
    };
  });
}
