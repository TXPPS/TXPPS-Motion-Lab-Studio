import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupUser } from '../setup.tsx';

vi.mock('../../src/audio/engine', async () => ({
  engine: (await import('../setup.tsx')).engineStub,
}));

const { InsertRack } = await import('../../src/components/mixer/InsertRack');
const { useProjectStore } = await import('../../src/state/projectStore');
const { CHAIN_PRESETS } = await import('../../src/model/effectPresets');
const { MAX_INSERTS } = await import('../../src/model/effects');

let trackId = '';

function RackHost() {
  const track = useProjectStore((s) => s.project.tracks.find((t) => t.id === trackId));
  if (!track) throw new Error('no track');
  return <InsertRack track={track} />;
}

function effects() {
  const track = useProjectStore.getState().project.tracks.find((t) => t.id === trackId);
  return track?.effects ?? [];
}

beforeEach(() => {
  trackId = useProjectStore.getState().addTrack('audio');
});

describe('InsertRack chain edits', () => {
  it('starts empty and says the signal passes through', () => {
    render(<RackHost />);
    expect(screen.getByText('No inserts. Signal passes through.')).toBeVisible();
  });

  it('appends each added effect to the end of the chain', async () => {
    const user = setupUser();
    render(<RackHost />);
    const picker = screen.getByLabelText('Add insert effect');

    await user.selectOptions(picker, 'delay');
    await user.selectOptions(picker, 'chorus');

    expect(effects().map((e) => e.kind)).toEqual(['delay', 'chorus']);
    expect(screen.getByRole('button', { name: 'Delay settings' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Chorus settings' })).toBeVisible();
    // The picker returns to its prompt so the next choice is a change event.
    expect(picker).toHaveValue('');
  });

  it('toggles bypass on one effect without touching its neighbour', async () => {
    const user = setupUser();
    render(<RackHost />);
    const picker = screen.getByLabelText('Add insert effect');
    await user.selectOptions(picker, 'delay');
    await user.selectOptions(picker, 'chorus');

    const bypass = screen.getByRole('button', { name: 'Bypass Delay' });
    expect(bypass).toHaveAttribute('aria-pressed', 'true');
    expect(bypass).toHaveTextContent('ON');

    await user.click(bypass);

    expect(effects()[0].bypass).toBe(true);
    expect(effects()[1].bypass).toBeFalsy();
    expect(bypass).toHaveAttribute('aria-pressed', 'false');
    expect(bypass).toHaveTextContent('OFF');

    await user.click(bypass);
    expect(effects()[0].bypass).toBe(false);
  });

  it('reorders the chain from the open slot', async () => {
    const user = setupUser();
    render(<RackHost />);
    const picker = screen.getByLabelText('Add insert effect');
    await user.selectOptions(picker, 'delay');
    await user.selectOptions(picker, 'chorus');

    await user.click(screen.getByRole('button', { name: 'Chorus settings' }));
    await user.click(screen.getByTitle('Move earlier in the chain'));

    expect(effects().map((e) => e.kind)).toEqual(['chorus', 'delay']);
  });

  it('cannot move the first effect earlier', async () => {
    const user = setupUser();
    render(<RackHost />);
    await user.selectOptions(screen.getByLabelText('Add insert effect'), 'delay');

    await user.click(screen.getByRole('button', { name: 'Delay settings' }));

    expect(screen.getByTitle('Move earlier in the chain')).toBeDisabled();
    expect(screen.getByTitle('Move later in the chain')).toBeDisabled();
  });

  it('removes only the effect whose slot was open', async () => {
    const user = setupUser();
    render(<RackHost />);
    const picker = screen.getByLabelText('Add insert effect');
    await user.selectOptions(picker, 'delay');
    await user.selectOptions(picker, 'chorus');

    await user.click(screen.getByRole('button', { name: 'Delay settings' }));
    await user.click(screen.getByRole('button', { name: 'Remove' }));

    expect(effects().map((e) => e.kind)).toEqual(['chorus']);
    expect(screen.queryByRole('button', { name: 'Delay settings' })).not.toBeInTheDocument();
  });

  it('adds every step of a chain preset, in order', async () => {
    const user = setupUser();
    const preset = CHAIN_PRESETS[0];
    render(<RackHost />);

    await user.selectOptions(screen.getByLabelText('Add an effect chain'), preset.name);

    expect(effects().map((e) => e.kind)).toEqual(preset.steps.map((s) => s.kind));
    for (const [i, step] of preset.steps.entries()) {
      for (const [key, value] of Object.entries(step.params)) {
        expect(effects()[i].params[key]).toBe(value);
      }
      if (step.bypass) expect(effects()[i].bypass).toBe(true);
    }
  });

  it('refuses a thirteenth insert and says the rack is full', async () => {
    const user = setupUser();
    for (let i = 0; i < MAX_INSERTS; i++) {
      useProjectStore.getState().addEffect(trackId, 'delay');
    }
    render(<RackHost />);

    const picker = screen.getByLabelText('Add insert effect');
    expect(picker).toBeDisabled();
    expect(screen.getByRole('option', { name: `Full (${MAX_INSERTS} inserts)` })).toBeVisible();
    expect(effects()).toHaveLength(MAX_INSERTS);
    await user.click(picker);
    expect(effects()).toHaveLength(MAX_INSERTS);
  });
});
