/**
 * Reading and writing the workspace, and the debounce that makes it bearable.
 *
 * Its own module for the same reason `workspaceScroll.ts` is: the store was past
 * this repository's length rule, and persistence is a whole concern with its own
 * hazards — a storage key, a migration, a debounce and an unload path — none of
 * which a reader asking "what does collapse do" needs to walk past.
 *
 * Nothing here knows what a pane means. It is given a layout and a list of
 * workspaces, and it puts them somewhere they survive a reload.
 */
import { freshLayout, normalizeLayout, type WorkspaceLayout } from './workspaceModel';
import { normalizeWorkspaces, type NamedWorkspace } from './workspacePresets';

const STORAGE_KEY = 'txpps-motionlab-workspace-v2';
/** What the previous shape was stored under, read once and migrated forward. */
const STORAGE_KEY_V1 = 'txpps-motionlab-workspace-v1';

export interface Stored {
  layout: WorkspaceLayout;
  workspaces: NamedWorkspace[];
}

/** Everything the store starts from, validated, clamped and migrated. */
export function loadWorkspace(): Stored {
  const empty = { layout: freshLayout(), workspaces: [] as NamedWorkspace[] };
  if (typeof localStorage === 'undefined') return empty;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      return {
        layout: normalizeLayout(parsed.layout),
        workspaces: normalizeWorkspaces(parsed.workspaces),
      };
    }
    // No v2 entry: a build before this one may have left a v1 layout, and
    // `normalizeLayout` migrates it. Read rather than deleted — a user who rolls
    // back to the previous build should still find their layout there.
    const v1 = localStorage.getItem(STORAGE_KEY_V1);
    if (v1) return { layout: normalizeLayout(JSON.parse(v1)), workspaces: [] };
    return empty;
  } catch {
    return empty;
  }
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
/** The most recent state, kept so a page going away can still write it. */
let pending: Stored | null = null;

function write(stored: Stored): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        layout: stored.layout,
        // Built-ins are derived, so storing them would freeze a copy of today's
        // defaults into every user's browser — and `normalizeWorkspaces` drops
        // them on the way back in for that reason.
        workspaces: stored.workspaces.filter((w) => !w.builtIn),
      }),
    );
  } catch {
    /* quota or private mode — the layout simply will not persist */
  }
}

/**
 * Write now, whatever the debounce was waiting for.
 *
 * The write is debounced by 400 ms, which is right for a divider being dragged
 * and wrong for a page that is about to go away: close a pane and reload — or
 * close the tab — inside that window and the layout was silently forgotten.
 * The timer does not survive an unload, so the flush has to happen before one.
 */
export function flushWorkspace(): void {
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
  window.addEventListener('pagehide', flushWorkspace);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushWorkspace();
  });
}

/** Queue a write, coalescing the flurry a dragged divider produces. */
export function persistWorkspace(stored: Stored): void {
  if (typeof localStorage === 'undefined') return;
  pending = stored;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    const s = pending;
    pending = null;
    if (s) write(s);
  }, 400);
}

/**
 * The layout half of the store, without the mutators.
 *
 * Written as an explicit projection rather than a spread-and-delete so that a
 * field added to `WorkspaceLayout` and not to this list fails to compile, which
 * is the only thing that stops the persisted shape drifting from the model.
 */
export function layoutOf(s: WorkspaceLayout): WorkspaceLayout {
  return {
    panes: { browser: s.panes.browser, inspector: s.panes.inspector, editor: s.panes.editor },
    maximized: s.maximized,
    editorTab: s.editorTab,
    phoneMode: s.phoneMode,
    showMarkers: s.showMarkers,
    showSections: s.showSections,
    showChords: s.showChords,
    showTempoLane: s.showTempoLane,
    showOverview: s.showOverview,
    channelRackOpen: s.channelRackOpen,
  };
}
