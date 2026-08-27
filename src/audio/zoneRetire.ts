/**
 * What to silence when a sampler zone leaves the project.
 *
 * A zone can be removed while it is sounding. `SamplerInstrument` reads its
 * params live, so the *next* note is right the instant the zone goes — but a
 * voice already playing holds its own buffer and its own graph, and nothing
 * about the removal reaches it. If that voice is looping or held its `endsAt` is
 * `Infinity`, so it plays until panic: delete a sample, load another, play a
 * chord, and you hear both.
 *
 * **Removal is not a button.** Undo, redo, opening a project, importing one and
 * switching a preset all take zones away without going near a delete control, so
 * a fix at any single call site covers exactly one of them. This is driven from
 * the engine's graph sync, which sees every project change there is — the same
 * reason the track-deletion fix was a subscription rather than a line in
 * `deleteTrack`.
 *
 * It lives in its own module because the engine cannot be built under jsdom, and
 * a mechanism that can only be exercised through a real AudioContext is one
 * nothing asserts. Here the diff, the rack walk and the bookkeeping are all
 * ordinary values, and `engine.ts` is three lines that hand it the instruments.
 */
import type { Track } from '../model/types';

/** Anything that can stop what it is sounding on a named set of zones. */
export interface ZoneSink {
  retireZones(gone: ReadonlySet<string>, at: number): number;
}

/**
 * Every sampler zone id a track can sound, its rack children included.
 *
 * A rack item carries its own sampler, so a multisample inside a rack loses
 * zones exactly the way a track-level one does. The first draft of this read
 * only `track.sampler`, which is the shape of bug that gets fixed on whichever
 * surface somebody happened to be looking at.
 */
export function zoneIdsOfTrack(track: Track): Set<string> {
  const ids = new Set<string>();
  for (const z of track.sampler?.zones ?? []) ids.add(z.id);
  for (const item of track.rack?.items ?? []) {
    for (const z of item.sampler?.zones ?? []) ids.add(z.id);
  }
  return ids;
}

/** What `before` had and `now` does not. */
export function zonesRemoved(before: ReadonlySet<string>, now: ReadonlySet<string>): Set<string> {
  const gone = new Set<string>();
  for (const id of before) if (!now.has(id)) gone.add(id);
  return gone;
}

export class ZoneRetirement {
  /** trackId → the zone ids that track had at the last sync. */
  private last = new Map<string, Set<string>>();

  /**
   * Compare this project against the last one and silence what has gone.
   *
   * `sinkFor` returns the instrument a track is playing through, or null where
   * it has none — frozen tracks, audio tracks, tracks whose instrument has not
   * been built yet. A track with no sink is skipped entirely rather than
   * recorded: recording it would make the sync *after* its instrument appears
   * diff against a set nothing was ever sounding, and silence a zone that had
   * only just arrived.
   */
  sync(tracks: readonly Track[], at: number, sinkFor: (trackId: string) => ZoneSink | null): void {
    const live = new Set<string>();
    for (const track of tracks) {
      const sink = sinkFor(track.id);
      if (!sink) continue;
      live.add(track.id);
      const now = zoneIdsOfTrack(track);
      const before = this.last.get(track.id);
      this.last.set(track.id, now);
      if (!before) continue;
      const gone = zonesRemoved(before, now);
      if (gone.size > 0) sink.retireZones(gone, at);
    }
    // A track that has lost its instrument has had every voice stopped by the
    // teardown that took it away. Keeping its last zone set would make whatever
    // next holds that id inherit a diff it has nothing to do with.
    for (const id of [...this.last.keys()]) if (!live.has(id)) this.last.delete(id);
  }

  /** Forget everything, for a project load or a full teardown. */
  reset(): void {
    this.last.clear();
  }
}
