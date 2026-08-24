/**
 * Offline mixdown ("bounce") to WAV.
 *
 * The whole project is re-rendered through an `OfflineAudioContext` faster than
 * real time. The graph is rebuilt from the same primitives the live engine
 * uses — `InsertChain` for effects, `PolySynth`/`DrumKit` for instruments, and
 * `computeClipSchedule` for clip timing and fades — so the bounce cannot
 * silently diverge from what was heard. `tests/export.test.ts` asserts that
 * audio clips, instrument notes, drum notes, insert effects and bus sends each
 * actually reach the output.
 *
 * Why offline rather than a real-time capture: it is faster, deterministic, and
 * unaffected by the page being backgrounded mid-render. The cost is that
 * anything requiring a live input (monitoring) is by definition not included —
 * which is correct for a mixdown.
 */
import { isAudioTrackType } from '../model/types';
import { freezeClipFor, isFreezeClipId, isFrozen } from '../model/freeze';
import { resolveChannels } from '../model/mixerGraph';
import { clipRatePlan } from '../model/clipRate';
import { playedNotes } from './notePipeline';
import {
  clipSecondsPerBeat,
  projectBeatRangeSec,
  projectBeatToSec,
  projectSecToBeat,
  projectBpmAt,
} from '../model/music';
import type { AudioClip, Effect, MidiClip, ProjectData, SynthParams, Track } from '../model/types';
import { diagLog } from '../state/diagnostics';
import { applyEnvelope, computeClipSchedule } from './clipSchedule';
import { InsertChain } from './effectChain';
import { hasTempoSyncedInsert, shouldRetempo, tempoVaries } from './tempoSync';
import type { ModulationClock } from './effectChain';
import { getBufferSync, loadBuffer } from './mediaLibrary';
import { DrumKit, PolySynth, type ActiveHandle, type Instrument } from './synth';
import { RackInstrument, SamplerInstrument, type RackChild } from './samplerInstrument';
import { defaultSamplerParams, type SamplerParams as SmpParams } from '../model/sampler';
import { laneValueAt, sampleSegment } from '../model/automation';
import type { AutomationLane } from '../model/automation';
import { denormParam, findAutoParam } from '../model/paramRegistry';
import type { AutoParam } from '../model/paramRegistry';
import { expandCompClip } from '../model/comping';
import {
  clipWarpMap,
  renderWarpedBuffer,
  warpedClipTiming,
  warpedTimeSec,
  warpKey,
} from './warpRender';
import type { WarpMap } from '../model/warp';
import { encodeWav } from './encode/wav';
import { preloadPlugins, warmPluginModules } from './wam/pluginPool';
import { ensureMotionWaveRuntime, motionWaveNodesReady } from './motionwave/runtime';
import { isMotionWaveKind } from './motionwave/registry';
import { printRequiredPlugins } from './wam/parityProbe';

/** Guard against a runaway render: two hours is far past any sane project. */
const MAX_RENDER_SECONDS = 60 * 120;
/** Let effect tails (reverb, delay) ring out rather than truncating them. */
export const DEFAULT_TAIL_SECONDS = 2;
/**
 * Silence rendered *before* the range and thrown away again.
 *
 * Every filter in the insert chain is born with zeroed state, and the dynamics
 * processors drive their VCA entirely from that state — so at t=0 a
 * compressor's gain is 0 and climbs to unity over its release, and even a
 * bypassed one crossfades its dry path up from silence. Live nobody hears it,
 * because the graph is built seconds before anyone presses play. Offline the
 * render begins at the same instant the graph does, so without a run-up every
 * bounce fades in. The initial state of a BiquadFilterNode is not reachable
 * through the Web Audio API; time is the only lever there is.
 *
 * This is the floor, for the parts of the graph that settle quickly — bypass
 * crossfades, hold delays, the master limiter. `preRollForProject` raises it
 * for a session whose ballistics are slower.
 */
export const DEFAULT_PRE_ROLL_SECONDS = 2;
/**
 * Settling time as a multiple of the slowest release. Five time constants
 * leaves 0.7% of the step, which at these levels is well under a tenth of a dB.
 */
const SETTLE_TIME_CONSTANTS = 5;
/**
 * The grid insert automation is applied on, offline.
 *
 * One frame at 60 Hz, which is the rate the live applier runs at — the point
 * being that a bounce and a monitor resolve the same lane at the same
 * resolution rather than at two (PA-006).
 */
const LIVE_AUTOMATION_GRID_SEC = 1 / 60;

/**
 * How many suspensions a render may schedule before the grid has to widen.
 *
 * An `OfflineAudioContext` takes every suspension up front, so this is a memory
 * bound rather than a time one. 120 000 at the grid above is 33 minutes at full
 * resolution, which covers any song and most live sets; past it the grid widens
 * and the diagnostics log says by how much.
 */
const MAX_SUSPENSIONS = 120000;

export interface RenderRange {
  startBeat: number;
  endBeat: number;
}

export interface RenderOptions {
  /** Omit to render the whole project. */
  range?: RenderRange;
  /** Extra seconds appended so effect tails are not cut off. */
  tailSeconds?: number;
  /**
   * Silence rendered ahead of the range so the graph settles, then trimmed off
   * again. Omit to let `preRollForProject` choose; 0 disables it.
   */
  preRollSec?: number;
  /** Render rate; defaults to the live context's rate when available. */
  sampleRate?: number;
  onProgress?: (stage: string) => void;
  signal?: { cancelled: boolean };
  /** Render a cue mix's balance instead of the main mix. */
  cueId?: string | null;
  /**
   * Skip the master stage — its inserts, fader, pan and safety limiter — and
   * take the sum straight to the output. A track freeze prints one channel and
   * plays the print back *into* that channel, so the master must not be baked
   * into it; every other caller wants the master and leaves this alone.
   */
  bypassMaster?: boolean;
}

