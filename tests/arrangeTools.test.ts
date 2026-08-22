import { describe, expect, it } from 'vitest';
import { TOOLS } from '../src/components/arrangement/Arrangement';
import { ARRANGE_TOOLS } from '../src/state/uiStore';
import { SHORTCUTS } from '../src/app/shortcuts';
import {
  MAX_LANE_SCALE,
  MAX_PX_PER_BEAT,
  MIN_LANE_SCALE,
  MIN_PX_PER_BEAT,
  laneScaleFromDrag,
  nextPxPerBeat,
  paintSpan,
  zoomAnchorScroll,
  zoomFactorFromDrag,
} from '../src/model/arrangeTools';

/** Grid snap at a given division, as the arrangement's snapTo behaves. */
const grid = (step: number) => (beat: number) => Math.round(beat / step) * step;
const noSnap = (beat: number) => beat;

describe('the tool row', () => {
  it('offers every tool, in the order the number keys select them', () => {
    expect(TOOLS.map((t) => t.id)).toEqual([...ARRANGE_TOOLS]);
  });

  it('says in the shortcut list which keys those are', () => {
    const tools = SHORTCUTS.find((s) => s.id === 'tools');
    expect(tools?.combo).toBe(`1-${ARRANGE_TOOLS.length}`);
    for (const id of ARRANGE_TOOLS) {
      expect(tools?.description.toLowerCase()).toContain(id);
    }
  });
});

describe('paintSpan', () => {
  it('gives a click the click length at the snapped press point', () => {
    const span = paintSpan(5.4, 5.4, grid(1), { clickLength: 4, minLength: 0.25, moved: false });
    expect(span).toEqual({ start: 5, length: 4 });
  });

  it('measures a drag between the two snapped ends', () => {
    const span = paintSpan(2.1, 9.9, grid(1), { clickLength: 4, minLength: 0.25, moved: true });
    expect(span).toEqual({ start: 2, length: 8 });
  });

  it('reads a backwards drag as the same span', () => {
    const back = paintSpan(9.9, 2.1, grid(1), { clickLength: 4, minLength: 0.25, moved: true });
    expect(back).toEqual({ start: 2, length: 8 });
  });

  it('never produces a zero-length clip from a drag inside one grid cell', () => {
    const span = paintSpan(4, 4.1, grid(1), { clickLength: 4, minLength: 0.25, moved: true });
    expect(span.start).toBe(4);
    expect(span.length).toBe(0.25);
  });

  it('honours the snap division it is handed, including no snap at all', () => {
    expect(
      paintSpan(1.3, 3.8, grid(0.25), { clickLength: 4, minLength: 0.25, moved: true }),
    ).toEqual({ start: 1.25, length: 2.5 });
    const free = paintSpan(1.3, 3.8, noSnap, { clickLength: 4, minLength: 0.25, moved: true });
    expect(free.start).toBeCloseTo(1.3, 12);
    expect(free.length).toBeCloseTo(2.5, 12);
  });

  it('cannot paint before the start of the song', () => {
    const span = paintSpan(-9, 2, grid(1), { clickLength: 4, minLength: 0.25, moved: true });
    expect(span).toEqual({ start: 0, length: 2 });
  });
});

describe('zoom-drag', () => {
  it('doubles and halves symmetrically, and stands still at rest', () => {
    expect(zoomFactorFromDrag(0)).toBe(1);
    expect(zoomFactorFromDrag(220)).toBeCloseTo(2, 12);
    expect(zoomFactorFromDrag(-220)).toBeCloseTo(0.5, 12);
    expect(zoomFactorFromDrag(110) * zoomFactorFromDrag(-110)).toBeCloseTo(1, 12);
  });

  it('clamps the zoom level to the range the timeline can draw', () => {
    expect(nextPxPerBeat(26, 2)).toBe(52);
    expect(nextPxPerBeat(100, 8)).toBe(MAX_PX_PER_BEAT);
    expect(nextPxPerBeat(8, 0.01)).toBe(MIN_PX_PER_BEAT);
  });

  it('quantises so repeated steps cannot drift onto a fractional pixel', () => {
    expect(nextPxPerBeat(26, 1.2345)).toBe(32.1);
  });

  it('keeps the beat under the anchor under the anchor', () => {
    const prev = 20;
    const next = 40;
    const scrollLeft = 400;
    const offsetInView = 150;
    const anchorBeat = (scrollLeft + offsetInView) / prev;
    const after = zoomAnchorScroll(scrollLeft, offsetInView, prev, next);
    expect((after + offsetInView) / next).toBeCloseTo(anchorBeat, 12);
  });

  it('does not scroll past the start of the song when zooming out near it', () => {
    expect(zoomAnchorScroll(10, 40, 40, 8)).toBe(0);
  });

  it('is a no-op scroll when there is no previous zoom to divide by', () => {
    expect(zoomAnchorScroll(320, 100, 0, 40)).toBe(320);
  });
});

describe('laneScaleFromDrag', () => {
  it('grows downward and shrinks upward', () => {
    expect(laneScaleFromDrag(1, 260)).toBeCloseTo(2, 12);
    expect(laneScaleFromDrag(1, -260)).toBeCloseTo(MIN_LANE_SCALE, 12);
    expect(laneScaleFromDrag(1, 0)).toBe(1);
  });

  it('stays inside the range a track header can still render', () => {
    expect(laneScaleFromDrag(2, 2000)).toBe(MAX_LANE_SCALE);
    expect(laneScaleFromDrag(1, -2000)).toBe(MIN_LANE_SCALE);
  });
});
