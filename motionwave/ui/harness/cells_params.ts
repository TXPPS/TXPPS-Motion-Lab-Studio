/**
 * Motion Wave — the ledger cells that are about parameters.
 *
 * D1, D2, D3, D9, D10, D11 and D12: is every control connected to something, do
 * its range and law hold, does it measure what its sheet says, does it survive
 * being thrashed, does it move without stepping, does it survive a save, and
 * does it hear the tempo. Written once and parameterised by the unit, because
 * fourteen hand-written copies of D1 would be fourteen different D1s.
 */

import { AutomationLane, PPQ } from '../automation/lane';
import { ParamSet } from '../param/set';
import { type ParamId, isChoice, toNormalised, toReal } from '../param/spec';
import { Taper } from '../param/units';
import { applyPreset, capturePreset, carriedValues, parsePreset, serialisePreset } from '../preset/codec';
import { type CellOutcome, fail, notApplicable, pass } from './cells';
import { magnitudeSpectrum, nearestBin } from './fft';
import { renderOffline } from './render';
import { dbfs, hasNonFinite, identical, maxStep, noise, peak, seededRandom, sine } from './signal';
import type { UnitUnderTest } from './types';

const RATE = 48000;
const BLOCK = 256;

/** A signal with silence, tone and noise in it, so a control has something to bite on. */
function probeSignal(frames: number, sampleRate: number): Float32Array {
  const out = sine(frames, 440, sampleRate, 0.5);
  const third = Math.floor(frames / 3);
  const grit = noise(frames, 0x5eed, 0.35);
  for (let i = 0; i < third; i++) out[i] = 0;
  for (let i = 2 * third; i < frames; i++) out[i] = grit[i];
  return out;
}

/** D1 — every declared control changes the sound. */
export function cellControlsWired(unit: UnitUnderTest): CellOutcome {
  const frames = BLOCK * 24;
  const input = probeSignal(frames, RATE);
  const dead: string[] = [];

  for (const spec of unit.specs) {
    const context = new Map(unit.wiringContext?.(spec.id) ?? []);
    const low = new Map(context).set(spec.id, 0);
    const high = new Map(context).set(spec.id, 1);
    const a = renderOffline(unit, { input, params: low, sampleRate: RATE, blockFrames: BLOCK });
    const b = renderOffline(unit, { input, params: high, sampleRate: RATE, blockFrames: BLOCK });
    // −80 dBFS rather than exact inequality: a control can be wired and still
    // move the output by a thousandth of a decibel at one end of its travel,
    // and a strict comparison would pass on floating-point noise instead of on
    // the control doing something a listener could find.
    let worst = 0;
    for (let i = 0; i < frames; i++) worst = Math.max(worst, Math.abs(a.output[i] - b.output[i]));
    if (dbfs(worst) < -80) dead.push(`${spec.id} "${spec.name}"`);
  }

  return dead.length === 0
    ? pass(`${unit.specs.length} control(s), each audible between its extremes`)
    : fail(`control(s) with no audible effect: ${dead.join(', ')}`);
}

/** D2 — ranges and tapers, checked against the spec's own law. */
export function cellRangesAndTapers(unit: UnitUnderTest): CellOutcome {
  const problems: string[] = [];
  for (const spec of unit.specs) {
    if (spec.def < spec.min || spec.def > spec.max) {
      problems.push(`${spec.id}: default ${spec.def} outside ${spec.min}..${spec.max}`);
    }
    if (!isChoice(spec)) {
      if (Math.abs(toReal(spec, 0) - spec.min) > 1e-9) problems.push(`${spec.id}: 0 is not min`);
      if (Math.abs(toReal(spec, 1) - spec.max) > 1e-9) problems.push(`${spec.id}: 1 is not max`);
    }
    // Round-trip through the law at nine positions, including both ends.
    for (let step = 0; step <= 8; step++) {
      const n = step / 8;
      const real = toReal(spec, n);
      const back = toNormalised(spec, real);
      const expected = spec.taper === Taper.Stepped || isChoice(spec) ? toNormalised(spec, toReal(spec, n)) : n;
      if (Math.abs(back - expected) > 1e-9) {
        problems.push(`${spec.id}: round-trip at ${n} returned ${back}`);
      }
    }
    // Monotonic, so a knob turned one way never sends the value the other way.
    let previous = toReal(spec, 0);
    for (let step = 1; step <= 32; step++) {
      const value = toReal(spec, step / 32);
      if (value < previous - 1e-12) problems.push(`${spec.id}: law is not monotonic`);
      previous = value;
    }
  }
  return problems.length === 0
    ? pass(`${unit.specs.length} spec(s): ends, round-trip to 1e-9, monotonic`)
    : fail(problems.slice(0, 4).join('; '));
}

