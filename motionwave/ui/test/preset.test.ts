import { describe, expect, it } from 'vitest';

import {
  applyPreset,
  capturePreset,
  carriedValues,
  parsePreset,
  presetIds,
  serialisePreset,
} from '../preset/codec';
import { PRESET_FORMAT, PRESET_SCHEMA_VERSION, PresetFormatError } from '../preset/format';
import { PresetMigrations, remapParam, renameParam, seedParam } from '../preset/migrate';
import { ParamSet } from '../param/set';
import { defineParam } from '../param/spec';
import { Taper, Unit } from '../param/units';

const SPECS = [
  defineParam({ id: 1, name: 'Gain', unit: Unit.Decibels, min: -60, max: 12, def: 0 }),
  defineParam({
    id: 2,
    name: 'Frequency',
    unit: Unit.Hertz,
    min: 20,
    max: 20000,
    def: 1000,
    taper: Taper.Logarithmic,
  }),
  defineParam({ id: 10, name: 'Mode', unit: Unit.Choice, choices: ['A', 'B', 'C'] }),
];
const META = { unit: 'ref-00', unitVersion: 1, name: 'Test' };

/** Values that are awkward in binary, so a lossy codec would be caught. */
const AWKWARD = [0.1 + 0.2, 1 / 3, Number.MIN_VALUE, 0.30000000000000004, 0.9999999999999999];

describe('a preset that loads produces a bit-identical parameter set', () => {
  it('round-trips every value through text without losing a bit', () => {
    const set = new ParamSet(SPECS);
    set.setNormalised(1, AWKWARD[0]);
    set.setNormalised(2, AWKWARD[1]);
    set.setNormalised(10, 0.5);

    const text = serialisePreset(capturePreset(set, META));
    const reloaded = new ParamSet(SPECS);
    applyPreset(reloaded, parsePreset(text));

    for (const [id, value] of set.capture()) {
      expect(Object.is(reloaded.capture().get(id), value), `id ${id}`).toBe(true);
    }
  });

  it('produces the same bytes for the same state, so two presets can be diffed', () => {
    const set = new ParamSet(SPECS);
    set.setNormalised(2, 0.42);
    const once = serialisePreset(capturePreset(set, META));
    const twice = serialisePreset(capturePreset(set, META));
    expect(twice).toBe(once);

    const reloaded = new ParamSet(SPECS);
    applyPreset(reloaded, parsePreset(once));
    expect(serialisePreset(capturePreset(reloaded, META))).toBe(once);
  });

  it('orders ids numerically, so 10 follows 9 instead of preceding it', () => {
    const set = new ParamSet(SPECS);
    const document = capturePreset(set, META);
    expect(Object.keys(document.values)).toEqual(['1', '2', '10']);
    expect(presetIds(document)).toEqual([1, 2, 10]);
  });

  it('survives values that are awkward in binary', () => {
    for (const value of AWKWARD) {
      const set = new ParamSet(SPECS);
      set.setNormalised(1, value);
      const text = serialisePreset(capturePreset(set, META));
      const reloaded = new ParamSet(SPECS);
      applyPreset(reloaded, parsePreset(text));
      expect(Object.is(reloaded.normalised(1), set.normalised(1))).toBe(true);
    }
  });
});

