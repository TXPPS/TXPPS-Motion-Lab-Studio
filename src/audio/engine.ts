/**
 * AudioEngine — the ONLY owner of the AudioContext and the audio graph.
 * UI components never touch nodes; they act on stores and call the public
 * methods here. The engine reacts to project-store changes (syncGraph) and
 * mirrors its status into the transport store.
 */
import { clipSecondsPerBeat, tempoMapOf } from '../model/music';
import { beatToSec, secToBeat } from '../model/tempo';
import { playedNotes } from './notePipeline';
import { resolveChannels } from '../model/mixerGraph';
import { midiRecorder } from './midiRecorder';
import { clipRatePlan } from '../model/clipRate';
import { stretchedBuffer } from './stretchCache';
import { clipWarpMap, warpedBuffer, warpedClipTiming, warpedTimeSec } from './warpRender';
import { isAudioTrackType, MASTER_ID } from '../model/types';
import { FREEZE_CLIP_PREFIX, isFreezeClipId, isFrozen } from '../model/freeze';
import type { AudioClip, MidiClip, ProjectData, SynthParams } from '../model/types';
import { useProjectStore } from '../state/projectStore';
import { useTransportStore } from '../state/transportStore';
import { diagLog } from '../state/diagnostics';
import { evict, getBufferSync, loadBuffer } from './mediaLibrary';
import { audioInput } from './inputManager';
import { useInputStore, type RecordPhase } from '../state/inputStore';
import { DrumKit, PolySynth, type ActiveHandle, type Instrument } from './synth';
import { RackInstrument, SamplerInstrument, type RackChild } from './samplerInstrument';
import { defaultSamplerParams, type SamplerParams } from '../model/sampler';
import { InsertChain } from './effectChain';
import { applyEnvelope, computeClipSchedule } from './clipSchedule';
import { expandCompClip } from '../model/comping';
import { Scheduler } from './scheduler';
import { laneValueAt } from '../model/automation';
import type { AutomationPoint } from '../model/automation';
import { denormParam, findAutoParam } from '../model/paramRegistry';
import type { AutoParam } from '../model/paramRegistry';

const MAX_ACTIVE_SOURCES = 128;
/** Lookahead and tick of the listen preview's note pump, in seconds and ms. */
const PREVIEW_LOOKAHEAD_SEC = 0.3;
const PREVIEW_TICK_MS = 60;
const PARAM_TAU = 0.015;
/** Automation smoothing: every applied value approaches its target over this
 *  time constant, so control-rate updates cannot produce zipper steps. */
const AUTO_TAU = 0.015;

/**
 * Write an AudioParam, refusing anything that is not a finite number.
 *
 * A NaN reaching an AudioParam is unrecoverable: the node emits NaN for the
 * rest of the session and the channel is silently dead, with no error anywhere.
 * The values written here come from the project store, which assigns whatever
 * it is handed, and from Control Link mappings that divide — so the guard
 * belongs at the write, exactly as it already does in `effectChain.setParam`.
 */
export function safeSet(param: AudioParam, value: number, at: number, tau: number): void {
  if (!Number.isFinite(value)) return;
  param.setTargetAtTime(value, at, tau);
}

/**
 * The click's level: the project's own, defaulted and clamped to the range the
 * validator stores. Exported because "what level is the click at" is a
 * question worth answering without an AudioContext.
 */
export function clickGain(p: Pick<ProjectData, 'clickLevel'>): number {
  const v = p.clickLevel;
  return Math.max(0, Math.min(2, typeof v === 'number' && Number.isFinite(v) ? v : 0.7));
}

/**
 * Does the transport's click sound right now?
 *
 * `clickRecordOnly` is the "click only while recording" switch: with it on, the
 * click is a tracking aid rather than part of listening back. The count-in is
 * deliberately not asked about here — it plays its clicks directly, because a
 * count-in with no click is not a count-in.
 */
export function clickSounds(p: Pick<ProjectData, 'clickRecordOnly'>, phase: RecordPhase): boolean {
  if (p.clickRecordOnly !== true) return true;
  return phase === 'recording' || phase === 'countIn';
}

/** One live-applied automation binding, resolved once per project change. */
interface AutoEntry {
  trackId: string;
  laneId: string;
  points: AutomationPoint[];
  param: AutoParam;
  kind: 'volume' | 'pan' | 'mute' | 'send' | 'fx' | 'synth' | 'smp';
  busId?: string;
  effectId?: string;
  paramKey?: string;
}

export interface MeterData {
  /** loudest of the two channels — what a single-bar meter shows */
  peak: number;
  rms: number;
  hold: number;
  clipped: boolean;
  /** per-channel readings; equal to `peak`/`rms` on a mono source */
  peakL: number;
  peakR: number;
  rmsL: number;
  rmsR: number;
  holdL: number;
  holdR: number;
}

const ZERO_METER: MeterData = {
  peak: 0,
  rms: 0,
  hold: 0,
  clipped: false,
  peakL: 0,
  peakR: 0,
  rmsL: 0,
  rmsR: 0,
  holdL: 0,
  holdR: 0,
};

/** Lazily-built stereo metering tap. Only channels with a visible meter get one. */
interface MeterTap {
  splitter: ChannelSplitterNode;
  left: AnalyserNode;
  right: AnalyserNode;
}

interface Channel {
  trackId: string;
  /** Tap feeding another channel's dynamics detector, when one keys from this. */
  keySend: GainNode | null;
  /** Which track this channel's own detectors are currently keyed from. */
  keyedFrom: string | null;
  /** Everything feeding this channel connects here. */
  input: GainNode;
  /** Input trim, polarity and mono sum, ahead of the inserts. */
  trim: GainNode;
  inserts: InsertChain;
  muteGain: GainNode;
  volGain: GainNode;
  panner: StereoPannerNode;
  analyser: AnalyserNode;
  tap: MeterTap | null;
  routedTo: string;
  /** per-target send gains, keyed by bus id */
  sends: Map<string, GainNode>;
}

/** Live input monitoring for one track. */
interface Monitor {
  deviceId: string;
  source: MediaStreamAudioSourceNode;
  gain: GainNode;
  analyser: AnalyserNode;
}

const FALLBACK_SYNTH: SynthParams = {
  waveform: 'triangle',
  cutoff: 3000,
  resonance: 1,
  attack: 0.01,
  decay: 0.2,
  sustain: 0.6,
  release: 0.3,
  volume: 0.5,
  presetName: 'Fallback',
};

class AudioEngine {
  private ctx: AudioContext | null = null;
  private startPromise: Promise<boolean> | null = null;
  private masterInput: GainNode | null = null;
  private masterInserts: InsertChain | null = null;
  private masterGain: GainNode | null = null;
  private masterPan: StereoPannerNode | null = null;
  private masterMono: GainNode | null = null;
  private limiter: DynamicsCompressorNode | null = null;
  private masterAnalyser: AnalyserNode | null = null;
  private metroGain: GainNode | null = null;

  private channels = new Map<string, Channel>();
  /** trackId → the print currently sounding for it, so a wrap can hand over. */
  private freezePlaying = new Map<string, { src: AudioBufferSourceNode; gain: GainNode }>();
  /** Prints this engine has asked the media library to decode. */
  private freezeLoading = new Set<string>();
  /** Prints currently in play, so a released one can be dropped from memory. */
  private freezeMediaIds = new Set<string>();
  /** cue mix being monitored on the main output, or null for the main mix */
  private monitorCueId: string | null = null;
  private monitors = new Map<string, Monitor>();
  private instruments = new Map<string, Instrument>();
  private activeSources = new Set<ActiveHandle>();
  private scheduler: Scheduler;

  private meterData = new Map<string, MeterData>();
  /** channel id → how many visible meters are reading it */
  private meterWatchers = new Map<string, number>();
  private masterTap: MeterTap | null = null;
  private scratch = new Float32Array(2048);
  private rafId: number | null = null;
  private frameCbs = new Set<(dt: number) => void>();
  private lastFrameTime = 0;
  private frameCount = 0;

  private playing = false;
  private pausedAtBeat = 0;
  private lastBpm = 0;
  private storeUnsub: (() => void) | null = null;

  // ---- automation state ----
  /** Bindings applied at control rate; rebuilt on every project change. */
  private autoIndex: AutoEntry[] = [];
  /** trackId → core param ids the automation engine owns (syncGraph skips them). */
  private autoOwned = new Map<string, Set<string>>();
  /** laneId → last applied normalized value (epsilon skip). */
  private autoApplied = new Map<string, number>();
  /** trackId → effectId → automated param values (passed into inserts.sync). */
  private fxOverrides = new Map<string, Map<string, Record<string, number>>>();
  /** trackId → automated synth params; instruments read through this. */
  private synthOverrides = new Map<string, Partial<SynthParams>>();
  /** trackId → automated sampler master params. */
  private samplerOverrides = new Map<string, Partial<SamplerParams>>();
  /** trackId → what kind of instrument is currently built (rebuild detector). */
  private instrumentKind = new Map<string, string>();
  private autoDirty = true;
  private lastAutoPos = -1;

