import { describe, expect, it } from 'vitest';
import { buildChord, drop2, invertChord, octaveDouble, spreadChord } from '../src/model/chords';
import {
  deleteOverlaps,
  humanizeNotes,
  legatoNotes,
  mirrorNotes,
  nearestSwungSlot,
  quantizeNotes,
  repeatNotes,
  reverseNotes,
  scaleVelocities,
  seededRandom,
  stretchNotes,
  thinNotes,
  transposeNotes,
} from '../src/model/midiTools';
import { inScale, snapToScale, suggestScales } from '../src/model/scales';
import type { Note } from '../src/model/types';

let id = 0;
function note(start: number, length: number, pitch: number, velocity = 100): Note {
  return { id: `n${id++}`, start, length, pitch, velocity };
}

describe('quantize', () => {
  it('hard-snaps starts to the grid at full strength', () => {
    const out = quantizeNotes([note(0.13, 1, 60), note(0.9, 1, 62)], {
      grid: 0.25,
      strength: 1,
      swing: 0,
    });
    expect(out[0].start).toBeCloseTo(0.25, 9);
    expect(out[1].start).toBeCloseTo(1.0, 9);
  });

  it('strength interpolates toward the grid instead of jumping', () => {
    const out = quantizeNotes([note(0.2, 1, 60)], { grid: 0.5, strength: 0.5, swing: 0 });
    // target 0, halfway from 0.2 → 0.1
    expect(out[0].start).toBeCloseTo(0.1, 9);
  });

  it('swing displaces odd slots late, and quantize targets the swung grid', () => {
    // 0.5-grid, swing 0.5 → slot 1 sits at 0.5 + 0.5*0.25 = 0.625
    expect(nearestSwungSlot(0.55, 0.5, 0.5)).toBeCloseTo(0.625, 9);
    // even slots stay put
    expect(nearestSwungSlot(0.1, 0.5, 0.5)).toBeCloseTo(0, 9);
    const out = quantizeNotes([note(0.55, 1, 60)], { grid: 0.5, strength: 1, swing: 0.5 });
    expect(out[0].start).toBeCloseTo(0.625, 9);
  });

  it('preserves velocity and (without lengths) note length', () => {
    const out = quantizeNotes([note(0.13, 0.73, 60, 77)], { grid: 0.25, strength: 1, swing: 0 });
    expect(out[0].velocity).toBe(77);
    expect(out[0].length).toBeCloseTo(0.73, 9);
  });

  it('optionally quantizes lengths via the note end', () => {
    const out = quantizeNotes([note(0, 0.9, 60)], {
      grid: 0.5,
      strength: 1,
      swing: 0,
      lengths: true,
    });
    expect(out[0].length).toBeCloseTo(1.0, 9);
  });

  it('zero strength or zero grid is the identity', () => {
    const src = [note(0.19, 0.4, 60)];
    expect(quantizeNotes(src, { grid: 0.25, strength: 0, swing: 0 })[0].start).toBeCloseTo(0.19);
    expect(quantizeNotes(src, { grid: 0, strength: 1, swing: 0 })[0].start).toBeCloseTo(0.19);
  });

  it('triplet grids quantize to thirds of a beat', () => {
    const out = quantizeNotes([note(0.3, 1, 60)], { grid: 1 / 3, strength: 1, swing: 0 });
    expect(out[0].start).toBeCloseTo(1 / 3, 9);
  });
});

