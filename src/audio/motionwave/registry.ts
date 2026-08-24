/**
 * Which Motion Wave units the host can insert, and what it needs to know.
 *
 * **This is the whole list, and it is derived rather than written.** ADR-0007's
 * boundary says one adapter driven by the manifests serves all fourteen units,
 * and that a `switch` on unit id inside `src/` is the failure that turns a
 * portable unit into a MotionLab unit one branch at a time. So the only thing
 * enumerated here is which units exist and what the host calls them; every
 * property that follows from a unit — its parameters, their ranges and tapers,
 * its face, its meters, its declared latency — is read from the unit's own
 * declaration, which is generated from the same manifest the C++ dispatch is.
 *
 * The import direction is deliberate and one-way: `src/` reads `motionwave/`,
 * never the reverse. A Motion Wave file that imported a MotionLab type would
 * make the units unusable in the native shell ADR-0001 still intends, and the
 * rule is checkable by grep rather than by intention — `npm run mw-boundary`.
 */
import { consoleEqUnit } from '../../../motionwave/ui/units/console_eq/unit';
import { fetLimiterUnit } from '../../../motionwave/ui/units/fet_limiter/unit';
import { granularReverbUnit } from '../../../motionwave/ui/units/granular_reverb/unit';
import { motionShaperUnit } from '../../../motionwave/ui/units/motion_shaper/unit';
import { opticalLevellerUnit } from '../../../motionwave/ui/units/optical_leveller/unit';
import { programEqUnit } from '../../../motionwave/ui/units/program_eq/unit';
import { variableMuUnit } from '../../../motionwave/ui/units/variable_mu/unit';
import type { UnitUnderTest } from '../../../motionwave/ui/harness/types';
import type { MotionWaveKind } from '../../model/types';

/**
 * The prefix the WASM bridge exports each unit's functions under.
 *
 * The one thing that genuinely cannot be derived: it is a C symbol prefix
 * chosen in `motionwave/wasm/bridge.cpp`, and nothing in the TypeScript
 * declaration knows it. Kept beside the unit rather than in the worklet so that
 * adding a unit is one row in one place.
 */
export interface MotionWaveUnitEntry {
  /** The `kind` an `Effect` carries, and the id the picker shows. */
  kind: MotionWaveKind;
  /** Ledger unit id, e.g. `fx-01`. What the worklet is told to instantiate. */
  unitId: string;
  /** What a user sees in the insert picker. */
  label: string;
  /** One line under the name, so the list is choosable without documentation. */
  blurb: string;
  unit: UnitUnderTest;
}

/**
 * Prefixed `mw-` so a Motion Wave insert is distinguishable from the
 * twenty-seven Web Audio devices at a glance, in a project file as well as in
 * the picker. A user reading a `.json` project should be able to tell which
 * engine rendered a track.
 */
export const MOTIONWAVE_UNITS: readonly MotionWaveUnitEntry[] = [
  {
    kind: 'mw-motion-shaper',
    unitId: 'fx-01',
    label: 'Motion Shaper',
    blurb: 'Three-band rhythmic modulation, drawn as a shape',
    unit: motionShaperUnit,
  },
  {
    kind: 'mw-program-eq',
    unitId: 'dyn-01',
    label: 'Program EQ',
    blurb: 'Passive programme equaliser; the low bands interact by design',
    unit: programEqUnit,
  },
  {
    kind: 'mw-optical-leveller',
    unitId: 'dyn-02',
    label: 'Optical Leveller',
    blurb: 'Photocell levelling amplifier, two-stage release',
    unit: opticalLevellerUnit,
  },
  {
    kind: 'mw-fet-limiter',
    unitId: 'dyn-03',
    label: 'FET Limiter',
    blurb: 'Fast peak limiter with the all-buttons mode',
    unit: fetLimiterUnit,
  },
  {
    kind: 'mw-variable-mu',
    unitId: 'dyn-04',
    label: 'Variable-Mu Limiter',
    blurb: 'Valve gain-reduction limiter, lateral/vertical matrix',
    unit: variableMuUnit,
  },
  {
    kind: 'mw-console-eq',
    unitId: 'dyn-05',
    label: 'Console EQ',
    blurb: 'Two console lineages: inductor and bridged-T',
    unit: consoleEqUnit,
  },
  {
    kind: 'mw-granular-reverb',
    unitId: 'fx-02',
    label: 'Granular Reverb',
    blurb: 'Grain-cloud reverb with shimmer and freeze',
    unit: granularReverbUnit,
  },
];

const byKind = new Map<string, MotionWaveUnitEntry>(
  MOTIONWAVE_UNITS.map((entry) => [entry.kind, entry]),
);

export function motionWaveUnitFor(kind: string): MotionWaveUnitEntry | undefined {
  return byKind.get(kind);
}

/**
 * A type predicate, deliberately.
 *
 * Returning a plain boolean would leave every exhaustive switch over
 * `EffectKind` still demanding a case per unit, which is the special-casing
 * ADR-0007 forbids. As a predicate it narrows the union away in one branch, so
 * a host switch handles the whole group once and the compiler still refuses to
 * let a *Web Audio* kind go unhandled.
 */
export function isMotionWaveKind(kind: string): kind is MotionWaveKind {
  return byKind.has(kind);
}
