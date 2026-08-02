import { describe, expect, it } from 'vitest';
import { computeClipSchedule, fadeGain } from '../src/audio/clipSchedule';
import {
  buildTakeClip,
  compSpans,
  expandCompClip,
  normalizeComp,
  COMP_JOIN_FADE_SEC,
} from '../src/model/comping';
import { useProjectStore } from '../src/state/projectStore';
import { createDemoProject } from '../src/model/demoProject';
import { validateProject } from '../src/persistence/projectRepo';
import type { AudioClip, ProjectData } from '../src/model/types';

const SPB = 0.5; // 120 bpm

function audioClip(patch: Partial<AudioClip>): AudioClip {
  return {
    id: patch.id ?? 'c1',
    trackId: patch.trackId ?? 't1',
    type: 'audio',
    name: 'A',
    start: 0,
    length: 4,
    muted: false,
    mediaId: 'm1',
    offset: 0,
    sourceDuration: 2,
    gain: 1,
    fadeIn: 0,
    fadeOut: 0,
    ...patch,
  };
}

describe('fade shapes', () => {
  it('hit endpoints for every shape', () => {
    for (const s of ['linear', 'equalPower', 'equalGain', 's'] as const) {
      expect(fadeGain(0, s)).toBe(0);
      expect(fadeGain(1, s)).toBe(1);
    }
  });

  it('equal power crosses at -3dB; amplitude pairs sum to unity', () => {
    expect(fadeGain(0.5, 'equalPower')).toBeCloseTo(Math.SQRT1_2, 6);
    for (const t of [0.1, 0.35, 0.5, 0.8]) {
      expect(fadeGain(t, 'linear') + fadeGain(1 - t, 'linear')).toBeCloseTo(1, 9);
      expect(fadeGain(t, 's') + fadeGain(1 - t, 's')).toBeCloseTo(1, 9);
      const p = fadeGain(t, 'equalPower');
      const q = fadeGain(1 - t, 'equalPower');
      expect(p * p + q * q).toBeCloseTo(1, 6);
    }
  });

  it('curved fades emit subdivided envelopes; phase invert negates them', () => {
    const clip = audioClip({ fadeIn: 1, fadeInShape: 'equalPower', sourceDuration: 2 });
    const plan = computeClipSchedule(clip, 0, 10, SPB)!;
    expect(plan.envelope.length).toBeGreaterThan(4);
    const mid = plan.envelope.find((p) => Math.abs(p.t - 0.5) < 0.001)!;
    expect(mid.value).toBeCloseTo(Math.SQRT1_2, 3);

    const inv = computeClipSchedule({ ...clip, phaseInvert: true }, 0, 10, SPB)!;
    expect(Math.min(...inv.envelope.map((p) => p.value))).toBeLessThan(0);
    expect(inv.envelope[inv.envelope.length - 1].value).toBeCloseTo(-mid.value * 0 - 1, 1);
  });

  it('mid-fade entry starts at the shaped level, not silence', () => {
    const clip = audioClip({ fadeIn: 1, fadeInShape: 's', sourceDuration: 2 });
    const plan = computeClipSchedule(clip, 0.5, 10, SPB)!;
    expect(plan.envelope[0].value).toBeCloseTo(fadeGain(0.5, 's'), 6);
  });
});

