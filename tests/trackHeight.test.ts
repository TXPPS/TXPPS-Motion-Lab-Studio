/**
 * How the three inputs to a lane's height combine, and the floor under them.
 *
 * `Track.height` had been in the schema since v6, clamped on load, and read by
 * nothing — so a per-track height was a field the persistence layer maintained
 * for a feature that did not exist. `laneScale` was the only live input, it
 * lived in `uiStore`, and a reload threw it away. And the arrangement had no
 * touch floor at all: 38 px at the minimum scale and 30 px collapsed, against
 * a 44 px minimum, on a surface whose lanes are the drag target for every clip
 * on them.
 *
 * All of this is arithmetic, so it is tested here rather than in a browser.
 * What a browser is for is proving the numbers reach the screen, which
 * `e2e/trackheight.spec.ts` does.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  FINE_LANE_MIN,
  LANE_H,
  LANE_H_COLLAPSED,
  LANE_MAX,
  LANE_SCALE_STEP,
  TOUCH_LANE_MIN,
  TRACK_HEIGHT_STEP,
  clampTrackHeight,
  coarsePointer,
  isCollapsedHeight,
  laneFloor,
  stepLaneScale,
  stepTrackHeight,
  trackLaneHeight,
} from '../src/components/arrangement/trackHeight';
import { MAX_LANE_SCALE, MIN_LANE_SCALE } from '../src/model/arrangeTools';
import { bandHeights } from '../src/components/arrangement/Arrangement';
import type { Clip, Track } from '../src/model/types';

/** Pretend to be a finger, or a mouse, for one test. */
function withPointer(kind: 'coarse' | 'fine', run: () => void) {
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: kind === 'coarse' && q.includes('coarse'),
    media: q,
  }));
  try {
    run();
  } finally {
    vi.unstubAllGlobals();
  }
}

afterEach(() => vi.unstubAllGlobals());

const track = (patch: Partial<Track> = {}): Track => ({
  id: 't1',
  name: 'Keys',
  type: 'instrument',
  color: '#888888',
  volume: 1,
  pan: 0,
  mute: false,
  solo: false,
  armed: false,
  collapsed: false,
  output: 'master',
  ...patch,
});

describe('the three inputs to a lane height', () => {
  it('draws the layout default when a track has never been resized', () => {
    expect(trackLaneHeight(track(), 1, false)).toBe(LANE_H);
  });

  it('honours a per-track height, which nothing read before', () => {
    // The whole point of the unit. Before this, `height: 120` drew at 64.
    expect(trackLaneHeight(track({ height: 120 }), 1, false)).toBe(120);
    expect(trackLaneHeight(track({ height: 30 }), 1, false)).toBe(30);
  });

  it('multiplies the per-track height by the global scale rather than replacing it', () => {
    // Replacing would make the global control silently discard every per-track
    // decision the user had made, which is the reason it multiplies.
    expect(trackLaneHeight(track({ height: 100 }), 2, false)).toBe(200);
    expect(trackLaneHeight(track({ height: 100 }), 0.6, false)).toBe(60);
    // And a deliberately tall track stays taller than its neighbour at every
    // zoom, which is what "multiplies" is worth.
    for (const scale of [0.6, 1, 1.5, 2.5]) {
      expect(trackLaneHeight(track({ height: 100 }), scale, false)).toBeGreaterThan(
        trackLaneHeight(track(), scale, false),
      );
    }
  });

  it('lets collapsed win outright, over both the height and the scale', () => {
    // A collapsed track is not a smaller version of an open one — the header
    // drops its whole control strip at that size — so scaling it would make
    // "collapsed" mean six different heights.
    const collapsed = track({ collapsed: true, height: 300 });
    for (const scale of [0.6, 1, 2.5]) {
      expect(trackLaneHeight(collapsed, scale, false)).toBe(LANE_H_COLLAPSED);
    }
  });

  it('holds the scale to the range the tool declares', () => {
    expect(trackLaneHeight(track(), 99, false)).toBe(Math.round(LANE_H * MAX_LANE_SCALE));
    expect(trackLaneHeight(track(), 0.01, false)).toBe(Math.round(LANE_H * MIN_LANE_SCALE));
  });

  it('returns whole pixels, so the two columns cannot drift apart', () => {
    // A fractional height that the header column and the lane column each
    // round separately drifts a pixel per track and lands a cross-track clip
    // drag on the wrong lane.
    for (const scale of [0.63, 1.07, 1.33, 2.41]) {
      const h = trackLaneHeight(track({ height: 77 }), scale, false);
      expect(Number.isInteger(h)).toBe(true);
    }
  });
});

