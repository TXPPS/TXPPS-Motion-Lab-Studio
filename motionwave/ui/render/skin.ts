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
 * clears the ratio, and a panel whose declared colours cannot support legible
 * text fails at load rather than quietly on a phone in sunlight.
 *
 * **The ground is the whole gradient, not the flat fascia.** Solving the ink
 * against `--mw-fascia` alone was wrong, and it shipped: every surface treatment
 * in `panelCss.ts` is a gradient running from `--mw-fascia-high` to
 * `--mw-fascia-low`, so the panel title sits on the highlight and the control
 * legends sit low on it. On the two dark panels the title measured 5.68:1 and
 * 5.70:1 against ink solved for the flat colour — under the 7:1 the skin
 * claimed — and no check could see it, because the check and the paint were
 * using different backgrounds. A ground the text is never drawn on is not the
 * ground.
 */
import type { PanelSkin } from '../harness/types';
import { contrastRatio, hslToRgb } from '../design/contrast';
import { assertImplements } from '../design/vocabulary';

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

/**
 * Fascia lightness per declared value — a *target*, resolved by `legibleFascia`.
 *
 * 47 was the true midpoint and is unreachable at every hue; 59 replaced it and
 * is unreachable at most of them once the gradient counts as the ground. Left
 * at 59 deliberately: the resolver moving it is the honest behaviour, and
 * burying the constraint in this constant would only mean the next hue that
 * cannot use it fails somewhere further from the cause.
 */
const LIGHTNESS: Record<PanelSkin['value'], number> = { light: 78, mid: 59, dark: 16 };

assertImplements('chroma', Object.keys(CHROMA));
assertImplements('value', Object.keys(LIGHTNESS));

/** What panel text has to clear. 4.5:1 is the contract; this asks for more. */
const INK_CONTRAST = 7;
const MUTED_CONTRAST = 4.5;

/**
 * How far the surface gradient runs either side of the fascia.
 *
 * These are the stops every treatment in `panelCss.ts` is built from, so they
 * are the extremes of the ground text is drawn on, and the ink is solved
 * against both. They live beside the solver rather than in the stylesheet that
 * consumes them because changing them changes what legible means.
 */
const SURFACE_HIGH = 7;
const SURFACE_LOW = 8;

/**
 * The least a resolved value may differ from its neighbour, in lightness.
 *
 * Below about eight points two fascias of the same hue read as one colour seen
 * under a highlight, so a vocabulary whose three values resolve closer than
 * this has three words and two appearances. That is the same failure as a word
 * with nothing behind it, one step later, and it is why `resolveValues` throws
 * rather than returning a triple whose middle has collapsed onto an end.
 */
const MIN_VALUE_STEP = 8;

