/**
 * Dense MIDI fixture: 11k+ notes across three writing styles.
 *
 * - "Orchestral": one long clip of sustained stacked chords, ~6k notes — the
 *   piano-roll windowing test opens this one.
 * - "Drums": a 128-bar sixteenth-note groove, ~3k notes.
 * - "Synth": fast arpeggio runs, ~2k notes.
 *
 * Deterministic (no Math.random), so tests can assert exact counts. Loaded via
 * `#/qa-midi`; never autosaved.
 */
import { newId } from './ids';
import { getPreset, DRUM_KIT_PARAMS } from './presets';
import { SCHEMA_VERSION } from './types';
import type { MidiClip, Note, ProjectData, Track } from './types';

export const HUGE_MIDI_PROJECT_ID = 'qa-midi-dense';

function track(patch: Partial<Track> & Pick<Track, 'name' | 'type'>): Track {
  return {
    id: newId('t'),
    color: '#9070c9',
    volume: 0.7,
    pan: 0,
    mute: false,
    solo: false,
    armed: false,
    collapsed: false,
    output: 'master',
    ...patch,
  };
}

export function createHugeMidiProject(): ProjectData {
  const now = Date.now();
  const orch = track({ name: 'Orchestral Stack', type: 'instrument', synth: getPreset('Warm Keys') });
  const drums = track({ name: 'Dense Drums', type: 'drum', color: '#d9a13c', synth: { ...DRUM_KIT_PARAMS } });
  const synth = track({ name: 'Arp Runs', type: 'instrument', color: '#37b89a', synth: getPreset('Sine Lead') });

  // Orchestral: 256 beats; every half-beat a 12-voice chord stack → 512 × 12 ≈ 6144.
  const orchNotes: Note[] = [];
  const chordTones = [0, 3, 7, 10, 14, 17];
  for (let step = 0; step < 512; step++) {
    const t = step * 0.5;
    const root = 36 + ((step * 5) % 24);
    for (const [i, iv] of chordTones.entries()) {
      orchNotes.push({
        id: newId('n'),
        start: t,
        length: 0.5,
        pitch: Math.min(108, root + iv),
        velocity: 60 + ((step + i * 7) % 50),
      });
      orchNotes.push({
        id: newId('n'),
        start: t,
        length: 0.5,
        pitch: Math.min(108, root + iv + 24),
        velocity: 50 + ((step * 3 + i) % 40),
      });
    }
  }

  // Drums: 128 bars of sixteenths on hats + kick/snare pattern ≈ 128×24 = 3072.
  const drumNotes: Note[] = [];
  for (let bar = 0; bar < 128; bar++) {
    const b = bar * 4;
    for (let s = 0; s < 16; s++) {
      drumNotes.push({
        id: newId('n'),
        start: b + s * 0.25,
        length: 0.12,
        pitch: 42,
        velocity: s % 2 === 0 ? 90 : 55,
        ...(s % 7 === 3 ? { muted: true } : {}),
      });
    }
    for (const beat of [0, 2]) {
      drumNotes.push({ id: newId('n'), start: b + beat, length: 0.3, pitch: 36, velocity: 118 });
    }
    for (const beat of [1, 3]) {
      drumNotes.push({ id: newId('n'), start: b + beat, length: 0.3, pitch: 38, velocity: 108 });
      drumNotes.push({
        id: newId('n'),
        start: b + beat + 0.5,
        length: 0.2,
        pitch: 39,
        velocity: 66,
      });
    }
  }

  // Synth: 128 beats of sixteenth arpeggios ≈ 2048.
  const synthNotes: Note[] = [];
  const arp = [0, 4, 7, 12, 16, 12, 7, 4];
  for (let s = 0; s < 2048; s++) {
    synthNotes.push({
      id: newId('n'),
      start: s * 0.25,
      length: 0.22,
      pitch: 55 + arp[s % arp.length] + 12 * (Math.floor(s / 256) % 2),
      velocity: 70 + ((s * 11) % 45),
    });
  }

  const mkClip = (t: Track, name: string, notes: Note[], length: number): MidiClip => ({
    id: newId('c'),
    trackId: t.id,
    type: 'midi',
    name,
    start: 0,
    length,
    muted: false,
    notes,
  });

  return {
    schemaVersion: SCHEMA_VERSION,
    id: HUGE_MIDI_PROJECT_ID,
    name: 'QA — Dense MIDI (11k notes)',
    bpm: 120,
    timeSig: { num: 4, den: 4 },
    masterVolume: 0.8,
    loop: { enabled: false, start: 0, end: 32 },
    metronome: false,
    createdAt: now,
    modifiedAt: now,
    workspace: { pxPerBeat: 14, snap: 0.25 },
    tracks: [orch, drums, synth],
    clips: [
      mkClip(orch, 'Stack 6k', orchNotes, 256),
      mkClip(drums, 'Groove 3k', drumNotes, 512),
      mkClip(synth, 'Arp 2k', synthNotes, 512),
    ],
    media: [],
  };
}
