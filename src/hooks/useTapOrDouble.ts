/**
 * One tap does a thing; two taps do a different thing and undo the first.
 *
 * The rack's contract (directive item 13) is that a single tap opens a device's
 * window, tapping again closes it, and a double tap shows the quick controls
 * instead. Those three read cleanly and the first two make the third ambiguous:
 * a tap that opens followed 200 ms later by a tap that closes is
 * indistinguishable, at the moment of the first tap, from the first half of a
 * double tap.
 *
 * Two ways out, and the obvious one is wrong. Deferring the single tap by one
 * double-tap interval makes every open wait 250 ms in order to serve a gesture
 * almost nobody makes. So the single tap happens immediately and the double tap
 * is responsible for **reverting** it — which costs nothing, because what the
 * tap did is a state flag rather than a navigation, and puts the cost on the
 * rare gesture instead of on every one.
 *
 * `onDouble` is therefore always called *after* its own `onTap` has already
 * run, and is expected to put back whatever that changed.
 *
 * No timer, and that is deliberate: the only state is when the last press
 * landed, so there is nothing to cancel on unmount and nothing that can fire
 * into a component that has gone.
 *
 * The interval is measured from the **event's own timestamp**, not from a clock
 * read inside the handler. Two reasons, and the second one is why this changed:
 * the event stamp is when the input actually happened rather than when React
 * got round to the handler, and `performance.now()` is what React's scheduler
 * itself reads — a test that froze it to make two presses land in the same
 * instant froze React's notion of time with it, and the re-render never came.
 */
import { useCallback, useRef } from 'react';

/**
 * The interval, in milliseconds.
 *
 * Both iOS and Chrome treat two presses inside about 250 ms as a double tap,
 * and matching the platform is the point: a person's hand is calibrated by
 * every other application on the device, not by this one.
 */
export const DOUBLE_TAP_MS = 250;

export function useTapOrDouble(
  onTap: () => void,
  onDouble: () => void,
  intervalMs = DOUBLE_TAP_MS,
): (e: { timeStamp: number }) => void {
  const last = useRef(Number.NEGATIVE_INFINITY);
  return useCallback(
    (e: { timeStamp: number }) => {
      const now = e.timeStamp;
      const isDouble = now - last.current < intervalMs;
      // Reset rather than `now`, so a third press starts a fresh single tap. Left
      // as `now`, a rapid triple would read as two doubles and the second would
      // revert a tap that never happened. Negative infinity rather than zero
      // because the stamps are real times and zero is one of them.
      last.current = isDouble ? Number.NEGATIVE_INFINITY : now;
      if (isDouble) onDouble();
      else onTap();
    },
    [onTap, onDouble, intervalMs],
  );
}
