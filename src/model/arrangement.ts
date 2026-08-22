/**
 * Global-track model: markers, arranger sections and the chord track.
 *
 * These three live on the project rather than on a track, because they
 * describe the *song* rather than any one instrument. All three are stored as
 * sorted, non-overlapping event lists and every mutation goes through the
 * normalisers here, so a hand-edited or corrupted project still loads.
 */

export interface Marker {
  id: string;
  /** absolute beat */
  beat: number;
  name: string;
  /** hex; falls back to the marker palette when absent */
  color?: string;
}

/**
 * One arranger section — "Verse 1", "Chorus". Sections tile the timeline:
 * they never overlap, and reordering them moves every event inside them.
 */
export interface ArrangerSection {
  id: string;
  /** absolute beat */
  start: number;
  /** beats; always > 0 */
  length: number;
  name: string;
  color: string;
}

/** Chord-track event. Root is a pitch class 0-11; `bass` is a slash-chord bass. */
export interface ChordEvent {
  id: string;
  beat: number;
  root: number;
  /** quality id from model/chords.ts */
  quality: string;
  /** optional pitch class for a slash bass (C/E) */
  bass?: number;
}

export const MARKER_COLORS = ['#d9a13c', '#4a90c4', '#37b89a', '#c96f9b', '#9070c9', '#d97455'];

export const SECTION_COLORS: Record<string, string> = {
  intro: '#4a90c4',
  verse: '#37b89a',
  prechorus: '#9070c9',
  chorus: '#d9a13c',
  bridge: '#c96f9b',
  solo: '#d97455',
  breakdown: '#7f93a8',
  outro: '#6aa84f',
};

/** Guess a section colour from its name so a typed name is instantly readable. */
export function sectionColorFor(name: string, fallback: string): string {
  const key = name.toLowerCase().replace(/[^a-z]/g, '');
  for (const [k, v] of Object.entries(SECTION_COLORS)) {
    if (key.startsWith(k)) return v;
  }
  return fallback;
}

const finite = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback;

export function normalizeMarkers(raw: unknown): Marker[] {
  if (!Array.isArray(raw)) return [];
  const out: Marker[] = [];
  const seen = new Set<string>();
  for (const m of raw) {
    if (!m || typeof m !== 'object') continue;
    const r = m as Partial<Marker>;
    const id = typeof r.id === 'string' && r.id && !seen.has(r.id) ? r.id : `mk-${out.length}`;
    seen.add(id);
    out.push({
      id,
      beat: Math.max(0, finite(r.beat, 0)),
      name:
        typeof r.name === 'string' && r.name.trim()
          ? r.name.slice(0, 80)
          : `Marker ${out.length + 1}`,
      ...(typeof r.color === 'string' ? { color: r.color } : {}),
    });
  }
  return out.sort((a, b) => a.beat - b.beat);
}

/**
 * Sections are sorted and de-overlapped: a section that would start inside its
 * predecessor is pushed to the predecessor's end, and zero/negative lengths
 * are dropped. The result always tiles forward in time.
 */
export function normalizeSections(raw: unknown): ArrangerSection[] {
  if (!Array.isArray(raw)) return [];
  const items: ArrangerSection[] = [];
  const seen = new Set<string>();
  for (const s of raw) {
    if (!s || typeof s !== 'object') continue;
    const r = s as Partial<ArrangerSection>;
    const length = finite(r.length, 0);
    if (length <= 0) continue;
    const id = typeof r.id === 'string' && r.id && !seen.has(r.id) ? r.id : `sec-${items.length}`;
    seen.add(id);
    const name =
      typeof r.name === 'string' && r.name.trim()
        ? r.name.slice(0, 60)
        : `Section ${items.length + 1}`;
    items.push({
      id,
      start: Math.max(0, finite(r.start, 0)),
      length,
      name,
      color:
        typeof r.color === 'string' && /^#[0-9a-f]{3,8}$/i.test(r.color)
          ? r.color
          : sectionColorFor(name, SECTION_COLORS.verse),
    });
  }
  items.sort((a, b) => a.start - b.start);
  const out: ArrangerSection[] = [];
  let cursor = 0;
  for (const s of items) {
    const start = Math.max(s.start, cursor);
    out.push({ ...s, start });
    cursor = start + s.length;
  }
  return out;
}

