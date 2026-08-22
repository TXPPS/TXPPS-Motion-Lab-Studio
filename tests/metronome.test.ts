import { beforeAll, describe, expect, it } from 'vitest';
import { clickGain, clickSounds, engine } from '../src/audio/engine';
import { createEmptyProject } from '../src/model/demoProject';
import { useInputStore } from '../src/state/inputStore';
import { useProjectStore } from '../src/state/projectStore';

/**
 * The click's level and its record-only switch, proven where they actually
 * land: on the one gain node that sits outside the mix.
 *
 * jsdom has no Web Audio, so the engine is started against a recording
 * stand-in for an AudioContext — enough to answer "which node was written, and
 * what is it wired to", which is the whole claim: the level reaches the click
 * and nothing else, and the click still bypasses the master analyser and the
 * safety limiter on its way to the output.
 */

interface RecordingParam {
  value: number;
  /** Highest value ever *written* — an envelope's peak survives its own decay. */
  peak: number;
  setTargetAtTime(v: number): void;
  setValueAtTime(v: number): void;
  linearRampToValueAtTime(v: number): void;
  cancelScheduledValues(): void;
}

interface RecordingNode {
  kind: string;
  connect(to: RecordingNode | RecordingParam): RecordingNode | undefined;
  disconnect(): void;
  [key: string]: unknown;
}

interface Edge {
  from: RecordingNode;
  to: RecordingNode | RecordingParam;
}

const edges: Edge[] = [];

function param(value = 0): RecordingParam {
  return {
    value,
    // Starts at zero rather than at the node's default, so "was written" and
    // "happens to be one" cannot be confused.
    peak: 0,
    setTargetAtTime(v) {
      this.value = v;
      this.peak = Math.max(this.peak, v);
    },
    setValueAtTime(v) {
      this.value = v;
      this.peak = Math.max(this.peak, v);
    },
    linearRampToValueAtTime(v) {
      this.value = v;
      this.peak = Math.max(this.peak, v);
    },
    cancelScheduledValues() {},
  };
}

const isParam = (x: RecordingNode | RecordingParam): x is RecordingParam =>
  typeof (x as RecordingParam).setTargetAtTime === 'function';

function node(kind: string, extra: Record<string, unknown> = {}): RecordingNode {
  const self: RecordingNode = {
    kind,
    ...extra,
    connect(to) {
      edges.push({ from: self, to });
      return isParam(to) ? undefined : to;
    },
    disconnect() {},
  };
  return self;
}

class FakeAudioContext {
  readonly sampleRate = 48000;
  currentTime = 0;
  state = 'running';
  readonly destination = node('destination');
  onstatechange: (() => void) | null = null;

  resume(): Promise<void> {
    return Promise.resolve();
  }
  createGain() {
    return node('gain', { gain: param(1), channelCount: 2, channelCountMode: 'max' });
  }
  createStereoPanner() {
    return node('panner', { pan: param(0) });
  }
  createDynamicsCompressor() {
    return node('compressor', {
      threshold: param(-24),
      knee: param(30),
      ratio: param(12),
      attack: param(0.003),
      release: param(0.25),
      reduction: 0,
    });
  }
  createAnalyser() {
    return node('analyser', {
      fftSize: 2048,
      getFloatTimeDomainData: (b: Float32Array) => b.fill(0),
    });
  }
  createChannelSplitter() {
    return node('splitter');
  }
  createChannelMerger() {
    return node('merger');
  }
  // The insert chains a channel builds on sync need these; nothing here reads
  // them, but a missing factory is a crash rather than a silent no-op.
  createDelay() {
    return node('delay', { delayTime: param(0) });
  }
  createBiquadFilter() {
    return node('biquad', {
      type: 'lowpass',
      frequency: param(350),
      Q: param(1),
      gain: param(0),
      detune: param(0),
    });
  }
  createWaveShaper() {
    return node('waveshaper', { curve: null, oversample: 'none' });
  }
  createConvolver() {
    return node('convolver', { buffer: null, normalize: true });
  }
  createConstantSource() {
    return node('constant', { offset: param(1), start: () => {}, stop: () => {} });
  }
  createPeriodicWave() {
    return {};
  }
  createBuffer(channels: number, length: number) {
    return {
      length,
      numberOfChannels: channels,
      sampleRate: 48000,
      duration: length / 48000,
      getChannelData: () => new Float32Array(length),
    };
  }
  createOscillator() {
    return node('oscillator', {
      type: 'sine',
      frequency: param(440),
      start: () => {},
      stop: () => {},
    });
  }
  createBufferSource() {
    return node('buffersource', {
      buffer: null,
      playbackRate: param(1),
      start: () => {},
      stop: () => {},
    });
  }
}

/** Nodes wired straight into the output. */
function feeding(target: RecordingNode): RecordingNode[] {
  return edges.filter((e) => e.to === target).map((e) => e.from);
}

