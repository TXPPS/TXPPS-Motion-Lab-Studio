/**
 * @vitest-environment jsdom
 *
 * jsdom, uniquely in this suite, and only for the knob case. This config runs
 * in node because a cell that reported PASS from jsdom's zero-sized boxes would
 * be reporting a layout nobody has. Nothing here measures a layout: the knob
 * case compares the SVG each body *emits*, which is arithmetic from tokens and
 * needs a Document only to hold the nodes.
 */
/**
 * Every word the skin vocabulary offers means something, on every axis.
 *
 * `value: 'mid'` was the first word with nothing behind it: it could not carry
 * the 7:1 ink `INK_CONTRAST` demands at any hue, so `skinColours` threw for it
 * and two units failed U23 — not because either skin was wrong, but because the
 * type offered a choice that could not be taken. A type that offers an
 * unusable option is worse than one that does not, because the failure arrives
 * after the design work rather than before it.
 *
 * This file is the audit of the other six axes to the same standard, and it
 * asks three separate questions of each term, because a term can fail any of
 * them independently:
 *
 *  1. **Is it implemented at all?** Enforced at module load by
 *     `assertImplements`; asserted here so the mechanism itself has a test.
 *  2. **Does it draw something different from its siblings?** A `surface` whose
 *     rule is a copy of another surface's is a word with an implementation and
 *     no meaning, which is the same defect one layer along.
 *  3. **Is what it draws legible?** Only the colour axes and `lettering` can
 *     move contrast, and `lettering` moves it by putting text on a different
 *     ground — which is how the Variable-Mu shipped its control legends at
 *     3.50:1 against a 4.5 contract.
 *
 * The cross-product is built rather than the combinations anyone happened to
 * pick. That is the whole point: seven units exercise seven skins, and there
 * are several hundred a designer may legally write.
 */
import { describe, expect, it } from 'vitest';
import { skinColours } from '../render/skin';
import { PANEL_CSS } from '../render/panelCss';
import { knobParts } from '../render/controls/knob';
import { SKIN_VOCABULARY, assertImplements, termsStyledBy } from '../design/vocabulary';
import { contrastRatio, hslToRgb } from '../design/contrast';
import type { PanelSkin } from '../harness/types';

/** Hues at the corners and through the middle of the wheel, plus the shipped seven. */
const HUES = [0, 15, 34, 36, 60, 96, 120, 168, 208, 248, 276, 300, 330];

function probe(over: Partial<PanelSkin> = {}): PanelSkin {
  return {
    era: 'vocabulary probe',
    surface: 'painted-steel',
    hueDeg: 208,
    chroma: 'muted',
    value: 'light',
    knob: 'bar',
    arrangement: 'strip',
    lettering: 'engraved',
    furniture: 'none',
    lampToken: '--mw-accent',
    ...over,
  };
}

/** An `hsl(...)` string back to channels, so a declaration can be measured. */
function channels(value: string) {
  const m = value.match(/hsl\((-?[\d.]+) ([\d.]+)% ([\d.]+)%\)/);
  expect(m, `not an hsl() declaration: ${value}`).not.toBeNull();
  return hslToRgb(Number(m![1]), Number(m![2]), Number(m![3]));
}

/** The declarations a stylesheet gives one term, as one comparable string. */
function rulesFor(css: string, attribute: string, term: string): string {
  const blocks: string[] = [];
  const selector = `[${attribute}='${term}']`;
  for (const chunk of css.split('}')) {
    if (chunk.includes(selector)) blocks.push(`${chunk.split('{').slice(1).join('{').trim()}}`);
  }
  return blocks.join('\n');
}

describe('every axis of the skin vocabulary is implemented', () => {
  const drawnByCss = {
    surface: 'data-mw-surface',
    furniture: 'data-mw-furniture',
    lettering: 'data-mw-lettering',
    arrangement: 'data-mw-arrangement',
  } as const;

  for (const [axis, attribute] of Object.entries(drawnByCss)) {
    it(`${axis}: every term has a rule, and no rule has no term`, () => {
      const styled = termsStyledBy(PANEL_CSS, attribute);
      expect(() => assertImplements(axis as never, styled)).not.toThrow();
      expect([...styled].sort()).toEqual([...SKIN_VOCABULARY[axis as never]].sort());
    });

    it(`${axis}: no two terms draw the same thing`, () => {
      // Two surfaces with identical declarations would pass every check above
      // and produce two panels nobody can tell apart, which is cell 26's
      // failure arriving through the vocabulary instead of through the faces.
      const seen = new Map<string, string>();
      for (const term of SKIN_VOCABULARY[axis as never] as readonly string[]) {
        const rules = rulesFor(PANEL_CSS, attribute, term);
        expect(rules.length, `${axis}/${term} has a selector and no declarations`).toBeGreaterThan(
          0,
        );
        const twin = seen.get(rules);
        expect(twin, `${axis}: ${term} draws exactly what ${twin} draws`).toBeUndefined();
        seen.set(rules, term);
      }
    });
  }

  it('knob: every body is drawn, and no two are the same drawing', () => {
    const doc = document;
    const spec = {
      id: 'probe',
      label: 'Probe',
      min: 0,
      max: 1,
      unit: '',
      taper: 'linear',
    } as never;
    const seen = new Map<string, string>();
    for (const knob of SKIN_VOCABULARY.knob) {
      const parts = knobParts(doc, probe({ knob }), spec, 0);
      const rotor = parts.art.querySelector('.mw-knob-rotor');
      expect(rotor, `knob/${knob} drew no rotor`).not.toBeNull();
      const drawing = rotor!.innerHTML;
      expect(drawing.length, `knob/${knob} drew an empty rotor`).toBeGreaterThan(0);
      const twin = seen.get(drawing);
      expect(twin, `knob: ${knob} is the same drawing as ${twin}`).toBeUndefined();
      seen.set(drawing, knob);
    }
  });
});