  constructor() {
    this.scheduler = new Scheduler({
      now: () => this.ctx?.currentTime ?? 0,
      getProject: () => useProjectStore.getState().project,
      scheduleClip: (clip, when, offsetSec) => this.scheduleClip(clip, when, offsetSec),
      scheduleNote: (trackId, clipId, pitch, vel, when, durSec) => {
        this.instruments.get(trackId)?.scheduleNote(pitch, vel, when, durSec, clipId);
      },
      scheduleMetronome: (when, accent) => this.scheduleTransportClick(when, accent),
      // Automation must keep moving in a hidden tab; the animation frame does
      // not fire there, but the transport tick does.
      onTick: () => this.applyAutomation(),
    });
  }

  // ---------- lifecycle ----------

  get context(): AudioContext | null {
    return this.ctx;
  }

  isRunning(): boolean {
    return this.ctx?.state === 'running';
  }

  /**
   * Create/resume the AudioContext. Must be called from a user gesture the
   * first time. Concurrent calls share one promise — a single context, always.
   */
  start(): Promise<boolean> {
    if (this.ctx && this.ctx.state === 'running') return Promise.resolve(true);
    if (this.startPromise) return this.startPromise;
    this.startPromise = this.doStart().finally(() => {
      this.startPromise = null;
    });
    return this.startPromise;
  }

  private async doStart(): Promise<boolean> {
    const t = useTransportStore.getState();
    try {
      if (!this.ctx) {
        t.set({ audioState: 'starting', audioError: null });
        const ctx = new AudioContext({ latencyHint: 'interactive' });
        this.ctx = ctx;
        this.buildMasterChain(ctx);
        ctx.onstatechange = () => this.reflectContextState();
        this.subscribeToProject();
        this.syncGraph(useProjectStore.getState().project, true);
        this.startFrameLoop();
        diagLog('info', `AudioContext created (${ctx.sampleRate} Hz)`);
      }
      if (this.ctx.state !== 'running') {
        await this.ctx.resume();
      }
      this.reflectContextState();
      const running = this.ctx.state === 'running';
      if (!running) {
        diagLog('warn', `AudioContext resume did not reach running (state: ${this.ctx.state})`);
      }
      return running;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      t.set({ audioState: 'error', audioError: msg });
      diagLog('error', `Audio startup failed: ${msg}`);
      return false;
    }
  }

  private buildMasterChain(ctx: AudioContext): void {
    const p = useProjectStore.getState().project;
    this.masterInput = ctx.createGain();
    this.masterInserts = new InsertChain(ctx);
    this.masterGain = ctx.createGain();
    this.masterGain.gain.value = p.master?.volume ?? p.masterVolume;
    this.masterPan = ctx.createStereoPanner();
    this.masterMono = ctx.createGain();
    // The mono check is a monitoring tool, not a mix decision: forcing an
    // explicit single-channel count here sums L and R without touching the
    // signal that a bounce renders.
    this.masterMono.channelCountMode = 'max';
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -1.5;
    this.limiter.knee.value = 0;
    this.limiter.ratio.value = 20;
    this.limiter.attack.value = 0.002;
    this.limiter.release.value = 0.08;
    this.masterAnalyser = ctx.createAnalyser();
    this.masterAnalyser.fftSize = 2048;
    // input → master inserts → fader → pan → mono check → limiter → analyser
    this.masterInput.connect(this.masterInserts.entry);
    this.masterInserts.exit.connect(this.masterGain);
    this.masterGain.connect(this.masterPan);
    this.masterPan.connect(this.masterMono);
    this.masterMono.connect(this.limiter);
    this.limiter.connect(this.masterAnalyser);
    this.masterAnalyser.connect(ctx.destination);
    // The click is a cue, never part of the mix: it joins after the master
    // chain so it is never compressed, never metered as programme, and never
    // present in a bounce.
    // The master is always metered, so its stereo tap is built up front.
    const splitter = ctx.createChannelSplitter(2);
    const left = ctx.createAnalyser();
    const right = ctx.createAnalyser();
    left.fftSize = 1024;
    right.fftSize = 1024;
    this.masterAnalyser.connect(splitter);
    splitter.connect(left, 0);
    splitter.connect(right, 1);
    this.masterTap = { splitter, left, right };
    // The click joins AFTER the analyser, straight at the destination: it is a
    // cue, not programme material, so it must never be metered, never be
    // compressed by the safety limiter, and never reach a bounce.
    this.metroGain = ctx.createGain();
    this.metroGain.gain.value = clickGain(p);
    this.metroGain.connect(ctx.destination);
  }

  private reflectContextState(): void {
    const t = useTransportStore.getState();
    if (!this.ctx) {
      t.set({ audioState: 'uninitialized', sampleRate: null });
      return;
    }
    const state = this.ctx.state as string;
    if (state === 'running') {
      t.set({ audioState: 'running', sampleRate: this.ctx.sampleRate, audioError: null });
    } else if (state === 'interrupted') {
      t.set({ audioState: 'interrupted' });
      diagLog('warn', 'AudioContext interrupted (likely OS/phone event)');
      if (this.playing) this.stop();
    } else if (state === 'suspended') {
      t.set({ audioState: 'suspended' });
      if (this.playing) {
        // A suspension during ACTIVE playback (device/route change, UA
        // policy blip) gets one immediate recovery attempt — context time
        // freezes while suspended, so the scheduler resumes coherently.
        // Only if it stays suspended does the transport stop.
        void this.ctx.resume().catch(() => {
          /* resume needs a user gesture — the timeout below stops us */
        });
        setTimeout(() => {
          if (this.playing && this.ctx && (this.ctx.state as string) !== 'running') {
            diagLog('warn', 'AudioContext suspended during playback — transport stopped');
            this.stop();
          } else if (this.playing) {
            diagLog('info', 'AudioContext auto-resumed during playback');
            this.reflectContextState();
          }
        }, 250);
      }
    } else if (state === 'closed') {
      t.set({ audioState: 'uninitialized', sampleRate: null });
    }
  }

