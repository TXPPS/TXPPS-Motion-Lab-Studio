// Every document under `docs/`, classified — and the classification is the
// contract, not a label.
//
// Three documents have gone stale in three directives and it was the same
// failure each time:
//
//   - `docs/audit/SOAK.md` carried a FAIL on the bypassed-latency property for
//     at least a directive after the product fixed it. The file *declares* the
//     bundle it describes and says in as many words that a different hash
//     means it describes a product that has moved. Nothing read that line.
//   - the parity documents marked five closed items MISSING, including the
//     headline one, at 535 MISSING and 294 PARTIAL.
//   - `docs/BACKLOG_MOTIONLAB.md` held three tickets that had been closed.
//
// A wrong document is worse than a missing one, for exactly the reason
// `tsconfig.e2e.json` was: its existence stops anybody asking. So:
//
//   **GENERATED** — written by a named script, never by hand, and *checkable*:
//   either it declares the artefact it describes and this compares them, or
//   `--regen` reruns the generator and diffs.
//
//   **GUARDED** — hand-written state whose claims a build guard checks in both
//   directions. Names the guard.
//
//   **NARRATIVE** — reasoning and decisions. May not record product state at
//   all, and `docs-guard` reads it for the shapes that state takes.
//
// Anything unclassified fails. That is the part that does not go stale: a new
// document under `docs/` stops the build until somebody says which of the
// three it is.
//
// A NARRATIVE document may carry `historical: true` and name the commit it
// describes. That is the conversion the directive asks for rather than a fourth
// class: an audit is a measurement of one tree at one moment, and a measurement
// of a named commit is *history* — it cannot go stale, because it was never a
// claim about now. The guard checks that the document says which commit and that
// the commit is in this repository. A report that names no commit is claiming to
// describe the present, and the present is what goes wrong.

/** @typedef {{ kind: 'GENERATED', by: string, declares?: 'source', why: string }} Generated */
/** @typedef {{ kind: 'GUARDED', by: string, why: string }} Guarded */
/** @typedef {{ kind: 'NARRATIVE', why: string }} Narrative */

const parity = (name) => [
  `docs/reference/fsp8-parity-${name}.md`,
  {
    kind: 'GUARDED',
    by: 'parity-guard',
    why: 'every claim is either citation-checked against the tree, pinned, or registered as needing judgement with a reason',
  },
];

