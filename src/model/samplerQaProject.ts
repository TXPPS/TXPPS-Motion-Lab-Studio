/**
 * Sampler QA fixtures (M7). Three routes, none autosaved:
 *
 * - `#/qa-sampler`     workstation showcase: quick sampler with slices and
 *                      smp: automation, a drum rack with a beat, a multisample
 *                      texture and a split synth+sampler instrument rack.
 * - `#/qa-drums`       scale: one rack with 100 assigned pads and a dense
 *                      trigger pattern.
 * - `#/qa-multisample` scale: 512 sample zones (32 key bands × 4 velocity
 *                      layers × 4 round-robins) plus a key-scan clip.
 *
 * Deterministic — no Math.random — so tests can assert exact counts. All
 * media is procedural (repository-safe).
 */
import { newId } from './ids';
import { getPreset } from './presets';
import {
  buildDrumKit,
  buildMultiSampler,
  buildQuickSampler,
  makePadZone,
  makeZone,
  DRUM_PAD_BASE,
  type SamplerParams,
  type SampleZone,
} from './sampler';
import { SCHEMA_VERSION, TRACK_COLORS } from './types';
import type { MidiClip, Note, ProjectData, Track } from './types';

export const SAMPLER_QA_PROJECT_ID = 'qa-sampler';
export const DRUMS_QA_PROJECT_ID = 'qa-drums';
export const MULTISAMPLE_QA_PROJECT_ID = 'qa-multisample';

/** 512 = 32 bands × 4 velocity layers × 4 round-robins. */
export const MULTISAMPLE_QA_ZONES = 512;
export const DRUMS_QA_PADS = 100;

const HIT_IDS = ['hit-kick', 'hit-snare', 'hit-clap', 'hit-hat', 'hit-openhat'];

function track(patch: Partial<Track> & Pick<Track, 'name' | 'type'>): Track {
  return {
    id: newId('t'),
    color: TRACK_COLORS[patch.name.length % TRACK_COLORS.length],
    volume: 0.8,
    pan: 0,
    mute: false,
    solo: false,
    armed: false,
    collapsed: false,
    output: 'master',
    ...patch,
  };
}

function midiClip(trackId: string, name: string, length: number, notes: Note[]): MidiClip {
  return { id: newId('c'), trackId, type: 'midi', name, start: 0, length, muted: false, notes };
}

function note(start: number, length: number, pitch: number, velocity: number): Note {
  return { id: newId('n'), start, length, pitch, velocity };
}

function scaffold(id: string, name: string, tracks: Track[], clips: MidiClip[]): ProjectData {
  const now = Date.now();
  return {
    schemaVersion: SCHEMA_VERSION,
    id,
    name,
    bpm: 110,
    timeSig: { num: 4, den: 4 },
    masterVolume: 0.8,
    loop: { enabled: true, start: 0, end: 8 },
    metronome: false,
    createdAt: now,
    modifiedAt: now,
    workspace: { pxPerBeat: 26, snap: 0.25 },
    tracks,
    clips,
    media: [],
  };
}

/** #/qa-sampler — every sampler workflow on one screen. */
export function createSamplerQaProject(): ProjectData {
  // 1. Quick sampler: trimmed + sliced perc loop, lowpass, cutoff automated.
  const quick = track({ name: 'Quick Slice', type: 'instrument', automationOpen: true });
  const qs = buildQuickSampler('perc-110-2bar', 'Perc Loop');
  const spb = 60 / 110; // the loop is rendered at 110 BPM
  qs.zones[0].startSec = 0;
  qs.zones[0].slices = Array.from({ length: 8 }, (_, i) => Math.round(i * spb * 1000) / 1000);
  qs.filterType = 'lowpass';
  qs.filterCutoff = 9000;
  quick.sampler = qs;
  quick.automation = [
    {
      id: newId('al'),
      paramId: 'smp:filterCutoff',
      enabled: true,
      height: 44,
      points: [
        { id: newId('ap'), beat: 0, value: 0.25, curve: 'linear' },
        { id: newId('ap'), beat: 4, value: 0.95, curve: 's' },
        { id: newId('ap'), beat: 8, value: 0.25, curve: 'exp' },
      ],
    },
  ];
  const quickClip = midiClip(
    quick.id,
    'Slice riff',
    8,
    [0, 1, 2, 3, 4, 5, 6, 7].map((b) => note(b, 0.5, 60 + [0, 3, 5, 7][b % 4], 96)),
  );

  // 2. Drum rack with the built-in kit and a straight beat.
  const drums = track({ name: 'Drum Rack', type: 'instrument' });
  drums.sampler = buildDrumKit();
  const beatNotes: Note[] = [];
  for (let b = 0; b < 8; b++) {
    if (b % 2 === 0) beatNotes.push(note(b, 0.25, DRUM_PAD_BASE + 0, 110)); // kick
    if (b % 4 === 2) beatNotes.push(note(b, 0.25, DRUM_PAD_BASE + 1, 100)); // snare
    beatNotes.push(note(b + 0.5, 0.25, DRUM_PAD_BASE + 3, 72)); // hat off-beats
    if (b === 7) beatNotes.push(note(b + 0.5, 0.25, DRUM_PAD_BASE + 4, 90)); // open hat
  }
  const drumClip = midiClip(drums.id, 'Beat', 8, beatNotes);

  // 3. Multisample texture pad.
  const multi = track({ name: 'Multisample', type: 'instrument' });
  multi.sampler = buildMultiSampler('texture-110-4bar', 'Texture');
  const chordClip = midiClip(multi.id, 'Chords', 8, [
    note(0, 4, 48, 84),
    note(0, 4, 55, 80),
    note(0, 4, 60, 78),
    note(4, 4, 53, 84),
    note(4, 4, 60, 80),
    note(4, 4, 65, 78),
  ]);

  // 4. Instrument rack: synth low half, quick sampler high half.
  const rack = track({ name: 'Layer Rack', type: 'instrument' });
  rack.rack = {
    items: [
      {
        id: newId('rk'),
        name: 'Low Synth',
        color: TRACK_COLORS[1],
        keyLo: 0,
        keyHi: 59,
        muted: false,
        solo: false,
        kind: 'synth',
        synth: getPreset('Warm Keys'),
      },
      {
        id: newId('rk'),
        name: 'High Texture',
        color: TRACK_COLORS[3],
        keyLo: 60,
        keyHi: 127,
        muted: false,
        solo: false,
        kind: 'sampler',
        sampler: buildQuickSampler('texture-110-4bar', 'Texture Hi'),
      },
    ],
  };
  const rackClip = midiClip(
    rack.id,
    'Split arp',
    8,
    [0, 1, 2, 3, 4, 5, 6, 7].map((b) => note(b, 0.75, b % 2 ? 67 + (b % 3) * 5 : 48 + b, 92)),
  );

  return scaffold(
    SAMPLER_QA_PROJECT_ID,
    'QA — Sampler Workstation',
    [quick, drums, multi, rack],
    [quickClip, drumClip, chordClip, rackClip],
  );
}

