import { describe, expect, it } from 'vitest';
import {
  bucketNotesByPitch,
  buildPadDrumMap,
  DRUM_GROUPS,
  ESSENTIAL_DRUM_MAP,
  firstIndexFrom,
  GM_DRUM_MAP,
  groupForName,
  laneList,
  laneOf,
  pitchesInGroup,
  usedLanes,
  type DrumGroup,
} from '../src/model/drumMap';
import { defaultSamplerParams, makePadZone, makeZone } from '../src/model/sampler';
import type { Note } from '../src/model/types';

let seq = 0;
function note(pitch: number, start: number, velocity = 100): Note {
  return { id: `n${seq++}`, start, length: 0.25, pitch, velocity };
}

describe('General MIDI drum map', () => {
  it('covers all 47 GM percussion notes, 35 to 81', () => {
    expect(GM_DRUM_MAP.lanes).toHaveLength(47);
    const pitches = GM_DRUM_MAP.lanes.map((l) => l.pitch).sort((a, b) => a - b);
    expect(pitches[0]).toBe(35);
    expect(pitches[46]).toBe(81);
    expect(new Set(pitches).size).toBe(47);
  });

  it('names the landmark pitches', () => {
    expect(laneOf(GM_DRUM_MAP, 36)?.name).toBe('Bass Drum 1');
    expect(laneOf(GM_DRUM_MAP, 38)?.name).toBe('Acoustic Snare');
    expect(laneOf(GM_DRUM_MAP, 42)?.name).toBe('Closed Hi-Hat');
    expect(laneOf(GM_DRUM_MAP, 46)?.name).toBe('Open Hi-Hat');
    expect(laneOf(GM_DRUM_MAP, 49)?.name).toBe('Crash Cymbal 1');
  });

  it('groups the landmark pitches by kit family', () => {
    expect(laneOf(GM_DRUM_MAP, 36)?.group).toBe('kick');
    expect(laneOf(GM_DRUM_MAP, 38)?.group).toBe('snare');
    expect(laneOf(GM_DRUM_MAP, 42)?.group).toBe('hats');
    expect(laneOf(GM_DRUM_MAP, 46)?.group).toBe('hats');
    expect(laneOf(GM_DRUM_MAP, 49)?.group).toBe('cymbals');
    expect(laneOf(GM_DRUM_MAP, 45)?.group).toBe('toms');
    expect(laneOf(GM_DRUM_MAP, 56)?.group).toBe('percussion');
  });

  it('has no lane outside the six kit families', () => {
    const known = new Set<DrumGroup>(DRUM_GROUPS);
    for (const lane of GM_DRUM_MAP.lanes) expect(known.has(lane.group)).toBe(true);
  });

  it('orders lanes by kit family, kick first and percussion last', () => {
    const groups = GM_DRUM_MAP.lanes.map((l) => l.group);
    expect(groups[0]).toBe('kick');
    expect(groups[groups.length - 1]).toBe('percussion');
    // Each family is contiguous: a family never reappears after another starts.
    const firstSeen = new Map<DrumGroup, number>();
    groups.forEach((g, i) => {
      if (!firstSeen.has(g)) firstSeen.set(g, i);
    });
    for (const [group, start] of firstSeen) {
      const indices = groups.flatMap((g, i) => (g === group ? [i] : []));
      expect(indices[indices.length - 1] - start).toBe(indices.length - 1);
    }
  });

  it('lists the pitches of one family in lane order', () => {
    expect(pitchesInGroup(GM_DRUM_MAP, 'kick')).toEqual([35, 36]);
    expect(pitchesInGroup(GM_DRUM_MAP, 'hats')).toEqual([42, 44, 46]);
    expect(pitchesInGroup(GM_DRUM_MAP, 'snare')).toEqual([37, 38, 39, 40]);
  });

  it('returns undefined for a pitch the map does not name', () => {
    expect(laneOf(GM_DRUM_MAP, 24)).toBeUndefined();
    expect(laneOf(GM_DRUM_MAP, 82)).toBeUndefined();
  });
});

describe('Essential 16 map', () => {
  it('holds exactly sixteen lanes, all of them GM lanes', () => {
    expect(ESSENTIAL_DRUM_MAP.lanes).toHaveLength(16);
    for (const lane of ESSENTIAL_DRUM_MAP.lanes) {
      expect(laneOf(GM_DRUM_MAP, lane.pitch)?.name).toBe(lane.name);
      expect(laneOf(GM_DRUM_MAP, lane.pitch)?.group).toBe(lane.group);
    }
  });

  it('keeps the kick, snare and both hats', () => {
    for (const pitch of [36, 38, 42, 46]) {
      expect(laneOf(ESSENTIAL_DRUM_MAP, pitch)).toBeDefined();
    }
  });
});

