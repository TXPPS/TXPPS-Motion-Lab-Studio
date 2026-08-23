/**
 * Motion Wave — moving a preset forward when a unit's meaning changes.
 *
 * A version exists so a spec that changes *meaning* can migrate rather than
 * silently reinterpret (ADR-0004). The distinction matters: a range that widens
 * needs nothing, because values are normalised and 0.5 still means half. A
 * parameter that changes from a ratio to a percentage, or a control that is
 * split into two, changes what 0.5 *is*, and a build that loads the old file
 * without migrating produces a sound the user never made — silently, which is
 * the part that makes it expensive.
 *
 * Migrations run one version at a time, so a preset from four releases ago
 * takes four small steps that were each tested when they were written, rather
 * than one large step nobody has run since.
 */

import type { PresetDocument } from './format';

export type PresetMigration = (document: PresetDocument) => PresetDocument;

export interface MigrationResult {
  readonly document: PresetDocument;
  /** How many steps ran. Zero is the normal case and not a failure. */
  readonly steps: number;
  /**
   * Set when the file is newer than this build. It is loaded as-is: the values
   * are preserved and handed back on the next save, because a downgrade path
   * that guessed would be a guess about a spec that did not exist yet.
   */
  readonly fromFuture: boolean;
  /**
   * Set when a step is missing between the file's version and this build's.
   * The preset still loads with what it has, and this is what a UI needs to
   * tell the user their preset may not sound the way it did.
   */
  readonly incomplete: boolean;
}

export class PresetMigrations {
  private readonly steps = new Map<string, PresetMigration>();

  /** Registers the step that takes `unit` from `fromVersion` to the next one. */
  register(unit: string, fromVersion: number, step: PresetMigration): void {
    const key = `${unit}@${fromVersion}`;
    if (this.steps.has(key)) {
      throw new Error(`preset migration already registered for ${key}`);
    }
    this.steps.set(key, step);
  }

  migrate(document: PresetDocument, targetVersion: number): MigrationResult {
    if (document.unitVersion > targetVersion) {
      return { document, steps: 0, fromFuture: true, incomplete: false };
    }
    let current = document;
    let steps = 0;
    while (current.unitVersion < targetVersion) {
      const step = this.steps.get(`${current.unit}@${current.unitVersion}`);
      if (step === undefined) {
        return { document: current, steps, fromFuture: false, incomplete: true };
      }
      const next = step(current);
      // A step that does not advance the version would loop forever, and it is
      // an easy mistake to make in a migration that only edits values.
      const advanced =
        next.unitVersion > current.unitVersion
          ? next
          : { ...next, unitVersion: current.unitVersion + 1 };
      current = advanced;
      steps += 1;
    }
    return { document: current, steps, fromFuture: false, incomplete: false };
  }
}

/**
 * A step that moves one parameter's value to a new id.
 *
 * The common migration, and the one that must never be done by editing the
 * spec's id in place: an id is the key an automation lane names a parameter by,
 * so renumbering without a migration re-points every project that automated it.
 */
export function renameParam(fromId: number, toId: number): PresetMigration {
  return (document) => {
    const values: Record<string, number> = { ...document.values };
    const value = values[String(fromId)];
    if (value === undefined) return { ...document, unitVersion: document.unitVersion + 1 };
    delete values[String(fromId)];
    values[String(toId)] = value;
    return { ...document, values, unitVersion: document.unitVersion + 1 };
  };
}

/** A step that re-maps one parameter's normalised value through a function. */
export function remapParam(id: number, map: (normalised: number) => number): PresetMigration {
  return (document) => {
    const values: Record<string, number> = { ...document.values };
    const value = values[String(id)];
    if (typeof value === 'number') {
      const mapped = map(value);
      values[String(id)] = Number.isFinite(mapped) ? Math.max(0, Math.min(1, mapped)) : value;
    }
    return { ...document, values, unitVersion: document.unitVersion + 1 };
  };
}

/** A step that gives a newly added parameter a value in older presets. */
export function seedParam(id: number, normalised: number): PresetMigration {
  return (document) => {
    if (document.values[String(id)] !== undefined) {
      return { ...document, unitVersion: document.unitVersion + 1 };
    }
    return {
      ...document,
      values: { ...document.values, [String(id)]: normalised },
      unitVersion: document.unitVersion + 1,
    };
  };
}
