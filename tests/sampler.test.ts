import { describe, expect, it } from 'vitest';
import {
  DRUM_PAD_BASE,
  buildDrumKit,
  buildMultiSampler,
  buildQuickSampler,
  detectTransients,
  makeZone,
  matchZones,
  snapToZeroCrossing,
  validateSampler,
  zonePlaybackRate,
} from '../src/model/sampler';
import { validateProject } from '../src/persistence/projectRepo';
import { createDemoProject } from '../src/model/demoProject';
import { listAutoParams, paramIdExists } from '../src/model/paramRegistry';
import { useProjectStore } from '../src/state/projectStore';

describe('zone lookup', () => {
  const zones = [
    makeZone({ mediaId: 'a', keyLo: 0, keyHi: 59, velLo: 1, velHi: 127, rootNote: 48 }),
    makeZone({ mediaId: 'b', keyLo: 60, keyHi: 127, velLo: 1, velHi: 127, rootNote: 72 }),
    makeZone({ mediaId: 'soft', keyLo: 0, keyHi: 127, velLo: 1, velHi: 63 }),
    makeZone({ mediaId: 'hard', keyLo: 0, keyHi: 127, velLo: 64, velHi: 127 }),
  ];

  it('filters by key and velocity ranges', () => {
    const hits = matchZones(zones, 40, 100);
    const media = hits.map((h) => h.zone.mediaId).sort();
    expect(media).toEqual(['a', 'hard']);
    const soft = matchZones(zones, 80, 30)
      .map((h) => h.zone.mediaId)
      .sort();
    expect(soft).toEqual(['b', 'soft']);
  });

  it('mute removes and solo isolates zones', () => {
    const z = [
      makeZone({ mediaId: 'x', muted: true }),
      makeZone({ mediaId: 'y' }),
      makeZone({ mediaId: 'z', solo: true }),
    ];
    expect(matchZones(z, 60, 100).map((h) => h.zone.mediaId)).toEqual(['z']);
  });

  it('round robin alternates within a group', () => {
    const rr = [
      makeZone({ mediaId: 'r1', rrGroup: 1 }),
      makeZone({ mediaId: 'r2', rrGroup: 1 }),
      makeZone({ mediaId: 'r3', rrGroup: 1 }),
    ];
    const counters = new Map<number, number>();
    const picks = [0, 1, 2, 3].map(() => matchZones(rr, 60, 100, counters)[0].zone.mediaId);
    expect(picks).toEqual(['r1', 'r2', 'r3', 'r1']);
  });

  it('overlapping key ranges crossfade complementarily', () => {
    const xf = [
      makeZone({ mediaId: 'lo', keyLo: 0, keyHi: 70 }),
      makeZone({ mediaId: 'hi', keyLo: 60, keyHi: 127 }),
    ];
    const at65 = matchZones(xf, 65, 100);
    const lo = at65.find((h) => h.zone.mediaId === 'lo')!;
    const hi = at65.find((h) => h.zone.mediaId === 'hi')!;
    expect(lo.xfGain + hi.xfGain).toBeCloseTo(1, 5);
    expect(lo.xfGain).toBeCloseTo(0.5, 5);
    // Outside the overlap: full gain.
    expect(matchZones(xf, 30, 100)[0].xfGain).toBe(1);
  });

  it('playback rate follows key tracking and tune', () => {
    const z = makeZone({ mediaId: 'a', rootNote: 60 });
    expect(zonePlaybackRate(z, 72)).toBeCloseTo(2, 9);
    expect(zonePlaybackRate(z, 48)).toBeCloseTo(0.5, 9);
    const fixed = makeZone({ mediaId: 'a', rootNote: 60, keyTrack: false, tuneCoarse: 12 });
    expect(zonePlaybackRate(fixed, 100)).toBeCloseTo(2, 9);
    const fine = makeZone({ mediaId: 'a', rootNote: 60, tuneFine: 50 });
    expect(zonePlaybackRate(fine, 60)).toBeCloseTo(Math.pow(2, 0.5 / 12), 9);
  });
});

