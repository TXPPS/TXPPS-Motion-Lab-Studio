import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ParamKnob } from '../../src/components/common/widgets';
import { createEmptyProject } from '../../src/model/demoProject';
import { useProjectStore } from '../../src/state/projectStore';

vi.mock('../../src/audio/engine', async () => ({
  engine: (await import('../setup.tsx')).engineStub,
}));

/**
 * A knob sweep is one undo entry.
 *
 * Every instrument knob in the product wrote one undo step per pointer move,
 * so undoing a filter sweep took as many presses as the sweep took frames.
 * The mixer's Fader and PanKnob always took gesture bounds; ParamKnob did
 * not, and nothing noticed because undo depth is invisible until you use it.
 */
describe('a knob sweep is one undo entry', () => {
  let trackId = '';

  beforeEach(() => {
    useProjectStore.getState().setProject(createEmptyProject('Undo'), { markClean: true });
    trackId = useProjectStore.getState().addTrack('instrument');
  });

  /** Drive the knob the way a pointer does: down, several moves, up. */
  function sweep(onNorm: (v: number) => void) {
    const store = useProjectStore.getState();
    render(
      <ParamKnob
        label="Cutoff"
        norm={0.5}
        display="3.0 kHz"
        onNorm={onNorm}
        onGestureStart={() => useProjectStore.getState().beginGesture()}
        onGestureEnd={() => useProjectStore.getState().endGesture()}
      />,
    );
    // jsdom has no PointerEvent; a MouseEvent under the pointer event's name
    // reaches the same listeners, which is what the warp-lane and score tests
    // already rely on.
    const pointer = (type: string, y: number) =>
      new MouseEvent(type, { bubbles: true, cancelable: true, clientX: 100, clientY: y });
    const knob = screen.getByRole('slider', { name: 'Cutoff' });
    fireEvent(knob, pointer('pointerdown', 100));
    for (let i = 1; i <= 8; i++) fireEvent(window, pointer('pointermove', 100 - i * 4));
    fireEvent(window, pointer('pointerup', 68));
    return store;
  }

  it('leaves one step to undo, not one per frame', () => {
    const before = useProjectStore.getState().project.tracks.find((t) => t.id === trackId)!.synth!
      .cutoff;

    sweep((n) => {
      useProjectStore.getState().setSynthParams(trackId, { cutoff: 200 + n * 12000 });
    });

    const moved = useProjectStore.getState().project.tracks.find((t) => t.id === trackId)!.synth!
      .cutoff;
    expect(moved, 'the sweep did not move the parameter').not.toBe(before);

    useProjectStore.getState().undo();
    const after = useProjectStore.getState().project.tracks.find((t) => t.id === trackId)!.synth!
      .cutoff;
    expect(after, 'one undo should return the whole sweep').toBe(before);
  });

  it('still moves the parameter from the keyboard, without opening a gesture', () => {
    const seen: number[] = [];
    render(<ParamKnob label="Res" norm={0.5} display="6.0 dB" onNorm={(v) => seen.push(v)} />);
    fireEvent.keyDown(screen.getByRole('slider', { name: 'Res' }), { key: 'ArrowUp' });
    expect(seen.length).toBe(1);
    expect(seen[0]).toBeGreaterThan(0.5);
  });
});
