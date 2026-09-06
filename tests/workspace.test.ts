import { beforeEach, describe, expect, it } from 'vitest';
import {
  BUILT_IN_WORKSPACES,
  DEFAULT_LAYOUT,
  PANE_IDS,
  PANE_LIMITS,
  freshLayout,
  normalizeLayout,
  paneIsOpen,
  useWorkspaceStore,
} from '../src/state/workspaceStore';
import { useUiStore } from '../src/state/uiStore';

/** Back to a known layout AND a known set of saved workspaces. */
function pristine(): void {
  useWorkspaceStore.setState({
    ...freshLayout(),
    workspaces: [...BUILT_IN_WORKSPACES],
    activeWorkspaceId: null,
  });
}

const ws = () => useWorkspaceStore.getState();

describe('workspace layout normalization', () => {
  it('valid stored layouts round-trip, including maximized and the editor tab', () => {
    const stored = {
      ...freshLayout(),
      panes: {
        browser: { visible: false, collapsed: false, size: 20 },
        inspector: { visible: true, collapsed: true, size: 15, lastSize: 22 },
        editor: { visible: true, collapsed: false, size: 50 },
      },
      maximized: 'editor' as const,
      editorTab: 'piano' as const,
      phoneMode: 'mix' as const,
    };
    expect(normalizeLayout(stored)).toEqual(stored);
  });

  it('garbage in the enumerated fields falls back rather than through', () => {
    for (const bad of ['fullscreen', 42, {}, [], true, 'EDITOR']) {
      expect(normalizeLayout({ ...freshLayout(), maximized: bad }).maximized).toBeNull();
      expect(normalizeLayout({ ...freshLayout(), editorTab: bad }).editorTab).toBe('mixer');
      expect(normalizeLayout({ ...freshLayout(), phoneMode: bad }).phoneMode).toBe('arrange');
    }
  });

  it('junk input yields the defaults', () => {
    expect(normalizeLayout(null)).toEqual(DEFAULT_LAYOUT);
    expect(normalizeLayout('nope')).toEqual(DEFAULT_LAYOUT);
    expect(normalizeLayout(undefined)).toEqual(DEFAULT_LAYOUT);
  });

  it('clamps a size that is merely out of range, rather than discarding it', () => {
    // This used to fall back to the default, and it cost a real preference: a
    // divider dragged all the way to its stop comes back from the panel library
    // a hair over its own maximum — 34.007 where the maximum is 34 — so the
    // layout threw it away on the next load and wrote the default back over it.
    // A number outside the range is a boundary; only a non-number is corruption.
    const n = normalizeLayout({
      panes: {
        browser: { visible: true, collapsed: false, size: 9999 },
        inspector: { visible: true, collapsed: false, size: 34.004 },
        editor: { visible: true, collapsed: false, size: -5 },
      },
    });
    expect(n.panes.browser.size).toBe(PANE_LIMITS.browser.maxPercent);
    expect(n.panes.inspector.size).toBe(PANE_LIMITS.inspector.maxPercent);
    expect(n.panes.editor.size).toBe(PANE_LIMITS.editor.minPercent);
  });

  it('refuses a size that is not a number at all', () => {
    const n = normalizeLayout({
      panes: {
        browser: { visible: true, collapsed: false, size: 'wide' },
        inspector: { visible: true, collapsed: false, size: Number.NaN },
        editor: { visible: true, collapsed: false, size: Number.POSITIVE_INFINITY },
      },
    });
    expect(n.panes.browser.size).toBe(PANE_LIMITS.browser.defaultSize);
    expect(n.panes.inspector.size).toBe(PANE_LIMITS.inspector.defaultSize);
    // Infinity is not finite, so it is corruption rather than a boundary — a
    // clamp would have turned it into the maximum and hidden the fact that
    // whatever wrote it was broken.
    expect(n.panes.editor.size).toBe(PANE_LIMITS.editor.defaultSize);
  });

  it('leaves lastSize absent when there is none, rather than inventing one', () => {
    // The `0` sentinel could not tell "never moved" from "dragged to the floor",
    // and the tablet's bottom pane read that same 0 as "use the height
    // heuristic" — so a user who dragged the divider all the way down got the
    // heuristic back on the next launch.
    expect(normalizeLayout(freshLayout()).panes.editor.lastSize).toBeUndefined();
    expect(
      normalizeLayout({
        panes: { editor: { visible: true, collapsed: true, size: 12, lastSize: 44 } },
      }).panes.editor.lastSize,
    ).toBe(44);
  });
});