describe('slicing helpers', () => {
  it('snapToZeroCrossing finds the nearest crossing', () => {
    const sr = 1000;
    const data = new Float32Array(1000);
    for (let i = 0; i < 1000; i++) data[i] = Math.sin((i / 1000) * Math.PI * 8);
    // crossings every 125 samples; ask near 130 → 125
    const snapped = snapToZeroCrossing(data, sr, 0.13, 0.02);
    // the crossing lands on sample 125/126 depending on float rounding at sin(pi)
    expect(Math.abs(snapped * sr - 125)).toBeLessThanOrEqual(1);
  });

  it('detectTransients marks separated hits and respects the gap', () => {
    const sr = 8000;
    const data = new Float32Array(sr); // one second
    const hits = [0.1, 0.35, 0.36, 0.7];
    for (const h of hits) {
      const at = Math.round(h * sr);
      for (let i = 0; i < 200; i++) data[at + i] = (1 - i / 200) * (i % 2 ? -0.9 : 0.9);
    }
    const markers = detectTransients(data, sr, { minGapSec: 0.05 });
    // The 0.35/0.36 pair collapses into one marker via the gap rule.
    expect(markers.length).toBe(3);
    expect(Math.abs(markers[0] - 0.1)).toBeLessThan(0.02);
    expect(Math.abs(markers[2] - 0.7)).toBeLessThan(0.02);
  });
});

describe('presets and validation', () => {
  it('drum kit builder makes fixed-key one-shot pads with a hat choke group', () => {
    const kit = buildDrumKit();
    expect(kit.view).toBe('drum');
    expect(kit.zones.length).toBeGreaterThanOrEqual(8);
    for (const z of kit.zones) {
      expect(z.keyLo).toBe(z.keyHi);
      expect(z.keyTrack).toBe(false);
      expect(z.oneShot).toBe(true);
    }
    const chokes = kit.zones.filter((z) => z.chokeGroup === 1);
    expect(chokes.length).toBeGreaterThanOrEqual(2);
  });

  it('quick and multi builders map zones sensibly', () => {
    const q = buildQuickSampler('perc-110-2bar', 'Perc');
    expect(q.zones).toHaveLength(1);
    expect(q.zones[0].keyLo).toBe(0);
    expect(q.zones[0].keyHi).toBe(127);
    const m = buildMultiSampler('texture-110-4bar', 'Tex');
    expect(m.zones.length).toBeGreaterThanOrEqual(4);
    // neighbouring zones overlap for crossfading
    expect(m.zones[1].keyLo).toBeLessThanOrEqual(m.zones[0].keyHi);
  });

  it('validateSampler clamps garbage and drops unusable zones', () => {
    const v = validateSampler({
      view: 'nonsense',
      zones: [
        { mediaId: 'ok', keyLo: -5, keyHi: 400, velLo: 0, velHi: 900, gain: 99 },
        { noMedia: true },
        null,
      ],
      attack: -3,
      volume: 99,
      filterType: 'weird',
      lfoTarget: 42,
    });
    expect(v).not.toBeNull();
    expect(v!.view).toBe('quick');
    expect(v!.zones).toHaveLength(1);
    expect(v!.zones[0].keyLo).toBe(0);
    expect(v!.zones[0].keyHi).toBe(127);
    expect(v!.zones[0].gain).toBe(4);
    expect(v!.volume).toBe(1.5);
    expect(v!.filterType).toBe('off');
    expect(validateSampler({ zones: 'no' })).toBeNull();
  });

  it('sampler tracks survive a validateProject round-trip', () => {
    const p = createDemoProject();
    const t = p.tracks.find((x) => x.type === 'instrument')!;
    t.sampler = buildDrumKit();
    const revived = validateProject(JSON.parse(JSON.stringify(p)));
    const rt = revived.tracks.find((x) => x.id === t.id)!;
    expect(rt.sampler).toBeDefined();
    expect(rt.sampler!.zones.length).toBe(t.sampler.zones.length);
  });
});