export interface SkinColours {
  readonly fascia: string;
  readonly fasciaHigh: string;
  readonly fasciaLow: string;
  readonly plate: string;
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

/** Thrown when a *vocabulary term* cannot be built at a hue, rather than a skin. */
export class SkinValueError extends Error {
  constructor(value: PanelSkin['value'], hueDeg: number, chroma: string, detail: string) {
    super(`skin value "${value}" is not buildable at ${hueDeg}deg ${chroma}: ${detail}`);
    this.name = 'SkinValueError';
  }
}

/** The three stops of the surface gradient at a given fascia lightness. */
function grounds(lightness: number): readonly number[] {
  return [lightness, Math.min(97, lightness + SURFACE_HIGH), Math.max(3, lightness - SURFACE_LOW)];
}

/**
 * The ink lightness that clears `wanted` against every ground by the smallest
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
function solveInk(
  over: readonly number[],
  hue: number,
  sat: number,
  inkSat: number,
  wanted: number,
): number {
  const grounded: Rgb[] = over.map((l) => hslToRgb(hue, sat, l));
  let best = -1;
  let bestRatio = Infinity;
  for (let l = 0; l <= 100; l++) {
    const ink = hslToRgb(hue, inkSat, l);
    let worst = Infinity;
    for (const ground of grounded) worst = Math.min(worst, contrastRatio(ground, ink));
    if (worst >= wanted && worst < bestRatio) {
      bestRatio = worst;
      best = l;
    }
  }
  return best;
}

/** Both inks solvable over the whole gradient at this fascia lightness. */
function carriesInk(lightness: number, hue: number, sat: number): boolean {
  if (lightness < 0 || lightness > 100) return false;
  const inkSat = Math.min(sat, 18);
  const over = grounds(lightness);
  return (
    solveInk(over, hue, sat, inkSat, INK_CONTRAST) >= 0 &&
    solveInk(over, hue, sat, inkSat, MUTED_CONTRAST) >= 0
  );
}

/**
 * The nearest fascia lightness to `target` that can carry legible ink, never
 * below `floor`.
 *
 * A hue-independent constant cannot do this job, and finding that out is what
 * this function is. Whether a fascia reaches 7:1 depends on its *luminance* —
 * which for one HSL lightness varies enormously with hue, because the green
 * coefficient is ten times the blue one. At 208 deg a lightness of 59 clears the
 * bar over a flat ground and at 0 deg the same 59 does not.
 *
 * The search walks outward and takes the first lightness that works, preferring
 * the lighter side on a tie: a grey panel carrying dark legends is what hardware
 * of every period actually is, and the darker branch would be a different object
 * wearing the same word.
 *
 * `floor` is how the three values stay three. It is passed by `resolveValues`
 * as the previous value plus its minimum step, so a `mid` forced upward by a
 * narrow legible band pushes `light` up rather than colliding with it. Without
 * it, 248 deg muted resolved mid to L71 and light stayed at L78 — seven points
 * apart, which is one panel colour with two names.
 */
function legibleFascia(hue: number, sat: number, target: number, floor: number): number {
  const from = Math.max(target, floor);
  if (carriesInk(from, hue, sat)) return from;
  for (let step = 1; step <= 100; step += 1) {
    if (carriesInk(from + step, hue, sat)) return from + step;
    if (from - step >= floor && carriesInk(from - step, hue, sat)) return from - step;
  }
  return -1;
}

/**
 * All three values resolved together, so `value` is checked as a vocabulary
 * axis rather than one skin at a time.
 *
 * A single skin cannot tell whether its own `mid` has collapsed onto `light`,
 * because it never computes `light`. Resolving the triple is what turns "this
 * panel looks like that one" into a failure at the point the word is used
 * instead of a note somebody makes looking at a screenshot.
 *
 * Darkest first, each one floored above the last. That order matters: `dark` is
 * legible at its target everywhere in the vocabulary, so it anchors the triple,
 * and the two above it move only as far as the legible band forces them.
 *
 * Memoised on hue and saturation: seven faces resolve seven triples, and the
 * cross-product test resolves a few hundred.
 */
const triples = new Map<string, Record<PanelSkin['value'], number>>();

function resolveValues(
  hue: number,
  sat: number,
  chroma: string,
): Record<PanelSkin['value'], number> {
  const key = `${hue}|${sat}`;
  const cached = triples.get(key);
  if (cached) return cached;
  const resolved = {} as Record<PanelSkin['value'], number>;
  let floor = 0;
  for (const value of ['dark', 'mid', 'light'] as const) {
    const at = legibleFascia(hue, sat, LIGHTNESS[value], floor);
    if (at < 0) {
      throw new SkinValueError(
        value,
        hue,
        chroma,
        `no lightness at or above L${floor} carries ${INK_CONTRAST}:1 ink`,
      );
    }
    resolved[value] = at;
    floor = at + MIN_VALUE_STEP;
  }
  triples.set(key, resolved);
  return resolved;
}

export function skinColours(skin: PanelSkin): SkinColours {
  const sat = CHROMA[skin.chroma];
  const inkSat = Math.min(sat, 18);
  const light = resolveValues(skin.hueDeg, sat, skin.chroma)[skin.value];
  const over = grounds(light);
  const inkL = solveInk(over, skin.hueDeg, sat, inkSat, INK_CONTRAST);
  const mutedL = solveInk(over, skin.hueDeg, sat, inkSat, MUTED_CONTRAST);
  if (inkL < 0) {
    throw new SkinContrastError(
      skin.era,
      contrastRatio(hslToRgb(skin.hueDeg, sat, light), hslToRgb(skin.hueDeg, sat, 0)),
    );
  }
  const ink = hslToRgb(skin.hueDeg, inkSat, inkL);
  const ratio = Math.min(...over.map((l) => contrastRatio(hslToRgb(skin.hueDeg, sat, l), ink)));
  const hsl = (l: number, s = sat) => `hsl(${skin.hueDeg} ${s}% ${l}%)`;
  // The legend plate steps *away* from the ink, not toward it.
  //
  // It was `--mw-fascia-low` unconditionally, which on a light panel moves the
  // plate toward dark legends: the Variable-Mu shipped its control labels at
  // 3.50:1 against a 4.5 contract, and the Optical Leveller would have measured
  // 3.51 had it declared the same lettering. A plate is a separate piece of
  // material and nothing about one requires the darker stop — what it requires
  // is to be distinguishable from the fascia and no harder to read than it,
  // which is the direction the ink is not.
  const plate = inkL < light ? Math.min(97, light + SURFACE_LOW) : Math.max(3, light - SURFACE_LOW);
  return {
    fascia: hsl(light),
    // A fascia is a surface with a direction of light on it. Two derived stops
    // rather than a gradient token, because the size of the step is what
    // distinguishes brushed alloy from wrinkle enamel and that is per skin.
    fasciaHigh: hsl(over[1]!),
    fasciaLow: hsl(over[2]!),
    plate: hsl(plate),
    ink: hsl(inkL, inkSat),
    inkMuted: hsl(mutedL < 0 ? inkL : mutedL, inkSat),
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
    '--mw-panel-plate': colours.plate,
    '--mw-panel-ink': colours.ink,
    '--mw-panel-ink-muted': colours.inkMuted,
    '--mw-panel-lamp': `var(${skin.lampToken})`,
  };
}
