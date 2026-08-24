/**
 * Motion Wave — WCAG contrast, computed from the token sheet.
 *
 * The harness's themes-and-accessibility cell (U23) has to answer "is this
 * unit's face readable" without a screen, a screenshot or a human. Contrast is
 * the part of that question which is arithmetic on the declared colours, so it
 * is computed rather than eyeballed: a palette pair that fails 4.5:1 fails here
 * before it reaches a face, instead of being discovered by a user in daylight.
 */

/** A colour as linear-light channel values in 0..1. */
interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

/**
 * Parses `#rgb`, `#rrggbb` and the space-separated `r g b` form the shadow
 * token uses. Returns null rather than throwing, because the caller is a test
 * that reports *which* token it could not read — an exception here loses that.
 */
export function parseColour(value: string): Rgb | null {
  const text = value.trim();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(text);
  if (hex !== null) {
    const digits = hex[1];
    const wide =
      digits.length === 3
        ? digits
            .split('')
            .map((d) => d + d)
            .join('')
        : digits;
    return {
      r: Number.parseInt(wide.slice(0, 2), 16) / 255,
      g: Number.parseInt(wide.slice(2, 4), 16) / 255,
      b: Number.parseInt(wide.slice(4, 6), 16) / 255,
    };
  }
  // The panel skins generate their fascia and ink as `hsl()`, because a
  // per-unit surface cannot come from a palette token — see `render/skin.ts`.
  // Parsed here rather than converted at the call site so that every caller
  // measuring contrast measures it the same way.
  const hsl = /^hsl\(\s*(-?[\d.]+)\s+([\d.]+)%\s+([\d.]+)%\s*\)$/i.exec(text);
  if (hsl !== null) return hslToRgb(Number(hsl[1]), Number(hsl[2]), Number(hsl[3]));

  const triple = /^(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})$/.exec(text);
  if (triple !== null) {
    return {
      r: Number(triple[1]) / 255,
      g: Number(triple[2]) / 255,
      b: Number(triple[3]) / 255,
    };
  }
  return null;
}

/** HSL to sRGB, channels in 0…1. The standard piecewise construction. */
export function hslToRgb(h: number, s: number, l: number): Rgb {
  const sat = s / 100;
  const lum = l / 100;
  const c = (1 - Math.abs(2 * lum - 1)) * sat;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const [r1, g1, b1] =
    hp < 1
      ? [c, x, 0]
      : hp < 2
        ? [x, c, 0]
        : hp < 3
          ? [0, c, x]
          : hp < 4
            ? [0, x, c]
            : hp < 5
              ? [x, 0, c]
              : [c, 0, x];
  const m = lum - c / 2;
  return { r: r1 + m, g: g1 + m, b: b1 + m };
}

/** The sRGB transfer function, per WCAG 2.x's definition of relative luminance. */
function toLinear(channel: number): number {
  return channel <= 0.03928 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4);
}

export function relativeLuminance(colour: Rgb): number {
  return 0.2126 * toLinear(colour.r) + 0.7152 * toLinear(colour.g) + 0.0722 * toLinear(colour.b);
}

/** Contrast ratio between two colours, 1..21. Order does not matter. */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Contrast between two token values, or null if either could not be parsed. */
export function tokenContrast(foreground: string, background: string): number | null {
  const fg = parseColour(foreground);
  const bg = parseColour(background);
  if (fg === null || bg === null) return null;
  return contrastRatio(fg, bg);
}
