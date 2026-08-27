import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { DeviceRack, masterRack, trackRack } from '../../src/components/mixer/DeviceRack';
import { createEmptyProject } from '../../src/model/demoProject';
import { MAX_INSERTS } from '../../src/model/effects';
import { useProjectStore } from '../../src/state/projectStore';
import { useUiStore } from '../../src/state/uiStore';
import { DOUBLE_TAP_MS } from '../../src/hooks/useTapOrDouble';

vi.mock('../../src/audio/engine', async () => ({
  engine: (await import('../setup.tsx')).engineStub,
}));

const project = () => useProjectStore.getState().project;

function setup(type: 'audio' | 'instrument' = 'audio') {
  useProjectStore.getState().setProject(createEmptyProject('Rack'), { markClean: true });
  const id = useProjectStore.getState().addTrack(type);
  useProjectStore.getState().setTrack(id, { name: 'Ch' });
  useUiStore.getState().set({ openDevice: null });
  return id;
}

/**
 * Two presses inside the double-tap interval.
 *
 * NOT `fireEvent.doubleClick`, which dispatches a lone `dblclick` and no clicks
 * at all — an event sequence no browser produces and no person can make. A real
 * double-click sends click, click, dblclick, and the gesture reads the clicks.
 * A test built on `doubleClick` would be asserting against a fiction, and this
 * one was until it failed for exactly that reason.
 *
 * Both presses carry the same stamp, which is what makes this a double press
 * rather than two single ones. Stamping the events rather than freezing
 * `performance.now()`: the scheduler React uses to decide when to re-render
 * reads that clock too, so holding it still stops the re-render this is about
 * to look for.
 */
function doublePress(el: Element) {
  fireEvent.click(el, { timeStamp: 1000 });
  fireEvent.click(el, { timeStamp: 1000 });
}

/** Re-read the track after every store change: the rack is built from it. */
const rackFor = (id: string) => trackRack(project().tracks.find((t) => t.id === id)!);

