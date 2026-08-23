/**
 * The panel harness — a real face, a real engine, and a real display clock.
 *
 * Ledger cells U21 and U22 were BLOCKED on "no browser", and that had stopped
 * being true: this host has one. What was missing was something to lay out and
 * something to pace. This page is that, and it is deliberately thin — it wires
 * the shipped renderer to the shipped worklet and gets out of the way, so that
 * what the cells measure is the product rather than a rig built to satisfy
 * them.
 *
 * The paint loop is the claim U21 makes, in five lines: read whatever the audio
 * thread last published, draw it, ask for the next frame. It never waits for
 * the audio thread and the audio thread never waits for it. Everything that
 * makes that safe is in the seqlock either side.
 */
import { renderFace, type PanelHandle } from '../render/facePanel';
import { motionShaperFace, MotionShaperMeter } from '../units/motion_shaper/face';
import { motionShaperSpecs } from '../units/motion_shaper/params.gen';
import { MotionShaperParam } from '../units/motion_shaper/params.gen';

/** The channel each published double carries, in the bridge's packing order. */
const CHANNELS = [
  MotionShaperMeter.Phase,
  MotionShaperMeter.BandGainLow,
  MotionShaperMeter.BandGainMid,
  MotionShaperMeter.BandGainHigh,
  MotionShaperMeter.BandLevelLow,
  MotionShaperMeter.BandLevelMid,
  MotionShaperMeter.BandLevelHigh,
  MotionShaperMeter.InputPeak,
  MotionShaperMeter.OutputPeak,
] as const;

interface Harness {
  panel: PanelHandle;
  /**
   * Stop the audio thread while the display clock keeps running.
   *
   * This is the only way to tell a face reading engine state from a face
   * animating on a timer: both look identical while the engine runs. Suspending
   * the context stops `process` being called, so nothing new is published — and
   * a playhead that keeps moving after that is moving from something other than
   * the engine.
   */
  stopEngine(): Promise<void>;
  /** The face's own layout claims, so a test never restates them. */
  breakpointsEm: readonly number[];
  minWidthRem: number;
  start(): Promise<void>;
  paints(): number;
  reads(): number;
  torn(): number;
  lastFrame(): Record<string, number>;
}

// The harness is declared for the browser suite in `ui/e2e/global.d.ts`, which
// is the side that consumes it. A second `declare global` here would be two
// declarations of one name and TypeScript rejects the pair — rightly, since
// they are exactly the two opinions this codebase keeps removing.

const mount = document.getElementById('mount') as HTMLElement;

let node: AudioWorkletNode | null = null;
let sequence: Int32Array | null = null;
let frame: Float64Array | null = null;
let paints = 0;
let reads = 0;
let torn = 0;
let last: Record<string, number> = {};
let context: AudioContext | null = null;

const panel = renderFace({
  container: mount,
  face: motionShaperFace,
  specs: motionShaperSpecs,
  title: 'Motion Shaper',
  onParam(id, real) {
    node?.port.postMessage({ kind: 'param', id, value: real });
  },
});

/**
 * Read the published frame through the seqlock.
 *
 * Retried rather than locked, and counted rather than hidden: `torn` records
 * how often the reader caught the writer mid-frame. A face that showed a half
 * frame would show one meter from this block and another from the last, which
 * looks like jitter in the audio rather than in the drawing.
 */
function readFrame(): Record<string, number> | null {
  if (!sequence || !frame) return null;
  for (let attempt = 0; attempt < 4; attempt++) {
    const before = Atomics.load(sequence, 0);
    if (before % 2 !== 0) {
      torn++;
      continue;
    }
    const values: Record<string, number> = {};
    for (let i = 0; i < CHANNELS.length; i++) values[CHANNELS[i]] = frame[i];
    if (Atomics.load(sequence, 0) === before) {
      reads++;
      return values;
    }
    torn++;
  }
  return null;
}

function tick() {
  const values = readFrame();
  if (values) {
    last = values;
    panel.paint(new Map(Object.entries(values)));
    paints++;
  }
  requestAnimationFrame(tick);
}

async function start() {
  context = new AudioContext({ sampleRate: 48000 });
  await context.audioWorklet.addModule('/motionwave.worklet.js');
  await context.audioWorklet.addModule('/shaper_worklet.js');

  // One doubles-aligned buffer: eight bytes for the sequence so the frame that
  // follows it starts on an eight-byte boundary, then the frame itself.
  const shared = new SharedArrayBuffer(8 + 9 * 8);
  sequence = new Int32Array(shared, 0, 1);
  frame = new Float64Array(shared, 8, 9);

  node = new AudioWorkletNode(context, 'motion-shaper', {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [2],
    processorOptions: { shared },
  });

  const osc = context.createOscillator();
  osc.frequency.value = 1000;
  const level = context.createGain();
  level.gain.value = 0.5;
  osc.connect(level).connect(node);
  // Connected to the destination so the graph actually pulls: a worklet in a
  // graph nothing renders is never called, and the test would then be measuring
  // a face paced against an engine that never ran.
  node.connect(context.destination);
  osc.start();

  await new Promise<void>((resolve) => {
    node!.port.onmessage = (event) => {
      if ((event.data as { kind: string }).kind === 'ready') resolve();
    };
  });

  // A shape with an obvious envelope, sent the way the curve editor would.
  node.port.postMessage({
    kind: 'curve',
    band: 0,
    nodes: [
      [0, 1, 0, 0],
      [0.5, 0, 0, 0],
    ],
  });
  for (let band = 0; band < 3; band++) {
    node.port.postMessage({
      kind: 'curve',
      band,
      nodes: [
        [0, 1, 0, 0],
        [0.5, 0, 0, 0],
      ],
    });
  }
  node.port.postMessage({ kind: 'param', id: MotionShaperParam.SyncMode, value: 1 });
  node.port.postMessage({ kind: 'param', id: MotionShaperParam.Rate, value: 2 });
  await context.resume();
  requestAnimationFrame(tick);
}

(window as unknown as { __mwPanel: Harness }).__mwPanel = {
  panel,
  async stopEngine() {
    await context?.suspend();
  },
  breakpointsEm: motionShaperFace.breakpointsEm,
  minWidthRem: motionShaperFace.minWidthRem,
  start,
  paints: () => paints,
  reads: () => reads,
  torn: () => torn,
  lastFrame: () => last,
};
