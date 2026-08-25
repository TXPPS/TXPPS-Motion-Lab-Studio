/**
 * The UI's ids are dropped when the project loses what they name.
 *
 * Found by Directive 11 §3's combinatorial fuzz, which asserts after every step
 * that no `uiStore` pointer names a missing thing. It broke at step 479 of a
 * 1500-step run and shrank to one step: delete a track. Confirming it by hand
 * found more than the fuzzer had reported — `selectedTrackId` was dangling as
 * well as `editClipId`, and both survived a save.
 *
 * The cases below are the reason the fix is a subscription rather than a line
 * in `deleteTrack`. Every one of them removes something without going near a
 * delete: undo, redo, and loading a different project. A rule attached to the
 * delete would pass the first case here and fail the other three.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { useProjectStore } from '../src/state/projectStore';
import { useUiStore } from '../src/state/uiStore';
import { danglingSelection, startSelectionReconciler } from '../src/state/reconcileSelection';

function fixture() {
  const st = useProjectStore.getState();
  const trackId = st.addTrack('instrument');
  const clipId = st.addMidiClip(trackId, 0, 4);
  useUiStore.getState().set({
    selectedTrackId: trackId,
    editClipId: clipId,
    selectedClipId: clipId,
    selectedClipIds: [clipId],
    selectedNoteIds: ['n1'],
  });
  return { trackId, clipId };
}

describe('the ui never points at something the project has lost', () => {
  let stop = () => {};

  beforeEach(() => {
    stop();
    useProjectStore.getState().setProject({
      ...useProjectStore.getState().project,
      tracks: [],
      clips: [],
    });
    useUiStore.getState().set({
      selectedTrackId: null,
      editClipId: null,
      selectedClipId: null,
      selectedClipIds: [],
      selectedNoteIds: [],
    });
    stop = startSelectionReconciler();
    return () => stop();
  });

  it('drops the selected track and the open clip when the track is deleted', () => {
    const { trackId, clipId } = fixture();
    expect(useUiStore.getState().editClipId, 'the fixture never opened a clip').toBe(clipId);

    useProjectStore.getState().deleteTrack(trackId);

    const ui = useUiStore.getState();
    expect(ui.selectedTrackId, 'the selection still names a deleted track').toBeNull();
    expect(ui.editClipId, 'the editor still names a deleted clip').toBeNull();
    expect(ui.selectedClipIds, 'a deleted clip is still selected').toEqual([]);
    // The note selection is scoped to the clip that closed. Left behind, the
    // next clip opened arrives with somebody else's notes selected, and the
    // first Delete removes them.
    expect(ui.selectedNoteIds, 'notes from the closed clip are still selected').toEqual([]);
  });

  it('drops the open clip when the clip alone is deleted', () => {
    const { trackId, clipId } = fixture();
    useProjectStore.getState().deleteClip(clipId);
    expect(useUiStore.getState().editClipId).toBeNull();
    expect(useUiStore.getState().selectedTrackId, 'the track is still there').toBe(trackId);
  });

  it('drops them when an undo removes the track, with no delete involved', () => {
    // The case a rule inside `deleteTrack` would miss. Nothing is deleted here:
    // the project is replaced by an earlier one that never had the track.
    const before = useProjectStore.getState().project;
    const { trackId } = fixture();
    expect(useUiStore.getState().selectedTrackId).toBe(trackId);
    useProjectStore.getState().setProject(before);
    expect(useUiStore.getState().selectedTrackId).toBeNull();
    expect(useUiStore.getState().editClipId).toBeNull();
  });

  it('leaves a live selection alone', () => {
    // The other half. A reconciler that cleared too eagerly would pass every
    // case above and make the product unusable.
    const { trackId, clipId } = fixture();
    useProjectStore.getState().setTrack(trackId, { name: 'renamed' });
    const ui = useUiStore.getState();
    expect(ui.selectedTrackId).toBe(trackId);
    expect(ui.editClipId).toBe(clipId);
    expect(ui.selectedClipIds).toEqual([clipId]);
  });

  it('keeps the clips in a multi-selection that survived', () => {
    const { trackId } = fixture();
    const st = useProjectStore.getState();
    const second = st.addMidiClip(trackId, 8, 4);
    const first = st.project.clips.find((c) => c.id !== second)!.id;
    useUiStore.getState().set({ selectedClipIds: [first, second], selectedClipId: second });
    useProjectStore.getState().deleteClip(first);
    expect(useUiStore.getState().selectedClipIds).toEqual([second]);
    expect(useUiStore.getState().selectedClipId).toBe(second);
  });
});

describe('the predicate itself', () => {
  const project = { tracks: [{ id: 't1' }], clips: [{ id: 'c1' }] } as never;
  const clean = {
    selectedTrackId: 't1',
    selectedClipId: 'c1',
    selectedClipIds: ['c1'],
    editClipId: 'c1',
    openDevice: null,
    autoSel: null,
    range: null,
  };

  it('returns null when nothing dangles, so no set() is issued', () => {
    // A reconciler that wrote on every project change would put the ui store
    // in a render loop with itself.
    expect(danglingSelection(project, clean)).toBeNull();
  });

  it('keeps an open device on the master, which is not a track', () => {
    // The master is a channel and is not a member of `project.tracks`, so the
    // first version of this predicate read its id as dangling and cleared the
    // window — including on the change the window's own power button makes, so
    // bypassing a master insert from its editor shut the editor. Two e2e cases
    // caught it and neither had been run when this file was written.
    expect(
      danglingSelection(project, { ...clean, openDevice: { trackId: 'master', effectId: 'fx1' } }),
    ).toBeNull();
  });

  it('drops an open device on a track that is gone', () => {
    const patch = danglingSelection(project, {
      ...clean,
      openDevice: { trackId: 'gone', effectId: 'fx1' },
    });
    expect(patch).toEqual({ openDevice: null });
  });

  it('narrows a time range to the tracks that remain, and clears an empty one', () => {
    expect(
      danglingSelection(project, {
        ...clean,
        range: { fromBeat: 0, toBeat: 4, trackIds: ['t1', 'gone'] },
      }),
    ).toEqual({ range: { fromBeat: 0, toBeat: 4, trackIds: ['t1'] } });
    expect(
      danglingSelection(project, {
        ...clean,
        range: { fromBeat: 0, toBeat: 4, trackIds: ['gone'] },
      }),
    ).toEqual({ range: null });
  });
});
