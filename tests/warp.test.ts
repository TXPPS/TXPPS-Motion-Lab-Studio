import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
  MIN_MARKER_GAP_SEC,
  addWarpMarker,
  moveWarpMarker,
  nearestTransient,
  removeWarpMarker,
  warpMarkerNear,
} from '../src/model/warpEdit';
import {
  warpChannel,
  warpSegments,
  warpedClipTiming,
  warpedTimeSec,
  renderWarpedBuffer,
  clearWarpCache,
  warpedBuffer,
} from '../src/audio/warpRender';
import { cacheBuffer, resetMediaCaches } from '../src/audio/mediaLibrary';
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

/** Two bars of a 120 bpm source, one marker per beat. */
function editableMap() {
  return createWarpMap(
    [
      { sourceSec: 0.5, beat: 1 },
      { sourceSec: 1.0, beat: 2 },
      { sourceSec: 1.5, beat: 3 },
    ],
    120,
  );
}

describe('warp marker editing', () => {
  it('keeps the beat a dragged marker is pinned to and moves the audio under it', () => {
    const map = editableMap();
    const moved = moveWarpMarker(map, 1, 1.2);
    expect(moved.markers[1]).toEqual({ sourceSec: 1.2, beat: 2 });
    // The audio at 1.2 s used to play late; now it lands exactly on beat 2.
    expect(sourceToBeat(map, 1.2)).toBeGreaterThan(2);
    expect(sourceToBeat(moved, 1.2)).toBeCloseTo(2, 12);
  });

  it('clamps a drag inside its neighbours instead of reordering them', () => {
    const map = editableMap();
    const left = moveWarpMarker(map, 1, -5);
    const right = moveWarpMarker(map, 1, 99);
    expect(left.markers[1].sourceSec).toBeCloseTo(0.5 + MIN_MARKER_GAP_SEC, 12);
    expect(right.markers[1].sourceSec).toBeCloseTo(1.5 - MIN_MARKER_GAP_SEC, 12);
    for (const m of [left, right]) {
      expect(m.markers).toHaveLength(3);
      for (let i = 1; i < m.markers.length; i++) {
        expect(m.markers[i].sourceSec).toBeGreaterThan(m.markers[i - 1].sourceSec);
        expect(m.markers[i].beat).toBeGreaterThan(m.markers[i - 1].beat);
      }
    }
  });

  it('clamps the first marker at zero and the last at the end of the media', () => {
    const map = editableMap();
    expect(moveWarpMarker(map, 0, -1).markers[0].sourceSec).toBe(0);
    expect(moveWarpMarker(map, 2, 100, 2.25).markers[2].sourceSec).toBe(2.25);
  });

  it('leaves a marker alone when its neighbours leave it no room', () => {
    const tight = createWarpMap(
      [
        { sourceSec: 1, beat: 1 },
        { sourceSec: 1.005, beat: 2 },
        { sourceSec: 1.01, beat: 3 },
      ],
      120,
    );
    expect(moveWarpMarker(tight, 1, 1.4)).toBe(tight);
    expect(moveWarpMarker(tight, 7, 1.4)).toBe(tight);
  });

  it('pins a new marker where the audio already plays, so adding one is silent', () => {
    const map = editableMap();
    const added = addWarpMarker(map, 1.31);
    expect(added.markers.map((m) => m.sourceSec)).toEqual([0.5, 1, 1.31, 1.5]);
    for (let sourceSec = 0; sourceSec <= 3; sourceSec += 0.031) {
      expect(sourceToBeat(added, sourceSec)).toBeCloseTo(sourceToBeat(map, sourceSec), 12);
    }
  });

  it('refuses an add on top of a marker that is already there', () => {
    const map = editableMap();
    expect(addWarpMarker(map, 1.0 + MIN_MARKER_GAP_SEC / 2)).toBe(map);
    expect(addWarpMarker(map, -1)).toBe(map);
  });

  it('removes a marker and leaves the rest ordered', () => {
    const map = editableMap();
    const cut = removeWarpMarker(map, 1);
    expect(cut.markers.map((m) => m.beat)).toEqual([1, 3]);
    expect(removeWarpMarker(map, 9)).toBe(map);
    expect(removeWarpMarker(removeWarpMarker(cut, 0), 0).markers).toHaveLength(0);
  });

  it('finds the marker under a pointer, nearest first, and nothing outside the tolerance', () => {
    const map = editableMap();
    expect(warpMarkerNear(map, 1.04, 0.06)).toBe(1);
    expect(warpMarkerNear(map, 1.26, 0.3)).toBe(2);
    expect(warpMarkerNear(map, 1.25, 0.01)).toBe(-1);
  });

  it('snaps to the nearest onset in reach and to nothing when there is none', () => {
    const onsets = [0.02, 0.51, 1.48];
    expect(nearestTransient(onsets, 0.54, 0.05)).toBe(0.51);
    expect(nearestTransient(onsets, 0.9, 0.05)).toBeNull();
    expect(nearestTransient(undefined, 0.9, 5)).toBeNull();
  });
});

