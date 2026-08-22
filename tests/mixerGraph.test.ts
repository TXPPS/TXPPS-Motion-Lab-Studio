import { describe, expect, it } from 'vitest';
import {
  folderChain,
  folderDepth,
  folderDescendants,
  resolveChannels,
  visibleTracks,
} from '../src/model/mixerGraph';
import type { ProjectData, Track, TrackType } from '../src/model/types';

function track(id: string, type: TrackType = 'audio', patch: Partial<Track> = {}): Track {
  return {
    id,
    type,
    name: id,
    color: '#37b89a',
    volume: 1,
    pan: 0,
    mute: false,
    solo: false,
    armed: false,
    collapsed: false,
    output: 'master',
    ...patch,
  };
}

function project(tracks: Track[]): ProjectData {
  return {
    schemaVersion: 6,
    id: 'p',
    name: 'p',
    createdAt: 0,
    modifiedAt: 0,
    bpm: 120,
    timeSig: { num: 4, den: 4 },
    loop: { enabled: false, start: 0, end: 16 },
    metronome: false,
    masterVolume: 1,
    tracks,
    clips: [],
    workspace: { pxPerBeat: 26, snap: 0.25 },
  };
}

describe('folder structure', () => {
  const tracks = [
    track('drums', 'folder'),
    track('kick', 'audio', { folderId: 'drums' }),
    track('room', 'folder', { folderId: 'drums' }),
    track('oh', 'audio', { folderId: 'room' }),
    track('bass'),
  ];

  it('walks the ancestry outermost last', () => {
    expect(folderChain(tracks, tracks[3]).map((t) => t.id)).toEqual(['room', 'drums']);
    expect(folderDepth(tracks, tracks[3])).toBe(2);
    expect(folderDepth(tracks, tracks[4])).toBe(0);
  });

  it('collects descendants at any depth', () => {
    expect(
      folderDescendants(tracks, 'drums')
        .map((t) => t.id)
        .sort(),
    ).toEqual(['kick', 'oh', 'room'].sort());
  });

  it('hides a folded folder’s whole subtree', () => {
    const folded = tracks.map((t) => (t.id === 'drums' ? { ...t, folded: true } : t));
    expect(visibleTracks(folded).map((t) => t.id)).toEqual(['drums', 'bass']);
  });

  it('survives a folder cycle without hanging', () => {
    const cyclic = [
      track('a', 'folder', { folderId: 'b' }),
      track('b', 'folder', { folderId: 'a' }),
    ];
    expect(folderChain(cyclic, cyclic[0]).length).toBeLessThanOrEqual(2);
  });
});

describe('mute, solo, VCA and folder gain', () => {
  it('multiplies folder and VCA gain into the channel', () => {
    const tracks = [
      track('grp', 'folder', { volume: 0.5 }),
      track('vca1', 'vca', { volume: 0.5 }),
      track('gtr', 'audio', { volume: 0.8, folderId: 'grp', vcaId: 'vca1' }),
    ];
    const st = resolveChannels(project(tracks)).get('gtr')!;
    expect(st.gain).toBeCloseTo(0.8 * 0.5 * 0.5, 9);
    expect(st.audible).toBe(true);
  });

  it('mutes every child when the folder or the VCA is muted', () => {
    const tracks = [
      track('grp', 'folder', { mute: true }),
      track('gtr', 'audio', { folderId: 'grp' }),
      track('vca1', 'vca', { mute: true }),
      track('keys', 'audio', { vcaId: 'vca1' }),
      track('bass'),
    ];
    const st = resolveChannels(project(tracks));
    expect(st.get('gtr')).toMatchObject({ audible: false, mutedByGroup: true });
    expect(st.get('keys')).toMatchObject({ audible: false, mutedByGroup: true });
    expect(st.get('bass')!.audible).toBe(true);
  });

  it('keeps a soloed track’s bus and the bus’s send target open', () => {
    const tracks = [
      track('verb', 'fx'),
      track('drumbus', 'bus'),
      track('kick', 'audio', {
        output: 'drumbus',
        solo: true,
        sends: [{ busId: 'verb', amount: 0.4, enabled: true, preFader: false }],
      }),
      track('gtr'),
    ];
    const st = resolveChannels(project(tracks));
    expect(st.get('kick')!.audible).toBe(true);
    expect(st.get('drumbus')!.audible).toBe(true);
    expect(st.get('verb')!.audible).toBe(true);
    expect(st.get('gtr')).toMatchObject({ audible: false, mutedBySolo: true });
  });

  it('soloing a bus keeps its feeders audible', () => {
    const tracks = [
      track('drumbus', 'bus', { solo: true }),
      track('kick', 'audio', { output: 'drumbus' }),
      track('snare', 'audio', { output: 'drumbus' }),
      track('gtr'),
    ];
    const st = resolveChannels(project(tracks));
    expect(st.get('kick')!.audible).toBe(true);
    expect(st.get('snare')!.audible).toBe(true);
    expect(st.get('gtr')!.audible).toBe(false);
  });

  it('soloing a folder or a VCA solos its members', () => {
    const tracks = [
      track('grp', 'folder', { solo: true }),
      track('gtr', 'audio', { folderId: 'grp' }),
      track('vca1', 'vca'),
      track('keys', 'audio', { vcaId: 'vca1' }),
    ];
    const st = resolveChannels(project(tracks));
    expect(st.get('gtr')!.audible).toBe(true);
    expect(st.get('keys')!.audible).toBe(false);

    const soloVca = tracks.map((t) =>
      t.id === 'grp' ? { ...t, solo: false } : t.id === 'vca1' ? { ...t, solo: true } : t,
    );
    const st2 = resolveChannels(project(soloVca));
    expect(st2.get('keys')!.audible).toBe(true);
    expect(st2.get('gtr')!.audible).toBe(false);
  });

  it('solo-safe channels survive any solo', () => {
    const tracks = [
      track('verb', 'fx', { soloSafe: true }),
      track('kick', 'audio', { solo: true }),
      track('gtr'),
    ];
    const st = resolveChannels(project(tracks));
    expect(st.get('verb')!.audible).toBe(true);
    expect(st.get('gtr')!.audible).toBe(false);
  });

  it('a track’s own mute always wins over a solo', () => {
    const tracks = [track('kick', 'audio', { solo: true, mute: true })];
    expect(resolveChannels(project(tracks)).get('kick')!.audible).toBe(false);
  });
});
