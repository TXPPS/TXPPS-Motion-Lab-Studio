/**
 * Motion Wave — the three-theme contract, in one place.
 *
 * There are three states, not two: light, dark, and "follow the system". The
 * third one is the default and it is expressed by stamping *nothing*, so the
 * `prefers-color-scheme` media query in `tokens.css` decides. Writing
 * `data-theme="light"` for a user who is on "system" and happens to be in
 * daylight looks identical until the sun goes down and the shell does not
 * follow — which is the bug this contract exists to prevent.
 */

import type { ResolvedTheme, ThemeChoice } from './tokens';

/** The attribute an explicit choice stamps. Nothing else may write it. */
export const THEME_ATTRIBUTE = 'data-theme';

/** Every value `ThemeChoice` can take, for a settings control to enumerate. */
export const THEME_CHOICES: readonly ThemeChoice[] = ['system', 'light', 'dark'];

/**
 * A narrowed view of what this module needs from the document element, so the
 * contract can be tested without a DOM. The harness runs on hosts that have no
 * document at all, and a theme rule that can only be checked in a browser is a
 * rule that goes unchecked (ADR-0005).
 */
export interface ThemeTarget {
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
  getAttribute(name: string): string | null;
}

/** Applies a choice to the root element. "system" removes the stamp. */
export function applyTheme(target: ThemeTarget, choice: ThemeChoice): void {
  if (choice === 'system') {
    target.removeAttribute(THEME_ATTRIBUTE);
    return;
  }
  target.setAttribute(THEME_ATTRIBUTE, choice);
}

/** The choice currently stamped on an element. An absent stamp is "system". */
export function readTheme(target: ThemeTarget): ThemeChoice {
  const stamped = target.getAttribute(THEME_ATTRIBUTE);
  return stamped === 'light' || stamped === 'dark' ? stamped : 'system';
}

/**
 * What a choice actually resolves to, given the OS preference.
 *
 * `systemPrefersDark` is passed in rather than read from `matchMedia` here
 * because this is the function every consumer shares — a face drawing a
 * canvas, the harness's contrast cell, a settings preview — and only one of
 * those has a window to ask.
 */
export function resolveTheme(choice: ThemeChoice, systemPrefersDark: boolean): ResolvedTheme {
  if (choice === 'light' || choice === 'dark') return choice;
  return systemPrefersDark ? 'dark' : 'light';
}

/**
 * The selector in `tokens.css` that supplies a resolved theme's values, given
 * how the user reached it. The harness uses this to look up the palette it is
 * about to check contrast on, so the check reads the same block the browser
 * would apply rather than a table somebody wrote out by hand.
 */
export function paletteSelectorFor(
  choice: ThemeChoice,
  systemPrefersDark: boolean,
): { selector: string; media: string | null } {
  const resolved = resolveTheme(choice, systemPrefersDark);
  if (choice === 'light') return { selector: ":root[data-theme='light']", media: null };
  if (choice === 'dark') return { selector: ':root', media: null };
  if (resolved === 'light') {
    return {
      selector: ":root:not([data-theme='dark'])",
      media: '@media (prefers-color-scheme: light)',
    };
  }
  return { selector: ':root', media: null };
}
