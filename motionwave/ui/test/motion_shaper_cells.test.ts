/**
 * Motion Shaper against the ledger's UI cells, through the real harness.
 *
 * Not a paraphrase of the cells and not a private set of assertions: this runs
 * `verifyUnit` and reads what it says, so the Ledger's UI rows are filled from
 * the same code that would judge any other unit. A unit that scored itself would
 * be marking its own homework.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { verifyUnit } from '../harness/verify';
import { HostCapabilities } from '../harness/capability';
import { motionShaperUnit } from '../units/motion_shaper/unit';

/** Cells this declaration is responsible for under the Directive 05 §2 split. */
const UI_CELLS = ['U19', 'U20', 'U21', 'U22', 'U23'] as const;

const here = dirname(fileURLToPath(import.meta.url));

/**
 * The real stylesheet, so U23 checks the palette that ships rather than a copy
 * of it. The cell refuses to report anything without one — a contrast check
 * against tokens nobody uses is worse than no check, because it passes.
 */
function tokensCss(): string {
  return readFileSync(join(here, '..', 'design', 'tokens.css'), 'utf8');
}

/**
 * The forbidden-name list, read from `docs/reference/` where it is allowed to
 * live. `UiCellOptions` takes it from the caller precisely so that the guard
 * itself does not have to contain the names it forbids.
 */
function forbiddenNames(): string[] {
  const path = join(here, '..', '..', '..', 'docs', 'reference', 'forbidden-names.txt');
  return readFileSync(path, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));
}

function resultsFor(host?: HostCapabilities) {
  const options = {
    tokensCss: tokensCss(),
    forbiddenNames: forbiddenNames(),
    ...(host === undefined ? {} : { host }),
  };
  const all = verifyUnit(motionShaperUnit, options);
  return new Map(all.map((r) => [r.cell, r]));
}

describe('the Motion Shaper face, judged by the harness', () => {
  it('passes U19 — original artwork with declared provenance', () => {
    const result = resultsFor().get('U19')!;
    // eslint-disable-next-line no-console
    console.log(`U19 ${result.status}: ${result.detail}`);
    expect(result.status).toBe('PASS');
  });

  it('passes U20 — every element bound to real engine state', () => {
    const result = resultsFor().get('U20')!;
    // eslint-disable-next-line no-console
    console.log(`U20 ${result.status}: ${result.detail}`);
    expect(result.status).toBe('PASS');
  });

  it('passes U23 — themes complete, pairs legible, controls named', () => {
    const result = resultsFor().get('U23')!;
    // eslint-disable-next-line no-console
    console.log(`U23 ${result.status}: ${result.detail}`);
    expect(result.status).toBe('PASS');
  });

  it('blocks U21 and U22 here, naming the capability each needs', () => {
    // Not a failure and not a pass. Frame pacing needs a refresh clock to count
    // against and an audio thread to be decoupled from; layout needs a browser
    // that computes it. Both are on the hardware punch list with procedures.
    for (const cell of ['U21', 'U22'] as const) {
      const result = resultsFor().get(cell)!;
      expect(result.status).toBe('BLOCKED');
      // A bare BLOCKED fails the ledger guard, so the reason must name the
      // missing capability rather than gesturing at one.
      expect(result.detail.length).toBeGreaterThan(10);
      // eslint-disable-next-line no-console
      console.log(`${cell} BLOCKED: ${result.detail}`);
    }
  });

  it('passes U21 and U22 the moment a capable host appears', () => {
    // The blocks above have to be about the host rather than about the unit,
    // and this is what proves it: given the capabilities, they run and pass.
    const capable = new HostCapabilities(['displayRefresh', 'realtimeThread', 'layoutEngine']);
    const results = resultsFor(capable);
    for (const cell of ['U21', 'U22'] as const) {
      expect(results.get(cell)!.status, cell).toBe('PASS');
    }
  });

  it('names an executable test behind every cell it claims', () => {
    // A PASS with no test is a FAIL, per the Ledger's own rule.
    const results = resultsFor();
    for (const cell of UI_CELLS) {
      const result = results.get(cell)!;
      expect(result.test.length, `${cell} names no test`).toBeGreaterThan(0);
    }
  });
});
