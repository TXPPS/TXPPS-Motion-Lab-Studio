import { act, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { engineStub, setupUser } from '../setup.tsx';

vi.mock('../../src/audio/engine', async () => ({
  engine: (await import('../setup.tsx')).engineStub,
}));

const { ChannelStrip } = await import('../../src/components/mixer/ChannelStrip');
const { useProjectStore } = await import('../../src/state/projectStore');
const { resolveChannels } = await import('../../src/model/mixerGraph');
const { formatDb } = await import('../../src/model/music');

/** The wiring the Mixer does around one strip, so the strip sees live props. */
function StripHost({ trackId }: { trackId: string }) {
  const project = useProjectStore((s) => s.project);
  const track = project.tracks.find((t) => t.id === trackId);
  if (!track) throw new Error(`no track ${trackId}`);
  const buses = project.tracks.filter((t) => t.type === 'bus');
  const sendTargets = project.tracks.filter((t) => t.type === 'bus' || t.type === 'fx');
  return (
    <ChannelStrip
      track={track}
      outputName="Master"
      buses={buses}
      sendTargets={sendTargets}
      vcas={project.tracks.filter((t) => t.type === 'vca')}
      state={resolveChannels(project).get(trackId)}
    />
  );
}

function firstTrack() {
  return useProjectStore.getState().project.tracks[0];
}

function trackNow(id: string) {
  const track = useProjectStore.getState().project.tracks.find((t) => t.id === id);
  if (!track) throw new Error(`no track ${id}`);
  return track;
}

describe('ChannelStrip mute, solo and arm', () => {
  it('writes mute to the store and reports it on the button', async () => {
    const user = setupUser();
    const track = firstTrack();
    render(<StripHost trackId={track.id} />);
    const mute = screen.getByRole('button', { name: `Mute ${track.name}` });
    expect(mute).toHaveAttribute('aria-pressed', 'false');

    await user.click(mute);

    expect(trackNow(track.id).mute).toBe(true);
    expect(mute).toHaveAttribute('aria-pressed', 'true');

    await user.click(mute);
    expect(trackNow(track.id).mute).toBe(false);
  });

  it('writes solo to the store', async () => {
    const user = setupUser();
    const track = firstTrack();
    render(<StripHost trackId={track.id} />);

    await user.click(screen.getByRole('button', { name: `Solo ${track.name}` }));

    expect(trackNow(track.id).solo).toBe(true);
    expect(screen.getByRole('button', { name: `Solo ${track.name}` })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('arms a recordable track', async () => {
    const user = setupUser();
    const track = firstTrack();
    render(<StripHost trackId={track.id} />);

    await user.click(screen.getByRole('button', { name: `Record arm ${track.name}` }));

    expect(trackNow(track.id).armed).toBe(true);
  });

  it('offers no record arm on a bus', () => {
    const bus = useProjectStore.getState().project.tracks.find((t) => t.type === 'bus');
    if (!bus) throw new Error('the demo project has no bus');
    render(<StripHost trackId={bus.id} />);

    expect(
      screen.queryByRole('button', { name: `Record arm ${bus.name}` }),
    ).not.toBeInTheDocument();
  });

  it('takes solo-safe from a right-click on solo, not a left-click', async () => {
    const user = setupUser();
    const track = firstTrack();
    render(<StripHost trackId={track.id} />);
    const solo = screen.getByRole('button', { name: `Solo ${track.name}` });

    await user.click(solo);
    expect(trackNow(track.id).soloSafe).toBeFalsy();

    await user.pointer({ target: solo, keys: '[MouseRight]' });

    expect(trackNow(track.id).soloSafe).toBe(true);
    expect(solo).toHaveTextContent('S!');
  });
});

describe('ChannelStrip audibility', () => {
  it('says why a channel is silent while another track is soloed', () => {
    const [track, other] = useProjectStore.getState().project.tracks;
    render(<StripHost trackId={track.id} />);
    const mute = screen.getByRole('button', { name: `Mute ${track.name}` });
    expect(mute).toHaveAttribute('title', 'Mute');

    act(() => useProjectStore.getState().setTrack(other.id, { solo: true }));

    expect(mute).toHaveAttribute('title', expect.stringMatching(/silenced by another track/));
    expect(
      screen.getByTitle(new RegExp(`${track.name} — silenced by another track`)),
    ).toBeVisible();
  });

  it('leaves a solo-safe channel audible while another track is soloed', () => {
    const [track, other] = useProjectStore.getState().project.tracks;
    act(() => useProjectStore.getState().setTrack(track.id, { soloSafe: true }));
    render(<StripHost trackId={track.id} />);

    act(() => useProjectStore.getState().setTrack(other.id, { solo: true }));

    expect(screen.getByRole('button', { name: `Mute ${track.name}` })).toHaveAttribute(
      'title',
      'Mute',
    );
  });
});

describe('ChannelStrip fader', () => {
  it('moves the dB readout with the fader', async () => {
    const user = setupUser();
    const track = firstTrack();
    const { container } = render(<StripHost trackId={track.id} />);
    const readout = container.querySelector('.rd-db');
    if (!readout) throw new Error('no dB readout');
    expect(readout).toHaveTextContent(formatDb(track.volume));

    const fader = screen.getByRole('slider', { name: `${track.name} volume` });
    fader.focus();
    await user.keyboard('{ArrowUp}');

    const raised = trackNow(track.id).volume;
    expect(raised).toBeGreaterThan(track.volume);
    expect(readout).toHaveTextContent(formatDb(raised));
    expect(fader).toHaveAttribute('aria-valuetext', `${formatDb(raised)} decibels`);

    await user.keyboard('{ArrowDown}{ArrowDown}');
    const lowered = trackNow(track.id).volume;
    expect(lowered).toBeLessThan(raised);
    expect(readout).toHaveTextContent(formatDb(lowered));
  });

  it('brackets a fader drag in one undo gesture', async () => {
    const user = setupUser();
    const track = firstTrack();
    render(<StripHost trackId={track.id} />);
    const fader = screen.getByRole('slider', { name: `${track.name} volume` });

    await user.pointer([
      { keys: '[MouseLeft>]', target: fader, coords: { x: 8, y: 100 } },
      { target: fader, coords: { x: 8, y: 60 } },
    ]);
    // A drag is one edit to undo, not one per pixel: the gesture stays open
    // until the pointer is released.
    expect(useProjectStore.getState().gestureDepth).toBe(1);
    expect(trackNow(track.id).volume).toBeGreaterThan(track.volume);

    await user.pointer({ keys: '[/MouseLeft]', target: fader, coords: { x: 8, y: 60 } });

    expect(useProjectStore.getState().gestureDepth).toBe(0);
  });
});

describe('ChannelStrip metering', () => {
  it('registers interest in its channel and releases it on unmount', () => {
    const track = firstTrack();
    const { unmount } = render(<StripHost trackId={track.id} />);

    const mine = engineStub.meterWatches.filter((w) => w.id === track.id);
    expect(mine.length).toBeGreaterThan(0);
    expect(engineStub.watchMeter).toHaveBeenCalledWith(track.id);
    for (const watch of mine) expect(watch.release).not.toHaveBeenCalled();

    unmount();

    for (const watch of mine) expect(watch.release).toHaveBeenCalledTimes(1);
  });

  it('stops reading the engine once the strip is gone', () => {
    const track = firstTrack();
    const { unmount } = render(<StripHost trackId={track.id} />);
    act(() => engineStub.frame());
    expect(engineStub.getMeter).toHaveBeenCalled();

    unmount();
    engineStub.getMeter.mockClear();
    act(() => engineStub.frame());

    expect(engineStub.getMeter).not.toHaveBeenCalled();
  });
});

describe('ChannelStrip routing — an output is a destination, a send is an amount', () => {
  /*
   * Item 14, on the console. `Mixer.tsx` built `[...buses, ...fxChannels]` and
   * passed it as `buses`, where it filled the output select — so the desk has
   * offered an FX return as an output destination for as long as the `fx` type
   * has existed, which erases the one distinction the type was created to make.
   * Phase A fixed the Channel view and recorded that this was still open;
   * phase B rewrites this strip, so it is fixed here rather than edited around.
   */
  it('offers buses as outputs and not FX returns', () => {
    const store = useProjectStore.getState();
    const busId = store.addTrack('bus');
    store.setTrack(busId, { name: 'Drum Bus' });
    const fxId = store.addTrack('fx');
    store.setTrack(fxId, { name: 'Plate' });

    const track = firstTrack();
    render(<StripHost trackId={track.id} />);
    const select = screen.getByRole('combobox', { name: `${track.name} output` });
    const values = [...select.querySelectorAll('option')].map((o) => o.getAttribute('value'));

    expect(values).toContain(busId);
    expect(values).not.toContain(fxId);
  });

  it('keeps an FX return a channel is already routed to', () => {
    // Never silently re-route: a select that cannot represent its own value
    // rewrites somebody's mix on first render.
    const store = useProjectStore.getState();
    store.addTrack('bus');
    const fxId = store.addTrack('fx');
    store.setTrack(fxId, { name: 'Plate' });
    const track = firstTrack();
    act(() => useProjectStore.getState().setTrack(track.id, { output: fxId }));

    render(<StripHost trackId={track.id} />);
    const select = screen.getByRole('combobox', { name: `${track.name} output` });

    expect((select as HTMLSelectElement).value).toBe(fxId);
    expect(select.textContent).toContain('Plate (FX return)');
  });

  it('still names an FX return a send goes to', () => {
    // The merged list was not wrong for everything: a send row has to be able
    // to name an FX return, which is why the two lists both exist rather than
    // one of them being deleted.
    const store = useProjectStore.getState();
    const fxId = store.addTrack('fx');
    store.setTrack(fxId, { name: 'Plate' });
    const track = firstTrack();
    act(() =>
      useProjectStore.getState().setTrack(track.id, {
        sends: [{ busId: fxId, amount: 0.5, enabled: true, preFader: false }],
      }),
    );

    render(<StripHost trackId={track.id} />);

    expect(screen.getByText('Plate')).toBeVisible();
  });

  it('and the console wires it that way, not only the strip', async () => {
    /*
     * The defect was in `Mixer.tsx`, not in the strip: it built one merged list
     * and passed it as `buses`. `StripHost` above hands the strip two correct
     * lists, so every case in this describe would pass with the console still
     * wired wrongly. This one renders the real console.
     */
    const { Mixer } = await import('../../src/components/mixer/Mixer');
    const store = useProjectStore.getState();
    const busId = store.addTrack('bus');
    store.setTrack(busId, { name: 'Drum Bus' });
    const fxId = store.addTrack('fx');
    store.setTrack(fxId, { name: 'Plate' });
    const track = firstTrack();

    render(<Mixer />);
    const select = screen.getByRole('combobox', { name: `${track.name} output` });
    const values = [...select.querySelectorAll('option')].map((o) => o.getAttribute('value'));

    expect(values).toContain(busId);
    expect(values).not.toContain(fxId);
  });
});