describe('warp render', () => {
  /** A marker at one second pinned half a beat early: the first second plays
   *  in half the time, and everything after it keeps the recorded tempo. */
  const halved = createWarpMap(
    [
      { sourceSec: 0, beat: 0 },
      { sourceSec: 1, beat: 1 },
    ],
    120,
  );

  it('is the identity for a map that pins fewer than two points', () => {
    for (const map of [createWarpMap([], 120), createWarpMap([{ sourceSec: 1, beat: 3 }], 120)]) {
      for (const sourceSec of [0, 0.4, 1, 2.7]) {
        expect(warpedTimeSec(map, sourceSec)).toBeCloseTo(sourceSec, 12);
      }
    }
  });

  it('never moves the head of the file, whatever the markers do behind it', () => {
    const late = createWarpMap(
      [
        { sourceSec: 1, beat: 0 },
        { sourceSec: 1.4, beat: 1 },
      ],
      120,
    );
    expect(warpedTimeSec(late, 0)).toBe(0);
    expect(warpedTimeSec(late, 0.7)).toBeCloseTo(0.7, 12);
    // The bent segment is 0.4 s of source playing a beat, which at 120 bpm is
    // half a second of warped time.
    expect(warpedTimeSec(late, 1.4)).toBeCloseTo(1.5, 12);
  });

  it('cuts the source at every marker inside it and stretches each piece to its beats', () => {
    const segments = warpSegments(halved, 2);
    expect(segments.map((s) => [s.fromSec, s.toSec])).toEqual([
      [0, 1],
      [1, 2],
    ]);
    expect(segments[0].outToSec).toBeCloseTo(0.5, 12);
    // Past the last marker the source runs at its own tempo again.
    expect(segments[1].outToSec - segments[1].outFromSec).toBeCloseTo(1, 12);
  });

  it('moves the audio to where the map says it plays', () => {
    const rate = 8000;
    const source = new Float32Array(2 * rate);
    // A second of tone, then a second of silence.
    for (let i = 0; i < rate; i++) source[i] = Math.sin((2 * Math.PI * 200 * i) / rate);
    const out = warpChannel(source, rate, halved);

    expect(out.length).toBe(Math.round(1.5 * rate));
    const rms = (fromSec: number, toSec: number) => {
      let sum = 0;
      const from = Math.round(fromSec * rate);
      const to = Math.round(toSec * rate);
      for (let i = from; i < to; i++) sum += out[i] * out[i];
      return Math.sqrt(sum / (to - from));
    };
    // The tone now finishes at half a second, not at one.
    expect(rms(0.05, 0.4)).toBeGreaterThan(0.3);
    expect(rms(0.65, 1.4)).toBeLessThan(0.02);
  });

  it('returns a copy, not the same array, when there is nothing to bend', () => {
    const source = new Float32Array([0.1, -0.2, 0.3, -0.4]);
    const out = warpChannel(source, 8000, createWarpMap([], 120));
    expect([...out]).toEqual([...source]);
    expect(out).not.toBe(source);
  });

  it('reads a clip trim in warped seconds so the same material still plays', () => {
    const timing = { offset: 1, length: 2, sourceDuration: 1, gain: 1, fadeIn: 0, fadeOut: 0 };
    const warped = warpedClipTiming(timing, halved);
    // The trim starts after the bent segment, which is half a second shorter.
    expect(warped.offset).toBeCloseTo(0.5, 12);
    expect(warped.sourceDuration).toBeCloseTo(1, 12);
    expect(warpedClipTiming({ ...timing, sourceDuration: undefined }, halved).sourceDuration).toBe(
      undefined,
    );
  });
});

