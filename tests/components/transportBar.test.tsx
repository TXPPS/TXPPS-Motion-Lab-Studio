import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { engineStub, setupUser } from '../setup.tsx';

vi.mock('../../src/audio/engine', async () => ({
  engine: (await import('../setup.tsx')).engineStub,
}));

const { TransportBar } = await import('../../src/components/transport/TransportBar');
const { useProjectStore } = await import('../../src/state/projectStore');
const { useTransportStore } = await import('../../src/state/transportStore');

describe('TransportBar transport buttons', () => {
  it('drives the engine from play, stop and return-to-start', async () => {
    const user = setupUser();
    render(<TransportBar />);

    await user.click(screen.getByRole('button', { name: 'Play' }));
    expect(engineStub.play).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Stop' }));
    expect(engineStub.stop).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Return to start' }));
    expect(engineStub.returnToStart).toHaveBeenCalledTimes(1);
  });

  it('shows the play button as pressed only while the transport is playing', () => {
    render(<TransportBar />);
    const play = screen.getByRole('button', { name: 'Play' });
    expect(play).toHaveAttribute('aria-pressed', 'false');

    act(() => useTransportStore.getState().set({ playState: 'playing' }));
    expect(play).toHaveAttribute('aria-pressed', 'true');

    act(() => useTransportStore.getState().set({ playState: 'stopped' }));
    expect(play).toHaveAttribute('aria-pressed', 'false');
  });

  it('moves the playhead a bar at a time', async () => {
    const user = setupUser();
    engineStub.positionBeats = 0;
    render(<TransportBar />);

    await user.click(screen.getByRole('button', { name: 'Forward one bar' }));
    expect(engineStub.seek).toHaveBeenLastCalledWith(4);

    engineStub.positionBeats = 8;
    await user.click(screen.getByRole('button', { name: 'Back one bar' }));
    expect(engineStub.seek).toHaveBeenLastCalledWith(4);
  });
});

describe('TransportBar position readout', () => {
  it('renders the engine position as bars, beats and ticks', () => {
    engineStub.positionBeats = 5.5;
    render(<TransportBar />);
    // 4/4: beat 5.5 is bar 2, beat 2, half way to the next beat.
    expect(screen.getByRole('button', { name: /Bars · Beats/ })).toHaveTextContent('2.2.480');
  });

  it('follows the engine on each frame without re-rendering the bar', () => {
    engineStub.positionBeats = 0;
    render(<TransportBar />);
    const readout = screen.getByRole('button', { name: /Bars · Beats/ });
    expect(readout).toHaveTextContent('1.1.000');

    engineStub.positionBeats = 12;
    act(() => engineStub.frame());
    expect(readout).toHaveTextContent('4.1.000');
  });

  it('seeks to a position typed into the readout', async () => {
    const user = setupUser();
    render(<TransportBar />);

    await user.click(screen.getByRole('button', { name: /Bars · Beats/ }));
    const input = screen.getByLabelText('Position in bars, beats and ticks');
    await user.clear(input);
    await user.type(input, '5.1.000{Enter}');

    // Bar 5 of a 4/4 project is beat 16.
    expect(engineStub.seek).toHaveBeenCalledWith(16);
    expect(screen.queryByLabelText('Position in bars, beats and ticks')).not.toBeInTheDocument();
  });

  it('leaves the position alone when the typed value is not a position', async () => {
    const user = setupUser();
    render(<TransportBar />);

    await user.click(screen.getByRole('button', { name: /Bars · Beats/ }));
    const input = screen.getByLabelText('Position in bars, beats and ticks');
    await user.clear(input);
    await user.type(input, 'nowhere{Enter}');

    expect(engineStub.seek).not.toHaveBeenCalled();
  });
});

describe('TransportBar tempo', () => {
  it('sets the tempo from the interval between taps', async () => {
    const user = setupUser();
    let clock = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => clock);
    render(<TransportBar />);

    const tap = screen.getByRole('button', { name: 'TAP' });
    for (const at of [0, 400, 800, 1200]) {
      clock = at;
      await user.click(tap);
    }

    // Four taps 400 ms apart is 150 BPM.
    expect(useProjectStore.getState().project.bpm).toBe(150);
    expect(screen.getByLabelText('Tempo in beats per minute')).toHaveValue(150);
  });

  it('starts a new count rather than averaging in a tap from a minute ago', async () => {
    const user = setupUser();
    let clock = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => clock);
    const before = useProjectStore.getState().project.bpm;
    render(<TransportBar />);

    const tap = screen.getByRole('button', { name: 'TAP' });
    await user.click(tap);
    clock = 60_000;
    await user.click(tap);

    // Two taps a minute apart would be 1 BPM; the gap resets the count instead.
    expect(useProjectStore.getState().project.bpm).toBe(before);
  });

  it('writes an edited tempo to the project', () => {
    render(<TransportBar />);
    const bpm = screen.getByLabelText('Tempo in beats per minute');

    fireEvent.change(bpm, { target: { value: '128' } });

    expect(useProjectStore.getState().project.bpm).toBe(128);
    expect(bpm).toHaveValue(128);
  });

  it('keeps the tempo out of the store when the field is emptied', () => {
    render(<TransportBar />);
    const bpm = screen.getByLabelText('Tempo in beats per minute');
    const before = useProjectStore.getState().project.bpm;

    fireEvent.change(bpm, { target: { value: '' } });

    expect(useProjectStore.getState().project.bpm).toBe(before);
  });
});

describe('TransportBar count-in', () => {
  it('badges the metronome with the project count-in', () => {
    act(() =>
      useProjectStore.getState().update((d) => {
        d.countIn = 3;
      }),
    );
    render(<TransportBar />);
    expect(screen.getByRole('button', { name: 'Metronome' })).toHaveTextContent('3');
  });

  it('drops the badge when the project has no count-in', () => {
    act(() =>
      useProjectStore.getState().update((d) => {
        d.countIn = 0;
      }),
    );
    render(<TransportBar />);
    expect(screen.getByRole('button', { name: 'Metronome' }).textContent).toBe('');
  });

  it('cycles the count-in on a right-click and shows the new value', async () => {
    const user = setupUser();
    act(() =>
      useProjectStore.getState().update((d) => {
        d.countIn = 1;
      }),
    );
    render(<TransportBar />);
    const metronome = screen.getByRole('button', { name: 'Metronome' });

    await user.pointer({ target: metronome, keys: '[MouseRight]' });

    expect(useProjectStore.getState().project.countIn).toBe(2);
    expect(metronome).toHaveTextContent('2');
  });

  it('toggles the metronome itself on a plain click', async () => {
    const user = setupUser();
    const before = useProjectStore.getState().project.metronome;
    render(<TransportBar />);

    await user.click(screen.getByRole('button', { name: 'Metronome' }));

    expect(useProjectStore.getState().project.metronome).toBe(!before);
  });
});
