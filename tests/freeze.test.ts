import { beforeEach, describe, expect, it } from 'vitest';
import {
  FREEZE_CLIP_PREFIX,
  freezeClipFor,
  freezeRefusal,
  freezeRenderProject,
  isFrozen,
  staleFreezeTrackIds,
  trackEndBeat,
} from '../src/model/freeze';
import { collectSoundingAt, collectWindowEvents } from '../src/audio/scheduler';
import { usedMediaIds } from '../src/model/media';
import type { MediaRef } from '../src/model/media';
import { createEmptyProject } from '../src/model/demoProject';
import { loadProject, saveProject, validateProject } from '../src/persistence/projectRepo';
import { resetDbConnection } from '../src/persistence/db';
import { listMediaIds, pruneOrphanedMedia, putMediaBlob } from '../src/persistence/mediaStore';
import { useProjectStore } from '../src/state/projectStore';
import type { MidiClip, ProjectData, Track } from '../src/model/types';

/**
 * Freeze: a track plays a rendered file instead of its instrument.
 *
 * The render itself needs a real browser (see `e2e/freeze.spec.ts`, which
 * proves the print is inaudibly close to the instrument it replaces). What is
 * provable here is everything around it: what the print stands in for, what
 * makes a print a lie, and that the audio a frozen track depends on survives a
 * save, a reload and a media cleanup.
 */

const PRINT: MediaRef = {
  id: 'freeze-1',
  name: 'Synth 1 (frozen)',
  kind: 'freeze',
  duration: 8,
  sampleRate: 48000,
  channels: 2,
  byteSize: 1536000,
  createdAt: 1,
  source: 'Freeze of Synth 1',
  peaksVersion: 0,
};

/** A one-instrument song with four bars of notes, frozen or not. */
function song(opts: { frozen?: boolean } = {}): ProjectData {
  const p = createEmptyProject('Freeze');
  const track = p.tracks[0];
  track.id = 'inst';
  const clip: MidiClip = {
    id: 'c1',
    trackId: 'inst',
    type: 'midi',
    name: 'Part',
    start: 0,
    length: 8,
    muted: false,
    notes: [
      { id: 'n1', start: 0, length: 2, pitch: 60, velocity: 100 },
      { id: 'n2', start: 4, length: 2, pitch: 64, velocity: 90 },
    ],
  };
  p.clips = [clip];
  if (opts.frozen) {
    track.freeze = { mediaId: PRINT.id, renderedAt: 1700000000000 };
    p.media = [PRINT];
  }
  return p;
}

const trackOf = (p: ProjectData): Track => p.tracks[0];

describe('the clip a frozen track plays', () => {
  it('is nothing at all when the track is not frozen', () => {
    const p = song();
    expect(isFrozen(trackOf(p))).toBe(false);
    expect(freezeClipFor(p, trackOf(p))).toBeNull();
  });

  it('covers the print, from beat 0, at unity', () => {
    const p = song({ frozen: true });
    const clip = freezeClipFor(p, trackOf(p))!;
    expect(clip.id).toBe(`${FREEZE_CLIP_PREFIX}inst`);
    expect(clip.start).toBe(0);
    expect(clip.offset).toBe(0);
    expect(clip.gain).toBe(1);
    expect(clip.sourceDuration).toBe(PRINT.duration);
    // 8 seconds at 120 bpm is 16 beats: the print is laid out in song time, so
    // entering part-way needs no mapping at all.
    expect(clip.length).toBeCloseTo(16);
  });

  it('is nothing when the metadata for the print has gone', () => {
    const p = song({ frozen: true });
    p.media = [];
    expect(freezeClipFor(p, trackOf(p))).toBeNull();
  });
});

describe('what the transport schedules', () => {
  it('schedules the notes while the track is live', () => {
    const p = song();
    const events = collectWindowEvents(p, 0, 8);
    expect(events.filter((e) => e.kind === 'note')).toHaveLength(2);
    expect(events.filter((e) => e.kind === 'clip')).toHaveLength(0);
  });

  it('schedules the print instead, and not one note', () => {
    const p = song({ frozen: true });
    const events = collectWindowEvents(p, 0, 8);
    expect(events.filter((e) => e.kind === 'note')).toHaveLength(0);
    const clips = events.filter((e) => e.kind === 'clip');
    expect(clips).toHaveLength(1);
    expect(clips[0].kind === 'clip' && clips[0].clip.mediaId).toBe(PRINT.id);
  });

  it('enters the print part-way when playback starts inside it', () => {
    const p = song({ frozen: true });
    const sounding = collectSoundingAt(p, 4);
    expect(sounding).toHaveLength(1);
    expect(sounding[0].kind).toBe('clipMid');
  });
});

