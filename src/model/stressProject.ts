/**
 * Layout stress fixture. Deliberately exceeds every viewport budget so scrolling,
 * clipping and overlap defects become measurable:
 *   - 24 tracks (vertical scroll) incl. collapsed + very long names
 *   - 72 bars of clips (horizontal scroll)
 *   - 24 mixer strips + 2 buses + master (mixer horizontal scroll)
 *   - one dense MIDI clip for the piano roll
 * Loaded via the `#/qa` route; never auto-saved over a real project.
 */
import { newId } from './ids';
import { getPreset, DRUM_KIT_PARAMS } from './presets';
import { SCHEMA_VERSION, TRACK_COLORS } from './types';
import type { Clip, Note, ProjectData, Track } from './types';

export const STRESS_PROJECT_ID = 'qa-layout-stress';

const LONG_NAME = 'Extremely Long Track Name That Must Truncate Cleanly Instead Of Breaking Layout';

interface Spec {
  name: string;
  type: Track['type'];
  collapsed?: boolean;
}

const SPECS: Spec[] = [
  { name: 'Kick', type: 'drum' },
  { name: LONG_NAME, type: 'instrument' },
  { name: 'Snare', type: 'drum' },
  { name: 'Hats', type: 'drum' },
  { name: 'Sub Bass', type: 'instrument' },
  { name: 'Bass DI', type: 'audio' },
  { name: 'Rhodes', type: 'instrument', collapsed: true },
  { name: 'Wurli', type: 'instrument' },
  { name: 'Pad', type: 'instrument' },
  { name: 'Strings Hi', type: 'instrument' },
  { name: 'Strings Lo', type: 'instrument', collapsed: true },
  { name: 'Lead', type: 'instrument' },
  { name: 'Arp', type: 'instrument' },
  { name: 'Pluck', type: 'instrument' },
  { name: 'Gtr L', type: 'audio' },
  { name: 'Gtr R', type: 'audio' },
  { name: 'Perc 1', type: 'audio' },
  { name: 'Perc 2', type: 'audio' },
  { name: 'Texture A', type: 'audio' },
  { name: 'Texture B', type: 'audio', collapsed: true },
  { name: 'FX Riser', type: 'audio' },
  { name: 'Vox Chop', type: 'audio' },
  { name: 'Noise', type: 'audio' },
  { name: 'X', type: 'instrument' }, // deliberately very short name
];

function densePianoNotes(bars: number): Note[] {
  const notes: Note[] = [];
  const scale = [0, 2, 3, 5, 7, 8, 10];
  for (let b = 0; b < bars; b++) {
    for (let s = 0; s < 16; s++) {
      // dense but musical: two voices per 16th grid position on alternating steps
      if (s % 2 === 0) {
        const deg = scale[(b * 3 + s) % scale.length];
        notes.push({
          id: newId('n'),
          start: b * 4 + s * 0.25,
          length: 0.25,
          pitch: 48 + deg + 12 * ((s / 2) % 3),
          velocity: 60 + ((s * 7 + b * 11) % 60),
        });
      }
      if (s % 4 === 1) {
        notes.push({
          id: newId('n'),
          start: b * 4 + s * 0.25,
          length: 0.5,
          pitch: 72 + scale[(s + b) % scale.length],
          velocity: 70 + ((b * 13) % 50),
        });
      }
    }
  }
  return notes;
}

export function createStressProject(): ProjectData {
  const now = Date.now();
  const tracks: Track[] = [];
  const clips: Clip[] = [];

  const busA: Track = {
    id: newId('t'),
    type: 'bus',
    name: 'Drum Bus',
    color: '#b8873a',
    volume: 1,
    pan: 0,
    mute: false,
    solo: false,
    armed: false,
    collapsed: false,
    output: 'master',
  };
  const busB: Track = {
    id: newId('t'),
    type: 'bus',
    name: 'Instrument Bus With A Long Name',
    color: '#6f7fa8',
    volume: 0.95,
    pan: 0,
    mute: false,
    solo: false,
    armed: false,
    collapsed: false,
    output: 'master',
  };

  SPECS.forEach((spec, i) => {
    const isDrum = spec.type === 'drum';
    const track: Track = {
      id: newId('t'),
      type: spec.type,
      name: spec.name,
      color: TRACK_COLORS[i % TRACK_COLORS.length],
      volume: 0.5 + ((i * 7) % 60) / 100,
      pan: ((i % 5) - 2) / 2.5,
      mute: i === 5,
      solo: false,
      armed: i === 1,
      collapsed: spec.collapsed ?? false,
      output: isDrum ? busA.id : spec.type === 'instrument' ? busB.id : 'master',
      ...(spec.type === 'instrument'
        ? { synth: getPreset(i % 2 ? 'Warm Keys' : 'Bright Pluck') }
        : {}),
      ...(isDrum ? { synth: { ...DRUM_KIT_PARAMS } } : {}),
    };
    tracks.push(track);

    // Spread clips across 72 bars (288 beats) so the timeline must scroll far.
    const clipCount = 4 + (i % 4);
    for (let c = 0; c < clipCount; c++) {
      const start = c * 68 + (i % 5) * 3;
      const length = 12 + (i % 3) * 6;
      if (track.type === 'audio') {
        clips.push({
          id: newId('c'),
          trackId: track.id,
          type: 'audio',
          name: `${spec.name} ${c + 1}`,
          start,
          length,
          muted: c === 2 && i === 3,
          mediaId: i % 2 ? 'perc-110-2bar' : 'texture-110-4bar',
          offset: 0,
          gain: 1,
        });
      } else {
        const notes: Note[] = [];
        for (let n = 0; n < 24; n++) {
          notes.push({
            id: newId('n'),
            start: (n * length) / 24,
            length: 0.5,
            pitch: (isDrum ? 36 : 48) + ((n * 5 + i) % (isDrum ? 11 : 24)),
            velocity: 70 + ((n * 9) % 55),
          });
        }
        clips.push({
          id: newId('c'),
          trackId: track.id,
          type: 'midi',
          name: `${spec.name} ${c + 1}`,
          start,
          length,
          muted: false,
          notes,
        });
      }
    }
  });

  // One dense piano-roll clip on the second (long-named) instrument track.
  const denseTrack = tracks.find((t) => t.type === 'instrument')!;
  clips.push({
    id: newId('c'),
    trackId: denseTrack.id,
    type: 'midi',
    name: 'Dense Piano Roll Fixture',
    start: 0,
    length: 32,
    muted: false,
    notes: densePianoNotes(8),
  });

  tracks.push(busA, busB);

  return {
    schemaVersion: SCHEMA_VERSION,
    id: STRESS_PROJECT_ID,
    name: 'QA Layout Stress Fixture',
    createdAt: now,
    modifiedAt: now,
    bpm: 120,
    timeSig: { num: 4, den: 4 },
    loop: { enabled: true, start: 0, end: 32 },
    metronome: false,
    masterVolume: 0.9,
    tracks,
    clips,
    workspace: { pxPerBeat: 22, snap: 0.25 },
  };
}
