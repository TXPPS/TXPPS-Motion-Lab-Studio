/**
 * Motion Wave — what a preset is.
 *
 * ADR-0004: "Presets are `{ paramId → normalised }` plus a version. Normalised,
 * not real, so a preset survives a spec whose range changes; versioned, so a
 * spec that changes *meaning* can migrate rather than silently reinterpret.
 * Unknown ids are preserved, not dropped."
 *
 * The last sentence is the one that costs something to honour and is the reason
 * this file exists separately from the codec. A preset written by a newer build
 * and opened by an older one carries parameters the older build has never heard
 * of. Dropping them makes the file lossy in one direction only: the user opens
 * it, saves it, and the newer build silently loses settings it wrote. So every
 * id survives a load, and every top-level field the envelope does not know
 * survives with it.
 */

/** Identifies the file as ours before anything is read out of it. */
export const PRESET_FORMAT = 'motionwave.preset';

/**
 * The envelope's own version, bumped only when the *shape* below changes —
 * never when a unit's parameters change, which is what `unitVersion` is for.
 * Conflating the two is how a change to one plugin invalidates every preset in
 * the product.
 */
export const PRESET_SCHEMA_VERSION = 1;

/** Values keyed by the decimal spelling of a `ParamId`, because JSON keys are strings. */
export type PresetValues = Readonly<Record<string, number>>;

export interface PresetDocument {
  readonly format: typeof PRESET_FORMAT;
  readonly schema: number;
  /** The unit's stable id, e.g. `fx-01`. Never a trademarked reference name. */
  readonly unit: string;
  /** The unit's spec-table version, which is what migrations step through. */
  readonly unitVersion: number;
  readonly name: string;
  readonly values: PresetValues;
  /**
   * Top-level fields this build does not understand, kept verbatim so a save
   * gives them back. Absent rather than empty when there are none, so a preset
   * written and read by the same build is byte-identical to itself.
   */
  readonly extra?: Readonly<Record<string, unknown>>;
}

/** The fields the envelope owns. Anything else in the file lands in `extra`. */
export const KNOWN_FIELDS: readonly string[] = [
  'format',
  'schema',
  'unit',
  'unitVersion',
  'name',
  'values',
];

/** Raised when a file is not a preset at all, as opposed to one we cannot map. */
export class PresetFormatError extends Error {
  constructor(problem: string) {
    super(`preset: ${problem}`);
    this.name = 'PresetFormatError';
  }
}

/** What a load did, so a caller can warn rather than guess. */
export interface PresetLoadReport {
  /** Ids applied to the set. */
  readonly applied: number[];
  /**
   * Ids the file carried that this build's spec table does not declare. They
   * are carried through to the next save; a UI that wants to say "written by a
   * newer version" has this list to say it from.
   */
  readonly unknownIds: number[];
  /** True when the file's envelope version is ahead of this build's. */
  readonly fromNewerSchema: boolean;
}
