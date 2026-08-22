/**
 * Project → Standard MIDI File material.
 *
 * `buildMidiExport` is pure: it turns a project into the track list and options
 * `buildMidiFile` writes, without touching the DOM, the clock or a download.
 * The caller serialises and saves. Splitting it this way means the exact bytes
 * another DAW will read can be asserted in a unit test, and that "export
 * selection" and "export the loop" are option flags rather than three separate
 * code paths.
 *
 * Positions are absolute song beats even when a range is exported, so material
 * re-imported into this or another session lands on the bar it came from.
 */
import type { MidiSigEvent, MidiTempoEvent, MidiWriteOptions, MidiWriteTrack } from './midiFile';
import { tempoMapOf } from './music';
import { DRUM_CHANNEL } from './midiImport';
import { barToBeat, bpmAt, TICKS_PER_BEAT, type TempoMap } from './tempo';
import type { MidiClip, ProjectData, Track } from './types';

/** Channels a melodic track may be assigned, in order. Channel 10 is GM drums. */
export const MELODIC_CHANNELS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15];

/**
 * Beats between the tempo events written across a ramp. A Standard MIDI File
 * has no ramp: a gradual accelerando only survives as a staircase, and a beat
 * is fine enough that no listener hears the steps.
 */
const RAMP_STEP_BEATS = 1;

/** Cap on the events one ramp may expand into, so a long ramp cannot bloat the file. */
const MAX_RAMP_STEPS = 256;

export interface MidiExportRange {
  /** absolute beats */
  start: number;
  end: number;
}

export interface MidiExportOptions {
  /** ticks per quarter note (default 960) */
  ppq?: number;
  /** export only these clips; absent or empty exports every clip */
  clipIds?: string[];
  /** export only these tracks; absent or empty exports every MIDI track */
  trackIds?: string[];
  /** export only material overlapping this beat range */
  range?: MidiExportRange;
  /** include muted tracks, clips and notes (default false) */
  includeMuted?: boolean;
  /** one file per track rather than one multi-track file (default false) */
  perTrack?: boolean;
  /** song title; defaults to the project name */
  name?: string;
}

export interface MidiExportFile {
  /** file-name stem, without an extension */
  name: string;
  tracks: MidiWriteTrack[];
  options: MidiWriteOptions;
}

export interface MidiExportPlan {
  files: MidiExportFile[];
  noteCount: number;
  warnings: string[];
}

const EPS = 1e-6;

