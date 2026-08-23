/**
 * Motion Wave — the design system's contract, as data.
 *
 * The names and the rules live here; the *values* live in `tokens.css` and are
 * read back from it. Keeping the values in one place is what stops the light
 * and dark palettes from drifting apart, and keeping the names here is what
 * lets a test say "the light theme is missing `--mw-meter-over`" instead of
 * "something is undefined".
 */

/** The colour tokens. Every theme must declare all of them, or none of it. */
export const PALETTE_TOKENS = [
  '--mw-bg-app',
  '--mw-bg-panel',
  '--mw-bg-raised',
  '--mw-bg-sunken',
  '--mw-bg-input',
  '--mw-bg-hover',
  '--mw-bg-active',
  '--mw-fg',
  '--mw-fg-muted',
  '--mw-fg-faint',
  '--mw-fg-inverse',
  '--mw-line',
  '--mw-line-strong',
  '--mw-accent',
  '--mw-accent-strong',
  '--mw-accent-fg',
  '--mw-accent-weak',
  '--mw-ok',
  '--mw-ok-fg',
  '--mw-warn',
  '--mw-warn-fg',
  '--mw-danger',
  '--mw-danger-fg',
  '--mw-meter-bg',
  '--mw-meter-low',
  '--mw-meter-mid',
  '--mw-meter-high',
  '--mw-meter-over',
  '--mw-meter-reduction',
  '--mw-automation',
  '--mw-modulation',
  '--mw-focus',
  '--mw-shadow-rgb',
] as const;

/** Every token whose value must be expressed in `rem` — see RA-007. */
export const REM_TOKENS = [
  '--mw-text-3xs',
  '--mw-text-2xs',
  '--mw-text-xs',
  '--mw-text-sm',
  '--mw-text-md',
  '--mw-text-lg',
  '--mw-text-xl',
  '--mw-text-2xl',
  '--mw-text-3xl',
  '--mw-space-0',
  '--mw-space-1',
  '--mw-space-2',
  '--mw-space-3',
  '--mw-space-4',
  '--mw-space-5',
  '--mw-space-6',
  '--mw-space-7',
  '--mw-space-8',
  '--mw-space-9',
  '--mw-control-knob',
  '--mw-control-knob-sm',
  '--mw-control-fader',
  '--mw-control-row',
  '--mw-target-min',
  '--mw-radius-sm',
  '--mw-radius-md',
  '--mw-radius-lg',
  '--mw-radius-pill',
] as const;

/**
 * The two hairline tokens are the only sanctioned `px` dimensions in the
 * system. Listed rather than special-cased in the test, so adding a third
 * requires editing this line and saying why in the commit.
 */
export const PIXEL_TOKENS = ['--mw-hairline', '--mw-hairline-strong'] as const;

/** Durations that `prefers-reduced-motion: reduce` must collapse. */
export const MOTION_DURATION_TOKENS = [
  '--mw-motion-instant',
  '--mw-motion-fast',
  '--mw-motion-base',
  '--mw-motion-slow',
] as const;

/**
 * Foreground/background pairs the product actually puts together, with the
 * WCAG level each has to clear. A pair that is not listed here is a pair no
 * face is allowed to use: the check is only as good as the list, so the list
 * grows when a face introduces a new combination.
 */
export interface ContrastPair {
  readonly foreground: string;
  readonly background: string;
  /** 4.5 for body text and controls, 3 for large text and graphical objects. */
  readonly minimum: number;
  readonly usage: string;
}

export const CONTRAST_PAIRS: readonly ContrastPair[] = [
  { foreground: '--mw-fg', background: '--mw-bg-panel', minimum: 4.5, usage: 'body text' },
  { foreground: '--mw-fg', background: '--mw-bg-app', minimum: 4.5, usage: 'app text' },
  { foreground: '--mw-fg-muted', background: '--mw-bg-panel', minimum: 4.5, usage: 'labels' },
  { foreground: '--mw-fg-faint', background: '--mw-bg-panel', minimum: 4.5, usage: 'readouts' },
  { foreground: '--mw-fg', background: '--mw-bg-raised', minimum: 4.5, usage: 'raised text' },
  { foreground: '--mw-fg', background: '--mw-bg-input', minimum: 4.5, usage: 'field text' },
  { foreground: '--mw-accent', background: '--mw-bg-panel', minimum: 4.5, usage: 'links' },
  { foreground: '--mw-accent-fg', background: '--mw-accent', minimum: 4.5, usage: 'on accent' },
  { foreground: '--mw-ok-fg', background: '--mw-ok', minimum: 4.5, usage: 'on success' },
  { foreground: '--mw-warn-fg', background: '--mw-warn', minimum: 4.5, usage: 'on warning' },
  { foreground: '--mw-danger-fg', background: '--mw-danger', minimum: 4.5, usage: 'on danger' },
  { foreground: '--mw-danger', background: '--mw-bg-panel', minimum: 4.5, usage: 'error text' },
  { foreground: '--mw-ok', background: '--mw-bg-panel', minimum: 4.5, usage: 'ok text' },
  { foreground: '--mw-warn', background: '--mw-bg-panel', minimum: 4.5, usage: 'warn text' },
  { foreground: '--mw-automation', background: '--mw-bg-panel', minimum: 3, usage: 'lanes' },
  { foreground: '--mw-modulation', background: '--mw-bg-panel', minimum: 3, usage: 'mod ring' },
  { foreground: '--mw-meter-low', background: '--mw-meter-bg', minimum: 3, usage: 'meter' },
  { foreground: '--mw-meter-mid', background: '--mw-meter-bg', minimum: 3, usage: 'meter' },
  { foreground: '--mw-meter-high', background: '--mw-meter-bg', minimum: 3, usage: 'meter' },
  { foreground: '--mw-meter-over', background: '--mw-meter-bg', minimum: 3, usage: 'meter' },
  { foreground: '--mw-focus', background: '--mw-bg-panel', minimum: 3, usage: 'focus ring' },
] as const;

/** The three states of the theme contract. "system" stamps no attribute. */
export type ThemeChoice = 'system' | 'light' | 'dark';

/** What a `ThemeChoice` actually resolves to once the OS preference is known. */
export type ResolvedTheme = 'light' | 'dark';
