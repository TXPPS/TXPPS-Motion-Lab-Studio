/**
 * Motion Wave — the readouts that are not a VU meter: bar, lamp, numeric.
 *
 * All three take a published frame value and draw it. None of them can reach
 * into the audio path to ask for one, which is the property the seqlock exists
 * to give and the reason a readout is handed a number rather than a source.
 */
import { svgEl } from './svg';
import type { ReadoutHandle } from './vu';

/**
 * Peak hold, in milliseconds.
 *
 * The same argument as the VU's over lamp: a peak is shorter than a display
 * frame, so a bar that showed only the current value would show a number that
 * is true and useless. Held long enough to read, short enough to follow a
 * performance.
 */
const PEAK_HOLD_MS = 1400;

/** Bar meter with a peak line, for level and for gain reduction alike. */
export function buildBar(doc: Document, accessibleName: string, reduction: boolean): ReadoutHandle {
  const node = doc.createElement('div');
  node.className = reduction ? 'mw-bar mw-bar-reduction' : 'mw-bar';
  node.dataset.mwPrimitive = 'meter';
  node.setAttribute('role', 'img');
  node.setAttribute('aria-label', accessibleName);

  const fill = doc.createElement('span');
  fill.className = 'mw-bar-fill';
  const peak = doc.createElement('span');
  peak.className = 'mw-bar-peak';
  node.appendChild(fill);
  node.appendChild(peak);

  let held = 0;
  let heldUntil = -Infinity;

  return {
    node,
    paint(value, nowMs) {
      const clamped = value < 0 ? 0 : value > 1 ? 1 : value;
      if (clamped >= held || nowMs > heldUntil) {
        held = clamped;
        heldUntil = nowMs + PEAK_HOLD_MS;
      }
      // Gain reduction grows downward from the top: it is an amount taken away,
      // and a reduction meter that filled from the bottom like a level meter
      // would read as more signal at exactly the moment there is less.
      fill.style.setProperty('--mw-bar-extent', `${(clamped * 100).toFixed(2)}%`);
      peak.style.setProperty('--mw-bar-peak', `${(held * 100).toFixed(2)}%`);
      node.dataset.mwValue = clamped.toFixed(6);
    },
    dispose() {
      node.remove();
    },
  };
}

/**
 * A lamp: on above its threshold, with the same hold a meter's peak gets.
 *
 * Threshold rather than brightness because that is what a lamp on a panel is —
 * a neon or an LED with a driver behind it, not a dimmer. A lamp that faded
 * would be a second, worse meter.
 */
export function buildLamp(doc: Document, accessibleName: string, threshold: number): ReadoutHandle {
  const node = doc.createElement('div');
  node.className = 'mw-lamp';
  node.dataset.mwPrimitive = 'lamp';
  node.setAttribute('role', 'img');
  node.setAttribute('aria-label', accessibleName);

  const svg = svgEl(doc, 'svg', {
    viewBox: '0 0 24 24',
    class: 'mw-lamp-face',
    focusable: 'false',
    'aria-hidden': 'true',
  });
  svg.appendChild(svgEl(doc, 'circle', { class: 'mw-lamp-bezel', cx: 12, cy: 12, r: 11 }));
  svg.appendChild(svgEl(doc, 'circle', { class: 'mw-lamp-glass', cx: 12, cy: 12, r: 7 }));
  node.appendChild(svg);

  let until = -Infinity;
  return {
    node,
    paint(value, nowMs) {
      if (value >= threshold) until = nowMs + PEAK_HOLD_MS / 2;
      node.dataset.mwOn = nowMs < until ? 'true' : 'false';
      node.dataset.mwValue = value.toFixed(6);
    },
    dispose() {
      node.remove();
    },
  };
}

/** A numeric readout, for the quantities a bar cannot say precisely enough. */
export function buildDisplay(doc: Document, accessibleName: string, suffix: string): ReadoutHandle {
  const node = doc.createElement('div');
  node.className = 'mw-display';
  node.dataset.mwPrimitive = 'display';
  node.setAttribute('role', 'img');
  node.setAttribute('aria-label', accessibleName);
  const text = doc.createElement('span');
  text.className = 'mw-display-text';
  node.appendChild(text);
  return {
    node,
    paint(value) {
      text.textContent = `${value.toFixed(2)}${suffix}`;
      node.dataset.mwValue = value.toFixed(6);
    },
    dispose() {
      node.remove();
    },
  };
}