/**
 * The migration, against a blob captured from the shipping v1 store.
 *
 * A migration checked against a blob written by the migration is checked against
 * nothing. This one is the literal JSON `txpps-motionlab-workspace-v1` held —
 * every field the old `write()` put in it, in the order it put them — so the
 * case fails if the reading changes rather than only if the writing does.
 */
const V1_BLOB = {
  browserSize: 22,
  inspectorSize: 19,
  editorSize: 45,
  tabletBottomSize: 51,
  showBrowser: true,
  showInspector: false,
  showEditor: true,
  maximized: 'editor',
  showMarkers: true,
  showSections: false,
  showChords: true,
  showTempoLane: false,
  showOverview: false,
  channelRackOpen: false,
};

describe('a layout saved by the previous build loads to the same picture', () => {
  const migrated = normalizeLayout(V1_BLOB);

  it('carries every pane across at the size and visibility it had', () => {
    expect(migrated.panes.browser).toEqual({ visible: true, collapsed: false, size: 22 });
    expect(migrated.panes.inspector).toEqual({ visible: false, collapsed: false, size: 19 });
    expect(migrated.panes.editor.visible).toBe(true);
    expect(migrated.panes.editor.size).toBe(45);
  });

  it('reads showX: false as hidden rather than as collapsed', () => {
    // They are different states now and only one of them keeps a rail. A
    // migration that made every hidden pane a collapsed one would hand every
    // existing user three rails they never asked for.
    for (const id of PANE_IDS) expect(migrated.panes[id].collapsed).toBe(false);
  });

  it('folds the tablet-only bottom size into the editor pane it always was', () => {
    // Two fields for one pane is how the two came to be clamped and reset
    // differently. The tablet's divider becomes the size the editor comes back
    // to, which is the only reading that loses nothing.
    expect(migrated.panes.editor.lastSize).toBe(51);
  });

  it('keeps the maximised pane and every lane flag', () => {
    expect(migrated.maximized).toBe('editor');
    expect(migrated.showSections).toBe(false);
    expect(migrated.showChords).toBe(true);
    expect(migrated.showOverview).toBe(false);
    expect(migrated.channelRackOpen).toBe(false);
  });

  it('gives the fields v1 never had their defaults', () => {
    expect(migrated.editorTab).toBe(DEFAULT_LAYOUT.editorTab);
    expect(migrated.phoneMode).toBe(DEFAULT_LAYOUT.phoneMode);
  });

  it('treats a v1 tabletBottomSize of 0 as the sentinel it was, not as a size', () => {
    // Zero is below the editor's own floor, so clamping it would have produced a
    // remembered size of 12 % for every user who had never touched a tablet.
    const n = normalizeLayout({ ...V1_BLOB, tabletBottomSize: 0 });
    expect(n.panes.editor.lastSize).toBeUndefined();
  });
});

describe('collapse is a state, not a hide', () => {
  beforeEach(pristine);

  it('remembers the size and gives it back on expand', () => {
    ws().setPaneSize('browser', 28);
    ws().toggleCollapsed('browser');
    expect(ws().panes.browser.collapsed).toBe(true);
    // Still on screen: the rail is what carries the control that expands it, and
    // a phone with no keyboard has no other route back.
    expect(ws().panes.browser.visible).toBe(true);
    expect(ws().panes.browser.lastSize).toBe(28);

    ws().toggleCollapsed('browser');
    expect(ws().panes.browser.collapsed).toBe(false);
    expect(ws().panes.browser.size).toBe(28);
  });

  it('is not the same question as visibility, and `paneIsOpen` is the one answer', () => {
    ws().toggleCollapsed('editor');
    expect(ws().panes.editor.visible).toBe(true);
    expect(paneIsOpen(ws().panes.editor)).toBe(false);
    ws().togglePane('editor');
    expect(ws().panes.editor.visible).toBe(false);
    expect(paneIsOpen(ws().panes.editor)).toBe(false);
  });

  it('does not let a resize event while collapsed overwrite the size to come back to', () => {
    // The panel library reports a resize when the rail lays out, and writing
    // that down would replace the remembered size with the rail's own.
    ws().setPaneSize('inspector', 30);
    ws().toggleCollapsed('inspector');
    ws().setPaneSize('inspector', 4);
    ws().toggleCollapsed('inspector');
    expect(ws().panes.inspector.size).toBe(30);
  });

  it('expands to the default when the pane has never been sized', () => {
    ws().toggleCollapsed('editor');
    useWorkspaceStore.setState({
      panes: { ...ws().panes, editor: { visible: true, collapsed: true, size: 12 } },
    });
    ws().toggleCollapsed('editor');
    expect(ws().panes.editor.size).toBe(PANE_LIMITS.editor.defaultSize);
  });
});

