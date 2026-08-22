/**
 * Chord detection and the Chord Assistant.
 *
 * Three jobs, all pure:
 *
 *  1. Read chords out of what is already played — a progression you improvised
 *     becomes a chord track you can edit.
 *  2. Suggest what could come next, from functional harmony rather than from a
 *     lookup of "songs that used this". A suggestion says WHY (its function and
 *     its role), because a suggestion a musician cannot reason about is a
 *     slot machine.
 *  3. Make material follow the chord track: move notes onto chord tones without
 *     changing the rhythm, which is what "follow chords" means.
 *
 * Nothing here plays audio or touches the store.
 */
import { buildChord, chordQuality, CHORD_QUALITIES } from './chords';
import { KEY_NAMES, SCALES, scaleById } from './scales';
import type { ChordEvent } from './arrangement';
import type { Note } from './types';

export interface DetectedChord {
  /** absolute beat the chord starts on */
  beat: number;
  root: number;
  quality: string;
  /** 0..1; how well the played pitches matched this chord */
  confidence: number;
  /** pitch classes that were sounding */
  pitches: number[];
}

const PITCH_CLASS_COUNT = 12;

/** Every (root, quality) pair, precomputed as a pitch-class mask. */
interface Template {
  root: number;
  quality: string;
  mask: number;
  size: number;
}

const TEMPLATES: Template[] = (() => {
  const out: Template[] = [];
  // Only the qualities a listener would name from three or four notes. The
  // extended ones (11, 13) are supersets that would win every comparison on
  // mask overlap alone and are better reached by editing.
  const useful = [
    'maj',
    'min',
    'dim',
    'aug',
    'sus2',
    'sus4',
    '6',
    'min6',
    '7',
    'maj7',
    'min7',
    '9',
  ];
  for (const q of CHORD_QUALITIES) {
    if (!useful.includes(q.id)) continue;
    for (let root = 0; root < PITCH_CLASS_COUNT; root++) {
      let mask = 0;
      for (const iv of q.intervals) mask |= 1 << ((root + iv) % PITCH_CLASS_COUNT);
      out.push({ root, quality: q.id, mask, size: q.intervals.length });
    }
  }
  return out;
})();

const popcount = (n: number): number => {
  let x = n;
  let c = 0;
  while (x) {
    x &= x - 1;
    c++;
  }
  return c;
};

/**
 * Best chord for a set of sounding pitch classes, weighted by how long each
 * pitch sounded — a passing tone should not rename the chord.
 */
export function chordFromWeights(
  weights: number[],
  /**
   * Pitch class of the lowest sounding note, when it is known.
   *
   * Some pitch-class sets are genuinely two chords — {C,F,G} is Csus4 and
   * Fsus2 at once — and only the bass decides which. Without it the detector
   * has to pick one and would be guessing.
   */
  bassPc?: number,
): { root: number; quality: string; confidence: number } | null {
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return null;
  let bestScore = -Infinity;
  let best: Template | null = null;
  for (const t of TEMPLATES) {
    let inChord = 0;
    for (let pc = 0; pc < PITCH_CLASS_COUNT; pc++) {
      if (t.mask & (1 << pc)) inChord += weights[pc];
    }
    const outside = total - inChord;
    // Reward chord tones, punish notes outside it, and prefer the smallest
    // chord that explains what is sounding — otherwise a 9th always wins.
    const missing = popcount(t.mask & ~maskOf(weights));
    const score = inChord * 1.5 - outside * 1.2 - missing * 0.22 * total - t.size * 0.02 * total;
    // The bass note is the strongest cue for the root there is.
    const rootBonus =
      (weights[t.root] > 0 ? weights[t.root] * 0.6 : 0) +
      (bassPc !== undefined && t.root === bassPc ? total * 0.5 : 0);
    if (score + rootBonus > bestScore) {
      bestScore = score + rootBonus;
      best = t;
    }
  }
  if (!best) return null;
  let inChord = 0;
  for (let pc = 0; pc < PITCH_CLASS_COUNT; pc++) {
    if (best.mask & (1 << pc)) inChord += weights[pc];
  }
  return { root: best.root, quality: best.quality, confidence: Math.min(1, inChord / total) };
}

function maskOf(weights: number[]): number {
  let m = 0;
  for (let pc = 0; pc < PITCH_CLASS_COUNT; pc++) if (weights[pc] > 0) m |= 1 << pc;
  return m;
}

export interface DetectOptions {
  /** analysis window in beats; a chord per half bar is the usual reading */
  resolution?: number;
  /** total length to scan, in beats */
  lengthBeats: number;
  /** beat the notes are relative to */
  originBeat?: number;
  /** drop windows whose best match is weaker than this */
  minConfidence?: number;
}

