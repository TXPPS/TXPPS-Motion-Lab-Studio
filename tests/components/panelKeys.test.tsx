/**
 * Directive 09 §3 — the panels answer the keyboard.
 *
 * Nothing did. `workspaceStore` has had `toggle`, `reveal` and `setMaximized`
 * since it was written, all correct, and no key reached any of them: every pane
 * could only be opened by finding its button. The reference puts the panels on
 * F2–F10 and a professional user's hands already know that map.
 *
 * These cases assert the *store*, not the DOM. A key that lights a button
 * without moving the state it claims to move is the same defect as a control
 * that does nothing, and the store is where the truth is.
 *
 * The second describe is the guard the transport's Home tooltip earned: the
 * registry is the documentation of record, so a panel key it advertises must be
 * bound and a bound one must be advertised. "Return to start (Home)" sat in a
 * tooltip for as long as nothing anywhere bound Home.
 */
import { render } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/audio/engine', async () => ({
  engine: (await import('../setup.tsx')).engineStub,
}));

const { engineStub } = await import('../setup.tsx');
const { useGlobalKeyboard } = await import('../../src/hooks/useKeyboard');
const { useWorkspaceStore } = await import('../../src/state/workspaceStore');
const { useUiStore } = await import('../../src/state/uiStore');
const { useRouteStore } = await import('../../src/state/routeStore');
const { SHORTCUTS } = await import('../../src/app/shortcuts');

function KeyboardHost() {
  useGlobalKeyboard();
  return <div data-testid="host" />;
}

function press(key: string, init: Partial<KeyboardEventInit> = {}) {
  fireEvent.keyDown(window, { key, code: key, ...init });
}

const ws = () => useWorkspaceStore.getState();
const ui = () => useUiStore.getState();

beforeEach(() => {
  useWorkspaceStore.getState().reset();
  useUiStore.getState().set({ browserTab: 'projects', editorTab: 'mixer' });
  render(<KeyboardHost />);
});

describe('the panel keys move the panels', () => {
  it('F2 shows and hides the editor', () => {
    const before = ws().showEditor;
    press('F2');
    expect(ws().showEditor).toBe(!before);
    press('F2');
    expect(ws().showEditor).toBe(before);
  });

  it('F3 opens the mixer, and opens the pane it lives in', () => {
    useWorkspaceStore.getState().toggle('showEditor'); // start with it hidden
    expect(ws().showEditor).toBe(false);
    useUiStore.getState().set({ editorTab: 'piano' });
    press('F3');
    // Both halves. Switching the tab of a hidden pane is a command that does
    // nothing, which is what `reveal` exists to prevent.
    expect(ws().showEditor).toBe(true);
    expect(ui().editorTab).toBe('mixer');
  });

  it('F4 shows and hides the inspector', () => {
    const before = ws().showInspector;
    press('F4');
    expect(ws().showInspector).toBe(!before);
  });

  it('F5 shows and hides the browser', () => {
    const before = ws().showBrowser;
    press('F5');
    expect(ws().showBrowser).toBe(!before);
  });

  it.each([
    ['F6', 'instruments'],
    ['F7', 'effects'],
    ['F8', 'loops'],
    ['F9', 'samples'],
    ['F10', 'pool'],
  ])('%s opens the browser on its %s tab', (key, tab) => {
    useWorkspaceStore.getState().toggle('showBrowser');
    expect(ws().showBrowser).toBe(false);
    press(key);
    expect(ws().showBrowser).toBe(true);
    expect(ui().browserTab).toBe(tab);
  });

  it('Shift+F full-screens the arrangement and lets it back out', () => {
    press('F', { shiftKey: true });
    expect(ws().maximized).toBe('arrange');
    press('F', { shiftKey: true });
    expect(ws().maximized).toBeNull();
  });

  it('Ctrl+1 to 4 move between the pages', () => {
    press('2', { ctrlKey: true });
    expect(useRouteStore.getState().route.page).toBe('song');
    press('3', { ctrlKey: true });
    expect(useRouteStore.getState().route.page).toBe('mastering');
    press('1', { ctrlKey: true });
    expect(useRouteStore.getState().route.page).toBe('start');
  });

  it('leaves plain digits to the tool row', () => {
    const page = useRouteStore.getState().route.page;
    press('2');
    // The arrangement tools are 1-9 and were bound first; a page key that ate
    // them would take a tool away to give a page a shortcut it has a modifier
    // for.
    expect(useRouteStore.getState().route.page).toBe(page);
  });

  it('returns to start on Home', () => {
    engineStub.returnToStart.mockClear();
    press('Home');
    // The transport's own tooltip has said "Return to start (Home)" for as long
    // as Home did nothing at all.
    expect(engineStub.returnToStart).toHaveBeenCalled();
  });

  it('does not answer a panel key while a field is being typed in', () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    const before = ws().showEditor;
    fireEvent.keyDown(input, { key: 'F2', code: 'F2' });
    expect(ws().showEditor).toBe(before);
    input.remove();
  });

  it('leaves F11 to the browser', () => {
    // Taking it would break the key a web user relies on to escape a
    // full-screen page. This is the one place the reference's map is not
    // matched, and it is a platform constraint rather than a preference.
    const snapshot = JSON.stringify([ws().showBrowser, ws().showEditor, ws().showInspector]);
    press('F11');
    expect(JSON.stringify([ws().showBrowser, ws().showEditor, ws().showInspector])).toBe(snapshot);
    expect(SHORTCUTS.some((s) => s.combo === 'f11')).toBe(false);
  });
});

describe('what the shortcut list promises, the keyboard answers', () => {
  /** Every function-key combo the registry advertises. */
  const advertised = SHORTCUTS.filter((s) => /^f\d+$/.test(s.combo)).map((s) => s.combo);

  it('advertises the panel keys it binds', () => {
    expect(advertised.sort()).toEqual(['f10', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7', 'f8', 'f9']);
  });

  const paneState = () =>
    JSON.stringify({
      b: ws().showBrowser,
      e: ws().showEditor,
      i: ws().showInspector,
      bt: ui().browserTab,
      et: ui().editorTab,
    });

  it.each(advertised)('%s does something', (combo) => {
    // Put the panes in a state every advertised key can move away from, and
    // only then take the reading. Captured before this setup, the comparison
    // would be against a state the setup itself had already changed — the
    // assertion would pass for an unbound key, which is the whole failure it
    // exists to catch.
    useWorkspaceStore.getState().reset();
    useUiStore.getState().set({ browserTab: 'projects', editorTab: 'piano' });
    useWorkspaceStore.getState().toggle('showBrowser');
    useWorkspaceStore.getState().toggle('showEditor');
    const before = paneState();
    press(combo.toUpperCase());
    expect(paneState(), `${combo} is in the shortcut list and changes nothing`).not.toBe(before);
  });
});
