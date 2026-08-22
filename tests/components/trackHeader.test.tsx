import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { setupUser } from '../setup.tsx';

vi.mock('../../src/audio/engine', async () => ({
  engine: (await import('../setup.tsx')).engineStub,
}));

const freezeTrack = vi.fn((_trackId: string) => Promise.resolve(true));
const unfreezeTrack = vi.fn((_trackId: string) => {});
vi.mock('../../src/audio/freeze', () => ({
  freezeTrack: (id: string) => freezeTrack(id),
  unfreezeTrack: (id: string) => unfreezeTrack(id),
}));

const { TrackHeader } = await import('../../src/components/arrangement/TrackHeader');
const { ContextMenuHost, DialogHost } = await import('../../src/components/common/overlays');
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
      <ContextMenuHost />
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

/** A fresh track of a given type, for the cases that need one they own. */
function makeTrack(type: 'audio' | 'instrument'): string {
  return useProjectStore.getState().addTrack(type);
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

describe('TrackHeader freeze', () => {
  /** The instrument track the demo project opens with. */
  function instrument() {
    return useProjectStore.getState().project.tracks.find((t) => t.type === 'instrument')!;
  }

  it('offers freezing from the track menu', async () => {
    const user = setupUser();
    const track = instrument();
    render(<HeaderHost trackId={track.id} />);

    await user.click(screen.getByTestId(`track-menu-${track.name}`));
    await user.click(screen.getByTestId(`freeze-menu-${track.name}`));

    expect(freezeTrack).toHaveBeenCalledWith(track.id);
  });

  it('marks a frozen track, and offers the way back', async () => {
    const user = setupUser();
    const track = instrument();
    useProjectStore.getState().setTrack(track.id, {
      freeze: { mediaId: 'freeze-1', renderedAt: 1 },
    });
    render(<HeaderHost trackId={track.id} />);

    // Visible without opening anything, and named for a screen reader.
    expect(screen.getByTestId(`frozen-${track.name}`)).toBeInTheDocument();
    expect(screen.getByRole('group', { name: new RegExp(`${track.name}.*frozen`) })).toBeVisible();

    await user.click(screen.getByTestId(`track-menu-${track.name}`));
    await user.click(screen.getByTestId(`freeze-menu-${track.name}`));
    expect(unfreezeTrack).toHaveBeenCalledWith(track.id);
  });

  it('says nothing about freezing on a track that has no instrument', async () => {
    const user = setupUser();
    const audio = useProjectStore.getState().project.tracks.find((t) => t.type === 'audio')!;
    render(<HeaderHost trackId={audio.id} />);

    await user.click(screen.getByTestId(`track-menu-${audio.name}`));
    expect(screen.queryByTestId(`freeze-menu-${audio.name}`)).toBeNull();
  });
});

/**
 * Directive 02 §1 — BUG-001 and BUG-002.
 *
 * The report said the `M` button was doing monitoring. It was not: it was, and
 * is, mute, correctly wired to the engine. What was true is that mute lit
 * **blue**, which is the colour monitoring owns in every DAW the user has met —
 * so a lit M read as "listening". These pin the corrected taxonomy so it cannot
 * drift back.
 */
describe('the track header control strip', () => {
  const trackOf = (id: string) => trackNow(id);

  it('binds M to mute and drives the stored state, not just the button', () => {
    const id = makeTrack('audio');
    render(<HeaderHost trackId={id} />);
    const mute = screen.getByTestId(`mute-${trackOf(id).name}`);
    expect(mute.textContent).toBe('M');
    expect(trackOf(id).mute).toBe(false);
    fireEvent.click(mute);
    expect(trackOf(id).mute).toBe(true);
    expect(mute).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(mute);
    expect(trackOf(id).mute).toBe(false);
  });

  it('gives an audio track a monitor control that is not the mute button', () => {
    const id = makeTrack('audio');
    render(<HeaderHost trackId={id} />);
    const monitor = screen.getByTestId(`monitor-${trackOf(id).name}`);
    // Distinct elements with distinct jobs. The whole of BUG-002 was that a
    // user could not tell these apart, because one of them was blue.
    expect(monitor).not.toBe(screen.getByTestId(`mute-${trackOf(id).name}`));
    expect(monitor).toHaveAttribute('aria-pressed', 'false');
    expect(monitor.querySelector('svg')).not.toBeNull(); // a loudspeaker, not a letter
  });

  it('offers no monitor control on a track that has no input', () => {
    const id = makeTrack('instrument');
    render(<HeaderHost trackId={id} />);
    expect(screen.queryByTestId(`monitor-${trackOf(id).name}`)).toBeNull();
  });

  it('shows solo and arm as their own controls', () => {
    const id = makeTrack('audio');
    render(<HeaderHost trackId={id} />);
    const name = trackOf(id).name;
    fireEvent.click(screen.getByTestId(`solo-${name}`));
    expect(trackOf(id).solo).toBe(true);
    fireEvent.click(screen.getByTestId(`arm-${name}`));
    expect(trackOf(id).armed).toBe(true);
  });

  it('marks a track silenced by another track solo without claiming it is muted', () => {
    // Pressing M on a track that is already inaudible would mute it *as well*,
    // and the user would then have two things to undo. The hatching says the
    // track is silent; `aria-pressed` still says the mute is off, because it is.
    const id = makeTrack('audio');
    const track = trackOf(id);
    render(
      <>
        <TrackHeader track={track} height={80} silencedBySolo />
        <DialogHost />
        <ContextMenuHost />
      </>,
    );
    const mute = screen.getByTestId(`mute-${track.name}`);
    expect(mute.className).toContain('m-implicit');
    expect(mute.className).not.toContain('m-on');
    expect(mute).toHaveAttribute('aria-pressed', 'false');
  });

  it('keeps every control the strip drops reachable from the menu', () => {
    // §1 forbids a collapsed control disappearing silently. The strip sheds the
    // fader, the pan knob and the automation button on a touch layout.
    const id = makeTrack('audio');
    render(<HeaderHost trackId={id} />);
    fireEvent.click(screen.getByTestId(`track-menu-${trackOf(id).name}`));
    const labels = screen.getAllByRole('menuitem').map((el) => el.textContent ?? '');
    for (const wanted of ['Mute', 'Solo', 'Monitor input', 'Level and pan…']) {
      expect(labels.some((l) => l.includes(wanted))).toBe(true);
    }
  });
});
