import { create } from 'zustand';

export type EditorTab = 'mixer' | 'piano' | 'synth' | 'diagnostics';
export type PhoneMode = 'arrange' | 'record' | 'perform' | 'edit' | 'mix' | 'browse';
export type BrowserTab = 'projects' | 'presets' | 'loops' | 'samples';
/** Arrangement editing tools. Only fully-usable tools are offered. */
export type ArrangeTool = 'pointer' | 'split' | 'erase' | 'mute' | 'slip';

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
  panelBrowser: boolean;
  panelInspector: boolean;
  panelEditor: boolean;
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

  pxPerBeat: number;
  snap: number;
  prPxPerBeat: number;
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
  panelBrowser: true,
  panelInspector: true,
  panelEditor: true,
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
  tool: 'pointer',

  selectedTrackId: null,
  selectedClipId: null,
  selectedClipIds: [],
  selectedNoteIds: [],
  editClipId: null,
  autoSel: null,

  pxPerBeat: 26,
  snap: 0.25,
  prPxPerBeat: 32,
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
  openEditorFor: (clipId, phone) =>
    set({
      editClipId: clipId,
      selectedClipId: clipId,
      selectedClipIds: [clipId],
      selectedNoteIds: [],
      panelEditor: true,
      editorTab: 'piano',
      ...(phone ? { phoneMode: 'edit' } : {}),
    }),
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