describe('the floor, which depends on the hand', () => {
  it('puts no lane under the touch minimum on a finger', () => {
    withPointer('coarse', () => {
      expect(laneFloor()).toBe(TOUCH_LANE_MIN);
      // The two cases the arrangement actually had: 38 px at the minimum
      // scale, and a 30 px collapsed lane.
      expect(trackLaneHeight(track(), MIN_LANE_SCALE)).toBeGreaterThanOrEqual(TOUCH_LANE_MIN);
      expect(trackLaneHeight(track({ collapsed: true }), 1)).toBe(TOUCH_LANE_MIN);
      // And a stored desktop value never reaches a finger, which is the whole
      // reason the clamp is on read rather than on write.
      expect(trackLaneHeight(track({ height: 24 }), 1)).toBe(TOUCH_LANE_MIN);
    });
  });

  it('lets a mouse have short lanes, because seeing the arrangement is the point', () => {
    withPointer('fine', () => {
      expect(laneFloor()).toBe(FINE_LANE_MIN);
      expect(trackLaneHeight(track({ collapsed: true }), 1)).toBe(LANE_H_COLLAPSED);
      expect(trackLaneHeight(track({ height: 10 }), 1)).toBe(FINE_LANE_MIN);
    });
  });

  it('stops at a ceiling, the same one the file format allows', () => {
    withPointer('fine', () => {
      expect(trackLaneHeight(track({ height: 4000 }), 2.5)).toBe(LANE_MAX);
      expect(clampTrackHeight(9999)).toBe(LANE_MAX);
    });
  });

  it('treats a browser with no matchMedia as a pointer', () => {
    // The unit test environment is exactly that, and a `matchMedia` call there
    // throws rather than returning false.
    vi.stubGlobal('matchMedia', undefined);
    expect(coarsePointer()).toBe(false);
    expect(laneFloor()).toBe(FINE_LANE_MIN);
  });
});

describe('the collapsed visual, derived rather than declared', () => {
  it('calls a collapsed lane collapsed on both hands', () => {
    // It was `height <= 32` in `TrackHeader.tsx`, which agreed with the 30 px
    // collapsed lane by coincidence. The touch floor raises that lane to 44,
    // and 44 > 32 — so the literal would have drawn the full control strip in
    // every collapsed header on a phone, in a row two thirds of the size the
    // strip needs.
    for (const kind of ['fine', 'coarse'] as const) {
      withPointer(kind, () => {
        const t = track({ collapsed: true });
        expect(isCollapsedHeight(trackLaneHeight(t, 1), t.collapsed)).toBe(true);
      });
    }
  });

  /**
   * The case that made this take the flag rather than the height.
   *
   * The first version compared the drawn height against the collapsed height,
   * which is the obvious derivation and is wrong on a finger: the floor puts a
   * collapsed lane and the shortest OPEN lane on the same 44 px, so every open
   * track on a phone at minimum zoom reported as collapsed and would have had
   * its whole control strip taken away. Nothing about the height distinguishes
   * them once the floor has done its work, so the flag has to be asked.
   */
  it('does not call an open lane collapsed, at any zoom, on either hand', () => {
    for (const kind of ['fine', 'coarse'] as const) {
      withPointer(kind, () => {
        for (const scale of [MIN_LANE_SCALE, 1, MAX_LANE_SCALE]) {
          const t = track();
          expect(
            isCollapsedHeight(trackLaneHeight(t, scale), t.collapsed),
            `${kind} pointer at scale ${scale}`,
          ).toBe(false);
        }
      });
    }
  });

  it('still collapses a mouse lane dragged shorter than its own strip', () => {
    // The half the flag cannot answer: a track left open and dragged down to
    // where the control strip no longer fits. Only reachable on a fine
    // pointer, because the touch floor is above that height by construction.
    withPointer('fine', () => {
      expect(isCollapsedHeight(trackLaneHeight(track({ height: 26 }), 1), false)).toBe(true);
      expect(isCollapsedHeight(trackLaneHeight(track({ height: 64 }), 1), false)).toBe(false);
    });
  });
});

