import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { setupUser } from '../setup.tsx';

vi.mock('../../src/audio/engine', async () => ({
  engine: (await import('../setup.tsx')).engineStub,
}));

const { KeyCommands } = await import('../../src/components/settings/KeyCommands');
const { useKeymapStore } = await import('../../src/state/keymapStore');
const { SHORTCUTS, comboLabel } = await import('../../src/app/shortcuts');

const PLAY = SHORTCUTS.find((s) => s.id === 'play');
const SPLIT = SHORTCUTS.find((s) => s.id === 'split');

if (!PLAY || !SPLIT) throw new Error('the shortcut registry lost play or split');

/** The button that shows a shortcut's binding and starts recording a new one. */
function comboButton(description: string) {
  return screen.getByRole('button', { name: new RegExp(`^${description}:`) });
}

describe('KeyCommands binding capture', () => {
  it('captures the next combination and shows it', async () => {
    const user = setupUser();
    render(<KeyCommands />);
    const button = comboButton(PLAY.description);
    expect(button).toHaveTextContent(comboLabel(PLAY.combo));

    await user.click(button);
    expect(button).toHaveTextContent('Press keys…');

    await user.keyboard('{Control>}{Shift>}p{/Shift}{/Control}');

    expect(useKeymapStore.getState().overrides[PLAY.id]).toBe('mod+shift+p');
    expect(button).toHaveTextContent(comboLabel('mod+shift+p'));
    expect(button).not.toHaveTextContent('Press keys…');
  });

  it('keeps recording while only modifiers are held', async () => {
    const user = setupUser();
    render(<KeyCommands />);
    const button = comboButton(PLAY.description);

    await user.click(button);
    await user.keyboard('{Shift}');

    expect(button).toHaveTextContent('Press keys…');
    expect(useKeymapStore.getState().overrides).toEqual({});
  });

  it('cancels on Escape and leaves the binding alone', async () => {
    const user = setupUser();
    render(<KeyCommands />);
    const button = comboButton(PLAY.description);

    await user.click(button);
    await user.keyboard('{Escape}');

    expect(useKeymapStore.getState().overrides).toEqual({});
    expect(button).toHaveTextContent(comboLabel(PLAY.combo));
  });

  it('stops recording when the button is clicked again', async () => {
    const user = setupUser();
    render(<KeyCommands />);
    const button = comboButton(PLAY.description);

    await user.click(button);
    await user.click(button);

    expect(button).toHaveTextContent(comboLabel(PLAY.combo));
  });

  it('takes a combination from whoever had it', async () => {
    const user = setupUser();
    render(<KeyCommands />);

    await user.click(comboButton(PLAY.description));
    await user.keyboard('{Control>}{Shift>}p{/Shift}{/Control}');
    await user.click(comboButton(SPLIT.description));
    await user.keyboard('{Control>}{Shift>}p{/Shift}{/Control}');

    const overrides = useKeymapStore.getState().overrides;
    expect(overrides[SPLIT.id]).toBe('mod+shift+p');
    expect(overrides[PLAY.id]).toBeUndefined();
    expect(comboButton(PLAY.description)).toHaveTextContent(comboLabel(PLAY.combo));
  });
});

describe('KeyCommands resetting', () => {
  it('offers a per-row reset only once the row has changed', async () => {
    const user = setupUser();
    render(<KeyCommands />);
    const reset = screen.getByRole('button', { name: `Reset ${PLAY.description}` });
    expect(reset).toBeDisabled();

    await user.click(comboButton(PLAY.description));
    await user.keyboard('{Control>}{Shift>}p{/Shift}{/Control}');
    expect(reset).toBeEnabled();

    await user.click(reset);

    expect(useKeymapStore.getState().overrides[PLAY.id]).toBeUndefined();
    expect(comboButton(PLAY.description)).toHaveTextContent(comboLabel(PLAY.combo));
  });

  it('resets every binding at once', async () => {
    const user = setupUser();
    render(<KeyCommands />);
    const resetAll = screen.getByRole('button', { name: 'Reset all' });
    expect(resetAll).toBeDisabled();

    await user.click(comboButton(PLAY.description));
    await user.keyboard('{Control>}{Shift>}p{/Shift}{/Control}');
    await user.click(comboButton(SPLIT.description));
    await user.keyboard('{Control>}{Shift>}k{/Shift}{/Control}');
    expect(resetAll).toBeEnabled();

    await user.click(resetAll);

    expect(useKeymapStore.getState().overrides).toEqual({});
  });
});

describe('KeyCommands search', () => {
  it('narrows the list to matching descriptions', async () => {
    const user = setupUser();
    render(<KeyCommands />);
    expect(screen.getByText(SPLIT.description)).toBeVisible();

    await user.type(screen.getByLabelText('Search shortcuts'), PLAY.description);

    expect(screen.getByText(PLAY.description)).toBeVisible();
    expect(screen.queryByText(SPLIT.description)).not.toBeInTheDocument();
  });

  it('also matches on the binding itself', async () => {
    const user = setupUser();
    render(<KeyCommands />);

    await user.type(screen.getByLabelText('Search shortcuts'), comboLabel(PLAY.combo));

    expect(screen.getByText(PLAY.description)).toBeVisible();
  });
});
