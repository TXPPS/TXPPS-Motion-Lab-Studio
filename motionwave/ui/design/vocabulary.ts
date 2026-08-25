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
