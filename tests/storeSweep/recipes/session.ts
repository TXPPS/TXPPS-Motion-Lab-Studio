/**
 * The five that operate on the session rather than on the song.
 *
 * `beginGesture` and `markSaved` change nothing in the document at all, which
 * is why they carry `scope: 'store'` — asking them to move the project would be
 * asking them to do the thing they exist not to do.
 */
import { useProjectStore } from '../../../src/state/projectStore';
import { createEmptyProject } from '../../../src/model/demoProject';
import { trackNow, type Handles } from '../fixture';
import type { Recipe } from '../harness';

const s = () => useProjectStore.getState();

export const sessionRecipes = (h: Handles): Recipe[] => [
  {
    id: 'store:projectStore.setProject',
    undo: 'none',
    // Loading a song is not an edit to the one that was open, and the store
    // clears both stacks — you cannot undo across a project boundary into a
    // document that is no longer on screen.
    run: () => {
      s().setProject(createEmptyProject('Swept'), { markClean: true });
      return `project ${useProjectStore.getState().project.name}`;
    },
  },
  {
    id: 'store:projectStore.markSaved',
    undo: 'none',
    scope: 'store',
    transient: 'the dirty flag and the save time are the session, not the song',
    arrange: () => s().setTrack(h.inst.id, { name: 'Dirtied' }),
    run: () => {
      s().markSaved(useProjectStore.getState().project);
      return `dirty ${useProjectStore.getState().dirty}`;
    },
  },
  {
    id: 'store:projectStore.beginGesture',
    undo: 'none',
    scope: 'store',
    transient: 'an open drag is session state; nothing about it is written down',
    run: () => {
      s().beginGesture();
      return `gesture depth ${useProjectStore.getState().gestureDepth}`;
    },
  },
  {
    id: 'store:projectStore.endGesture',
    undo: 'step',
    // The whole point of the gesture: many continuous writes, one undo step,
    // pushed by the release rather than by any of the writes.
    arrange: () => s().beginGesture(),
    run: () => {
      s().setTrack(h.inst.id, { volume: 0.11 });
      s().setTrack(h.inst.id, { volume: 0.22 });
      s().endGesture();
      return `volume ${trackNow(h.inst.id).volume}, depth ${useProjectStore.getState().gestureDepth}`;
    },
  },
  {
    id: 'store:projectStore.flushGestures',
    undo: 'step',
    // The safety net: a drag whose pointer never came back up must not leave
    // the undo system wedged open for the rest of the session.
    arrange: () => {
      s().beginGesture();
      s().beginGesture();
    },
    run: () => {
      s().setTrack(h.inst.id, { volume: 0.33 });
      s().flushGestures();
      return `volume ${trackNow(h.inst.id).volume}, depth ${useProjectStore.getState().gestureDepth}`;
    },
  },
];
