/**
 * Stem separation, measured rather than described.
 *
 * The mix is built from four sources whose energy sits in known places, so every
 * claim can be a number: how much of each source's own band each stem kept, how
 * much of everyone else's it let through, and how closely the four stems add
 * back up to what went in. The last two cases deliberately probe the limits the
 * module's header admits to, so that the documentation stays true if the code
 * changes.
 */
import { describe, expect, it } from 'vitest';
import {
  RECONSTRUCTION_TOLERANCE_DB,
  STEM_NAMES,
  separateStems,
  sumStems,
  type StemName,
  type Stems,
} from '../src/model/stemSeparation';
import { makeWindow, realFft } from '../src/model/fft';

const SR = 44100;
/** Analysis length for the measurements. A power of two, under the mix length. */
const ANALYSIS = 65536;
const LENGTH = Math.round(1.6 * SR);

/** Deterministic noise, so a failure is reproducible. */
function noiseSource(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a * 1664525 + 1013904223) >>> 0;
    return (a / 4294967296) * 2 - 1;
  };
}

function addSine(target: Float32Array[], hz: number, amplitude: number, pan: number): void {
  const left = Math.min(1, 1 - pan);
  const right = Math.min(1, 1 + pan);
  for (let i = 0; i < LENGTH; i++) {
    const v = amplitude * Math.sin((2 * Math.PI * hz * i) / SR + 0.3);
    target[0][i] += v * left;
    target[1][i] += v * right;
  }
}

/** A centred voice: 440 Hz with a 30 cent, 5 Hz vibrato, the way one is sung. */
function addVocal(target: Float32Array[], amplitude: number, pan = 0): void {
  const left = Math.min(1, 1 - pan);
  const right = Math.min(1, 1 + pan);
  let phase = 0;
  for (let i = 0; i < LENGTH; i++) {
    const cents = 30 * Math.sin((2 * Math.PI * 5 * i) / SR);
    phase += (2 * Math.PI * 440 * Math.pow(2, cents / 1200)) / SR;
    const v = amplitude * Math.sin(phase);
    target[0][i] += v * left;
    target[1][i] += v * right;
  }
}

/** Centred broadband clicks every 250 ms: short, loud, and flat in frequency. */
function addClicks(target: Float32Array[], amplitude: number, intervalSec = 0.25): void {
  const noise = noiseSource(7);
  const burst = Math.round(0.004 * SR);
  for (let at = 0; at < LENGTH; at += Math.round(intervalSec * SR)) {
    for (let i = 0; i < burst && at + i < LENGTH; i++) {
      const v = amplitude * noise() * Math.exp(-i / (burst / 4));
      target[0][at + i] += v;
      target[1][at + i] += v;
    }
  }
}

function emptyMix(channels = 2): Float32Array[] {
  return Array.from({ length: channels }, () => new Float32Array(LENGTH));
}

const measurementWindow = makeWindow('blackmanHarris', ANALYSIS);

/**
 * Energy in a frequency band, summed over channels. Blackman-Harris because its
 * side lobes are 92 dB down: with a rectangular window the 60 Hz tone's own
 * leakage would land in the 440 Hz band and every rejection figure below would
 * be measuring the measurement.
 */
function bandEnergy(channels: readonly Float32Array[], lowHz: number, highHz: number): number {
  let sum = 0;
  const buffer = new Float32Array(ANALYSIS);
  for (const channel of channels) {
    for (let i = 0; i < ANALYSIS; i++) buffer[i] = channel[i] * measurementWindow[i];
    const spectrum = realFft(buffer, ANALYSIS);
    const from = Math.max(0, Math.floor((lowHz * ANALYSIS) / SR));
    const to = Math.min(spectrum.re.length - 1, Math.ceil((highHz * ANALYSIS) / SR));
    for (let k = from; k <= to; k++) {
      sum += spectrum.re[k] * spectrum.re[k] + spectrum.im[k] * spectrum.im[k];
    }
  }
  return sum;
}

/** How much of the mix's energy in a band a stem kept, in dB. 0 is all of it. */
function captureDb(
  stems: Stems,
  name: StemName,
  mix: readonly Float32Array[],
  lowHz: number,
  highHz: number,
): number {
  const reference = bandEnergy(mix, lowHz, highHz);
  const kept = bandEnergy(stems[name], lowHz, highHz);
  if (!(reference > 0)) return -Infinity;
  return 10 * Math.log10(kept / reference);
}

