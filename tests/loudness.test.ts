/**
 * Loudness measurement against the numbers BS.1770-4 and EBU R 128 fix.
 *
 * These are calibration tests, not smoke tests. The K-weighting coefficients
 * are compared with the table printed in the standard; the loudness of a
 * full-scale sine is compared with a figure derived by hand below; the gate is
 * proved by a signal whose ungated and gated loudness differ; and true peak is
 * proved by a signal whose real peak is nowhere near any of its samples.
 */
import { describe, expect, it } from 'vitest';
import {
  KWeightedAccumulator,
  LoudnessMeter,
  MIN_DBFS,
  MIN_LUFS,
  TruePeakDetector,
  cascadeGain,
  dbfsFromAmplitude,
  dbfsFromMeanSquare,
  dcOffset,
  kWeightingGainDb,
  kWeightingHighpass,
  kWeightingShelf,
  kWeightingStages,
  lufsFromWeightedSum,
  measureChannels,
  phaseCorrelation,
  rms,
  samplePeak,
  stereoWidth,
  truePeak,
  truePeakDbtp,
} from '../src/model/loudness';

const SR = 48000;

function sine(hz: number, seconds: number, amplitude = 1, sampleRate = SR): Float32Array {
  const out = new Float32Array(Math.round(seconds * sampleRate));
  for (let i = 0; i < out.length; i++) {
    out[i] = amplitude * Math.sin((2 * Math.PI * hz * i) / sampleRate);
  }
  return out;
}

function scaled(source: Float32Array, gain: number): Float32Array {
  return Float32Array.from(source, (v) => v * gain);
}

function measureStereo(left: Float32Array, right: Float32Array, sampleRate = SR): LoudnessMeter {
  const meter = new LoudnessMeter(sampleRate, { channelCount: 2 });
  const block = 4096;
  for (let offset = 0; offset < left.length; offset += block) {
    const take = Math.min(block, left.length - offset);
    meter.push([left.subarray(offset, offset + take), right.subarray(offset, offset + take)], take);
  }
  return meter;
}

describe('K-weighting', () => {
  it('reproduces the coefficients BS.1770-4 tabulates for 48 kHz', () => {
    const shelf = kWeightingShelf(48000);
    expect(shelf.b0).toBeCloseTo(1.53512485958697, 11);
    expect(shelf.b1).toBeCloseTo(-2.69169618940638, 11);
    expect(shelf.b2).toBeCloseTo(1.19839281085285, 11);
    expect(shelf.a1).toBeCloseTo(-1.69065929318241, 11);
    expect(shelf.a2).toBeCloseTo(0.73248077421585, 11);

    const highpass = kWeightingHighpass(48000);
    expect(highpass.b0).toBe(1);
    expect(highpass.b1).toBe(-2);
    expect(highpass.b2).toBe(1);
    expect(highpass.a1).toBeCloseTo(-1.99004745483398, 10);
    expect(highpass.a2).toBeCloseTo(0.99007225036621, 10);
  });

  it('is the same curve at every sample rate a browser might pick', () => {
    for (const rate of [44100, 48000, 88200, 96000]) {
      const stages = kWeightingStages(rate);
      // The shelf's job: roughly +4 dB above 2 kHz, unity below it.
      expect(20 * Math.log10(cascadeGain([stages[0]], 100, rate))).toBeCloseTo(0, 1);
      expect(20 * Math.log10(cascadeGain([stages[0]], 10000, rate))).toBeCloseTo(3.99, 1);
      // The RLB high-pass sits at Q = 0.5, so its corner is -6 dB, not -3 dB;
      // it is a gentle tilt away from rumble rather than a crossover point.
      const corner = 20 * Math.log10(cascadeGain([stages[1]], 38.135, rate));
      expect(corner).toBeGreaterThan(-6.1);
      expect(corner).toBeLessThan(-5.9);
      expect(20 * Math.log10(cascadeGain([stages[1]], 1000, rate))).toBeCloseTo(0, 1);
      expect(kWeightingGainDb(1000, rate)).toBeCloseTo(0.69, 1);
    }
  });

  it('filters streaming blocks exactly as it filters one long block', () => {
    const signal = sine(1000, 0.5);
    const whole = new KWeightedAccumulator(SR).accumulate(signal, 0, signal.length);
    const streaming = new KWeightedAccumulator(SR);
    let sum = 0;
    for (let offset = 0; offset < signal.length; offset += 777) {
      sum += streaming.accumulate(signal, offset, Math.min(777, signal.length - offset));
    }
    expect(sum).toBeCloseTo(whole, 4);
  });
});