/** D3 — the unit measures what its Reference Spec Sheet says it measures. */
export function cellSheetVerification(unit: UnitUnderTest): CellOutcome {
  const targets = unit.sheetTargets ?? [];
  if (targets.length === 0) {
    return fail('the unit declares no measurable claims from its sheet');
  }
  const frames = 1 << 15;
  const misses: string[] = [];
  for (const target of targets) {
    const input = sine(frames, target.probeHz, RATE, 0.25);
    const rendered = renderOffline(unit, {
      input,
      params: target.params,
      sampleRate: RATE,
      blockFrames: BLOCK,
    });
    const bin = nearestBin(target.probeHz, 1 << 14, RATE);
    const before = magnitudeSpectrum(input)[bin];
    const after = magnitudeSpectrum(rendered.output)[bin];
    const measuredDb = dbfs(after) - dbfs(before);
    if (Math.abs(measuredDb - target.expectedDb) > target.toleranceDb) {
      misses.push(
        `${target.what}: measured ${measuredDb.toFixed(2)} dB against ${target.expectedDb} ±${target.toleranceDb}`,
      );
    }
  }
  return misses.length === 0
    ? pass(`${targets.length} sheet claim(s) within tolerance`)
    : fail(misses.join('; '));
}

/** D9 — random parameter traffic produces no NaN and no runaway. */
export function cellParamFuzz(unit: UnitUnderTest): CellOutcome {
  const seed = 0x1a2b3c4d;
  const random = seededRandom(seed);
  const frames = BLOCK * 64;
  const input = noise(frames, 0xc0ffee, 0.5);
  const lanes = unit.specs.map((spec) => {
    const lane = new AutomationLane(spec.id);
    for (let point = 0; point <= 16; point++) {
      lane.add({ tick: point * 30, value: random(), curve: 'linear' });
    }
    return lane;
  });

  const rendered = renderOffline(unit, { input, lanes, sampleRate: RATE, blockFrames: BLOCK });
  if (hasNonFinite(rendered.output)) {
    return fail(`a NaN or infinity reached the output — replay with seed 0x${seed.toString(16)}`);
  }
  const loudest = peak(rendered.output);
  // Four times full scale. A unit is allowed to make gain; it is not allowed to
  // diverge, and a resonant filter that has lost its damping passes 12 dBFS
  // within a few blocks of the parameter that broke it.
  if (loudest > 4) {
    return fail(
      `output reached ${dbfs(loudest).toFixed(1)} dBFS under parameter fuzz — seed 0x${seed.toString(16)}`,
    );
  }
  return pass(`${lanes.length} lane(s) of random traffic, peak ${dbfs(loudest).toFixed(1)} dBFS, finite throughout`);
}

/**
 * D10 — a parameter sweep produces no zipper.
 *
 * Measured at the block boundaries specifically, not over the whole buffer. A
 * parameter stepped once per block puts its discontinuity exactly there, and
 * comparing boundary steps against the largest step *inside* a block is what
 * separates "the signal is loud" from "the signal jumped when the parameter
 * did" — a whole-buffer maximum cannot tell those apart.
 */
