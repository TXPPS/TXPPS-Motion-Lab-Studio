/**
 * The skin vocabulary, as data — and the check that every word in it means
 * something.
 *
 * `PanelSkin` used to declare its axes as bare TypeScript unions, which made a
 * term look like a free choice when it was not. `value: 'mid'` was in the union
 * and could not be built at any hue: `skinColours` threw for it, after the
 * design work rather than before. That is the failure this file removes, and it
 * removes it in the only way that lasts — by making the union *derived* from a
 * list an implementation has to satisfy, rather than a second copy of one.
 *
 * So the axes live here, the types in `harness/types.ts` are computed from
 * them, and every module that implements an axis calls `assertImplements` at
 * module scope. A term with no implementation therefore throws when the module
 * is loaded, not when a panel is painted — which is the difference between a
 * failing build and a user reporting that a control looks wrong.
 *
 * The check runs in both directions on purpose. A term with no implementation
 * is a word with nothing behind it; an implementation with no term is dead code
 * that reads as coverage, and one of those was already here — six units wore
 * the framework's default panel while seven distinct skins were declared as
 * available.
 *
 * What this file cannot check is whether a term is *legible* at a given hue,
 * because that depends on the hue. `render/skin.ts` owns that half and throws
 * its own error; `test/skin_vocabulary.test.ts` runs the cross-product.
 */

/**
 * Every axis, and every term on it.
 *
 * `chroma` and `value` are colour axes and carry no drawing of their own —
 * `render/skin.ts` turns them into numbers. The other five are drawn, and each
 * names the module that draws it in `IMPLEMENTED_BY` below.
 */
export const SKIN_VOCABULARY = {
  surface: ['painted-steel', 'brushed-alloy', 'wrinkle-enamel', 'anodised', 'moulded', 'glass'],
  chroma: ['neutral', 'muted', 'saturated'],
  value: ['light', 'mid', 'dark'],
  knob: ['pointer-skirt', 'chicken-head', 'fluted', 'bar', 'collet', 'flat-cap'],
  arrangement: ['wide-banded', 'centre-stage', 'strip', 'console', 'field'],
  lettering: ['engraved', 'silkscreen', 'legend-plate'],
  furniture: ['rack-ears', 'bezel', 'none'],
} as const;

export type SkinAxis = keyof typeof SKIN_VOCABULARY;
export type SkinTerm<A extends SkinAxis> = (typeof SKIN_VOCABULARY)[A][number];

/** Where each axis is expected to be implemented, so a failure says where to go. */
export const IMPLEMENTED_BY: Record<SkinAxis, string> = {
  surface: 'render/panelCss.ts',
  chroma: 'render/skin.ts',
  value: 'render/skin.ts',
  knob: 'render/controls/knob.ts',
  arrangement: 'render/panelCss.ts',
  lettering: 'render/panelCss.ts',
  furniture: 'render/panelCss.ts',
};

/** Thrown at module load when an axis and its implementation disagree. */
export class VocabularyError extends Error {
  constructor(axis: SkinAxis, missing: readonly string[], extra: readonly string[], where: string) {
    const parts = [];
    if (missing.length > 0) parts.push(`${where} draws nothing for ${missing.join(', ')}`);
    if (extra.length > 0)
      parts.push(`${where} draws ${extra.join(', ')}, which no skin can ask for`);
    super(`skin vocabulary "${axis}": ${parts.join('; ')}`);
    this.name = 'VocabularyError';
  }
}

/**
 * Assert that `implemented` is exactly the axis, and throw naming the gap.
 *
 * Called at module scope by the implementing module, which is what makes this a
 * load-time failure. Calling it from a test instead would leave the broken
 * module perfectly importable, and a panel would paint a term as nothing.
 */
export function assertImplements(axis: SkinAxis, implemented: Iterable<string>): void {
  const have = new Set(implemented);
  const want: readonly string[] = SKIN_VOCABULARY[axis];
  const missing = want.filter((term) => !have.has(term));
  const extra = [...have].filter((term) => !want.includes(term as never));
  if (missing.length > 0 || extra.length > 0) {
    throw new VocabularyError(axis, missing, extra, IMPLEMENTED_BY[axis]);
  }
}

/**
 * The terms a stylesheet actually has a rule for, read from the sheet itself.
 *
 * Parsed rather than listed beside the rules, because a list beside the rules
 * is the same restatement the unions were: it can agree with the axis while the
 * sheet has stopped carrying the rule. What is wanted is evidence, and the only
 * evidence a stylesheet offers is its own selectors.
 */
export function termsStyledBy(css: string, attribute: string): string[] {
  const found = new Set<string>();
  // String.raw, because a template literal eats the backslashes: the pattern
  // arrived as [data-mw-surface='...'] with the brackets unescaped, which is a
  // valid character class with a range out of order and threw at load. It threw
  // in the right place, at least.
  const pattern = new RegExp(String.raw`\[${attribute}='([^']+)'\]`, 'g');
  for (const match of css.matchAll(pattern)) found.add(match[1]!);
  return [...found];
}

