import { describe, expect, it } from 'vitest';
import {
  PROGRESSIONS,
  chordFromWeights,
  chordLabelOf,
  detectChords,
  followChords,
  progressionToChords,
  suggestChords,
} from '../src/model/chordAssistant';
import type { Note } from '../src/model/types';

let seq = 0;
function note(pitch: number, start: number, length = 1, velocity = 100): Note {
  return { id: `n${seq++}`, pitch, start, length, velocity };
}

/** Chord tones of a triad/seventh, voiced around middle C. */
function chord(root: number, intervals: number[], start: number, length = 2): Note[] {
  return intervals.map((iv) => note(48 + root + iv, start, length));
}

describe('chord recognition', () => {
  it('names a major triad from its pitch classes', () => {
    const w = new Array(12).fill(0);
    w[0] = 1;
    w[4] = 1;
    w[7] = 1;
    const got = chordFromWeights(w)!;
    expect(got.root).toBe(0);
    expect(got.quality).toBe('maj');
    expect(got.confidence).toBeGreaterThan(0.9);
  });

  it('distinguishes minor, dominant seventh and major seventh on the same root', () => {
    const build = (ivs: number[], bass?: number) => {
      const w = new Array(12).fill(0);
      for (const iv of ivs) w[iv % 12] = 1;
      return chordFromWeights(w, bass)!;
    };
    expect(build([0, 3, 7])).toMatchObject({ root: 0, quality: 'min' });
    expect(build([0, 4, 7, 10])).toMatchObject({ root: 0, quality: '7' });
    expect(build([0, 4, 7, 11])).toMatchObject({ root: 0, quality: 'maj7' });
  });

  it('lets the bass decide between two readings of the same pitch classes', () => {
    // {C, F, G} is Csus4 and Fsus2 at once; only the lowest note separates them.
    const w = new Array(12).fill(0);
    w[0] = 1;
    w[5] = 1;
    w[7] = 1;
    expect(chordFromWeights(w, 0)).toMatchObject({ root: 0, quality: 'sus4' });
    expect(chordFromWeights(w, 5)).toMatchObject({ root: 5, quality: 'sus2' });
  });

  it('reads a I–V–vi–IV progression back out of the notes that played it', () => {
    const notes: Note[] = [
      ...chord(0, [0, 4, 7], 0), // C
      ...chord(7, [0, 4, 7], 2), // G
      ...chord(9, [0, 3, 7], 4), // Am
      ...chord(5, [0, 4, 7], 6), // F
    ];
    const found = detectChords(notes, { lengthBeats: 8, resolution: 2 });
    expect(found.map((c) => chordLabelOf(c.root, c.quality))).toEqual(['C', 'G', 'Am', 'F']);
    for (const c of found) expect(c.confidence).toBeGreaterThan(0.8);
  });

  it('collapses a chord that lasts several windows into one event', () => {
    const notes = [...chord(0, [0, 4, 7], 0, 8)];
    const found = detectChords(notes, { lengthBeats: 8, resolution: 2 });
    expect(found).toHaveLength(1);
    expect(found[0].beat).toBe(0);
  });

  it('ignores a passing tone rather than renaming the chord', () => {
    const notes = [
      ...chord(0, [0, 4, 7], 0, 2),
      note(48 + 6, 0.5, 0.1), // a very short F# over C major
    ];
    const found = detectChords(notes, { lengthBeats: 2, resolution: 2 });
    expect(found[0]).toMatchObject({ root: 0, quality: 'maj' });
  });

  it('reports nothing for a single note or for silence', () => {
    expect(detectChords([note(60, 0, 4)], { lengthBeats: 4 })).toEqual([]);
    expect(detectChords([], { lengthBeats: 8 })).toEqual([]);
  });
});

describe('suggestions', () => {
  it('ranks the tonic first after a dominant, and says why', () => {
    const s = suggestChords(0, 'major', { root: 7, quality: 'maj' });
    expect(s[0]).toMatchObject({ root: 0, numeral: 'I' });
    expect(s[0].reason).toMatch(/[Rr]esolve/);
  });

  it('offers a secondary dominant as a way out of the key', () => {
    const s = suggestChords(0, 'major', { root: 2, quality: 'min' });
    expect(s.some((x) => x.numeral === 'V/x' && x.quality === '7')).toBe(true);
  });

  it('uses minor degrees in a minor key', () => {
    const s = suggestChords(9, 'minor');
    expect(s.some((x) => x.numeral === 'i' && x.root === 9 && x.quality === 'min')).toBe(true);
    expect(s.some((x) => x.numeral === 'VII')).toBe(true);
  });
});

describe('progressions', () => {
  it('lays a preset out on the right beats in the right key', () => {
    const pop = PROGRESSIONS.find((p) => p.id === 'pop')!;
    const chords = progressionToChords(pop, 2, 8); // D major, from beat 8
    expect(chords.map((c) => chordLabelOf(c.root, c.quality))).toEqual(['D', 'A', 'Bm', 'G']);
    expect(chords.map((c) => c.beat)).toEqual([8, 12, 16, 20]);
  });

  it('ships a twelve-bar blues that is actually twelve bars', () => {
    const blues = PROGRESSIONS.find((p) => p.id === 'blues')!;
    expect(blues.chords).toHaveLength(12);
    expect(blues.beatsPerChord).toBe(4);
  });
});

describe('follow chords', () => {
  const chords = [
    { id: 'a', beat: 0, root: 0, quality: 'maj' },
    { id: 'b', beat: 4, root: 5, quality: 'maj' },
  ];

  it('moves notes to the nearest chord tone without changing the rhythm', () => {
    const notes = [note(62, 0, 1), note(62, 4, 1)];
    const out = followChords(notes, chords, 'nearest');
    // D over C major goes to C or E (a semitone or two away); over F it goes to F.
    expect([60, 64]).toContain(out[0].pitch);
    expect(out[0].start).toBe(0);
    // Over F major the nearest chord tone to D is C, two semitones below —
    // "nearest" means nearest, not "the root".
    expect(out[1].pitch).toBe(60);
    expect(out[1].length).toBe(1);
  });

  it('bass mode puts everything on the root', () => {
    const out = followChords([note(67, 0, 1), note(67, 4, 1)], chords, 'bass');
    expect(out[0].pitch % 12).toBe(0);
    expect(out[1].pitch % 12).toBe(5);
  });

  it('chordTone mode leaves notes that already belong alone', () => {
    const inChord = note(64, 0, 1); // E over C major
    const out = followChords([inChord], chords, 'chordTone');
    expect(out[0].pitch).toBe(64);
  });

  it('does nothing without a chord track', () => {
    const notes = [note(61, 0, 1)];
    expect(followChords(notes, [], 'nearest')).toBe(notes);
  });
});

describe('cadence reasoning', () => {
  it('calls only the tonic a resolution — not II, III or IV', () => {
    const s = suggestChords(0, 'major', { root: 7, quality: 'maj' });
    const reasonOf = (numeral: string) => s.find((x) => x.numeral === numeral)!.reason;
    expect(reasonOf('I')).toMatch(/[Rr]esolve/);
    for (const n of ['ii', 'iii', 'IV']) {
      expect(reasonOf(n)).not.toMatch(/[Rr]esolve/);
    }
  });
});
