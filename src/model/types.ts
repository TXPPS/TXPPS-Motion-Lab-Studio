import type { MediaRef } from './media';
import type { AutomationLane, AutomationMode } from './automation';
import type { SamplerParams } from './sampler';
import type { TempoMap } from './tempo';
import type { WarpMap } from './warp';
import type { ArrangerSection, ChordEvent, Marker } from './arrangement';
import type { ControlLink } from './controlLink';
import type { Groove } from './groove';

/** Core project data model. Everything here is plain serializable data. */

/**
 * v2 (Milestone 2) adds recorded/imported media references, nondestructive
 * audio-clip editing fields, and mixer sends. v3 (Milestone 5) adds per-track
 * automation lanes and the automation mode. v4 (Milestone 6) adds fade
 * shapes, take lanes with non-destructive comping, clip/track locking, edit
 * groups, and the audio-cleanup flags. v5 (Milestone 7) adds the sampler
 * instrument (zones), drum racks, and instrument racks. Older projects
 * migrate forward losslessly — see `validateProject` in
 * persistence/projectRepo.ts.
 *
 * v6 (v2.0) makes the project describe a *song* rather than a grid: a tempo and
 * time-signature map instead of one bpm, marker / arranger / chord global
 * tracks, folder and VCA and FX-channel track types, a real master channel with
 * its own inserts and automation, per-track input trim and polarity, and
 * scratch pads.
 *
 * v7 (v2.1) adds third-party plugins: `EffectKind` gains `'wam'` and `Effect`
 * gains an optional `plugin` describing which Web Audio Modules plugin fills
 * that slot and what state it was left in. The change is purely additive — a v6
 * project is a valid v7 project — so the migration is a version stamp and
 * nothing else. What is *not* additive is the load path: see
 * `persistence/projectRepo.ts`, where a plugin the app cannot resolve has to
 * survive as a tombstone rather than being filtered away.
 */
export const SCHEMA_VERSION = 7;

/** One layer/split inside an instrument rack. */
export interface RackItem {
  id: string;
  name: string;
  color: string;
  keyLo: number;
  keyHi: number;
  muted: boolean;
  solo: boolean;
  kind: 'synth' | 'sampler';
  synth?: import('./types').SynthParams;
  sampler?: SamplerParams;
}

/**
 * Fade / crossfade shapes. As a crossfade pair (out on the left clip, in on
 * the right), linear, equalGain and s sum to constant amplitude; equalPower
 * (sin/cos) sums to constant power (-3 dB at the midpoint).
 */
export type FadeShape = 'linear' | 'equalPower' | 'equalGain' | 's';

/** One alternative source under a comped audio clip. */
export interface Take {
  id: string;
  name: string;
  mediaId: string;
  /** seconds into the take's media that aligns with the clip's start */
  offset: number;
  /** muted takes stay listed but are skipped by solo-audition */
  muted?: boolean;
}

/**
 * Comp segment: from `at` (beats relative to the clip start) until the next
 * segment (or the clip end), the named take is the one that sounds. Always
 * sorted, first segment at 0.
 */
export interface CompSegment {
  at: number;
  takeId: string;
}

/**
 * Track kinds.
 * - `audio` / `instrument` / `drum` carry material.
 * - `bus` is a summing destination other tracks route *into*.
 * - `fx` is a send destination: identical signal path to a bus, but it is fed
 *   by sends rather than by output routing, and the UI groups it separately.
 * - `folder` carries no audio; it owns children for folding and group edits.
 * - `vca` carries no audio either; its fader scales the gain of its members
 *   without changing their routing, so their own faders keep their positions.
 */
export type TrackType = 'audio' | 'instrument' | 'drum' | 'bus' | 'fx' | 'folder' | 'vca';

/** Track kinds that own a channel in the audio graph. */
export const AUDIO_TRACK_TYPES: TrackType[] = ['audio', 'instrument', 'drum', 'bus', 'fx'];

