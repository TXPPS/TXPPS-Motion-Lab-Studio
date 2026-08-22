/**
 * The instrument faces, through the DOM.
 *
 * `tests/synthFace.test.ts` proves the numbers a face draws are the numbers the
 * voice engine assigns. This proves the other half: that the pictures reach the
 * screen, that every handle on them can be driven by a pointer *and* by the
 * keyboard, and that the two routes move the same parameter the same way.
 */
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { SynthPanel } from '../../src/components/synth/SynthPanel';
import { createEmptyProject } from '../../src/model/demoProject';
import { buildDrumKit, makeZone } from '../../src/model/sampler';
import type { SamplerParams } from '../../src/model/sampler';
import { synthVoiceFilter } from '../../src/model/synthFace';
import { useProjectStore } from '../../src/state/projectStore';
import { useUiStore } from '../../src/state/uiStore';
import { engineStub } from '../setup.tsx';

vi.mock('../../src/audio/engine', async () => ({
  engine: (await import('../setup.tsx')).engineStub,
}));

const project = () => useProjectStore.getState().project;
const trackOf = (id: string) => project().tracks.find((t) => t.id === id)!;

function setup(type: 'instrument' | 'drum' = 'instrument'): string {
  useProjectStore.getState().setProject(createEmptyProject('Face'), { markClean: true });
  const id = useProjectStore.getState().addTrack(type);
  useProjectStore.getState().setTrack(id, { name: 'Lead' });
  useUiStore.getState().selectTrack(id);
  return id;
}

/**
 * jsdom has no PointerEvent, and Testing Library's fallback drops every
 * property of one — including the coordinates the drag is about. A MouseEvent
 * under the pointer event's name carries them to the same listeners, which is
 * what `tests/components/warpLane.test.tsx` already relies on.
 */
function pointer(type: string, clientX: number, clientY: number): MouseEvent {
  return new MouseEvent(type, { bubbles: true, cancelable: true, clientX, clientY });
}

function drag(el: HTMLElement, dx: number, dy: number): void {
  fireEvent(el, pointer('pointerdown', 100, 100));
  fireEvent(window, pointer('pointermove', 100 + dx, 100 + dy));
  fireEvent(window, pointer('pointerup', 100 + dx, 100 + dy));
}

