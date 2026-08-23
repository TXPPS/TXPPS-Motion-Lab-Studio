// GENERATED FILE — do not edit.
//
// Written by scripts/generate-params.mjs from motionwave/manifests/dyn-03-fet-limiter.json.
// Edit the manifest and re-run `npm run params`. A hand edit here is exactly
// the second opinion the manifest exists to prevent, and `npm run params:check`
// fails the build if one is present.
import { defineParam } from '../../param/spec';
import type { ParamSpec } from '../../param/spec';
import { Taper, Unit } from '../../param/units';

/** Parameter ids, the same numbers the C++ enum carries. */
export const FetLimiterParam = {
  Input: 1,
  Output: 2,
  Attack: 3,
  Release: 4,
  Ratio: 5,
  Limiting: 6,
  Variance: 7,
  Oversampling: 8,
  Noise: 9,
} as const;

export type FetLimiterParamId = (typeof FetLimiterParam)[keyof typeof FetLimiterParam];

/**
 * Every range, default and taper, straight from the manifest — which took them
 * from the Reference Spec Sheet. A control that sweeps a different range than
 * its sheet fails the unit's acceptance test on a number nobody checks by ear.
 */
export const fetLimiterSpecs: readonly ParamSpec[] = [
  defineParam({
    id: FetLimiterParam.Input,
    name: 'Input',
    unit: Unit.Decibels,
    min: -20,
    max: 40,
    def: 0,
    taper: Taper.Linear,
    smoothingMs: 30,
  }),
  defineParam({
    id: FetLimiterParam.Output,
    name: 'Output',
    unit: Unit.Decibels,
    min: -20,
    max: 40,
    def: 0,
    taper: Taper.Linear,
    smoothingMs: 30,
  }),
  defineParam({
    id: FetLimiterParam.Attack,
    name: 'Attack',
    unit: Unit.Linear,
    min: 1,
    max: 7,
    def: 7,
    taper: Taper.Linear,
    smoothingMs: 20,
  }),
  defineParam({
    id: FetLimiterParam.Release,
    name: 'Release',
    unit: Unit.Linear,
    min: 1,
    max: 7,
    def: 4,
    taper: Taper.Linear,
    smoothingMs: 20,
  }),
  defineParam({
    id: FetLimiterParam.Ratio,
    name: 'Ratio',
    unit: Unit.Choice,
    min: 0,
    max: 4,
    def: 0,
    taper: Taper.Stepped,
    steps: 5,
    choices: ['4:1', '8:1', '12:1', '20:1', 'All In'],
    smoothingMs: 0,
  }),
  defineParam({
    id: FetLimiterParam.Limiting,
    name: 'Limiting',
    unit: Unit.Choice,
    min: 0,
    max: 1,
    def: 1,
    taper: Taper.Stepped,
    steps: 2,
    choices: ['Off', 'On'],
    smoothingMs: 0,
  }),
  defineParam({
    id: FetLimiterParam.Variance,
    name: 'Variance',
    unit: Unit.Percent,
    min: 0,
    max: 1,
    def: 0,
    taper: Taper.Linear,
    smoothingMs: 30,
  }),
  defineParam({
    id: FetLimiterParam.Oversampling,
    name: 'Oversampling',
    unit: Unit.Choice,
    min: 0,
    max: 3,
    def: 3,
    taper: Taper.Stepped,
    steps: 4,
    choices: ['Off', '2x', '4x', '8x'],
    smoothingMs: 0,
  }),
  defineParam({
    id: FetLimiterParam.Noise,
    name: 'Noise',
    unit: Unit.Percent,
    min: 0,
    max: 1,
    def: 1,
    taper: Taper.Linear,
    smoothingMs: 30,
  }),
];

/**
 * What each parameter needs on the panel: which control, and what a screen
 * reader calls it. Not how it looks — colour and geometry are the face's, and
 * belong with the rest of the design language rather than in a generated file.
 *
 * `paramId` is a real id by construction. That is the half of D1 this file
 * exists to make unconstructible.
 */
export const fetLimiterControls = [
  {
    id: 'input',
    role: 'knob',
    paramId: FetLimiterParam.Input,
    accessibleName: 'Input',
  },
  {
    id: 'output',
    role: 'knob',
    paramId: FetLimiterParam.Output,
    accessibleName: 'Output',
  },
  {
    id: 'attack',
    role: 'knob',
    paramId: FetLimiterParam.Attack,
    accessibleName: 'Attack',
  },
  {
    id: 'release',
    role: 'knob',
    paramId: FetLimiterParam.Release,
    accessibleName: 'Release',
  },
  {
    id: 'ratio',
    role: 'switch',
    paramId: FetLimiterParam.Ratio,
    accessibleName: 'Ratio buttons',
  },
  {
    id: 'limiting',
    role: 'switch',
    paramId: FetLimiterParam.Limiting,
    accessibleName: 'Limiting in or out',
  },
  {
    id: 'variance',
    role: 'knob',
    paramId: FetLimiterParam.Variance,
    accessibleName: 'Unit variance',
  },
  {
    id: 'oversampling',
    role: 'switch',
    paramId: FetLimiterParam.Oversampling,
    accessibleName: 'Oversampling factor',
  },
  {
    id: 'noise',
    role: 'knob',
    paramId: FetLimiterParam.Noise,
    accessibleName: 'Noise floor',
  },
] as const;
