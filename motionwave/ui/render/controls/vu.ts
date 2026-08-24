/**
 * Motion Wave — the VU meter.
 *
 * The needle's law comes from `ballistics.ts` and is derived from the two
 * published facts about the instrument rather than chosen. What is left here is
 * the scale, the lamp and the drawing.
 *
 * **The scale is a stated deviation.** A standard VU face is not linear in dB:
 * the marks crowd below −7 and open out above it, and the exact fractional
 * positions are part of the printed face rather than of the electrical
 * specification. This draws the scale linear in dB from −20 to +3 VU, which is
 * correct at the top of the scale where the meter is read and progressively
 * optimistic at the bottom where it is not. It is recorded as a deviation in
 * `docs/UNIT_LEDGER.md` rather than quietly approximated, because a meter that
 * disagrees with a hardware meter by a known amount is a different thing from
 * one that disagrees by an unknown amount.
 */
import { VuPointer } from './ballistics';
import { arcPath, polar, svgEl, tickPath } from './svg';

/**
 * Where 0 VU sits in digital full scale.
 *
 * −18 dBFS is the EBU alignment (EBU R68), which is the one the rest of this
 * product's metering already assumes. Naming it here rather than folding it
 * into the arithmetic is what lets a reader check it against the standard.
 */
export const ZERO_VU_DBFS = -18;

const SCALE_MIN_VU = -20;
const SCALE_MAX_VU = 3;
const SWEEP_DEG = 80;

/** Marks a VU face carries. Drawn from this list so the drawing cannot drift. */
const MARKS: readonly { vu: number; major: boolean }[] = [
  { vu: -20, major: true },
  { vu: -10, major: true },
  { vu: -7, major: false },
  { vu: -5, major: true },
  { vu: -3, major: false },
  { vu: -2, major: false },
  { vu: -1, major: false },
  { vu: 0, major: true },
  { vu: 1, major: false },
  { vu: 2, major: false },
  { vu: 3, major: true },
];

const PIVOT_X = 50;
const PIVOT_Y = 60;
const NEEDLE_R = 46;

function degreesFor(vu: number): number {
  const clamped = vu < SCALE_MIN_VU ? SCALE_MIN_VU : vu > SCALE_MAX_VU ? SCALE_MAX_VU : vu;
  const position = (clamped - SCALE_MIN_VU) / (SCALE_MAX_VU - SCALE_MIN_VU);
  return -SWEEP_DEG / 2 + position * SWEEP_DEG;
}

/** Linear amplitude to VU. Silence is pinned rather than allowed to reach −∞. */
function amplitudeToVu(amplitude: number): number {
  const magnitude = Math.abs(amplitude);
  if (magnitude < 1e-6) return SCALE_MIN_VU;
  return 20 * Math.log10(magnitude) - ZERO_VU_DBFS;
}

export interface ReadoutHandle {
  readonly node: HTMLElement;
  /** `nowMs` drives the ballistics; it is the frame clock, not a sample clock. */
  paint(value: number, nowMs: number): void;
  dispose(): void;
}

/**
 * How long the over lamp stays lit after the last excursion.
 *
 * A lamp that tracked the signal would be invisible: an over is a few
 * milliseconds and a display frame is sixteen, so most overs would fall between
 * two frames and never be drawn at all. One second is long enough to be seen
 * across a room and short enough to distinguish two separate overs.
 */
const LAMP_HOLD_MS = 1000;

export function buildVu(doc: Document, accessibleName: string): ReadoutHandle {
  const node = doc.createElement('div');
  node.className = 'mw-vu';
  node.dataset.mwPrimitive = 'vu';
  node.setAttribute('role', 'img');
  node.setAttribute('aria-label', accessibleName);

  const svg = svgEl(doc, 'svg', {
    viewBox: '0 0 100 64',
    class: 'mw-vu-face',
    focusable: 'false',
    'aria-hidden': 'true',
  });
  svg.appendChild(
    svgEl(doc, 'rect', { class: 'mw-vu-plate', x: 0, y: 0, width: 100, height: 64, rx: 3 }),
  );
  svg.appendChild(
    svgEl(doc, 'path', {
      class: 'mw-vu-arc',
      d: arcPath(
        PIVOT_X,
        PIVOT_Y,
        NEEDLE_R + 4,
        degreesFor(SCALE_MIN_VU),
        degreesFor(SCALE_MAX_VU),
      ),
    }),
  );
  // The red field above 0 VU, which is most of how a VU face is read at a
  // glance and the only part of it that is not a tick.
  svg.appendChild(
    svgEl(doc, 'path', {
      class: 'mw-vu-red',
      d: arcPath(PIVOT_X, PIVOT_Y, NEEDLE_R + 4, degreesFor(0), degreesFor(SCALE_MAX_VU)),
    }),
  );
  for (const mark of MARKS) {
    const deg = degreesFor(mark.vu);
    svg.appendChild(
      svgEl(doc, 'path', {
        class: mark.major ? 'mw-vu-tick mw-vu-tick-major' : 'mw-vu-tick',
        d: tickPath(PIVOT_X, PIVOT_Y, mark.major ? NEEDLE_R - 4 : NEEDLE_R - 1, NEEDLE_R + 4, deg),
      }),
    );
    if (mark.major) {
      const at = polar(PIVOT_X, PIVOT_Y, NEEDLE_R - 11, deg);
      const label = svgEl(doc, 'text', {
        class: 'mw-vu-label',
        x: at.x.toFixed(2),
        y: at.y.toFixed(2),
        'text-anchor': 'middle',
        'dominant-baseline': 'middle',
      });
      label.textContent = mark.vu > 0 ? `+${mark.vu}` : String(mark.vu);
      svg.appendChild(label);
    }
  }

  const needle = svgEl(doc, 'path', {
    class: 'mw-vu-needle',
    d: tickPath(PIVOT_X, PIVOT_Y, 4, NEEDLE_R, 0),
  });
  svg.appendChild(needle);
  svg.appendChild(svgEl(doc, 'circle', { class: 'mw-vu-pivot', cx: PIVOT_X, cy: PIVOT_Y, r: 5 }));
  const lamp = svgEl(doc, 'circle', { class: 'mw-vu-lamp', cx: 88, cy: 12, r: 5 });
  svg.appendChild(lamp);
  node.appendChild(svg);

  const pointer = new VuPointer();
  let lastMs: number | null = null;
  let lampUntil = -Infinity;

  return {
    node,
    paint(value, nowMs) {
      const dt = lastMs === null ? 1 / 60 : Math.max(0, (nowMs - lastMs) / 1000);
      lastMs = nowMs;
      // The ballistics act on amplitude, not on the reading. The movement is
      // linear in current and the *scale* is what is nonlinear, so smoothing the
      // decibel value instead would give a needle whose rise time depended on
      // how loud the signal was.
      const settled = pointer.advance(Math.abs(value), dt);
      needle.setAttribute(
        'transform',
        `rotate(${degreesFor(amplitudeToVu(settled)).toFixed(3)} ${PIVOT_X} ${PIVOT_Y})`,
      );
      if (amplitudeToVu(Math.abs(value)) >= SCALE_MAX_VU) lampUntil = nowMs + LAMP_HOLD_MS;
      lamp.dataset.mwOn = nowMs < lampUntil ? 'true' : 'false';
      node.dataset.mwValue = settled.toFixed(6);
    },
    dispose() {
      node.remove();
    },
  };
}