describe('the console device rack', () => {
  let id = '';
  beforeEach(() => {
    id = setup();
  });

  it('lists every device in order, not the first few', () => {
    // The old strip showed four and summarised the rest, so a chain of eight
    // could not be read from the console at all.
    for (const kind of ['eq3', 'compressor', 'saturator', 'delay', 'reverb', 'width'] as const) {
      useProjectStore.getState().addEffect(id, kind);
    }
    render(<DeviceRack rack={rackFor(id)} />);
    const slots = screen.getAllByTestId(/^device-Ch-/);
    expect(slots).toHaveLength(6);
    expect(slots.map((s) => within(s).getByText(/^\d+$/).textContent)).toEqual([
      '1',
      '2',
      '3',
      '4',
      '5',
      '6',
    ]);
  });

  it('expands its main controls on a double-click, and puts back the window it opened', () => {
    // The reference's Micro View: a device slot that is only a label makes you
    // open a window to move a threshold.
    //
    // The gesture is item 13's and it is the inverse of what this rack used to
    // do. What is asserted here is the half that is easy to get wrong: the
    // double-click's *first* click has already opened the window by the time
    // the second arrives, so the second has to put it back. Without that, a
    // double-click leaves a window open on top of the controls it just
    // revealed.
    useProjectStore.getState().addEffect(id, 'compressor');
    render(<DeviceRack rack={rackFor(id)} />);
    expect(screen.queryByTestId('micro-Ch-1')).toBeNull();

    doublePress(within(screen.getByTestId('device-Ch-1')).getByText('Compressor'));
    expect(
      useUiStore.getState().openDevice,
      'the second press must revert the open the first one did',
    ).toBeNull();

    const micro = screen.getByTestId('micro-Ch-1');
    const sliders = within(micro).getAllByRole('slider');
    expect(sliders.length).toBeGreaterThan(1);
    expect(sliders[0]).toHaveAttribute('aria-label', 'Threshold on Compressor');
  });

  it('moves a parameter from the closed slot, by keyboard as well as by drag', () => {
    useProjectStore.getState().addEffect(id, 'compressor');
    const { rerender } = render(<DeviceRack rack={rackFor(id)} />);
    doublePress(within(screen.getByTestId('device-Ch-1')).getByText('Compressor'));

    const before = project().tracks.find((t) => t.id === id)!.effects![0].params.threshold;
    fireEvent.keyDown(screen.getByLabelText('Threshold on Compressor'), { key: 'ArrowRight' });
    rerender(<DeviceRack rack={rackFor(id)} />);
    const after = project().tracks.find((t) => t.id === id)!.effects![0].params.threshold;
    expect(after).toBeGreaterThan(before);
    // and it reads back as a value a musician recognises, not a raw number
    expect(screen.getByLabelText('Threshold on Compressor')).toHaveAttribute(
      'aria-valuetext',
      expect.stringContaining('dB'),
    );
  });

  it('opens the device window on one click and closes it on the next', () => {
    const fx = useProjectStore.getState().addEffect(id, 'compressor')!;
    // Stamped an interval apart on purpose. Two `fireEvent.click`s land
    // microseconds apart otherwise, which is a double-click by any measure — so
    // without the stamps "click again to close" would be indistinguishable from
    // the case above and neither test would assert what its title says.
    render(<DeviceRack rack={rackFor(id)} />);
    const name = within(screen.getByTestId('device-Ch-1')).getByText('Compressor');

    fireEvent.click(name, { timeStamp: 1000 });
    expect(useUiStore.getState().openDevice).toEqual({ trackId: id, effectId: fx });

    fireEvent.click(name, { timeStamp: 1000 + DOUBLE_TAP_MS + 1 });
    expect(
      useUiStore.getState().openDevice,
      'a second press past the double-tap interval closes it',
    ).toBeNull();
  });

  it('leaves an already-open device open when it is double-clicked', () => {
    // The revert restores what was there, rather than clearing. Reverting to
    // "closed" unconditionally would be simpler and would shut a window every
    // time somebody asked for the quick controls of the device they were
    // already looking at.
    const fx = useProjectStore.getState().addEffect(id, 'compressor')!;
    useUiStore.getState().set({ openDevice: { trackId: id, effectId: fx } });
    render(<DeviceRack rack={rackFor(id)} />);
    doublePress(within(screen.getByTestId('device-Ch-1')).getByText('Compressor'));
    expect(useUiStore.getState().openDevice).toEqual({ trackId: id, effectId: fx });
    expect(screen.getByTestId('micro-Ch-1')).toBeTruthy();
  });

  it('bypasses from the strip, and says which state the light means', () => {
    useProjectStore.getState().addEffect(id, 'compressor');
    const { rerender } = render(<DeviceRack rack={rackFor(id)} />);
    const power = screen.getByLabelText('Bypass Compressor on Ch');
    expect(power).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(power);
    expect(project().tracks.find((t) => t.id === id)!.effects![0].bypass).toBe(true);
    rerender(<DeviceRack rack={rackFor(id)} />);
    expect(screen.getByLabelText('Enable Compressor on Ch')).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('reorders by dropping a device above another', () => {
    const a = useProjectStore.getState().addEffect(id, 'eq3')!;
    useProjectStore.getState().addEffect(id, 'compressor');
    useProjectStore.getState().addEffect(id, 'reverb');
    const { rerender } = render(<DeviceRack rack={rackFor(id)} />);

    // Drag the EQ (slot 1) onto the top half of the reverb (slot 3).
    const data = new Map<string, string>();
    const dataTransfer = {
      setData: (k: string, v: string) => void data.set(k, v),
      getData: (k: string) => data.get(k) ?? '',
      types: ['application/x-motionlab-device'],
      effectAllowed: '',
    };
    const target = screen.getByTestId('device-Ch-3');
    target.getBoundingClientRect = () =>
      ({ top: 0, height: 20, left: 0, width: 100, bottom: 20, right: 100 }) as DOMRect;

    fireEvent.dragStart(screen.getByTestId('device-Ch-1'), { dataTransfer });
    fireEvent.dragOver(target, { dataTransfer, clientY: 15 }); // below the midpoint → after
    fireEvent.drop(target, { dataTransfer });

    rerender(<DeviceRack rack={rackFor(id)} />);
    const kinds = project()
      .tracks.find((t) => t.id === id)!
      .effects!.map((e) => e.kind);
    expect(kinds, 'the EQ should have moved to the end').toEqual(['compressor', 'reverb', 'eq3']);
    expect(a).toBeTruthy();
  });

  it('shows the instrument above the inserts on a channel that plays notes', () => {
    const inst = setup('instrument');
    useProjectStore.getState().addEffect(inst, 'reverb');
    render(<DeviceRack rack={rackFor(inst)} />);
    const rack = screen.getByTestId('rack-Ch');
    const order = [...rack.querySelectorAll('.dev-instrument, .dev-slot')];
    expect(order[0]).toHaveClass('dev-instrument');
    expect(order[1]).toHaveClass('dev-slot');
  });

  it('offers no instrument slot on an audio channel', () => {
    render(<DeviceRack rack={rackFor(id)} />);
    expect(screen.queryByTestId('instrument-Ch')).toBeNull();
  });

  it('refuses a thirteenth device and says why', () => {
    for (let i = 0; i < MAX_INSERTS; i++) useProjectStore.getState().addEffect(id, 'trim');
    render(<DeviceRack rack={rackFor(id)} />);
    const add = screen.getByTestId('device-add-Ch');
    expect(add).toBeDisabled();
    expect(add).toHaveAttribute('aria-label', `Insert limit of ${MAX_INSERTS} reached`);
  });
});

describe('the master channel uses the same rack', () => {
  beforeEach(() => {
    useProjectStore.getState().setProject(createEmptyProject('Master'), { markClean: true });
  });

  it('lists and bypasses master devices without a second implementation', () => {
    useProjectStore.getState().addMasterEffect('limiter');
    const fx = () => useProjectStore.getState().project.master?.effects ?? [];
    const { rerender } = render(<DeviceRack rack={masterRack(fx())} />);
    expect(screen.getByTestId('device-Master-1')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Bypass Limiter on Master'));
    expect(fx()[0].bypass).toBe(true);
    rerender(<DeviceRack rack={masterRack(fx())} />);
    expect(screen.getByLabelText('Enable Limiter on Master')).toBeTruthy();
  });
});
