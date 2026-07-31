/**
 * AudioEngine — the ONLY owner of the AudioContext and the audio graph.
 * UI components never touch nodes; they act on stores and call the public
 * methods here. The engine reacts to project-store changes (syncGraph) and
 * mirrors its status into the transport store.
 */
import { secondsPerBeat } from '../model/music';
import type { AudioClip, ProjectData, SynthParams, Track } from '../model/types';
import { useProjectStore } from '../state/projectStore';
import { useTransportStore } from '../state/transportStore';
import { diagLog } from '../state/diagnostics';
import { getBufferSync } from './mediaLibrary';
import { audioInput } from './inputManager';
import { useInputStore } from '../state/inputStore';
import { DrumKit, PolySynth, type ActiveHandle, type Instrument } from './synth';
import { InsertChain } from './effectChain';
import { Scheduler } from './scheduler';

const MAX_ACTIVE_SOURCES = 128;
const PARAM_TAU = 0.015;

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
        diagLog('warn', 'AudioContext suspended during playback — transport stopped');
        this.stop();
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

    // 1. create channels/instruments for new tracks
    for (const track of p.tracks) {
      if (!this.channels.has(track.id)) this.channels.set(track.id, this.buildChannel(track.id));
      const hasSynth = track.type === 'instrument' || track.type === 'drum';
      if (hasSynth && !this.instruments.has(track.id)) {
        const ch = this.channels.get(track.id)!;
        const getParams = () => {
          const tr = useProjectStore.getState().project.tracks.find((x) => x.id === track.id);
          return tr?.synth ?? FALLBACK_SYNTH;
        };
        const registry = {
          register: (h: ActiveHandle) => this.registerSource(h),
          unregister: (h: ActiveHandle) => this.unregisterSource(h),
          canAllocate: () => this.canAllocate(),
        };
        this.instruments.set(
          track.id,
          track.type === 'drum'
            ? new DrumKit(ctx, ch.input, track.id, getParams, registry)
            : new PolySynth(ctx, ch.input, track.id, getParams, registry),
        );
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
      ch.inserts.sync(track.effects ?? [], p.bpm);
      ch.muteGain.gain.setTargetAtTime(audible ? 1 : 0, t, smooth);
      ch.volGain.gain.setTargetAtTime(track.volume, t, smooth);
      ch.panner.pan.setTargetAtTime(track.pan, t, smooth);
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
        const level = send.enabled && audible ? Math.max(0, send.amount) : 0;
        node.gain.setTargetAtTime(level, t, initial ? 0.001 : PARAM_TAU);
      }
    }
    this.masterGain.gain.setTargetAtTime(p.masterVolume, t, initial ? 0.001 : PARAM_TAU);

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
    const ctx = this.ctx;
    const ch = this.channels.get(clip.trackId);
    if (!ctx || !ch || !this.canAllocate()) return;
    const buffer = getBufferSync(clip.mediaId);
    if (!buffer) return;
    const p = useProjectStore.getState().project;
    const spb = secondsPerBeat(p.bpm);
    // How much source is left in this clip, honouring an explicit trim length.
    const intoClipSec = Math.max(0, offsetSec - clip.offset);
    const clipSourceSec = clip.sourceDuration ?? clip.length * spb;
    const clipRemainSec = clipSourceSec - intoClipSec;
    const mediaRemainSec = buffer.duration - offsetSec;
    const durSec = Math.min(clipRemainSec, mediaRemainSec, clip.length * spb - intoClipSec);
    if (durSec <= 0.001 || offsetSec >= buffer.duration) return;

    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const g = ctx.createGain();
    const peak = Math.max(0, clip.gain);
    const fadeIn = Math.max(0, clip.fadeIn ?? 0);
    const fadeOut = Math.max(0, clip.fadeOut ?? 0);
    const end = when + durSec;

    // Fades are expressed against the clip, so a clip entered mid-way (loop
    // wrap, mid-clip play) starts at the level the envelope had already reached.
    if (fadeIn > 0 && intoClipSec < fadeIn) {
      const startLevel = peak * (intoClipSec / fadeIn);
      g.gain.setValueAtTime(startLevel, when);
      g.gain.linearRampToValueAtTime(peak, when + (fadeIn - intoClipSec));
    } else {
      g.gain.setValueAtTime(peak, when);
    }
    if (fadeOut > 0) {
      const fadeStartInClip = Math.max(0, clipSourceSec - fadeOut);
      const fadeStartAt = when + Math.max(0, fadeStartInClip - intoClipSec);
      if (fadeStartAt < end) {
        g.gain.setValueAtTime(g.gain.value, Math.max(when, fadeStartAt));
        g.gain.linearRampToValueAtTime(0.0001, end);
      }
    }

    src.connect(g);
    g.connect(ch.input);
    const handle: ActiveHandle = {
      kind: 'buffer',
      trackId: clip.trackId,
      clipId: clip.id,
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
  };
}
