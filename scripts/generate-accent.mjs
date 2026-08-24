#!/usr/bin/env node
/**
 * The accent family, derived from one colour.
 *
 * The accent is not one token. It is a base, a brighter emphasis, a dimmer
 * non-text fill, a lit-lamp fill, two translucent washes, and — on the Motion
 * Wave side — a strong, a weak, an ink and a focus ring. Set independently they
 * drift: a lamp ends up a slightly different green from the button it sits on,
 * and nobody can say which one is wrong. Set from one base, they move together.
 *
 * The base itself comes from the product's logo: the icon is an oscilloscope
 * screen with a green trace, and `ACCENT_HUE`/`ACCENT_SAT` below are that
 * trace's measured hue and saturation. Only lightness is chosen, and it is
 * chosen by contrast rather than by eye — see `solve` below.
 *
 *   node scripts/generate-accent.mjs           # rewrite both token sheets
 *   node scripts/generate-accent.mjs --check   # fail if they have drifted
 *
 * `--check` is what makes "derived" true rather than aspirational: a hand-edited
 * accent fails it, so the only way to change the colour is to change the base.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Measured from `assets/MotionLab Studio - Logo & App Icon.png`.
 *
 * Method: crop to the CRT screen inside the bezel (12% inset, which clears the
 * bezel's inner highlight ring — the same green, and it would have pulled the
 * sample toward chrome). Drop the near-black screen (V <= 0.25) and the
 * near-white hot trace core (S <= 0.35); 15.5% of the region survives, which is
 * the trace and its glow. Histogram hue in 2-degree bins weighted by S*V — a
 * single clean peak at 105 degrees. Saturation is not a gradient in this
 * artwork: every dense (S,V) cell sits at 0.97.
 *
 * A plain average over the whole image gives #0d1b07, which is near-black mud —
 * the region and the exclusions are what make this a colour rather than a
 * smear.
 */
export const ACCENT_HUE = 105;
export const ACCENT_SAT = 0.97;

/** What each palette's focus ring managed against its own accent. */
export const focusReport = [];

const ROOT = process.cwd();
const APP_CSS = join(ROOT, 'src/styles/tokens.css');
const MW_CSS = join(ROOT, 'motionwave/ui/design/tokens.css');

// ----------------------------------------------------------------- colour

function hsvToRgb(h, s, v) {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  const [r, g, b] =
    h < 60
      ? [c, x, 0]
      : h < 120
        ? [x, c, 0]
        : h < 180
          ? [0, c, x]
          : h < 240
            ? [0, x, c]
            : h < 300
              ? [x, 0, c]
              : [c, 0, x];
  return [r + m, g + m, b + m].map((n) => Math.round(n * 255));
}

const hex = (h, s, v) =>
  '#' +
  hsvToRgb(h, s, v)
    .map((n) => n.toString(16).padStart(2, '0'))
    .join('');

function parseHex(value) {
  const m = /^#([0-9a-f]{6})$/i.exec(value.trim());
  if (!m) return null;
  const n = Number.parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const channel = (c) => (c / 255 <= 0.04045 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4);
const luminance = ([r, g, b]) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);