function safeName(raw: string, fallback: string): string {
  const cleaned = raw.replace(/[\\/:*?"<>|]+/g, '-').trim();
  return cleaned || fallback;
}

/** Conductor tempo events, with ramps expanded into steps. */
function tempoEvents(map: TempoMap, ppq: number): MidiTempoEvent[] {
  const out: MidiTempoEvent[] = [];
  map.tempos.forEach((ev, i) => {
    out.push({ tick: Math.round(ev.beat * ppq), bpm: ev.bpm });
    const next = map.tempos[i + 1];
    if (ev.curve !== 'ramp' || !next || next.beat <= ev.beat) return;
    const steps = Math.min(MAX_RAMP_STEPS, Math.floor((next.beat - ev.beat) / RAMP_STEP_BEATS));
    for (let s = 1; s < steps; s++) {
      const beat = ev.beat + s * RAMP_STEP_BEATS;
      out.push({ tick: Math.round(beat * ppq), bpm: bpmAt(map, beat) });
    }
  });
  return out;
}

function sigEvents(map: TempoMap, ppq: number): MidiSigEvent[] {
  return map.sigs.map((s) => ({
    tick: Math.round(barToBeat(map, s.bar) * ppq),
    num: s.num,
    den: s.den,
  }));
}

/** MIDI channel per exported track: drums on 10, the rest round-robin. */
function assignChannels(tracks: Track[]): Map<string, number> {
  const out = new Map<string, number>();
  let next = 0;
  for (const t of tracks) {
    if (t.type === 'drum') {
      out.set(t.id, DRUM_CHANNEL);
      continue;
    }
    out.set(t.id, MELODIC_CHANNELS[next % MELODIC_CHANNELS.length]);
    next++;
  }
  return out;
}

/**
 * Build the tracks and options for a MIDI export. Never throws; a project with
 * nothing to export yields a plan with no files and a warning.
 */
export function buildMidiExport(
  project: ProjectData,
  opts: MidiExportOptions = {},
): MidiExportPlan {
  const ppq = Math.max(24, Math.round(opts.ppq ?? TICKS_PER_BEAT));
  const map = tempoMapOf(project);
  const includeMuted = opts.includeMuted === true;
  const clipIds = opts.clipIds?.length ? new Set(opts.clipIds) : undefined;
  const trackIds = opts.trackIds?.length ? new Set(opts.trackIds) : undefined;
  const range = opts.range;
  const warnings: string[] = [];

  const candidates = project.tracks.filter(
    (t) =>
      (t.type === 'instrument' || t.type === 'drum') &&
      (!trackIds || trackIds.has(t.id)) &&
      (includeMuted || !t.mute),
  );
  const channels = assignChannels(candidates);

  const written: { track: Track; write: MidiWriteTrack }[] = [];
  let noteCount = 0;
  let dropped = 0;

  for (const track of candidates) {
    const notes: MidiWriteTrack['notes'] = [];
    for (const clip of project.clips) {
      if (clip.trackId !== track.id || clip.type !== 'midi') continue;
      if (clipIds && !clipIds.has(clip.id)) continue;
      if (clip.muted && !includeMuted) continue;
      const midi = clip as MidiClip;
      for (const n of midi.notes) {
        if (n.muted && !includeMuted) continue;
        // Mirror the scheduler: a note past the clip end is not heard, and one
        // that runs over the end is cut there.
        if (n.start >= midi.length - EPS) {
          dropped++;
          continue;
        }
        const start = clip.start + n.start;
        let length = Math.min(n.length, midi.length - n.start);
        if (range) {
          // Only notes that *start* inside the range are exported. Keeping a
          // note that merely sounds into it would put material before the
          // range's own start, and moving its note-on to the boundary would
          // export a performance nobody played.
          if (start < range.start - EPS || start >= range.end - EPS) continue;
          length = Math.min(length, range.end - start);
        }
        if (length <= 0) continue;
        notes.push({
          tick: Math.round(start * ppq),
          durTicks: Math.max(1, Math.round(length * ppq)),
          pitch: n.pitch,
          velocity: n.velocity,
        });
      }
    }
    if (notes.length === 0) continue;
    notes.sort((a, b) => a.tick - b.tick || a.pitch - b.pitch);
    noteCount += notes.length;
    written.push({
      track,
      write: {
        name: safeName(track.name, 'Track'),
        channel: channels.get(track.id) ?? 0,
        notes,
      },
    });
  }

  if (dropped > 0)
    warnings.push(`${dropped} note(s) lay past the end of their clip and were skipped.`);
  if (written.length === 0) warnings.push('Nothing to export: no unmuted MIDI notes in range.');

  const songName = safeName(opts.name ?? project.name, 'Song');
  const options: MidiWriteOptions = {
    ppq,
    tempos: tempoEvents(map, ppq),
    sigs: sigEvents(map, ppq),
    name: songName,
  };

  const files: MidiExportFile[] = opts.perTrack
    ? written.map((w) => ({
        name: `${songName} - ${w.write.name}`,
        tracks: [w.write],
        // Each file carries the whole song's tempo map: a stem opened on its
        // own must still sit at the right tempo and signature.
        options: { ...options, name: w.write.name },
      }))
    : written.length > 0
      ? [{ name: songName, tracks: written.map((w) => w.write), options }]
      : [];

  return { files, noteCount, warnings };
}
