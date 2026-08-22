import { describe, expect, it } from 'vitest';
import {
  beamCount,
  beamGroupStarts,
  buildScore,
  chooseClef,
  detectKey,
  fitDuration,
  keyFromTonic,
  keySignatureGlyphs,
  noteValueBeats,
  spellPitch,
  staffPositionOf,
  type ScoreElement,
  type ScoreMeasure,
  type TimeSig,
} from '../src/model/notation';
import { normalizeTempoMap } from '../src/model/tempo';
import type { MidiClip, Note } from '../src/model/types';

const FOUR_FOUR: TimeSig = { num: 4, den: 4 };
const SIX_EIGHT: TimeSig = { num: 6, den: 8 };

const map = (sig = { num: 4, den: 4 }) => normalizeTempoMap(undefined, 120, sig);

let seq = 0;
function note(start: number, length: number, pitch: number, velocity = 100): Note {
  return { id: `n${seq++}`, start, length, pitch, velocity };
}

function clip(notes: Note[], length = 4, start = 0): MidiClip {
  return {
    id: 'c1',
    trackId: 't1',
    name: 'Part',
    type: 'midi',
    start,
    length,
    muted: false,
    notes,
  };
}

/** Compact "value.dots" spelling of a fit, e.g. ['4.1'] for a dotted quarter. */
const spell = (units: { value: number; dots: number }[]) =>
  units.map((u) => `${u.value}.${u.dots}`);

const notesOf = (m: ScoreMeasure, voice = 0): ScoreElement[] =>
  m.voices[voice].elements.filter((e) => e.kind === 'note');

describe('notation — note values', () => {
  it('measures values and dots in quarter beats', () => {
    expect(noteValueBeats(1, 0)).toBe(4);
    expect(noteValueBeats(2, 1)).toBe(3);
    expect(noteValueBeats(4, 0)).toBe(1);
    expect(noteValueBeats(4, 1)).toBe(1.5);
    expect(noteValueBeats(8, 2)).toBe(0.875);
    expect(noteValueBeats(32, 0)).toBe(0.125);
  });

  it('counts beams per value', () => {
    expect(beamCount(4)).toBe(0);
    expect(beamCount(8)).toBe(1);
    expect(beamCount(16)).toBe(2);
    expect(beamCount(32)).toBe(3);
  });
});

describe('notation — duration fitting', () => {
  it('writes three eighths from the downbeat as a dotted quarter', () => {
    expect(spell(fitDuration(0, 1.5, FOUR_FOUR))).toEqual(['4.1']);
  });

  it('writes the same three eighths from the "and of 1" as an eighth tied to a quarter', () => {
    const units = fitDuration(0.5, 2, FOUR_FOUR);
    expect(spell(units)).toEqual(['8.0', '4.0']);
    expect(units[0].start).toBe(0.5);
    expect(units[1].start).toBe(1);
  });

  it('refuses a dotted quarter on beat 2 of 4/4, which would hide beat 3', () => {
    expect(spell(fitDuration(1, 2.5, FOUR_FOUR))).toEqual(['4.0', '8.0']);
  });

  it('allows a dotted quarter on beat 3, which hides nothing stronger', () => {
    expect(spell(fitDuration(2, 3.5, FOUR_FOUR))).toEqual(['4.1']);
  });

  it('keeps symmetric syncopation as one note', () => {
    // The quarter on the "and of 2" straddles the middle of the bar evenly.
    expect(spell(fitDuration(1.5, 2.5, FOUR_FOUR))).toEqual(['4.0']);
    expect(spell(fitDuration(0.5, 1.5, FOUR_FOUR))).toEqual(['4.0']);
  });

  it('splits a dotted eighth that starts on a 16th off-beat', () => {
    expect(spell(fitDuration(0.25, 1, FOUR_FOUR))).toEqual(['16.0', '8.0']);
    expect(spell(fitDuration(0, 0.75, FOUR_FOUR))).toEqual(['8.1']);
  });

  it('fills whole bars with one value where the meter allows', () => {
    expect(spell(fitDuration(0, 4, FOUR_FOUR))).toEqual(['1.0']);
    expect(spell(fitDuration(0, 3, { num: 3, den: 4 }))).toEqual(['2.1']);
    expect(spell(fitDuration(0, 3, SIX_EIGHT))).toEqual(['2.1']);
  });

  it('splits an additive 7/8 bar along its 2+2+3 grouping', () => {
    expect(spell(fitDuration(0, 3.5, { num: 7, den: 8 }))).toEqual(['4.0', '4.0', '4.1']);
  });

  it('covers every span exactly', () => {
    for (const [s, e] of [
      [0, 4],
      [0.25, 3.75],
      [0.5, 2],
      [1.125, 2.875],
    ]) {
      const units = fitDuration(s, e, FOUR_FOUR, { grid: 0.125 });
      expect(units[0].start).toBeCloseTo(s, 9);
      const total = units.reduce((a, u) => a + u.duration, 0);
      expect(total).toBeCloseTo(e - s, 9);
      for (let i = 1; i < units.length; i++) {
        expect(units[i].start).toBeCloseTo(units[i - 1].start + units[i - 1].duration, 9);
      }
    }
  });
});

