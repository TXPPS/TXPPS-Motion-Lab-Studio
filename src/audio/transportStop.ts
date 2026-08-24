/**
 * The one place a transport stop is announced.
 *
 * MotionLab had two transport owners. The AudioEngine owned the clock and the
 * RecordingController owned the take, and the dependency ran one way only:
 * `recording.stop()` called `engine.stop()`, and nothing called back. So every
 * route to a stopped transport that entered through the engine — the Stop
 * button, the spacebar, the Show page's play/stop toggle, Control Link's MMC
 * stop, loading a project, the diagnostics report — halted the clock and left
 * MediaRecorder capturing. The playhead froze, the take timer kept climbing,
 * the microphone stayed open, and the take was never committed. That is the
 * "stop does not stop" the user reported, and it was not one bug at one call
 * site: it was six call sites reaching a primitive that had never been told
 * about recording.
 *
 * This module is deliberately dependency-free. The engine can announce a stop
 * without importing the recorder, and the recorder can listen without
 * importing the engine — that import cycle is the reason the callback was
 * never added in the first place, so removing the cycle is the fix rather than
 * a place to hang one more call.
 *
 * Listeners run SYNCHRONOUSLY, and are announced BEFORE the clock is cleared.
 * Both matter:
 *
 *   - Synchronously, because the acceptance is that no audio exists after the
 *     stop instant. A listener that deferred its `MediaRecorder.stop()` to a
 *     microtask would let one more chunk boundary through, which is the same
 *     bug in a smaller size.
 *   - Before the clock is cleared, because a listener that needs to know where
 *     the transport was — and the take finaliser does, to decide where the clip
 *     ends — has to ask while the answer is still the live scheduler position
 *     rather than a paused one.
 */

/**
 * Why the transport stopped. The recorder reads this to decide what happens to
 * the bytes it is holding, so it is intent and not just provenance.
 */
export type TransportStopReason =
  /** Stop button, spacebar, MMC stop, or the end of a punch region. Keep the take. */
  | 'user'
  /** Escape. End the take and do not turn it into a clip. */
  | 'abandon'
  /** The audio graph is being torn out from under it. */
  | 'panic'
  /** The project holding the armed track is being replaced. */
  | 'project';

/**
 * Returns true when this listener had work in flight that the stop ended.
 * The engine uses that to tell a first stop press from a second one.
 */
export type TransportStopListener = (reason: TransportStopReason) => boolean;

const listeners = new Set<TransportStopListener>();

/** Subscribe. The returned function unsubscribes; tests rely on that. */
export function onTransportStop(fn: TransportStopListener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/**
 * Announce a stop to every listener and report whether any of them had
 * something to end.
 *
 * A listener that throws is logged past rather than rethrown: the caller is
 * mid-way through stopping the transport, and letting a recorder fault abort
 * that would leave the clock running with the UI showing it stopped — a worse
 * failure than the one being reported, and precisely the divergence this
 * module exists to remove.
 */
export function announceTransportStop(reason: TransportStopReason): boolean {
  let hadWork = false;
  // Iterated over a copy so a listener that unsubscribes itself while handling
  // the stop — which the recovery path does — cannot mutate the set mid-loop.
  for (const fn of [...listeners]) {
    try {
      if (fn(reason)) hadWork = true;
    } catch (e) {
      // `console`, not `diagLog`: the diagnostics log lives downstream of this
      // module and importing it would restore the dependency this file exists
      // to remove.
      console.error('transport stop listener failed', e);
    }
  }
  return hadWork;
}

/** Test seam: how many listeners are attached. Not used by the app. */
export function transportStopListenerCount(): number {
  return listeners.size;
}
