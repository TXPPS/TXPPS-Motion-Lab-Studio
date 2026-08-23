/**
 * Motion Wave — the twenty-three Definition-of-Done cells, as a catalogue.
 *
 * The titles are `docs/UNIT_LEDGER.md`'s column definitions verbatim. They are
 * copied rather than paraphrased so that a cell's name in a harness report and
 * its name in the ledger are the same string, and a reader never has to work
 * out whether "bypass null" and "bypass null −120" are the same check.
 *
 * Each cell declares what it needs. That declaration is the whole mechanism by
 * which a result becomes `BLOCKED (reason)` rather than a silent skip: the
 * runner asks the host for the required capabilities, and the first one missing
 * is named in the result. A cell with an empty `requires` runs anywhere, which
 * is a claim this file is making on that cell's behalf and which its
 * implementation has to honour.
 */

import type { Capability } from './capability';

export type CellId =
  | 'D1'
  | 'D2'
  | 'D3'
  | 'D4'
  | 'D5'
  | 'D6'
  | 'D7'
  | 'D8'
  | 'D9'
  | 'D10'
  | 'D11'
  | 'D12'
  | 'I13'
  | 'I14'
  | 'I15'
  | 'I16'
  | 'I17'
  | 'I18'
  | 'U19'
  | 'U20'
  | 'U21'
  | 'U22'
  | 'U23';

/** What a unit must supply for a cell to be runnable at all. */
export type CellNeed = 'renderer' | 'voices' | 'face' | 'sheet' | 'oversampling' | 'tempoSync';

export interface CellDefinition {
  readonly id: CellId;
  readonly group: 'DSP' | 'Instruments' | 'UI';
  readonly title: string;
  /** `instrument` marks the cells the ledger writes `n/a` into for an effect. */
  readonly appliesTo: 'all' | 'instrument';
  readonly requires: readonly Capability[];
  readonly needs: readonly CellNeed[];
}

export const CELLS: readonly CellDefinition[] = [
  { id: 'D1', group: 'DSP', title: 'controls wired', appliesTo: 'all', requires: [], needs: ['renderer'] },
  { id: 'D2', group: 'DSP', title: 'ranges/tapers', appliesTo: 'all', requires: [], needs: [] },
  { id: 'D3', group: 'DSP', title: 'sheet verification', appliesTo: 'all', requires: [], needs: ['renderer', 'sheet'] },
  { id: 'D4', group: 'DSP', title: 'bypass null −120', appliesTo: 'all', requires: [], needs: ['renderer'] },
  { id: 'D5', group: 'DSP', title: 'oversampling + alias dBc', appliesTo: 'all', requires: [], needs: ['renderer', 'oversampling'] },
  { id: 'D6', group: 'DSP', title: 'rates 44.1–192', appliesTo: 'all', requires: [], needs: ['renderer'] },
  { id: 'D7', group: 'DSP', title: 'buffers 32–1024', appliesTo: 'all', requires: [], needs: ['renderer'] },
  { id: 'D8', group: 'DSP', title: 'latency = PDC', appliesTo: 'all', requires: [], needs: ['renderer'] },
  { id: 'D9', group: 'DSP', title: 'param fuzz', appliesTo: 'all', requires: [], needs: ['renderer'] },
  { id: 'D10', group: 'DSP', title: 'automation, no zipper', appliesTo: 'all', requires: [], needs: ['renderer'] },
  { id: 'D11', group: 'DSP', title: 'preset round-trip', appliesTo: 'all', requires: [], needs: [] },
  { id: 'D12', group: 'DSP', title: 'tempo map', appliesTo: 'all', requires: [], needs: ['renderer', 'tempoSync'] },
  { id: 'I13', group: 'Instruments', title: 'polyphony + stealing', appliesTo: 'instrument', requires: [], needs: ['renderer', 'voices'] },
  { id: 'I14', group: 'Instruments', title: 'stuck-note fuzz', appliesTo: 'instrument', requires: [], needs: ['voices'] },
  { id: 'I15', group: 'Instruments', title: 'panic clears', appliesTo: 'instrument', requires: [], needs: ['voices'] },
  { id: 'I16', group: 'Instruments', title: 'MPE', appliesTo: 'instrument', requires: [], needs: ['renderer', 'voices'] },
  { id: 'I17', group: 'Instruments', title: 'presets audition', appliesTo: 'instrument', requires: [], needs: ['renderer', 'voices'] },
  { id: 'I18', group: 'Instruments', title: 'tuning', appliesTo: 'instrument', requires: [], needs: ['renderer', 'voices'] },
  { id: 'U19', group: 'UI', title: 'original artwork', appliesTo: 'all', requires: [], needs: ['face'] },
  { id: 'U20', group: 'UI', title: 'real engine state', appliesTo: 'all', requires: [], needs: ['face'] },
  {
    id: 'U21',
    group: 'UI',
    title: '60 fps decoupled',
    appliesTo: 'all',
    // Frame pacing is a measurement of two clocks that do not exist here: a
    // display refresh to count frames against, and an audio thread to prove the
    // face is decoupled *from*. The framework's own metering tests prove the
    // decoupling property; what cannot be done here is watch it hold at rate.
    requires: ['displayRefresh', 'realtimeThread'],
    needs: ['face'],
  },
  {
    id: 'U22',
    group: 'UI',
    title: 'responsive',
    appliesTo: 'all',
    // A breakpoint is a claim about geometry, and geometry needs an engine that
    // computes it. jsdom answers zero for every box, so a check run against it
    // would pass on a face that is 0×0 at every width.
    requires: ['layoutEngine'],
    needs: ['face'],
  },
  { id: 'U23', group: 'UI', title: 'themes + a11y', appliesTo: 'all', requires: [], needs: ['face'] },
];

export const CELL_IDS: readonly CellId[] = CELLS.map((cell) => cell.id);

export function cellDefinition(id: CellId): CellDefinition {
  const found = CELLS.find((cell) => cell.id === id);
  if (found === undefined) throw new Error(`unknown ledger cell ${id}`);
  return found;
}

/**
 * What running a cell produced. `n/a` is a legitimate answer from inside a cell
 * as well as from the runner: a unit with nothing to oversample has no alias
 * figure, and reporting that as a pass would put a tick beside work nobody did.
 */
export interface CellOutcome {
  readonly status: 'PASS' | 'FAIL' | 'n/a';
  readonly detail: string;
}

export function pass(detail: string): CellOutcome {
  return { status: 'PASS', detail };
}

export function fail(detail: string): CellOutcome {
  return { status: 'FAIL', detail };
}

export function notApplicable(detail: string): CellOutcome {
  return { status: 'n/a', detail };
}
