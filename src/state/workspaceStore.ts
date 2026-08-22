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

/**
 * One pane may take over the whole workspace ("full screen" in DAW terms).
 * null = the normal docked layout. The docked layout's sizes/visibility are
 * untouched while maximized, so restoring is just clearing this field.
 */
export type MaximizedPane = null | 'arrange' | 'editor' | 'browser' | 'inspector';

export interface WorkspaceLayout {
  /** percentages within their panel group */
  browserSize: number;
  inspectorSize: number;
  editorSize: number;
  showBrowser: boolean;
  showInspector: boolean;
  showEditor: boolean;
  maximized: MaximizedPane;
  /** Global-track lanes shown above the tracks. */
  showMarkers: boolean;
  showSections: boolean;
  showChords: boolean;
  showTempoLane: boolean;
  /** Bird's-eye navigator strip above the arrangement. */
  showOverview: boolean;
}

export const DEFAULT_LAYOUT: WorkspaceLayout = {
  browserSize: 16,
  inspectorSize: 17,
  editorSize: 38,
  showBrowser: true,
  showInspector: true,
  showEditor: true,
  maximized: null,
  showMarkers: true,
  showSections: true,
  showChords: false,
  showTempoLane: false,
  showOverview: true,
};

const MAXIMIZABLE = new Set(['arrange', 'editor', 'browser', 'inspector']);

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
    showMarkers: bool(r.showMarkers, DEFAULT_LAYOUT.showMarkers),
    showSections: bool(r.showSections, DEFAULT_LAYOUT.showSections),
    showChords: bool(r.showChords, DEFAULT_LAYOUT.showChords),
    showTempoLane: bool(r.showTempoLane, DEFAULT_LAYOUT.showTempoLane),
    showOverview: bool(r.showOverview, DEFAULT_LAYOUT.showOverview),
    maximized:
      typeof r.maximized === 'string' && MAXIMIZABLE.has(r.maximized)
        ? (r.maximized as MaximizedPane)
        : null,
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
  toggle: (
    key:
      | 'showBrowser'
      | 'showInspector'
      | 'showEditor'
      | 'showMarkers'
      | 'showSections'
      | 'showChords'
      | 'showTempoLane'
      | 'showOverview',
  ) => void;
  /** Toggle full-screen for a pane (passing the current pane restores). */
  setMaximized: (pane: MaximizedPane) => void;
  reset: () => void;
}

/**
 * Scroll containers that survive a maximize/restore. Maximizing remounts the
 * panes (they are conditionally rendered, same as the existing show/hide
 * toggles), which would reset DOM scroll — so positions are captured before
 * the layout change and written back once the new layout has painted.
 */
const SCROLL_KEEPERS = [
  '[data-testid="arr-scroll"]',
  '.pr-scroll',
  '[data-testid="mixer"]',
  '.syn-scroll',
];

/**
 * Module-persistent: a pane hidden by one toggle only re-appears on a LATER
 * toggle, so its position must outlive the single transition. Every layout
 * change refreshes the entries for currently visible scrollers (hidden ones
 * keep their last-seen position — the only truth available for them).
 */
const scrollMemory = new Map<string, { left: number; top: number }>();

function captureScroll(): Map<string, { left: number; top: number }> {
  if (typeof document === 'undefined') return scrollMemory;
  for (const sel of SCROLL_KEEPERS) {
    const el = document.querySelector(sel);
    if (el) scrollMemory.set(sel, { left: el.scrollLeft, top: el.scrollTop });
  }
  return scrollMemory;
}

function restoreScroll(mem: Map<string, { left: number; top: number }>): void {
  if (typeof requestAnimationFrame === 'undefined' || mem.size === 0) return;
  // The remounted scrollers reach full size only after React commits AND the
  // panel group settles — until then assignments clamp to 0. Retry across a
  // few frames until each position sticks (or the budget runs out).
  let tries = 0;
  const apply = () => {
    let pending = false;
    for (const [sel, pos] of mem) {
      const el = document.querySelector(sel);
      if (!el) {
        pending = true;
        continue;
      }
      if (Math.abs(el.scrollLeft - pos.left) > 1) {
        el.scrollLeft = pos.left;
        if (Math.abs(el.scrollLeft - pos.left) > 1) pending = true;
      }
      if (Math.abs(el.scrollTop - pos.top) > 1) {
        el.scrollTop = pos.top;
        if (Math.abs(el.scrollTop - pos.top) > 1) pending = true;
      }
    }
    if (pending && ++tries < 15) requestAnimationFrame(apply);
  };
  requestAnimationFrame(apply);
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;

function persist(state: WorkspaceLayout): void {
  if (typeof localStorage === 'undefined') return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      const {
        browserSize,
        inspectorSize,
        editorSize,
        showBrowser,
        showInspector,
        showEditor,
        maximized,
        showMarkers,
        showSections,
        showChords,
        showTempoLane,
        showOverview,
      } = state;
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          browserSize,
          inspectorSize,
          editorSize,
          showBrowser,
          showInspector,
          showEditor,
          maximized,
          showMarkers,
          showSections,
          showChords,
          showTempoLane,
          showOverview,
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
  setMaximized: (pane) => {
    const next = get().maximized === pane ? null : pane;
    const mem = captureScroll();
    set({ maximized: next });
    persist(get());
    restoreScroll(mem);
  },
  reset: () => {
    set({ ...DEFAULT_LAYOUT });
    persist(get());
    diagLog('info', 'Workspace layout reset to defaults');
  },
}));
