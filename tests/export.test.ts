import { describe, expect, it } from 'vitest';
import {
  ExportError,
  audioBufferToWav,
  preRollForProject,
  renderLayout,
  renderProject,
  scheduleLaneOnParam,
  sidechainRouting,
} from '../src/audio/exportMix';
import { normalizeInPlace } from '../src/app/exportActions';
import { makePoint } from '../src/model/automation';
import type { AutomationLane } from '../src/model/automation';
import { denormParam, findAutoParam } from '../src/model/paramRegistry';
import { createEmptyProject } from '../src/model/demoProject';
import { truePeakDbtp } from '../src/model/loudness';
import type { Effect, ProjectData, Track } from '../src/model/types';

/**
 * jsdom has no Web Audio, so the offline *render* is verified in a real browser
 * (`e2e/export.spec.ts`). What is unit-tested here is everything the render
 * decides before it touches a node — the frame budget, the pre-roll, the key
 * routing, the automation schedule — plus the WAV encoder, which is pure byte
 * manipulation and is where a silent corruption would be hardest to notice by
 * ear.
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
    const s = samplesOf(audioBufferToWav(fakeBuffer([new Float32Array([1, -1, 0])])), 1);
    expect(s[0]).toBe(32767);
    expect(s[1]).toBe(-32768);
    // Digital silence carries the dither and nothing else: within one code of
    // zero, which is the price of not truncating (see the encoder's comment).
    expect(Math.abs(s[2])).toBeLessThanOrEqual(1);
  });

  it('clamps out-of-range samples instead of wrapping them into noise', () => {
    // Wrapping would turn a loud overshoot into a full-polarity flip.
    const wav = audioBufferToWav(fakeBuffer([new Float32Array([4, -4, 1.5, -1.5])]));
    expect(samplesOf(wav, 1)).toEqual([32767, -32768, 32767, -32768]);
  });

  it('substitutes silence for non-finite samples rather than emitting garbage', () => {
    const wav = audioBufferToWav(fakeBuffer([new Float32Array([NaN, Infinity, -Infinity, 0.5])]));
    const s = samplesOf(wav, 1);
    expect(Math.abs(s[0])).toBeLessThanOrEqual(1);
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

describe('16-bit quantisation', () => {
  const decode = (wav: ArrayBuffer): number[] => {
    const v = new DataView(wav);
    const out: number[] = [];
    for (let o = 44; o < wav.byteLength; o += 2) out.push(v.getInt16(o, true));
    return out;
  };
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const constant = (value: number, frames: number) => new Float32Array(frames).fill(value);
  const LSB = 1 / 32768;

  /**
   * `DataView.setInt16` applies ToInt16, which truncates toward zero — a level
   * of 0.6 LSB used to encode as digital silence, and every level in between
   * codes lost its fractional part instead of being carried by the dither.
   */
  it('resolves a level below one bit instead of truncating it to silence', () => {
    const codes = decode(audioBufferToWav(fakeBuffer([constant(0.6 * LSB, 4096)])));
    expect(
      codes.some((c) => c !== 0),
      'sub-LSB level encoded as pure silence',
    ).toBe(true);
    expect(mean(codes)).toBeGreaterThan(0.5);
    expect(mean(codes)).toBeLessThan(0.7);
  });

  it('carries the fractional part of a level rather than dropping it', () => {
    const codes = decode(audioBufferToWav(fakeBuffer([constant(1.4 * LSB, 8192)])));
    // Truncation gives exactly 1 for every sample; rounding with dither
    // averages the level it was actually handed.
    expect(mean(codes)).toBeGreaterThan(1.3);
    expect(mean(codes)).toBeLessThan(1.5);
  });

  it('treats the two polarities alike', () => {
    // The old encoder scaled positives by 0x7fff and negatives by 0x8000,
    // which is a small even-order term on top of the truncation.
    const up = mean(decode(audioBufferToWav(fakeBuffer([constant(0.25, 4096)]))));
    const down = mean(decode(audioBufferToWav(fakeBuffer([constant(-0.25, 4096)]))));
    expect(up + down).toBeLessThan(0.5);
  });

  it('is reproducible: the same mix encodes to the same bytes', () => {
    const buf = () => fakeBuffer([constant(0.3 * LSB, 512), constant(-0.7 * LSB, 512)]);
    const a = new Uint8Array(audioBufferToWav(buf()));
    const b = new Uint8Array(audioBufferToWav(buf()));
    expect([...a]).toEqual([...b]);
  });
});

