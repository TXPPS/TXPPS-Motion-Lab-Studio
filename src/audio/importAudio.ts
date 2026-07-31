/**
 * Audio file import.
 *
 * Files arrive from a file picker or a drag-and-drop onto the arrangement, and
 * follow exactly the same path as a recorded take: decode → validate → peaks →
 * IndexedDB → MediaRef → optional clip. Nothing downstream can tell an import
 * from a recording.
 *
 * Format support is the browser's, not ours. Rather than gate on a hardcoded
 * extension list and reject files a given engine could actually play, we let
 * `decodeAudioData` decide and report its refusal honestly — Safari decodes
 * ALAC and AAC that Chromium does not, Chromium and Firefox decode Opus/WebM
 * that older Safari does not, and no static list is correct on every browser.
 */
import { newId } from '../model/ids';
import { secondsToBeats } from '../model/music';
import { PEAKS_VERSION, type MediaRef } from '../model/media';
import { diagLog } from '../state/diagnostics';
import { useProjectStore } from '../state/projectStore';
import { cacheBuffer } from './mediaLibrary';
import { peaksAreSilent, peaksFromAudioBuffer } from './peaks';
import { putMediaBlob, putPeaks, QuotaError, storageEstimate } from '../persistence/mediaStore';

/**
 * Per-file ceiling. Browser storage is a shared, evictable resource and a
 * decoded buffer costs far more RAM than the encoded file — a 200MB file
 * decodes to well over a gigabyte of Float32. Refusing early with a clear
 * message beats an out-of-memory tab.
 */
export const MAX_IMPORT_BYTES = 120 * 1024 * 1024;

/** Advisory list for the picker only — decoding is what actually decides. */
export const IMPORT_ACCEPT = 'audio/*,.wav,.mp3,.m4a,.aac,.ogg,.oga,.opus,.flac,.webm,.aif,.aiff';

export interface ImportTarget {
  /** Track to place a clip on. Omitted: import into the project media library only. */
  trackId?: string;
  /** Timeline beat for the new clip. */
  startBeat?: number;
}

export type ImportOutcome =
  | { ok: true; file: string; mediaRef: MediaRef; clipId: string | null; silent: boolean }
  | { ok: false; file: string; reason: string };

let sharedDecodeCtx: BaseAudioContext | null = null;

/**
 * Prefer the engine's context so imports decode at the device sample rate.
 * Import is always user-initiated, so callers can start the engine first; the
 * offline fallback exists only for the case where audio cannot start at all,
 * and costs one resample on playback.
 */
function getDecodeContext(engineCtx: BaseAudioContext | null): BaseAudioContext {
  if (engineCtx) return engineCtx;
  sharedDecodeCtx ??= new OfflineAudioContext(1, 1, 44100);
  return sharedDecodeCtx;
}

function humanBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Is there room for `bytes`? Uses the browser's own estimate and keeps a
 * margin, because the estimate is approximate and a write that lands right at
 * the quota edge fails mid-transaction.
 */
async function hasRoomFor(bytes: number): Promise<{ ok: boolean; message?: string }> {
  const est = await storageEstimate();
  if (!est || !est.quota) return { ok: true }; // no estimate available — attempt the write
  const free = est.quota - est.usage;
  const needed = bytes * 1.25; // encoded bytes + peak envelope + transaction overhead
  if (free < needed) {
    return {
      ok: false,
      message: `Not enough browser storage: ${humanBytes(free)} free, about ${humanBytes(
        Math.round(needed),
      )} needed. Delete unused projects or recordings and retry.`,
    };
  }
  return { ok: true };
}

function baseName(fileName: string): string {
  const noPath = fileName.split(/[\\/]/).pop() ?? fileName;
  return noPath.replace(/\.[^.]+$/, '') || noPath;
}

function decodeFailureMessage(file: File, err: unknown): string {
  const detail = err instanceof Error ? err.message : String(err);
  const ext = file.name.includes('.') ? file.name.split('.').pop()!.toUpperCase() : 'this format';
  return `This browser could not decode ${ext}. Try WAV, MP3 or M4A.${
    detail ? ` (${detail})` : ''
  }`;
}

/**
 * Import one file. Bytes are persisted before the project is touched, matching
 * the recording path: a failure can leave unreferenced media (recoverable by
 * pruning) but never a clip pointing at media that does not exist.
 */
