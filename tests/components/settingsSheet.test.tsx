import { act, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { setupUser } from '../setup.tsx';

vi.mock('../../src/audio/engine', async () => ({
  engine: (await import('../setup.tsx')).engineStub,
}));

const { SettingsSheet } = await import('../../src/components/settings/SettingsSheet');
const { useUiStore } = await import('../../src/state/uiStore');
const { usePrefsStore } = await import('../../src/state/prefsStore');

/** The sheet plus the control that opened it, so focus has somewhere to return. */
function SettingsHost() {
  return (
    <>
      <button type="button">Preferences</button>
      <SettingsSheet />
    </>
  );
}

function open(): void {
  act(() => useUiStore.getState().set({ settingsOpen: true }));
}

function root(): HTMLElement {
  return document.documentElement;
}

describe('SettingsSheet appearance', () => {
  it('writes the chosen theme onto the document', async () => {
    const user = setupUser();
    render(<SettingsHost />);
    open();
    expect(root()).not.toHaveAttribute('data-theme');

    await user.click(screen.getByRole('radio', { name: 'Dark' }));

    expect(root()).toHaveAttribute('data-theme', 'dark');
    expect(screen.getByRole('radio', { name: 'Dark' })).toHaveAttribute('aria-checked', 'true');
    expect(usePrefsStore.getState().theme).toBe('dark');

    await user.click(screen.getByRole('radio', { name: 'Contrast' }));
    expect(root()).toHaveAttribute('data-theme', 'contrast');
  });

  it('takes the theme attribute off again for the system theme', async () => {
    const user = setupUser();
    render(<SettingsHost />);
    open();

    await user.click(screen.getByRole('radio', { name: 'Light' }));
    expect(root()).toHaveAttribute('data-theme', 'light');

    await user.click(screen.getByRole('radio', { name: 'System' }));

    expect(root()).not.toHaveAttribute('data-theme');
  });

  it('sets the interface scale from the segmented control', async () => {
    const user = setupUser();
    render(<SettingsHost />);
    open();
    expect(root().style.getPropertyValue('--ui-scale')).toBe('1');

    await user.click(screen.getByRole('button', { name: '125%' }));

    expect(root().style.getPropertyValue('--ui-scale')).toBe('1.25');
    expect(usePrefsStore.getState().uiScale).toBe(1.25);
    expect(screen.getByRole('button', { name: '125%' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '100%' })).toHaveAttribute('aria-pressed', 'false');

    await user.click(screen.getByRole('button', { name: '85%' }));
    expect(root().style.getPropertyValue('--ui-scale')).toBe('0.85');
  });

  it('flags reduced motion on the document', async () => {
    const user = setupUser();
    render(<SettingsHost />);
    open();
    const toggle = screen.getByRole('switch', { name: 'Reduce motion' });
    expect(toggle).toHaveAttribute('aria-checked', 'false');

    await user.click(toggle);

    expect(toggle).toHaveAttribute('aria-checked', 'true');
    expect(root()).toHaveAttribute('data-reduce-motion');
  });

  it('puts every preference back with Reset preferences', async () => {
    const user = setupUser();
    render(<SettingsHost />);
    open();
    await user.click(screen.getByRole('radio', { name: 'Light' }));
    await user.click(screen.getByRole('button', { name: '140%' }));

    await user.click(screen.getByRole('button', { name: 'Reset preferences' }));

    expect(root()).not.toHaveAttribute('data-theme');
    expect(root().style.getPropertyValue('--ui-scale')).toBe('1');
  });
});

describe('SettingsSheet dismissal', () => {
  it('closes on Escape', async () => {
    const user = setupUser();
    render(<SettingsHost />);
    open();
    expect(screen.getByRole('dialog', { name: 'Preferences' })).toBeVisible();

    await user.keyboard('{Escape}');

    expect(useUiStore.getState().settingsOpen).toBe(false);
    expect(screen.queryByRole('dialog', { name: 'Preferences' })).not.toBeInTheDocument();
  });

  it('closes on Done and on the close button', async () => {
    const user = setupUser();
    render(<SettingsHost />);

    open();
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(useUiStore.getState().settingsOpen).toBe(false);

    open();
    await user.click(screen.getByRole('button', { name: 'Close preferences' }));
    expect(useUiStore.getState().settingsOpen).toBe(false);
  });
});

describe('SettingsSheet focus', () => {
  it('moves focus into the dialog and hands it back on close', async () => {
    const user = setupUser();
    render(<SettingsHost />);
    const opener = screen.getByRole('button', { name: 'Preferences' });
    opener.focus();

    open();
    const dialog = screen.getByRole('dialog', { name: 'Preferences' });
    expect(dialog).toContainElement(document.activeElement as HTMLElement);

    await user.keyboard('{Escape}');

    expect(opener).toHaveFocus();
  });

  it('keeps Tab inside the dialog', async () => {
    const user = setupUser();
    render(<SettingsHost />);
    open();
    const close = screen.getByRole('button', { name: 'Close preferences' });
    const done = screen.getByRole('button', { name: 'Done' });

    done.focus();
    await user.tab();
    expect(close).toHaveFocus();

    await user.tab({ shift: true });
    expect(done).toHaveFocus();
  });
});
