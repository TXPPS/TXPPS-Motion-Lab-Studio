/**
 * Motion Wave — the runner that turns a unit into twenty-three ledger cells.
 *
 * This is the file `docs/UNIT_LEDGER.md` is filled in from. Its whole job is to
 * make the three outcomes distinguishable and to keep the fourth from
 * happening: a cell either ran and passed, ran and failed, could not run and
 * says which capability was missing, or does not apply to this kind of unit.
 * There is no path through this function that returns nothing, and none that
 * skips a cell quietly — a cell that is not reached is a bug in this file, not
 * a blank in the ledger.
 */

import type { CellDefinition, CellId, CellOutcome } from './cells';
import { CELLS } from './cells';
import { HostCapabilities, probeHost } from './capability';
import {
  cellAutomationNoZipper,
  cellControlsWired,
  cellParamFuzz,
  cellPresetRoundTrip,
  cellRangesAndTapers,
  cellSheetVerification,
  cellTempoMap,
} from './cells_params';
import {
  cellAliasRejection,
  cellBufferSizes,
  cellBypassNull,
  cellLatencyMatchesPdc,
  cellSampleRates,
} from './cells_signal';
import {
  cellMpe,
  cellPanicClears,
  cellPolyphonyAndStealing,
  cellPresetsAudition,
  cellStuckNoteFuzz,
  cellTuning,
} from './cells_voices';
import {
  cellOriginalArtwork,
  cellRealEngineState,
  cellResponsive,
  cellSixtyFpsDecoupled,
  cellThemesAndAccessibility,
  type UiCellOptions,
} from './cells_ui';
import type { CellStatus, UnitUnderTest } from './types';

export interface CellResult {
  readonly cell: CellId;
  readonly title: string;
  readonly status: CellStatus;
  /** One line. For `BLOCKED` it names the capability and what would supply it. */
  readonly detail: string;
  /**
   * The executable check behind the result. The ledger's rule is that every
   * `PASS` is backed by a named test and a `PASS` with no test is a `FAIL`, so
   * the name travels with the result rather than being written down separately
   * and going stale.
   */
  readonly test: string;
}

export interface VerifyOptions extends UiCellOptions {
  /** Defaults to probing the current host. Supplied explicitly by tests. */
  readonly host?: HostCapabilities;
}

type CellRunner = (unit: UnitUnderTest, options: VerifyOptions) => CellOutcome;

const RUNNERS: Readonly<Record<CellId, CellRunner>> = {
  D1: (unit) => cellControlsWired(unit),
  D2: (unit) => cellRangesAndTapers(unit),
  D3: (unit) => cellSheetVerification(unit),
  D4: (unit) => cellBypassNull(unit),
  D5: (unit) => cellAliasRejection(unit),
  D6: (unit) => cellSampleRates(unit),
  D7: (unit) => cellBufferSizes(unit),
  D8: (unit) => cellLatencyMatchesPdc(unit),
  D9: (unit) => cellParamFuzz(unit),
  D10: (unit) => cellAutomationNoZipper(unit),
  D11: (unit) => cellPresetRoundTrip(unit),
  D12: (unit) => cellTempoMap(unit),
  I13: (unit) => cellPolyphonyAndStealing(unit),
  I14: (unit) => cellStuckNoteFuzz(unit),
  I15: (unit) => cellPanicClears(unit),
  I16: (unit) => cellMpe(unit),
  I17: (unit) => cellPresetsAudition(unit),
  I18: (unit) => cellTuning(unit),
  U19: (unit, options) => cellOriginalArtwork(unit, options),
  U20: (unit) => cellRealEngineState(unit),
  U21: (unit) => cellSixtyFpsDecoupled(unit),
  U22: (unit) => cellResponsive(unit),
  U23: (unit, options) => cellThemesAndAccessibility(unit, options),
};

/** The name that goes in the ledger beside a result. */
export function testNameFor(unit: UnitUnderTest, cell: CellId): string {
  return `verifyUnit(${unit.id})/${cell}`;
}

/**
 * What is missing before a cell can even be attempted.
 *
 * A missing *capability* is BLOCKED: the host cannot do it and no amount of
 * work on the unit changes that. A missing *declaration* is the unit's own gap
 * and is FAIL — except for the two features a unit may legitimately not have,
 * where the honest answer is `n/a` and a `PASS` would be a tick beside work
 * that was never needed.
 */
function unrunnable(
  definition: CellDefinition,
  unit: UnitUnderTest,
  host: HostCapabilities,
): { status: CellStatus; detail: string } | null {
  if (definition.appliesTo === 'instrument' && unit.kind !== 'instrument') {
    return { status: 'n/a', detail: 'the unit is an effect and has no voices' };
  }
  const missing = host.firstMissing(definition.requires);
  if (missing !== null) {
    return { status: 'BLOCKED', detail: host.reasonFor(missing) };
  }
  for (const need of definition.needs) {
    switch (need) {
      case 'renderer':
        if (unit.renderer === undefined) {
          const blockedBy = unit.rendererBlockedBy ?? 'wasmCore';
          return {
            status: 'BLOCKED',
            detail: `the unit's DSP cannot run here — ${host.reasonFor(blockedBy)}`,
          };
        }
        break;
      case 'voices':
        if (unit.voices === undefined) {
          return { status: 'FAIL', detail: 'the unit is an instrument and declares no voice control' };
        }
        break;
      case 'face':
        if (unit.face === undefined) {
          return { status: 'FAIL', detail: 'the unit declares no face' };
        }
        break;
      case 'sheet':
        if ((unit.sheetTargets ?? []).length === 0) {
          return { status: 'FAIL', detail: 'the unit declares no measurable claims from its sheet' };
        }
        break;
      case 'oversampling':
        if (unit.oversampling === undefined) {
          return { status: 'n/a', detail: 'the unit declares no oversampling' };
        }
        break;
      case 'tempoSync':
        if ((unit.tempoSyncedParams ?? []).length === 0) {
          return { status: 'n/a', detail: 'the unit declares no tempo-synced parameter' };
        }
        break;
    }
  }
  return null;
}

/** Runs every cell for a unit and returns one result per cell, in ledger order. */
export function verifyUnit(unit: UnitUnderTest, options: VerifyOptions = {}): CellResult[] {
  const host = options.host ?? probeHost();
  return CELLS.map((definition) => {
    const test = testNameFor(unit, definition.id);
    const blocked = unrunnable(definition, unit, host);
    if (blocked !== null) {
      return { cell: definition.id, title: definition.title, ...blocked, test };
    }
    try {
      const outcome = RUNNERS[definition.id](unit, options);
      return {
        cell: definition.id,
        title: definition.title,
        status: outcome.status,
        detail: outcome.detail,
        test,
      };
    } catch (error) {
      // A check that throws is a check that failed, never a check that was
      // skipped. Losing the exception here would turn a broken cell into a
      // blank in the ledger, which is the one outcome the ledger forbids.
      return {
        cell: definition.id,
        title: definition.title,
        status: 'FAIL' as const,
        detail: `the check threw: ${(error as Error).message}`,
        test,
      };
    }
  });
}

/** True when every applicable cell reads `PASS`, which is what `SHIPPING` means. */
export function isShipping(results: readonly CellResult[]): boolean {
  return results.every((result) => result.status === 'PASS' || result.status === 'n/a');
}
