import { describe, expect, it } from 'vitest';
import {
  avgSecPerBeat,
  barToBeat,
  beatRangeSec,
  beatToBBT,
  beatToBar,
  beatToSec,
  bpmAt,
  formatBBT,
  formatClock,
  isSimpleMap,
  normalizeTempoMap,
  parseBBT,
  secToBeat,
  sigAtBeat,
} from '../src/model/tempo';

const simple = normalizeTempoMap(undefined, 120, { num: 4, den: 4 });

describe('tempo map — normalisation', () => {
  it('pins a floor event even from an empty map', () => {
    expect(simple.tempos).toHaveLength(1);
    expect(simple.tempos[0]).toMatchObject({ beat: 0, bpm: 120 });
    expect(simple.sigs[0]).toMatchObject({ bar: 0, num: 4, den: 4 });
    expect(isSimpleMap(simple)).toBe(true);
  });

  it('sorts, clamps and de-duplicates junk', () => {
    const m = normalizeTempoMap(
      {
        tempos: [
          { id: 'b', beat: 16, bpm: 5000 },
          { id: 'a', beat: 4, bpm: 90 },
          { id: 'dupe', beat: 4, bpm: 100 },
          { id: 'neg', beat: -8, bpm: 0 },
        ],
        sigs: [
          { id: 's2', bar: 8, num: 3, den: 4 },
          { id: 's-bad', bar: 2, num: 99, den: 7 },
        ],
      },
      120,
      { num: 4, den: 4 },
    );
    expect(m.tempos.map((t) => t.beat)).toEqual([0, 4, 16]);
    // the negative-beat event was clamped to 0 and became the floor
    expect(m.tempos[0].bpm).toBe(20);
    expect(m.tempos[1].bpm).toBe(100); // last write at beat 4 wins
    expect(m.tempos[2].bpm).toBe(999); // clamped
    expect(m.sigs[0].bar).toBe(0);
    expect(m.sigs.find((s) => s.bar === 2)).toMatchObject({ num: 32, den: 4 });
  });
});

describe('tempo map — time conversion', () => {
  it('matches the constant-tempo formula', () => {
    expect(beatToSec(simple, 8)).toBeCloseTo(4, 9);
    expect(secToBeat(simple, 4)).toBeCloseTo(8, 9);
    expect(beatRangeSec(simple, 2, 6)).toBeCloseTo(2, 9);
    expect(avgSecPerBeat(simple, 0, 4)).toBeCloseTo(0.5, 9);
  });

  it('honours a tempo jump', () => {
    const m = normalizeTempoMap(
      {
        tempos: [
          { id: 'a', beat: 0, bpm: 120 },
          { id: 'b', beat: 4, bpm: 60 },
        ],
      },
      120,
      { num: 4, den: 4 },
    );
    // 4 beats at 120 = 2s, then 4 beats at 60 = 4s
    expect(beatToSec(m, 8)).toBeCloseTo(6, 9);
    expect(bpmAt(m, 3.99)).toBe(120);
    expect(bpmAt(m, 4)).toBe(60);
    expect(secToBeat(m, 6)).toBeCloseTo(8, 9);
  });

  it('integrates a linear ramp and round-trips it', () => {
    const m = normalizeTempoMap(
      {
        tempos: [
          { id: 'a', beat: 0, bpm: 60, curve: 'ramp' },
          { id: 'b', beat: 8, bpm: 120 },
        ],
      },
      120,
      { num: 4, den: 4 },
    );
    // closed form: 60·Δb·ln(b1/b0)/(b1-b0)
    const expected = (60 * Math.log(120 / 60)) / ((120 - 60) / 8);
    expect(beatToSec(m, 8)).toBeCloseTo(expected, 9);
    expect(bpmAt(m, 4)).toBeCloseTo(90, 9);
    for (const beat of [0.5, 2, 5.25, 8, 12]) {
      expect(secToBeat(m, beatToSec(m, beat))).toBeCloseTo(beat, 6);
    }
  });

  it('round-trips beat↔second across a mixed map at many points', () => {
    const m = normalizeTempoMap(
      {
        tempos: [
          { id: 'a', beat: 0, bpm: 100 },
          { id: 'b', beat: 12, bpm: 140, curve: 'ramp' },
          { id: 'c', beat: 28, bpm: 75 },
          { id: 'd', beat: 40, bpm: 180 },
        ],
      },
      120,
      { num: 4, den: 4 },
    );
    for (let beat = 0; beat <= 64; beat += 0.37) {
      expect(secToBeat(m, beatToSec(m, beat))).toBeCloseTo(beat, 6);
    }
  });
});

describe('tempo map — bars and signatures', () => {
  const m = normalizeTempoMap(
    {
      sigs: [
        { id: 's0', bar: 0, num: 4, den: 4 },
        { id: 's1', bar: 4, num: 3, den: 4 },
        { id: 's2', bar: 8, num: 6, den: 8 },
      ],
    },
    120,
    { num: 4, den: 4 },
  );

  it('maps bars to beats through signature changes', () => {
    expect(barToBeat(m, 4)).toBe(16); // 4 bars of 4/4
    expect(barToBeat(m, 8)).toBe(16 + 12); // + 4 bars of 3/4
    expect(barToBeat(m, 10)).toBe(28 + 6); // + 2 bars of 6/8 (3 quarter-beats each)
  });

  it('maps beats back to bars', () => {
    expect(beatToBar(m, 16)).toBeCloseTo(4, 9);
    expect(beatToBar(m, 28)).toBeCloseTo(8, 9);
    expect(beatToBar(m, 34)).toBeCloseTo(10, 9);
    expect(sigAtBeat(m, 29)).toMatchObject({ num: 6, den: 8 });
  });

  it('formats bars·beats·ticks in the denominator the musician reads', () => {
    expect(formatBBT(m, 0)).toBe('1.1.000');
    expect(formatBBT(m, 2.5)).toBe('1.3.480');
    // bar 9 is 6/8: six eighth-note "beats" per bar
    expect(beatToBBT(m, 28 + 1)).toMatchObject({ bar: 9, beat: 3, tick: 0 });
    expect(formatBBT(m, 16, false)).toBe('5.1');
  });

  it('parses bars·beats·ticks back to the same beat', () => {
    for (const beat of [0, 3.25, 16, 28.5, 34]) {
      const text = formatBBT(m, beat);
      expect(parseBBT(m, text)).toBeCloseTo(beat, 5);
    }
    expect(parseBBT(m, 'nope')).toBeNull();
    expect(parseBBT(m, '5')).toBe(16);
  });
});

describe('clock formatting', () => {
  it('drops the hour below an hour and keeps milliseconds', () => {
    expect(formatClock(0)).toBe('0:00.000');
    expect(formatClock(61.5)).toBe('1:01.500');
    expect(formatClock(3661.25)).toBe('1:01:01.250');
    expect(formatClock(61.5, false)).toBe('1:01');
  });
});
