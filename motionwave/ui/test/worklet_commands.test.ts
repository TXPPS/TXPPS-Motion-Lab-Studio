/**
 * Commands sent to a processor before its core exists.
 *
 * The worklet loads its WebAssembly in a promise, and the host writes every
 * parameter and every curve the moment the node is constructed. Between those
 * two facts is a window, and until Directive 09 everything that arrived in it
 * was dropped: `port.onmessage` was assigned inside the `.then()`, on the
 * theory that a `MessagePort` queues what is sent before a handler exists. It
 * does — until something starts it, and an AudioWorklet's port is started by
 * the implementation when the processor is constructed.
 *
 * The symptom was a Motion Shaper with three saved curves rendering at
 * 0.096451, which is exactly its undrawn wire, while the same project rendered
 * a moment later gave 0.025869. Intermittent, because on a warm page the core
 * resolves before the host writes and nothing is lost — so it survived
 * twenty-six ledger cells and surfaced only on a cold first render inside a
 * full suite. A saved session opening as a wire, one time in some.
 *
 * The processor is plain JavaScript for the `AudioWorkletGlobalScope`, so it is
 * exercised here with that scope stubbed. That is the only way to make this
 * deterministic: reproducing it in a browser means winning a race on purpose.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

interface Command {
  kind: string;
  [key: string]: unknown;
}

interface Harness {
  post(message: Command): void;
  resolveCore(): Promise<void>;
  applied: Command[];
  posted: Command[];
}

/**
 * Load the worklet with its global scope stubbed, and hand back the seams.
 *
 * The core's resolution is held open deliberately, so a test can post into the
 * window the defect lived in rather than hoping to land in it.
 */
function loadProcessor(): Harness {
  const here = dirname(fileURLToPath(import.meta.url));
  const source = readFileSync(join(here, '..', 'worklet', 'unit_worklet.js'), 'utf8');

  const applied: Command[] = [];
  const posted: Command[] = [];
  let releaseCore: () => void = () => {};
  const coreGate = new Promise<void>((resolve) => {
    releaseCore = resolve;
  });

  // Everything the core exposes that the processor binds at construction. The
  // curve path is the one under test, so it records rather than pretending.
  const core: Record<string, unknown> = {
    HEAPF64: new Float64Array(4096),
    _malloc: () => 8,
    _free: () => {},
    _mw_shaper_set_bpm: () => {},
    _mw_shaper_set_curve: (band: number, _ptr: number, count: number) =>
      applied.push({ kind: 'curve', band, count }),
  };
  for (const name of ['prepare', 'set_param', 'input', 'output', 'process', 'visual', 'set_bypass']) {
    core[`_mw_shaper_${name}`] =
      name === 'set_param'
        ? (id: number, value: number) => applied.push({ kind: 'param', id, value })
        : name === 'set_bypass'
          ? (on: number) => applied.push({ kind: 'bypass', on })
          : () => 0;
  }

  const port = {
    onmessage: null as ((event: { data: Command }) => void) | null,
    postMessage: (message: Command) => posted.push(message),
  };

  class StubProcessor {
    readonly port = port;
  }

  let registered: (new (options: {
    processorOptions: Record<string, unknown>;
  }) => unknown) | null = null;

  const scope = {
    AudioWorkletProcessor: StubProcessor,
    registerProcessor: (_name: string, ctor: typeof registered) => {
      registered = ctor;
    },
    sampleRate: 48000,
    createMotionWaveCore: () => coreGate.then(() => core),
  };

  const run = new Function(...Object.keys(scope), `${source}\nreturn null;`);
  run(...Object.values(scope));
  if (registered === null) throw new Error('the worklet registered no processor');
  new (registered as new (o: { processorOptions: Record<string, unknown> }) => unknown)({
    processorOptions: { unit: 'fx-01' },
  });

  return {
    post: (message) => port.onmessage?.({ data: message }),
    async resolveCore() {
      releaseCore();
      // Two turns: one for the gate, one for the `.then()` that binds the core.
      await Promise.resolve();
      await Promise.resolve();
    },
    applied,
    posted,
  };
}

describe('a processor takes commands from the moment it exists', () => {
  it('accepts messages before its core has loaded', () => {
    const worklet = loadProcessor();
    // The assertion the old arrangement failed: there was no handler at all
    // until the core resolved, so this was a message posted into nothing.
    expect(worklet.post).not.toThrow();
  });

  it('applies a curve written before the core resolved', async () => {
    const worklet = loadProcessor();
    worklet.post({ kind: 'curve', band: 1, nodes: [[0, 1, 0, 0], [0.5, 0, 0, 0]] });
    expect(worklet.applied, 'a curve reached a core that does not exist yet').toEqual([]);

    await worklet.resolveCore();
    expect(worklet.applied).toEqual([{ kind: 'curve', band: 1, count: 2 }]);
  });

  it('applies parameters written before the core resolved, in order', async () => {
    const worklet = loadProcessor();
    worklet.post({ kind: 'param', id: 3, value: 0.25 });
    worklet.post({ kind: 'param', id: 3, value: 0.75 });
    worklet.post({ kind: 'bypass', on: true });
    await worklet.resolveCore();
    // Order matters: two writes to one parameter must not be reordered, or the
    // unit settles on whichever arrived first.
    expect(worklet.applied).toEqual([
      { kind: 'param', id: 3, value: 0.25 },
      { kind: 'param', id: 3, value: 0.75 },
      { kind: 'bypass', on: 1 },
    ]);
  });

  it('applies later commands directly, without growing the queue', async () => {
    const worklet = loadProcessor();
    await worklet.resolveCore();
    worklet.post({ kind: 'param', id: 7, value: 0.5 });
    expect(worklet.applied).toEqual([{ kind: 'param', id: 7, value: 0.5 }]);
  });

  it('announces itself ready only once the core is bound', async () => {
    const worklet = loadProcessor();
    expect(worklet.posted).toEqual([]);
    await worklet.resolveCore();
    expect(worklet.posted).toEqual([{ kind: 'ready' }]);
  });
});
