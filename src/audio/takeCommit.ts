/**
 * What becomes of a finished take.
 *
 * Split out of `recordingController.ts` because it answers a different question
 * from the state machine. The machine decides when a take ends; this decides
 * whether the bytes become a clip, and if they cannot, whether the performance
 * is still recoverable.
 *
 * Nothing here writes to a store. Every path ends in one `TakeOutcome` and the
 * controller applies it, so the take state has one writer rather than the five
 * it had when these branches each set it themselves — five writers being how a
 * take could report itself both committed and lost.
 */
import { diagLog } from '../state/diagnostics';
import type { FinishedTake } from './recorder';
import { commitTake, stashRecovery } from './recorder';

/** Everything the commit needs to know about where the take came from. */
export interface TakeMeta {
  trackId: string | null;
  trackName: string;
  startBeat: number;
  /** The window the clip should cover, when the take was punched or rolled in. */
  window?: { startBeat: number; endBeat: number };
}

export type TakeOutcome =
  /** Nothing was captured. There is nothing to keep and nothing to recover. */
  | { kind: 'empty' }
  /**
   * The bytes exist but could not become a clip. They are in the recovery
   * store, and `message` says why — surfaced rather than swallowed, because a
   * take the user believes was saved and was not is the worst outcome here.
   */
  | { kind: 'recovered'; message: string }
  | {
      kind: 'committed';
      clipId: string;
      trackId: string;
      mediaId: string;
      name: string;
      durationSec: number;
      bytes: number;
      mimeType: string;
      /** The peak envelope never rose above the silence floor. */
      silent: boolean;
    };

/**
 * Wait for the encoder, then turn what it produced into a clip.
 *
 * `onFlushed` fires once the blob has resolved and before anything else. The
 * controller releases the input there: stopping a MediaStreamTrack while the
 * encoder is still flushing truncates the tail of the take, so the input has to
 * outlive the recorder by exactly this one await.
 */
export async function commitOrRecover(
  pending: Promise<FinishedTake | null>,
  meta: TakeMeta,
  ctx: BaseAudioContext | null,
  onFlushed: () => void,
  latencySec = 0,
): Promise<TakeOutcome> {
  const take = await pending;
  onFlushed();

  const { trackId, trackName, startBeat, window } = meta;
  if (!take || !trackId) {
    diagLog('warn', 'Recording stopped but no audio was captured');
    return { kind: 'empty' };
  }

  const recoveryMeta = {
    trackId,
    trackName,
    startBeat,
    durationSec: take.durationSec,
  };

  if (!ctx) {
    // Keep the bytes rather than losing the performance.
    await stashRecovery(take.blob, take.mimeType, recoveryMeta);
    return { kind: 'recovered', message: 'Audio context lost — the take was saved for recovery.' };
  }

  try {
    const result = await commitTake({
      take,
      trackId,
      trackName,
      startBeat,
      window,
      ctx,
      latencySec,
    });
    if (!result) {
      await stashRecovery(take.blob, take.mimeType, recoveryMeta);
      return {
        kind: 'recovered',
        message:
          'The take could not be decoded and was saved for recovery instead of being discarded.',
      };
    }
    return {
      kind: 'committed',
      clipId: result.clipId,
      trackId,
      mediaId: result.mediaRef.id,
      name: result.mediaRef.name,
      durationSec: result.durationSec,
      bytes: result.mediaRef.byteSize,
      mimeType: result.mediaRef.mimeType ?? 'unknown',
      silent: result.silent,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // `.catch` on the stash as well: this path is already handling a failure,
    // and a second one must still produce an outcome rather than reject into a
    // caller that has no take state left to clean up.
    await stashRecovery(take.blob, take.mimeType, recoveryMeta).catch(() => null);
    return {
      kind: 'recovered',
      message: `Could not save the take (${msg}). It was kept for recovery.`,
    };
  }
}
