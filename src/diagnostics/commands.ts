/**
 * Diagnostic commands: small, safe, self-contained checks a user can run when
 * something is wrong, and whose output goes straight into the report.
 *
 * Each returns a human-readable result rather than throwing, because these are
 * run precisely when the app is already misbehaving.
 */
import { engine } from '../audio/engine';
import { audioInput } from '../audio/inputManager';
import { getBufferSync, isMissing } from '../audio/mediaLibrary';
import { pickMimeType, recorderSupported } from '../audio/recorder';
import { peaksFromAudioBuffer } from '../audio/peaks';
import {
  deleteMediaBlob,
  getMediaBlob,
  listMediaIds,
  mediaStorageStats,
  pruneOrphanedMedia,
  putMediaBlob,
  storageEstimate,
} from '../persistence/mediaStore';
import { listProjects, loadProject } from '../persistence/projectRepo';
import { useUiStore } from '../state/uiStore';
import { diagLog } from '../state/diagnostics';
import { permissionLabel, useInputStore } from '../state/inputStore';
import { useProjectStore } from '../state/projectStore';
import { refreshStorageDiagnostics } from './report';

export interface CommandResult {
  ok: boolean;
  title: string;
  detail: string;
}

/** Ask for microphone permission explicitly. Runs only from a user gesture. */
export async function testMicPermission(): Promise<CommandResult> {
  const before = useInputStore.getState().permission;
  const granted = await audioInput.requestPermission();
  await audioInput.refreshDevices();
  const after = useInputStore.getState();
  const labelled = after.devices.filter((d) => d.label).length;

  return {
    ok: granted,
    title: 'Microphone permission',
    detail: granted
      ? `${permissionLabel(before)} → ${permissionLabel(after.permission)}; ${
          after.devices.length
        } device(s), ${labelled} with labels`
      : `Denied or dismissed: ${after.lastError ?? 'no reason reported'}`,
  };
}

/**
 * Open an input stream briefly and confirm real signal is arriving.
 * Reports a silent input honestly rather than calling the test passed.
 */
export async function runInputMonitorSmokeTest(): Promise<CommandResult> {
  if (useInputStore.getState().permission !== 'granted') {
    return {
      ok: false,
      title: 'Input monitor smoke test',
      detail: 'Skipped: microphone permission has not been granted.',
    };
  }
  const started = await engine.start();
  if (!started) {
    return {
      ok: false,
      title: 'Input monitor smoke test',
      detail: 'Skipped: the AudioContext could not start.',
    };
  }

  const track = useProjectStore.getState().project.tracks.find((t) => t.type === 'audio');
  if (!track) {
    return {
      ok: false,
      title: 'Input monitor smoke test',
      detail: 'Skipped: the project has no audio track to monitor through.',
    };
  }

  const wasMonitoring = engine.isMonitoring(track.id);
  try {
    if (!wasMonitoring) {
      const ok = await engine.startMonitoring(track.id, track.inputDeviceId ?? 'default');
      if (!ok) {
        return {
          ok: false,
          title: 'Input monitor smoke test',
          detail: `Could not open the input: ${useInputStore.getState().lastError ?? 'unknown'}`,
        };
      }
    }
    // Sample the level for a moment; a single frame can legitimately be zero.
    let peak = 0;
    const started = performance.now();
    while (performance.now() - started < 900) {
      peak = Math.max(peak, engine.inputLevel(track.id));
      await new Promise((r) => setTimeout(r, 50));
    }
    return {
      ok: peak > 0.001,
      title: 'Input monitor smoke test',
      detail:
        peak > 0.001
          ? `Signal detected, peak ${(20 * Math.log10(peak)).toFixed(1)} dBFS over ~0.9s`
          : 'Stream opened but no signal was detected — check the input device and its level.',
    };
  } finally {
    if (!wasMonitoring) engine.stopMonitoring(track.id);
  }
}

