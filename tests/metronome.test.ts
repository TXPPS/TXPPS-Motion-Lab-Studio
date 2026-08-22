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
    setTargetAtTime(v) {
      this.value = v;
    },
    setValueAtTime(v) {
      this.value = v;
    },
    linearRampToValueAtTime(v) {
      this.value = v;
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

function metroGain(): RecordingNode {
  const ctx = engine.context as unknown as FakeAudioContext;
  const gains = feeding(ctx.destination).filter((n) => n.kind === 'gain');
  expect(gains, 'exactly one gain node should reach the output directly').toHaveLength(1);
  return gains[0];
}

/** The master fader: the gain whose output is the master pan. */
function masterGain(): RecordingNode {
  const pan = edges.find((e) => !isParam(e.to) && e.to.kind === 'panner' && e.from.kind === 'gain');
  return pan!.from;
}

function levelOf(n: RecordingNode): number {
  return (n.gain as RecordingParam).value;
}

beforeAll(async () => {
  // The engine's frame loop measures meters, which is not what this file is
  // about — and a loop that keeps rescheduling itself outlives the test.
  globalThis.requestAnimationFrame = (() => 0) as unknown as typeof requestAnimationFrame;
  (globalThis as unknown as { AudioContext: unknown }).AudioContext = FakeAudioContext;
  const project = createEmptyProject('Click');
  project.clickLevel = 0.25;
  useProjectStore.getState().setProject(project, { markClean: true });
  await engine.start();
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
    expect(levelOf(metroGain())).toBeCloseTo(0.25);
  });

  it('follows the project without touching the master fader', () => {
    const masterBefore = levelOf(masterGain());
    useProjectStore.getState().update((d) => {
      d.clickLevel = 0.9;
    });
    expect(levelOf(metroGain())).toBeCloseTo(0.9);
    expect(levelOf(masterGain())).toBeCloseTo(masterBefore);
  });

  it('scales the click itself, and keeps the accent above the beat', () => {
    edges.length = 0;
    engine.playMetronomeClick(true);
    engine.playMetronomeClick(false);
    const clicks = edges.filter((e) => e.from.kind === 'gain' && e.to === metroGain());
    expect(clicks, 'both clicks should reach the click bus').toHaveLength(2);
    // The level lives on the bus; the envelope carries only the accent balance.
    expect(levelOf(clicks[0].from)).toBeGreaterThan(levelOf(clicks[1].from));
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
    expect(edges.filter((e) => e.to === metroGain())).toHaveLength(0);

    // The count-in calls the click directly, so it is unaffected.
    engine.playMetronomeClick(true);
    expect(edges.filter((e) => e.to === metroGain())).toHaveLength(1);

    useInputStore.getState().set({ phase: 'recording' });
    edges.length = 0;
    engine.scheduleTransportClick(0, true);
    expect(edges.filter((e) => e.to === metroGain())).toHaveLength(1);
  });
});
