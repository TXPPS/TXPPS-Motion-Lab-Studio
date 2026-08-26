/**
 * Delay compensation, decided once and used by both render paths.
 *
 * PA-010 was that seven inserts delayed their channel and none of them said so,
 * which put a limiter'd vocal 7 ms behind the drums. The fix was to declare the
 * delay and hold every other channel back to match the deepest — and it went
 * into `AudioEngine` only. `exportMix` builds the same channels out of the same
 * `InsertChain` and had no compensating node at all, so PA-010 survived intact
 * in the export path: what was monitored in phase bounced out of phase, with
 * nothing on screen to say so. A defect that is fixed on the path you can hear
 * and live on the path you deliver is worse than one that is broken on both,
 * because monitoring is how you would have caught it.
 *
 * So the arithmetic lives here, in one pure function that neither path may
 * reimplement. It is the same argument as `synthFace.ts`: a picture drawn from
 * a second evaluation of the same idea is a picture that can disagree with the
 * audio, and two renderers compensating from two copies of this sum are two
 * renderers that can disagree about when the vocal starts.
 */

/**
 * The longest hold a channel can be given, and the size every `DelayNode` on
 * the path is built at.
 *
 * A `DelayNode`'s maximum is fixed at construction and cannot be grown when a
 * user adds one more insert, so it is sized for a worst case rather than for
 * the current chain: eight limiters at 10 ms of lookahead each, with room over.
 */
export const MAX_PDC_SEC = 0.5;

export interface PdcPlan {
  /** Extra samples to hold each channel back by, in the order handed in. */
  holdSamples: number[];
  /**
   * Samples the mix ends up late by once every channel has been aligned.
   *
   * Live this is unobservable — there is nothing to compare it against, and a
   * uniform delay on everything you hear is just the buffer. In a file it is a
   * misalignment against the timeline the file came from, so a bounce takes it
   * off the front. That is the one place the two paths deliberately differ, and
   * it is a difference the offline path can make and the live path cannot.
   */
  commonSamples: number;
}

/**
 * Hold every channel back to match the deepest, and say what that cost.
 *
 * The master chain is a floor rather than a peer: it sits downstream of every
 * channel, so its latency is common to all of them and moving channels relative
 * to each other cannot compensate it. It counts towards `commonSamples` and
 * never towards a hold.
 *
 * Rounded to whole samples on purpose. A `DelayNode` asked for a fractional
 * sample interpolates rather than shifts — it is a filter, and a gentle one is
 * still not a wire — so a compensation that lands between samples would trade a
 * timing error for a frequency-response error on every channel but one.
 */
export function pdcPlan(
  channelLatencySamples: readonly number[],
  masterLatencySamples: number,
  sampleRate: number,
): PdcPlan {
  let deepest = 0;
  for (const l of channelLatencySamples) deepest = Math.max(deepest, l);
  const cap = MAX_PDC_SEC * sampleRate;
  // A channel past the cap stays early rather than being held wrong: the cap is
  // the delay line's length, and asking a `DelayNode` for more than it was
  // built with silently clamps. Clamping here makes the shortfall arithmetic
  // rather than a property of a node nobody is looking at.
  const holdSamples = channelLatencySamples.map((l) =>
    Math.round(Math.max(0, Math.min(cap, deepest - l))),
  );
  return { holdSamples, commonSamples: Math.round(deepest + Math.max(0, masterLatencySamples)) };
}

/**
 * What a channel's chain actually costs the signal on it.
 *
 * A frozen track's audio does not pass through its inserts — the print already
 * carries them, so it joins the channel at the chain's output on both paths.
 * The chain is still built and still synced, though, so it still *declares* a
 * latency, and compensating for a delay nothing on that channel is subject to
 * would push a frozen track late by exactly the delay freezing removed. Freeze
 * a limiter'd vocal and it would slide 7 ms the other way, which is the same
 * defect wearing the fix's clothes.
 */
export function channelLatencySamples(frozen: boolean, chainLatencySamples: number): number {
  return frozen ? 0 : chainLatencySamples;
}
