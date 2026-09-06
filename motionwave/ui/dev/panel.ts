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
import { SETUP, STIMULUS } from './stimulus';
import { MotionShaperParam } from '../units/motion_shaper/params.gen';
import { motionShaperUnit } from '../units/motion_shaper/unit';
import { programEqUnit } from '../units/program_eq/unit';
import { opticalLevellerUnit } from '../units/optical_leveller/unit';
import { fetLimiterUnit } from '../units/fet_limiter/unit';
import { variableMuUnit } from '../units/variable_mu/unit';
import { consoleEqUnit } from '../units/console_eq/unit';
import { granularReverbUnit } from '../units/granular_reverb/unit';
import { granularDelayUnit } from '../units/granular_delay/unit';
import type { UnitUnderTest } from '../harness/types';

/**
 * Every unit this page can host, keyed by its ledger id.
 *
 * One object per unit rather than a face, a spec list and a channel list kept
 * in parallel. The parallel version had a hand-written channel order for two
 * units and nothing for the other five, and the consequence was not a
 * mislabelled readout — it was `startEngine` returning early for any unit whose
 * packing was not listed. Five faces have never had an engine behind them on
 * this page, which is most of why five units read `FAIL` at `V27`: not because
 * nothing moves, because nothing was ever asked to.
 *
 * `MotionWaveFace.tsx` in the app has always read the order off `unit.meters`.
 * Two opinions about the same ordering is the arrangement `CLAUDE.md` rules out
 * for pictures, and it is the same failure here: the copy that is wrong is the
 * one nobody is looking at.
 */
const UNITS: Record<string, UnitUnderTest> = {
  'fx-01': motionShaperUnit,
  'dyn-01': programEqUnit,
  'dyn-02': opticalLevellerUnit,
  'dyn-03': fetLimiterUnit,
  'dyn-04': variableMuUnit,
  'dyn-05': consoleEqUnit,
  'fx-02': granularReverbUnit,
  'fx-03': granularDelayUnit,
};

/**
 * The name each published double carries, in the bridge's packing order.
 *
 * Read off the unit's own declaration, exactly as the app reads it. The order
 * is `bridge.cpp`'s and is asserted from the other end by each unit's visual
 * export, which packs it.
 */
const channelsOf = (unit: UnitUnderTest): readonly string[] =>
  (unit.meters ?? []).map((m) => m.name);

/**
 * The widest frame any unit publishes, and what the shared buffer holds.
 *
 * The same eighteen as `unit_worklet.js`, and it has to be: both sides
 * construct a view over one buffer and the worklet's is unconditional.
 */
const MAX_FRAME_DOUBLES = 18;

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
  /** The face's tabs, so the responsive cell can bring each forward. */
  groups(): readonly string[];
  showGroup(id: string): void;
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

/**
 * Which unit's face to lay out, from `?unit=`.
 *
 * U22 is a claim about *geometry*, and geometry needs a face and a browser and
 * nothing else — no engine, no audio thread. So every unit's face can be
 * measured here from the day it exists, which matters: the alternative is that
 * a unit's responsive cell waits on its WebAssembly bridge, and thirteen units
 * would queue behind one piece of plumbing that has nothing to do with layout.
 *
 * U21 is different and cannot be shortcut this way — it is a claim about two
 * clocks, so it needs that unit's engine actually running.
 */
const requestedId = new URLSearchParams(window.location.search).get('unit') ?? 'fx-01';
const selectedUnit = UNITS[requestedId] ?? UNITS['fx-01'];