export interface RenderResult {
  buffer: AudioBuffer;
  durationSec: number;
  sampleRate: number;
  channels: number;
  peak: number;
  clipped: boolean;
  /** what actually got scheduled — reported so an empty bounce is explicable */
  scheduledClips: number;
  scheduledNotes: number;
  missingMedia: string[];
  /**
   * Plugins the render could not load, by name. They stayed in their chains as
   * tombstones and passed audio through unaltered, so the bounce is a real
   * bounce of everything else — but it is not the mix that was made, and the
   * caller has to say so.
   */
  missingPlugins: string[];
}

export class ExportError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'ExportError';
  }
}

/** A no-op registry: the offline render has no polyphony ceiling to enforce. */
const OFFLINE_REGISTRY = {
  register: (_h: ActiveHandle) => {},
  unregister: (_h: ActiveHandle) => {},
  canAllocate: () => true,
};

const FALLBACK_SYNTH = {
  waveform: 'triangle' as const,
  cutoff: 3000,
  resonance: 1,
  attack: 0.01,
  decay: 0.2,
  sustain: 0.6,
  release: 0.3,
  volume: 0.5,
  presetName: 'Fallback',
};

/** Every insert chain in the project, master and per-clip chains included. */
function allEffects(project: ProjectData): Effect[] {
  const out: Effect[] = [...(project.master?.effects ?? [])];
  for (const track of project.tracks) out.push(...(track.effects ?? []));
  for (const clip of project.clips) out.push(...(clip.eventFx ?? []));
  return out;
}

/**
 * Plugins in this project that a bounce must refuse to render live.
 *
 * A plugin lands here only when the parity probe has *measured* it rendering
 * differently offline than it plays — never on suspicion, and never for a
 * plugin nobody has probed. A frozen track is exempt by construction: its
 * plugin is not instantiated at all, because the track plays a print that
 * already has the plugin baked into it, made by this same renderer.
 */
function printRequiredForProject(
  project: ProjectData,
): { trackName: string; pluginName: string; trackId: string; note: string }[] {
  const out: { trackName: string; pluginName: string; trackId: string; note: string }[] = [];
  const scan = (trackId: string, trackName: string, effects: Effect[] | undefined) => {
    for (const hit of printRequiredPlugins(effects ?? [])) {
      out.push({ trackId, trackName, pluginName: hit.name, note: hit.note });
    }
  };
  for (const track of project.tracks) {
    if (isFrozen(track)) continue;
    scan(track.id, track.name, track.effects);
  }
  scan('master', 'the master bus', project.master?.effects);
  return out;
}

/** Tracks that must be frozen before this project can be bounced, for the UI to
 *  offer "Freeze and export" rather than only refusing. */
export function tracksNeedingPrint(project: ProjectData): string[] {
  return [...new Set(printRequiredForProject(project).map((b) => b.trackId))].filter(
    (id) => id !== 'master',
  );
}

/**
 * Pre-roll long enough for this session's slowest processor to settle.
 *
 * The release control is the slowest of the ballistics, so five of the longest
 * release in the project is the bound that matters; everything else in the
 * graph settles inside the floor. Bypassed inserts count too: their ballistics
 * still run, and being generous costs a fraction of a second of render time
 * while being mean costs a fade-in on the delivered file.
 */
export function preRollForProject(project: ProjectData): number {
  let slowestMs = 0;
  for (const fx of allEffects(project)) {
    const ms = fx.params?.release;
    if (typeof ms === 'number' && Number.isFinite(ms) && ms > slowestMs) slowestMs = ms;
  }
  return Math.max(DEFAULT_PRE_ROLL_SECONDS, (SETTLE_TIME_CONSTANTS * slowestMs) / 1000);
}

export interface RenderLayout {
  /** Frames the offline context is asked for, pre-roll included. */
  frames: number;
  /** Leading frames dropped before the buffer is handed back. */
  trimFrames: number;
  /** Frames the caller actually receives. */
  keptFrames: number;
}

/**
 * Frame budget for a render, and the slice of it that never leaves this module.
 *
 * Pure and separate from the render because "the bounce is exactly as long as
 * the range and starts where the range starts" is the one property of a
 * pre-rolled render worth pinning down without an audio graph.
 */
export function renderLayout(
  durationSec: number,
  preRollSec: number,
  sampleRate: number,
): RenderLayout {
  const trimFrames = Math.round(Math.max(0, preRollSec) * sampleRate);
  const keptFrames = Math.ceil(durationSec * sampleRate);
  return { frames: trimFrames + keptFrames, trimFrames, keptFrames };
}

/**
 * Where this render's clock sits in the song, for the modulators.
 *
 * The graph is built at t = 0 and the delivered audio begins `preRoll` seconds
 * later, so context time zero is that far *before* the range start — which is
 * why the LFOs, started with no argument, used to arrive at bar 5 in a
 * different place depending on whether the bounce began at bar 1 or bar 5. The
 * run-up is the same length whatever range was asked for; the song time at the
 * range start is not, and it is the song time that has to decide the phase.
 *
 * Pure and exported for the same reason `renderLayout` is: "the same bars bounce
 * to the same samples however the range was cut" is worth pinning down without
 * an audio graph, and jsdom has none.
 */
export function renderModulationClock(rangeStartSec: number, preRollSec: number): ModulationClock {
  return { startAt: 0, songSec: rangeStartSec - Math.max(0, preRollSec) };
}

/**
 * Which channel keys which channel's dynamics detectors.
 *
 * Pure, so the two exclusions — a key source that is not a channel, and a
 * channel keying itself — are testable without a graph. The live engine makes
 * the same two exclusions inline (`engine.ts`, the sidechain block).
 */
export function sidechainRouting(
  project: ProjectData,
  isChannel: (id: string) => boolean,
): { trackId: string; keyId: string }[] {
  const out: { trackId: string; keyId: string }[] = [];
  for (const track of project.tracks) {
    const keyId = track.sidechainFrom ?? null;
    if (!keyId || keyId === track.id) continue;
    if (!isChannel(track.id) || !isChannel(keyId)) continue;
    out.push({ trackId: track.id, keyId });
  }
  return out;
}

/** Lanes the render applies: enabled, non-empty, and the track is not 'off'. */
function appliedLanes(track: Track): AutomationLane[] {
  if (!track.automation || track.automationMode === 'off') return [];
  return track.automation.filter((l) => l.enabled && l.points.length > 0);
}

