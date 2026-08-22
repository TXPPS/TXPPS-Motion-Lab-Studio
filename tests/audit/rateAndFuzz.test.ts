/**
 * PA probes 3 and 4 — sample-rate independence, and the parameter-space fuzz.
 *
 * Sample rate: every builder is handed a context and several of them read
 * `ctx.sampleRate`. The question is which of the numbers they write change with
 * it, and whether each one that does *should*. A delay expressed in seconds must
 * not; a hold expressed in samples must.
 *
 * Fuzz: no combination of parameter values may put a NaN or an Infinity into an
 * `AudioParam`, a `WaveShaper.curve` or a `ConvolverNode.buffer`. A NaN that
 * reaches an AudioParam is unrecoverable — the node emits NaN for the rest of
 * the session and the channel is silently dead — which is why `setParam` guards
 * it, and why the places that do not go through `setParam` are what this looks
 * at.
 */
import { describe, expect, it } from 'vitest';
import { EFFECT_SPECS, defaultParams, normaliseParams } from '../../src/model/effects';
import { buildEffectNode } from '../../src/audio/effectChain';
import type { Effect, EffectKind } from '../../src/model/types';
import { createProbeContext } from './probeContext';

const BPM = 120;
const RATES = [44100, 48000, 88200, 96000, 192000];

function effectOf(kind: EffectKind, overrides: Record<string, number> = {}): Effect {
  return { id: `fx-${kind}`, kind, bypass: false, params: { ...defaultParams(kind), ...overrides } };
}

/** Every settled parameter target in the graph, keyed by node and field. */
function settled(kind: EffectKind, rate: number): Map<string, number> {
  const probe = createProbeContext(rate);
  const e = effectOf(kind);
  const node = buildEffectNode(probe.ctx, e);
  node.update(e, BPM, false);
  node.update(e, BPM, false);
  const out = new Map<string, number>();
  for (const w of probe.writes) {
    if (typeof w.value === 'number') out.set(w.path, w.value);
  }
  node.dispose();
  return out;
}

/** Web Audio's render quantum, which is what `Smoother` places its pole from. */
const RENDER_QUANTUM = 128;

/**
 * The exponential time constant a one-pole feedback gain stands for at a rate.
 *
 * `Smoother` closes a loop round a `DelayNode` that Web Audio pins to one
 * render quantum, so its pole is `g = exp(-quantum / (rate · tau))`. A gain that
 * moves with the sample rate is therefore not automatically a bug: if the tau it
 * implies is the *same* at every rate, the rate has been compensated for
 * exactly, which is the whole reason the gain moves. The complement `1 - g` is
 * the tap gain that rides with it.
 */
function impliedTau(gain: number, rate: number): number {
  const period = RENDER_QUANTUM / rate;
  return -period / Math.log(gain);
}