/**
 * Detect a chord progression from notes.
 *
 * Windows that repeat the previous chord are collapsed, so a four-bar C major
 * is one event rather than eight identical ones — the chord track is a map of
 * where the harmony CHANGES.
 */
export function detectChords(notes: Note[], opts: DetectOptions): DetectedChord[] {
  const resolution = Math.max(0.25, opts.resolution ?? 2);
  const origin = opts.originBeat ?? 0;
  const minConfidence = opts.minConfidence ?? 0.55;
  const out: DetectedChord[] = [];

  for (let w = 0; w < opts.lengthBeats; w += resolution) {
    const from = w;
    const to = w + resolution;
    const weights = new Array<number>(PITCH_CLASS_COUNT).fill(0);
    const seen = new Set<number>();
    for (const n of notes) {
      if (n.muted) continue;
      const start = n.start;
      const end = n.start + n.length;
      const overlap = Math.min(end, to) - Math.max(start, from);
      if (overlap <= 0) continue;
      const pc = ((Math.round(n.pitch) % 12) + 12) % 12;
      // Low notes carry the root; weight by duration and lean on the bass.
      weights[pc] += overlap * (1 + (n.velocity / 127) * 0.5) * (n.pitch < 52 ? 1.6 : 1);
      seen.add(pc);
    }
    if (seen.size < 2) continue;
    let lowest = Infinity;
    for (const n of notes) {
      if (n.muted) continue;
      if (Math.min(n.start + n.length, to) - Math.max(n.start, from) <= 0) continue;
      if (n.pitch < lowest) lowest = n.pitch;
    }
    const bassPc = Number.isFinite(lowest) ? ((Math.round(lowest) % 12) + 12) % 12 : undefined;
    const best = chordFromWeights(weights, bassPc);
    if (!best || best.confidence < minConfidence) continue;
    const prev = out[out.length - 1];
    if (prev && prev.root === best.root && prev.quality === best.quality) continue;
    out.push({
      beat: origin + from,
      root: best.root,
      quality: best.quality,
      confidence: best.confidence,
      pitches: [...seen].sort((a, b) => a - b),
    });
  }
  return out;
}

// ------------------------------------------------------------ suggestions

/** Roman-numeral degrees of the major and natural-minor scales. */
const MAJOR_DEGREES = [
  { semitone: 0, quality: 'maj', numeral: 'I', role: 'Home' },
  { semitone: 2, quality: 'min', numeral: 'ii', role: 'Sets up the V' },
  { semitone: 4, quality: 'min', numeral: 'iii', role: 'Softer home' },
  { semitone: 5, quality: 'maj', numeral: 'IV', role: 'Lifts away' },
  { semitone: 7, quality: 'maj', numeral: 'V', role: 'Pulls home' },
  { semitone: 9, quality: 'min', numeral: 'vi', role: 'The sad relative' },
  { semitone: 11, quality: 'dim', numeral: 'vii°', role: 'Leans hard home' },
];

const MINOR_DEGREES = [
  { semitone: 0, quality: 'min', numeral: 'i', role: 'Home' },
  { semitone: 2, quality: 'dim', numeral: 'ii°', role: 'Tense approach' },
  { semitone: 3, quality: 'maj', numeral: 'III', role: 'The bright relative' },
  { semitone: 5, quality: 'min', numeral: 'iv', role: 'Lifts away' },
  { semitone: 7, quality: 'min', numeral: 'v', role: 'Modal pull' },
  { semitone: 8, quality: 'maj', numeral: 'VI', role: 'Wide and open' },
  { semitone: 10, quality: 'maj', numeral: 'VII', role: 'Rock cadence' },
];

export interface ChordSuggestion {
  root: number;
  quality: string;
  numeral: string;
  /** why it is offered, in one phrase */
  reason: string;
  /** 0..1 — how strongly it follows from the previous chord */
  strength: number;
  label: string;
}

export function chordLabelOf(root: number, quality: string): string {
  const short: Record<string, string> = {
    maj: '',
    min: 'm',
    dim: '°',
    aug: '+',
    sus2: 'sus2',
    sus4: 'sus4',
    '6': '6',
    min6: 'm6',
    '7': '7',
    maj7: 'maj7',
    min7: 'm7',
    '9': '9',
    '11': '11',
    '13': '13',
  };
  return `${KEY_NAMES[((root % 12) + 12) % 12]}${short[quality] ?? quality}`;
}

