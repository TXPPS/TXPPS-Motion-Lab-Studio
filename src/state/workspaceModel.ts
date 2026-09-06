/**
 * The authoritative layout model: one shape every shell derives its drawing
 * from, and the constraints declared once.
 *
 * It was six loose fields on `workspaceStore` — `showBrowser` beside
 * `browserSize`, a `tabletBottomSize` that meant "the editor pane, but only on a
 * tablet", and a `0` sentinel for "never moved". Three things went wrong with
 * that shape and all three are the same defect:
 *
 *   - **The limits were written twice.** `normalizeLayout` clamped
 *     `browserSize` to 10–40 % while `DesktopLayout` declared `minSize="180px"`
 *     and `maxSize="34%"` in JSX, so the two could disagree and did: a browser
 *     clamped to 40 by the store was pushed back to 34 by the panel library on
 *     the next resize event, and the store wrote 34 back. `PANE_LIMITS` below is
 *     the one table, and both the normaliser and the shells read it.
 *   - **Collapse was a boolean hide.** `showEditor: false` unmounted the pane
 *     and forgot its size, so re-opening it always landed on the default — a
 *     divider dragged to 55 % came back at 38. `lastSize` is what makes expand
 *     mean "back to where it was".
 *   - **The tablet's bottom pane was a separate concept.** It is the editor
 *     pane; it always was. Two fields for one pane is how the two came to be
 *     persisted, clamped and reset differently.
 *
 * `editorTab` and `phoneMode` live here too, and that is the lesson of
 * `TabletLayout`'s `useState`: a control that sets the tab and reveals the pane
 * must read the same truth on all three shells, or it works on two of them and
 * is inert on the third for a directive.
 */

/** The three panes that can be shown, sized, collapsed and maximised. */
export type PaneId = 'browser' | 'inspector' | 'editor';

export const PANE_IDS: readonly PaneId[] = ['browser', 'inspector', 'editor'];

/**
 * One pane may take over the whole workspace ("full screen" in DAW terms).
 * null = the normal docked layout. The docked layout's sizes and visibility are
 * untouched while maximized, so restoring is just clearing this field.
 */
export type MaximizedPane = null | 'arrange' | PaneId;

export const MAXIMIZABLE: readonly Exclude<MaximizedPane, null>[] = [
  'arrange',
  'editor',
  'browser',
  'inspector',
];

/** The editor surfaces, by id. Mirrors `app/editorIds.ts` without importing a component graph. */
export type EditorTab =
  'mixer' | 'piano' | 'drums' | 'score' | 'audio' | 'chords' | 'synth' | 'channel' | 'diagnostics';

export type PhoneMode = 'arrange' | 'record' | 'perform' | 'edit' | 'mix' | 'browse';

const EDITOR_TABS: readonly EditorTab[] = [
  'mixer',
  'piano',
  'drums',
  'score',
  'audio',
  'chords',
  'synth',
  'channel',
  'diagnostics',
];

const PHONE_MODES: readonly PhoneMode[] = ['arrange', 'record', 'perform', 'edit', 'mix', 'browse'];

/**
 * What one pane is doing.
 *
 * `visible` and `collapsed` are not the same question and folding them into one
 * boolean is what made collapse a hide. A hidden pane is not drawn at all; a
 * collapsed one is drawn as a rail — a strip that still carries the control that
 * expands it, which is what stops a collapse being a one-way door on a form
 * factor with no keyboard.
 */
export interface PaneState {
  visible: boolean;
  collapsed: boolean;
  /** Percentage of the panel group this pane sits in. */
  size: number;
  /**
   * The size to come back to, in percent.
   *
   * Optional rather than `0`-as-unset. The sentinel meant a pane that had
   * genuinely been dragged to its floor was indistinguishable from one nobody
   * had touched, and the tablet's bottom pane read the same `0` as "use the
   * height heuristic" — so a user who dragged the divider all the way down got
   * the heuristic back on the next launch.
   */
  lastSize?: number;
}

/**
 * Every constraint on a pane, in one place, in the units each consumer needs.
 *
 * `minPx` / `maxPercent` are what the panel library is given, and `minPercent` /
 * `maxPercent` are what the normaliser clamps to. They are two readings of one
 * rule rather than two rules: the pixel floor is what keeps the arrangement
 * usable at any window width, and the percentage floor is what keeps a stored
 * layout sane when it is loaded at a width nobody has seen yet.
 *
 * `railPx` is the collapsed width or height. It is 44 because a rail carries a
 * control and a control a finger must reach is 44 px (WCAG 2.5.8) — a 24 px rail
 * would be a pane you can collapse on a phone and never get back.
 */
