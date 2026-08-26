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

/** A file created from nothing, and deleted again afterwards. */
const creating = (file, content) => ({ file, content });
/** An edit to a tracked file. The driver restores the original either way. */
const editing = (file, from, to) => ({ file, from, to });

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
  test: { kind: 'suite' },
  'test:mw': { kind: 'suite' },
  'test:core': { kind: 'suite' },
  e2e: { kind: 'suite' },
  'e2e:mw': { kind: 'suite' },

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
  },
  stress: {
    kind: 'probe',
    provenBy: 'probe:mutations',
    manual: 'endurance layer runs for minutes of wall clock by construction',
  },
  reachability: {
    kind: 'probe',
    provenBy: 'probe:mutations',
    manual: 'walks every menu in a live browser; run per directive',
  },

  // ------------------------------------------------------------- composite
  build: { kind: 'composite', why: 'eleven checks in a chain, each with its own entry' },

  // ------------------------------------------------------------------ gates
  typecheck: {
    kind: 'gate',
    // A deliberate type error in a file each of the four projects actually
    // includes. `tsconfig.app.json` is the one `npx tsc --noEmit` compiles
    // nothing of, which is the gotcha at the top of CLAUDE.md.
    mutate: editing(
      'src/audio/pdc.ts',
      'export const MAX_PDC_SEC = 0.5;',
      'export const MAX_PDC_SEC: number = "half a second";',
    ),
  },
  'typecheck:e2e': {
    kind: 'gate',
    // The project that existed and was invoked by nothing. Its mutation has to
    // land in `e2e/`, because that is the only thing it includes — a type error
    // in `src/` would be caught by `typecheck` and prove nothing about this.
    mutate: editing('e2e/bouncealignment.spec.ts', 'const WINDOW = {', 'const WINDOW: number = {'),
  },
  lint: {
    kind: 'gate',
    mutate: creating('src/__mutant.ts', 'export const x = 1;\nconst unusedOnPurpose = 2;\n'),
  },
  'format:check': {
    kind: 'gate',
    mutate: creating('src/__mutant.ts', 'export const x   =    1\n'),
  },
  'params:check': {
    kind: 'gate',
    // A generated parameter table, hand-edited. The manifest is the source of
    // both sides of the parity, so an edit here is exactly the drift the check
    // is for.
    mutate: editing(
      'motionwave/ui/units/program_eq/params.gen.ts',
      'export const',
      'export /* mutant */ const',
    ),
  },
  'accent:check': {
    kind: 'gate',
    mutate: editing('src/styles/tokens.css', '--accent:', '--accent: #ff00ff; --accent-was:'),
  },
  'contrast:check': {
    kind: 'gate',
    // Contrast is asserted against the tokens, so the mutation is a token that
    // cannot carry text. Distinct from `accent:check`'s: that one asks whether
    // the accent was derived, this one asks whether it is legible.
    mutate: editing('src/styles/tokens.css', '--accent:', '--accent: #2a2a2a; --accent-was:'),
  },
  'icons:check': {
    kind: 'gate',
    mutate: editing('public/icons/icon-192.png', 'PNG', 'PnG'),
  },
  'curve:check': {
    kind: 'gate',
    needs: 'g++',
    mutate: editing('motionwave/ui/test/curve_golden.json', '[', '[0.5,'),
  },
  'sinc:check': {
    kind: 'gate',
    mutate: editing(
      'motionwave/core/dsp/grain/sinc_table.gen.h',
      'kSincHalfWidth = 8',
      'kSincHalfWidth = 9',
    ),
  },
  'windows:check': {
    kind: 'gate',
    mutate: editing('motionwave/core/dsp/grain/window_tables.gen.h', '0.0', '0.5'),
  },
  'wasm:check': {
    kind: 'gate',
    // The tracked core against a fresh compile. It needs emsdk, and says so
    // itself where there is none — which is why the driver reports BLOCKED
    // here rather than green: a check that reports SKIPPED is not a check that
    // passed, and this one has already been wrong once by comparing a file
    // against itself.
    // A constant the compiler folds, not a comment.
    //
    // This mutation was `namespace mw` -> `namespace /* mutant */ mw`, which
    // changes no compiled byte at all: the check correctly reported a match and
    // the gate correctly called it DECAYED. Nobody had seen that, because the
    // gate's own host test looked for emsdk at a path this machine does not use
    // and reported BLOCKED for three summaries running. Unblocking it is what
    // found the weak mutation — which is the argument for BLOCKED never being
    // treated as a kind of pass.
    //
    // `kShelfPlateau` is a `static constexpr double` inside the shelf's own
    // maths, so moving it changes the emitted WebAssembly and the tracked core
    // stops matching its source, which is precisely what this check exists for.
    mutate: editing(
      'motionwave/core/units/console_eq.h',
      'static constexpr double kShelfPlateau = 2.5;',
      'static constexpr double kShelfPlateau = 2.75;',
    ),
    needs: 'emsdk',
    // `build.sh` copies its output over the tracked core as its last step, so
    // the mutated run leaves a mutant artefact in git. Undoing the source edit
    // is not enough; the artefact has to come back too.
    restores: ['motionwave/wasm/prebuilt/motionwave.worklet.js'],
  },
  'licence-guard': {
    kind: 'gate',
    mutate: creating(
      'src/__mutant.ts',
      '// SPDX-License-Identifier: GPL-3.0-only\nexport const x = 1;\n',
    ),
  },
  'ledger-guard': {
    kind: 'gate',
    // A unit claimed as SHIPPING whose cells are all `—`, which is what the
    // guard exists to refuse: "the Ledger must not be able to lie".
    //
    // It used to corrupt a `| FAIL` cell into `| SHIPPING-FAIL`, and there is
    // no `FAIL` left in the ledger — the Granular Reverb's V27 was the last one
    // and it closed. So the mutation could not be applied and the gate read
    // BROKEN, which is the verdict that means the check is unreadable rather
    // than that it failed. An anchor tied to a value that was always going to
    // change is an anchor with an expiry date; `NOT STARTED` on `fx-03` is a
    // row that stays until somebody builds it, and building it is exactly when
    // this entry should be looked at again.
    mutate: editing(
      'docs/UNIT_LEDGER.md',
      '| Granular Delay      | `fx-03`  | NOT STARTED',
      '| Granular Delay      | `fx-03`  | SHIPPING   ',
    ),
  },
  'gesture-guard': {
    kind: 'gate',
    // A scripted press in a file with no entry in the guard's own registry.
    // `console.spec.ts` presses through Playwright today, so the mutation is
    // exactly what the guard exists to notice: somebody reaching for
    // `el.click()` in a new place because it was quicker.
    mutate: editing(
      'e2e/console.spec.ts',
      "from '@playwright/test';",
      "from '@playwright/test'; const m = (l) => l.evaluate((n) => n.click());",
    ),
  },
  'parity-guard': {
    kind: 'gate',
    // The evidence layer, which is where 806 of the 947 claims are settled.
    //
    // The editing chapter states, as its reason for calling the Audio Part
    // `PARTIAL`, that it grepped `audioPart` and `consolidate` and found no
    // hits. Putting `audioPart` into the tree makes that sentence false, which
    // is exactly the drift that let six items — one of them a P0 — be closed
    // while the documents still called them missing.
    //
    // It used to mutate `engine.ts`'s `pdcSamples` publish, which exercised the
    // thirteen pinned predicates instead. Those still run; this one covers the
    // layer that covers the corpus.
    mutate: editing(
      'src/model/types.ts',
      'export interface',
      'export type MutantPart = { audioPart: number };export interface',
    ),
  },
  'scope-guard': {
    kind: 'gate',
    // The only entry that needs the git index, so the driver stages the file it
    // creates and unstages it afterwards — and refuses to run at all if the
    // index was not already empty. A sweep that quietly reset somebody's
    // staged work to check a guard would be a worse defect than the one it is
    // checking for.
    mutate: creating('src/__mutant.ts', 'export const x = 1;\n'),
    stages: true,
    env: { MW_SCOPE: 'docs' },
  },
  'probe:mutations': {
    kind: 'gate',
    command: 'node scripts/probe-mutations.mjs --check',
    // `--check` matches the registry against the call sites. Renaming a planted
    // id breaks the match in both directions at once, which is what the two
    // halves of that check are for.
    mutate: editing(
      'scripts/bypass-probe.mjs',
      "unless('bypass/full-resolution'",
      "unless('bypass/full-resolution-renamed'",
    ),
  },
};

