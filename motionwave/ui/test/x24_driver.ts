/**
 * The shape a Ledger cell X24 test has, for every unit but the first.
 *
 * X24 asks for one integration test per unit: a real face driving a real
 * engine, getting back real audio and the real state the audio path published.
 * Five units need that now, and five copies of the same module loading and heap
 * arithmetic is five chances to read the visual frame at the wrong offset and
 * be wrong only on the unit nobody looked at.
 *
 * So the mechanics are here once. What stays in each unit's own file is the
 * part that is genuinely that unit's: which controls to turn, what the audio
 * should do when they are turned, and what the published frame means.
 *
 * The Motion Shaper keeps its own file and its own loader. It has two exports
 * the others do not — a curve of breakpoints and a tempo — and rewriting a
 * passing 24/24 test to share a helper is a change with no upside and a real
 * chance of breaking the one unit that is finished.
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { indexSpecs, toReal } from '../param/spec';
import type { ParamSpec } from '../param/spec';

const here = dirname(fileURLToPath(import.meta.url));
const wasmModule = join(here, '..', '..', 'wasm', 'dist', 'motionwave.mjs');

/**
 * The exports every unit has.
 *
 * Indexed rather than named, because the names differ by unit and a driver that
 * hard-coded one unit's would be the thing this file exists to avoid. The
 * prefix is the only per-unit knowledge here.
 */
export interface CoreModule {
  HEAPF32: Float32Array;
  HEAPF64: Float64Array;
  _malloc(bytes: number): number;
  _free(ptr: number): void;
  [entry: string]: unknown;
}

let cached: CoreModule | null = null;

/** Load the same `.wasm` the app loads. Once per process; it holds one unit each. */
export async function loadCore(): Promise<CoreModule> {
  if (cached) return cached;
  const factory = (await import(/* @vite-ignore */ wasmModule)) as {
    default: () => Promise<CoreModule>;
  };
  cached = await factory.default();
  return cached;
}

export interface Frame {
  /** Peak of the block, from the audio itself. */
  peak: number;
  /** The doubles the unit published, in the order its bridge packs them. */
  visual: number[];
  /** How many times the audio path has published. */
  generation: number;
}

export class UnitDriver {
  constructor(
    private readonly core: CoreModule,
    private readonly prefix: string,
    private readonly specs: ReadonlyMap<number, ParamSpec>,
    private readonly visualCount: number,
    readonly rate = 48000,
    readonly block = 128,
    readonly channels = 2,
  ) {}

  static from(
    core: CoreModule,
    prefix: string,
    specs: readonly ParamSpec[],
    visualCount: number,
  ): UnitDriver {
    return new UnitDriver(core, prefix, indexSpecs(specs), visualCount);
  }

  private call<T>(entry: string, ...args: number[]): T {
    const fn = this.core[`_${this.prefix}_${entry}`] as ((...a: number[]) => T) | undefined;
    if (typeof fn !== 'function') {
      throw new Error(`the module does not export _${this.prefix}_${entry}`);
    }
    return fn(...args);
  }

  prepare(): void {
    this.call<void>('prepare', this.rate, this.block, this.channels);
    this.call<void>('set_bypass', 0);
  }

  setParam(id: number, real: number): void {
    this.call<void>('set_param', id, real);
  }

  setBypass(on: boolean): void {
    this.call<void>('set_bypass', on ? 1 : 0);
  }

  /**
   * Set a control the way the panel does: a normalised knob position, converted
   * to a real value by the parameter's own spec, sent under the parameter's own
   * id.
   *
   * This is what makes an X24 test an integration test rather than a second
   * unit test. A control naming an id the engine does not have cannot be
   * written down — the tables are generated together — but a *taper* that
   * disagreed with the DSP's expectation arrives as a plausible number in the
   * wrong place, and only a round trip through real audio shows it.
   */
  turn(id: number, normalised: number): number {
    const spec = this.specs.get(id);
    if (!spec) throw new Error(`no spec for parameter ${id}`);
    const real = toReal(spec, normalised);
    this.setParam(id, real);
    return real;
  }

  /** Write one block of a steady tone at `amplitude`, starting at `startFrame`. */
  fillTone(startFrame: number, hz: number, amplitude: number): void {
    const base = this.call<number>('input') / Float32Array.BYTES_PER_ELEMENT;
    for (let i = 0; i < this.block; i++) {
      const t = (startFrame + i) / this.rate;
      const v = amplitude * Math.sin(2 * Math.PI * hz * t);
      for (let c = 0; c < this.channels; c++) {
        this.core.HEAPF32[base + i * this.channels + c] = v;
      }
    }
  }

  /** Write one block of silence — for the rows that measure a recovery. */
  fillSilence(): void {
    const base = this.call<number>('input') / Float32Array.BYTES_PER_ELEMENT;
    for (let i = 0; i < this.block * this.channels; i++) this.core.HEAPF32[base + i] = 0;
  }

  processBlock(startFrame: number): Frame {
    this.call<void>('process', this.block, this.rate, startFrame / this.rate, 1);
    const outBase = this.call<number>('output') / Float32Array.BYTES_PER_ELEMENT;
    let peak = 0;
    for (let i = 0; i < this.block * this.channels; i++) {
      peak = Math.max(peak, Math.abs(this.core.HEAPF32[outBase + i]));
    }
    const visualBase = this.call<number>('visual') / Float64Array.BYTES_PER_ELEMENT;
    const visual: number[] = [];
    for (let i = 0; i < this.visualCount; i++) visual.push(this.core.HEAPF64[visualBase + i]);
    return { peak, visual, generation: this.call<number>('generation') };
  }

  /** Drive a tone for `blocks` blocks, capturing audio and frame together. */
  run(blocks: number, hz: number, amplitude: number, from = 0): Frame[] {
    const out: Frame[] = [];
    for (let b = 0; b < blocks; b++) {
      const start = from + b * this.block;
      this.fillTone(start, hz, amplitude);
      out.push(this.processBlock(start));
    }
    return out;
  }

  /** The same with no input, for measuring what the unit does after a signal. */
  runSilent(blocks: number, from = 0): Frame[] {
    const out: Frame[] = [];
    for (let b = 0; b < blocks; b++) {
      this.fillSilence();
      out.push(this.processBlock(from + b * this.block));
    }
    return out;
  }
}

/**
 * The assertion every X24 test carries, and the one that catches a timer.
 *
 * A face driven by a timer rather than by the engine passes every other check
 * in this file: it shows numbers, they move, they look plausible. What it
 * cannot do is publish exactly once per processed block — so the generation
 * counter advancing by one per block, and *not at all* when nothing is
 * processed, is the discriminator. It is kept as the template for every unit
 * for that reason.
 */
export function expectPublishedOncePerBlock(frames: readonly Frame[]): void {
  for (let i = 1; i < frames.length; i++) {
    if (frames[i].generation - frames[i - 1].generation !== 1) {
      throw new Error(
        `block ${i} published ${frames[i].generation - frames[i - 1].generation} times, not once`,
      );
    }
  }
}
