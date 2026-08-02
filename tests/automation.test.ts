import { describe, expect, it } from 'vitest';
import {
  laneValueAt,
  lowerBound,
  makePoint,
  normalizeLanePoints,
  sampleSegment,
  shapeProgress,
  validateLane,
} from '../src/model/automation';
import type { AutomationPoint, CurveShape } from '../src/model/automation';
import {
  denormParam,
  findAutoParam,
  listAutoParams,
  normParam,
  paramIdExists,
} from '../src/model/paramRegistry';
import { validateProject } from '../src/persistence/projectRepo';
import { useProjectStore } from '../src/state/projectStore';
import { createDemoProject } from '../src/model/demoProject';
import type { ProjectData, Track } from '../src/model/types';

const pt = (beat: number, value: number, curve: CurveShape = 'linear'): AutomationPoint =>
  makePoint(beat, value, curve);

describe('curve math', () => {
  it('all shapes hit the endpoints exactly', () => {
    for (const c of ['linear', 'exp', 'log', 's', 'step'] as CurveShape[]) {
      expect(shapeProgress(0, c)).toBe(0);
      expect(shapeProgress(1, c)).toBe(1);
    }
  });

  it('shapes are monotonic within the segment', () => {
    for (const c of ['linear', 'exp', 'log', 's'] as CurveShape[]) {
      let prev = -1;
      for (let i = 0; i <= 20; i++) {
        const v = shapeProgress(i / 20, c);
        expect(v).toBeGreaterThanOrEqual(prev);
        prev = v;
      }
    }
  });

  it('exp starts slow and log starts fast', () => {
    expect(shapeProgress(0.5, 'exp')).toBeLessThan(0.5);
    expect(shapeProgress(0.5, 'log')).toBeGreaterThan(0.5);
    expect(shapeProgress(0.5, 's')).toBeCloseTo(0.5, 9);
  });

  it('step holds until the end', () => {
    expect(shapeProgress(0.99, 'step')).toBe(0);
  });
});

describe('laneValueAt', () => {
  const points = [pt(4, 0.2), pt(8, 1)];

  it('returns null for an empty lane', () => {
    expect(laneValueAt([], 3)).toBeNull();
  });

  it('holds the first value before the first point and the last after', () => {
    expect(laneValueAt(points, 0)).toBe(0.2);
    expect(laneValueAt(points, 100)).toBe(1);
  });

  it('interpolates linearly between points', () => {
    expect(laneValueAt(points, 6)).toBeCloseTo(0.6, 9);
  });

  it('applies the left point curve to the segment', () => {
    const curved = [pt(0, 0, 'exp'), pt(1, 1)];
    expect(laneValueAt(curved, 0.5)).toBeCloseTo(0.125, 9);
    const stepped = [pt(0, 0.3, 'step'), pt(2, 0.9)];
    expect(laneValueAt(stepped, 1.999)).toBe(0.3);
    expect(laneValueAt(stepped, 2)).toBe(0.9);
  });

  it('is exact at the points themselves', () => {
    expect(laneValueAt(points, 4)).toBe(0.2);
    expect(laneValueAt(points, 8)).toBe(1);
  });

  it('binary search matches a linear scan on a large lane', () => {
    const many: AutomationPoint[] = [];
    for (let i = 0; i < 500; i++) many.push(pt(i * 0.7, (i % 10) / 10));
    for (const b of [0, 3.33, 77.7, 200.05, 349.29, 400]) {
      // linear reference
      let ref = many[0].value;
      for (let i = 0; i < many.length - 1; i++) {
        if (b >= many[i].beat && b < many[i + 1].beat) {
          const t = (b - many[i].beat) / (many[i + 1].beat - many[i].beat);
          ref = many[i].value + (many[i + 1].value - many[i].value) * t;
        }
      }
      if (b >= many[many.length - 1].beat) ref = many[many.length - 1].value;
      expect(laneValueAt(many, b)).toBeCloseTo(ref, 9);
    }
  });

  it('lowerBound finds the first point at or after a beat', () => {
    expect(lowerBound(points, 0)).toBe(0);
    expect(lowerBound(points, 4)).toBe(0);
    expect(lowerBound(points, 4.01)).toBe(1);
    expect(lowerBound(points, 9)).toBe(2);
  });
});