describe('PA · sample-rate independence, 44.1 / 48 / 88.2 / 96 / 192 kHz', () => {
  it('writes the same time-based numbers at every rate, for every kind', () => {
    const drifting = new Map<string, { rate: number; value: number }[]>();
    for (const spec of EFFECT_SPECS) {
      const base = settled(spec.kind, RATES[0]);
      for (const rate of RATES.slice(1)) {
        const here = settled(spec.kind, rate);
        for (const [path, v] of base) {
          const w = here.get(path);
          expect(w, `${spec.kind} ${path} missing at ${rate}`).toBeTypeOf('number');
          if (Object.is(v, w)) continue;
          if (Math.abs((w as number) - v) / Math.max(1e-12, Math.abs(v)) < 1e-12) continue;
          const key = `${spec.kind} ${path}`;
          if (!drifting.has(key)) drifting.set(key, [{ rate: RATES[0], value: v }]);
          drifting.get(key)!.push({ rate, value: w as number });
        }
      }
    }

    /** Each drifting field, classified by what its movement means. */
    const holds: string[] = [];
    const poles: string[] = [];
    const unexplained: string[] = [];
    for (const [key, samples] of drifting) {
      const ratios = samples.map((s) => (s.value * s.rate) / (samples[0].value * samples[0].rate));
      if (ratios.every((r) => Math.abs(r - 1) < 1e-9)) {
        holds.push(`${key} = ${(samples[0].value * samples[0].rate).toFixed(3)} samples at every rate`);
        continue;
      }
      // The pole, or the tap gain that complements it.
      for (const form of [(v: number) => v, (v: number) => 1 - v]) {
        const taus = samples.map((s) => impliedTau(form(s.value), s.rate));
        const spread = Math.max(...taus) / Math.min(...taus) - 1;
        if (Number.isFinite(spread) && spread < 1e-9) {
          poles.push(`${key} → time constant ${(taus[0] * 1000).toFixed(4)} ms at every rate`);
          break;
        }
      }
      if (!poles.some((p) => p.startsWith(key))) unexplained.push(key);
    }

    console.log(
      `Sample-rate sweep over ${EFFECT_SPECS.length} kinds:\n` +
        `  ${drifting.size} parameter targets move with the rate\n` +
        `  ${holds.length} are a fixed number of SAMPLES:\n    ${holds.join('\n    ')}\n` +
        `  ${poles.length} are smoother poles holding a fixed TIME:\n    ${poles.join('\n    ')}\n` +
        `  ${unexplained.length} unexplained: ${unexplained.join(', ') || 'none'}`,
    );
    expect(unexplained).toEqual([]);
  });

  it('scales the crusher hold exactly with the rate, so its divide stays a divide', () => {
    const a = settled('bitcrusher', 48000);
    const b = settled('bitcrusher', 96000);
    const holds = [...a.keys()].filter((k) => /^delay#\d+\.delayTime$/.test(k));
    expect(holds.length).toBeGreaterThan(0);
    for (const h of holds) {
      const va = a.get(h)!;
      const vb = b.get(h)!;
      if (va === 0) {
        expect(vb).toBe(0);
        continue;
      }
      expect(vb / va).toBeCloseTo(0.5, 12);
    }
  });

  it('keeps the reverb tail the same length in seconds at every rate', () => {
    const lengths = RATES.map((rate) => {
      const probe = createProbeContext(rate);
      const e = effectOf('reverb');
      const node = buildEffectNode(probe.ctx, e);
      node.update(e, BPM, false);
      const w = probe.writes.find((x) => x.path.endsWith('.buffer'));
      const m = /buffer\(\d+x(\d+)\)/.exec(String(w?.value ?? ''));
      node.dispose();
      return { rate, frames: Number(m?.[1] ?? 0) };
    });
    console.log(
      'reverb impulse: ' +
        lengths.map((l) => `${l.rate} Hz → ${l.frames} frames (${(l.frames / l.rate).toFixed(3)} s)`).join(', '),
    );
    for (const l of lengths) expect(l.frames / l.rate).toBeCloseTo(1.8, 4);
  });

  it('keeps a tempo-synced delay at the same seconds at every rate', () => {
    for (const kind of ['delay', 'pingpong'] as EffectKind[]) {
      const times = RATES.map((rate) => settled(kind, rate));
      const first = [...times[0]].filter(([k]) => /delay#\d+\.delayTime$/.test(k));
      expect(first.length).toBeGreaterThan(0);
      for (const [path, v] of first) {
        for (const t of times) expect(t.get(path), `${kind} ${path}`).toBeCloseTo(v, 12);
      }
    }
  });
});

// ------------------------------------------------------------------- the fuzz

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Values chosen to break things, plus the spec's own rails and midpoints. */
function fuzzValues(min: number, max: number, rand: () => number): number[] {
  return [
    min,
    max,
    (min + max) / 2,
    min + (max - min) * rand(),
    min - (max - min),
    max + (max - min),
    0,
    -0,
    1e-9,
    -1e-9,
    1e12,
    -1e12,
    Number.MAX_SAFE_INTEGER,
    Number.MIN_VALUE,
  ];
}

interface Fault {
  kind: string;
  where: string;
  value: string;
  params: string;
}

function faultsIn(probe: ReturnType<typeof createProbeContext>, kind: string, params: Effect['params']): Fault[] {
  const out: Fault[] = [];
  for (const w of probe.writes) {
    if (typeof w.value === 'number' && !Number.isFinite(w.value)) {
      out.push({ kind, where: `${w.path} (${w.how})`, value: String(w.value), params: JSON.stringify(params) });
    }
    if (typeof w.value === 'string' && /NaN|Infinity/.test(w.value)) {
      out.push({ kind, where: w.path, value: w.value, params: JSON.stringify(params) });
    }
  }
  return out;
}

/** A curve or an impulse with a non-finite sample in it, reported by hash. */
function scanTables(probe: ReturnType<typeof createProbeContext>): string[] {
  return probe.writes.filter((w) => String(w.value).includes('NaN')).map((w) => w.path);
}

describe('PA · parameter-space fuzz, every kind', () => {
  it('never writes a non-finite value, through normalised parameters', () => {
    const rand = mulberry32(20260822);
    const faults: Fault[] = [];
    for (const spec of EFFECT_SPECS) {
      for (const p of spec.params) {
        for (const raw of fuzzValues(p.min, p.max, rand)) {
          const params = normaliseParams(spec.kind, { ...defaultParams(spec.kind), [p.key]: raw });
          const probe = createProbeContext();
          const e: Effect = { id: 'fz', kind: spec.kind, bypass: false, params };
          const node = buildEffectNode(probe.ctx, e);
          node.update(e, BPM, false);
          node.update({ ...e, bypass: true }, BPM, true);
          faults.push(...faultsIn(probe, spec.kind, params));
          node.dispose();
        }
      }
    }
    if (faults.length > 0) console.log('NON-FINITE WRITES:', JSON.stringify(faults.slice(0, 10), null, 1));
    expect(faults).toEqual([]);
  });

  it('never writes a non-finite value even from unnormalised junk', () => {
    // The automation applier hands `updateOne` values straight from
    // `denormParam`, which never runs them past `normaliseParams` again — so the
    // builders have to survive a raw number, not only a validated one.
    const rand = mulberry32(7);
    const junk = [NaN, Infinity, -Infinity, 1e308, -1e308, 1e-320];
    const faults: Fault[] = [];
    for (const spec of EFFECT_SPECS) {
      for (const p of spec.params) {
        for (const raw of [...junk, ...fuzzValues(p.min, p.max, rand)]) {
          const params = { ...defaultParams(spec.kind), [p.key]: raw };
          const probe = createProbeContext();
          const e: Effect = { id: 'fz', kind: spec.kind, bypass: false, params };
          const node = buildEffectNode(probe.ctx, e);
          node.update(e, BPM, false);
          faults.push(...faultsIn(probe, spec.kind, params));
          const tables = scanTables(probe);
          for (const t of tables) {
            faults.push({ kind: spec.kind, where: t, value: 'table holds NaN', params: JSON.stringify(params) });
          }
          node.dispose();
        }
      }
    }
    if (faults.length > 0) {
      const byKind = new Map<string, number>();
      for (const f of faults) byKind.set(f.kind, (byKind.get(f.kind) ?? 0) + 1);
      console.log('NON-FINITE WRITES FROM RAW VALUES:', JSON.stringify([...byKind], null, 1));
      console.log('first three:', JSON.stringify(faults.slice(0, 3), null, 1));
    }
    expect(faults).toEqual([]);
  });

  it('never writes a non-finite value from a random whole-parameter-map draw', () => {
    const rand = mulberry32(99);
    const faults: Fault[] = [];
    for (const spec of EFFECT_SPECS) {
      for (let trial = 0; trial < 200; trial++) {
        const params: Record<string, number> = {};
        for (const p of spec.params) {
          const span = p.max - p.min;
          params[p.key] = p.min - span * 0.25 + span * 1.5 * rand();
        }
        const probe = createProbeContext(RATES[Math.floor(rand() * RATES.length)]);
        const e: Effect = { id: 'fz', kind: spec.kind, bypass: false, params };
        const node = buildEffectNode(probe.ctx, e);
        node.update(e, BPM, false);
        node.update(e, 20 + rand() * 280, false);
        faults.push(...faultsIn(probe, spec.kind, params));
        node.dispose();
      }
    }
    if (faults.length > 0) console.log('NON-FINITE:', JSON.stringify(faults.slice(0, 5), null, 1));
    expect(faults).toEqual([]);
  });
});
