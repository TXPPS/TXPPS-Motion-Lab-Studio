/**
 * One Motion Wave unit, as an insert the host can put in a chain.
 *
 * This is the whole adapter on the audio side: an `AudioWorkletNode` running
 * the shared C++ core, wrapped so it satisfies `EffectNode` — the same
 * interface the twenty-seven Web Audio devices satisfy, so the insert chain,
 * the delay compensation and the bounce need to know nothing about it.
 *
 * **Parameters are written by id, not by name.** The host's `Effect.params` is
 * keyed by string; a Motion Wave parameter is an integer the C++ dispatch
 * switches on. The mapping is the manifest's, read from the unit's generated
 * declaration, which is the same file the C++ side is generated from — so a
 * parameter cannot exist on one side and not the other, and the key scheme
 * stays `fx:<effectId>:<key>` so automation, macros and control links need to
 * know nothing about any of this.
 */
import { diagLog } from '../../state/diagnostics';
import type { Effect } from '../../model/types';
import type { EffectNode } from '../effectChain';
import { motionWaveUnitFor } from './registry';
import { motionWaveReady, trackPendingNode } from './runtime';

/**
 * The frame a unit publishes, as the host sees it.
 *
 * An array of doubles whose meaning is the unit's own — `bridge.cpp` documents
 * each layout beside the export that fills it. The host does not interpret it;
 * it hands it to the face, which does.
 */
export type UnitFrame = Float64Array;

export interface MotionWaveNode extends EffectNode {
  /** Resolves once the processor has its engine and is rendering for real. */
  ready: Promise<void>;
  /** The most recent published frame, or null before the first arrives. */
  frame(): UnitFrame | null;
  /** Called whenever a frame arrives, for a face that wants to repaint. */
  onFrame(listener: (frame: UnitFrame) => void): () => void;
}