describe('maximise and restore', () => {
  beforeEach(pristine);

  it('is a toggle on the pane it names', () => {
    ws().setMaximized('editor');
    expect(ws().maximized).toBe('editor');
    ws().setMaximized('editor');
    expect(ws().maximized).toBeNull();
  });

  it('leaves the docked layout untouched, so restoring is exact', () => {
    ws().setPaneSize('browser', 25);
    ws().toggleCollapsed('inspector');
    const before = JSON.stringify(ws().panes);
    ws().setMaximized('arrange');
    ws().setMaximized('arrange');
    expect(JSON.stringify(ws().panes)).toBe(before);
  });

  it('switches straight from one maximised pane to another', () => {
    ws().setMaximized('browser');
    ws().setMaximized('inspector');
    expect(ws().maximized).toBe('inspector');
  });
});

/**
 * "Open this in the editor" has to open the editor.
 *
 * Three commands used to announce their intention by setting a boolean on the
 * UI store that nothing anywhere read. There are three ways a pane can be out of
 * the way now — hidden, collapsed, or behind another pane's full screen — and a
 * command that knew about one of them does nothing in the other two.
 */
describe('revealing a pane', () => {
  beforeEach(pristine);

  it('switches a hidden pane back on', () => {
    ws().togglePane('editor');
    ws().reveal('editor');
    expect(paneIsOpen(ws().panes.editor)).toBe(true);
  });

  it('expands a collapsed pane, to the size it had', () => {
    ws().setPaneSize('editor', 52);
    ws().toggleCollapsed('editor');
    ws().reveal('editor');
    expect(paneIsOpen(ws().panes.editor)).toBe(true);
    expect(ws().panes.editor.size).toBe(52);
  });

  it('steps out of another pane full screen, which hides everything else', () => {
    ws().setMaximized('browser');
    ws().reveal('inspector');
    expect(ws().maximized).toBeNull();
    expect(paneIsOpen(ws().panes.inspector)).toBe(true);
  });

  it('leaves the pane full screen when it is already the one asked for', () => {
    // It could not be more visible than that, and dropping out of full screen
    // to "reveal" what is already filling the window would be a step backwards.
    ws().setMaximized('editor');
    ws().reveal('editor');
    expect(ws().maximized).toBe('editor');
  });

  it('is what opening a clip for editing does, tab and pane together', () => {
    ws().togglePane('editor');
    ws().setMaximized('browser');
    useUiStore.getState().openEditorFor('clip-1');
    expect(paneIsOpen(ws().panes.editor)).toBe(true);
    expect(ws().maximized).toBeNull();
    expect(ws().editorTab).toBe('piano');
    expect(useUiStore.getState().editClipId).toBe('clip-1');
  });

  it('opens the pane when a control asks for an editor tab', () => {
    ws().togglePane('editor');
    ws().showEditorTab('channel');
    expect(paneIsOpen(ws().panes.editor)).toBe(true);
    expect(ws().editorTab).toBe('channel');
  });
});

