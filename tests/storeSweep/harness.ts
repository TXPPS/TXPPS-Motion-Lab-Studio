/**
 * One pattern, run against every store action: invoke, undo, save, reload.
 *
 * 159 of the Function Ledger's 186 store rows had no case at all. They are the
 * cheapest rows to cover and the most valuable, because they are where undo,
 * persistence and the engine graph all meet — so they are swept as a batch
 * under one shape rather than argued about one at a time.
 *
 * The shape is four phases and each is a separate claim:
 *
 *   1. **It does something.** The store's serialisable state must differ after
 *      the call. A mutator that no-ops on plausible arguments is a finding, not
 *      a pass — this is the phase that stops a wrong recipe reading as green.
 *   2. **Undo behaves as declared.** A recipe says `undo: 'step'` or
 *      `undo: 'none'`, and both are checked: a step must push exactly one entry
 *      *and* restore the prior project exactly; none must push nothing. The
 *      declaration is in the recipe rather than read out of the store, because
 *      reading it out of the thing under test makes the check a restatement.
 *   3. **The change survives a save and a reload.** Not "the project still
 *      validates" — the *paths the action wrote* are diffed, and every one of
 *      them must still hold its value after `validateProject`. This is the
 *      phase that catches a validator quietly dropping the field the action has
 *      just written, which is how automation lanes were once lost on save.
 *   4. **It is serialisable at all.** For the shell stores, which have no undo
 *      and no project, a change that JSON cannot carry is the defect worth
 *      finding; where the store persists, the persisted blob must move too.
 *
 * What this deliberately does not do is invent arguments. `cases.mjs` says why:
 * a generated invocation calls everything with plausible rubbish and reports
 * coverage of a behaviour nobody specified. The *arguments* are hand-written
 * per row; the *assertions* are identical for all of them. That split is the whole
 * design — the recipe says what to call, the harness says what must be true of
 * any store action, and neither can be weakened without the other noticing.
 */
import { expect } from 'vitest';
import { validateProject } from '../../src/persistence/projectRepo';
import type { ProjectData } from '../../src/model/types';

/** How a recipe declares its undo behaviour. Both values are checked. */
export type UndoKind = 'step' | 'none';

export interface Recipe {
  /** The Function Ledger row this drives, verbatim. */
  id: string;
  /** `step`: pushes exactly one undo entry and is restored by it. */
  undo: UndoKind;
  /**
   * What phase 1 watches.
   *
   * `project` for the mutators, which is nearly all of them. `store` for the
   * handful whose whole subject is session state the document never carries —
   * the gesture depth, the dirty flag. Diffing the project for those would
   * demand a change the action is not supposed to make.
   */
  scope?: 'project' | 'store';
  /**
   * Preconditions, run *before* the before-snapshot is taken.
   *
   * It has to be a separate phase rather than the first lines of `run`. Half
   * these rows need something built first — two overlapping clips, a comped
   * take, an automation lane — and building it inside `run` puts those edits
   * inside the measurement: phase 1 would credit the arrangement, and phase 2
   * would see four undo steps where the recipe declared one. Worse for the
   * inverse actions: `reset` after a `toggle` in the same `run` returns the
   * store to exactly where it started, so the action that did the most would
   * read as the action that did nothing.
   */
  arrange?: () => void;
  /**
   * Invoke, and only invoke. Anything it returns is recorded beside the row in
   * the coverage artefact, so it is worth returning what changed.
   */
  run: () => string;
  /**
   * Why phase 3 does not apply, for the rows where it genuinely does not.
   *
   * A view flag, an audition, a toast: state the product keeps for the length
   * of a session and never writes down. Naming the reason is the mechanism —
   * an empty string would let any awkward row opt out silently.
   */
  transient?: string;
}

/** Every JSON path whose value differs between two trees, as dotted strings. */
export function diffPaths(a: unknown, b: unknown, path = '', out: string[] = []): string[] {
  if (a === b) return out;
  const bothObjects =
    typeof a === 'object' &&
    typeof b === 'object' &&
    a !== null &&
    b !== null &&
    Array.isArray(a) === Array.isArray(b);
  if (!bothObjects) {
    out.push(path);
    return out;
  }
  const keys = new Set([...Object.keys(a as object), ...Object.keys(b as object)]);
  for (const k of keys) {
    diffPaths(
      (a as Record<string, unknown>)[k],
      (b as Record<string, unknown>)[k],
      path ? `${path}.${k}` : k,
      out,
    );
  }
  return out;
}

/** The value at a dotted path, or a sentinel that is not any legal value. */
const MISSING = Symbol('missing');
export function at(tree: unknown, path: string): unknown {
  let node: unknown = tree;
  for (const key of path.split('.')) {
    if (node === null || typeof node !== 'object') return MISSING;
    if (!(key in (node as Record<string, unknown>))) return MISSING;
    node = (node as Record<string, unknown>)[key];
  }
  return node;
}

/** An array or object with nothing in it. */
const isEmptyContainer = (v: unknown): boolean =>
  typeof v === 'object' && v !== null && Object.keys(v as object).length === 0;

/**
 * Every scalar under a value, as full dotted paths.
 *
 * Phase 3 compares leaves rather than whole objects, and the difference is not
 * pedantry. `validateProject` fills defaults — a `master` written with a pan
 * comes back with `monoCheck` and `dim` beside it — so comparing the object
 * reports the change as lost when every byte of it survived. The claim worth
 * making is narrower and exactly right: **a reload may add, it may never drop
 * or alter what the action wrote.**
 */
export function leafPaths(value: unknown, prefix: string, out: string[] = []): string[] {
  if (value === null || typeof value !== 'object') {
    out.push(prefix);
    return out;
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) {
    out.push(prefix);
    return out;
  }
  for (const [k, v] of entries) leafPaths(v, prefix ? `${prefix}.${k}` : k, out);
  return out;
}