describe('MotionSynth', () => {
  it('draws the filter the voice builds, and says so in the accessible name', () => {
    const id = setup();
    useProjectStore.getState().setSynthParams(id, { cutoff: 1200, resonance: 6 });
    render(<SynthPanel />);

    const filter = synthVoiceFilter(trackOf(id).synth!);
    expect(filter.freqHz).toBe(1200);
    expect(screen.getByLabelText(/Filter response:/)).toHaveAccessibleName(
      /Low-pass at 1.2 kHz, resonance 6.0 dB/,
    );
  });

  it('drags the corner handle: sideways is cutoff, up is resonance', () => {
    const id = setup();
    useProjectStore.getState().setSynthParams(id, { cutoff: 1000, resonance: 4 });
    render(<SynthPanel />);

    drag(screen.getByTestId('syn-filter-handle'), 30, -20);
    const after = trackOf(id).synth!;
    expect(after.cutoff, 'right is up the frequency axis').toBeGreaterThan(1000);
    expect(after.resonance, 'up is more resonance').toBeGreaterThan(4);
  });

  it('gives the handle the same reach from the keyboard', () => {
    const id = setup();
    useProjectStore.getState().setSynthParams(id, { cutoff: 1000, resonance: 4 });
    render(<SynthPanel />);
    const handle = screen.getByTestId('syn-filter-handle');

    // A cutoff is a pitch, so one arrow is one semitone of it.
    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    expect(trackOf(id).synth!.cutoff).toBe(Math.round(1000 * Math.pow(2, 1 / 12)));
    fireEvent.keyDown(handle, { key: 'ArrowLeft' });
    expect(trackOf(id).synth!.cutoff).toBe(1000);

    fireEvent.keyDown(handle, { key: 'ArrowUp' });
    expect(trackOf(id).synth!.resonance).toBeCloseTo(4.5, 6);
    fireEvent.keyDown(handle, { key: 'ArrowDown', shiftKey: true });
    expect(trackOf(id).synth!.resonance).toBeCloseTo(4.4, 6);
  });

  it('keeps the corner inside the range the voice clamps to', () => {
    const id = setup();
    useProjectStore.getState().setSynthParams(id, { cutoff: 40, resonance: 0.05 });
    render(<SynthPanel />);
    const handle = screen.getByTestId('syn-filter-handle');
    fireEvent.keyDown(handle, { key: 'ArrowLeft' });
    fireEvent.keyDown(handle, { key: 'ArrowDown' });
    expect(trackOf(id).synth!.cutoff).toBe(40);
    expect(trackOf(id).synth!.resonance).toBe(0.05);
  });

  it('reports the envelope in real time units', () => {
    const id = setup();
    useProjectStore
      .getState()
      .setSynthParams(id, { attack: 0.012, decay: 0.35, sustain: 0.45, release: 0.5 });
    render(<SynthPanel />);
    expect(screen.getByLabelText(/Amplitude envelope:/)).toHaveAccessibleName(
      /attack 12 ms, decay 350 ms, sustain 45%, release 500 ms/,
    );
  });

  it('draws the oscillator the voice is set to, and switches with it', () => {
    const id = setup();
    render(<SynthPanel />);
    expect(screen.getByLabelText(/Oscillator waveform/)).toHaveAccessibleName(/sawtooth|triangle/);
    fireEvent.click(screen.getByTitle('Square'));
    expect(trackOf(id).synth!.waveform).toBe('square');
    expect(screen.getByLabelText(/Oscillator waveform/)).toHaveAccessibleName(/square/);
  });

  it('parks a patch in the other A/B slot and brings it back', () => {
    const id = setup();
    useProjectStore.getState().setSynthParams(id, { cutoff: 900 });
    render(<SynthPanel />);

    fireEvent.click(screen.getByTestId('ins-ab-b'));
    act(() => useProjectStore.getState().setSynthParams(id, { cutoff: 5000 }));
    fireEvent.click(screen.getByTestId('ins-ab-a'));
    expect(trackOf(id).synth!.cutoff).toBe(900);
    fireEvent.click(screen.getByTestId('ins-ab-b'));
    expect(trackOf(id).synth!.cutoff).toBe(5000);
  });

  it('mutes the channel from the header lamp', () => {
    const id = setup();
    render(<SynthPanel />);
    // Lit means passing, which is the one meaning green is allowed to have.
    const lamp = screen.getByLabelText('Lead output');
    expect(lamp).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(lamp);
    expect(trackOf(id).mute).toBe(true);
    expect(lamp).toHaveAttribute('aria-pressed', 'false');
  });

  it('shows a drum track only what its kit reads', () => {
    setup('drum');
    render(<SynthPanel />);
    // The drum instrument uses the level and nothing else, so a filter curve
    // and an envelope graph beside it would be four lies.
    expect(screen.queryByTestId('syn-filter')).toBeNull();
    expect(screen.queryByTestId('syn-env')).toBeNull();
    expect(screen.getByTestId('drum-pads')).toBeInTheDocument();
  });
});

describe('the classic drum kit', () => {
  const padsOf = () => within(screen.getByTestId('drum-pads')).getAllByRole('button');

  it('lays out one pad per hit, each naming its key', () => {
    setup('drum');
    render(<SynthPanel />);
    const pads = padsOf();
    expect(pads.map((p) => p.textContent)).toEqual([
      'KickC2',
      'SnareD2',
      'ClapD#2',
      'HatF#2',
      'Open HatA#2',
    ]);
  });

  it('strikes harder at the top of a pad than at the bottom', () => {
    setup('drum');
    render(<SynthPanel />);
    const pad = padsOf()[0];
    // jsdom lays nothing out, so the pad has to be given a box for the strike
    // position to mean anything.
    vi.spyOn(pad, 'getBoundingClientRect').mockReturnValue({
      top: 0,
      height: 100,
    } as DOMRect);

    fireEvent(pad, pointer('pointerdown', 0, 4));
    fireEvent(pad, pointer('pointerdown', 0, 96));
    const [hard, soft] = engineStub.liveNoteOn.mock.calls.map((c) => c[2] as number);
    expect(engineStub.liveNoteOn.mock.calls.map((c) => c[1])).toEqual([36, 36]);
    expect(hard).toBeGreaterThan(soft);
    expect(hard).toBeLessThanOrEqual(127);
    // A pad struck at its very bottom edge still sounds: a silent hit reads as
    // a broken pad, not as a soft one.
    expect(soft).toBeGreaterThan(0);
  });

  it('loads the kit into a drum rack on the keys the part already uses', () => {
    const id = setup('drum');
    render(<SynthPanel />);
    fireEvent.click(screen.getByTestId('kit-to-rack'));

    const sampler = trackOf(id).sampler!;
    expect(sampler.view).toBe('drum');
    expect(sampler.zones.map((z) => z.keyLo)).toEqual([36, 38, 39, 42, 46]);
    // And the face follows the device: the panel is the sampler's now.
    expect(screen.queryByTestId('synth-panel')).toBeNull();
  });

  it('makes the conversion one step of undo', () => {
    const id = setup('drum');
    render(<SynthPanel />);
    fireEvent.click(screen.getByTestId('kit-to-rack'));
    act(() => useProjectStore.getState().undo());
    expect(trackOf(id).sampler).toBeUndefined();
  });
});

