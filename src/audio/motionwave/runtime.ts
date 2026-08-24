/**
 * Loading the Motion Wave core into an AudioContext.
 *
 * Two modules, in order, once per context: the Emscripten core, which puts
 * `createMotionWaveCore` into the worklet's global scope, and the processor,
 * which uses it. They are the same two files the dev harness loads and the same
 * two `scripts/sync-motionwave-assets.mjs` copies into the bundle — ADR-0007's
 * point is that the app must run the artefact the harness proved, not a second
 * one built to resemble it.
 *
 * **Loading is asynchronous and building a graph is not**, which is the whole
 * difficulty. `new AudioWorkletNode` throws if its processor is not registered
 * yet, and the insert chain is rebuilt synchronously from project state. The
 * app already has a seam for this shape of problem — a WAM plugin that resolves
 * after the graph was built without it triggers a rebuild — and this uses the
 * same one rather than inventing a second.
 */
import { diagLog } from '../../state/diagnostics';

/** `public/` is the site root, and the build asserts both of these are in it. */
const CORE_URL = '/worklets/motionwave.worklet.js';
const PROCESSOR_URL = '/worklets/unit_worklet.js';

type Status = 'idle' | 'loading' | 'ready' | 'failed';

const status = new WeakMap<BaseAudioContext, Status>();
const listeners = new Set<() => void>();

/**
 * Notified when a context finishes loading the core.
 *
 * Mirrors `onPluginsResolved`: a chain built before the core arrived has no
 * Motion Wave nodes in it, and something has to ask for it to be built again.
 */
export function onMotionWaveResolved(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Whether a node can be constructed on this context right now. */
export function motionWaveReady(ctx: BaseAudioContext): boolean {
  return status.get(ctx) === 'ready';
}

/** Whether loading has failed, which is a different thing from not yet done. */
export function motionWaveFailed(ctx: BaseAudioContext): boolean {
  return status.get(ctx) === 'failed';
}

/**
 * Every node on a context that has not yet reported itself ready.
 *
 * Keyed by context and never cleared per node, because the only caller that
 * needs it is an offline render, which builds its graph once and then waits
 * once. A live context accumulates resolved promises, which cost nothing and
 * are dropped with the context.
 */
const pending = new WeakMap<BaseAudioContext, Promise<void>[]>();

export function trackPendingNode(ctx: BaseAudioContext, ready: Promise<void>): void {
  const list = pending.get(ctx);
  if (list) list.push(ready);
  else pending.set(ctx, [ready]);
}

/**
 * Wait for every Motion Wave node on a context to have its engine.
 *
 * **An offline render must call this between building its graph and starting,
 * and the reason is measured rather than theoretical.** The processor
 * instantiates its WebAssembly in a promise, and `startRendering` runs a
 * timeline far faster than real time — so a one-second bounce finishes before
 * the unit exists and the file comes back at an RMS of 0.0001, or of exactly
 * zero. Nothing errors, nothing warns, and the rendered file is simply not the
 * mix.
 *
 * Bounded, because a node that never reports ready must not hang a bounce
 * forever: after the timeout the render proceeds and the missing unit shows up
 * as the pass-through it is, which is a bad mix that finishes rather than a
 * good one that does not.
 */
export async function motionWaveNodesReady(
  ctx: BaseAudioContext,
  timeoutMs = 5000,
): Promise<boolean> {
  const list = pending.get(ctx);
  if (!list || list.length === 0) return true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), timeoutMs);
  });
  const outcome = await Promise.race([Promise.all(list).then(() => 'ready' as const), expired]);
  if (timer !== undefined) clearTimeout(timer);
  if (outcome === 'timeout') {
    diagLog(
      'error',
      `${list.length} Motion Wave unit(s) did not report ready within ${timeoutMs} ms. ` +
        'They will render as pass-throughs.',
    );
    return false;
  }
  return true;
}

/**
 * Load the core into a context, at most once.
 *
 * Safe to call repeatedly and from anywhere — the offline renderer needs it on
 * its own context too, and a bounce that quietly dropped every Motion Wave
 * insert would produce a mix that does not match what was heard, which is the
 * failure `exportMix`'s parity tests exist to prevent one layer up.
 */
export async function ensureMotionWaveRuntime(ctx: BaseAudioContext): Promise<boolean> {
  const current = status.get(ctx);
  if (current === 'ready') return true;
  if (current === 'failed') return false;
  if (current === 'loading') {
    // Another caller is already loading it; wait for that one rather than
    // calling `addModule` twice, which throws on the second registration.
    return new Promise<boolean>((resolve) => {
      const stop = onMotionWaveResolved(() => {
        stop();
        resolve(status.get(ctx) === 'ready');
      });
    });
  }

  status.set(ctx, 'loading');
  try {
    // Order matters: the processor's module body calls nothing, but its
    // constructor calls `createMotionWaveCore`, which the first module defines.
    await ctx.audioWorklet.addModule(CORE_URL);
    await ctx.audioWorklet.addModule(PROCESSOR_URL);
    status.set(ctx, 'ready');
    diagLog('info', 'Motion Wave core loaded into the audio thread.');
  } catch (e) {
    status.set(ctx, 'failed');
    /*
     * Loud, and specific about the consequence.
     *
     * A missing core is not a degraded picture like the live waveform's
     * worklet — it is seven inserts that will pass audio through unchanged
     * while appearing to be in circuit. Directive 07 §6 forbids shipping a unit
     * that appears in the picker and produces no sound, so the one thing this
     * must not do is fail quietly.
     */
    diagLog(
      'error',
      `Motion Wave core failed to load: ${String(e)}. Its units will pass audio through ` +
        'unprocessed. Check that /worklets/motionwave.worklet.js is in the bundle — ' +
        '`npm run build` asserts it.',
    );
  }
  for (const listener of listeners) listener();
  return status.get(ctx) === 'ready';
}
