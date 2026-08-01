/**
 * Clip clipboard.
 *
 * In-memory rather than the system clipboard: clip data references media ids
 * that only mean something inside this project's storage, so exporting them as
 * OS clipboard text would produce something that pastes nowhere. Copies are
 * deep clones taken at copy time — later edits to the originals do not mutate
 * what was copied.
 *
 * Paste lands the block at the playhead (snapped), on the clips' own tracks,
 * with internal spacing preserved. Clips whose track has since been deleted are
 * skipped rather than guessed onto another track.
 */
import { engine } from '../audio/engine';
import { snapBeatFloor } from '../model/music';
import type { Clip } from '../model/types';
import { useProjectStore } from '../state/projectStore';
import { useUiStore } from '../state/uiStore';

let buffer: Clip[] = [];

export function clipboardCount(): number {
  return buffer.length;
}

/** Test seam. */
export function resetClipboard(): void {
  buffer = [];
}

function selectedClips(): Clip[] {
  const ids = new Set(useUiStore.getState().selectedClipIds);
  return useProjectStore.getState().project.clips.filter((c) => ids.has(c.id));
}

export function copySelection(): number {
  const clips = selectedClips();
  if (clips.length === 0) return 0;
  buffer = structuredClone(clips);
  useUiStore
    .getState()
    .toast('info', `Copied ${clips.length} clip${clips.length === 1 ? '' : 's'}`);
  return clips.length;
}

export function cutSelection(): number {
  const clips = selectedClips();
  if (clips.length === 0) return 0;
  buffer = structuredClone(clips);
  useProjectStore.getState().deleteClips(clips.map((c) => c.id));
  useUiStore.getState().selectClips([]);
  useUiStore.getState().toast('info', `Cut ${clips.length} clip${clips.length === 1 ? '' : 's'}`);
  return clips.length;
}

export function pasteAtPlayhead(): number {
  if (buffer.length === 0) return 0;
  const ui = useUiStore.getState();
  const at = snapBeatFloor(engine.getPositionBeats(), Math.max(ui.snap, 0.25));
  const minStart = Math.min(...buffer.map((c) => c.start));

  const placed = buffer.map((c) => ({ ...structuredClone(c), start: at + (c.start - minStart) }));
  const ids = useProjectStore.getState().insertClips(placed);

  if (ids.length === 0) {
    ui.toast('error', 'Nothing pasted: the copied clips’ tracks no longer exist.');
    return 0;
  }
  if (ids.length < buffer.length) {
    ui.toast('error', `Pasted ${ids.length} of ${buffer.length} — some tracks no longer exist.`);
  }
  useUiStore.getState().selectClips(ids);
  return ids.length;
}

/** Duplicate the selection as a block and select the copies. */
export function duplicateSelection(): number {
  const ids = useUiStore.getState().selectedClipIds;
  if (ids.length === 0) return 0;
  const newIds = useProjectStore.getState().duplicateClips(ids);
  if (newIds.length) useUiStore.getState().selectClips(newIds);
  return newIds.length;
}
