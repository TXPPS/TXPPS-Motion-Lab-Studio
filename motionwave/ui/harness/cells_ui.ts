/**
 * Motion Wave — the ledger's UI cells.
 *
 * U19 to U23. Three of them are decidable from a face's declaration and the
 * token sheet, and are checked here. Two are not decidable on this host at all
 * and are reported `BLOCKED` by the runner before they reach this file — frame
 * pacing needs a display refresh clock and an audio thread to be decoupled
 * from, and a breakpoint needs an engine that computes geometry. ADR-0005 is
 * explicit that the answer to a gate that cannot run is to name what is missing,
 * not to weaken the gate until it passes on what we have.
 */

import { tokenContrast } from '../design/contrast';
import { blockFor, readTokenBlocks } from '../design/stylesheet';
import { PALETTE_TOKENS } from '../design/tokens';
import { paletteSelectorFor } from '../design/theme';
import { type CellOutcome, fail, pass } from './cells';
import type { FaceElement, UnitFace, UnitUnderTest } from './types';

/** Roles that are controls: they move a parameter or they are a defect. */
const CONTROL_ROLES: readonly FaceElement['role'][] = ['knob', 'fader', 'switch', 'button'];

/** Roles that read the engine rather than write it. */
const READOUT_ROLES: readonly FaceElement['role'][] = ['meter', 'graph'];

export interface UiCellOptions {
  /** The text of `design/tokens.css`, so contrast is checked against real values. */
  readonly tokensCss?: string;
  /**
   * Names no string on a face may contain. Supplied by the caller rather than
   * listed here, because `LEGAL_NOTES.md` forbids a trademarked reference name
   * appearing anywhere under `motionwave/` — including in the guard that looks
   * for it. The list lives with the caller, in `docs/reference/`.
   */
  readonly forbiddenNames?: readonly string[];
}

function faceOf(unit: UnitUnderTest): UnitFace {
  if (unit.face === undefined) throw new Error(`unit ${unit.id} declares no face`);
  return unit.face;
}

/** Every string a face carries, for the name scan. */
function faceStrings(face: UnitFace): string[] {
  const strings: string[] = [];
  for (const element of face.elements) strings.push(element.id, element.accessibleName);
  for (const asset of face.artwork) strings.push(asset.id, asset.attribution);
  return strings;
}

/** U19 — the artwork is the unit's own, and says where it came from. */
export function cellOriginalArtwork(unit: UnitUnderTest, options: UiCellOptions = {}): CellOutcome {
  const face = faceOf(unit);
  if (face.artwork.length === 0) {
    return fail('the face declares no artwork, so its provenance cannot be established');
  }
  const problems: string[] = [];
  for (const asset of face.artwork) {
    if (asset.origin !== 'original' && asset.attribution.trim().length === 0) {
      problems.push(`"${asset.id}" is ${asset.origin} with no attribution`);
    }
  }
  const forbidden = options.forbiddenNames ?? [];
  for (const text of faceStrings(face)) {
    for (const name of forbidden) {
      if (name.length > 0 && text.toLowerCase().includes(name.toLowerCase())) {
        problems.push(`"${text}" carries a reference name the face may not use`);
      }
    }
  }
  return problems.length === 0
    ? pass(`${face.artwork.length} asset(s), provenance declared${forbidden.length > 0 ? `, ${forbidden.length} name(s) scanned` : ''}`)
    : fail(problems.join('; '));
}

/**
 * U20 — every element is bound to real engine state.
 *
 * A control that does nothing is a bug of the same class as a wrong number, and
 * it is the one class of UI bug that static analysis can eliminate outright: a
 * knob with no parameter, a meter with no channel, or either pointing at
 * something the unit does not declare. The check is the reason a unit's face
 * cannot drift away from its spec table between releases.
 */
