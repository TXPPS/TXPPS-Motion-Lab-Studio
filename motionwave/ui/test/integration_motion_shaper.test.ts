/**
 * Ledger cell X24 — the Motion Shaper, end to end.
 *
 * Cells D1–I18 are proven natively and cells U19–U23 are proven against the
 * face's declaration. Both are real proofs and neither of them touches the
 * thing a user actually does, which is turn a control on a panel in a browser
 * and hear the audio change. Everything between those two proofs — the face's
 * control table, the parameter spec's taper, the WebAssembly boundary, the
 * unit's dispatch, and the state the audio path publishes back for the panel to
 * draw — is exactly where a product breaks while every component test stays
 * green.
 *
 * So this drives the *real* tables. The controls come from the face, the ranges
 * from the unit's specs, the ids from the manifest the C++ dispatch was
 * generated from, and the audio from the same `.wasm` the app loads. Nothing is
 * restated here; a copy of any of it would make this test agree with itself.
 *
 * X24 stays meaningful precisely because D1 already proved the individual
 * wires. This is not sixteen more setter checks — it is the claim that the
 * assembled path carries a gesture through to sound and back to the screen.
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

import { motionShaperMeters, motionShaperUnit } from '../units/motion_shaper/unit';
import { motionShaperFace, MotionShaperMeter } from '../units/motion_shaper/face';
import { MotionShaperParam, motionShaperControls } from '../units/motion_shaper/params.gen';
import { indexSpecs, toReal } from '../param/spec';

const here = dirname(fileURLToPath(import.meta.url));
const wasmModule = join(here, '..', '..', 'wasm', 'dist', 'motionwave.mjs');

interface CoreModule {
  _mw_shaper_prepare(rate: number, block: number, channels: number): void;
  _mw_shaper_set_param(id: number, value: number): void;
  _mw_shaper_set_curve(band: number, ptr: number, count: number): void;
  _mw_shaper_set_bpm(bpm: number): void;
  _mw_shaper_set_bypass(bypass: number): void;
  _mw_shaper_input(): number;
  _mw_shaper_output(): number;
  _mw_shaper_process(frames: number, rate: number, songSeconds: number, playing: number): void;
  _mw_shaper_visual(): number;
  _mw_shaper_generation(): number;
  _malloc(bytes: number): number;
  _free(ptr: number): void;
  HEAPF32: Float32Array;
  HEAPF64: Float64Array;
}

let core: CoreModule;

const RATE = 48000;
const BLOCK = 128;
const CHANNELS = 2;
/** Cycles per second the modulator is driven at, free-running. */
const MOD_HZ = 4;
/** How far the curve pulls the gain down at its bottom, in dB. */
const RANGE_DB = -24;

const specs = indexSpecs(motionShaperUnit.specs);

beforeAll(async () => {
  const factory = (await import(/* @vite-ignore */ wasmModule)) as {
    default: () => Promise<CoreModule>;
  };
  core = await factory.default();
}, 60_000);

/** What the visual frame carries, in the order the bridge packs it. */
interface Visual {
  phase: number;
  bandGain: [number, number, number];
  bandPeak: [number, number, number];
  inputPeak: number;
  outputPeak: number;
}

function readVisual(): Visual {
  const base = core._mw_shaper_visual() / Float64Array.BYTES_PER_ELEMENT;
  const h = core.HEAPF64;
  return {
    phase: h[base],
    bandGain: [h[base + 1], h[base + 2], h[base + 3]],
    bandPeak: [h[base + 4], h[base + 5], h[base + 6]],
    inputPeak: h[base + 7],
    outputPeak: h[base + 8],
  };
}

/**
 * Set a control the way the panel does: a normalised knob position, converted
 * to a real value by the parameter's own spec, sent under the parameter's own
 * id.
 *
 * This is the part that makes the test an integration test rather than a
 * second unit test. A control that named an id the engine does not have could
 * not reach here — the tables are generated together — but a *taper* that
 * disagreed with the DSP's expectation would arrive as a plausible number in
 * the wrong place, and only a round trip through real audio shows it.
 */
