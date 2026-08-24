/**
 * Motion Wave — the SVG a control primitive is drawn from.
 *
 * SVG rather than canvas, for two reasons that both come from where these
 * panels run. A canvas needs its own device-pixel-ratio handling and redraws on
 * every resize; an SVG is resolution-independent for free, which matters on a
 * phone whose ratio is 3. And a canvas cannot be themed by CSS, so every colour
 * would have to be read out of the design tokens in JavaScript and re-read on
 * every theme change — a second copy of the palette, which is exactly what
 * `design/tokens.ts` exists to prevent.
 *
 * Nothing here is traced, photographed or licensed. Every mark is arithmetic.
 */

const NS = 'http://www.w3.org/2000/svg';

export function svgEl<K extends keyof SVGElementTagNameMap>(
  doc: Document,
  tag: K,
  attrs: Record<string, string | number> = {},
): SVGElementTagNameMap[K] {
  const node = doc.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  return node;
}

/**
 * A point at `deg` from twelve o'clock, clockwise.
 *
 * The same frame `gesture.ts` measures the pointer in. Two frames is one frame
 * too many: the first thing that goes wrong when the drawing and the gesture
 * disagree is that a knob turns the wrong way at the top of its sweep only,
 * which reads as a rendering glitch rather than as a sign convention.
 */
export function polar(cx: number, cy: number, r: number, deg: number): { x: number; y: number } {
  const rad = ((deg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

/** An arc path from `fromDeg` to `toDeg`, both from twelve o'clock, clockwise. */
export function arcPath(cx: number, cy: number, r: number, fromDeg: number, toDeg: number): string {
  const a = polar(cx, cy, r, fromDeg);
  const b = polar(cx, cy, r, toDeg);
  const large = Math.abs(toDeg - fromDeg) > 180 ? 1 : 0;
  const sweep = toDeg >= fromDeg ? 1 : 0;
  return `M ${a.x.toFixed(3)} ${a.y.toFixed(3)} A ${r} ${r} 0 ${large} ${sweep} ${b.x.toFixed(3)} ${b.y.toFixed(3)}`;
}

/** A radial tick from `inner` to `outer` at `deg`. */
export function tickPath(
  cx: number,
  cy: number,
  inner: number,
  outer: number,
  deg: number,
): string {
  const a = polar(cx, cy, inner, deg);
  const b = polar(cx, cy, outer, deg);
  return `M ${a.x.toFixed(3)} ${a.y.toFixed(3)} L ${b.x.toFixed(3)} ${b.y.toFixed(3)}`;
}

/** The drawing surface every rotary primitive shares: a 100×100 square. */
export function rotaryCanvas(doc: Document, className: string): SVGSVGElement {
  const svg = svgEl(doc, 'svg', {
    viewBox: '0 0 100 100',
    class: className,
    focusable: 'false',
    'aria-hidden': 'true',
  });
  return svg;
}
