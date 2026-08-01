/**
 * Chord construction: qualities, inversions, voicings.
 *
 * A chord is intervals from a root; voicing operations rearrange octaves
 * without changing pitch classes. All pure and clamped to MIDI range, so the
 * piano roll's "chordify" applies any of these to a selected root note and a
 * test can assert the exact pitches.
 */

export interface ChordQuality {
  id: string;
  label: string;
  /** semitone offsets from the root, ascending */
  intervals: number[];
}

export const CHORD_QUALITIES: ChordQuality[] = [
  { id: 'maj', label: 'Major', intervals: [0, 4, 7] },
  { id: 'min', label: 'Minor', intervals: [0, 3, 7] },
  { id: 'dim', label: 'Diminished', intervals: [0, 3, 6] },
  { id: 'aug', label: 'Augmented', intervals: [0, 4, 8] },
  { id: 'sus2', label: 'Sus2', intervals: [0, 2, 7] },
  { id: 'sus4', label: 'Sus4', intervals: [0, 5, 7] },
  { id: '6', label: '6', intervals: [0, 4, 7, 9] },
  { id: 'min6', label: 'Minor 6', intervals: [0, 3, 7, 9] },
  { id: '7', label: '7', intervals: [0, 4, 7, 10] },
  { id: 'maj7', label: 'Maj7', intervals: [0, 4, 7, 11] },
  { id: 'min7', label: 'Min7', intervals: [0, 3, 7, 10] },
  { id: '9', label: '9', intervals: [0, 4, 7, 10, 14] },
  { id: '11', label: '11', intervals: [0, 4, 7, 10, 14, 17] },
  { id: '13', label: '13', intervals: [0, 4, 7, 10, 14, 21] },
];

const BY_ID = new Map(CHORD_QUALITIES.map((q) => [q.id, q]));

export function chordQuality(id: string): ChordQuality | undefined {
  return BY_ID.get(id);
}

function clampMidi(p: number): number {
  return Math.min(127, Math.max(0, p));
}

/** Pitches of a chord on `root`. Out-of-range tones fold down an octave. */
export function buildChord(root: number, qualityId: string): number[] {
  const q = BY_ID.get(qualityId);
  if (!q) return [clampMidi(root)];
  return q.intervals.map((iv) => {
    let p = root + iv;
    while (p > 127) p -= 12;
    while (p < 0) p += 12;
    return p;
  });
}

/**
 * Invert: move the lowest `n` tones up an octave (positive), or the highest
 * down (negative). Result stays sorted ascending.
 */
export function invertChord(pitches: number[], inversion: number): number[] {
  const out = [...pitches].sort((a, b) => a - b);
  const n = Math.abs(inversion) % Math.max(1, out.length);
  for (let i = 0; i < n; i++) {
    if (inversion > 0) {
      const low = out.shift()!;
      out.push(clampMidi(low + 12));
    } else {
      const high = out.pop()!;
      out.unshift(clampMidi(high - 12));
    }
    out.sort((a, b) => a - b);
  }
  return out;
}

/** Drop-2 voicing: the second-highest tone drops an octave. Classic guitar/piano spread. */
export function drop2(pitches: number[]): number[] {
  const out = [...pitches].sort((a, b) => a - b);
  if (out.length < 2) return out;
  const idx = out.length - 2;
  out[idx] = clampMidi(out[idx] - 12);
  return out.sort((a, b) => a - b);
}

/** Spread: alternate tones up an octave, opening the voicing. */
export function spreadChord(pitches: number[]): number[] {
  const out = [...pitches].sort((a, b) => a - b);
  return out.map((p, i) => (i % 2 === 1 ? clampMidi(p + 12) : p)).sort((a, b) => a - b);
}

/** Add the root an octave below and the top an octave above. */
export function octaveDouble(pitches: number[]): number[] {
  const sorted = [...pitches].sort((a, b) => a - b);
  if (sorted.length === 0) return sorted;
  const set = new Set(sorted);
  set.add(clampMidi(sorted[0] - 12));
  set.add(clampMidi(sorted[sorted.length - 1] + 12));
  return [...set].sort((a, b) => a - b);
}