/** @type {Record<string, Generated | Guarded | Narrative>} */
export const DOCS = Object.fromEntries([
  // ── Generated ────────────────────────────────────────────────────────────
  [
    'docs/audit/SOAK.md',
    {
      kind: 'GENERATED',
      by: 'soak',
      declares: 'source',
      why: 'four soak layers against one running build; the bundle it names is the only one it describes',
    },
  ],
  [
    'docs/audit/soak-coverage.json',
    {
      kind: 'GENERATED',
      by: 'soak',
      why: 'the coverage arithmetic behind SOAK.md, written by the same run',
    },
  ],
  [
    'docs/FUNCTION_LEDGER.md',
    {
      kind: 'GENERATED',
      by: 'functions',
      why: 'derived from the source: every action module, store contract, shortcut, effect kind and surface. A function without a row fails the build',
    },
  ],
  [
    'docs/audit/REACHABILITY.md',
    {
      kind: 'GENERATED',
      by: 'reachability',
      why: 'every surface on every form factor, reached through the shell’s own controls',
    },
  ],

  // ── Guarded ──────────────────────────────────────────────────────────────
  [
    'docs/UNIT_LEDGER.md',
    {
      kind: 'GUARDED',
      by: 'ledger-guard',
      why: 'every PASS is backed by a named executable test and the guard checks the table against them',
    },
  ],
  parity('fundamentals'),
  parity('setup'),
  parity('recording'),
  parity('editing'),
  parity('mixing'),
  parity('windows'),
  parity('shortcuts'),
  parity('spec'),
  [
    'docs/PARITY.md',
    {
      kind: 'GUARDED',
      by: 'parity-guard',
      why: 'the workflow-level Yes/Partial/No table, every row settled by a citation, a predicate or a recorded judgement',
    },
  ],
  [
    'docs/DEVICE-PARITY.md',
    {
      kind: 'GUARDED',
      by: 'parity-guard',
      why: 'the device face gap list; every effect kind it names must exist and every “we have none” row must still have none',
    },
  ],
  [
    'docs/BACKLOG_MOTIONLAB.md',
    {
      kind: 'GUARDED',
      by: 'docs-guard',
      why: 'a closed ticket must name the commit or test that closed it, and an open one must not name one — this is where three closed tickets sat unmarked',
    },
  ],
  [
    'docs/KNOWN-LIMITATIONS.md',
    {
      kind: 'GUARDED',
      by: 'docs-guard',
      why: 'each limitation names the file it lives in, and the guard fails when that file is gone — a limitation of code that no longer exists is a claim about nothing',
    },
  ],

  // ── Narrative: history, stamped with the commit it describes ─────────────
  //
  // Each of these measured or planned one tree at one moment. Stamped, they
  // are history and cannot go stale; unstamped, every one of them was claiming
  // to describe the present, and three of them were superseded years of
  // directives ago while still reading as current.
  ...[
    ['docs/AUDIT-DEVICE-FUNCTION.md', 'a device audit, superseded by audit/PLUGIN_AUDIT.md'],
    ['docs/AUDIT-RESPONSIVE.md', 'a responsive audit, superseded by audit/RESPONSIVE_AUDIT.md'],
    ['docs/LAYOUT-AUDIT.md', 'a layout audit at a named commit, superseded'],
    ['docs/MILESTONE-2-RECORDING.md', 'what one milestone built, and why'],
    ['docs/MILESTONE-3-WORKFLOW.md', 'what one milestone built, and why'],
    ['docs/MILESTONE-4-MIDI.md', 'what one milestone built, and why'],
    ['docs/MILESTONE-5-AUTOMATION.md', 'what one milestone built, and why'],
    ['docs/MILESTONE-6-AUDIO-EDITING.md', 'what one milestone built, and why'],
    ['docs/MILESTONE-7-SAMPLER.md', 'what one milestone built, and why'],
    ['docs/audit/PLUGIN_AUDIT.md', 'the plugin audit; its open items live in the guarded backlog'],
    [
      'docs/audit/RESPONSIVE_AUDIT.md',
      'the responsive audit; its open items live in the guarded backlog',
    ],
  ].map(([path, why]) => [path, { kind: 'NARRATIVE', historical: true, why }]),

  // ── Narrative ────────────────────────────────────────────────────────────
  ...[
    [
      'docs/adr/0001-stack-and-engine-topology.md',
      'a locked decision and its rejected alternatives',
    ],
    ['docs/adr/0002-project-file-format.md', 'a locked decision and its rejected alternatives'],
    [
      'docs/adr/0003-repository-layout-and-module-boundaries.md',
      'a locked decision and its rejected alternatives',
    ],
    [
      'docs/adr/0004-parameter-and-automation-framework.md',
      'a locked decision and its rejected alternatives',
    ],
    [
      'docs/adr/0005-verification-under-a-constrained-host.md',
      'a locked decision and its rejected alternatives',
    ],
    [
      'docs/adr/0006-mobile-performance-tiers.md',
      'a locked decision and its rejected alternatives',
    ],
    ['docs/adr/0007-motionlab-as-host.md', 'a locked decision and its rejected alternatives'],
    ['docs/adr/0008-control-primitives.md', 'a locked decision and its rejected alternatives'],
    ['docs/design/lib-grain-engine.md', 'a design for code that does not exist yet'],
    ['docs/design/lib-nonlinear.md', 'a design for code that does not exist yet'],
    ['docs/design/lib-voice-substrate.md', 'a design for code that does not exist yet'],
    ['docs/DESIGN-DIRECTION.md', 'the visual identity argument and the mechanisms behind it'],
    ['docs/BUILD-PLAN-V2.md', 'the plan and the reasoning for its order'],
    ['docs/THIRD-PARTY-PLUGINS.md', 'research into what plugin support can mean for a browser DAW'],
    [
      'docs/REFERENCE-FSP8.md',
      'what the reference does, with sources — a description of somebody else’s product',
    ],
    ['docs/BETA-GUIDE.md', 'how to run a beta'],
    ['docs/QUICK-START.md', 'how to use the product'],
    ['docs/USER-MANUAL.md', 'how to use the product'],
    ['docs/FAQ.md', 'answers to questions'],
    [
      'docs/RELEASE-NOTES.md',
      'what changed in a shipped version — history, which does not go stale',
    ],
    [
      'docs/RELEASE-NOTES-V2.md',
      'what changed in a shipped version — history, which does not go stale',
    ],
    ['docs/RELEASE-CHECKLIST.md', 'the steps a release takes, not the state of one'],
    ['docs/PERFORMANCE.md', 'how the product is made fast, and the reasoning'],
    [
      'docs/HARDWARE_VERIFICATION.md',
      'what a device-dependent check would do and why the host cannot',
    ],
    ['docs/MANUAL_QA_UNITS.md', 'the manual procedure for a check no machine here can run'],
    [
      'docs/BROWSER-COMPATIBILITY.md',
      'what each engine supports — a description of somebody else’s product',
    ],
    [
      'docs/reference/forbidden-names.txt',
      'the trademarked names that may not appear under motionwave/',
    ],
    ...[
      'dyn-01-program-eq',
      'dyn-02-optical-leveller',
      'dyn-03-fet-limiter',
      'dyn-04-variable-mu',
      'dyn-05-console-eq',
      'fx-01-motion-shaper',
      'fx-02-granular-reverb',
      'fx-03-granular-delay',
      'smp-01-slipstream-sampler',
      'std-01-mpe-midi2',
      'syn-01-dco-poly',
      'syn-02-phase-distortion',
      'syn-03-analog-five',
      'syn-04-six-op-fm',
      'syn-05-matrix-twelve',
    ].map((n) => [
      `docs/reference/${n}.md`,
      'a Reference Spec Sheet: what the hardware does, with sources. It describes the world, not this product',
    ]),
  ].map(([path, why]) => [path, { kind: 'NARRATIVE', why }]),
]);
