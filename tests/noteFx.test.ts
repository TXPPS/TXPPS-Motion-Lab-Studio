import { describe, expect, it } from 'vitest';
import {
  applyNoteFx,
  createNoteFx,
  defaultNoteFxParams,
  divisionBeats,
  NOTE_FX_DIVISIONS,
  NOTE_FX_SPECS,
  noteFxParam,
  type NoteFxContext,
} from '../src/model/noteFx';
import type { Note, NoteFx, NoteFxKind } from '../src/model/types';

const ctx: NoteFxContext = { lengthBeats: 4, beatsPerBar: 4 };

function note(id: string, start: number, length: number, pitch: number, velocity = 100): Note {
  return { id, start, length, pitch, velocity };
}

function fx(kind: NoteFxKind, params: Record<string, number>, list?: number[]): NoteFx {
  const base = createNoteFx(kind, `fx-${kind}`);
  return { ...base, params: { ...base.params, ...params }, ...(list ? { list } : {}) };
}

/** Rate index for a division label, so tests read as musicians write. */
function div(label: string): number {
  return NOTE_FX_DIVISIONS.findIndex((d) => d.label === label);
}

const chord = [note('a', 0, 2, 60), note('b', 0, 2, 64), note('c', 0, 2, 67)];

const pitches = (notes: Note[]): number[] => notes.map((n) => n.pitch);
const starts = (notes: Note[]): number[] => notes.map((n) => n.start);

describe('note fx: arpeggiator', () => {
  it('walks a held chord upward, one note per step', () => {
    const out = applyNoteFx(chord, [fx('arpeggiator', { rate: div('1/8'), mode: 0 })], ctx);
    expect(starts(out)).toEqual([0, 0.5, 1, 1.5]);
    expect(pitches(out)).toEqual([60, 64, 67, 60]);
    // gate 0.9 of a 1/8 step
    expect(out.every((n) => Math.abs(n.length - 0.45) < 1e-9)).toBe(true);
    expect(out.every((n) => n.velocity === 100)).toBe(true);
  });

  it('adds octaves above the chord', () => {
    const out = applyNoteFx(
      chord,
      [fx('arpeggiator', { rate: div('1/8'), mode: 0, octaves: 2 })],
      ctx,
    );
    expect(pitches(out)).toEqual([60, 64, 67, 72]);
  });

  it('plays down, up/down and as-played orders', () => {
    const down = applyNoteFx(chord, [fx('arpeggiator', { rate: div('1/8'), mode: 1 })], ctx);
    expect(pitches(down)).toEqual([67, 64, 60, 67]);

    const updown = applyNoteFx(chord, [fx('arpeggiator', { rate: div('1/8'), mode: 2 })], ctx);
    expect(pitches(updown)).toEqual([60, 64, 67, 64]);

    const played = [note('a', 0, 2, 67), note('b', 0, 2, 60), note('c', 0, 2, 64)];
    const asPlayed = applyNoteFx(played, [fx('arpeggiator', { rate: div('1/8'), mode: 5 })], ctx);
    expect(pitches(asPlayed)).toEqual([67, 60, 64, 67]);
  });

  it('emits the whole chord per step in chord mode', () => {
    const out = applyNoteFx(chord, [fx('arpeggiator', { rate: div('1/4'), mode: 6 })], ctx);
    expect(out).toHaveLength(6);
    expect(starts(out)).toEqual([0, 0, 0, 1, 1, 1]);
    expect(pitches(out.slice(0, 3))).toEqual([60, 64, 67]);
  });

  it('is deterministic under a seed and stays inside the chord', () => {
    const random = fx('arpeggiator', { rate: div('1/16'), mode: 4, seed: 77 });
    const a = applyNoteFx(chord, [random], ctx);
    const b = applyNoteFx(chord, [random], ctx);
    expect(pitches(a)).toEqual(pitches(b));
    expect(a).toHaveLength(8);
    expect(a.every((n) => [60, 64, 67].includes(n.pitch))).toBe(true);
    const other = applyNoteFx(chord, [{ ...random, params: { ...random.params, seed: 4 } }], ctx);
    expect(pitches(other)).not.toEqual(pitches(a));
  });

  it('stops with the chord unless latched', () => {
    const short = [note('a', 0, 1, 60), note('b', 0, 1, 64)];
    const open = applyNoteFx(short, [fx('arpeggiator', { rate: div('1/4'), mode: 0 })], ctx);
    expect(starts(open)).toEqual([0]);

    const latched = applyNoteFx(
      short,
      [fx('arpeggiator', { rate: div('1/4'), mode: 0, latch: 1 })],
      ctx,
    );
    expect(starts(latched)).toEqual([0, 1, 2, 3]);
    expect(pitches(latched)).toEqual([60, 64, 60, 64]);
  });

  it('delays the off-beat steps by the swing amount', () => {
    const out = applyNoteFx(
      chord,
      [fx('arpeggiator', { rate: div('1/8'), mode: 0, swing: 0.5 })],
      ctx,
    );
    expect(starts(out)).toEqual([0, 0.625, 1, 1.625]);
  });

  it('restarts the pattern when the chord changes', () => {
    const notes = [
      note('a', 0, 1, 60),
      note('b', 0, 1, 64),
      note('c', 1, 1, 71),
      note('d', 1, 1, 74),
    ];
    const out = applyNoteFx(notes, [fx('arpeggiator', { rate: div('1/4'), mode: 0 })], ctx);
    expect(pitches(out)).toEqual([60, 71]);
  });

  it('never plays a muted note and passes it through untouched', () => {
    const withMuted = [...chord, { ...note('m', 0, 2, 48), muted: true }];
    const out = applyNoteFx(withMuted, [fx('arpeggiator', { rate: div('1/8'), mode: 0 })], ctx);
    expect(out.filter((n) => n.pitch === 48)).toEqual([{ ...note('m', 0, 2, 48), muted: true }]);
    expect(out.filter((n) => !n.muted).every((n) => n.pitch !== 48)).toBe(true);
  });
});