export async function importAudioFile(
  file: File,
  target: ImportTarget,
  engineCtx: BaseAudioContext | null,
): Promise<ImportOutcome> {
  const label = file.name || 'audio file';

  if (file.size === 0) {
    return { ok: false, file: label, reason: 'File is empty.' };
  }
  if (file.size > MAX_IMPORT_BYTES) {
    return {
      ok: false,
      file: label,
      reason: `File is ${humanBytes(file.size)}; the limit is ${humanBytes(MAX_IMPORT_BYTES)}.`,
    };
  }

  const room = await hasRoomFor(file.size);
  if (!room.ok) return { ok: false, file: label, reason: room.message! };

  let buffer: AudioBuffer;
  try {
    const bytes = await file.arrayBuffer();
    // decodeAudioData detaches the buffer, so nothing else may reuse `bytes`.
    buffer = await getDecodeContext(engineCtx).decodeAudioData(bytes);
  } catch (e) {
    diagLog('warn', `Import failed to decode "${label}": ${String(e)}`);
    return { ok: false, file: label, reason: decodeFailureMessage(file, e) };
  }

  if (!buffer.duration || buffer.length === 0) {
    return { ok: false, file: label, reason: 'Decoded to zero audio frames.' };
  }

  const mediaId = newId('m');
  const peaks = peaksFromAudioBuffer(buffer);
  const silent = peaksAreSilent(peaks);

  const mediaRef: MediaRef = {
    id: mediaId,
    name: baseName(label),
    fileName: label,
    kind: 'import',
    mimeType: file.type || undefined,
    duration: buffer.duration,
    sampleRate: buffer.sampleRate,
    channels: buffer.numberOfChannels,
    byteSize: file.size,
    createdAt: Date.now(),
    source: 'file import',
    peaksVersion: PEAKS_VERSION,
  };

  try {
    await putMediaBlob(mediaId, file, file.type || 'application/octet-stream');
    await putPeaks(mediaId, peaks);
  } catch (e) {
    const reason =
      e instanceof QuotaError
        ? e.message
        : `Could not save to browser storage: ${e instanceof Error ? e.message : String(e)}`;
    return { ok: false, file: label, reason };
  }

  cacheBuffer(mediaId, buffer, peaks);

  const store = useProjectStore.getState();
  let clipId: string | null = null;
  if (target.trackId) {
    const bpm = store.project.bpm;
    clipId = store.addRecordedClip({
      trackId: target.trackId,
      mediaId,
      start: Math.max(0, target.startBeat ?? 0),
      lengthBeats: Math.max(0.25, secondsToBeats(buffer.duration, bpm)),
      name: mediaRef.name,
      sourceDuration: buffer.duration,
      mediaRef,
    });
  } else {
    store.registerMedia(mediaRef);
  }

  diagLog(
    'info',
    `Imported "${label}": ${buffer.duration.toFixed(2)}s, ${buffer.numberOfChannels}ch @ ${
      buffer.sampleRate
    }Hz, ${humanBytes(file.size)}${silent ? ' (SILENT)' : ''}`,
  );

  return { ok: true, file: label, mediaRef, clipId, silent };
}

/**
 * Import several files sequentially. Sequential is deliberate: parallel decodes
 * of large files spike memory, and one failure must not abort the rest.
 * Multi-file drops land end to end on the timeline rather than stacking.
 */
export async function importAudioFiles(
  files: File[],
  target: ImportTarget,
  engineCtx: BaseAudioContext | null,
): Promise<ImportOutcome[]> {
  const out: ImportOutcome[] = [];
  let beat = target.startBeat ?? 0;
  for (const f of files) {
    const res = await importAudioFile(f, { ...target, startBeat: beat }, engineCtx);
    out.push(res);
    if (res.ok && res.clipId) {
      const clip = useProjectStore.getState().project.clips.find((c) => c.id === res.clipId);
      if (clip) beat = clip.start + clip.length;
    }
  }
  return out;
}

/** Summarise a batch for a single toast, without hiding partial failure. */
export function summariseImport(results: ImportOutcome[]): {
  level: 'info' | 'error';
  text: string;
} {
  const ok = results.filter((r): r is Extract<ImportOutcome, { ok: true }> => r.ok);
  const failed = results.filter((r): r is Extract<ImportOutcome, { ok: false }> => !r.ok);

  if (failed.length === 0) {
    const silent = ok.filter((r) => r.silent).length;
    return {
      level: 'info',
      text:
        `Imported ${ok.length} file${ok.length === 1 ? '' : 's'}` +
        (silent ? ` — ${silent} contained silence` : ''),
    };
  }
  if (ok.length === 0) {
    return {
      level: 'error',
      text:
        failed.length === 1
          ? `${failed[0].file}: ${failed[0].reason}`
          : `${failed.length} files could not be imported`,
    };
  }
  return {
    level: 'error',
    text: `Imported ${ok.length}, failed ${failed.length} — ${failed[0].file}: ${failed[0].reason}`,
  };
}

/** Pull audio files out of a drop, ignoring directories and non-audio entries. */
export function audioFilesFromDrop(dt: DataTransfer | null): File[] {
  if (!dt) return [];
  const files: File[] = [];
  if (dt.items && dt.items.length) {
    for (const item of Array.from(dt.items)) {
      if (item.kind !== 'file') continue;
      const f = item.getAsFile();
      if (f && f.size > 0) files.push(f);
    }
  } else if (dt.files) {
    files.push(...Array.from(dt.files));
  }
  return files;
}

/** Test seam. */
export function resetImportContext(): void {
  sharedDecodeCtx = null;
}