describe('used lanes', () => {
  const notes = [note(36, 0), note(36, 1), note(42, 0.5), note(38, 1)];

  it('keeps only the lanes the clip plays, in map order', () => {
    const lanes = usedLanes(GM_DRUM_MAP, notes);
    expect(lanes.map((l) => l.pitch)).toEqual([36, 38, 42]);
  });

  it('is empty for an empty clip', () => {
    expect(usedLanes(GM_DRUM_MAP, [])).toEqual([]);
  });

  it('adds a labelled row for a pitch outside the map instead of hiding it', () => {
    const lanes = usedLanes(ESSENTIAL_DRUM_MAP, [note(36, 0), note(90, 0)]);
    expect(lanes.map((l) => l.pitch)).toEqual([36, 90]);
    expect(lanes[1].name).toBe('F#6');
    expect(lanes[1].group).toBe('percussion');
  });

  it('does not repeat a lane when many notes share a pitch', () => {
    const lanes = usedLanes(GM_DRUM_MAP, [note(36, 0), note(36, 1), note(36, 2)]);
    expect(lanes).toHaveLength(1);
  });
});

describe('laneList', () => {
  it('returns the whole map plus unmapped rows when not filtering', () => {
    const lanes = laneList(ESSENTIAL_DRUM_MAP, [note(90, 0)], false);
    expect(lanes).toHaveLength(17);
    expect(lanes[16].pitch).toBe(90);
  });

  it('falls back to the whole map when a filtered clip has no notes', () => {
    expect(laneList(ESSENTIAL_DRUM_MAP, [], true)).toHaveLength(16);
  });
});

describe('map derived from a track pads', () => {
  it('reads pad names and keys in pad order', () => {
    const sampler = defaultSamplerParams('drum');
    sampler.zones = [
      makePadZone('hit-kick', 0, 'Kick'),
      makePadZone('hit-snare', 1, 'Snare'),
      makePadZone('hit-hat', 2, 'Closed Hat'),
    ];
    const map = buildPadDrumMap(sampler);
    expect(map?.lanes.map((l) => l.name)).toEqual(['Kick', 'Snare', 'Closed Hat']);
    expect(map?.lanes.map((l) => l.pitch)).toEqual([24, 25, 26]);
    expect(map?.lanes.map((l) => l.group)).toEqual(['kick', 'snare', 'hats']);
  });

  it('keeps a pad colour and falls back to the family colour', () => {
    const sampler = defaultSamplerParams('drum');
    const pad = makePadZone('hit-kick', 0, 'Kick');
    pad.color = '#123456';
    const plain = makePadZone('hit-snare', 1, 'Snare');
    delete plain.color;
    sampler.zones = [pad, plain];
    const map = buildPadDrumMap(sampler);
    expect(map?.lanes[0].color).toBe('#123456');
    expect(map?.lanes[1].color).toBe('var(--drum-snare)');
  });

  it('ignores key-tracking and multi-key zones, which are not pads', () => {
    const sampler = defaultSamplerParams('multi');
    sampler.zones = [makeZone({ mediaId: 'm', name: 'Piano', keyLo: 0, keyHi: 127 })];
    expect(buildPadDrumMap(sampler)).toBeNull();
  });

  it('is null when the track has no sampler at all', () => {
    expect(buildPadDrumMap(undefined)).toBeNull();
  });
});

describe('group guessing from a pad name', () => {
  it.each([
    ['Kick 2', 'kick'],
    ['BD', 'kick'],
    ['Acoustic Snare', 'snare'],
    ['Rimshot', 'snare'],
    ['Hand Clap', 'snare'],
    ['Closed HH', 'hats'],
    ['Open Hi-Hat', 'hats'],
    ['Floor Tom', 'toms'],
    ['Crash', 'cymbals'],
    ['Ride Bell', 'cymbals'],
    ['Cowbell', 'percussion'],
    ['Shaker', 'percussion'],
  ])('%s is a %s', (name, group) => {
    expect(groupForName(name)).toBe(group);
  });
});

describe('bucketing', () => {
  it('buckets by pitch and sorts each bucket by start', () => {
    const notes = [note(36, 2), note(42, 0), note(36, 0), note(36, 1)];
    const byPitch = bucketNotesByPitch(notes);
    expect([...byPitch.keys()].sort((a, b) => a - b)).toEqual([36, 42]);
    expect(byPitch.get(36)?.map((n) => n.start)).toEqual([0, 1, 2]);
  });

  it('finds the first note at or after a beat', () => {
    const sorted = [note(36, 0), note(36, 1), note(36, 2), note(36, 3)];
    expect(firstIndexFrom(sorted, 0)).toBe(0);
    expect(firstIndexFrom(sorted, 1.5)).toBe(2);
    expect(firstIndexFrom(sorted, 3)).toBe(3);
    expect(firstIndexFrom(sorted, 9)).toBe(4);
    expect(firstIndexFrom([], 1)).toBe(0);
  });
});
