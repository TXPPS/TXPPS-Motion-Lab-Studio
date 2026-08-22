/**
 * Standard MIDI File → project material.
 *
 * `buildImportPlan` is pure: it reads a parsed file and describes the tracks,
 * clips and notes an import would create, plus the tempo map the file implies.
 * Nothing here touches a store, an id generator or the clock, so the import
 * dialog can preview a plan, the user can change an option, and the same
 * function runs again — and so the whole conversion is unit-testable.
 *
 * The one judgement call this module makes is where clips begin and end. A
 * MIDI file is an undifferentiated stream of notes; a DAW arrangement is made
 * of clips. Splitting at long rests and snapping to bar lines reproduces what
 * an engineer would do by hand, and keeps an eight-minute file from arriving as
 * one unmovable block.
 */
import type { MidiFileData, MidiNoteEvent, MidiSigEvent, MidiTempoEvent } from './midiFile';
import {
  barBeats,
  barToBeat,
  beatToBar,
  beatsPerBarAt,
  normalizeTempoMap,
  type SigEvent,
  type TempoEvent,
  type TempoMap,
} from './tempo';
import type { Note, TimeSignature } from './types';

/** General MIDI program names, program 1 first. */
export const GM_PROGRAM_NAMES: readonly string[] = [
  'Acoustic Grand Piano',
  'Bright Acoustic Piano',
  'Electric Grand Piano',
  'Honky-tonk Piano',
  'Electric Piano 1',
  'Electric Piano 2',
  'Harpsichord',
  'Clavi',
  'Celesta',
  'Glockenspiel',
  'Music Box',
  'Vibraphone',
  'Marimba',
  'Xylophone',
  'Tubular Bells',
  'Dulcimer',
  'Drawbar Organ',
  'Percussive Organ',
  'Rock Organ',
  'Church Organ',
  'Reed Organ',
  'Accordion',
  'Harmonica',
  'Tango Accordion',
  'Acoustic Guitar (nylon)',
  'Acoustic Guitar (steel)',
  'Electric Guitar (jazz)',
  'Electric Guitar (clean)',
  'Electric Guitar (muted)',
  'Overdriven Guitar',
  'Distortion Guitar',
  'Guitar Harmonics',
  'Acoustic Bass',
  'Electric Bass (finger)',
  'Electric Bass (pick)',
  'Fretless Bass',
  'Slap Bass 1',
  'Slap Bass 2',
  'Synth Bass 1',
  'Synth Bass 2',
  'Violin',
  'Viola',
  'Cello',
  'Contrabass',
  'Tremolo Strings',
  'Pizzicato Strings',
  'Orchestral Harp',
  'Timpani',
  'String Ensemble 1',
  'String Ensemble 2',
  'Synth Strings 1',
  'Synth Strings 2',
  'Choir Aahs',
  'Voice Oohs',
  'Synth Voice',
  'Orchestra Hit',
  'Trumpet',
  'Trombone',
  'Tuba',
  'Muted Trumpet',
  'French Horn',
  'Brass Section',
  'Synth Brass 1',
  'Synth Brass 2',
  'Soprano Sax',
  'Alto Sax',
  'Tenor Sax',
  'Baritone Sax',
  'Oboe',
  'English Horn',
  'Bassoon',
  'Clarinet',
  'Piccolo',
  'Flute',
  'Recorder',
  'Pan Flute',
  'Blown Bottle',
  'Shakuhachi',
  'Whistle',
  'Ocarina',
  'Lead 1 (square)',
  'Lead 2 (sawtooth)',
  'Lead 3 (calliope)',
  'Lead 4 (chiff)',
  'Lead 5 (charang)',
  'Lead 6 (voice)',
  'Lead 7 (fifths)',
  'Lead 8 (bass + lead)',
  'Pad 1 (new age)',
  'Pad 2 (warm)',
  'Pad 3 (polysynth)',
  'Pad 4 (choir)',
  'Pad 5 (bowed)',
  'Pad 6 (metallic)',
  'Pad 7 (halo)',
  'Pad 8 (sweep)',
  'FX 1 (rain)',
  'FX 2 (soundtrack)',
  'FX 3 (crystal)',
  'FX 4 (atmosphere)',
  'FX 5 (brightness)',
  'FX 6 (goblins)',
  'FX 7 (echoes)',
  'FX 8 (sci-fi)',
  'Sitar',
  'Banjo',
  'Shamisen',
  'Koto',
  'Kalimba',
  'Bag pipe',
  'Fiddle',
  'Shanai',
  'Tinkle Bell',
  'Agogo',
  'Steel Drums',
  'Woodblock',
  'Taiko Drum',
  'Melodic Tom',
  'Synth Drum',
  'Reverse Cymbal',
  'Guitar Fret Noise',
  'Breath Noise',
  'Seashore',
  'Bird Tweet',
  'Telephone Ring',
  'Helicopter',
  'Applause',
  'Gunshot',
];

