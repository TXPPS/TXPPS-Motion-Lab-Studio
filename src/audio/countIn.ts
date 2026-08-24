/**
 * The count-in: N bars of metronome before capture begins.
 *
 * Split out of `recordingController.ts` because it is its own small machine —
 * a cancellable countdown that resolves once — and because it had a defect the
 * controller's size was hiding.
 *
 * **It counted at the wrong tempo.** It read `project.bpm` and
 * `project.timeSig`, which are the values at bar 1, while every other timing
 * decision in the recording path goes through `tempoMapOf` and `beatsPerBarAt`
 * for the beat actually in question. Punch in at bar 40 of a song that slows to
 * 90 there and the count-in clicked at 120 in 4/4 — it counted you in to a
 * tempo the take was not going to be recorded at, which is the one job it has.
 *
 * The tempo is taken at the roll point rather than integrated backwards across
 * the count-in bars. A count-in that accelerated through itself would be
 * technically truer to a ramp and useless to play to: what a musician needs is
 * the pulse they are about to join.
 *
 * The clicks and the beat display arrive as callbacks so this module needs
 * neither the engine nor a store, and so it can be tested without either.
 */
import { beatsPerBarAt, bpmAt } from '../model/tempo';
import { tempoMapOf } from '../model/music';
import type { ProjectData } from '../model/types';

export interface CountInHooks {
  /** Sound one click. `accent` marks the first beat of a bar. */
  click: (accent: boolean) => void;
  /** Beats still to come, for the display. Reaches 0 exactly once. */
  onBeat: (left: number) => void;
}

export class CountIn {
  private timer: ReturnType<typeof setInterval> | null = null;
  /**
   * The promise's resolver, held so an abort can settle it now.
   *
   * Clearing the interval kills the tick that would otherwise notice the
   * cancellation, so a version that only cleared it left the caller awaiting a
   * promise that could never settle — the recorder stuck at `countIn`, refusing
   * every later take for the rest of the session.
   */
  private settle: ((ok: boolean) => void) | null = null;

  get running(): boolean {
    return this.timer !== null;
  }

  /**
   * Count in and resolve true, or resolve false if aborted.
   *
   * `atBeat` is where the take will roll in from — the punch point when there
   * is one, not the playhead.
   */
  run(project: ProjectData, bars: number, atBeat: number, hooks: CountInHooks): Promise<boolean> {
    this.abort();
    const map = tempoMapOf(project);
    const beat = Math.max(0, atBeat);
    const bpb = beatsPerBarAt(map, beat);
    const bpm = bpmAt(map, beat);
    const totalBeats = Math.max(0, Math.round(bpb * bars));
    if (totalBeats === 0) return Promise.resolve(true);

    const beatMs = (60 / Math.max(1, bpm)) * 1000;
    let left = totalBeats;
    hooks.onBeat(left);

    return new Promise<boolean>((resolve) => {
      this.settle = resolve;
      const tick = () => {
        // The accent falls on the downbeats of the count-in, counted back from
        // its end, so a two-bar count in 4/4 is ONE two three four ONE two
        // three four regardless of where in the bar the punch point sits.
        hooks.click(left % bpb === 0);
        left -= 1;
        hooks.onBeat(Math.max(0, left));
        if (left <= 0) this.finish(true);
      };
      tick(); // the first click is immediate; the interval carries the rest
      this.timer = setInterval(tick, beatMs);
    });
  }

  /** Stop counting and settle the promise the caller is waiting on. */
  abort(): void {
    this.finish(false);
  }

  private finish(ok: boolean): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    const settle = this.settle;
    this.settle = null;
    settle?.(ok);
  }
}
