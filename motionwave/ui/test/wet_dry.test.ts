import { describe, expect, it } from 'vitest';

import { DelayLine } from '../mix/delay_line';
import { LatencyDeclarationError, NO_LATENCY, declareLatency, sumLatency } from '../mix/latency';
import { WetDryMixer } from '../mix/wet_dry';
import { flatnessDb, magnitudeSpectrum } from '../harness/fft';
import { impulse, peak, peakIndex } from '../harness/signal';

/**
 * The defect this whole file exists for: MotionLab Studio's Saturator and
 * Distortion each blended a wet leg 192 samples late against an undelayed dry
 * leg, which is a comb with a notch every 250 Hz at 48 kHz, at every Mix below
 * 100%. Both legs were inside one insert, so no channel-level compensation
 * could reach it.
 */
const WET_LATENCY_FRAMES = 192;

/** Stands in for an oversampled waveshaper: a pure delay of the same length. */
function wetPath(input: Float32Array): Float32Array {
  const out = new Float32Array(input.length);
  const line = new DelayLine(WET_LATENCY_FRAMES);
  line.process(input, out, input.length);
  return out;
}

function blend(mixer: WetDryMixer, input: Float32Array): Float32Array {
  const wet = wetPath(input);
  const out = new Float32Array(input.length);
  mixer.process(input, wet, out, input.length);
  return out;
}

describe('a latency has to be declared, not passed as a number', () => {
  it('refuses a fractional figure rather than rounding it into a lie', () => {
    expect(() => declareLatency(192.5, 'measured', 'half a sample late')).toThrow(
      LatencyDeclarationError,
    );
  });

  it('refuses a negative figure, an infinite one, and an unexplained one', () => {
    expect(() => declareLatency(-1, 'measured', 'earlier than the input')).toThrow(
      LatencyDeclarationError,
    );
    expect(() => declareLatency(Number.POSITIVE_INFINITY, 'measured', 'forever')).toThrow(
      LatencyDeclarationError,
    );
    expect(() => declareLatency(192, 'measured', '   ')).toThrow(LatencyDeclarationError);
  });

  it('will not let "none" mean a non-zero delay, or a zero delay go unexplained', () => {
    expect(() => declareLatency(192, 'none', 'nothing at all')).toThrow(LatencyDeclarationError);
    expect(() => declareLatency(0, 'measured', 'measured as zero')).toThrow(
      LatencyDeclarationError,
    );
    expect(NO_LATENCY.frames).toBe(0);
  });

  it('keeps the provenance when latencies are summed in series', () => {
    const shaper = declareLatency(192, 'measured', 'oversampled shaper');
    const cabinet = declareLatency(205, 'measured', 'cabinet convolver');
    const total = sumLatency(shaper, cabinet);
    // The Amp Sim deviation in PROGRESS.md is exactly this sum going unmade:
    // 192 declared for the shaper while the convolver quietly added 205 more.
    expect(total.frames).toBe(397);
    expect(total.note).toContain('cabinet convolver');
  });
});

describe('the mixer aligns the dry leg itself, so a comb cannot be built', () => {
  it('sums both legs at one instant instead of 192 samples apart', () => {
    const mixer = WetDryMixer.forWetPath(
      declareLatency(WET_LATENCY_FRAMES, 'measured', 'oversampled shaper'),
      { mix: 0.5 },
    );
    const out = blend(mixer, impulse(2048, 0, 1));

    expect(peakIndex(out)).toBe(WET_LATENCY_FRAMES);
    expect(out[WET_LATENCY_FRAMES]).toBeCloseTo(1, 6);
    // Nothing anywhere else: a second impulse at index 0 is the comb.
    for (let i = 0; i < out.length; i++) {
      if (i === WET_LATENCY_FRAMES) continue;
      expect(Math.abs(out[i]), `sample ${i} should be silent`).toBeLessThan(1e-7);
    }
  });

  it('leaves the magnitude response flat at every mix position', () => {
    // Measured from the impulse response, unwindowed, because that *is* the
    // transfer function: a blend of two aligned legs is one impulse and its
    // spectrum is a straight line, while a blend of two legs 192 samples apart
    // is two impulses and its spectrum has a null every 250 Hz at 48 kHz.
    for (const mix of [0, 0.25, 0.5, 0.75, 1]) {
      const mixer = WetDryMixer.forWetPath(
        declareLatency(WET_LATENCY_FRAMES, 'measured', 'oversampled shaper'),
        { mix },
      );
      const spectrum = magnitudeSpectrum(blend(mixer, impulse(1 << 14, 0, 1)), false);
      expect(flatnessDb(spectrum, 1, spectrum.length - 1), `mix ${mix}`).toBeLessThan(0.1);
    }
  });

  it('reports its own latency so the channel can compensate what it added', () => {
    const mixer = WetDryMixer.forWetPath(
      declareLatency(WET_LATENCY_FRAMES, 'measured', 'oversampled shaper'),
    );
    expect(mixer.compensationFrames).toBe(WET_LATENCY_FRAMES);
    // Reporting zero would move the defect from inside the insert, where
    // nothing can fix it, to the channel, where the fix already exists.
    expect(mixer.reportedLatencyFrames).toBe(WET_LATENCY_FRAMES);
  });

  it('reads the declaration straight off the processor in the wet leg', () => {
    const processor = {
      declaredLatency: declareLatency(64, 'derived', 'linear-phase FIR of 129 taps'),
    };
    expect(WetDryMixer.forProcessor(processor).compensationFrames).toBe(64);
  });
});

