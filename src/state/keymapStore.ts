import { create } from 'zustand';
import { SHORTCUTS, comboOf, type Shortcut } from '../app/shortcuts';

/**
 * User key bindings.
 *
 * The registry in `app/shortcuts.ts` is the default map and the documentation
 * of record; this holds only what the user changed, so a default that moves in
 * a later release moves for everyone who never touched it.
 *
 * Rebinding works as a translation rather than as a rewrite of the dispatcher:
 * a pressed combo that a user has bound to some action is translated into that
 * action's DEFAULT combo before the handlers see it. One small map, and every
 * existing handler keeps working.
 */

const KEY = 'motionlab.keymap.v1';

interface KeymapState {
  /** shortcut id → the combo the user bound it to */
  overrides: Record<string, string>;
  setBinding: (id: string, combo: string) => void;
  clearBinding: (id: string) => void;
  resetAll: () => void;
}

function read(): Record<string, string> {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const [id, combo] of Object.entries(parsed)) {
      if (typeof combo === 'string' && combo && SHORTCUTS.some((s) => s.id === id)) {
        out[id] = combo;
      }
    }
    return out;
  } catch {
    return {};
  }
}

function persist(overrides: Record<string, string>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(overrides));
  } catch {
    /* storage disabled — the session still works, it just will not persist */
  }
}

export const useKeymapStore = create<KeymapState>((set, get) => ({
  overrides: read(),
  setBinding: (id, combo) => {
    const next = { ...get().overrides };
    // Binding a combo takes it from whoever had it: two actions on one key is
    // never what the user meant, and silently ignoring the second is worse.
    for (const [other, c] of Object.entries(next)) {
      if (other !== id && c === combo) delete next[other];
    }
    const shortcut = SHORTCUTS.find((s) => s.id === id);
    if (shortcut && shortcut.combo === combo) delete next[id];
    else next[id] = combo;
    set({ overrides: next });
    persist(next);
    rebuild(next);
  },
  clearBinding: (id) => {
    const next = { ...get().overrides };
    delete next[id];
    set({ overrides: next });
    persist(next);
    rebuild(next);
  },
  resetAll: () => {
    set({ overrides: {} });
    persist({});
    rebuild({});
  },
}));

/** pressed combo → default combo, for everything the user has moved. */
let translation = new Map<string, string>();
/**
 * Default combos whose action has moved away and which nothing else claimed.
 * They must stop doing anything: a key that still fires the action it was
 * rebound away from is the one outcome a rebinding must never have.
 */
let orphaned = new Set<string>();

function rebuild(overrides: Record<string, string>): void {
  translation = new Map();
  orphaned = new Set();
  const claimed = new Set(Object.values(overrides));
  for (const [id, combo] of Object.entries(overrides)) {
    const shortcut = SHORTCUTS.find((s) => s.id === id);
    if (!shortcut || combo === shortcut.combo) continue;
    translation.set(combo, shortcut.combo);
    if (!claimed.has(shortcut.combo)) orphaned.add(shortcut.combo);
  }
}

rebuild(useKeymapStore.getState().overrides);

/**
 * Translate a keyboard event into the default combo the handlers expect.
 * Returns null when the event is not a rebound combo and should pass through
 * unchanged, and '' when its default action has been displaced by a rebinding.
 */
export function translateCombo(e: KeyboardEvent): string | null {
  if (translation.size === 0 && orphaned.size === 0) return null;
  const pressed = comboOf(e);
  if (!pressed) return null;
  const target = translation.get(pressed);
  if (target !== undefined) return target;
  return orphaned.has(pressed) ? '' : null;
}

/** What a shortcut is currently bound to. */
export function effectiveCombo(shortcut: Shortcut): string {
  return useKeymapStore.getState().overrides[shortcut.id] ?? shortcut.combo;
}

/** Ids that share a binding right now, so the editor can warn. */
export function bindingConflicts(): string[][] {
  const byCombo = new Map<string, string[]>();
  for (const s of SHORTCUTS) {
    const combo = effectiveCombo(s);
    byCombo.set(combo, [...(byCombo.get(combo) ?? []), s.id]);
  }
  return [...byCombo.values()].filter((ids) => ids.length > 1);
}
