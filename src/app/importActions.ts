/**
 * UI-facing wrapper around the import pipeline: starts audio, runs the import,
 * reports the outcome, and selects the result. Kept out of `audio/importAudio`
 * so the pipeline itself stays free of store and toast dependencies and can be
 * unit-tested without a UI.
 */
import { engine } from '../audio/engine';
import {
  IMPORT_ACCEPT,
  audioFilesFromDrop,
  importAudioFiles,
  summariseImport,
  type ImportOutcome,
  type ImportTarget,
} from '../audio/importAudio';
import { useProjectStore } from '../state/projectStore';
import { useUiStore } from '../state/uiStore';

let importing = false;

export function isImporting(): boolean {
  return importing;
}

/**
 * Import files and report honestly. Audio is started first (the caller is
 * always a user gesture) so files decode at the device sample rate; if it
 * cannot start, import still proceeds through the offline fallback.
 */
export async function runImport(files: File[], target: ImportTarget): Promise<ImportOutcome[]> {
  const ui = useUiStore.getState();
  if (files.length === 0) return [];
  if (importing) {
    ui.toast('error', 'An import is already running.');
    return [];
  }

  importing = true;
  try {
    await engine.start().catch(() => false);
    const results = await importAudioFiles(files, target, engine.context);

    const summary = summariseImport(results);
    ui.toast(summary.level, summary.text);

    const firstClip = results.find((r) => r.ok && r.clipId);
    if (firstClip?.ok && firstClip.clipId && target.trackId) {
      useUiStore.getState().selectClip(firstClip.clipId, target.trackId);
    }
    return results;
  } finally {
    importing = false;
  }
}

/**
 * Open the file picker and import onto `target`. Uses a detached input so no
 * hidden element has to live in the tree; some browsers require the element to
 * be in the document, so it is appended and removed around the click.
 */
export function pickAndImport(target: ImportTarget): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = IMPORT_ACCEPT;
  input.multiple = true;
  input.style.position = 'fixed';
  input.style.left = '-9999px';
  input.onchange = () => {
    const files = input.files ? Array.from(input.files) : [];
    input.remove();
    void runImport(files, target);
  };
  document.body.appendChild(input);
  input.click();
}

/** Import a drop event's payload onto a track at a beat. */
export function importDrop(dt: DataTransfer | null, target: ImportTarget): void {
  const files = audioFilesFromDrop(dt);
  if (files.length === 0) return;
  void runImport(files, target);
}

/** Does this drag carry files? Used to show a drop affordance without reading them. */
export function dragHasFiles(dt: DataTransfer | null): boolean {
  if (!dt) return false;
  if (dt.types && Array.from(dt.types).includes('Files')) return true;
  return dt.items ? Array.from(dt.items).some((i) => i.kind === 'file') : false;
}

/** Import into the project library, creating an audio track for the first file. */
export async function importToNewTrack(files: File[], startBeat = 0): Promise<void> {
  const trackId = useProjectStore.getState().addTrack('audio');
  const results = await runImport(files, { trackId, startBeat });
  // An import that produced nothing must not leave an empty track behind.
  if (!results.some((r) => r.ok && r.clipId)) {
    useProjectStore.getState().deleteTrack(trackId);
  } else {
    useUiStore.getState().selectTrack(trackId);
  }
}
