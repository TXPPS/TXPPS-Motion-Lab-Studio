import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { setupUser } from '../setup.tsx';

vi.mock('../../src/audio/engine', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/audio/engine')>()),
  engine: (await import('../setup.tsx')).engineStub,
}));

const freezeTrack = vi.fn((_trackId: string) => Promise.resolve(true));
const unfreezeTrack = vi.fn((_trackId: string) => {});
vi.mock('../../src/audio/freeze', () => ({
  freezeTrack: (id: string) => freezeTrack(id),
  unfreezeTrack: (id: string) => unfreezeTrack(id),
}));

const { Inspector } = await import('../../src/components/inspector/Inspector');
const { useProjectStore } = await import('../../src/state/projectStore');
const { useUiStore } = await import('../../src/state/uiStore');
const { createEmptyProject } = await import('../../src/model/demoProject');
const { newId } = await import('../../src/model/ids');
import type { MidiClip, ProjectData } from '../../src/model/types';

/** A one-instrument song, selected, optionally with notes and a print. */
function show(opts: { notes?: boolean; frozen?: boolean; audio?: boolean } = {}) {
  const p: ProjectData = createEmptyProject('Inspector');
  const track = p.tracks[0];
  if (opts.audio) track.type = 'audio';
  if (opts.notes !== false) {
    const clip: MidiClip = {
      id: newId('c'),
      trackId: track.id,
      type: 'midi',
      name: 'Part',
      start: 0,
      length: 4,
      muted: false,
      notes: [{ id: 'n1', start: 0, length: 1, pitch: 60, velocity: 100 }],
    };
    p.clips = [clip];
  }
  if (opts.frozen) {
    track.freeze = { mediaId: 'freeze-1', renderedAt: Date.parse('2026-01-02T03:04:05Z') };
    p.media = [
      {
        id: 'freeze-1',
        name: 'print',
        kind: 'freeze',
        duration: 2,
        sampleRate: 48000,
        channels: 2,
        byteSize: 10,
        createdAt: 1,
        source: 'freeze',
        peaksVersion: 0,
      },
    ];
  }
  useProjectStore.getState().setProject(p, { markClean: true });
  useUiStore.getState().selectTrack(track.id);
  render(<Inspector />);
  return track.id;
}

describe('the MIDI input channel', () => {
  it('offers omni and the sixteen channels, and starts at omni', () => {
    show();
    const select = screen.getByLabelText('MIDI input channel for Synth 1') as HTMLSelectElement;
    expect(select.value).toBe('0');
    expect(select.options).toHaveLength(17);
  });

  it('writes the choice to the track', async () => {
    const user = setupUser();
    const id = show();
    await user.selectOptions(screen.getByLabelText('MIDI input channel for Synth 1'), '10');
    expect(useProjectStore.getState().project.tracks.find((t) => t.id === id)?.midiChannel).toBe(
      10,
    );
  });

  it('is not offered on an audio track, which has no instrument to play', () => {
    show({ audio: true });
    expect(screen.queryByTestId('midi-channel')).toBeNull();
  });
});

describe('the freeze panel', () => {
  it('freezes the track, and says what freezing means', async () => {
    const user = setupUser();
    const id = show();
    expect(screen.getByTestId('freeze-state')).toHaveTextContent('Playing live');
    await user.click(screen.getByRole('button', { name: 'Freeze Synth 1' }));
    expect(freezeTrack).toHaveBeenCalledWith(id);
  });

  it('shows the frozen state and offers the way back', async () => {
    const user = setupUser();
    const id = show({ frozen: true });
    expect(screen.getByTestId('freeze-state')).toHaveTextContent('Frozen');
    // The panel has to say that the instrument is not running and that an edit
    // gives it back — a freeze nobody understands is a bug report.
    expect(screen.getByTestId('unfreeze-track')).toBeInTheDocument();
    expect(screen.getByText(/instrument is not running/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Unfreeze Synth 1' }));
    expect(unfreezeTrack).toHaveBeenCalledWith(id);
  });

  it('refuses a track with nothing to print, and says why', () => {
    show({ notes: false });
    const button = screen.getByTestId('freeze-track');
    expect(button).toBeDisabled();
    expect(screen.getByText(/no clips to render/i)).toBeInTheDocument();
  });

  it('is not offered on an audio track', () => {
    show({ audio: true });
    expect(screen.queryByTestId('freeze-track')).toBeNull();
  });
});
