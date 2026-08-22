/**
 * Take recorder.
 *
 * Captures the armed track's input with MediaRecorder, then turns the blob into
 * a decoded buffer, a peak envelope, a stored media record and a timeline clip.
 *
 * Why MediaRecorder: it is the only capture API available across Chrome, Safari
 * and Firefox today, it encodes off the main thread, and its output decodes
 * back through the same `decodeAudioData` path used for imports. Its container
 * differs per browser (Opus/WebM on Chromium and Firefox, AAC/MP4 on Safari),
 * so the format is negotiated below and reported in diagnostics rather than
 * assumed.
 *
 * Timeline alignment: the capture start beat is captured at the moment the
 * recorder actually starts, and any count-in happens *before* that, so the
 * resulting clip lands where the user expects regardless of encoder latency.
 */
import { projectBeatRangeSec, projectBeatsForSeconds } from '../model/music';
import { newId } from '../model/ids';
import { PEAKS_VERSION, type MediaRef } from '../model/media';
import { diagLog } from '../state/diagnostics';
import { useProjectStore } from '../state/projectStore';
import { peaksAreSilent, peaksFromAudioBuffer } from './peaks';
import { cacheBuffer } from './mediaLibrary';
import { putMediaBlob, putPeaks, putRecovery, deleteRecovery } from '../persistence/mediaStore';

/** Preference order: Opus first (small, high quality), then browser defaults. */
const MIME_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
  'audio/mp4;codecs=mp4a.40.2',
  'audio/mp4',
  'audio/aac',
];

export function pickMimeType(): string | null {
  if (typeof MediaRecorder === 'undefined') return null;
  for (const m of MIME_CANDIDATES) {
    try {
      if (MediaRecorder.isTypeSupported(m)) return m;
    } catch {
      /* isTypeSupported can throw on malformed strings in some engines */
    }
  }
  return null; // let the browser choose its own default
}

export function recorderSupported(): boolean {
  return typeof MediaRecorder !== 'undefined';
}

export interface FinishedTake {
  blob: Blob;
  mimeType: string;
  durationSec: number;
}

/** Thin wrapper that owns exactly one MediaRecorder at a time. */
export class TakeRecorder {
  private rec: MediaRecorder | null = null;
  private chunks: BlobPart[] = [];
  private startedAt = 0;
  private stopPromise: Promise<FinishedTake | null> | null = null;

  get active(): boolean {
    return this.rec !== null && this.rec.state !== 'inactive';
  }

  get mimeType(): string | null {
    return this.rec?.mimeType ?? null;
  }

  get elapsedSec(): number {
    return this.startedAt ? (performance.now() - this.startedAt) / 1000 : 0;
  }

  start(stream: MediaStream): boolean {
    if (this.active) return false;
    if (!recorderSupported()) {
      diagLog('error', 'MediaRecorder is not available in this browser');
      return false;
    }
    const mime = pickMimeType();
    try {
      this.rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
    } catch (e) {
      diagLog('error', `Could not create MediaRecorder: ${String(e)}`);
      return false;
    }
    this.chunks = [];
    this.rec.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) this.chunks.push(e.data);
    };
    this.rec.onerror = (e) => {
      diagLog('error', `Recorder error: ${String((e as ErrorEvent).error ?? e)}`);
    };
    // Periodic chunks mean an interrupted take still has recoverable data.
    this.rec.start(1000);
    this.startedAt = performance.now();
    diagLog('info', `Recording started (${this.rec.mimeType || 'browser default'})`);
    return true;
  }

  /** Stop and resolve with the finished blob (null when nothing was captured). */
  stop(): Promise<FinishedTake | null> {
    if (this.stopPromise) return this.stopPromise;
    const rec = this.rec;
    if (!rec || rec.state === 'inactive') return Promise.resolve(null);

    this.stopPromise = new Promise<FinishedTake | null>((resolve) => {
      const durationSec = this.elapsedSec;
      rec.onstop = () => {
        const mimeType = rec.mimeType || 'audio/webm';
        const blob = new Blob(this.chunks, { type: mimeType });
        this.chunks = [];
        this.rec = null;
        this.startedAt = 0;
        this.stopPromise = null;
        resolve(blob.size > 0 ? { blob, mimeType, durationSec } : null);
      };
      try {
        rec.stop();
      } catch {
        this.rec = null;
        this.stopPromise = null;
        resolve(null);
      }
    });
    return this.stopPromise;
  }

  /** Best-effort snapshot of what has been captured so far, for recovery. */
  snapshot(): Blob | null {
    if (this.chunks.length === 0) return null;
    return new Blob(this.chunks, { type: this.rec?.mimeType || 'audio/webm' });
  }

  /** Drop everything without producing a take. */
  abort(): void {
    const rec = this.rec;
    this.chunks = [];
    this.rec = null;
    this.startedAt = 0;
    this.stopPromise = null;
    if (rec && rec.state !== 'inactive') {
      rec.onstop = null;
      try {
        rec.stop();
      } catch {
        /* already stopping */
      }
    }
  }
}