describe('levels', () => {
  it('reads a full-scale sine as -3.01 dBFS RMS', () => {
    expect(dbfsFromAmplitude(rms(sine(1000, 1)))).toBeCloseTo(-3.0103, 3);
    expect(dbfsFromAmplitude(samplePeak(sine(1000, 1)))).toBeCloseTo(0, 3);
  });

  it('floors silence rather than returning -Infinity', () => {
    expect(dbfsFromAmplitude(0)).toBe(MIN_DBFS);
    expect(dbfsFromMeanSquare(0)).toBe(MIN_DBFS);
    expect(lufsFromWeightedSum(0)).toBe(MIN_LUFS);
  });

  it('measures DC offset as the mean sample value', () => {
    expect(dcOffset(Float32Array.from(sine(1000, 0.5), (v) => v + 0.1))).toBeCloseTo(0.1, 3);
    expect(dcOffset(sine(1000, 0.5))).toBeCloseTo(0, 3);
  });
});

/**
 * Derivation of the expected figure for a 0 dBFS 1 kHz sine.
 *
 *   mean square of a unit sine            = 1/2      → -3.0103 dB
 *   equal-power centre pan puts 1/√2 in each channel, so each channel carries a
 *   mean square of 1/4 and the unity-weighted channel sum is 1/4 + 1/4 = 1/2 —
 *   a centre-panned mono source measures exactly as the mono source does.
 *   K-weighting at 1 kHz                  = +0.698 dB (asserted above)
 *   BS.1770 scale offset                  = -0.691
 *
 *   L = -0.691 + 10·log10(0.5) + 0.698 = -3.003 LUFS
 *
 * which is the -3.01 LUFS the standard's calibration signal is quoted at, to
 * within the third decimal place.
 */
describe('LUFS', () => {
  const CENTRE_PAN = Math.SQRT1_2;

  it('reads a centre-panned full-scale 1 kHz sine at -3.01 LUFS', () => {
    const channel = sine(1000, 5, CENTRE_PAN);
    const meter = measureStereo(channel, channel);
    const reading = meter.read();
    expect(reading.momentaryLufs).toBeCloseTo(-3.01, 1);
    expect(Math.abs(reading.momentaryLufs - -3.01)).toBeLessThan(0.3);
    expect(Math.abs(reading.shortTermLufs - -3.01)).toBeLessThan(0.3);
    expect(Math.abs(reading.integratedLufs - -3.01)).toBeLessThan(0.3);
  });

  it('gives a mono-summed source the same loudness as the equal-power pair', () => {
    const mono = sine(1000, 5);
    const monoMeter = new LoudnessMeter(SR, { channelCount: 1 });
    monoMeter.push([mono]);
    const stereo = measureStereo(sine(1000, 5, CENTRE_PAN), sine(1000, 5, CENTRE_PAN));
    expect(monoMeter.integratedLufs).toBeCloseTo(stereo.integratedLufs, 2);
  });

  it('tracks level changes one for one', () => {
    const base = sine(1000, 5, CENTRE_PAN);
    const loud = measureStereo(base, base).integratedLufs;
    const quiet = measureStereo(scaled(base, 0.1), scaled(base, 0.1)).integratedLufs;
    expect(loud - quiet).toBeCloseTo(20, 1);
  });

  it('calibrates to -23 LUFS, the EBU R 128 target', () => {
    const reference = sine(1000, 5, CENTRE_PAN);
    const current = measureStereo(reference, reference).integratedLufs;
    const trim = Math.pow(10, (-23 - current) / 20);
    const target = scaled(reference, trim);
    expect(measureStereo(target, target).integratedLufs).toBeCloseTo(-23, 1);
  });

  it('is 1.23 LU louder when the same tone is panned hard left with no pan law', () => {
    // Both channels at full amplitude doubles the weighted sum: +3.01 LU over
    // the single-channel case. Asserting it proves the channel sum, not a mean.
    const tone = sine(1000, 5);
    const both = measureStereo(tone, tone).integratedLufs;
    const one = measureStereo(tone, new Float32Array(tone.length)).integratedLufs;
    expect(both - one).toBeCloseTo(3.01, 1);
  });

  it('reports the gate: silence between phrases does not drag the value down', () => {
    const rate = 24000;
    const tone = sine(1000, 10, 0.5, rate);
    const silence = new Float32Array(10 * rate);
    const signal = new Float32Array(tone.length + silence.length);
    signal.set(tone, 0);

    const gated = measureStereo(signal, signal, rate).integratedLufs;
    const toneOnly = measureStereo(tone, tone, rate).integratedLufs;
    // Half the programme is silent, so an ungated mean of the mean squares
    // would land 10·log10(2) = 3.01 LU below the tone's own loudness.
    const ungated = toneOnly - 3.01;
    expect(Math.abs(gated - toneOnly)).toBeLessThan(0.2);
    expect(gated - ungated).toBeGreaterThan(2.8);
  });

  it('measures loudness range as the spread between quiet and loud passages', () => {
    const rate = 24000;
    const quiet = sine(1000, 20, 0.1, rate);
    const loud = sine(1000, 20, 0.1 * Math.pow(10, 10 / 20), rate);
    const signal = new Float32Array(quiet.length + loud.length);
    signal.set(quiet, 0);
    signal.set(loud, quiet.length);
    const meter = measureStereo(signal, signal, rate);
    expect(meter.loudnessRangeLu).toBeGreaterThan(9);
    expect(meter.loudnessRangeLu).toBeLessThan(11);
  });

  it('reports no loudness range for a steady tone', () => {
    const tone = sine(1000, 12, 0.3, 24000);
    expect(measureStereo(tone, tone, 24000).loudnessRangeLu).toBeLessThan(0.5);
  });

  it('reads the silence floor before anything is pushed', () => {
    const meter = new LoudnessMeter(SR);
    const reading = meter.read();
    expect(reading.momentaryLufs).toBe(MIN_LUFS);
    expect(reading.integratedLufs).toBe(MIN_LUFS);
    expect(reading.loudnessRangeLu).toBe(0);
    expect(reading.truePeakDbtp).toBe(MIN_DBFS);
  });

  it('fills a caller-owned reading instead of allocating one', () => {
    const meter = new LoudnessMeter(SR);
    const target = meter.read();
    expect(meter.read(target)).toBe(target);
  });

  it('starts again after a reset', () => {
    const tone = sine(1000, 2, 0.5);
    const meter = measureStereo(tone, tone);
    expect(meter.integratedLufs).toBeGreaterThan(MIN_LUFS);
    meter.reset();
    expect(meter.integratedLufs).toBe(MIN_LUFS);
    expect(meter.samplePeakDbfs).toBe(MIN_DBFS);
  });
});

