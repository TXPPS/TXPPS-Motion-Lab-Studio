/**
 * Motion Wave — the ledger cells that measure the signal.
 *
 * D4 through D8: does bypass null, how much aliasing does the oversampling
 * leave, does the unit behave at every sample rate and every buffer size, and
 * is the latency it declares the latency it has. All five are the kind of check
 * ADR-0005 calls the strong form: rendered offline against a known input and
 * measured, which is verification an ear on a device cannot give.
 */

import { type CellOutcome, fail, notApplicable, pass } from './cells';
import { binHz, loudestBinExcluding, magnitudeSpectrum, nearestBin } from './fft';
import { renderOffline } from './render';
import { dbfs, differenceDb, impulse, peak, peakIndex, rms, silence, sine } from './signal';
import type { UnitUnderTest } from './types';

const RATE = 48000;
const BLOCK = 256;

/** The ledger's own figure: a bypassed unit must null to −120 dBFS. */
export const NULL_TARGET_DB = -120;

/**
 * D4 — bypass nulls against the input, delayed by the declared latency.
 *
 * Against the *delayed* input, not the raw one. A plugin whose latency changes
 * when it is bypassed makes the host's compensation wrong in one of the two
 * states, and the audible result is that bypassing moves the track in time —
 * so a unit that reports latency must keep reporting it while bypassed, and
 * the null test is the place that finds out whether it does.
 */
export function cellBypassNull(unit: UnitUnderTest): CellOutcome {
  if (unit.kind === 'instrument') {
    return notApplicable('an instrument has no input to null a bypass against');
  }
  const renderer = unit.renderer;
  if (renderer?.setBypass === undefined) {
    return fail('the unit declares no bypass, so it cannot be null-tested');
  }
  const frames = BLOCK * 32;
  const input = sine(frames, 997, RATE, 0.5);
  const rendered = renderOffline(unit, {
    input,
    bypass: true,
    sampleRate: RATE,
    blockFrames: BLOCK,
  });

  const latency = renderer.declaredLatency.frames;
  const expected = new Float32Array(frames);
  expected.set(input.subarray(0, frames - latency), latency);
  const difference = differenceDb(
    rendered.output.subarray(latency, frames),
    expected.subarray(latency, frames),
  );
  return difference <= NULL_TARGET_DB
    ? pass(`bypass nulls at ${difference.toFixed(1)} dBFS against the input delayed ${latency} frames`)
    : fail(`bypass leaves ${difference.toFixed(1)} dBFS of residual, against a −120 dBFS target`);
}

/**
 * D5 — alias products, in dBc below the fundamental.
 *
 * The probe is 11 kHz at 48 kHz on purpose: its second harmonic at 22 kHz is
 * still below Nyquist and is a real harmonic, while the third and fourth fold
 * to 15 kHz and 4 kHz where nothing else lives. A probe whose folded products
 * land back on the fundamental would measure an aliasing figure of zero on a
 * unit with no oversampling at all.
 */
export function cellAliasRejection(unit: UnitUnderTest): CellOutcome {
  const declared = unit.oversampling;
  if (declared === undefined) return notApplicable('the unit declares no oversampling');

  const frames = 1 << 15;
  const bins = frames >> 1;
  const probeHz = 11000;
  const input = sine(frames, probeHz, RATE, 0.5);
  const rendered = renderOffline(unit, { input, sampleRate: RATE, blockFrames: BLOCK });
  const spectrum = magnitudeSpectrum(rendered.output);

  const fundamentalBin = nearestBin(probeHz, bins, RATE);
  const nyquist = RATE / 2;
  const harmonicBins: number[] = [];
  for (let harmonic = 1; harmonic * probeHz < nyquist; harmonic++) {
    harmonicBins.push(nearestBin(harmonic * probeHz, bins, RATE));
  }
  const skirt = 4;
  const isSignal = (bin: number): boolean =>
    harmonicBins.some((centre) => Math.abs(bin - centre) <= skirt);

  const fundamental = spectrum[fundamentalBin];
  if (!(fundamental > 0)) return fail('the probe tone did not survive the unit');
  const worst = loudestBinExcluding(spectrum, isSignal);
  const dBc = 20 * Math.log10(worst.magnitude / fundamental);
  return dBc <= declared.maxAliasDbc
    ? pass(
        `${declared.factor}× oversampled: worst alias ${dBc.toFixed(1)} dBc at ${binHz(worst.bin, bins, RATE).toFixed(0)} Hz, target ${declared.maxAliasDbc}`,
      )
    : fail(
        `worst alias ${dBc.toFixed(1)} dBc at ${binHz(worst.bin, bins, RATE).toFixed(0)} Hz, against a ${declared.maxAliasDbc} dBc target`,
      );
}