export function isAudioTrackType(t: TrackType): boolean {
  return AUDIO_TRACK_TYPES.includes(t);
}

export type Waveform = 'sawtooth' | 'square' | 'triangle' | 'sine';

export interface SynthParams {
  /**
   * The built-in type assigned to the voice's `OscillatorNode` — and it stays
   * exactly that even when `shape` is morphing, because the morph is made by
   * subtracting a delayed copy of this oscillator rather than by replacing it.
   * A patch is therefore never described twice: this says what the node plays,
   * `shape` says how much of it is cancelled.
   */
  waveform: Waveform;
  /** Filter cutoff in Hz (20..18000) */
  cutoff: number;
  /**
   * Filter resonance in decibels of lift at the corner, clamped 0.05..24 by
   * the voice. Not a quality factor: `Voice` writes it to `Q` on a `lowpass`,
   * and Web Audio reads that field as dB for the pass filters.
   */
  resonance: number;
  /** ADSR in seconds / sustain 0..1 */
  attack: number;
  decay: number;
  sustain: number;
  release: number;
  /** Instrument output level, linear 0..1 */
  volume: number;
  presetName: string;

  // ---- oscillator morph, sub, glide and LFO (additive; see synthFace.ts) ----
  // Every field below is optional and every absent field means "build nothing",
  // so a project written before they existed loads into the same voice graph it
  // always had: one oscillator of `waveform` into the filter, no delay line, no
  // sub, no pitch ramp and no modulator. That is why none of this needed a
  // schema bump — `tests/synthSchema.test.ts` holds the app to it.

  /**
   * Saw↔square morph, 0..1. The voice subtracts `shape` times a copy of its own
   * sawtooth delayed by `1 - pulseWidth` of a cycle, so 0 is the plain saw and
   * 1 with a half-cycle delay is exactly a square. **Absent is not 0**: absent
   * means the voice builds no delay path at all and plays `waveform` as it
   * always did, which is what keeps a stored triangle a triangle.
   */
  shape?: number;
  /**
   * Duty cycle of the pulse's positive half, 0.1..0.9, default 0.5. It only
   * means anything as `shape` approaches 1 — at the saw end there is no pulse
   * for it to be the width of.
   */
  pulseWidth?: number;
  /** Sine sub-oscillator an octave down, linear 0..1. 0 builds no sub. */
  subLevel?: number;
  /** Portamento: seconds to glide from the previous note's pitch. 0 is off. */
  glide?: number;
  /** LFO rate in Hz. One LFO, three fixed destinations, one depth each. */
  lfoRate?: number;
  /** LFO → pitch depth, 0..1 = up to ±100 cents on the oscillator and its sub. */
  lfoToPitch?: number;
  /** LFO → filter depth, 0..1 = up to ±half the voice's own cutoff, in Hz. */
  lfoToFilter?: number;
  /** LFO → pulse width depth, 0..1 = up to ±0.4 of a cycle of duty. */
  lfoToWidth?: number;
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
  /** automation lanes (v3); values are normalized — see model/automation.ts */
  automation?: AutomationLane[];
  /** read (default) applies lanes; touch/latch also record control moves; off ignores lanes */
  automationMode?: AutomationMode;
  /** automation lanes expanded beneath the track in the arrangement */
  automationOpen?: boolean;
  /** sampler instrument (quick/drum/multi views share one engine) */
  sampler?: SamplerParams;
  /** instrument rack: layered/split child instruments (wins over sampler/synth) */
  rack?: { items: RackItem[] };
  /** locked tracks refuse clip timing edits and deletion */
  locked?: boolean;
  /** edit group (1..4): selecting a clip links time-overlapping clips across the group */
  editGroup?: number;

