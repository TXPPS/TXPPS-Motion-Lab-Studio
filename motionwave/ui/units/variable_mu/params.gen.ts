// GENERATED FILE — do not edit.
//
// Written by scripts/generate-params.mjs from motionwave/manifests/dyn-04-variable-mu.json.
// Edit the manifest and re-run `npm run params`. A hand edit here is exactly
// the second opinion the manifest exists to prevent, and `npm run params:check`
// fails the build if one is present.
import { defineParam } from '../../param/spec';
import type { ParamSpec } from '../../param/spec';
import { Taper, Unit } from '../../param/units';

/** Parameter ids, the same numbers the C++ enum carries. */
export const VariableMuParam = {
  InputA: 1,
  InputB: 2,
  ThresholdA: 3,
  ThresholdB: 4,
  TimeConstantA: 5,
  TimeConstantB: 6,
  DcThresholdA: 7,
  DcThresholdB: 8,
  Mode: 9,
  Oversampling: 10,
} as const;

export type VariableMuParamId = (typeof VariableMuParam)[keyof typeof VariableMuParam];

/**
 * Every range, default and taper, straight from the manifest — which took them
 * from the Reference Spec Sheet. A control that sweeps a different range than
 * its sheet fails the unit's acceptance test on a number nobody checks by ear.
 */
export const variableMuSpecs: readonly ParamSpec[] = [
  defineParam({
    id: VariableMuParam.InputA,
    name: 'Input A',
    unit: Unit.Decibels,
    min: 0,
    max: 20,
    def: 0,
    taper: Taper.Linear,
    steps: 21,
    smoothingMs: 20,
  }),
  defineParam({
    id: VariableMuParam.InputB,
    name: 'Input B',
    unit: Unit.Decibels,
    min: 0,
    max: 20,
    def: 0,
    taper: Taper.Linear,
    steps: 21,
    smoothingMs: 20,
  }),
  defineParam({
    id: VariableMuParam.ThresholdA,
    name: 'Threshold A',
    unit: Unit.Linear,
    min: 0,
    max: 10,
    def: 10,
    taper: Taper.Linear,
    smoothingMs: 30,
  }),
  defineParam({
    id: VariableMuParam.ThresholdB,
    name: 'Threshold B',
    unit: Unit.Linear,
    min: 0,
    max: 10,
    def: 10,
    taper: Taper.Linear,
    smoothingMs: 30,
  }),
  defineParam({
    id: VariableMuParam.TimeConstantA,
    name: 'Time Constant A',
    unit: Unit.Choice,
    min: 0,
    max: 5,
    def: 3,
    taper: Taper.Stepped,
    steps: 6,
    choices: ['1', '2', '3', '4', '5', '6'],
    smoothingMs: 0,
  }),
  defineParam({
    id: VariableMuParam.TimeConstantB,
    name: 'Time Constant B',
    unit: Unit.Choice,
    min: 0,
    max: 5,
    def: 3,
    taper: Taper.Stepped,
    steps: 6,
    choices: ['1', '2', '3', '4', '5', '6'],
    smoothingMs: 0,
  }),
  defineParam({
    id: VariableMuParam.DcThresholdA,
    name: 'DC Threshold A',
    unit: Unit.Percent,
    min: 0,
    max: 1,
    def: 0.5,
    taper: Taper.Linear,
    smoothingMs: 30,
  }),
  defineParam({
    id: VariableMuParam.DcThresholdB,
    name: 'DC Threshold B',
    unit: Unit.Percent,
    min: 0,
    max: 1,
    def: 0.5,
    taper: Taper.Linear,
    smoothingMs: 30,
  }),
  defineParam({
    id: VariableMuParam.Mode,
    name: 'Mode',
    unit: Unit.Choice,
    min: 0,
    max: 1,
    def: 0,
    taper: Taper.Stepped,
    steps: 2,
    choices: ['Left / Right', 'Lateral / Vertical'],
    smoothingMs: 0,
  }),
  defineParam({
    id: VariableMuParam.Oversampling,
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
];

/**
 * What each parameter needs on the panel: which control, and what a screen
 * reader calls it. Not how it looks — colour and geometry are the face's, and
 * belong with the rest of the design language rather than in a generated file.
 *
 * `paramId` is a real id by construction. That is the half of D1 this file
 * exists to make unconstructible.
 */
export const variableMuControls = [
  {
    id: 'input-a',
    role: 'knob',
    paramId: VariableMuParam.InputA,
    accessibleName: 'Left / Lateral input attenuation',
  },
  {
    id: 'input-b',
    role: 'knob',
    paramId: VariableMuParam.InputB,
    accessibleName: 'Right / Vertical input attenuation',
  },
  {
    id: 'threshold-a',
    role: 'knob',
    paramId: VariableMuParam.ThresholdA,
    accessibleName: 'Left / Lateral threshold, ten is no compression',
  },
  {
    id: 'threshold-b',
    role: 'knob',
    paramId: VariableMuParam.ThresholdB,
    accessibleName: 'Right / Vertical threshold, ten is no compression',
  },
  {
    id: 'time-constant-a',
    role: 'switch',
    paramId: VariableMuParam.TimeConstantA,
    accessibleName: 'Left / Lateral time constant',
  },
  {
    id: 'time-constant-b',
    role: 'switch',
    paramId: VariableMuParam.TimeConstantB,
    accessibleName: 'Right / Vertical time constant',
  },
  {
    id: 'dc-threshold-a',
    role: 'knob',
    paramId: VariableMuParam.DcThresholdA,
    accessibleName: 'Left / Lateral DC threshold trim',
  },
  {
    id: 'dc-threshold-b',
    role: 'knob',
    paramId: VariableMuParam.DcThresholdB,
    accessibleName: 'Right / Vertical DC threshold trim',
  },
  {
    id: 'mode',
    role: 'switch',
    paramId: VariableMuParam.Mode,
    accessibleName: 'Left/right or lateral/vertical',
  },
  {
    id: 'oversampling',
    role: 'switch',
    paramId: VariableMuParam.Oversampling,
    accessibleName: 'Oversampling tier',
  },
] as const;