export function normalizeChords(raw: unknown): ChordEvent[] {
  if (!Array.isArray(raw)) return [];
  const out: ChordEvent[] = [];
  const seen = new Set<string>();
  for (const c of raw) {
    if (!c || typeof c !== 'object') continue;
    const r = c as Partial<ChordEvent>;
    const id = typeof r.id === 'string' && r.id && !seen.has(r.id) ? r.id : `ch-${out.length}`;
    seen.add(id);
    const root = ((Math.round(finite(r.root, 0)) % 12) + 12) % 12;
    out.push({
      id,
      beat: Math.max(0, finite(r.beat, 0)),
      root,
      quality: typeof r.quality === 'string' && r.quality ? r.quality : 'maj',
      ...(typeof r.bass === 'number' && Number.isFinite(r.bass)
        ? { bass: ((Math.round(r.bass) % 12) + 12) % 12 }
        : {}),
    });
  }
  // One chord per position: a later write at the same beat replaces the earlier.
  const byBeat = new Map<number, ChordEvent>();
  for (const c of out) byBeat.set(Math.round(c.beat * 1e6), c);
  return [...byBeat.values()].sort((a, b) => a.beat - b.beat);
}

/** The section containing `beat`, or null in a gap. */
export function sectionAt(sections: ArrangerSection[], beat: number): ArrangerSection | null {
  for (const s of sections) {
    if (beat >= s.start && beat < s.start + s.length) return s;
  }
  return null;
}

/** The chord sounding at `beat` (the last one at or before it). */
export function chordAt(chords: ChordEvent[], beat: number): ChordEvent | null {
  let found: ChordEvent | null = null;
  for (const c of chords) {
    if (c.beat <= beat + 1e-9) found = c;
    else break;
  }
  return found;
}

/** Chord spans with an explicit end, for rendering and for chord-following. */
export function chordSpans(
  chords: ChordEvent[],
  songEnd: number,
): { chord: ChordEvent; start: number; end: number }[] {
  return chords.map((c, i) => ({
    chord: c,
    start: c.beat,
    end: i + 1 < chords.length ? chords[i + 1].beat : Math.max(songEnd, c.beat + 4),
  }));
}

/** Next marker strictly after `beat`, for the "go to next marker" transport key. */
export function nextMarker(markers: Marker[], beat: number): Marker | null {
  for (const m of markers) if (m.beat > beat + 1e-6) return m;
  return null;
}

export function prevMarker(markers: Marker[], beat: number): Marker | null {
  let found: Marker | null = null;
  for (const m of markers) {
    if (m.beat < beat - 1e-6) found = m;
    else break;
  }
  return found;
}

/**
 * Move a section to a new index, returning the new section list with every
 * section re-tiled from the first one's start. Callers move the events inside
 * each section by the returned delta map.
 */
export function reorderSections(
  sections: ArrangerSection[],
  fromIndex: number,
  toIndex: number,
): { sections: ArrangerSection[]; deltas: Map<string, number> } {
  const list = [...sections];
  if (fromIndex < 0 || fromIndex >= list.length) return { sections, deltas: new Map() };
  const clampedTo = Math.min(list.length - 1, Math.max(0, toIndex));
  const [moved] = list.splice(fromIndex, 1);
  list.splice(clampedTo, 0, moved);
  const origin = sections.length ? sections[0].start : 0;
  const deltas = new Map<string, number>();
  let cursor = origin;
  const out = list.map((s) => {
    deltas.set(s.id, cursor - s.start);
    const next = { ...s, start: cursor };
    cursor += s.length;
    return next;
  });
  return { sections: out, deltas };
}
