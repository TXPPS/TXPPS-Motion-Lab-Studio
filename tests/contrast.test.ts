/**
 * The app's palette is legible, in every theme it ships.
 *
 * Motion Wave has had this check since it was written; the app has not, and it
 * cost exactly what an unchecked palette costs. The accent shipped at **4.12:1
 * on dark and 3.80:1 on light** — both under the 4.5:1 the same product
 * enforces one directory over — and nobody knew, because nothing was looking.
 * It was found by arithmetic done for an unrelated reason.
 *
 * The maths and the CSS parsing are imported from `motionwave/ui/design/`
 * rather than rewritten here. A second implementation of a check is not a
 * second proof; it is a second thing that can be wrong, and the two would
 * disagree the first time either was fixed. This is a test importing pure
 * functions, not `src/` taking a dependency on `motionwave/` — that boundary
 * (CLAUDE.md, "Motion Wave core: the rules that are not negotiable") is about
 * the shipped product and is untouched.
 *
 * The pair list is the check. A pair that is not listed is a pair nothing
 * verifies, so the list grows whenever a surface starts carrying a colour it
 * did not before.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { tokenContrast } from '../motionwave/ui/design/contrast';
import { readTokenBlocks } from '../motionwave/ui/design/stylesheet';

const CSS = readFileSync(join(process.cwd(), 'src/styles/tokens.css'), 'utf8');

/**
 * Every block that carries a palette, discovered rather than listed.
 *
 * Listing them by selector was wrong twice over. The dark palette is declared
 * under `:root, :root[data-theme='dark']` — a two-selector rule whose text
 * contains the file's own line ending, so matching it literally is a check that
 * passes on one operating system and not the other. And a listed set is a set
 * that silently stops covering a palette somebody adds later, which is the
 * failure this whole file exists to catch, one level up.
 *
 * A block declaring `--accent` is a palette. That is the definition, and it
 * cannot go stale.
 */
const PALETTES = readTokenBlocks(CSS)
  .filter((block) => block.declarations.has('--accent'))
  .map((block) => ({
    name: `${block.selector.replace(/\s+/g, ' ')}${block.media ? ` in ${block.media}` : ''}`,
    tokens: block.declarations,
  }));

interface Pair {
  readonly fg: string;
  readonly bg: string;
  readonly minimum: number;
  readonly usage: string;
}

/**
 * What the product actually puts on what.
 *
 * 4.5 for anything carrying text or a glyph, 3 for a graphical object — a lane,
 * a meter fill, a focus ring — per WCAG 1.4.3 and 1.4.11.
 *
 * `--text-faint` is listed on `--bg-panel` only, and that is deliberate rather
 * than an oversight: the token sheet's own comment records that faint on
 * `--bg-raised` / `--bg-hover` / `--bg-active` measures 4.35 / 3.76 / 3.21, and
 * that those are control-cap and chrome-selection surfaces which carry
 * `--text-dim` or `--text` instead. Listing them here would fail a combination
 * the product does not use.
 */
