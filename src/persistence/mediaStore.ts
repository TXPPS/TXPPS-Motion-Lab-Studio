/**
 * IndexedDB storage for audio bytes and waveform envelopes.
 *
 * Kept deliberately separate from the project document: a project stores only
 * small MediaRef metadata, so saving a project never rewrites megabytes of
 * audio and localStorage is never involved.
 */
import type { PeakData } from '../model/media';
import { fromStoredPeaks, toStoredPeaks, type StoredPeaks } from '../audio/peaks';
import { diagLog } from '../state/diagnostics';
import {
  idbDelete,
  idbGet,
  idbGetAll,
  idbPut,
  STORE_MEDIA,
  STORE_PEAKS,
  STORE_RECOVERY,
} from './db';

export interface StoredMedia {
  id: string;
  blob: Blob;
  mimeType: string;
  createdAt: number;
}

/** A take captured but not yet committed to a project (crash/interrupt safety). */
export interface RecoveryRecord {
  id: string;
  blob: Blob;
  mimeType: string;
  startedAt: number;
  durationSec: number;
  projectId: string;
  projectName: string;
  trackId: string;
  trackName: string;
  startBeat: number;
}

export class QuotaError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'QuotaError';
  }
}

function wrapWriteError(e: unknown, what: string): Error {
  const msg = e instanceof Error ? e.message : String(e);
  if (/quota|exceeded|storage/i.test(msg)) {
    diagLog('error', `Storage quota exceeded while writing ${what}`);
    return new QuotaError(`Not enough browser storage to save ${what}. Free space and retry.`);
  }
  diagLog('error', `Media store write failed (${what}): ${msg}`);
  return e instanceof Error ? e : new Error(msg);
}

// ---------- media blobs ----------

export async function putMediaBlob(id: string, blob: Blob, mimeType: string): Promise<void> {
  try {
    await idbPut(STORE_MEDIA, { id, blob, mimeType, createdAt: Date.now() } satisfies StoredMedia);
  } catch (e) {
    throw wrapWriteError(e, 'audio media');
  }
}

export async function getMediaBlob(id: string): Promise<StoredMedia | undefined> {
  return idbGet<StoredMedia>(STORE_MEDIA, id);
}

export async function deleteMediaBlob(id: string): Promise<void> {
  await idbDelete(STORE_MEDIA, id).catch(() => {});
  await idbDelete(STORE_PEAKS, id).catch(() => {});
}

export async function listMediaIds(): Promise<string[]> {
  const all = await idbGetAll<StoredMedia>(STORE_MEDIA).catch(() => []);
  return all.map((m) => m.id);
}

/** Total stored bytes — reported in diagnostics. */
export async function mediaStorageStats(): Promise<{ count: number; bytes: number }> {
  const all = await idbGetAll<StoredMedia>(STORE_MEDIA).catch(() => []);
  return { count: all.length, bytes: all.reduce((a, m) => a + (m.blob?.size ?? 0), 0) };
}

// ---------- peaks ----------

export async function putPeaks(id: string, peaks: PeakData): Promise<void> {
  try {
    await idbPut(STORE_PEAKS, toStoredPeaks(id, peaks));
  } catch (e) {
    // Peaks are a cache: failing to persist them must never fail the operation.
    diagLog('warn', `Could not cache waveform peaks for ${id}: ${String(e)}`);
  }
}

export async function getPeaks(id: string): Promise<PeakData | undefined> {
  const s = await idbGet<StoredPeaks>(STORE_PEAKS, id).catch(() => undefined);
  return s ? fromStoredPeaks(s) : undefined;
}

// ---------- recovery ----------

export async function putRecovery(rec: RecoveryRecord): Promise<void> {
  try {
    await idbPut(STORE_RECOVERY, rec);
  } catch (e) {
    throw wrapWriteError(e, 'recovery take');
  }
}

export async function listRecoveries(): Promise<RecoveryRecord[]> {
  const all = await idbGetAll<RecoveryRecord>(STORE_RECOVERY).catch(() => []);
  return all.sort((a, b) => b.startedAt - a.startedAt);
}

export async function deleteRecovery(id: string): Promise<void> {
  await idbDelete(STORE_RECOVERY, id).catch(() => {});
}

/**
 * Remove stored media no longer referenced by any project. Callers pass the full
 * set of referenced ids; anything else is orphaned. Never runs implicitly.
 */
export async function pruneOrphanedMedia(referenced: Set<string>): Promise<string[]> {
  const ids = await listMediaIds();
  const orphans = ids.filter((id) => !referenced.has(id));
  for (const id of orphans) await deleteMediaBlob(id);
  if (orphans.length) diagLog('info', `Pruned ${orphans.length} orphaned media item(s)`);
  return orphans;
}

/** Best-effort browser storage estimate for diagnostics. */
export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  try {
    if (typeof navigator === 'undefined' || !navigator.storage?.estimate) return null;
    const e = await navigator.storage.estimate();
    return { usage: e.usage ?? 0, quota: e.quota ?? 0 };
  } catch {
    return null;
  }
}
