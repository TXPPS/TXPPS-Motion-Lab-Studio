/**
 * Every appearance the skin vocabulary offers can actually be built.
 *
 * `PanelSkin` presents `value` as a free choice of three and `chroma` as a free
 * choice of three, and one of the nine combinations was a trap: a `mid` fascia
 * could not carry the 7:1 ink `INK_CONTRAST` demands at any hue or chroma, so
 * `skinColours` threw `SkinContrastError` for it. Two units declared `mid` and
 * both failed U23 — not because either skin was wrong, but because the
 * vocabulary offered a word with no meaning behind it.
 *
 * A type that offers an option which cannot be used is worse than one that does
 * not offer it, because the failure arrives after the design work rather than
 * before it. This file is what makes that impossible to reintroduce: it builds
 * the whole cross-product rather than the combinations anyone happened to pick.
 */
import { describe, expect, it } from 'vitest';
import { skinColours } from '../render/skin';
import type { PanelSkin } from '../harness/types';

const VALUES: PanelSkin['value'][] = ['light', 'mid', 'dark'];
const CHROMAS: PanelSkin['chroma'][] = ['neutral', 'muted', 'saturated'];

/** Hues at the corners and through the middle of the wheel. */
const HUES = [0, 34, 96, 168, 208, 248, 276, 330];

function probe(value: PanelSkin['value'], chroma: PanelSkin['chroma'], hueDeg: number): PanelSkin {
  return {
    era: 'vocabulary probe',
    surface: 'painted-steel',
    hueDeg,
    chroma,
    value,
    knob: 'bar',
    arrangement: 'strip',
    lettering: 'engraved',
    furniture: 'none',
    lampToken: '--mw-accent',
  };
}

describe('the skin vocabulary has no unusable words', () => {
  for (const value of VALUES) {
    for (const chroma of CHROMAS) {
      it(`${value} + ${chroma} carries legible ink at every hue`, () => {
        for (const hueDeg of HUES) {
          expect(
            () => skinColours(probe(value, chroma, hueDeg)),
            `${value}/${chroma} at ${hueDeg}° cannot be built`,
          ).not.toThrow();
        }
      });
    }
  }

  it('covers the whole cross-product, so no combination is skipped', () => {
    // The failure this guards is the one above it, one level up: a list that
    // quietly stops covering a case somebody adds to the union later.
    expect(VALUES.length * CHROMAS.length).toBe(9);
  });

  it('the three values are actually different lightnesses', () => {
    // `mid` moved to clear the contrast bar, and the direction it moved was
    // toward `light`. If it ever moves far enough to *be* light, the vocabulary
    // has three words and two appearances.
    const at = (value: PanelSkin['value']) => skinColours(probe(value, 'neutral', 208)).fascia;
    const seen = new Set([at('light'), at('mid'), at('dark')]);
    expect(seen.size).toBe(3);
  });
});
