import { describe, expect, it } from 'vitest';
import { audioBufferToWav } from '../src/audio/exportMix';

/**
 * jsdom has no Web Audio, so the offline *render* is verified in a real browser
 * (`e2e/export.spec.ts`). What is unit-tested here is the WAV encoder, which is
 * pure byte manipulation and is where a silent corruption would be hardest to
 * notice by ear.
 */
function fakeBuffer(channels: Float32Array[], sampleRate = 44100): AudioBuffer {
  return {
    numberOfChannels: channels.length,
    length: channels[0].length,
    sampleRate,
    duration: channels[0].length / sampleRate,
    getChannelData: (i: number) => channels[i],
  } as unknown as AudioBuffer;
}

function parseHeader(buf: ArrayBuffer) {
  const v = new DataView(buf);
  const str = (o: number, n: number) => String.fromCharCode(...new Uint8Array(buf, o, n));
  return {
    riff: str(0, 4),
    riffSize: v.getUint32(4, true),
    wave: str(8, 4),
    fmt: str(12, 4),
    fmtSize: v.getUint32(16, true),
    format: v.getUint16(20, true),
    channels: v.getUint16(22, true),
    sampleRate: v.getUint32(24, true),
    byteRate: v.getUint32(28, true),
    blockAlign: v.getUint16(32, true),
    bitsPerSample: v.getUint16(34, true),
    data: str(36, 4),
    dataSize: v.getUint32(40, true),
  };
}

describe('WAV header', () => {
  it('writes a well-formed 16-bit PCM stereo header', () => {
    const frames = 1000;
    const wav = audioBufferToWav(
      fakeBuffer([new Float32Array(frames), new Float32Array(frames)], 48000),
    );
    const h = parseHeader(wav);

    expect(h.riff).toBe('RIFF');
    expect(h.wave).toBe('WAVE');
    expect(h.fmt).toBe('fmt ');
    expect(h.data).toBe('data');
    expect(h.fmtSize).toBe(16);
    expect(h.format).toBe(1); // PCM
    expect(h.channels).toBe(2);
    expect(h.sampleRate).toBe(48000);
    expect(h.bitsPerSample).toBe(16);
    expect(h.blockAlign).toBe(4); // 2 channels x 2 bytes
    expect(h.byteRate).toBe(48000 * 4);
  });

  it('declares sizes that match the actual file length', () => {
    const frames = 512;
    const wav = audioBufferToWav(fakeBuffer([new Float32Array(frames), new Float32Array(frames)]));
    const h = parseHeader(wav);
    expect(h.dataSize).toBe(frames * 4);
    expect(wav.byteLength).toBe(44 + frames * 4);
    // RIFF size counts everything after the first 8 bytes.
    expect(h.riffSize).toBe(wav.byteLength - 8);
  });

  it('writes a mono header for a mono buffer', () => {
    const wav = audioBufferToWav(fakeBuffer([new Float32Array(100)]));
    const h = parseHeader(wav);
    expect(h.channels).toBe(1);
    expect(h.blockAlign).toBe(2);
    expect(wav.byteLength).toBe(44 + 100 * 2);
  });

  it('downmixes beyond stereo rather than writing a header it cannot honour', () => {
    const f = () => new Float32Array(50);
    const wav = audioBufferToWav(fakeBuffer([f(), f(), f(), f(), f(), f()]));
    const h = parseHeader(wav);
    expect(h.channels).toBe(2);
    expect(h.dataSize).toBe(50 * 4);
  });
});

describe('WAV sample encoding', () => {
  const samplesOf = (wav: ArrayBuffer, channels: number) => {
    const v = new DataView(wav);
    const out: number[] = [];
    for (let o = 44; o < wav.byteLength; o += 2) out.push(v.getInt16(o, true));
    expect(out.length % channels).toBe(0);
    return out;
  };

  it('maps full-scale positive and negative to the 16-bit extremes', () => {
    const wav = audioBufferToWav(fakeBuffer([new Float32Array([1, -1, 0])]));
    expect(samplesOf(wav, 1)).toEqual([32767, -32768, 0]);
  });

  it('clamps out-of-range samples instead of wrapping them into noise', () => {
    // Wrapping would turn a loud overshoot into a full-polarity flip.
    const wav = audioBufferToWav(fakeBuffer([new Float32Array([4, -4, 1.5, -1.5])]));
    expect(samplesOf(wav, 1)).toEqual([32767, -32768, 32767, -32768]);
  });

  it('substitutes silence for non-finite samples rather than emitting garbage', () => {
    const wav = audioBufferToWav(fakeBuffer([new Float32Array([NaN, Infinity, -Infinity, 0.5])]));
    const s = samplesOf(wav, 1);
    expect(s[0]).toBe(0);
    // Infinity clamps to full scale after the finite check passes it through.
    expect(Math.abs(s[1])).toBeLessThanOrEqual(32767);
    expect(Math.abs(s[2])).toBeLessThanOrEqual(32768);
    expect(s[3]).toBeGreaterThan(16000);
  });

  it('interleaves stereo channels sample by sample', () => {
    const left = new Float32Array([1, 1, 1]);
    const right = new Float32Array([-1, -1, -1]);
    const s = samplesOf(audioBufferToWav(fakeBuffer([left, right])), 2);
    expect(s).toEqual([32767, -32768, 32767, -32768, 32767, -32768]);
  });

  it('round-trips a mid-scale value within one quantisation step', () => {
    const wav = audioBufferToWav(fakeBuffer([new Float32Array([0.5])]));
    const s = samplesOf(wav, 1)[0];
    expect(Math.abs(s / 32767 - 0.5)).toBeLessThan(0.0001);
  });

  it('produces a header-only file for an empty buffer', () => {
    const wav = audioBufferToWav(fakeBuffer([new Float32Array(0)]));
    expect(wav.byteLength).toBe(44);
    expect(parseHeader(wav).dataSize).toBe(0);
  });
});