/**
 * Paths that move on their own and are not what any action was asked to do.
 *
 * `modifiedAt` is stamped by every write; diffing it into the survival check
 * would make phase 3 pass on a recipe whose real change was dropped, which is
 * exactly the reassurance this exists to refuse.
 */
const INCIDENTAL = /(^|\.)modifiedAt$/;

/**
 * Phases 1–3, for a mutator on the project store.
 *
 * `snapshot` is taken as a structured clone rather than a reference because the
 * store hands back the live object and an in-place mutation would make the
 * before and after the same tree — which reads as "nothing changed" for an
 * action that changed everything.
 */
export function runProjectRecipe(
  recipe: Recipe,
  read: () => { project: ProjectData; undoDepth: number; session: Record<string, unknown> },
  undo: () => void,
): { note: string; changed: number } {
  const watchesSession = recipe.scope === 'store';
  recipe.arrange?.();
  const before = structuredClone(read().project);
  const sessionBefore = structuredClone(read().session);
  const depthBefore = read().undoDepth;

  const note = recipe.run();

  // ---- phase 1: it did something -----------------------------------------
  const after = structuredClone(read().project);
  const changed = diffPaths(before, after).filter((p) => !INCIDENTAL.test(p));
  const moved = watchesSession
    ? diffPaths(sessionBefore, structuredClone(read().session))
    : changed;
  expect(
    moved,
    `${recipe.id} changed nothing in the ${watchesSession ? 'session state' : 'project'}`,
  ).not.toHaveLength(0);

  // ---- phase 3 first: the reload must be asked of the *written* state -----
  // Ordered before undo because undo throws the written state away, and the
  // question is whether a save taken at this instant would carry it back.
  if (!recipe.transient) {
    const reloaded = validateProject(JSON.parse(JSON.stringify(after)));
    const lost: string[] = [];
    for (const path of changed) {
      for (const leaf of leafPaths(at(after, path), path)) {
        const want = at(after, leaf);
        // Nothing was written here, so there is nothing to carry. A field that
        // went from absent to a default is the validator doing its job.
        if (want === undefined || want === MISSING) continue;
        // An empty array or object that comes back absent is the same value to
        // every reader in this codebase — they all say `?? []` — so it is
        // normalisation, not loss. `master.automation: []` is the case that
        // made the point.
        if (isEmptyContainer(want) && at(reloaded, leaf) === MISSING) continue;
        if (JSON.stringify(want) !== JSON.stringify(at(reloaded, leaf))) lost.push(leaf);
      }
    }
    expect(lost, `${recipe.id} wrote state a save/reload does not carry back`).toEqual([]);
  }

  // ---- phase 2: undo, as declared ----------------------------------------
  const pushed = read().undoDepth - depthBefore;
  if (recipe.undo === 'step') {
    expect(pushed, `${recipe.id} is declared undoable and pushed ${pushed} steps`).toBe(1);
    undo();
    const restored = structuredClone(read().project);
    const residue = diffPaths(before, restored).filter((p) => !INCIDENTAL.test(p));
    expect(residue, `${recipe.id} undo left the project changed`).toEqual([]);
  } else {
    expect(pushed, `${recipe.id} is declared non-undoable and pushed ${pushed} steps`).toBe(0);
  }

  return { note, changed: moved.length };
}

/**
 * Phases 1 and 4, for a store outside the project.
 *
 * `persistKey` names the localStorage entry the store writes, where it writes
 * one. A preference that changes in memory and never reaches storage comes back
 * wrong on the next launch, and that is invisible to any assertion made about
 * the store alone.
 */
export function runShellRecipe(
  recipe: Recipe,
  read: () => Record<string, unknown>,
  persistKey?: string,
  flush?: () => void,
): { note: string; changed: number } {
  const snapshot = () =>
    JSON.parse(
      JSON.stringify(read(), (_k, v: unknown) => (typeof v === 'function' ? '[fn]' : v)),
    ) as Record<string, unknown>;

  recipe.arrange?.();
  const before = snapshot();
  const storedBefore = persistKey ? localStorage.getItem(persistKey) : null;

  const note = recipe.run();

  const after = snapshot();
  const changed = diffPaths(before, after);
  expect(changed, `${recipe.id} changed nothing in its store`).not.toHaveLength(0);

  // A store may debounce its write — the workspace does, by 400 ms, which is
  // right for a divider being dragged. The flush is the product's own
  // (`pagehide`), not a test-only door, so what is checked is the path a real
  // tab close takes.
  flush?.();

  if (persistKey) {
    // Phase 4: a preference that changes in memory and never reaches storage
    // comes back wrong on the next launch, and no assertion made about the
    // store alone can see that.
    if (!recipe.transient) {
      expect(localStorage.getItem(persistKey), `${recipe.id} did not reach localStorage`).not.toBe(
        storedBefore,
      );
    }
    // And what it wrote has to be data. A function or a class instance in a
    // persisted store is silently lost on the next read.
    const carried = changed.filter((p) =>
      (JSON.stringify(at(after, p) ?? null) ?? '').includes('"[fn]"'),
    );
    expect(carried, `${recipe.id} put something JSON cannot carry into a persisted store`).toEqual(
      [],
    );
  } else {
    // A store that persists nothing must say so. Left unstated, a store that
    // *should* persist and does not would pass this function by having no key
    // — which is the shape of "the check was turned off" rather than a check.
    expect(
      recipe.transient,
      `${recipe.id} is on a store with no persistence and says nothing about why`,
    ).toBeTruthy();
  }

  return { note, changed: changed.length };
}
