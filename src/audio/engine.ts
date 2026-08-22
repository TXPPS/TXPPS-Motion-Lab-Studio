/**
 * AudioEngine — the ONLY owner of the AudioContext and the audio graph.
 * UI components never touch nodes; they act on stores and call the public
 * methods here. The engine reacts to project-store changes (syncGraph) and
 * mirrors its status into the transport store.
 */
import { clipSecondsPerBeat } from '../model/music';
import type { AudioClip, ProjectData, SynthParams, Track } from '../model/types';
import { useProjectStore } from '../state/projectStore';
import { useTransportStore } from '../state/transportStore';
import { diagLog } from '../state/diagnostics';
import { getBufferSync, loadBuffer } from './mediaLibrary';
import { audioInput } from './inputManager';
import { useInputStore } from '../state/inputStore';
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
const PARAM_TAU = 0.015;
/** Automation smoothing: every applied value approaches its target over this
 *  time constant, so control-rate updates cannot produce zipper steps. */
const AUTO_TAU = 0.015;

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
  peak: number;
  rms: number;
  hold: number;
  clipped: boolean;
}

interface Channel {
  trackId: string;
  input: GainNode;
  /** insert effects, between the input and the fader */
  inserts: InsertChain;
  muteGain: GainNode;
  volGain: GainNode;
  panner: StereoPannerNode;
  analyser: AnalyserNode;
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
  private masterGain: GainNode | null = null;
  private limiter: DynamicsCompressorNode | null = null;
  private masterAnalyser: AnalyserNode | null = null;
  private metroGain: GainNode | null = null;

  private channels = new Map<string, Channel>();
  private monitors = new Map<string, Monitor>();
  private instruments = new Map<string, Instrument>();
  private activeSources = new Set<ActiveHandle>();
  private scheduler: Scheduler;

  private meterData = new Map<string, MeterData>();
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
      scheduleMetronome: (when, accent) => this.scheduleMetronomeClick(when, accent),
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
    this.masterInput = ctx.createGain();
    this.masterGain = ctx.createGain();
    this.masterGain.gain.value = useProjectStore.getState().project.masterVolume;
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -1.5;
    this.limiter.knee.value = 0;
    this.limiter.ratio.value = 20;
    this.limiter.attack.value = 0.002;
    this.limiter.release.value = 0.08;
    this.masterAnalyser = ctx.createAnalyser();
    this.masterAnalyser.fftSize = 1024;
    this.masterInput.connect(this.masterGain);
    this.masterGain.connect(this.limiter);
    this.limiter.connect(this.masterAnalyser);
    this.masterAnalyser.connect(ctx.destination);
    this.metroGain = ctx.createGain();
    this.metroGain.gain.value = 0.5;
    this.metroGain.connect(this.masterAnalyser);
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
    this.buildAutoIndex(p);