export function buildMotionWaveNode(ctx: BaseAudioContext, effect: Effect): EffectNode {
  const entry = motionWaveUnitFor(effect.kind);
  if (!entry || !motionWaveReady(ctx)) {
    /*
     * A pass-through, and a loud one.
     *
     * The core loads asynchronously and the graph is built synchronously, so
     * there is a window in which a unit is in the project and cannot yet be
     * constructed. The engine rebuilds the graph when the core resolves, which
     * closes that window — but if it never resolves, this is what is left, and
     * Directive 07 §6 forbids a unit that appears in the picker and silently
     * produces nothing. So it passes audio rather than dropping it, and says
     * so once per insert rather than pretending.
     */
    const passThrough = ctx.createGain();
    if (entry) {
      diagLog(
        'warn',
        `${entry.label} is passing audio through unprocessed — the Motion Wave core is not ` +
          'loaded on this context yet.',
      );
    }
    return {
      id: effect.id,
      kind: effect.kind,
      input: passThrough,
      output: passThrough,
      update: () => {},
      dispose: () => passThrough.disconnect(),
    };
  }

  const node = new AudioWorkletNode(ctx, 'motion-wave-unit', {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [2],
    /*
     * No shared buffer. This app is deliberately not cross-origin isolated —
     * `public/_headers` and `src/audio/wam/wamHost.ts` both record why — so
     * `SharedArrayBuffer` does not exist here and the worklet takes its
     * `MessagePort` transport instead. Passing `shared: undefined` is what
     * selects it, and the worklet's own comment explains why that path needs no
     * lock at all.
     */
    processorOptions: { unit: entry.unitId },
  });

  let latest: UnitFrame | null = null;
  const listeners = new Set<(frame: UnitFrame) => void>();

  /*
   * **The processor instantiates its WebAssembly asynchronously, and an offline
   * render does not wait for it.**
   *
   * The core is a promise inside the processor's constructor, so there is a
   * window — a few milliseconds of real time — in which `process` is being
   * called and has no engine to call. On the live context that is invisible:
   * audio keeps flowing and the unit starts working a moment later. On an
   * `OfflineAudioContext` it is fatal, because `startRendering` runs the whole
   * timeline faster than the promise resolves, and a one-second render finishes
   * before the unit exists.
   *
   * Measured before this gate: a bounce through the Motion Shaper came back at
   * an RMS of 0.0001 and, on a second run, at exactly zero. Not a fault in the
   * unit, and not visible anywhere except in the rendered file — which is the
   * worst place for a defect to be, because the file is the artefact someone
   * sends to someone else.
   *
   * So the node publishes a promise that resolves when the processor says it is
   * ready, and anything that renders offline waits for every one of them.
   */
  let markReady: () => void = () => {};
  const ready = new Promise<void>((resolve) => {
    markReady = resolve;
  });
  trackPendingNode(ctx, ready);

  node.port.onmessage = (event: MessageEvent) => {
    const message = event.data as { kind?: string; frame?: Float64Array };
    if (message.kind === 'ready') {
      markReady();
      return;
    }
    if (message.kind === 'frame' && message.frame) {
      latest = message.frame;
      for (const listener of listeners) listener(message.frame);
    }
  };

  /*
   * Every parameter is written once at construction, before any audio flows.
   *
   * A unit starts at its own defaults, and the project's stored values are only
   * a subset — anything the user never touched is absent from `Effect.params`.
   * Writing the full set from the manifest means a reloaded project sounds like
   * the one that was saved even if the unit's defaults change between versions,
   * which is the difference between a project file that records a sound and one
   * that records a diff against whatever the code happened to default to.
   */
  const specs = entry.unit.specs;
  const write = (id: number, value: number) => {
    node.port.postMessage({ kind: 'param', id, value });
  };

  /*
   * Shapes are sent whole, and only when they change.
   *
   * A curve is not a parameter — it has no range and no single value — so it
   * cannot ride the per-parameter path above. It also must not be resent every
   * update: each send allocates on the worklet side to copy the breakpoints
   * into the core's heap, and `update` runs on every project change.
   *
   * A unit that declares no shapes sends none, which is the whole of the host's
   * knowledge about which units have them.
   */
  const shapeCount = entry.unit.shapeCount ?? 0;
  let lastShapes = '';
  const sendShapes = (next: Effect) => {
    if (shapeCount === 0) return;
    const shapes = next.shapes;
    const encoded = JSON.stringify(shapes ?? null);
    if (encoded === lastShapes) return;
    lastShapes = encoded;
    for (let index = 0; index < shapeCount; index++) {
      const nodes = shapes?.[index];
      if (!nodes || nodes.length === 0) continue;
      node.port.postMessage({ kind: 'curve', band: index, nodes });
    }
  };

  let lastBypass: boolean | null = null;
  const node_: MotionWaveNode = {
    id: effect.id,
    kind: effect.kind,
    input: node,
    output: node,
    update(next: Effect, _bpm: number, bypass: boolean) {
      for (const spec of specs) {
        const key = String(spec.id);
        const value = next.params[key];
        write(spec.id, value === undefined ? spec.def : value);
      }
      sendShapes(next);
      if (bypass !== lastBypass) {
        lastBypass = bypass;
        /*
         * Bypass is the unit's own, not a host-side crossfade.
         *
         * Every unit implements it as "still in circuit, still metering, wet
         * bus not summed" — X24 found four units publishing zeros here and it
         * is a graded cell. Routing around the node instead would give the
         * host's answer to a question the unit already answers, and would lose
         * the metering that makes a bypassed insert legible.
         */
        node.port.postMessage({ kind: 'bypass', on: bypass });
      }
    },
    /**
     * What the unit declares, which the host's PDC then compensates.
     *
     * A unit that declares latency and is not compensated puts its track out of
     * time against the rest of the session — the PA-010 defect class. The
     * number is the unit's own declaration rather than a measurement taken
     * here, and `declareLatency` requires it to have been measured or to be
     * zero by construction.
     *
     * **Zero while bypassed**, which every other insert kind has always done
     * and this one did not. `InsertChain` routes a bypassed insert *around* the
     * node — the through leg is muted and the signal takes a wire — so a
     * bypassed unit delays nothing whatever it does internally, and a
     * declaration it is not applying is a compensation applied against nothing.
     * Five units bypassed to silence still moved their track by their own
     * latency, in the direction that makes a bounce *early*. Found by the
     * strong form of the bypass property once the bounce began taking the
     * compensation off the front, which is what made the shift observable at
     * all; before that it was uniform, and a uniform shift is invisible.
     */
    latencySamples() {
      return lastBypass ? 0 : entry.unit.declaredLatency.frames;
    },
    frame: () => latest,
    onFrame(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    ready,
    dispose() {
      /*
       * The port handler goes first, and the listeners with it.
       *
       * A disconnected worklet node stops being pulled but its port stays live,
       * so a frame already in flight would arrive after disposal and be handed
       * to a face that has been unmounted. Clearing the handler is what makes
       * removing an insert leave nothing behind holding a reference to the
       * editor that was open on it.
       */
      node.port.onmessage = null;
      listeners.clear();
      latest = null;
      node.disconnect();
    },
  };

  return node_;
}
