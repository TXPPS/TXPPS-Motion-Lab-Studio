/**
 * Saving a chain, and putting one back.
 *
 * Both racks used to apply a chain by looping the store once per device and
 * once per parameter, so a six-device chain arrived as forty-odd steps of undo
 * and taking it back meant pressing undo forty times. And a chain you built
 * could not be kept at all: the library was the product's six, with no way to
 * add the one you actually use.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { applyChainSteps, captureChain, type ChainStepLike } from '../src/app/chainActions';
import { useChainStore, MAX_SAVED_CHAINS } from '../src/state/chainStore';
import { useProjectStore } from '../src/state/projectStore';
import { createEmptyProject } from '../src/model/demoProject';
import type { EffectKind } from '../src/model/types';

const store = () => useProjectStore.getState();

function target(trackId: string) {
  return {
    add: (kind: EffectKind) => store().addEffect(trackId, kind),
    setParam: (id: string, key: string, value: number) =>
      store().setEffectParam(trackId, id, key, value),
    setBypass: (id: string, bypass: boolean) => store().setEffectBypass(trackId, id, bypass),
  };
}

const effectsOf = (trackId: string) =>
  store().project.tracks.find((t) => t.id === trackId)?.effects ?? [];

let trackId = '';

beforeEach(() => {
  useProjectStore.getState().setProject(createEmptyProject('Chains'), { markClean: true });
  trackId = store().addTrack('audio');
  useChainStore.getState().reset();
  localStorage.clear();
});

describe('applying a chain', () => {
  const steps: ChainStepLike[] = [
    { kind: 'eq3', params: { lowDb: -3, midDb: 2 } },
    { kind: 'compressor', params: { threshold: -18, ratio: 4 }, bypass: true },
    { kind: 'reverb', params: { size: 2.4 } },
  ];

  it('puts every device on in order, with its settings', () => {
    expect(applyChainSteps(target(trackId), steps)).toBe(0);
    const fx = effectsOf(trackId);
    expect(fx.map((e) => e.kind)).toEqual(['eq3', 'compressor', 'reverb']);
    expect(fx[0].params.lowDb).toBe(-3);
    expect(fx[1].params.ratio).toBe(4);
    expect(fx[2].params.size).toBe(2.4);
  });

  it('carries bypass, because a chain saved switched off means it', () => {
    applyChainSteps(target(trackId), steps);
    expect(effectsOf(trackId).map((e) => e.bypass)).toEqual([false, true, false]);
  });

  it('is one step of undo, not one per parameter', () => {
    applyChainSteps(target(trackId), steps);
    expect(effectsOf(trackId)).toHaveLength(3);
    store().undo();
    expect(effectsOf(trackId)).toHaveLength(0);
  });

  it('reports what did not fit rather than dropping the tail silently', () => {
    const many: ChainStepLike[] = Array.from({ length: 40 }, () => ({
      kind: 'trim' as const,
      params: {},
    }));
    const dropped = applyChainSteps(target(trackId), many);
    expect(dropped).toBeGreaterThan(0);
    expect(effectsOf(trackId).length + dropped).toBe(40);
  });
});

describe('capturing a chain', () => {
  it('takes the kinds, the settings and the bypasses off a channel', () => {
    applyChainSteps(target(trackId), [
      { kind: 'eq3', params: { midDb: 5 } },
      { kind: 'limiter', params: {}, bypass: true },
    ]);
    const captured = captureChain(effectsOf(trackId));
    expect(captured.map((s) => s.kind)).toEqual(['eq3', 'limiter']);
    expect(captured[0].params.midDb).toBe(5);
    expect(captured[1].bypass).toBe(true);
    expect(captured[0].bypass).toBeUndefined();
  });

  it('round-trips: capture a channel, apply it to another, get the same chain', () => {
    applyChainSteps(target(trackId), [
      { kind: 'eq3', params: { midDb: 5, midFreq: 900 } },
      { kind: 'compressor', params: { ratio: 6 }, bypass: true },
    ]);
    const other = store().addTrack('audio');
    applyChainSteps(target(other), captureChain(effectsOf(trackId)));
    const a = effectsOf(trackId).map(({ id: _id, ...rest }) => rest);
    const b = effectsOf(other).map(({ id: _id, ...rest }) => rest);
    expect(b).toEqual(a);
  });

  it('does not share parameter objects with the channel it came from', () => {
    applyChainSteps(target(trackId), [{ kind: 'eq3', params: { midDb: 5 } }]);
    const captured = captureChain(effectsOf(trackId));
    store().setEffectParam(trackId, effectsOf(trackId)[0].id, 'midDb', -5);
    expect(captured[0].params.midDb).toBe(5);
  });
});

describe('the saved chain library', () => {
  it('saves under a name and lists it', () => {
    const id = useChainStore.getState().save('Vocal', [{ kind: 'eq3', params: {} }]);
    expect(id).not.toBeNull();
    expect(useChainStore.getState().chains.map((c) => c.name)).toEqual(['Vocal']);
  });

  it('refuses a chain with no name and one with no devices', () => {
    expect(useChainStore.getState().save('   ', [{ kind: 'eq3', params: {} }])).toBeNull();
    expect(useChainStore.getState().save('Empty', [])).toBeNull();
    expect(useChainStore.getState().chains).toHaveLength(0);
  });

  it('replaces a chain saved under a name already used', () => {
    useChainStore.getState().save('Vocal', [{ kind: 'eq3', params: {} }]);
    useChainStore.getState().save('Vocal', [
      { kind: 'gate', params: {} },
      { kind: 'eq8', params: {} },
    ]);
    const chains = useChainStore.getState().chains;
    expect(chains).toHaveLength(1);
    expect(chains[0].steps.map((s) => s.kind)).toEqual(['gate', 'eq8']);
  });

  it('forgets one without touching the rest', () => {
    const a = useChainStore.getState().save('A', [{ kind: 'trim', params: {} }])!;
    useChainStore.getState().save('B', [{ kind: 'trim', params: {} }]);
    useChainStore.getState().remove(a);
    expect(useChainStore.getState().chains.map((c) => c.name)).toEqual(['B']);
  });

  it('keeps a bounded library rather than filling the storage quota', () => {
    for (let i = 0; i < MAX_SAVED_CHAINS + 5; i++) {
      useChainStore.getState().save(`C${i}`, [{ kind: 'trim', params: {} }]);
    }
    expect(useChainStore.getState().chains).toHaveLength(MAX_SAVED_CHAINS);
    // Newest first, so the oldest are the ones that fall off the end.
    expect(useChainStore.getState().chains[0].name).toBe(`C${MAX_SAVED_CHAINS + 4}`);
  });

  it('survives a page load through storage', () => {
    useChainStore.getState().save('Vocal', [{ kind: 'eq3', params: { midDb: 2 } }]);
    const raw = localStorage.getItem('motionlab.chains.v1');
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!) as { name: string; steps: { kind: string }[] }[];
    expect(parsed[0].name).toBe('Vocal');
    expect(parsed[0].steps[0].kind).toBe('eq3');
  });
});
