// GENERATED FILE — do not edit.
//
// Written by scripts/generate-params.mjs from motionwave/manifests/dyn-02-optical-leveller.json.
// Edit the manifest and re-run `npm run params`. A hand edit here is exactly
// the second opinion the manifest exists to prevent, and `npm run params:check`
// fails the build if one is present.
import { defineParam } from '../../param/spec';
import type { ParamSpec } from '../../param/spec';
import { Taper, Unit } from '../../param/units';

/** Parameter ids, the same numbers the C++ enum carries. */
export const OpticalLevellerParam = {
  PeakReduction: 1,
  Gain: 2,
  Mode: 3,
  Emphasis: 4,
  Wear: 5,
  Input: 6,
  Variance: 7,
  Oversampling: 8,
  Noise: 9,
} as const;

export type OpticalLevellerParamId =
  (typeof OpticalLevellerParam)[keyof typeof OpticalLevellerParam];

/**
 * Every range, default and taper, straight from the manifest — which took them
 * from the Reference Spec Sheet. A control that sweeps a different range than
 * its sheet fails the unit's acceptance test on a number nobody checks by ear.
 */
export const opticalLevellerSpecs: readonly ParamSpec[] = [
  defineParam({
    id: OpticalLevellerParam.PeakReduction,
    name: 'Peak Reduction',
    unit: Unit.Percent,
    min: 0,
    max: 1,
    def: 0,
    taper: Taper.Linear,
    smoothingMs: 30,
  }),
  defineParam({
    id: OpticalLevellerParam.Gain,
    name: 'Gain',
    unit: Unit.Decibels,
    min: -20,
    max: 40,
    def: 0,
    taper: Taper.Linear,
    smoothingMs: 30,
  }),
  defineParam({
    id: OpticalLevellerParam.Mode,
    name: 'Mode',
    unit: Unit.Choice,
    min: 0,
    max: 1,
    def: 0,
    taper: Taper.Stepped,
    steps: 2,
    choices: ['Compress', 'Limit'],
    smoothingMs: 0,
  }),
  defineParam({
    id: OpticalLevellerParam.Emphasis,
    name: 'Emphasis',
    unit: Unit.Percent,
    min: 0,
    max: 1,
    def: 0,
    taper: Taper.Linear,
    smoothingMs: 30,
  }),
  defineParam({
    id: OpticalLevellerParam.Wear,
    name: 'Cell Wear',
    unit: Unit.Percent,
    min: 0,
    max: 1,
    def: 0,
    taper: Taper.Linear,
    smoothingMs: 30,
  }),
  defineParam({
    id: OpticalLevellerParam.Input,
    name: 'Input',
    unit: Unit.Decibels,
    min: -20,
    max: 20,
    def: 0,
    taper: Taper.Linear,
    smoothingMs: 30,
  }),
  defineParam({
    id: OpticalLevellerParam.Variance,
    name: 'Variance',
    unit: Unit.Percent,
    min: 0,
    max: 1,
    def: 0,
    taper: Taper.Linear,
    smoothingMs: 30,
  }),
  defineParam({
    id: OpticalLevellerParam.Oversampling,
    name: 'Oversampling',
    unit: Unit.Choice,
    min: 0,
    max: 3,
    def: 2,
    taper: Taper.Stepped,
    steps: 4,
    choices: ['Off', '2x', '4x', '8x'],
    smoothingMs: 0,
  }),
  defineParam({
    id: OpticalLevellerParam.Noise,
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
export const opticalLevellerControls = [
  {
    id: 'peak-reduction',
    role: 'knob',
    paramId: OpticalLevellerParam.PeakReduction,
    accessibleName: 'Peak reduction',
  },
  {
    id: 'gain',
    role: 'knob',
    paramId: OpticalLevellerParam.Gain,
    accessibleName: 'Make-up gain',
  },
  {
    id: 'mode',
    role: 'switch',
    paramId: OpticalLevellerParam.Mode,
    accessibleName: 'Compress or limit',
  },
  {
    id: 'emphasis',
    role: 'knob',
    paramId: OpticalLevellerParam.Emphasis,
    accessibleName: 'Sidechain pre-emphasis',
  },
  {
    id: 'wear',
    role: 'knob',
    paramId: OpticalLevellerParam.Wear,
    accessibleName: 'Cell wear',
  },
  {
    id: 'input',
    role: 'knob',
    paramId: OpticalLevellerParam.Input,
    accessibleName: 'Input trim',
  },
  {
    id: 'variance',
    role: 'knob',
    paramId: OpticalLevellerParam.Variance,
    accessibleName: 'Unit variance',
  },
  {
    id: 'oversampling',
    role: 'switch',
    paramId: OpticalLevellerParam.Oversampling,
    accessibleName: 'Oversampling factor',
  },
  {
    id: 'noise',
    role: 'knob',
    paramId: OpticalLevellerParam.Noise,
    accessibleName: 'Noise floor',
  },
] as const;
