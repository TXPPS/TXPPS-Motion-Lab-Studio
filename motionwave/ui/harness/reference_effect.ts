/**
 * Motion Wave — a reference effect, built only to exercise the harness.
 *
 * This is a fixture, not a unit. It appears in no ledger, ships in nothing, and
 * exists so that the twenty-three cells can be run against something real on a
 * host with no C++ core: a harness whose checks have never executed is a
 * harness nobody knows the state of, and the first unit to plug into it would
 * be debugging the harness rather than itself.
 *
 * Everything about it is chosen to make a cell meaningful rather than to sound
 * good. Its wet path is linear phase, so the latency it declares is a fact
 * about a symmetric impulse response rather than an estimate. Its bypass is a
 * pure integer delay, so a null test that leaves anything behind means a real
 * defect. Its blend goes through `WetDryMixer`, so the comb this framework
 * exists to prevent would show up here first.
 */

import { AutomationLane } from '../automation/lane';
import { declareLatency } from '../mix/latency';
import { WetDryMixer } from '../mix/wet_dry';
import { DelayLine } from '../mix/delay_line';
import { type Ramp, rampAt, steady } from '../param/ramp';
import { type ParamId, defineParam } from '../param/spec';
import { Taper, Unit } from '../param/units';
import type { MeterChannel } from '../metering/bus';
import type { RenderContext, UnitRenderer, UnitUnderTest } from './types';

export const DRIVE: ParamId = 1;
export const TONE: ParamId = 2;
export const SHAPE: ParamId = 3;
export const MIX: ParamId = 4;
export const OUTPUT: ParamId = 5;
export const DEPTH: ParamId = 6;
export const RATE: ParamId = 7;

/** Symmetric, so the impulse response is symmetric and the peak is the centre. */
const TAPS = 129;
const LATENCY_FRAMES = (TAPS - 1) / 2;

/** Beats per cycle for each division the Rate switch offers. */
const DIVISION_BEATS = [4, 2, 1, 0.5];

export const REFERENCE_SPECS = [
  defineParam({ id: DRIVE, name: 'Drive', unit: Unit.Decibels, min: -12, max: 12, def: 0 }),
  defineParam({
    id: TONE,
    name: 'Tone',
    unit: Unit.Hertz,
    min: 200,
    max: 8000,
    def: 4000,
    taper: Taper.Logarithmic,
    smoothingMs: 30,
  }),
  defineParam({ id: SHAPE, name: 'Shape', unit: Unit.Choice, choices: ['Low', 'Band', 'High'] }),
  defineParam({ id: MIX, name: 'Mix', unit: Unit.Percent, min: 0, max: 1, def: 1 }),
  defineParam({ id: OUTPUT, name: 'Output', unit: Unit.Decibels, min: -12, max: 6, def: 0 }),
  defineParam({ id: DEPTH, name: 'Depth', unit: Unit.Percent, min: 0, max: 1, def: 0 }),
  defineParam({
    id: RATE,
    name: 'Rate',
    unit: Unit.Choice,
    choices: ['1/1', '1/2', '1/4', '1/8'],
    def: 2,
  }),
];

export const REFERENCE_METERS: readonly MeterChannel[] = [
  { name: 'in', kind: 'peak' },
  { name: 'out', kind: 'peak' },
];

function decibelsToGain(db: number): number {
  return Math.pow(10, db / 20);
}

/** A windowed-sinc low-pass, normalised to unit gain at DC. */
function lowPassKernel(into: Float64Array, normalisedCutoff: number): void {
  const centre = (TAPS - 1) / 2;
  let sum = 0;
  for (let i = 0; i < TAPS; i++) {
    const offset = i - centre;
    const sinc =
      offset === 0
        ? 2 * normalisedCutoff
        : Math.sin(2 * Math.PI * normalisedCutoff * offset) / (Math.PI * offset);
    // Hann. A rectangular window leaves −21 dB of stopband ripple, which on the
    // noise section of the harness's probe signal is loud enough to make two
    // different cutoffs measure the same.
    const window = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (TAPS - 1));
    into[i] = sinc * window;
    sum += into[i];
  }
  if (sum !== 0) {
    for (let i = 0; i < TAPS; i++) into[i] /= sum;
  }
}

export class ReferenceEffectRenderer implements UnitRenderer {
  readonly declaredLatency = declareLatency(
    LATENCY_FRAMES,
    'derived',
    `linear-phase FIR of ${TAPS} taps, so the group delay is exactly (n-1)/2`,
  );

