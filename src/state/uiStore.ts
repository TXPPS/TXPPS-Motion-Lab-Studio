import type { SnapMode } from '../model/snap';
import { create } from 'zustand';
import { useWorkspaceStore } from './workspaceStore';

/**
 * Which editor the bottom panel is showing. The list of editors themselves
 * lives in `app/editors.ts`; this is only the persisted selection.
 */
export type EditorTab =
  'mixer' | 'piano' | 'drums' | 'score' | 'audio' | 'chords' | 'synth' | 'diagnostics';
export type PhoneMode = 'arrange' | 'record' | 'perform' | 'edit' | 'mix' | 'browse';
export type BrowserTab = 'projects' | 'instruments' | 'effects' | 'loops' | 'samples' | 'pool';
/**
 * Arrangement editing tools, in the order the toolbar shows them and the
 * order the number keys 1-9 select them. One list rather than a type beside a
 * key map: a tool that the toolbar offers and the keyboard has never heard of
 * is a shortcut list that lies, which is how `range` ended up unbound.
 */
export const ARRANGE_TOOLS = [
  'pointer',
  'range',
  'split',
  'erase',
  'mute',
  'slip',
  'paint',
  'listen',
  'zoom',
] as const;

export type ArrangeTool = (typeof ARRANGE_TOOLS)[number];

export interface DialogState {
  kind: 'prompt' | 'confirm';
  title: string;
  message?: string;
  initialValue?: string;
  confirmLabel?: string;
  danger?: boolean;
  onSubmit: (value: string) => void;
}

export interface MenuItem {
  label: string;
  /** Keyboard hint rendered right-aligned, e.g. "Ctrl+D". Purely informative. */
  shortcut?: string;
  danger?: boolean;
  disabled?: boolean;
  /** Stable hook for tests; the label is what a user (and a reader) sees. */
  testId?: string;
  action: () => void;
}

export interface ContextMenuState {
  x: number;
  y: number;
  items: MenuItem[];
}

export interface Toast {
  id: number;
  level: 'info' | 'error';
  message: string;
}

interface UiState {
  editorTab: EditorTab;
  browserTab: BrowserTab;
  phoneMode: PhoneMode;
  /** Forced layout via #/phone test route */
  forcedLayout: 'phone' | null;
  /** QA layout overlay via #/qa or #/debug — off in normal production use */
  debugOverlay: boolean;
  diagnosticsOpen: boolean;
  /** Keyboard shortcut help sheet */
  shortcutsOpen: boolean;
  /** First-run welcome card */
  welcomeOpen: boolean;
  /** Preferences sheet */
  settingsOpen: boolean;
  /** Export dialog */
  exportOpen: boolean;
  /** cue mix being monitored on the main output, or null for the main mix */
  monitorCueId: string | null;
  /**
   * The device whose editor is open, addressed by the channel it sits on.
   * One at a time: a console with six plugin windows open is a console you
   * cannot see, and every DAW that allows it also gives you a way to close
   * them all at once.
   */
  openDevice: { trackId: string; effectId: string } | null;
  /** Active arrangement tool */
  tool: ArrangeTool;

  selectedTrackId: string | null;
  /**
   * Primary selected clip — what the inspector shows. Always the last clip
   * added to the selection, and always a member of `selectedClipIds`.
   */
  selectedClipId: string | null;
  /** Full clip selection, in selection order. */
  selectedClipIds: string[];
  selectedNoteIds: string[];
  /** Piano roll target clip */
  editClipId: string | null;
  /** Automation point selection — one lane at a time, like every point tool. */
  autoSel: { trackId: string; laneId: string; pointIds: string[] } | null;
  /**
   * Time-range selection: a span across a set of tracks. It is not a clip
   * selection — a range covers whatever is inside it, including parts of clips —
   * so it lives beside `selectedClipIds` rather than inside it.
   */
  range: { fromBeat: number; toBeat: number; trackIds: string[] } | null;

  pxPerBeat: number;
  /**
   * Vertical arrangement zoom: a multiplier on the track lane height. One
   * number for every track, because the zoom tool scales the view rather than
   * resizing one lane — a per-track height would be project data, not view
   * state, and would have to survive a save.
   */
  laneScale: number;
  /** Grid size in beats. 0 means the grid itself is off. */
  snap: number;
  /**
   * How a position is snapped. The grid size and the snap MODE are separate
   * because 'events' and 'zero crossing' still want a grid to fall back to,
   * and 'adaptive' picks its own grid from the zoom.
   */
  snapMode: SnapMode;
  prPxPerBeat: number;
  /**
   * Lane height in the piano roll, in pixels — the roll's *second* zoom axis.
   *
   * It was a module constant of 16, which fixed two things at once: a lane was
   * 16px on a phone as well as a desktop, and the roll had one zoom. Held to a
   * floor on read rather than on write (`src/components/pianoroll/geometry.ts`),
   * because the floor is a property of the hand in use and the hand can change
   * after the value was stored.
   */
  prRowH: number;
  /**
   * What is under the finger right now, for the roll to show somewhere else.
   *
   * A hand editing a note covers it. On a desktop that is what the note's own
   * label and the pointer's tooltip are for; on touch there is no hover, no
   * tooltip, and the thing being edited is behind a thumb — so the roll reads
   * the value out in a band above the grid instead. Null when nothing is being
   * dragged; the band is not drawn at all rather than drawn empty.
   */
  prDragReadout: { text: string; nearTop: boolean } | null;
  prSnap: number;
  /** Piano roll key (tonic pitch class 0-11) and scale id; 'chromatic' = off */
  prKey: number;
  prScale: string;
  /** Snap added/edited pitches to the scale */
  prScaleLock: boolean;

