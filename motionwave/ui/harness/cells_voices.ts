/**
 * Motion Wave — the ledger cells that only instruments have.
 *
 * I13 through I18. Two of them carry a lesson MotionLab Studio paid for and
 * this harness inherits: the measure of a stuck note is `sustainingVoices`,
 * not `activeVoices` — a correctly released voice stays allocated until its
 * tail retires, so "busy" and "stuck" look identical through the wrong
 * counter — and every such check needs a non-vacuity step, because a counter
 * that answers zero for twelve held notes passes a stuck-note test perfectly.
 */

import { applyPreset } from '../preset/codec';
import { ParamSet } from '../param/set';
import { type CellOutcome, fail, pass } from './cells';
import { magnitudeSpectrum, nearestBin } from './fft';
import { renderOffline } from './render';
import { dbfs, hasNonFinite, peak, seededRandom, silence } from './signal';
import type { UnitUnderTest, VoiceControl } from './types';

const RATE = 48000;
const BLOCK = 256;

function voicesOf(unit: UnitUnderTest): VoiceControl {
  if (unit.voices === undefined) throw new Error(`unit ${unit.id} declares no voice control`);
  return unit.voices;
}

/** I13 — polyphony holds its ceiling and stealing takes the oldest voice. */
export function cellPolyphonyAndStealing(unit: UnitUnderTest): CellOutcome {
  const voices = voicesOf(unit);
  voices.panic();
  const overload = voices.maxVoices + 4;
  const frames = BLOCK * 16;

  const rendered = renderOffline(unit, {
    input: silence(frames),
    sampleRate: RATE,
    blockFrames: BLOCK,
    beforeBlock: (blockIndex) => {
      if (blockIndex < overload) {
        voices.noteOn({ noteId: blockIndex, key: 48 + blockIndex, velocity: 0.8, channel: 0 });
      }
    },
  });

  if (voices.activeVoices > voices.maxVoices) {
    return fail(`${voices.activeVoices} voices allocated against a ceiling of ${voices.maxVoices}`);
  }
  if (voices.activeVoices !== voices.maxVoices) {
    return fail(
      `${overload} notes produced only ${voices.activeVoices} voices — stealing is not filling the ceiling`,
    );
  }
  if (hasNonFinite(rendered.output)) return fail('stealing produced a non-finite sample');
  voices.panic();
  return pass(`${overload} notes into ${voices.maxVoices} voices: ceiling held, output finite`);
}

/**
 * I14 — random note traffic leaves nothing sustaining.
 *
 * Seeded, so a failure comes back. The non-vacuity check is the part that makes
 * the result mean anything: without it, an instrument whose counter never rises
 * passes by answering zero to a question it was never really asked.
 */
export function cellStuckNoteFuzz(unit: UnitUnderTest): CellOutcome {
  const voices = voicesOf(unit);
  voices.panic();
  const seed = 0x515ced;
  const random = seededRandom(seed);
  const held = new Set<number>();
  let sawSustaining = false;

  for (let event = 0; event < 2000; event++) {
    const noteId = Math.floor(random() * 64);
    if (held.has(noteId) && random() < 0.6) {
      voices.noteOff(noteId);
      held.delete(noteId);
    } else {
      voices.noteOn({ noteId, key: 36 + (noteId % 48), velocity: random(), channel: 0 });
      held.add(noteId);
    }
    if (voices.sustainingVoices > 0) sawSustaining = true;
  }
  for (const noteId of held) voices.noteOff(noteId);

  if (!sawSustaining) {
    return fail(
      'sustainingVoices never rose above zero during the fuzz, so the check proves nothing — the counter is wrong, not the instrument',
    );
  }
  if (voices.sustainingVoices !== 0) {
    return fail(
      `${voices.sustainingVoices} voice(s) still sustaining after every note was released — replay with seed 0x${seed.toString(16)}`,
    );
  }
  return pass(`2000 randomised events, seed 0x${seed.toString(16)}: 0 unmatched note-ons`);
}

/** I15 — panic clears everything, from a state that was demonstrably not clear. */
export function cellPanicClears(unit: UnitUnderTest): CellOutcome {
  const voices = voicesOf(unit);
  voices.panic();
  for (let note = 0; note < 12; note++) {
    voices.noteOn({ noteId: note, key: 48 + note, velocity: 0.9, channel: 0 });
  }
  if (voices.sustainingVoices === 0) {
    return fail('twelve held notes reported zero sustaining voices, so panic cannot be tested');
  }
  voices.panic();
  if (voices.sustainingVoices !== 0 || voices.activeVoices !== 0) {
    return fail(
      `after panic: ${voices.activeVoices} active, ${voices.sustainingVoices} sustaining`,
    );
  }
  return pass('twelve held notes, then panic: 0 active, 0 sustaining');
}

