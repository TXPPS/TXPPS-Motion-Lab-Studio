/**
 * PA probe 2 — what automation actually does to an insert.
 *
 * The engine applies an automated insert parameter by calling the whole of that
 * effect's `update()` on its frame loop (`engine.applyAutomation` →
 * `InsertChain.updateOne`), and the offline render calls the same `update()` on
 * a suspend/resume grid (`exportMix`). So "what does automating this control
 * cost" is answerable by driving `update()` the way those two drivers do and
 * counting what the builder rewrites.
 *
 * Numbers here are counts and wall-clock times measured on this host. The
 * audible consequence of a curve swap is not measured — that needs a renderer.
 */
import { describe, expect, it } from 'vitest';
import { EFFECT_SPECS, defaultParams } from '../../src/model/effects';
import { buildEffectNode } from '../../src/audio/effectChain';
import { denormParam, normParam, listAutoParams } from '../../src/model/paramRegistry';
import type { AutoParam } from '../../src/model/paramRegistry';
import type { Effect, EffectKind, ProjectData, Track } from '../../src/model/types';
import { createProbeContext } from './probeContext';

const BPM = 120;
/** `engine.applyAutomation` skips a lane whose normalised value moved less. */
const AUTO_EPSILON = 0.0008;

function effectOf(kind: EffectKind, overrides: Record<string, number> = {}): Effect {
  return {
    id: `fx-${kind}`,
    kind,
    bypass: false,
    params: { ...defaultParams(kind), ...overrides },
  };
}

/**
 * Drive one parameter from one end of its range to the other exactly as the
 * live engine would: `frames` updates, skipping any step smaller than the
 * engine's own epsilon, and report what the builder rewrote outright.
 */
function sweep(
  kind: EffectKind,
  key: string,
  from: number,
  to: number,
  frames: number,
): { updates: number; curveSwaps: number; bufferSwaps: number; bufferSamples: number; ms: number } {
  const probe = createProbeContext();
  const base = effectOf(kind, { [key]: from });
  const node = buildEffectNode(probe.ctx, base);
  node.update(base, BPM, false);
  node.update(base, BPM, false);
  probe.clear();

  let lastNorm = 0;
  let updates = 0;
  const started = performance.now();
  for (let i = 1; i <= frames; i++) {
    const norm = i / frames;
    if (Math.abs(norm - lastNorm) < AUTO_EPSILON) continue;
    lastNorm = norm;
    updates++;
    node.update(effectOf(kind, { [key]: from + (to - from) * norm }), BPM, false);
  }
  const ms = performance.now() - started;

  const changed = probe.writes.filter((w) => !w.same && w.how === 'field');
  const curveSwaps = changed.filter((w) => w.path.endsWith('.curve')).length;
  const buffers = changed.filter((w) => w.path.endsWith('.buffer'));
  let bufferSamples = 0;
  for (const b of buffers) {
    const m = /buffer\((\d+)x(\d+)\)/.exec(String(b.value));
    if (m) bufferSamples += Number(m[1]) * Number(m[2]);
  }
  node.dispose();
  return { updates, curveSwaps, bufferSwaps: buffers.length, bufferSamples, ms };
}

describe('PA-004 · automating an insert parameter rewrites a table instead of ramping', () => {
  it('re-renders the reverb impulse many times over one Size sweep', () => {
    // Six seconds of automation at the frame rate the engine runs its applier
    // on: 360 frames. The reverb's own guard re-renders when Size has moved
    // more than 0.05 s.
    const r = sweep('reverb', 'size', 0.2, 6, 360);
    console.log(
      `reverb Size 0.2→6.0 s over 360 frames: ${r.updates} updates, ` +
        `${r.bufferSwaps} impulse re-renders, ${r.bufferSamples.toLocaleString()} samples ` +
        `generated, ${r.ms.toFixed(1)} ms of synchronous work`,
    );
    expect(r.bufferSwaps).toBeGreaterThan(50);
  });

  it('re-renders the reverb impulse over a Damping sweep too', () => {
    const r = sweep('reverb', 'damping', 800, 16000, 360);
    console.log(
      `reverb Damping 800→16000 Hz over 360 frames: ${r.bufferSwaps} impulse re-renders, ` +
        `${r.bufferSamples.toLocaleString()} samples, ${r.ms.toFixed(1)} ms`,
    );
    expect(r.bufferSwaps).toBeGreaterThan(50);
  });

  it('rebuilds a WaveShaper curve on all but a handful of frames', () => {
    for (const [kind, key, from, to] of [
      ['saturator', 'drive', 0, 36],
      ['distortion', 'drive', 0, 48],
      ['compressor', 'threshold', -60, 0],
      ['gate', 'threshold', -80, 0],
      ['limiter', 'ceiling', -12, 0],
      ['deesser', 'threshold', -60, 0],
    ] as [EffectKind, string, number, number][]) {
      const r = sweep(kind, key, from, to, 360);
      console.log(
        `${kind}.${key}: ${r.curveSwaps} curve rebuilds in ${r.updates} updates, ${r.ms.toFixed(1)} ms`,
      );
      expect(r.curveSwaps).toBeGreaterThan(300);
    }
  });

  it('costs nothing extra on the inserts whose controls are all AudioParams', () => {
    for (const [kind, key, from, to] of [
      ['eq3', 'lowDb', -18, 18],
      ['filter', 'cutoff', 20, 20000],
      ['delay', 'feedback', 0, 0.9],
      ['chorus', 'rate', 0.05, 8],
    ] as [EffectKind, string, number, number][]) {
      const r = sweep(kind, key, from, to, 360);
      expect(`${kind}: ${r.curveSwaps + r.bufferSwaps}`).toBe(`${kind}: 0`);
    }
  });
});

