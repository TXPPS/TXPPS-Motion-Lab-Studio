import { beforeEach, describe, expect, it } from 'vitest';
import {
  createLink,
  describeSource,
  describeTarget,
  isPress,
  linkValue,
  matchKeys,
  normalizeLinks,
  sourceKey,
  targetExists,
  type ControlLink,
  type ControlSource,
} from '../src/model/controlLink';
import { createEmptyProject } from '../src/model/demoProject';
import { useProjectStore } from '../src/state/projectStore';

const cc = (n: number, channel = 1): ControlSource => ({ kind: 'cc', cc: n, channel });

function link(patch: Partial<ControlLink> = {}): ControlLink {
  return {
    ...createLink('l1', cc(7), { kind: 'master', param: 'volume' }),
    ...patch,
  };
}

describe('control sources', () => {
  it('gives a channel-specific key and an omni fallback, most specific first', () => {
    expect(matchKeys(cc(7, 3))).toEqual(['cc:7:3', 'cc:7:0']);
    // An omni binding has nothing more general to fall back to.
    expect(matchKeys(cc(7, 0))).toEqual(['cc:7:0']);
  });

  it('keeps message kinds apart even at the same number', () => {
    expect(sourceKey(cc(64))).not.toBe(sourceKey({ kind: 'note', note: 64, channel: 1 }));
  });

  it('describes itself in the terms printed on hardware', () => {
    expect(describeSource(cc(74, 2))).toBe('CC 74 · ch 2');
    expect(describeSource({ kind: 'pitchbend', channel: 0 })).toBe('Pitch bend · omni');
  });
});

describe('reading a control', () => {
  it('maps an absolute control across the full range', () => {
    const l = link();
    expect(linkValue(l, 0, 0)).toBeCloseTo(0, 6);
    expect(linkValue(l, 127, 0)).toBeCloseTo(1, 6);
    expect(linkValue(l, 64, 0)).toBeCloseTo(64 / 127, 6);
  });

  it('confines an absolute control to the range it was given', () => {
    const l = link({ min: 0.25, max: 0.75 });
    expect(linkValue(l, 0, 0)).toBeCloseTo(0.25, 6);
    expect(linkValue(l, 127, 0)).toBeCloseTo(0.75, 6);
  });

  it('inverts without changing the ends of the range', () => {
    const l = link({ min: 0.2, max: 0.8, invert: true });
    expect(linkValue(l, 0, 0)).toBeCloseTo(0.8, 6);
    expect(linkValue(l, 127, 0)).toBeCloseTo(0.2, 6);
  });

  it('reads an endless encoder as a direction from where the target already is', () => {
    const l = link({ mode: 'relative' });
    // 1..63 counts up, 65..127 counts down.
    expect(linkValue(l, 1, 0.5)).toBeGreaterThan(0.5);
    expect(linkValue(l, 127, 0.5)).toBeLessThan(0.5);
    // 0 and 64 are the idle codes.
    expect(linkValue(l, 64, 0.5)).toBeCloseTo(0.5, 6);
    // and it never leaves the range
    expect(linkValue(l, 63, 1)).toBeCloseTo(1, 6);
    expect(linkValue(l, 65, 0)).toBeCloseTo(0, 6);
  });

  it('flips a toggle between the ends, and ignores the release', () => {
    const l = link({ mode: 'toggle' });
    expect(linkValue(l, 127, 0)).toBeCloseTo(1, 6);
    expect(linkValue(l, 127, 1)).toBeCloseTo(0, 6);
    // a button's release must not flip it straight back
    expect(linkValue(l, 0, 1)).toBeCloseTo(1, 6);
  });

  it('treats half travel as a press, and pitch bend by how far it was pushed', () => {
    expect(isPress(link(), 64)).toBe(true);
    expect(isPress(link(), 63)).toBe(false);
    const bend = link({ source: { kind: 'pitchbend', channel: 1 } });
    expect(isPress(bend, 91)).toBe(true);
    expect(isPress(bend, 64)).toBe(false);
  });
});