/** Lowest note number the GM drum map names. */
export const GM_DRUM_LOW = 35;

/** General MIDI percussion key map, note 35 (Acoustic Bass Drum) first. */
export const GM_DRUM_NAMES: readonly string[] = [
  'Acoustic Bass Drum',
  'Bass Drum 1',
  'Side Stick',
  'Acoustic Snare',
  'Hand Clap',
  'Electric Snare',
  'Low Floor Tom',
  'Closed Hi-Hat',
  'High Floor Tom',
  'Pedal Hi-Hat',
  'Low Tom',
  'Open Hi-Hat',
  'Low-Mid Tom',
  'Hi-Mid Tom',
  'Crash Cymbal 1',
  'High Tom',
  'Ride Cymbal 1',
  'Chinese Cymbal',
  'Ride Bell',
  'Tambourine',
  'Splash Cymbal',
  'Cowbell',
  'Crash Cymbal 2',
  'Vibraslap',
  'Ride Cymbal 2',
  'Hi Bongo',
  'Low Bongo',
  'Mute Hi Conga',
  'Open Hi Conga',
  'Low Conga',
  'High Timbale',
  'Low Timbale',
  'High Agogo',
  'Low Agogo',
  'Cabasa',
  'Maracas',
  'Short Whistle',
  'Long Whistle',
  'Short Guiro',
  'Long Guiro',
  'Claves',
  'Hi Wood Block',
  'Low Wood Block',
  'Mute Cuica',
  'Open Cuica',
  'Mute Triangle',
  'Open Triangle',
];

export function gmProgramName(program: number): string {
  return GM_PROGRAM_NAMES[Math.round(program)] ?? 'Instrument';
}

/** Name of a GM drum key, or an empty string outside the standard kit. */
export function gmDrumName(pitch: number): string {
  return GM_DRUM_NAMES[Math.round(pitch) - GM_DRUM_LOW] ?? '';
}

/** GM drums live on MIDI channel 10, which is index 9. */
export const DRUM_CHANNEL = 9;

/**
 * Longest note the importer will place, in quarter beats (128 bars of 4/4).
 * Files written by notation software sometimes carry a note with no note-off;
 * the reader gives those a nominal length, but a pedal-held sample can still
 * run for the length of the piece and would stretch its clip over the song.
 */
export const MAX_NOTE_BEATS = 512;

export interface MidiImportOptions {
  /** adopt the file's tempo and signature map (default true) */
  importTempo?: boolean;
  /** absolute beat the file's beat 0 lands on (default 0) */
  startBeat?: number;
  /** collapse every MIDI track into one project track (default false) */
  mergeTracks?: boolean;
  /** keep only these MIDI channels (0-based); omitted or empty keeps all */
  channels?: number[];
  /** multiply every velocity (default 1) */
  velocityScale?: number;
  /** split clips at rests longer than this many bars (default 2) */
  restBars?: number;
}

export interface ImportClipPlan {
  name: string;
  /** absolute beat */
  start: number;
  /** beats */
  length: number;
  /** starts are relative to the clip, as MidiClip requires */
  notes: Note[];
}

export interface ImportTrackPlan {
  name: string;
  type: 'instrument' | 'drum';
  /** the channel most of this track's notes used */
  channel: number;
  /** first program change seen, when the file sent one */
  program?: number;
  programName?: string;
  clips: ImportClipPlan[];
}

export interface ImportPlan {
  tracks: ImportTrackPlan[];
  /** the file's map, offset to `startBeat`; only present when importTempo */
  tempoMap?: TempoMap;
  /** tempo and signature at the file's start, for callers that keep a flat bpm */
  bpm: number;
  timeSig: TimeSignature;
  /** absolute beat the material ends at */
  endBeat: number;
  noteCount: number;
  ppq: number;
  warnings: string[];
}

