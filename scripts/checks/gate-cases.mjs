// How each gate is proved: the mutation that must make it fail, and the
// constructed state that must make it pass.
//
// Split from `mutants.mjs`, which now says what each declared script *is* and
// leaves the twenty gates and the two direct guards here. The two files answer
// different questions and the registry had grown past four hundred lines
// answering both.
//
// `mutate` is applied by `gates.mjs` and the check must go red. `satisfy` is
// applied by `satisfy.mjs` and the check must stay green — see that file for
// why "it can fail" is only half the question, and which deploy the other half
// cost.
import {
  accepting,
  CLEAN_TS,
  creating,
  currentDeclaredSource,
  editing,
  repairedBy,
} from './edits.mjs';
import { srcFingerprint } from '../srcfingerprint.mjs';

export const GATES = {
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
    satisfy: accepting('a well-typed source in src/', 'src/__satisfy.ts', CLEAN_TS),
  },
  'typecheck:e2e': {
    kind: 'gate',
    // The project that existed and was invoked by nothing. Its mutation has to
    // land in `e2e/`, because that is the only thing it includes — a type error
    // in `src/` would be caught by `typecheck` and prove nothing about this.
    mutate: editing('e2e/bouncealignment.spec.ts', 'const WINDOW = {', 'const WINDOW: number = {'),
    satisfy: accepting(
      'a well-typed spec in e2e/',
      'e2e/__satisfy.spec.ts',
      "import { expect, test } from '@playwright/test';\n\ntest('is well typed', () => {\n  expect(1).toBe(1);\n});\n",
    ),
  },
  lint: {
    kind: 'gate',
    mutate: creating('src/__mutant.ts', 'export const x = 1;\nconst unusedOnPurpose = 2;\n'),
    satisfy: accepting('a lint-clean source', 'src/__satisfy.ts', CLEAN_TS),
  },
  'format:check': {
    kind: 'gate',
    mutate: creating('src/__mutant.ts', 'export const x   =    1\n'),
    satisfy: accepting('an already-formatted source', 'src/__satisfy.ts', CLEAN_TS),
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
    satisfy: repairedBy('npm run params'),
  },
  'accent:check': {
    kind: 'gate',
    mutate: editing('src/styles/tokens.css', '--accent:', '--accent: #ff00ff; --accent-was:'),
    satisfy: repairedBy('npm run accent'),
  },
  'contrast:check': {
    kind: 'gate',
    // Contrast is asserted against the tokens, so the mutation is a token that
    // cannot carry text. Distinct from `accent:check`'s: that one asks whether
    // the accent was derived, this one asks whether it is legible.
    mutate: editing('src/styles/tokens.css', '--accent:', '--accent: #2a2a2a; --accent-was:'),
    // The same repair, and a different question of it: `accent:check` asks
    // whether the accent was derived, this asks whether what the deriver
    // produces is legible. A generator that emitted an illegible token would
    // satisfy the first and refuse the second.
    satisfy: repairedBy('npm run accent'),
  },
  'icons:check': {
    kind: 'gate',
    mutate: editing('public/icons/icon-192.png', 'PNG', 'PnG'),
    satisfy: repairedBy('npm run icons'),
  },
  'curve:check': {
    kind: 'gate',
    needs: 'g++',
    mutate: editing('motionwave/ui/test/curve_golden.json', '[', '[0.5,'),
    satisfy: repairedBy('npm run curve:golden'),
  },
  'sinc:check': {
    kind: 'gate',
    mutate: editing(
      'motionwave/core/dsp/grain/sinc_table.gen.h',
      'kSincHalfWidth = 8',
      'kSincHalfWidth = 9',
    ),
    satisfy: repairedBy('npm run sinc'),
  },
  'windows:check': {
    kind: 'gate',
    mutate: editing('motionwave/core/dsp/grain/window_tables.gen.h', '0.0', '0.5'),
    satisfy: repairedBy('npm run windows'),
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
    // Recompiling is exactly what this check's failure message says to do, so
    // the case is the strongest form of the question: is the state it demands
    // reachable by doing what it tells you to do?
    satisfy: repairedBy('npm run build:wasm'),
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
    // A permissively licensed file. The guard scans headers for copyleft
    // phrases, so a case that carried no header at all would pass by saying
    // nothing — the state worth proving it accepts is one that names a licence
    // and names a compatible one.
    satisfy: accepting('a permissively licensed source', 'src/__satisfy.ts', CLEAN_TS),
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
    // A unit renamed. Legal — the guard's subject is whether a status column
    // can outrun the cells beside it, and a name is neither — and it changes
    // the file, so it is not the tree we started from.
    satisfy: {
      name: 'a renamed unit',
      edits: [editing('docs/UNIT_LEDGER.md', '| Granular Delay      |', '| Granular Delay X    |')],
    },
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
    // A spec that presses the way the house rule says to. A case with no press
    // in it at all would also pass and would prove nothing: the claim worth
    // making is that the *approved* route is recognised as approved, not that
    // a file with no gestures is ignored.
    satisfy: accepting(
      'a spec that presses through e2e/pointer.ts',
      'e2e/__satisfy.spec.ts',
      "import { test } from '@playwright/test';\nimport { reach } from './pointer';\n\ntest('presses through a real pointer', async ({ page }) => {\n  await reach(page.locator('body'), 'touch', 'the page body');\n});\n",
    ),
  },
  'docs-guard': {
    kind: 'gate',
    // A narrative document that starts recording product state.
    //
    // `docs/adr/0001` is a decision record: it says what was decided and what
    // was rejected, and nothing in it can go stale. Adding a verdict table row
    // to it is exactly how `docs/design/lib-voice-substrate.md` came to claim
    // "no implementation exists" while two of its files were in the tree — a
    // sentence about the present, in a file nobody re-reads, checked by no one.
    mutate: editing(
      'docs/adr/0001-stack-and-engine-topology.md',
      '**Status:** Accepted',
      '| Web Audio engine | SHIPPING |\n\n**Status:** Accepted',
    ),
    satisfy: [
      {
        // A new document, classified. The classification *is* the contract, so
        // the case has to add both halves — the file and its registry entry —
        // and it is exactly what adding a document is supposed to look like.
        name: 'a new narrative document with a registry entry',
        edits: [
          creating(
            'docs/__satisfy.md',
            '# Satisfy\n\nA narrative note: it records why a decision was taken and records no\nproduct state, which is what NARRATIVE means.\n',
          ),
          editing(
            'scripts/docs/registry.mjs',
            'export const DOCS = Object.fromEntries([',
            "export const DOCS = Object.fromEntries([\n  ['docs/__satisfy.md', { kind: 'NARRATIVE', why: 'the satisfiability case' }],",
          ),
        ],
      },
      {
        // The deploy, reproduced. `docs-guard` is the only member of the build
        // chain that asks git anything, and it asked eleven questions a
        // `--depth 1` clone cannot answer — which is what Cloudflare's builder
        // makes and what took the site down for a quarter of an hour.
        name: 'a shallow clone, which is what the deploy builder makes',
        shallow: true,
      },
    ],
  },
  'docs-guard:release': {
    kind: 'gate',
    // The currency check, which is the whole reason `--strict` exists.
    //
    // `docs/audit/SOAK.md` names the bundle it measured and says in as many
    // words that a different hash means it describes a product that has moved.
    // Nothing read that line, and the file carried a FAIL on the bypassed
    // latency property for a directive after the product fixed it. Renaming
    // the bundle it declares is that, reproduced.
    // The declared source fingerprint, corrupted.
    //
    // It used to rename the *bundle* the report names, and that mutation went
    // stale the moment the currency rule stopped reading the bundle — the gate
    // reported DECAYED on the next run, which is the gate doing its job on the
    // check that taught this directive its lesson. The anchor is the label
    // rather than the digest, because a digest changes whenever `src/` does and
    // an anchor with an expiry date is an anchor that reads BROKEN later.
    mutate: editing('docs/audit/SOAK.md', '- **Source** `', '- **Source** `0000'),
    // The case this whole mechanism exists for.
    //
    // The rule used to compare the *bundle* `SOAK.md` names against `dist/`,
    // and it could never pass: `vite.config.ts` compiles the commit date in, so
    // committing the fresh report invalidated the name the report had just been
    // made to carry. It would have held its mutation and been unsatisfiable,
    // and an unsatisfiable check gets turned off.
    //
    // So: move `src/`, then write the fingerprint that move produces into the
    // report, and the check must accept. The second edit is a thunk because the
    // value it needs does not exist until the first has landed.
    satisfy: {
      name: 'a moved source and a report that declares the new fingerprint',
      edits: [
        creating('src/__satisfy.ts', CLEAN_TS),
        () =>
          editing(
            'docs/audit/SOAK.md',
            /* the fingerprint as it stands, which the first edit has just invalidated */
            currentDeclaredSource(),
            `- **Source** \`${srcFingerprint()}\``,
          ),
      ],
    },
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
    // A source file added that no claim cites. The guard settles 806 claims by
    // grepping the tree, so what it must tolerate is the tree growing — and it
    // is the tolerance half that goes wrong when a citation predicate is made
    // too wide.
    satisfy: accepting('a source file no claim cites', 'src/__satisfy.ts', CLEAN_TS),
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
    // A file staged *inside* the declared scope. The mutation proves the guard
    // stops a sweep; this proves it lets the work through, which is the half
    // that decides whether anybody keeps using it.
    satisfy: {
      name: 'a file staged inside the declared scope',
      stages: true,
      edits: [creating('docs/__satisfy.md', '# Satisfy\n\nA file inside the declared scope.\n')],
    },
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
    // The same rename, made in both places. The mutation renames the call site
    // and leaves the registry, and the check goes red in both directions at
    // once; renaming both is the state it is supposed to accept, and it is what
    // splitting a probe across files actually looks like.
    satisfy: {
      name: 'a rename made in both the registry and the call site',
      edits: [
        editing(
          'scripts/bypass-probe.mjs',
          "unless('bypass/full-resolution'",
          "unless('bypass/full-resolution-v2'",
        ),
        editing(
          'scripts/probe-mutant.mjs',
          "id: 'bypass/full-resolution',",
          "id: 'bypass/full-resolution-v2',",
        ),
      ],
    },
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
    // A chunk that fits. The budget is on gzipped total JS, so a small file
    // added to the same directory the mutation targets is the state the check
    // is supposed to accept — and it lands in `dist/assets`, because a file one
    // level up is one this check never reads and would prove nothing.
    satisfy: {
      name: 'a small chunk that fits inside the budget',
      edits: [creating('dist/assets/__satisfy.js', 'export const satisfied = 1;\n')],
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
    satisfiedBy:
      'its constructed passing state is the build itself: `npm run build` copies the core into ' +
      '`dist/worklets/` and this runs as the last step of that chain, so every green build is the ' +
      'case. Constructing a second one would mean writing two files large enough to pass a size ' +
      'floor and calling that a core, which is a fixture that proves the fixture.',
    needs: 'dist',
  },
};