function contrast(a, b) {
  const la = luminance(typeof a === 'string' ? parseHex(a) : a);
  const lb = luminance(typeof b === 'string' ? parseHex(b) : b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * The lightest (or darkest) value at the accent's hue that still clears
 * `minimum` against every surface given.
 *
 * Searched rather than guessed. Hue and saturation are measurements and are not
 * negotiable; value is the only free parameter, so it is the only one that gets
 * to absorb the contrast requirement — and picking the extreme that still
 * passes keeps the colour as close to the logo's own brightness as the surfaces
 * allow.
 */
function solve({ from, toward, against, minimum, sat = ACCENT_SAT }) {
  const step = toward > from ? 0.005 : -0.005;
  let best = null;
  for (let v = from; toward > from ? v <= toward : v >= toward; v += step) {
    const c = hex(ACCENT_HUE, sat, v);
    if (against.every((bg) => contrast(c, bg) >= minimum)) best = { v, hex: c };
    else if (best) break;
  }
  if (!best) {
    throw new Error(
      `no value at hue ${ACCENT_HUE} clears ${minimum}:1 against ${against.join(', ')}`,
    );
  }
  return best;
}

/** Black or white ink, whichever reads better on the given fill. */
const inkFor = (fill, dark, light) =>
  contrast(fill, dark) >= contrast(fill, light) ? dark : light;

const rgba = (h, alpha) => {
  const [r, g, b] = parseHex(h);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

// ------------------------------------------------------------- derivation

/**
 * Every accent token for one palette, from that palette's own surfaces.
 *
 * `lighter` says which direction is *away* from the background: on a dark
 * palette the emphasis colour is brighter and the dim one is darker, and on a
 * light palette it is the other way round. Deriving that from the palette
 * rather than writing it per token is what stops a light theme inheriting a
 * dark theme's idea of "stronger".
 */
export function accentFamily({
  surfaces,
  lighter,
  lampInk,
  bgAlpha,
  lineAlpha,
  minimum = 4.5,
  base: given,
}) {
  // A caller may hand in the base it solved elsewhere. That is how the app and
  // the unit panels end up the *same* green: solved per file, each one found
  // the darkest value its own surfaces allowed, and the two sheets came out
  // visibly different greens sitting side by side in one window.
  const base =
    given ??
    (lighter
      ? solve({ from: 1, toward: 0.2, against: surfaces, minimum })
      : solve({ from: 0.05, toward: 1, against: surfaces, minimum }));

  // Emphasis moves away from the surface, dim moves toward it. Both are bounded
  // by the same contrast rule the base is, so "brighter" can never mean
  // "unreadable".
  const hi = lighter
    ? {
        v: Math.min(1, base.v + 0.16),
        hex: hex(ACCENT_HUE, ACCENT_SAT, Math.min(1, base.v + 0.16)),
      }
    : {
        v: Math.max(0.05, base.v - 0.14),
        hex: hex(ACCENT_HUE, ACCENT_SAT, Math.max(0.05, base.v - 0.14)),
      };
  const dimV = lighter ? Math.max(0.05, base.v - 0.28) : Math.min(1, base.v + 0.3);
  const dim = { v: dimV, hex: hex(ACCENT_HUE, ACCENT_SAT, dimV) };

  // The lamp carries `--lamp-ink` as a glyph, so it is solved against the ink
  // rather than against the panel: a lit lamp nobody can read the legend on is
  // the failure this token exists to avoid.
  const lamp = solve({ from: 1, toward: 0.3, against: [lampInk], minimum: 4.5 });

  return {
    accent: base.hex,
    'accent-hi': hi.hex,
    'accent-dim': dim.hex,
    'accent-lamp': lamp.hex,
    'accent-bg': rgba(base.hex, bgAlpha),
    'accent-line': rgba(base.hex, lineAlpha),
  };
}

/** The Motion Wave family, which names its tokens differently. */
export function mwAccentFamily({ surfaces, lighter, minimum = 4.5, base: given }) {
  const base =
    given ??
    (lighter
      ? solve({ from: 1, toward: 0.2, against: surfaces, minimum })
      : solve({ from: 0.05, toward: 1, against: surfaces, minimum }));
  const strongV = lighter ? Math.min(1, base.v + 0.16) : Math.max(0.05, base.v - 0.14);
  const weakV = lighter ? Math.max(0.08, base.v - 0.5) : Math.min(1, base.v + 0.42);

  /*
   * The focus ring is the accent's own emphasis colour.
   *
   * `.mw-ctl:focus-within` draws it as an `outline` with `outline-offset`, so
   * the ring sits *outside* the control with a gap — on the panel, never on the
   * accent fill. The rule it has to satisfy is therefore the one the token sheet
   * already codifies, 3:1 against the panel, and an earlier attempt here to also
   * hold it 3:1 against the accent was solving a constraint the geometry does
   * not impose. That attempt produced a near-black ring on the light palette,
   * which is worse than the problem it was chasing.
   *
   * If the ring ever moves inside the control, this stops being true and needs a
   * two-tone treatment — a light core over a dark halo — because no single
   * colour can stand 3:1 off both a near-white panel and a mid-dark fill.
   *
   * What this does fix: `--mw-focus` and `--mw-accent` were the *same hex* on
   * the light palette and 1.37:1 apart on dark, so the ring was invisible
   * wherever it mattered most. Being the emphasis colour makes it a deliberate
   * step away from the accent rather than a coincidence.
   */
  const focusHex = hex(ACCENT_HUE, ACCENT_SAT, strongV);
  const focusVsPanels = Math.min(...surfaces.map((bg) => contrast(focusHex, bg)));
  if (focusVsPanels < 3) {
    throw new Error(`focus ring ${focusHex} is only ${focusVsPanels.toFixed(2)}:1 on its panels`);
  }
  focusReport.push({ lighter, hex: focusHex, vsPanels: focusVsPanels, accent: base.hex });

  return {
    'mw-accent': base.hex,
    'mw-accent-strong': hex(ACCENT_HUE, ACCENT_SAT, strongV),
    'mw-accent-fg': inkFor(base.hex, '#04131f', '#ffffff'),
    'mw-accent-weak': hex(ACCENT_HUE, lighter ? ACCENT_SAT * 0.85 : ACCENT_SAT * 0.35, weakV),
    'mw-focus': focusHex,
  };
}

// ------------------------------------------------------------------ rewrite

/** Replace `--name: value;` inside one block, preserving any trailing comment. */
function setToken(css, blockStart, blockEnd, name, value) {
  const head = css.slice(0, blockStart);
  const body = css.slice(blockStart, blockEnd);
  const tail = css.slice(blockEnd);
  const re = new RegExp(`(--${name}:\\s*)([^;]+)(;)`);
  if (!re.test(body)) return css;
  return head + body.replace(re, `$1${value}$3`) + tail;
}

/** Every `{ ... }` rule body that declares `--<probe>`, in source order. */
function blocksDeclaring(css, probe) {
  const out = [];
  const re = new RegExp(`--${probe}:`, 'g');
  let m;
  while ((m = re.exec(css)) !== null) {
    const open = css.lastIndexOf('{', m.index);
    const close = css.indexOf('}', m.index);
    if (open !== -1 && close !== -1) out.push({ start: open, end: close });
  }
  return out;
}

/** Read a surface token's value out of one block. */
function surfaceIn(css, block, name) {
  const body = css.slice(block.start, block.end);
  const m = new RegExp(`--${name}:\\s*([^;]+);`).exec(body);
  return m ? m[1].trim() : null;
}

function rewrite(path, probe, familyFor) {
  let css = readFileSync(path, 'utf8');
  // Recomputed each pass: replacing a value changes later offsets.
  for (let i = 0; ; i += 1) {
    const blocks = blocksDeclaring(css, probe);
    if (i >= blocks.length) break;
    const block = blocks[i];
    const family = familyFor(css, block);
    if (!family) continue;
    for (const [name, value] of Object.entries(family)) {
      css = setToken(css, block.start, block.end, name, value);
    }
  }
  return css;
}

// --------------------------------------------------------------------- run

const check = process.argv.includes('--check');
const results = [];

/**
 * One green for the whole product, per theme.
 *
 * Every surface the accent can sit on, in either file, gathered before anything
 * is solved. Solved per file instead, each sheet found the darkest value its own
 * backgrounds allowed — the unit panels are darker than the app, so they got a
 * darker green, and the two sat side by side in one window looking like a
 * mistake. The accent is a brand colour; it does not get to vary by which
 * component is drawing it.
 */
function collectSurfaces(path, probe, names) {
  const css = readFileSync(path, 'utf8');
  const dark = [];
  const light = [];
  for (const block of blocksDeclaring(css, probe)) {
    const found = names
      .map((n) => surfaceIn(css, block, n))
      .filter((v) => v !== null && v.startsWith('#'));
    if (found.length === 0) continue;
    // The high-contrast palette is deliberately excluded: its ground is pure
    // black and it wants a *stronger* accent than the default dark theme, so
    // folding it into the shared solve would drag the product's green darker
    // to satisfy a palette that asked for the opposite.
    if (found.some((c) => c.toLowerCase() === '#000000')) continue;
    (luminance(parseHex(found[0])) < 0.18 ? dark : light).push(...found);
  }
  return { dark, light };
}

const appS = collectSurfaces(APP_CSS, 'accent', [
  'bg-panel',
  'bg-app',
  'bg-raised',
  'bg-float',
  'bg-active',
]);
const mwS = collectSurfaces(MW_CSS, 'mw-accent', ['mw-bg-panel', 'mw-bg-app', 'mw-bg-raised']);

const BASE = {
  dark: solve({ from: 1, toward: 0.2, against: [...appS.dark, ...mwS.dark], minimum: 4.5 }),
  light: solve({ from: 0.05, toward: 1, against: [...appS.light, ...mwS.light], minimum: 4.5 }),
};
console.log(`base (dark)  ${BASE.dark.hex}   base (light) ${BASE.light.hex}`);
console.log('');

const appNext = rewrite(APP_CSS, 'accent', (css, block) => {
  const names = ['bg-panel', 'bg-app', 'bg-raised', 'bg-float', 'bg-active'];
  const surfaces = names.map((n) => surfaceIn(css, block, n)).filter((v) => v && v.startsWith('#'));
  if (surfaces.length === 0) return null;
  // Which way is "away from the surface" is read off the palette itself.
  const lighter = luminance(parseHex(surfaces[0])) < 0.18;
  const current = surfaceIn(css, block, 'accent-bg') ?? '';
  const alphas = [...current.matchAll(/0\.\d+/g)].map(Number);
  const line = surfaceIn(css, block, 'accent-line') ?? '';
  const lineAlphas = [...line.matchAll(/0\.\d+/g)].map(Number);
  // The high-contrast palette solves its own, at a higher bar and in the other
  // direction: it wants the brightest green that clears 7:1 on pure black, not
  // the dimmest that clears 4.5:1. Sharing the default dark base would have
  // handed the accessibility palette a *lower*-contrast accent than the theme
  // it exists to improve on.
  const highContrast = surfaces.some((c) => c.toLowerCase() === '#000000');
  const family = accentFamily({
    surfaces,
    lighter,
    lampInk: surfaceIn(css, block, 'lamp-ink') ?? '#17150f',
    bgAlpha: alphas[0] ?? 0.14,
    lineAlpha: lineAlphas[0] ?? 0.42,
    base: highContrast
      ? solve({ from: 0.2, toward: 1, against: surfaces, minimum: 7 })
      : lighter
        ? BASE.dark
        : BASE.light,
  });
  results.push({ file: 'src/styles/tokens.css', lighter, family, surfaces });
  return family;
});

const mwNext = rewrite(MW_CSS, 'mw-accent', (css, block) => {
  const names = ['mw-bg-panel', 'mw-bg-app', 'mw-bg-raised'];
  const surfaces = names.map((n) => surfaceIn(css, block, n)).filter((v) => v && v.startsWith('#'));
  if (surfaces.length === 0) return null;
  const lighter = luminance(parseHex(surfaces[0])) < 0.18;
  const family = mwAccentFamily({ surfaces, lighter, base: lighter ? BASE.dark : BASE.light });
  results.push({ file: 'motionwave/ui/design/tokens.css', lighter, family, surfaces });
  return family;
});

const appWas = readFileSync(APP_CSS, 'utf8');
const mwWas = readFileSync(MW_CSS, 'utf8');
const drifted = appWas !== appNext || mwWas !== mwNext;

for (const r of results) {
  console.log(`${r.file}  (${r.lighter ? 'dark palette' : 'light palette'})`);
  for (const [k, v] of Object.entries(r.family)) console.log(`  --${k}: ${v}`);
}

if (check) {
  if (drifted) {
    console.error('');
    console.error('accent: the token sheets are not what the base derives.');
    console.error('The accent family is generated. Change ACCENT_HUE/ACCENT_SAT in');
    console.error('scripts/generate-accent.mjs and run it, rather than editing the CSS.');
    process.exit(1);
  }
  console.log('\naccent: both sheets match the derived family.');
} else {
  writeFileSync(APP_CSS, appNext);
  writeFileSync(MW_CSS, mwNext);
  console.log(`\naccent: written${drifted ? '' : ' (no change)'}.`);
}