describe('notation — beaming', () => {
  it('beams a 6/8 bar in two groups of three', () => {
    const eighths = [0, 0.5, 1, 1.5, 2, 2.5].map((s) => note(s, 0.5, 67));
    const score = buildScore(clip(eighths, 3), map({ num: 6, den: 8 }), { grid: 0.5 });
    const bar = score.measures[0];
    expect(bar.sig).toEqual({ num: 6, den: 8 });
    expect(bar.beams).toHaveLength(2);
    expect(bar.beams.map((b) => b.elementIds.length)).toEqual([3, 3]);
    expect(bar.beams[0].levels).toEqual([1, 1, 1]);
  });

  it('beams 4/4 eighths by the beat', () => {
    const eighths = [0, 0.5, 1, 1.5].map((s) => note(s, 0.5, 67));
    const score = buildScore(clip(eighths, 2), map(), { grid: 0.5 });
    expect(score.measures[0].beams.map((b) => b.elementIds.length)).toEqual([2, 2]);
  });

  it('never beams across a rest', () => {
    const score = buildScore(clip([note(0, 0.5, 67), note(1.5, 0.5, 67)], 4), map(), {
      grid: 0.5,
    });
    expect(score.measures[0].beams).toHaveLength(0);
    expect(notesOf(score.measures[0])[0].beam).toBeNull();
  });

  it('groups by the beat for simple meters and by the dotted beat for compound', () => {
    expect(beamGroupStarts(FOUR_FOUR)).toEqual([0, 1, 2, 3]);
    expect(beamGroupStarts(SIX_EIGHT)).toEqual([0, 1.5]);
    expect(beamGroupStarts({ num: 3, den: 8 })).toEqual([0]);
  });
});

describe('notation — pitch spelling', () => {
  const gMajor = keyFromTonic(7, 'major');
  const eFlat = keyFromTonic(3, 'major');

  it('spells from the key signature', () => {
    expect(spellPitch(66, gMajor)).toMatchObject({ step: 'F', alter: 1, octave: 4 });
    expect(spellPitch(65, gMajor)).toMatchObject({ step: 'F', alter: 0, octave: 4 });
    expect(spellPitch(63, eFlat)).toMatchObject({ step: 'E', alter: -1, octave: 4 });
    expect(spellPitch(66, eFlat)).toMatchObject({ step: 'G', alter: -1, octave: 4 });
    expect(spellPitch(61, keyFromTonic(0, 'major'))).toMatchObject({ step: 'C', alter: 1 });
  });

  it('keeps the octave with the letter, not the pitch class', () => {
    // B♯ sounds as C4 but is written in the octave below.
    const bSharp = spellPitch(60, keyFromTonic(6, 'major'));
    expect(bSharp.step === 'C' || (bSharp.step === 'B' && bSharp.octave === 3)).toBe(true);
    expect(spellPitch(60, keyFromTonic(0, 'major')).diatonic).toBe(28);
  });

  it('names keys and prints their signatures', () => {
    expect(keyFromTonic(7, 'major')).toMatchObject({ fifths: 1, name: 'G major' });
    expect(keyFromTonic(9, 'minor')).toMatchObject({ fifths: 0, name: 'A minor' });
    expect(keyFromTonic(3, 'major')).toMatchObject({ fifths: -3, name: 'E♭ major' });
    const glyphs = keySignatureGlyphs(keyFromTonic(2, 'major'), 'treble');
    expect(glyphs.map((g) => g.step)).toEqual(['F', 'C']);
    expect(glyphs.map((g) => g.staffPos)).toEqual([8, 5]);
    expect(keySignatureGlyphs(keyFromTonic(2, 'major'), 'bass').map((g) => g.staffPos)).toEqual([
      6, 3,
    ]);
  });

  it('detects the key from the pitch content', () => {
    // A G major scale: the F♯ is what rules C major out.
    expect(detectKey([67, 69, 71, 72, 74, 76, 78, 79])).toMatchObject({ tonic: 7, fifths: 1 });
  });

  it('prints no accidental for a pitch the key already supplies, and a natural to cancel it', () => {
    const score = buildScore(clip([note(0, 1, 66), note(1, 1, 65)], 4), map(), {
      key: keyFromTonic(7, 'major'),
    });
    const [fSharp, fNatural] = notesOf(score.measures[0]);
    expect(fSharp.notes[0].pitch).toMatchObject({ step: 'F', alter: 1 });
    expect(fSharp.notes[0].accidental).toBeNull();
    expect(fNatural.notes[0].pitch).toMatchObject({ step: 'F', alter: 0 });
    expect(fNatural.notes[0].accidental).toBe(0);
  });

  it('scopes an accidental to its bar and its octave', () => {
    const notes = [note(0, 1, 61), note(1, 1, 61), note(2, 1, 73), note(4, 1, 61)];
    const score = buildScore(clip(notes, 8), map(), { key: keyFromTonic(0, 'major') });
    const bar1 = notesOf(score.measures[0]);
    expect(bar1[0].notes[0].accidental).toBe(1);
    expect(bar1[1].notes[0].accidental).toBeNull();
    // Same letter, different octave: it needs its own sign.
    expect(bar1[2].notes[0].accidental).toBe(1);
    // New bar: the accidental has expired.
    expect(notesOf(score.measures[1])[0].notes[0].accidental).toBe(1);
  });

  it('does not repeat an accidental on a tied continuation', () => {
    const score = buildScore(clip([note(3, 2, 61)], 8), map(), { key: keyFromTonic(0, 'major') });
    expect(notesOf(score.measures[0])[0].notes[0].accidental).toBe(1);
    expect(notesOf(score.measures[1])[0].notes[0].accidental).toBeNull();
  });
});

