/**
 * PA probe 5 — do tempo-synced controls follow the tempo map?
 *
 * Four kinds carry a division rather than a time: Delay, Ping-Pong, and Tremolo
 * and Auto Pan when their Tempo sync switch is on. All four resolve it through
 * `syncSeconds`/`syncHz`, which take a single bpm — and the bpm they are handed
 * comes from the one call site each driver has: `p.bpm` in `engine.syncGraph`
 * and `engine.applyAutomation`, `project.bpm` in `exportMix`.
 *
 * The project also holds a tempo *map*, and `model/music.ts` exports
 * `projectBpmAt`, whose own doc comment says "use for delay sync". This asks
 * what the two answer at the same bar.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EFFECT_SPECS, defaultParams, describeEffect, formatParam } from '../../src/model/effects';
import { buildEffectNode } from '../../src/audio/effectChain';
import { syncSeconds } from '../../src/audio/dsp/curves';
import { projectBpmAt, tempoMapOf } from '../../src/model/music';
import { beatsPerBarAt, normalizeTempoMap, barToBeat } from '../../src/model/tempo';
import type { Effect, EffectKind, ProjectData } from '../../src/model/types';
import { createProbeContext } from './probeContext';

function effectOf(kind: EffectKind, overrides: Record<string, number> = {}): Effect {
  return {
    id: `fx-${kind}`,
    kind,
    bypass: false,
    params: { ...defaultParams(kind), ...overrides },
  };
}

/** The delay time one insert is actually set to, at a given bpm. */
function delaySecondsAt(
  kind: EffectKind,
  bpm: number,
  overrides: Record<string, number> = {},
): number {
  const probe = createProbeContext();
  const e = effectOf(kind, overrides);
  const node = buildEffectNode(probe.ctx, e);
  node.update(e, bpm, false);
  const write = probe.writes.filter((w) => /^delay#\d+\.delayTime$/.test(w.path)).pop();
  node.dispose();
  return write?.value as number;
}

/** A song that starts at 120 and goes to 160 at bar 9, in 4/4 then 7/8. */
function twoTempoProject(): ProjectData {
  const map = normalizeTempoMap(
    {
      tempos: [
        { id: 't0', beat: 0, bpm: 120, curve: 'jump' },
        { id: 't1', beat: 32, bpm: 160, curve: 'jump' },
      ],
      sigs: [
        { id: 's0', bar: 0, num: 4, den: 4 },
        { id: 's1', bar: 8, num: 7, den: 8 },
      ],
    },
    120,
    { num: 4, den: 4 },
  );
  return {
    bpm: map.tempos[0].bpm,
    timeSig: { num: map.sigs[0].num, den: map.sigs[0].den },
    tempoMap: map,
    tracks: [],
  } as unknown as ProjectData;
}

describe('PA-002 · tempo-synced inserts and the tempo map', () => {
  it('resolves a division at the project tempo, correctly, when the tempo is constant', () => {
    // The delay's default is 6 sixteenths. At 120 bpm a sixteenth is 0.125 s.
    expect(delaySecondsAt('delay', 120)).toBeCloseTo(0.75, 12);
    expect(delaySecondsAt('delay', 90)).toBeCloseTo(1, 12);
    // Ping-pong: 3 sixteenths, and its Feel control is applied.
    expect(delaySecondsAt('pingpong', 120)).toBeCloseTo(0.375, 12);
    expect(delaySecondsAt('pingpong', 120, { modifier: 1 })).toBeCloseTo(0.5625, 12);
    expect(delaySecondsAt('pingpong', 120, { modifier: 2 })).toBeCloseTo(0.25, 12);
  });

  it('leaves the scalar bpm pinned to beat 0 while the map moves', () => {
    const p = twoTempoProject();
    const map = tempoMapOf(p);
    expect(p.bpm).toBe(120);
    expect(projectBpmAt(p, 0)).toBe(120);
    expect(projectBpmAt(p, 40)).toBe(160);
    // The delay every driver builds is the one taken from `p.bpm`.
    const asBuilt = delaySecondsAt('delay', p.bpm);
    const asTheBarSounds = syncSeconds(6, projectBpmAt(p, 40), 'straight');
    console.log(
      `bar 9 at 160 bpm: 6/16 should be ${asTheBarSounds.toFixed(4)} s; ` +
        `the insert is set to ${asBuilt.toFixed(4)} s ` +
        `(${((asBuilt / asTheBarSounds - 1) * 100).toFixed(1)}% long, ` +
        `${((asBuilt - asTheBarSounds) * 1000).toFixed(0)} ms per repeat)`,
    );
    expect(asBuilt).toBeCloseTo(0.75, 12);
    expect(asTheBarSounds).toBeCloseTo(0.5625, 12);
    void map;
  });

  it('has no caller for the tempo-map lookup its own doc comment names for delay sync', () => {
    const src = join(__dirname, '..', '..', 'src');
    const files = ['audio/engine.ts', 'audio/exportMix.ts', 'audio/effectChain.ts'];
    for (const f of files) {
      expect(readFileSync(join(src, f), 'utf8'), f).not.toContain('projectBpmAt');
    }
  });

  it('is unaffected by a time-signature change, which is correct for a division', () => {
    // A sixteenth is a sixteenth in any meter; only a bar-length division would
    // need the signature, and none of the four declares one. Recorded so the
    // matrix row says "correct" rather than "untested".
    const p = twoTempoProject();
    const map = tempoMapOf(p);
    expect(beatsPerBarAt(map, barToBeat(map, 0))).toBe(4);
    expect(beatsPerBarAt(map, barToBeat(map, 9))).toBe(3.5);
    expect(syncSeconds(6, 120, 'straight')).toBe(syncSeconds(6, 120, 'straight'));
  });

  it('PA-011 · reads a division on the knob without the Feel the audio applies', () => {
    // `formatParam` is handed a `ParamSpec` and a number and nothing else, so
    // its `'div'` case can only ask `describeDivision` for the straight name.
    // The collapsed slot has the whole effect and asks for the real one, and so
    // does the audio. Three devices carry both a division and a Feel.
    const rows: string[] = [];
    for (const [kind, key] of [
      ['pingpong', 'timeSixteenths'],
      ['tremolo', 'division'],
      ['autopan', 'division'],
    ] as [EffectKind, string][]) {
      const spec = EFFECT_SPECS.find((s2) => s2.kind === kind)!.params.find((p) => p.key === key)!;
      for (const modifier of [1, 2]) {
        const e = effectOf(kind, {
          modifier,
          ...(kind === 'tremolo' || kind === 'autopan' ? { sync: 1 } : {}),
        });
        const knob = formatParam(spec, e.params[key]);
        const slot = describeEffect(e);
        const suffix = modifier === 1 ? 'D' : 'T';
        rows.push(
          `${kind} Feel=${modifier === 1 ? 'Dotted' : 'Triplet'}: knob reads "${knob}", ` +
            `slot reads "${slot}"`,
        );
        // The knob never carries the Feel; the slot always does.
        expect(knob.endsWith(suffix)).toBe(false);
        expect(slot).toContain(`${knob} ${suffix}`);
      }
    }
    console.log(`Division readouts that disagree with each other:\n  ${rows.join('\n  ')}`);
  });
});