/**
 * Thrown at module load when a rule paints a colour nothing has solved against.
 */
export class PaintSourceError extends Error {
  constructor(attribute: string, term: string, strays: readonly string[]) {
    super(
      `[${attribute}='${term}'] paints from ${strays.join(', ')}, ` +
        `which the ink was never solved against`,
    );
    this.name = 'PaintSourceError';
  }
}

/**
 * Every colour a term's rules name, whatever syntax names it.
 *
 * `termsStyledBy` proves a word has a rule. This proves the rule paints
 * something the contrast solver has actually accounted for, which is a
 * different question and the one the vocabulary audit kept not asking.
 *
 * The ink is solved against the fascia and its two derived stops, and that is
 * only the ground text sits on for as long as every surface treatment is built
 * from those three. Nothing said so. A surface added tomorrow with a
 * `color-mix(in srgb, white 30%, ...)` highlight would ship a panel whose title
 * sits on a ground no check ever saw — the same defect as solving against the
 * flat fascia while the sheet painted a gradient, which shipped, and which is
 * the reason this file exists at all.
 *
 * Every colour syntax is caught rather than the ones currently in use: a hex
 * literal, a named colour, any `rgb()`/`hsl()`/`oklch()` family function, and
 * any custom property. `transparent` and `currentColor` are allowed through —
 * the first contributes nothing and the second is the ink, which is the one
 * colour that does not need solving against itself.
 */
export function paintSources(css: string, attribute: string, term: string): string[] {
  const found = new Set<string>();
  const selector = `[${attribute}='${term}']`;
  for (const chunk of css.split('}')) {
    if (!chunk.includes(selector)) continue;
    const body = chunk.split('{').slice(1).join('{');
    for (const m of body.matchAll(/var\((--[\w-]+)[^)]*\)/g)) found.add(m[1]!);
    for (const m of body.matchAll(/#[0-9a-fA-F]{3,8}\b/g)) found.add(m[0]);
    for (const m of body.matchAll(/\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/g)) {
      found.add(m[0].slice(0, -1));
    }
    // Named colours. Everything that is *not* a bare word is stripped first —
    // `var()` and its custom property, hex literals, and every function name —
    // so what remains in a colour-valued declaration is a keyword or a colour,
    // and the keyword set is small and closed.
    //
    // Stripping the function names matters more than it looks: without it the
    // scan read `radial` out of `radial-gradient` and `high` out of
    // `--mw-fascia-high`, and reported six surfaces painting from a colour
    // called `fascia`. A check that cannot be trusted when it fires is not a
    // check, and the first thing this one did was fire wrongly.
    for (const m of body.matchAll(COLOUR_PROPERTY)) {
      const bare = m[1]!
        .replace(/var\([^)]*\)/g, ' ')
        .replace(/#[0-9a-fA-F]{3,8}/g, ' ')
        .replace(/--[\w-]+/g, ' ')
        .replace(/[\w-]+\(/g, '(');
      for (const word of bare.matchAll(/\b([a-z]{3,})\b/g)) {
        if (!CSS_KEYWORDS.has(word[1]!)) found.add(word[1]!);
      }
    }
  }
  return [...found];
}

/** Declarations whose value can name a colour. */
const COLOUR_PROPERTY =
  /(?:^|\n)\s*(?:background|color|border[\w-]*|fill|stroke|box-shadow|text-shadow)[\w-]*:\s*([^;]+)/g;

/**
 * Words that appear in a colour property and are not colours.
 *
 * Kept deliberately short. Anything not here is reported, and a false report is
 * a word added to this set with the reason visible in the diff — which is the
 * cheap direction to be wrong in. Missing a real colour is the expensive one.
 */
const CSS_KEYWORDS = new Set([
  'transparent',
  'currentcolor',
  'inherit',
  'initial',
  'unset',
  'none',
  'solid',
  'dashed',
  'dotted',
  'inset',
  'srgb',
  'oklab',
  'shorter',
  'longer',
  'hue',
  'from',
  'closest',
  'farthest',
  'side',
  'corner',
  'circle',
  'ellipse',
  'top',
  'bottom',
  'left',
  'right',
  'center',
  'repeat',
  'round',
  'space',
  'cover',
  'contain',
  'fixed',
  'scroll',
  'local',
]);

/**
 * Assert every term on an axis paints only from `allowed`, and throw naming the
 * stray.
 *
 * Called at module scope beside `assertImplements`, for the same reason: a test
 * leaves the module importable, and an importable module paints.
 */
export function assertPaintsFrom(css: string, attribute: string, allowed: readonly string[]): void {
  for (const term of termsStyledBy(css, attribute)) {
    const strays = paintSources(css, attribute, term).filter((c) => !allowed.includes(c));
    if (strays.length > 0) throw new PaintSourceError(attribute, term, strays);
  }
}
