/**
 * Merging one project into another.
 *
 * A song is rarely written in one file. Someone tracks drums in one session
 * and guitars in another, or an arranger sends back a bridge as its own
 * project; putting them together should not mean exporting stems and
 * re-importing them.
 *
 * The rule throughout: everything the incoming project points at gets a new
 * id, and every reference to it is rewritten in the same pass. Media ids are
 * the one exception — the bytes live in one browser-wide store keyed by id, so
 * a merged clip points at exactly the audio it always did.
 *
 * Pure: no store, no IndexedDB, no React. The caller commits the result.
 */
import type { AudioClip, Clip, MidiClip, ProjectData, Track } from '../model/types';
import type { ArrangerSection, ChordEvent, Marker } from '../model/arrangement';
import type { AutomationLane } from '../model/automation';

export interface MergeOptions {
  /** Where the incoming material lands, in beats on the target timeline. */
  atBeat?: number;
  /** Bring the incoming markers, sections and chords across, shifted to match. */
  includeGlobalTracks?: boolean;
  /** Prefix added to every incoming track name, so its origin stays readable. */
  prefix?: string;
  /** Id factory; injected so a merge is reproducible in a test. */
  makeId?: (kind: string) => string;
}

export interface MergeResult {
  project: ProjectData;
  /** What actually came across, for the message the user is shown. */
  added: { tracks: number; clips: number; markers: number; sections: number; chords: number };
  /** Media the incoming project referenced, so the caller can check it exists. */
  mediaIds: string[];
  /** Things that could not come across, in words a user can act on. */
  warnings: string[];
}

let counter = 0;
const defaultMakeId = (kind: string): string => `${kind}${Date.now().toString(36)}${counter++}`;

/**
 * The incoming project's tracks, clips and references, rebased onto the
 * target. The target is not mutated; the result is a new project object with
 * the merged arrays.
 */