// ---------------------------------------------------------------- samplers

function quickTrack(patch: Partial<SamplerParams> = {}): string {
  const id = setup();
  useProjectStore.getState().setInstrument(id, 'quick');
  useProjectStore
    .getState()
    .addSamplerZones(id, [
      makeZone({ mediaId: 'sample-a', name: 'Kick', startSec: 0.5, endSec: 2 }),
    ]);
  if (Object.keys(patch).length) useProjectStore.getState().setSamplerParams(id, patch);
  return id;
}

const zoneOf = (id: string) => trackOf(id).sampler!.zones[0];

describe('the quick sampler', () => {
  it('gives every window marker a value, a unit and the arrow keys', () => {
    const id = quickTrack();
    render(<SynthPanel />);
    const start = screen.getByTestId('smp-trim-start');
    expect(start).toHaveAttribute('role', 'slider');
    expect(start).toHaveAttribute('aria-valuetext', '0.500 seconds');

    fireEvent.keyDown(start, { key: 'ArrowRight' });
    expect(zoneOf(id).startSec).toBeCloseTo(0.51, 6);
    fireEvent.keyDown(start, { key: 'ArrowLeft', shiftKey: true });
    expect(zoneOf(id).startSec).toBeCloseTo(0.41, 6);
  });

  it('drags a marker along the waveform', () => {
    const id = quickTrack();
    render(<SynthPanel />);
    drag(screen.getByTestId('smp-trim-end'), -40, 0);
    expect(zoneOf(id).endSec).toBeLessThan(2);
  });

  it('offers the loop markers only when the zone loops, and inside the trim', () => {
    const id = quickTrack();
    render(<SynthPanel />);
    expect(screen.queryByTestId('smp-loopStart')).toBeNull();

    fireEvent.click(screen.getByTitle('Loop the playback window'));
    // Authored outside the window; the voice pulls it in, so the marker reads
    // the value that will actually sound rather than the one that was stored.
    act(() =>
      useProjectStore.getState().updateSamplerZones(id, [zoneOf(id).id], () => ({
        loopStartSec: 0,
      })),
    );
    expect(screen.getByTestId('smp-loopStart')).toHaveAttribute('aria-valuetext', '0.500 seconds');
  });

  it('will not let a marker be dragged out of its own window', () => {
    const id = quickTrack();
    render(<SynthPanel />);
    const end = screen.getByTestId('smp-trim-end');
    for (let i = 0; i < 400; i++) fireEvent.keyDown(end, { key: 'ArrowLeft', shiftKey: true });
    expect(zoneOf(id).endSec).toBeCloseTo(zoneOf(id).startSec + 0.01, 6);
  });
});

describe('the drum rack', () => {
  function drumTrack(): string {
    const id = setup();
    useProjectStore.getState().setInstrument(id, 'drum');
    useProjectStore.getState().applySamplerPreset(id, buildDrumKit());
    return id;
  }

  it('lays the kit out as pads, each naming its own key', () => {
    drumTrack();
    render(<SynthPanel />);
    expect(within(screen.getByTestId('pad-grid')).getAllByRole('button').length).toBeGreaterThan(8);
    expect(screen.getByTestId('pad-0')).toHaveAccessibleName('Pad 1: Kick (C1)');
  });

  /** Previewing starts the engine first, so the note lands a microtask later. */
  const flush = () => act(async () => {});

  it('takes its velocity from where the pad was struck', async () => {
    const id = drumTrack();
    render(<SynthPanel />);
    const pad = screen.getByTestId('pad-0');
    // jsdom lays nothing out, so the pad is told how tall it is.
    pad.getBoundingClientRect = () =>
      ({
        top: 0,
        height: 100,
        left: 0,
        width: 100,
        right: 100,
        bottom: 100,
        x: 0,
        y: 0,
      }) as DOMRect;

    fireEvent.click(pad, { clientY: 4 });
    fireEvent.click(pad, { clientY: 96 });
    await flush();
    const velocities = engineStub.liveNoteOn.mock.calls
      .filter((c) => c[0] === id)
      .map((c) => c[2] as number);
    expect(velocities[0], 'struck at the top').toBeGreaterThan(115);
    expect(velocities[1], 'struck at the bottom').toBeLessThan(45);
  });

  it('plays a pad at a fixed strong velocity from the keyboard', async () => {
    const id = drumTrack();
    render(<SynthPanel />);
    fireEvent.keyDown(screen.getByTestId('pad-0'), { key: 'Enter' });
    await flush();
    // Pad 1 is the first MIDI-addressable pad key, C1.
    expect(engineStub.liveNoteOn).toHaveBeenCalledWith(id, 24, 110);
  });

  it('marks a pad the zone matcher will drop', () => {
    const id = drumTrack();
    render(<SynthPanel />);
    fireEvent.click(screen.getByTestId('pad-1'));
    fireEvent.click(screen.getByLabelText('Solo pad'));
    // One solo silences every un-soloed pad, which is what the matcher does.
    expect(screen.getByTestId('pad-0')).toHaveAccessibleName(/silent/);
    expect(screen.getByTestId('pad-1')).not.toHaveAccessibleName(/silent/);
    expect(trackOf(id).sampler!.zones[1].solo).toBe(true);
  });
});

