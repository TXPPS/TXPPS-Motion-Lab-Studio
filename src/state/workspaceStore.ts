/**
 * The workspace: which panes are drawn, how big, which editor, and the named
 * layouts a musician can recall. Persisted to localStorage.
 *
 * The model itself is `workspaceModel.ts` and the presets are
 * `workspacePresets.ts`; this file is the store — the mutators, the persistence
 * and the scroll survival across a maximise. Split because the model is read by
 * tests and by three shells that have no business importing zustand, and because
 * one file describing all three was past this repository's length rule.
 *
 * Stored values are validated, clamped and migrated on load, so a layout saved
 * by an older build (or at a very different viewport) can never reproduce an
 * unusable workspace.
 */
import { create } from 'zustand';
import { diagLog } from './diagnostics';
import { captureScroll, restoreScroll } from './workspaceScroll';
import { layoutOf, loadWorkspace, persistWorkspace } from './workspacePersist';
import {
  freshLayout,
  normalizeLayout,
  paneIsOpen,
  restoredSize,
  type EditorTab,
  type MaximizedPane,
  type PaneId,
  type PaneState,
  type PhoneMode,
  type WorkspaceLayout,
} from './workspaceModel';
import {
  BUILT_IN_WORKSPACES,
  newWorkspaceId,
  uniqueName,
  type NamedWorkspace,
} from './workspacePresets';

export type {
  EditorTab,
  MaximizedPane,
  PaneId,
  PaneState,
  PhoneMode,
  WorkspaceLayout,
} from './workspaceModel';
export {
  DEFAULT_LAYOUT,
  PANE_IDS,
  PANE_LIMITS,
  RAIL_PX,
  freshLayout,
  normalizeLayout,
  paneIsOpen,
  restoredSize,
} from './workspaceModel';
export type { NamedWorkspace } from './workspacePresets';
export { BUILT_IN_WORKSPACES } from './workspacePresets';

/** The lane and view flags, which are booleans on the layout rather than panes. */
export type LayoutFlag =
  | 'showMarkers'
  | 'showSections'
  | 'showChords'
  | 'showTempoLane'
  | 'showOverview'
  | 'channelRackOpen';

interface WorkspaceState extends WorkspaceLayout {
  /** Every named workspace, built-ins first. */
  workspaces: NamedWorkspace[];
  /** The workspace most recently recalled or saved, or null after any edit. */
  activeWorkspaceId: string | null;
  /**
   * Bumped whenever a stored size is written over the live layout wholesale.
   *
   * `react-resizable-panels` reads `defaultSize` at MOUNT and owns the size from
   * then on, so a recall that only changed the store left the dividers exactly
   * where they were: measured, a workspace saved with the inspector at 486 px
   * recalled to the 190 px it happened to be sitting at. The panel group is
   * keyed on this, so a recall remounts it and every pane takes its stored size
   * as its default again — the same mechanism maximise already relies on, which
   * is why the scroll positions are captured across it.
   *
   * A counter rather than a boolean: two recalls in a row must remount twice,
   * and a flag that was already true the second time would not.
   */
  layoutEpoch: number;

  /** Patch the layout's non-pane fields (lane flags, the editor tab, phone mode). */
  setLayout: (patch: Partial<WorkspaceLayout>) => void;
  /** Patch one pane. Sizes are clamped by the model's own table. */
  setPane: (id: PaneId, patch: Partial<PaneState>) => void;
  /** Record a divider's new position. */
  setPaneSize: (id: PaneId, size: number) => void;
  toggle: (key: LayoutFlag) => void;
  /** Show or hide a pane outright. */
  togglePane: (id: PaneId) => void;
  /**
   * Collapse a pane to its rail, or expand it back to the size it had.
   *
   * The size is captured on the way down, which is why this is one action rather
   * than a `collapsed` flag callers set: a caller that set the flag without
   * capturing would give the pane nothing to come back to, and the bug would be
   * invisible until somebody expanded it.
   */
  toggleCollapsed: (id: PaneId) => void;
  /** Toggle full screen for a pane (passing the current pane restores). */
  setMaximized: (pane: MaximizedPane) => void;
  /**
   * Show a pane, whatever it takes.
   *
   * "Open this in the editor" has to actually open the editor. The panels a
   * command wants are hidden three different ways now — switched off, collapsed
   * to a rail, or standing behind another pane's full screen — and a command
   * that only knew about one of them silently does nothing in the other cases.
   */
  reveal: (pane: PaneId) => void;
  /** Reveal the editor pane and put a given editor in front of it. */
  showEditorTab: (tab: EditorTab) => void;
  setPhoneMode: (mode: PhoneMode) => void;

  saveWorkspace: (name: string) => string;
  recallWorkspace: (id: string) => void;
  renameWorkspace: (id: string, name: string) => void;
  deleteWorkspace: (id: string) => void;

  reset: () => void;
}

/** The two halves the persistence module wants, taken from the live store. */
const persistNow = (s: WorkspaceState) =>
  persistWorkspace({ layout: layoutOf(s), workspaces: s.workspaces });

const initial = loadWorkspace();

