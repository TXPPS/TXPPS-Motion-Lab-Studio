/**
 * Interrupted-take recovery.
 *
 * A take is stashed whenever finalising fails — a decode error, a quota
 * failure, a cancel, or a reload mid-recording. The audio is already on disk at
 * that point; this module is what turns it back into a clip.
 *
 * Discovery is deliberately passive: it reports what is waiting and lets the
 * user decide. Recovering silently would drop clips into whichever project
 * happened to be open, which is rarely the one they were recording into.
 */
import { engine } from '../audio/engine';
import { cacheBuffer } from '../audio/mediaLibrary';
import { peaksAreSilent, peaksFromAudioBuffer } from '../audio/peaks';
import { newId } from '../model/ids';
import { PEAKS_VERSION, type MediaRef } from '../model/media';
import { secondsToBeats } from '../model/music';
import {
  deleteRecovery,
  listRecoveries,
  putMediaBlob,
  putPeaks,
  type RecoveryRecord,
} from '../persistence/mediaStore';
import { diagLog } from '../state/diagnostics';
import { useInputStore } from '../state/inputStore';
import { useProjectStore } from '../state/projectStore';
import { useUiStore } from '../state/uiStore';

/** Look for stashed takes and report the count. Never modifies a project. */
export async function scanRecoveries(): Promise<RecoveryRecord[]> {
  const recs = await listRecoveries().catch(() => []);
  useInputStore.getState().set({ pendingRecoveries: recs.length });
  if (recs.length > 0) {
    diagLog(
      'warn',
      `${recs.length} interrupted take(s) waiting to be recovered or discarded`,
    );
  }
  return recs;
}

/**
 * Turn a stashed take into a clip on a track in the *current* project.
 *
 * The recovery's original track is used when it still exists; otherwise a new
 * audio track is created rather than guessing at a substitute, so recovered
 * audio never lands silently on an unrelated part.
 */
export async function recoverTake(rec: RecoveryRecord): Promise<boolean> {
  const ui = useUiStore.getState();
  await engine.start().catch(() => false);
  const ctx = engine.context;
  if (!ctx) {
    ui.toast('error', 'Audio could not start, so the take cannot be decoded yet.');
    return false;
  }

  let buffer: AudioBuffer;
  try {
    buffer = await ctx.decodeAudioData(await rec.blob.arrayBuffer());
  } catch (e) {
    diagLog('error', `Recovery take could not be decoded: ${String(e)}`);
    ui.toast('error', 'That take is not decodable and cannot be recovered.');
    return false;
  }
  if (!buffer.duration || buffer.length === 0) {
    ui.toast('error', 'That take contains no audio frames.');
    return false;
  }

  const store = useProjectStore.getState();
  const existing = store.project.tracks.find((t) => t.id === rec.trackId && t.type === 'audio');
  const trackId = existing?.id ?? store.addTrack('audio');
  const trackName = existing?.name ?? rec.trackName;

  const mediaId = newId('m');
  const peaks = peaksFromAudioBuffer(buffer);
  const mediaRef: MediaRef = {
    id: mediaId,
    name: `${trackName} (recovered)`,
    kind: 'recording',
    mimeType: rec.mimeType,
    duration: buffer.duration,
    sampleRate: buffer.sampleRate,
    channels: buffer.numberOfChannels,
    byteSize: rec.blob.size,
    createdAt: rec.startedAt,
    source: 'recovered take',
    peaksVersion: PEAKS_VERSION,
  };

  try {
    await putMediaBlob(mediaId, rec.blob, rec.mimeType);
    await putPeaks(mediaId, peaks);
  } catch (e) {
    // Leave the recovery record in place: a failed write must not lose the audio.
    ui.toast('error', `Could not save the recovered take: ${e instanceof Error ? e.message : e}`);
    return false;
  }
  cacheBuffer(mediaId, buffer, peaks);

  const bpm = useProjectStore.getState().project.bpm;
  const clipId = useProjectStore.getState().addRecordedClip({
    trackId,
    mediaId,
    // The original start beat only means something in the original project.
    start: rec.projectId === store.project.id ? rec.startBeat : 0,
    lengthBeats: Math.max(0.25, secondsToBeats(buffer.duration, bpm)),
    name: mediaRef.name,
    sourceDuration: buffer.duration,
    mediaRef,
  });

  await deleteRecovery(rec.id);
  await scanRecoveries();

  useUiStore.getState().selectClip(clipId, trackId);
  const silent = peaksAreSilent(peaks);
  ui.toast(
    silent ? 'error' : 'info',
    silent
      ? `Recovered ${buffer.duration.toFixed(1)}s, but the take is silent.`
      : `Recovered ${buffer.duration.toFixed(1)}s onto ${trackName}.`,
  );
  diagLog(
    'info',
    `Recovered take ${rec.id}: ${buffer.duration.toFixed(2)}s onto "${trackName}"${
      rec.projectId === store.project.id ? '' : ' (different project — placed at bar 1)'
    }`,
  );
  return true;
}

/** Discard a stashed take. Irreversible, so callers confirm first. */
export async function discardRecovery(rec: RecoveryRecord): Promise<void> {
  await deleteRecovery(rec.id);
  await scanRecoveries();
  diagLog('info', `Discarded recovery take ${rec.id}`);
}

export async function discardAllRecoveries(): Promise<number> {
  const recs = await listRecoveries().catch(() => []);
  for (const r of recs) await deleteRecovery(r.id);
  await scanRecoveries();
  if (recs.length) diagLog('info', `Discarded ${recs.length} recovery take(s)`);
  return recs.length;
}

export function describeRecovery(rec: RecoveryRecord): string {
  const when = new Date(rec.startedAt).toLocaleString();
  const size = rec.blob.size < 1024 * 1024
    ? `${(rec.blob.size / 1024).toFixed(0)} KB`
    : `${(rec.blob.size / (1024 * 1024)).toFixed(1)} MB`;
  return `${rec.trackName} · ${rec.durationSec.toFixed(1)}s · ${size} · ${when} · ${rec.projectName}`;
}
