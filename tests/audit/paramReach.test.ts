/**
 * PA probe 1 — does every declared control reach the graph, and does moving it
 * ramp or jump?
 *
 * Two questions the device-function audit answered by reading, asked here by
 * measurement instead, because "I traced it" and "the graph changed" are not
 * the same claim:
 *
 * 1. Move one parameter and nothing else. If no node state changes, the
 *    control is inert *in this configuration* — which is not the same as dead,
 *    because several controls only bite in one mode.
 * 2. Classify how the change was written. `setTargetAtTime` is a ramp and is
 *    inaudible; an assignment to `.value` or a replacement of `curve` or
 *    `buffer` is a step, and a step at automation rate is zipper noise.
 *
 * Nothing here renders audio. See `probeContext.ts` for what that costs.
 */
import { describe, expect, it } from 'vitest';
import { EFFECT_SPECS, defaultParams } from '../../src/model/effects';
import type { ParamSpec } from '../../src/model/effects';
import { buildEffectNode } from '../../src/audio/effectChain';
import type { Effect, EffectKind } from '../../src/model/types';
import { createProbeContext } from './probeContext';
import { isMotionWaveKind } from '../../src/audio/motionwave/registry';

const BPM = 120;

/**
 * Why the Motion Wave units are not probed here, and where they are instead.
 *
 * This probe watches a Web Audio graph: it builds a node in a fake context and
 * records which `AudioParam` writes and buffer replacements a control produces.
 * A Motion Wave unit has none of those. Its parameters cross into WebAssembly
 * through a `MessagePort`, and its processing happens on an audio thread this
 * probe does not have — the fake context has no `AudioWorklet` at all, so the
 * adapter correctly builds a pass-through and every control correctly reaches
 * nothing.
 *
 * Skipping them here would be exactly the grandfathering Directive 07 §6
 * forbids, so it is worth being precise about what covers them instead. The
 * question this probe asks — does every declared control reach the audio — is
 * asked of each unit by its own D1 cell, natively, against the real DSP:
 * `motionwave/core/test/*_delta_tests.cpp` sweeps every parameter of every unit
 * from the same generated table this file would read and requires a measurable
 * difference in the render. That is a stronger test than this one, because it
 * measures rendered audio rather than graph writes.
 *
 * What neither covers is whether the *host* reaches the unit, and that is
 * precisely what Ledger cell 25 is for. It cannot be answered in jsdom by
 * anything, because it is a question about a browser with an audio device.
 */
const MOTIONWAVE_COVERED_BY = 'D1 natively per unit, and Ledger cell 25 in the real app';

function effectOf(kind: EffectKind, overrides: Record<string, number> = {}): Effect {
  return {
    id: `fx-${kind}`,
    kind,
    bypass: false,
    params: { ...defaultParams(kind), ...overrides },
  };
}

/** A value clearly different from `from`, inside the spec's own range. */
function otherValue(p: ParamSpec, from: number): number {
  if (p.choices) {
    for (let i = 0; i < p.choices.length; i++) if (i !== Math.round(from)) return i;
    return from;
  }
  const mid = p.min + (p.max - p.min) * 0.73;
  return Math.abs(mid - from) > (p.max - p.min) * 0.05 ? mid : p.min + (p.max - p.min) * 0.21;
}

export interface ReachResult {
  kind: string;
  key: string;
  changed: boolean;
  /** Ways the change was written, deduplicated. */
  hows: string[];
  /** Node fields replaced outright (curve, buffer, …) rather than ramped. */
  steppedPaths: string[];
}

export function probeParameter(
  kind: EffectKind,
  p: ParamSpec,
  base: Record<string, number> = {},
): ReachResult {
  const probe = createProbeContext();
  const at = effectOf(kind, base);
  const node = buildEffectNode(probe.ctx, at);
  // Two settling updates: a builder that only writes a branch when it changes
  // must be given the chance to have written it once already.
  node.update(at, BPM, false);
  node.update(at, BPM, false);
  const before = probe.snapshot();
  probe.clear();

  const moved = effectOf(kind, { ...base, [p.key]: otherValue(p, at.params[p.key]) });
  node.update(moved, BPM, false);
  const after = probe.snapshot();

  const hows = [...new Set(probe.writes.filter((w) => !w.same).map((w) => w.how))].sort();
  const stepped = [
    ...new Set(
      probe.writes
        .filter((w) => !w.same && (w.how === 'assign' || w.how === 'field'))
        .map((w) => w.path),
    ),
  ].sort();
  node.dispose();
  return { kind, key: p.key, changed: before !== after, hows, steppedPaths: stepped };
}

/**
 * Controls whose whole job is the readout rather than the graph. Established by
 * the device-function audit and re-stated here so this probe's "no graph
 * change" for them is not read as a new finding.
 */
