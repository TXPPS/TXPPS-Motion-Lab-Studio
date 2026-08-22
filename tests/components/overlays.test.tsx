import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setupUser } from '../setup.tsx';

vi.mock('../../src/audio/engine', async () => ({
  engine: (await import('../setup.tsx')).engineStub,
}));

const { ContextMenuHost, DialogHost, ToastHost } =
  await import('../../src/components/common/overlays');
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