describe('sampleSegment', () => {
  it('linear needs one sample', () => {
    const s = sampleSegment(pt(0, 0), pt(4, 1));
    expect(s).toHaveLength(1);
    expect(s[0]).toEqual({ beat: 4, value: 1 });
  });

  it('curves subdivide and end exactly on the right point', () => {
    const s = sampleSegment(pt(0, 0, 's'), pt(4, 1), 8);
    expect(s).toHaveLength(8);
    expect(s[s.length - 1].beat).toBeCloseTo(4, 9);
    expect(s[s.length - 1].value).toBeCloseTo(1, 9);
  });

  it('step returns hold then jump at the same beat', () => {
    const s = sampleSegment(pt(0, 0.2, 'step'), pt(3, 0.8));
    expect(s).toEqual([
      { beat: 3, value: 0.2 },
      { beat: 3, value: 0.8 },
    ]);
  });
});

describe('normalization and validation', () => {
  it('normalizeLanePoints clamps and sorts', () => {
    const points = [pt(5, 0.5), pt(-2, 4), pt(1, -3)];
    normalizeLanePoints(points);
    expect(points.map((p) => p.beat)).toEqual([0, 1, 5]);
    expect(points[0].value).toBe(1);
    expect(points[1].value).toBe(0);
  });

  it('validateLane drops malformed points and unknown curves', () => {
    const lane = validateLane({
      id: 'l1',
      paramId: 'volume',
      points: [
        { id: 'a', beat: 2, value: 0.5, curve: 'wobble' },
        { id: 'b', beat: 'x', value: 0.5 },
        { beat: 1, value: 9 },
        null,
      ],
      enabled: 1,
    });
    expect(lane).not.toBeNull();
    expect(lane!.points).toHaveLength(2);
    expect(lane!.points[0].beat).toBe(1);
    expect(lane!.points[0].value).toBe(1);
    expect(lane!.points[1].curve).toBe('linear');
    expect(lane!.enabled).toBe(true);
  });

  it('validateLane rejects structural garbage', () => {
    expect(validateLane(null)).toBeNull();
    expect(validateLane({ paramId: 'volume', points: [] })).toBeNull();
    expect(validateLane({ id: 'x', paramId: 'volume', points: 'no' })).toBeNull();
  });
});

function demoWithLane(mutate?: (p: ProjectData) => void): ProjectData {
  const p = createDemoProject();
  const t = p.tracks[0];
  t.automation = [
    {
      id: 'lane1',
      paramId: 'volume',
      enabled: true,
      points: [makePoint(0, 1), makePoint(8, 0.25, 's')],
    },
  ];
  mutate?.(p);
  return p;
}

describe('serialization', () => {
  it('automation survives a validateProject round-trip', () => {
    const p = demoWithLane();
    const revived = validateProject(JSON.parse(JSON.stringify(p)));
    const lane = revived.tracks[0].automation?.[0];
    expect(lane).toBeDefined();
    expect(lane!.paramId).toBe('volume');
    expect(lane!.points).toHaveLength(2);
    expect(lane!.points[1].curve).toBe('s');
    expect(revived.schemaVersion).toBe(4);
  });

  it('drops lanes whose parameter no longer exists', () => {
    const p = demoWithLane((proj) => {
      proj.tracks[0].automation!.push({
        id: 'lane2',
        paramId: 'fx:ghost:threshold',
        enabled: true,
        points: [makePoint(0, 0.5)],
      });
    });
    const revived = validateProject(JSON.parse(JSON.stringify(p)));
    expect(revived.tracks[0].automation).toHaveLength(1);
  });

  it('v2 projects without automation validate unchanged', () => {
    const p = createDemoProject();
    const raw = JSON.parse(JSON.stringify(p)) as Record<string, unknown>;
    raw.schemaVersion = 2;
    const revived = validateProject(raw);
    expect(revived.tracks.every((t) => t.automation === undefined)).toBe(true);
  });
});