/**
 * Schedule a lane onto an AudioParam as explicit ramps across the render.
 * Linear segments are single ramps; curved segments are subdivided; stepped
 * segments hold and jump through a 2ms micro-ramp so the jump cannot click.
 * Offline scheduling makes these ramps sample-accurate between knots — this is
 * the strongest guarantee the render path offers.
 *
 * Exported as a test seam: the shape of the schedule is the whole behaviour,
 * and it can be read off a recording AudioParam without an audio graph.
 */
export function scheduleLaneOnParam(
  param: AudioParam,
  lane: AutomationLane,
  desc: AutoParam,
  opts: {
    startBeat: number;
    endBeat: number;
    /** beat → render-relative seconds; tempo-map aware, supplied by the caller */
    timeOf: (beat: number) => number;
    mapValue?: (v: number) => number;
  },
): void {
  const { startBeat, endBeat, timeOf } = opts;
  const map = opts.mapValue ?? ((v: number) => v);
  const valueOf = (norm: number) => map(denormParam(desc, norm));

  const startNorm = laneValueAt(lane.points, startBeat);
  if (startNorm === null) return;
  param.setValueAtTime(valueOf(startNorm), 0);

  const pts = lane.points;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    if (b.beat <= startBeat || a.beat >= endBeat) continue;
    let lastT = timeOf(Math.max(a.beat, startBeat));
    for (const s of sampleSegment(a, b, 16)) {
      if (s.beat <= startBeat) continue;
      if (s.beat > endBeat + 1e-9) break;
      const t = timeOf(s.beat);
      if (t <= lastT + 1e-6) {
        // Stepped jump: land the new value over 2ms instead of instantaneously.
        // The ramp alone does that — the previous iteration already scheduled
        // the old value at `t`, so this ramps away from it. A setValueAtTime
        // here would take the jump instantaneously and leave the ramp holding
        // a value it had already reached.
        param.linearRampToValueAtTime(valueOf(s.value), t + 0.002);
      } else {
        param.linearRampToValueAtTime(valueOf(s.value), t);
      }
      lastT = t;
    }
  }
}

/**
 * Ensure every referenced media item is decoded before the render begins.
 *
 * Note that this takes the context the *caller* will render on, not the live
 * one — the resources it resolves belong to a context. That was already true
 * for decoded audio and it is true for plugin instances too: a `WamNode`
 * belongs to the context that made it, so each render context gets its own.
 */
export async function preloadForRender(
  project: ProjectData,
  ctx: BaseAudioContext,
): Promise<string[]> {
  const ids = [
    ...new Set([
      ...project.clips.filter((c): c is AudioClip => c.type === 'audio').map((c) => c.mediaId),
      // A frozen track's print is played by nothing on the timeline, so it has
      // to be asked for by name or the render would be silent where the
      // instrument used to be.
      ...project.tracks.filter(isFrozen).map((t) => t.freeze!.mediaId),
    ]),
  ];
  const missing: string[] = [];
  for (const id of ids) {
    if (getBufferSync(id)) continue;
    const buf = await loadBuffer(id, ctx);
    if (!buf) missing.push(id);
  }
  // Plugin *instances* cannot be preloaded here, because a `WamNode` belongs to
  // the context that created it and `renderProject` makes its own. What we can
  // do — and what matters for how long an export takes to start — is warm the
  // module cache, so the render's own preload finds every plugin's ES module
  // already imported and only pays for instantiation.
  await warmPluginModules(project);
  return missing;
}

/**
 * Render the project to an AudioBuffer.
 *
 * Media must already be decoded (`preloadForRender`) because the offline graph
 * is built synchronously — an await mid-build would let the render start before
 * every source is connected.
 */