export interface PaneLimits {
  /** Minimum extent in CSS pixels, for the panel library. */
  minPx: number;
  /** Percentage bounds, for the stored layout. */
  minPercent: number;
  maxPercent: number;
  /** The collapsed rail's extent, in CSS pixels. */
  railPx: number;
  /** What a fresh layout opens at. */
  defaultSize: number;
  /** Which way the pane's size is measured, for the rail's own styling. */
  axis: 'horizontal' | 'vertical';
}

/** WCAG 2.5.8's minimum, and the reason a rail is as wide as it is. */
export const RAIL_PX = 44;

export const PANE_LIMITS: Record<PaneId, PaneLimits> = {
  browser: {
    minPx: 180,
    minPercent: 10,
    maxPercent: 34,
    railPx: RAIL_PX,
    defaultSize: 16,
    axis: 'horizontal',
  },
  inspector: {
    minPx: 190,
    minPercent: 10,
    maxPercent: 34,
    railPx: RAIL_PX,
    defaultSize: 17,
    axis: 'horizontal',
  },
  editor: {
    minPx: 150,
    minPercent: 12,
    maxPercent: 68,
    railPx: RAIL_PX,
    defaultSize: 38,
    axis: 'vertical',
  },
};

/** Panes and the arrangement flags that travel with them: the whole picture. */
export interface WorkspaceLayout {
  panes: Record<PaneId, PaneState>;
  maximized: MaximizedPane;
  /** Which editor the editor pane is showing, on every form factor. */
  editorTab: EditorTab;
  /** Which workspace a phone is showing. */
  phoneMode: PhoneMode;
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
   * A view preference and not a property of the music, which is why it is here
   * and not on the project: collapsing a rack is not an edit.
   */
  channelRackOpen: boolean;
}

const pane = (id: PaneId): PaneState => ({
  visible: true,
  collapsed: false,
  size: PANE_LIMITS[id].defaultSize,
});

export const DEFAULT_LAYOUT: WorkspaceLayout = {
  panes: { browser: pane('browser'), inspector: pane('inspector'), editor: pane('editor') },
  maximized: null,
  editorTab: 'mixer',
  phoneMode: 'arrange',
  showMarkers: true,
  showSections: true,
  showChords: false,
  showTempoLane: false,
  showOverview: true,
  channelRackOpen: true,
};

/** A fresh copy, since every field of the default is about to be written over. */
export const freshLayout = (): WorkspaceLayout => ({
  ...DEFAULT_LAYOUT,
  panes: {
    browser: { ...DEFAULT_LAYOUT.panes.browser },
    inspector: { ...DEFAULT_LAYOUT.panes.inspector },
    editor: { ...DEFAULT_LAYOUT.panes.editor },
  },
});

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
function clampSize(v: unknown, id: PaneId): number {
  const { minPercent, maxPercent, defaultSize } = PANE_LIMITS[id];
  if (typeof v !== 'number' || !Number.isFinite(v)) return defaultSize;
  return Math.min(maxPercent, Math.max(minPercent, v));
}

const bool = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback);

const oneOf = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
  typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;

function normalizePane(raw: unknown, id: PaneId): PaneState {
  const base = pane(id);
  if (typeof raw !== 'object' || raw === null) return base;
  const r = raw as Record<string, unknown>;
  const size = clampSize(r.size, id);
  // `lastSize` is genuinely optional, so an absent one stays absent rather than
  // becoming the default: "expand to where it was" and "expand to the default"
  // are different answers and only one of them is a memory.
  const lastSize =
    typeof r.lastSize === 'number' && Number.isFinite(r.lastSize)
      ? clampSize(r.lastSize, id)
      : undefined;
  return {
    visible: bool(r.visible, base.visible),
    collapsed: bool(r.collapsed, base.collapsed),
    size,
    ...(lastSize === undefined ? {} : { lastSize }),
  };
}

