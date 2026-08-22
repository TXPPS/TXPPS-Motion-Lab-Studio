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
import { resolveChannels } from '../model/mixerGraph';
import { clipRatePlan } from '../model/clipRate';
import { playedNotes } from './notePipeline';
import {
  clipSecondsPerBeat,
  projectBeatRangeSec,
  projectBeatToSec,
  projectSecToBeat,
} from '../model/music';
import type { AudioClip, MidiClip, ProjectData, SynthParams, Track } from '../model/types';
import { diagLog } from '../state/diagnostics';
import { applyEnvelope, computeClipSchedule } from './clipSchedule';
import { InsertChain } from './effectChain';
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

/** Guard against a runaway render: two hours is far past any sane project. */
const MAX_RENDER_SECONDS = 60 * 120;
/** Let effect tails (reverb, delay) ring out rather than truncating them. */
export const DEFAULT_TAIL_SECONDS = 2;

export interface RenderRange {
  startBeat: number;
  endBeat: number;
}

export interface RenderOptions {
  /** Omit to render the whole project. */
  range?: RenderRange;
  /** Extra seconds appended so effect tails are not cut off. */
  tailSeconds?: number;
  /** Render rate; defaults to the live context's rate when available. */
  sampleRate?: number;
  onProgress?: (stage: string) => void;
  signal?: { cancelled: boolean };
  /** Render a cue mix's balance instead of the main mix. */
  cueId?: string | null;
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
 */
function scheduleLaneOnParam(
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
        // stepped jump: land the new value over 2ms instead of instantaneously
        param.setValueAtTime(valueOf(s.value), Math.max(0, t));
        param.linearRampToValueAtTime(valueOf(s.value), t + 0.002);
      } else {
        param.linearRampToValueAtTime(valueOf(s.value), t);
      }
      lastT = t;
    }
  }
}

