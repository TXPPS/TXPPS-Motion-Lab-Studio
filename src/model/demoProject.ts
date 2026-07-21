import { newId } from './ids';
import { getPreset, DRUM_KIT_PARAMS } from './presets';
import { SCHEMA_VERSION } from './types';
import type { MidiClip, AudioClip, Note, ProjectData, Track } from './types';

export const DEMO_BPM = 110;

/** Kick 36, Snare 38, Clap 39, Closed hat 42, Open hat 46 */
const KICK = 36;
const SNARE = 38;
const CLAP = 39;
const CHAT = 42;
const OHAT = 46;

function note(pitch: number, start: number, length: number, velocity: number): Note {
  return { id: newId('n'), pitch, start, length, velocity };
}

/** One bar of the drum groove, offset by `bar` (bars are 4 beats). */
function drumBar(bar: number, opts: { clap?: boolean; openHat?: boolean; fill?: boolean }): Note[] {
  const b = bar * 4;
  const out: Note[] = [];
  out.push(note(KICK, b + 0, 0.3, 118));
  out.push(note(KICK, b + 1.75, 0.25, 96));
  out.push(note(KICK, b + 2.5, 0.3, 110));
  out.push(note(SNARE, b + 1, 0.3, 112));
  if (!opts.fill) {
    out.push(note(SNARE, b + 3, 0.3, 108));
  } else {
    out.push(note(SNARE, b + 3, 0.2, 74));
    out.push(note(SNARE, b + 3.25, 0.2, 88));
    out.push(note(SNARE, b + 3.5, 0.2, 102));
    out.push(note(SNARE, b + 3.75, 0.2, 118));
  }
  if (opts.clap) out.push(note(CLAP, b + 3, 0.3, 96));
  for (let i = 0; i < 8; i++) {
    const t = i * 0.5;
    if (opts.openHat && t === 3.5) continue;
    out.push(note(CHAT, b + t, 0.12, i % 2 === 0 ? 92 : 58));
  }
  if (opts.openHat) out.push(note(OHAT, b + 3.5, 0.4, 86));
  return out;
}

function drumClipNotes(withFill: boolean): Note[] {
  return [
    ...drumBar(0, {}),
    ...drumBar(1, { openHat: true }),
    ...drumBar(2, {}),
    ...drumBar(3, { clap: true, openHat: true, fill: withFill }),
  ];
}

/** Bass bar for a root pitch. */
function bassBar(bar: number, root: number): Note[] {
  const b = bar * 4;
  return [
    note(root, b + 0, 0.75, 105),
    note(root, b + 1, 0.45, 78),
    note(root + 12, b + 1.5, 0.4, 92),
    note(root, b + 2, 0.75, 100),
    note(root, b + 3, 0.45, 80),
    note(root + 7, b + 3.5, 0.45, 88),
  ];
}

/** Chord voicing per bar: sustained pad + off-beat push. */
function keysBar(bar: number, pitches: number[]): Note[] {
  const b = bar * 4;
  const out: Note[] = [];
  for (const p of pitches) out.push(note(p, b + 0, 2.4, 82));
  for (const p of pitches) out.push(note(p, b + 2.5, 1.4, 66));
  return out;
}

const AM = [57, 60, 64];
const F = [53, 57, 60];
const C = [55, 60, 64];
const G = [55, 59, 62];

function leadNotes(): Note[] {
  return [
    // bar 1 of clip
    note(69, 0, 0.5, 96),
    note(72, 0.5, 0.5, 88),
    note(76, 1, 1, 102),
    note(74, 2.5, 0.5, 84),
    note(72, 3, 1, 90),
    // bar 2
    note(76, 4, 0.5, 94),
    note(74, 4.5, 0.5, 84),
    note(72, 5, 1, 92),
    note(69, 6.5, 0.5, 80),
    note(72, 7, 1, 88),
    // bar 3 (repeat of 1)
    note(69, 8, 0.5, 96),
    note(72, 8.5, 0.5, 88),
    note(76, 9, 1, 102),
    note(74, 10.5, 0.5, 84),
    note(72, 11, 1, 90),
    // bar 4 (resolve)
    note(69, 12, 0.75, 96),
    note(67, 13, 0.75, 86),
    note(64, 14, 1.75, 92),
  ];
}