const PAIRS: readonly Pair[] = [
  // Body text, on every ground it is drawn on.
  { fg: '--text', bg: '--bg-app', minimum: 4.5, usage: 'app text' },
  { fg: '--text', bg: '--bg-panel', minimum: 4.5, usage: 'panel text' },
  { fg: '--text', bg: '--bg-panel-2', minimum: 4.5, usage: 'panel-2 text' },
  { fg: '--text', bg: '--bg-float', minimum: 4.5, usage: 'menu text' },
  { fg: '--text', bg: '--bg-raised', minimum: 4.5, usage: 'button-cap text' },
  { fg: '--text', bg: '--bg-hover', minimum: 4.5, usage: 'hovered text' },
  { fg: '--text', bg: '--bg-active', minimum: 4.5, usage: 'pressed text' },
  { fg: '--text', bg: '--bg-input', minimum: 4.5, usage: 'field text' },
  { fg: '--text', bg: '--bg-well', minimum: 4.5, usage: 'well text' },
  { fg: '--text-dim', bg: '--bg-panel', minimum: 4.5, usage: 'labels' },
  { fg: '--text-dim', bg: '--bg-raised', minimum: 4.5, usage: 'cap labels' },
  { fg: '--text-faint', bg: '--bg-panel', minimum: 4.5, usage: 'faint readouts' },

  // The accent, wherever it is drawn as a value rather than a wash.
  { fg: '--accent', bg: '--bg-app', minimum: 4.5, usage: 'accent on app' },
  { fg: '--accent', bg: '--bg-panel', minimum: 4.5, usage: 'accent on panel' },
  { fg: '--accent', bg: '--bg-raised', minimum: 4.5, usage: 'accent on a cap' },
  { fg: '--accent', bg: '--bg-float', minimum: 4.5, usage: 'accent in a menu' },
  { fg: '--accent', bg: '--bg-active', minimum: 4.5, usage: 'accent when pressed' },

  // Every lit lamp carries `--lamp-ink` as its glyph.
  { fg: '--lamp-ink', bg: '--accent-lamp', minimum: 4.5, usage: 'ink on the signal lamp' },
  { fg: '--lamp-ink', bg: '--solo-lamp', minimum: 4.5, usage: 'ink on the solo lamp' },
  { fg: '--lamp-ink', bg: '--mute-lamp', minimum: 4.5, usage: 'ink on the mute lamp' },
  { fg: '--lamp-ink', bg: '--monitor-lamp', minimum: 4.5, usage: 'ink on the monitor lamp' },
  { fg: '--lamp-ink', bg: '--danger-lamp', minimum: 4.5, usage: 'ink on the record lamp' },
  { fg: '--lamp-ink', bg: '--key-lamp', minimum: 4.5, usage: 'ink on the key lamp' },

  // Status text.
  { fg: '--danger-text', bg: '--bg-panel', minimum: 4.5, usage: 'error text' },

  // Graphical objects: 3:1 is the bar, and they carry no glyph.
  { fg: '--border-strong', bg: '--bg-panel', minimum: 3, usage: 'a border that means something' },
  { fg: '--monitor', bg: '--bg-panel', minimum: 3, usage: 'monitor state' },
  { fg: '--warm', bg: '--bg-panel', minimum: 3, usage: 'loop and tempo marks' },
];

describe('every palette the app ships is legible', () => {
  it('found the palettes at all', () => {
    // Four today: dark, light by preference, light by choice, and contrast —
    // plus the contrast-by-preference block. If this ever reads one, the
    // discovery above has stopped working and every case below is checking the
    // same palette four times.
    expect(
      PALETTES.length,
      `found ${PALETTES.map((p) => p.name).join(', ')}`,
    ).toBeGreaterThanOrEqual(4);
  });

  for (const palette of PALETTES) {
    describe(palette.name, () => {
      it.each(PAIRS.map((p) => [`${p.fg} on ${p.bg} (${p.usage})`, p] as const))(
        '%s',
        (_label, pair) => {
          const fg = palette.tokens.get(pair.fg);
          const bg = palette.tokens.get(pair.bg);
          // A palette need not redeclare every token — the three-theme contract
          // has bare `:root` carry the defaults — so one it does not override is
          // checked in the block that declares it.
          if (fg === undefined || bg === undefined) return;
          const ratio = tokenContrast(fg, bg);
          expect(
            ratio,
            `${pair.fg} = ${fg} or ${pair.bg} = ${bg} could not be read`,
          ).not.toBeNull();
          expect(
            ratio ?? 0,
            `${palette.name}: ${pair.fg} (${fg}) on ${pair.bg} (${bg}) is ` +
              `${(ratio ?? 0).toFixed(2)}:1, under the ${pair.minimum}:1 that ${pair.usage} needs`,
          ).toBeGreaterThanOrEqual(pair.minimum);
        },
      );
    });
  }

  it('resolves the pairs it claims to check', () => {
    // The failure this guards is a rename that turns every case above into the
    // early return two lines up: all green, nothing checked. It has already
    // caught exactly that once, when the dark palette was being looked up under
    // a selector that matched the metrics block instead.
    for (const palette of PALETTES) {
      const readable = PAIRS.filter(
        (p) => palette.tokens.get(p.fg) !== undefined && palette.tokens.get(p.bg) !== undefined,
      );
      expect(
        readable.length,
        `${palette.name} resolved only ${readable.length} of ${PAIRS.length} pairs`,
      ).toBeGreaterThan(PAIRS.length - 6);
    }
  });
});
