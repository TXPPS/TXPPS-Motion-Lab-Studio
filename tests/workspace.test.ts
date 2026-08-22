import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_LAYOUT, normalizeLayout, useWorkspaceStore } from '../src/state/workspaceStore';
import { useUiStore } from '../src/state/uiStore';

describe('workspace layout normalization', () => {
  it('valid stored layouts round-trip, including maximized', () => {
    const stored = {
      browserSize: 20,
      inspectorSize: 15,
      editorSize: 50,
      showBrowser: false,
      showInspector: true,
      showEditor: true,
      maximized: 'editor',
    };
    // Fields the stored layout does not mention keep their defaults; the ones
    // it does mention survive verbatim.
    expect(normalizeLayout(stored)).toEqual({ ...DEFAULT_LAYOUT, ...stored });
    expect(normalizeLayout({ ...stored, maximized: 'arrange' }).maximized).toBe('arrange');
    expect(normalizeLayout({ ...stored, maximized: null }).maximized).toBeNull();
  });

  it('garbage maximized values fall back to the docked layout', () => {
    for (const bad of ['fullscreen', 42, {}, [], true, 'EDITOR']) {
      expect(normalizeLayout({ ...DEFAULT_LAYOUT, maximized: bad }).maximized).toBeNull();
    }
  });

  it('layouts saved by pre-RC2.1 builds (no maximized field) stay valid', () => {
    const old = {
      browserSize: 16,
      inspectorSize: 17,
      editorSize: 38,
      showBrowser: true,
      showInspector: true,
      showEditor: false,
    };
    const n = normalizeLayout(old);
    expect(n.maximized).toBeNull();
    expect(n.showEditor).toBe(false);
  });

  it('unusable numbers and junk input yield the defaults', () => {
    expect(normalizeLayout(null)).toEqual(DEFAULT_LAYOUT);
    expect(normalizeLayout('nope')).toEqual(DEFAULT_LAYOUT);
    const n = normalizeLayout({ browserSize: 9999, editorSize: -5, maximized: 'browser' });
    expect(n.browserSize).toBe(DEFAULT_LAYOUT.browserSize);
    expect(n.editorSize).toBe(DEFAULT_LAYOUT.editorSize);
    expect(n.maximized).toBe('browser');
  });
});

/**
 * "Open this in the editor" has to open the editor.
 *
 * Three commands used to announce their intention by setting a boolean on the
 * UI store — `panelEditor`, `panelInspector`, `panelBrowser` — that nothing
 * anywhere read. So double-clicking a clip while the bottom panel was hidden
 * selected the clip and showed the user nothing, and the same for opening an
 * instrument from a device rack or an inspector from a channel strip.
 */
describe('revealing a pane', () => {
  beforeEach(() => useWorkspaceStore.setState({ ...DEFAULT_LAYOUT }));

  it('switches a hidden pane back on', () => {
    useWorkspaceStore.setState({ showEditor: false });
    useWorkspaceStore.getState().reveal('editor');
    expect(useWorkspaceStore.getState().showEditor).toBe(true);
  });

  it('steps out of another pane full screen, which hides everything else', () => {
    useWorkspaceStore.setState({ maximized: 'browser' });
    useWorkspaceStore.getState().reveal('inspector');
    expect(useWorkspaceStore.getState().maximized).toBeNull();
    expect(useWorkspaceStore.getState().showInspector).toBe(true);
  });

  it('leaves the pane full screen when it is already the one asked for', () => {
    // It could not be more visible than that, and dropping out of full screen
    // to "reveal" what is already filling the window would be a step backwards.
    useWorkspaceStore.setState({ maximized: 'editor' });
    useWorkspaceStore.getState().reveal('editor');
    expect(useWorkspaceStore.getState().maximized).toBe('editor');
  });

  it('is what opening a clip for editing does', () => {
    useWorkspaceStore.setState({ showEditor: false, maximized: 'browser' });
    useUiStore.getState().openEditorFor('clip-1');
    expect(useWorkspaceStore.getState().showEditor).toBe(true);
    expect(useWorkspaceStore.getState().maximized).toBeNull();
    expect(useUiStore.getState().editClipId).toBe('clip-1');
    expect(useUiStore.getState().editorTab).toBe('piano');
  });
});