/** Round-trip a small blob through IndexedDB to prove media storage works. */
export async function runMediaStorageSmokeTest(): Promise<CommandResult> {
  const id = `smoke-${Date.now()}`;
  const payload = new Uint8Array(2048).map((_, i) => i % 251);
  try {
    await putMediaBlob(id, new Blob([payload], { type: 'application/octet-stream' }), 'test');
    const back = await getMediaBlob(id);
    if (!back?.blob) {
      return { ok: false, title: 'Media storage smoke test', detail: 'Write succeeded but read returned nothing.' };
    }
    const bytes = new Uint8Array(await back.blob.arrayBuffer());
    const identical = bytes.length === payload.length && bytes.every((b, i) => b === payload[i]);
    const stats = await mediaStorageStats();
    const est = await storageEstimate();
    return {
      ok: identical,
      title: 'Media storage smoke test',
      detail: identical
        ? `Round-tripped ${bytes.length} bytes. Store holds ${stats.count} item(s)${
            est ? `, origin using ${(est.usage / 1048576).toFixed(1)} MB` : ''
          }.`
        : `Data came back altered (${bytes.length} of ${payload.length} bytes).`,
    };
  } catch (e) {
    return {
      ok: false,
      title: 'Media storage smoke test',
      detail: `Failed: ${e instanceof Error ? e.message : String(e)}`,
    };
  } finally {
    await deleteMediaBlob(id).catch(() => {});
    await refreshStorageDiagnostics();
  }
}

/**
 * Media ids referenced by ANY saved project plus the open one. The open
 * project matters separately because it may have unsaved changes; scanning
 * only saved data would call its newest recording "unused".
 */
async function collectReferencedMedia(): Promise<Set<string>> {
  const referenced = new Set<string>();
  const collect = (p: {
    clips: { type: string; mediaId?: string }[];
    media?: { id: string }[];
  }) => {
    for (const c of p.clips) if (c.type === 'audio' && c.mediaId) referenced.add(c.mediaId);
    for (const m of p.media ?? []) referenced.add(m.id);
  };
  collect(useProjectStore.getState().project);
  const metas = await listProjects().catch(() => []);
  for (const meta of metas) {
    const p = await loadProject(meta.id).catch(() => null);
    if (p) collect(p);
  }
  return referenced;
}

/** Report stored media no saved project references. Never deletes. */
export async function findUnusedMedia(): Promise<CommandResult> {
  const referenced = await collectReferencedMedia();
  const ids = await listMediaIds();
  const unused = ids.filter((id) => !referenced.has(id));
  let bytes = 0;
  for (const id of unused) {
    const m = await getMediaBlob(id).catch(() => undefined);
    bytes += m?.blob?.size ?? 0;
  }
  return {
    ok: true,
    title: 'Unused media scan',
    detail: unused.length
      ? `${unused.length} item(s), ${(bytes / 1048576).toFixed(1)} MB not referenced by any project. Use "Delete unused media" to reclaim the space.`
      : 'Every stored media item is referenced by a project.',
  };
}

/**
 * Delete unreferenced media, behind an explicit confirm — the scan itself
 * never deletes, and the confirm names the exact count.
 */
export async function deleteUnusedMedia(): Promise<CommandResult> {
  const referenced = await collectReferencedMedia();
  const ids = await listMediaIds();
  const unused = ids.filter((id) => !referenced.has(id));
  if (unused.length === 0) {
    return { ok: true, title: 'Delete unused media', detail: 'Nothing to delete.' };
  }
  return new Promise((resolve) => {
    useUiStore.getState().showDialog({
      kind: 'confirm',
      title: `Delete ${unused.length} unused media item(s)?`,
      message:
        'These recordings/imports are not referenced by any saved project. This permanently deletes their audio.',
      confirmLabel: 'Delete',
      danger: true,
      onSubmit: () => {
        void pruneOrphanedMedia(referenced).then((pruned) => {
          void refreshStorageDiagnostics();
          resolve({
            ok: true,
            title: 'Delete unused media',
            detail: `Deleted ${pruned.length} item(s).`,
          });
        });
      },
    });
    // If the user dismisses the dialog instead, report that honestly after a
    // beat rather than hanging the command forever.
    setTimeout(() => {
      resolve({
        ok: true,
        title: 'Delete unused media',
        detail: `${unused.length} candidate(s) found — confirm the dialog to delete.`,
      });
    }, 400);
  });
}