describe('comping model', () => {
  const takes = [
    { id: 'tA', name: 'A', mediaId: 'mA', offset: 0 },
    { id: 'tB', name: 'B', mediaId: 'mB', offset: 1 },
  ];

  it('normalizeComp sorts, dedupes, anchors at zero and drops unknown takes', () => {
    const segs = normalizeComp(
      [
        { at: 2, takeId: 'tB' },
        { at: 0.5, takeId: 'ghost' },
        { at: 2, takeId: 'tA' },
        { at: 6, takeId: 'tB' },
      ],
      takes,
      4,
    );
    expect(segs[0].at).toBe(0);
    expect(segs.map((s) => s.takeId)).toEqual(['tB', 'tA', 'tB']);
    expect(segs[2].at).toBe(4);
  });

  it('compSpans honours solo audition', () => {
    const clip = audioClip({
      takes,
      comp: [
        { at: 0, takeId: 'tA' },
        { at: 2, takeId: 'tB' },
      ],
      soloTakeId: 'tB',
    });
    const spans = compSpans(clip);
    expect(spans).toHaveLength(1);
    expect(spans[0].take.id).toBe('tB');
  });

  it('expandCompClip maps offsets and adds micro-fades at internal joins', () => {
    const clip = audioClip({
      start: 8,
      length: 4,
      fadeIn: 0.2,
      fadeOut: 0.3,
      takes,
      comp: [
        { at: 0, takeId: 'tA' },
        { at: 2, takeId: 'tB' },
      ],
    });
    const parts = expandCompClip(clip, SPB);
    expect(parts).toHaveLength(2);
    expect(parts[0].start).toBe(8);
    expect(parts[0].offset).toBe(0);
    expect(parts[0].fadeIn).toBeCloseTo(0.2, 9); // the clip's own fade
    expect(parts[0].fadeOut).toBeCloseTo(COMP_JOIN_FADE_SEC, 9); // internal join
    expect(parts[1].start).toBe(10);
    expect(parts[1].offset).toBeCloseTo(1 + 2 * SPB, 9);
    expect(parts[1].fadeIn).toBeCloseTo(COMP_JOIN_FADE_SEC, 9);
    expect(parts[1].fadeOut).toBeCloseTo(0.3, 9);
    expect(parts[1].mediaId).toBe('mB');
  });

  it('a take that starts late leaves silence, not negative offsets', () => {
    const clip = audioClip({
      length: 4,
      takes: [{ id: 'tL', name: 'L', mediaId: 'mL', offset: -1 }],
      comp: [{ at: 0, takeId: 'tL' }],
    });
    const parts = expandCompClip(clip, SPB);
    expect(parts).toHaveLength(1);
    expect(parts[0].offset).toBe(0);
    expect(parts[0].start).toBeCloseTo(0 + 1 / SPB, 9);
  });

  it('buildTakeClip aligns takes to the base start', () => {
    const a = audioClip({ id: 'a', start: 4, length: 4, offset: 0.5, mediaId: 'mA' });
    const b = audioClip({ id: 'b', start: 6, length: 4, offset: 0, mediaId: 'mB' });
    const packed = buildTakeClip([a, b], SPB)!;
    expect(packed.start).toBe(4);
    expect(packed.length).toBe(6);
    expect(packed.takes).toHaveLength(2);
    expect(packed.takes![0].offset).toBeCloseTo(0.5, 9);
    expect(packed.takes![1].offset).toBeCloseTo(0 - 2 * SPB, 9);
    expect(packed.comp![0].takeId).toBe(packed.takes![0].id);
  });
});

function bootWithClips(clips: AudioClip[]): ProjectData {
  const p = createDemoProject();
  const t = p.tracks.find((x) => x.type === 'audio')!;
  for (const c of clips) c.trackId = t.id;
  p.clips = clips as ProjectData['clips'];
  useProjectStore.getState().setProject(p, { markClean: true });
  return useProjectStore.getState().project;
}

const clipsNow = () => useProjectStore.getState().project.clips as AudioClip[];