describe('PA · fx automation lanes: taper round-trip, and PA-005', () => {
  it('recovers the value a lane point was written from, for every declared parameter', () => {
    const track: Track = {
      id: 't1',
      name: 'T',
      type: 'audio',
      volume: 1,
      pan: 0,
      mute: false,
      solo: false,
      clips: [],
      effects: EFFECT_SPECS.map((s) => effectOf(s.kind)),
    } as unknown as Track;
    const project = { tracks: [track] } as unknown as ProjectData;
    const params = listAutoParams(track, project).filter((p) => p.id.startsWith('fx:'));
    expect(params.length).toBe(EFFECT_SPECS.reduce((n, s) => n + s.params.length, 0));

    const worst: { id: string; err: number }[] = [];
    for (const p of params) {
      let err = 0;
      for (let i = 0; i <= 32; i++) {
        const v = denormParam(p, i / 32);
        const back = denormParam(p, normParam(p, v));
        const span = p.max - p.min || 1;
        err = Math.max(err, Math.abs(back - v) / span);
      }
      if (err > 1e-9) worst.push({ id: p.id, err });
    }
    expect(worst).toEqual([]);
  });

  it('offers a lane for every parameter of Vocal Tune, whose node is a pass-through', () => {
    // Not a rounding problem — a wiring one. `buildPassThrough` is the whole of
    // the Vocal Tune node, so a lane on any of its six parameters plays back
    // against a graph that cannot read it. Recorded here because the guard that
    // catches this class for instruments (`tests/laneWired.test.ts`) says in its
    // own header that effect lanes are not its business.
    const track = {
      id: 't1',
      name: 'T',
      type: 'audio',
      volume: 1,
      pan: 0,
      mute: false,
      solo: false,
      clips: [],
      effects: [effectOf('vocaltune')],
    } as unknown as Track;
    const project = { tracks: [track] } as unknown as ProjectData;
    const offered = listAutoParams(track, project)
      .filter((p: AutoParam) => p.id.startsWith('fx:'))
      .map((p) => p.id.split(':')[2]);
    expect(offered).toEqual(['strength', 'speed', 'humanise', 'scale', 'key', 'formant']);
  });
});

describe('PA-006 · the offline grid an insert lane is rendered on', () => {
  /** `exportMix`: 25 ms, widened so the render never exceeds 4800 suspensions. */
  const gridFor = (durationSec: number): number => {
    let grid = 0.025;
    const usable = durationSec - 0.001;
    if (usable / grid > 4800) grid = usable / 4800;
    return grid;
  };

  it('widens with render length, so a long bounce quantises its sweeps harder', () => {
    const rows = [30, 120, 300, 600, 1800].map((sec) => ({
      sec,
      gridMs: gridFor(sec) * 1000,
      hz: 1 / gridFor(sec),
    }));
    console.log(
      rows
        .map((r) => `${r.sec}s render → ${r.gridMs.toFixed(1)} ms grid (${r.hz.toFixed(1)} Hz)`)
        .join('\n'),
    );
    expect(gridFor(30) * 1000).toBeCloseTo(25, 6);
    expect(gridFor(600) * 1000).toBeCloseTo(125, 3);
    expect(gridFor(1800) * 1000).toBeCloseTo(374.999, 2);
  });
});
