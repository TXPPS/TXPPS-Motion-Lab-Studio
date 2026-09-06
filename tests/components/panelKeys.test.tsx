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

/** Is this pane drawing its contents — visible and not folded to a rail? */
const open = (id: 'browser' | 'editor' | 'inspector') => {
  const p = ws().panes[id];
  return p.visible && !p.collapsed;
};

beforeEach(() => {
  useWorkspaceStore.getState().reset();
  useUiStore.getState().set({ browserTab: 'projects' });
  render(<KeyboardHost />);
});

describe('the panel keys move the panels', () => {
  it('F2 shows and hides the editor', () => {
    const before = ws().panes.editor.visible;
    press('F2');
    expect(ws().panes.editor.visible).toBe(!before);
    press('F2');
    expect(ws().panes.editor.visible).toBe(before);
  });

  it('F3 opens the mixer, and opens the pane it lives in', () => {
    useWorkspaceStore.getState().togglePane('editor'); // start with it hidden
    expect(ws().panes.editor.visible).toBe(false);
    useWorkspaceStore.getState().setLayout({ editorTab: 'piano' });
    press('F3');
    // Both halves. Switching the tab of a hidden pane is a command that does
    // nothing, which is what `showEditorTab` exists to prevent.
    expect(open('editor')).toBe(true);
    expect(ws().editorTab).toBe('mixer');
  });

  it('F3 opens the pane even when it is collapsed to a rail rather than hidden', () => {
    // The third way a pane can be out of the way, and the one `reveal` did not
    // know about while collapse was still a synonym for hide: a rail IS visible,
    // so a check on `visible` alone reads as "already open" and the command puts
    // the mixer behind a 44px strip.
    useWorkspaceStore.getState().toggleCollapsed('editor');
    expect(ws().panes.editor.collapsed).toBe(true);
    press('F3');
    expect(open('editor')).toBe(true);
    expect(ws().editorTab).toBe('mixer');
  });

  it('F4 shows and hides the inspector', () => {
    const before = ws().panes.inspector.visible;
    press('F4');
    expect(ws().panes.inspector.visible).toBe(!before);
  });

  it('F5 shows and hides the browser', () => {
    const before = ws().panes.browser.visible;
    press('F5');
    expect(ws().panes.browser.visible).toBe(!before);
  });

  it.each([
    ['F2', 'editor'],
    ['F4', 'inspector'],
    ['F5', 'browser'],
  ] as const)('Shift+%s collapses the %s to a rail and expands it back', (key, id) => {
    // A pane a pointer can fold and a keyboard cannot is half a feature. The
    // SIZE has to survive the round trip as well as the state: an expand that
    // lands on the default has forgotten what the user set, which is exactly
    // what the old boolean hide did.
    useWorkspaceStore.getState().setPaneSize(id, 30);
    expect(ws().panes[id].size).toBe(30);
    press(key, { shiftKey: true });
    expect(ws().panes[id].collapsed).toBe(true);
    // Collapsed, not hidden — the rail is what carries the way back.
    expect(ws().panes[id].visible).toBe(true);
    press(key, { shiftKey: true });
    expect(ws().panes[id].collapsed).toBe(false);
    expect(ws().panes[id].size).toBe(30);
  });

  it.each([
    ['F6', 'instruments'],
    ['F7', 'effects'],
    ['F8', 'loops'],
    ['F9', 'samples'],
    ['F10', 'pool'],
  ])('%s opens the browser on its %s tab', (key, tab) => {
    useWorkspaceStore.getState().togglePane('browser');
    expect(ws().panes.browser.visible).toBe(false);
    press(key);
    expect(open('browser')).toBe(true);
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
    const before = ws().panes.editor.visible;
    fireEvent.keyDown(input, { key: 'F2', code: 'F2' });
    expect(ws().panes.editor.visible).toBe(before);
    input.remove();
  });

  it('leaves F11 to the browser', () => {
    // Taking it would break the key a web user relies on to escape a
    // full-screen page. This is the one place the reference's map is not
    // matched, and it is a platform constraint rather than a preference.
    const snapshot = JSON.stringify(ws().panes);
    press('F11');
    expect(JSON.stringify(ws().panes)).toBe(snapshot);
    expect(SHORTCUTS.some((s) => s.combo === 'f11')).toBe(false);
  });
});

describe('what the shortcut list promises, the keyboard answers', () => {
  /** Every function-key combo the registry advertises. */
  const advertised = SHORTCUTS.filter((s) => /^f\d+$/.test(s.combo)).map((s) => s.combo);

  it('advertises the panel keys it binds', () => {
    expect(advertised.sort()).toEqual(['f10', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7', 'f8', 'f9']);
  });

  it('advertises the three collapse keys it binds', () => {
    // The same rule one modifier over. `advertised` matches bare function keys
    // only, so the collapse combos would have been in the help sheet with
    // nothing checking that anything answered them — which is the shape of the
    // transport's Home tooltip, and the reason this describe block exists.
    const shifted = SHORTCUTS.filter((s) => /^shift[+]f\d+$/.test(s.combo)).map((s) => s.combo);
    expect(shifted.sort()).toEqual(['shift+f2', 'shift+f4', 'shift+f5']);
  });

  const paneState = () =>
    JSON.stringify({ panes: ws().panes, bt: ui().browserTab, et: ws().editorTab });

  it.each(advertised)('%s does something', (combo) => {
    // Put the panes in a state every advertised key can move away from, and
    // only then take the reading. Captured before this setup, the comparison
    // would be against a state the setup itself had already changed — the
    // assertion would pass for an unbound key, which is the whole failure it
    // exists to catch.
    useWorkspaceStore.getState().reset();
    useUiStore.getState().set({ browserTab: 'projects' });
    useWorkspaceStore.getState().setLayout({ editorTab: 'piano' });
    useWorkspaceStore.getState().togglePane('browser');
    useWorkspaceStore.getState().togglePane('editor');
    const before = paneState();
    press(combo.toUpperCase());
    expect(paneState(), `${combo} is in the shortcut list and changes nothing`).not.toBe(before);
  });
});
