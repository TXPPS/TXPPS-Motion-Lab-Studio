/**
 * Absolute-maximum stress fixture (`#/qa-max`): 500 tracks, 50,000 clips,
 * 20,000+ MIDI notes, 1,000 automation lanes.
 *
 * This is far past any musical session — its only job is to expose failure
 * modes (memory, render stalls, edit latency) before a beta user finds them,
 * and to give the performance docs honest measured numbers at the extreme.
 * Loaded via `#/qa-max`; never autosaved.
 */
import { newId } from './ids';
import { getPreset, SYNTH_PRESETS } from './presets';
import { SCHEMA_VERSION, TRACK_COLORS } from './types';
import type { Clip, MidiClip, Note, ProjectData, Track } from './types';
import type { AutomationPoint } from './automation';

export const MAX_PROJECT_ID = 'qa-max-scale';
export const MAX_TRACKS = 500;
export const MAX_CLIPS = 50_000;
export const MAX_LANES = 1_000;
/** 40 MIDI clips × 500+ notes. */
export const MAX_NOTES = 20_000;

export function createMaxProject(): ProjectData {
  const now = Date.now();
  const tracks: Track[] = [];
  const clips: Clip[] = [];

  const wave = (i: number, n: number): AutomationPoint[] => {
    const pts: AutomationPoint[] = [];
    for (let k = 0; k < n; k++) {
      pts.push({
        id: newId('ap'),
        beat: k * 51.2,
        value: 0.5 + 0.4 * Math.sin(i + k * 1.3),
        curve: 'linear',
      });
    }
    return pts;
  };

  // 500 tracks: mostly audio (cheap clips), a band of instruments for notes.
  for (let i = 0; i < MAX_TRACKS; i++) {
    const isInstrument = i < 40;
    const t: Track = {
      id: newId('t'),
      type: isInstrument ? 'instrument' : 'audio',
      name: `${isInstrument ? 'Inst' : 'Audio'} ${String(i + 1).padStart(3, '0')}`,
      color: TRACK_COLORS[i % TRACK_COLORS.length],
      volume: 0.7,
      pan: 0,
      mute: false,
      solo: false,
      armed: false,
      // Collapsed rows keep the initial viewport honest but scrollable depth real.
      collapsed: i >= 24,
      output: 'master',
      ...(isInstrument
        ? { synth: getPreset(SYNTH_PRESETS[i % SYNTH_PRESETS.length].presetName) }
        : {}),
    };
    // 1000 lanes: two per track on the first 500 tracks.
    if (i < MAX_LANES / 2) {
      t.automation = [
        { id: newId('al'), paramId: 'volume', enabled: true, points: wave(i, 10) },
        { id: newId('al'), paramId: 'pan', enabled: true, points: wave(i * 2, 10) },
      ];
    }
    tracks.push(t);
  }

  // 20,000 notes in 40 dense MIDI clips on the instrument band.
  for (let i = 0; i < 40; i++) {
    const notes: Note[] = [];
    for (let n = 0; n < MAX_NOTES / 40; n++) {
      notes.push({
        id: newId('n'),
        start: (n % 125) * 0.25,
        length: 0.25,
        pitch: 36 + ((i * 7 + n) % 48),
        velocity: 60 + ((i + n) % 60),
      });
    }
    const clip: MidiClip = {
      id: newId('c'),
      trackId: tracks[i].id,
      type: 'midi',
      name: `Dense ${i + 1}`,
      start: (i % 8) * 32,
      length: 32,
      muted: false,
      notes,
    };
    clips.push(clip);
  }

  // Fill to exactly 50,000 clips with audio loops across 2048 beats.
  const loops = ['perc-110-2bar', 'texture-110-4bar'];
  let c = clips.length;
  outer: for (let lap = 0; ; lap++) {
    for (let i = 40; i < MAX_TRACKS; i++) {
      if (c >= MAX_CLIPS) break outer;
      const start = ((lap * 16) % 2048) + (i % 16);
      clips.push({
        id: newId('c'),
        trackId: tracks[i].id,
        type: 'audio',
        name: `Loop ${c}`,
        start,
        length: lap % 3 === 0 ? 16 : 8,
        muted: false,
        mediaId: loops[(i + lap) % 2],
        offset: 0,
        gain: 1,
        fadeIn: 0,
        fadeOut: 0,
      } as Clip);
      c++;
    }
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    id: MAX_PROJECT_ID,
    name: 'QA — Max Scale (500 tracks / 50k clips)',
    bpm: 110,
    timeSig: { num: 4, den: 4 },
    masterVolume: 0.8,
    loop: { enabled: false, start: 0, end: 32 },
    metronome: false,
    createdAt: now,
    modifiedAt: now,
    workspace: { pxPerBeat: 6, snap: 1 },
    tracks,
    clips,
    media: [],
  };
}