    // 1. create channels/instruments for new tracks. The instrument KIND can
    // change (synth → sampler → rack), so a signature mismatch rebuilds it.
    for (const track of p.tracks) {
      if (!this.channels.has(track.id)) this.channels.set(track.id, this.buildChannel(track.id));
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

    // 2. remove channels for deleted tracks
    const liveIds = new Set(p.tracks.map((x) => x.id));
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
        ch.inserts.dispose();
        try {
          ch.input.disconnect();
          ch.muteGain.disconnect();
          ch.volGain.disconnect();
          ch.panner.disconnect();
          ch.analyser.disconnect();
        } catch {}
        this.channels.delete(id);
        this.meterData.delete(id);
      }
    }

    // 3. apply params + routing
    const soloActive = p.tracks.some((x) => x.solo);
    for (const track of p.tracks) {
      const ch = this.channels.get(track.id)!;
      const audible = this.isAudible(track, p.tracks, soloActive);
      const smooth = initial ? 0.001 : PARAM_TAU;
      const owned = this.autoOwned.get(track.id);
      ch.inserts.sync(track.effects ?? [], p.bpm, this.fxOverrides.get(track.id));
      if (!owned?.has('mute')) ch.muteGain.gain.setTargetAtTime(audible ? 1 : 0, t, smooth);
      if (!owned?.has('volume')) ch.volGain.gain.setTargetAtTime(track.volume, t, smooth);
      if (!owned?.has('pan')) ch.panner.pan.setTargetAtTime(track.pan, t, smooth);
      const dest = track.type === 'bus' ? 'master' : track.output;
      if (ch.routedTo !== dest) {
        try {
          ch.analyser.disconnect();
        } catch {}
        const target =
          dest !== 'master' &&
          this.channels.has(dest) &&
          p.tracks.find((x) => x.id === dest)?.type === 'bus'
            ? this.channels.get(dest)!.input
            : this.masterInput;
        ch.analyser.connect(target);
        ch.routedTo = dest;
      }

      // Sends: post-fader taps the panner output, pre-fader taps the channel
      // input. Buses never send onward, which keeps the graph acyclic.
      const wanted = new Map(
        (track.type === 'bus' ? [] : (track.sends ?? []))
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
    this.masterGain.gain.setTargetAtTime(p.masterVolume, t, initial ? 0.001 : PARAM_TAU);
    // Values at the playhead may have changed with the edit (or a lane may
    // have just been disabled and released its parameter).
    this.autoDirty = true;
    this.applyAutomation();

    // 4. stop sources whose clip vanished or got muted
    const clipState = new Map(p.clips.map((c) => [c.id, c.muted]));
    this.stopSourcesWhere((h) => {
      if (!h.clipId) return false;
      const muted = clipState.get(h.clipId);
      return muted === undefined || muted === true;
    });

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
      return new SamplerInstrument(ctx, out, trackId, () => this.readSamplerParams(trackId), registry);
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
        const items = useProjectStore.getState().project.tracks.find((x) => x.id === trackId)?.rack
          ?.items;
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
    const inserts = new InsertChain(ctx);
    const muteGain = ctx.createGain();
    const volGain = ctx.createGain();
    const panner = ctx.createStereoPanner();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    // input → inserts → mute → volume → pan → analyser → destination.
    // Inserts sit ahead of the fader so moving the fader does not change how
    // hard a compressor works, which is what a mixing engineer expects.
    input.connect(inserts.entry);
    inserts.exit.connect(muteGain);
    muteGain.connect(volGain);
    volGain.connect(panner);
    panner.connect(analyser);
    analyser.connect(this.masterInput!);
    return {
      trackId,
      input,
      inserts,
      muteGain,
      volGain,
      panner,
      analyser,
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
    const liveSamplerTracks = new Set(entries.filter((e) => e.kind === 'smp').map((e) => e.trackId));
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
    const soloActive = p.tracks.some((x) => x.solo);
    /** effects whose automated params changed this pass */
    const fxTouched = new Set<string>();

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

      switch (e.kind) {
        case 'volume':
          ch.volGain.gain.setTargetAtTime(Math.max(0, v), t, AUTO_TAU);
          break;
        case 'pan':
          ch.panner.pan.setTargetAtTime(Math.max(-1, Math.min(1, v)), t, AUTO_TAU);
          break;
        case 'mute': {
          const open = this.isAudible(track, p.tracks, soloActive) && v < 0.5;
          ch.muteGain.gain.setTargetAtTime(open ? 1 : 0, t, 0.008);
          break;
        }
        case 'send': {
          const node = e.busId ? ch.sends.get(e.busId) : undefined;
          if (!node) break;
          const send = track.sends?.find((s) => s.busId === e.busId);
          const audible = this.isAudible(track, p.tracks, soloActive);
          const level = send?.enabled && audible ? Math.max(0, v) : 0;
          node.gain.setTargetAtTime(level, t, AUTO_TAU);
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

  private isAudible(track: Track, tracks: Track[], soloActive: boolean): boolean {
    if (track.mute) return false;
    if (!soloActive) return true;
    if (track.solo) return true;
    if (track.type === 'bus') return tracks.some((s) => s.solo && s.output === track.id);
    const out = tracks.find((x) => x.id === track.output);
    return out?.solo === true;
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
    const buffer = getBufferSync(clip.mediaId);
    if (!buffer) return;
    const p = useProjectStore.getState().project;
    const spb = clipSecondsPerBeat(p, clip);
    // Duration and gain envelope come from the shared scheduler so that an
    // exported bounce is sample-for-sample the same decision as live playback.
    const plan = computeClipSchedule(clip, offsetSec, buffer.duration, spb);
    if (!plan) return;
    const durSec = plan.durSec;

    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const g = ctx.createGain();
    if (clip.monoSum) {
      // Explicit mono forces an equal-weight downmix through this node.
      g.channelCount = 1;
      g.channelCountMode = 'explicit';
    }
    applyEnvelope(g.gain, plan.envelope, when);

    src.connect(g);
    g.connect(ch.input);
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
    src.onended = () => {
      this.unregisterSource(handle);
      try {
        src.disconnect();
        g.disconnect();
      } catch {}
    };
    this.registerSource(handle);
    src.start(when, offsetSec, durSec);
  }

  private auditionState: { src: AudioBufferSourceNode; g: GainNode; mediaId: string } | null =
    null;

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
    this.stopAllMonitoring();
    audioInput.stopAll();
    useTransportStore.getState().set({ playState: 'stopped' });
    useInputStore.getState().set({ activeStreams: 0, activeTracks: 0, inputLevel: 0 });
    diagLog('warn', `Panic: all audio and input stopped${wasPlaying ? ' (transport was playing)' : ''}`);
  }

  getPositionBeats(): number {
    return this.playing ? this.scheduler.positionBeats() : this.pausedAtBeat;
  }

  // ---------- live input ----------

  liveNoteOn(trackId: string, pitch: number, velocity: number): void {
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

  private updateMeters(dt: number): void {
    if (!this.ctx) return;
    const read = (id: string, analyser: AnalyserNode) => {
      const n = analyser.fftSize;
      const buf = this.scratch.subarray(0, n);
      analyser.getFloatTimeDomainData(buf);
      let peak = 0;
      let sum = 0;
      for (let i = 0; i < n; i++) {
        const v = Math.abs(buf[i]);
        if (v > peak) peak = v;
        sum += buf[i] * buf[i];
      }
      const rms = Math.sqrt(sum / n);
      const prev = this.meterData.get(id) ?? { peak: 0, rms: 0, hold: 0, clipped: false };
      const hold = peak >= prev.hold ? peak : Math.max(0, prev.hold - dt * 0.4);
      this.meterData.set(id, {
        peak,
        rms: Math.max(rms, prev.rms * 0.82),
        hold,
        clipped: prev.clipped || peak >= 0.999,
      });
    };
    for (const [id, ch] of this.channels) read(id, ch.analyser);
    if (this.masterAnalyser) read('master', this.masterAnalyser);
  }

  getMeter(id: string): MeterData | undefined {
    return this.meterData.get(id);
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
