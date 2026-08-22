import { describe, expect, it } from 'vitest';
import {
  beatToSource,
  createWarpMap,
  normalizeWarpMap,
  quantizeWarp,
  resetWarp,
  sourceToBeat,
  stretchRatioAt,
  warpFromTransients,
  warpedBeatLength,
} from '../src/model/warp';
import {
  BUILTIN_GROOVES,
  applyGroove,
  extractGroove,
  grooveBeatsPerBar,
  grooveByName,
  straightGroove,
  swingGroove,
} from '../src/model/groove';
import type { Transient } from '../src/model/transients';

/** Markers exactly on the beat of a 120 bpm source: half a second each. */
function gridMap(bars = 4) {
  const markers = [];
  for (let beat = 0; beat <= bars * 4; beat++) markers.push({ sourceSec: beat * 0.5, beat });
  return createWarpMap(markers, 120);
}

describe('WarpMap', () => {
  it('is the identity when every marker sits on the grid it was recorded to', () => {
    const map = gridMap();
    for (const sourceSec of [0, 0.1, 0.37, 1, 2.5, 5.9, 7.999]) {
      expect(sourceToBeat(map, sourceSec)).toBeCloseTo(sourceSec * 2, 12);
    }
    for (const beat of [0, 0.5, 3.25, 9, 15.5]) {
      expect(beatToSource(map, beat)).toBeCloseTo(beat / 2, 12);
      expect(stretchRatioAt(map, beat)).toBeCloseTo(1, 12);
    }
  });

  it('halves the source time when the markers say the source is at double tempo', () => {
    // 16 beats of music inside 4 seconds of a source recorded at 120 bpm, where
    // 16 beats would normally take 8 seconds.
    const map = createWarpMap(
      [
        { sourceSec: 0, beat: 0 },
        { sourceSec: 4, beat: 16 },
      ],
      120,
    );
    expect(beatToSource(map, 8)).toBeCloseTo(2, 12);
    expect(beatToSource(map, 8)).toBeCloseTo(gridMapSource(8) / 2, 12);
    expect(sourceToBeat(map, 1)).toBeCloseTo(4, 12);
    expect(stretchRatioAt(map, 8)).toBeCloseTo(0.5, 12);
    expect(warpedBeatLength(map, 4)).toBeCloseTo(16, 12);
  });

  it('round-trips source and beat through an uneven map to 1e-9', () => {
    const map = createWarpMap(
      [
        { sourceSec: 0.13, beat: 0 },
        { sourceSec: 0.61, beat: 1 },
        { sourceSec: 1.44, beat: 2 },
        { sourceSec: 1.72, beat: 3 },
        { sourceSec: 3.05, beat: 6 },
      ],
      132,
    );
    for (let sourceSec = 0; sourceSec <= 4; sourceSec += 0.017) {
      expect(beatToSource(map, sourceToBeat(map, sourceSec))).toBeCloseTo(sourceSec, 9);
    }
    for (let beat = -2; beat <= 10; beat += 0.13) {
      expect(sourceToBeat(map, beatToSource(map, beat))).toBeCloseTo(beat, 9);
    }
  });

  it('continues at the recorded tempo outside the markers, not at the last segment rate', () => {
    const map = createWarpMap(
      [
        { sourceSec: 1, beat: 2 },
        { sourceSec: 1.5, beat: 4 },
      ],
      120,
    );
    // Inside: two beats per half second.
    expect(stretchRatioAt(map, 3)).toBeCloseTo(0.5, 12);
    // Outside: the source's own 120 bpm, so half a second per beat.
    expect(beatToSource(map, 0)).toBeCloseTo(0, 12);
    expect(sourceToBeat(map, 2.5)).toBeCloseTo(6, 12);
    expect(stretchRatioAt(map, 6)).toBeCloseTo(1, 12);
  });

  it('drops markers that would need a negative or an infinite rate', () => {
    const map = normalizeWarpMap({
      markers: [
        { sourceSec: 0, beat: 0 },
        { sourceSec: 1, beat: 2 },
        // Same source instant as its neighbour: an infinite rate.
        { sourceSec: 1, beat: 3 },
        // Later in the source but earlier in the song: a negative rate.
        { sourceSec: 2, beat: 1 },
        { sourceSec: 3, beat: 6 },
        { sourceSec: Number.NaN, beat: 7 },
      ],
      sourceBpm: 120,
    });
    expect(map.markers).toEqual([
      { sourceSec: 0, beat: 0 },
      { sourceSec: 1, beat: 2 },
      { sourceSec: 3, beat: 6 },
    ]);
    for (let i = 1; i < map.markers.length; i++) {
      expect(stretchRatioAt(map, map.markers[i - 1].beat)).toBeGreaterThan(0);
    }
  });

  it('resets to an unwarped clip', () => {
    const map = resetWarp(gridMap());
    expect(map.markers).toHaveLength(0);
    expect(sourceToBeat(map, 3)).toBeCloseTo(6, 12);
    expect(stretchRatioAt(map, 4)).toBe(1);
  });
});

