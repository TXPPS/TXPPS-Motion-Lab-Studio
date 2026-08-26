// How each gate is proved: the mutation that must make it fail, and the
// constructed state that must make it pass.
//
// Split from `mutants.mjs`, which now says what each declared script *is* and
// leaves the gates and the two direct guards here. The two files answer
// different questions and the registry had grown past four hundred lines
// answering both. It grew past it a second time once a gate could carry a list
// of mutations, and the four whose subject is a tracked document moved on to
// `doc-gates.mjs` — code and build artefacts here, documents there.
//
// `mutate` is applied by `gates.mjs` and the check must go red. `satisfy` is
// applied by `satisfy.mjs` and the check must stay green — see that file for
// why "it can fail" is only half the question, and which deploy the other half
// cost.
import { accepting, CLEAN_TS, creating, editing, repairedBy } from './edits.mjs';
import { DOC_GATES } from './doc-gates.mjs';

export const GATES = {
  // Four of them live in `doc-gates.mjs`: everything whose subject is a tracked
  // document rather than code or a build artefact. Spread rather than merged by
  // hand so a name added there cannot go missing here.
  ...DOC_GATES,
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