export async function renderProject(
  project: ProjectData,
  opts: RenderOptions = {},
): Promise<RenderResult> {
  const startBeat = Math.max(0, opts.range?.startBeat ?? 0);
  const endBeat = Math.max(startBeat + 0.25, opts.range?.endBeat ?? projectEnd(project));
  const tail = Math.max(0, opts.tailSeconds ?? DEFAULT_TAIL_SECONDS);
  // Under a tempo map the render length is the integral across the range, not
  // a multiplication — a song that ritards is longer than its beat count says.
  const durationSec = projectBeatRangeSec(project, startBeat, endBeat - startBeat) + tail;
  const preRoll = Math.max(0, opts.preRollSec ?? preRollForProject(project));

  if (!Number.isFinite(durationSec) || durationSec <= 0) {
    throw new ExportError('Nothing to export: the render range is empty.');
  }
  // The pre-roll is rendered, so it counts against the ceiling even though it
  // is never delivered.
  if (durationSec + preRoll > MAX_RENDER_SECONDS) {
    throw new ExportError(
      `Render length ${Math.round(durationSec + preRoll)}s exceeds the ` +
        `${MAX_RENDER_SECONDS}s limit.`,
    );
  }
  if (typeof OfflineAudioContext === 'undefined') {
    throw new ExportError('This browser does not support offline audio rendering.');
  }

  // Refuse to bounce a plugin we have measured as rendering differently offline
  // than it plays. This is the only thing standing between "the bounce matches
  // what was monitored" and a wrong file with no error on it — see
  // `wam/parityProbe.ts`. The route out is a freeze, which prints through this
  // same renderer, so the user gets a correct bounce either way.
  const blocked = printRequiredForProject(project);
  if (blocked.length > 0) {
    throw new ExportError(
      `${blocked.length === 1 ? 'A plugin does' : `${blocked.length} plugins do`} not render ` +
        `the same offline as in playback, so this bounce would not match what you heard: ` +
        blocked.map((b) => `"${b.pluginName}" on ${b.trackName}`).join(', ') +
        `. Freeze ${blocked.length === 1 ? 'that track' : 'those tracks'} and export again.`,
    );
  }

  const sampleRate = opts.sampleRate ?? 44100;
  const layout = renderLayout(durationSec, preRoll, sampleRate);
  // Song time at the range start: every scheduled time in this render is
  // measured from here, so it must exist before the first insert chain is
  // built and before the first ramp is scheduled.
  const rangeStartSec = projectBeatToSec(project, startBeat);
  // Tempo-synced inserts are built at the tempo of the beat this render starts
  // from, not at `project.bpm` — which is pinned to beat 0 and so would put
  // every synced division in a bounce of bars 33-40 at the tempo of bar 1. The
  // suspension grid below keeps it tracking from there.
  const startBpm = projectBpmAt(project, startBeat);
  // Every insert chain below is handed this, so a modulator starts where the
  // song says it is rather than where the render's own clock happens to be.
  const modulation = renderModulationClock(rangeStartSec, preRoll);
  const ctx = new OfflineAudioContext(2, layout.frames, sampleRate);
  // Plugins are resolved on the render's own context, before the graph is built
  // — the same rule decoded media follows, and for the same reason: the build
  // below is synchronous, and an await inside it would let the render start
  // with a half-connected graph. Everything a plugin needs (its saved state,
  // its parameter values) is applied and awaited in here, not during the build,
  // because `setParameterValues` is async and `startRendering()` will not wait.
  const pluginReport = await preloadPlugins(project, ctx);
  const missingPlugins = pluginReport.failed.map((f) => f.ref.name || f.ref.identifier);
  /*
   * The Motion Wave core, on the render's own context, for the same reason and
   * before the same synchronous build.
   *
   * A bounce that dropped these units would be silently wrong rather than
   * loudly broken: the graph would build, the render would succeed, and the
   * file would be missing every Motion Wave insert the mix was approved with.
   * `renderProject` and the realtime engine build through the same
   * `InsertChain`, which is what makes them agree — and that agreement only
   * holds if both contexts have the core.
   */
  const motionWaveReady = await ensureMotionWaveRuntime(ctx);
  /*
   * Counted so the failure is *reported* rather than only logged.
   *
   * A bounce is the artefact a person sends someone else. If the core did not
   * load, every Motion Wave insert passed audio through unprocessed and the
   * file is not the mix — which has to appear in the render's own summary, next
   * to missing media and unloaded plugins, and not only in a console line
   * nobody reads after the fact.
   */
  const motionWaveUnitsInMix = [
    ...project.tracks.flatMap((track) => track.effects ?? []),
    ...(project.master?.effects ?? []),
  ].filter((effect) => isMotionWaveKind(effect.kind)).length;
  if (motionWaveUnitsInMix > 0 && !motionWaveReady) {
    diagLog(
      'error',
      `Bounce contains ${motionWaveUnitsInMix} Motion Wave insert(s) and the core did not ` +
        'load: they rendered as pass-throughs. This file is not the mix.',
    );
  }
  opts.onProgress?.('Building graph');

  // ---- master chain: mirrors AudioEngine.buildMasterChain ----
  // A bounce that does not run the master inserts is not the mix the engineer
  // approved, so the offline chain carries the same stages in the same order.
  const masterInput = ctx.createGain();
  // Held beyond the block so the tempo-tracking grid below can re-drive it;
  // null when the master is bypassed and there is no chain to drive.
  let masterChain: InsertChain | null = null;
  if (opts.bypassMaster) {
    masterInput.connect(ctx.destination);
  } else {
    const masterInserts = new InsertChain(ctx, modulation);
    masterChain = masterInserts;
    const masterGain = ctx.createGain();
    masterGain.gain.value = project.master?.volume ?? project.masterVolume;
    const masterPan = ctx.createStereoPanner();
    masterPan.pan.value = project.master?.pan ?? 0;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = project.master?.limiter === false ? 0 : -1.5;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.08;
    masterInserts.sync(project.master?.effects ?? [], startBpm);
    masterInput.connect(masterInserts.entry);
    masterInserts.exit.connect(masterGain);
    masterGain.connect(masterPan);
    masterPan.connect(limiter);
    limiter.connect(ctx.destination);
  }

  // ---- channels ----
  interface OfflineChannel {
    input: GainNode;
    inserts: InsertChain;
    muteGain: GainNode;
    volGain: GainNode;
    panner: StereoPannerNode;
    out: GainNode;
  }
  const channels = new Map<string, OfflineChannel>();
  // Mute, solo, VCA and folder gain come from the same pure resolver the live
  // engine uses, so a bounce cannot disagree with what was monitored — a cue
  // mix included, which is what makes "send the drummer their mix" one click.
  const states = resolveChannels(project, opts.cueId);

  for (const track of project.tracks) {
    if (!isAudioTrackType(track.type)) continue;
    const state = states.get(track.id)!;
    const input = ctx.createGain();
    const trim = ctx.createGain();
    const inserts = new InsertChain(ctx, modulation);
    const muteGain = ctx.createGain();
    const volGain = ctx.createGain();
    const panner = ctx.createStereoPanner();
    const out = ctx.createGain();

    input.connect(trim);
    trim.connect(inserts.entry);
    inserts.exit.connect(muteGain);
    muteGain.connect(volGain);
    volGain.connect(panner);
    panner.connect(out);

    inserts.sync(track.effects ?? [], startBpm);
    trim.gain.value = Math.pow(10, (track.inputGainDb ?? 0) / 20) * (track.phaseInvert ? -1 : 1);
    if (track.monoSum) {
      trim.channelCount = 1;
      trim.channelCountMode = 'explicit';
    }
    muteGain.gain.value = state.audible ? 1 : 0;
    volGain.gain.value = state.gain;
    panner.pan.value = state.pan;

    channels.set(track.id, { input, inserts, muteGain, volGain, panner, out });
  }

  // ---- routing: outputs then sends (buses exist by now) ----
  for (const track of project.tracks) {
    const ch = channels.get(track.id);
    if (!ch) continue;
    const dest = track.type === 'bus' || track.type === 'fx' ? 'master' : track.output;
    const target =
      dest !== 'master' && channels.has(dest) ? channels.get(dest)!.input : masterInput;
    ch.out.connect(target);
  }

  // Sidechain, as live: another channel's post-fader signal keys this one's
  // dynamics detectors. The tap is post-fader on the source because a kick
  // faded down should duck less, which is what an engineer expects. Without
  // this every detector keys off its own input, and a bass compressor keyed
  // from the kick pumps while monitoring and sits flat in the bounce — with
  // nothing to say so, because the pump *is* the arrangement.
  for (const { trackId, keyId } of sidechainRouting(project, (id) => channels.has(id))) {
    const ch = channels.get(trackId)!;
    const key = ctx.createGain();
    channels.get(keyId)!.panner.connect(key);
    for (const input of ch.inserts.sidechainInputs()) key.connect(input);
    ch.inserts.setSidechain(true);
  }

  const sendGains = new Map<string, GainNode>();
  for (const track of project.tracks) {
    // Buses and FX channels never send onward, which keeps the graph acyclic.
    if (track.type === 'bus' || track.type === 'fx') continue;
    const ch = channels.get(track.id);
    if (!ch) continue;
    const audible = states.get(track.id)?.audible ?? true;
    for (const send of track.sends ?? []) {
      const bus = channels.get(send.busId);
      const busTrack = project.tracks.find((t) => t.id === send.busId);
      if (
        !bus ||
        !busTrack ||
        (busTrack.type !== 'bus' && busTrack.type !== 'fx') ||
        send.busId === track.id
      ) {
        continue;
      }
      const g = ctx.createGain();
      g.gain.value = send.enabled && audible ? Math.max(0, send.amount) : 0;
      // Pre-fader taps the insert output, matching the live graph.
      (send.preFader ? ch.inserts.exit : ch.panner).connect(g);
      g.connect(bus.input);
      sendGains.set(`${track.id}|${send.busId}`, g);
    }
  }

  // ---- automation: fader-domain lanes become scheduled (sample-accurate)
  // ramps; insert-parameter lanes apply through a suspend/resume control grid;
  // synth-parameter lanes apply per note at schedule time (below). ----
  // The render clock is song seconds measured from the range start, so every
  // automation ramp converts through the tempo map rather than through one
  // seconds-per-beat — a lane written over a ritard lands where it was drawn.
  // Offset by the pre-roll, which every scheduled time in this render carries:
  // the lane's opening value is set at 0 and simply holds through the run-up.
  const timeOf = (beat: number) =>
    preRoll + Math.max(0, projectBeatToSec(project, beat) - rangeStartSec);
  const tailEndBeat = projectSecToBeat(project, projectBeatToSec(project, endBeat) + tail);
  const rampOpts = { startBeat, endBeat: tailEndBeat, timeOf };
  interface FxAutoEntry {
    track: Track;
    lane: AutomationLane;
    desc: AutoParam;
    effectId: string;
    key: string;
  }
  const fxAuto: FxAutoEntry[] = [];
  const synthAuto = new Map<string, { lane: AutomationLane; desc: AutoParam; key: string }[]>();
  const smpAuto = new Map<string, { lane: AutomationLane; desc: AutoParam; key: string }[]>();
  let automatedLanes = 0;

  for (const track of project.tracks) {
    const ch = channels.get(track.id);
    if (!ch) continue;
    const state = states.get(track.id);
    const audible = state?.audible ?? true;
    const groupGain = state?.groupGain ?? 1;
    const cueOverride = state?.cueOverride ?? false;
    const cueScale = state?.cueScale ?? 1;
    for (const lane of appliedLanes(track)) {
      const desc = findAutoParam(track, project, lane.paramId);
      if (!desc) continue;
      automatedLanes++;
      const id = lane.paramId;
      if (id === 'volume') {
        // As live: the lane writes the channel's own fader, and the VCA/folder
        // multiplier is reapplied so a group trim is not lost under automation.
        // A channel a cue has taken over keeps the cue's level — the lane
        // belongs to the main mix, and this render is not the main mix.
        if (!cueOverride) {
          scheduleLaneOnParam(ch.volGain.gain, lane, desc, {
            ...rampOpts,
            mapValue: (v) => Math.max(0, v) * groupGain * cueScale,
          });
        }
      } else if (id === 'pan') {
        if (!cueOverride) {
          scheduleLaneOnParam(ch.panner.pan, lane, desc, {
            ...rampOpts,
            mapValue: (v) => Math.max(-1, Math.min(1, v)),
          });
        }
      } else if (id === 'mute') {
        // The mute lane gates the channel; manual mute/solo still wins.
        if (audible && !cueOverride) {
          scheduleLaneOnParam(ch.muteGain.gain, lane, desc, {
            ...rampOpts,
            mapValue: (v) => (v >= 0.5 ? 0 : 1),
          });
        }
      } else if (id.startsWith('send:')) {
        const g = sendGains.get(`${track.id}|${id.slice(5)}`);
        const send = (track.sends ?? []).find((s) => s.busId === id.slice(5));
        if (g && send?.enabled && audible) {
          scheduleLaneOnParam(g.gain, lane, desc, {
            ...rampOpts,
            mapValue: (v) => Math.max(0, v),
          });
        }
      } else if (id.startsWith('fx:')) {
        const [, effectId, key] = id.split(':');
        fxAuto.push({ track, lane, desc, effectId, key });
      } else if (id.startsWith('synth:')) {
        const list = synthAuto.get(track.id) ?? [];
        list.push({ lane, desc, key: id.slice(6) });
        synthAuto.set(track.id, list);
      } else if (id.startsWith('smp:')) {
        const list = smpAuto.get(track.id) ?? [];
        list.push({ lane, desc, key: id.slice(4) });
        smpAuto.set(track.id, list);
      }
    }
  }

  // Insert-parameter automation: apply merged values at a control-rate grid
  // via suspend/resume.
  //
  // PA-006. This was a 25 ms grid capped at 4800 suspensions, which meant the
  // grid *widened* on anything long: 62.5 ms at five minutes, 125 ms at ten,
  // 375 ms at half an hour — while playback applies the same lanes at 60 to
  // 100 Hz. A bounce and a monitor of the same bars were therefore two
  // different renders of the insert automation, and `KNOWN-LIMITATIONS.md`
  // called the bounce exact.
  //
  // The grid now starts at the live applier's own rate, so up to
  // `MAX_SUSPENSIONS` the two agree. Past that it still has to widen — an
  // `OfflineAudioContext` schedules every suspension up front, so the count is
  // memory rather than time — but it says so in the diagnostics log instead of
  // degrading in silence, which was the actual defect.
  //
  // The same grid carries tempo tracking, so a synced delay follows the map
  // through the bounce rather than holding the tempo it was built at. It is
  // only worth adding the grid for tempo when the map moves *and* something
  // reads it — thousands of suspensions a bounce cannot use is a pure cost.
  const trackTempo = tempoVaries(project) && hasTempoSyncedInsert(project);
  let heldBpm = startBpm;
  if (fxAuto.length > 0 || trackTempo) {
    let grid = LIVE_AUTOMATION_GRID_SEC;
    const usable = durationSec - 0.001;
    if (usable / grid > MAX_SUSPENSIONS) {
      grid = usable / MAX_SUSPENSIONS;
      diagLog(
        'warn',
        `Bounce is ${Math.round(usable)}s: insert automation resolution widened from ` +
          `${Math.round(LIVE_AUTOMATION_GRID_SEC * 1000)}ms to ${Math.round(grid * 1000)}ms, ` +
          `so insert lanes will not match playback exactly over this length.`,
      );
    }
    const beatAt = (sec: number) => projectSecToBeat(project, rangeStartSec + sec);
    for (let t = grid; t < usable; t += grid) {
      const at = t;
      void ctx.suspend(preRoll + at).then(() => {
        const beat = beatAt(at);
        const bpm = projectBpmAt(project, beat);
        // Gated the same way the live engine gates it, so monitor and bounce
        // re-drive the chain at the same points in the song.
        const retempo = trackTempo && shouldRetempo(heldBpm, bpm);
        if (retempo) heldBpm = bpm;
        const merged = new Map<string, Record<string, number>>();
        for (const fa of fxAuto) {
          const n = laneValueAt(fa.lane.points, beat);
          if (n === null) continue;
          const params = merged.get(`${fa.track.id}|${fa.effectId}`) ?? {};
          params[fa.key] = denormParam(fa.desc, n);
          merged.set(`${fa.track.id}|${fa.effectId}`, params);
        }
        for (const [key, params] of merged) {
          const [trackId, effectId] = key.split('|');
          const track = project.tracks.find((x) => x.id === trackId);
          const fx = track?.effects?.find((x) => x.id === effectId);
          const chan = channels.get(trackId);
          if (track && fx && chan) chan.inserts.updateOne(fx, bpm, params);
        }
        if (retempo) {
          for (const track of project.tracks) {
            const chan = channels.get(track.id);
            if (chan && track.effects?.length) chan.inserts.sync(track.effects, bpm);
          }
          if (masterChain && project.master?.effects?.length) {
            masterChain.sync(project.master.effects, bpm);
          }
        }
        void ctx.resume();
      });
    }
  }

  // ---- instruments ----
  // Each instrument reads through a mutable box so synth-parameter automation
  // can set the value for the note being scheduled (per-voice application —
  // the same granularity the live engine has).
  const instruments = new Map<string, Instrument>();
  const synthBoxes = new Map<string, { params: SynthParams }>();
  const samplerBoxes = new Map<string, { params: SmpParams }>();
  for (const track of project.tracks) {
    if (track.type !== 'instrument' && track.type !== 'drum') continue;
    // Frozen: the print is the instrument. Building one here would cost the
    // render everything a freeze exists to save, and nothing would play it.
    if (isFrozen(track)) continue;
    const ch = channels.get(track.id)!;
    if (track.rack?.items.length) {
      // Rack: children mirror the live engine; per-item params are static in
      // a bounce (item-level automation is not offered).
      const children: RackChild[] = track.rack.items.map((item) => ({
        id: item.id,
        keyLo: item.keyLo,
        keyHi: item.keyHi,
        muted: item.muted,
        solo: item.solo,
        instrument:
          item.kind === 'sampler'
            ? new SamplerInstrument(
                ctx,
                ch.input,
                track.id,
                () => item.sampler ?? defaultSamplerParams('quick'),
                OFFLINE_REGISTRY,
              )
            : new PolySynth(
                ctx,
                ch.input,
                track.id,
                () => item.synth ?? FALLBACK_SYNTH,
                OFFLINE_REGISTRY,
              ),
      }));
      instruments.set(track.id, new RackInstrument(() => children));
      continue;
    }
    if (track.sampler) {
      const sbox = { params: track.sampler };
      samplerBoxes.set(track.id, sbox);
      instruments.set(
        track.id,
        new SamplerInstrument(ctx, ch.input, track.id, () => sbox.params, OFFLINE_REGISTRY),
      );
      continue;
    }
    const box = { params: track.synth ?? FALLBACK_SYNTH };
    synthBoxes.set(track.id, box);
    const getParams = () => box.params;
    instruments.set(
      track.id,
      track.type === 'drum'
        ? new DrumKit(ctx, ch.input, track.id, getParams, OFFLINE_REGISTRY)
        : new PolySynth(ctx, ch.input, track.id, getParams, OFFLINE_REGISTRY),
    );
  }
  const synthParamsAt = (track: Track, beat: number): SynthParams => {
    const base = track.synth ?? FALLBACK_SYNTH;
    const lanes = synthAuto.get(track.id);
    if (!lanes) return base;
    const merged: SynthParams = { ...base };
    for (const l of lanes) {
      const n = laneValueAt(l.lane.points, beat);
      if (n === null) continue;
      (merged as unknown as Record<string, number>)[l.key] = denormParam(l.desc, n);
    }
    return merged;
  };

  // ---- schedule everything up front ----
  opts.onProgress?.('Scheduling');
  // One warp render per (media, map): comped takes and duplicated loops share
  // theirs, and a warp render walks the whole file.
  const warpRenders = new Map<string, AudioBuffer>();
  const warpRender = (mediaId: string, map: WarpMap, source: AudioBuffer): AudioBuffer => {
    const key = `${mediaId}|${warpKey(map)}`;
    const done = warpRenders.get(key);
    if (done) return done;
    let rendered = source;
    try {
      rendered = renderWarpedBuffer(ctx, source, map);
    } catch (e) {
      // An unrenderable map bounces unwarped rather than silent, and says so.
      diagLog('warn', `Warp render failed for ${mediaId}: ${String(e)}`);
    }
    warpRenders.set(key, rendered);
    return rendered;
  };
  let scheduledClips = 0;
  let scheduledNotes = 0;
  const missingMedia = new Set<string>();

  // A frozen track plays its print instead of its notes here exactly as it does
  // live — same synthetic clip, same place in the channel — so a bounce of a
  // frozen session is the session, not a silent track where an instrument was.
  const freezeClips = project.tracks
    .map((t) => freezeClipFor(project, t))
    .filter((c): c is AudioClip => c !== null);

  for (const clip of [...project.clips, ...freezeClips]) {
    if (clip.muted) continue;
    const ch = channels.get(clip.trackId);
    if (!ch) continue;
    if (clip.type === 'midi' && isFrozen(project.tracks.find((t) => t.id === clip.trackId)!)) {
      continue;
    }
    // Skip clips entirely outside the render range.
    if (clip.start + clip.length <= startBeat || clip.start >= endBeat) continue;

    if (clip.type === 'audio') {
      // Take clips render exactly as they play: expanded per comp span.
      const spb = clipSecondsPerBeat(project, clip);
      const parts = clip.takes?.length ? expandCompClip(clip, spb) : [clip];
      let scheduledAny = false;
      for (const part of parts) {
        if (part.start + part.length <= startBeat || part.start >= endBeat) continue;
        const media = getBufferSync(part.mediaId);
        if (!media) {
          missingMedia.add(part.mediaId);
          continue;
        }
        // A warped clip bounces from the same render playback hears, computed
        // here rather than fetched from the cache: an offline render cannot
        // wait on a background task, and it must not guess at the map.
        const warp = clipWarpMap(part);
        const buffer = warp ? warpRender(part.mediaId, warp, media) : media;
        // Entering part-way through a clip that began before the range start.
        const enterBeat = Math.max(part.start, startBeat);
        const intoClip = enterBeat - part.start;
        const enterSec = part.offset + projectBeatRangeSec(project, part.start, intoClip);
        const offsetSec = warp ? warpedTimeSec(warp, enterSec) : enterSec;
        const plan = computeClipSchedule(
          warp ? warpedClipTiming(part, warp) : part,
          offsetSec,
          buffer.duration,
          spb,
        );
        if (!plan) continue;

        const when = preRoll + Math.max(0, projectBeatToSec(project, enterBeat) - rangeStartSec);
        const src = ctx.createBufferSource();
        src.buffer = buffer;
        // Stretch and transpose render by resampling here: an offline bounce
        // cannot wait on the WSOLA cache, and a render that silently omitted a
        // stretched clip would be worse than one that resamples it. The
        // difference is stated in docs/KNOWN-LIMITATIONS.md.
        const rate = clipRatePlan(project, part, spb).fallbackRate;
        if (rate !== 1) src.playbackRate.value = rate;
        const g = ctx.createGain();
        if (part.monoSum) {
          g.channelCount = 1;
          g.channelCountMode = 'explicit';
        }
        applyEnvelope(g.gain, plan.envelope, when);
        src.connect(g);
        // A print already carries the channel's trim and inserts, so it joins
        // the channel where it was taken from — the insert chain's output —
        // and everything after that (fader, pan, sends) still applies to it.
        const dest: AudioNode = isFreezeClipId(part.id) ? ch.inserts.exit : ch.input;
        if (part.eventFx?.length) {
          // Same shape as live: the clip's own chain between it and the channel.
          const eventChain = new InsertChain(ctx, modulation);
          eventChain.sync(part.eventFx, projectBpmAt(project, part.start));
          g.connect(eventChain.entry);
          eventChain.exit.connect(dest);
        } else {
          g.connect(dest);
        }
        src.start(when, plan.offsetSec, plan.durSec);
        scheduledAny = true;
      }
      if (scheduledAny) scheduledClips++;
    } else {
      const inst = instruments.get(clip.trackId);
      if (!inst) continue;
      const track = project.tracks.find((t) => t.id === clip.trackId);
      const box = synthBoxes.get(clip.trackId);
      const hasSynthAuto = !!track && synthAuto.has(clip.trackId);
      const sbox = samplerBoxes.get(clip.trackId);
      const hasSmpAuto = !!track && smpAuto.has(clip.trackId);
      // The same expansion the live scheduler uses, so note effects render.
      for (const note of playedNotes(project, clip as MidiClip, track)) {
        if (note.muted) continue;
        const absBeat = clip.start + note.start;
        if (absBeat < startBeat || absBeat >= endBeat) continue;
        // A note is not retriggered part-way; notes starting before the range
        // are omitted, which is what a range bounce means.
        const when = projectBeatToSec(project, absBeat) - rangeStartSec;
        if (when < 0) continue;
        if (hasSynthAuto && box && track) box.params = synthParamsAt(track, absBeat);
        if (hasSmpAuto && sbox && track?.sampler) {
          const merged: SmpParams = { ...track.sampler };
          for (const l of smpAuto.get(track.id)!) {
            const n = laneValueAt(l.lane.points, absBeat);
            if (n === null) continue;
            (merged as unknown as Record<string, number>)[l.key] = denormParam(l.desc, n);
          }
          sbox.params = merged;
        }
        const durSec = projectBeatRangeSec(project, absBeat, note.length);
        inst.scheduleNote(note.pitch, note.velocity, preRoll + when, durSec, clip.id);
        scheduledNotes++;
      }
      scheduledClips++;
    }
  }

  if (opts.signal?.cancelled) throw new ExportError('Export cancelled.');

  opts.onProgress?.('Rendering');
  /*
   * Every Motion Wave unit has its engine before the timeline starts.
   *
   * `startRendering` runs the whole render far faster than real time, and the
   * processor instantiates its WebAssembly in a promise — so without this the
   * bounce finishes before the units exist. Measured that way, a one-second
   * render through the Motion Shaper came back at an RMS of 0.0001 and, on a
   * second run, at exactly zero: no error, no warning, and a file that is not
   * the mix. This is the only place in the render where waiting is both
   * necessary and possible.
   */
  if (motionWaveUnitsInMix > 0) await motionWaveNodesReady(ctx);
  const rendered = await ctx.startRendering();
  // The run-up was only ever for the graph's benefit; the caller gets the range
  // it asked for, starting at its first sample.
  const output = dropPreRoll(ctx, rendered, layout.trimFrames);

  // ---- measure ----
  let peak = 0;
  for (let c = 0; c < output.numberOfChannels; c++) {
    const data = output.getChannelData(c);
    for (let i = 0; i < data.length; i++) {
      const v = Math.abs(data[i]);
      if (v > peak) peak = v;
    }
  }
  if (!Number.isFinite(peak)) {
    throw new ExportError('Render produced non-finite samples.');
  }

  diagLog(
    'info',
    `Bounce rendered: ${output.duration.toFixed(2)}s (+${preRoll.toFixed(1)}s pre-roll), ${
      output.numberOfChannels
    }ch @ ${output.sampleRate}Hz, peak ${peak.toFixed(
      3,
    )}, ${scheduledClips} clips, ${scheduledNotes} notes${
      automatedLanes ? `, ${automatedLanes} automation lane${automatedLanes === 1 ? '' : 's'}` : ''
    }${missingMedia.size ? `, ${missingMedia.size} missing media` : ''}${
      missingPlugins.length ? `, ${missingPlugins.length} plugin(s) not loaded` : ''
    }${motionWaveUnitsInMix > 0 && !motionWaveReady ? `, ${motionWaveUnitsInMix} MOTION WAVE UNIT(S) NOT RENDERED` : ''}`,
  );

  return {
    buffer: output,
    durationSec: output.duration,
    sampleRate: output.sampleRate,
    channels: output.numberOfChannels,
    peak,
    clipped: peak > 1.0001,
    scheduledClips,
    scheduledNotes,
    missingMedia: [...missingMedia],
    missingPlugins,
  };
}

