// GENERATED FILE — do not edit.
//
// Written by scripts/generate-params.mjs from motionwave/manifests/fx-01-motion-shaper.json.
// Edit the manifest and re-run `npm run params`. A hand edit here is exactly
// the second opinion the manifest exists to prevent, and `npm run params:check`
// fails the build if one is present.
import { defineParam } from '../../param/spec';
import type { ParamSpec } from '../../param/spec';
import { Taper, Unit } from '../../param/units';

/** Parameter ids, the same numbers the C++ enum carries. */
export const MotionShaperParam = {
  BandCount: 1,
  CrossoverLowMid: 2,
  CrossoverMidHigh: 3,
  Slope: 4,
  Smooth: 5,
  Mix: 6,
  DepthLow: 7,
  DepthMid: 8,
  DepthHigh: 9,
  RangeLow: 10,
  RangeMid: 11,
  RangeHigh: 12,
  Rate: 13,
  Swing: 14,
  PhaseOffset: 15,
  SyncMode: 16,
} as const;

export type MotionShaperParamId = (typeof MotionShaperParam)[keyof typeof MotionShaperParam];

/**
 * Every range, default and taper, straight from the manifest — which took them
 * from the Reference Spec Sheet. A control that sweeps a different range than
 * its sheet fails the unit's acceptance test on a number nobody checks by ear.
 */
