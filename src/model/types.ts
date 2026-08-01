import type { MediaRef } from './media';

/** Core project data model. Everything here is plain serializable data. */

/**
 * v2 (Milestone 2) adds recorded/imported media references, nondestructive
 * audio-clip editing fields, and mixer sends. v1 projects migrate forward
 * losslessly — see `validateProject` in persistence/projectRepo.ts.
 */
export const SCHEMA_VERSION = 2;

export type TrackType = 'audio' | 'instrument' | 'drum' | 'bus';

export type Waveform = 'sawtooth' | 'square' | 'triangle' | 'sine';

export interface SynthParams {
  waveform: Waveform;
  /** Filter cutoff in Hz (20..18000) */
  cutoff: number;
  /** Filter resonance Q (0.1..20) */
  resonance: number;
  /** ADSR in seconds / sustain 0..1 */
  attack: number;
  decay: number;
  sustain: number;
  release: number;
  /** Instrument output level, linear 0..1 */
  volume: number;
  presetName: string;
}

export interface Track {
  id: string;
  type: TrackType;
  name: string;
  /** hex color used across arrangement + mixer */
  color: string;
  /** linear gain, 1 = unity, max 1.5 */
  volume: number;
  /** -1 (L) .. 1 (R) */
  pan: number;
  mute: boolean;
  solo: boolean;
  armed: boolean;
  collapsed: boolean;
  /** 'master' or the id of a bus track */
  output: string;
  /** present on instrument/drum tracks */
  synth?: SynthParams;
  /** audio tracks: selected input device id, or 'default' */
  inputDeviceId?: string;
  /** audio tracks: monitor the live input through this channel */
  monitoring?: boolean;
  /** effect-bus sends */
  sends?: Send[];
  /** insert chain, applied in order between the channel input and the fader */
  effects?: Effect[];
}

export interface Note {
  id: string;
  /** beats relative to clip start */
  start: number;
  /** beats */
  length: number;
  /** MIDI note number */
  pitch: number;
  /** 1..127 */
  velocity: number;
}

interface ClipBase {
  id: string;
  trackId: string;
  name: string;
  /** absolute timeline position in beats */
  start: number;
  /** beats */
  length: number;
  muted: boolean;
}

export interface AudioClip extends ClipBase {
  type: 'audio';
  /** procedural generator id, or a MediaRef id backed by IndexedDB */
  mediaId: string;
  /** seconds into the source where playback starts (trim from the left) */
  offset: number;
  /**
   * Seconds of source material this clip plays. Undefined means "derive from
   * the clip's musical length", which is how v1 clips behaved.
   */
  sourceDuration?: number;
  /** clip gain, linear */
  gain: number;
  /** fade-in length in seconds (0 = none) */
  fadeIn: number;
  /** fade-out length in seconds (0 = none) */
  fadeOut: number;
}

export interface MidiClip extends ClipBase {
  type: 'midi';
  notes: Note[];
}

export type Clip = AudioClip | MidiClip;

export interface LoopRegion {
  enabled: boolean;
  /** beats */
  start: number;
  end: number;
}

export interface TimeSignature {
  num: number;
  den: number;
}

export interface WorkspaceState {
  /** arrangement zoom */
  pxPerBeat: number;
  /** grid snap in beats */
  snap: number;
}

/** Per-track send into an effect bus. */
export interface Send {
  /** target bus track id */
  busId: string;
  /** linear amount 0..1.5 */
  amount: number;
  enabled: boolean;
  /** post-fader is the default; pre-fader taps before volume/pan */
  preFader: boolean;
}

/**
 * Insert effects.
 *
 * Every effect is the same shape — a kind plus a flat number map — so the
 * engine builds, updates and tears down any of them through one code path, and
 * an unknown kind loaded from an older or newer project degrades to a bypassed
 * slot instead of breaking the channel.
 */
export type EffectKind = 'trim' | 'eq3' | 'compressor' | 'delay' | 'reverb';

export interface Effect {
  id: string;
  kind: EffectKind;
  /** Bypassed effects stay in the chain (and in the project) but pass audio through. */
  bypass: boolean;
  /** Parameter values by name; see EFFECT_SPECS for ranges and defaults. */
  params: Record<string, number>;
}

export interface ProjectData {
  schemaVersion: number;
  id: string;
  name: string;
  /** metadata for recorded/imported media; bytes live in IndexedDB */
  media?: MediaRef[];
  createdAt: number;
  modifiedAt: number;
  bpm: number;
  timeSig: TimeSignature;
  loop: LoopRegion;
  metronome: boolean;
  /** linear master gain 0..1.5 */
  masterVolume: number;
  tracks: Track[];
  clips: Clip[];
  workspace: WorkspaceState;
  /** Free-form musician notes: lyrics, session to-dos, mix decisions. */
  notes?: string;
}

export interface ProjectMeta {
  id: string;
  name: string;
  createdAt: number;
  modifiedAt: number;
  trackCount: number;
  clipCount: number;
}

export const TRACK_COLORS = [
  '#37b89a',
  '#4a90c4',
  '#9070c9',
  '#d9a13c',
  '#d97455',
  '#6aa84f',
  '#7f93a8',
  '#c96f9b',
];

export const MASTER_ID = 'master';