const requested = requestedId in UNITS ? requestedId : 'fx-01';
const selected = {
  face: selectedUnit.face!,
  specs: selectedUnit.specs,
  title: selectedUnit.name,
};
const isShaper = requested === 'fx-01';
const CHANNEL_NAMES = channelsOf(selectedUnit);

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
  face: selected.face,
  specs: selected.specs,
  title: selected.title,
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
    for (let i = 0; i < CHANNEL_NAMES.length; i++) values[CHANNEL_NAMES[i]] = frame[i];
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
  // Every unit this page knows the channel packing for gets a real engine.
  //
  // It used to be the Motion Shaper alone, and the comment here said so — but
  // that had stopped being true underneath it: `unit_worklet.js` names seven
  // units' exports and `bridge.cpp` exports all seven. What was left was this
  // early return, so six panels laid out against nothing and V27 — which asks
  // whether something *moves* — could not be measured on any of them.
  //
  // A unit that publishes nothing has nothing for an engine to feed a face
  // with. That is a real state — an instrument shell with no metering yet — and
  // it is reported by the panel staying still rather than by a crash.
  if (CHANNEL_NAMES.length === 0) return;
  context = new AudioContext({ sampleRate: 48000 });
  await context.audioWorklet.addModule('/motionwave.worklet.js');
  // `unit_worklet.js`, and the name is the whole of a bug worth recording.
  // The worklet was `shaper_worklet.js` until it was generalised to name any
  // unit's exports; it was renamed and this line was not. `addModule` then
  // rejected with "Unable to load a worklet's module" for every run after
  // that commit — so U21, which is the cell this whole page exists to
  // measure, has not executed since, while the Ledger recorded it PASS on
  // seven units. A string that names a file is not checked by anything the
  // way an import is, which is exactly why the suite has to be *run*.

  await context.audioWorklet.addModule('/unit_worklet.js');

  // One doubles-aligned buffer: eight bytes for the sequence so the frame that
  // follows it starts on an eight-byte boundary, then the frame itself.
  // The widest frame any unit publishes, not this unit's.
  //
  // Both sides view the same buffer and the worklet's view is
  // `new Float64Array(shared, 8, MAX_FRAME_DOUBLES)`, unconditionally — so a
  // buffer cut to a narrower unit's width makes that construction throw and
  // takes the processor down with it. Sizing this to `unit.meters.length`
  // looked like tidying and stopped every panel on the page: the Program EQ,
  // which had been passing V27 for a week, failed alongside the six that never
  // had. Reading the tail is not the risk the narrow buffer was guarding
  // against either — the worklet zeroes every slot past its own width before
  // publishing, and only the named channels are read below.
  const shared = new SharedArrayBuffer(8 + MAX_FRAME_DOUBLES * 8);
  sequence = new Int32Array(shared, 0, 1);
  frame = new Float64Array(shared, 8, MAX_FRAME_DOUBLES);

  node = new AudioWorkletNode(context, 'motion-wave-unit', {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [2],
    // Which unit the worklet should instantiate. Without it the audio thread
    // runs whichever unit the worklet happens to name, and U21 would measure a
    // face against an engine that is not behind it.
    processorOptions: { shared, unit: requested },
  });

  const stimulus = STIMULUS[requested] ?? { hz: 1000 };
  const osc = context.createOscillator();
  osc.frequency.value = stimulus.hz;
  const level = context.createGain();
  level.gain.value = 0.5;
  osc.connect(level).connect(node);
  if (stimulus.envelopeHz) {
    // A sine into the gain, biased so it never goes negative: the tone swells
    // and falls between about 0.05 and 0.55 rather than inverting. A polarity
    // flip would be a click, and a click is a transient the detectors would
    // respond to instead of the envelope.
    const lfo = context.createOscillator();
    lfo.frequency.value = stimulus.envelopeHz;
    const depth = context.createGain();
    depth.gain.value = 0.25;
    level.gain.value = 0.3;
    lfo.connect(depth).connect(level.gain);
    lfo.start();
  }
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

  if (isShaper) {
    // A shape with an obvious envelope, sent the way the curve editor would.
    // Only the Motion Shaper has curves; the worklet's own table records that
    // as `curve: false` for every other unit, and posting one at a unit that
    // has none is a message its processor drops on the audio thread.
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
  }
  for (const { id, value } of SETUP[requested] ?? []) {
    node.port.postMessage({ kind: 'param', id, value });
  }
  await context.resume();
  requestAnimationFrame(tick);
}

(window as unknown as { __mwPanel: Harness }).__mwPanel = {
  panel,
  async stopEngine() {
    await context?.suspend();
  },
  breakpointsEm: selected.face.breakpointsEm,
  minWidthRem: selected.face.minWidthRem,
  groups: () => panel.groups(),
  showGroup: (id: string) => panel.showGroup(id),
  start,
  paints: () => paints,
  reads: () => reads,
  torn: () => torn,
  lastFrame: () => last,
};