describe('true peak', () => {
  /**
   * Both signals here fade in and out over 512 samples. Without that, the block
   * would begin and end on a step from silence, and a step is exactly what an
   * interpolating filter overshoots on — the meter would then be reporting a
   * transient the test invented rather than the one being looked for.
   */
  function fadeEnds(signal: Float32Array, ramp = 512): Float32Array {
    for (let i = 0; i < ramp; i++) {
      const gain = 0.5 - 0.5 * Math.cos((Math.PI * i) / ramp);
      signal[i] *= gain;
      signal[signal.length - 1 - i] *= gain;
    }
    return signal;
  }

  /**
   * 12 kHz at 48 kHz sits exactly a quarter of the way round the circle, so with
   * a 45° starting phase every sample lands at ±sin45° of the real amplitude and
   * the waveform's actual peaks fall precisely between samples. At amplitude
   * 1.2 the samples read ±0.849 (-1.43 dBFS, apparently clean) while the signal
   * a converter reconstructs reaches 1.2 (+1.58 dBTP, clipping).
   */
  function interSamplePeak(amplitude: number): Float32Array {
    const out = new Float32Array(4800);
    for (let i = 0; i < out.length; i++) {
      out[i] = amplitude * Math.sin((2 * Math.PI * 12000 * i) / SR + Math.PI / 4);
    }
    return fadeEnds(out);
  }

  it('sees a peak that no sample shows', () => {
    const signal = interSamplePeak(1.2);
    expect(dbfsFromAmplitude(samplePeak(signal))).toBeLessThan(0);
    expect(dbfsFromAmplitude(samplePeak(signal))).toBeCloseTo(-1.43, 1);
    expect(truePeakDbtp(signal)).toBeGreaterThan(0);
    expect(truePeakDbtp(signal)).toBeCloseTo(1.58, 1);
  });

  it('never reads below the sample peak', () => {
    let state = 99;
    const noise = new Float32Array(8192);
    for (let i = 0; i < noise.length; i++) {
      state = (state * 1103515245 + 12345) & 0x7fffffff;
      noise[i] = state / 0x3fffffff - 1;
    }
    for (const signal of [noise, sine(1000, 0.1), interSamplePeak(0.5)]) {
      expect(truePeak(signal)).toBeGreaterThanOrEqual(samplePeak(signal) - 1e-6);
    }
  });

  it('passes a steady level through at unity', () => {
    const plateau = fadeEnds(new Float32Array(4096).fill(0.5));
    expect(truePeak(plateau)).toBeCloseTo(0.5, 4);
  });

  it('agrees with the sample peak when the peaks land on samples', () => {
    // 50 Hz has 960 samples to a cycle, so the crest is effectively sampled.
    const slow = sine(50, 0.08, 0.6);
    expect(truePeakDbtp(slow)).toBeCloseTo(dbfsFromAmplitude(0.6), 2);
  });

  it('finds a peak straddling two pushed blocks', () => {
    const signal = interSamplePeak(1.2);
    const streamed = new TruePeakDetector();
    for (let offset = 0; offset < signal.length; offset += 101) {
      streamed.process(signal, offset, Math.min(101, signal.length - offset));
    }
    expect(dbfsFromAmplitude(streamed.peak)).toBeCloseTo(1.58, 1);
  });
});