/**
 * Hand back the render without its run-up.
 *
 * A copy is unavoidable — an AudioBuffer cannot be sliced in place — but it is
 * one pass over the mix, against a render that has just walked the whole song.
 */
function dropPreRoll(
  ctx: BaseAudioContext,
  rendered: AudioBuffer,
  trimFrames: number,
): AudioBuffer {
  if (trimFrames <= 0) return rendered;
  const length = Math.max(1, rendered.length - trimFrames);
  const out = ctx.createBuffer(rendered.numberOfChannels, length, rendered.sampleRate);
  for (let c = 0; c < rendered.numberOfChannels; c++) {
    out.copyToChannel(rendered.getChannelData(c).subarray(trimFrames, trimFrames + length), c);
  }
  return out;
}

function projectEnd(p: ProjectData): number {
  let end = 0;
  for (const c of p.clips) end = Math.max(end, c.start + c.length);
  return Math.max(end, 4);
}

/**
 * Encode an AudioBuffer as a 16-bit PCM WAV.
 *
 * 16-bit rather than 32-bit float: it is what every consumer application,
 * phone and DAW opens without question, and the limiter already keeps the
 * signal inside range.
 *
 * The quantiser is the shared one in `encode/` — rounding with TPDF dither —
 * rather than a `DataView.setInt16` of its own. `setInt16` applies ToInt16,
 * which truncates toward zero: a two-LSB dead band around silence whose error
 * is a function of the programme, so a fade turns granular instead of quiet.
 * The file's shape is unchanged — same header, same stereo ceiling, same
 * clamping — so every existing caller keeps the format it was written for.
 */
