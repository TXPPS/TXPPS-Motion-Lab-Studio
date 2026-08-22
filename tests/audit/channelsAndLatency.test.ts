/**
 * PA probe 10 — channel configuration, and what each insert declares about its
 * own latency.
 *
 * Channels: Web Audio up-mixes by rule, so most inserts are channel-count
 * agnostic and need no case. The ones that are not are the five that force an
 * explicit two-channel interpretation with `makeStereoTap`, and the two that
 * take the image apart with a splitter. This lists them and checks the one
 * property a mid/side network has to have on a mono input — that the side
 * channel is silent, so a mono source is unchanged by a width control.
 *
 * Latency: `EffectNode` has no latency member, so nothing an insert adds is
 * declared to anything. What each one adds is still knowable, and the two that
 * are arithmetic rather than the browser's are computed here.
 */
import { describe, expect, it } from 'vitest';
import { EFFECT_SPECS, defaultParams, CRUSH_FACTORS } from '../../src/model/effects';
import { buildEffectNode } from '../../src/audio/effectChain';
import { crusherGroupDelaySamples } from '../../src/audio/dsp/curves';
import type { Effect, EffectKind } from '../../src/model/types';
import { createProbeContext } from './probeContext';

const BPM = 120;
const SR = 48000;

function effectOf(kind: EffectKind, overrides: Record<string, number> = {}): Effect {
  return {
    id: `fx-${kind}`,
    kind,
    bypass: false,
    params: { ...defaultParams(kind), ...overrides },
  };
}

function built(kind: EffectKind, overrides: Record<string, number> = {}, bypass = false) {
  const probe = createProbeContext(SR);
  const e = effectOf(kind, overrides);
  const node = buildEffectNode(probe.ctx, e);
  node.update({ ...e, bypass }, BPM, bypass);
  node.update({ ...e, bypass }, BPM, bypass);
  return { probe, node, effect: e };
}

describe('PA · mono, stereo and mono→stereo instantiation', () => {
  it('names the inserts that force a two-channel up-mix, and only those', () => {
    const forcing: string[] = [];
    const splitting: string[] = [];
    for (const spec of EFFECT_SPECS) {
      const { probe, node } = built(spec.kind);
      const explicit = probe
        .nodesOfKind('gain')
        .filter((g) => g.channelCountMode === 'explicit' && g.channelCount === 2);
      if (explicit.length > 0) forcing.push(`${spec.kind} (${explicit.length})`);
      if (probe.nodesOfKind('splitter').length > 0) splitting.push(spec.kind);
      node.dispose();
    }
    console.log(`forces a stereo up-mix: ${forcing.join(', ')}`);
    console.log(`takes the image apart with a splitter: ${splitting.join(', ')}`);
    expect(forcing.map((f) => f.split(' ')[0])).toEqual([
      'chorus',
      'tremolo',
      'rotary',
      'width',
      'autopan',
    ]);
    expect(splitting).toEqual(['tremolo', 'width']);
  });

  it('gives Stereo Width a side channel that is silent for a mono source', () => {
    // Mono arrives up-mixed as L = R, so side = 0.5·L − 0.5·R is exactly zero
    // whatever Width is set to, and the processor is a wire for mono material.
    // The two gains that build it are the invariant: +0.5 and −0.5.
    const { probe, node } = built('width', { width: 2 });
    const halves = probe
      .nodesOfKind('gain')
      .map((g) => (g.gain as { value: number }).value)
      .filter((v) => Math.abs(Math.abs(v) - 0.5) < 1e-12);
    // midFromLeft, midFromRight and sideFromLeft at +0.5; sideFromRight at −0.5.
    expect(halves.filter((v) => v > 0).length).toBe(3);
    expect(halves.filter((v) => v < 0).length).toBe(1);
    node.dispose();
  });

  it("keeps the tremolo's two channels at the same depth, so mono stays centred at 0°", () => {
    const { probe, node } = built('tremolo', { depth: 0.8, phaseOffset: 0 });
    const depths = probe.writes.filter((w) => w.value === 0.4 && w.how === 'setTarget');
    // leftDepth and rightDepth both at depth/2.
    expect(new Set(depths.map((d) => d.path)).size).toBe(2);
    node.dispose();
  });
});