export function cellAutomationNoZipper(unit: UnitUnderTest): CellOutcome {
  const swept = unit.specs.find((spec) => spec.smoothingMs > 0 && !isChoice(spec));
  if (swept === undefined) return notApplicable('the unit declares no smoothed parameter');

  const frames = BLOCK * 48;
  const input = sine(frames, 220, RATE, 0.5);
  const lane = new AutomationLane(swept.id);
  const ticks = ((120 / 60) * PPQ * frames) / RATE;
  lane.add({ tick: 0, value: 0, curve: 'linear' });
  lane.add({ tick: Math.round(ticks), value: 1, curve: 'linear' });

  const rendered = renderOffline(unit, { input, lanes: [lane], sampleRate: RATE, blockFrames: BLOCK });
  let boundary = 0;
  for (let index = BLOCK; index < frames; index += BLOCK) {
    boundary = Math.max(boundary, Math.abs(rendered.output[index] - rendered.output[index - 1]));
  }
  const interior = maxStep(rendered.output.subarray(1, BLOCK - 1));
  if (boundary > interior * 2 && boundary > 1e-6) {
    return fail(
      `block boundaries step ${dbfs(boundary).toFixed(1)} dBFS against ${dbfs(interior).toFixed(1)} dBFS inside a block while "${swept.name}" sweeps`,
    );
  }
  return pass(`"${swept.name}" swept 0→1: boundary step ${dbfs(boundary).toFixed(1)} dBFS, no discontinuity`);
}

/** D11 — a preset round-trips exactly, and carries what it does not understand. */
export function cellPresetRoundTrip(unit: UnitUnderTest): CellOutcome {
  const set = new ParamSet(unit.specs);
  const random = seededRandom(0x9e3779b9);
  for (const spec of unit.specs) set.setNormalised(spec.id, random(), 'user');

  const before = capturePreset(set, unit.presetMeta);
  const text = serialisePreset(before);
  const parsed = parsePreset(text);
  const reloaded = new ParamSet(unit.specs);
  applyPreset(reloaded, parsed);

  const original = set.capture();
  const restored = reloaded.capture();
  for (const [id, value] of original) {
    const other = restored.get(id);
    if (other === undefined || !Object.is(value, other)) {
      return fail(`parameter ${id} came back as ${String(other)} instead of ${value}`);
    }
  }
  if (serialisePreset(capturePreset(reloaded, unit.presetMeta)) !== text) {
    return fail('a second save produced different bytes from the first');
  }

  // A parameter this build has never heard of has to survive the trip, or a
  // user who opens a newer preset and saves it loses what the newer build wrote.
  const unknownId = 0xffff;
  const withUnknown = parsePreset(
    serialisePreset({ ...before, values: { ...before.values, [String(unknownId)]: 0.375 } }),
  );
  const report = applyPreset(reloaded, withUnknown);
  const carried = carriedValues(withUnknown, report);
  if (carried[String(unknownId)] !== 0.375) {
    return fail('an unknown parameter id was dropped on load rather than carried');
  }
  const resaved = capturePreset(reloaded, unit.presetMeta, carried);
  if (resaved.values[String(unknownId)] !== 0.375) {
    return fail('an unknown parameter id was lost on the next save');
  }
  return pass(`${unit.specs.length} parameter(s) bit-identical through save/load, unknown ids carried`);
}

/** D12 — a tempo-synced parameter actually reads the tempo map. */
export function cellTempoMap(unit: UnitUnderTest): CellOutcome {
  const synced = unit.tempoSyncedParams ?? [];
  if (synced.length === 0) return notApplicable('the unit declares no tempo-synced parameter');

  const frames = BLOCK * 64;
  const input = probeSignal(frames, RATE);
  const params = new Map<ParamId, number>();
  const slow = renderOffline(unit, { input, params, tempoBpm: 60, sampleRate: RATE, blockFrames: BLOCK });
  const fast = renderOffline(unit, { input, params, tempoBpm: 180, sampleRate: RATE, blockFrames: BLOCK });
  if (identical(slow.output, fast.output)) {
    return fail(`parameters ${synced.join(', ')} are declared tempo-synced but 60 and 180 bpm render identically`);
  }
  return pass(`${synced.length} tempo-synced parameter(s) track the map: 60 and 180 bpm differ`);
}