  // ---- v6 ----
  /** parent folder track id; folder membership is by reference, not by order */
  folderId?: string;
  /** folder tracks: children are hidden in the arrangement while folded */
  folded?: boolean;
  /** VCA track whose fader scales this track's gain */
  vcaId?: string;
  /** custom lane height in px; falls back to the layout default */
  height?: number;
  /** input trim applied ahead of the insert chain, in dB */
  inputGainDb?: number;
  /** flip channel polarity at the input */
  phaseInvert?: boolean;
  /** sum the channel to mono at the input */
  monoSum?: boolean;
  /** never silenced by another track's solo (reverb returns, talkback) */
  soloSafe?: boolean;
  /** track id whose post-fader signal keys this channel's sidechain-aware inserts */
  sidechainFrom?: string;
  /** free-form per-track note shown in the inspector */
  notes?: string;
  /** MIDI input channel filter for instrument tracks (0 = omni) */
  midiChannel?: number;
  /** note effects applied to this track's MIDI before it reaches the instrument */
  noteFx?: NoteFx[];
  /** assignable macro knobs; up to eight, like the hardware they model */
  macros?: Macro[];
  /** frozen tracks play a rendered media file instead of their instrument */
  freeze?: { mediaId: string; renderedAt: number };
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
  /** Muted notes stay visible and editable but are never scheduled. */
  muted?: boolean;
  /** Per-note pan (-1..1), applied on top of the channel pan. */
  pan?: number;
  /** Per-note fine tuning in cents (-100..100). */
  detune?: number;
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
  /** locked clips refuse timing edits and deletion until unlocked */
  locked?: boolean;
  /** per-clip colour override; falls back to the track colour */
  color?: string;
  /** insert effects applied to this clip alone, ahead of the channel */
  eventFx?: Effect[];
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
  /** fade curve shapes; absent = linear */
  fadeInShape?: FadeShape;
  fadeOutShape?: FadeShape;
  /** flip polarity (gain × −1) — the classic phase-cancellation check */
  phaseInvert?: boolean;
  /** force a mono downmix on playback (channelCount 1, explicit) */
  monoSum?: boolean;
  /** alternative takes; when present, `comp` decides what sounds */
  takes?: Take[];
  /** ordered comp segments over the takes; ignored without takes */
  comp?: CompSegment[];
  /** take lanes expanded beneath the track in the arrangement */
  takesOpen?: boolean;
  /** audition one take by itself (UI state, persisted harmlessly) */
  soloTakeId?: string;
  /**
   * Speed multiplier: 2 plays the material twice as fast (and half as long),
   * 0.5 half as fast. Named for what the control does, not for what happens to
   * the waveform, because "stretch 2" reads both ways and speed does not.
   */
  stretch?: number;
  /** follow the song tempo: the clip re-stretches when the tempo map changes */
  followTempo?: boolean;
  /** source tempo in bpm, used to derive `stretch` when following tempo */
  sourceBpm?: number;
  /** semitone transposition applied by resampling (or by the stretcher) */
  transpose?: number;
  /** detected transient positions in seconds into the source, for slicing/warp */
  transients?: number[];
  /**
   * Warp markers tying source time to musical time. When present they decide
   * playback rate over the clip; `stretch` is the simple constant-rate case.
   */
  warp?: WarpMap;
  /**
   * Keep the pitch while stretching. Resampling is free but moves the pitch
   * with the rate; preserving it means rendering the clip through the time
   * stretcher, which costs a render but is what "follow the tempo" means for
   * anything but a one-shot.
   */
  preservePitch?: boolean;
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
/**
 * One channel's place in a cue mix.
 *
 * `follow` is the default state and the reason a cue mix is usable at all: a
 * new cue starts as a copy of the main mix and only the channels the performer
 * asked about are ever touched, so a twenty-track session does not need twenty
 * decisions before the first note.
 */
export interface CueSend {
  /** linear 0..1.5, used when `follow` is false */
  level: number;
  pan: number;
  mute: boolean;
  /** take the level and pan from the main mix instead of the stored ones */
  follow: boolean;
}

/**
 * A headphone mix. It is the same channels heard differently — not a copy of
 * the material — so it carries only what each channel does, keyed by track id.
 */
export interface CueMix {
  id: string;
  name: string;
  /** master level for the whole cue, linear */
  level: number;
  /** channels not listed here follow the main mix */
  sends: Record<string, CueSend>;
  /** a cue is a monitor path: solo on the main mix should not silence it */
  ignoreSolo: boolean;
}

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
/**
 * Motion Wave units, rendered by the shared C++ core through WebAssembly rather
 * than by Web Audio nodes (ADR-0007).
 *
 * Prefixed so a Motion Wave insert is distinguishable from the twenty-seven Web
 * Audio devices in a project file as well as in the picker: a person reading a
 * `.json` should be able to tell which engine rendered a track.
 *
 * **Named as its own union so the host can branch on the group once**, rather
 * than gaining a case per unit in every exhaustive switch over `EffectKind`.
 * ADR-0007's boundary forbids unit-specific special-casing inside `src/`, and
 * fourteen new cases in each of several switches is exactly how that rule gets
 * broken without anyone deciding to break it. Everything else about a unit —
 * its parameters, ranges, tapers, face and declared latency — is read from its
 * own generated declaration; these names are the one thing a union must spell.
 */
export type MotionWaveKind =
  | 'mw-motion-shaper'
  | 'mw-program-eq'
  | 'mw-optical-leveller'
  | 'mw-fet-limiter'
  | 'mw-variable-mu'
  | 'mw-console-eq'
  | 'mw-granular-reverb';

export type EffectKind =
  // dynamics
  | 'trim'
  | 'compressor'
  | 'gate'
  | 'limiter'
  | 'multiband'
  | 'deesser'
  // tone
  | 'eq3'
  | 'eq8'
  | 'filter'
  | 'saturator'
  | 'distortion'
  | 'ampsim'
  | 'bitcrusher'
  // modulation
  | 'chorus'
  | 'flanger'
  | 'phaser'
  | 'tremolo'
  | 'rotary'
  // time
  | 'delay'
  | 'pingpong'
  | 'reverb'
  // stereo + utility
  | 'width'
  | 'autopan'
  | 'gainMatch'
  | 'analyser'
  | 'tuner'
  | 'vocaltune'
  | MotionWaveKind
  // third-party: a Web Audio Modules 2.0 plugin. Unlike every other kind this
  // one has no built-in DSP and no static parameter spec — see `Effect.plugin`.
  | 'wam';

/**
 * One parameter of a plugin, as it was last seen.
 *
 * A plugin's parameters are discovered at runtime by asking the plugin, so
 * nothing static describes them. Caching the descriptors means an automation
 * lane, a macro or a control link still renders with a real name, range and
 * unit when the plugin is absent — the difference between "Cutoff (not in this
 * version)" and an unnamed grey line.
 */
export interface PluginParamCache {
  id: string;
  label: string;
  type: 'float' | 'int' | 'boolean' | 'choice';
  defaultValue: number;
  minValue: number;
  maxValue: number;
  /** Nonlinear skew of the range, 0 when linear. */
  exponent?: number;
  /** Discrete settings; the stored value is an index into this list. */
  choices?: string[];
  units?: string;
}

/**
 * Which third-party plugin fills an insert slot, and what it was left holding.
 *
 * This is the whole of what we persist about a plugin, and it is deliberately
 * enough to reconstruct the slot without the plugin being present: the name to
 * show, the place to fetch it from, and the settings to hand back if it ever
 * loads again. A plugin that fails to load becomes a tombstone built from this
 * record, never a deletion.
 */
export interface PluginRef {
  /** Stable identity from the plugin's own descriptor, e.g. "com.sequencerParty.simpleDistortion". */
  identifier: string;
  /** Where it came from: a curated shelf id ("shelf:distortion") or an absolute URL. */
  source: string;
  name: string;
  vendor: string;
  version: string;
  /**
   * Opaque state from `WamNode.getState()`. We store it and hand it back; we
   * never interpret it, because only the plugin knows what is in it.
   */
  state?: unknown;
  /** Parameter descriptors from the last successful load. */
  paramCache?: PluginParamCache[];
}

export interface Effect {
  id: string;
  kind: EffectKind;
  /** Bypassed effects stay in the chain (and in the project) but pass audio through. */
  bypass: boolean;
  /**
   * Parameter values by name; see EFFECT_SPECS for ranges and defaults.
   *
   * For a `'wam'` effect the keys are the plugin's own parameter ids and there
   * is no spec to validate them against — only the plugin knows their ranges,
   * so the load path checks them for being finite numbers and keeps them all.
   * The key scheme is unchanged (`fx:<effectId>:<key>`), which is why
   * automation, macros and control links need to know nothing about plugins.
   */
  params: Record<string, number>;
  /** Present only on `kind: 'wam'`. */
  plugin?: PluginRef;
  /**
   * Drawn shapes, for a unit whose state is not all scalars.
   *
   * The Motion Shaper's modulation is a curve per band, and a curve has no
   * range, no taper and no single value — so it cannot be a parameter, and
   * `params` cannot hold it. It is still state the project has to keep: a
   * session saved without it reloads as a wire, having lost the only thing the
   * device was doing.
   *
   * Indexed by shape number, each a list of breakpoints as
   * `[x, y, shape, tension]` — the same four numbers the unit's own curve
   * editor and its WASM bridge already speak. Which units have them, and how
   * many, is the *unit's* declaration (`shapeCount`), not the host's knowledge:
   * ADR-0007 forbids the host from knowing which device it is looking at.
   */
  shapes?: number[][][];
}

/**
 * One macro knob.
 *
 * A macro is a single control that moves several parameters at once, each over
 * its own range and in its own direction — one "Intensity" knob that opens a
 * filter, adds drive and pulls a reverb back. It writes the real parameters, so
 * everything downstream (the mixer, the engine, an export) sees ordinary
 * values and needs to know nothing about macros.
 */
export interface MacroTarget {
  /** Parameter id from model/paramRegistry: volume | pan | fx:<id>:<key> | synth:<key>… */
  paramId: string;
  /** Normalised 0..1 value the target takes when the macro is at 0 and at 1.
   *  `from` above `to` inverts the target, which is how one knob can open one
   *  thing while closing another. */
  from: number;
  to: number;
}

export interface Macro {
  id: string;
  name: string;
  /** 0..1 */
  value: number;
  targets: MacroTarget[];
}

/**
 * Note effects: MIDI-domain processors that sit between a clip (or the live
 * keyboard) and the instrument. They never alter the stored notes — the
 * scheduler expands them at play time — so switching one off restores the
 * written performance exactly.
 */
export type NoteFxKind = 'arpeggiator' | 'chorder' | 'repeater' | 'noteFilter' | 'velocityCurve';

export interface NoteFx {
  id: string;
  kind: NoteFxKind;
  bypass: boolean;
  params: Record<string, number>;
  /** chorder: interval set; noteFilter: allowed pitch classes */
  list?: number[];
}

/**
 * The master channel. Kept off the `tracks` array — nothing can delete it,
 * reorder it, or route it away — but it carries the same inserts, automation
 * and metering a channel does.
 */
export interface MasterChannel {
  /** linear gain 0..1.5 */
  volume: number;
  pan: number;
  effects?: Effect[];
  automation?: AutomationLane[];
  automationMode?: AutomationMode;
  /** engage the safety limiter ahead of the output (on by default) */
  limiter?: boolean;
  /** monitoring: sum to mono for a mono compatibility check */
  monoCheck?: boolean;
  /** monitoring: -20 dB dim */
  dim?: boolean;
}

/**
 * A scratch pad is a parallel arrangement sandbox: the same tracks, a private
 * set of clips, its own length. Trying an alternative chorus never disturbs the
 * main timeline, and a pad can be swapped into it in one step.
 */
export interface ScratchPad {
  id: string;
  name: string;
  clips: Clip[];
  /** beats */
  length: number;
  createdAt: number;
}

/**
 * One entry on the mastering page: a rendered mix placed in an album order,
 * with the level and edge treatment mastering actually applies. The audio it
 * points at is a media item like any other, so a master is a real artefact you
 * can re-open, re-measure and re-export rather than a transient render.
 */
export interface MasterItem {
  id: string;
  name: string;
  mediaId: string;
  /** trim in dB applied to this entry alone */
  gainDb: number;
  /** seconds */
  fadeIn: number;
  fadeOut: number;
  /** silence after this entry, in seconds */
  gapAfter: number;
  /** last measured loudness, cached so the list does not re-analyse on every paint */
  measured?: {
    integratedLufs: number;
    loudnessRangeLu: number;
    truePeakDbtp: number;
    samplePeakDbfs: number;
    durationSeconds: number;
    measuredAt: number;
  };
}

/** The mastering (Project) page's document: an ordered release plus its chain. */
export interface MasteringProject {
  items: MasterItem[];
  /** delivery target in LUFS (−14 streaming, −16 podcast, −23 broadcast, −9 club) */
  targetLufs: number;
  /** true-peak ceiling in dBTP */
  ceilingDbtp: number;
  /** album-wide insert chain, applied ahead of the delivery limiter */
  effects?: Effect[];
  /** normalise every entry to the target instead of keeping relative levels */
  normalize?: boolean;
  title?: string;
  artist?: string;
}

/**
 * A live-performance setlist entry: one song, its patch and its cue.
 * The Show page plays these back to back without re-opening projects.
 */
export interface SetlistEntry {
  id: string;
  name: string;
  /** project id to load, when the song lives in its own project */
  projectId?: string;
  /** scratch pad or arranger section to start from */
  startBeat?: number;
  bpm?: number;
  timeSig?: TimeSignature;
  /** performer-facing note, shown large on stage */
  note?: string;
  color?: string;
  /** tracks to arm/unmute for this song, by track id */
  armed?: string[];
}

export interface ShowSetup {
  entries: SetlistEntry[];
  /** index of the entry currently cued */
  cued?: number;
  /** big-type mode for stage legibility */
  stageMode?: boolean;
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