describe('the global step', () => {
  it('steps up and down by the same ratio and returns', () => {
    expect(stepLaneScale(1, LANE_SCALE_STEP)).toBeCloseTo(1.25, 9);
    expect(stepLaneScale(stepLaneScale(1, LANE_SCALE_STEP), 1 / LANE_SCALE_STEP)).toBe(1);
  });

  it('lands on the ends rather than past them, however many presses', () => {
    let up = 1;
    for (let i = 0; i < 30; i++) up = stepLaneScale(up, LANE_SCALE_STEP);
    expect(up).toBe(MAX_LANE_SCALE);
    let down = 1;
    for (let i = 0; i < 30; i++) down = stepLaneScale(down, 1 / LANE_SCALE_STEP);
    expect(down).toBe(MIN_LANE_SCALE);
  });

  it('quantises, so the readout cannot say 110% twice while the lanes move', () => {
    const stepped = stepLaneScale(1.234567, LANE_SCALE_STEP);
    expect(stepped * 100).toBeCloseTo(Math.round(stepped * 100), 9);
  });
});

describe('the per-track step the touch menu offers', () => {
  it('moves the drawn lane by the step, from the default it was never given', () => {
    withPointer('fine', () => {
      const before = trackLaneHeight(track(), 1);
      const next = stepTrackHeight(track(), 1, 1);
      expect(trackLaneHeight(track({ height: next }), 1)).toBe(before + TRACK_HEIGHT_STEP);
    });
  });

  it('moves the DRAWN lane by the step at every zoom, not the stored base', () => {
    // A step is a step on screen. Stepping the stored base instead would move
    // the lane by 16 x scale, so the same command would travel 9.6 px at the
    // minimum zoom and 40 at the maximum.
    withPointer('fine', () => {
      for (const scale of [0.6, 1, 1.75, 2.5]) {
        const t = track({ height: 80 });
        const drawn = trackLaneHeight(t, scale);
        const next = stepTrackHeight(t, scale, 1);
        expect(trackLaneHeight({ ...t, height: next }, scale)).toBe(drawn + TRACK_HEIGHT_STEP);
      }
    });
  });

  it('shortens as well, and stops at the floor rather than under it', () => {
    withPointer('coarse', () => {
      let h: number | undefined = undefined;
      for (let i = 0; i < 40; i++) h = stepTrackHeight({ height: h, collapsed: false }, 1, -1);
      expect(trackLaneHeight({ height: h, collapsed: false }, 1)).toBe(TOUCH_LANE_MIN);
    });
  });
});

describe('bandHeights, which is what the arrangement lays out from', () => {
  const noClips: Clip[] = [];

  it('gives every track its own height rather than one for all of them', () => {
    withPointer('fine', () => {
      const bands = bandHeights(
        [track({ id: 'a' }), track({ id: 'b', height: 140 }), track({ id: 'c', collapsed: true })],
        noClips,
        1,
      );
      expect(bands.map((b) => b.clip)).toEqual([LANE_H, 140, LANE_H_COLLAPSED]);
    });
  });

  it('carries the floor through to the totals the hit-testing uses', () => {
    // The totals are what maps a Y coordinate to a track. A floor applied to
    // the drawn lane and not to these would put every cross-track drag on the
    // wrong lane by an accumulating amount.
    withPointer('coarse', () => {
      const bands = bandHeights(
        [track({ collapsed: true }), track({ collapsed: true })],
        noClips,
        1,
      );
      expect(bands.map((b) => b.total)).toEqual([TOUCH_LANE_MIN, TOUCH_LANE_MIN]);
    });
  });

  it('still adds the automation and take lanes on top of the clip lane', () => {
    withPointer('fine', () => {
      const t = track({
        automationOpen: true,
        automation: [{ id: 'al', paramId: 'volume', points: [], enabled: true, height: 50 }],
      });
      const [band] = bandHeights([t], noClips, 1);
      expect(band.clip).toBe(LANE_H);
      expect(band.total).toBe(LANE_H + 50);
    });
  });
});