describe('render layout', () => {
  it('allocates the pre-roll on top of the range and hands back only the range', () => {
    const l = renderLayout(10, 2, 48000);
    expect(l.frames).toBe(48000 * 12);
    expect(l.trimFrames).toBe(48000 * 2);
    expect(l.keptFrames).toBe(48000 * 10);
    expect(l.trimFrames + l.keptFrames).toBe(l.frames);
  });

  it('degenerates to the plain range when the pre-roll is switched off', () => {
    const l = renderLayout(3.5, 0, 44100);
    expect(l.trimFrames).toBe(0);
    expect(l.frames).toBe(Math.ceil(3.5 * 44100));
  });
});

describe('pre-roll length', () => {
  const withEffect = (fx: Effect): ProjectData => {
    const p = createEmptyProject('Pre-roll');
    p.tracks[0].effects = [fx];
    return p;
  };
  const comp = (release: number): Effect => ({
    id: 'f1',
    kind: 'compressor',
    bypass: false,
    params: { release },
  });

  it('never drops below the floor', () => {
    expect(preRollForProject(createEmptyProject('Bare'))).toBe(2);
    expect(preRollForProject(withEffect(comp(100)))).toBe(2);
  });

  it('grows to five times the slowest release in the session', () => {
    expect(preRollForProject(withEffect(comp(1000)))).toBeCloseTo(5, 9);
  });

  it('counts the master chain and per-clip chains, not just track inserts', () => {
    const master = createEmptyProject('Master');
    master.master = { volume: 1, pan: 0, effects: [comp(800)] };
    expect(preRollForProject(master)).toBeCloseTo(4, 9);

    const perClip = createEmptyProject('Clip fx');
    perClip.clips = [
      {
        id: 'c1',
        trackId: perClip.tracks[0].id,
        type: 'midi',
        name: 'n',
        start: 0,
        length: 4,
        muted: false,
        notes: [],
        eventFx: [comp(900)],
      },
    ];
    expect(preRollForProject(perClip)).toBeCloseTo(4.5, 9);
  });

  /**
   * The pre-roll is rendered, so it has to count against the ceiling. jsdom has
   * no OfflineAudioContext, and that check comes *after* the length guard — so
   * a range that only overruns once the pre-roll is added must fail with the
   * length message rather than falling through to "no offline rendering".
   */
  it('counts against the render-length ceiling', async () => {
    const p = withEffect(comp(1000)); // 5s pre-roll
    // 120bpm, 0.5s/beat: 14394 beats is 7197s, just inside the 7200s limit.
    const overrun = renderProject(p, {
      range: { startBeat: 0, endBeat: 14394 },
      tailSeconds: 0,
    });
    await expect(overrun).rejects.toThrow(/exceeds the 7200s limit/);

    const inside = renderProject(p, {
      range: { startBeat: 0, endBeat: 14000 },
      tailSeconds: 0,
    });
    await expect(inside).rejects.toThrow(/does not support offline audio rendering/);
    await expect(inside).rejects.toBeInstanceOf(ExportError);
  });
});

describe('sidechain routing', () => {
  const project = (): ProjectData => {
    const p = createEmptyProject('Keys');
    const bass: Track = { ...p.tracks[0], id: 'bass', name: 'Bass' };
    const kick: Track = { ...p.tracks[0], id: 'kick', name: 'Kick' };
    p.tracks = [bass, kick];
    return p;
  };

  it('routes a keyed channel from its key source', () => {
    const p = project();
    p.tracks[0].sidechainFrom = 'kick';
    expect(sidechainRouting(p, () => true)).toEqual([{ trackId: 'bass', keyId: 'kick' }]);
  });

  it('leaves an unkeyed session alone', () => {
    expect(sidechainRouting(project(), () => true)).toEqual([]);
  });

  it('refuses a channel keying itself', () => {
    const p = project();
    p.tracks[0].sidechainFrom = 'bass';
    expect(sidechainRouting(p, () => true)).toEqual([]);
  });

  it('ignores a key source that is not a channel', () => {
    // A folder or VCA carries no audio, and a deleted track carries no id.
    const p = project();
    p.tracks[0].sidechainFrom = 'gone';
    expect(sidechainRouting(p, (id) => id === 'bass' || id === 'kick')).toEqual([]);
  });
});

