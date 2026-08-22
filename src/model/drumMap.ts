/**
 * Drum maps — the lane layout of a drum part.
 *
 * A drum part is addressed by instrument, not by pitch. The editor's rows are
 * kit slots with a name, a family and a colour, and the map is the only thing
 * that turns a MIDI note number into one; the editor names nothing itself, so
 * swapping the map re-labels every row without touching a note.
 *
 * Everything here is pure data and pure lookup. Nothing reads a store.
 */
import { midiToName } from './music';
import type { SamplerParams } from './sampler';
import type { Note } from './types';

/**
 * Kit families. This is the axis a drummer reads a grid by — where the
 * backbeat is, where the hats are — so it drives row order and row colour.
 */
export type DrumGroup = 'kick' | 'snare' | 'hats' | 'toms' | 'cymbals' | 'percussion';

export const DRUM_GROUPS: readonly DrumGroup[] = [
  'kick',
  'snare',
  'hats',
  'toms',
  'cymbals',
  'percussion',
];

export const GROUP_LABELS: Record<DrumGroup, string> = {
  kick: 'Kick',
  snare: 'Snare',
  hats: 'Hats',
  toms: 'Toms',
  cymbals: 'Cymbals',
  percussion: 'Percussion',
};

/**
 * Lane colour per family, as a reference to a theme token rather than a literal
 * — the map is data, but the palette still has to follow the active theme.
 * The tokens are defined in styles/drumeditor.css from the global scale.
 */
export const GROUP_COLOR: Record<DrumGroup, string> = {
  kick: 'var(--drum-kick)',
  snare: 'var(--drum-snare)',
  hats: 'var(--drum-hats)',
  toms: 'var(--drum-toms)',
  cymbals: 'var(--drum-cymbals)',
  percussion: 'var(--drum-perc)',
};

export interface DrumLane {
  /** MIDI note number this lane triggers. */
  pitch: number;
  name: string;
  group: DrumGroup;
  /** CSS colour: a theme token reference, or a pad's own colour. */
  color: string;
}

export interface DrumMap {
  id: string;
  name: string;
  /** Ordered top to bottom, as the editor draws them. */
  lanes: DrumLane[];
}

/** Which map an editor is showing. `pads` exists only for tracks that have some. */
export type DrumMapId = 'gm' | 'essential' | 'pads';

// ------------------------------------------------------------------ GM kit

/**
 * The General MIDI percussion key map: notes 35–81, all 47 of them.
 * Names are the GM names; the family is the drum-kit reading of each.
 * A hand clap sits with the snare because it plays the backbeat, not because
 * GM says so — the group exists to make the grid readable, not to mirror a spec.
 */
const GM_PERCUSSION: readonly (readonly [number, string, DrumGroup])[] = [
  [35, 'Acoustic Bass Drum', 'kick'],
  [36, 'Bass Drum 1', 'kick'],
  [37, 'Side Stick', 'snare'],
  [38, 'Acoustic Snare', 'snare'],
  [39, 'Hand Clap', 'snare'],
  [40, 'Electric Snare', 'snare'],
  [41, 'Low Floor Tom', 'toms'],
  [42, 'Closed Hi-Hat', 'hats'],
  [43, 'High Floor Tom', 'toms'],
  [44, 'Pedal Hi-Hat', 'hats'],
  [45, 'Low Tom', 'toms'],
  [46, 'Open Hi-Hat', 'hats'],
  [47, 'Low-Mid Tom', 'toms'],
  [48, 'Hi-Mid Tom', 'toms'],
  [49, 'Crash Cymbal 1', 'cymbals'],
  [50, 'High Tom', 'toms'],
  [51, 'Ride Cymbal 1', 'cymbals'],
  [52, 'Chinese Cymbal', 'cymbals'],
  [53, 'Ride Bell', 'cymbals'],
  [54, 'Tambourine', 'percussion'],
  [55, 'Splash Cymbal', 'cymbals'],
  [56, 'Cowbell', 'percussion'],
  [57, 'Crash Cymbal 2', 'cymbals'],
  [58, 'Vibraslap', 'percussion'],
  [59, 'Ride Cymbal 2', 'cymbals'],
  [60, 'Hi Bongo', 'percussion'],
  [61, 'Low Bongo', 'percussion'],
  [62, 'Mute Hi Conga', 'percussion'],
  [63, 'Open Hi Conga', 'percussion'],
  [64, 'Low Conga', 'percussion'],
  [65, 'High Timbale', 'percussion'],
  [66, 'Low Timbale', 'percussion'],
  [67, 'High Agogo', 'percussion'],
  [68, 'Low Agogo', 'percussion'],
  [69, 'Cabasa', 'percussion'],
  [70, 'Maracas', 'percussion'],
  [71, 'Short Whistle', 'percussion'],
  [72, 'Long Whistle', 'percussion'],
  [73, 'Short Guiro', 'percussion'],
  [74, 'Long Guiro', 'percussion'],
  [75, 'Claves', 'percussion'],
  [76, 'Hi Wood Block', 'percussion'],
  [77, 'Low Wood Block', 'percussion'],
  [78, 'Mute Cuica', 'percussion'],
  [79, 'Open Cuica', 'percussion'],
  [80, 'Mute Triangle', 'percussion'],
  [81, 'Open Triangle', 'percussion'],
];

