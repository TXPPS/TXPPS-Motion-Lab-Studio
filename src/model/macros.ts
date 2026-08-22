/**
 * Macro controls.
 *
 * A macro is one knob wired to several parameters, each over its own range and
 * in its own direction. Moving it writes the real parameters — it is not a
 * layer the engine has to understand — so a macro works with automation, with
 * the mixer, and with an offline bounce without any of them knowing it exists.
 *
 * The mapping is pure and lives here; the store applies what it returns.
 */
import { denormParam, findAutoParam } from './paramRegistry';
import type { Macro, MacroTarget, ProjectData, Track } from './types';

export const MAX_MACROS = 8;

export function createMacro(id: string, index: number): Macro {
  return { id, name: `Macro ${index + 1}`, value: 0, targets: [] };
}

/** Normalised value a target takes at this macro position. */
export function targetNorm(target: MacroTarget, value: number): number {
  const v = Math.min(1, Math.max(0, value));
  return Math.min(1, Math.max(0, target.from + (target.to - target.from) * v));
}

export interface MacroWrite {
  paramId: string;
  /** the parameter's own units, ready to write */
  value: number;
}

/**
 * What moving `macro` to `value` should write.
 *
 * Targets whose parameter no longer resolves — the effect was removed, the send
 * deleted — are skipped rather than dropped, so re-adding the effect makes the
 * macro work again instead of the assignment having quietly vanished.
 */
export function macroWrites(
  track: Track,
  project: ProjectData,
  macro: Macro,
  value: number,
): MacroWrite[] {
  const out: MacroWrite[] = [];
  for (const target of macro.targets) {
    const desc = findAutoParam(track, project, target.paramId);
    if (!desc) continue;
    out.push({ paramId: target.paramId, value: denormParam(desc, targetNorm(target, value)) });
  }
  return out;
}

/** True when this parameter is already driven by the macro. */
export function hasTarget(macro: Macro, paramId: string): boolean {
  return macro.targets.some((t) => t.paramId === paramId);
}

/**
 * A short description of what a macro does, for its tooltip: the reference
 * shows the assignment count, which is the one thing a knob cannot show itself.
 */
export function describeMacro(macro: Macro, track: Track, project: ProjectData): string {
  if (macro.targets.length === 0) return 'Not assigned — drop a parameter on it';
  const names = macro.targets
    .map((t) => findAutoParam(track, project, t.paramId)?.name ?? t.paramId)
    .slice(0, 4);
  const extra = macro.targets.length - names.length;
  return names.join(', ') + (extra > 0 ? ` and ${extra} more` : '');
}