interface AbsNote {
  start: number;
  length: number;
  pitch: number;
  velocity: number;
  channel: number;
}

const EPS = 1e-6;

function clampVel(v: number): number {
  return Math.min(127, Math.max(1, Math.round(v)));
}

/**
 * Signature events keyed by bar, as TempoMap wants them.
 *
 * The file keys them by tick, so each event's bar index is the running count of
 * bars the *previous* signature filled — which is why this walks rather than
 * dividing.
 */
function sigEvents(sigs: MidiSigEvent[], ppq: number): SigEvent[] {
  const out: SigEvent[] = [];
  let bar = 0;
  let prevTick = 0;
  let prevBeats = 4;
  for (const s of sigs) {
    const num = s.num > 0 ? s.num : 4;
    const den = s.den > 0 ? s.den : 4;
    if (out.length > 0) {
      bar += Math.max(0, Math.round((s.tick - prevTick) / ppq / prevBeats));
    }
    out.push({ id: `imp-sig-${out.length}`, bar, num, den });
    prevTick = s.tick;
    prevBeats = barBeats(num, den);
  }
  return out;
}

function tempoEvents(tempos: MidiTempoEvent[], ppq: number): TempoEvent[] {
  return tempos.map((t, i) => ({
    id: `imp-tempo-${i}`,
    beat: Math.max(0, t.tick / ppq),
    bpm: t.bpm,
    curve: 'jump' as const,
  }));
}

/** Notes → clips, split where the music rests for longer than `restBars`. */
function splitClips(
  notes: AbsNote[],
  map: TempoMap,
  restBars: number,
  trackName: string,
): ImportClipPlan[] {
  const sorted = [...notes].sort((a, b) => a.start - b.start || a.pitch - b.pitch);
  const groups: AbsNote[][] = [];
  let current: AbsNote[] = [];
  let reach = 0;
  for (const n of sorted) {
    const restBeats = restBars * beatsPerBarAt(map, reach);
    if (current.length > 0 && n.start - reach > restBeats + EPS) {
      groups.push(current);
      current = [];
    }
    current.push(n);
    reach = current.length === 1 ? n.start + n.length : Math.max(reach, n.start + n.length);
  }
  if (current.length > 0) groups.push(current);

  return groups.map((group, i) => {
    const first = group.reduce((m, n) => Math.min(m, n.start), Infinity);
    const last = group.reduce((m, n) => Math.max(m, n.start + n.length), 0);
    // Clips begin on the bar line before their first note and end on the bar
    // line after their last, so imported material lines up with the ruler.
    const start = barToBeat(map, Math.floor(beatToBar(map, first) + EPS));
    const endBar = Math.ceil(beatToBar(map, last) - EPS);
    const end = Math.max(barToBeat(map, endBar), start + beatsPerBarAt(map, start));
    return {
      name: groups.length > 1 ? `${trackName} ${i + 1}` : trackName,
      start,
      length: end - start,
      notes: group.map((n, k) => ({
        id: `imp-${i}-${k}-${Math.round(n.start * 960)}-${n.pitch}`,
        start: n.start - start,
        length: n.length,
        pitch: n.pitch,
        velocity: n.velocity,
      })),
    };
  });
}

function trackName(
  raw: string,
  isDrums: boolean,
  program: number | undefined,
  index: number,
): string {
  const named = raw.trim();
  if (named) return named;
  if (isDrums) return 'Drums';
  if (program !== undefined) return gmProgramName(program);
  return `Track ${index + 1}`;
}

/**
 * Describe the import of a parsed MIDI file. Never throws: a file with nothing
 * usable in it yields an empty plan and a warning.
 */
