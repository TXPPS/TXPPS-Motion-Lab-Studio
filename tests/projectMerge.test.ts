import { describe, expect, it } from 'vitest';
import { mergeProjects } from '../src/app/projectMerge';
import { createEmptyProject } from '../src/model/demoProject';
import type { ProjectData, Track } from '../src/model/types';

let n = 0;
const makeId = (kind: string) => `${kind}-${n++}`;

function project(name: string): ProjectData {
  n = 0;
  return createEmptyProject(name);
}

/** A source project with a bus, a track routed to it, a send and automation. */
function sourceWithRouting(): ProjectData {
  const p = project('Source');
  const bus: Track = {
    id: 'srcBus',
    type: 'bus',
    name: 'Reverb',
    color: '#888',
    volume: 1,
    pan: 0,
    mute: false,
    solo: false,
    armed: false,
    collapsed: false,
    output: 'master',
  };
  const track: Track = {
    ...bus,
    id: 'srcTrack',
    type: 'audio',
    name: 'Gtr',
    output: 'srcBus',
    sends: [{ busId: 'srcBus', amount: 0.4, enabled: true, preFader: false }],
    automation: [
      {
        id: 'lane1',
        paramId: 'send:srcBus',
        enabled: true,
        points: [{ id: 'p1', beat: 2, value: 0.5, curve: 'linear' }],
      },
    ],
  };
  return { ...p, tracks: [track, bus] };
}

describe('merging projects', () => {
  it('adds the incoming tracks and clips without touching what is there', () => {
    const target = project('Target');
    const targetTracks = target.tracks.length;
    const source = { ...project('Source'), tracks: [...project('Source').tracks] };
    const result = mergeProjects(target, source, { makeId });
    expect(result.project.tracks.length).toBe(targetTracks + source.tracks.length);
    // the target's own objects are untouched, so undo of a merge is a plain swap
    expect(target.tracks.length).toBe(targetTracks);
  });

  it('rewrites routing, sends and send automation to the new track ids', () => {
    const result = mergeProjects(project('Target'), sourceWithRouting(), { makeId });
    const merged = result.project.tracks;
    const bus = merged.find((t) => t.name === 'Reverb')!;
    const track = merged.find((t) => t.name === 'Gtr')!;
    expect(bus.id).not.toBe('srcBus');
    expect(track.output).toBe(bus.id);
    expect(track.sends?.[0].busId).toBe(bus.id);
    expect(track.automation?.[0].paramId).toBe(`send:${bus.id}`);
    // nothing anywhere still names the old ids
    expect(JSON.stringify(result.project)).not.toContain('srcBus');
  });

  it('lands the material at the beat it was given, in time and in automation', () => {
    const source = sourceWithRouting();
    const withClip: ProjectData = {
      ...source,
      clips: [
        {
          id: 'c1',
          trackId: 'srcTrack',
          type: 'midi',
          name: 'Riff',
          start: 4,
          length: 4,
          muted: false,
          notes: [{ id: 'n1', start: 0, length: 1, pitch: 60, velocity: 100 }],
        },
      ],
    };
    const result = mergeProjects(project('Target'), withClip, { atBeat: 16, makeId });
    const clip = result.project.clips.at(-1)!;
    expect(clip.start).toBe(20);
    const track = result.project.tracks.find((t) => t.name === 'Gtr')!;
    expect(track.automation?.[0].points[0].beat).toBe(18);
    // note ids are renewed, or two clips would share them after a merge
    expect(clip.type === 'midi' && clip.notes[0].id).not.toBe('n1');
  });

  it('keeps names distinguishable rather than stacking two "Gtr" strips', () => {
    const target = mergeProjects(project('Target'), sourceWithRouting(), { makeId }).project;
    const twice = mergeProjects(target, sourceWithRouting(), { makeId }).project;
    const names = twice.tracks.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain('Gtr 2');
  });

  it('applies a prefix when one is asked for', () => {
    const result = mergeProjects(project('Target'), sourceWithRouting(), {
      prefix: 'Demo',
      makeId,
    });
    expect(result.project.tracks.some((t) => t.name === 'Demo Gtr')).toBe(true);
  });

  it('drops a send whose bus did not come across, and says so', () => {
    const source = sourceWithRouting();
    const orphaned: ProjectData = {
      ...source,
      tracks: source.tracks.filter((t) => t.id !== 'srcBus'),
    };
    const result = mergeProjects(project('Target'), orphaned, { makeId });
    const track = result.project.tracks.find((t) => t.name === 'Gtr')!;
    expect(track.sends).toEqual([]);
    expect(track.output).toBe('master');
    expect(result.warnings.some((w) => w.includes('send'))).toBe(true);
  });

  it('brings global tracks only when asked, shifted with the material', () => {
    const source: ProjectData = {
      ...project('Source'),
      markers: [{ id: 'm1', beat: 0, name: 'Verse' }],
      chords: [{ id: 'ch1', beat: 0, root: 0, quality: 'maj' }],
    };
    expect(mergeProjects(project('Target'), source, { makeId }).added.markers).toBe(0);
    const withGlobals = mergeProjects(project('Target'), source, {
      includeGlobalTracks: true,
      atBeat: 8,
      makeId,
    });
    expect(withGlobals.added.markers).toBe(1);
    expect(withGlobals.project.markers?.at(-1)?.beat).toBe(8);
    expect(withGlobals.project.chords?.at(-1)?.beat).toBe(8);
  });

  it('unfreezes an incoming frozen track rather than playing the wrong render', () => {
    const source = sourceWithRouting();
    const frozen: ProjectData = {
      ...source,
      tracks: source.tracks.map((t) =>
        t.id === 'srcTrack' ? { ...t, freeze: { mediaId: 'm', renderedAt: 1 } } : t,
      ),
    };
    const result = mergeProjects(project('Target'), frozen, { makeId });
    expect(result.project.tracks.find((t) => t.name === 'Gtr')?.freeze).toBeUndefined();
    expect(result.warnings.some((w) => w.includes('frozen'))).toBe(true);
  });

  it('warns when the incoming project had its own tempo changes', () => {
    const source: ProjectData = {
      ...project('Source'),
      tempoMap: {
        tempos: [
          { beat: 0, bpm: 120, ramp: false },
          { beat: 8, bpm: 90, ramp: false },
        ],
        sigs: [{ beat: 0, num: 4, den: 4 }],
      },
    };
    const result = mergeProjects(project('Target'), source, { makeId });
    expect(result.warnings.some((w) => w.toLowerCase().includes('tempo'))).toBe(true);
  });

  it('reports the media the incoming clips need', () => {
    const source = sourceWithRouting();
    const withAudio: ProjectData = {
      ...source,
      clips: [
        {
          id: 'a1',
          trackId: 'srcTrack',
          type: 'audio',
          name: 'Take',
          start: 0,
          length: 4,
          muted: false,
          mediaId: 'media-1',
          offset: 0,
          gain: 1,
          fadeIn: 0,
          fadeOut: 0,
        },
      ],
    };
    const result = mergeProjects(project('Target'), withAudio, { makeId });
    expect(result.mediaIds).toEqual(['media-1']);
  });
});
