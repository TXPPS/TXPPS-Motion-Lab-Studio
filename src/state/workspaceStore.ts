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
  /**
   * The tablet's bottom panel, as a percentage. 0 means "never moved", in which
   * case the layout's own height heuristic still chooses.
   */
  tabletBottomSize: number;
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
  /**
   * Whether the Channel editor's device rail shows its cards or its chips.
   *
   * It replaced the flag that asked whether the overview band was drawn *inside
   * the mixer*. The band is an editor of its own now — the whole point of items
   * 12 to 14 is that a channel's chain stops being a tenant of the console's
   * height — so the question that flag answered no longer exists, and a stored
   * key nothing reads is the same defect the flag was itself written to fix.
   *
   * A view preference and not a property of the music, which is why it is here
   * and not on the project: collapsing a rack is not an edit.
   */
  channelRackOpen: boolean;
}

export const DEFAULT_LAYOUT: WorkspaceLayout = {
  browserSize: 16,
  inspectorSize: 17,
  editorSize: 38,
  tabletBottomSize: 0,
  showBrowser: true,
  showInspector: true,
  showEditor: true,
  maximized: null,
  showMarkers: true,
  showSections: true,
  showChords: false,
  showTempoLane: false,
  showOverview: true,
  channelRackOpen: true,
};

const MAXIMIZABLE = new Set(['arrange', 'editor', 'browser', 'inspector']);

/** Clamp every field into a usable range; unknown/invalid input yields defaults. */
export function normalizeLayout(raw: unknown): WorkspaceLayout {
  if (typeof raw !== 'object' || raw === null) return { ...DEFAULT_LAYOUT };
  const r = raw as Record<string, unknown>;
  /**
   * Clamped, not rejected.
   *
   * A pane size is a continuous quantity, and a stored 62.007 where the panel's
   * own maximum is 62 is not corrupt — it is 62, plus the rounding the panel
   * library did on the way out. Rejecting it threw away a divider the user had
   * dragged all the way to its stop, and the layout then wrote the default back
   * over it on the next resize event, so the preference could never be made to
   * stick at either end of its range. Anything that is not a finite number is
   * still refused: that is corruption rather than a boundary.
   */
  const num = (v: unknown, fallback: number, min: number, max: number) =>
    typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
  const bool = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback);
  return {
    browserSize: num(r.browserSize, DEFAULT_LAYOUT.browserSize, 10, 40),
    inspectorSize: num(r.inspectorSize, DEFAULT_LAYOUT.inspectorSize, 10, 40),
    editorSize: num(r.editorSize, DEFAULT_LAYOUT.editorSize, 12, 70),
    tabletBottomSize:
      typeof r.tabletBottomSize === 'number' && r.tabletBottomSize > 0
        ? num(r.tabletBottomSize, DEFAULT_LAYOUT.tabletBottomSize, 12, 62)
        : 0,
    showBrowser: bool(r.showBrowser, DEFAULT_LAYOUT.showBrowser),
    showInspector: bool(r.showInspector, DEFAULT_LAYOUT.showInspector),
    showEditor: bool(r.showEditor, DEFAULT_LAYOUT.showEditor),
    showMarkers: bool(r.showMarkers, DEFAULT_LAYOUT.showMarkers),
    showSections: bool(r.showSections, DEFAULT_LAYOUT.showSections),
    showChords: bool(r.showChords, DEFAULT_LAYOUT.showChords),
    showTempoLane: bool(r.showTempoLane, DEFAULT_LAYOUT.showTempoLane),
    showOverview: bool(r.showOverview, DEFAULT_LAYOUT.showOverview),
    channelRackOpen: bool(r.channelRackOpen, DEFAULT_LAYOUT.channelRackOpen),
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
      | 'showOverview'
      | 'channelRackOpen',
  ) => void;
  /** Toggle full-screen for a pane (passing the current pane restores). */
  setMaximized: (pane: MaximizedPane) => void;
  /**
   * Show a pane, whatever it takes.
   *
   * "Open this in the editor" has to actually open the editor. The panels a
   * command wants are hidden two different ways — switched off, or standing
   * behind another pane's full screen — and a command that only knew about one
   * of them silently did nothing in the other case.
   */
  reveal: (pane: 'browser' | 'inspector' | 'editor') => void;
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
/** The most recent layout, kept so a page going away can still write it. */
let pending: WorkspaceLayout | null = null;

/**
 * Write the layout now, whatever the debounce was waiting for.
 *
 * The write is debounced by 400 ms, which is right for a divider being dragged
 * and wrong for a page that is about to go away: close a pane and reload — or
 * close the tab — inside that window and the layout was silently forgotten.
 * The timer does not survive an unload, so the flush has to happen before one.
 */
function flushLayout(): void {
  if (!pending) return;
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  write(pending);
  pending = null;
}

if (typeof window !== 'undefined') {
  // `pagehide` rather than `beforeunload`: it fires on the back/forward cache
  // path and on mobile app switches, where `beforeunload` does not, and those
  // are exactly the moments a phone user loses a layout.
  window.addEventListener('pagehide', flushLayout);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushLayout();
  });
}

function persist(state: WorkspaceLayout): void {
  if (typeof localStorage === 'undefined') return;
  pending = state;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    const s = pending;
    pending = null;
    if (s) write(s);
  }, 400);
}

function write(state: WorkspaceLayout): void {
  if (typeof localStorage === 'undefined') return;
  {
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
        channelRackOpen,
        tabletBottomSize,
      } = state;
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          browserSize,
          inspectorSize,
          editorSize,
          tabletBottomSize,
          showBrowser,
          showInspector,
          showEditor,
          maximized,
          showMarkers,
          showSections,
          showChords,
          showTempoLane,
          showOverview,
          channelRackOpen,
        }),
      );
    } catch {
      /* quota or private mode — layout simply won't persist */
    }
  }
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
  reveal: (pane) => {
    const key =
      pane === 'browser' ? 'showBrowser' : pane === 'inspector' ? 'showInspector' : 'showEditor';
    const state = get();
    // Another pane's full screen hides this one however visible it is, so step
    // out of it — but leave this pane maximized if it already is, because the
    // caller asked to see it and it could not be more visible than that.
    if (state.maximized !== null && state.maximized !== pane) set({ maximized: null });
    if (!state[key]) set({ [key]: true } as Partial<WorkspaceState>);
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