describe('humanize', () => {
  const src = () => [note(0, 1, 60, 100), note(1, 1, 64, 100), note(2, 1, 67, 100)];

  it('is deterministic for a given seed', () => {
    const opts = { seed: 42, timing: 0.05, velocity: 20, length: 0.2, probability: 1 };
    const strip = (ns: Note[]) => ns.map(({ id: _id, ...rest }) => rest);
    // ids are allocation-order artifacts; the musical content must be identical
    expect(strip(humanizeNotes(src(), opts))).toEqual(strip(humanizeNotes(src(), opts)));
  });

  it('different seeds give different performances', () => {
    const a = humanizeNotes(src(), {
      seed: 1,
      timing: 0.05,
      velocity: 20,
      length: 0,
      probability: 1,
    });
    const b = humanizeNotes(src(), {
      seed: 2,
      timing: 0.05,
      velocity: 20,
      length: 0,
      probability: 1,
    });
    expect(a).not.toEqual(b);
  });

  it('respects bounds: velocity 1..127, start >= 0, length > 0', () => {
    const out = humanizeNotes([note(0, 0.1, 60, 126), note(0.01, 0.1, 60, 2)], {
      seed: 7,
      timing: 1,
      velocity: 300,
      length: 0.9,
      probability: 1,
    });
    for (const n of out) {
      expect(n.velocity).toBeGreaterThanOrEqual(1);
      expect(n.velocity).toBeLessThanOrEqual(127);
      expect(n.start).toBeGreaterThanOrEqual(0);
      expect(n.length).toBeGreaterThan(0);
    }
  });

  it('probability below 1 mutes rather than deletes', () => {
    const out = humanizeNotes(
      Array.from({ length: 40 }, (_, i) => note(i, 1, 60)),
      { seed: 5, timing: 0, velocity: 0, length: 0, probability: 0.5 },
    );
    expect(out.length).toBe(40);
    const mutedCount = out.filter((n) => n.muted).length;
    expect(mutedCount).toBeGreaterThan(5);
    expect(mutedCount).toBeLessThan(35);
  });

  it('pitch humanize stays integer and within range', () => {
    const out = humanizeNotes([note(0, 1, 127), note(1, 1, 0)], {
      seed: 9,
      timing: 0,
      velocity: 0,
      length: 0,
      probability: 1,
      pitch: 3,
    });
    for (const n of out) {
      expect(Number.isInteger(n.pitch)).toBe(true);
      expect(n.pitch).toBeGreaterThanOrEqual(0);
      expect(n.pitch).toBeLessThanOrEqual(127);
    }
  });

  it('seededRandom produces the documented stable sequence bounds', () => {
    const r = seededRandom(123);
    for (let i = 0; i < 100; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('transforms', () => {
  it('transpose clamps at the MIDI range edges', () => {
    expect(transposeNotes([note(0, 1, 126)], 12)[0].pitch).toBe(127);
    expect(transposeNotes([note(0, 1, 1)], -12)[0].pitch).toBe(0);
  });

  it('reverse flips note order within the selection span', () => {
    const out = reverseNotes([note(0, 1, 60), note(3, 1, 64)]);
    // span 0..4: first note's end maps to 4 → start 3; last maps to start 0
    expect(out[0].start).toBeCloseTo(3, 9);
    expect(out[1].start).toBeCloseTo(0, 9);
  });

  it('reverse twice is the identity', () => {
    const src = [note(0, 0.5, 60), note(1, 0.25, 64), note(2.5, 1, 67)];
    const twice = reverseNotes(reverseNotes(src));
    twice.forEach((n, i) => expect(n.start).toBeCloseTo(src[i].start, 9));
  });

  it('mirror inverts pitches around the selection centre', () => {
    const out = mirrorNotes([note(0, 1, 60), note(1, 1, 64), note(2, 1, 67)]);
    expect(out.map((n) => n.pitch)).toEqual([67, 63, 60]);
  });

  it('stretch doubles and halves around the selection start', () => {
    const doubled = stretchNotes([note(2, 0.5, 60), note(3, 0.5, 64)], 2);
    expect(doubled[0].start).toBeCloseTo(2, 9);
    expect(doubled[1].start).toBeCloseTo(4, 9);
    expect(doubled[0].length).toBeCloseTo(1, 9);
    const halved = stretchNotes(doubled, 0.5);
    expect(halved[1].start).toBeCloseTo(3, 9);
  });

  it('legato extends each event to the next start; chords share the reach', () => {
    const out = legatoNotes([note(0, 0.2, 60), note(0, 0.2, 64), note(2, 1, 67)]);
    expect(out[0].length).toBeCloseTo(2, 9);
    expect(out[1].length).toBeCloseTo(2, 9);
    expect(out[2].length).toBeCloseTo(1, 9); // last note keeps its own length
  });

  it('deleteOverlaps trims same-pitch overlaps and leaves chords alone', () => {
    const out = deleteOverlaps([note(0, 2, 60), note(1, 1, 60), note(1, 1, 64)]);
    const first = out.find((n) => n.pitch === 60 && n.start === 0)!;
    expect(first.length).toBeCloseTo(1, 9);
    expect(out.find((n) => n.pitch === 64)!.length).toBeCloseTo(1, 9);
  });

  it('thin keeps every Nth event, counting chords as one event', () => {
    const out = thinNotes(
      [note(0, 1, 60), note(0, 1, 64), note(1, 1, 62), note(2, 1, 65), note(3, 1, 67)],
      2,
    );
    // events at 0 (chord), 2 kept; 1, 3 dropped
    expect(out.map((n) => n.start).sort((a, b) => a - b)).toEqual([0, 0, 2]);
  });

  it('repeat returns only the copies, offset by the span', () => {
    const out = repeatNotes([note(0, 1, 60), note(1, 1, 64)], 2);
    expect(out.length).toBe(4);
    expect(out.map((n) => n.start).sort((a, b) => a - b)).toEqual([2, 3, 4, 5]);
  });

  it('scaleVelocities clamps into 1..127', () => {
    const out = scaleVelocities([note(0, 1, 60, 100), note(1, 1, 60, 2)], 2);
    expect(out[0].velocity).toBe(127);
    expect(out[1].velocity).toBe(4);
  });
});

describe('chords', () => {
  it('builds the documented qualities', () => {
    expect(buildChord(60, 'maj')).toEqual([60, 64, 67]);
    expect(buildChord(60, 'min7')).toEqual([60, 63, 67, 70]);
    expect(buildChord(60, '13')).toEqual([60, 64, 67, 70, 74, 81]);
    expect(buildChord(60, 'sus4')).toEqual([60, 65, 67]);
  });

  it('folds out-of-range chord tones down an octave', () => {
    const high = buildChord(120, '9');
    for (const p of high) expect(p).toBeLessThanOrEqual(127);
  });

  it('first inversion moves the root up an octave', () => {
    expect(invertChord([60, 64, 67], 1)).toEqual([64, 67, 72]);
    expect(invertChord([60, 64, 67], 2)).toEqual([67, 72, 76]);
  });

  it('negative inversion drops the top down', () => {
    expect(invertChord([60, 64, 67], -1)).toEqual([55, 60, 64]);
  });

  it('drop2 lowers the second-highest tone an octave', () => {
    expect(drop2([60, 64, 67, 71])).toEqual([55, 60, 64, 71]);
  });

  it('spread opens alternate tones upward', () => {
    expect(spreadChord([60, 64, 67])).toEqual([60, 67, 76]);
  });

  it('octaveDouble adds sub-root and top octave', () => {
    expect(octaveDouble([60, 64, 67])).toEqual([48, 60, 64, 67, 79]);
  });
});

describe('scales', () => {
  it('membership: F♯ is not in C major; B♭ is in F major', () => {
    expect(inScale(66, 0, 'major')).toBe(false);
    expect(inScale(70, 5, 'major')).toBe(true);
  });

  it('snapToScale resolves ties downward and preserves members', () => {
    expect(snapToScale(66, 0, 'major')).toBe(65); // F♯ → F, not G
    expect(snapToScale(64, 0, 'major')).toBe(64);
  });

  it('chromatic never snaps', () => {
    expect(snapToScale(61, 0, 'chromatic')).toBe(61);
  });

  it('suggestScales ranks a C major scale first for white-key input', () => {
    const s = suggestScales([60, 62, 64, 65, 67, 69, 71]);
    expect(s[0].matches).toBe(7);
    expect(s[0].label).toBe('C major');
  });
});
