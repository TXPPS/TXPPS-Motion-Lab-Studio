/**
 * Song templates.
 *
 * A blank timeline is the worst thing to hand someone who wants to record. A
 * template is a starting session: the tracks a job needs, routed, colour-coded
 * and armed where that is obvious, with a tempo and a time signature that suit
 * the material.
 *
 * Templates are pure data plus a builder — they never touch the store or the
 * audio engine, so they can be unit-tested and listed without side effects.
 */
import { newId } from './ids';
import { createEmptyProject } from './demoProject';
import { defaultParams } from './effects';
import { getPreset } from './presets';
import {
  TRACK_COLORS,
  type EffectKind,
  type ProjectData,
  type Track,
  type TrackType,
} from './types';

export interface TemplateTrack {
  name: string;
  type: TrackType;
  color?: string;
  /** name of a synth preset from model/presets */
  preset?: string;
  /** route into the named template track (matched by name) instead of master */
  output?: string;
  armed?: boolean;
  inserts?: EffectKind[];
  /** send into the named template track at this level */
  sendTo?: { name: string; amount: number };
  folder?: string;
}

export interface Template {
  id: string;
  name: string;
  blurb: string;
  /** one line of what you get, shown under the name */
  summary: string;
  icon: string;
  color: string;
  bpm: number;
  timeSig: { num: number; den: number };
  tracks: TemplateTrack[];
}

export const TEMPLATES: readonly Template[] = [
  {
    id: 'empty',
    name: 'Empty session',
    blurb: 'One audio track and a master. Build it your way.',
    summary: '1 track',
    icon: 'plus',
    color: '#7f93a8',
    bpm: 120,
    timeSig: { num: 4, den: 4 },
    tracks: [{ name: 'Audio 1', type: 'audio', armed: true }],
  },
  {
    id: 'songwriter',
    name: 'Songwriter',
    blurb: 'Voice and guitar, a click, and a reverb to sing into.',
    summary: '4 tracks · vocal chain · plate',
    icon: 'mic',
    color: '#d9a13c',
    bpm: 96,
    timeSig: { num: 4, den: 4 },
    tracks: [
      { name: 'Reverb', type: 'fx', color: '#9070c9', inserts: ['reverb'] },
      {
        name: 'Vocal',
        type: 'audio',
        color: '#d9a13c',
        armed: true,
        inserts: ['eq8', 'compressor', 'deesser'],
        sendTo: { name: 'Reverb', amount: 0.28 },
      },
      {
        name: 'Acoustic',
        type: 'audio',
        color: '#6aa84f',
        inserts: ['eq8', 'compressor'],
        sendTo: { name: 'Reverb', amount: 0.18 },
      },
      { name: 'Scratch Keys', type: 'instrument', color: '#4a90c4', preset: 'Warm Keys' },
    ],
  },
  {
    id: 'band',
    name: 'Band recording',
    blurb: 'Drum kit in a folder on its own bus, bass, two guitars and a vocal.',
    summary: '11 tracks · drum bus · folder',
    icon: 'drum',
    color: '#d97455',
    bpm: 128,
    timeSig: { num: 4, den: 4 },
    tracks: [
      { name: 'Drum Bus', type: 'bus', color: '#d97455', inserts: ['eq8', 'compressor'] },
      { name: 'Room Verb', type: 'fx', color: '#9070c9', inserts: ['reverb'] },
      { name: 'Drums', type: 'folder', color: '#d97455' },
      {
        name: 'Kick',
        type: 'audio',
        color: '#d97455',
        output: 'Drum Bus',
        folder: 'Drums',
        armed: true,
        inserts: ['eq8', 'gate'],
      },
      {
        name: 'Snare',
        type: 'audio',
        color: '#d97455',
        output: 'Drum Bus',
        folder: 'Drums',
        armed: true,
        inserts: ['eq8', 'compressor'],
      },
      {
        name: 'Overheads',
        type: 'audio',
        color: '#d97455',
        output: 'Drum Bus',
        folder: 'Drums',
        armed: true,
      },
      { name: 'Room', type: 'audio', color: '#d97455', output: 'Drum Bus', folder: 'Drums' },
      {
        name: 'Bass DI',
        type: 'audio',
        color: '#4a90c4',
        armed: true,
        inserts: ['compressor', 'eq8'],
      },
      { name: 'Guitar L', type: 'audio', color: '#6aa84f', inserts: ['ampsim'] },
      { name: 'Guitar R', type: 'audio', color: '#6aa84f', inserts: ['ampsim'] },
      {
        name: 'Lead Vocal',
        type: 'audio',
        color: '#d9a13c',
        inserts: ['eq8', 'compressor', 'deesser'],
        sendTo: { name: 'Room Verb', amount: 0.22 },
      },
    ],
  },
  {
    id: 'electronic',
    name: 'Electronic',
    blurb: 'Drum rack, bass, two synths and a delay throw.',
    summary: '6 tracks · rack · sidechain-ready',
    icon: 'grid',
    color: '#37b89a',
    bpm: 124,
    timeSig: { num: 4, den: 4 },
    tracks: [
      { name: 'Delay Throw', type: 'fx', color: '#9070c9', inserts: ['pingpong'] },
      { name: 'Drums', type: 'drum', color: '#37b89a' },
      { name: 'Sub Bass', type: 'instrument', color: '#4a90c4', preset: 'Deep Saw Bass' },
      {
        name: 'Lead',
        type: 'instrument',
        color: '#c96f9b',
        preset: 'Bright Pluck',
        sendTo: { name: 'Delay Throw', amount: 0.3 },
      },
      {
        name: 'Pad',
        type: 'instrument',
        color: '#9070c9',
        preset: 'Soft Pad',
        inserts: ['chorus'],
      },
      { name: 'FX / Risers', type: 'audio', color: '#7f93a8' },
    ],
  },
  {
    id: 'podcast',
    name: 'Podcast',
    blurb: 'Two voices with gates and de-essers, plus a music bed.',
    summary: '3 tracks · speech chain',
    icon: 'headphones',
    color: '#4a90c4',
    bpm: 120,
    timeSig: { num: 4, den: 4 },
    tracks: [
      {
        name: 'Host',
        type: 'audio',
        color: '#4a90c4',
        armed: true,
        inserts: ['gate', 'eq8', 'compressor', 'deesser'],
      },
      {
        name: 'Guest',
        type: 'audio',
        color: '#37b89a',
        armed: true,
        inserts: ['gate', 'eq8', 'compressor', 'deesser'],
      },
      { name: 'Music Bed', type: 'audio', color: '#7f93a8', inserts: ['eq8'] },
    ],
  },
  {
    id: 'beat',
    name: 'Beat sketch',
    blurb: 'A drum rack and three instrument tracks at 90 BPM, ready to loop.',
    summary: '4 tracks · 8-bar loop',
    icon: 'sampler',
    color: '#c96f9b',
    bpm: 90,
    timeSig: { num: 4, den: 4 },
    tracks: [
      { name: 'Drums', type: 'drum', color: '#c96f9b' },
      { name: 'Bass', type: 'instrument', color: '#4a90c4', preset: 'Deep Saw Bass' },
      { name: 'Keys', type: 'instrument', color: '#37b89a', preset: 'Warm Keys' },
      { name: 'Sample', type: 'audio', color: '#d9a13c' },
    ],
  },
];

