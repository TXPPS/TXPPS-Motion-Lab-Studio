/**
 * UI-facing bounce workflow: render → validate → download.
 *
 * The rendered WAV is decoded and checked before it is offered to the user, so
 * a silent or malformed bounce is reported as a failure rather than handed over
 * as a file that turns out to be useless later.
 */
import { engine } from '../audio/engine';
import {
  audioBufferToWav,
  preloadForRender,
  renderProject,
  validateWav,
  type RenderRange,
} from '../audio/exportMix';
import { diagLog } from '../state/diagnostics';
import {
  encodeAudio,
  type AudioFormatId,
  type EncodeBitDepth,
  type EncodeMetadata,
  type EncodedAudio,
} from '../audio/encode';
import { measureChannels, truePeakDbtp } from '../model/loudness';
import type { ProjectData } from '../model/types';
import { useProjectStore } from '../state/projectStore';
import { useUiStore } from '../state/uiStore';

export type ExportStage = 'idle' | 'preparing' | 'rendering' | 'validating' | 'done' | 'error';

export interface ExportState {
  stage: ExportStage;
  message: string;
  lastResult: string | null;
}

let state: ExportState = { stage: 'idle', message: '', lastResult: null };
const listeners = new Set<(s: ExportState) => void>();
let cancelSignal: { cancelled: boolean } | null = null;

export function exportState(): ExportState {
  return state;
}