describe('the mutation test: the alignment is what removes the comb', () => {
  it('produces the shipped defect when the same wet path is declared as zero', () => {
    // Declaring the truth is what makes the mixer work, so declaring a lie has
    // to reproduce the original bug. If this ever stops combing, the alignment
    // is not what is doing the work and the test above proves nothing.
    const lying = WetDryMixer.forWetPath(NO_LATENCY, { mix: 0.5 });
    const out = blend(lying, impulse(2048, 0, 1));

    expect(Math.abs(out[0])).toBeCloseTo(0.5, 6);
    expect(Math.abs(out[WET_LATENCY_FRAMES])).toBeCloseTo(0.5, 6);

    const combed = magnitudeSpectrum(
      blend(WetDryMixer.forWetPath(NO_LATENCY, { mix: 0.5 }), impulse(1 << 14, 0, 1)),
      false,
    );
    const aligned = magnitudeSpectrum(
      blend(
        WetDryMixer.forWetPath(declareLatency(WET_LATENCY_FRAMES, 'measured', 'shaper'), {
          mix: 0.5,
        }),
        impulse(1 << 14, 0, 1),
      ),
      false,
    );
    expect(flatnessDb(aligned, 1, aligned.length - 1)).toBeLessThan(0.1);
    expect(flatnessDb(combed, 1, combed.length - 1)).toBeGreaterThan(40);

    // And the notches are where the arithmetic says they are. Two legs 192
    // samples apart null wherever 192 samples is an odd number of half cycles,
    // which is every 48000/192 = 250 Hz — the figure PA-010 recorded. The first
    // null is at half of that, and the bin nearest it is 34 dB down rather than
    // infinitely down because a bin centre is not the null itself.
    const firstNullBin = Math.round((1 << 14) / (2 * WET_LATENCY_FRAMES));
    expect(combed[firstNullBin]).toBeLessThan(combed[0] / 50);
  });
});

describe('the blend itself', () => {
  it('is linear by default and equal power when asked', () => {
    const latency = declareLatency(4, 'derived', 'four-tap FIR');
    const linear = WetDryMixer.forWetPath(latency);
    const equal = WetDryMixer.forWetPath(latency, { law: 'equalPower' });
    expect(linear.gainsAt(0.5)).toEqual({ dry: 0.5, wet: 0.5 });
    expect(equal.gainsAt(0.5).dry).toBeCloseTo(Math.SQRT1_2, 9);
    expect(equal.gainsAt(0.5).wet).toBeCloseTo(Math.SQRT1_2, 9);
  });

  it('sweeps the mix inside the block, so automating it does not step', () => {
    const mixer = WetDryMixer.forWetPath(NO_LATENCY);
    const dry = new Float32Array(256).fill(1);
    const wet = new Float32Array(256).fill(0);
    const out = new Float32Array(256);
    mixer.processRamped(dry, wet, out, 256, { start: 1, end: 0, moving: true });
    let biggestStep = 0;
    for (let i = 1; i < out.length; i++) {
      biggestStep = Math.max(biggestStep, Math.abs(out[i] - out[i - 1]));
    }
    expect(biggestStep).toBeLessThan(0.01);
    expect(mixer.mix).toBe(0);
  });

  it('is safe when the output buffer is one of its inputs', () => {
    const mixer = WetDryMixer.forWetPath(NO_LATENCY, { mix: 0.5 });
    const dry = new Float32Array([1, 1, 1, 1]);
    const wet = new Float32Array([0, 0, 0, 0]);
    mixer.process(dry, wet, wet, 4);
    expect([...wet]).toEqual([0.5, 0.5, 0.5, 0.5]);
  });

  it('clamps a mix position that arrives outside its range', () => {
    const mixer = WetDryMixer.forWetPath(NO_LATENCY);
    mixer.setMix(5);
    expect(mixer.mix).toBe(1);
    mixer.setMix(Number.NaN);
    expect(mixer.mix).toBe(1);
  });
});

describe('the delay line the alignment is built on', () => {
  it('returns the sample from exactly n frames ago', () => {
    const line = new DelayLine(3);
    const input = new Float32Array([1, 2, 3, 4, 5, 6]);
    const out = new Float32Array(6);
    line.process(input, out, 6);
    expect([...out]).toEqual([0, 0, 0, 1, 2, 3]);
  });

  it('is a pass-through at zero, and correct in place', () => {
    const line = new DelayLine(0);
    const buffer = new Float32Array([1, 2, 3]);
    line.process(buffer, buffer, 3);
    expect([...buffer]).toEqual([1, 2, 3]);
  });

  it('clears its tail on reset, so a relocated transport does not replay old audio', () => {
    const line = new DelayLine(2);
    const out = new Float32Array(4);
    line.process(new Float32Array([9, 9, 9, 9]), out, 4);
    line.reset();
    line.process(new Float32Array([0, 0, 0, 0]), out, 4);
    expect(peak(out)).toBe(0);
  });

  it('refuses a fractional or negative delay', () => {
    expect(() => new DelayLine(1.5)).toThrow(RangeError);
    expect(() => new DelayLine(-1)).toThrow(RangeError);
  });
});
