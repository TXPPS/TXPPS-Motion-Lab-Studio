import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { WarpLane, WarpPanel } from '../../src/components/audioeditor/WarpTool';
import { createWarpMap, sourceToBeat, type WarpMap } from '../../src/model/warp';
import type { AudioClip } from '../../src/model/types';
import { useProjectStore } from '../../src/state/projectStore';

const WIDTH = 400;
/** Two seconds of source across four hundred pixels: 5 ms a pixel. */
const rect = {
  left: 0,
  top: 0,
  width: WIDTH,
  height: 60,
  right: WIDTH,
  bottom: 60,
  x: 0,
  y: 0,
  toJSON: () => ({}),
};

// jsdom performs no layout, so every rect is empty and a pointer at x = 200
// would land nowhere. The lane is told how wide it is instead.
const original = HTMLElement.prototype.getBoundingClientRect;
beforeEach(() => {
  HTMLElement.prototype.getBoundingClientRect = () => rect as DOMRect;
});
afterEach(() => {
  HTMLElement.prototype.getBoundingClientRect = original;
});

/**
 * jsdom has no PointerEvent, and Testing Library's fallback drops every
 * property of one — including the coordinate the drag is about. A MouseEvent
 * under the pointer event's name carries them and reaches the same listeners.
 * Shift is held so the drag reports the raw position instead of snapping to an
 * onset.
 */
function pointer(type: string, clientX: number): MouseEvent {
  return new MouseEvent(type, { bubbles: true, cancelable: true, clientX, shiftKey: true });
}

function map(): WarpMap {
  return createWarpMap(
    [
      { sourceSec: 0.5, beat: 1 },
      { sourceSec: 1.0, beat: 2 },
    ],
    120,
  );
}

function mount(onChange: (m: WarpMap) => void, transients = [0.52, 1.02, 1.48]) {
  return render(
    <WarpLane
      map={map()}
      offsetSec={0}
      durationSec={2}
      maxSourceSec={2}
      transients={transients}
      gridBeats={1}
      onChange={onChange}
    />,
  );
}

describe('WarpLane', () => {
  it('draws one handle per marker, labelled with the beat it pins', () => {
    mount(vi.fn());
    expect(screen.getAllByTestId(/warp-marker-/)).toHaveLength(2);
    expect(screen.getByTestId('warp-marker-0')).toHaveAccessibleName(
      'Warp marker at 0.500 seconds, pinned to beat 1',
    );
    expect(screen.getByTestId('warp-marker-1')).toHaveTextContent('2');
  });

  it('adds a marker at the nearest onset when an empty spot is double-clicked', () => {
    const onChange = vi.fn();
    mount(onChange);
    // 1.46 s is 292 px in, close enough to the onset at 1.48 to take it.
    fireEvent.doubleClick(screen.getByTestId('warp-lane'), { clientX: 292 });
    const next = onChange.mock.calls[0][0] as WarpMap;
    expect(next.markers.map((m) => m.sourceSec)).toEqual([0.5, 1, 1.48]);
    // Pinned where it already played, so adding it moved nothing.
    expect(next.markers[2].beat).toBeCloseTo(sourceToBeat(map(), 1.48), 12);
  });

  it('removes a marker on a double-click and on a right-click', () => {
    for (const fire of [fireEvent.doubleClick, fireEvent.contextMenu]) {
      const onChange = vi.fn();
      const view = mount(onChange);
      fire(screen.getByTestId('warp-lane'), { clientX: 200 });
      expect((onChange.mock.calls[0][0] as WarpMap).markers.map((m) => m.beat)).toEqual([1]);
      view.unmount();
    }
  });

  it('commits a drag once, clamped short of the marker it was dragged at', () => {
    const onChange = vi.fn();
    mount(onChange);
    const lane = screen.getByTestId('warp-lane');
    fireEvent(screen.getByTestId('warp-marker-0'), pointer('pointerdown', 100));
    // Past the marker at one second, which is where the drag has to stop.
    fireEvent(lane, pointer('pointermove', 380));
    expect(onChange).not.toHaveBeenCalled();
    fireEvent(lane, pointer('pointerup', 380));
    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0][0] as WarpMap;
    expect(next.markers[0].sourceSec).toBeLessThan(1);
    expect(next.markers[0].beat).toBe(1);
    expect(next.markers[1]).toEqual({ sourceSec: 1, beat: 2 });
  });

  it('nudges with the arrow keys and removes with Delete', () => {
    const onChange = vi.fn();
    mount(onChange);
    const marker = screen.getByTestId('warp-marker-1');
    fireEvent.keyDown(marker, { key: 'ArrowRight' });
    expect((onChange.mock.calls[0][0] as WarpMap).markers[1].sourceSec).toBeCloseTo(1.002, 12);
    fireEvent.keyDown(marker, { key: 'Delete' });
    expect((onChange.mock.calls[1][0] as WarpMap).markers.map((m) => m.beat)).toEqual([1]);
  });
});

describe('WarpPanel', () => {
  /** Markers a hair off the beat, the way a real player lands. */
  const loose = createWarpMap(
    [
      { sourceSec: 0.5, beat: 0.94 },
      { sourceSec: 1.0, beat: 2.09 },
    ],
    120,
  );

  function mountPanel(onChange: (m: WarpMap) => void, map = loose) {
    const clip = useProjectStore
      .getState()
      .project.clips.find((c): c is AudioClip => c.type === 'audio')!;
    return render(
      <WarpPanel
        clip={clip}
        map={map}
        buffer={null}
        gridBeats={1}
        strength={1}
        onGrid={vi.fn()}
        onStrength={vi.fn()}
        onChange={onChange}
      />,
    );
  }

  it('quantizes the markers onto the grid at full strength', () => {
    const onChange = vi.fn();
    mountPanel(onChange);
    fireEvent.click(screen.getByTestId('warp-quantize'));
    expect((onChange.mock.calls[0][0] as WarpMap).markers.map((m) => m.beat)).toEqual([1, 2]);
  });

  it('resets to an unwarped clip and says so once there is nothing pinned', () => {
    const onChange = vi.fn();
    const view = mountPanel(onChange);
    fireEvent.click(screen.getByTestId('warp-reset'));
    expect((onChange.mock.calls[0][0] as WarpMap).markers).toHaveLength(0);
    view.unmount();

    mountPanel(onChange, createWarpMap([], 120));
    expect(screen.getByTestId('warp-summary')).toHaveTextContent('No markers');
    expect(screen.getByTestId('warp-reset')).toBeDisabled();
  });
});