describe('warpFromTransients', () => {
  it('lands every marker of a loose four-on-the-floor on a beat', () => {
    const bpm = 120;
    const played = [0.004, 0.512, 0.978, 1.507, 1.995, 2.481, 3.02, 3.494];
    const transients: Transient[] = played.map((timeSec) => ({ timeSec, strength: 0.9 }));
    const map = warpFromTransients(transients, bpm, 1);

    expect(map.markers).toHaveLength(played.length);
    map.markers.forEach((m, i) => {
      expect(m.beat).toBe(i);
      expect(m.sourceSec).toBe(played[i]);
    });
    // Every marker now reads as an exact beat, which is the point of the map.
    for (const m of map.markers) expect(sourceToBeat(map, m.sourceSec)).toBeCloseTo(m.beat, 12);
  });

  it('ignores weak onsets and lets the stronger of two claimants keep a slot', () => {
    const transients: Transient[] = [
      { timeSec: 0.0, strength: 1 },
      { timeSec: 0.48, strength: 0.4 },
      { timeSec: 0.52, strength: 0.95 },
      { timeSec: 1.01, strength: 0.05 },
    ];
    const map = warpFromTransients(transients, 120, 1);
    expect(map.markers).toEqual([
      { sourceSec: 0, beat: 0 },
      { sourceSec: 0.52, beat: 1 },
    ]);
  });
});

describe('quantizeWarp', () => {
  it('moves markers onto the grid in proportion to strength', () => {
    const map = createWarpMap(
      [
        { sourceSec: 0, beat: 0 },
        { sourceSec: 0.5, beat: 1.2 },
        { sourceSec: 1, beat: 1.9 },
      ],
      120,
    );
    expect(quantizeWarp(map, 0, 1).markers).toEqual(map.markers);
    const half = quantizeWarp(map, 0.5, 1);
    expect(half.markers[1].beat).toBeCloseTo(1.1, 12);
    expect(half.markers[2].beat).toBeCloseTo(1.95, 12);
    const full = quantizeWarp(map, 1, 1);
    expect(full.markers.map((m) => m.beat)).toEqual([0, 1, 2]);
  });
});

function gridMapSource(beat: number): number {
  return beat * 0.5;
}

describe('groove', () => {
  const straightEighths = () =>
    Array.from({ length: 8 }, (_, i) => ({ beat: i * 0.5, velocity: 100 }));

  it('62 % swing delays every offbeat and leaves the downbeats alone', () => {
    const groove = swingGroove(62);
    const out = applyGroove(straightEighths(), groove, 1);
    out.forEach((e, i) => {
      const original = i * 0.5;
      // 62 % of the way through the pair instead of 50 %: an eighth of a beat.
      const expected = i % 2 === 0 ? original : original + 0.12;
      expect(e.beat).toBeCloseTo(expected, 12);
      expect(e.velocity).toBe(100);
    });
  });

  it('is the identity at strength 0 and interpolates in between', () => {
    const groove = grooveByName('Swing 62%');
    expect(groove).toBeDefined();
    const events = straightEighths();
    expect(applyGroove(events, groove!, 0)).toEqual(events);
    const half = applyGroove(events, groove!, 0.5);
    expect(half[1].beat).toBeCloseTo(0.56, 12);
  });

  it('scales velocity by the groove and clamps to the MIDI range', () => {
    const groove = straightGroove(2);
    groove.velocities[1] = 2;
    groove.velocities[3] = 0;
    const out = applyGroove(straightEighths(), groove, 1);
    expect(out[1].velocity).toBe(127);
    expect(out[3].velocity).toBe(1);
    expect(out[0].velocity).toBe(100);
  });

  it('reads back the groove it was just given', () => {
    const groove = swingGroove(62);
    const bpm = 120;
    // Two bars of grooved eighths, turned into onsets the way the detector
    // would report them.
    const events = Array.from({ length: 16 }, (_, i) => ({ beat: i * 0.5, velocity: 100 }));
    const grooved = applyGroove(events, groove, 1);
    const transients: Transient[] = grooved.map((e) => ({
      timeSec: (e.beat * 60) / bpm,
      strength: 0.8,
    }));

    const extracted = extractGroove(transients, bpm, 2, { name: 'Read back' });
    expect(extracted.resolution).toBe(2);
    expect(grooveBeatsPerBar(extracted)).toBe(4);
    extracted.offsets.forEach((offset, slot) => {
      expect(offset, `slot ${slot}`).toBeCloseTo(groove.offsets[slot], 6);
    });
    for (const v of extracted.velocities) expect(v).toBeCloseTo(1, 6);
  });

  it('extracts the accent pattern as velocity multipliers', () => {
    const bpm = 120;
    const transients: Transient[] = Array.from({ length: 8 }, (_, i) => ({
      timeSec: (i * 0.5 * 60) / bpm,
      strength: i % 2 === 0 ? 1 : 0.5,
    }));
    const groove = extractGroove(transients, bpm, 2);
    expect(groove.velocities[0]).toBeCloseTo(1 / 0.75, 6);
    expect(groove.velocities[1]).toBeCloseTo(0.5 / 0.75, 6);
    for (const o of groove.offsets) expect(o).toBeCloseTo(0, 9);
  });

  it('offers the presets the groove menu needs', () => {
    const names = BUILTIN_GROOVES.map((g) => g.name);
    expect(names).toEqual([
      'Straight',
      'Swing 54%',
      'Swing 58%',
      'Swing 62%',
      'Swing 1/16 62%',
      'Laid Back',
      'Pushed',
    ]);
    for (const g of BUILTIN_GROOVES) {
      expect(g.offsets).toHaveLength(g.velocities.length);
      expect(grooveBeatsPerBar(g)).toBe(4);
    }
    // A sixteenth swing moves the second sixteenth of each pair, not the eighth.
    const sixteenth = grooveByName('Swing 1/16 62%')!;
    expect(sixteenth.offsets[1]).toBeCloseTo(0.06, 12);
    expect(sixteenth.offsets[2]).toBe(0);
    expect(grooveByName('Laid Back')!.offsets[1]).toBeGreaterThan(0);
    expect(grooveByName('Pushed')!.offsets[1]).toBeLessThan(0);
  });
});