describe('parameter registry', () => {
  const p = createDemoProject();
  const withFx = p.tracks.find((t) => (t.effects ?? []).length > 0);
  const synthTrack = p.tracks.find((t) => t.type === 'instrument');

  it('always offers volume, pan and mute', () => {
    for (const t of p.tracks) {
      const ids = listAutoParams(t, p).map((x) => x.id);
      expect(ids).toContain('volume');
      expect(ids).toContain('pan');
      expect(ids).toContain('mute');
    }
  });

  it('offers sends, effect params and synth params where they exist', () => {
    const sendTrack = p.tracks.find((t) => (t.sends ?? []).length > 0);
    if (sendTrack) {
      const ids = listAutoParams(sendTrack, p).map((x) => x.id);
      expect(ids.some((i) => i.startsWith('send:'))).toBe(true);
    }
    if (withFx) {
      const ids = listAutoParams(withFx, p).map((x) => x.id);
      expect(ids.some((i) => i.startsWith('fx:'))).toBe(true);
    }
    expect(synthTrack).toBeDefined();
    const ids = listAutoParams(synthTrack!, p).map((x) => x.id);
    expect(ids).toContain('synth:cutoff');
  });

  it('denorm/norm round-trips linear and log scales', () => {
    const vol = findAutoParam(p.tracks[0], p, 'volume')!;
    expect(denormParam(vol, normParam(vol, 1.2))).toBeCloseTo(1.2, 9);
    const cutoff = findAutoParam(synthTrack!, p, 'synth:cutoff')!;
    expect(cutoff.scale).toBe('log');
    expect(denormParam(cutoff, normParam(cutoff, 440))).toBeCloseTo(440, 6);
    // normalized midpoint of a log param is the geometric mean
    expect(denormParam(cutoff, 0.5)).toBeCloseTo(Math.sqrt(cutoff.min * cutoff.max), 3);
  });

  it('mute is stepped: denorm snaps to 0/1', () => {
    const mute = findAutoParam(p.tracks[0], p, 'mute')!;
    expect(denormParam(mute, 0.49)).toBe(0);
    expect(denormParam(mute, 0.51)).toBe(1);
  });

  it('paramIdExists tracks live sends/effects', () => {
    const t = p.tracks[0];
    expect(paramIdExists(t, 'volume')).toBe(true);
    expect(paramIdExists(t, 'send:nope')).toBe(false);
    expect(paramIdExists(t, 'fx:missing:gainDb')).toBe(false);
    expect(paramIdExists(t, 'bogus')).toBe(false);
    if (withFx) {
      const fx = withFx.effects![0];
      const spec = listAutoParams(withFx, p).find((x) => x.id.startsWith(`fx:${fx.id}:`));
      expect(spec).toBeDefined();
      expect(paramIdExists(withFx, spec!.id)).toBe(true);
    }
  });
});

describe('automation stress fixture', () => {
  it('holds exactly 100 tracks, 500 lanes, 100000 points and validates', async () => {
    const { createHugeAutomationProject } = await import('../src/model/hugeAutomationProject');
    const p = createHugeAutomationProject();
    expect(p.tracks).toHaveLength(100);
    let lanes = 0;
    let points = 0;
    for (const t of p.tracks) {
      for (const l of t.automation ?? []) {
        lanes++;
        points += l.points.length;
        // sorted invariant
        for (let i = 1; i < l.points.length; i++) {
          expect(l.points[i].beat).toBeGreaterThanOrEqual(l.points[i - 1].beat);
        }
      }
    }
    expect(lanes).toBe(500);
    expect(points).toBe(100000);
    // Every lane must survive validation intact (no dangling parameter ids).
    const revived = validateProject(JSON.parse(JSON.stringify(p)));
    const revivedLanes = revived.tracks.reduce((a, t) => a + (t.automation?.length ?? 0), 0);
    expect(revivedLanes).toBe(500);
  });
});

