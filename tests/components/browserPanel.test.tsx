import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { setupUser } from '../setup.tsx';

vi.mock('../../src/audio/engine', async () => ({
  engine: (await import('../setup.tsx')).engineStub,
}));

const { BrowserPanel } = await import('../../src/components/browser/BrowserPanel');
const { useProjectStore } = await import('../../src/state/projectStore');
const { useUiStore } = await import('../../src/state/uiStore');
const { SYNTH_PRESETS } = await import('../../src/model/presets');
const { createEmptyProject } = await import('../../src/model/demoProject');

const PRESET = SYNTH_PRESETS[0].presetName;

/** Every tab is reachable from the tablist, by its label. */
function tab(name: string) {
  return screen.getByRole('tab', { name });
}

describe('BrowserPanel tabs', () => {
  it('opens on Projects and reports an empty library', async () => {
    render(<BrowserPanel />);
    expect(tab('Projects')).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByText('No saved projects yet.')).toBeVisible();
  });

  it('renders the instrument list when the Instruments tab is chosen', async () => {
    const user = setupUser();
    render(<BrowserPanel />);
    expect(screen.queryByRole('button', { name: new RegExp(PRESET) })).not.toBeInTheDocument();

    await user.click(tab('Instruments'));

    expect(tab('Instruments')).toHaveAttribute('aria-selected', 'true');
    expect(tab('Projects')).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByRole('button', { name: new RegExp(PRESET) })).toBeVisible();
    expect(screen.getByRole('button', { name: /Drum Rack/ })).toBeVisible();
    expect(useUiStore.getState().browserTab).toBe('instruments');
  });

  it('renders effects, not instruments, on the Effects tab', async () => {
    const user = setupUser();
    render(<BrowserPanel />);

    await user.click(tab('Effects'));

    expect(screen.getByRole('button', { name: /Vocal Bus/ })).toBeVisible();
    expect(screen.queryByRole('button', { name: new RegExp(PRESET) })).not.toBeInTheDocument();
  });
});

describe('BrowserPanel search', () => {
  it('filters the visible rows and restores them when cleared', async () => {
    const user = setupUser();
    render(<BrowserPanel />);
    await user.click(tab('Instruments'));
    const search = screen.getByLabelText('Search the browser');

    await user.type(search, PRESET);

    expect(screen.getByRole('button', { name: new RegExp(PRESET) })).toBeVisible();
    for (const other of SYNTH_PRESETS.slice(1)) {
      expect(
        screen.queryByRole('button', { name: new RegExp(other.presetName) }),
      ).not.toBeInTheDocument();
    }

    await user.click(screen.getByRole('button', { name: 'Clear search' }));

    expect(search).toHaveValue('');
    expect(
      screen.getByRole('button', { name: new RegExp(SYNTH_PRESETS[1].presetName) }),
    ).toBeVisible();
  });

  it('matches without regard to case', async () => {
    const user = setupUser();
    render(<BrowserPanel />);
    await user.click(tab('Instruments'));

    await user.type(screen.getByLabelText('Search the browser'), PRESET.toUpperCase());

    expect(screen.getByRole('button', { name: new RegExp(PRESET) })).toBeVisible();
  });

  it('says so when a search matches nothing', async () => {
    const user = setupUser();
    render(<BrowserPanel />);
    await screen.findByText('No saved projects yet.');

    await user.type(screen.getByLabelText('Search the browser'), 'nothing called this');

    expect(screen.queryByRole('button', { name: new RegExp(PRESET) })).not.toBeInTheDocument();
  });
});

describe('BrowserPanel instrument rows', () => {
  it('creates and selects a track when nothing is selected', async () => {
    const user = setupUser();
    useProjectStore.getState().setProject(createEmptyProject('Test'), { markClean: true });
    useUiStore.getState().selectTrack(null);
    const before = useProjectStore.getState().project.tracks.length;
    render(<BrowserPanel />);
    await user.click(tab('Instruments'));

    await user.click(screen.getByRole('button', { name: new RegExp(PRESET) }));

    const tracks = useProjectStore.getState().project.tracks;
    expect(tracks).toHaveLength(before + 1);
    const added = tracks[tracks.length - 1];
    expect(added.type).toBe('instrument');
    expect(added.name).toBe(PRESET);
    expect(useUiStore.getState().selectedTrackId).toBe(added.id);
  });

  it('loads the preset onto the selected instrument track instead of adding one', async () => {
    const user = setupUser();
    useProjectStore.getState().setProject(createEmptyProject('Test'), { markClean: true });
    const target = useProjectStore.getState().project.tracks[0];
    useUiStore.getState().selectTrack(target.id);
    const before = useProjectStore.getState().project.tracks.length;
    render(<BrowserPanel />);
    await user.click(tab('Instruments'));

    const row = screen.getByRole('button', { name: new RegExp(PRESET) });
    expect(within(row).getByText(`Click to load onto ${target.name}`)).toBeVisible();
    await user.click(row);

    expect(useProjectStore.getState().project.tracks).toHaveLength(before);
    expect(useProjectStore.getState().project.tracks[0].synth?.presetName).toBe(PRESET);
  });

  it('refuses a note effect when no instrument track is selected', async () => {
    const user = setupUser();
    useUiStore.getState().selectTrack(null);
    render(<BrowserPanel />);
    await user.click(tab('Instruments'));

    await user.click(screen.getAllByRole('button', { name: /Arpeggiator/ })[0]);

    expect(useUiStore.getState().toasts.map((t) => t.message)).toContain(
      'Select an instrument track first.',
    );
  });
});