describe('note fx: chorder', () => {
  it('stacks a fixed interval set with velocity falloff', () => {
    const out = applyNoteFx([note('a', 0, 1, 60)], [fx('chorder', { falloff: 0.8 }, [4, 7])], ctx);
    expect(pitches(out)).toEqual([60, 64, 67]);
    expect(out.map((n) => n.velocity)).toEqual([100, 80, 64]);
  });

  it('adds voices below the note when the interval set is negative', () => {
    const out = applyNoteFx([note('a', 0, 1, 60)], [fx('chorder', {}, [-12, -5])], ctx);
    expect(pitches(out)).toEqual([48, 55, 60]);
  });

  it('strums the added voices and lands them on the root', () => {
    const out = applyNoteFx([note('a', 0, 2, 60)], [fx('chorder', { strum: 0.1 }, [4, 7])], ctx);
    expect(starts(out)).toEqual([0, 0.1, 0.2]);
    expect(out.map((n) => n.length)).toEqual([2, 1.9, 1.8]);
  });

  it('builds diatonic triads and sevenths in the chosen key', () => {
    const triad = applyNoteFx([note('a', 0, 1, 62)], [fx('chorder', { mode: 1, key: 0 })], ctx);
    expect(pitches(triad)).toEqual([62, 65, 69]);

    const seventh = applyNoteFx([note('a', 0, 1, 60)], [fx('chorder', { mode: 2, key: 0 })], ctx);
    expect(pitches(seventh)).toEqual([60, 64, 67, 71]);

    // wrapping past the top of the scale keeps stacking in the next octave
    const high = applyNoteFx([note('a', 0, 1, 71)], [fx('chorder', { mode: 1, key: 0 })], ctx);
    expect(pitches(high)).toEqual([71, 74, 77]);
  });

  it('keeps the added voices in key for an out-of-scale root', () => {
    const out = applyNoteFx([note('a', 0, 1, 61)], [fx('chorder', { mode: 1, key: 0 })], ctx);
    expect(pitches(out)).toEqual([61, 64, 67]);
  });
});

describe('note fx: repeater', () => {
  it('echoes at the division with velocity decay', () => {
    const out = applyNoteFx(
      [note('a', 0, 0.5, 60, 100)],
      [fx('repeater', { division: div('1/8'), repeats: 3, decay: 0.5 })],
      ctx,
    );
    expect(starts(out)).toEqual([0, 0.5, 1, 1.5]);
    expect(out.map((n) => n.velocity)).toEqual([100, 50, 25, 13]);
    expect(out.map((n) => n.id)).toEqual(['a', 'a:rep1', 'a:rep2', 'a:rep3']);
  });

  it('stops echoing once the tail falls below velocity 1', () => {
    const out = applyNoteFx(
      [note('a', 0, 0.5, 60, 100)],
      [fx('repeater', { division: div('1/8'), repeats: 8, decay: 0.1 })],
      ctx,
    );
    expect(out.map((n) => n.velocity)).toEqual([100, 10, 1]);
  });

  it('transposes each repeat and stays inside the region', () => {
    const out = applyNoteFx(
      [note('a', 0, 0.25, 60)],
      [fx('repeater', { division: div('1/4'), repeats: 4, decay: 1, pitch: 12 })],
      { lengthBeats: 3, beatsPerBar: 4 },
    );
    expect(starts(out)).toEqual([0, 1, 2]);
    expect(pitches(out)).toEqual([60, 72, 84]);
  });
});

describe('note fx: note filter', () => {
  const spread = [
    note('a', 0, 1, 40, 30),
    note('b', 1, 1, 60, 100),
    note('c', 2, 1, 62, 100),
    note('d', 3, 1, 90, 120),
  ];

  it('passes only the key and velocity window', () => {
    const out = applyNoteFx(
      spread,
      [fx('noteFilter', { keyLo: 55, keyHi: 80, velLo: 50, velHi: 110 })],
      ctx,
    );
    expect(pitches(out)).toEqual([60, 62]);
  });

  it('filters by pitch class, then transposes and offsets velocity', () => {
    const out = applyNoteFx(
      spread,
      [fx('noteFilter', { transpose: 12, velOffset: -10 }, [0, 7])],
      ctx,
    );
    expect(pitches(out)).toEqual([72]);
    expect(out[0].velocity).toBe(90);
  });

  it('tests the key range against the written pitch, not the transposed one', () => {
    const out = applyNoteFx(spread, [fx('noteFilter', { keyHi: 60, transpose: 12 })], ctx);
    expect(pitches(out)).toEqual([52, 72]);
  });

  it('drops notes transposed off the keyboard', () => {
    const out = applyNoteFx([note('a', 0, 1, 120)], [fx('noteFilter', { transpose: 24 })], ctx);
    expect(out).toEqual([]);
  });
});