/**
 * What could follow `previous` in this key.
 *
 * The ranking is functional: after a dominant the tonic is the strongest
 * answer, after a tonic the subdominant and the relative minor open the most
 * doors, and a secondary dominant is always available as a way out. Every
 * suggestion carries the reason so the musician can disagree with it.
 */
export function suggestChords(
  tonic: number,
  scaleId: string,
  previous?: { root: number; quality: string },
): ChordSuggestion[] {
  const minor = scaleId.includes('minor') || scaleId === 'aeolian' || scaleId === 'dorian';
  const degrees = minor ? MINOR_DEGREES : MAJOR_DEGREES;
  const degreeOf = (root: number) =>
    degrees.find((d) => (tonic + d.semitone) % 12 === ((root % 12) + 12) % 12);
  const prevDegree = previous ? degreeOf(previous.root) : undefined;

  const out: ChordSuggestion[] = degrees.map((d) => {
    const root = (tonic + d.semitone) % 12;
    let strength = 0.5;
    let reason = d.role;
    if (prevDegree) {
      // Strong root motion: down a fifth, up a step, down a third.
      const interval = (((root - previous!.root) % 12) + 12) % 12;
      if (interval === 5) {
        strength = 0.95;
        reason = 'Falls a fifth — the strongest move in tonal music';
      } else if (interval === 2) {
        strength = 0.8;
        reason = 'Steps up — keeps the phrase moving';
      } else if (interval === 9) {
        strength = 0.78;
        reason = 'Down a third — the same notes, a new colour';
      } else if (interval === 7) {
        strength = 0.7;
        reason = 'Up a fifth — opens the phrase out';
      } else if (interval === 0) {
        strength = 0.2;
        reason = 'Stays put';
      }
      // Exactly the tonic: "II", "III" and "IV" also start with an I, and
      // treating them as the tonic made every degree claim to be a cadence.
      const isTonic = d.numeral === 'I' || d.numeral === 'i';
      if ((prevDegree.numeral === 'V' || prevDegree.numeral === 'v') && isTonic) {
        strength = 1;
        reason = 'Resolves the dominant — the cadence the ear is waiting for';
      }
    }
    return {
      root,
      quality: d.quality,
      numeral: d.numeral,
      reason,
      strength,
      label: chordLabelOf(root, d.quality),
    };
  });

  // Two ways out of the key, always offered last: the secondary dominant of the
  // next chord, and a borrowed flat-VI.
  if (previous) {
    const secondary = (previous.root + 7) % 12;
    out.push({
      root: secondary,
      quality: '7',
      numeral: 'V/x',
      reason: 'Secondary dominant — borrows the pull of another key for one bar',
      strength: 0.72,
      label: chordLabelOf(secondary, '7'),
    });
  }
  const borrowed = (tonic + 8) % 12;
  out.push({
    root: borrowed,
    quality: 'maj',
    numeral: minor ? 'VI' : '♭VI',
    reason: minor ? 'Wide and open' : 'Borrowed from the parallel minor — an instant lift',
    strength: 0.6,
    label: chordLabelOf(borrowed, 'maj'),
  });

  return out.sort((a, b) => b.strength - a.strength);
}

export interface ProgressionPreset {
  id: string;
  name: string;
  blurb: string;
  /** scale degrees as [semitoneFromTonic, quality] */
  chords: { semitone: number; quality: string }[];
  /** beats each chord lasts */
  beatsPerChord: number;
  minor?: boolean;
}