describe('forward compatibility: what a build does not understand, it keeps', () => {
  it('carries an unknown id through a load and back out on the next save', () => {
    const set = new ParamSet(SPECS);
    const written = capturePreset(set, META);
    const fromNewerBuild = parsePreset(
      serialisePreset({ ...written, values: { ...written.values, '999': 0.625 } }),
    );

    const reloaded = new ParamSet(SPECS);
    const report = applyPreset(reloaded, fromNewerBuild);
    expect(report.unknownIds).toEqual([999]);

    const carried = carriedValues(fromNewerBuild, report);
    const resaved = capturePreset(reloaded, META, carried);
    // Dropping it would make the file lossy in one direction only: the user
    // opens it in the older build, saves, and the newer build finds its own
    // settings gone.
    expect(resaved.values['999']).toBe(0.625);
  });

  it('keeps top-level fields the envelope does not know about', () => {
    const set = new ParamSet(SPECS);
    const text = JSON.stringify({
      ...capturePreset(set, META),
      author: 'someone',
      tags: ['bass'],
    });
    const parsed = parsePreset(text);
    expect(parsed.extra).toEqual({ author: 'someone', tags: ['bass'] });
    expect(serialisePreset(parsed)).toContain('"author": "someone"');
  });

  it('loads a preset from a newer envelope rather than refusing it', () => {
    const set = new ParamSet(SPECS);
    const future = parsePreset(
      serialisePreset({ ...capturePreset(set, META), schema: PRESET_SCHEMA_VERSION + 5 }),
    );
    const report = applyPreset(new ParamSet(SPECS), future);
    expect(report.fromNewerSchema).toBe(true);
    expect(report.applied.length).toBe(SPECS.length);
  });

  it('refuses a file that is not a preset, and says which part failed', () => {
    expect(() => parsePreset('{')).toThrow(PresetFormatError);
    expect(() => parsePreset('[]')).toThrow(PresetFormatError);
    expect(() => parsePreset(JSON.stringify({ format: 'other' }))).toThrow(PresetFormatError);
    expect(() =>
      parsePreset(JSON.stringify({ format: PRESET_FORMAT, values: { '1': 'loud' } })),
    ).toThrow(PresetFormatError);
    expect(() =>
      parsePreset(JSON.stringify({ format: PRESET_FORMAT, values: { '1': Number.NaN } })),
    ).toThrow(PresetFormatError);
  });
});

describe('versioning migrates rather than silently reinterpreting', () => {
  const base = { format: PRESET_FORMAT, schema: 1, unit: 'ref-00', name: 'Old' } as const;

  it('steps one version at a time and stops when a step is missing', () => {
    const migrations = new PresetMigrations();
    migrations.register('ref-00', 1, renameParam(2, 7));
    const result = migrations.migrate({ ...base, unitVersion: 1, values: { '2': 0.4 } }, 3);
    expect(result.steps).toBe(1);
    expect(result.incomplete).toBe(true);
    expect(result.document.values['7']).toBe(0.4);
    expect(result.document.values['2']).toBeUndefined();
  });

  it('runs every registered step in order', () => {
    const migrations = new PresetMigrations();
    migrations.register('ref-00', 1, renameParam(2, 7));
    migrations.register(
      'ref-00',
      2,
      remapParam(7, (value) => 1 - value),
    );
    migrations.register('ref-00', 3, seedParam(8, 0.25));
    const result = migrations.migrate({ ...base, unitVersion: 1, values: { '2': 0.4 } }, 4);
    expect(result.steps).toBe(3);
    expect(result.incomplete).toBe(false);
    expect(result.document.values['7']).toBeCloseTo(0.6, 12);
    expect(result.document.values['8']).toBe(0.25);
    expect(result.document.unitVersion).toBe(4);
  });

  it('leaves a file from a newer build exactly as it found it', () => {
    const migrations = new PresetMigrations();
    const future = { ...base, unitVersion: 9, values: { '2': 0.4 } };
    const result = migrations.migrate(future, 3);
    expect(result.fromFuture).toBe(true);
    expect(result.steps).toBe(0);
    expect(result.document).toBe(future);
  });

  it('never loops on a step that forgets to advance the version', () => {
    const migrations = new PresetMigrations();
    migrations.register('ref-00', 1, (document) => document);
    migrations.register('ref-00', 2, (document) => document);
    const result = migrations.migrate({ ...base, unitVersion: 1, values: {} }, 3);
    expect(result.steps).toBe(2);
    expect(result.document.unitVersion).toBe(3);
  });

  it('refuses two steps registered for the same version', () => {
    const migrations = new PresetMigrations();
    migrations.register('ref-00', 1, renameParam(2, 7));
    expect(() => migrations.register('ref-00', 1, renameParam(2, 8))).toThrow();
  });
});