/**
 * The two nodes this file is about, found structurally rather than by creation
 * order: the click bus is the only gain wired straight into the output (the
 * other thing there is the master analyser), and the master fader is the gain
 * feeding the master pan. Both are resolved once, while the graph the engine
 * built at startup is still the whole of the record.
 */
let metro: RecordingNode;
let master: RecordingNode;

function levelOf(n: RecordingNode): number {
  return (n.gain as RecordingParam).value;
}

beforeAll(async () => {
  // The engine's frame loop measures meters, which is not what this file is
  // about — and a loop that keeps rescheduling itself outlives the test.
  globalThis.requestAnimationFrame = (() => 0) as unknown as typeof requestAnimationFrame;
  (globalThis as unknown as { AudioContext: unknown }).AudioContext = FakeAudioContext;
  useProjectStore.getState().setProject(createEmptyProject('Click'), { markClean: true });
  await engine.start();

  const ctx = engine.context as unknown as FakeAudioContext;
  const direct = feeding(ctx.destination).filter((n) => n.kind === 'gain');
  expect(direct, 'exactly one gain node should reach the output directly').toHaveLength(1);
  metro = direct[0];
  const toPan = edges.find(
    (e) => !isParam(e.to) && e.to.kind === 'panner' && e.from.kind === 'gain',
  );
  master = toPan!.from;
});

describe('the click level', () => {
  it('defaults to the validated 0.7 and clamps what it is handed', () => {
    expect(clickGain({})).toBe(0.7);
    expect(clickGain({ clickLevel: 0 })).toBe(0);
    expect(clickGain({ clickLevel: 1.4 })).toBeCloseTo(1.4);
    expect(clickGain({ clickLevel: -3 })).toBe(0);
    expect(clickGain({ clickLevel: 9 })).toBe(2);
    expect(clickGain({ clickLevel: Number.NaN })).toBe(0.7);
  });

  it('reaches the click, on a node that bypasses the analyser and the limiter', () => {
    // Structural, and the reason the click can be levelled at all: the bus it
    // is written to is wired to the output directly, past the master analyser
    // and the safety limiter.
    useProjectStore.getState().update((d) => {
      d.clickLevel = 0.25;
    });
    expect(levelOf(metro)).toBeCloseTo(0.25);
  });

  it('follows the project without touching the master fader', () => {
    const masterBefore = levelOf(master);
    useProjectStore.getState().update((d) => {
      d.clickLevel = 0.9;
    });
    expect(levelOf(metro)).toBeCloseTo(0.9);
    expect(levelOf(master)).toBeCloseTo(masterBefore);
  });

  it('scales the click itself, and keeps the accent above the beat', () => {
    edges.length = 0;
    engine.playMetronomeClick(true);
    engine.playMetronomeClick(false);
    const clicks = edges.filter((e) => e.from.kind === 'gain' && e.to === metro);
    expect(clicks, 'both clicks should reach the click bus').toHaveLength(2);
    // The level lives on the bus; each click's own envelope carries nothing
    // but the accent balance, which the level must not flatten.
    const peakOf = (n: RecordingNode) => (n.gain as RecordingParam).peak;
    expect(peakOf(clicks[0].from)).toBeGreaterThan(peakOf(clicks[1].from));
  });
});

describe('click only while recording', () => {
  it('sounds in every phase when the switch is off', () => {
    expect(clickSounds({}, 'idle')).toBe(true);
    expect(clickSounds({ clickRecordOnly: false }, 'idle')).toBe(true);
  });

  it('sounds only while counting in or capturing when it is on', () => {
    const on = { clickRecordOnly: true };
    expect(clickSounds(on, 'idle')).toBe(false);
    expect(clickSounds(on, 'arming')).toBe(false);
    expect(clickSounds(on, 'finalizing')).toBe(false);
    expect(clickSounds(on, 'error')).toBe(false);
    // A count-in with no click is not a count-in.
    expect(clickSounds(on, 'countIn')).toBe(true);
    expect(clickSounds(on, 'recording')).toBe(true);
  });

  it('silences the transport click but never the count-in', () => {
    useProjectStore.getState().update((d) => {
      d.clickRecordOnly = true;
      d.metronome = true;
    });
    useInputStore.getState().set({ phase: 'idle' });

    edges.length = 0;
    engine.scheduleTransportClick(0, true);
    expect(edges.filter((e) => e.to === metro)).toHaveLength(0);

    // The count-in calls the click directly, so it is unaffected.
    engine.playMetronomeClick(true);
    expect(edges.filter((e) => e.to === metro)).toHaveLength(1);

    useInputStore.getState().set({ phase: 'recording' });
    edges.length = 0;
    engine.scheduleTransportClick(0, true);
    expect(edges.filter((e) => e.to === metro)).toHaveLength(1);
  });
});
