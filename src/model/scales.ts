/**
 * Scales: membership, snapping, and simple fit suggestions.
 *
 * A scale is pitch classes from a tonic. Scale lock never deletes what a
 * musician plays — it snaps a candidate pitch to the nearest member, tie
 * broken downward, which is what "wrong" notes want in practice.
 */

export interface ScaleDef {
  id: string;
  label: string;
  /** pitch classes from the tonic */
  steps: number[];
}

export const SCALES: ScaleDef[] = [
  { id: 'major', label: 'Major', steps: [0, 2, 4, 5, 7, 9, 11] },
  { id: 'minor', label: 'Natural minor', steps: [0, 2, 3, 5, 7, 8, 10] },
  { id: 'harm-minor', label: 'Harmonic minor', steps: [0, 2, 3, 5, 7, 8, 11] },
  { id: 'mel-minor', label: 'Melodic minor', steps: [0, 2, 3, 5, 7, 9, 11] },
  { id: 'dorian', label: 'Dorian', steps: [0, 2, 3, 5, 7, 9, 10] },
  { id: 'phrygian', label: 'Phrygian', steps: [0, 1, 3, 5, 7, 8, 10] },
  { id: 'lydian', label: 'Lydian', steps: [0, 2, 4, 6, 7, 9, 11] },
  { id: 'mixolydian', label: 'Mixolydian', steps: [0, 2, 4, 5, 7, 9, 10] },
  { id: 'maj-pent', label: 'Major pentatonic', steps: [0, 2, 4, 7, 9] },
  { id: 'min-pent', label: 'Minor pentatonic', steps: [0, 3, 5, 7, 10] },
  { id: 'blues', label: 'Blues', steps: [0, 3, 5, 6, 7, 10] },
  { id: 'chromatic', label: 'Chromatic', steps: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
];

export const KEY_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];

const BY_ID = new Map(SCALES.map((s) => [s.id, s]));

export function scaleById(id: string): ScaleDef | undefined {
  return BY_ID.get(id);
}

export function inScale(pitch: number, tonic: number, scaleId: string): boolean {
  const s = BY_ID.get(scaleId);
  if (!s) return true;
  const pc = (((pitch - tonic) % 12) + 12) % 12;
  return s.steps.includes(pc);
}

/** Nearest in-scale pitch; ties resolve downward. Chromatic returns the input. */
export function snapToScale(pitch: number, tonic: number, scaleId: string): number {
  const s = BY_ID.get(scaleId);
  if (!s || s.steps.length === 0) return pitch;
  for (let d = 0; d <= 6; d++) {
    if (inScale(pitch - d, tonic, scaleId) && pitch - d >= 0) return pitch - d;
    if (inScale(pitch + d, tonic, scaleId) && pitch + d <= 127) return pitch + d;
  }
  return pitch;
}

/**
 * Rank key/scale candidates by how many of the given pitches they contain.
 * Only major and natural minor are offered as suggestions — the honest use
 * case is "what key am I in", not a mode catalogue.
 */
export function suggestScales(
  pitches: number[],
  limit = 3,
): { tonic: number; scaleId: string; label: string; matches: number; total: number }[] {
  if (pitches.length === 0) return [];
  const classes = pitches.map((p) => ((p % 12) + 12) % 12);
  const results: {
    tonic: number;
    scaleId: string;
    label: string;
    matches: number;
    total: number;
  }[] = [];
  for (const scaleId of ['major', 'minor']) {
    for (let tonic = 0; tonic < 12; tonic++) {
      const matches = classes.filter((pc) => inScale(pc, tonic, scaleId)).length;
      results.push({
        tonic,
        scaleId,
        label: `${KEY_NAMES[tonic]} ${scaleId === 'major' ? 'major' : 'minor'}`,
        matches,
        total: classes.length,
      });
    }
  }
  // Best coverage first; ties prefer fewer accidentals-by-convention (C first).
  return results.sort((a, b) => b.matches - a.matches || a.tonic - b.tonic).slice(0, limit);
}
