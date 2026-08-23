/**
 * Motion Wave — latch, touch, write and trim, over one structure.
 *
 * ADR-0004: "Latch, touch, write and trim are recording modes over the same
 * structure, not four code paths." They differ only in when a parameter starts
 * writing, when it stops, and whether what it writes is the value or an offset
 * from the value already there. Everything else — where the points land, how
 * the span is cleared, how playback is held off the control — is shared, which
 * is why a fix to one mode is a fix to all four.
 */

import type { AutomationLane } from './lane';
import type { AutomationPlayer } from './player';
import type { ParamSet } from '../param/set';
import type { ParamId } from '../param/spec';

export type AutomationMode = 'off' | 'read' | 'touch' | 'latch' | 'write' | 'trim';

interface RecordState {
  writing: boolean;
  /** Ticks already written in this pass, so a re-pass erases what it replaces. */
  lastTick: number;
  /**
   * For trim: the distance between what the user is holding and what the lane
   * said at the moment they took hold. Captured once, at touch, so the offset
   * stays constant through the gesture — recomputing it per block would make
   * the trim chase its own output and run away.
   */
  trimDelta: number;
  /**
   * The lane as it was before this pass started. Trim has to read the shape it
   * is trimming, and by the time it asks, the live lane already contains the
   * points this pass has written — reading that back would feed the offset into
   * itself and the fader would climb to the ceiling on its own.
   */
  source: AutomationLane | null;
}

export class AutomationRecorder {
  mode: AutomationMode = 'read';
  private readonly player: AutomationPlayer;
  private readonly set: ParamSet;
  private readonly armed = new Set<ParamId>();
  private readonly states = new Map<ParamId, RecordState>();
  private rolling = false;

  constructor(player: AutomationPlayer, set: ParamSet) {
    this.player = player;
    this.set = set;
  }

  /** Marks a parameter as eligible to record. Write mode needs no gesture. */
  arm(paramId: ParamId): void {
    this.armed.add(paramId);
  }

  disarm(paramId: ParamId): void {
    this.armed.delete(paramId);
    this.finish(paramId);
  }

  isWriting(paramId: ParamId): boolean {
    return this.states.get(paramId)?.writing === true;
  }

  /**
   * The transport rolled. Write mode begins immediately on every armed
   * parameter — that is exactly what distinguishes it from latch, which waits
   * for a hand. A user who selects write, arms a fader and presses play expects
   * the pass to erase what was there whether or not they touch anything, and a
   * write mode that waits for a touch is indistinguishable from latch.
   */
  start(tick: number): void {
    this.rolling = true;
    if (this.mode !== 'write') return;
    for (const paramId of this.armed) this.begin(paramId, tick);
  }

  /** A control was taken hold of. */
  touch(paramId: ParamId, tick: number): void {
    if (!this.armed.has(paramId)) this.armed.add(paramId);
    this.stateFor(paramId);
    if (this.mode === 'off' || this.mode === 'read') return;
    this.begin(paramId, tick);
  }

  /**
   * A control was let go.
   *
   * Touch stops writing and hands the parameter back to its lane; latch and
   * write keep writing the value the user left until the transport stops. Trim
   * follows touch, because a trim that latched would keep applying an offset to
   * material the user has stopped listening to.
   */
  release(paramId: ParamId, tick: number): void {
    const state = this.states.get(paramId);
    if (state === undefined) return;
    if (this.mode === 'touch' || this.mode === 'trim') {
      this.writeAt(paramId, tick);
      this.finish(paramId);
    }
  }

  /**
   * One buffer of the pass. Records the current value for every parameter that
   * is writing, whether or not the user is moving it — a parameter that is
   * writing and not moving still has to lay down a flat line, or the lane keeps
   * whatever was underneath and the pass appears to have done nothing.
   */
  advance(tick: number): ParamId[] {
    if (!this.rolling) return [];
    const written: ParamId[] = [];
    for (const [paramId, state] of this.states) {
      if (!state.writing) continue;
      this.writeAt(paramId, tick);
      written.push(paramId);
    }
    return written;
  }

  /** The transport stopped: every mode lets go and playback resumes. */
  stop(): void {
    this.rolling = false;
    for (const paramId of [...this.states.keys()]) this.finish(paramId);
  }

  private stateFor(paramId: ParamId): RecordState {
    const existing = this.states.get(paramId);
    if (existing !== undefined) return existing;
    const created: RecordState = { writing: false, lastTick: -1, trimDelta: 0, source: null };
    this.states.set(paramId, created);
    return created;
  }

  private begin(paramId: ParamId, tick: number): void {
    const state = this.stateFor(paramId);
    if (state.writing) return;
    state.writing = true;
    state.lastTick = tick;
    // Playback is suspended for the whole pass rather than per block, so a lane
    // cannot post a value between two of the recorder's own writes and leave a
    // point from the old automation stranded inside the new pass.
    this.player.suspend(paramId);

    const lane = this.player.lane(paramId);
    state.source = lane.isEmpty ? null : lane.clone();
    const underneath = state.source === null ? Number.NaN : state.source.valueAt(tick);
    // Trim over an empty lane has nothing to trim, so it records absolutely.
    // The alternative — refusing to record — leaves the user holding a fader
    // that visibly moves and writes nothing, which reads as a broken mode.
    state.trimDelta = Number.isFinite(underneath) ? this.set.normalised(paramId) - underneath : 0;
    this.writeAt(paramId, tick);
  }

  private writeAt(paramId: ParamId, tick: number): void {
    const state = this.states.get(paramId);
    if (state === undefined || !state.writing) return;
    const lane = this.player.lane(paramId);

    // Everything between the last write and this one is replaced. Without the
    // clear, a second pass interleaves its points with the first and the lane
    // plays a sawtooth between two takes.
    if (tick > state.lastTick) lane.clearRange(state.lastTick + 1, tick + 1);

    const value =
      this.mode === 'trim' && state.source !== null
        ? state.source.valueAt(tick) + state.trimDelta
        : this.set.normalised(paramId);
    lane.add({ tick, value, curve: 'linear' });
    state.lastTick = tick;
  }

  private finish(paramId: ParamId): void {
    const state = this.states.get(paramId);
    if (state === undefined) return;
    state.writing = false;
    state.source = null;
    this.player.resume(paramId);
  }
}