describe('store: heal, ripple, crossfade, takes, locks', () => {
  it('heals a split pair with contiguous material, refuses others', () => {
    bootWithClips([
      audioClip({ id: 'L', start: 0, length: 2, offset: 0, sourceDuration: 1 }),
      audioClip({ id: 'R', start: 2, length: 2, offset: 1, sourceDuration: 1 }),
      audioClip({ id: 'X', start: 4, length: 2, offset: 9, sourceDuration: 1 }),
    ]);
    const s = useProjectStore.getState();
    expect(s.healClips(['L', 'R', 'X'])).toBe(1);
    const healed = clipsNow().find((c) => c.id === 'L')!;
    expect(healed.length).toBe(4);
    expect(healed.sourceDuration).toBeCloseTo(2, 9);
    expect(clipsNow().some((c) => c.id === 'R')).toBe(false);
    expect(clipsNow().some((c) => c.id === 'X')).toBe(true);
    s.undo();
    expect(clipsNow().some((c) => c.id === 'R')).toBe(true);
  });

  it('ripple delete pulls later clips left and skips locked material', () => {
    bootWithClips([
      audioClip({ id: 'A', start: 0, length: 2 }),
      audioClip({ id: 'B', start: 4, length: 2 }),
      audioClip({ id: 'C', start: 8, length: 2, locked: true }),
    ]);
    const s = useProjectStore.getState();
    s.rippleDeleteClips(['B']);
    const a = clipsNow().find((c) => c.id === 'A')!;
    const cLocked = clipsNow().find((c) => c.id === 'C')!;
    expect(clipsNow().some((c) => c.id === 'B')).toBe(false);
    expect(a.start).toBe(0);
    expect(cLocked.start).toBe(8); // locked: not pulled
    s.undo();
    expect(clipsNow().some((c) => c.id === 'B')).toBe(true);
  });

  it('createCrossfade sets complementary shaped fades over the overlap', () => {
    bootWithClips([
      audioClip({ id: 'L', start: 0, length: 4, sourceDuration: 2 }),
      audioClip({ id: 'R', start: 3, length: 4, offset: 0.5, sourceDuration: 2 }),
    ]);
    const s = useProjectStore.getState();
    expect(s.createCrossfade('L', 'R', 1, 'equalPower')).toBe(true);
    const l = clipsNow().find((c) => c.id === 'L')!;
    const r = clipsNow().find((c) => c.id === 'R')!;
    const spb = 60 / useProjectStore.getState().project.bpm;
    expect(l.fadeOut).toBeCloseTo(1 * spb, 6);
    expect(r.fadeIn).toBeCloseTo(1 * spb, 6);
    expect(l.fadeOutShape).toBe('equalPower');
    expect(r.fadeInShape).toBe('equalPower');
    s.undo();
    expect(clipsNow().find((c) => c.id === 'L')!.fadeOut).toBe(0);
  });

  it('packTakes replaces clips with one take clip; swipe and promote comp it', () => {
    bootWithClips([
      audioClip({ id: 'A', start: 0, length: 4, mediaId: 'mA' }),
      audioClip({ id: 'B', start: 0, length: 4, mediaId: 'mB' }),
    ]);
    const s = useProjectStore.getState();
    const packedId = s.packTakes(['A', 'B'])!;
    expect(packedId).not.toBeNull();
    let packed = clipsNow().find((c) => c.id === packedId)!;
    expect(packed.takes).toHaveLength(2);
    expect(clipsNow()).toHaveLength(1);

    const tB = packed.takes![1].id;
    s.setCompRange(packedId, 1, 3, tB);
    packed = clipsNow().find((c) => c.id === packedId)!;
    expect(packed.comp!.map((x) => x.takeId)).toEqual([
      packed.takes![0].id,
      tB,
      packed.takes![0].id,
    ]);

    s.promoteTake(packedId, tB);
    packed = clipsNow().find((c) => c.id === packedId)!;
    expect(packed.comp).toEqual([{ at: 0, takeId: tB }]);

    // Deleting down to the last take flattens to a plain clip.
    s.deleteTake(packedId, packed.takes![0].id);
    packed = clipsNow().find((c) => c.id === packedId)!;
    expect(packed.takes).toHaveLength(1);
    s.deleteTake(packedId, packed.takes![0].id);
    packed = clipsNow().find((c) => c.id === packedId)!;
    expect(packed.takes).toBeUndefined();
    expect(packed.mediaId).toBe('mB');
  });

  it('locked clips and locked tracks refuse timing edits', () => {
    bootWithClips([audioClip({ id: 'A', start: 4, length: 2, locked: true })]);
    const s = useProjectStore.getState();
    s.moveClip('A', 0);
    expect(clipsNow()[0].start).toBe(4);
    s.deleteClips(['A']);
    expect(clipsNow()).toHaveLength(1);
    expect(s.splitClip('A', 5)).toBeNull();

    // Track lock blocks even unlocked clips.
    s.setClip('A', { locked: false });
    const trackId = clipsNow()[0].trackId;
    s.setTrack(trackId, { locked: true });
    s.moveClip('A', 0);
    expect(clipsNow()[0].start).toBe(4);
    s.setTrack(trackId, { locked: false });
    s.moveClip('A', 0);
    expect(clipsNow()[0].start).toBe(0);
  });

  it('slip clamps at zero and at the media end', () => {
    bootWithClips([audioClip({ id: 'A', offset: 0.4, sourceDuration: 1 })]);
    const s = useProjectStore.getState();
    s.slipClip('A', -1);
    expect(clipsNow()[0].offset).toBe(0);
    s.slipClip('A', 10, 1.5);
    expect(clipsNow()[0].offset).toBe(1.5);
  });

  it('the audio-edit fixture is dense, deterministic and valid', async () => {
    const { createAudioEditQaProject } = await import('../src/model/audioEditQaProject');
    const p = createAudioEditQaProject();
    expect(p.clips.length).toBeGreaterThanOrEqual(2000);
    const withTakes = p.clips.filter((c) => c.type === 'audio' && c.takes?.length);
    expect(withTakes.length).toBeGreaterThanOrEqual(2);
    const faded = p.clips.filter(
      (c) => c.type === 'audio' && (c.fadeIn > 0 || c.fadeOut > 0),
    );
    expect(faded.length).toBeGreaterThan(1900);
    const revived = validateProject(JSON.parse(JSON.stringify(p)));
    expect(revived.clips.length).toBe(p.clips.length);
    expect(revived.tracks.some((t) => t.locked)).toBe(true);
    expect(revived.tracks.filter((t) => t.editGroup === 1)).toHaveLength(2);
  });

  it('take clips survive validation round-trips', () => {
    bootWithClips([
      audioClip({ id: 'A', start: 0, length: 4, mediaId: 'mA' }),
      audioClip({ id: 'B', start: 0, length: 4, mediaId: 'mB' }),
    ]);
    const s = useProjectStore.getState();
    const packedId = s.packTakes(['A', 'B'])!;
    const revived = validateProject(JSON.parse(JSON.stringify(useProjectStore.getState().project)));
    const packed = revived.clips.find((c) => c.id === packedId) as AudioClip;
    expect(packed.takes).toHaveLength(2);
    expect(packed.comp![0].at).toBe(0);
    expect(revived.schemaVersion).toBe(5);
  });
});