describe('store automation ops', () => {
  const boot = () => {
    const s = useProjectStore.getState();
    s.setProject(createDemoProject(), { markClean: true });
    return useProjectStore.getState();
  };
  const track = (): Track => useProjectStore.getState().project.tracks[0];

  it('addAutomationLane creates one lane per parameter and opens the lanes', () => {
    const s = boot();
    const id = s.addAutomationLane(track().id, 'volume');
    expect(id).not.toBeNull();
    expect(s.addAutomationLane(track().id, 'volume')).toBeNull(); // duplicate
    expect(s.addAutomationLane(track().id, 'fx:nope:gain')).toBeNull(); // unknown
    expect(track().automation).toHaveLength(1);
    expect(track().automationOpen).toBe(true);
  });

  it('point add/update/delete keep the lane sorted and clamped', () => {
    const s = boot();
    const laneId = s.addAutomationLane(track().id, 'volume')!;
    s.addAutomationPoint(track().id, laneId, 4, 0.5);
    const first = s.addAutomationPoint(track().id, laneId, 1, 2)!; // clamps to 1
    expect(track().automation![0].points.map((p) => p.beat)).toEqual([1, 4]);
    expect(track().automation![0].points[0].value).toBe(1);

    s.updateAutomationPoints(track().id, laneId, [first], () => ({ beat: 9 }));
    expect(track().automation![0].points.map((p) => p.beat)).toEqual([4, 9]);

    s.deleteAutomationPoints(track().id, laneId, [first]);
    expect(track().automation![0].points).toHaveLength(1);
  });

  it('undo restores a point add in one step', () => {
    const s = boot();
    const laneId = s.addAutomationLane(track().id, 'pan')!;
    s.addAutomationPoint(track().id, laneId, 2, 0.75);
    expect(track().automation![0].points).toHaveLength(1);
    s.undo();
    expect(track().automation![0].points).toHaveLength(0);
    s.redo();
    expect(track().automation![0].points).toHaveLength(1);
  });

  it('insertAutomationPoints is one undoable step', () => {
    const s = boot();
    const laneId = s.addAutomationLane(track().id, 'volume')!;
    const ids = s.insertAutomationPoints(track().id, laneId, [
      { beat: 0, value: 0.1 },
      { beat: 2, value: 0.9, curve: 'exp' },
      { beat: 1, value: 0.5 },
    ]);
    expect(ids).toHaveLength(3);
    expect(track().automation![0].points.map((p) => p.beat)).toEqual([0, 1, 2]);
    s.undo();
    expect(track().automation![0].points).toHaveLength(0);
  });

  it('writeAutomationAt overwrites the passed region', () => {
    const s = boot();
    const laneId = s.addAutomationLane(track().id, 'volume')!;
    s.insertAutomationPoints(track().id, laneId, [
      { beat: 0, value: 0.1 },
      { beat: 1, value: 0.2 },
      { beat: 2, value: 0.3 },
      { beat: 5, value: 0.9 },
    ]);
    // Writing at beat 2.5 having last written at 0.5 → points at 1 and 2 go.
    s.writeAutomationAt(track().id, laneId, 2.5, 0.7, 0.5);
    const beats = track().automation![0].points.map((p) => p.beat);
    expect(beats).toEqual([0, 2.5, 5]);
    const at25 = track().automation![0].points.find((p) => p.beat === 2.5)!;
    expect(at25.value).toBeCloseTo(0.7, 9);
  });

  it('setAutomationCurve and lane enable/remove work and undo', () => {
    const s = boot();
    const laneId = s.addAutomationLane(track().id, 'volume')!;
    const pid = s.addAutomationPoint(track().id, laneId, 1, 0.5)!;
    s.setAutomationCurve(track().id, laneId, [pid], 'step');
    expect(track().automation![0].points[0].curve).toBe('step');
    s.setAutomationLane(track().id, laneId, { enabled: false });
    expect(track().automation![0].enabled).toBe(false);
    s.removeAutomationLane(track().id, laneId);
    expect(track().automation).toBeUndefined();
    s.undo();
    expect(track().automation).toHaveLength(1);
  });
});