export const motionShaperSpecs: readonly ParamSpec[] = [
  defineParam({
    id: MotionShaperParam.BandCount,
    name: 'Bands',
    unit: Unit.Choice,
    min: 0,
    max: 2,
    def: 2,
    taper: Taper.Stepped,
    steps: 3,
    choices: ['One', 'Two', 'Three'],
    smoothingMs: 0,
  }),
  defineParam({
    id: MotionShaperParam.CrossoverLowMid,
    name: 'Low / Mid',
    unit: Unit.Hertz,
    min: 30,
    max: 2000,
    def: 220,
    taper: Taper.Logarithmic,
    smoothingMs: 20,
  }),
  defineParam({
    id: MotionShaperParam.CrossoverMidHigh,
    name: 'Mid / High',
    unit: Unit.Hertz,
    min: 500,
    max: 16000,
    def: 3200,
    taper: Taper.Logarithmic,
    smoothingMs: 20,
  }),
  defineParam({
    id: MotionShaperParam.Slope,
    name: 'Slope',
    unit: Unit.Choice,
    min: 0,
    max: 2,
    def: 2,
    taper: Taper.Stepped,
    steps: 3,
    choices: ['6 dB/oct', '12 dB/oct', '24 dB/oct'],
    smoothingMs: 0,
  }),
  defineParam({
    id: MotionShaperParam.Smooth,
    name: 'Smooth',
    unit: Unit.Percent,
    min: 0,
    max: 1,
    def: 0,
    taper: Taper.Linear,
    smoothingMs: 30,
  }),
  defineParam({
    id: MotionShaperParam.Mix,
    name: 'Mix',
    unit: Unit.Percent,
    min: 0,
    max: 1,
    def: 1,
    taper: Taper.Linear,
    smoothingMs: 30,
  }),
  defineParam({
    id: MotionShaperParam.DepthLow,
    name: 'Low Depth',
    unit: Unit.Percent,
    min: 0,
    max: 1,
    def: 1,
    taper: Taper.Linear,
    smoothingMs: 30,
  }),
  defineParam({
    id: MotionShaperParam.DepthMid,
    name: 'Mid Depth',
    unit: Unit.Percent,
    min: 0,
    max: 1,
    def: 1,
    taper: Taper.Linear,
    smoothingMs: 30,
  }),
  defineParam({
    id: MotionShaperParam.DepthHigh,
    name: 'High Depth',
    unit: Unit.Percent,
    min: 0,
    max: 1,
    def: 1,
    taper: Taper.Linear,
    smoothingMs: 30,
  }),
  defineParam({
    id: MotionShaperParam.RangeLow,
    name: 'Low Range',
    unit: Unit.Decibels,
    min: -90,
    max: 0,
    def: -60,
    taper: Taper.Linear,
    smoothingMs: 30,
  }),
  defineParam({
    id: MotionShaperParam.RangeMid,
    name: 'Mid Range',
    unit: Unit.Decibels,
    min: -90,
    max: 0,
    def: -60,
    taper: Taper.Linear,
    smoothingMs: 30,
  }),
  defineParam({
    id: MotionShaperParam.RangeHigh,
    name: 'High Range',
    unit: Unit.Decibels,
    min: -90,
    max: 0,
    def: -60,
    taper: Taper.Linear,
    smoothingMs: 30,
  }),
  defineParam({
    id: MotionShaperParam.Rate,
    name: 'Rate',
    unit: Unit.Hertz,
    min: 0.05,
    max: 200,
    def: 2,
    taper: Taper.Logarithmic,
    smoothingMs: 20,
  }),
  defineParam({
    id: MotionShaperParam.Swing,
    name: 'Swing',
    unit: Unit.Percent,
    min: 0,
    max: 1,
    def: 0,
    taper: Taper.Linear,
    smoothingMs: 20,
  }),
  defineParam({
    id: MotionShaperParam.PhaseOffset,
    name: 'Offset',
    unit: Unit.Linear,
    min: 0,
    max: 360,
    def: 0,
    taper: Taper.Linear,
    smoothingMs: 20,
  }),
  defineParam({
    id: MotionShaperParam.SyncMode,
    name: 'Sync',
    unit: Unit.Choice,
    min: 0,
    max: 2,
    def: 0,
    taper: Taper.Stepped,
    steps: 3,
    choices: ['Host', 'Free', 'Trigger'],
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
export const motionShaperControls = [
  {
    id: 'band-count',
    role: 'switch',
    paramId: MotionShaperParam.BandCount,
    accessibleName: 'Number of bands',
  },
  {
    id: 'crossover-low-mid',
    role: 'knob',
    paramId: MotionShaperParam.CrossoverLowMid,
    accessibleName: 'Low to mid crossover',
  },
  {
    id: 'crossover-mid-high',
    role: 'knob',
    paramId: MotionShaperParam.CrossoverMidHigh,
    accessibleName: 'Mid to high crossover',
  },
  {
    id: 'slope',
    role: 'switch',
    paramId: MotionShaperParam.Slope,
    accessibleName: 'Crossover slope',
  },
  {
    id: 'smooth',
    role: 'knob',
    paramId: MotionShaperParam.Smooth,
    accessibleName: 'Smoothing',
  },
  {
    id: 'mix',
    role: 'knob',
    paramId: MotionShaperParam.Mix,
    accessibleName: 'Wet and dry mix',
  },
  {
    id: 'depth-low',
    role: 'knob',
    paramId: MotionShaperParam.DepthLow,
    accessibleName: 'Low band depth',
  },
  {
    id: 'depth-mid',
    role: 'knob',
    paramId: MotionShaperParam.DepthMid,
    accessibleName: 'Mid band depth',
  },
  {
    id: 'depth-high',
    role: 'knob',
    paramId: MotionShaperParam.DepthHigh,
    accessibleName: 'High band depth',
  },
  {
    id: 'range-low',
    role: 'knob',
    paramId: MotionShaperParam.RangeLow,
    accessibleName: 'Low band range',
  },
  {
    id: 'range-mid',
    role: 'knob',
    paramId: MotionShaperParam.RangeMid,
    accessibleName: 'Mid band range',
  },
  {
    id: 'range-high',
    role: 'knob',
    paramId: MotionShaperParam.RangeHigh,
    accessibleName: 'High band range',
  },
  {
    id: 'rate',
    role: 'knob',
    paramId: MotionShaperParam.Rate,
    accessibleName: 'Modulation rate',
  },
  {
    id: 'swing',
    role: 'knob',
    paramId: MotionShaperParam.Swing,
    accessibleName: 'Swing',
  },
  {
    id: 'phase-offset',
    role: 'knob',
    paramId: MotionShaperParam.PhaseOffset,
    accessibleName: 'Phase offset',
  },
  {
    id: 'sync-mode',
    role: 'switch',
    paramId: MotionShaperParam.SyncMode,
    accessibleName: 'Sync mode',
  },
] as const;