describe('every colour term carries legible ink', () => {
  for (const value of SKIN_VOCABULARY.value) {
    for (const chroma of SKIN_VOCABULARY.chroma) {
      it(`${value} + ${chroma} is buildable at every hue`, () => {
        for (const hueDeg of HUES) {
          expect(
            () => skinColours(probe({ value, chroma, hueDeg })),
            `${value}/${chroma} at ${hueDeg}deg cannot be built`,
          ).not.toThrow();
        }
      });
    }
  }

  it('the ink clears 7:1 on every stop of the surface gradient, not just the fascia', () => {
    // The regression this exists for: the ink was solved against `--mw-fascia`
    // alone while every surface treatment paints a gradient from
    // `--mw-fascia-high` to `--mw-fascia-low`. The panel title sits on the
    // highlight. Both dark panels measured 5.68:1 and 5.70:1 there and every
    // check passed, because the check and the paint used different grounds.
    for (const hueDeg of HUES) {
      for (const chroma of SKIN_VOCABULARY.chroma) {
        for (const value of SKIN_VOCABULARY.value) {
          const c = skinColours(probe({ hueDeg, chroma, value }));
          for (const ground of [c.fascia, c.fasciaHigh, c.fasciaLow]) {
            const ratio = contrastRatio(channels(ground), channels(c.ink));
            expect(
              ratio,
              `${value}/${chroma}/${hueDeg}deg: ink on ${ground}`,
            ).toBeGreaterThanOrEqual(6.99);
          }
        }
      }
    }
  });

  it('a legend plate is no harder to read than the fascia it is screwed to', () => {
    // `legend-plate` put the label on `--mw-fascia-low`, which on a light panel
    // steps the plate *toward* dark legends. The Variable-Mu shipped at 3.50:1
    // against the 4.5 its muted ink claims, and the Optical Leveller would have
    // measured 3.51 had it declared the same lettering. The plate steps away
    // from the ink now, so it can only ever be easier to read than the fascia.
    for (const hueDeg of HUES) {
      for (const chroma of SKIN_VOCABULARY.chroma) {
        for (const value of SKIN_VOCABULARY.value) {
          const c = skinColours(probe({ hueDeg, chroma, value, lettering: 'legend-plate' }));
          const onPlate = contrastRatio(channels(c.plate), channels(c.inkMuted));
          const onFascia = contrastRatio(channels(c.fascia), channels(c.inkMuted));
          const where = `${value}/${chroma}/${hueDeg}deg`;
          expect(onPlate, `${where}: muted ink on the plate`).toBeGreaterThanOrEqual(4.5);
          expect(onPlate, `${where}: the plate is harder to read than the fascia`).toBeGreaterThan(
            onFascia - 0.01,
          );
        }
      }
    }
  });

  it('the three values stay three appearances', () => {
    // `mid` moved twice to clear a contrast bar and both times it moved toward
    // `light`. If it ever arrives, the vocabulary has three words and two
    // panels — so the resolver pushes `light` further up instead, and this is
    // the assertion that the push actually happened.
    for (const hueDeg of HUES) {
      for (const chroma of SKIN_VOCABULARY.chroma) {
        const at = (value: PanelSkin['value']) =>
          Number(skinColours(probe({ hueDeg, chroma, value })).fascia.match(/([\d.]+)%\)$/)![1]);
        const [dark, mid, light] = [at('dark'), at('mid'), at('light')];
        expect(
          mid - dark,
          `${chroma} at ${hueDeg}deg: mid L${mid} vs dark L${dark}`,
        ).toBeGreaterThanOrEqual(8);
        expect(
          light - mid,
          `${chroma} at ${hueDeg}deg: light L${light} vs mid L${mid}`,
        ).toBeGreaterThanOrEqual(8);
      }
    }
  });
});

describe('the vocabulary check itself works', () => {
  it('names a term with no implementation', () => {
    expect(() => assertImplements('knob', ['bar'])).toThrow(/pointer-skirt/);
  });

  it('names an implementation with no term', () => {
    expect(() => assertImplements('knob', [...SKIN_VOCABULARY.knob, 'hexagonal'])).toThrow(
      /hexagonal/,
    );
  });

  it('reads terms out of a stylesheet rather than a list beside it', () => {
    expect(termsStyledBy(".x[data-mw-surface='glass'] { a: b; }", 'data-mw-surface')).toEqual([
      'glass',
    ]);
    expect(termsStyledBy('.x { a: b; }', 'data-mw-surface')).toEqual([]);
  });
});