export function createDemoProject(id?: string): ProjectData {
  const drums: Track = {
    id: newId('t'),
    type: 'drum',
    name: 'Drums',
    color: '#d9a13c',
    volume: 1.0,
    pan: 0,
    mute: false,
    solo: false,
    armed: false,
    collapsed: false,
    output: '',
    synth: { ...DRUM_KIT_PARAMS },
  };
  const perc: Track = {
    id: newId('t'),
    type: 'audio',
    name: 'Perc Loop',
    color: '#d97455',
    volume: 0.7,
    pan: 0.25,
    mute: false,
    solo: false,
    armed: false,
    collapsed: false,
    output: '',
  };
  const bass: Track = {
    id: newId('t'),
    type: 'instrument',
    name: 'Bass',
    color: '#4a90c4',
    volume: 0.9,
    pan: 0,
    mute: false,
    solo: false,
    armed: false,
    collapsed: false,
    output: 'master',
    synth: getPreset('Deep Saw Bass'),
  };
  const keys: Track = {
    id: newId('t'),
    type: 'instrument',
    name: 'Keys',
    color: '#37b89a',
    volume: 0.8,
    pan: -0.15,
    mute: false,
    solo: false,
    armed: false,
    collapsed: false,
    output: 'master',
    synth: getPreset('Warm Keys'),
  };
  const lead: Track = {
    id: newId('t'),
    type: 'instrument',
    name: 'Lead',
    color: '#9070c9',
    volume: 0.75,
    pan: 0.2,
    mute: false,
    solo: false,
    armed: false,
    collapsed: false,
    output: 'master',
    synth: getPreset('Sine Lead'),
  };
  const texture: Track = {
    id: newId('t'),
    type: 'audio',
    name: 'Texture',
    color: '#7f93a8',
    volume: 0.55,
    pan: -0.3,
    mute: false,
    solo: false,
    armed: false,
    collapsed: false,
    output: 'master',
  };
  const drumBus: Track = {
    id: newId('t'),
    type: 'bus',
    name: 'Drum Bus',
    color: '#b8873a',
    volume: 1.0,
    pan: 0,
    mute: false,
    solo: false,
    armed: false,
    collapsed: false,
    output: 'master',
  };
  drums.output = drumBus.id;
  perc.output = drumBus.id;

  const clips: (MidiClip | AudioClip)[] = [];

  clips.push({
    id: newId('c'),
    trackId: drums.id,
    type: 'midi',
    name: 'Drums A',
    start: 0,
    length: 16,
    muted: false,
    notes: drumClipNotes(false),
  });
  clips.push({
    id: newId('c'),
    trackId: drums.id,
    type: 'midi',
    name: 'Drums B',
    start: 16,
    length: 16,
    muted: false,
    notes: drumClipNotes(true),
  });

  for (let i = 0; i < 4; i++) {
    clips.push({
      id: newId('c'),
      trackId: perc.id,
      type: 'audio',
      name: 'Perc 2-bar',
      start: i * 8,
      length: 8,
      muted: false,
      mediaId: 'perc-110-2bar',
      offset: 0,
      gain: 1,
    });
  }

  clips.push({
    id: newId('c'),
    trackId: bass.id,
    type: 'midi',
    name: 'Bass A',
    start: 0,
    length: 16,
    muted: false,
    notes: [...bassBar(0, 33), ...bassBar(1, 29), ...bassBar(2, 36), ...bassBar(3, 31)],
  });
  clips.push({
    id: newId('c'),
    trackId: bass.id,
    type: 'midi',
    name: 'Bass B',
    start: 16,
    length: 16,
    muted: false,
    notes: [...bassBar(0, 33), ...bassBar(1, 29), ...bassBar(2, 36), ...bassBar(3, 31)],
  });

  clips.push({
    id: newId('c'),
    trackId: keys.id,
    type: 'midi',
    name: 'Keys — Am F C G',
    start: 0,
    length: 32,
    muted: false,
    notes: [
      ...keysBar(0, AM),
      ...keysBar(1, F),
      ...keysBar(2, C),
      ...keysBar(3, G),
      ...keysBar(4, AM),
      ...keysBar(5, F),
      ...keysBar(6, C),
      ...keysBar(7, G),
    ],
  });

  clips.push({
    id: newId('c'),
    trackId: lead.id,
    type: 'midi',
    name: 'Lead Motif',
    start: 16,
    length: 16,
    muted: false,
    notes: leadNotes(),
  });

  for (let i = 0; i < 2; i++) {
    clips.push({
      id: newId('c'),
      trackId: texture.id,
      type: 'audio',
      name: 'Texture Pad',
      start: i * 16,
      length: 16,
      muted: false,
      mediaId: 'texture-110-4bar',
      offset: 0,
      gain: 1,
    });
  }

  const now = Date.now();
  return {
    schemaVersion: SCHEMA_VERSION,
    id: id ?? newId('p'),
    name: 'MotionLab Demo',
    createdAt: now,
    modifiedAt: now,
    bpm: DEMO_BPM,
    timeSig: { num: 4, den: 4 },
    loop: { enabled: true, start: 0, end: 32 },
    metronome: false,
    masterVolume: 0.9,
    tracks: [drums, perc, bass, keys, lead, texture, drumBus],
    clips,
    workspace: { pxPerBeat: 26, snap: 0.25 },
  };
}

export function createEmptyProject(name: string): ProjectData {
  const now = Date.now();
  const inst: Track = {
    id: newId('t'),
    type: 'instrument',
    name: 'Synth 1',
    color: '#37b89a',
    volume: 0.85,
    pan: 0,
    mute: false,
    solo: false,
    armed: true,
    collapsed: false,
    output: 'master',
    synth: getPreset('Warm Keys'),
  };
  return {
    schemaVersion: SCHEMA_VERSION,
    id: newId('p'),
    name,
    createdAt: now,
    modifiedAt: now,
    bpm: 120,
    timeSig: { num: 4, den: 4 },
    loop: { enabled: false, start: 0, end: 16 },
    metronome: false,
    masterVolume: 0.9,
    tracks: [inst],
    clips: [],
    workspace: { pxPerBeat: 26, snap: 0.25 },
  };
}
