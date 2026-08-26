/**
 * How each declared check is known to be able to fail.
 *
 * Three findings made this necessary and they are three different shapes of the
 * same thing. `tsconfig.e2e.json` was correct and invoked by nothing. The panel
 * spec ran and could not fail, because the worklet it needed had been renamed
 * and it passed anyway. `wasm:check` compared a file against itself. In all
 * three the check existed, and its existence is what stopped anybody asking.
 *
 * So every npm script needs an entry here, and the entry has to say one of two
 * things: this is not a check and here is why, or this is a check and here is
 * the edit that makes it go red. A script with no entry fails `--check`, which
 * is what turns "somebody should verify that" into "the build will not go
 * without it" — the same mechanism `probe-mutations.mjs` uses, applied one
 * level up.
 *
 * **And every check says how it can *pass*.** A mutation proves a check is
 * load-bearing; it does not prove the check can ever be satisfied.
 * `docs-guard`'s currency rule compared a bundle name that `vite.config.ts`
 * changes on every commit, so committing the report it demanded invalidated the
 * report — it would have held its mutation and it was unsatisfiable, and a
 * check that cannot be satisfied gets turned off. So each entry also carries
 * `satisfy` (a constructed state the check must accept) or `satisfiedBy` (why
 * no such state can be constructed). `scripts/checks/satisfy.mjs` applies them.
 *
 * `kind` says what the proof is:
 *
 *  - `gate`    — a mutation, applied to the thing the check reads. The strong
 *                form: the check is run clean, run mutated, and must disagree.
 *  - `suite`   — a test runner. Its falsifiability is not in question; what is
 *                in question is whether every spec on disk is in it, which is
 *                what the enumeration in `check-checks.mjs --run` proves.
 *  - `probe`   — a measurement harness whose corrections are mutation-tested by
 *                `npm run probe:mutations`. Not re-proved here; named, so the
 *                chain from this file to that one is on the page.
 *  - `composite` — runs other checks and adds none of its own.
 *  - `tool`    — not a check. A generator, a server, a formatter. Needs a
 *                reason, because "it is not a check" is exactly what somebody
 *                would say about a check they had broken.
 */

import { accepting } from './edits.mjs';
import { GATES } from './gate-cases.mjs';

export { DIRECT } from './gate-cases.mjs';

export const CHECKS = {
  // ---------------------------------------------------------------- tools
  dev: { kind: 'tool', why: 'the dev server' },
  preview: { kind: 'tool', why: 'the preview server the browser suites run against' },
  'test:watch': { kind: 'tool', why: 'the interactive form of `test`' },
  format: { kind: 'tool', why: 'writes; `format:check` is the check' },
  icons: { kind: 'tool', why: 'writes; `icons:check` is the check' },
  accent: { kind: 'tool', why: 'writes; `accent:check` is the check' },
  params: { kind: 'tool', why: 'writes; `params:check` is the check' },
  sinc: { kind: 'tool', why: 'writes; `sinc:check` is the check' },
  windows: { kind: 'tool', why: 'writes; `windows:check` is the check' },
  'curve:golden': { kind: 'tool', why: 'writes; `curve:check` is the check' },
  functions: { kind: 'tool', why: 'writes the Function Ledger; the build runs it with --check' },
  shot: { kind: 'tool', why: 'takes screenshots' },
  'build:wasm': { kind: 'tool', why: 'compiles the core; `wasm:check` is the check' },
  'build:panel': { kind: 'tool', why: 'builds the panel harness `e2e:mw` runs against' },
  'motionwave:assets': {
    kind: 'tool',
    why: 'copies the core into public/; `check-core-in-bundle` is the check',
  },

  // ---------------------------------------------------------------- suites
  //
  // A suite's constructed passing state is a new spec it picks up and accepts.
  // Not a formality: the panel spec was on disk, declared tests, and the runner
  // was pointed somewhere else — so "the runner sees a file that appears" is
  // exactly the claim worth making, and it is the one that was false.
  test: {
    kind: 'suite',
    satisfy: accepting(
      'a new spec the runner picks up',
      'tests/__satisfy.test.ts',
      "import { expect, it } from 'vitest';\n\nit('is a spec the runner finds and accepts', () => {\n  expect(1 + 1).toBe(2);\n});\n",
    ),
  },
  'test:mw': {
    kind: 'suite',
    satisfy: accepting(
      'a new spec the runner picks up',
      'motionwave/ui/test/__satisfy.test.ts',
      "import { expect, it } from 'vitest';\n\nit('is a spec the runner finds and accepts', () => {\n  expect(1 + 1).toBe(2);\n});\n",
    ),
  },
  'test:core': {
    kind: 'suite',
    satisfy: accepting(
      'a new suite the compiler picks up',
      'motionwave/core/test/__satisfy_tests.cpp',
      '#include "harness.h"\n\nMW_TEST(satisfy_the_runner) {\n  MW_EXPECT(1 + 1 == 2);\n}\n',
    ),
  },
  e2e: {
    kind: 'suite',
    satisfiedBy:
      'a constructed case would need the preview build and a browser per form factor, which is ' +
      'minutes per run; what a new spec being picked up proves is proved by `test` above, and ' +
      'the enumeration in `--run` is what asks this runner whether it sees every file on disk',
  },
  'e2e:mw': {
    kind: 'suite',
    satisfiedBy: 'same as `e2e`: a browser and the panel build, and the enumeration covers it',
  },

  // ---------------------------------------------------------------- probes
  //
  // `manual` is the one escape hatch here, and it takes a reason for the same
  // reason `licence-guard`'s self-exemption is one obvious line: an exemption
  // that can be granted silently is how the orphans got to be orphans. These
  // three take tens of minutes against a live browser and are run per directive
  // rather than per push. They are still listed on every run, so "we do not run
  // that on a push" stays a decision somebody made rather than a fact nobody
  // noticed.
  soak: {
    kind: 'probe',
    provenBy: 'probe:mutations',
    manual: 'four layers against a live preview; tens of minutes, run per directive',
    satisfiedBy:
      'it passes on every directive run and its report names the tree it measured, so its ' +
      'satisfiability is observed rather than constructed; constructing one would mean a second ' +
      'twenty-minute run against a live browser to learn what the first already said',
  },
  stress: {
    kind: 'probe',
    provenBy: 'probe:mutations',
    manual: 'endurance layer runs for minutes of wall clock by construction',
    satisfiedBy: 'same as `soak`: it is satisfied on every directive run, at minutes per run',
  },
  reachability: {
    kind: 'probe',
    provenBy: 'probe:mutations',
    manual: 'walks every menu in a live browser; run per directive',
    satisfiedBy: 'same as `soak`: satisfied on every directive run, against a live browser',
  },

  // ------------------------------------------------------------- composite
  build: {
    kind: 'composite',
    why: 'eleven checks in a chain, each with its own entry',
    satisfiedBy:
      'the chain is satisfiable exactly when its members are, and each carries its own case. ' +
      'The one property that is the chain\u2019s own — that it survives the shallow clone the ' +
      'deploy builder makes — is `docs-guard`\u2019s second case, because `docs-guard` is the ' +
      'only member of the chain that asks git anything',
  },

  // ------------------------------------------------------------------ gates
  //
  // Twenty entries, each with a mutation and a constructed passing state. They
  // live in `gate-cases.mjs` because the two questions — what a script is, and
  // how it is proved — are different subjects and one file was describing both.
  ...GATES,
};

export const CHECK_NAMES = Object.keys(CHECKS);
