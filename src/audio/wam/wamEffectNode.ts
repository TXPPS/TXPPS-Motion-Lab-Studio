/**
 * The `EffectNode` adapter for a Web Audio Modules plugin.
 *
 * `EffectNode` (see `effectChain.ts`) was already very nearly the right shape
 * for this, which is why a plugin is an adapter rather than a rewrite. Three
 * places it does not line up, and what we do about each:
 *
 * **Identity.** `input` and `output` are our own gain nodes, not the plugin's
 * node. The plugin sits between them. That gives the chain a stable pair of
 * endpoints across a plugin reload or a failed load, and it gives us somewhere
 * to put a bypass.
 *
 * **Bypass.** WAM 2.0 has no bypass concept — nothing in the API turns a plugin
 * off. So we carry a dry path around it and crossfade. The gains are set
 * *directly* at construction and only ramped when the state actually changes,
 * which matters more than it sounds: an offline render begins at the same
 * instant its graph does, so a crossfade that starts at zero and climbs would
 * fade the first two seconds of every bounce in. `exportMix.ts` has a pre-roll
 * for exactly this class of problem; not needing it is better than using it.
 *
 * **Parameters.** `setParameterValues` is async, and an offline render will not
 * wait for it — `startRendering()` can begin before the message reaches the
 * processor. So the values a render needs are applied during the *preload*
 * (see `pluginPool.ts`), before the graph is built at all, and `update()` here
 * only pushes what has changed since. On a live context that is a knob moving;
 * on an offline context the diff is empty by construction, which is what makes
 * the bounce match.
 *
 * Two members of `EffectNode` are deliberately absent:
 *
 * - `gainReductionDb` — WAM has no standard gain-reduction report. The meter
 *   shows nothing, which is honest; a fabricated number would not be.
 * - `sidechain` / `setSidechain` — `WamIODescriptor` describes only
 *   audio/MIDI/sysex/OSC/MPE/automation ports. There is no standard key input,
 *   so a plugin cannot be keyed from another channel. That is a real
 *   limitation and it belongs in the docs, not behind a silently dead control.
 */
import type { Effect } from '../../model/types';
import type { EffectNode } from '../effectChain';
import type { WamNode, WebAudioModuleInstance } from './types';

/** Bypass crossfade. Matches `RAMP` in effectChain.ts — a plugin should not
 *  switch in and out any differently from a built-in device. */
const RAMP = 0.02;

export interface WamEffectNodeOptions {
  /** The already-instantiated, already-configured plugin. */
  instance: WebAudioModuleInstance;
  /** Parameter values the pool has *already* applied and awaited. Seeds the
   *  diff so the first `update()` re-sends nothing. */
  appliedParams: Readonly<Record<string, number>>;
  /** Bypass state the pool built for, so the gains start where they belong. */
  initialBypass: boolean;
}

export interface WamEffectNode extends EffectNode {
  readonly instance: WebAudioModuleInstance;
  /** Read the plugin's opaque state back, for saving. */
  readState(): Promise<unknown>;
}

export function buildWamEffectNode(
  ctx: BaseAudioContext,
  effect: Effect,
  opts: WamEffectNodeOptions,
): WamEffectNode {
  const { instance, appliedParams, initialBypass } = opts;
  const node: WamNode = instance.audioNode;

  const input = ctx.createGain();
  const output = ctx.createGain();
  // Wet and dry are summed at `output`, so exactly one of them is open. They
  // are set, not ramped, because at t=0 there is nothing to ramp from.
  const wet = ctx.createGain();
  const dry = ctx.createGain();
  wet.gain.value = initialBypass ? 0 : 1;
  dry.gain.value = initialBypass ? 1 : 0;

  input.connect(dry);
  dry.connect(output);
  input.connect(node);
  node.connect(wet);
  wet.connect(output);

  // A measurement tap, fed from the output in parallel rather than in series,
  // so the spectrum and scope displays keep working across a plugin. Free, and
  // it cannot colour the signal because nothing downstream reads from it.
  const tap = ctx.createAnalyser();
  tap.fftSize = 2048;
  output.connect(tap);

  let lastBypass = initialBypass;
  const lastParams: Record<string, number> = { ...appliedParams };
  let disposed = false;

  /** Fire-and-forget parameter write. A rejection here is the plugin's, not
   *  ours, and it must not take a graph sync down with it. */
  const push = (values: Record<string, { id: string; value: number; normalized: boolean }>) => {
    void node.setParameterValues(values).catch(() => {
      /* the plugin refused a value; it keeps the one it had */
    });
  };

  return {
    id: effect.id,
    kind: effect.kind,
    input,
    output,
    tap,
    instance,

    update(e: Effect, _bpm: number, bypass: boolean): void {
      if (disposed) return;

      if (bypass !== lastBypass) {
        const t = ctx.currentTime;
        wet.gain.setTargetAtTime(bypass ? 0 : 1, t, RAMP);
        dry.gain.setTargetAtTime(bypass ? 1 : 0, t, RAMP);
        lastBypass = bypass;
      }

      // Only what moved. A project-store change fires this on every insert of
      // every channel, and a plugin's parameter write is a postMessage — an
      // undiffed pass would put the whole mixer through the message port on
      // every edit anywhere in the project.
      let changed: Record<string, { id: string; value: number; normalized: boolean }> | null = null;
      for (const [key, value] of Object.entries(e.params)) {
        if (!Number.isFinite(value) || lastParams[key] === value) continue;
        lastParams[key] = value;
        (changed ??= {})[key] = { id: key, value, normalized: false };
      }
      if (changed) push(changed);
    },

    readState(): Promise<unknown> {
      return node.getState();
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      try {
        node.destroy();
      } catch {
        /* a plugin that throws on teardown does not get to keep the graph */
      }
      for (const n of [input, output, wet, dry, tap, node]) {
        try {
          n.disconnect();
        } catch {
          /* already gone */
        }
      }
    },
  };
}