describe('PA-009 · declared latency', () => {
  it('declares none: no insert publishes a latency figure at all', () => {
    for (const spec of EFFECT_SPECS) {
      const { node } = built(spec.kind);
      expect(Object.keys(node), spec.kind).not.toContain('latencySec');
      expect(Object.keys(node), spec.kind).not.toContain('latencySamples');
      node.dispose();
    }
  });

  it("computes the crusher's own delay exactly, and matches its dry alignment to it", () => {
    const rows: string[] = [];
    for (let i = 0; i < CRUSH_FACTORS.length; i++) {
      const factor = CRUSH_FACTORS[i];
      const stages = Math.round(Math.log2(factor));
      const { probe, node } = built('bitcrusher', { downsample: i, mix: 0.5 });
      // The alignment delay is the one whose target the builder writes; it is
      // the only DelayNode in this graph that is not a fixed power of two.
      const written = probe.writes
        .filter((w) => /^delay#\d+\.delayTime$/.test(w.path) && w.how === 'setTarget')
        .pop();
      const alignedSamples = (written?.value as number) * SR;
      const expected = crusherGroupDelaySamples(stages);
      rows.push(
        `${factor}× → ${stages} stages, ${expected} samples (${((expected / SR) * 1000).toFixed(3)} ms), dry leg held ${alignedSamples.toFixed(1)}`,
      );
      expect(alignedSamples).toBeCloseTo(expected, 9);
      node.dispose();
    }
    console.log(
      `Bitcrusher group delay, uncompensated against the rest of the session:\n  ${rows.join('\n  ')}`,
    );
  });

  it("returns the limiter's lookahead to zero on bypass, and applies it otherwise", () => {
    for (const ms of [0.5, 3, 10]) {
      const { probe, node } = built('limiter', { lookahead: ms });
      const set = probe.writes.filter((w) => /^delay#\d+\.delayTime$/.test(w.path)).pop();
      expect((set?.value as number) * 1000).toBeCloseTo(ms, 9);
      node.dispose();
    }
    const { probe, node } = built('limiter', { lookahead: 10 }, true);
    const set = probe.writes.filter((w) => /^delay#\d+\.delayTime$/.test(w.path)).pop();
    expect(set?.value).toBe(0);
    node.dispose();
  });

  it("takes the limiter's oversampled clipper off every live route when bypassed", () => {
    // `docs/KNOWN-LIMITATIONS.md` says the limiter's 192-sample clipper stage is
    // "present even when the insert is bypassed". The clipper's wet leg is now
    // muted and a dry leg opened, so it is not.
    const { probe, node } = built('limiter', {}, true);
    const shapers = probe.nodesOfKind('waveshaper').filter((w) => w.oversample === '4x');
    expect(shapers.length).toBe(1);
    const clipper = shapers[0].name as string;
    const feedsFrom = probe.connections.filter((c) => c.from === clipper);
    expect(feedsFrom.length).toBeGreaterThan(0);
    // Whatever the shaper feeds is held at zero while bypassed: `postClip`.
    const downstream = feedsFrom.map((c) => c.to);
    const muted = probe
      .nodesOfKind('gain')
      .filter((g) => downstream.includes(g.name as string))
      .map((g) => (g.gain as { value: number }).value);
    console.log(`bypassed limiter: the 4× clipper feeds gain(s) at ${muted.join(', ')}`);
    expect(muted).toEqual([0]);
    node.dispose();
  });
});

/**
 * The product of the gain nodes around every simple cycle in a recorded graph.
 *
 * A feedback loop grows without bound when the gain round it reaches one, so
 * this is the number the clamps exist to hold down. Only `GainNode`s are
 * counted: the filters these loops contain are a Butterworth pass pair and a
 * chain of allpasses, none of which exceeds unity magnitude anywhere, and a
 * `DelayNode` is unity by definition.
 */
function loopGains(
  probe: ReturnType<typeof createProbeContext>,
): { cycle: string; gain: number }[] {
  const out: { cycle: string; gain: number }[] = [];
  const edges = new Map<string, string[]>();
  for (const c of probe.connections) {
    if (c.to.includes('.')) continue; // a parameter connection, not a signal one
    if (!edges.has(c.from)) edges.set(c.from, []);
    edges.get(c.from)!.push(c.to);
  }
  const gainOf = new Map<string, number>();
  for (const g of probe.nodesOfKind('gain')) {
    gainOf.set(g.name as string, (g.gain as { value: number }).value);
  }
  const walk = (start: string, at: string, path: string[]): void => {
    for (const next of edges.get(at) ?? []) {
      if (next === start) {
        const cycle = [...path, next];
        const gain = cycle.reduce((p2, n) => p2 * (gainOf.get(n) ?? 1), 1);
        out.push({ cycle: cycle.join('→'), gain: Math.abs(gain) });
      } else if (!path.includes(next)) {
        walk(start, next, [...path, next]);
      }
    }
  };
  for (const node of edges.keys()) walk(node, node, [node]);
  return out;
}

describe('PA · extreme values and runaway', () => {
  it('holds every signal feedback loop below unity at both ends of its control', () => {
    const rows: string[] = [];
    for (const kind of ['delay', 'pingpong', 'flanger', 'phaser'] as EffectKind[]) {
      for (const v of [-5, 5]) {
        const { probe, node } = built(kind, { feedback: v });
        const loops = loopGains(probe);
        expect(loops.length, `${kind} has no loop to measure`).toBeGreaterThan(0);
        const worst = Math.max(...loops.map((l) => l.gain));
        rows.push(`${kind} feedback=${v} → ${loops.length} loop(s), largest loop gain ${worst}`);
        expect(worst, `${kind} at feedback ${v}`).toBeLessThanOrEqual(0.9 + 1e-12);
        node.dispose();
      }
    }
    for (const kind of ['compressor', 'gate', 'limiter', 'deesser'] as EffectKind[]) {
      const { probe, node } = built(kind);
      const loops = loopGains(probe);
      const worst = Math.max(...loops.map((l) => l.gain));
      rows.push(`${kind} control smoothers → ${loops.length} loop(s), largest loop gain ${worst}`);
      // `Smoother`'s pole: strictly below one at any ballistic setting, which is
      // what keeps its DC gain at exactly one rather than above it.
      expect(worst, kind).toBeLessThan(1);
      node.dispose();
    }
    console.log(`Loop gains at the rails:\n  ${rows.join('\n  ')}`);
  });

  it('finds no feedback loop at all in the twenty-one kinds that declare none', () => {
    const looping: string[] = [];
    for (const spec of EFFECT_SPECS) {
      const { probe, node } = built(spec.kind);
      if (loopGains(probe).length > 0) looping.push(spec.kind);
      node.dispose();
    }
    console.log(`kinds containing a feedback loop: ${looping.join(', ')}`);
    expect(looping.sort()).toEqual(
      ['compressor', 'deesser', 'delay', 'flanger', 'gate', 'limiter', 'phaser', 'pingpong'].sort(),
    );
  });
});

describe("PA-012 · the Filter's Drive is a second uncompensated parallel blend", () => {
  it('runs an oversampled shaper against a dry wire at every intermediate setting', () => {
    // `docs/KNOWN-LIMITATIONS.md` states that the saturator's and the
    // distortion's Mix is "the one place a comb is not compensated". The
    // Filter's Drive is built the same way — `DriveStage` crossfades a
    // `'4x'` shaper against a wire by the drive amount — and is not mentioned.
    const rows: string[] = [];
    for (const drive of [0, 6, 12, 18, 24]) {
      const { probe, node } = built('filter', { drive });
      const shaper = probe.nodesOfKind('waveshaper').find((w) => w.oversample === '4x');
      expect(shaper, 'the drive stage builds no 4× shaper').toBeTruthy();
      const feeds = probe.connections
        .filter((c) => c.from === (shaper!.name as string))
        .map((c) => c.to);
      const wet = probe
        .nodesOfKind('gain')
        .filter((g) => feeds.includes(g.name as string))
        .map((g) => (g.gain as { value: number }).value)[0];
      rows.push(`drive ${drive} dB → shaped leg at ${wet}, dry leg at ${(1 - wet).toFixed(4)}`);
      expect(wet).toBeCloseTo(drive / 24, 12);
      node.dispose();
    }
    console.log(`Filter · Drive, an uncompensated parallel blend:\n  ${rows.join('\n  ')}`);
  });
});