describe('notation — measures, ties and rests', () => {
  it('splits a note across a bar line into two tied notes', () => {
    const score = buildScore(clip([note(3, 2, 60)], 8), map());
    expect(score.measures).toHaveLength(2);
    const first = notesOf(score.measures[0]);
    const second = notesOf(score.measures[1]);
    expect(spell(first)).toEqual(['4.0']);
    expect(spell(second)).toEqual(['4.0']);
    expect(first[0].notes[0].tieTo).toBe(true);
    expect(first[0].notes[0].tieFrom).toBe(false);
    expect(second[0].notes[0].tieFrom).toBe(true);
    expect(second[0].notes[0].tieTo).toBe(false);
    // Both heads still point back at the one clip note they came from.
    expect(first[0].noteIds).toEqual(second[0].noteIds);
  });

  it('fills an empty bar with one whole rest, whatever the meter', () => {
    for (const sig of [
      { num: 4, den: 4 },
      { num: 3, den: 4 },
      { num: 7, den: 8 },
    ]) {
      const beats = sig.num * (4 / sig.den);
      const score = buildScore(clip([], beats), map(sig));
      const [rest] = score.measures[0].voices[0].elements;
      expect(rest.kind).toBe('rest');
      expect(rest.wholeMeasure).toBe(true);
      expect(rest.value).toBe(1);
      expect(rest.duration).toBeCloseTo(beats, 9);
    }
  });

  it('splits rests at the strong divisions instead of dotting across them', () => {
    // Three beats of silence from the downbeat of 4/4 is a half plus a quarter:
    // a dotted half rest would hide beat 3.
    expect(spell(fitDuration(0, 3, FOUR_FOUR, { rest: true }))).toEqual(['2.0', '4.0']);
    // A whole beat of 6/8 is one node, so it takes the dot.
    expect(spell(fitDuration(0, 1.5, SIX_EIGHT, { rest: true }))).toEqual(['4.1']);
    // Silence never syncopates.
    expect(spell(fitDuration(0.5, 1.5, FOUR_FOUR, { rest: true }))).toEqual(['8.0', '8.0']);
  });

  it('fills the gaps around a note with valued rests', () => {
    const score = buildScore(clip([note(1, 1, 60)], 4), map());
    const els = score.measures[0].voices[0].elements;
    expect(els.map((e) => `${e.kind}:${e.value}.${e.dots}`)).toEqual([
      'rest:4.0',
      'note:4.0',
      'rest:2.0',
    ]);
    expect(els.reduce((a, e) => a + e.duration, 0)).toBeCloseTo(4, 9);
  });

  it('follows a signature change inside the clip', () => {
    const changing = normalizeTempoMap(
      {
        sigs: [
          { id: 's0', bar: 0, num: 4, den: 4 },
          { id: 's1', bar: 1, num: 3, den: 4 },
        ],
      },
      120,
      { num: 4, den: 4 },
    );
    const score = buildScore(clip([], 8), changing);
    expect(score.measures.map((m) => `${m.sig.num}/${m.sig.den}`)).toEqual(['4/4', '3/4', '3/4']);
    expect(score.measures.map((m) => m.showSig)).toEqual([true, true, false]);
    expect(score.measures.map((m) => m.beats)).toEqual([4, 3, 3]);
  });

  it('numbers bars from where the clip sits on the timeline', () => {
    const score = buildScore(clip([note(0, 1, 60)], 4, 8), map());
    expect(score.measures[0]).toMatchObject({ index: 2, number: 3, startBeat: 8 });
  });
});