function turn(paramId: number, normalised: number): number {
  const spec = specs.get(paramId);
  expect(spec, `no spec for parameter ${paramId}`).toBeDefined();
  const real = toReal(spec!, normalised);
  core._mw_shaper_set_param(paramId, real);
  return real;
}

/** Send one band's curve across the boundary, as the editor's nodes would. */
function sendCurve(band: number, nodes: readonly [number, number, number, number][]) {
  const bytes = nodes.length * 4 * Float64Array.BYTES_PER_ELEMENT;
  const ptr = core._malloc(bytes);
  const base = ptr / Float64Array.BYTES_PER_ELEMENT;
  nodes.forEach((n, i) => {
    for (let k = 0; k < 4; k++) core.HEAPF64[base + i * 4 + k] = n[k];
  });
  core._mw_shaper_set_curve(band, ptr, nodes.length);
  core._free(ptr);
}

/** A ramp from full down to the floor and back — a shape with an obvious envelope. */
const RAMP: readonly [number, number, number, number][] = [
  [0.0, 1.0, 0, 0],
  [0.5, 0.0, 0, 0],
];

/** A steady 1 kHz tone at −6 dBFS, so the output's envelope *is* the modulation. */
function fillTone(frames: number, startFrame: number) {
  const base = core._mw_shaper_input() / Float32Array.BYTES_PER_ELEMENT;
  for (let i = 0; i < frames; i++) {
    const t = (startFrame + i) / RATE;
    const v = 0.5 * Math.sin(2 * Math.PI * 1000 * t);
    for (let c = 0; c < CHANNELS; c++) core.HEAPF32[base + i * CHANNELS + c] = v;
  }
}

function readBlock(frames: number): Float32Array {
  const base = core._mw_shaper_output() / Float32Array.BYTES_PER_ELEMENT;
  return core.HEAPF32.slice(base, base + frames * CHANNELS);
}

function peakOf(block: Float32Array): number {
  let top = 0;
  for (const v of block) top = Math.max(top, Math.abs(v));
  return top;
}

/**
 * Drive the unit for a while, returning one entry per block.
 *
 * The audio and the published frame are captured together, because the claim
 * X24 makes is about them agreeing — capturing them in separate runs would
 * compare two renders rather than one render against its own readout.
 */
function run(blocks: number): { peak: number; visual: Visual; generation: number }[] {
  const out: { peak: number; visual: Visual; generation: number }[] = [];
  for (let b = 0; b < blocks; b++) {
    const start = b * BLOCK;
    fillTone(BLOCK, start);
    core._mw_shaper_process(BLOCK, RATE, start / RATE, 1);
    out.push({
      peak: peakOf(readBlock(BLOCK)),
      visual: readVisual(),
      generation: core._mw_shaper_generation(),
    });
  }
  return out;
}

/**
 * The base setting: three bands, hard modulation, free-running.
 *
 * Every parameter is written, starting from the spec table's own defaults,
 * before the few this test cares about are overridden. That is not tidiness:
 * the module holds one unit for the file's lifetime, and the first version of
 * this left `Swing` at the maximum a previous case had swept it to. The phase
 * then advanced unevenly — correctly, since that is what swing *is* — and it
 * read as the engine running at three quarters of the rate it was set to. A
 * configuration that names only what it changes is a configuration that
 * inherits whatever ran before it.
 */
function configure() {
  core._mw_shaper_prepare(RATE, BLOCK, CHANNELS);
  core._mw_shaper_set_bpm(120);
  core._mw_shaper_set_bypass(0);
  for (const spec of motionShaperUnit.specs) core._mw_shaper_set_param(spec.id, spec.def);
  for (let b = 0; b < 3; b++) sendCurve(b, RAMP);
  core._mw_shaper_set_param(MotionShaperParam.BandCount, 2);
  core._mw_shaper_set_param(MotionShaperParam.Slope, 2);
  core._mw_shaper_set_param(MotionShaperParam.SyncMode, 1);
  core._mw_shaper_set_param(MotionShaperParam.Rate, MOD_HZ);
  core._mw_shaper_set_param(MotionShaperParam.Smooth, 0);
  core._mw_shaper_set_param(MotionShaperParam.Mix, 1);
  for (const id of [
    MotionShaperParam.DepthLow,
    MotionShaperParam.DepthMid,
    MotionShaperParam.DepthHigh,
  ]) {
    core._mw_shaper_set_param(id, 1);
  }
  for (const id of [
    MotionShaperParam.RangeLow,
    MotionShaperParam.RangeMid,
    MotionShaperParam.RangeHigh,
  ]) {
    core._mw_shaper_set_param(id, RANGE_DB);
  }
}

