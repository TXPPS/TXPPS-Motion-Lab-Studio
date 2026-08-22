/**
 * Track freeze — the data half.
 *
 * Freezing prints an instrument track (its notes, its instrument, its note FX
 * and its inserts) to one audio file and plays that file instead of running the
 * instrument. Everything here is pure: what the print stands in for, what the
 * print is made from, and what edits turn an existing print into a lie. The
 * rendering and the storage live in `audio/freeze.ts`.
 *
 * The scheduler, the live engine and the offline bounce all read the synthetic
 * clip below, so a frozen track cannot play one way while monitoring and
 * another way in a render.
 *
 * Where the print is taken, and where it plays back:
 *
 *   instrument → trim → inserts │ → mute → volume → pan → sends → master
 *   └──────── printed ─────────┘ └──────── still live ────────────┘
 *
 * So a frozen track still mixes: fader, pan, mute, solo, sends and their
 * automation all keep working, and only the part that costs CPU is baked.
 */
import { newId } from './ids';
import { resolveChannels } from './mixerGraph';
import { projectBeatsForSeconds } from './music';
import type { AudioClip, ProjectData, Track } from './types';

/**
 * Clip ids for freeze playback are synthetic — the print is not a clip anyone
 * can select, move or delete — so they carry a prefix nothing else uses and
 * every consumer can recognise one without a lookup.
 */
export const FREEZE_CLIP_PREFIX = 'freeze:';

export function isFreezeClipId(id: string): boolean {
  return id.startsWith(FREEZE_CLIP_PREFIX);
}

/** Track kinds a freeze means anything for: the ones that own an instrument. */
export function isFreezableType(t: Track['type']): boolean {
  return t === 'instrument' || t === 'drum';
}

export function isFrozen(track: Track): boolean {
  return !!track.freeze && isFreezableType(track.type);
}

/**
 * Media ids the prints in this project use.
 *
 * Deliberately structural rather than taking a `ProjectData`: the media
 * bookkeeping walks saved projects that were validated by an older build.
 */
export function freezeMediaIds(p: { tracks: { freeze?: { mediaId: string } }[] }): string[] {
  const out: string[] = [];
  for (const t of p.tracks) if (t.freeze) out.push(t.freeze.mediaId);
  return out;
}

/**
 * The clip a frozen track plays instead of its instrument.
 *
 * It always starts at beat 0 and runs the length of the print, because the
 * print is rendered from beat 0: song time and print time are then the same
 * number, and entering part-way — a seek, a loop wrap, a range bounce — needs
 * no mapping at all. Returns null when the print's metadata is missing, which
 * is what a deleted media item looks like from here.
 */
export function freezeClipFor(p: ProjectData, track: Track): AudioClip | null {
  if (!isFrozen(track)) return null;
  const ref = p.media?.find((m) => m.id === track.freeze!.mediaId);
  if (!ref || !(ref.duration > 0)) return null;
  return {
    id: FREEZE_CLIP_PREFIX + track.id,
    trackId: track.id,
    type: 'audio',
    name: `${track.name} (frozen)`,
    start: 0,
    length: projectBeatsForSeconds(p, 0, ref.duration),
    muted: false,
    mediaId: ref.id,
    offset: 0,
    sourceDuration: ref.duration,
    gain: 1,
    fadeIn: 0,
    fadeOut: 0,
  };
}

/** Automation lanes a print bakes in. The rest still play over the print. */
function isBakedLane(paramId: string): boolean {
  return paramId.startsWith('fx:') || paramId.startsWith('synth:') || paramId.startsWith('smp:');
}

/**
 * Channels whose signal keys this one's dynamics detectors, transitively.
 *
 * A compressor keyed from the kick is part of what the track sounds like, so
 * the print has to hear the kick — and if the kick is itself keyed from
 * something, so is that. Cycle-safe, and never includes the track itself.
 */
export function sidechainChain(p: ProjectData, track: Track): Track[] {
  const out: Track[] = [];
  const seen = new Set<string>([track.id]);
  let cursor = track.sidechainFrom;
  while (typeof cursor === 'string' && !seen.has(cursor)) {
    seen.add(cursor);
    const src = p.tracks.find((t) => t.id === cursor);
    if (!src) break;
    out.push(src);
    cursor = src.sidechainFrom;
  }
  return out;
}

/** Everything about one track that its own printed audio depends on. */
function trackRenderSignature(p: ProjectData, t: Track): string {
  const parts = [
    t.type,
    String(t.inputGainDb ?? 0),
    t.phaseInvert ? 'ø' : '',
    t.monoSum ? 'mono' : '',
    JSON.stringify(t.synth ?? null),
    JSON.stringify(t.sampler ?? null),
    JSON.stringify(t.rack ?? null),
    JSON.stringify(t.noteFx ?? null),
    JSON.stringify(t.effects ?? null),
    t.automationMode ?? 'read',
    JSON.stringify((t.automation ?? []).filter((l) => isBakedLane(l.paramId))),
  ];
  // Sorted by clip id: the clips array is rebuilt by half the store's
  // operations, and a print does not go stale because two clips swapped
  // places in an array.
  const clips = p.clips
    .filter((c) => c.trackId === t.id && c.type === 'midi')
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  for (const c of clips) {
    parts.push(`${c.id}@${c.start}+${c.length}${c.muted ? '!' : ''}`);
    parts.push(JSON.stringify(c.type === 'midi' ? c.notes : null));
  }
  return parts.join('');
}