function peakErrorDb(mix: readonly Float32Array[], stems: Stems): number {
  const sum = sumStems(stems);
  let error = 0;
  let peak = 0;
  for (let c = 0; c < mix.length; c++) {
    for (let i = 0; i < mix[c].length; i++) {
      error = Math.max(error, Math.abs(sum[c][i] - mix[c][i]));
      peak = Math.max(peak, Math.abs(mix[c][i]));
    }
  }
  if (!(peak > 0)) return -Infinity;
  return 20 * Math.log10(error / peak);
}

const BANDS: Record<StemName, [number, number]> = {
  bass: [40, 90],
  vocals: [400, 480],
  other: [850, 950],
  drums: [2000, 8000],
};

describe('separateStems on a four-source mix', () => {
  const mix = emptyMix();
  addSine(mix, 60, 0.3, 0); // bass, centred
  addVocal(mix, 0.3); // lead, centred, with vibrato
  addSine(mix, 900, 0.25, -1); // pad, hard left
  addClicks(mix, 0.6); // drums, centred
  const stems = separateStems(mix, SR);

  it('keeps essentially all of each source in its own stem', () => {
    for (const name of STEM_NAMES) {
      const [low, high] = BANDS[name];
      expect(captureDb(stems, name, mix, low, high)).toBeGreaterThan(-1);
    }
  });

  it('rejects every other source by at least 40 dB', () => {
    for (const name of STEM_NAMES) {
      for (const other of STEM_NAMES) {
        if (other === name) continue;
        const [low, high] = BANDS[other];
        expect(captureDb(stems, name, mix, low, high)).toBeLessThan(-40);
      }
    }
  });

  it('returns the same shape as the input', () => {
    for (const name of STEM_NAMES) {
      expect(stems[name]).toHaveLength(2);
      expect(stems[name][0]).toHaveLength(LENGTH);
      expect(stems[name][1]).toHaveLength(LENGTH);
    }
  });

  it('sums back to the input inside the documented tolerance', () => {
    expect(peakErrorDb(mix, stems)).toBeLessThan(RECONSTRUCTION_TOLERANCE_DB);
  });
});

describe('separateStems, harmonic against percussive in the same band', () => {
  // A sustained 3 kHz tone and a click train share the whole top of the
  // spectrum, so nothing but the horizontal-against-vertical test can tell them
  // apart. This is the case the median filters exist for.
  const mix = emptyMix();
  addSine(mix, 3000, 0.3, 0);
  addClicks(mix, 0.6);
  const stems = separateStems(mix, SR);

  it('leaves the sustained tone out of the drum stem', () => {
    expect(captureDb(stems, 'drums', mix, 2950, 3050)).toBeLessThan(-20);
  });

  it('puts the clicks in the drum stem even where the tone sits on top of them', () => {
    expect(captureDb(stems, 'drums', mix, 9000, 16000)).toBeGreaterThan(-1);
  });

  it('still sums back to the input', () => {
    expect(peakErrorDb(mix, stems)).toBeLessThan(RECONSTRUCTION_TOLERANCE_DB);
  });
});

describe('separateStems, the limits it admits to', () => {
  it('sends a hard-panned lead to "other", because the vocal cue is centredness', () => {
    const mix = emptyMix();
    addVocal(mix, 0.4, -1);
    addSine(mix, 60, 0.3, 0);
    const stems = separateStems(mix, SR);
    expect(captureDb(stems, 'other', mix, 400, 480)).toBeGreaterThan(-1);
    expect(captureDb(stems, 'vocals', mix, 400, 480)).toBeLessThan(-20);
  });

  it('accepts mono input and still sums back, with no centre cue to work from', () => {
    const stereo = emptyMix();
    addVocal(stereo, 0.3);
    addSine(stereo, 60, 0.3, 0);
    addClicks(stereo, 0.6);
    const mono = [stereo[0]];
    const stems = separateStems(mono, SR);
    for (const name of STEM_NAMES) expect(stems[name]).toHaveLength(1);
    expect(peakErrorDb(mono, stems)).toBeLessThan(RECONSTRUCTION_TOLERANCE_DB);
    // Everything is "centred" in mono, so the vocal stem is a band-limited slice
    // of the harmonic part. It takes the 440 Hz lead, but it would equally take
    // any other centred harmonic source, which is the point of the warning.
    expect(captureDb(stems, 'vocals', mono, 400, 480)).toBeGreaterThan(-1);
  });

  it('returns empty stems for no channels and for empty channels', () => {
    expect(separateStems([], SR).vocals).toEqual([]);
    const empty = separateStems([new Float32Array(0)], SR);
    expect(empty.drums).toHaveLength(1);
    expect(empty.drums[0]).toHaveLength(0);
  });
});
