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
import { MotionShaperParam } from '../units/motion_shaper/params.gen';
import { ConsoleEqParam } from '../units/console_eq/params.gen';
import { OpticalLevellerParam } from '../units/optical_leveller/params.gen';
import { FetLimiterParam } from '../units/fet_limiter/params.gen';
import { VariableMuParam } from '../units/variable_mu/params.gen';
import { motionShaperUnit } from '../units/motion_shaper/unit';
import { programEqUnit } from '../units/program_eq/unit';
import { opticalLevellerUnit } from '../units/optical_leveller/unit';
import { fetLimiterUnit } from '../units/fet_limiter/unit';
import { variableMuUnit } from '../units/variable_mu/unit';
import { consoleEqUnit } from '../units/console_eq/unit';
import { granularReverbUnit } from '../units/granular_reverb/unit';
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
 * The same nine as `unit_worklet.js`, and it has to be: both sides construct
 * a view over one buffer and the worklet's is unconditional.
 */
const MAX_FRAME_DOUBLES = 9;

/**
 * What to play at each unit, and why it is not one tone for all of them.
 *
 * The Motion Shaper's claim is about a modulator, so a steady tone is right —
 * what moves is the shaping. The Program EQ's is about iron, and a transformer
 * follows *flux*: at 1 kHz the core barely moves whatever the level, so a
 * kilohertz probe would leave its panel still and V27 would be measuring the
 * stimulus rather than the unit. 40 Hz is where `dyn-01` §7's thickening lives.
 */
interface Stimulus {
  hz: number;
  /**
   * Rate of an amplitude envelope, in Hz, or 0 for a steady tone.
   *
   * A steady tone cannot reveal a leveller. Its detector settles within its
   * attack and then every block publishes the same gain reduction, so the panel
   * shows one number forever and `V27` fails for a unit whose animation is
   * perfectly correct. What a compressor's face has to show is its *time*
   * behaviour — an optical cell's exposure history, a FET's recovery, a valve's
   * bias storage — and time behaviour is invisible under a signal that has none.
   *
   * So the dynamics units get programme rather than a tone: the same sine under
   * a slow envelope, which is the smallest stimulus their mechanism responds to.
   * This is the same argument as `dyn-01`'s 40 Hz and not a different one — a
   * probe that leaves the mechanism still measures the probe.
   */
  envelopeHz?: number;
}

const STIMULUS: Record<string, Stimulus> = {
  // A modulator, so the shaping is what moves. Steady is right.
  'fx-01': { hz: 1000 },
  // Iron follows flux, and at 1 kHz the core barely moves whatever the level.
  'dyn-01': { hz: 40 },
  // Levellers, limiters and valves: what they show is what they do over time.
  'dyn-02': { hz: 220, envelopeHz: 1.7 },
  'dyn-03': { hz: 220, envelopeHz: 3.1 },
  'dyn-04': { hz: 220, envelopeHz: 1.3 },
  // An equaliser is not time-varying, but its meters are: an envelope is what
  // puts anything at all on the input and output readouts.
  'dyn-05': { hz: 220, envelopeHz: 2.3 },
  // Grains are spawned against the incoming signal, so the population moves
  // with it.
  'fx-02': { hz: 440, envelopeHz: 0.9 },
};

/**
 * Controls a unit needs off their defaults before its mechanism does anything.
 *
 * The Console EQ is the case that made this necessary and it is not a special
 * case. Its `V27` readout is the EQ section's inductor core, and an inductor
 * carries the *network's* current — with every band at zero the network is out
 * of circuit and the core is correctly still. Measuring a flat equaliser and
 * reporting that nothing moves would be measuring the stimulus again, which is
 * the same error as probing a transformer at a kilohertz.
 *
 * Sent as parameter messages through the port the app uses, not by reaching
 * into the unit: a state a user cannot get the unit into is not a state worth
 * measuring a panel in.
 */
const SETUP: Record<string, { id: number; value: number }[]> = {
  // Peak Reduction defaults to zero, which is a leveller with the cell dark.
  // The panel read exposure 0 and 0.06 dB of gain reduction, and that is the
  // unit behaving correctly under a control nobody had turned.
  'dyn-02': [{ id: OpticalLevellerParam.PeakReduction, value: 0.7 }],
  // The opposite problem: at unity input this limiter sat 17.9 dB into
  // limiting, where the detector is pinned and nothing moves. Backed off so it
  // rides the envelope instead of flattening it — which is where a limiter's
  // mechanism is visible and also where anybody would actually use one.
  'dyn-03': [{ id: FetLimiterParam.Input, value: -16 }],
  // Threshold defaults to its maximum and input to zero, so the valve was
  // barely biased: 0.58 dB of reduction and a bias store that never charged.
  'dyn-04': [
    { id: VariableMuParam.InputA, value: 12 },
    { id: VariableMuParam.InputB, value: 12 },
    { id: VariableMuParam.ThresholdA, value: 3 },
    { id: VariableMuParam.ThresholdB, value: 3 },
  ],
  'dyn-05': [
    { id: ConsoleEqParam.EqIn, value: 1 },
    { id: ConsoleEqParam.LowFrequency, value: 0 },
    { id: ConsoleEqParam.LowAmount, value: 12 },
  ],
};

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
  start,
  paints: () => paints,
  reads: () => reads,
  torn: () => torn,
  lastFrame: () => last,
};