  private readonly mixer = WetDryMixer.forWetPath(this.declaredLatency);
  private readonly bypassDelay = new DelayLine(LATENCY_FRAMES);
  private readonly kernel = new Float64Array(TAPS);
  private readonly scratch = new Float64Array(TAPS);
  private readonly history = new Float32Array(TAPS);
  private wet = new Float32Array(0);
  private historyIndex = 0;
  private sampleRate = 48000;
  private tempoBpm = 120;
  private bypassed = false;
  private lastCutoff = -1;
  private lastShape = -1;
  private tremoloPhase = 0;

  prepare(context: RenderContext): void {
    this.sampleRate = context.sampleRate;
    this.tempoBpm = context.tempoBpm;
    if (this.wet.length < context.blockFrames) this.wet = new Float32Array(context.blockFrames);
    this.lastCutoff = -1;
    this.lastShape = -1;
  }

  reset(): void {
    this.history.fill(0);
    this.historyIndex = 0;
    this.tremoloPhase = 0;
    this.mixer.reset();
    this.bypassDelay.reset();
  }

  setBypass(bypassed: boolean): void {
    this.bypassed = bypassed;
  }

  processBlock(
    input: Float32Array,
    output: Float32Array,
    frames: number,
    params: ReadonlyMap<ParamId, Ramp>,
  ): void {
    if (this.bypassed) {
      // A pure delay, so a bypassed unit stays exactly where the compensation
      // put it. Passing the input through undelayed would move the track in
      // time every time somebody clicked bypass.
      for (let i = 0; i < frames; i++) output[i] = this.bypassDelay.tick(input[i]);
      return;
    }

    const drive = params.get(DRIVE) ?? steady(0);
    const tone = params.get(TONE) ?? steady(2000);
    const shape = Math.round((params.get(SHAPE) ?? steady(0)).end);
    const mix = params.get(MIX) ?? steady(1);
    const level = params.get(OUTPUT) ?? steady(0);
    const depth = params.get(DEPTH) ?? steady(0);
    const rate = Math.round((params.get(RATE) ?? steady(2)).end);

    this.updateKernel(tone.end, shape);
    const beats = DIVISION_BEATS[Math.max(0, Math.min(DIVISION_BEATS.length - 1, rate))];
    const phaseStep = this.tempoBpm / 60 / beats / this.sampleRate;

    for (let i = 0; i < frames; i++) {
      const gain = decibelsToGain(rampAt(drive, i, frames));
      const filtered = this.filter(input[i] * gain);
      const modulation =
        1 - rampAt(depth, i, frames) * 0.5 * (1 - Math.cos(2 * Math.PI * this.tremoloPhase));
      this.wet[i] = filtered * modulation;
      this.tremoloPhase += phaseStep;
      if (this.tremoloPhase >= 1) this.tremoloPhase -= 1;
    }

    this.mixer.processRamped(input, this.wet, output, frames, mix);
    for (let i = 0; i < frames; i++) output[i] *= decibelsToGain(rampAt(level, i, frames));
  }

  /**
   * Recomputed only when the cutoff or the shape has actually moved.
   *
   * Rebuilding sixty-five taps every block would be wasted work, but the reason
   * the guard is here is correctness rather than cost: a kernel rebuilt from a
   * value that has not changed still lands on the same numbers, and a test that
   * compares two buffer sizes has to see the same coefficients in both.
   */
  private updateKernel(cutoffHz: number, shape: number): void {
    if (cutoffHz === this.lastCutoff && shape === this.lastShape) return;
    this.lastCutoff = cutoffHz;
    this.lastShape = shape;
    const normalised = Math.max(0.001, Math.min(0.45, cutoffHz / this.sampleRate));

    if (shape === 0) {
      lowPassKernel(this.kernel, normalised);
      return;
    }
    if (shape === 2) {
      // Spectral inversion: a symmetric low-pass subtracted from a centred
      // impulse is a symmetric high-pass, so the group delay does not move and
      // the declared latency stays true for every setting of the switch.
      lowPassKernel(this.kernel, normalised);
      for (let i = 0; i < TAPS; i++) this.kernel[i] = -this.kernel[i];
      this.kernel[(TAPS - 1) / 2] += 1;
      return;
    }
    const upper = Math.min(0.45, (cutoffHz * 2) / this.sampleRate);
    lowPassKernel(this.scratch, upper > normalised ? upper : Math.min(0.45, normalised * 1.5));
    lowPassKernel(this.kernel, normalised);
    for (let i = 0; i < TAPS; i++) this.kernel[i] = this.scratch[i] - this.kernel[i];
  }