describe('the multisample', () => {
  function multiTrack(): string {
    const id = setup();
    useProjectStore.getState().setInstrument(id, 'multi');
    useProjectStore
      .getState()
      .addSamplerZones(id, [
        makeZone({ mediaId: 'sample-a', name: 'Low', keyLo: 40, keyHi: 60, rootNote: 48 }),
        makeZone({ mediaId: 'sample-b', name: 'High', keyLo: 50, keyHi: 80, rootNote: 72 }),
      ]);
    return id;
  }

  it('draws the map, and traces the zone the focus is in', () => {
    multiTrack();
    render(<SynthPanel />);
    const map = screen.getByLabelText(/Key and velocity map/);
    expect(map).toHaveAccessibleName(/2 zones/);

    fireEvent.focus(screen.getAllByLabelText('Key low')[1]);
    expect(map).toHaveAccessibleName(/High covers D3 to G#5, velocity 1 to 127/);
  });

  it('still lists every zone as an editable row', () => {
    const id = multiTrack();
    render(<SynthPanel />);
    const rows = screen.getAllByTestId('zone-row');
    expect(rows).toHaveLength(2);
    fireEvent.change(within(rows[0]).getByLabelText('Key low'), { target: { value: '30' } });
    expect(trackOf(id).sampler!.zones[0].keyLo).toBe(30);
  });
});

describe('the sampler voice sections', () => {
  it('draws no filter curve when the voice builds no filter', () => {
    quickTrack({ filterType: 'off' });
    render(<SynthPanel />);
    expect(screen.queryByTestId('smp-filter')).toBeNull();
    expect(screen.getByText(/No filter node is built/)).toBeInTheDocument();
  });

  it('sweeps the drawn corner where the modulator sweeps it', () => {
    quickTrack({
      filterType: 'lowpass',
      filterCutoff: 4000,
      lfoTarget: 'filter',
      lfoDepth: 0.5,
      lfoRate: 3,
    });
    render(<SynthPanel />);
    expect(screen.getByTestId('smp-filter')).toBeInTheDocument();
    expect(screen.getByLabelText(/Modulator, 3.00 Hz/)).toBeInTheDocument();
  });

  it('says so when a modulator is switched on and reaches nothing', () => {
    quickTrack({ filterType: 'off', lfoTarget: 'filter', lfoDepth: 0.8 });
    render(<SynthPanel />);
    expect(screen.getByTestId('lfo-inert')).toHaveTextContent(/reaches nothing/);
  });

  it('drives the sampler filter from the same handle the synth has', () => {
    const id = quickTrack({ filterType: 'lowpass', filterCutoff: 2000, filterRes: 1 });
    render(<SynthPanel />);
    const handle = screen.getByTestId('smp-filter-handle');
    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    expect(trackOf(id).sampler!.filterCutoff).toBe(Math.round(2000 * Math.pow(2, 1 / 12)));
    fireEvent.keyDown(handle, { key: 'ArrowUp' });
    expect(trackOf(id).sampler!.filterRes).toBeCloseTo(1.5, 6);
  });
});

describe('the instrument rack', () => {
  it('draws each layer over one key axis and marks the silenced ones', () => {
    const id = setup();
    useProjectStore.getState().rackAddItem(id, 'synth');
    useProjectStore.getState().rackAddItem(id, 'sampler');
    render(<SynthPanel />);

    const rows = screen.getAllByTestId('rack-item');
    expect(rows).toHaveLength(2);
    expect(rows[0].querySelector('.layer-bar')).not.toHaveClass('off');

    const items = trackOf(id).rack!.items;
    fireEvent.click(within(rows[1]).getByLabelText(`Solo ${items[1].name}`));
    expect(screen.getAllByTestId('rack-item')[0].querySelector('.layer-bar')).toHaveClass('off');
  });
});
