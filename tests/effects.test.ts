import { beforeEach, describe, expect, it } from 'vitest';
import {
  EFFECT_SPECS,
  MAX_INSERTS,
  defaultParams,
  describeEffect,
  effectSpec,
  formatParam,
  isKnownEffect,
  normaliseParams,
  paramOf,
} from '../src/model/effects';
import type { Effect } from '../src/model/types';
import { useProjectStore } from '../src/state/projectStore';
import { createDemoProject } from '../src/model/demoProject';

function reset() {
  useProjectStore.getState().setProject(createDemoProject(), { markClean: true });
}

function audioTrackId(): string {
  return useProjectStore.getState().project.tracks.find((t) => t.type === 'audio')!.id;
}

describe('effect specs', () => {
  it('gives every spec parameter a default inside its own range', () => {
    for (const spec of EFFECT_SPECS) {
      for (const p of spec.params) {
        expect(p.min, `${spec.kind}.${p.key} min<max`).toBeLessThan(p.max);
        expect(p.default, `${spec.kind}.${p.key} default >= min`).toBeGreaterThanOrEqual(p.min);
        expect(p.default, `${spec.kind}.${p.key} default <= max`).toBeLessThanOrEqual(p.max);
      }
    }
  });

  it('log-curve parameters never start at zero, which would break the mapping', () => {
    for (const spec of EFFECT_SPECS) {
      for (const p of spec.params) {
        if (p.curve === 'log') expect(p.min, `${spec.kind}.${p.key}`).toBeGreaterThan(0);
      }
    }
  });

  it('defaultParams covers exactly the spec keys', () => {
    for (const spec of EFFECT_SPECS) {
      expect(Object.keys(defaultParams(spec.kind)).sort()).toEqual(
        spec.params.map((p) => p.key).sort(),
      );
    }
  });

  it('recognises known kinds and rejects unknown ones', () => {
    expect(isKnownEffect('compressor')).toBe(true);
    expect(isKnownEffect('quantum-flux')).toBe(false);
    expect(effectSpec('reverb')).toBeTruthy();
  });
});

describe('parameter normalisation', () => {
  it('clamps out-of-range values into the spec range', () => {
    const p = normaliseParams('compressor', { threshold: -900, ratio: 5000, attack: 3 });
    expect(p.threshold).toBe(-60);
    expect(p.ratio).toBe(20);
    expect(p.attack).toBe(3);
  });

  it('substitutes defaults for missing, non-numeric and non-finite values', () => {
    const p = normaliseParams('delay', {
      feedback: NaN,
      tone: 'loud' as unknown as number,
      mix: Infinity,
    });
    const spec = effectSpec('delay')!;
    for (const s of spec.params) expect(Number.isFinite(p[s.key])).toBe(true);
    expect(p.feedback).toBe(spec.params.find((x) => x.key === 'feedback')!.default);
    expect(p.tone).toBe(spec.params.find((x) => x.key === 'tone')!.default);
  });

  it('returns an empty map for an unknown kind rather than throwing', () => {
    expect(normaliseParams('nonsense' as never, { a: 1 })).toEqual({});
  });

  it('paramOf falls back to the spec default when a value is absent', () => {
    const fx: Effect = { id: 'x', kind: 'eq3', bypass: false, params: {} };
    expect(paramOf(fx, 'midFreq')).toBe(1000);
    expect(paramOf(fx, 'not-a-param')).toBe(0);
  });
});

describe('effect formatting', () => {
  it('formats each unit distinctly and never emits NaN', () => {
    for (const spec of EFFECT_SPECS) {
      for (const p of spec.params) {
        const text = formatParam(p, p.default);
        expect(text).not.toMatch(/NaN|undefined/);
        expect(text.length).toBeGreaterThan(0);
      }
    }
  });

  it('summarises every effect kind without throwing', () => {
    for (const spec of EFFECT_SPECS) {
      const fx: Effect = {
        id: 'x',
        kind: spec.kind,
        bypass: false,
        params: defaultParams(spec.kind),
      };
      expect(describeEffect(fx)).not.toMatch(/NaN|undefined/);
    }
  });
});