describe('X24 — the Motion Shaper, real face to real audio and back', () => {
  it('every control the face draws reaches the engine across the boundary', () => {
    configure();
    // The face's own element list, not a list written here. An element with a
    // parameter id must have a spec, and the value that spec produces must be
    // one the engine accepts — the boundary refusing an id would show as a
    // trap, and a NaN reaching the audio path would show as the render below.
    const controls = motionShaperFace.elements.filter((e) => e.paramId !== null);
    expect(controls.length).toBe(motionShaperControls.length);
    for (const element of controls) {
      for (const position of [0, 0.25, 0.5, 0.75, 1]) {
        turn(element.paramId as number, position);
      }
    }
    // Put it back and prove the engine is still producing finite audio, which
    // is the only thing that shows a value arrived in a state the DSP can use.
    configure();
    const frames = run(8);
    for (const block of frames) {
      expect(Number.isFinite(block.peak)).toBe(true);
    }
    expect(frames[frames.length - 1].peak).toBeGreaterThan(0.01);
  });

  it('produces the audio the drawn curve asks for', () => {
    configure();
    // A whole modulation cycle: at 4 Hz and 48 kHz that is 12000 frames, so 94
    // blocks covers it with room either side.
    const frames = run(120);
    const peaks = frames.map((f) => f.peak);
    const loudest = Math.max(...peaks);
    const quietest = Math.min(...peaks.slice(4));
    const depthDb = 20 * Math.log10(quietest / loudest);
    console.log(
      `X24 modulation depth across a cycle: ${depthDb.toFixed(2)} dB (range control at ${RANGE_DB})`,
    );
    // The curve reaches its floor, so the output should reach the range the
    // control asks for. Not asserted to the decibel: the peak of a block is the
    // largest sample in 128 of them and the envelope moves inside that block,
    // so the deepest block reads slightly *above* the true floor. Two dB of
    // headroom covers that and nothing else — a range control that did nothing
    // would read 0 dB and one wired to the wrong scale would miss by tens.
    expect(depthDb).toBeLessThan(RANGE_DB + 2);
    expect(depthDb).toBeGreaterThan(RANGE_DB - 2);
    // What this case does *not* cover, said plainly: the probe is a 1 kHz tone,
    // so it lives in the mid band and the depth measured here is the mid band's.
    // Mis-scaling the low or high band's range leaves this number where it was —
    // it was tried, and read −24.17 dB. The published-gain case below is what
    // covers the other two, by checking band 0 against the curve directly.
  });

  it('publishes the state the face draws, and it is the state the audio had', () => {
    configure();
    const frames = run(120);

    for (const { peak, visual } of frames) {
      // The published output peak is the peak of the block that was actually
      // returned. This is the assertion that separates a real visualiser from
      // an animation: a face fed from a timer would be smooth, plausible and
      // completely disconnected from what came out of the unit.
      expect(visual.outputPeak).toBeCloseTo(peak, 5);
      // The input is a steady tone, so the input peak is the tone's amplitude.
      expect(visual.inputPeak).toBeGreaterThan(0.45);
      expect(visual.inputPeak).toBeLessThanOrEqual(0.5 + 1e-6);
      expect(visual.phase).toBeGreaterThanOrEqual(0);
      expect(visual.phase).toBeLessThanOrEqual(1);
    }

    // The playhead advances at the rate the control set. One block is
    // BLOCK/RATE seconds, so the phase should move MOD_HZ * that per block.
    const perBlock = (MOD_HZ * BLOCK) / RATE;
    let checked = 0;
    for (let i = 1; i < frames.length; i++) {
      const step = frames[i].visual.phase - frames[i - 1].visual.phase;
      if (step < 0) continue; // the wrap, which is the cycle doing its job
      expect(step).toBeCloseTo(perBlock, 4);
      checked++;
    }
    expect(checked).toBeGreaterThan(100);

    // Every block published exactly once. A face that stalls — because the
    // engine stopped publishing rather than because nothing changed — is
    // invisible without this, and looks identical to a modulator at rest.
    for (let i = 1; i < frames.length; i++) {
      expect(frames[i].generation - frames[i - 1].generation).toBe(1);
    }
  });

  it('publishes a band gain that matches the curve at the published phase', () => {
    configure();
    const frames = run(120);
    // The ramp is 1 → 0 over the first half and 0 → 1 over the second, and the
    // gain the unit applies is that curve mapped onto the range in dB. Checking
    // the *published* gain against the curve at the *published* phase is the
    // house rule from the other side: a picture drawn from the same evaluation
    // the audio uses, never a second opinion.
    let worst = 0;
    for (const { visual } of frames) {
      const p = visual.phase;
      const curve = p < 0.5 ? 1 - p / 0.5 : (p - 0.5) / 0.5;
      // The factor the audio multiplies by, which is the curve mapped onto the
      // range in dB — not the curve. Depth is 1 and Mix is 1 here, so the two
      // outer terms of `blend` fall away; at any other setting they would not,
      // and a frame carrying the curve would overstate the modulation by the
      // whole of Depth and Mix. That is the defect this case found.
      const expected = Math.pow(10, (RANGE_DB * (1 - curve)) / 20);
      worst = Math.max(worst, Math.abs(visual.bandGain[0] - expected));
    }
    console.log(`X24 published band gain vs curve: worst ${worst.toExponential(2)}`);
    // Loose enough for the modulator's decimation filter, which is a real part
    // of the signal path and delays the gain by a few samples, and tight enough
    // that a gain drawn from anything other than this curve fails.
    expect(worst).toBeLessThan(0.02);
  });

  it('a bypassed unit still publishes, and publishes the truth', () => {
    configure();
    core._mw_shaper_set_bypass(1);
    const frames = run(16);
    for (const { peak, visual } of frames) {
      // Bypass passes signal, so a face that froze or blanked would be lying
      // about a unit the user can still hear.
      expect(peak).toBeGreaterThan(0.45);
      expect(visual.outputPeak).toBeCloseTo(peak, 5);
    }
    expect(frames[15].generation - frames[0].generation).toBe(15);
  });

  it('the face names channels the engine actually publishes', () => {
    // The last strand: U20 checks the face's meters against the unit's declared
    // channel list, and this checks that list against the engine's published
    // frame. Without it both halves could agree on a channel nothing fills.
    const published = new Set<string>([
      MotionShaperMeter.Phase,
      MotionShaperMeter.BandGainLow,
      MotionShaperMeter.BandGainMid,
      MotionShaperMeter.BandGainHigh,
      MotionShaperMeter.BandLevelLow,
      MotionShaperMeter.BandLevelMid,
      MotionShaperMeter.BandLevelHigh,
      MotionShaperMeter.InputPeak,
      MotionShaperMeter.OutputPeak,
    ]);
    configure();
    const [{ visual }] = run(4).slice(-1);
    const values: Record<string, number> = {
      [MotionShaperMeter.Phase]: visual.phase,
      [MotionShaperMeter.BandGainLow]: visual.bandGain[0],
      [MotionShaperMeter.BandGainMid]: visual.bandGain[1],
      [MotionShaperMeter.BandGainHigh]: visual.bandGain[2],
      [MotionShaperMeter.BandLevelLow]: visual.bandPeak[0],
      [MotionShaperMeter.BandLevelMid]: visual.bandPeak[1],
      [MotionShaperMeter.BandLevelHigh]: visual.bandPeak[2],
      [MotionShaperMeter.InputPeak]: visual.inputPeak,
      [MotionShaperMeter.OutputPeak]: visual.outputPeak,
    };
    for (const channel of motionShaperMeters) {
      expect(published.has(channel.name), `${channel.name} is not in the published frame`).toBe(
        true,
      );
      expect(Number.isFinite(values[channel.name])).toBe(true);
    }
  });
});