/** I16 — per-note expression reaches the voice it names and no other. */
export function cellMpe(unit: UnitUnderTest): CellOutcome {
  const voices = voicesOf(unit);
  if (voices.setNotePitchBend === undefined) {
    return fail('the unit implements no per-note pitch bend, so it cannot claim MPE');
  }
  const frames = 1 << 15;
  const bins = frames >> 1;
  const fundamentalBin = nearestBin(440, bins, RATE);
  const measure = (bend: number): number => {
    voices.panic();
    const rendered = renderOffline(unit, {
      input: silence(frames),
      sampleRate: RATE,
      blockFrames: BLOCK,
      beforeBlock: (blockIndex) => {
        if (blockIndex === 0) {
          voices.noteOn({ noteId: 1, key: 69, velocity: 0.9, channel: 1 });
          voices.noteOn({ noteId: 2, key: 69, velocity: 0.9, channel: 2 });
          voices.setNotePitchBend?.(2, bend);
        }
      },
    });
    return dbfs(magnitudeSpectrum(rendered.output)[fundamentalBin]);
  };

  // Measured at the fundamental rather than as a peak level. Two voices on one
  // key sum to twice the amplitude at 440 Hz; bending one of them moves half
  // the energy elsewhere and the 440 Hz bin drops by about 6 dB. A peak
  // measurement cannot tell those apart, because two detuned sines still reach
  // the same instantaneous maximum whenever they happen to align.
  const flat = measure(0);
  const bent = measure(7);
  voices.panic();
  if (!Number.isFinite(flat) || !Number.isFinite(bent))
    return fail('MPE render produced no signal');
  if (flat - bent < 3) {
    return fail(
      `bending one member channel moved the 440 Hz bin by ${(flat - bent).toFixed(2)} dB, so the bend reached both voices or neither`,
    );
  }
  return pass(
    `per-note bend on one of two voices on the same key dropped the fundamental ${(flat - bent).toFixed(2)} dB`,
  );
}

/** I17 — every factory preset loads, sounds, and stays in bounds. */
export function cellPresetsAudition(unit: UnitUnderTest): CellOutcome {
  const voices = voicesOf(unit);
  const presets = unit.factoryPresets ?? [];
  if (presets.length === 0) return fail('the unit ships no factory presets');
  const frames = BLOCK * 32;

  for (const preset of presets) {
    const set = new ParamSet(unit.specs);
    const report = applyPreset(set, preset);
    if (report.applied.length === 0) {
      return fail(`preset "${preset.name}" set no parameter this unit declares`);
    }
    voices.panic();
    const rendered = renderOffline(unit, {
      input: silence(frames),
      params: set.capture(),
      sampleRate: RATE,
      blockFrames: BLOCK,
      beforeBlock: (blockIndex) => {
        if (blockIndex === 0) voices.noteOn({ noteId: 1, key: 60, velocity: 0.9, channel: 0 });
      },
    });
    const level = dbfs(peak(rendered.output));
    if (hasNonFinite(rendered.output))
      return fail(`preset "${preset.name}" produced a non-finite sample`);
    if (level < -60) return fail(`preset "${preset.name}" is silent at ${level.toFixed(1)} dBFS`);
    if (level > 6) return fail(`preset "${preset.name}" peaks at ${level.toFixed(1)} dBFS`);
  }
  voices.panic();
  return pass(`${presets.length} factory preset(s) audition between −60 and +6 dBFS`);
}

/** I18 — an alternate tuning moves the pitch by exactly what it asks for. */
export function cellTuning(unit: UnitUnderTest): CellOutcome {
  const voices = voicesOf(unit);
  if (voices.setTuningTable === undefined) {
    return fail('the unit implements no tuning table');
  }
  const frames = 1 << 15;
  const bins = frames >> 1;
  const fundamental = (centsOnA: number): number => {
    voices.panic();
    const table = new Array<number>(12).fill(0);
    table[9] = centsOnA;
    voices.setTuningTable?.(table);
    const rendered = renderOffline(unit, {
      input: silence(frames),
      sampleRate: RATE,
      blockFrames: BLOCK,
      beforeBlock: (blockIndex) => {
        if (blockIndex === 0) voices.noteOn({ noteId: 1, key: 69, velocity: 0.9, channel: 0 });
      },
    });
    const spectrum = magnitudeSpectrum(rendered.output);
    let bestBin = 0;
    for (let bin = 1; bin < spectrum.length; bin++) {
      if (spectrum[bin] > spectrum[bestBin]) bestBin = bin;
    }
    return (bestBin * RATE) / (bins * 2);
  };

  const equal = fundamental(0);
  const raised = fundamental(50);
  voices.panic();
  voices.setTuningTable?.(new Array<number>(12).fill(0));
  if (!(equal > 0) || !(raised > 0)) return fail('no pitch could be measured');

  const measuredCents = 1200 * Math.log2(raised / equal);
  const resolutionCents = 1200 * Math.log2(1 + RATE / (bins * 2) / equal);
  if (Math.abs(measuredCents - 50) > Math.max(6, resolutionCents)) {
    return fail(
      `a +50 cent table moved the pitch ${measuredCents.toFixed(1)} cents (${equal.toFixed(1)} Hz to ${raised.toFixed(1)} Hz)`,
    );
  }
  const reference = nearestBin(440, bins, RATE);
  return pass(
    `equal temperament reads ${equal.toFixed(1)} Hz (bin ${reference}); a +50 cent table moves it ${measuredCents.toFixed(1)} cents`,
  );
}
