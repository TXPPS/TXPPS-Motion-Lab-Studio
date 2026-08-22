import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { setupUser } from '../setup.tsx';

vi.mock('../../src/audio/engine', async () => ({
  engine: (await import('../setup.tsx')).engineStub,
}));

const { TrackHeader } = await import('../../src/components/arrangement/TrackHeader');
const { DialogHost } = await import('../../src/components/common/overlays');
const { useProjectStore } = await import('../../src/state/projectStore');
const { useUiStore } = await import('../../src/state/uiStore');

/** The header as the arrangement mounts it, with the dialog host it opens. */
function HeaderHost({ trackId }: { trackId: string }) {
  const track = useProjectStore((s) => s.project.tracks.find((t) => t.id === trackId));
  if (!track) throw new Error('no track');
  return (
    <>
      <TrackHeader track={track} height={80} />
      <DialogHost />
    </>
  );
}

function trackNow(id: string) {
  const track = useProjectStore.getState().project.tracks.find((t) => t.id === id);
  if (!track) throw new Error(`no track ${id}`);
  return track;
}

function firstTrack() {
  return useProjectStore.getState().project.tracks[0];
}

describe('TrackHeader rename', () => {
  it('renames the track from the dialog a double-click opens', async () => {
    const user = setupUser();
    const track = firstTrack();
    render(<HeaderHost trackId={track.id} />);

    await user.dblClick(screen.getByText(track.name));

    const dialog = screen.getByRole('dialog', { name: 'Rename track' });
    const input = within(dialog).getByRole('textbox');
    expect(input).toHaveValue(track.name);

    await user.clear(input);
    await user.type(input, 'Snare Bus');
    await user.click(within(dialog).getByRole('button', { name: 'Rename' }));

    expect(trackNow(track.id).name).toBe('Snare Bus');
    expect(screen.getByText('Snare Bus')).toBeVisible();
  });

  it('leaves the name alone when the rename is cancelled', async () => {
    const user = setupUser();
    const track = firstTrack();
    render(<HeaderHost trackId={track.id} />);

    await user.dblClick(screen.getByText(track.name));
    const input = within(screen.getByRole('dialog', { name: 'Rename track' })).getByRole('textbox');
    await user.clear(input);
    await user.type(input, 'Discarded');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(trackNow(track.id).name).toBe(track.name);
  });
});

describe('TrackHeader mute and solo', () => {
  it('writes mute and solo to the store', async () => {
    const user = setupUser();
    const track = firstTrack();
    render(<HeaderHost trackId={track.id} />);
    const mute = screen.getByTitle('Mute');
    const solo = screen.getByTitle('Solo');

    await user.click(mute);
    expect(trackNow(track.id).mute).toBe(true);
    expect(mute).toHaveAttribute('aria-pressed', 'true');

    await user.click(solo);
    expect(trackNow(track.id).solo).toBe(true);
    expect(solo).toHaveAttribute('aria-pressed', 'true');

    await user.click(mute);
    expect(trackNow(track.id).mute).toBe(false);
  });

  it('does not select-and-toggle: the controls do not fall through to the header', async () => {
    const user = setupUser();
    const track = firstTrack();
    useUiStore.getState().selectTrack(null);
    render(<HeaderHost trackId={track.id} />);

    await user.click(screen.getByTitle('Mute'));

    // The controls row stops the click, so muting does not also select.
    expect(useUiStore.getState().selectedTrackId).toBeNull();
  });

  it('moves the volume slider into the store', () => {
    const track = firstTrack();
    render(<HeaderHost trackId={track.id} />);

    const volume = screen.getByLabelText(`${track.name} volume`);
    fireEvent.change(volume, { target: { value: '0.4' } });

    expect(trackNow(track.id).volume).toBeCloseTo(0.4, 5);
    expect(volume).toHaveValue('0.4');
  });
});

describe('TrackHeader folders', () => {
  it('folds and unfolds a folder track', async () => {
    const user = setupUser();
    const folderId = useProjectStore.getState().addTrack('folder');
    const folder = trackNow(folderId);
    render(<HeaderHost trackId={folderId} />);

    const fold = screen.getByRole('button', { name: `Fold ${folder.name}` });
    expect(fold).toHaveAttribute('aria-expanded', 'true');

    await user.click(fold);

    expect(trackNow(folderId).folded).toBe(true);
    const unfold = screen.getByRole('button', { name: `Unfold ${folder.name}` });
    expect(unfold).toHaveAttribute('aria-expanded', 'false');

    await user.click(unfold);
    expect(trackNow(folderId).folded).toBe(false);
  });

  it('shows no fold control on a plain track', () => {
    const track = firstTrack();
    render(<HeaderHost trackId={track.id} />);

    expect(screen.queryByRole('button', { name: `Fold ${track.name}` })).not.toBeInTheDocument();
  });
});

describe('TrackHeader automation', () => {
  it('writes the chosen mode while the lanes are open', async () => {
    const user = setupUser();
    const track = firstTrack();
    // Adding a lane opens the lanes, which is where the mode picker lives.
    useProjectStore.getState().addAutomationLane(track.id, 'volume');
    render(<HeaderHost trackId={track.id} />);

    const picker = screen.getByLabelText(`${track.name} automation mode`);
    expect(picker).toHaveValue('read');

    await user.selectOptions(picker, 'latch');

    expect(trackNow(track.id).automationMode).toBe('latch');
    expect(picker).toHaveValue('latch');
  });

  it('hides the mode picker with the lanes', async () => {
    const user = setupUser();
    const track = firstTrack();
    useProjectStore.getState().addAutomationLane(track.id, 'volume');
    render(<HeaderHost trackId={track.id} />);

    await user.click(screen.getByRole('button', { name: 'A' }));

    expect(trackNow(track.id).automationOpen).toBe(false);
    expect(screen.queryByLabelText(`${track.name} automation mode`)).not.toBeInTheDocument();
  });

  it('opens the add-lane menu when the track has no lanes yet', async () => {
    const user = setupUser();
    const track = firstTrack();
    render(<HeaderHost trackId={track.id} />);

    await user.click(screen.getByRole('button', { name: 'A' }));

    expect(trackNow(track.id).automationOpen).toBeFalsy();
    const menu = useUiStore.getState().contextMenu;
    expect(menu?.items.map((i) => i.label)).toContain('Volume');
  });
});
