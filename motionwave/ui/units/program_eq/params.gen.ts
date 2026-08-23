// GENERATED FILE — do not edit.
//
// Written by scripts/generate-params.mjs from motionwave/manifests/dyn-01-program-eq.json.
// Edit the manifest and re-run `npm run params`. A hand edit here is exactly
// the second opinion the manifest exists to prevent, and `npm run params:check`
// fails the build if one is present.
import { defineParam } from '../../param/spec';
import type { ParamSpec } from '../../param/spec';
import { Taper, Unit } from '../../param/units';

/** Parameter ids, the same numbers the C++ enum carries. */
export const ProgramEqParam = {
  LowFreq: 1,
  LowBoost: 2,
  LowAtten: 3,
  HighFreq: 4,
  HighBoost: 5,
  Bandwidth: 6,
  AttenSel: 7,
  HighAtten: 8,
  EqIn: 9,
  Input: 10,
  Output: 11,
  Variance: 12,
  Oversampling: 13,
  Noise: 14,
} as const;

export type ProgramEqParamId = (typeof ProgramEqParam)[keyof typeof ProgramEqParam];

/**
 * Every range, default and taper, straight from the manifest — which took them
 * from the Reference Spec Sheet. A control that sweeps a different range than
 * its sheet fails the unit's acceptance test on a number nobody checks by ear.
 */
export const programEqSpecs: readonly ParamSpec[] = [
  defineParam({
    id: ProgramEqParam.LowFreq,
    name: 'Low Frequency',
    unit: Unit.Choice,
    min: 0,
    max: 3,
    def: 2,
    taper: Taper.Stepped,
    steps: 4,
    choices: ['20 Hz', '30 Hz', '60 Hz', '100 Hz'],
    smoothingMs: 0,
  }),
  defineParam({
    id: ProgramEqParam.LowBoost,
    name: 'Low Boost',
    unit: Unit.Percent,
    min: 0,
    max: 1,
    def: 0,
    taper: Taper.Linear,
    smoothingMs: 30,
  }),
  defineParam({
    id: ProgramEqParam.LowAtten,
    name: 'Low Atten',
    unit: Unit.Percent,
    min: 0,
    max: 1,
    def: 0,
    taper: Taper.Linear,
    smoothingMs: 30,
  }),
  defineParam({
    id: ProgramEqParam.HighFreq,
    name: 'High Frequency',
    unit: Unit.Choice,
    min: 0,
    max: 6,
    def: 4,
    taper: Taper.Stepped,
    steps: 7,
    choices: ['3 kHz', '4 kHz', '5 kHz', '8 kHz', '10 kHz', '12 kHz', '16 kHz'],
    smoothingMs: 0,
  }),
  defineParam({
    id: ProgramEqParam.HighBoost,
    name: 'High Boost',
    unit: Unit.Percent,
    min: 0,
    max: 1,
    def: 0,
    taper: Taper.Linear,
    smoothingMs: 30,
  }),
  defineParam({
    id: ProgramEqParam.Bandwidth,
    name: 'Bandwidth',
    unit: Unit.Percent,
    min: 0,
    max: 1,
    def: 0,
    taper: Taper.Linear,
    smoothingMs: 30,
  }),
  defineParam({
    id: ProgramEqParam.AttenSel,
    name: 'Atten Select',
    unit: Unit.Choice,
    min: 0,
    max: 2,
    def: 1,
    taper: Taper.Stepped,
    steps: 3,
    choices: ['5 kHz', '10 kHz', '20 kHz'],
    smoothingMs: 0,
  }),
  defineParam({
    id: ProgramEqParam.HighAtten,
    name: 'High Atten',
    unit: Unit.Percent,
    min: 0,
    max: 1,
    def: 0,
    taper: Taper.Linear,
    smoothingMs: 30,
  }),
  defineParam({
    id: ProgramEqParam.EqIn,
    name: 'EQ In',
    unit: Unit.Choice,
    min: 0,
    max: 1,
    def: 1,
    taper: Taper.Stepped,
    steps: 2,
    choices: ['Out', 'In'],
    smoothingMs: 0,
  }),
  defineParam({
    id: ProgramEqParam.Input,
    name: 'Input',
    unit: Unit.Decibels,
    min: -20,
    max: 20,
    def: 0,
    taper: Taper.Linear,
    smoothingMs: 30,
  }),
  defineParam({
    id: ProgramEqParam.Output,
    name: 'Output',
    unit: Unit.Decibels,
    min: -20,
    max: 20,
    def: 0,
    taper: Taper.Linear,
    smoothingMs: 30,
  }),
  defineParam({
    id: ProgramEqParam.Variance,
    name: 'Variance',
    unit: Unit.Percent,
    min: 0,
    max: 1,
    def: 0,
    taper: Taper.Linear,
    smoothingMs: 30,
  }),
  defineParam({
    id: ProgramEqParam.Oversampling,
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
    id: ProgramEqParam.Noise,
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
export const programEqControls = [
  {
    id: 'low-freq',
    role: 'switch',
    paramId: ProgramEqParam.LowFreq,
    accessibleName: 'Low frequency selector',
  },
  {
    id: 'low-boost',
    role: 'knob',
    paramId: ProgramEqParam.LowBoost,
    accessibleName: 'Low boost',
  },
  {
    id: 'low-atten',
    role: 'knob',
    paramId: ProgramEqParam.LowAtten,
    accessibleName: 'Low attenuation',
  },
  {
    id: 'high-freq',
    role: 'switch',
    paramId: ProgramEqParam.HighFreq,
    accessibleName: 'High frequency selector',
  },
  {
    id: 'high-boost',
    role: 'knob',
    paramId: ProgramEqParam.HighBoost,
    accessibleName: 'High boost',
  },
  {
    id: 'bandwidth',
    role: 'knob',
    paramId: ProgramEqParam.Bandwidth,
    accessibleName: 'Bandwidth, broad to sharp',
  },
  {
    id: 'atten-sel',
    role: 'switch',
    paramId: ProgramEqParam.AttenSel,
    accessibleName: 'High attenuation frequency',
  },
  {
    id: 'high-atten',
    role: 'knob',
    paramId: ProgramEqParam.HighAtten,
    accessibleName: 'High attenuation',
  },
  {
    id: 'eq-in',
    role: 'switch',
    paramId: ProgramEqParam.EqIn,
    accessibleName: 'Equaliser in or out',
  },
  {
    id: 'input',
    role: 'knob',
    paramId: ProgramEqParam.Input,
    accessibleName: 'Input trim',
  },
  {
    id: 'output',
    role: 'knob',
    paramId: ProgramEqParam.Output,
    accessibleName: 'Output trim',
  },
  {
    id: 'variance',
    role: 'knob',
    paramId: ProgramEqParam.Variance,
    accessibleName: 'Unit variance',
  },
  {
    id: 'oversampling',
    role: 'switch',
    paramId: ProgramEqParam.Oversampling,
    accessibleName: 'Oversampling factor',
  },
  {
    id: 'noise',
    role: 'knob',
    paramId: ProgramEqParam.Noise,
    accessibleName: 'Noise floor',
  },
] as const;