describe('notation — chords, voices and stems', () => {
  it('makes one chord of notes that start and end together', () => {
    const score = buildScore(clip([note(0, 1, 60), note(0, 1, 64), note(0, 1, 67)], 4), map());
    const [chord] = notesOf(score.measures[0]);
    expect(chord.notes.map((n) => n.pitch.step)).toEqual(['C', 'E', 'G']);
    expect(chord.notes.map((n) => n.staffPos)).toEqual([-2, 0, 2]);
    expect(score.measures[0].voices).toHaveLength(1);
  });

  it('splits overlapping material with different starts into two stemmed voices', () => {
    const score = buildScore(clip([note(0, 4, 72), note(1, 1, 55), note(2, 1, 57)], 4), map());
    const bar = score.measures[0];
    expect(bar.voices).toHaveLength(2);
    expect(bar.voices[0].stem).toBe('up');
    expect(bar.voices[1].stem).toBe('down');
    // The upper part is voice 0 whichever order the notes arrived in.
    expect(notesOf(bar, 0)[0].notes[0].pitch.midi).toBe(72);
    expect(notesOf(bar, 0)[0].stem).toBe('up');
    expect(notesOf(bar, 1)[0].stem).toBe('down');
  });

  it('stems a single voice away from the middle line', () => {
    const score = buildScore(clip([note(0, 1, 64), note(1, 1, 81)], 4), map());
    const [low, high] = notesOf(score.measures[0]);
    expect(staffPositionOf(low.notes[0].pitch.diatonic, 'treble')).toBe(0);
    expect(low.stem).toBe('up');
    expect(high.stem).toBe('down');
  });

  it('chooses a clef from the range and offers the grand staff for a wide one', () => {
    expect(chooseClef(60, 79)).toBe('treble');
    expect(chooseClef(36, 55)).toBe('bass');
    expect(chooseClef(40, 84)).toBe('grand');
    const low = buildScore(clip([note(0, 1, 40)], 4), map());
    expect(low.clef).toBe('bass');
    expect(low.measures[0].voices[0].elements[0].notes[0].staffPos).toBe(
      staffPositionOf(spellPitch(40, low.key).diatonic, 'bass'),
    );
  });

  it('engraves only the requested slice of the range', () => {
    const both = clip([note(0, 1, 43), note(0, 1, 72)], 4);
    const right = buildScore(both, map(), { clef: 'treble', pitchMin: 60 });
    const left = buildScore(both, map(), { clef: 'bass', pitchMax: 59 });
    expect(notesOf(right.measures[0])[0].notes.map((n) => n.pitch.midi)).toEqual([72]);
    expect(notesOf(left.measures[0])[0].notes.map((n) => n.pitch.midi)).toEqual([43]);
  });
});

describe('notation — quantisation', () => {
  it('pulls a loose performance onto the grid', () => {
    const score = buildScore(clip([note(0.03, 0.97, 60), note(1.02, 0.94, 62)], 4), map());
    const els = notesOf(score.measures[0]);
    expect(els.map((e) => e.start)).toEqual([0, 1]);
    expect(spell(els)).toEqual(['4.0', '4.0']);
  });

  it('keeps a note shorter than the grid instead of dropping it', () => {
    const score = buildScore(clip([note(0, 0.01, 60)], 4), map(), { grid: 0.25 });
    const els = notesOf(score.measures[0]);
    expect(els).toHaveLength(1);
    expect(els[0].duration).toBe(0.25);
  });

  it('skips muted notes', () => {
    const muted = { ...note(0, 1, 60), muted: true };
    const score = buildScore(clip([muted], 4), map());
    expect(notesOf(score.measures[0])).toHaveLength(0);
    expect(score.measures[0].voices[0].elements[0].wholeMeasure).toBe(true);
  });
});

describe('notation — beam stems', () => {
  it('gives one beam group a single stem direction', () => {
    // A run that straddles the middle line would otherwise stem both ways.
    const eighths = [0, 0.5, 1, 1.5].map((s, i) => note(s, 0.5, i < 2 ? 62 : 79));
    const score = buildScore(clip(eighths, 2), map(), { grid: 0.5 });
    const bar = score.measures[0];
    for (const group of bar.beams) {
      const stems = new Set(
        group.elementIds.map(
          (id) => bar.voices[group.voice].elements.find((e) => e.id === id)?.stem,
        ),
      );
      expect(stems.size).toBe(1);
    }
    expect(bar.beams).toHaveLength(2);
    expect(notesOf(bar)[2].stem).toBe('down');
  });
});
