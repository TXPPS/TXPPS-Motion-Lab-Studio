/**
 * Extreme-scale QA fixture: 100 tracks, 1000+ clips.
 *
 * This is deliberately past any sensible musical project. Its job is to prove
 * the arrangement, mixer and selection machinery stay responsive at a scale
 * users should never reach — so that at the scale they do reach, there is
 * headroom. Loaded via `#/qa-huge`; never autosaved.
 */
import { newId } from './ids';
import { getPreset, DRUM_KIT_PARAMS, SYNTH_PRESETS } from './presets';
import { SCHEMA_VERSION, TRACK_COLORS } from './types';
import type { Clip, Note, ProjectData, Track } from './types';

export const HUGE_PROJECT_ID = 'qa-huge-scale';

export function createHugeProject(): ProjectData {
  const now = Date.now();
  const tracks: Track[] = [];
  const clips: Clip[] = [];

  // Two buses at the end, as in a real session.
  const busA: Track = {
    id: newId('t'),
    type: 'bus',
    name: 'Bus A',
    color: '#b8873a',
    volume: 1,
    pan: 0,
    mute: false,
    solo: false,
    armed: false,
    collapsed: false,
    output: 'master',
  };
  const busB: Track = { ...busA, id: newId('t'), name: 'Bus B', color: '#6f8bb8' };

  // 98 content tracks: audio and instrument alternating, some collapsed.
  for (let i = 0; i < 98; i++) {
    const isAudio = i % 2 === 0;
    tracks.push({
      id: newId('t'),
      type: isAudio ? 'audio' : i % 10 === 5 ? 'drum' : 'instrument',
      name: `${isAudio ? 'Audio' : 'Inst'} ${String(i + 1).padStart(2, '0')}`,
      color: TRACK_COLORS[i % TRACK_COLORS.length],
      volume: 0.7 + (i % 5) * 0.05,
      pan: ((i % 9) - 4) / 8,
      mute: false,
      solo: false,
      armed: false,
      collapsed: i % 7 === 3,
      output: i % 11 === 0 ? busA.id : 'master',
      ...(isAudio ? {} : { synth: i % 10 === 5 ? { ...DRUM_KIT_PARAMS } : getPreset(SYNTH_PRESETS[i % SYNTH_PRESETS.length].presetName) }),
    });
  }
  tracks.push(busA, busB);

  // ~1030 clips over 128 bars. Audio tracks reuse the two procedural loops;
  // instrument tracks get small MIDI cells so note rendering is exercised too.
  const notesFor = (seed: number): Note[] => {
    const out: Note[] = [];
    for (let n = 0; n < 6; n++) {
      out.push({
        id: newId('n'),
        pitch: 48 + ((seed + n * 3) % 24),
        start: n * 0.66,
        length: 0.5,
        velocity: 70 + ((seed * 7 + n * 11) % 50),
      });
    }
    return out;
  };

  let count = 0;
  // ~11 clips on every one of the 98 tracks (≈1078 total): the cap is per
  // track, not global, so the timeline is populated to its full depth — a
  // global cap would leave the lower two-thirds of the project empty and
  // quietly exempt it from the test.
  for (let ti = 0; ti < 98; ti++) {
    const t = tracks[ti];
    let onTrack = 0;
    for (let bar = ti % 4; bar * 4 < 512 && onTrack < 11; bar += 12, onTrack++) {
      const start = bar * 4;
      if (t.type === 'audio') {
        clips.push({
          id: newId('c'),
          trackId: t.id,
          type: 'audio',
          name: `A${count}`,
          start,
          length: 8,
          muted: count % 29 === 0,
          mediaId: count % 3 === 0 ? 'texture-110-4bar' : 'perc-110-2bar',
          offset: (count % 4) * 0.4,
          sourceDuration: count % 3 === 0 ? 6 : 3.5,
          gain: 0.7 + (count % 6) * 0.1,
          fadeIn: count % 5 === 0 ? 0.3 : 0,
          fadeOut: count % 7 === 0 ? 0.5 : 0,
        });
      } else {
        clips.push({
          id: newId('c'),
          trackId: t.id,
          type: 'midi',
          name: `M${count}`,
          start,
          length: 4,
          muted: false,
          notes: notesFor(count),
        });
      }
      count++;
    }
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    id: HUGE_PROJECT_ID,
    name: 'QA — 100 tracks / 1000 clips',
    bpm: 110,
    timeSig: { num: 4, den: 4 },
    masterVolume: 0.8,
    loop: { enabled: false, start: 0, end: 32 },
    metronome: false,
    createdAt: now,
    modifiedAt: now,
    workspace: { pxPerBeat: 10, snap: 1 },
    tracks,
    clips,
    media: [],
  };
}
