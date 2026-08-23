/**
 * Motion Wave — turning harness results into the rows the ledger holds.
 *
 * `docs/UNIT_LEDGER.md` says a cell holds exactly one of `PASS`, `FAIL`,
 * `BLOCKED (reason)`, `n/a` or `—`, with no prose and no "mostly", and that
 * `scripts/ledger-guard.mjs` fails the build if a unit is marked `SHIPPING`
 * while an applicable cell is not `PASS`. Generating the row here rather than
 * typing it means the table cannot disagree with the run that produced it —
 * the failure mode a hand-updated board always eventually has.
 */

import type { CellStatus } from './types';
import type { CellResult } from './verify';

export interface ResultTally {
  readonly pass: number;
  readonly fail: number;
  readonly blocked: number;
  readonly notApplicable: number;
}

export function tally(results: readonly CellResult[]): ResultTally {
  const count = (status: CellStatus): number =>
    results.filter((result) => result.status === status).length;
  return {
    pass: count('PASS'),
    fail: count('FAIL'),
    blocked: count('BLOCKED'),
    notApplicable: count('n/a'),
  };
}

/**
 * A cell's ledger value. `BLOCKED` carries its reason inside the parentheses,
 * because the ledger's rule is that a bare `BLOCKED` is not allowed: it has to
 * name the specific missing capability or it is indistinguishable from a cell
 * nobody looked at.
 */
export function ledgerValue(result: CellResult): string {
  if (result.status !== 'BLOCKED') return result.status;
  const reason = result.detail.replace(/\s+/g, ' ').trim();
  return `BLOCKED (${reason})`;
}

/** One markdown row for the unit table, in the ledger's column order. */
export function ledgerRow(
  unitName: string,
  sheet: string,
  status: string,
  results: readonly CellResult[],
): string {
  const cells = results.map((result) => ledgerValue(result));
  return `| ${[unitName, `\`${sheet}\``, status, ...cells].join(' | ')} |`;
}

/**
 * The long form: every cell with its detail and the name of the test behind it.
 * This is what goes under a unit's section in the ledger, where the rule is
 * that every `PASS` is backed by a named executable test.
 */
export function formatReport(unitName: string, results: readonly CellResult[]): string {
  const counts = tally(results);
  const lines = [
    `${unitName} — ${counts.pass} PASS, ${counts.fail} FAIL, ${counts.blocked} BLOCKED, ${counts.notApplicable} n/a`,
    '',
  ];
  for (const result of results) {
    lines.push(
      `${result.cell.padEnd(4)} ${ledgerValue(result).padEnd(12)} ${result.title} — ${result.detail}  [${result.test}]`,
    );
  }
  return lines.join('\n');
}

/** The blocked cells and what would unblock each, for the phase report. */
export function blockedSummary(results: readonly CellResult[]): string[] {
  return results
    .filter((result) => result.status === 'BLOCKED')
    .map((result) => `${result.cell} ${result.title}: ${result.detail}`);
}
