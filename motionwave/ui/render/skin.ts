/**
 * Motion Wave — a panel's appearance, computed from its declared skin.
 *
 * The skin is data on the face (`PanelSkin`); this turns it into the custom
 * properties and the rules that draw it. Keeping the interpretation here rather
 * than in `facePanel.ts` is what lets that file stay ignorant of which unit it
 * is drawing, which is the property that makes fourteen faces affordable.
 *
 * **The fascia colour is generated, and its ink is solved rather than chosen.**
 * A panel's surface is a hue, a chroma and a lightness the face declares, so it
 * cannot come from the palette tokens — every panel would be the same colour
 * again, which is the failure cell 26 exists for. But a generated background
 * with a hand-picked foreground is how a contrast failure gets shipped: at
 * lightness 46 % neither black nor white clears 4.5:1, and both look fine to
 * someone who is not measuring. So the ink's lightness is searched for until it
 * clears the ratio, in both directions, and the better of the two wins. A panel
 * whose declared colours cannot support legible text fails loudly at build time
 * instead of quietly on a phone in sunlight.
 */
import type { PanelSkin } from '../harness/types';
import { contrastRatio, hslToRgb } from '../design/contrast';

/**
 * Channels in 0…1, matching `design/contrast.ts` — which is where the
 * conversion now lives.
 *
 * Worth recording: the first version of this file carried its own `hslToRgb`
 * returning 0…255 and handed the result straight to `contrastRatio`, which
 * applies the sRGB transfer curve to whatever it is given. Every channel
 * clipped to the top of the curve, every pair came back at 1.00:1, and the ink
 * solver concluded that no lightness anywhere could carry legible text. The
 * units were the entire bug and no type catches it, so the conversion is shared
 * rather than repeated.
 */
type Rgb = { r: number; g: number; b: number };

/** Chroma names to saturation, in percent. */
const CHROMA: Record<PanelSkin['chroma'], number> = { neutral: 4, muted: 13, saturated: 27 };

/** Value names to lightness, in percent. */
const LIGHTNESS: Record<PanelSkin['value'], number> = { light: 78, mid: 47, dark: 16 };

/** What panel text has to clear. 4.5:1 is the contract; this asks for more. */
const INK_CONTRAST = 7;
const MUTED_CONTRAST = 4.5;

/**
 * The ink lightness that clears `wanted` against the fascia by the smallest
 * margin, or −1 if no lightness does.
 *
 * The smallest margin, not the largest, because ink that clears by a mile is
 * ink that has stopped belonging to the panel — pure white legends on a mid
 * grey fascia read as a screenshot of two different objects. Scanned rather
 * than solved in closed form because sRGB's transfer curve is piecewise and
 * luminance is not monotone in HSL lightness once saturation is involved; a
 * hundred candidates cost nothing at panel build time and cannot be wrong the
 * way a remembered pair of hex values can.
 */
function solveInk(fascia: Rgb, hue: number, sat: number, wanted: number): number {
  let best = -1;
  let bestRatio = Infinity;
  for (let l = 0; l <= 100; l++) {
    const ratio = contrastRatio(fascia, hslToRgb(hue, sat, l));
    if (ratio >= wanted && ratio < bestRatio) {
      bestRatio = ratio;
      best = l;
    }
  }
  return best;
}

export interface SkinColours {
  readonly fascia: string;
  readonly fasciaHigh: string;
  readonly fasciaLow: string;
  readonly ink: string;
  readonly inkMuted: string;
  readonly inkRatio: number;
}

/** Thrown when a declared skin cannot carry legible text at all. */
export class SkinContrastError extends Error {
  constructor(era: string, ratio: number) {
    super(`panel skin "${era}" reaches only ${ratio.toFixed(2)}:1 for its own label text`);
    this.name = 'SkinContrastError';
  }
}

export function skinColours(skin: PanelSkin): SkinColours {
  const sat = CHROMA[skin.chroma];
  const light = LIGHTNESS[skin.value];
  const fascia = hslToRgb(skin.hueDeg, sat, light);
  const inkL = solveInk(fascia, skin.hueDeg, Math.min(sat, 18), INK_CONTRAST);
  const mutedL = solveInk(fascia, skin.hueDeg, Math.min(sat, 18), MUTED_CONTRAST);
  if (inkL < 0)
    throw new SkinContrastError(skin.era, contrastRatio(fascia, hslToRgb(skin.hueDeg, sat, 0)));
  const ratio = contrastRatio(fascia, hslToRgb(skin.hueDeg, Math.min(sat, 18), inkL));
  const hsl = (l: number, s = sat) => `hsl(${skin.hueDeg} ${s}% ${l}%)`;
  return {
    fascia: hsl(light),
    // A fascia is a surface with a direction of light on it. Two derived stops
    // rather than a gradient token, because the size of the step is what
    // distinguishes brushed alloy from wrinkle enamel and that is per skin.
    fasciaHigh: hsl(Math.min(97, light + 7)),
    fasciaLow: hsl(Math.max(3, light - 8)),
    ink: hsl(inkL, Math.min(sat, 18)),
    inkMuted: hsl(mutedL < 0 ? inkL : mutedL, Math.min(sat, 18)),
    inkRatio: ratio,
  };
}

/** The custom properties a panel root carries, as declarations. */
export function skinVariables(skin: PanelSkin): Record<string, string> {
  const colours = skinColours(skin);
  return {
    '--mw-fascia': colours.fascia,
    '--mw-fascia-high': colours.fasciaHigh,
    '--mw-fascia-low': colours.fasciaLow,
    '--mw-panel-ink': colours.ink,
    '--mw-panel-ink-muted': colours.inkMuted,
    '--mw-panel-lamp': `var(${skin.lampToken})`,
  };
}
