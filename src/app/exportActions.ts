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

function safeFileName(name: string): string {
  const base = name.replace(/[^A-Za-z0-9 ._-]+/g, '').trim() || 'MotionLab Mix';
  return `${base}.wav`;
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

    // Download.
    const blob = new Blob([bytes], { type: 'audio/wav' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = safeFileName(project.name);
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);

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