/**
 * D6 — the unit behaves the same at every supported rate.
 *
 * The same tone in seconds, not in samples, at each rate; the output's RMS has
 * to agree. A coefficient that was derived at 48 kHz and never scaled shows up
 * here as a unit that is quieter or brighter at 96 — the class of bug that is
 * invisible to everybody who works at one rate and obvious to the first user
 * who does not.
 */
export function cellSampleRates(unit: UnitUnderTest): CellOutcome {
  const rates = [44100, 48000, 88200, 96000, 176400, 192000];
  const seconds = 0.25;
  const levels: { rate: number; db: number }[] = [];
  for (const rate of rates) {
    const frames = Math.round(seconds * rate);
    const input = sine(frames, 1000, rate, 0.5);
    const rendered = renderOffline(unit, { input, sampleRate: rate, blockFrames: BLOCK });
    const settled = rendered.output.subarray(Math.floor(frames / 2));
    levels.push({ rate, db: dbfs(rms(settled)) });
  }
  const decibels = levels.map((level) => level.db);
  const spread = Math.max(...decibels) - Math.min(...decibels);
  if (!Number.isFinite(spread)) return fail('a rate produced a non-finite output');
  return spread <= 1.5
    ? pass(`44.1–192 kHz: level spread ${spread.toFixed(2)} dB across six rates`)
    : fail(
        `level varies ${spread.toFixed(2)} dB across rates: ${levels
          .map((level) => `${level.rate}=${level.db.toFixed(1)}`)
          .join(', ')}`,
      );
}

/**
 * D7 — buffer size does not change the output.
 *
 * With no parameter moving, the block size is an implementation detail and the
 * samples must be identical. It only holds because nothing is moving: the
 * smoother's coefficient is derived from the buffer size, so a parameter in
 * motion legitimately takes a slightly different path at 32 frames than at
 * 1024. Testing it in motion would be testing the smoother, not the unit.
 */
export function cellBufferSizes(unit: UnitUnderTest): CellOutcome {
  const sizes = [32, 64, 128, 256, 512, 1024];
  const frames = 1024 * 8;
  const input = sine(frames, 440, RATE, 0.5);
  const reference = renderOffline(unit, { input, sampleRate: RATE, blockFrames: 1024 }).output;
  for (const size of sizes) {
    const rendered = renderOffline(unit, { input, sampleRate: RATE, blockFrames: size });
    const difference = differenceDb(rendered.output, reference);
    if (difference > NULL_TARGET_DB) {
      return fail(`a ${size}-frame render differs from a 1024-frame one by ${difference.toFixed(1)} dBFS`);
    }
  }
  return pass(`32–1024 frames: every buffer size renders within ${NULL_TARGET_DB} dBFS of the others`);
}

/**
 * D8 — the declared latency is the measured one.
 *
 * Measured from a quarter-scale impulse, not a full-scale one. PA-010 records
 * this measurement being wrong twice before it was trusted: a full-scale
 * impulse makes a limiter limit, so what comes back is the latency of a device
 * in a state no user puts it in.
 */
export function cellLatencyMatchesPdc(unit: UnitUnderTest): CellOutcome {
  const renderer = unit.renderer;
  if (renderer === undefined) return fail('no renderer');
  const declared = renderer.declaredLatency;
  const frames = 1 << 14;

  if (unit.kind === 'instrument') {
    // An instrument has no input edge to measure a delay from, but it does have
    // a note-on, and the distance from the note to the first sample it produces
    // is the same quantity a host has to compensate. Measured against a −80 dBFS
    // floor rather than against exact zero, because an envelope that opens over
    // a few samples is not latency.
    const played = renderOffline(unit, {
      input: silence(frames),
      sampleRate: RATE,
      blockFrames: BLOCK,
    });
    let first = -1;
    for (let i = 0; i < played.output.length; i++) {
      if (dbfs(played.output[i]) > -80) {
        first = i;
        break;
      }
    }
    if (first < 0) return fail('the instrument produced nothing to measure a delay from');
    return first === declared.frames
      ? pass(`first sample ${first} frames after the note, ${declared.frames} declared (${declared.source})`)
      : fail(`sound starts ${first} frames after the note against ${declared.frames} declared`);
  }

  const input = impulse(frames, 64, 0.25);
  const rendered = renderOffline(unit, { input, sampleRate: RATE, blockFrames: BLOCK });

  if (peak(rendered.output) <= 0) return fail('the impulse did not survive the unit');
  const measured = peakIndex(rendered.output) - 64;
  if (measured !== declared.frames) {
    return fail(
      `measured ${measured} frames against ${declared.frames} declared (${declared.source}: ${declared.note})`,
    );
  }
  return pass(`${measured} frames measured, ${declared.frames} declared (${declared.source})`);
}