  keyboardOctave: number;

  dialog: DialogState | null;
  contextMenu: ContextMenuState | null;
  toasts: Toast[];

  set: (patch: Partial<UiState>) => void;
  selectTrack: (id: string | null) => void;
  selectClip: (id: string | null, trackId?: string | null) => void;
  /** Shift/Ctrl-click: add or remove one clip without dropping the rest. */
  toggleClipSelection: (id: string, trackId?: string | null) => void;
  /** Replace the whole selection (marquee, select-all). */
  selectClips: (ids: string[]) => void;
  openEditorFor: (clipId: string, phone?: boolean) => void;
  showDialog: (d: DialogState) => void;
  closeDialog: () => void;
  showMenu: (m: ContextMenuState) => void;
  closeMenu: () => void;
  toast: (level: Toast['level'], message: string) => void;
  dismissToast: (id: number) => void;
}

let toastId = 0;

export const useUiStore = create<UiState>((set, get) => ({
  editorTab: 'mixer',
  browserTab: 'projects',
  phoneMode: 'arrange',
  forcedLayout: null,
  debugOverlay: false,
  diagnosticsOpen: false,
  shortcutsOpen: false,
  welcomeOpen: false,
  settingsOpen: false,
  exportOpen: false,
  monitorCueId: null,
  openDevice: null,
  tool: 'pointer',

  selectedTrackId: null,
  selectedClipId: null,
  selectedClipIds: [],
  selectedNoteIds: [],
  editClipId: null,
  autoSel: null,
  range: null,

  pxPerBeat: 26,
  laneScale: 1,
  snap: 0.25,
  snapMode: 'grid',
  prPxPerBeat: 32,
  // 16 is the desktop lane the roll has always drawn; `useRowHeight` raises it
  // to 56 on a touch device, so a finger never meets the desktop default.
  prRowH: 16,
  prDragReadout: null,
  prSnap: 0.25,
  prKey: 0,
  prScale: 'chromatic',
  prScaleLock: false,

  keyboardOctave: 4,

  dialog: null,
  contextMenu: null,
  toasts: [],

  set: (patch) => set(patch),
  selectTrack: (id) => set({ selectedTrackId: id }),
  selectClip: (id, trackId) =>
    set({
      selectedClipId: id,
      selectedClipIds: id ? [id] : [],
      ...(trackId !== undefined ? { selectedTrackId: trackId } : {}),
      ...(id ? {} : { selectedNoteIds: [] }),
    }),
  toggleClipSelection: (id, trackId) =>
    set((s) => {
      const has = s.selectedClipIds.includes(id);
      const ids = has ? s.selectedClipIds.filter((x) => x !== id) : [...s.selectedClipIds, id];
      return {
        selectedClipIds: ids,
        // Primary follows the toggle: the clip just added, or the last survivor.
        selectedClipId: has ? (ids[ids.length - 1] ?? null) : id,
        ...(trackId !== undefined && !has ? { selectedTrackId: trackId } : {}),
      };
    }),
  selectClips: (ids) =>
    set({
      selectedClipIds: ids,
      selectedClipId: ids[ids.length - 1] ?? null,
      ...(ids.length === 0 ? { selectedNoteIds: [] } : {}),
    }),
  openEditorFor: (clipId, phone) => {
    // Opening a clip for editing has to open the editor. Which panes are on
    // screen is the workspace's business, not this store's — the boolean that
    // used to be set here was read by nothing, so double-clicking a clip while
    // the bottom panel was hidden or another pane was full screen selected the
    // clip and showed the user nothing.
    useWorkspaceStore.getState().reveal('editor');
    set({
      editClipId: clipId,
      selectedClipId: clipId,
      selectedClipIds: [clipId],
      selectedNoteIds: [],
      editorTab: 'piano',
      ...(phone ? { phoneMode: 'edit' } : {}),
    });
  },
  showDialog: (dialog) => set({ dialog }),
  closeDialog: () => set({ dialog: null }),
  showMenu: (contextMenu) => set({ contextMenu }),
  closeMenu: () => set({ contextMenu: null }),
  toast: (level, message) => {
    const id = ++toastId;
    set((s) => ({ toasts: [...s.toasts.slice(-3), { id, level, message }] }));
    setTimeout(() => get().dismissToast(id), level === 'error' ? 6000 : 3200);
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));