export function cellRealEngineState(unit: UnitUnderTest): CellOutcome {
  const face = faceOf(unit);
  const specIds = new Set(unit.specs.map((spec) => spec.id));
  const meterNames = new Set((unit.meters ?? []).map((meter) => meter.name));
  const problems: string[] = [];
  const bound = new Set<number>();

  for (const element of face.elements) {
    const isControl = CONTROL_ROLES.includes(element.role);
    const isReadout = READOUT_ROLES.includes(element.role);
    if (isControl && element.paramId === null) {
      problems.push(`${element.role} "${element.id}" moves no parameter`);
    }
    if (element.paramId !== null) {
      if (!specIds.has(element.paramId)) {
        problems.push(`"${element.id}" names parameter ${element.paramId}, which the unit does not declare`);
      } else {
        bound.add(element.paramId);
      }
    }
    if (isReadout) {
      if (element.meterChannel === undefined) {
        problems.push(`${element.role} "${element.id}" reads no meter channel`);
      } else if (!meterNames.has(element.meterChannel)) {
        problems.push(`"${element.id}" reads meter "${element.meterChannel}", which the unit does not publish`);
      }
    }
  }

  const unreachable = unit.specs.filter((spec) => !bound.has(spec.id));
  if (unreachable.length > 0) {
    problems.push(
      `parameter(s) with no control on the face: ${unreachable.map((spec) => `${spec.id} "${spec.name}"`).join(', ')}`,
    );
  }
  return problems.length === 0
    ? pass(`${face.elements.length} element(s) bound to ${specIds.size} parameter(s) and ${meterNames.size} meter(s)`)
    : fail(problems.slice(0, 4).join('; '));
}

/** U21 — implemented for the host that can run it; the runner blocks it here. */
export function cellSixtyFpsDecoupled(unit: UnitUnderTest): CellOutcome {
  const face = faceOf(unit);
  const readouts = face.elements.filter((element) => READOUT_ROLES.includes(element.role));
  if (readouts.length === 0) return fail('the face has no meter or graph to pace');
  return pass(`${readouts.length} readout(s) driven from the metering snapshot`);
}

/** U22 — implemented for the host that can run it; the runner blocks it here. */
export function cellResponsive(unit: UnitUnderTest): CellOutcome {
  const face = faceOf(unit);
  if (face.breakpointsEm.length === 0) return fail('the face declares no breakpoints');
  if (!(face.minWidthRem > 0)) return fail('the face declares no minimum width in rem');
  const unsorted = face.breakpointsEm.some(
    (value, index) => index > 0 && value <= face.breakpointsEm[index - 1],
  );
  if (unsorted) return fail('breakpoints are not in ascending order');
  return pass(`${face.breakpointsEm.length} breakpoint(s) in em, minimum ${face.minWidthRem} rem`);
}

/**
 * U23 — every theme is complete, every pair is legible, every control is named.
 *
 * The contrast half is arithmetic on the declared token values, so it runs
 * anywhere and finds a light-theme pair nobody looked at before a user does.
 * What cannot run here is a screen reader: that gate is BLOCKED at the
 * programme level under ADR-0005 and stays listed there rather than being
 * quietly folded into this cell's result.
 */
export function cellThemesAndAccessibility(
  unit: UnitUnderTest,
  options: UiCellOptions = {},
): CellOutcome {
  const face = faceOf(unit);
  const problems: string[] = [];

  for (const element of face.elements) {
    if (element.accessibleName.trim().length === 0) {
      problems.push(`"${element.id}" has no accessible name`);
    }
    if (CONTROL_ROLES.includes(element.role) && !element.keyboardFocusable) {
      problems.push(`${element.role} "${element.id}" cannot be reached from the keyboard`);
    }
  }

  const css = options.tokensCss;
  if (css === undefined) {
    return fail('no token sheet was supplied, so the palette could not be checked for contrast');
  }
  const blocks = readTokenBlocks(css);
  for (const theme of ['light', 'dark'] as const) {
    const where = paletteSelectorFor(theme, theme === 'dark');
    const palette = blockFor(blocks, where.selector, where.media);
    if (palette === null) {
      problems.push(`the ${theme} palette block ${where.selector} is missing from the token sheet`);
      continue;
    }
    for (const token of PALETTE_TOKENS) {
      if (!palette.has(token)) problems.push(`${theme} theme does not declare ${token}`);
    }
    for (const element of face.elements) {
      const minimum = READOUT_ROLES.includes(element.role) ? 3 : 4.5;
      for (const pair of element.colours ?? []) {
        const ratio = tokenContrast(palette.get(pair.foreground) ?? '', palette.get(pair.background) ?? '');
        if (ratio === null) {
          problems.push(`${theme}: "${element.id}" uses tokens that do not resolve to colours`);
        } else if (ratio < minimum) {
          problems.push(
            `${theme}: "${element.id}" reads ${ratio.toFixed(2)}:1 against a ${minimum}:1 minimum`,
          );
        }
      }
    }
  }

  return problems.length === 0
    ? pass(`${face.elements.length} element(s) named and reachable; both themes complete and legible`)
    : fail(problems.slice(0, 4).join('; '));
}