export interface CommitOptions {
  take: FinishedTake;
  trackId: string;
  trackName: string;
  /** timeline beat where capture began */
  startBeat: number;
  ctx: BaseAudioContext;
  /** recovery record to clear once the take is safely committed */
  recoveryId?: string;
}

export interface CommitResult {
  mediaRef: MediaRef;
  clipId: string;
  durationSec: number;
  silent: boolean;
}

/**
 * Decode → validate → store → create clip. Returns null when the capture holds
 * no usable audio; the caller reports that honestly rather than inserting an
 * empty clip.
 */
export async function commitTake(opts: CommitOptions): Promise<CommitResult | null> {
  const { take, trackId, trackName, startBeat, ctx, recoveryId } = opts;
  const mediaId = newId('m');

  let buffer: AudioBuffer;
  try {
    const bytes = await take.blob.arrayBuffer();
    buffer = await ctx.decodeAudioData(bytes);
  } catch (e) {
    diagLog('error', `Recorded audio could not be decoded: ${e instanceof Error ? e.message : e}`);
    return null;
  }
  if (!buffer.duration || buffer.length === 0) {
    diagLog('warn', 'Recorded take contained no audio frames');
    return null;
  }

  const peaks = peaksFromAudioBuffer(buffer);
  const silent = peaksAreSilent(peaks);

  const mediaRef: MediaRef = {
    id: mediaId,
    name: `${trackName} take`,
    kind: 'recording',
    mimeType: take.mimeType,
    duration: buffer.duration,
    sampleRate: buffer.sampleRate,
    channels: buffer.numberOfChannels,
    byteSize: take.blob.size,
    createdAt: Date.now(),
    source: 'microphone',
    peaksVersion: PEAKS_VERSION,
  };

  // Persist bytes before touching the project so a failed write cannot leave a
  // clip pointing at media that does not exist.
  await putMediaBlob(mediaId, take.blob, take.mimeType);
  await putPeaks(mediaId, peaks);
  cacheBuffer(mediaId, buffer, peaks);

  const store = useProjectStore.getState();
  // Musical length of the take depends on where it lands: a take recorded
  // across a tempo change is not `seconds x one bpm` beats long.
  const lengthBeats = Math.max(
    0.25,
    projectBeatsForSeconds(store.project, startBeat, buffer.duration),
  );
  const clipId = store.addRecordedClip({
    trackId,
    mediaId,
    start: startBeat,
    lengthBeats,
    name: mediaRef.name,
    sourceDuration: buffer.duration,
    mediaRef,
  });

  if (recoveryId) await deleteRecovery(recoveryId);

  diagLog(
    'info',
    `Take committed: ${buffer.duration.toFixed(2)}s, ${(take.blob.size / 1024).toFixed(0)}KB, ${
      take.mimeType
    }${silent ? ' (SILENT — check input level)' : ''}`,
  );
  return { mediaRef, clipId, durationSec: buffer.duration, silent };
}

/** Write a recovery record so an interrupted take is not lost. */
export async function stashRecovery(
  blob: Blob,
  mimeType: string,
  info: { trackId: string; trackName: string; startBeat: number; durationSec: number },
): Promise<string | null> {
  try {
    const p = useProjectStore.getState().project;
    const id = newId('rec');
    await putRecovery({
      id,
      blob,
      mimeType,
      startedAt: Date.now(),
      durationSec: info.durationSec,
      projectId: p.id,
      projectName: p.name,
      trackId: info.trackId,
      trackName: info.trackName,
      startBeat: info.startBeat,
    });
    diagLog('warn', `Interrupted take stashed for recovery (${(blob.size / 1024).toFixed(0)}KB)`);
    return id;
  } catch (e) {
    diagLog('error', `Could not stash recovery take: ${String(e)}`);
    return null;
  }
}

export function beatsForSeconds(seconds: number, fromBeat = 0): number {
  return projectBeatsForSeconds(useProjectStore.getState().project, fromBeat, seconds);
}

export function secondsForBeats(beats: number, fromBeat = 0): number {
  return projectBeatRangeSec(useProjectStore.getState().project, fromBeat, beats);
}
