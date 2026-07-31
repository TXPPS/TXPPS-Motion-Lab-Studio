import { create } from 'zustand';

export type EditorTab = 'mixer' | 'piano' | 'synth' | 'diagnostics';
export type PhoneMode = 'arrange' | 'record' | 'perform' | 'edit' | 'mix' | 'browse';
export type BrowserTab = 'projects' | 'presets' | 'loops';

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

  selectedTrackId: string | null;
  selectedClipId: string | null;
  selectedNoteIds: string[];
  /** Piano roll target clip */
  editClipId: string | null;

  pxPerBeat: number;
  snap: number;
  prPxPerBeat: number;
  prSnap: number;

  keyboardOctave: number;

  dialog: DialogState | null;
  contextMenu: ContextMenuState | null;
  toasts: Toast[];

  set: (patch: Partial<UiState>) => void;
  selectTrack: (id: string | null) => void;
  selectClip: (id: string | null, trackId?: string | null) => void;
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

  selectedTrackId: null,
  selectedClipId: null,
  selectedNoteIds: [],
  editClipId: null,

  pxPerBeat: 26,
  snap: 0.25,
  prPxPerBeat: 32,
  prSnap: 0.25,

  keyboardOctave: 4,

  dialog: null,
  contextMenu: null,
  toasts: [],

  set: (patch) => set(patch),
  selectTrack: (id) => set({ selectedTrackId: id }),
  selectClip: (id, trackId) =>
    set({
      selectedClipId: id,
      ...(trackId !== undefined ? { selectedTrackId: trackId } : {}),
      ...(id ? {} : { selectedNoteIds: [] }),
    }),
  openEditorFor: (clipId, phone) =>
    set({
      editClipId: clipId,
      selectedClipId: clipId,
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
