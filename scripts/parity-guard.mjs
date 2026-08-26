/**
 * The FSP8 parity audit, kept honest against the code it describes.
 *
 *   node scripts/parity-guard.mjs           # verdicts against the repository
 *   node scripts/parity-guard.mjs --list    # what is claimed, and where
 *
 * `docs/reference/fsp8-parity-*.md` is eleven thousand lines of verdicts —
 * `PARITY`, `PARTIAL`, `MISSING`, `DIVERGENT-BY-DESIGN` — taken by reading the
 * reference manual against this repository at one moment. Nothing has kept them
 * matching since, and five of the eight items those documents name as their own
 * priorities had been closed while the documents still called them missing. The
 * headline one — "the cheapest high-value item is that **no keyboard shortcut
 * opens any pane**" — is answered by nine shortcuts that have been in
 * `src/app/shortcuts.ts` for directives.
 *
 * A stale audit is worse than no audit, for the same reason a configured check
 * nobody invokes is worse than a missing one: it is *evidence*, and it stops
 * anybody looking. So every claim the audit makes about MotionLab's own code
 * that can be settled by reading that code is settled here, on every build, and
 * a verdict that has moved fails rather than rots.
 *
 * This does not check the reference half. Whether FSP8 does what the manual
 * says is not knowable from this repository, and pretending otherwise would be
 * the second opinion CLAUDE.md's rule is about. What is checkable is the half
 * that is ours: does MotionLab still do — or still not do — what the verdict
 * says it does.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const LIST = process.argv.includes('--list');

const read = (path) => {
  try {
    return readFileSync(join(ROOT, path), 'utf8');
  } catch {
    return '';
  }
};
/** True when every pattern appears in the file. */
const has = (path, ...patterns) => {
  const src = read(path);
  return patterns.every((p) => (p instanceof RegExp ? p.test(src) : src.includes(p)));
};

/**
 * Each claim the audit makes about this repository, and how to settle it.
 *
 * `verdict` is what the document currently says. `holds` returns true when
 * MotionLab *does* the thing. They must agree: `PARITY` with a false predicate
 * is a claim that regressed, and `MISSING` with a true one is a claim that was
 * closed and never written down. Both are failures, and the second is the one
 * that actually happened — five times.
 *
 * `anchor` is text that must still be in the named document. Without it a claim
 * could be deleted from the audit and go on being checked here, which is the
 * same drift in the other direction.
 */