describe('insert chain store actions', () => {
  beforeEach(() => reset());

  it('adds an effect with spec defaults', () => {
    const tid = audioTrackId();
    const id = useProjectStore.getState().addEffect(tid, 'eq3');
    expect(id).toBeTruthy();
    const fx = useProjectStore.getState().project.tracks.find((t) => t.id === tid)!.effects![0];
    expect(fx.kind).toBe('eq3');
    expect(fx.bypass).toBe(false);
    expect(fx.params.midFreq).toBe(1000);
  });

  it('refuses to add past the slot cap and reports it by returning null', () => {
    const tid = audioTrackId();
    for (let i = 0; i < MAX_INSERTS; i++) {
      expect(useProjectStore.getState().addEffect(tid, 'trim')).toBeTruthy();
    }
    expect(useProjectStore.getState().addEffect(tid, 'trim')).toBeNull();
    const t = useProjectStore.getState().project.tracks.find((x) => x.id === tid)!;
    expect(t.effects!.length).toBe(MAX_INSERTS);
  });

  it('clamps parameter writes to the spec range', () => {
    const tid = audioTrackId();
    const id = useProjectStore.getState().addEffect(tid, 'compressor')!;
    useProjectStore.getState().setEffectParam(tid, id, 'ratio', 999);
    useProjectStore.getState().setEffectParam(tid, id, 'threshold', -999);
    const fx = useProjectStore.getState().project.tracks.find((t) => t.id === tid)!.effects![0];
    expect(fx.params.ratio).toBe(20);
    expect(fx.params.threshold).toBe(-60);
  });

  it('ignores writes to unknown parameters and non-finite values', () => {
    const tid = audioTrackId();
    const id = useProjectStore.getState().addEffect(tid, 'trim')!;
    useProjectStore.getState().setEffectParam(tid, id, 'notAParam', 5);
    useProjectStore.getState().setEffectParam(tid, id, 'gainDb', NaN);
    const fx = useProjectStore.getState().project.tracks.find((t) => t.id === tid)!.effects![0];
    expect(fx.params.notAParam).toBeUndefined();
    expect(fx.params.gainDb).toBe(0);
  });

  it('reorders within the chain and refuses to move past either end', () => {
    const tid = audioTrackId();
    const a = useProjectStore.getState().addEffect(tid, 'trim')!;
    const b = useProjectStore.getState().addEffect(tid, 'eq3')!;
    const order = () =>
      useProjectStore
        .getState()
        .project.tracks.find((t) => t.id === tid)!
        .effects!.map((e) => e.id);

    expect(order()).toEqual([a, b]);
    useProjectStore.getState().moveEffect(tid, b, -1);
    expect(order()).toEqual([b, a]);
    // already first: a move earlier is a no-op, not a crash or a duplicate
    useProjectStore.getState().moveEffect(tid, b, -1);
    expect(order()).toEqual([b, a]);
    useProjectStore.getState().moveEffect(tid, a, 1);
    expect(order()).toEqual([b, a]);
  });

  it('bypasses and removes without disturbing its neighbours', () => {
    const tid = audioTrackId();
    const a = useProjectStore.getState().addEffect(tid, 'trim')!;
    const b = useProjectStore.getState().addEffect(tid, 'delay')!;
    useProjectStore.getState().setEffectBypass(tid, a, true);
    let effects = useProjectStore.getState().project.tracks.find((t) => t.id === tid)!.effects!;
    expect(effects.find((e) => e.id === a)!.bypass).toBe(true);
    expect(effects.find((e) => e.id === b)!.bypass).toBe(false);

    useProjectStore.getState().removeEffect(tid, a);
    effects = useProjectStore.getState().project.tracks.find((t) => t.id === tid)!.effects!;
    expect(effects.map((e) => e.id)).toEqual([b]);
  });

  it('does nothing when the track or effect does not exist', () => {
    const tid = audioTrackId();
    expect(useProjectStore.getState().addEffect('no-such-track', 'trim')).toBeNull();
    expect(() => useProjectStore.getState().removeEffect(tid, 'no-such-fx')).not.toThrow();
    expect(() =>
      useProjectStore.getState().setEffectParam(tid, 'no-such-fx', 'gainDb', 1),
    ).not.toThrow();
    expect(() => useProjectStore.getState().moveEffect(tid, 'no-such-fx', 1)).not.toThrow();
  });
});

describe('sends', () => {
  beforeEach(() => reset());

  it('rejects a send to a non-bus track and to itself', () => {
    const p = useProjectStore.getState().project;
    const audio = p.tracks.find((t) => t.type === 'audio')!;
    const instrument = p.tracks.find((t) => t.type === 'instrument')!;

    useProjectStore.getState().setSend(audio.id, instrument.id, { enabled: true, amount: 0.5 });
    useProjectStore.getState().setSend(audio.id, audio.id, { enabled: true, amount: 0.5 });

    const after = useProjectStore.getState().project.tracks.find((t) => t.id === audio.id)!;
    expect(after.sends ?? []).toEqual([]);
  });

  it('creates and updates a send to a real bus', () => {
    const p = useProjectStore.getState().project;
    const audio = p.tracks.find((t) => t.type === 'audio')!;
    const bus = p.tracks.find((t) => t.type === 'bus')!;

    useProjectStore.getState().setSend(audio.id, bus.id, { enabled: true, amount: 0.4 });
    let send = useProjectStore
      .getState()
      .project.tracks.find((t) => t.id === audio.id)!
      .sends!.find((s) => s.busId === bus.id)!;
    expect(send.amount).toBeCloseTo(0.4);
    expect(send.preFader).toBe(false);

    useProjectStore.getState().setSend(audio.id, bus.id, { preFader: true });
    send = useProjectStore
      .getState()
      .project.tracks.find((t) => t.id === audio.id)!
      .sends!.find((s) => s.busId === bus.id)!;
    expect(send.preFader).toBe(true);
    // patching one field must not reset the others
    expect(send.amount).toBeCloseTo(0.4);
  });

  it('refuses a send that would create a routing cycle', () => {
    const p = useProjectStore.getState().project;
    const busA = p.tracks.find((t) => t.type === 'bus')!;
    const busB = p.tracks.filter((t) => t.type === 'bus')[1];
    expect(busB, 'demo project needs two buses for this test').toBeTruthy();

    // Route A into B, then try to send B back into A.
    useProjectStore.getState().setTrack(busA.id, { output: busB.id });
    useProjectStore.getState().setSend(busB.id, busA.id, { enabled: true, amount: 0.5 });

    const after = useProjectStore.getState().project.tracks.find((t) => t.id === busB.id)!;
    expect(after.sends ?? []).toEqual([]);
  });

  it('removes a send', () => {
    const p = useProjectStore.getState().project;
    const audio = p.tracks.find((t) => t.type === 'audio')!;
    const bus = p.tracks.find((t) => t.type === 'bus')!;
    useProjectStore.getState().setSend(audio.id, bus.id, { enabled: true, amount: 0.4 });
    useProjectStore.getState().removeSend(audio.id, bus.id);
    const after = useProjectStore.getState().project.tracks.find((t) => t.id === audio.id)!;
    expect(after.sends).toEqual([]);
  });
});