const GROUP_RANK: Record<DrumGroup, number> = {
  kick: 0,
  snare: 1,
  hats: 2,
  toms: 3,
  cymbals: 4,
  percussion: 5,
};

function gmLane(entry: readonly [number, string, DrumGroup]): DrumLane {
  const [pitch, name, group] = entry;
  return { pitch, name, group, color: GROUP_COLOR[group] };
}

/**
 * Kit order, not pitch order: kick at the top, then the backbeat, hats, toms,
 * cymbals, hand percussion. GM's numbering interleaves toms and hats, and a
 * grid sorted that way is unreadable.
 */
function byKitOrder(a: DrumLane, b: DrumLane): number {
  return GROUP_RANK[a.group] - GROUP_RANK[b.group] || a.pitch - b.pitch;
}

export const GM_DRUM_MAP: DrumMap = {
  id: 'gm',
  name: 'General MIDI',
  lanes: GM_PERCUSSION.map(gmLane).sort(byKitOrder),
};

/**
 * The sixteen slots a kit part actually uses most of the time. Same names and
 * families as GM so a map swap never renames a row that exists in both.
 */
const ESSENTIAL_PITCHES = [36, 37, 38, 39, 42, 44, 46, 41, 45, 48, 49, 51, 53, 54, 56, 70];

export const ESSENTIAL_DRUM_MAP: DrumMap = {
  id: 'essential',
  name: 'Essential 16',
  lanes: GM_PERCUSSION.filter((e) => ESSENTIAL_PITCHES.includes(e[0]))
    .map(gmLane)
    .sort(byKitOrder),
};

export const BUILT_IN_DRUM_MAPS: Record<'gm' | 'essential', DrumMap> = {
  gm: GM_DRUM_MAP,
  essential: ESSENTIAL_DRUM_MAP,
};

// --------------------------------------------------------- derived from pads

/**
 * Family guessed from a pad's own name. Ordered: the first pattern that matches
 * wins, so "Ride Bell" lands in cymbals while "Cowbell" — which no rule claims —
 * falls through to percussion.
 */
const NAME_GROUPS: readonly (readonly [RegExp, DrumGroup])[] = [
  [/\b(kick|bass ?drum|bd)\b/i, 'kick'],
  [/(hi.?hat|\bhats?\b|\bhh\b)/i, 'hats'],
  [/(snare|rim|side ?stick|clap|\bsd\b)/i, 'snare'],
  [/tom/i, 'toms'],
  [/(crash|ride|china|splash|cymbal)/i, 'cymbals'],
];

export function groupForName(name: string): DrumGroup {
  for (const [re, group] of NAME_GROUPS) {
    if (re.test(name)) return group;
  }
  return 'percussion';
}

/**
 * A map derived from a track's own sampler pads.
 *
 * Only fixed-key, non-key-tracking zones are pads — a multisample zone spanning
 * a key range is one instrument across many notes, which is not a lane. Pads
 * stay in key order, because that order *is* the kit's own layout; only the
 * built-in maps get reordered by family.
 *
 * Returns null when the track has no pads, so a caller can hide the option
 * rather than offer an empty map.
 */