/** Report clips whose media cannot be resolved. */
export function checkMissingMedia(): CommandResult {
  const p = useProjectStore.getState().project;
  const audioClips = p.clips.filter((c) => c.type === 'audio');
  const bad = audioClips.filter((c) => isMissing(c.mediaId) || !getBufferSync(c.mediaId));
  const unresolved = bad.filter((c) => isMissing(c.mediaId));

  return {
    ok: unresolved.length === 0,
    title: 'Missing media check',
    detail: unresolved.length
      ? `${unresolved.length} clip(s) reference media that could not be loaded: ${[
          ...new Set(unresolved.map((c) => `${c.name} → ${c.mediaId}`)),
        ]
          .slice(0, 5)
          .join('; ')}`
      : `All ${audioClips.length} audio clip(s) resolve${
          bad.length ? ` (${bad.length} not yet decoded)` : ''
        }.`,
  };
}

/** Release every input stream without touching playback. */
export function stopAllMediaStreams(): CommandResult {
  const before = audioInput.activeTrackStates().length;
  engine.stopAllMonitoring();
  audioInput.stopAll();
  const after = audioInput.activeTrackStates().length;
  diagLog('info', `Diagnostics: stopped media streams (${before} → ${after})`);
  return {
    ok: after === 0,
    title: 'Stop all media streams',
    detail: `Open input streams: ${before} → ${after}`,
  };
}

/**
 * Render one second of the project offline and confirm the encoder path works,
 * without downloading anything.
 */
export async function runExportSmokeTest(): Promise<CommandResult> {
  try {
    const { renderProject, audioBufferToWav, validateWav, preloadForRender } = await import(
      '../audio/exportMix'
    );
    const project = useProjectStore.getState().project;
    const ctx: BaseAudioContext = engine.context ?? new OfflineAudioContext(1, 1, 44100);
    await preloadForRender(project, ctx);
    const res = await renderProject(project, {
      range: { startBeat: 0, endBeat: 4 },
      tailSeconds: 0.2,
      sampleRate: 44100,
    });
    const wav = audioBufferToWav(res.buffer);
    const info = await validateWav(wav, ctx);
    return {
      ok: info.valid,
      title: 'Export smoke test',
      detail: info.valid
        ? `Rendered and decoded ${info.durationSec.toFixed(2)}s, ${info.channels}ch @ ${
            info.sampleRate
          }Hz, peak ${info.peak.toFixed(3)}, ${(wav.byteLength / 1024).toFixed(0)} KB`
        : `Invalid output: ${info.reason}`,
    };
  } catch (e) {
    return {
      ok: false,
      title: 'Export smoke test',
      detail: `Failed: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

/** Confirm the recorder can negotiate a format in this browser. */
export function checkRecorderSupport(): CommandResult {
  const supported = recorderSupported();
  const mime = supported ? pickMimeType() : null;
  return {
    ok: supported,
    title: 'Recorder support',
    detail: supported
      ? `MediaRecorder available; negotiated ${mime ?? 'the browser default container'}`
      : 'MediaRecorder is not available in this browser — recording is unsupported here.',
  };
}

/** Regenerate peaks for a decoded buffer, to confirm the waveform path works. */
export function checkWaveformPath(): CommandResult {
  const p = useProjectStore.getState().project;
  const clip = p.clips.find((c) => c.type === 'audio');
  if (!clip || clip.type !== 'audio') {
    return { ok: false, title: 'Waveform path', detail: 'Skipped: no audio clip in this project.' };
  }
  const buf = getBufferSync(clip.mediaId);
  if (!buf) {
    return {
      ok: false,
      title: 'Waveform path',
      detail: `Media "${clip.mediaId}" is not decoded yet.`,
    };
  }
  const peaks = peaksFromAudioBuffer(buf, 256);
  const finite = peaks.max.every((v) => Number.isFinite(v));
  return {
    ok: finite && peaks.buckets > 0,
    title: 'Waveform path',
    detail: `Generated ${peaks.buckets} buckets over ${peaks.duration.toFixed(2)}s${
      finite ? '' : ' — NON-FINITE VALUES PRESENT'
    }`,
  };
}
