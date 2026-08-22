import { choiceOf } from '../model/effects';
import type { Effect } from '../model/types';

/**
 * Which tempo a tempo-synced insert is driven by.
 *
 * A delay set to 1/8, a tremolo set to 1/4, a phaser sweeping in bars — each
 * turns a musical division into a time in seconds, and that conversion needs a
 * tempo. The project carries a scalar `bpm` that looks like the answer and is
 * not: it is pinned to the tempo map's value at beat 0 so that older builds and
 * export headers keep working. Under any project with a tempo change, driving
 * an insert from it means every synced effect in the song runs at the tempo the
 * song *starts* at. At a 120→160 change a 6/16 delay lands on 0.7500 s where
 * the bar wants 0.5625 s — a third long, which is not a subtle detune but a
 * different rhythm.
 *
 * So the tempo has to be sampled at the position being played or rendered. That
 * raises the second question this module answers: how often to re-sample. A
 * tempo *ramp* moves continuously, and re-driving a chain every frame would put
 * a full insert update pass — including the waveshaper curve rebuilds several
 * effects perform on any update — on the frame loop for the ramp's whole
 * length. So a re-sync is gated on a *relative* move.
 */

/**
 * Relative tempo change that is worth re-driving the inserts for.
 *
 * Half a per cent. The error this tolerates is proportional: on a half-second
 * delay it is 2.5 ms, and on a 10 Hz tremolo it is 0.05 Hz — below the
 * threshold at which either is a rhythm rather than a tuning. A full 120→160
 * ramp crosses this about sixty times, so the cost is a few passes per second
 * instead of one per frame.
 */
export const TEMPO_SYNC_EPS = 0.005;

/**
 * True when the inserts, last driven at `held`, should be re-driven at `next`.
 *
 * `held` of zero means nothing has been driven yet, which is always worth a
 * pass. A non-finite or non-positive `next` is refused rather than propagated:
 * a bpm of zero would make every synced division infinitely long.
 */
export function shouldRetempo(held: number, next: number): boolean {
  if (!Number.isFinite(next) || next <= 0) return false;
  if (!(held > 0)) return true;
  return Math.abs(next - held) / held > TEMPO_SYNC_EPS;
}

/** True when a project's tempo map actually varies, so the check is worth running. */
export function tempoVaries(p: { tempoMap?: { tempos: unknown[] } | null }): boolean {
  const tempos = p.tempoMap?.tempos;
  return Array.isArray(tempos) && tempos.length > 1;
}

/**
 * Whether anything in the project actually reads the tempo.
 *
 * Only effects whose `sync` switch is on convert a division into a rate, so a
 * project without one needs no tempo tracking at all. Worth knowing because the
 * offline renderer buys tracking with `suspend` calls, and adding thousands of
 * them to a bounce that cannot use them would be a straight cost for nothing.
 */
export function hasTempoSyncedInsert(p: {
  tracks?: { effects?: Effect[] }[];
  master?: { effects?: Effect[] } | null;
}): boolean {
  const synced = (list?: Effect[]) => (list ?? []).some((e) => choiceOf(e, 'sync') === 1);
  if (synced(p.master?.effects)) return true;
  return (p.tracks ?? []).some((t) => synced(t.effects));
}