/**
 * The v1 blob, read into the model above.
 *
 * v1's fields map one to one except in two places, and both are the reason the
 * migration is written out rather than spread over the normaliser: `showX:
 * false` meant the pane was gone with its size forgotten, which is `visible:
 * false` and NOT `collapsed`; and `tabletBottomSize` was the editor pane
 * measured on a tablet, with `0` meaning "never moved". A stored `0` therefore
 * carries no information and must not become a size — it becomes no `lastSize`
 * at all, which is what "never moved" means in the new shape.
 */
function fromV1(r: Record<string, unknown>): Partial<WorkspaceLayout> {
  const paneFromV1 = (id: PaneId, sizeKey: string, showKey: string): PaneState => ({
    visible: bool(r[showKey], true),
    collapsed: false,
    size: clampSize(r[sizeKey], id),
  });
  const editor = paneFromV1('editor', 'editorSize', 'showEditor');
  // The tablet's own divider, where the user moved it. It is the same pane, so
  // it becomes the editor's remembered size rather than a second field — and
  // where the desktop and the tablet disagree the tablet's is the one that was
  // dragged more recently in practice, so it is kept as `lastSize` where the
  // desktop's stays the current size.
  const tabletBottom = r.tabletBottomSize;
  if (typeof tabletBottom === 'number' && Number.isFinite(tabletBottom) && tabletBottom > 0) {
    editor.lastSize = clampSize(tabletBottom, 'editor');
  }
  return {
    panes: {
      browser: paneFromV1('browser', 'browserSize', 'showBrowser'),
      inspector: paneFromV1('inspector', 'inspectorSize', 'showInspector'),
      editor,
    },
  };
}

/** Is this blob in the old shape? v1 has no `panes` and names a v1 field. */
function looksLikeV1(r: Record<string, unknown>): boolean {
  if (typeof r.panes === 'object' && r.panes !== null) return false;
  return ['showBrowser', 'showEditor', 'showInspector', 'browserSize', 'editorSize'].some(
    (k) => k in r,
  );
}

/**
 * Clamp every field into a usable range; unknown or invalid input yields the
 * defaults, and a v1 blob is migrated on the way through.
 */
export function normalizeLayout(raw: unknown): WorkspaceLayout {
  if (typeof raw !== 'object' || raw === null) return freshLayout();
  const r = raw as Record<string, unknown>;
  const migrated = looksLikeV1(r) ? fromV1(r) : null;
  const panes = migrated?.panes ?? {
    browser: normalizePane((r.panes as Record<string, unknown> | undefined)?.browser, 'browser'),
    inspector: normalizePane(
      (r.panes as Record<string, unknown> | undefined)?.inspector,
      'inspector',
    ),
    editor: normalizePane((r.panes as Record<string, unknown> | undefined)?.editor, 'editor'),
  };
  return {
    panes,
    maximized: oneOf(r.maximized, MAXIMIZABLE, null as never) || null,
    editorTab: oneOf(r.editorTab, EDITOR_TABS, DEFAULT_LAYOUT.editorTab),
    phoneMode: oneOf(r.phoneMode, PHONE_MODES, DEFAULT_LAYOUT.phoneMode),
    showMarkers: bool(r.showMarkers, DEFAULT_LAYOUT.showMarkers),
    showSections: bool(r.showSections, DEFAULT_LAYOUT.showSections),
    showChords: bool(r.showChords, DEFAULT_LAYOUT.showChords),
    showTempoLane: bool(r.showTempoLane, DEFAULT_LAYOUT.showTempoLane),
    showOverview: bool(r.showOverview, DEFAULT_LAYOUT.showOverview),
    channelRackOpen: bool(r.channelRackOpen, DEFAULT_LAYOUT.channelRackOpen),
  };
}

/**
 * Is this pane actually drawing its contents?
 *
 * Derived rather than stored, and that is the whole point of the split: a
 * collapsed pane is visible (its rail is on screen) and is not showing anything,
 * so any component that asked `visible` alone would draw a browser inside a
 * 44 px strip. One function, so the answer cannot differ between three shells.
 */
export const paneIsOpen = (p: PaneState): boolean => p.visible && !p.collapsed;

/**
 * What a pane expands back to.
 *
 * `lastSize` where there is one, the default otherwise — never the pane's
 * *current* size, which while collapsed is whatever the rail forced it to.
 */
export const restoredSize = (p: PaneState, id: PaneId): number =>
  p.lastSize ?? PANE_LIMITS[id].defaultSize;
