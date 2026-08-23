/**
 * Motion Wave — reading and writing presets.
 *
 * The guarantee this file has to hold: a preset that loads produces a
 * bit-identical parameter set. Not "close enough to hear the same" — identical,
 * because a preset is also how a golden render is reproduced, how a bug report
 * is replayed, and how a unit's verification harness proves cell D11. A codec
 * that loses a bit somewhere makes all three unreliable in the same invisible
 * way.
 *
 * Two things are needed for that. Serialisation is canonical — key order is
 * fixed, so the same set always produces the same bytes and a diff between two
 * presets is a diff between two sounds. And numbers go through `JSON` untouched
 * rather than through any rounding of ours: JavaScript's number formatting is
 * shortest-round-trip, so `JSON.parse(JSON.stringify(x))` returns the same
 * double, and any "tidying" we did to the text would be what broke that.
 */

import {
  KNOWN_FIELDS,
  PRESET_FORMAT,
  PRESET_SCHEMA_VERSION,
  PresetFormatError,
  type PresetDocument,
  type PresetLoadReport,
} from './format';
import type { ParamSet } from '../param/set';
import type { ParamId } from '../param/spec';

export interface PresetMeta {
  readonly unit: string;
  readonly unitVersion: number;
  readonly name: string;
}

/**
 * Captures the current set as a preset.
 *
 * `carried` is whatever a previous load could not map. Re-emitting it here is
 * the whole of the forward-compatibility promise: without this argument the
 * promise is a comment, because the values have nowhere to live between a load
 * and the next save.
 */
export function capturePreset(
  set: ParamSet,
  meta: PresetMeta,
  carried: Readonly<Record<string, number>> = {},
  extra?: Readonly<Record<string, unknown>>,
): PresetDocument {
  const values: Record<string, number> = { ...carried };
  for (const [id, value] of set.capture()) values[String(id)] = value;
  const document: PresetDocument = {
    format: PRESET_FORMAT,
    schema: PRESET_SCHEMA_VERSION,
    unit: meta.unit,
    unitVersion: meta.unitVersion,
    name: meta.name,
    values: sortValues(values),
  };
  return extra !== undefined && Object.keys(extra).length > 0 ? { ...document, extra } : document;
}

/**
 * Applies a preset to a set, and reports what it could not place.
 *
 * Unknown ids are returned rather than thrown on. A unit that has lost a
 * parameter since the preset was written is a normal event across versions, and
 * refusing the whole file over one stale id would make every preset in a user's
 * library fail on the release that removed it.
 */
export function applyPreset(set: ParamSet, document: PresetDocument): PresetLoadReport {
  const applied: number[] = [];
  const unknownIds: number[] = [];
  for (const [key, value] of Object.entries(document.values)) {
    const id = Number(key);
    if (!Number.isInteger(id) || id < 0) continue;
    if (set.indexOf(id) < 0 || !set.setNormalised(id, value, 'preset')) {
      unknownIds.push(id);
      continue;
    }
    applied.push(id);
  }
  return {
    applied,
    unknownIds,
    fromNewerSchema: document.schema > PRESET_SCHEMA_VERSION,
  };
}

/** The values a load could not place, ready to hand back to `capturePreset`. */
export function carriedValues(
  document: PresetDocument,
  report: PresetLoadReport,
): Record<string, number> {
  const carried: Record<string, number> = {};
  for (const id of report.unknownIds) {
    const value = document.values[String(id)];
    if (typeof value === 'number') carried[String(id)] = value;
  }
  return carried;
}

/** The set's ids, for a caller that wants to diff a preset against a unit. */
export function presetIds(document: PresetDocument): ParamId[] {
  return Object.keys(document.values)
    .map(Number)
    .filter((id) => Number.isInteger(id) && id >= 0)
    .sort((a, b) => a - b);
}

/**
 * Canonical JSON. Keys in a fixed order and ids sorted numerically, so two
 * saves of the same state are the same bytes — which is what lets a preset be
 * compared, deduplicated and version-controlled at all.
 */
export function serialisePreset(document: PresetDocument): string {
  const ordered: Record<string, unknown> = {
    format: document.format,
    schema: document.schema,
    unit: document.unit,
    unitVersion: document.unitVersion,
    name: document.name,
    values: sortValues(document.values),
  };
  if (document.extra !== undefined) ordered.extra = document.extra;
  return JSON.stringify(ordered, null, 2);
}

/**
 * Parses a preset, keeping every field it does not know about.
 *
 * Throws only when the text is not a preset — bad JSON, a missing format tag,
 * a `values` that is not an object of numbers. A file that is a preset but is
 * newer than this build is loaded, not refused: refusing it is how a user's
 * library stops opening after they try a beta.
 */
export function parsePreset(text: string): PresetDocument {
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch (error) {
    throw new PresetFormatError(`not valid JSON (${(error as Error).message})`);
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new PresetFormatError('the document is not an object');
  }
  const source = raw as Record<string, unknown>;
  if (source.format !== PRESET_FORMAT) {
    throw new PresetFormatError(`format tag is ${JSON.stringify(source.format)}`);
  }
  const rawValues = source.values;
  if (typeof rawValues !== 'object' || rawValues === null || Array.isArray(rawValues)) {
    throw new PresetFormatError('values is not an object');
  }

  const values: Record<string, number> = {};
  for (const [key, value] of Object.entries(rawValues as Record<string, unknown>)) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new PresetFormatError(`value for id ${key} is not a finite number`);
    }
    values[key] = value;
  }

  const extra: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    if (!KNOWN_FIELDS.includes(key)) extra[key] = value;
  }

  const document: PresetDocument = {
    format: PRESET_FORMAT,
    schema: typeof source.schema === 'number' ? source.schema : PRESET_SCHEMA_VERSION,
    unit: typeof source.unit === 'string' ? source.unit : '',
    unitVersion: typeof source.unitVersion === 'number' ? source.unitVersion : 1,
    name: typeof source.name === 'string' ? source.name : '',
    values: sortValues(values),
  };
  return Object.keys(extra).length > 0 ? { ...document, extra } : document;
}

/** Numeric key order, so `10` follows `9` instead of preceding it. */
function sortValues(values: Readonly<Record<string, number>>): Record<string, number> {
  const sorted: Record<string, number> = {};
  for (const key of Object.keys(values).sort((a, b) => Number(a) - Number(b))) {
    sorted[key] = values[key];
  }
  return sorted;
}
