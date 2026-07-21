import { describe, expect, it } from 'vitest';
import { collectSoundingAt, collectWindowEvents } from '../src/audio/scheduler';
import { createDemoProject } from '../src/model/demoProject';
import type { ProjectData } from '../src/model/types';

function baseProject(): ProjectData {
  return {
    schemaVersion: 1,
    id: 'p1',
    name: 'T',
    createdAt: 0,
    modifiedAt: 0,
    bpm: 120,
    timeSig: { num: 4, den: 4 },
    loop: { enabled: false, start: 0, end: 16 },
    metronome: false,
    masterVolume: 1,
    tracks: [
      {
        id: 'inst',
        type: 'instrument',
        name: 'i',
        color: '#fff',
        volume: 1,
        pan: 0,
        mute: false,
        solo: false,
        armed: false,
        collapsed: false,
        output: 'master',
        synth: undefined,
      },
      {
        id: 'aud',
        type: 'audio',
        name: 'a',
        color: '#fff',
        volume: 1,
        pan: 0,
        mute: false,
        solo: false,
        armed: false,
        collapsed: false,
        output: 'master',
      },
    ],
    clips: [],
    workspace: { pxPerBeat: 26, snap: 0.25 },
  };
}

describe('collectWindowEvents', () => {
  it('returns notes whose absolute start is in [from, to)', () => {
    const p = baseProject();
    p.clips.push({
      id: 'c1',
      trackId: 'inst',
      type: 'midi',
      name: 'm',
      start: 4,
      length: 4,
      muted: false,
      notes: [
        { id: 'n1', start: 0, length: 1, pitch: 60, velocity: 100 }, // abs 4
        { id: 'n2', start: 2, length: 1, pitch: 62, velocity: 100 }, // abs 6
      ],
    });
    const evs = collectWindowEvents(p, 4, 5);
    expect(evs).toHaveLength(1);
    expect(evs[0]).toMatchObject({ kind: 'note', pitch: 60, beat: 4 });
    // window that catches neither
    expect(collectWindowEvents(p, 8, 10)).toHaveLength(0);
  });

  it('skips muted clips', () => {
    const p = baseProject();
    p.clips.push({
      id: 'c1',
      trackId: 'inst',
      type: 'midi',
      name: 'm',
      start: 0,
      length: 4,
      muted: true,
      notes: [{ id: 'n1', start: 0, length: 1, pitch: 60, velocity: 100 }],
    });
    expect(collectWindowEvents(p, 0, 4)).toHaveLength(0);
  });

  it('clamps note duration to clip bounds and excludes notes past clip end', () => {
    const p = baseProject();
    p.clips.push({
      id: 'c1',
      trackId: 'inst',
      type: 'midi',
      name: 'm',
      start: 0,
      length: 2,
      muted: false,
      notes: [
        { id: 'n1', start: 1.5, length: 4, pitch: 60, velocity: 100 }, // dur clamped to 0.5
        { id: 'n2', start: 2.5, length: 1, pitch: 62, velocity: 100 }, // past clip end -> excluded
      ],
    });
    const evs = collectWindowEvents(p, 0, 4);
    expect(evs).toHaveLength(1);
    expect(evs[0]).toMatchObject({ pitch: 60 });
    if (evs[0].kind === 'note') expect(evs[0].durBeats).toBeCloseTo(0.5);
  });

  it('emits audio clip start events', () => {
    const p = baseProject();
    p.clips.push({
      id: 'a1',
      trackId: 'aud',
      type: 'audio',
      name: 'a',
      start: 2,
      length: 8,
      muted: false,
      mediaId: 'perc-110-2bar',
      offset: 0,
      gain: 1,
    });
    const evs = collectWindowEvents(p, 0, 4);
    expect(evs.some((e) => e.kind === 'clip')).toBe(true);
  });

  it('emits metronome clicks on the beat when enabled', () => {
    const p = baseProject();
    p.metronome = true;
    const evs = collectWindowEvents(p, 0, 4).filter((e) => e.kind === 'metronome');
    expect(evs).toHaveLength(4);
    // downbeat accented
    expect(evs.find((e) => e.kind === 'metronome' && e.beat === 0)).toMatchObject({ accent: true });
  });
});

describe('collectSoundingAt', () => {
  it('finds notes already playing at a beat (loop wrap / mid-play start)', () => {
    const p = baseProject();
    p.clips.push({
      id: 'c1',
      trackId: 'inst',
      type: 'midi',
      name: 'm',
      start: 0,
      length: 8,
      muted: false,
      notes: [{ id: 'n1', start: 0, length: 4, pitch: 60, velocity: 100 }], // sounds through beat 2
    });
    const evs = collectSoundingAt(p, 2);
    expect(evs).toHaveLength(1);
    if (evs[0].kind === 'note') {
      expect(evs[0].pitch).toBe(60);
      expect(evs[0].durBeats).toBeCloseTo(2); // remaining
    }
  });

  it('finds audio clips mid-playback and reports beats-into-clip', () => {
    const p = baseProject();
    p.clips.push({
      id: 'a1',
      trackId: 'aud',
      type: 'audio',
      name: 'a',
      start: 0,
      length: 8,
      muted: false,
      mediaId: 'perc-110-2bar',
      offset: 0,
      gain: 1,
    });
    const evs = collectSoundingAt(p, 3);
    expect(evs).toHaveLength(1);
    expect(evs[0].kind).toBe('clipMid');
    if (evs[0].kind === 'clipMid') expect(evs[0].intoBeats).toBeCloseTo(3);
  });

  it('excludes clips that have not started or already ended', () => {
    const p = baseProject();
    p.clips.push({
      id: 'c1',
      trackId: 'inst',
      type: 'midi',
      name: 'm',
      start: 4,
      length: 4,
      muted: false,
      notes: [{ id: 'n1', start: 0, length: 1, pitch: 60, velocity: 100 }],
    });
    expect(collectSoundingAt(p, 2)).toHaveLength(0); // not started
    expect(collectSoundingAt(p, 10)).toHaveLength(0); // ended
  });
});

describe('demo project integrity', () => {
  it('has content across track types and valid clip references', () => {
    const p = createDemoProject();
    expect(p.tracks.length).toBeGreaterThanOrEqual(5);
    expect(p.clips.length).toBeGreaterThan(5);
    const ids = new Set(p.tracks.map((t) => t.id));
    for (const c of p.clips) expect(ids.has(c.trackId)).toBe(true);
    expect(p.tracks.some((t) => t.type === 'drum')).toBe(true);
    expect(p.tracks.some((t) => t.type === 'instrument')).toBe(true);
    expect(p.tracks.some((t) => t.type === 'audio')).toBe(true);
    expect(p.tracks.some((t) => t.type === 'bus')).toBe(true);
  });

  it('keeps notes within their clip length', () => {
    const p = createDemoProject();
    for (const c of p.clips) {
      if (c.type === 'midi') {
        for (const n of c.notes) expect(n.start).toBeLessThan(c.length);
      }
    }
  });
});
