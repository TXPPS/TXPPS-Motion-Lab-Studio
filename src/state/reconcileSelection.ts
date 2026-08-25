/**
 * The UI never points at something the project no longer has.
 *
 * `uiStore` holds ids that belong to `projectStore` — the selected track, the
 * clip the piano roll is editing, the automation points a lane tool is dragging
 * — and nothing was clearing them when the thing they name went away. Deleting
 * the track whose clip is open left `editClipId` naming a deleted clip and
 * `selectedTrackId` naming a deleted track, and both survived a save.
 *
 * **Found by the combinatorial fuzz** (`npm run soak --layer=fuzz`), which
 * checks after every step that no ui pointer names a missing thing, and shrank
 * a 480-step failure to one: delete a track. Confirmed by hand afterwards, and
 * the selected track dangling was worse than what the fuzzer reported.
 *
 * The fix is a subscription rather than a line in `deleteTrack`, because there
 * are many ways for a thing to stop existing and only one of them is a delete:
 * undo, redo, loading a project, dropping a lane during validation, an import
 * that replaces a track. A rule attached to each of those is a rule that will
 * be missed by the next one; a rule attached to *the project changing* cannot
 * be. `projectStore` also stays ignorant of the UI, which is the layering that
 * lets the offline renderer use it without a window.
 *
 * Only ids are reconciled. What is *shown* — which editor tab, which page — is
 * the user's position and is left alone: closing the piano roll because its
 * clip went away would be the app deciding where somebody is looking.
 */
import { useProjectStore } from './projectStore';
import { useUiStore } from './uiStore';
import type { ProjectData } from '../model/types';

/** What `uiStore` should hold once everything missing has been dropped. */
export function danglingSelection(
  project: ProjectData,
  ui: {
    selectedTrackId: string | null;
    selectedClipId: string | null;
    selectedClipIds: string[];
    editClipId: string | null;
    openDevice: { trackId: string; effectId: string } | null;
    autoSel: { trackId: string; laneId: string; pointIds: string[] } | null;
    range: { fromBeat: number; toBeat: number; trackIds: string[] } | null;
  },
): Partial<typeof ui> | null {
  const tracks = new Set(project.tracks.map((t) => t.id));
  const clips = new Set(project.clips.map((c) => c.id));
  const patch: Record<string, unknown> = {};

  if (ui.selectedTrackId !== null && !tracks.has(ui.selectedTrackId)) patch.selectedTrackId = null;
  if (ui.editClipId !== null && !clips.has(ui.editClipId)) patch.editClipId = null;
  if (ui.selectedClipId !== null && !clips.has(ui.selectedClipId)) patch.selectedClipId = null;

  const keptClips = ui.selectedClipIds.filter((id) => clips.has(id));
  if (keptClips.length !== ui.selectedClipIds.length) patch.selectedClipIds = keptClips;

  // A note selection is scoped to the open clip, so it goes with it. Left
  // behind, the next clip opened would arrive with somebody else's notes
  // selected and the first Delete would remove them.
  if (patch.editClipId === null && ui.editClipId !== null) patch.selectedNoteIds = [];

  if (ui.openDevice && !tracks.has(ui.openDevice.trackId)) patch.openDevice = null;
  if (ui.autoSel && !tracks.has(ui.autoSel.trackId)) patch.autoSel = null;

  if (ui.range) {
    const kept = ui.range.trackIds.filter((id) => tracks.has(id));
    if (kept.length === 0) patch.range = null;
    else if (kept.length !== ui.range.trackIds.length) patch.range = { ...ui.range, trackIds: kept };
  }

  return Object.keys(patch).length > 0 ? (patch as Partial<typeof ui>) : null;
}

/**
 * Start reconciling. Returns the unsubscribe, for a test that wants one run
 * without a listener left behind.
 *
 * Compared on the *project object* rather than on a version counter, because
 * `setProject` replaces it wholesale on a load and `update` replaces it on
 * every edit — so identity is the cheapest true answer to "did anything
 * change", and the reconciliation itself is a handful of set lookups.
 */
export function startSelectionReconciler(): () => void {
  const run = (project: ProjectData) => {
    const ui = useUiStore.getState();
    const patch = danglingSelection(project, ui);
    if (patch) ui.set(patch);
  };
  run(useProjectStore.getState().project);
  return useProjectStore.subscribe((s, prev) => {
    if (s.project !== prev.project) run(s.project);
  });
}