describe('automation scheduling', () => {
  interface Op {
    kind: 'set' | 'ramp';
    value: number;
    time: number;
  }

  function recordingParam(): { param: AudioParam; ops: Op[] } {
    const ops: Op[] = [];
    const param = {
      setValueAtTime: (value: number, time: number) => ops.push({ kind: 'set', value, time }),
      linearRampToValueAtTime: (value: number, time: number) =>
        ops.push({ kind: 'ramp', value, time }),
    } as unknown as AudioParam;
    return { param, ops };
  }

  function volumeLane(curve: 'step' | 'linear'): {
    lane: AutomationLane;
    desc: ReturnType<typeof findAutoParam>;
    project: ProjectData;
  } {
    const project = createEmptyProject('Lane');
    const lane: AutomationLane = {
      id: 'l1',
      paramId: 'volume',
      enabled: true,
      points: [makePoint(0, 1, curve), makePoint(4, 0.25, 'linear')],
    };
    return { lane, desc: findAutoParam(project.tracks[0], project, 'volume'), project };
  }

  /**
   * `setValueAtTime(v, t)` takes the value *at* t, so the 2 ms ramp that
   * followed it targeted a value the parameter already held — a hold, not a
   * ramp, and a one-sample discontinuity in the bounce. The ramp alone leaves
   * from the value the previous knot scheduled at t, which is the intent.
   */
  it('lands a stepped jump on a real 2ms ramp, not an instantaneous set', () => {
    const { lane, desc } = volumeLane('step');
    const { param, ops } = recordingParam();
    scheduleLaneOnParam(param, lane, desc!, {
      startBeat: 0,
      endBeat: 8,
      timeOf: (beat) => beat * 0.5,
    });

    // The only instantaneous write is the lane's opening value.
    expect(ops.filter((o) => o.kind === 'set')).toHaveLength(1);
    expect(ops[0]).toEqual({ kind: 'set', value: denormParam(desc!, 1), time: 0 });

    const jump = ops[ops.length - 2];
    const land = ops[ops.length - 1];
    expect(jump.kind).toBe('ramp');
    expect(jump.value).toBeCloseTo(denormParam(desc!, 1), 9);
    expect(land.kind).toBe('ramp');
    expect(land.value).toBeCloseTo(denormParam(desc!, 0.25), 9);
    expect(land.time - jump.time).toBeCloseTo(0.002, 9);
  });

  it('carries the pre-roll on every ramp while holding the opening value at zero', () => {
    const { lane, desc } = volumeLane('linear');
    const { param, ops } = recordingParam();
    const preRoll = 2;
    scheduleLaneOnParam(param, lane, desc!, {
      startBeat: 0,
      endBeat: 8,
      timeOf: (beat) => preRoll + beat * 0.5,
    });

    expect(ops[0]).toEqual({ kind: 'set', value: denormParam(desc!, 1), time: 0 });
    for (const op of ops.slice(1)) expect(op.time).toBeGreaterThanOrEqual(preRoll);
  });
});

describe('peak normalisation', () => {
  /**
   * The peak used to be read back through dBTP, which floors at -120 dBFS, so
   * every quieter stem measured as 1e-6 however quiet it really was — and the
   * `peak <= 0` guard could never fire, because 1e-6 is not zero.
   */
  it('leaves a silent stem alone instead of scaling it by a million', () => {
    const ch = new Float32Array(2048);
    expect(normalizeInPlace([ch], -1)).toBe(1);
  });

  it('reaches the ceiling for a stem below the dBFS floor', () => {
    const ch = new Float32Array(2048).fill(1e-9); // about -180 dBFS
    normalizeInPlace([ch], -1);
    // Measured against 1e-6 instead of the real peak this landed ~60 dB short.
    expect(truePeakDbtp(ch)).toBeCloseTo(-1, 3);
  });

  it('still normalises an ordinary stem to the ceiling it was given', () => {
    const ch = Float32Array.from({ length: 2048 }, (_, i) => 0.25 * Math.sin(i / 7));
    normalizeInPlace([ch], -6);
    let peak = 0;
    for (const v of ch) peak = Math.max(peak, Math.abs(v));
    expect(20 * Math.log10(peak)).toBeGreaterThan(-6.6);
    expect(20 * Math.log10(peak)).toBeLessThan(-5.4);
  });
});
