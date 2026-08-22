import { describe, expect, it } from 'vitest';
import {
  barContextAt,
  durationBeats,
  forceAccidental,
  lastGridStart,
  pitchAtStaffPosition,
  planInsert,
  SCORE_VALUES,
  stepPitchBy,
  valueOfBeats,
  writableLength,
  type FitContext,
} from '../src/model/scoreEdit';
import { buildScore, keyFromTonic, spellPitch, staffPositionOf } from '../src/model/notation';
import { normalizeTempoMap } from '../src/model/tempo';
import type { MidiClip, Note } from '../src/model/types';

const map = (sig = { num: 4, den: 4 }) => normalizeTempoMap(undefined, 120, sig);

const C = keyFromTonic(0, 'major');
const G = keyFromTonic(7, 'major');
const EFLAT = keyFromTonic(3, 'major');

const ctx = (over: Partial<FitContext> = {}): FitContext => ({
  map: map(),
  clipStart: 0,
  clipLength: 8,
  grid: 0.25,
  ...over,
});

function clip(notes: Note[], length = 8, start = 0): MidiClip {
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

describe('score editing — reading a staff position', () => {
  it('takes the letter from the line and the accidental from the key', () => {
    // Bottom line of a treble staff is E4 whatever the key spells it as.
    expect(pitchAtStaffPosition(0, 'treble', C)).toMatchObject({ step: 'E', octave: 4, midi: 64 });
    expect(pitchAtStaffPosition(0, 'treble', EFLAT)).toMatchObject({
      step: 'E',
      alter: -1,
      midi: 63,
    });
    // Top line is F5, and G major supplies its sharp without printing one.
    expect(pitchAtStaffPosition(8, 'treble', C)).toMatchObject({ step: 'F', midi: 77 });
    expect(pitchAtStaffPosition(8, 'treble', G)).toMatchObject({ step: 'F', alter: 1, midi: 78 });
  });

  it('reads the bass clef from its own bottom line', () => {
    expect(pitchAtStaffPosition(0, 'bass', C)).toMatchObject({ step: 'G', octave: 2, midi: 43 });
    // The F line the clef names.
    expect(pitchAtStaffPosition(6, 'bass', C)).toMatchObject({ step: 'F', octave: 3, midi: 53 });
    expect(pitchAtStaffPosition(6, 'bass', EFLAT)).toMatchObject({ step: 'F', midi: 53 });
  });

  it('round-trips against the engraver: click a line, the head lands on it', () => {
    for (const clef of ['treble', 'bass'] as const) {
      for (const key of [C, G, EFLAT]) {
        for (let pos = -6; pos <= 12; pos++) {
          const p = pitchAtStaffPosition(pos, clef, key);
          expect(staffPositionOf(spellPitch(p.midi, key).diatonic, clef)).toBe(pos);
        }
      }
    }
  });
});

describe('score editing — moving by staff steps', () => {
  it('moves by letters, not semitones, and respells where it lands', () => {
    expect(stepPitchBy(64, C, 1)).toBe(65); // E4 → F4, a semitone
    expect(stepPitchBy(65, C, 1)).toBe(67); // F4 → G4, a tone
    expect(stepPitchBy(60, C, -1)).toBe(59); // C4 → B3
  });

  it('picks up the key signature on the way', () => {
    // E4 up one step is F, and in G major F is sharp.
    expect(stepPitchBy(64, G, 1)).toBe(66);
    // A♭ major flattens the step it lands on.
    expect(stepPitchBy(60, keyFromTonic(8, 'major'), 1)).toBe(61);
  });

  it('moves an octave in seven steps, not twelve', () => {
    expect(stepPitchBy(60, C, 7)).toBe(72);
    expect(stepPitchBy(66, G, -7)).toBe(54);
  });
});

describe('score editing — forcing an accidental', () => {
  it('keeps the staff line and changes the pitch', () => {
    // F♯ in G major asked for a natural sounds F, one line unmoved.
    expect(forceAccidental(66, G, 0)).toBe(65);
    expect(forceAccidental(65, C, 1)).toBe(66);
    expect(forceAccidental(65, C, -1)).toBe(64); // F♭ sounds E
    expect(forceAccidental(63, EFLAT, 0)).toBe(64); // E♭ → E♮
  });

  it('is idempotent when the note already carries that accidental', () => {
    expect(forceAccidental(66, G, 1)).toBe(66);
    expect(forceAccidental(60, C, 0)).toBe(60);
  });

  it('is a pitch control, so an exotic enharmonic is respelled by the key', () => {
    // Flattening F♯ asks for F♭, and F♭ sounds E — which is what the key
    // spells it as, because a `Note` has nowhere to record the letter. The
    // head therefore moves to the E line. The UI says "changes the pitch"
    // for exactly this reason.
    const flattened = forceAccidental(66, G, -1);
    expect(flattened).toBe(64);
    expect(spellPitch(flattened, G)).toMatchObject({ step: 'E', alter: 0 });
    // The ordinary cases do keep their line: the sharp and the natural of F.
    for (const alter of [0, 1]) {
      expect(spellPitch(forceAccidental(66, G, alter), G).diatonic).toBe(
        spellPitch(66, G).diatonic,
      );
    }
  });
});

describe('score editing — the duration palette', () => {
  it('measures each palette entry in beats', () => {
    expect(SCORE_VALUES).toEqual([1, 2, 4, 8, 16, 32]);
    expect(durationBeats({ value: 1, dots: 0 })).toBe(4);
    expect(durationBeats({ value: 4, dots: 0 })).toBe(1);
    expect(durationBeats({ value: 4, dots: 1 })).toBe(1.5);
    expect(durationBeats({ value: 32, dots: 0 })).toBe(0.125);
  });

  it('names a span back, so a shortened entry can say what it became', () => {
    expect(valueOfBeats(1.5)).toEqual({ value: 4, dots: 1 });
    expect(valueOfBeats(0.25)).toEqual({ value: 16, dots: 0 });
    expect(valueOfBeats(1 / 3)).toBeNull();
    for (const value of SCORE_VALUES) {
      for (const dots of [0, 1] as const) {
        expect(valueOfBeats(durationBeats({ value, dots }))).toEqual({ value, dots });
      }
    }
  });
});

describe('score editing — durations the engraver will write whole', () => {
  it('gives the asked-for value where the metre allows it', () => {
    expect(writableLength(ctx(), 0, 4)).toBe(4); // whole note on the downbeat
    expect(writableLength(ctx(), 0, 1.5)).toBe(1.5); // dotted quarter on beat 1
    expect(writableLength(ctx(), 2, 1.5)).toBe(1.5); // and on beat 3
    expect(writableLength(ctx(), 1.5, 1)).toBe(1); // syncopated quarter stays one note
  });

  it('shortens a value the metre would otherwise split and tie', () => {
    // A dotted quarter on beat 2 of 4/4 would hide beat 3, so a quarter is the
    // longest single head available there.
    expect(writableLength(ctx(), 1, 1.5)).toBe(1);
    expect(writableLength(ctx(), 0.25, 1)).toBe(0.5);
  });

  it('stops at the barline and at the clip end rather than tying across', () => {
    expect(writableLength(ctx(), 2, 4)).toBe(2);
    expect(writableLength(ctx({ clipLength: 2 }), 1.5, 4)).toBe(0.5);
    expect(writableLength(ctx({ clipLength: 2 }), 2, 1)).toBe(0);
  });

  it('never writes shorter than the grid the score is notated on', () => {
    expect(writableLength(ctx({ grid: 0.5 }), 0, 0.125)).toBe(0.5);
    expect(writableLength(ctx({ grid: 0.25 }), 0, 0.125)).toBe(0.25);
  });

  it('follows a compound metre', () => {
    const compound = ctx({ map: map({ num: 6, den: 8 }), grid: 0.5, clipLength: 6 });
    expect(writableLength(compound, 0, 1.5)).toBe(1.5); // the dotted beat
    expect(writableLength(compound, 0.5, 1.5)).toBe(1); // off it, only a quarter
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
    expect(barContextAt(changing, 0, 5)).toMatchObject({ bar: 1, from: 4, beats: 3 });
    // A whole note in the 3/4 bar is a dotted half, because that is the bar.
    expect(writableLength(ctx({ map: changing, clipLength: 10 }), 4, 4)).toBe(3);
  });
});

describe('score editing — placing an inserted note', () => {
  it('snaps the start to the nearest grid position', () => {
    expect(planInsert(ctx(), 0.03, 1)).toMatchObject({ start: 0, length: 1 });
    expect(planInsert(ctx(), 0.6, 1)).toMatchObject({ start: 0.5, length: 1 });
    expect(planInsert(ctx({ grid: 1 }), 1.4, 1)).toMatchObject({ start: 1 });
    expect(planInsert(ctx({ grid: 0.125 }), 0.7, 0.5)).toMatchObject({ start: 0.75 });
  });

  it('clamps inside the clip instead of lengthening it', () => {
    expect(lastGridStart(4, 0.25)).toBe(3.75);
    expect(lastGridStart(4, 1)).toBe(3);
    expect(lastGridStart(0.25, 0.25)).toBe(0);
    const plan = planInsert(ctx({ clipLength: 4 }), 99, 1);
    expect(plan?.start).toBe(3.75);
    expect((plan?.start ?? 0) + (plan?.length ?? 0)).toBeLessThanOrEqual(4);
  });

  it('reports the value it had to shorten to, and only then', () => {
    expect(planInsert(ctx(), 0, 1.5)?.shortenedFrom).toBeNull();
    expect(planInsert(ctx(), 1, 1.5)).toMatchObject({ length: 1, shortenedFrom: 1.5 });
  });

  it('enters what the engraver then writes: one head, the palette value', () => {
    // The whole point of fitting on the way in — every one of these lands as a
    // single element, never as a pair the reader has to untie.
    for (const [beat, want] of [
      [0, 4],
      [0, 1.5],
      [1, 1.5],
      [0.25, 1],
      [1.5, 1],
      [2, 4],
      [3.75, 0.25],
    ]) {
      const plan = planInsert(ctx(), beat, want);
      expect(plan).not.toBeNull();
      const note: Note = {
        id: 'n1',
        start: plan!.start,
        length: plan!.length,
        pitch: 67,
        velocity: 100,
      };
      const score = buildScore(clip([note]), map(), { grid: 0.25 });
      const heads = score.measures
        .flatMap((m) => m.voices.flatMap((v) => v.elements))
        .filter((e) => e.kind === 'note');
      expect(heads).toHaveLength(1);
      expect(heads[0].duration).toBeCloseTo(plan!.length, 9);
      expect(valueOfBeats(plan!.length)).toEqual({ value: heads[0].value, dots: heads[0].dots });
      expect(heads[0].notes[0].tieTo).toBe(false);
      expect(heads[0].notes[0].tieFrom).toBe(false);
    }
  });

  it('declines a coordinate the browser could not measure', () => {
    // An unlaid-out element reports no box, and the NaN that follows used to
    // reach the engraver as a note of NaN beats — which it tried to split
    // forever. It stops here now, and the engraver survives one anyway.
    expect(planInsert(ctx(), NaN, 1)).toBeNull();
    expect(writableLength(ctx(), NaN, 1)).toBe(0);
    expect(writableLength(ctx(), 0, NaN)).toBe(0);
    expect(
      buildScore(clip([{ id: 'n', start: 0, length: NaN, pitch: 60, velocity: 100 }]), map()),
    ).toBeTruthy();
  });

  it('always lands inside the clip, so a click past the end never refuses', () => {
    // The policy is clamp, not extend: the clip's length belongs to the
    // arrangement, so entry stops at the wall instead of moving it.
    for (const beat of [2, 4.5, 1000]) {
      const plan = planInsert(ctx({ clipLength: 2 }), beat, 1);
      expect(plan).not.toBeNull();
      expect(plan!.start).toBeLessThan(2);
      expect(plan!.start + plan!.length).toBeLessThanOrEqual(2);
    }
  });
});