describe('new bindings', () => {
  it('guesses the mode from what is being bound', () => {
    expect(createLink('a', cc(7), { kind: 'master', param: 'volume' }).mode).toBe('absolute');
    expect(createLink('b', cc(7), { kind: 'transport', command: 'play' }).mode).toBe('toggle');
    expect(
      createLink('c', { kind: 'note', note: 36, channel: 1 }, { kind: 'master', param: 'volume' })
        .mode,
    ).toBe('toggle');
  });
});

describe('bindings in a project', () => {
  beforeEach(() => {
    useProjectStore.getState().setProject(createEmptyProject('Links'), { markClean: true });
  });

  it('re-points a control that was already bound instead of stacking a binding', () => {
    const store = useProjectStore.getState();
    store.addControlLink(cc(7), { kind: 'master', param: 'volume' });
    store.addControlLink(cc(7), { kind: 'transport', command: 'play' });
    const links = useProjectStore.getState().project.controlLinks ?? [];
    expect(links.length).toBe(1);
    expect(links[0].target).toEqual({ kind: 'transport', command: 'play' });
  });

  it('reports a target that no longer exists', () => {
    const project = useProjectStore.getState().project;
    const trackId = useProjectStore.getState().addTrack('audio');
    const after = useProjectStore.getState().project;
    expect(targetExists({ kind: 'param', trackId, paramId: 'volume' }, after)).toBe(true);
    expect(targetExists({ kind: 'param', trackId, paramId: 'nope' }, after)).toBe(false);
    expect(targetExists({ kind: 'param', trackId: 'gone', paramId: 'volume' }, project)).toBe(false);
    expect(targetExists({ kind: 'transport', command: 'play' }, project)).toBe(true);
  });

  it('names a target by its track and parameter', () => {
    const trackId = useProjectStore.getState().addTrack('audio');
    const project = useProjectStore.getState().project;
    const name = project.tracks.find((t) => t.id === trackId)!.name;
    expect(describeTarget({ kind: 'param', trackId, paramId: 'volume' }, project)).toBe(
      `${name} · Volume`,
    );
  });

  it('writes a parameter from a normalised value', () => {
    const trackId = useProjectStore.getState().addTrack('audio');
    useProjectStore.getState().setParamNorm(trackId, 'pan', 1);
    const track = useProjectStore.getState().project.tracks.find((t) => t.id === trackId)!;
    expect(track.pan).toBeCloseTo(1, 6);
    useProjectStore.getState().setParamNorm(trackId, 'pan', 0.5);
    const mid = useProjectStore.getState().project.tracks.find((t) => t.id === trackId)!;
    expect(mid.pan).toBeCloseTo(0, 6);
  });

  it('removes and clears bindings', () => {
    const store = useProjectStore.getState();
    const a = store.addControlLink(cc(7), { kind: 'master', param: 'volume' })!;
    store.addControlLink(cc(8), { kind: 'master', param: 'tempo' });
    useProjectStore.getState().removeControlLink(a);
    expect(useProjectStore.getState().project.controlLinks?.length).toBe(1);
    useProjectStore.getState().clearControlLinks();
    expect(useProjectStore.getState().project.controlLinks?.length).toBe(0);
  });
});

describe('loading bindings', () => {
  it('keeps what is valid and drops what is not', () => {
    const links = normalizeLinks([
      { id: 'a', source: { kind: 'cc', cc: 7, channel: 1 }, target: { kind: 'master' } },
      { id: 'b', source: { kind: 'cc', cc: 300, channel: 99 }, target: { kind: 'master' } },
      { id: 'c', source: { kind: 'nonsense' }, target: { kind: 'master' } },
      { id: 'a', source: { kind: 'cc', cc: 9, channel: 1 }, target: { kind: 'master' } },
      'not a link',
    ]);
    expect(links.map((l) => l.id)).toEqual(['a', 'b']);
    // out-of-range numbers are clamped rather than discarding an otherwise
    // usable binding
    expect(links[1].source).toEqual({ kind: 'cc', cc: 127, channel: 16 });
    expect(links[0].target).toEqual({ kind: 'master', param: 'volume' });
  });

  it('returns an empty list for anything that is not an array', () => {
    expect(normalizeLinks(undefined)).toEqual([]);
    expect(normalizeLinks({})).toEqual([]);
  });
});
