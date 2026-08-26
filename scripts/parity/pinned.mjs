/**
 * The thirteen claims pinned to a predicate, one at a time.
 *
 * `scripts/parity/evidence.mjs` checks the audit against its own citations at
 * scale — 806 claims, automatically, without anybody writing an entry. These
 * thirteen predate it and stay, because they check something it cannot: not
 * that a cited file still exists, but that the *verdict* is still the right
 * one. `MISSING` with a true predicate is a claim that was closed and never
 * written down, which is what happened five times; `PARITY` with a false one
 * is a regression. A citation check would pass in both directions.
 *
 * These are the items the chapters name as their own priorities. When one of
 * them moves, somebody has already decided it matters.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');

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

export { read };

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
export const PINNED = [
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
export const expected = (claim) => claim.expect ?? claim.verdict === 'PARITY';