  // ---- v6 ----
  /**
   * Tempo and time-signature map. `bpm` and `timeSig` above remain the value at
   * beat 0 and are kept in sync, so every older reader still sees a valid song.
   */
  tempoMap?: TempoMap;
  /** named timeline positions */
  markers?: Marker[];
  /** arranger sections tiling the timeline */
  sections?: ArrangerSection[];
  /** chord track */
  chords?: ChordEvent[];
  /** master channel: inserts, automation, monitoring */
  master?: MasterChannel;
  /** alternative arrangements */
  scratchPads?: ScratchPad[];
  /** id of the pad currently swapped into the timeline, if any */
  activePadId?: string;
  /** hardware controls bound to parameters, macros and the transport */
  controlLinks?: ControlLink[];
  /** grooves lifted off performances in this song, alongside the built-ins */
  grooves?: Groove[];
  /** headphone mixes: a separate balance per performer, off the same channels */
  cueMixes?: CueMix[];
  /** count-in bars before recording (0 = none) */
  countIn?: number;
  /** pre-roll in bars before the punch point */
  preRoll?: number;
  /** punch region for recording */
  punch?: { enabled: boolean; start: number; end: number };
  /** metronome level, linear */
  clickLevel?: number;
  /** click only while recording */
  clickRecordOnly?: boolean;
  /** author metadata written into exports */
  artist?: string;
  genre?: string;
  /** mastering (Project) page document */
  mastering?: MasteringProject;
  /** live performance (Show) page document */
  show?: ShowSetup;
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