describe('note fx: velocity curve', () => {
  const dynamics = [note('a', 0, 1, 60, 100), note('b', 1, 1, 62, 20)];

  it('compresses and expands around the centre', () => {
    const soft = applyNoteFx(dynamics, [fx('velocityCurve', { mode: 0, amount: 0.5 })], ctx);
    expect(soft.map((n) => n.velocity)).toEqual([82, 42]);

    const loud = applyNoteFx(dynamics, [fx('velocityCurve', { mode: 1, amount: 0.5 })], ctx);
    // expansion pushes past both ends and clamps into 1..127
    expect(loud.map((n) => n.velocity)).toEqual([118, 1]);
  });

  it('flattens to a fixed value', () => {
    const out = applyNoteFx(dynamics, [fx('velocityCurve', { mode: 2, fixed: 77 })], ctx);
    expect(out.map((n) => n.velocity)).toEqual([77, 77]);
  });

  it('randomises deterministically from the seed and the note position', () => {
    const random = fx('velocityCurve', { mode: 3, range: 20, seed: 9 });
    const a = applyNoteFx(dynamics, [random], ctx);
    const b = applyNoteFx(dynamics, [random], ctx);
    expect(a.map((n) => n.velocity)).toEqual(b.map((n) => n.velocity));
    expect(a.every((n, i) => Math.abs(n.velocity - dynamics[i].velocity) <= 20)).toBe(true);

    // The same note expanded as part of a longer window keeps its value, which
    // is what makes a bounce match playback.
    const window = applyNoteFx([dynamics[1]], [random], ctx);
    expect(window[0].velocity).toBe(a[1].velocity);

    const other = applyNoteFx(
      dynamics,
      [{ ...random, params: { ...random.params, seed: 3 } }],
      ctx,
    );
    expect(other.map((n) => n.velocity)).not.toEqual(a.map((n) => n.velocity));
  });
});

describe('note fx: chain and specs', () => {
  it('is the identity when every effect is bypassed', () => {
    const input = [...chord, note('d', 2, 1, 72, 40)];
    const chain: NoteFx[] = NOTE_FX_SPECS.map((s) => ({
      ...createNoteFx(s.kind, `b-${s.kind}`),
      bypass: true,
    }));
    expect(applyNoteFx(input, chain, ctx)).toEqual(input);
  });

  it('runs stages in order', () => {
    const input = [note('a', 0, 1, 60, 100), note('b', 1, 1, 61, 100)];
    const chain = [
      fx('noteFilter', {}, [0]),
      fx('chorder', { falloff: 0.5 }, [7]),
      fx('velocityCurve', { mode: 2, fixed: 90 }),
    ];
    const out = applyNoteFx(input, chain, ctx);
    // the C# is filtered out first, so only C gets a fifth, and both land at 90
    expect(pitches(out)).toEqual([60, 67]);
    expect(out.every((n) => n.velocity === 90)).toBe(true);
  });

  it('describes every kind with usable parameter ranges', () => {
    for (const spec of NOTE_FX_SPECS) {
      expect(spec.label.length).toBeGreaterThan(0);
      expect(spec.blurb.length).toBeGreaterThan(0);
      expect(spec.params.length).toBeGreaterThan(0);
      const defaults = defaultNoteFxParams(spec.kind);
      for (const p of spec.params) {
        expect(p.min).toBeLessThan(p.max);
        expect(p.step).toBeGreaterThan(0);
        expect(defaults[p.key]).toBeGreaterThanOrEqual(p.min);
        expect(defaults[p.key]).toBeLessThanOrEqual(p.max);
      }
    }
  });

  it('clamps a stored parameter into its spec range', () => {
    const wild = { ...createNoteFx('repeater', 'r'), params: { repeats: 999, decay: -4 } };
    expect(noteFxParam(wild, 'repeats')).toBe(16);
    expect(noteFxParam(wild, 'decay')).toBe(0);
    // an absent parameter falls back to the spec default
    expect(noteFxParam(wild, 'gate')).toBe(1);
  });

  it('resolves bar-length divisions against the context signature', () => {
    const barIndex = NOTE_FX_DIVISIONS.findIndex((d) => d.bars === 1);
    expect(divisionBeats(barIndex, { lengthBeats: 0, beatsPerBar: 3 })).toBe(3);
    expect(divisionBeats(div('1/8'), { lengthBeats: 0, beatsPerBar: 3 })).toBe(0.5);
  });
});