describe('a print that no longer tells the truth', () => {
  const frozen = () => song({ frozen: true });

  function editing(mutate: (p: ProjectData) => void): string[] {
    const before = frozen();
    const after = structuredClone(before);
    mutate(after);
    return staleFreezeTrackIds(before, after);
  }

  it('survives everything that is applied after the print', () => {
    expect(editing((p) => (trackOf(p).volume = 0.2))).toEqual([]);
    expect(editing((p) => (trackOf(p).pan = -0.5))).toEqual([]);
    expect(editing((p) => (trackOf(p).mute = true))).toEqual([]);
    expect(
      editing(
        (p) => (trackOf(p).sends = [{ busId: 'b', amount: 0.4, enabled: true, preFader: false }]),
      ),
    ).toEqual([]);
    expect(editing((p) => (p.name = 'Renamed'))).toEqual([]);
  });

  it('is released by anything the print was made from', () => {
    expect(editing((p) => ((p.clips[0] as MidiClip).notes[0].pitch = 61))).toEqual(['inst']);
    expect(
      editing((p) =>
        (p.clips[0] as MidiClip).notes.push({
          id: 'n3',
          start: 6,
          length: 1,
          pitch: 72,
          velocity: 80,
        }),
      ),
    ).toEqual(['inst']);
    expect(editing((p) => (p.clips[0].muted = true))).toEqual(['inst']);
    expect(editing((p) => (trackOf(p).synth!.cutoff = 800))).toEqual(['inst']);
    expect(
      editing(
        (p) =>
          (trackOf(p).effects = [
            { id: 'fx1', kind: 'eq3', bypass: false, params: { lowGain: 4 } },
          ]),
      ),
    ).toEqual(['inst']);
    expect(
      editing(
        (p) =>
          (trackOf(p).noteFx = [
            { id: 'nf1', kind: 'arpeggiator', bypass: false, params: { rate: 4 } },
          ]),
      ),
    ).toEqual(['inst']);
    expect(editing((p) => (trackOf(p).inputGainDb = 6))).toEqual(['inst']);
    // Notes are printed at seconds, so the tempo moves every one of them.
    expect(editing((p) => (p.bpm = 90))).toEqual(['inst']);
  });

  it('is not released by an edit to a different track', () => {
    const before = frozen();
    before.tracks.push({ ...structuredClone(trackOf(before)), id: 'other', freeze: undefined });
    const after = structuredClone(before);
    after.tracks[1].synth!.cutoff = 400;
    expect(staleFreezeTrackIds(before, after)).toEqual([]);
  });

  it('is not "stale" at the moment it is created', () => {
    const before = song();
    const after = song({ frozen: true });
    expect(staleFreezeTrackIds(before, after)).toEqual([]);
  });

  it('follows the channel that keys it, since the print heard that channel', () => {
    const withKey = () => {
      const p = song({ frozen: true });
      p.tracks.push({
        ...structuredClone(trackOf(p)),
        id: 'kick',
        type: 'drum',
        freeze: undefined,
        armed: false,
      });
      trackOf(p).sidechainFrom = 'kick';
      p.clips.push({
        id: 'c2',
        trackId: 'kick',
        type: 'midi',
        name: 'Kick',
        start: 0,
        length: 8,
        muted: false,
        notes: [{ id: 'k1', start: 0, length: 1, pitch: 36, velocity: 120 }],
      });
      return p;
    };
    const before = withKey();
    const after = structuredClone(before);
    (after.clips[1] as MidiClip).notes[0].velocity = 20;
    expect(staleFreezeTrackIds(before, after)).toEqual(['inst']);

    const quieter = structuredClone(before);
    quieter.tracks[1].volume = 0.1;
    expect(staleFreezeTrackIds(before, quieter)).toEqual(['inst']);
  });

  it('costs nothing to check when no track is frozen', () => {
    const before = song();
    const after = structuredClone(before);
    (after.clips[0] as MidiClip).notes[0].pitch = 61;
    expect(staleFreezeTrackIds(before, after)).toEqual([]);
  });
});

describe('the project the print is rendered from', () => {
  it('strips everything applied after the print, master included', () => {
    const p = song({ frozen: true });
    trackOf(p).volume = 0.3;
    trackOf(p).pan = 0.8;
    trackOf(p).mute = true;
    trackOf(p).sends = [{ busId: 'bus', amount: 0.5, enabled: true, preFader: false }];
    p.master = { volume: 0.5, pan: 0.2, limiter: true, effects: [] };

    const copy = freezeRenderProject(p, trackOf(p));
    const printed = copy.tracks[0];
    expect(printed.volume).toBe(1);
    expect(printed.pan).toBe(0);
    expect(printed.mute).toBe(false);
    expect(printed.sends).toEqual([]);
    expect(printed.freeze).toBeUndefined();
    expect(copy.master?.volume).toBe(1);
    expect(copy.master?.limiter).toBe(false);
    expect(copy.clips).toHaveLength(1);
  });

  it('keeps a channel that keys it, routed somewhere silent', () => {
    const p = song({ frozen: true });
    p.tracks.push({ ...structuredClone(trackOf(p)), id: 'kick', freeze: undefined, volume: 0.6 });
    trackOf(p).sidechainFrom = 'kick';

    const copy = freezeRenderProject(p, trackOf(p));
    const key = copy.tracks.find((t) => t.id === 'kick')!;
    const sink = copy.tracks.find((t) => t.type === 'bus')!;
    expect(key.output).toBe(sink.id);
    // The key is tapped post-fader on the source, so its own level survives —
    // and the sink it feeds is silent, so it is heard by detectors only.
    expect(key.volume).toBeCloseTo(0.6);
    expect(sink.volume).toBe(0);
    expect(sink.mute).toBe(true);
  });

  it('refuses a track with nothing on it, and any track without an instrument', () => {
    const empty = createEmptyProject('Nothing');
    expect(freezeRefusal(empty, empty.tracks[0])).toMatch(/no clips/i);
    const p = song();
    trackOf(p).type = 'audio';
    expect(freezeRefusal(p, trackOf(p))).toMatch(/instrument and drum/i);
    expect(trackEndBeat(song(), 'inst')).toBe(8);
  });
});

