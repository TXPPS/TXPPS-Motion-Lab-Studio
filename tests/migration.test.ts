import { describe, expect, it } from 'vitest';
import { validateProject } from '../src/persistence/projectRepo';
import { SCHEMA_VERSION } from '../src/model/types';
import type { AudioClip } from '../src/model/types';
import { MAX_INSERTS } from '../src/model/effects';

/**
 * A minimal but realistic Milestone 1 project: schema v1, audio clips with no
 * gain/fade/offset fields, tracks with no sends or effects, and no media array.
 * This is exactly the shape already sitting in a real user's IndexedDB.
 */
function v1Project(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    id: 'p1',
    name: 'Old Project',
    bpm: 128,
    timeSig: { num: 4, den: 4 },
    masterVolume: 0.8,
    loop: { enabled: false, start: 0, end: 16 },
    metronome: false,
    createdAt: 1,
    modifiedAt: 2,
    tracks: [
      {
        id: 't1',
        type: 'audio',
        name: 'Audio',
        color: '#fff',
        volume: 1,
        pan: 0,
        mute: false,
        solo: false,
        armed: false,
        collapsed: false,
        output: 'master',
      },
      {
        id: 'bus1',
        type: 'bus',
        name: 'Bus',
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
    clips: [
      {
        id: 'c1',
        trackId: 't1',
        type: 'audio',
        name: 'Loop',
        start: 0,
        length: 8,
        muted: false,
        mediaId: 'perc-110-2bar',
      },
    ],
  };
}

describe('v1 to v2 migration', () => {
  it('upgrades the schema version', () => {
    expect(validateProject(v1Project()).schemaVersion).toBe(SCHEMA_VERSION);
  });

  it('fills in the audio-clip fields v1 never wrote, without moving the clip', () => {
    const p = validateProject(v1Project());
    const clip = p.clips[0] as AudioClip;
    expect(clip.start).toBe(0);
    expect(clip.length).toBe(8);
    expect(clip.mediaId).toBe('perc-110-2bar');
    expect(clip.offset).toBe(0);
    expect(clip.gain).toBe(1);
    expect(clip.fadeIn).toBe(0);
    expect(clip.fadeOut).toBe(0);
  });

  it('leaves a v1 project with no media array in a usable state', () => {
    const p = validateProject(v1Project());
    expect(Array.isArray(p.media)).toBe(true);
    expect(p.media).toEqual([]);
  });

  it('does not invent sends or effects on v1 tracks', () => {
    const p = validateProject(v1Project());
    for (const t of p.tracks) {
      expect(t.sends ?? []).toEqual([]);
      expect(t.effects ?? []).toEqual([]);
    }
  });

  it('preserves v2 fields that are already present', () => {
    const raw = v1Project();
    raw.schemaVersion = 2;
    (raw.clips as Record<string, unknown>[])[0].gain = 0.5;
    (raw.clips as Record<string, unknown>[])[0].fadeIn = 1.5;
    (raw.clips as Record<string, unknown>[])[0].offset = 0.25;
    const clip = validateProject(raw).clips[0] as AudioClip;
    expect(clip.gain).toBe(0.5);
    expect(clip.fadeIn).toBe(1.5);
    expect(clip.offset).toBe(0.25);
  });
});

describe('hostile and corrupt project data', () => {
  it('drops sends pointing at tracks that do not exist', () => {
    const raw = v1Project();
    (raw.tracks as Record<string, unknown>[])[0].sends = [
      { busId: 'ghost-bus', amount: 0.5, enabled: true, preFader: false },
      { busId: 'bus1', amount: 0.4, enabled: true, preFader: false },
    ];
    const t = validateProject(raw).tracks[0];
    expect(t.sends!.map((s) => s.busId)).toEqual(['bus1']);
  });

  it('drops a send from a track to itself', () => {
    const raw = v1Project();
    (raw.tracks as Record<string, unknown>[])[0].sends = [
      { busId: 't1', amount: 0.5, enabled: true, preFader: false },
    ];
    expect(validateProject(raw).tracks[0].sends).toEqual([]);
  });

  it('drops effects of an unknown kind rather than loading a broken chain', () => {
    const raw = v1Project();
    (raw.tracks as Record<string, unknown>[])[0].effects = [
      { id: 'f1', kind: 'quantum-flux', bypass: false, params: {} },
      { id: 'f2', kind: 'eq3', bypass: false, params: {} },
    ];
    const fx = validateProject(raw).tracks[0].effects!;
    expect(fx.map((e) => e.kind)).toEqual(['eq3']);
  });

  it('clamps effect parameters so a corrupt value can never reach an AudioParam', () => {
    const raw = v1Project();
    (raw.tracks as Record<string, unknown>[])[0].effects = [
      {
        id: 'f1',
        kind: 'compressor',
        bypass: false,
        params: { threshold: -9999, ratio: 1e9, attack: NaN },
      },
    ];
    const fx = validateProject(raw).tracks[0].effects![0];
    expect(fx.params.threshold).toBe(-60);
    expect(fx.params.ratio).toBe(20);
    expect(Number.isFinite(fx.params.attack)).toBe(true);
  });

  it('enforces the insert cap on loaded projects', () => {
    const raw = v1Project();
    (raw.tracks as Record<string, unknown>[])[0].effects = Array.from({ length: 40 }, (_, i) => ({
      id: `f${i}`,
      kind: 'trim',
      bypass: false,
      params: {},
    }));
    expect(validateProject(raw).tracks[0].effects!.length).toBe(MAX_INSERTS);
  });

  it('discards non-array sends and effects instead of throwing', () => {
    const raw = v1Project();
    (raw.tracks as Record<string, unknown>[])[0].sends = 'not an array';
    (raw.tracks as Record<string, unknown>[])[0].effects = { nope: true };
    const t = validateProject(raw).tracks[0];
    expect(t.sends ?? []).toEqual([]);
    expect(t.effects ?? []).toEqual([]);
  });

  it('drops media entries that are missing required fields', () => {
    const raw = v1Project();
    raw.media = [{ id: 'm1', duration: 3.5 }, { id: 'm2' }, { duration: 1 }, 'garbage', null];
    expect(validateProject(raw).media!.map((m) => m.id)).toEqual(['m1']);
  });

  it('strips a non-numeric sourceDuration rather than carrying it into the engine', () => {
    const raw = v1Project();
    (raw.clips as Record<string, unknown>[])[0].sourceDuration = 'four seconds';
    const clip = validateProject(raw).clips[0] as AudioClip;
    expect(clip.sourceDuration).toBeUndefined();
  });
});
