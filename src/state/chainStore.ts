/**
 * Chains the user saved.
 *
 * The built-in chains in `model/effectPresets.ts` are the product's; these are
 * the engineer's own — the vocal chain they arrived at on this song and want on
 * the next one. They are per-device rather than per-project, like the keymap
 * and the appearance preferences, because a chain you built is yours across
 * every song you open, and a song you send someone should not silently carry
 * your library with it.
 *
 * Stored in localStorage. A chain is small — a few devices and their numbers —
 * and it has to be listable before the first paint of a rack, which rules out
 * the asynchronous store the audio lives in.
 */
import { create } from 'zustand';
import type { ChainStepLike } from '../app/chainActions';
import { newId } from '../model/ids';

export interface SavedChain {
  id: string;
  name: string;
  steps: ChainStepLike[];
  savedAt: number;
}

const KEY = 'motionlab.chains.v1';
/** Enough for a working library; a runaway loop cannot fill the quota. */
export const MAX_SAVED_CHAINS = 64;

/**
 * Read what is stored, keeping only what is structurally a chain.
 *
 * Anything shaped wrong is dropped rather than repaired: a chain whose steps
 * are not steps cannot be applied, and a half-restored chain would put devices
 * on a channel that the user never chose.
 */
function read(): SavedChain[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isSavedChain).slice(0, MAX_SAVED_CHAINS);
  } catch {
    return [];
  }
}

function isSavedChain(v: unknown): v is SavedChain {
  if (typeof v !== 'object' || v === null) return false;
  const c = v as Partial<SavedChain>;
  return (
    typeof c.id === 'string' &&
    typeof c.name === 'string' &&
    c.name.length > 0 &&
    Array.isArray(c.steps) &&
    c.steps.every(
      (s) => typeof s?.kind === 'string' && typeof s?.params === 'object' && s.params !== null,
    )
  );
}

function persist(chains: SavedChain[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(chains));
  } catch {
    /* storage disabled or full — the chains stay for this session */
  }
}

interface ChainStore {
  chains: SavedChain[];
  /** Returns the new chain's id, or null when the name or the steps are empty. */
  save: (name: string, steps: readonly ChainStepLike[]) => string | null;
  remove: (id: string) => void;
  /** Test seam; also what a "clear my chains" control would call. */
  reset: () => void;
}

export const useChainStore = create<ChainStore>((set, get) => ({
  chains: read(),
  save: (name, steps) => {
    const trimmed = name.trim();
    if (!trimmed || steps.length === 0) return null;
    const id = newId('chain');
    const entry: SavedChain = {
      id,
      name: trimmed,
      steps: structuredClone(steps) as ChainStepLike[],
      savedAt: Date.now(),
    };
    // Saving over a name replaces it. Two chains called "Vocal" in one menu is
    // a menu you cannot use, and the second save is plainly the one meant.
    const rest = get().chains.filter((c) => c.name !== trimmed);
    const next = [entry, ...rest].slice(0, MAX_SAVED_CHAINS);
    set({ chains: next });
    persist(next);
    return id;
  },
  remove: (id) => {
    const next = get().chains.filter((c) => c.id !== id);
    set({ chains: next });
    persist(next);
  },
  reset: () => {
    set({ chains: [] });
    persist([]);
  },
}));
