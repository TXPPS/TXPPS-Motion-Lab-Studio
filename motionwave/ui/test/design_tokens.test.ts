import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { tokenContrast } from '../design/contrast';
import { readRootFontPx, remToDevicePx, remToPx } from '../design/metrics';
import { applyTheme, paletteSelectorFor, readTheme, resolveTheme } from '../design/theme';
import { allTokenNames, blockFor, readTokenBlocks } from '../design/stylesheet';
import {
  CONTRAST_PAIRS,
  MOTION_DURATION_TOKENS,
  PALETTE_TOKENS,
  PIXEL_TOKENS,
  REM_TOKENS,
} from '../design/tokens';

const CSS = readFileSync(fileURLToPath(new URL('../design/tokens.css', import.meta.url)), 'utf8');
const BLOCKS = readTokenBlocks(CSS);
const ROOT = blockFor(BLOCKS, ':root');
const LIGHT_MEDIA = blockFor(
  BLOCKS,
  ":root:not([data-theme='dark'])",
  '@media (prefers-color-scheme: light)',
);
const LIGHT_ATTRIBUTE = blockFor(BLOCKS, ":root[data-theme='light']");

describe('the type scale is rem-based, which is RA-007 not happening again', () => {
  it('expresses every scale token in rem', () => {
    expect(ROOT).not.toBeNull();
    for (const token of REM_TOKENS) {
      const value = ROOT?.get(token);
      expect(value, `${token} is not declared`).toBeDefined();
      expect(value, `${token} = ${String(value)} is not in rem`).toMatch(/^-?[\d.]+rem$/);
    }
  });

  it('declares no font size in px, pt or any absolute unit', () => {
    const sizes = [...CSS.matchAll(/font-size\s*:\s*([^;}]+)/g)].map((match) => match[1].trim());
    for (const size of sizes) {
      expect(size, `font-size: ${size} does not scale with the root font size`).toMatch(
        /rem|em|%|var\(/,
      );
      expect(size).not.toMatch(/\d(px|pt|pc|in|cm|mm)\b/);
    }
  });

  it('allows px only for the two hairline tokens, which are listed on purpose', () => {
    const pixelValued = allTokenNames(BLOCKS).filter((name) => {
      const value = ROOT?.get(name) ?? '';
      return /\b\d*\.?\d+px\b/.test(value);
    });
    expect(pixelValued.sort()).toEqual([...PIXEL_TOKENS].sort());
  });
});

describe('the three-theme contract', () => {
  it('defines every palette token on bare :root first', () => {
    for (const token of PALETTE_TOKENS) {
      expect(ROOT?.has(token), `${token} is missing from bare :root`).toBe(true);
    }
  });

  it('gives the light theme the same tokens and values in both of its blocks', () => {
    expect(LIGHT_MEDIA).not.toBeNull();
    expect(LIGHT_ATTRIBUTE).not.toBeNull();
    for (const token of PALETTE_TOKENS) {
      expect(LIGHT_MEDIA?.get(token), `media block is missing ${token}`).toBeDefined();
      expect(LIGHT_ATTRIBUTE?.get(token), `attribute block is missing ${token}`).toBeDefined();
      expect(LIGHT_ATTRIBUTE?.get(token), `${token} has drifted between the two light blocks`).toBe(
        LIGHT_MEDIA?.get(token),
      );
    }
  });

  it('guards the light media block against an explicit dark choice', () => {
    // Without the :not() the cascade lets a dark OS override a user who asked
    // for light, and "system" and "dark" become the same setting.
    expect(CSS).toContain("@media (prefers-color-scheme: light)");
    expect(CSS).toContain(":root:not([data-theme='dark'])");
  });

  it('stamps nothing for system and the choice itself otherwise', () => {
    const attributes = new Map<string, string>();
    const target = {
      setAttribute: (name: string, value: string) => attributes.set(name, value),
      removeAttribute: (name: string) => void attributes.delete(name),
      getAttribute: (name: string) => attributes.get(name) ?? null,
    };
    applyTheme(target, 'dark');
    expect(readTheme(target)).toBe('dark');
    applyTheme(target, 'light');
    expect(readTheme(target)).toBe('light');
    applyTheme(target, 'system');
    expect(attributes.size).toBe(0);
    expect(readTheme(target)).toBe('system');
  });

  it('resolves system from the OS preference and an explicit choice from itself', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });

  it('points each theme at the block the browser would actually apply', () => {
    expect(paletteSelectorFor('dark', false)).toEqual({ selector: ':root', media: null });
    expect(paletteSelectorFor('light', true)).toEqual({
      selector: ":root[data-theme='light']",
      media: null,
    });
    expect(paletteSelectorFor('system', false).media).toBe('@media (prefers-color-scheme: light)');
    expect(paletteSelectorFor('system', true)).toEqual({ selector: ':root', media: null });
  });
});

describe('every colour pair the product puts together is legible', () => {
  for (const theme of ['dark', 'light'] as const) {
    const palette = theme === 'dark' ? ROOT : LIGHT_ATTRIBUTE;
    for (const pair of CONTRAST_PAIRS) {
      it(`${theme}: ${pair.usage} clears ${pair.minimum}:1`, () => {
        const ratio = tokenContrast(
          palette?.get(pair.foreground) ?? '',
          palette?.get(pair.background) ?? '',
        );
        expect(ratio, `${pair.foreground} on ${pair.background} did not resolve`).not.toBeNull();
        expect(ratio ?? 0).toBeGreaterThanOrEqual(pair.minimum);
      });
    }
  }
});

describe('motion respects a reduced-motion preference', () => {
  it('collapses every duration token under prefers-reduced-motion', () => {
    const reduced = blockFor(BLOCKS, ':root', '@media (prefers-reduced-motion: reduce)');
    expect(reduced, 'no reduced-motion block in the token sheet').not.toBeNull();
    for (const token of MOTION_DURATION_TOKENS) {
      const value = reduced?.get(token);
      expect(value, `${token} is not collapsed under reduced motion`).toBeDefined();
      expect(Number.parseFloat(value ?? '999')).toBeLessThanOrEqual(1);
    }
  });

  it('keeps the durations non-zero so transitionend still fires', () => {
    const reduced = blockFor(BLOCKS, ':root', '@media (prefers-reduced-motion: reduce)');
    const moving = MOTION_DURATION_TOKENS.filter((token) => token !== '--mw-motion-instant');
    for (const token of moving) {
      expect(Number.parseFloat(reduced?.get(token) ?? '0')).toBeGreaterThan(0);
    }
  });
});

describe('rem conversion for the parts CSS cannot lay out', () => {
  it('scales a drawn dimension with the root font size', () => {
    expect(remToPx(1.5, 16)).toBe(24);
    expect(remToPx(1.5, 32)).toBe(48);
    expect(remToDevicePx(0.375, 16, 2)).toBe(12);
  });

  it('falls back to the CSS initial value rather than throwing', () => {
    const source = {
      getComputedStyle: () => ({ fontSize: 'not a size' }),
      document: { documentElement: {} as Element },
    };
    expect(readRootFontPx(source)).toBe(16);
  });

  it('reads a root size the platform has enlarged', () => {
    const source = {
      getComputedStyle: () => ({ fontSize: '32px' }),
      document: { documentElement: {} as Element },
    };
    expect(readRootFontPx(source)).toBe(32);
  });
});