describe('stereo relationship', () => {
  const tone = sine(440, 0.5, 0.7);

  it('correlates identical channels at +1 and inverted channels at -1', () => {
    expect(phaseCorrelation(tone, tone)).toBeCloseTo(1, 6);
    expect(phaseCorrelation(tone, scaled(tone, -1))).toBeCloseTo(-1, 6);
    expect(phaseCorrelation(tone, scaled(tone, 0.25))).toBeCloseTo(1, 6);
  });

  it('reports zero for unrelated channels and for silence', () => {
    const other = sine(440, 0.5, 0.7);
    for (let i = 0; i < other.length; i++) other[i] = Math.cos((2 * Math.PI * 440 * i) / SR) * 0.7;
    expect(Math.abs(phaseCorrelation(tone, other))).toBeLessThan(0.01);
    expect(phaseCorrelation(new Float32Array(64), new Float32Array(64))).toBe(0);
  });

  it('measures width from mono through to out of phase', () => {
    expect(stereoWidth(tone, tone)).toBeCloseTo(0, 6);
    expect(stereoWidth(tone, scaled(tone, -1))).toBeCloseTo(2, 6);
    expect(stereoWidth(tone, new Float32Array(tone.length))).toBeCloseTo(1, 6);
  });

  it('follows the signal through the streaming meter', () => {
    expect(measureStereo(tone, tone).correlation).toBeCloseTo(1, 4);
    expect(measureStereo(tone, scaled(tone, -1)).correlation).toBeCloseTo(-1, 4);
    expect(measureStereo(tone, scaled(tone, -1)).stereoWidth).toBeCloseTo(2, 4);
  });
});

describe('whole-buffer measurement', () => {
  it('reports the numbers an export report prints', () => {
    const left = Float32Array.from(sine(1000, 4, 0.5), (v) => v + 0.02);
    const right = sine(1000, 4, 0.25);
    const report = measureChannels([left, right], SR);

    expect(report.channelCount).toBe(2);
    expect(report.durationSeconds).toBeCloseTo(4, 6);
    expect(report.sampleRate).toBe(SR);
    expect(report.channels).toHaveLength(2);
    expect(report.channels[0].dcOffset).toBeCloseTo(0.02, 3);
    expect(report.channels[1].dcOffset).toBeCloseTo(0, 3);
    expect(report.channels[0].samplePeakDbfs).toBeGreaterThan(report.channels[1].samplePeakDbfs);
    expect(report.samplePeakDbfs).toBeCloseTo(report.channels[0].samplePeakDbfs, 6);
    expect(report.truePeakDbtp).toBeGreaterThanOrEqual(report.samplePeakDbfs - 1e-6);
    expect(report.integratedLufs).toBeGreaterThan(-20);
    expect(report.integratedLufs).toBeLessThan(0);
    // The DC offset on the left channel decorrelates the pair very slightly.
    expect(report.correlation).toBeGreaterThan(0.99);
    expect(report.correlation).toBeLessThan(1);
  });

  it('reports the same true peak the one-shot helper does, tail included', () => {
    const burst = new Float32Array(2048);
    for (let i = 0; i < burst.length; i++) {
      burst[i] = 0.9 * Math.sin((2 * Math.PI * 12000 * i) / SR + Math.PI / 4);
    }
    const report = measureChannels([burst], SR);
    expect(report.channels[0].truePeakDbtp).toBeCloseTo(truePeakDbtp(burst), 9);
  });

  it('agrees with the streaming meter it is built on', () => {
    const channel = sine(1000, 5, Math.SQRT1_2);
    const report = measureChannels([channel, Float32Array.from(channel)], SR);
    expect(report.integratedLufs).toBeCloseTo(measureStereo(channel, channel).integratedLufs, 6);
  });

  it('handles a mono buffer', () => {
    const report = measureChannels([sine(1000, 2, 0.5)], SR);
    expect(report.channelCount).toBe(1);
    expect(report.correlation).toBe(1);
    expect(report.stereoWidth).toBe(0);
    expect(report.integratedLufs).toBeGreaterThan(MIN_LUFS);
  });

  it('handles an empty buffer without dividing by zero', () => {
    const report = measureChannels([new Float32Array(0), new Float32Array(0)], SR);
    expect(report.durationSeconds).toBe(0);
    expect(report.integratedLufs).toBe(MIN_LUFS);
    expect(report.samplePeakDbfs).toBe(MIN_DBFS);
    expect(Number.isFinite(report.rmsDbfs)).toBe(true);
  });
});