export function onExportState(fn: (s: ExportState) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function set(patch: Partial<ExportState>): void {
  state = { ...state, ...patch };
  for (const fn of listeners) fn(state);
}

export function cancelExport(): void {
  if (cancelSignal) cancelSignal.cancelled = true;
}

function safeFileName(name: string, ext: string): string {
  const base = name.replace(/[^A-Za-z0-9 ._-]+/g, '').trim() || 'MotionLab Mix';
  return `${base}.${ext}`;
}

/**
 * What a bounce is. Every field here is a decision an engineer makes before
 * delivering, and every one of them used to be hardcoded: 16-bit WAV of the
 * whole song at the context's rate, with no dither and no metadata.
 */
export interface ExportSettings {
  format: AudioFormatId;
  bitDepth: EncodeBitDepth;
  /** 32-bit only */
  float: boolean;
  sampleRate: number;
  /** Dither is only meaningful when reducing to a fixed-point depth. */
  dither: 'none' | 'tpdf' | 'shaped';
  /** 'mix' bounces the master; 'stems' bounces one file per source. */
  scope: 'mix' | 'stems' | 'tracks';
  range: 'song' | 'loop';
  /** Normalise the result so its true peak lands here, in dBTP. Null = leave it. */
  normalizeDbtp: number | null;
  /** Trim silence from the head and tail of the render. */
  trimSilence: boolean;
  /** Seconds of decay captured past the last event. */
  tailSeconds: number;
  metadata: EncodeMetadata;
}

export const DEFAULT_EXPORT: ExportSettings = {
  format: 'wav',
  bitDepth: 24,
  float: false,
  sampleRate: 48000,
  dither: 'tpdf',
  scope: 'mix',
  range: 'song',
  normalizeDbtp: null,
  trimSilence: false,
  tailSeconds: 2,
  metadata: {},
};

/** Apply a peak-normalisation gain in place. Returns the gain that was applied. */
function normalizeInPlace(channels: Float32Array[], targetDbtp: number): number {
  let peak = 0;
  for (const ch of channels) {
    const tp = Math.pow(10, truePeakDbtp(ch) / 20);
    if (tp > peak) peak = tp;
  }
  if (peak <= 0) return 1;
  const gain = Math.pow(10, targetDbtp / 20) / peak;
  for (const ch of channels) {
    for (let i = 0; i < ch.length; i++) ch[i] *= gain;
  }
  return gain;
}

/** Strip leading and trailing near-silence, keeping a short guard either side. */
function trimEdges(channels: Float32Array[], sampleRate: number): Float32Array[] {
  const threshold = Math.pow(10, -60 / 20);
  const frames = channels[0]?.length ?? 0;
  let first = frames;
  let last = 0;
  for (const ch of channels) {
    for (let i = 0; i < frames; i++) {
      if (Math.abs(ch[i]) > threshold) {
        if (i < first) first = i;
        break;
      }
    }
    for (let i = frames - 1; i >= 0; i--) {
      if (Math.abs(ch[i]) > threshold) {
        if (i > last) last = i;
        break;
      }
    }
  }
  if (first >= last) return channels;
  const guard = Math.round(sampleRate * 0.02);
  const from = Math.max(0, first - guard);
  const to = Math.min(frames, last + guard);
  return channels.map((ch) => ch.slice(from, to));
}

function channelsOf(buffer: AudioBuffer): Float32Array[] {
  const out: Float32Array[] = [];
  for (let c = 0; c < buffer.numberOfChannels; c++) out.push(buffer.getChannelData(c).slice());
  return out;
}

function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/**
 * Bounce the project with full settings: format, depth, rate, dither,
 * normalisation and scope (mix, stems by bus, or one file per track).
 *
 * Stems are rendered by soloing each source in a copy of the project, so a stem
 * is the same signal path the mix used — inserts, sends and all — rather than a
 * separate code path that can drift from it.
 */
export async function exportProject(settings: ExportSettings): Promise<boolean> {
  if (state.stage === 'rendering' || state.stage === 'preparing') {
    useUiStore.getState().toast('error', 'An export is already running.');
    return false;
  }
  const signal = { cancelled: false };
  cancelSignal = signal;
  const project = useProjectStore.getState().project;
  set({ stage: 'preparing', message: 'Decoding media…', lastResult: null });

  try {
    await engine.start().catch(() => false);
    const decodeCtx: BaseAudioContext = engine.context ?? new OfflineAudioContext(1, 1, 44100);
    const missing = await preloadForRender(project, decodeCtx);
    if (missing.length) {
      diagLog('warn', `Export: ${missing.length} media item(s) missing; they will be silent`);
    }
    if (signal.cancelled) throw new Error('Export cancelled.');

    const range: RenderRange | undefined =
      settings.range === 'loop' && project.loop.end > project.loop.start
        ? { startBeat: project.loop.start, endBeat: project.loop.end }
        : undefined;

    const jobs = buildExportJobs(project, settings);
    const files: { name: string; encoded: EncodedAudio; summary: string }[] = [];

    for (let i = 0; i < jobs.length; i++) {
      const job = jobs[i];
      set({
        stage: 'rendering',
        message:
          jobs.length > 1 ? `Rendering ${job.name} (${i + 1}/${jobs.length})…` : 'Rendering mix…',
      });
      const result = await renderProject(job.project, {
        range,
        sampleRate: settings.sampleRate,
        tailSeconds: settings.tailSeconds,
        onProgress: (stage) => set({ message: `${job.name}: ${stage}…` }),
        signal,
      });
      if (result.scheduledClips === 0 && jobs.length === 1) {
        throw new Error('Nothing to export: no clips fall inside the render range.');
      }
      let channels = channelsOf(result.buffer);
      if (settings.trimSilence) channels = trimEdges(channels, result.buffer.sampleRate);
      if (settings.normalizeDbtp !== null) normalizeInPlace(channels, settings.normalizeDbtp);

      const encoded = encodeAudio(channels, {
        format: settings.format,
        sampleRate: result.buffer.sampleRate,
        bitDepth: settings.bitDepth,
        float: settings.float,
        ...(settings.dither === 'none' || settings.float || settings.bitDepth === 32
          ? {}
          : {
              dither: {
                kind: 'tpdf' as const,
                noiseShaping: settings.dither === 'shaped' ? ('second-order' as const) : undefined,
              },
            }),
        metadata: {
          ...settings.metadata,
          title: settings.metadata.title || job.name,
          software: 'TXPPS MotionLab Studio',
        },
      });
      const measured = measureChannels(channels, result.buffer.sampleRate);
      files.push({
        name: safeFileName(job.name, encoded.ext),
        encoded,
        summary: `${measured.durationSeconds.toFixed(1)}s · ${channels.length}ch @ ${(
          result.buffer.sampleRate / 1000
        ).toFixed(
          1,
        )}kHz · ${measured.integratedLufs > -70 ? `${measured.integratedLufs.toFixed(1)} LUFS · ` : ''}${measured.truePeakDbtp.toFixed(1)} dBTP`,
      });
      if (signal.cancelled) throw new Error('Export cancelled.');
    }

    set({ stage: 'validating', message: 'Writing files…' });
    for (const f of files) download(f.encoded.blob, f.name);

    const totalBytes = files.reduce((n, f) => n + f.encoded.bytes, 0);
    const summary =
      files.length === 1
        ? files[0].summary
        : `${files.length} files · ${(totalBytes / 1048576).toFixed(1)} MB`;
    set({ stage: 'done', message: 'Export complete', lastResult: summary });
    diagLog('info', `Export complete: ${summary}`);
    useUiStore.getState().toast('info', `Exported ${summary}`);
    return true;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    set({ stage: 'error', message: msg, lastResult: null });
    diagLog('error', `Export failed: ${msg}`);
    useUiStore.getState().toast('error', msg);
    return false;
  } finally {
    cancelSignal = null;
  }
}

/**
 * One render job per output file.
 *
 * A stem is produced by muting everything that does not feed it, in a COPY of
 * the project — the render path is untouched, so a stem carries exactly the
 * inserts, sends and automation the full mix gave it.
 */
function buildExportJobs(
  project: ProjectData,
  settings: ExportSettings,
): { name: string; project: ProjectData }[] {
  if (settings.scope === 'mix') return [{ name: project.name, project }];

  const sources =
    settings.scope === 'stems'
      ? project.tracks.filter((t) => t.type === 'bus' || t.type === 'fx')
      : project.tracks.filter(
          (t) => t.type === 'audio' || t.type === 'instrument' || t.type === 'drum',
        );
  if (sources.length === 0) return [{ name: project.name, project }];

  return sources.map((source) => {
    // Keep the source and everything upstream of it; silence the rest. Solo
    // would be simpler but would also pull in solo-safe channels, which is not
    // what a stem means.
    const keep = new Set<string>([source.id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const t of project.tracks) {
        if (keep.has(t.id)) continue;
        const feeds =
          keep.has(t.output) || (t.sends ?? []).some((s) => s.enabled && keep.has(s.busId));
        if (feeds) {
          keep.add(t.id);
          grew = true;
        }
      }
    }
    const copy: ProjectData = {
      ...project,
      name: `${project.name} — ${source.name}`,
      tracks: project.tracks.map((t) =>
        keep.has(t.id) ? { ...t, solo: false } : { ...t, mute: true, solo: false },
      ),
    };
    return { name: `${project.name} - ${source.name}`, project: copy };
  });
}

/**
 * Bounce the project (or a range) to a downloadable WAV.
 * Returns true when a validated file was produced.
 */
export async function exportWav(range?: RenderRange): Promise<boolean> {
  if (state.stage === 'rendering' || state.stage === 'preparing') {
    useUiStore.getState().toast('error', 'An export is already running.');
    return false;
  }
  const signal = { cancelled: false };
  cancelSignal = signal;

  const project = useProjectStore.getState().project;
  set({ stage: 'preparing', message: 'Decoding media…', lastResult: null });

  try {
    // Media must be decoded before the offline graph is built, because that
    // build is synchronous — an await mid-build would start the render before
    // every source was connected.
    await engine.start().catch(() => false);
    const decodeCtx: BaseAudioContext = engine.context ?? new OfflineAudioContext(1, 1, 44100);
    const missing = await preloadForRender(project, decodeCtx);
    if (missing.length) {
      diagLog('warn', `Export: ${missing.length} media item(s) missing; they will be silent`);
    }
    if (signal.cancelled) throw new Error('Export cancelled.');

    set({ stage: 'rendering', message: 'Rendering mix…' });
    const result = await renderProject(project, {
      range,
      sampleRate: engine.context?.sampleRate ?? 44100,
      onProgress: (s) => set({ message: `${s}…` }),
      signal,
    });

    if (result.scheduledClips === 0) {
      throw new Error('Nothing to export: no clips fall inside the render range.');
    }

    set({ stage: 'validating', message: 'Checking the file…' });
    const bytes = audioBufferToWav(result.buffer);
    const info = await validateWav(bytes, decodeCtx);
    if (!info.valid) {
      throw new Error(`Export failed validation: ${info.reason ?? 'unknown'}`);
    }

    download(new Blob([bytes], { type: 'audio/wav' }), safeFileName(project.name, 'wav'));

    const summary =
      `${info.durationSec.toFixed(1)}s · ${info.channels}ch @ ${(info.sampleRate / 1000).toFixed(
        1,
      )}kHz · peak ${(20 * Math.log10(Math.max(1e-6, info.peak))).toFixed(1)} dBFS` +
      (result.missingMedia.length ? ` · ${result.missingMedia.length} missing media` : '');

    set({ stage: 'done', message: 'Export complete', lastResult: summary });
    diagLog('info', `Export complete: ${summary}, ${(bytes.byteLength / 1048576).toFixed(1)} MB`);
    useUiStore
      .getState()
      .toast(
        result.missingMedia.length ? 'error' : 'info',
        result.missingMedia.length
          ? `Exported, but ${result.missingMedia.length} clip(s) had missing media and are silent.`
          : `Exported ${summary}`,
      );
    return true;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    set({ stage: 'error', message: msg, lastResult: null });
    diagLog('error', `Export failed: ${msg}`);
    useUiStore.getState().toast('error', msg);
    return false;
  } finally {
    cancelSignal = null;
  }
}

/** Bounce only the loop region. */
export async function exportLoopRegion(): Promise<boolean> {
  const loop = useProjectStore.getState().project.loop;
  if (!(loop.end > loop.start)) {
    useUiStore.getState().toast('error', 'The loop region is empty.');
    return false;
  }
  return exportWav({ startBeat: loop.start, endBeat: loop.end });
}
