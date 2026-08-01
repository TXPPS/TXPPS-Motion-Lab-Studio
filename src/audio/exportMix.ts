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
import { beatsToSeconds, secondsPerBeat } from '../model/music';
import type { AudioClip, MidiClip, ProjectData, Track } from '../model/types';
import { diagLog } from '../state/diagnostics';
import { applyEnvelope, computeClipSchedule } from './clipSchedule';
import { InsertChain } from './effectChain';
import { getBufferSync, loadBuffer } from './mediaLibrary';
import { DrumKit, PolySynth, type ActiveHandle, type Instrument } from './synth';

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

function isAudible(track: Track, tracks: Track[], soloActive: boolean): boolean {
  if (track.mute) return false;
  if (soloActive && !track.solo) {
    // A track feeding a soloed bus stays audible.
    let out = track.output;
    const seen = new Set<string>();
    while (out && out !== 'master' && !seen.has(out)) {
      seen.add(out);
      const parent = tracks.find((t) => t.id === out);
      if (!parent) break;
      if (parent.solo) return true;
      out = parent.output;
    }
    return false;
  }
  return true;
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
  const spb = secondsPerBeat(project.bpm);
  const tail = Math.max(0, opts.tailSeconds ?? DEFAULT_TAIL_SECONDS);
  const durationSec = (endBeat - startBeat) * spb + tail;

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
  const masterInput = ctx.createGain();
  const masterGain = ctx.createGain();
  masterGain.gain.value = project.masterVolume;
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -1.5;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.002;
  limiter.release.value = 0.08;
  masterInput.connect(masterGain);
  masterGain.connect(limiter);
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
  const soloActive = project.tracks.some((t) => t.solo);

  for (const track of project.tracks) {
    const input = ctx.createGain();
    const inserts = new InsertChain(ctx);
    const muteGain = ctx.createGain();
    const volGain = ctx.createGain();
    const panner = ctx.createStereoPanner();
    const out = ctx.createGain();

    input.connect(inserts.entry);
    inserts.exit.connect(muteGain);
    muteGain.connect(volGain);
    volGain.connect(panner);
    panner.connect(out);

    inserts.sync(track.effects ?? [], project.bpm);
    muteGain.gain.value = isAudible(track, project.tracks, soloActive) ? 1 : 0;
    volGain.gain.value = track.volume;
    panner.pan.value = track.pan;

    channels.set(track.id, { input, inserts, muteGain, volGain, panner, out });
  }

  // ---- routing: outputs then sends (buses exist by now) ----
  for (const track of project.tracks) {
    const ch = channels.get(track.id)!;
    const dest = track.type === 'bus' ? 'master' : track.output;
    const target =
      dest !== 'master' && channels.has(dest)
        ? channels.get(dest)!.input
        : masterInput;
    ch.out.connect(target);
  }
  for (const track of project.tracks) {
    if (track.type === 'bus') continue; // buses never send onward
    const ch = channels.get(track.id)!;
    const audible = isAudible(track, project.tracks, soloActive);
    for (const send of track.sends ?? []) {
      const bus = channels.get(send.busId);
      const busTrack = project.tracks.find((t) => t.id === send.busId);
      if (!bus || !busTrack || busTrack.type !== 'bus' || send.busId === track.id) continue;
      const g = ctx.createGain();
      g.gain.value = send.enabled && audible ? Math.max(0, send.amount) : 0;
      // Pre-fader taps the insert output, matching the live graph.
      (send.preFader ? ch.inserts.exit : ch.panner).connect(g);
      g.connect(bus.input);
    }
  }

  // ---- instruments ----
  const instruments = new Map<string, Instrument>();
  for (const track of project.tracks) {
    if (track.type !== 'instrument' && track.type !== 'drum') continue;
    const ch = channels.get(track.id)!;
    const getParams = () => track.synth ?? FALLBACK_SYNTH;
    instruments.set(
      track.id,
      track.type === 'drum'
        ? new DrumKit(ctx, ch.input, track.id, getParams, OFFLINE_REGISTRY)
        : new PolySynth(ctx, ch.input, track.id, getParams, OFFLINE_REGISTRY),
    );
  }

  // ---- schedule everything up front ----
  opts.onProgress?.('Scheduling');
  const rangeStartSec = beatsToSeconds(startBeat, project.bpm);
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
      const buffer = getBufferSync(clip.mediaId);
      if (!buffer) {
        missingMedia.add(clip.mediaId);
        continue;
      }
      // Entering part-way through a clip that began before the range start.
      const enterBeat = Math.max(clip.start, startBeat);
      const intoClip = enterBeat - clip.start;
      const offsetSec = clip.offset + beatsToSeconds(intoClip, project.bpm);
      const plan = computeClipSchedule(clip, offsetSec, buffer.duration, spb);
      if (!plan) continue;

      const when = Math.max(0, beatsToSeconds(enterBeat, project.bpm) - rangeStartSec);
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      const g = ctx.createGain();
      applyEnvelope(g.gain, plan.envelope, when);
      src.connect(g);
      g.connect(ch.input);
      src.start(when, plan.offsetSec, plan.durSec);
      scheduledClips++;
    } else {
      const inst = instruments.get(clip.trackId);
      if (!inst) continue;
      for (const note of (clip as MidiClip).notes) {
        if (note.muted) continue;
        const absBeat = clip.start + note.start;
        if (absBeat < startBeat || absBeat >= endBeat) continue;
        // A note is not retriggered part-way; notes starting before the range
        // are omitted, which is what a range bounce means.
        const when = beatsToSeconds(absBeat, project.bpm) - rangeStartSec;
        if (when < 0) continue;
        const durSec = beatsToSeconds(note.length, project.bpm);
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
      missingMedia.size ? `, ${missingMedia.size} missing media` : ''
    }`,
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