describe('named workspaces', () => {
  beforeEach(pristine);

  it('ships three built-ins, derived from the defaults rather than written out', () => {
    expect(
      ws()
        .workspaces.filter((w) => w.builtIn)
        .map((w) => w.name),
    ).toEqual(['Arrange', 'Mix', 'Edit']);
    // Derived: the Arrange preset IS the default layout, so a change to a
    // default size moves the preset with it instead of leaving a stale copy.
    const arrange = ws().workspaces.find((w) => w.name === 'Arrange')!;
    expect(arrange.layout.panes.browser.size).toBe(PANE_LIMITS.browser.defaultSize);
    expect(arrange.layout.panes.editor.size).toBe(PANE_LIMITS.editor.defaultSize);
  });

  it('saves the whole model, recalls it, and the layout comes back', () => {
    ws().setPaneSize('browser', 30);
    ws().setPaneSize('editor', 55);
    ws().toggleCollapsed('inspector');
    ws().setLayout({ editorTab: 'score', showChords: true });
    const id = ws().saveWorkspace('Tracking');

    // Move everything, then come back.
    ws().reset();
    expect(ws().panes.browser.size).toBe(PANE_LIMITS.browser.defaultSize);
    expect(ws().editorTab).toBe('mixer');

    ws().recallWorkspace(id);
    expect(ws().panes.browser.size).toBe(30);
    expect(ws().panes.editor.size).toBe(55);
    expect(ws().panes.inspector.collapsed).toBe(true);
    expect(ws().editorTab).toBe('score');
    expect(ws().showChords).toBe(true);
  });

  it('recalls a built-in as readily as a saved one', () => {
    ws().setPaneSize('browser', 30);
    const mix = ws().workspaces.find((w) => w.name === 'Mix')!;
    ws().recallWorkspace(mix.id);
    expect(ws().editorTab).toBe('mixer');
    expect(ws().panes.browser.visible).toBe(false);
    expect(ws().panes.editor.size).toBe(PANE_LIMITS.editor.maxPercent);
  });

  it('renames and deletes a saved workspace', () => {
    const id = ws().saveWorkspace('Draft');
    ws().renameWorkspace(id, 'Final');
    expect(ws().workspaces.find((w) => w.id === id)?.name).toBe('Final');
    ws().deleteWorkspace(id);
    expect(ws().workspaces.some((w) => w.id === id)).toBe(false);
  });

  it('refuses to rename or delete a built-in', () => {
    // A built-in is derived from the defaults, so a rename would be written down
    // and lost on the next load — a control that appears to work and does not.
    const mix = ws().workspaces.find((w) => w.name === 'Mix')!;
    ws().renameWorkspace(mix.id, 'Mine now');
    expect(ws().workspaces.find((w) => w.id === mix.id)?.name).toBe('Mix');
    ws().deleteWorkspace(mix.id);
    expect(ws().workspaces.some((w) => w.id === mix.id)).toBe(true);
  });

  it('will not let two workspaces share a name', () => {
    // Two rows in a menu that look identical and do different things cannot be
    // told apart by looking, which is the only way anybody chooses from a menu.
    ws().saveWorkspace('Take');
    ws().saveWorkspace('Take');
    const names = ws()
      .workspaces.filter((w) => !w.builtIn)
      .map((w) => w.name);
    expect(names).toEqual(['Take', 'Take 2']);
  });

  it('names the workspace showing, and stops naming it once the layout moves', () => {
    const id = ws().saveWorkspace('Tracking');
    expect(ws().activeWorkspaceId).toBe(id);
    ws().setPaneSize('browser', 30);
    // The layout is no longer the one that was saved, and a menu still ticking
    // "Tracking" would be saying something false about what is on screen.
    expect(ws().activeWorkspaceId).toBeNull();
  });

  it('migrates a workspace saved in the old shape on recall', () => {
    // A recall must not be the one path into the store that skips the migration:
    // a workspace saved by a build before this one carries a v1 layout, and
    // putting it into the store unnormalised would set `panes` to undefined.
    useWorkspaceStore.setState({
      workspaces: [
        ...BUILT_IN_WORKSPACES,
        {
          id: 'ws-old',
          name: 'From v1',
          builtIn: false,
          layout: normalizeLayout(V1_BLOB),
        },
      ],
    });
    ws().recallWorkspace('ws-old');
    expect(ws().panes.browser.size).toBe(22);
    expect(ws().panes.inspector.visible).toBe(false);
  });
});

describe('reset', () => {
  beforeEach(pristine);

  it('restores the defaults', () => {
    ws().setPaneSize('browser', 32);
    ws().toggleCollapsed('editor');
    ws().reset();
    expect(ws().panes).toEqual(DEFAULT_LAYOUT.panes);
  });

  it('keeps the saved workspaces, which are not part of the layout', () => {
    // "Reset layout" says what it does. Deleting somebody's screensets because
    // they wanted the default panes back would be a command doing far more than
    // it says, and there would be no undo for it.
    const id = ws().saveWorkspace('Keep me');
    ws().reset();
    expect(ws().workspaces.some((w) => w.id === id)).toBe(true);
  });
});