describe('store + automation integration', () => {
  const boot = () => {
    useProjectStore.getState().setProject(createDemoProject(), { markClean: true });
    return useProjectStore.getState();
  };
  const instTrack = () =>
    useProjectStore.getState().project.tracks.find((t) => t.type === 'instrument')!;

  it('setInstrument switches kinds and applySamplerPreset installs kits', () => {
    const s = boot();
    s.setInstrument(instTrack().id, 'drum');
    expect(instTrack().sampler?.view).toBe('drum');
    expect(instTrack().sampler!.zones.length).toBeGreaterThan(4);
    s.setInstrument(instTrack().id, 'synth');
    expect(instTrack().sampler).toBeUndefined();
    s.undo();
    expect(instTrack().sampler?.view).toBe('drum');
  });

  it('assignPad creates and replaces pad zones', () => {
    const s = boot();
    s.setInstrument(instTrack().id, 'quick');
    s.assignPad(instTrack().id, 3, 'hit-kick', 'Kick');
    let pad = instTrack().sampler!.zones.find((z) => z.keyLo === DRUM_PAD_BASE + 3)!;
    expect(pad.mediaId).toBe('hit-kick');
    s.assignPad(instTrack().id, 3, 'hit-snare');
    pad = instTrack().sampler!.zones.find((z) => z.keyLo === DRUM_PAD_BASE + 3)!;
    expect(pad.mediaId).toBe('hit-snare');
    expect(instTrack().sampler!.zones.filter((z) => z.keyLo === DRUM_PAD_BASE + 3)).toHaveLength(1);
  });

  it('slices convert to pads and to a MIDI clip', () => {
    const s = boot();
    s.setInstrument(instTrack().id, 'quick');
    const zid = s.addSamplerZones(instTrack().id, [
      makeZone({ mediaId: 'perc-110-2bar', name: 'Loop' }),
    ])[0];
    s.setZoneSlices(instTrack().id, zid, [0, 0.5, 1.0, 1.5]);
    const clipId = s.sliceToMidiClip(instTrack().id, zid, 4)!;
    const clip = useProjectStore.getState().project.clips.find((c) => c.id === clipId)!;
    expect(clip.type).toBe('midi');
    expect((clip as { notes: unknown[] }).notes).toHaveLength(4);

    const pads = s.sliceToPads(instTrack().id, zid);
    expect(pads).toBe(4);
    expect(instTrack().sampler!.view).toBe('drum');
    const first = instTrack().sampler!.zones[0];
    expect(first.startSec).toBe(0);
    expect(first.endSec).toBeCloseTo(0.5, 9);
  });

  it('smp: parameters register for sampler tracks and not for racks', () => {
    const s = boot();
    const p = useProjectStore.getState().project;
    const t = instTrack();
    s.setInstrument(t.id, 'quick');
    const ids = listAutoParams(instTrack(), p).map((x) => x.id);
    expect(ids).toContain('smp:filterCutoff');
    expect(ids).not.toContain('synth:cutoff');
    expect(paramIdExists(instTrack(), 'smp:volume')).toBe(true);
    s.rackAddItem(t.id, 'synth');
    expect(paramIdExists(instTrack(), 'smp:volume')).toBe(false);
  });

  it('rack items add, update, reorder, remove', () => {
    const s = boot();
    const t = instTrack();
    const a = s.rackAddItem(t.id, 'synth')!;
    const b = s.rackAddItem(t.id, 'sampler')!;
    expect(instTrack().rack!.items).toHaveLength(2);
    s.rackUpdateItem(t.id, b, { keyLo: 60, name: 'Highs' });
    expect(instTrack().rack!.items[1].keyLo).toBe(60);
    s.rackMoveItem(t.id, b, -1);
    expect(instTrack().rack!.items[0].id).toBe(b);
    s.rackRemoveItem(t.id, b);
    s.rackRemoveItem(t.id, a);
    expect(instTrack().rack).toBeUndefined();
  });
});