export function audioBufferToWav(buffer: AudioBuffer): ArrayBuffer {
  // Beyond stereo the header could not be honoured, so the extra channels are
  // dropped rather than mis-declared.
  const count = Math.max(1, Math.min(2, buffer.numberOfChannels));
  const channels: Float32Array[] = [];
  for (let c = 0; c < count; c++) channels.push(buffer.getChannelData(c));
  const bytes = encodeWav(channels, {
    sampleRate: buffer.sampleRate,
    format: 'int16',
    dither: { kind: 'tpdf' },
  });
  // encodeWav allocates exactly one right-sized array, so its buffer is the
  // file — no copy needed to hand back an ArrayBuffer.
  return bytes.buffer as ArrayBuffer;
}

export interface WavInfo {
  valid: boolean;
  reason?: string;
  durationSec: number;
  sampleRate: number;
  channels: number;
  peak: number;
}

/**
 * Decode an encoded WAV and confirm it is genuinely playable audio.
 *
 * Export is the one operation whose output leaves the app, so it is verified by
 * decoding rather than by trusting the encoder.
 */
export async function validateWav(bytes: ArrayBuffer, ctx: BaseAudioContext): Promise<WavInfo> {
  const empty: WavInfo = {
    valid: false,
    durationSec: 0,
    sampleRate: 0,
    channels: 0,
    peak: 0,
  };
  let decoded: AudioBuffer;
  try {
    // decodeAudioData detaches its input, so hand it a copy.
    decoded = await ctx.decodeAudioData(bytes.slice(0));
  } catch (e) {
    return { ...empty, reason: `Not decodable: ${e instanceof Error ? e.message : String(e)}` };
  }

  let peak = 0;
  for (let c = 0; c < decoded.numberOfChannels; c++) {
    const d = decoded.getChannelData(c);
    for (let i = 0; i < d.length; i++) {
      const v = Math.abs(d[i]);
      if (v > peak) peak = v;
    }
  }

  const info: WavInfo = {
    valid: true,
    durationSec: decoded.duration,
    sampleRate: decoded.sampleRate,
    channels: decoded.numberOfChannels,
    peak,
  };
  if (!Number.isFinite(peak)) return { ...info, valid: false, reason: 'Peak is not finite' };
  if (decoded.duration <= 0) return { ...info, valid: false, reason: 'Zero duration' };
  if (peak === 0) return { ...info, valid: false, reason: 'Output is entirely silent' };
  return info;
}
