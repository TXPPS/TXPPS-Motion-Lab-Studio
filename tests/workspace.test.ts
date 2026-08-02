import { describe, expect, it } from 'vitest';
import { DEFAULT_LAYOUT, normalizeLayout } from '../src/state/workspaceStore';

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
    expect(normalizeLayout(stored)).toEqual(stored);
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