const CLAIMS = [
  {
    id: 'spec/pane-shortcuts',
    doc: 'docs/reference/fsp8-parity-spec.md',
    anchor: 'The cheapest high-value item is that',
    what: 'a keyboard shortcut opens a pane',
    verdict: 'PARITY',
    holds: () =>
      has('src/app/shortcuts.ts', "id: 'panel-editor'", "id: 'panel-mixer'", "id: 'panel-browser'"),
  },
  {
    id: 'fundamentals/pdc-in-transport',
    doc: 'docs/reference/fsp8-parity-fundamentals.md',
    anchor: 'Total PDC displayed in the transport',
    what: 'the transport shows what delay compensation is costing',
    verdict: 'PARITY',
    holds: () =>
      has('src/components/transport/TransportBar.tsx', 'pdcSamples') &&
      has('src/state/transportStore.ts', 'pdcSamples') &&
      has('src/audio/engine.ts', 'pdcSamples: plan.commonSamples'),
  },
  {
    id: 'recording/monitor-follows-arm',
    doc: 'docs/reference/fsp8-parity-recording.md',
    anchor: 'monitoring-follows-arm',
    what: 'arming a track opens its monitor, under a named preference',
    verdict: 'PARITY',
    holds: () =>
      has('src/app/monitorActions.ts', 'monitorFollowsArm') &&
      has('src/components/settings/SettingsSheet.tsx', 'monitorFollowsArm'),
  },
  {
    id: 'recording/mono-input-is-constrained',
    doc: 'docs/reference/fsp8-parity-recording.md',
    anchor: 'channelCount: { exact: 1 }',
    what: 'a mono track asks for one channel as a constraint rather than a hint',
    verdict: 'PARITY',
    holds: () => has('src/audio/inputManager.ts', /channelCount:\s*\{\s*exact:/),
  },
  {
    id: 'recording/track-declares-its-width',
    doc: 'docs/reference/fsp8-parity-recording.md',
    anchor: 'mono vs stereo',
    what: 'a track records at a declared width rather than at whatever arrived',
    verdict: 'PARTIAL',
    expect: true,
    // Partial on purpose, and the predicate says which half. The width is
    // declared per track; what is still missing is the reference's *portable
    // named channel* layer, which is a different object and would be a schema
    // change rather than a field.
    holds: () =>
      has('src/model/types.ts', 'inputChannels?: 1 | 2') &&
      !has('src/model/types.ts', 'InputChannelSet'),
  },
  {
    id: 'mixing/pan-law-is-minus-three',
    doc: 'docs/reference/fsp8-parity-spec.md',
    anchor: 'a **−3 dB pan law**',
    what: 'panning uses the constant-power law, inherited rather than chosen',
    verdict: 'PARITY',
    // A pan law is not a line of code, so this is checked where the product
    // asserts it — a bare `createStereoPanner` is the spec-defined −3.01 dB,
    // and a hand-rolled gain pair would be the thing to catch.
    holds: () =>
      has('src/audio/engine.ts', 'createStereoPanner') &&
      has('src/audio/exportMix.ts', 'createStereoPanner'),
  },
  {
    id: 'mixing/metering-scales',
    doc: 'docs/reference/fsp8-parity-mixing.md',
    anchor: 'K-20',
    what: 'the meters offer the three reference scales',
    verdict: 'MISSING',
    holds: () => has('src/model/metering.ts', 'K-20', 'K-14', 'K-12'),
  },
  {
    id: 'mixing/no-second-post-fader-rack',
    doc: 'docs/reference/fsp8-parity-spec.md',
    anchor: 'second post-fader insert rack',
    what: 'the main output has one insert rack, not two',
    verdict: 'PARITY',
    holds: () => !has('src/model/types.ts', 'postFaderEffects'),
  },
  {
    id: 'fundamentals/undo-history-browser',
    doc: 'docs/reference/fsp8-parity-fundamentals.md',
    anchor: 'Undo History browser',
    what: 'the undo stack carries a label per entry, so a history list is buildable',
    verdict: 'MISSING',
    holds: () => has('src/state/projectStore.ts', /undoLabels|undoStack:\s*\{\s*label/),
  },
  // ---- and the MotionLab backlog, which had gone stale the same way ----
  {
    id: 'backlog/ra-006-insert-button',
    doc: 'docs/BACKLOG_MOTIONLAB.md',
    anchor: 'RA-006',
    what: 'a press on a strip does not move the console under the pointer',
    verdict: 'PARITY',
    holds: () => has('src/components/mixer/ChannelOverview.tsx', 'useSettledSelection'),
  },
  {
    id: 'backlog/pa-012-filter-drive',
    doc: 'docs/BACKLOG_MOTIONLAB.md',
    anchor: 'PA-012',
    what: "the Filter's Drive aligns its own dry leg",
    verdict: 'PARITY',
    holds: () => has('src/audio/effectChain.ts', /this.align.delayTime/),
  },
  {
    id: 'backlog/pa-009-bypassed-limiter',
    doc: 'docs/BACKLOG_MOTIONLAB.md',
    anchor: 'PA-009',
    what: 'a bypassed limiter declares no latency',
    verdict: 'PARITY',
    // A plain substring, not a regex: the declaration is formatted across
    // lines and a pattern that tries to match the whitespace between them is a
    // pattern that breaks the next time prettier reflows it.
    holds: () => has('src/audio/effectChain.ts', 'lastBypass'),
  },
  {
    id: 'fundamentals/per-track-delay',
    doc: 'docs/reference/fsp8-parity-fundamentals.md',
    anchor: 'Manual per-track delay',
    what: 'a track can be nudged by a manual delay in milliseconds',
    verdict: 'MISSING',
    holds: () => has('src/model/types.ts', 'delayMs'),
  },
];

/**
 * What the predicate must return for the recorded verdict to still be true.
 *
 * Stated per claim rather than derived from the verdict word: `PARTIAL` means
 * "some of it", and its predicate is written to describe the half that is
 * there — so inferring `false` from the label would fail every partial claim
 * the moment it was written.
 */
const expected = (claim) => claim.expect ?? claim.verdict === 'PARITY';

if (LIST) {
  console.log('FSP8 parity claims checked against this repository:\n');
  for (const c of CLAIMS) {
    console.log(`  ${c.verdict.padEnd(8)} ${c.holds() ? 'holds ' : 'absent'}  ${c.id} — ${c.what}`);
  }
  process.exit(0);
}

const problems = [];
for (const claim of CLAIMS) {
  if (!read(claim.doc).includes(claim.anchor)) {
    problems.push(
      `${claim.id}: "${claim.anchor}" is no longer in ${claim.doc}. ` +
        'Either the claim moved and this entry needs its new anchor, or it was dropped ' +
        'and this entry should go with it.',
    );
    continue;
  }
  const actual = claim.holds();
  if (actual === expected(claim)) continue;
  problems.push(
    actual
      ? `${claim.id}: recorded ${claim.verdict}, and the code now does it — ${claim.what}. ` +
          `Update ${claim.doc} and the verdict here in the same commit.`
      : `${claim.id}: recorded ${claim.verdict}, and the code no longer does it — ${claim.what}. ` +
          'That is a regression, not a stale document.',
  );
}

if (problems.length > 0) {
  console.error('parity-guard: the audit and the code disagree.\n');
  for (const p of problems) console.error(`  ${p}\n`);
  process.exit(1);
}
const parity = CLAIMS.filter((c) => c.verdict === 'PARITY').length;
console.log(
  `parity-guard: ${CLAIMS.length} checked claim(s) — ${parity} at parity, ` +
    `${CLAIMS.length - parity} still open, and every one of them settled by reading the code.`,
);