  /** Try to recover after tab visibility/interruption changes (best effort). */
  handleVisibilityResume(): void {
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().then(
        () => this.reflectContextState(),
        () => {
          /* needs a user gesture — the audio chip offers retry */
        },
      );
    }
  }

  // ---------- project sync ----------

  private subscribeToProject(): void {
    if (this.storeUnsub) return;
    this.storeUnsub = useProjectStore.subscribe((s, prev) => {
      if (s.project !== prev.project) this.syncGraph(s.project, false);
    });
  }

  private syncGraph(p: ProjectData, initial: boolean): void {
    const ctx = this.ctx;
    if (!ctx || !this.masterInput || !this.masterGain) return;
    const t = ctx.currentTime;
    // `autoApplied` is a frame-to-frame de-duplicator keyed on the lane's own
    // value, not a record of what the nodes hold. A cue, a VCA or folder fader
    // and a solo all move the value a lane *should* produce while leaving the
    // lane itself untouched — and the pass below will not write a parameter the
    // automation engine owns. Without this the cue assembles itself channel by
    // channel as lanes happen to move, and a group fader does nothing at all to
    // an automated member.
    this.autoApplied.clear();
    this.buildAutoIndex(p);

    // 1. create channels/instruments for new tracks. The instrument KIND can
    // change (synth → sampler → rack), so a signature mismatch rebuilds it.
    for (const track of p.tracks) {
      // Folders and VCAs carry no audio — they act on their members' gain,
      // which resolveChannels() has already folded into each member's state.
      if (!isAudioTrackType(track.type)) continue;
      if (!this.channels.has(track.id)) this.channels.set(track.id, this.buildChannel(track.id));
      // A frozen track plays its print, so it owns no instrument at all: this
      // is where the CPU a freeze buys back actually comes from, and it is why
      // the instrument is torn down rather than left idle.
      if (isFrozen(track)) {
        if (this.instruments.has(track.id)) {
          this.instruments.get(track.id)!.dispose();
          this.instruments.delete(track.id);
          this.instrumentKind.delete(track.id);
        }
        continue;
      }
      const hasInstrument = track.type === 'instrument' || track.type === 'drum';
      if (!hasInstrument) continue;
      const kind = track.rack?.items.length
        ? `rack:${track.rack.items.map((i) => `${i.id}~${i.kind}`).join(',')}`
        : track.sampler
          ? 'sampler'
          : 'synth';
      if (this.instruments.has(track.id) && this.instrumentKind.get(track.id) !== kind) {
        this.instruments.get(track.id)!.dispose();
        this.instruments.delete(track.id);
      }
      if (!this.instruments.has(track.id)) {
        const ch = this.channels.get(track.id)!;
        this.instruments.set(track.id, this.buildInstrument(ctx, ch.input, track.id, kind));
        this.instrumentKind.set(track.id, kind);
      }
    }

    // 2. remove channels for deleted tracks (and for tracks that became a
    // folder or a VCA, which no longer own one)
    const liveIds = new Set(p.tracks.filter((x) => isAudioTrackType(x.type)).map((x) => x.id));
    for (const [id, ch] of this.channels) {
      if (!liveIds.has(id)) {
        this.stopSourcesWhere((h) => h.trackId === id, true);
        this.stopMonitoring(id);
        this.instruments.get(id)?.dispose();
        this.instruments.delete(id);
        for (const node of ch.sends.values()) {
          try {
            node.disconnect();
          } catch {
            /* already gone */
          }
        }
        ch.sends.clear();
        try {
          ch.keySend?.disconnect();
        } catch {
          /* already gone */
        }
        this.disposeTap(id);
        this.meterWatchers.delete(id);
        ch.inserts.dispose();
        try {
          ch.input.disconnect();
          ch.trim.disconnect();
          ch.muteGain.disconnect();
          ch.volGain.disconnect();
          ch.panner.disconnect();
          ch.analyser.disconnect();
        } catch {}
        this.channels.delete(id);
        this.meterData.delete(id);
      }
    }

    // 3. apply params + routing. Mute, solo, VCA and folder gain are resolved
    // once, as pure data, so the engine, the meters and the bounce cannot
    // disagree about what is audible.
    const states = resolveChannels(p, this.monitorCueId);
    for (const track of p.tracks) {
      const ch = this.channels.get(track.id);
      if (!ch) continue;
      const state = states.get(track.id)!;
      const audible = state.audible;
      const smooth = initial ? 0.001 : PARAM_TAU;
      const owned = this.autoOwned.get(track.id);
      ch.inserts.sync(track.effects ?? [], p.bpm, this.fxOverrides.get(track.id));
      // Input trim carries polarity: a negative gain IS the polarity flip, so
      // the two never need separate nodes and can never fight each other.
      const trimGain = Math.pow(10, (track.inputGainDb ?? 0) / 20) * (track.phaseInvert ? -1 : 1);
      safeSet(ch.trim.gain, trimGain, t, smooth);
      const wantMono = track.monoSum === true;
      if ((ch.trim.channelCount === 1) !== wantMono) {
        ch.trim.channelCount = wantMono ? 1 : 2;
        ch.trim.channelCountMode = wantMono ? 'explicit' : 'max';
      }
      if (!owned?.has('mute')) safeSet(ch.muteGain.gain, audible ? 1 : 0, t, smooth);
      // The fader value the automation engine owns is the track's own volume;
      // VCA and folder trims multiply on top of it here.
      if (!owned?.has('volume')) safeSet(ch.volGain.gain, state.gain, t, smooth);
      if (!owned?.has('pan')) safeSet(ch.panner.pan, state.pan, t, smooth);
      const dest = track.type === 'bus' || track.type === 'fx' ? 'master' : track.output;
      if (ch.routedTo !== dest) {
        try {
          ch.analyser.disconnect();
        } catch {}
        const destType = p.tracks.find((x) => x.id === dest)?.type;
        const target =
          dest !== 'master' && this.channels.has(dest) && (destType === 'bus' || destType === 'fx')
            ? this.channels.get(dest)!.input
            : this.masterInput;
        ch.analyser.connect(target);
        ch.routedTo = dest;
      }

      // Sidechain: another channel's post-fader signal keys this one's dynamics
      // detectors. The key tap is post-fader on the source because a kick that
      // is faded down should duck less, which is what an engineer expects.
      const keySource = track.sidechainFrom ?? null;
      if (ch.keyedFrom !== keySource) {
        if (ch.keySend) {
          try {
            ch.keySend.disconnect();
          } catch {
            /* already gone */
          }
          ch.keySend = null;
        }
        const src = keySource ? this.channels.get(keySource) : undefined;
        if (src && keySource !== track.id) {
          const node = ctx.createGain();
          src.panner.connect(node);
          for (const input of ch.inserts.sidechainInputs()) node.connect(input);
          ch.keySend = node;
          ch.inserts.setSidechain(true);
        } else {
          ch.inserts.setSidechain(false);
        }
        ch.keyedFrom = keySource;
      } else if (ch.keySend) {
        // The chain may have been rebuilt under the same routing; reconnect.
        try {
          ch.keySend.disconnect();
        } catch {
          /* already gone */
        }
        for (const input of ch.inserts.sidechainInputs()) ch.keySend.connect(input);
        ch.inserts.setSidechain(true);
      }

      // Sends: post-fader taps the panner output, pre-fader taps the channel
      // input. Buses never send onward, which keeps the graph acyclic.
      const wanted = new Map(
        (track.type === 'bus' || track.type === 'fx' ? [] : (track.sends ?? []))
          .filter((s) => this.channels.has(s.busId) && s.busId !== track.id)
          .map((s) => [s.busId, s]),
      );
      for (const [busId, node] of [...ch.sends]) {
        if (!wanted.has(busId)) {
          try {
            node.disconnect();
          } catch {
            /* already gone */
          }
          ch.sends.delete(busId);
        }
      }
      for (const [busId, send] of wanted) {
        let node = ch.sends.get(busId);
        if (!node) {
          node = ctx.createGain();
          node.gain.value = 0;
          // Pre-fader still means post-insert: a send should carry the sound
          // the channel actually makes, just not its fader move.
          const tap: AudioNode = send.preFader ? ch.inserts.exit : ch.panner;
          tap.connect(node);
          node.connect(this.channels.get(busId)!.input);
          ch.sends.set(busId, node);
        }
        if (!owned?.has(`send:${busId}`)) {
          const level = send.enabled && audible ? Math.max(0, send.amount) : 0;
          node.gain.setTargetAtTime(level, t, initial ? 0.001 : PARAM_TAU);
        }
      }
    }
    const master = p.master;
    const masterSmooth = initial ? 0.001 : PARAM_TAU;
    this.masterGain.gain.setTargetAtTime(master?.volume ?? p.masterVolume, t, masterSmooth);
    this.masterPan?.pan.setTargetAtTime(master?.pan ?? 0, t, masterSmooth);
    this.masterInserts?.sync(master?.effects ?? [], p.bpm, this.fxOverrides.get(MASTER_ID));
    if (this.masterMono) {
      const mono = master?.monoCheck === true;
      if ((this.masterMono.channelCount === 1) !== mono) {
        this.masterMono.channelCount = mono ? 1 : 2;
        this.masterMono.channelCountMode = mono ? 'explicit' : 'max';
      }
    }
    if (this.limiter) {
      // Disengaging the safety limiter raises its threshold out of the way
      // rather than rewiring the chain, so nothing clicks on the toggle.
      this.limiter.threshold.setTargetAtTime(master?.limiter === false ? 0 : -1.5, t, masterSmooth);
    }
    // The click's level is the project's, like the count-in and the pre-roll.
    // It is written here and nowhere else, on the one gain node that sits
    // outside the mix — so turning the click down cannot touch the programme.
    if (this.metroGain) safeSet(this.metroGain.gain, clickGain(p), t, masterSmooth);
    this.syncFreezeMedia(p);
    // Values at the playhead may have changed with the edit (or a lane may
    // have just been disabled and released its parameter).
    this.autoDirty = true;
    this.applyAutomation();

    // 4. stop sources whose clip vanished or got muted
    const clipState = new Map(p.clips.map((c) => [c.id, c.muted]));
    this.stopSourcesWhere((h) => {
      if (!h.clipId) return false;
      // A freeze plays a clip that is not in the project — it stands in for
      // the instrument, not for anything on the timeline — so an unknown id
      // here means "synthetic", not "deleted". Its own track losing the freeze
      // is what stops it, below.
      if (isFreezeClipId(h.clipId)) return false;
      const muted = clipState.get(h.clipId);
      return muted === undefined || muted === true;
    });
    for (const [trackId] of this.freezePlaying) {
      const track = p.tracks.find((x) => x.id === trackId);
      if (!track || !isFrozen(track)) {
        this.stopSourcesWhere((h) => h.clipId === FREEZE_CLIP_PREFIX + trackId);
      }
    }

    // 5. tempo change during playback → retime scheduler
    if (this.playing && this.lastBpm !== p.bpm) this.scheduler.retime();
    this.lastBpm = p.bpm;
  }

  private sourceRegistry() {
    return {
      register: (h: ActiveHandle) => this.registerSource(h),
      unregister: (h: ActiveHandle) => this.unregisterSource(h),
      canAllocate: () => this.canAllocate(),
    };
  }

  private readSynthParams(trackId: string): SynthParams {
    const tr = useProjectStore.getState().project.tracks.find((x) => x.id === trackId);
    const base = tr?.synth ?? FALLBACK_SYNTH;
    const ov = this.synthOverrides.get(trackId);
    return ov ? { ...base, ...ov } : base;
  }

  private readSamplerParams(trackId: string): SamplerParams {
    const tr = useProjectStore.getState().project.tracks.find((x) => x.id === trackId);
    const base = tr?.sampler ?? defaultSamplerParams('quick');
    const ov = this.samplerOverrides.get(trackId);
    return ov ? { ...base, ...ov } : base;
  }

  private buildInstrument(
    ctx: AudioContext,
    out: AudioNode,
    trackId: string,
    kind: string,
  ): Instrument {
    const registry = this.sourceRegistry();
    if (kind === 'sampler') {
      return new SamplerInstrument(
        ctx,
        out,
        trackId,
        () => this.readSamplerParams(trackId),
        registry,
      );
    }
    if (kind.startsWith('rack:')) {
      // Child instruments are created once per rack shape; ranges and
      // mute/solo read live from the store on every trigger.
      const trackNow = useProjectStore.getState().project.tracks.find((x) => x.id === trackId);
      const children: RackChild[] = (trackNow?.rack?.items ?? []).map((item) => ({
        id: item.id,
        keyLo: item.keyLo,
        keyHi: item.keyHi,
        muted: item.muted,
        solo: item.solo,
        instrument:
          item.kind === 'sampler'
            ? new SamplerInstrument(
                ctx,
                out,
                trackId,
                () => {
                  const it = useProjectStore
                    .getState()
                    .project.tracks.find((x) => x.id === trackId)
                    ?.rack?.items.find((x) => x.id === item.id);
                  return it?.sampler ?? defaultSamplerParams('quick');
                },
                registry,
              )
            : new PolySynth(
                ctx,
                out,
                trackId,
                () => {
                  const it = useProjectStore
                    .getState()
                    .project.tracks.find((x) => x.id === trackId)
                    ?.rack?.items.find((x) => x.id === item.id);
                  return it?.synth ?? FALLBACK_SYNTH;
                },
                registry,
              ),
      }));
      return new RackInstrument(() => {
        const items = useProjectStore.getState().project.tracks.find((x) => x.id === trackId)
          ?.rack?.items;
        return children.map((c) => {
          const it = items?.find((x) => x.id === c.id);
          return it
            ? { ...c, keyLo: it.keyLo, keyHi: it.keyHi, muted: it.muted, solo: it.solo }
            : c;
        });
      });
    }
    const trackNow = useProjectStore.getState().project.tracks.find((x) => x.id === trackId);
    return trackNow?.type === 'drum' && !trackNow.sampler
      ? new DrumKit(ctx, out, trackId, () => this.readSynthParams(trackId), registry)
      : new PolySynth(ctx, out, trackId, () => this.readSynthParams(trackId), registry);
  }

  private buildChannel(trackId: string): Channel {
    const ctx = this.ctx!;
    const input = ctx.createGain();
    const trim = ctx.createGain();
    const inserts = new InsertChain(ctx);
    const muteGain = ctx.createGain();
    const volGain = ctx.createGain();
    const panner = ctx.createStereoPanner();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    // input → trim → inserts → mute → volume → pan → analyser → destination.
    // The trim carries input gain and polarity, so a compressor downstream sees
    // the level the engineer set; inserts sit ahead of the fader so moving the
    // fader does not change how hard that compressor works.
    input.connect(trim);
    trim.connect(inserts.entry);
    inserts.exit.connect(muteGain);
    muteGain.connect(volGain);
    volGain.connect(panner);
    panner.connect(analyser);
    analyser.connect(this.masterInput!);
    return {
      trackId,
      keySend: null,
      keyedFrom: null,
      input,
      trim,
      inserts,
      muteGain,
      volGain,
      panner,
      analyser,
      tap: null,
      routedTo: 'master',
      sends: new Map(),
    };
  }

  // ---------- input monitoring ----------

  /**
   * Route a track's selected input into its own channel, so monitored audio is
   * shaped by that track's volume, pan, mute/solo and bus routing exactly like
   * recorded material will be.
   */
  async startMonitoring(trackId: string, deviceId: string): Promise<boolean> {
    const ok = await this.start();
    const ctx = this.ctx;
    if (!ok || !ctx) return false;
    const ch = this.channels.get(trackId);
    if (!ch) return false;
    // Toggling repeatedly must not stack nodes: always tear down first.
    if (this.monitors.has(trackId)) this.stopMonitoring(trackId);

    const source = await audioInput.acquire(deviceId, `monitor:${trackId}`, ctx);
    if (!source) return false;
    const gain = ctx.createGain();
    gain.gain.value = 1;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    source.connect(gain);
    gain.connect(analyser);
    analyser.connect(ch.input);
    this.monitors.set(trackId, { deviceId, source, gain, analyser });
    useInputStore.getState().set({ activeStreams: audioInput.activeStreamCount() });
    diagLog('info', `Monitoring started on track ${trackId} (${deviceId})`);
    return true;
  }

  stopMonitoring(trackId: string): void {
    const m = this.monitors.get(trackId);
    if (!m) return;
    try {
      m.source.disconnect(m.gain);
      m.gain.disconnect();
      m.analyser.disconnect();
    } catch {
      /* already torn down */
    }
    this.monitors.delete(trackId);
    audioInput.release(m.deviceId, `monitor:${trackId}`);
    useInputStore.getState().set({ activeStreams: audioInput.activeStreamCount() });
    diagLog('info', `Monitoring stopped on track ${trackId}`);
  }

  isMonitoring(trackId: string): boolean {
    return this.monitors.has(trackId);
  }

  monitoringCount(): number {
    return this.monitors.size;
  }

  /** Peak level of a monitored input, 0..1, for the input meter. */
  inputLevel(trackId: string): number {
    const m = this.monitors.get(trackId);
    if (!m) return 0;
    const n = m.analyser.fftSize;
    const buf = this.scratch.subarray(0, n);
    m.analyser.getFloatTimeDomainData(buf);
    let peak = 0;
    for (let i = 0; i < n; i++) {
      const v = Math.abs(buf[i]);
      if (v > peak) peak = v;
    }
    return peak;
  }

  stopAllMonitoring(): void {
    for (const id of [...this.monitors.keys()]) this.stopMonitoring(id);
  }

  // ---------- automation ----------

  /**
   * Resolve every applied lane to its target once per project change. A lane
   * participates when it is enabled, has points, and the track's automation
   * mode is not 'off'. `autoOwned` records which core parameters the applier
   * owns so syncGraph leaves them alone.
   */
  private buildAutoIndex(p: ProjectData): void {
    const entries: AutoEntry[] = [];
    const owned = new Map<string, Set<string>>();
    const fxOv = new Map<string, Map<string, Record<string, number>>>();
    const liveLanes = new Set<string>();

    for (const track of p.tracks) {
      if (!track.automation || track.automationMode === 'off') continue;
      for (const lane of track.automation) {
        if (!lane.enabled || lane.points.length === 0) continue;
        const param = findAutoParam(track, p, lane.paramId);
        if (!param) continue;
        const id = lane.paramId;
        let entry: AutoEntry | null = null;
        if (id === 'volume' || id === 'pan' || id === 'mute') {
          entry = { trackId: track.id, laneId: lane.id, points: lane.points, param, kind: id };
        } else if (id.startsWith('send:')) {
          entry = {
            trackId: track.id,
            laneId: lane.id,
            points: lane.points,
            param,
            kind: 'send',
            busId: id.slice(5),
          };
        } else if (id.startsWith('fx:')) {
          const [, effectId, paramKey] = id.split(':');
          entry = {
            trackId: track.id,
            laneId: lane.id,
            points: lane.points,
            param,
            kind: 'fx',
            effectId,
            paramKey,
          };
          if (!fxOv.has(track.id)) fxOv.set(track.id, new Map());
        } else if (id.startsWith('synth:')) {
          entry = {
            trackId: track.id,
            laneId: lane.id,
            points: lane.points,
            param,
            kind: 'synth',
            paramKey: id.slice(6),
          };
        } else if (id.startsWith('smp:')) {
          entry = {
            trackId: track.id,
            laneId: lane.id,
            points: lane.points,
            param,
            kind: 'smp',
            paramKey: id.slice(4),
          };
        }
        if (!entry) continue;
        entries.push(entry);
        liveLanes.add(lane.id);
        if (entry.kind === 'volume' || entry.kind === 'pan' || entry.kind === 'mute') {
          if (!owned.has(track.id)) owned.set(track.id, new Set());
          owned.get(track.id)!.add(id);
        } else if (entry.kind === 'send') {
          if (!owned.has(track.id)) owned.set(track.id, new Set());
          owned.get(track.id)!.add(id);
        }
      }
    }

    this.autoIndex = entries;
    this.autoOwned = owned;
    // Drop caches/overrides for lanes that no longer apply, so a deleted or
    // disabled lane releases its parameter back to the static value.
    for (const key of [...this.autoApplied.keys()]) {
      if (!liveLanes.has(key)) this.autoApplied.delete(key);
    }
    const liveSynthTracks = new Set(
      entries.filter((e) => e.kind === 'synth').map((e) => e.trackId),
    );
    for (const id of [...this.synthOverrides.keys()]) {
      if (!liveSynthTracks.has(id)) this.synthOverrides.delete(id);
    }
    const liveSamplerTracks = new Set(
      entries.filter((e) => e.kind === 'smp').map((e) => e.trackId),
    );
    for (const id of [...this.samplerOverrides.keys()]) {
      if (!liveSamplerTracks.has(id)) this.samplerOverrides.delete(id);
    }
    // fx overrides are rebuilt each apply pass; keep only tracks still automated
    for (const id of [...this.fxOverrides.keys()]) {
      if (!fxOv.has(id)) this.fxOverrides.delete(id);
    }
    for (const [id, m] of fxOv) {
      if (!this.fxOverrides.has(id)) this.fxOverrides.set(id, m);
    }
  }

  /**
   * Apply automated values at the current position. Runs on the frame loop —
   * cheap when paused (position unchanged → one comparison), bounded during
   * playback by an epsilon skip per lane. Every write is a setTargetAtTime
   * ramp, never a direct value assignment, so there is no zipper stepping.
   */
  private applyAutomation(): void {
    const ctx = this.ctx;
    if (!ctx || this.autoIndex.length === 0) {
      this.lastAutoPos = -1;
      return;
    }
    const pos = this.getPositionBeats();
    if (!this.autoDirty && pos === this.lastAutoPos) return;
    this.autoDirty = false;
    this.lastAutoPos = pos;

    const p = useProjectStore.getState().project;
    const t = ctx.currentTime;
    /** effects whose automated params changed this pass */
    const fxTouched = new Set<string>();
    const states = resolveChannels(p, this.monitorCueId);

    for (const e of this.autoIndex) {
      const n = laneValueAt(e.points, pos);
      if (n === null) continue;
      const last = this.autoApplied.get(e.laneId);
      if (last !== undefined && Math.abs(last - n) < 0.0008) continue;
      this.autoApplied.set(e.laneId, n);
      const ch = this.channels.get(e.trackId);
      if (!ch) continue;
      const track = p.tracks.find((x) => x.id === e.trackId);
      if (!track) continue;
      const v = denormParam(e.param, n);
      const state = states.get(e.trackId);

      switch (e.kind) {
        case 'volume':
          // The lane writes the channel's own fader; the group multiplier is
          // reapplied here so a VCA or folder trim keeps working under
          // automation instead of being overwritten by it. A channel a cue has
          // taken over keeps the cue's level: the lane is the main mix's, and
          // this is not the main mix.
          safeSet(
            ch.volGain.gain,
            state?.cueOverride
              ? state.gain
              : Math.max(0, v) * (state?.groupGain ?? 1) * (state?.cueScale ?? 1),
            t,
            AUTO_TAU,
          );
          break;
        case 'pan':
          safeSet(
            ch.panner.pan,
            state?.cueOverride ? state.pan : Math.max(-1, Math.min(1, v)),
            t,
            AUTO_TAU,
          );
          break;
        case 'mute': {
          const open = (state?.audible ?? true) && (state?.cueOverride || v < 0.5);
          safeSet(ch.muteGain.gain, open ? 1 : 0, t, 0.008);
          break;
        }
        case 'send': {
          const node = e.busId ? ch.sends.get(e.busId) : undefined;
          if (!node) break;
          const send = track.sends?.find((s) => s.busId === e.busId);
          const level = send?.enabled && (state?.audible ?? true) ? Math.max(0, v) : 0;
          safeSet(node.gain, level, t, AUTO_TAU);
          break;
        }
        case 'fx': {
          if (!e.effectId || !e.paramKey) break;
          let m = this.fxOverrides.get(e.trackId);
          if (!m) {
            m = new Map();
            this.fxOverrides.set(e.trackId, m);
          }
          const params = m.get(e.effectId) ?? {};
          params[e.paramKey] = v;
          m.set(e.effectId, params);
          fxTouched.add(`${e.trackId}|${e.effectId}`);
          break;
        }
        case 'synth': {
          if (!e.paramKey) break;
          const ov = this.synthOverrides.get(e.trackId) ?? {};
          (ov as Record<string, number>)[e.paramKey] = v;
          this.synthOverrides.set(e.trackId, ov);
          break;
        }
        case 'smp': {
          if (!e.paramKey) break;
          const ov = this.samplerOverrides.get(e.trackId) ?? {};
          (ov as Record<string, number>)[e.paramKey] = v;
          this.samplerOverrides.set(e.trackId, ov);
          break;
        }
      }
    }

    for (const key of fxTouched) {
      const [trackId, effectId] = key.split('|');
      const ch = this.channels.get(trackId);
      const track = p.tracks.find((x) => x.id === trackId);
      const fx = track?.effects?.find((x) => x.id === effectId);
      const params = this.fxOverrides.get(trackId)?.get(effectId);
      if (ch && fx && params) ch.inserts.updateOne(fx, p.bpm, params);
    }
  }

  /** Debug/test probe: the value automation resolves for a parameter right now. */
  automationValueAt(trackId: string, paramId: string): { norm: number; value: number } | null {
    const entry = this.autoIndex.find((e) => e.trackId === trackId && e.param.id === paramId);
    if (!entry) return null;
    const n = laneValueAt(entry.points, this.getPositionBeats());
    if (n === null) return null;
    return { norm: n, value: denormParam(entry.param, n) };
  }

  // ---------- source registry ----------

  private canAllocate(): boolean {
    if (this.activeSources.size >= MAX_ACTIVE_SOURCES) {
      diagLog('warn', `Active source cap (${MAX_ACTIVE_SOURCES}) reached — skipping source`);
      return false;
    }
    return true;
  }

  private registerSource(h: ActiveHandle): void {
    this.activeSources.add(h);
  }

  private unregisterSource(h: ActiveHandle): void {
    this.activeSources.delete(h);
  }

  activeSourceCount(): number {
    return this.activeSources.size;
  }

  private stopSourcesWhere(pred: (h: ActiveHandle) => boolean, hard = false): void {
    for (const h of [...this.activeSources]) {
      if (pred(h)) h.stop(hard);
    }
  }

  private stopAllSources(hard: boolean): void {
    for (const h of [...this.activeSources]) h.stop(hard);
    for (const inst of this.instruments.values()) inst.allNotesOff();
  }

  // ---------- scheduling callbacks ----------

  /**
   * Bring the print a track is currently playing to an end at `when`.
   *
   * Scheduled rather than immediate: the caller is scheduling the next pass
   * ahead of time (a loop wrap is up to a lookahead away), and stopping the
   * old pass now would leave a hole until then.
   */
  private endFreezeSource(trackId: string, when: number): void {
    const prev = this.freezePlaying.get(trackId);
    if (!prev || !this.ctx) return;
    this.freezePlaying.delete(trackId);
    const from = Math.max(this.ctx.currentTime, when - 0.004);
    prev.gain.gain.cancelScheduledValues(from);
    prev.gain.gain.setTargetAtTime(0, from, 0.0015);
    try {
      prev.src.stop(when + 0.02);
    } catch {
      /* already stopped */
    }
  }

  /**
   * Keep the prints decoded, and only the prints still in use.
   *
   * A freeze is played from a media file like any other, but nothing on the
   * timeline points at it — so the load that happens for clips at project open
   * has to happen here as well, for a project that opens frozen and for a
   * freeze that undo brings back. The mirror image matters just as much: a
   * released print is the largest thing the session is still holding, so its
   * decode is dropped as soon as no track plays it.
   */
  private syncFreezeMedia(p: ProjectData): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const live = new Set<string>();
    for (const track of p.tracks) {
      if (!isFrozen(track)) continue;
      const id = track.freeze!.mediaId;
      live.add(id);
      if (getBufferSync(id) || this.freezeLoading.has(id)) continue;
      this.freezeLoading.add(id);
      void loadBuffer(id, ctx).then((buf) => {
        this.freezeLoading.delete(id);
        if (!buf) {
          diagLog('warn', `Frozen track "${track.name}" has no print in storage — it is silent`);
        }
      });
    }
    for (const id of [...this.freezeMediaIds]) {
      if (live.has(id)) continue;
      this.freezeMediaIds.delete(id);
      evict(id);
    }
    for (const id of live) this.freezeMediaIds.add(id);
  }

  /**
   * Schedule one audio clip.
   *
   * Clip gain and the fade envelopes are applied here, on a per-source gain
   * node, ahead of the track channel — so editing them is nondestructive and
   * never touches the stored media. `offsetSec` is an absolute position into
   * the source, already including the clip's own trim offset.
   */
  private scheduleClip(clip: AudioClip, when: number, offsetSec: number): void {
    const p = useProjectStore.getState().project;
    const spb = clipSecondsPerBeat(p, clip);
    // Take clips expand into one source per comp span; each span reschedules
    // through the plain path so a comp cannot behave differently from clips.
    if (clip.takes && clip.takes.length > 0) {
      const entryIntoClipSec = Math.max(0, offsetSec - clip.offset);
      for (const v of expandCompClip(clip, spb)) {
        const spanStartSec = (v.start - clip.start) * spb;
        const spanEndSec = spanStartSec + v.length * spb;
        if (spanEndSec <= entryIntoClipSec + 0.001) continue;
        if (spanStartSec >= entryIntoClipSec) {
          this.scheduleAudioSource(v, when + (spanStartSec - entryIntoClipSec), v.offset);
        } else {
          this.scheduleAudioSource(v, when, v.offset + (entryIntoClipSec - spanStartSec));
        }
      }
      return;
    }
    this.scheduleAudioSource(clip, when, offsetSec);
  }

  private scheduleAudioSource(clip: AudioClip, when: number, offsetSec: number): void {
    const ctx = this.ctx;
    const ch = this.channels.get(clip.trackId);
    if (!ctx || !ch || !this.canAllocate()) return;
    const p = useProjectStore.getState().project;
    const spb = clipSecondsPerBeat(p, clip);
    /**
     * A print already carries the channel's trim and inserts, so it joins the
     * channel at the insert chain's output — the exact point it was taken
     * from. Everything downstream of there still applies to it live: mute,
     * fader, pan, both kinds of send and all of their automation. Feeding it
     * back in at the top would run every insert on it twice.
     */
    const frozen = isFreezeClipId(clip.id);
    const dest: AudioNode = frozen ? ch.inserts.exit : ch.input;
    // One print at a time per track. A loop wrap re-enters the print while the
    // previous pass is still running its whole length, so the old one is faded
    // out to land exactly where the new one starts rather than stacking.
    if (frozen) this.endFreezeSource(clip.trackId, when);

    // Playback rate and which buffer to use are one decision. A clip that
    // follows the tempo, is stretched, or is transposed either resamples
    // (cheap, and takes the pitch with it) or plays a pre-rendered stretch
    // (pitch preserved). While that render is in flight the resampled path
    // keeps sounding, because a silent clip is worse than a briefly wrong one.
    const plan = clipRatePlan(p, clip, spb);
    // The warp map is applied first, by rendering the source onto its own
    // musical grid: everything after it — tempo follow, stretch, transpose —
    // then works on material that is already in time, exactly as it does for a
    // clip with no map at all. Until that render lands the clip plays unwarped
    // rather than silent, the same trade the stretch cache makes.
    const warp = clipWarpMap(clip);
    const warped = warp ? warpedBuffer(ctx, clip.mediaId, warp) : null;
    const timing = warped && warp ? warpedClipTiming(clip, warp) : clip;
    if (warped && warp) offsetSec = warpedTimeSec(warp, offsetSec);
    let buffer =
      plan.preservePitch && plan.timeRatio !== 1
        ? stretchedBuffer(ctx, clip.mediaId, plan.timeRatio, plan.semitones, warp)
        : (warped ?? getBufferSync(clip.mediaId));
    let rate = plan.rate;
    if (!buffer) {
      buffer = warped ?? getBufferSync(clip.mediaId);
      // The pre-render is not ready: fall back to resampling at the same speed.
      rate = plan.fallbackRate;
    } else if (plan.preservePitch && plan.timeRatio !== 1) {
      // The stretched buffer already carries the tempo and the transposition.
      rate = 1;
      offsetSec = offsetSec / plan.timeRatio;
    }
    if (!buffer) return;
    // Duration and gain envelope come from the shared scheduler so that an
    // exported bounce is sample-for-sample the same decision as live playback.
    const schedule = computeClipSchedule(
      timing,
      offsetSec,
      buffer.duration,
      plan.preservePitch && plan.timeRatio !== 1 ? spb / plan.timeRatio : spb,
    );
    if (!schedule) return;

    const src = ctx.createBufferSource();
    src.buffer = buffer;
    if (rate !== 1) src.playbackRate.value = rate;
    const g = ctx.createGain();
    if (clip.monoSum) {
      // Explicit mono forces an equal-weight downmix through this node.
      g.channelCount = 1;
      g.channelCountMode = 'explicit';
    }
    applyEnvelope(g.gain, schedule.envelope, when);

    src.connect(g);

    /**
     * Event FX: a clip's own insert chain, built per scheduled source and torn
     * down with it. It sits between the clip and the channel, so it processes
     * this clip and nothing else on the track — which is the whole point of a
     * per-event effect, and why it cannot live on the channel.
     */
    let eventChain: InsertChain | null = null;
    if (clip.eventFx?.length) {
      eventChain = new InsertChain(ctx);
      eventChain.sync(clip.eventFx, p.bpm);
      g.connect(eventChain.entry);
      eventChain.exit.connect(dest);
    } else {
      g.connect(dest);
    }

    const handle: ActiveHandle = {
      kind: 'buffer',
      trackId: clip.trackId,
      // Comp spans carry synthetic ids (`<clipId>~<takeId>~<n>`); the registry
      // must track the real clip so mute/delete stops its running spans.
      clipId: clip.id.split('~')[0],
      stop: (hard) => {
        const t = ctx.currentTime;
        g.gain.setTargetAtTime(0, t, hard ? 0.004 : 0.012);
        try {
          src.stop(t + 0.05);
        } catch {}
      },
    };
    if (frozen) this.freezePlaying.set(clip.trackId, { src, gain: g });
    src.onended = () => {
      this.unregisterSource(handle);
      if (this.freezePlaying.get(clip.trackId)?.src === src) {
        this.freezePlaying.delete(clip.trackId);
      }
      try {
        src.disconnect();
        g.disconnect();
        eventChain?.dispose();
      } catch {
        /* already gone */
      }
    };
    this.registerSource(handle);
    // `duration` is in SOURCE seconds; a resampled clip consumes that much
    // material and simply finishes sooner, which is what the rate means.
    src.start(when, schedule.offsetSec, schedule.durSec);
  }

  private auditionState: { src: AudioBufferSourceNode; g: GainNode; mediaId: string } | null = null;

  /**
   * Preview a media item from the browser: one shot, straight to the master,
   * outside the transport. Starting a new audition replaces the running one,
   * so tapping through a list never stacks sounds.
   */
  async audition(mediaId: string): Promise<boolean> {
    const ok = await this.start();
    const ctx = this.ctx;
    if (!ok || !ctx || !this.masterInput) return false;
    const buffer = getBufferSync(mediaId) ?? (await loadBuffer(mediaId, ctx));
    if (!buffer) return false;

    this.stopAudition();
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const g = ctx.createGain();
    g.gain.value = 0.9;
    src.connect(g);
    g.connect(this.masterInput);
    const state = { src, g, mediaId };
    this.auditionState = state;
    src.onended = () => {
      if (this.auditionState === state) this.auditionState = null;
      try {
        src.disconnect();
        g.disconnect();
      } catch {
        /* already gone */
      }
    };
    src.start();
    return true;
  }

  stopAudition(): void {
    const a = this.auditionState;
    if (!a) return;
    this.auditionState = null;
    const t = this.ctx?.currentTime ?? 0;
    a.g.gain.setTargetAtTime(0, t, 0.015);
    try {
      a.src.stop(t + 0.06);
    } catch {
      /* already stopped */
    }
  }

  /** The media id currently auditioning, or null. */
  auditioningId(): string | null {
    return this.auditionState?.mediaId ?? null;
  }

  /**
   * Sources belonging to a running listen preview are tagged with a clip id
   * that no clip has, so ending the preview stops exactly its own voices and
   * leaves the transport's voices for the same clip playing.
   */
  private previewTag: string | null = null;
  private previewTimer: ReturnType<typeof setInterval> | null = null;
  /**
   * Bumped by every start and every stop. Media loads and context unlocks are
   * asynchronous; a preview whose buffer arrives after the pointer went up
   * must not start sounding, and the generation is how it finds that out.
   */
  private previewGen = 0;

  /**
   * Listen to one clip from a point inside it, for as long as the caller holds
   * it — the arrangement's listen tool.
   *
   * It runs beside the transport, never through it: nothing here seeks, starts
   * or stops the scheduler, so a listen during playback is additive and a
   * listen while stopped leaves the position where the musician left it.
   */
  async previewClip(clipId: string, fromBeat: number): Promise<boolean> {
    this.stopPreview();
    const gen = ++this.previewGen;
    const ok = await this.start();
    const ctx = this.ctx;
    if (!ok || !ctx || gen !== this.previewGen) return false;
    const p = useProjectStore.getState().project;
    const clip = p.clips.find((c) => c.id === clipId);
    if (!clip) return false;
    const at = Math.min(Math.max(fromBeat, clip.start), clip.start + clip.length);
    this.previewTag = `${clip.id}~listen`;
    return clip.type === 'audio'
      ? this.previewAudioClip(clip, at, gen)
      : this.previewMidiClip(clip, at, gen);
  }

  private async previewAudioClip(clip: AudioClip, atBeat: number, gen: number): Promise<boolean> {
    const ctx = this.ctx;
    const dest = this.channels.get(clip.trackId)?.input ?? this.masterInput;
    if (!ctx || !dest) return false;
    const buffer = getBufferSync(clip.mediaId) ?? (await loadBuffer(clip.mediaId, ctx));
    if (!buffer || gen !== this.previewGen) return false;
    const p = useProjectStore.getState().project;
    const spb = clipSecondsPerBeat(p, clip);
    const into = Math.max(0, atBeat - clip.start);
    // Resampling rather than the stretch cache: a preview is wanted now, and
    // a pre-render that has not been asked for yet would arrive after the
    // finger came off. The speed is right; a stretched clip previews at the
    // pitch resampling gives it.
    const rate = clipRatePlan(p, clip, spb).fallbackRate;
    const schedule = computeClipSchedule(clip, clip.offset + into * spb, buffer.duration, spb);
    if (!schedule) return false;

    const when = ctx.currentTime + 0.02;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    if (rate !== 1) src.playbackRate.value = rate;
    const g = ctx.createGain();
    applyEnvelope(g.gain, schedule.envelope, when);
    src.connect(g);
    g.connect(dest);
    const handle: ActiveHandle = {
      kind: 'buffer',
      trackId: clip.trackId,
      clipId: this.previewTag ?? undefined,
      stop: (hard) => {
        const t = ctx.currentTime;
        g.gain.cancelScheduledValues(t);
        g.gain.setTargetAtTime(0, t, hard ? 0.004 : 0.012);
        try {
          src.stop(t + 0.05);
        } catch {
          /* already stopped */
        }
      },
    };
    src.onended = () => {
      this.unregisterSource(handle);
      try {
        src.disconnect();
        g.disconnect();
      } catch {
        /* already gone */
      }
    };
    this.registerSource(handle);
    src.start(when, schedule.offsetSec, schedule.durSec);
    return true;
  }

  private previewMidiClip(clip: MidiClip, atBeat: number, gen: number): boolean {
    const ctx = this.ctx;
    const inst = this.instruments.get(clip.trackId);
    const tag = this.previewTag;
    if (!ctx || !inst || !tag) return false;
    const p = useProjectStore.getState().project;
    const map = tempoMapOf(p);
    const track = p.tracks.find((t) => t.id === clip.trackId);
    // A note already sounding at the press point starts immediately with what
    // is left of it: pressing inside a held chord should sound the chord.
    const events = playedNotes(p, clip, track)
      .filter((n) => !n.muted && n.start < clip.length)
      .map((n) => ({
        pitch: n.pitch,
        velocity: n.velocity,
        beat: Math.max(clip.start + n.start, atBeat),
        end: clip.start + Math.min(n.start + n.length, clip.length),
      }))
      .filter((e) => e.end > atBeat)
      .sort((a, b) => a.beat - b.beat);

    const t0 = ctx.currentTime + 0.03;
    const startSec = beatToSec(map, atBeat);
    let next = 0;
    /**
     * An instrument builds a voice the moment it is handed a note, so a
     * preview cannot give it the whole clip at once — it would spend every
     * voice it has on notes a minute away and steal them back before they
     * sounded. Same lookahead pump as the transport, for the same reason.
     */
    const pump = () => {
      if (gen !== this.previewGen) return;
      const horizon = secToBeat(map, ctx.currentTime - t0 + startSec + PREVIEW_LOOKAHEAD_SEC);
      while (next < events.length && events[next].beat <= horizon) {
        const e = events[next++];
        const at = beatToSec(map, e.beat);
        inst.scheduleNote(e.pitch, e.velocity, t0 + at - startSec, beatToSec(map, e.end) - at, tag);
      }
    };
    pump();
    this.previewTimer = setInterval(pump, PREVIEW_TICK_MS);
    return true;
  }

  /** End the listen preview. Safe to call when nothing is previewing. */
  stopPreview(): void {
    this.previewGen++;
    if (this.previewTimer !== null) {
      clearInterval(this.previewTimer);
      this.previewTimer = null;
    }
    const tag = this.previewTag;
    if (!tag) return;
    this.previewTag = null;
    this.stopSourcesWhere((h) => h.clipId === tag);
  }

  /**
   * The transport's own click.
   *
   * The one click "only while recording" can silence: the count-in's clicks
   * come through `playMetronomeClick` instead, because a count-in with no
   * click is not a count-in.
   */
  scheduleTransportClick(when: number, accent: boolean): void {
    const p = useProjectStore.getState().project;
    if (!clickSounds(p, useInputStore.getState().phase)) return;
    this.scheduleMetronomeClick(when, accent);
  }

  /** Immediate metronome click, used by the recording count-in. */
  playMetronomeClick(accent: boolean): void {
    const ctx = this.ctx;
    if (!ctx) return;
    this.scheduleMetronomeClick(ctx.currentTime + 0.01, accent);
  }

  private scheduleMetronomeClick(when: number, accent: boolean): void {
    const ctx = this.ctx;
    if (!ctx || !this.metroGain || !this.canAllocate()) return;
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = accent ? 1760 : 1175;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(accent ? 0.5 : 0.32, when + 0.002);
    g.gain.setTargetAtTime(0, when + 0.015, 0.012);
    osc.connect(g);
    g.connect(this.metroGain);
    const handle: ActiveHandle = {
      kind: 'metronome',
      stop: () => {
        try {
          osc.stop();
        } catch {}
      },
    };
    osc.onended = () => {
      this.unregisterSource(handle);
      try {
        osc.disconnect();
        g.disconnect();
      } catch {}
    };
    this.registerSource(handle);
    osc.start(when);
    osc.stop(when + 0.12);
  }

  // ---------- transport ----------

  isPlaying(): boolean {
    return this.playing;
  }

  async play(fromBeat?: number): Promise<void> {
    const ok = await this.start();
    if (!ok) return;
    if (this.playing) return; // no duplicate schedulers, ever
    const startBeat = fromBeat ?? this.pausedAtBeat;
    this.playing = true;
    this.scheduler.start(startBeat);
    useTransportStore.getState().set({ playState: 'playing' });
    diagLog('info', `Transport play from beat ${startBeat.toFixed(2)}`);
  }

  stop(): void {
    if (!this.playing) {
      // second stop press: return to start (common DAW convention)
      this.pausedAtBeat = 0;
      useTransportStore.getState().set({ positionBeats: 0 });
      return;
    }
    this.pausedAtBeat = this.scheduler.positionBeats();
    this.scheduler.stop();
    this.playing = false;
    this.stopAllSources(false);
    useTransportStore.getState().set({ playState: 'stopped', positionBeats: this.pausedAtBeat });
    diagLog('info', `Transport stopped at beat ${this.pausedAtBeat.toFixed(2)}`);
  }

  togglePlay(): void {
    if (this.playing) this.stop();
    else void this.play();
  }

  returnToStart(): void {
    if (this.playing) this.seek(0);
    else {
      this.pausedAtBeat = 0;
      useTransportStore.getState().set({ positionBeats: 0 });
    }
  }

  seek(beat: number): void {
    const b = Math.max(0, beat);
    if (this.playing) {
      this.stopAllSources(false);
      this.scheduler.jumpTo(b);
    } else {
      this.pausedAtBeat = b;
      useTransportStore.getState().set({ positionBeats: b });
    }
  }

  /** Stop-everything escape hatch: transport, sources, voices. */
  panic(): void {
    const wasPlaying = this.playing;
    if (this.playing) {
      this.scheduler.stop();
      this.playing = false;
    }
    this.stopAllSources(true);
    this.stopAudition();
    this.stopPreview();
    this.stopAllMonitoring();
    audioInput.stopAll();
    useTransportStore.getState().set({ playState: 'stopped' });
    useInputStore.getState().set({ activeStreams: 0, activeTracks: 0, inputLevel: 0 });
    diagLog(
      'warn',
      `Panic: all audio and input stopped${wasPlaying ? ' (transport was playing)' : ''}`,
    );
  }

  getPositionBeats(): number {
    return this.playing ? this.scheduler.positionBeats() : this.pausedAtBeat;
  }

  // ---------- live input ----------

  /**
   * Monitor a cue mix on the main output instead of the main mix.
   *
   * The engine holds this rather than reading it from the UI store: which mix
   * is being monitored is a property of the audio path, and the store that
   * owns panel layout has no business being a dependency of the graph.
   */
  setMonitorCue(cueId: string | null): void {
    if (this.monitorCueId === cueId) return;
    this.monitorCueId = cueId;
    this.syncGraph(useProjectStore.getState().project, false);
  }

  get monitoredCueId(): string | null {
    return this.monitorCueId;
  }

  liveNoteOn(trackId: string, pitch: number, velocity: number): void {
    // Capture happens here rather than in the Web MIDI handler: hardware MIDI,
    // the on-screen keyboard and the computer keyboard all arrive through this
    // one method, so one hook records all three.
    if (midiRecorder.isRecording) {
      midiRecorder.noteOn(trackId, pitch, velocity, this.getPositionBeats());
    }
    if (!this.isRunning()) {
      // Preserve the first note request: unlock, then trigger.
      void this.start().then((ok) => {
        if (ok) this.instruments.get(trackId)?.noteOn(pitch, velocity);
      });
      return;
    }
    this.instruments.get(trackId)?.noteOn(pitch, velocity);
  }

  liveNoteOff(trackId: string, pitch: number): void {
    if (midiRecorder.isRecording) {
      midiRecorder.noteOff(trackId, pitch, this.getPositionBeats());
    }
    this.instruments.get(trackId)?.noteOff(pitch);
  }

  setSustain(trackId: string, on: boolean): void {
    this.instruments.get(trackId)?.setSustain(on);
  }

  allNotesOff(): void {
    for (const inst of this.instruments.values()) inst.allNotesOff();
  }

  // ---------- frame loop (meters + UI callbacks) ----------

  private startFrameLoop(): void {
    if (this.rafId !== null || typeof requestAnimationFrame === 'undefined') return;
    const loop = (time: number) => {
      const dt = this.lastFrameTime ? (time - this.lastFrameTime) / 1000 : 0.016;
      this.lastFrameTime = time;
      this.updateMeters(dt);
      this.applyAutomation();
      for (const cb of this.frameCbs) cb(dt);
      this.frameCount++;
      if (this.frameCount % 8 === 0) {
        const t = useTransportStore.getState();
        const patch: Record<string, unknown> = { activeSources: this.activeSources.size };
        if (this.playing) patch.positionBeats = this.getPositionBeats();
        t.set(patch);
      }
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  /** Subscribe to the engine's single rAF loop (playhead, meter widgets). */
  onFrame(cb: (dt: number) => void): () => void {
    this.frameCbs.add(cb);
    return () => this.frameCbs.delete(cb);
  }

  /**
   * Register interest in a channel's meter.
   *
   * Metering is not free: each read scans an analyser's whole time-domain
   * buffer, so metering every channel of a 500-track session costs a million
   * samples per frame for bars nobody is looking at. Only watched channels are
   * read, and a channel's stereo tap is built on first watch and torn down when
   * the last watcher leaves.
   */
  watchMeter(id: string): () => void {
    this.meterWatchers.set(id, (this.meterWatchers.get(id) ?? 0) + 1);
    this.ensureTap(id);
    return () => {
      const n = (this.meterWatchers.get(id) ?? 1) - 1;
      if (n > 0) {
        this.meterWatchers.set(id, n);
        return;
      }
      this.meterWatchers.delete(id);
      this.disposeTap(id);
      this.meterData.delete(id);
    };
  }

  private ensureTap(id: string): void {
    const ctx = this.ctx;
    const ch = this.channels.get(id);
    if (!ctx || !ch || ch.tap) return;
    const splitter = ctx.createChannelSplitter(2);
    const left = ctx.createAnalyser();
    const right = ctx.createAnalyser();
    left.fftSize = 1024;
    right.fftSize = 1024;
    ch.analyser.connect(splitter);
    splitter.connect(left, 0);
    splitter.connect(right, 1);
    ch.tap = { splitter, left, right };
  }

  private disposeTap(id: string): void {
    const ch = this.channels.get(id);
    if (!ch?.tap) return;
    for (const n of [ch.tap.splitter, ch.tap.left, ch.tap.right]) {
      try {
        n.disconnect();
      } catch {
        /* already gone */
      }
    }
    ch.tap = null;
  }

  private scanAnalyser(analyser: AnalyserNode): { peak: number; rms: number } {
    const n = analyser.fftSize;
    const buf = this.scratch.subarray(0, n);
    analyser.getFloatTimeDomainData(buf);
    let peak = 0;
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const v = buf[i];
      const a = v < 0 ? -v : v;
      if (a > peak) peak = a;
      sum += v * v;
    }
    return { peak, rms: Math.sqrt(sum / n) };
  }

  private updateMeters(dt: number): void {
    if (!this.ctx) return;
    const write = (
      id: string,
      l: { peak: number; rms: number },
      r: { peak: number; rms: number },
    ) => {
      const prev = this.meterData.get(id) ?? ZERO_METER;
      const decay = dt * 0.4;
      const holdL = l.peak >= prev.holdL ? l.peak : Math.max(0, prev.holdL - decay);
      const holdR = r.peak >= prev.holdR ? r.peak : Math.max(0, prev.holdR - decay);
      const peak = Math.max(l.peak, r.peak);
      this.meterData.set(id, {
        peak,
        rms: Math.max(Math.max(l.rms, r.rms), prev.rms * 0.82),
        hold: Math.max(holdL, holdR),
        clipped: prev.clipped || peak >= 0.999,
        peakL: l.peak,
        peakR: r.peak,
        rmsL: Math.max(l.rms, prev.rmsL * 0.82),
        rmsR: Math.max(r.rms, prev.rmsR * 0.82),
        holdL,
        holdR,
      });
    };

    for (const id of this.meterWatchers.keys()) {
      const ch = this.channels.get(id);
      if (!ch) continue;
      if (!ch.tap) this.ensureTap(id);
      if (ch.tap) write(id, this.scanAnalyser(ch.tap.left), this.scanAnalyser(ch.tap.right));
      else {
        const mono = this.scanAnalyser(ch.analyser);
        write(id, mono, mono);
      }
    }
    // The master meter is always live: it is the one reading that must be true
    // even when no mixer is on screen (the transport shows it).
    if (this.masterTap) {
      write(
        'master',
        this.scanAnalyser(this.masterTap.left),
        this.scanAnalyser(this.masterTap.right),
      );
    } else if (this.masterAnalyser) {
      const mono = this.scanAnalyser(this.masterAnalyser);
      write('master', mono, mono);
    }
  }

  getMeter(id: string): MeterData | undefined {
    return this.meterData.get(id);
  }

  /**
   * Gain reduction of one insert, in dB (0 or negative).
   *
   * `trackId` is a track id or 'master'. Returns 0 when the effect does not
   * report reduction, when the chain has not been built yet, or when the
   * context is not running — a display must never claim compression that is
   * not happening.
   */
  gainReductionOf(trackId: string, effectId: string): number {
    const chain = trackId === MASTER_ID ? this.masterInserts : this.channels.get(trackId)?.inserts;
    return chain?.gainReductionOf(effectId) ?? 0;
  }

  /** Measurement tap of one insert, for spectrum, scope and tuner faces. */
  effectTap(trackId: string, effectId: string): AnalyserNode | undefined {
    const chain = trackId === MASTER_ID ? this.masterInserts : this.channels.get(trackId)?.inserts;
    return chain?.tapOf(effectId);
  }

  resetClipIndicators(): void {
    for (const [id, m] of this.meterData) this.meterData.set(id, { ...m, clipped: false });
  }
}

export const engine = new AudioEngine();

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') engine.handleVisibilityResume();
  });
}

// Minimal probe for automated tests to read real signal levels & source counts.
// Read-only; exposes no ability to mutate the project or graph.
if (typeof window !== 'undefined') {
  (window as unknown as { __ml?: unknown }).__ml = {
    getMeter: (id: string) => engine.getMeter(id),
    activeSources: () => engine.activeSourceCount(),
    position: () => engine.getPositionBeats(),
    isPlaying: () => engine.isPlaying(),
    isRunning: () => engine.isRunning(),
    automationValueAt: (trackId: string, paramId: string) =>
      engine.automationValueAt(trackId, paramId),
  };
}
