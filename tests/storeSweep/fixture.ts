/**
 * The handles every recipe starts from, rebuilt before each row.
 *
 * A shared, mutated fixture would make the sweep order-dependent, and an
 * order-dependent sweep of 161 rows is a sweep whose failures move when you
 * add a row. So the project is rebuilt per recipe and the handles are read off
 * that build — cheap, because none of this touches audio.
 *
 * The demo project is the base rather than an empty one because half of these
 * mutators need something to mutate, and a fixture assembled by calling the
 * store's own actions would make phase 1 depend on the very actions under test.
 */
import { useProjectStore } from '../../src/state/projectStore';
import { createDemoProject } from '../../src/model/demoProject';
import type { AudioClip, Clip, MidiClip, Track } from '../../src/model/types';
import type { MediaRef } from '../../src/model/media';

export interface Handles {
  /** An instrument track carrying at least one insert effect. */
  inst: Track;
  /** A second instrument track, for the copy-to and grouping rows. */
  inst2: Track;
  /** An audio track. */
  audio: Track;
  /** A bus, which is what a send can be addressed to. */
  bus: Track;
  /** A MIDI clip with notes in it. */
  midi: MidiClip;
  /** An audio clip on the audio track. */
  wav: AudioClip;
  /** Registered media, so a zone or a pad has something legal to point at. */
  media: MediaRef;
}

/** A media reference that is legal without any bytes behind it. */
export function fakeMedia(id: string, name = 'Sweep sample'): MediaRef {
  return {
    id,
    name,
    kind: 'import',
    duration: 2,
    sampleRate: 48000,
    channels: 1,
    byteSize: 0,
    createdAt: 0,
    source: 'store sweep',
    peaksVersion: 1,
  };
}

const store = () => useProjectStore.getState();

/**
 * Rebuild the project and hand back the handles.
 *
 * `markClean: true` matters: without it the fixture itself counts as an edit,
 * and every recipe would start with a dirty project and a populated undo stack,
 * which is the state phase 2 measures against.
 */
export function freshProject(): Handles {
  const project = createDemoProject();

  // Media first, so the sampler and pad rows have a target that survives
  // validation. `validateProject` drops a zone pointing at media the project
  // has never heard of, which would make phase 3 fail for a reason that is the
  // fixture's fault rather than the action's.
  const media = fakeMedia('media-sweep');
  project.media = [...(project.media ?? []), media];

  const midi = project.clips.find((c): c is MidiClip => c.type === 'midi' && c.notes.length > 0);
  const wav = project.clips.find((c): c is AudioClip => c.type === 'audio');
  if (!midi || !wav) throw new Error('demo project no longer carries both clip kinds');

  const instruments = project.tracks.filter((t) => t.type === 'instrument');
  const inst = instruments.find((t) => (t.effects ?? []).length > 0) ?? instruments[0];
  const inst2 = instruments.find((t) => t.id !== inst.id) ?? instruments[0];
  const audio = project.tracks.find((t) => t.type === 'audio');
  const bus = project.tracks.find((t) => t.type === 'bus');
  if (!inst || !audio || !bus) throw new Error('demo project no longer carries all track kinds');

  store().setProject(project, { markClean: true });

  return { inst, inst2, audio, bus, midi, wav, media };
}

/** The live project, since the store hands back a new object on every write. */
export const now = () => store().project;

/** A track as it stands now, by the id a handle was taken with. */
export const trackNow = (id: string): Track => {
  const t = now().tracks.find((x) => x.id === id);
  if (!t) throw new Error(`track ${id} is gone`);
  return t;
};

/** A clip as it stands now. */
export const clipNow = (id: string): Clip => {
  const c = now().clips.find((x) => x.id === id);
  if (!c) throw new Error(`clip ${id} is gone`);
  return c;
};

/**
 * Give a track an insert and hand back its id.
 *
 * Several rows need an effect that is definitely present and definitely known
 * — `addEffect` returns null for a kind the registry has dropped, and a recipe
 * that then calls `setEffectParam(null)` fails phase 1 for the wrong reason.
 */
export function withEffect(trackId: string): string {
  const id = store().addEffect(trackId, 'eq3');
  if (!id) throw new Error('addEffect refused eq3');
  return id;
}
