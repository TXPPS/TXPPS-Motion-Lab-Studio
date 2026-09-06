/**
 * Named workspaces: a whole layout, saved under a name and recalled.
 *
 * The product had exactly one recall — "Reset layout", which restores the
 * defaults — so a musician who arranged the panes for tracking and then opened
 * everything up to mix had no way back but doing it again by hand. That is the
 * gap a DAW's screensets fill.
 *
 * A workspace records the **whole** authoritative model, not a diff against the
 * defaults. A diff would have to name which fields it covers, and the first
 * field added to `WorkspaceLayout` after that would silently not be recalled —
 * which is the same class of defect as a control that does nothing, arriving a
 * release later and looking like the layout "forgot" something.
 *
 * The built-ins are DERIVED from `DEFAULT_LAYOUT` rather than written out. Three
 * arrangements of the same panes, each stated as what it changes about the
 * default, so a change to the default's sizes moves all three with it instead of
 * leaving three copies of a number nobody remembers to update.
 */
import {
  DEFAULT_LAYOUT,
  PANE_LIMITS,
  freshLayout,
  normalizeLayout,
  type PaneId,
  type WorkspaceLayout,
} from './workspaceModel';

export interface NamedWorkspace {
  id: string;
  name: string;
  layout: WorkspaceLayout;
  /** A built-in cannot be deleted or renamed; it can always be recalled. */
  builtIn: boolean;
}

/** Ids are stable strings so a recall survives a rename. */
let seq = 0;
export const newWorkspaceId = (): string =>
  `ws-${Date.now().toString(36)}-${(seq++).toString(36)}-${Math.floor(Math.random() * 1296).toString(36)}`;

/** A layout with these panes open at these sizes, everything else the default. */
function arranged(
  open: Partial<Record<PaneId, number | false>>,
  rest: Partial<WorkspaceLayout> = {},
): WorkspaceLayout {
  const layout = freshLayout();
  for (const id of Object.keys(layout.panes) as PaneId[]) {
    const want = open[id];
    if (want === false) {
      // Hidden rather than collapsed: a built-in says "this pane is not part of
      // this way of working", and a rail would still be spending 44 px saying
      // so. Collapse is a gesture a person makes, not a preset's default.
      layout.panes[id] = { ...layout.panes[id], visible: false };
    } else if (typeof want === 'number') {
      layout.panes[id] = {
        ...layout.panes[id],
        size: Math.min(PANE_LIMITS[id].maxPercent, Math.max(PANE_LIMITS[id].minPercent, want)),
      };
    }
  }
  return { ...layout, ...rest };
}

/**
 * The three the product ships with.
 *
 * Named after what somebody is doing rather than after which panes are open,
 * because that is the question being asked when the menu is opened. Each is one
 * sentence's worth of difference from the default:
 *
 *   Arrange — the default itself: everything open, the editor at 38 %.
 *   Mix     — the console, with the side panels out of the way and the editor
 *             taking most of the height.
 *   Edit    — a note editor with the inspector beside it and the browser gone.
 */
export const BUILT_IN_WORKSPACES: NamedWorkspace[] = [
  {
    id: 'builtin-arrange',
    name: 'Arrange',
    builtIn: true,
    layout: arranged({}, { editorTab: DEFAULT_LAYOUT.editorTab, phoneMode: 'arrange' }),
  },
  {
    id: 'builtin-mix',
    name: 'Mix',
    builtIn: true,
    layout: arranged(
      { browser: false, inspector: false, editor: PANE_LIMITS.editor.maxPercent },
      { editorTab: 'mixer', phoneMode: 'mix' },
    ),
  },
  {
    id: 'builtin-edit',
    name: 'Edit',
    builtIn: true,
    layout: arranged(
      { browser: false, editor: 55 },
      { editorTab: 'piano', phoneMode: 'edit', showOverview: false },
    ),
  },
];

/** A stored workspace list, read back with every field checked. */
export function normalizeWorkspaces(raw: unknown): NamedWorkspace[] {
  if (!Array.isArray(raw)) return [];
  const out: NamedWorkspace[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue;
    const e = entry as Record<string, unknown>;
    const name = typeof e.name === 'string' ? e.name.trim().slice(0, 60) : '';
    if (!name) continue;
    // A stored built-in is ignored rather than loaded: the built-ins are derived
    // from the current defaults, and reading a copy saved by an older build back
    // over them is exactly the stale-duplicate problem deriving them avoids.
    if (e.builtIn === true) continue;
    out.push({
      id: typeof e.id === 'string' && e.id ? e.id : newWorkspaceId(),
      name,
      builtIn: false,
      layout: normalizeLayout(e.layout),
    });
  }
  return out;
}

/**
 * A name nothing else in the list is using.
 *
 * Saving twice under one name would give a menu two rows that look identical and
 * do different things, and there is no way to tell them apart by looking.
 */
export function uniqueName(name: string, taken: readonly NamedWorkspace[]): string {
  const base = name.trim().slice(0, 60) || 'Workspace';
  if (!taken.some((w) => w.name.toLowerCase() === base.toLowerCase())) return base;
  for (let n = 2; n < 100; n += 1) {
    const candidate = `${base} ${n}`;
    if (!taken.some((w) => w.name.toLowerCase() === candidate.toLowerCase())) return candidate;
  }
  return `${base} ${newWorkspaceId()}`;
}