/** Ensure every referenced media item is decoded before the render begins. */
export async function preloadForRender(
  project: ProjectData,
  ctx: BaseAudioContext,
): Promise<string[]> {
  const ids = [
    ...new Set(
      project.clips.filter((c): c is AudioClip => c.type === 'audio').map((c) => c.mediaId),
    ),
  ];
  const missing: string[] = [];
  for (const id of ids) {
    if (getBufferSync(id)) continue;
    const buf = await loadBuffer(id, ctx);
    if (!buf) missing.push(id);
  }
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

  if (!Number.isFinite(durationSec) || durationSec <= 0) {
    throw new ExportError('Nothing to export: the render range is empty.');
  }
  if (durationSec > MAX_RENDER_SECONDS) {
    throw new ExportError(
      `Render length ${Math.round(durationSec)}s exceeds the ${MAX_RENDER_SECONDS}s limit.`,
    );
  }
  if (typeof OfflineAudioContext === 'undefined') {
    throw new ExportError('This browser does not support offline audio rendering.');
  }

  const sampleRate = opts.sampleRate ?? 44100;
  const frames = Math.ceil(durationSec * sampleRate);
  const ctx = new OfflineAudioContext(2, frames, sampleRate);
  opts.onProgress?.('Building graph');

  // ---- master chain: mirrors AudioEngine.buildMasterChain ----
  // A bounce that does not run the master inserts is not the mix the engineer
  // approved, so the offline chain carries the same stages in the same order.
  const masterInput = ctx.createGain();
  const masterInserts = new InsertChain(ctx);
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
  masterInserts.sync(project.master?.effects ?? [], project.bpm);
  masterInput.connect(masterInserts.entry);
  masterInserts.exit.connect(masterGain);
  masterGain.connect(masterPan);
  masterPan.connect(limiter);
  limiter.connect(ctx.destination);

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
    const inserts = new InsertChain(ctx);
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

    inserts.sync(track.effects ?? [], project.bpm);
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
  // Song time at the range start: every scheduled time in this render is
  // measured from here, so it must exist before the first ramp is scheduled.
  const rangeStartSec = projectBeatToSec(project, startBeat);
  // The render clock is song seconds measured from the range start, so every
  // automation ramp converts through the tempo map rather than through one
  // seconds-per-beat — a lane written over a ritard lands where it was drawn.
  const timeOf = (beat: number) => Math.max(0, projectBeatToSec(project, beat) - rangeStartSec);
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
    for (const lane of appliedLanes(track)) {
      const desc = findAutoParam(track, project, lane.paramId);
      if (!desc) continue;
      automatedLanes++;
      const id = lane.paramId;
      if (id === 'volume') {
        // As live: the lane writes the channel's own fader, and the VCA/folder
        // multiplier is reapplied so a group trim is not lost under automation.
        scheduleLaneOnParam(ch.volGain.gain, lane, desc, {
          ...rampOpts,
          mapValue: (v) => Math.max(0, v) * groupGain,
        });
      } else if (id === 'pan') {
        scheduleLaneOnParam(ch.panner.pan, lane, desc, {
          ...rampOpts,
          mapValue: (v) => Math.max(-1, Math.min(1, v)),
        });
      } else if (id === 'mute') {
        // The mute lane gates the channel; manual mute/solo still wins.
        if (audible) {
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
  // via suspend/resume. 25ms grid, capped at 4800 suspensions for very long
  // renders (the grid widens rather than the render failing).
  if (fxAuto.length > 0) {
    let grid = 0.025;
    const usable = durationSec - 0.001;
    if (usable / grid > 4800) grid = usable / 4800;
    const beatAt = (sec: number) => projectSecToBeat(project, rangeStartSec + sec);
    for (let t = grid; t < usable; t += grid) {
      const at = t;
      void ctx.suspend(at).then(() => {
        const beat = beatAt(at);
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
          if (track && fx && chan) chan.inserts.updateOne(fx, project.bpm, params);
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

  for (const clip of project.clips) {
    if (clip.muted) continue;
    const ch = channels.get(clip.trackId);
    if (!ch) continue;
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

        const when = Math.max(0, projectBeatToSec(project, enterBeat) - rangeStartSec);
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
        if (part.eventFx?.length) {
          // Same shape as live: the clip's own chain between it and the channel.
          const eventChain = new InsertChain(ctx);
          eventChain.sync(part.eventFx, project.bpm);
          g.connect(eventChain.entry);
          eventChain.exit.connect(ch.input);
        } else {
          g.connect(ch.input);
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
        inst.scheduleNote(note.pitch, note.velocity, when, durSec, clip.id);
        scheduledNotes++;
      }
      scheduledClips++;
    }
  }

  if (opts.signal?.cancelled) throw new ExportError('Export cancelled.');

  opts.onProgress?.('Rendering');
  const rendered = await ctx.startRendering();

  // ---- measure ----
  let peak = 0;
  for (let c = 0; c < rendered.numberOfChannels; c++) {
    const data = rendered.getChannelData(c);
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
    `Bounce rendered: ${rendered.duration.toFixed(2)}s, ${rendered.numberOfChannels}ch @ ${
      rendered.sampleRate
    }Hz, peak ${peak.toFixed(3)}, ${scheduledClips} clips, ${scheduledNotes} notes${
      automatedLanes ? `, ${automatedLanes} automation lane${automatedLanes === 1 ? '' : 's'}` : ''
    }${missingMedia.size ? `, ${missingMedia.size} missing media` : ''}`,
  );

  return {
    buffer: rendered,
    durationSec: rendered.duration,
    sampleRate: rendered.sampleRate,
    channels: rendered.numberOfChannels,
    peak,
    clipped: peak > 1.0001,
    scheduledClips,
    scheduledNotes,
    missingMedia: [...missingMedia],
  };
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
 * signal inside range. Samples are clamped before conversion so an overshoot
 * wraps to full scale instead of folding over into noise.
 */
export function audioBufferToWav(buffer: AudioBuffer): ArrayBuffer {
  const channels = Math.max(1, Math.min(2, buffer.numberOfChannels));
  const frames = buffer.length;
  const bytesPerSample = 2;
  const blockAlign = channels * bytesPerSample;
  const dataBytes = frames * blockAlign;
  const out = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(out);

  const ascii = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };

  ascii(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // format: PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 8 * bytesPerSample, true);
  ascii(36, 'data');
  view.setUint32(40, dataBytes, true);

  const chans: Float32Array[] = [];
  for (let c = 0; c < channels; c++) chans.push(buffer.getChannelData(c));

  let offset = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channels; c++) {
      let v = chans[c][i];
      if (!Number.isFinite(v)) v = 0;
      v = Math.max(-1, Math.min(1, v));
      // Asymmetric ranges: -32768..32767 is what 16-bit PCM actually spans.
      view.setInt16(offset, v < 0 ? v * 0x8000 : v * 0x7fff, true);
      offset += 2;
    }
  }
  return out;
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