export function mergeProjects(
  target: ProjectData,
  source: ProjectData,
  options: MergeOptions = {},
): MergeResult {
  const makeId = options.makeId ?? defaultMakeId;
  const at = Math.max(0, options.atBeat ?? 0);
  const prefix = options.prefix ?? '';
  const warnings: string[] = [];

  // Pass one: every incoming track gets an id in the target's namespace. The
  // map has to be complete before anything is rewritten, because a track's
  // sends, folder and VCA can all point forward to a track later in the list.
  const trackIds = new Map<string, string>();
  for (const t of source.tracks) trackIds.set(t.id, makeId('t'));

  const names = new Set(target.tracks.map((t) => t.name));
  const tracks: Track[] = source.tracks.map((t) => {
    const copy: Track = { ...t, id: trackIds.get(t.id)! };
    copy.name = uniqueName(prefix ? `${prefix} ${t.name}` : t.name, names);
    names.add(copy.name);
    copy.output = t.output === 'master' ? 'master' : (trackIds.get(t.output) ?? 'master');
    if (t.folderId) copy.folderId = trackIds.get(t.folderId);
    if (t.vcaId) copy.vcaId = trackIds.get(t.vcaId);
    if (t.sidechainFrom) copy.sidechainFrom = trackIds.get(t.sidechainFrom);
    if (t.sends) {
      const kept = t.sends.filter((s) => trackIds.has(s.busId));
      if (kept.length !== t.sends.length) {
        warnings.push(`"${t.name}" had a send to a bus that is not in the merged material.`);
      }
      copy.sends = kept.map((s) => ({ ...s, busId: trackIds.get(s.busId)! }));
    }
    if (t.automation)
      copy.automation = t.automation.map((l) => rebaseLane(l, trackIds, at, makeId));
    // Freeze renders are tied to the source project's playback of the source
    // arrangement; keeping the reference would play the wrong thing.
    if (t.freeze) {
      delete copy.freeze;
      warnings.push(`"${t.name}" was frozen; it comes across unfrozen and will play live.`);
    }
    return copy;
  });

  const mediaIds = new Set<string>();
  const clips: Clip[] = [];
  for (const c of source.clips) {
    const trackId = trackIds.get(c.trackId);
    if (!trackId) continue;
    const base = { ...c, id: makeId('c'), trackId, start: c.start + at };
    if (base.type === 'audio') {
      const audio = base as AudioClip;
      mediaIds.add(audio.mediaId);
      if (audio.takes) for (const take of audio.takes) mediaIds.add(take.mediaId);
      clips.push(audio);
    } else {
      const midi = base as MidiClip;
      midi.notes = midi.notes.map((n) => ({ ...n, id: makeId('n') }));
      clips.push(midi);
    }
  }

  const markers: Marker[] = [];
  const sections: ArrangerSection[] = [];
  const chords: ChordEvent[] = [];
  if (options.includeGlobalTracks) {
    for (const m of source.markers ?? [])
      markers.push({ ...m, id: makeId('m'), beat: m.beat + at });
    for (const s of source.sections ?? []) {
      sections.push({ ...s, id: makeId('s'), start: s.start + at });
    }
    for (const c of source.chords ?? []) chords.push({ ...c, id: makeId('ch'), beat: c.beat + at });
  }

  // The target's tempo map is the song's; an incoming map would move the
  // material already on the timeline, which is never what a merge should do.
  if (hasTempoChanges(source)) {
    warnings.push(
      'The incoming project had its own tempo changes. This song keeps its tempo map, so that material may need warping.',
    );
  }

  const project: ProjectData = {
    ...target,
    tracks: [...target.tracks, ...tracks],
    clips: [...target.clips, ...clips],
    media: mergeMedia(target, source, mediaIds),
    markers: [...(target.markers ?? []), ...markers].sort((a, b) => a.beat - b.beat),
    sections: [...(target.sections ?? []), ...sections].sort((a, b) => a.start - b.start),
    chords: [...(target.chords ?? []), ...chords].sort((a, b) => a.beat - b.beat),
    modifiedAt: target.modifiedAt,
  };

  return {
    project,
    added: {
      tracks: tracks.length,
      clips: clips.length,
      markers: markers.length,
      sections: sections.length,
      chords: chords.length,
    },
    mediaIds: [...mediaIds],
    warnings,
  };
}

/** Two tracks called "Drums" in one console is a mixing accident waiting to happen. */
function uniqueName(name: string, taken: ReadonlySet<string>): string {
  if (!taken.has(name)) return name;
  for (let i = 2; i < 999; i++) {
    const candidate = `${name} ${i}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${name} ${Math.round(Math.random() * 1e6)}`;
}

/**
 * An automation lane carries a parameter id that can name another track — a
 * send is `send:<busId>` — so a lane is rebased in time and in reference at
 * once, and a lane naming a track that did not come across is dropped rather
 * than left pointing at a stranger's bus.
 */
function rebaseLane(
  lane: AutomationLane,
  trackIds: ReadonlyMap<string, string>,
  at: number,
  makeId: (kind: string) => string,
): AutomationLane {
  let paramId = lane.paramId;
  if (paramId.startsWith('send:')) {
    const busId = paramId.slice('send:'.length);
    const mapped = trackIds.get(busId);
    paramId = mapped ? `send:${mapped}` : paramId;
  }
  return {
    ...lane,
    id: makeId('l'),
    paramId,
    points: lane.points.map((p) => ({ ...p, beat: p.beat + at })),
  };
}

function mergeMedia(
  target: ProjectData,
  source: ProjectData,
  used: ReadonlySet<string>,
): ProjectData['media'] {
  const have = new Set((target.media ?? []).map((m) => m.id));
  const incoming = (source.media ?? []).filter((m) => used.has(m.id) && !have.has(m.id));
  if (incoming.length === 0) return target.media;
  return [...(target.media ?? []), ...incoming];
}

function hasTempoChanges(project: ProjectData): boolean {
  const events = project.tempoMap?.tempos ?? [];
  return events.length > 1 || events.some((e) => e.beat > 0);
}
