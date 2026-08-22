/**
 * The colours a mix is driven by.
 *
 * Directive 02 §1 reported that the `M` button was doing monitoring. It was
 * not — it was mute, correctly wired. What was true is that mute lit **blue**,
 * and blue is monitoring's colour in every DAW the user had met, so a lit M
 * read as "listening". The bug was a token, not a binding, and the observation
 * was right even though the diagnosis was not.
 *
 * This is the guard. A state colour is part of the product's vocabulary: if
 * mute and monitoring ever share a hue again, a user cannot tell at a glance
 * whether a track is silent or listening, and nothing else on the button says.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const tokens = readFileSync(join(process.cwd(), 'src/styles/tokens.css'), 'utf8');

/** Every value a custom property is given, across all four palettes. */
function valuesOf(name: string): string[] {
  const found = [...tokens.matchAll(new RegExp(`--${name}:\\s*([^;]+);`, 'g'))].map((m) =>
    m[1].trim().toLowerCase(),
  );
  return found;
}

/** Rough hue family of a hex colour, which is all this test needs to judge. */
function family(hex: string): 'red' | 'amber' | 'yellow' | 'green' | 'blue' | 'other' {
  const m = /^#([0-9a-f]{6})$/.exec(hex);
  if (!m) return 'other';
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  if (b > r && b > g + 20) return 'blue';
  if (g > r && g > b + 20) return 'green';
  if (r > b + 40 && g > b + 40) return g > r * 0.82 ? 'yellow' : 'amber';
  if (r > g + 40 && r > b + 40) return 'red';
  return 'other';
}

describe('state colours are distinguishable at a glance', () => {
  it('defines a monitor lamp at all', () => {
    // There was none: monitoring had no colour because it had no control.
    expect(valuesOf('monitor-lamp').length).toBeGreaterThan(0);
  });

  it('lights monitoring blue, in every palette', () => {
    for (const value of valuesOf('monitor-lamp')) {
      expect(family(value), `monitor-lamp ${value}`).toBe('blue');
    }
  });

  it('never lights mute blue, because blue means monitoring', () => {
    for (const value of valuesOf('mute-lamp')) {
      expect(family(value), `mute-lamp ${value}`).not.toBe('blue');
    }
  });

  it('lights mute amber or yellow and the record arm red', () => {
    for (const value of valuesOf('mute-lamp')) {
      expect(['amber', 'yellow'], `mute-lamp ${value}`).toContain(family(value));
    }
    for (const value of valuesOf('danger-lamp')) {
      expect(family(value), `danger-lamp ${value}`).toBe('red');
    }
  });

  it('keeps mute and solo apart, since both live in the warm half', () => {
    // Same family is fine — the same *value* is not, or the two buttons beside
    // each other say the same thing.
    const mute = valuesOf('mute-lamp');
    const solo = valuesOf('solo-lamp');
    for (const m of mute) expect(solo, `mute-lamp ${m} collides with a solo lamp`).not.toContain(m);
  });

  it('defines every state lamp in a rule that a default-theme visitor gets', () => {
    // The three-theme contract: an explicit choice stamps `data-theme` and
    // "system" stamps nothing at all. A token defined only inside
    // `[data-theme='light']` or inside a `prefers-color-scheme` block is
    // undefined for a visitor on the default palette, and the control renders
    // with no colour rather than the wrong one.
    //
    // Which rule a definition sits in is the test, so this reads the selector
    // the definition is inside rather than guessing from indentation — the file
    // has non-palette media blocks above the palettes, and both a bare `:root`
    // and a themed one use two-space bodies.
    const selectorFor = (index: number): string => {
      const open = tokens.lastIndexOf('{', index);
      const prev = Math.max(
        tokens.lastIndexOf('}', open),
        tokens.lastIndexOf('{', open - 1),
        tokens.lastIndexOf('*/', open),
      );
      return tokens.slice(prev + 1, open).trim();
    };
    for (const name of ['mute-lamp', 'solo-lamp', 'danger-lamp', 'monitor-lamp']) {
      const at = tokens.indexOf(`--${name}:`);
      expect(at, `--${name} is never defined`).toBeGreaterThanOrEqual(0);
      const selector = selectorFor(at);
      // Split on commas: a selector list containing a bare `:root` is what a
      // visitor with no `data-theme` attribute matches, and the file writes it
      // across several lines as `:root, :root[data-theme='dark']`.
      const bare = selector
        .split(',')
        .map((part) => part.replace(/\/\*[\s\S]*?\*\//g, '').trim())
        .some((part) => part.endsWith(':root'));
      expect(
        bare,
        `--${name} is first defined on "${selector}", which a default-theme visitor does not match`,
      ).toBe(true);
    }
  });
});