export function findTemplate(id: string): Template | undefined {
  return TEMPLATES.find((t) => t.id === id);
}

/**
 * Build a project from a template.
 *
 * Routing and sends are resolved by NAME within the template, so a template can
 * be written the way a musician describes a session ("kick into the drum bus")
 * without carrying generated ids around.
 */
export function projectFromTemplate(template: Template, name?: string): ProjectData {
  const project = createEmptyProject(name ?? template.name);
  project.bpm = template.bpm;
  project.timeSig = { ...template.timeSig };
  project.loop = {
    enabled: true,
    start: 0,
    end: template.timeSig.num * (4 / template.timeSig.den) * 8,
  };
  project.tracks = [];

  const idByName = new Map<string, string>();
  for (const spec of template.tracks) idByName.set(spec.name, newId('trk'));

  template.tracks.forEach((spec, i) => {
    const id = idByName.get(spec.name)!;
    const track: Track = {
      id,
      type: spec.type,
      name: spec.name,
      color: spec.color ?? TRACK_COLORS[i % TRACK_COLORS.length],
      volume: 1,
      pan: 0,
      mute: false,
      solo: false,
      armed: spec.armed === true,
      collapsed: false,
      output: spec.output ? (idByName.get(spec.output) ?? 'master') : 'master',
    };
    if (spec.folder) {
      const folderId = idByName.get(spec.folder);
      if (folderId) track.folderId = folderId;
    }
    if (spec.type === 'instrument' || spec.type === 'drum') {
      track.synth = getPreset(spec.preset ?? 'Warm Keys');
    }
    if (spec.inserts?.length) {
      track.effects = spec.inserts.map((kind) => ({
        id: newId('fx'),
        kind,
        bypass: false,
        params: defaultParams(kind),
      }));
    }
    if (spec.sendTo) {
      const busId = idByName.get(spec.sendTo.name);
      if (busId) {
        track.sends = [{ busId, amount: spec.sendTo.amount, enabled: true, preFader: false }];
      }
    }
    project.tracks.push(track);
  });

  return project;
}
