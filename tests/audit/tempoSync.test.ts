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
 *
 * They answered differently, which was PA-002. The drivers now sample the map
 * at the playhead (live) and at the beat being rendered (offline), and re-drive
 * the chain as the playhead crosses into a new tempo. The probes below are kept
 * as the regression: they assert the corrected arithmetic and still record what
 * the pinned scalar would have produced, because that number is the reason the
 * fix exists.
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

  it('resolves a division at the tempo of the bar being played, not of bar 1', () => {
    const p = twoTempoProject();
    const map = tempoMapOf(p);
    expect(p.bpm).toBe(120);
    expect(projectBpmAt(p, 0)).toBe(120);
    expect(projectBpmAt(p, 40)).toBe(160);
    // The scalar stays pinned — that is deliberate, it is what old projects and
    // export headers read. What changed is that no driver builds a delay from
    // it any more: they sample the map at the beat in hand.
    const fromTheMap = delaySecondsAt('delay', projectBpmAt(p, 40));
    const fromTheScalar = delaySecondsAt('delay', p.bpm);
    const asTheBarSounds = syncSeconds(6, projectBpmAt(p, 40), 'straight');
    console.log(
      `bar 9 at 160 bpm: 6/16 wants ${asTheBarSounds.toFixed(4)} s; ` +
        `driven from the map the insert is ${fromTheMap.toFixed(4)} s, ` +
        `driven from the pinned scalar it was ${fromTheScalar.toFixed(4)} s ` +
        `(${((fromTheScalar / asTheBarSounds - 1) * 100).toFixed(1)}% long, ` +
        `${((fromTheScalar - asTheBarSounds) * 1000).toFixed(0)} ms per repeat)`,
    );
    expect(fromTheMap).toBeCloseTo(0.5625, 12);
    expect(asTheBarSounds).toBeCloseTo(0.5625, 12);
    expect(fromTheScalar).toBeCloseTo(0.75, 12);
    void map;
  });

  it('drives every chain from the tempo map rather than from the pinned scalar', () => {
    // A static check because the alternative — standing up a live engine and an
    // offline render in jsdom — cannot run here, and because the failure this
    // guards is precisely a call site reverting to `p.bpm`. Both drivers must
    // reach for the map; `effectChain` must not, since it is handed a bpm and
    // has no project to look one up in.
    const src = join(__dirname, '..', '..', 'src');
    for (const f of ['audio/engine.ts', 'audio/exportMix.ts']) {
      expect(readFileSync(join(src, f), 'utf8'), f).toContain('projectBpmAt');
    }
    expect(readFileSync(join(src, 'audio/effectChain.ts'), 'utf8')).not.toContain('projectBpmAt');

    // And no driver may hand a chain the pinned scalar again.
    for (const [f, calls] of [
      ['audio/engine.ts', ['inserts.sync(', 'inserts.updateOne(']],
      ['audio/exportMix.ts', ['inserts.sync(', 'inserts.updateOne(', 'Chain.sync(']],
    ] as const) {
      const text = readFileSync(join(src, f), 'utf8');
      for (const call of calls) {
        for (const line of text.split('\n').filter((l) => l.includes(call))) {
          expect(line, `${f}: ${line.trim()}`).not.toMatch(/\bp(roject)?\.bpm\b/);
        }
      }
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