/** #/qa-drums — 100 assigned pads on one rack plus a dense trigger pattern. */
export function createDrumsQaProject(): ProjectData {
  const rack = track({ name: '100 Pads', type: 'instrument' });
  const params = buildDrumKit('100-Pad Rack');
  const zones: SampleZone[] = [];
  for (let i = 0; i < DRUMS_QA_PADS; i++) {
    const mediaId = HIT_IDS[i % HIT_IDS.length];
    const z = makePadZone(mediaId, i, `${mediaId.replace('hit-', '')} ${i + 1}`);
    z.tuneCoarse = (i % 25) - 12; // audible spread across the grid
    z.gain = 0.7 + (i % 5) * 0.06;
    if (mediaId === 'hit-hat' || mediaId === 'hit-openhat') z.chokeGroup = 1 + Math.floor(i / 20);
    zones.push(z);
  }
  params.zones = zones;
  rack.sampler = params;

  // 32 beats of 16ths walking the pad grid, two voices per step.
  const notes: Note[] = [];
  for (let s = 0; s < 128; s++) {
    const beat = s * 0.25;
    notes.push(note(beat, 0.2, DRUM_PAD_BASE + ((s * 7) % DRUMS_QA_PADS), 70 + (s % 50)));
    if (s % 2 === 0)
      notes.push(note(beat, 0.2, DRUM_PAD_BASE + ((s * 13 + 3) % DRUMS_QA_PADS), 96));
  }
  const clip = midiClip(rack.id, 'Pad walk', 32, notes);

  const kit = track({ name: 'Reference Kit', type: 'instrument', collapsed: true });
  kit.sampler = buildDrumKit();

  const p = scaffold(DRUMS_QA_PROJECT_ID, 'QA — Drum Rack (100 pads)', [rack, kit], [clip]);
  p.loop.end = 32;
  return p;
}

/** #/qa-multisample — 512 zones: 32 key bands × 4 velocity layers × 4 RRs. */
export function createMultisampleQaProject(): ProjectData {
  const mega = track({ name: 'Mega Multi (512 zones)', type: 'instrument' });
  const params: SamplerParams = {
    ...buildMultiSampler('texture-110-4bar', 'Mega'),
    zones: [],
  };
  const VELS: [number, number][] = [
    [1, 32],
    [33, 64],
    [65, 96],
    [97, 127],
  ];
  for (let band = 0; band < 32; band++) {
    const keyLo = band * 4;
    const keyHi = Math.min(127, band * 4 + 4); // 1-key overlap → crossfade joins
    for (let v = 0; v < 4; v++) {
      for (let rr = 0; rr < 4; rr++) {
        const z = makeZone({
          mediaId: band % 2 ? 'texture-110-4bar' : 'perc-110-2bar',
          name: `B${band + 1} V${v + 1} R${rr + 1}`,
          keyLo,
          keyHi,
          velLo: VELS[v][0],
          velHi: VELS[v][1],
          rootNote: keyLo + 2,
          rrGroup: band * 4 + v + 1,
          tuneFine: rr * 8 - 12,
          gain: 0.8,
        });
        params.zones.push(z);
      }
    }
  }
  params.presetName = 'Mega Multi';
  mega.sampler = params;

  // Key scan: 64 notes climbing the keyboard with a velocity ramp.
  const notes: Note[] = [];
  for (let i = 0; i < 64; i++) {
    notes.push(note(i * 0.5, 0.4, Math.min(127, i * 2), 20 + ((i * 13) % 107)));
  }
  const clip = midiClip(mega.id, 'Key scan', 32, notes);

  const octave = track({ name: 'Octave Multi', type: 'instrument', collapsed: true });
  octave.sampler = buildMultiSampler('texture-110-4bar', 'Texture');

  const p = scaffold(
    MULTISAMPLE_QA_PROJECT_ID,
    'QA — Multisample (512 zones)',
    [mega, octave],
    [clip],
  );
  p.loop.end = 32;
  return p;
}