export function buildImportPlan(data: MidiFileData, opts: MidiImportOptions = {}): ImportPlan {
  const ppq = data.ppq > 0 ? data.ppq : 480;
  const startBeat = Math.max(0, opts.startBeat ?? 0);
  const restBars = Math.max(0.25, opts.restBars ?? 2);
  const velocityScale = Math.max(0, opts.velocityScale ?? 1);
  const channelFilter = opts.channels?.length ? new Set(opts.channels.map(Math.round)) : undefined;
  const warnings = [...data.warnings];

  const rawTempos = data.tempos.length ? data.tempos : [{ tick: 0, bpm: 120 }];
  const rawSigs = data.sigs.length ? data.sigs : [{ tick: 0, num: 4, den: 4 }];
  const bpm = rawTempos[0].bpm;
  const timeSig: TimeSignature = { num: rawSigs[0].num, den: rawSigs[0].den };

  // The map is built at the file's own time base first, because clip placement
  // needs bar lines before it can know where anything goes.
  const fileMap = normalizeTempoMap(
    { tempos: tempoEvents(rawTempos, ppq), sigs: sigEvents(rawSigs, ppq) },
    bpm,
    timeSig,
  );

  let map = fileMap;
  if (startBeat > 0) {
    const barsIn = startBeat / barBeats(fileMap.sigs[0].num, fileMap.sigs[0].den);
    const shiftBars = Math.round(barsIn);
    if (Math.abs(barsIn - shiftBars) > EPS) {
      warnings.push('Import offset is not a whole bar; imported signature changes may shift.');
    }
    map = normalizeTempoMap(
      {
        tempos: fileMap.tempos.map((t) => ({ ...t, beat: t.beat + startBeat })),
        sigs: fileMap.sigs.map((s) => (s.bar === 0 ? s : { ...s, bar: s.bar + shiftBars })),
      },
      bpm,
      timeSig,
    );
  }

  let clamped = 0;
  let negative = 0;
  const convert = (notes: MidiNoteEvent[]): AbsNote[] => {
    const out: AbsNote[] = [];
    for (const n of notes) {
      if (channelFilter && !channelFilter.has(n.channel)) continue;
      let start = n.tick / ppq;
      let length = Math.max(1 / 960, n.durTicks / ppq);
      if (start < 0) {
        // A pickup written before the file's origin is played from the origin
        // rather than dropped; the alternative is silently losing the anacrusis.
        length = Math.max(1 / 960, length + start);
        start = 0;
        negative++;
      }
      if (length > MAX_NOTE_BEATS) {
        length = MAX_NOTE_BEATS;
        clamped++;
      }
      out.push({
        start: start + startBeat,
        length,
        pitch: Math.min(127, Math.max(0, Math.round(n.pitch))),
        velocity: clampVel(n.velocity * velocityScale),
        channel: n.channel,
      });
    }
    return out;
  };

  interface Source {
    notes: AbsNote[];
    name: string;
    program?: number;
  }
  const sources: Source[] = [];
  if (opts.mergeTracks) {
    const notes: AbsNote[] = [];
    let name = '';
    let program: number | undefined;
    for (const t of data.tracks) {
      notes.push(...convert(t.notes));
      if (!name && t.name.trim() && t.notes.length > 0) name = t.name.trim();
      if (program === undefined && t.programs.length > 0) program = t.programs[0];
    }
    if (notes.length > 0) sources.push({ notes, name, program });
  } else {
    data.tracks.forEach((t, i) => {
      const notes = convert(t.notes);
      // Conductor tracks (and any other track that ends up empty after the
      // channel filter) carry no material and would only add dead lanes.
      if (notes.length === 0) return;
      sources.push({
        notes,
        name: trackName(t.name, t.isDrums, t.programs[0], i),
        program: t.programs[0],
      });
    });
  }

  if (negative > 0)
    warnings.push(`${negative} note(s) started before the song start and were moved.`);
  if (clamped > 0) warnings.push(`${clamped} very long note(s) were shortened.`);
  if (sources.length === 0) warnings.push('No notes found in this file.');

  const tracks: ImportTrackPlan[] = sources.map((s, i) => {
    const counts = new Map<number, number>();
    for (const n of s.notes) counts.set(n.channel, (counts.get(n.channel) ?? 0) + 1);
    const channel = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
    const isDrums = s.notes.every((n) => n.channel === DRUM_CHANNEL);
    const name = s.name || trackName('', isDrums, s.program, i);
    return {
      name,
      type: isDrums ? 'drum' : 'instrument',
      channel,
      ...(s.program !== undefined
        ? { program: s.program, programName: gmProgramName(s.program) }
        : {}),
      clips: splitClips(s.notes, map, restBars, name),
    };
  });

  const endBeat = tracks.reduce(
    (m, t) => t.clips.reduce((n, c) => Math.max(n, c.start + c.length), m),
    startBeat,
  );

  return {
    tracks,
    ...(opts.importTempo === false ? {} : { tempoMap: map }),
    bpm,
    timeSig,
    endBeat,
    noteCount: tracks.reduce((m, t) => m + t.clips.reduce((n, c) => n + c.notes.length, 0), 0),
    ppq,
    warnings,
  };
}
