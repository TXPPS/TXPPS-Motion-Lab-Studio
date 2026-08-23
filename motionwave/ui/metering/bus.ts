/**
 * Motion Wave — named meters over one snapshot, and the ballistics a face draws.
 *
 * A unit declares the meters it has; the framework allocates their slots and
 * hands the processor a snapshot to publish into. Nothing about the transport
 * is per-unit, which is what makes the harness's U21 cell meaningful: a unit
 * that fed its face directly instead of through here would be reading engine
 * state on the UI thread, and no amount of care in the face would fix it.
 *
 * The ballistics live on the reading side on purpose. Peak hold and decay are a
 * property of how a person reads a meter, not of the signal, and computing them
 * on the audio thread would spend the budget the phone tier does not have on a
 * number that is only ever looked at.
 */

import { MeterSnapshot } from './snapshot';

/** What a meter measures. Drives the scale a face draws it against. */
export type MeterKind = 'peak' | 'rms' | 'reduction' | 'level' | 'raw';

export interface MeterChannel {
  readonly name: string;
  readonly kind: MeterKind;
}

/** Silence, in dBFS. Anything quieter is reported as this rather than −∞. */
export const METER_FLOOR_DB = -120;

export function amplitudeToDb(amplitude: number): number {
  const magnitude = Math.abs(amplitude);
  if (!(magnitude > 0)) return METER_FLOOR_DB;
  const db = 20 * Math.log10(magnitude);
  return db < METER_FLOOR_DB ? METER_FLOOR_DB : db;
}

export class MeterBus {
  readonly channels: readonly MeterChannel[];
  readonly snapshot: MeterSnapshot;
  private readonly slots: ReadonlyMap<string, number>;

  constructor(channels: readonly MeterChannel[]) {
    if (channels.length === 0) throw new RangeError('a MeterBus needs at least one channel');
    const slots = new Map<string, number>();
    channels.forEach((channel, index) => {
      if (slots.has(channel.name)) {
        throw new Error(`duplicate meter channel "${channel.name}"`);
      }
      slots.set(channel.name, index);
    });
    this.channels = channels;
    this.slots = slots;
    this.snapshot = new MeterSnapshot(channels.length);
  }

  slotOf(name: string): number {
    return this.slots.get(name) ?? -1;
  }

  /** Publishes one frame from the processor side. Values are linear amplitude. */
  publish(frame: ArrayLike<number>): void {
    this.snapshot.publish(frame);
  }

  reader(): MeterReader {
    return new MeterReader(this);
  }
}

/**
 * A per-face view of a bus.
 *
 * Holds its own copy so that a torn read costs nothing: the frame it already
 * had is still the last complete one, and a meter that repeats a frame at
 * 60 fps is invisible, where one that flashes to zero is not.
 */
export class MeterReader {
  private readonly bus: MeterBus;
  /** Where a read lands before it is known to be whole. */
  private readonly scratch: Float32Array;
  private readonly frame: Float32Array;
  private readonly held: Float32Array;
  private missed = 0;

  constructor(bus: MeterBus) {
    this.bus = bus;
    this.scratch = new Float32Array(bus.channels.length);
    this.frame = new Float32Array(bus.channels.length);
    this.held = new Float32Array(bus.channels.length);
  }

  /** Frames dropped because a write was in flight. Diagnostics only. */
  get missedFrames(): number {
    return this.missed;
  }

  /**
   * Takes a frame and advances the ballistics. `decayDb` is how far a held peak
   * falls this frame; at 60 fps, 0.4 dB gives the ~24 dB/second fall that reads
   * as a meter rather than as a light switch.
   */
  poll(decayDb = 0.4): boolean {
    const fresh = this.bus.snapshot.read(this.scratch);
    // Committed only on success. A torn read has already overwritten the
    // scratch with a mixture of two frames, and showing that is worse than
    // showing the last whole one — a meter briefly reading a peak that never
    // occurred is how a mix engineer is sent chasing a transient that is not
    // in the file.
    if (fresh) this.frame.set(this.scratch);
    else this.missed += 1;
    const decay = Math.pow(10, -decayDb / 20);
    for (let i = 0; i < this.held.length; i++) {
      const value = this.frame[i];
      const fallen = this.held[i] * decay;
      this.held[i] = value > fallen ? value : fallen;
    }
    return fresh;
  }

  /** The instantaneous value of a channel, linear. */
  value(name: string): number {
    const slot = this.bus.slotOf(name);
    return slot < 0 ? 0 : this.frame[slot];
  }

  /** The held-and-decaying value, which is what a bar is drawn to. */
  holdOf(name: string): number {
    const slot = this.bus.slotOf(name);
    return slot < 0 ? 0 : this.held[slot];
  }

  /** The held value in dBFS, which is what a scale is printed in. */
  heldDb(name: string): number {
    return amplitudeToDb(this.holdOf(name));
  }
}
