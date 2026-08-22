/**
 * Enforcing a polyphony ceiling.
 *
 * Every instrument here keeps a `Set` of live voices and a maximum. The obvious
 * implementation — when the set is full, find the oldest voice and stop it —
 * is wrong in two ways that only show up under the load the cap exists for, and
 * both of them were shipped:
 *
 * 1. **One steal per spawn.** Stopping a voice does not remove it from the set;
 *    retirement does that, later, when the voice's tail has actually finished.
 *    So a spawn that finds the set over the ceiling stops one voice and starts
 *    another, and the set stays over. Sixty notes at one instant started sixty
 *    oscillators against a ceiling of twenty-four.
 *
 * 2. **A strict `<` over equal timestamps.** Notes in a chord share a start
 *    time exactly. `v.startedAt < oldest.startedAt` is false for every one of
 *    them, so the walk returns the first voice it saw every time and the same
 *    voice is stolen over and over while the rest run untouched.
 *
 * The fix for both is the same shape: steal in a loop, and remove each stolen
 * voice from the set as it is stolen, so the loop makes progress and the count
 * the ceiling is compared against is the truth. Removing early is safe because
 * the set is only the *allocation* ledger — the voice's own cleanup still runs
 * on its own schedule and unregisters it from the engine, and `Set.delete` of
 * something already gone is a no-op.
 *
 * Policy is unchanged: oldest first, ties going to whichever was inserted
 * first. Preferring voices already in their release phase would be less
 * audible still, but that is a different change from making the ceiling hold,
 * and this one is the bug.
 */

/** The least a voice has to expose to be subject to a ceiling. */
export interface CappableVoice {
  /** Context time the voice began. Ties are normal — a chord shares one. */
  readonly startedAt: number;
}

/**
 * Steal until `voices` has room for one more, and return how many were taken.
 *
 * Call before adding, not after: it leaves the set at `cap - 1` at most, so the
 * voice about to be added brings it to exactly `cap`.
 *
 * `cut` is handed each stolen voice and is responsible for stopping it. It is
 * called after the voice leaves the set so that a `cut` which synchronously
 * triggers the voice's own cleanup cannot re-enter this loop.
 */
export function stealToFit<V extends CappableVoice>(
  voices: Set<V>,
  cap: number,
  cut: (voice: V) => void,
): number {
  if (!(cap > 0)) {
    // A ceiling of zero means no voices at all, which no caller wants and
    // which would silently empty the set. Treat it as "no ceiling" instead.
    return 0;
  }
  let stolen = 0;
  while (voices.size >= cap) {
    let oldest: V | null = null;
    for (const v of voices) if (!oldest || v.startedAt < oldest.startedAt) oldest = v;
    if (!oldest) break;
    voices.delete(oldest);
    cut(oldest);
    stolen++;
  }
  return stolen;
}