export function buildPadDrumMap(
  sampler: SamplerParams | undefined,
  name = 'Track pads',
): DrumMap | null {
  if (!sampler) return null;
  const seen = new Set<number>();
  const lanes: DrumLane[] = [];
  for (const z of sampler.zones) {
    if (z.keyTrack || z.keyLo !== z.keyHi || seen.has(z.keyLo)) continue;
    seen.add(z.keyLo);
    const group = groupForName(z.name);
    lanes.push({ pitch: z.keyLo, name: z.name, group, color: z.color ?? GROUP_COLOR[group] });
  }
  if (lanes.length === 0) return null;
  lanes.sort((a, b) => a.pitch - b.pitch);
  return { id: 'pads', name, lanes };
}

// -------------------------------------------------------------- lane lookup

/**
 * Pitch → lane index, cached per map object. Bucketing a clip walks every note
 * once and looks its lane up here, so a 64-bar part costs one hash probe per
 * note instead of a scan of 47 lanes.
 */
const laneIndexCache = new WeakMap<DrumMap, Map<number, DrumLane>>();

function laneIndex(map: DrumMap): Map<number, DrumLane> {
  let index = laneIndexCache.get(map);
  if (!index) {
    index = new Map(map.lanes.map((l) => [l.pitch, l]));
    laneIndexCache.set(map, index);
  }
  return index;
}

export function laneOf(map: DrumMap, pitch: number): DrumLane | undefined {
  return laneIndex(map).get(pitch);
}

export function pitchesInGroup(map: DrumMap, group: DrumGroup): number[] {
  return map.lanes.filter((l) => l.group === group).map((l) => l.pitch);
}

/**
 * A lane for a pitch the map does not name. Notes on unmapped pitches are real
 * and must stay reachable, so they get a row labelled by note name instead of
 * being silently dropped from the editor.
 */
function unmappedLane(pitch: number): DrumLane {
  return {
    pitch,
    name: midiToName(pitch),
    group: 'percussion',
    color: GROUP_COLOR.percussion,
  };
}

function unmappedPitches(map: DrumMap, notes: readonly Pick<Note, 'pitch'>[]): number[] {
  const index = laneIndex(map);
  const extra = new Set<number>();
  for (const n of notes) {
    if (!index.has(n.pitch)) extra.add(n.pitch);
  }
  return [...extra].sort((a, b) => a - b);
}

/**
 * The lanes a clip actually plays — map order for named lanes, then any
 * unmapped pitches ascending. This is what lets an editor drop 40 empty GM rows
 * without hiding a note.
 */
export function usedLanes(map: DrumMap, notes: readonly Pick<Note, 'pitch'>[]): DrumLane[] {
  const used = new Set<number>();
  for (const n of notes) used.add(n.pitch);
  const named = map.lanes.filter((l) => used.has(l.pitch));
  return [...named, ...unmappedPitches(map, notes).map(unmappedLane)];
}

/**
 * The rows to draw. `usedOnly` falls back to the whole map when the clip is
 * empty, because a grid with no rows offers nowhere to put the first hit.
 */
export function laneList(
  map: DrumMap,
  notes: readonly Pick<Note, 'pitch'>[],
  usedOnly: boolean,
): DrumLane[] {
  if (usedOnly) {
    const used = usedLanes(map, notes);
    if (used.length > 0) return used;
  }
  return [...map.lanes, ...unmappedPitches(map, notes).map(unmappedLane)];
}

/**
 * Notes bucketed by pitch in one pass, each bucket sorted by start.
 *
 * The editor never filters the whole note list per row: it buckets once per
 * change and each row reads its own array, which is also sorted so a windowed
 * draw can binary-search into the visible span.
 */
export function bucketNotesByPitch(notes: readonly Note[]): Map<number, Note[]> {
  const byPitch = new Map<number, Note[]>();
  for (const n of notes) {
    const bucket = byPitch.get(n.pitch);
    if (bucket) bucket.push(n);
    else byPitch.set(n.pitch, [n]);
  }
  for (const bucket of byPitch.values()) bucket.sort((a, b) => a.start - b.start);
  return byPitch;
}

/** Index of the first note at or after `beat` in a start-sorted bucket. */
export function firstIndexFrom(sorted: readonly Note[], beat: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid].start < beat) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
