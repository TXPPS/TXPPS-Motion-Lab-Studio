/**
 * Who is holding which note, and the guarantee that every one of them ends.
 *
 * BUG-004/005. The on-screen keyboard dispatched note-off from the key
 * element's own `pointerup`, and the key never hears that event: `pointerdown`
 * calls `releasePointerCapture` on purpose, so that sliding a finger across the
 * keyboard fires `pointerenter` on the neighbours and glides. The cost of that
 * choice is that the *release* lands wherever the finger happens to be — on the
 * body, on a panel, outside the window — and a release the key never hears is a
 * note that never stops and a key that stays lit. Measured before the fix: a
 * press followed by a lift anywhere but on the key produced note-on and no
 * note-off, and the same held true of blur, tab-hide, pointer-cancel and
 * unmount.
 *
 * The fix cannot live in the key, because the key is exactly the thing that
 * does not receive the event. It has to be owned above every surface that plays
 * notes, which is what this is: one registry of held notes, one set of
 * window-level listeners, one definition of "released".
 *
 * It is shared rather than per-surface because the same gesture exists on the
 * pad grid, the piano roll and the sampler, and four copies of this bookkeeping
 * would be four chances to get it wrong again. A surface presses and releases by
 * identity; everything else — the finger leaving, the window blurring, the tab
 * hiding, the component unmounting — is handled here for all of them.
 */
import { engine } from './engine';

/** A pointer, a computer key, or a MIDI note — whatever is doing the holding. */
export type HolderId = string | number;

interface Held {
  trackId: string;
  pitch: number;
}

/** `surface` scopes ids, so two surfaces can both use pointer id 1. */
function keyOf(surface: string, holder: HolderId): string {
  return `${surface} ${holder}`;
}

class HeldNotes {
  private held = new Map<string, Held>();
  private subscribers = new Set<() => void>();
  private installed = false;

  /**
   * Window-level release, installed on the first press.
   *
   * `pointerup` and `pointercancel` are listened for in the capture phase and
   * on `window`, so they arrive whatever they were dispatched at — that is the
   * whole point. `blur` and a hidden tab release everything, because a note
   * held while the app is not in front is a note nobody can stop.
   */
  private install(): void {
    if (this.installed || typeof window === 'undefined') return;
    this.installed = true;
    const up = (e: Event) => {
      const id = (e as PointerEvent).pointerId;
      if (id === undefined) return;
      // A pointer id is not unique across surfaces, so every surface holding
      // that id releases it. Two surfaces cannot hold one physical finger.
      for (const key of [...this.held.keys()]) {
        if (key.endsWith(` ${id}`)) this.releaseKey(key);
      }
    };
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', up, true);
    window.addEventListener('blur', () => this.releaseAll());
    window.addEventListener('pagehide', () => this.releaseAll());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.releaseAll();
    });
  }

  /**
   * Start a note. Pressing an id that is already holding a different pitch
   * releases the old one first, which is what makes a glide across the keys a
   * legato line rather than a pile of stuck notes.
   */
  press(surface: string, holder: HolderId, trackId: string, pitch: number, velocity = 100): void {
    this.install();
    const key = keyOf(surface, holder);
    const existing = this.held.get(key);
    if (existing && existing.pitch === pitch && existing.trackId === trackId) return;
    if (existing) engine.liveNoteOff(existing.trackId, existing.pitch);
    this.held.set(key, { trackId, pitch });
    engine.liveNoteOn(trackId, pitch, velocity);
    this.notify();
  }

  /**
   * End a note. Releasing something not held is a no-op rather than an error:
   * the key's own `pointerup` and the window's both arrive, and only one of
   * them can be the one that does the work.
   */
  release(surface: string, holder: HolderId): void {
    this.releaseKey(keyOf(surface, holder));
  }

  private releaseKey(key: string): void {
    const held = this.held.get(key);
    if (!held) return;
    this.held.delete(key);
    engine.liveNoteOff(held.trackId, held.pitch);
    this.notify();
  }

  /** Release everything, or everything one surface holds. */
  releaseAll(surface?: string): void {
    const prefix = surface === undefined ? null : `${surface} `;
    for (const key of [...this.held.keys()]) {
      if (prefix === null || key.startsWith(prefix)) this.releaseKey(key);
    }
  }

  /** The pitches a surface is holding, for drawing them lit. */
  pitches(surface: string): ReadonlySet<number> {
    const prefix = `${surface} `;
    const out = new Set<number>();
    for (const [key, held] of this.held) if (key.startsWith(prefix)) out.add(held.pitch);
    return out;
  }

  /** Total notes held across every surface. The number a fuzz run asserts is zero. */
  get size(): number {
    return this.held.size;
  }

  // ---- React subscription ------------------------------------------------
  //
  // `useSyncExternalStore` rather than component state, because the releases
  // that matter arrive from window listeners rather than from the component,
  // and a component that owned the state could not be told about them without
  // exactly the wiring this exists to remove.

  subscribe = (fn: () => void): (() => void) => {
    this.subscribers.add(fn);
    return () => {
      this.subscribers.delete(fn);
    };
  };

  /**
   * A per-surface snapshot, cached so `useSyncExternalStore` sees a stable
   * reference between changes. Returning a fresh Set per call re-renders
   * forever.
   */
  private snapshots = new Map<string, ReadonlySet<number>>();

  snapshot = (surface: string): ReadonlySet<number> => {
    let cached = this.snapshots.get(surface);
    if (!cached) {
      cached = this.pitches(surface);
      this.snapshots.set(surface, cached);
    }
    return cached;
  };

  private notify(): void {
    this.snapshots.clear();
    for (const fn of this.subscribers) fn();
  }

  /** Tests only: forget everything without dispatching note-offs. */
  clearForTest(): void {
    this.held.clear();
    this.snapshots.clear();
  }
}

export const heldNotes = new HeldNotes();