/**
 * Everything a print of this track depends on, as one comparable string.
 *
 * Compared before and after an edit, this is what decides whether a freeze
 * still tells the truth. It deliberately includes the tempo map — notes are
 * printed at seconds, so a tempo change moves every one of them — and the
 * state of any channel keying this one, but NOT the fader, pan, mute, sends or
 * their automation, because those are applied after the print and stay live.
 */
export function freezeRenderSignature(p: ProjectData, track: Track): string {
  const chain = sidechainChain(p, track);
  // Resolving the whole console is only worth it when something keys this
  // track; this runs on every edit a frozen project makes.
  const states = chain.length ? resolveChannels(p, null) : null;
  const key = chain.map((k) => {
    const st = states?.get(k.id);
    return `${k.id}=${st?.audible ? 1 : 0}/${st?.gain ?? 1}/${st?.pan ?? 0}:${trackRenderSignature(p, k)}`;
  });
  return [
    JSON.stringify(p.tempoMap ?? null),
    String(p.bpm),
    `${p.timeSig.num}/${p.timeSig.den}`,
    trackRenderSignature(p, track),
    ...key,
  ].join('');
}

/**
 * Frozen tracks whose print no longer matches the project.
 *
 * `before` and `after` are two versions of the same project; a track listed
 * here has been edited into a state its print does not describe.
 */
export function staleFreezeTrackIds(before: ProjectData, after: ProjectData): string[] {
  const out: string[] = [];
  for (const track of after.tracks) {
    if (!isFrozen(track)) continue;
    const was = before.tracks.find((t) => t.id === track.id);
    // A track that did not exist before, or was not frozen before, has just
    // been given its freeze — by the freeze action itself, which is not stale.
    if (!was || !isFrozen(was) || was.freeze!.mediaId !== track.freeze!.mediaId) continue;
    if (freezeRenderSignature(before, was) !== freezeRenderSignature(after, track)) {
      out.push(track.id);
    }
  }
  return out;
}

/** Last beat this track has material on; the print runs from 0 to here. */
export function trackEndBeat(p: ProjectData, trackId: string): number {
  let end = 0;
  for (const c of p.clips) {
    if (c.trackId === trackId) end = Math.max(end, c.start + c.length);
  }
  return end;
}

/** Why this track cannot be frozen, or null when it can. */
export function freezeRefusal(p: ProjectData, track: Track): string | null {
  if (!isFreezableType(track.type)) {
    return 'Only instrument and drum tracks can be frozen — an audio track is already audio.';
  }
  if (trackEndBeat(p, track.id) <= 0) {
    return `"${track.name}" has no clips to render.`;
  }
  return null;
}

/**
 * The project handed to the offline renderer to make one track's print.
 *
 * It is a real project, so the print goes through the same renderer, the same
 * insert chains and the same note pipeline a bounce does — there is no second
 * renderer to drift from the first. What it strips is everything that is
 * applied *after* the print: the fader, pan, mute, solo, sends, the group
 * trims and the whole master chain (which `renderProject` is asked to bypass,
 * so the safety limiter's own latency is not baked in either).
 *
 * Channels that key this one's detectors come along, with the level and mute
 * they have at this moment, routed into a silent bus: heard by the detectors,
 * never by the print. Their fader automation is not followed — the key level
 * is the one on the desk when Freeze was pressed.
 */
export function freezeRenderProject(p: ProjectData, track: Track): ProjectData {
  const states = resolveChannels(p, null);
  const sinkId = newId('freeze-sink');

  const printed: Track = structuredClone(track);
  printed.volume = 1;
  printed.pan = 0;
  printed.mute = false;
  printed.solo = false;
  printed.armed = false;
  printed.monitoring = false;
  printed.soloSafe = false;
  printed.output = 'master';
  printed.sends = [];
  printed.automation = (track.automation ?? []).filter((l) => isBakedLane(l.paramId));
  delete printed.vcaId;
  delete printed.folderId;
  delete printed.freeze;

  const keys = sidechainChain(p, track).map((k) => {
    const st = states.get(k.id);
    const copy: Track = structuredClone(k);
    copy.volume = st?.gain ?? k.volume;
    copy.pan = st?.pan ?? k.pan;
    copy.mute = !(st?.audible ?? true);
    copy.solo = false;
    copy.soloSafe = false;
    copy.output = sinkId;
    copy.sends = [];
    copy.automation = (k.automation ?? []).filter((l) => isBakedLane(l.paramId));
    delete copy.vcaId;
    delete copy.folderId;
    return copy;
  });

  const sink: Track | null = keys.length
    ? {
        id: sinkId,
        type: 'bus',
        name: 'Freeze key sink',
        color: '#000000',
        // The key is tapped post-fader on the source, so the sink's own fader
        // cannot weaken it — it only stops the key from reaching the print.
        volume: 0,
        pan: 0,
        mute: true,
        solo: false,
        armed: false,
        collapsed: true,
        output: 'master',
      }
    : null;

  const kept = new Set([printed.id, ...keys.map((k) => k.id)]);
  return {
    ...p,
    name: `${p.name} — ${track.name} freeze`,
    tracks: [printed, ...keys, ...(sink ? [sink] : [])],
    clips: p.clips.filter((c) => kept.has(c.trackId)).map((c) => structuredClone(c)),
    master: { volume: 1, pan: 0, effects: [], limiter: false },
    masterVolume: 1,
    metronome: false,
    cueMixes: [],
    scratchPads: [],
  };
}
