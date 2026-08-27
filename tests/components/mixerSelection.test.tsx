/**
 * Selecting a strip does not re-tier the console under the pointer.
 *
 * RA-006. Selecting a channel used to mount the overview band, which took 116 px
 * out of a mixer pane that had 265 — so the console re-tiered *while a pointer
 * was still pressed on it*. Measured at the time: the Insert button moved from
 * y=696 to y=803 between `pointerdown` and `pointerup`, the release landed on a
 * different element, and the only way to add a device to a channel did not work
 * with a mouse. The device suite did not see it because it opened that menu with
 * `el.click()`, which has no press to move under.
 *
 * `ChannelOverview` answered it with `useSettledSelection`: select on
 * `pointerdown` as a fader drag requires, but hold the *layout* until the hand
 * comes off. That component is gone — the band is an editor now — so the hook
 * went with it, and `parity-guard` correctly refused a build whose recorded
 * PARITY rested on a file that no longer exists.
 *
 * The claim is still true and it is true for a stronger reason: nothing in the
 * console mounts or unmounts on selection any more, so there is no layout to
 * settle. That is what this asserts, and it asserts it as a measurement rather
 * than as the presence of a hook — a predicate naming an implementation goes
 * stale the moment the implementation is replaced by a better one, which is
 * exactly what happened here.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { Mixer } from '../../src/components/mixer/Mixer';
import { createEmptyProject } from '../../src/model/demoProject';
import { useProjectStore } from '../../src/state/projectStore';
import { useUiStore } from '../../src/state/uiStore';

vi.mock('../../src/audio/engine', async () => ({
  engine: (await import('../setup.tsx')).engineStub,
}));

/**
 * How many elements the console renders, and how deep.
 *
 * jsdom has no layout, so a height comparison would read 0 against 0 and pass
 * whatever happened — the vacuous shape this repository has been caught by
 * before. What *causes* a re-tier is the console's box changing, and what
 * changes it is a subtree appearing or disappearing. Counting the nodes catches
 * that in the one environment available here; the geometry itself is
 * `e2e/landscape.spec.ts`'s subject, where there is a real layout engine.
 */
function shape(): { nodes: number; strips: number } {
  const mixer = screen.getByTestId('mixer').parentElement!;
  return {
    nodes: mixer.querySelectorAll('*').length,
    strips: mixer.querySelectorAll('.strip').length,
  };
}

describe('the console holds still while a channel is selected', () => {
  let ids: string[] = [];
  beforeEach(() => {
    useProjectStore.getState().setProject(createEmptyProject('Desk'), { markClean: true });
    ids = ['audio', 'instrument'].map((t, i) => {
      const id = useProjectStore.getState().addTrack(t as 'audio' | 'instrument');
      useProjectStore.getState().setTrack(id, { name: `Ch${i + 1}` });
      return id;
    });
    useUiStore.getState().set({ selectedTrackId: null, openDevice: null });
  });

  it('renders the same console before and after a strip is selected', () => {
    render(<Mixer />);
    const before = shape();
    expect(before.strips).toBeGreaterThan(0);

    act(() => useUiStore.getState().selectTrack(ids[0]));
    const after = shape();

    expect(after, 'selecting a channel changed what the console renders').toEqual(before);
  });

  it('renders the same console when the selection moves between strips', () => {
    useUiStore.getState().selectTrack(ids[0]);
    render(<Mixer />);
    const before = shape();

    act(() => useUiStore.getState().selectTrack(ids[1]));

    expect(shape(), 'moving the selection changed what the console renders').toEqual(before);
  });

  it('selects on pointerdown, because a fader drag has no click at the end of it', () => {
    // The half that must NOT be given up in fixing the above. Selection has to
    // happen on the press: dragging a fader on an unselected strip has to select
    // it, and a drag ends with no click for a later handler to catch.
    //
    // Pressed on the FADER, not on the strip element. This fired on the strip
    // itself and passed while the product did not do it: `usePointerDrag` calls
    // `stopPropagation`, so a press that lands anywhere draggable never reached
    // the strip's handler — and the strip element is a node no finger ever
    // lands on. Measured on a tablet in landscape, the fader row is 52 px of a
    // 123 px channel and selecting a strip is the first step of the console's
    // only route to a chain. The strip claims it in the capture phase now.
    render(<Mixer />);
    const strip = screen.getByTestId('strip-Ch2');
    const fader = strip.querySelector('.fader');
    expect(fader, 'the strip draws no fader, so this presses nothing').toBeTruthy();
    fireEvent.pointerDown(fader!);
    expect(useUiStore.getState().selectedTrackId).toBe(ids[1]);
  });

  it("and a press on the strip's own body still selects it", () => {
    // Both halves, because the capture handler could have been moved onto the
    // fader instead and that would pass the case above while losing every press
    // on the name, the buttons or the readout.
    render(<Mixer />);
    fireEvent.pointerDown(screen.getByTestId('strip-Ch2'));
    expect(useUiStore.getState().selectedTrackId).toBe(ids[1]);
  });

  it('would notice a subtree that mounts on selection', () => {
    // Non-vacuity. `shape()` reading two identical numbers because it is
    // counting the wrong thing looks exactly like a console that holds still,
    // and this repository has shipped that shape more than once. So: mount
    // something the way the overview band used to, and require the measurement
    // to move.
    render(<Mixer />);
    const before = shape();
    const host = screen.getByTestId('mixer').parentElement!;
    const band = document.createElement('div');
    band.innerHTML = '<span></span><span></span>';
    host.insertBefore(band, host.firstChild);
    expect(shape().nodes, 'the probe cannot see a subtree appearing').toBeGreaterThan(before.nodes);
    band.remove();
  });
});