export const PROGRESSIONS: readonly ProgressionPreset[] = [
  {
    id: 'pop',
    name: 'I – V – vi – IV',
    blurb: 'The one that is in half the charts, for a reason.',
    beatsPerChord: 4,
    chords: [
      { semitone: 0, quality: 'maj' },
      { semitone: 7, quality: 'maj' },
      { semitone: 9, quality: 'min' },
      { semitone: 5, quality: 'maj' },
    ],
  },
  {
    id: 'canon',
    name: 'I – V – vi – iii – IV – I – IV – V',
    blurb: 'Pachelbel. Descending bass, endless loop.',
    beatsPerChord: 2,
    chords: [
      { semitone: 0, quality: 'maj' },
      { semitone: 7, quality: 'maj' },
      { semitone: 9, quality: 'min' },
      { semitone: 4, quality: 'min' },
      { semitone: 5, quality: 'maj' },
      { semitone: 0, quality: 'maj' },
      { semitone: 5, quality: 'maj' },
      { semitone: 7, quality: 'maj' },
    ],
  },
  {
    id: 'twofive',
    name: 'ii7 – V7 – Imaj7',
    blurb: 'The jazz cadence. Repeat it round the circle of fifths.',
    beatsPerChord: 4,
    chords: [
      { semitone: 2, quality: 'min7' },
      { semitone: 7, quality: '7' },
      { semitone: 0, quality: 'maj7' },
    ],
  },
  {
    id: 'blues',
    name: '12-bar blues',
    blurb: 'I – IV – I – V – IV – I, four beats to the bar.',
    beatsPerChord: 4,
    chords: [
      { semitone: 0, quality: '7' },
      { semitone: 0, quality: '7' },
      { semitone: 0, quality: '7' },
      { semitone: 0, quality: '7' },
      { semitone: 5, quality: '7' },
      { semitone: 5, quality: '7' },
      { semitone: 0, quality: '7' },
      { semitone: 0, quality: '7' },
      { semitone: 7, quality: '7' },
      { semitone: 5, quality: '7' },
      { semitone: 0, quality: '7' },
      { semitone: 7, quality: '7' },
    ],
  },
  {
    id: 'andalusian',
    name: 'i – VII – VI – V',
    blurb: 'The descending minor line. Flamenco, and half of rock.',
    beatsPerChord: 4,
    minor: true,
    chords: [
      { semitone: 0, quality: 'min' },
      { semitone: 10, quality: 'maj' },
      { semitone: 8, quality: 'maj' },
      { semitone: 7, quality: 'maj' },
    ],
  },
  {
    id: 'doowop',
    name: 'I – vi – IV – V',
    blurb: 'Fifties changes. Sits under any melody.',
    beatsPerChord: 4,
    chords: [
      { semitone: 0, quality: 'maj' },
      { semitone: 9, quality: 'min' },
      { semitone: 5, quality: 'maj' },
      { semitone: 7, quality: 'maj' },
    ],
  },
];

/** Lay a preset out from `startBeat` as chord-track events. */
export function progressionToChords(
  preset: ProgressionPreset,
  tonic: number,
  startBeat: number,
): Omit<ChordEvent, 'id'>[] {
  return preset.chords.map((c, i) => ({
    beat: startBeat + i * preset.beatsPerChord,
    root: (tonic + c.semitone) % 12,
    quality: c.quality,
  }));
}

// ---------------------------------------------------------- follow chords

export type FollowMode = 'nearest' | 'bass' | 'chordTone' | 'scale';

/**
 * Move notes onto the chord sounding at their position.
 *
 * Rhythm is never touched — that is what separates "follow the chords" from
 * "replace my part". `nearest` moves each note to the closest chord tone,
 * `bass` puts everything on the root, `chordTone` preserves the note's role in
 * the previous chord, and `scale` only corrects notes outside the key.
 */
export function followChords(
  notes: Note[],
  chords: ChordEvent[],
  mode: FollowMode,
  opts: { originBeat?: number; tonic?: number; scaleId?: string } = {},
): Note[] {
  if (chords.length === 0) return notes;
  const origin = opts.originBeat ?? 0;
  const chordAtBeat = (beat: number): ChordEvent | null => {
    let found: ChordEvent | null = null;
    for (const c of chords) {
      if (c.beat <= beat + 1e-9) found = c;
      else break;
    }
    return found;
  };

  return notes.map((n) => {
    const chord = chordAtBeat(origin + n.start);
    if (!chord) return n;
    const tones = buildChord(chord.root, chord.quality).map((p) => ((p % 12) + 12) % 12);
    const pc = ((Math.round(n.pitch) % 12) + 12) % 12;

    if (mode === 'scale') {
      const scale = scaleById(opts.scaleId ?? 'major') ?? SCALES[0];
      const tonic = opts.tonic ?? chord.root;
      const degrees = scale.steps.map((d) => (tonic + d) % 12);
      if (degrees.includes(pc)) return n;
    } else if (mode === 'chordTone' && tones.includes(pc)) {
      return n;
    }

    const target =
      mode === 'bass'
        ? chord.root
        : tones.reduce((bestPc, candidate) => {
            const d = (x: number) => Math.min((x - pc + 12) % 12, (pc - x + 12) % 12);
            return d(candidate) < d(bestPc) ? candidate : bestPc;
          }, tones[0]);

    // Move by the shortest signed distance so the melodic contour survives.
    let delta = (target - pc + 12) % 12;
    if (delta > 6) delta -= 12;
    return { ...n, pitch: Math.max(0, Math.min(127, Math.round(n.pitch) + delta)) };
  });
}

/** The chord quality's display name, for a label beside a suggestion. */
export function qualityLabel(id: string): string {
  return chordQuality(id)?.label ?? id;
}