/**
 * Checks that are not npm scripts: a guard invoked directly by a build step or
 * a CI step. They are reached by their path rather than by a name, so they are
 * declared here and matched against the same command text.
 */
export const DIRECT = {
  'scripts/check-bundle.mjs': {
    kind: 'gate',
    // A chunk in `dist/` big enough to break the total-JS budget. Random hex
    // rather than repeated text, because the budget is on the *gzipped* size
    // and a megabyte of one character compresses to nothing.
    mutate: {
      // `dist/assets`, not `dist`: the budget reads the assets directory, and a
      // file dropped one level up is a mutation the check never sees — which
      // read as DECAYED and was the sweep mis-measuring itself.
      file: 'dist/assets/index-mutant.js',
      content: Array.from({ length: 40000 }, (_, i) => ((i * 2654435761) >>> 0).toString(36)).join(
        '',
      ),
    },
    needs: 'dist',
  },
  'scripts/check-core-in-bundle.mjs': {
    kind: 'gate',
    mutate: { file: 'dist/worklets/__mutant.txt', content: 'x' },
    expect: 'unfalsifiable',
    unfalsifiableBecause:
      'it asserts two files are present and large enough, and adding a third does not make that false. ' +
      'Removing one would, and deleting a build artefact to prove a check works is a worse trade than ' +
      'recording that this one is only proved by the build that produces them.',
    needs: 'dist',
  },
};

export const CHECK_NAMES = Object.keys(CHECKS);