export const useWorkspaceStore = create<WorkspaceState>((set, get) => {
  /** Every mutator ends the same way: write it down, and it is no longer a preset. */
  const commit = (opts: { keepsWorkspace?: boolean } = {}) => {
    if (!opts.keepsWorkspace && get().activeWorkspaceId !== null) set({ activeWorkspaceId: null });
    persistNow(get());
  };

  const patchPane = (id: PaneId, patch: Partial<PaneState>) => {
    const panes = get().panes;
    // Through the normaliser rather than assigned, so a size arriving from the
    // panel library's own rounding is clamped by the same table the shells were
    // given their limits from. Two clampers is how the store and the JSX came to
    // disagree in the first place.
    const merged = normalizeLayout({
      ...layoutOf(get()),
      panes: { ...panes, [id]: { ...panes[id], ...patch } },
    });
    set({ panes: merged.panes });
  };

  return {
    ...initial.layout,
    workspaces: [...BUILT_IN_WORKSPACES, ...initial.workspaces],
    activeWorkspaceId: null,
    layoutEpoch: 0,

    setLayout: (patch) => {
      set(normalizeLayout({ ...layoutOf(get()), ...patch }));
      commit();
    },
    setPane: (id, patch) => {
      patchPane(id, patch);
      commit();
    },
    setPaneSize: (id, size) => {
      // A collapsed pane's measured extent is the rail, not a preference — the
      // panel library still reports a resize when the rail lays out, and writing
      // that down would overwrite the size the pane is supposed to come back to.
      if (get().panes[id].collapsed) return;
      patchPane(id, { size });
      commit();
    },
    toggle: (key) => {
      set({ [key]: !get()[key] } as Partial<WorkspaceState>);
      commit();
    },
    togglePane: (id) => {
      patchPane(id, { visible: !get().panes[id].visible });
      commit();
    },
    toggleCollapsed: (id) => {
      const pane = get().panes[id];
      if (pane.collapsed) {
        patchPane(id, { collapsed: false, size: restoredSize(pane, id) });
      } else {
        // The size goes into `lastSize` before the rail takes its place. Without
        // this the pane has nothing to expand back to and every collapse would
        // land on the default, which is the defect the boolean hide had.
        patchPane(id, { collapsed: true, lastSize: pane.size });
      }
      commit();
    },
    reveal: (pane) => {
      const state = get();
      // Another pane's full screen hides this one however visible it is, so step
      // out of it — but leave this pane maximized if it already is, because the
      // caller asked to see it and it could not be more visible than that.
      if (state.maximized !== null && state.maximized !== pane) set({ maximized: null });
      const current = get().panes[pane];
      if (!paneIsOpen(current)) {
        patchPane(pane, {
          visible: true,
          collapsed: false,
          ...(current.collapsed ? { size: restoredSize(current, pane) } : {}),
        });
      }
      commit();
    },
    showEditorTab: (tab) => {
      get().reveal('editor');
      set({ editorTab: tab });
      commit();
    },
    setPhoneMode: (mode) => {
      set({ phoneMode: mode });
      commit();
    },
    setMaximized: (pane) => {
      const next = get().maximized === pane ? null : pane;
      const mem = captureScroll();
      set({ maximized: next });
      commit();
      restoreScroll(mem);
    },

    saveWorkspace: (name) => {
      const id = newWorkspaceId();
      const entry: NamedWorkspace = {
        id,
        name: uniqueName(name, get().workspaces),
        builtIn: false,
        layout: layoutOf(get()),
      };
      set({ workspaces: [...get().workspaces, entry], activeWorkspaceId: id });
      persistNow(get());
      diagLog('info', `Workspace saved: ${entry.name}`);
      return id;
    },
    recallWorkspace: (id) => {
      const found = get().workspaces.find((w) => w.id === id);
      if (!found) return;
      const mem = captureScroll();
      // Through the normaliser: a workspace saved by an older build carries an
      // older shape, and recalling it must not be the one path into the store
      // that skips migration.
      set({
        ...normalizeLayout(found.layout),
        activeWorkspaceId: id,
        layoutEpoch: get().layoutEpoch + 1,
      });
      persistNow(get());
      diagLog('info', `Workspace recalled: ${found.name}`);
      restoreScroll(mem);
    },
    renameWorkspace: (id, name) => {
      const trimmed = name.trim().slice(0, 60);
      if (!trimmed) return;
      const others = get().workspaces.filter((w) => w.id !== id);
      set({
        workspaces: get().workspaces.map((w) =>
          w.id === id && !w.builtIn ? { ...w, name: uniqueName(trimmed, others) } : w,
        ),
      });
      persistNow(get());
    },
    deleteWorkspace: (id) => {
      const doomed = get().workspaces.find((w) => w.id === id);
      if (!doomed || doomed.builtIn) return;
      set({
        workspaces: get().workspaces.filter((w) => w.id !== id),
        ...(get().activeWorkspaceId === id ? { activeWorkspaceId: null } : {}),
      });
      persistNow(get());
      diagLog('info', `Workspace deleted: ${doomed.name}`);
    },

    reset: () => {
      // A reset writes every size at once, so it needs the remount for the same
      // reason a recall does — otherwise "Reset layout" moved the flags and left
      // the dividers where they were. And a remount resets DOM scroll, so the
      // positions are carried across it exactly as maximise carries them.
      const mem = captureScroll();
      set({ ...freshLayout(), activeWorkspaceId: null, layoutEpoch: get().layoutEpoch + 1 });
      persistNow(get());
      diagLog('info', 'Workspace layout reset to defaults');
      restoreScroll(mem);
    },
  };
});

/** Selector: is this pane drawing its contents right now? */
export const selectPaneOpen =
  (id: PaneId) =>
  (s: WorkspaceState): boolean =>
    paneIsOpen(s.panes[id]);

/** Selector: is this pane on screen at all, as a rail or in full? */
export const selectPaneShown =
  (id: PaneId) =>
  (s: WorkspaceState): boolean =>
    s.panes[id].visible;