describe('the store releases a stale freeze as the edit lands', () => {
  beforeEach(() => {
    useProjectStore.getState().setProject(song({ frozen: true }), { markClean: true });
  });

  it('gives the instrument back and drops the print from the pool', () => {
    useProjectStore.getState().updateNotes('c1', ['n1'], () => ({ pitch: 67 }));
    const p = useProjectStore.getState().project;
    expect(p.tracks[0].freeze).toBeUndefined();
    expect(p.media?.some((m) => m.id === PRINT.id)).toBe(false);
  });

  it("keeps a duplicated track's print until the last track lets it go", () => {
    const dup = useProjectStore.getState().duplicateTrack('inst')!;
    expect(useProjectStore.getState().project.tracks[1].freeze?.mediaId).toBe(PRINT.id);

    useProjectStore.getState().setTrack(dup, {
      synth: { ...trackOf(useProjectStore.getState().project).synth!, cutoff: 500 },
    });
    const after = useProjectStore.getState().project;
    expect(after.tracks[1].freeze).toBeUndefined();
    // The original is still frozen, so the print it plays has to stay listed.
    expect(after.tracks[0].freeze?.mediaId).toBe(PRINT.id);
    expect(after.media?.some((m) => m.id === PRINT.id)).toBe(true);
  });

  it('keeps the freeze through a mix move', () => {
    useProjectStore.getState().setTrack('inst', { volume: 0.4 });
    expect(useProjectStore.getState().project.tracks[0].freeze).toBeDefined();
  });

  it('brings the freeze back with undo, print and all', () => {
    // deleteNotes is one undoable step, which is what makes the release
    // reversible: the print's bytes are still on disk, so undo restores a
    // freeze that plays.
    useProjectStore.getState().deleteNotes('c1', ['n1']);
    expect(useProjectStore.getState().project.tracks[0].freeze).toBeUndefined();
    useProjectStore.getState().undo();
    const p = useProjectStore.getState().project;
    expect(p.tracks[0].freeze?.mediaId).toBe(PRINT.id);
    expect(p.media?.some((m) => m.id === PRINT.id)).toBe(true);
  });
});

describe('a freeze on disk', () => {
  beforeEach(async () => {
    await resetDbConnection();
  });

  it('survives a save and a reload', async () => {
    const p = song({ frozen: true });
    await saveProject(p);
    const back = await loadProject(p.id);
    expect(back?.tracks[0].freeze).toEqual({
      mediaId: PRINT.id,
      renderedAt: 1700000000000,
    });
    expect(back?.media?.some((m) => m.id === PRINT.id)).toBe(true);
  });

  it('is dropped when the print it points at is gone, so the instrument returns', () => {
    const p = song({ frozen: true });
    p.media = [];
    const back = validateProject(JSON.parse(JSON.stringify(p)));
    expect(back.tracks[0].freeze).toBeUndefined();
  });

  it('is dropped from a track that has no instrument to stand in for', () => {
    const p = song({ frozen: true });
    p.tracks[0].type = 'audio';
    const back = validateProject(JSON.parse(JSON.stringify(p)));
    expect(back.tracks[0].freeze).toBeUndefined();
  });

  it('keeps a renderedAt it can trust', () => {
    const p = song({ frozen: true });
    (p.tracks[0].freeze as { renderedAt: unknown }).renderedAt = 'yesterday';
    const back = validateProject(JSON.parse(JSON.stringify(p)));
    expect(back.tracks[0].freeze?.renderedAt).toBe(0);
  });
});

describe('the print is media in use', () => {
  it('is counted among the ids a project plays', () => {
    expect(usedMediaIds(song({ frozen: true })).has(PRINT.id)).toBe(true);
    expect(usedMediaIds(song()).has(PRINT.id)).toBe(false);
  });

  it('is not pruned as an orphan while the track is frozen', async () => {
    await resetDbConnection();
    const p = song({ frozen: true });
    await putMediaBlob(PRINT.id, new Blob([new Uint8Array([1, 2, 3])]), 'audio/wav');
    await putMediaBlob('stray', new Blob([new Uint8Array([4])]), 'audio/wav');

    // The set the app prunes against: what the project plays, plus its own
    // media records.
    const referenced = new Set([...usedMediaIds(p), ...(p.media ?? []).map((m) => m.id)]);
    const pruned = await pruneOrphanedMedia(referenced);

    expect(pruned).toEqual(['stray']);
    expect(await listMediaIds()).toContain(PRINT.id);
  });
});
