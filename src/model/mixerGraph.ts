/**
 * Channel-state resolution: mute, solo, VCA and folder gain.
 *
 * Once folders and VCAs exist, "is this track audible and how loud is it" stops
 * being a property of the track and becomes a property of the whole graph. The
 * engine, the meters, the mixer UI and the offline bounce must all answer it
 * identically, so it is answered exactly once, here, as pure data.
 *
 * Rules
 * -----
 * - A folder is not an audio channel. Its fader and its mute act on its
 *   children — the children keep their own routing and their own fader
 *   positions, which is what makes a folder safe to collapse and reopen.
 * - A VCA is not an audio channel either. It scales its members' gain without
 *   touching their routing, so a member's own automation still reads correctly.
 * - Solo is transitive in both directions: soloing a track keeps whatever it
 *   feeds audible, and soloing a bus keeps whatever feeds it audible. Soloing a
 *   folder or a VCA solos its members.
 * - `soloSafe` tracks (reverb returns, talkback) survive any solo.
 */
import type { ProjectData, Track } from './types';

export interface ChannelState {
  /** false → the channel's mute gain is driven to zero */
  audible: boolean;
  /** the fader gain the channel should apply, including VCA and folder trims */
  gain: number;
  /**
   * The VCA + folder multiplier alone. Volume automation writes the track's own
   * fader value, so it has to multiply this back in or a VCA would be ignored
   * the moment a volume lane started playing.
   */
  groupGain: number;
  /** channel pan; VCAs and folders never pan */
  pan: number;
  /** true when something other than this track's own controls is silencing it */
  mutedByGroup: boolean;
  /** true when this track is silent only because something else is soloed */
  mutedBySolo: boolean;
}

/** Walk a track's folder ancestry, outermost last. Cycle-safe. */
export function folderChain(tracks: Track[], track: Track): Track[] {
  const out: Track[] = [];
  const seen = new Set<string>([track.id]);
  let cursor = track.folderId;
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    const parent = tracks.find((t) => t.id === cursor);
    if (!parent || parent.type !== 'folder') break;
    out.push(parent);
    cursor = parent.folderId;
  }
  return out;
}

/** Direct children of a folder (tracks, not descendants). */
export function folderChildren(tracks: Track[], folderId: string): Track[] {
  return tracks.filter((t) => t.folderId === folderId);
}

/** Every descendant of a folder, at any depth. */
export function folderDescendants(tracks: Track[], folderId: string): Track[] {
  const out: Track[] = [];
  const stack = [folderId];
  const seen = new Set<string>();
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const t of tracks) {
      if (t.folderId !== id) continue;
      out.push(t);
      if (t.type === 'folder') stack.push(t.id);
    }
  }
  return out;
}

export function vcaMembers(tracks: Track[], vcaId: string): Track[] {
  return tracks.filter((t) => t.vcaId === vcaId);
}

/** Tracks that route their output into `busId`, plus tracks that send to it. */
export function feedersOf(tracks: Track[], busId: string): Track[] {
  return tracks.filter(
    (t) => t.output === busId || (t.sends ?? []).some((s) => s.enabled && s.busId === busId),
  );
}

/**
 * Resolve every track's audibility and effective gain in one pass.
 *
 * Returns a map keyed by track id. Tracks that carry no audio (folder, VCA)
 * are included so the mixer can render them, but their `audible` only describes
 * whether their members are being heard.
 */
export function resolveChannels(project: ProjectData): Map<string, ChannelState> {
  const tracks = project.tracks;
  const byId = new Map(tracks.map((t) => [t.id, t]));
  const out = new Map<string, ChannelState>();

  const soloActive = tracks.some((t) => t.solo);

  // 1. Expand solo through folders and VCAs.
  const soloed = new Set<string>();
  for (const t of tracks) {
    if (!t.solo) continue;
    soloed.add(t.id);
    if (t.type === 'folder') for (const d of folderDescendants(tracks, t.id)) soloed.add(d.id);
    if (t.type === 'vca') for (const m of vcaMembers(tracks, t.id)) soloed.add(m.id);
  }

  // 2. Solo is transitive downstream (what a soloed track feeds must stay open)
  //    and upstream (a soloed bus needs its feeders).
  const audibleBySolo = new Set(soloed);
  const downstream = [...soloed];
  const seenDown = new Set<string>();
  while (downstream.length) {
    const id = downstream.pop()!;
    if (seenDown.has(id)) continue;
    seenDown.add(id);
    const t = byId.get(id);
    if (!t) continue;
    for (const target of [
      t.output,
      ...(t.sends ?? []).filter((s) => s.enabled).map((s) => s.busId),
    ]) {
      if (!target || target === 'master' || audibleBySolo.has(target)) continue;
      audibleBySolo.add(target);
      downstream.push(target);
    }
  }
  const upstream = [...soloed].filter((id) => {
    const t = byId.get(id);
    return t?.type === 'bus' || t?.type === 'fx';
  });
  const seenUp = new Set<string>();
  while (upstream.length) {
    const id = upstream.pop()!;
    if (seenUp.has(id)) continue;
    seenUp.add(id);
    for (const f of feedersOf(tracks, id)) {
      if (audibleBySolo.has(f.id)) continue;
      audibleBySolo.add(f.id);
      if (f.type === 'bus' || f.type === 'fx') upstream.push(f.id);
    }
  }

  // 3. Per-track state.
  for (const t of tracks) {
    const chain = folderChain(tracks, t);
    const vca = t.vcaId ? byId.get(t.vcaId) : undefined;

    const groupMuted = chain.some((f) => f.mute) || (vca?.type === 'vca' && vca.mute === true);
    const selfMuted = t.mute;
    const soloOk = !soloActive || audibleBySolo.has(t.id) || t.soloSafe === true;

    let groupGain = 1;
    for (const f of chain) groupGain *= f.volume;
    if (vca?.type === 'vca') groupGain *= vca.volume;

    out.set(t.id, {
      audible: !selfMuted && !groupMuted && soloOk,
      gain: Math.max(0, t.volume * groupGain),
      groupGain: Math.max(0, groupGain),
      pan: t.type === 'vca' || t.type === 'folder' ? 0 : t.pan,
      mutedByGroup: groupMuted && !selfMuted,
      mutedBySolo: !soloOk && !selfMuted && !groupMuted,
    });
  }
  return out;
}

/**
 * Tracks in arrangement order with folded folders' contents removed.
 * The arrangement and the mixer both need "what is visible right now".
 */
export function visibleTracks(tracks: Track[]): Track[] {
  const foldedFolders = new Set(
    tracks.filter((t) => t.type === 'folder' && t.folded).map((t) => t.id),
  );
  if (foldedFolders.size === 0) return tracks;
  const hidden = new Set<string>();
  for (const id of foldedFolders) {
    for (const d of folderDescendants(tracks, id)) hidden.add(d.id);
  }
  return tracks.filter((t) => !hidden.has(t.id));
}

/** Nesting depth of a track, for the arrangement's indent guides. */
export function folderDepth(tracks: Track[], track: Track): number {
  return folderChain(tracks, track).length;
}
