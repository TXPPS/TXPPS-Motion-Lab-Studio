/**
 * Workspace layout: panel visibility and sizes, persisted to localStorage.
 * Only small numbers/booleans live here — never project or audio data.
 *
 * Stored values are validated and normalized on load, so a layout saved by an
 * older build (or at a very different viewport) can never reproduce an unusable
 * workspace; anything out of range falls back to the defaults.
 */
import { create } from 'zustand';
import { diagLog } from './diagnostics';

const STORAGE_KEY = 'txpps-motionlab-workspace-v1';

export interface WorkspaceLayout {
  /** percentages within their panel group */
  browserSize: number;
  inspectorSize: number;
  editorSize: number;
  showBrowser: boolean;
  showInspector: boolean;
  showEditor: boolean;
}

export const DEFAULT_LAYOUT: WorkspaceLayout = {
  browserSize: 16,
  inspectorSize: 17,
  editorSize: 38,
  showBrowser: true,
  showInspector: true,
  showEditor: true,
};

/** Clamp every field into a usable range; unknown/invalid input yields defaults. */
export function normalizeLayout(raw: unknown): WorkspaceLayout {
  if (typeof raw !== 'object' || raw === null) return { ...DEFAULT_LAYOUT };
  const r = raw as Record<string, unknown>;
  const num = (v: unknown, fallback: number, min: number, max: number) =>
    typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : fallback;
  const bool = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback);
  return {
    browserSize: num(r.browserSize, DEFAULT_LAYOUT.browserSize, 10, 40),
    inspectorSize: num(r.inspectorSize, DEFAULT_LAYOUT.inspectorSize, 10, 40),
    editorSize: num(r.editorSize, DEFAULT_LAYOUT.editorSize, 12, 70),
    showBrowser: bool(r.showBrowser, DEFAULT_LAYOUT.showBrowser),
    showInspector: bool(r.showInspector, DEFAULT_LAYOUT.showInspector),
    showEditor: bool(r.showEditor, DEFAULT_LAYOUT.showEditor),
  };
}

function load(): WorkspaceLayout {
  if (typeof localStorage === 'undefined') return { ...DEFAULT_LAYOUT };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_LAYOUT };
    return normalizeLayout(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_LAYOUT };
  }
}

interface WorkspaceState extends WorkspaceLayout {
  setSizes: (patch: Partial<WorkspaceLayout>) => void;
  toggle: (key: 'showBrowser' | 'showInspector' | 'showEditor') => void;
  reset: () => void;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;

function persist(state: WorkspaceLayout): void {
  if (typeof localStorage === 'undefined') return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      const { browserSize, inspectorSize, editorSize, showBrowser, showInspector, showEditor } =
        state;
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          browserSize,
          inspectorSize,
          editorSize,
          showBrowser,
          showInspector,
          showEditor,
        }),
      );
    } catch {
      /* quota or private mode — layout simply won't persist */
    }
  }, 400);
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  ...load(),
  setSizes: (patch) => {
    set(patch);
    persist(get());
  },
  toggle: (key) => {
    set({ [key]: !get()[key] } as Partial<WorkspaceState>);
    persist(get());
  },
  reset: () => {
    set({ ...DEFAULT_LAYOUT });
    persist(get());
    diagLog('info', 'Workspace layout reset to defaults');
  },
}));