const READOUT_ONLY = new Set([
  'gainMatch:target',
  'tuner:reference',
  'analyser:view',
  // Vocal Tune is a declared pass-through: its six parameters drive the audio
  // editor's offline retune, not this graph. `buildPassThrough` is the whole
  // node, so none of them can move anything here and that is the design.
  'vocaltune:strength',
  'vocaltune:speed',
  'vocaltune:humanise',
  'vocaltune:scale',
  'vocaltune:key',
  'vocaltune:formant',
]);

/**
 * A configuration in which a control that is off by default can be seen to
 * work, keyed by `kind:param`. A control that needs one is not broken; what
 * would be broken is a control that does nothing in every configuration.
 */
const ACTIVATING: Record<string, Record<string, number>> = {
  'tremolo:division': { sync: 1 },
  'tremolo:modifier': { sync: 1 },
  'autopan:division': { sync: 1 },
  'autopan:modifier': { sync: 1 },
  'tremolo:rate': { sync: 0 },
  'autopan:rate': { sync: 0 },
  'flanger:depth': { delay: 12 },
  'chorus:depth': { delay: 30 },
  'eq8:hpQ': { hpOn: 1 },
  'eq8:lpQ': { lpOn: 1 },
  // A gain band's on/off switch ramps its gain to 0 dB when off. At the default
  // of 0 dB there is nothing to ramp to, so the switch is only visible on a
  // band that is boosting or cutting something.
  'eq8:lsOn': { lsGain: 6 },
  'eq8:b1On': { b1Gain: 6 },
  'eq8:b2On': { b2Gain: 6 },
  'eq8:b3On': { b3Gain: 6 },
  'eq8:b4On': { b4Gain: 6 },
  'eq8:hsOn': { hsGain: 6 },
  // The rotary reads one of its two rates, whichever the Speed switch selects.
  'rotary:fastRate': { speed: 1 },
  'rotary:slowRate': { speed: 0 },
};

describe('PA · every declared control reaches the graph', () => {
  const results: ReachResult[] = [];

  it('moves something in the audio graph for every parameter of every kind', () => {
    const inert: string[] = [];
    let skipped = 0;
    for (const spec of EFFECT_SPECS) {
      if (isMotionWaveKind(spec.kind)) {
        skipped += spec.params.length;
        continue;
      }
      for (const p of spec.params) {
        const id = `${spec.kind}:${p.key}`;
        let r = probeParameter(spec.kind, p);
        if (!r.changed && ACTIVATING[id]) r = probeParameter(spec.kind, p, ACTIVATING[id]);
        results.push(r);
        if (!r.changed && !READOUT_ONLY.has(id)) inert.push(id);
      }
    }
    // Printed rather than only asserted: the audit needs the list, not a pass.
    if (inert.length > 0) console.log('INERT CONTROLS:', inert.join(', '));
    console.log(
      `NOT PROBED HERE: ${skipped} Motion Wave parameter(s) — covered by ${MOTIONWAVE_COVERED_BY}.`,
    );
    expect(inert).toEqual([]);
    // And the skip is not silent: if the units ever stop being registered, this
    // count goes to zero and the reason above stops being true of anything.
    expect(skipped).toBeGreaterThan(0);
  });

  it('reports which controls step the graph instead of ramping it', () => {
    const stepping = results
      .filter((r) => r.steppedPaths.length > 0)
      .map((r) => `${r.kind}:${r.key} → ${r.steppedPaths.join(' ')}`);
    console.log(`STEPPING CONTROLS (${stepping.length}):\n  ${stepping.join('\n  ')}`);
    // No assertion: this is the measurement the automation finding is built on.
    expect(results.length).toBeGreaterThan(100);
  });
});

describe('PA · bypass is written as a ramp, never as a jump', () => {
  it('writes no outright assignment when an insert is switched in or out', () => {
    const faults: string[] = [];
    for (const spec of EFFECT_SPECS) {
      // See the note at the top: a Motion Wave unit writes no `AudioParam`, so
      // there is nothing here for this probe to classify. Its bypass is graded
      // by D4 natively, which nulls it against the dry signal at −240 dBFS.
      if (isMotionWaveKind(spec.kind)) continue;
      const probe = createProbeContext();
      const on = effectOf(spec.kind);
      const node = buildEffectNode(probe.ctx, on);
      node.update(on, BPM, false);
      node.update(on, BPM, false);
      probe.clear();
      node.update({ ...on, bypass: true }, BPM, true);
      const jumps = probe.writes.filter(
        (w) => !w.same && (w.how === 'assign' || w.how === 'field'),
      );
      if (jumps.length > 0) {
        faults.push(`${spec.kind}: ${[...new Set(jumps.map((j) => j.path))].join(' ')}`);
      }
      probe.clear();
      node.update(on, BPM, false);
      const back = probe.writes.filter((w) => !w.same && (w.how === 'assign' || w.how === 'field'));
      if (back.length > 0) {
        faults.push(`${spec.kind} (back in): ${[...new Set(back.map((j) => j.path))].join(' ')}`);
      }
      node.dispose();
    }
    if (faults.length > 0) console.log('BYPASS JUMPS:', faults.join('; '));
    expect(faults).toEqual([]);
  });
});
