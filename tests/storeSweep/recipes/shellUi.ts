/**
 * The UI store: selection, dialogs, menus and toasts.
 *
 * Split from the other seven because it carries more actions than the rest put
 * together, and because it is the one store here that persists nothing — every
 * row states that, which is what stops "no persistence" being a way to opt out
 * of the phase that checks it.
 */
import { useUiStore } from '../../../src/state/uiStore';
import type { ShellStore } from './shell';
import type { Recipe } from '../harness';

const s = () => useUiStore.getState();

/** Why none of these reach storage. Stated per row, not assumed. */
const WHY = 'selection and overlays are session state; nothing here is written down';

export const ui: ShellStore = {
  name: 'uiStore',
  read: () => useUiStore.getState() as unknown as Record<string, unknown>,
  reset: () =>
    s().set({
      selectedClipId: null,
      selectedClipIds: [],
      selectedNoteIds: [],
      editClipId: null,
      editorTab: 'mixer',
      dialog: null,
      contextMenu: null,
      toasts: [],
    }),
  recipes: (): Recipe[] => [
    {
      id: 'store:uiStore.selectClip',
      undo: 'none',
      transient: WHY,
      run: () => {
        s().selectClip('clip-a', 'track-a');
        return `primary ${s().selectedClipId}, set ${s().selectedClipIds.length}`;
      },
    },
    {
      id: 'store:uiStore.toggleClipSelection',
      undo: 'none',
      transient: WHY,
      arrange: () => s().selectClip('clip-a', 'track-a'),
      run: () => {
        s().toggleClipSelection('clip-b', 'track-a');
        return `set ${s().selectedClipIds.join(',')}`;
      },
    },
    {
      id: 'store:uiStore.selectClips',
      undo: 'none',
      transient: WHY,
      run: () => {
        s().selectClips(['clip-a', 'clip-b', 'clip-c']);
        return `primary ${s().selectedClipId} of ${s().selectedClipIds.length}`;
      },
    },
    {
      id: 'store:uiStore.openEditorFor',
      undo: 'none',
      transient: WHY,
      run: () => {
        s().openEditorFor('clip-a');
        return `editing ${s().editClipId} on the ${s().editorTab} tab`;
      },
    },
    {
      id: 'store:uiStore.showDialog',
      undo: 'none',
      transient: WHY,
      run: () => {
        s().showDialog({ kind: 'prompt', title: 'Sweep', onSubmit: () => {} });
        return `dialog ${s().dialog?.title}`;
      },
    },
    {
      id: 'store:uiStore.closeDialog',
      undo: 'none',
      transient: WHY,
      arrange: () => s().showDialog({ kind: 'prompt', title: 'Sweep', onSubmit: () => {} }),
      run: () => {
        s().closeDialog();
        return `dialog ${s().dialog}`;
      },
    },
    {
      id: 'store:uiStore.showMenu',
      undo: 'none',
      transient: WHY,
      run: () => {
        s().showMenu({ x: 10, y: 20, items: [{ label: 'Sweep', action: () => {} }] });
        return `menu of ${s().contextMenu?.items.length}`;
      },
    },
    {
      id: 'store:uiStore.closeMenu',
      undo: 'none',
      transient: WHY,
      arrange: () => s().showMenu({ x: 10, y: 20, items: [{ label: 'Sweep', action: () => {} }] }),
      run: () => {
        s().closeMenu();
        return `menu ${s().contextMenu}`;
      },
    },
    {
      id: 'store:uiStore.toast',
      undo: 'none',
      transient: WHY,
      run: () => {
        s().toast('error', 'Sweep toast');
        return `${s().toasts.length} toasts`;
      },
    },
    {
      id: 'store:uiStore.dismissToast',
      undo: 'none',
      transient: WHY,
      arrange: () => s().toast('info', 'Doomed toast'),
      run: () => {
        s().dismissToast(s().toasts[0].id);
        return `${s().toasts.length} toasts`;
      },
    },
  ],
};