describe('renderWarpedBuffer', () => {
  /**
   * jsdom has no Web Audio; the render only ever asks its context for a buffer,
   * so a stand-in that hands back plain arrays exercises the real code.
   */
  function fakeContext(): BaseAudioContext {
    return {
      createBuffer: (channels: number, length: number, sampleRate: number) => {
        const data = Array.from({ length: channels }, () => new Float32Array(length));
        return {
          numberOfChannels: channels,
          length,
          sampleRate,
          duration: length / sampleRate,
          getChannelData: (i: number) => data[i],
          copyToChannel: (from: Float32Array, i: number) => data[i].set(from),
        } as unknown as AudioBuffer;
      },
    } as unknown as BaseAudioContext;
  }

  function fakeBuffer(channels: Float32Array[], sampleRate: number): AudioBuffer {
    return {
      numberOfChannels: channels.length,
      length: channels[0].length,
      sampleRate,
      duration: channels[0].length / sampleRate,
      getChannelData: (i: number) => channels[i],
    } as unknown as AudioBuffer;
  }

  it('warps every channel to the length the map asks for', () => {
    const rate = 8000;
    const map = createWarpMap(
      [
        { sourceSec: 0, beat: 0 },
        { sourceSec: 1, beat: 1 },
      ],
      120,
    );
    const tone = (hz: number) =>
      Float32Array.from({ length: 2 * rate }, (_, i) => Math.sin((2 * Math.PI * hz * i) / rate));
    const out = renderWarpedBuffer(fakeContext(), fakeBuffer([tone(200), tone(300)], rate), map);

    expect(out.numberOfChannels).toBe(2);
    expect(out.sampleRate).toBe(rate);
    // The first second of source now plays in half a second.
    expect(out.length).toBe(Math.round(1.5 * rate));
    for (let c = 0; c < 2; c++) {
      const data = out.getChannelData(c);
      let peak = 0;
      for (const v of data) peak = Math.max(peak, Math.abs(v));
      expect(peak).toBeGreaterThan(0.5);
    }
  });
});

describe('warp render cache', () => {
  const SR = 8000;

  function fakeCtx(): BaseAudioContext {
    return {
      createBuffer: (channels: number, length: number, sampleRate: number) => {
        const data = Array.from({ length: channels }, () => new Float32Array(length));
        return {
          numberOfChannels: channels,
          length,
          sampleRate,
          duration: length / sampleRate,
          getChannelData: (i: number) => data[i],
          copyToChannel: (from: Float32Array, i: number) => data[i].set(from),
        } as unknown as AudioBuffer;
      },
    } as unknown as BaseAudioContext;
  }

  /** A map whose single bent segment differs per index, so each has its own key. */
  const mapFor = (i: number) =>
    createWarpMap(
      [
        { sourceSec: 0, beat: 0 },
        { sourceSec: 1 + i / 1000, beat: 1 },
      ],
      120,
    );

  beforeEach(() => {
    vi.useFakeTimers();
    resetMediaCaches();
    clearWarpCache();
    const tone = Float32Array.from({ length: 2 * SR }, (_, i) =>
      Math.sin((2 * Math.PI * 200 * i) / SR),
    );
    cacheBuffer('m1', {
      numberOfChannels: 1,
      length: tone.length,
      sampleRate: SR,
      duration: tone.length / SR,
      getChannelData: () => tone,
    } as unknown as AudioBuffer);
  });

  afterEach(() => {
    vi.useRealTimers();
    clearWarpCache();
    resetMediaCaches();
  });

  /** Ask for a render and let the deferred work run, so the entry is filled. */
  function render(ctx: BaseAudioContext, i: number): AudioBuffer | null {
    const first = warpedBuffer(ctx, 'm1', mapFor(i));
    vi.runAllTimers();
    return first ?? warpedBuffer(ctx, 'm1', mapFor(i));
  }

  /**
   * The cache held 16 entries and evicted `keys().next()` — the least recently
   * *inserted*. Looping a section with 17 warped clips therefore threw away
   * the clip that was about to play again, on every pass.
   */
  it('evicts the least recently used entry, not the oldest insertion', () => {
    const ctx = fakeCtx();
    for (let i = 0; i < 16; i++) expect(render(ctx, i)).not.toBeNull();

    // Touch the oldest insertion: it is now the most recently used.
    expect(warpedBuffer(ctx, 'm1', mapFor(0))).not.toBeNull();
    // One more entry pushes the cache over its ceiling.
    render(ctx, 16);

    expect(warpedBuffer(ctx, 'm1', mapFor(0)), 'the clip just played was evicted').not.toBeNull();
    expect(warpedBuffer(ctx, 'm1', mapFor(1)), 'the truly stalest entry survived').toBeNull();
  });
});
