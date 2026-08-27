// How each gate over a *document* is proved.
//
// Split from `gate-cases.mjs`, which had grown past the house limit again once
// `docs-guard` and `ledger-guard` each took a list of mutations. The boundary is
// a real one rather than a line count: everything here has a tracked document
// for a subject and is checking whether what the document says is still true,
// and everything left there has code or a build artefact for a subject.
//
// **The last split of this file broke the build.** Moving a scripted-press
// string literal into a file `gesture-guard` does not exempt by name was enough,
// and the commit was pushed because the build had been run before the split
// rather than after it. Nothing here is a string that guard reads, and the guard
// itself is one directory up in `gate-cases.mjs` with its own case beside it —
// but the reason that is knowable rather than hoped is `.githooks/pre-push`,
// which will not let a tree be pushed that no build has read.
import { accepting, CLEAN_TS, creating, currentDeclaredSource, editing } from './edits.mjs';
import { srcFingerprint } from '../srcfingerprint.mjs';

/*
 * Two headings out of `docs/audit/REACHABILITY.md`, used as insertion points.
 *
 * A heading rather than a table cell, because the formatter pads every cell in
 * that document to its column's width — so a cell anchor stops matching the day
 * somebody adds a surface with a longer name, and an anchor that stops matching
 * reports BROKEN, the verdict that means the gate could not be read at all.
 */
const ROUTES_HEADING = '## How each was reached';
// The heading that follows the matrix table. Not the sweep-summary one above
// it: the generator writes that section and the committed document predates
// it, so an anchor there is BROKEN today and would come back on the next
// regeneration — which is an anchor that works only sometimes.
const MATRIX_TAIL = '## Defects: reachable on desktop';

/** The routes heading, followed by a table carrying the given rows. */
const routeTable = (...rows) =>
  `${ROUTES_HEADING}\n\n| surface | form | via |\n| --- | --- | --- |\n` +
  rows.map((r) => `| ${r} |\n`).join('');

/** Gates whose subject is a document this repository tracks. */
export const DOC_GATES = {
  'route:check': {
    kind: 'gate',
    // A route recorded for a surface the matrix table does not list. That is
    // one of the three ways the two tables can describe different runs, and it
    // is the one a real format drift produces: rows arriving in one table and
    // not the other.
    //
    // The anchor is the section heading rather than a table cell, deliberately.
    // Every row in that document is padded to its column's width by the
    // formatter, so a cell anchor carries an expiry date measured in whenever
    // somebody adds a surface with a longer name — and an anchor that stops
    // matching reports BROKEN, which is the verdict meaning the gate could not
    // be read at all. A heading has no padding in it and moves only when the
    // generator's prose does.
    mutate: editing(
      'docs/audit/REACHABILITY.md',
      ROUTES_HEADING,
      routeTable('a surface the matrix does not list | desktop | nav-mix'),
    ),
    // A surface added to *both* tables, consistently — which is what growing
    // the matrix by one actually looks like. A case that only added the
    // not-reached row would also pass and would prove far less: it would show
    // the check tolerates a surface with no routes, not that it accepts one
    // with them.
    satisfy: {
      name: 'a surface present in both tables at once',
      edits: [
        editing(
          'docs/audit/REACHABILITY.md',
          MATRIX_TAIL,
          `| a constructed surface | yes | — | — | — | — |\n\n${MATRIX_TAIL}`,
        ),
        editing(
          'docs/audit/REACHABILITY.md',
          ROUTES_HEADING,
          routeTable('a constructed surface | phone-portrait | nav-mix'),
        ),
      ],
    },
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
    //
    // The second edit is the substrate's progress count, which is the guard's
    // other rule and
    // needs its own edit. The sentence it replaced went stale inside one
    // directive — "ten of the twelve remain, and the next is `voice_set.h`",
    // with `voice_set.h` in the tree — so the number is derived from the design's
    // file table and the filesystem, and this is the proof that the derivation
    // is load-bearing rather than decorative.
    mutate: [
      editing(
        'docs/UNIT_LEDGER.md',
        '| Granular Delay      | `fx-03`  | NOT STARTED',
        '| Granular Delay      | `fx-03`  | SHIPPING   ',
      ),
      // The *denominator*, not the count. The count changes every time a file
      // in the substrate is finished, so anchoring on it would give this
      // mutation an expiry date measured in days — the failure the `fx-03`
      // anchor above is written the way it is to avoid. Twelve is what the
      // design plans, and it moves only when the design does.
      editing(
        'docs/UNIT_LEDGER.md',
        "of the 12** files in the substrate's table exist",
        "of the 11** files in the substrate's table exist",
      ),
    ],
    // A unit renamed. Legal — the guard's subject is whether a status column
    // can outrun the cells beside it, and a name is neither — and it changes
    // the file, so it is not the tree we started from.
    satisfy: {
      name: 'a renamed unit',
      edits: [editing('docs/UNIT_LEDGER.md', '| Granular Delay      |', '| Granular Delay X    |')],
    },
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
    //
    // And a generated document truncated, which is the second rule and needs
    // its own mutation. `SOAK.md` was reduced to three lines by fifty-four
    // scoped probe runs and every rule this guard had stayed green — the
    // fingerprint was copied forward correctly, the header was written before
    // there was anything to render, and the classification was untouched. A
    // list is the honest shape here: this guard is load-bearing in four ways
    // and one edit can only ever speak for one of them.
    mutate: [
      editing(
        'docs/adr/0001-stack-and-engine-topology.md',
        '**Status:** Accepted',
        '| Web Audio engine | SHIPPING |\n\n**Status:** Accepted',
      ),
      editing('docs/audit/SOAK.md', '\n## 2. Combinatorial fuzz\n', '\n'),
      // The rows emptied, not a key added beside them. The first draft of this
      // line inserted `"truncated": []` *before* `"rows"` and left the rows
      // where they were, so nothing was truncated and the guard was right to
      // pass — DECAYED, on the first run of the list this directive added, for
      // a mutation that did not mutate. Which is the verdict working: a gate
      // that reads HELD under an edit that changes nothing is the green column
      // this whole file exists to stop.
      editing('docs/audit/store-coverage.json', '"rows": [', '"rows": [], "wasRows": ['),
    ],
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
      {
        // The strong form, on the rule this directive added: empty the store
        // sweep's artefact, run the writer the error message names, and the
        // guard must go green again.
        //
        // Worth the two minutes `npm test` costs, because the completeness rule
        // is exactly the shape the currency rule was — a demand made of a
        // generated file — and that one could not be satisfied by any command
        // at all. Asking whether this one can is the only way to know it has
        // not repeated the mistake.
        name: '`npm test` rewrites the artefact it emptied',
        repairing: 'docs/audit/store-coverage.json',
        repair: 'npm test',
        restores: ['docs/audit/store-coverage.json'],
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
};
