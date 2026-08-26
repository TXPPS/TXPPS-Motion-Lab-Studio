/**
 * The store sweep: every store mutator, through one four-phase pattern.
 *
 * See `tests/storeSweep/harness.ts` for what the four phases claim and why the
 * arguments are hand-written while the assertions are not. This file is the
 * entry: it rebuilds the fixture per row, runs the pattern, and writes what it
 * observed to `docs/audit/store-coverage.json` so the Function Ledger can count
 * these rows without anybody transcribing a number.
 *
 * The completeness test at the bottom is what keeps this honest. A store action
 * added tomorrow with no recipe fails here, the same way a function added with
 * no ledger row fails `functions:check` — otherwise the sweep quietly stops
 * covering the store it was built for, which is the failure the whole Function
 * Ledger exists to make impossible.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { enumerate } from '../scripts/functions/enumerate.mjs';
import { useProjectStore } from '../src/state/projectStore';
import { freshProject } from './storeSweep/fixture';
import { runProjectRecipe, runShellRecipe } from './storeSweep/harness';
import { projectRecipes } from './storeSweep/recipes';
import { SHELL_STORES, shellRecipes } from './storeSweep/recipes/shell';

const OUT = 'docs/audit/store-coverage.json';

/**
 * What the sweep observed, one entry per row, written once at the end.
 *
 * The *count* of changed paths is deliberately not recorded. Two rows move by a
 * path or two depending on the clock — `markSaved` diffs `lastSavedAt`, which
 * is `Date.now()` and sometimes lands on the value it replaced — and a
 * committed artefact that changes when nothing changed makes `functions:check`
 * red on every push but the one straight after a test run. That is a check
 * nobody can satisfy, and an unsatisfiable check gets turned off.
 */
const observed: { id: string; covered: boolean; note: string }[] = [];

/**
 * Ids, redacted out of the evidence.
 *
 * `newId()` is a timestamp, a counter and three random digits, so a note that
 * quotes one is different on every run — and the coverage artefact is committed
 * and read by `functions:check`, which compares the Function Ledger byte for
 * byte. A generated file that changes when nothing changed makes that check
 * unsatisfiable on every push but the one immediately after a test run, and an
 * unsatisfiable check gets turned off. The identity is not the evidence anyway:
 * "clip &lt;id&gt;" says a clip was created, which is the whole claim.
 */
const REDACT_ID = /\b[a-z]{1,8}[0-9a-z]{9,}\b/g;
const settle = (note: string) => note.replace(REDACT_ID, '<id>');

/**
 * Session state: what the store keeps that the document never carries.
 *
 * `gestureSnapshot` is reduced to a boolean because it holds an entire project
 * and the only question asked of it is whether a gesture is open.
 */
const session = (): Record<string, unknown> => {
  const st = useProjectStore.getState();
  return {
    gestureDepth: st.gestureDepth,
    gesturing: st.gestureSnapshot !== null,
    dirty: st.dirty,
    lastSavedAt: st.lastSavedAt,
  };
};

const readProject = () => ({
  project: useProjectStore.getState().project,
  undoDepth: useProjectStore.getState().undoStack.length,
  session: session(),
});

/**
 * The row ids, taken from a throwaway fixture at collection time.
 *
 * Recipes close over the handles of the project they will run against, so they
 * cannot be built once and reused — but their *ids* are constant, and naming
 * each case after its ledger row is what makes a failure say which store action
 * broke rather than "sweep row 94".
 */
const PROJECT_IDS = projectRecipes(freshProject()).map((r) => r.id);
const SHELL_IDS = SHELL_STORES.flatMap((s) => shellRecipes(s).map((r) => r.id));

describe('store sweep — project mutators', () => {
  let handles = freshProject();
  beforeEach(() => {
    handles = freshProject();
  });

  for (const id of PROJECT_IDS) {
    it(id, () => {
      const recipe = projectRecipes(handles).find((r) => r.id === id)!;
      const { note, changed } = runProjectRecipe(recipe, readProject, () =>
        useProjectStore.getState().undo(),
      );
      observed.push({ id, covered: changed > 0, note: settle(note) });
    });
  }
});

describe('store sweep — shell stores', () => {
  for (const store of SHELL_STORES) {
    for (const recipe of shellRecipes(store)) {
      it(recipe.id, () => {
        store.reset();
        const { note, changed } = runShellRecipe(recipe, store.read, store.persistKey, store.flush);
        observed.push({ id: recipe.id, covered: changed > 0, note: settle(note) });
      });
    }
  }
});

describe('the sweep covers the stores it claims to', () => {
  it('has a recipe for every store row the Function Ledger enumerates', () => {
    const known = new Set([...PROJECT_IDS, ...SHELL_IDS, ...coveredBySoak()]);
    const missing = enumerate()
      .filter((r) => r.kind === 'store')
      .map((r) => r.id)
      .filter((id) => !known.has(id));
    expect(missing, 'store actions with no recipe and no prior case').toEqual([]);
  });

  it('drives more rows than the soak already did', () => {
    // Non-vacuity. A sweep that only re-covered what was covered would pass
    // every assertion above and move the ledger not at all.
    const soak = coveredBySoak();
    const fresh = [...PROJECT_IDS, ...SHELL_IDS].filter((id) => !soak.has(id));
    expect(fresh.length).toBeGreaterThan(100);
  });
});

/** Rows the functional soak already drives against the running app. */
function coveredBySoak(): Set<string> {
  if (!existsSync('docs/audit/soak-coverage.json')) return new Set();
  const data = JSON.parse(readFileSync('docs/audit/soak-coverage.json', 'utf8')) as {
    rows: { id: string }[];
  };
  return new Set(data.rows.map((r) => r.id));
}

afterAll(() => {
  // Only a complete run may write the artefact. `vitest run tests/one.test.ts`
  // would otherwise leave a coverage file describing a fraction of the sweep,
  // and a partial artefact read as a total is the arithmetic this directive
  // came to fix.
  if (observed.length !== PROJECT_IDS.length + SHELL_IDS.length) return;
  const payload = {
    instrument: 'tests/storeSweep.test.ts',
    rows: observed.sort((a, b) => a.id.localeCompare(b.id)),
  };
  writeFileSync(OUT, `${JSON.stringify(payload, null, 2)}\n`);
});