  private filter(sample: number): number {
    this.history[this.historyIndex] = sample;
    let sum = 0;
    let index = this.historyIndex;
    for (let tap = 0; tap < TAPS; tap++) {
      sum += this.kernel[tap] * this.history[index];
      index = index === 0 ? TAPS - 1 : index - 1;
    }
    this.historyIndex = this.historyIndex === TAPS - 1 ? 0 : this.historyIndex + 1;
    return sum;
  }
}

/** The fixture, assembled. Its sheet claims are about this code, not a machine. */
export function makeReferenceEffect(): UnitUnderTest {
  const renderer = new ReferenceEffectRenderer();
  return {
    id: 'ref-00',
    name: 'Reference Shaper',
    kind: 'effect',
    specs: REFERENCE_SPECS,
    declaredLatency: renderer.declaredLatency,
    presetMeta: { unit: 'ref-00', unitVersion: 1, name: 'Init' },
    meters: REFERENCE_METERS,
    renderer,
    tempoSyncedParams: [RATE],
    // Rate is inaudible until the tremolo has depth, so the checks that have to
    // hear it say what to hold the rest of the unit at while they listen.
    wiringContext: (paramId) => (paramId === RATE ? new Map([[DEPTH, 1]]) : new Map()),
    sheetTargets: [
      {
        what: 'passband is flat at 300 Hz with the tone control at 2 kHz',
        params: new Map([[TONE, 0.6241]]),
        probeHz: 300,
        expectedDb: 0,
        toleranceDb: 1,
      },
      {
        what: '+6 dB of drive is +6 dB in the passband',
        params: new Map([
          [TONE, 0.6241],
          [DRIVE, 0.75],
        ]),
        probeHz: 300,
        expectedDb: 6,
        toleranceDb: 1,
      },
    ],
    face: referenceFace(),
  };
}

/** An automation lane over the fixture, for tests that need one ready-made. */
export function referenceLane(paramId: ParamId, ticks: number): AutomationLane {
  const lane = new AutomationLane(paramId);
  lane.add({ tick: 0, value: 0, curve: 'linear' });
  lane.add({ tick: ticks, value: 1, curve: 'linear' });
  return lane;
}

function referenceFace(): UnitUnderTest['face'] {
  const control = (id: string, paramId: ParamId, name: string) => ({
    id,
    role: 'knob' as const,
    paramId,
    accessibleName: name,
    keyboardFocusable: true,
    colours: [{ foreground: '--mw-fg', background: '--mw-bg-panel' }],
  });
  return {
    elements: [
      control('drive', DRIVE, 'Drive'),
      control('tone', TONE, 'Tone'),
      {
        id: 'shape',
        role: 'switch',
        paramId: SHAPE,
        accessibleName: 'Shape',
        keyboardFocusable: true,
        colours: [{ foreground: '--mw-fg-muted', background: '--mw-bg-raised' }],
      },
      control('mix', MIX, 'Mix'),
      control('output', OUTPUT, 'Output'),
      control('depth', DEPTH, 'Depth'),
      {
        id: 'rate',
        role: 'switch',
        paramId: RATE,
        accessibleName: 'Rate',
        keyboardFocusable: true,
        colours: [{ foreground: '--mw-fg-muted', background: '--mw-bg-raised' }],
      },
      {
        id: 'meter-in',
        role: 'meter',
        paramId: null,
        meterChannel: 'in',
        accessibleName: 'Input level',
        keyboardFocusable: false,
        colours: [{ foreground: '--mw-meter-low', background: '--mw-meter-bg' }],
      },
      {
        id: 'meter-out',
        role: 'meter',
        paramId: null,
        meterChannel: 'out',
        accessibleName: 'Output level',
        keyboardFocusable: false,
        colours: [{ foreground: '--mw-meter-high', background: '--mw-meter-bg' }],
      },
    ],
    artwork: [{ id: 'panel', origin: 'original', attribution: 'drawn for Motion Wave' }],
    breakpointsEm: [18, 26, 38],
    minWidthRem: 16,
  };
}
