import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setupUser } from '../setup.tsx';

vi.mock('../../src/audio/engine', async () => ({
  engine: (await import('../setup.tsx')).engineStub,
}));

const { ContextMenuHost, DialogHost, ToastHost } =
  await import('../../src/components/common/overlays');
const { ShortcutsSheet } = await import('../../src/components/common/ShortcutsSheet');
const { WelcomeSheet } = await import('../../src/components/common/WelcomeSheet');
const { useGlobalKeyboard } = await import('../../src/hooks/useKeyboard');
const { useUiStore } = await import('../../src/state/uiStore');

/** The overlay hosts as the shell mounts them, keyboard handling included. */
function OverlayHost() {
  useGlobalKeyboard();
  return (
    <>
      <button type="button">Behind the overlay</button>
      <DialogHost />
      <ContextMenuHost />
      <ToastHost />
    </>
  );
}

describe('DialogHost', () => {
  it('submits the typed value and closes', async () => {
    const user = setupUser();
    const onSubmit = vi.fn();
    render(<OverlayHost />);
    act(() =>
      useUiStore
        .getState()
        .showDialog({ kind: 'prompt', title: 'Rename track', confirmLabel: 'Rename', onSubmit }),
    );

    const dialog = screen.getByRole('dialog', { name: 'Rename track' });
    await user.type(within(dialog).getByRole('textbox'), '  Bass Bus  ');
    await user.click(within(dialog).getByRole('button', { name: 'Rename' }));

    expect(onSubmit).toHaveBeenCalledWith('Bass Bus');
    expect(useUiStore.getState().dialog).toBeNull();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('submits on Enter', async () => {
    const user = setupUser();
    const onSubmit = vi.fn();
    render(<OverlayHost />);
    act(() => useUiStore.getState().showDialog({ kind: 'prompt', title: 'New project', onSubmit }));

    await user.type(screen.getByRole('textbox'), 'Take 2{Enter}');

    expect(onSubmit).toHaveBeenCalledWith('Take 2');
  });

  it('cancels without submitting', async () => {
    const user = setupUser();
    const onSubmit = vi.fn();
    render(<OverlayHost />);
    act(() =>
      useUiStore
        .getState()
        .showDialog({ kind: 'prompt', title: 'New project', initialValue: 'Untitled', onSubmit }),
    );

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(useUiStore.getState().dialog).toBeNull();
  });

  it('closes on Escape without submitting', async () => {
    const user = setupUser();
    const onSubmit = vi.fn();
    render(<OverlayHost />);
    act(() =>
      useUiStore
        .getState()
        .showDialog({ kind: 'prompt', title: 'New project', initialValue: 'Untitled', onSubmit }),
    );

    await user.type(screen.getByRole('textbox'), '{Escape}');

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('refuses to submit an empty prompt', async () => {
    const user = setupUser();
    const onSubmit = vi.fn();
    render(<OverlayHost />);
    act(() =>
      useUiStore
        .getState()
        .showDialog({ kind: 'prompt', title: 'New project', initialValue: '   ', onSubmit }),
    );

    const confirm = screen.getByRole('button', { name: 'OK' });
    expect(confirm).toBeDisabled();

    await user.type(screen.getByRole('textbox'), 'named');
    expect(confirm).toBeEnabled();
    await user.click(confirm);
    expect(onSubmit).toHaveBeenCalledWith('named');
  });

  it('confirms a destructive action with its message and no text field', async () => {
    const user = setupUser();
    const onSubmit = vi.fn();
    render(<OverlayHost />);
    act(() =>
      useUiStore.getState().showDialog({
        kind: 'confirm',
        title: 'Delete "Drums"?',
        message: 'The track and all of its clips will be removed.',
        confirmLabel: 'Delete',
        danger: true,
        onSubmit,
      }),
    );

    expect(screen.getByText('The track and all of its clips will be removed.')).toBeVisible();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Delete' }));

    expect(onSubmit).toHaveBeenCalledWith('');
  });
});

describe('ContextMenuHost', () => {
  const menu = (action = vi.fn()) => ({
    x: 20,
    y: 20,
    items: [
      { label: 'Rename…', action },
      { label: 'Nothing to do here', disabled: true, action: () => {} },
    ],
  });

  it('runs the chosen item and closes', async () => {
    const user = setupUser();
    const action = vi.fn();
    render(<OverlayHost />);
    act(() => useUiStore.getState().showMenu(menu(action)));

    await user.click(screen.getByRole('menuitem', { name: 'Rename…' }));

    expect(action).toHaveBeenCalledTimes(1);
    expect(useUiStore.getState().contextMenu).toBeNull();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('disables an item that cannot be chosen', () => {
    render(<OverlayHost />);
    act(() => useUiStore.getState().showMenu(menu()));

    expect(screen.getByRole('menuitem', { name: 'Nothing to do here' })).toBeDisabled();
  });

  it('closes on Escape', async () => {
    const user = setupUser();
    render(<OverlayHost />);
    act(() => useUiStore.getState().showMenu(menu()));
    expect(screen.getByRole('menu')).toBeInTheDocument();

    await user.keyboard('{Escape}');

    expect(useUiStore.getState().contextMenu).toBeNull();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('closes on a press outside itself', async () => {
    const user = setupUser();
    render(<OverlayHost />);
    act(() => useUiStore.getState().showMenu(menu()));

    await user.click(screen.getByRole('button', { name: 'Behind the overlay' }));

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('survives a press inside itself, so an item can be clicked', () => {
    render(<OverlayHost />);
    act(() => useUiStore.getState().showMenu(menu()));

    fireEvent.pointerDown(screen.getByRole('menuitem', { name: 'Rename…' }));

    expect(screen.getByRole('menu')).toBeInTheDocument();
  });
});

describe('ToastHost', () => {
  afterEach(() => vi.useRealTimers());

  it('stacks what it is told, newest last', () => {
    render(<OverlayHost />);
    expect(screen.queryByText('Saved')).not.toBeInTheDocument();

    act(() => useUiStore.getState().toast('info', 'Saved'));
    act(() => useUiStore.getState().toast('error', 'Import failed'));

    const shown = screen.getAllByText(/Saved|Import failed/).map((el) => el.textContent);
    expect(shown).toEqual(['Saved', 'Import failed']);
  });

  it('dismisses a toast on click', async () => {
    const user = setupUser();
    render(<OverlayHost />);
    act(() => useUiStore.getState().toast('info', 'Added "Perc Loop"'));
    const toast = screen.getByText('Added "Perc Loop"');

    await user.click(toast);

    expect(screen.queryByText('Added "Perc Loop"')).not.toBeInTheDocument();
    expect(useUiStore.getState().toasts).toHaveLength(0);
  });

  it('expires on its own, and an error lingers longer than a note', () => {
    vi.useFakeTimers();
    render(<OverlayHost />);
    act(() => useUiStore.getState().toast('info', 'Saved'));
    act(() => useUiStore.getState().toast('error', 'Import failed'));

    act(() => vi.advanceTimersByTime(3300));
    expect(screen.queryByText('Saved')).not.toBeInTheDocument();
    expect(screen.getByText('Import failed')).toBeVisible();

    act(() => vi.advanceTimersByTime(3000));
    expect(screen.queryByText('Import failed')).not.toBeInTheDocument();
  });
});

describe('ContextMenuHost keyboard', () => {
  const items = [
    { label: 'Rename…', action: vi.fn() },
    { label: 'Nothing to do here', disabled: true, action: vi.fn() },
    { label: 'Duplicate', action: vi.fn() },
    { label: 'Delete', danger: true, action: vi.fn() },
  ];
  const open = () => act(() => useUiStore.getState().showMenu({ x: 20, y: 20, items }));
  const label = () => document.activeElement?.textContent;

  it('is a vertical menu whose items are not tab stops', () => {
    render(<OverlayHost />);
    open();

    expect(screen.getByRole('menu')).toHaveAttribute('aria-orientation', 'vertical');
    for (const item of screen.getAllByRole('menuitem')) {
      expect(item).toHaveAttribute('tabindex', '-1');
    }
  });

  it('takes focus on the first item a user can actually choose', () => {
    render(<OverlayHost />);
    open();

    expect(screen.getByRole('menuitem', { name: 'Rename…' })).toHaveFocus();
  });

  it('walks with the arrows, skipping what is disabled, and wraps at both ends', async () => {
    const user = setupUser();
    render(<OverlayHost />);
    open();

    await user.keyboard('{ArrowDown}');
    expect(label()).toBe('Duplicate');
    await user.keyboard('{ArrowDown}');
    expect(label()).toBe('Delete');
    await user.keyboard('{ArrowDown}');
    expect(label()).toBe('Rename…');
    await user.keyboard('{ArrowUp}');
    expect(label()).toBe('Delete');
  });

  it('jumps to the ends with Home and End', async () => {
    const user = setupUser();
    render(<OverlayHost />);
    open();

    await user.keyboard('{End}');
    expect(label()).toBe('Delete');
    await user.keyboard('{Home}');
    expect(label()).toBe('Rename…');
  });

  it('closes on Escape and gives focus back to what opened it', async () => {
    const user = setupUser();
    render(<OverlayHost />);
    const opener = screen.getByRole('button', { name: 'Behind the overlay' });
    act(() => opener.focus());
    open();
    expect(opener).not.toHaveFocus();

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it('gives focus back after an item is chosen', async () => {
    const user = setupUser();
    render(<OverlayHost />);
    const opener = screen.getByRole('button', { name: 'Behind the overlay' });
    act(() => opener.focus());
    open();

    await user.keyboard('{Enter}');

    expect(items[0].action).toHaveBeenCalled();
    expect(opener).toHaveFocus();
  });
});

describe('the Menu key opens the focused object’s menu', () => {
  const rename = vi.fn();

  /** An object that declares its menu the way every app surface does. */
  function MenuTarget() {
    return (
      <div
        data-testid="target"
        tabIndex={0}
        onContextMenu={(e) => {
          e.preventDefault();
          useUiStore.getState().showMenu({
            x: e.clientX,
            y: e.clientY,
            items: [{ label: 'Rename…', action: rename }],
          });
        }}
      />
    );
  }

  function Host() {
    useGlobalKeyboard();
    return (
      <>
        <MenuTarget />
        <ContextMenuHost />
      </>
    );
  }

  /** Focus the target and give it a box, since jsdom lays nothing out. */
  function focusTarget(): HTMLElement {
    const el = screen.getByTestId('target');
    vi.spyOn(el, 'getBoundingClientRect').mockReturnValue(new DOMRect(200, 120, 300, 40));
    act(() => el.focus());
    return el;
  }

  it('opens the same menu the pointer opens, at the focused object’s box', () => {
    render(<Host />);
    focusTarget();

    fireEvent.keyDown(document.activeElement!, { key: 'ContextMenu' });

    expect(useUiStore.getState().contextMenu).toMatchObject({ x: 212, y: 132 });
    expect(screen.getByRole('menuitem', { name: 'Rename…' })).toHaveFocus();
  });

  it('answers Shift+F10 as well, for keyboards without a Menu key', () => {
    render(<Host />);
    focusTarget();

    fireEvent.keyDown(document.activeElement!, { key: 'F10', shiftKey: true });

    expect(screen.getByRole('menu')).toBeInTheDocument();
  });

  it('leaves the browser its own menu when nothing focused has one', () => {
    render(<Host />);

    fireEvent.keyDown(document.body, { key: 'ContextMenu' });

    expect(useUiStore.getState().contextMenu).toBeNull();
  });
});

describe('dialog focus', () => {
  it('is a modal dialog that takes focus on its input', () => {
    render(<OverlayHost />);
    act(() =>
      useUiStore
        .getState()
        .showDialog({ kind: 'prompt', title: 'Rename track', onSubmit: vi.fn() }),
    );

    const dialog = screen.getByRole('dialog', { name: 'Rename track' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(within(dialog).getByRole('textbox')).toHaveFocus();
  });

  it('takes focus on a confirm, which has no field to fall back on', () => {
    render(<OverlayHost />);
    act(() =>
      useUiStore.getState().showDialog({
        kind: 'confirm',
        title: 'Delete "Drums"?',
        confirmLabel: 'Delete',
        onSubmit: vi.fn(),
      }),
    );

    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
  });

  it('keeps Tab inside itself', async () => {
    const user = setupUser();
    render(<OverlayHost />);
    act(() =>
      useUiStore.getState().showDialog({
        kind: 'confirm',
        title: 'Delete "Drums"?',
        confirmLabel: 'Delete',
        onSubmit: vi.fn(),
      }),
    );

    await user.tab();
    expect(screen.getByRole('button', { name: 'Delete' })).toHaveFocus();
    // The last control wraps to the first rather than escaping to the page.
    await user.tab();
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
  });

  it('gives focus back to whatever opened it', async () => {
    const user = setupUser();
    render(<OverlayHost />);
    const opener = screen.getByRole('button', { name: 'Behind the overlay' });
    act(() => opener.focus());
    act(() =>
      useUiStore.getState().showDialog({
        kind: 'confirm',
        title: 'Delete "Drums"?',
        confirmLabel: 'Delete',
        onSubmit: vi.fn(),
      }),
    );

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(opener).toHaveFocus();
  });
});

describe('sheet focus', () => {
  it('the shortcuts sheet takes focus and keeps it', async () => {
    const user = setupUser();
    render(
      <>
        <button type="button">Behind the overlay</button>
        <ShortcutsSheet />
      </>,
    );
    const opener = screen.getByRole('button', { name: 'Behind the overlay' });
    act(() => opener.focus());
    act(() => useUiStore.getState().set({ shortcutsOpen: true }));

    const sheet = screen.getByRole('dialog', { name: 'Keyboard shortcuts' });
    expect(within(sheet).getByRole('button', { name: 'Close' })).toHaveFocus();

    // One control, so Tab can only land back on it — never on the page behind.
    await user.tab();
    expect(sheet).toContainElement(document.activeElement as HTMLElement | null);
  });

  it('the welcome sheet takes focus and hands it back on close', async () => {
    const user = setupUser();
    render(
      <>
        <button type="button">Behind the overlay</button>
        <WelcomeSheet />
      </>,
    );
    const opener = screen.getByRole('button', { name: 'Behind the overlay' });
    act(() => opener.focus());
    act(() => useUiStore.getState().set({ welcomeOpen: true }));

    const sheet = screen.getByRole('dialog', { name: 'Welcome to MotionLab Studio' });
    expect(sheet).toContainElement(document.activeElement as HTMLElement | null);

    await user.click(within(sheet).getByRole('button', { name: 'Start making music' }));

    expect(opener).toHaveFocus();
  });
});

describe('toast announcement', () => {
  it('announces notices politely and failures at once, in separate regions', () => {
    render(<OverlayHost />);
    act(() => useUiStore.getState().toast('info', 'Saved'));
    act(() => useUiStore.getState().toast('error', 'Import failed'));

    const polite = screen.getByRole('status');
    expect(polite).toHaveAttribute('aria-live', 'polite');
    expect(polite).toHaveAttribute('aria-atomic', 'false');
    expect(within(polite).getByText('Saved')).toBeInTheDocument();
    expect(within(polite).queryByText('Import failed')).not.toBeInTheDocument();

    expect(within(screen.getByRole('alert')).getByText('Import failed')).toBeInTheDocument();
  });

  it('keeps both regions mounted so the first message is not missed', () => {
    render(<OverlayHost />);

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('is a button that says what it will do', async () => {
    const user = setupUser();
    render(<OverlayHost />);
    act(() => useUiStore.getState().toast('info', 'Added "Perc Loop"'));

    const toast = screen.getByRole('button', { name: 'Added "Perc Loop". Dismiss' });
    await user.click(toast);

    expect(useUiStore.getState().toasts).toHaveLength(0);
  });
});
