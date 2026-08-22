/**
 * The async-resource seam.
 *
 * This is the load-bearing part of plugin support, and it is not the plugin
 * loading. `InsertChain.rebuild()`, `buildEffectNode()` and
 * `AudioEngine.syncGraph()` are all synchronous, and `syncGraph` runs on every
 * single project-store change. Instantiating a plugin is `await`. Those two
 * facts cannot both be served by making the graph async — an await mid-build
 * would let a render start before every source was connected, and on the live
 * side it would let two overlapping edits interleave into one graph.
 *
 * So we use the pattern the codebase already established for decoded audio.
 * `exportMix.ts` says it plainly:
 *
 * > Media must already be decoded (`preloadForRender`) because the offline
 * > graph is built synchronously — an await mid-build would let the render
 * > start before every source is connected.
 *
 * A plugin instance is exactly that kind of resource: resolved asynchronously
 * ahead of time, then looked up synchronously during the build. `loadBuffer` /
 * `getBufferSync` in `mediaLibrary.ts` is the shape; `preloadPlugins` /
 * `getPluginSync` here is the same shape for plugins.
 *
 * What that buys, concretely:
 *
 * - `syncGraph` stays synchronous. Non-negotiable — see risk R2.
 * - A plugin that has not resolved yet builds as a unity pass-through, so audio
 *   flows immediately and the plugin appears a moment later. Never a stall,
 *   never a gap.
 * - An offline render has every plugin instantiated, stated and parameterised
 *   *before* `startRendering()`, which is why the bounce matches the monitor.
 * - A plugin that cannot be loaded at all is a **tombstone**: the effect keeps
 *   its place in the chain, its name, its source and every parameter value, and
 *   the user is told. Nothing is destroyed, and if the plugin becomes reachable
 *   later a retry restores it with its saved state.
 *
 * Instances are keyed by context *and* effect id. Per context, because a
 * `WamNode` belongs to the context that made it and an offline render makes a
 * fresh one every time; per effect id, because two instances of the same plugin
 * on two channels are two different plugins with two different settings.
 */
import { diagLog } from '../../state/diagnostics';
import type { Effect, PluginParamCache, PluginRef } from '../../model/types';
import { allEffectChains, resolveSource } from './shelf';
import { loadPluginModule, wamHostFor } from './wamHost';
import type { WamParameterInfo, WebAudioModuleInstance } from './types';

export interface PluginInstanceRecord {
  effectId: string;
  instance: WebAudioModuleInstance;
  /** Parameter values applied and awaited during the preload. */
  appliedParams: Record<string, number>;
  /** Bypass state the instance was built for. */
  bypass: boolean;
  /** Descriptors read back from the live plugin, for the project's param cache. */
  paramCache: PluginParamCache[];
  /** Changes when the instance is replaced, so a chain knows to rebuild. */
  token: string;
}

export interface PluginFailure {
  effectId: string;
  /** What the project says it wanted, so the tombstone can name it. */
  ref: PluginRef;
  reason: string;
}

export interface PreloadReport {
  ready: string[];
  failed: PluginFailure[];
}

interface ContextPool {
  ready: Map<string, PluginInstanceRecord>;
  failed: Map<string, PluginFailure>;
  inflight: Map<string, Promise<void>>;
}

const pools = new WeakMap<BaseAudioContext, ContextPool>();
const resolveListeners = new Set<() => void>();

/** Token a chain uses to notice a plugin arriving, failing or being replaced. */
const PENDING = 'pending';
const FAILED = 'failed';
const NO_PLUGIN = 'none';

function poolFor(ctx: BaseAudioContext): ContextPool {
  let p = pools.get(ctx);
  if (!p) {
    p = { ready: new Map(), failed: new Map(), inflight: new Map() };
    pools.set(ctx, p);
  }
  return p;
}

/** Every `'wam'` effect in a project, wherever its chain lives. */
export function pluginEffects(project: Parameters<typeof allEffectChains>[0]): Effect[] {
  const out: Effect[] = [];
  for (const chain of allEffectChains(project)) {
    for (const e of chain) if (e.kind === 'wam') out.push(e);
  }
  return out;
}

/**
 * Synchronous lookup, used while the graph is being built. Never loads.
 *
 * This is `getBufferSync` for plugins, and it has the same contract: it answers
 * with what is already resolved or it answers with nothing, and it never awaits.
 */
export function getPluginSync(
  ctx: BaseAudioContext,
  effectId: string,
): PluginInstanceRecord | null {
  return pools.get(ctx)?.ready.get(effectId) ?? null;
}

/** Why a plugin is not in the graph, for the tombstone strip to show. */
export function getPluginFailure(ctx: BaseAudioContext, effectId: string): PluginFailure | null {
  return pools.get(ctx)?.failed.get(effectId) ?? null;
}

/**
 * The chain's shape signature contribution for one effect.
 *
 * `InsertChain.sync` rebuilds when the shape changes, and its signature is
 * `id:kind` — which never changes when a plugin resolves, so without this the
 * pass-through placeholder would stay in the graph forever. Folding the pool's
 * token into the signature makes "a plugin landed" a shape change, which is
 * exactly what it is.
 */
export function pluginToken(ctx: BaseAudioContext, effect: Effect): string {
  if (effect.kind !== 'wam') return '';
  if (!effect.plugin) return NO_PLUGIN;
  const pool = pools.get(ctx);
  if (!pool) return PENDING;
  const ready = pool.ready.get(effect.id);
  if (ready) return ready.token;
  return pool.failed.has(effect.id) ? FAILED : PENDING;
}

/**
 * Called when a plugin resolves. The engine re-runs `syncGraph` from here, which
 * is how a pass-through placeholder becomes the real plugin without anything in
 * the graph path having awaited.
 */
export function onPluginsResolved(fn: () => void): () => void {
  resolveListeners.add(fn);
  return () => resolveListeners.delete(fn);
}

function notifyResolved(): void {
  for (const fn of [...resolveListeners]) {
    try {
      fn();
    } catch (e) {
      diagLog('error', `Plugin re-sync listener threw: ${e instanceof Error ? e.message : e}`);
    }
  }
}

/**
 * Import every plugin module a project references, without instantiating any.
 *
 * A plugin instance belongs to one context, so nothing instantiated here would
 * be usable by a render on its own fresh `OfflineAudioContext`. The ES module
 * behind it is not context-bound, though, and importing it is the slow half —
 * a network fetch and a parse. Doing that before the render context exists is
 * what keeps export start-up from growing linearly with plugin count.
 *
 * Failures are swallowed: this is a warm-up, and the real attempt (with the
 * real error message and the real tombstone) happens in `preloadPlugins`.
 */
export async function warmPluginModules(
  project: Parameters<typeof allEffectChains>[0],
): Promise<void> {
  const sources = new Set<string>();
  for (const e of pluginEffects(project)) if (e.plugin) sources.add(e.plugin.source);
  await Promise.all(
    [...sources].map(async (source) => {
      const resolved = resolveSource(source);
      if (resolved.url === null) return;
      await loadPluginModule(resolved.url).catch(() => {
        /* reported properly when the render actually asks for it */
      });
    }),
  );
}

/**
 * Instantiate every plugin a project needs on a given context.
 *
 * Awaited before the graph is built — from `preloadForRender` for a bounce, and
 * off the project subscription for live playback. Idempotent: an effect that is
 * already resolved on this context is skipped, so calling it on every project
 * change costs a map lookup per plugin.
 *
 * Failures are recorded, not thrown. A project with an unloadable plugin still
 * opens, still plays and still bounces — minus that plugin, and saying so.
 */
export async function preloadPlugins(
  project: Parameters<typeof allEffectChains>[0],
  ctx: BaseAudioContext,
): Promise<PreloadReport> {
  const effects = pluginEffects(project);
  const pool = poolFor(ctx);

  // Effects that have gone from the project release their instances; a plugin
  // is an AudioWorklet processor and an unreferenced one keeps running.
  const live = new Set(effects.map((e) => e.id));
  for (const [id, rec] of pool.ready) {
    if (live.has(id)) continue;
    disposeRecord(rec);
    pool.ready.delete(id);
  }
  for (const id of [...pool.failed.keys()]) if (!live.has(id)) pool.failed.delete(id);

  if (effects.length === 0) return { ready: [], failed: [] };

  const work: Promise<void>[] = [];
  for (const effect of effects) {
    if (pool.ready.has(effect.id) || pool.failed.has(effect.id)) continue;
    const inflight = pool.inflight.get(effect.id);
    if (inflight) {
      work.push(inflight);
      continue;
    }
    const p = instantiate(ctx, pool, effect).finally(() => pool.inflight.delete(effect.id));
    pool.inflight.set(effect.id, p);
    work.push(p);
  }
  const hadWork = work.length > 0;
  await Promise.all(work);

  const report: PreloadReport = {
    ready: effects.filter((e) => pool.ready.has(e.id)).map((e) => e.id),
    failed: effects.map((e) => pool.failed.get(e.id)).filter((f): f is PluginFailure => !!f),
  };
  // Only wake the graph when something actually changed, or a subscription that
  // calls this on every edit would re-sync the graph on every edit.
  if (hadWork) notifyResolved();
  return report;
}

async function instantiate(
  ctx: BaseAudioContext,
  pool: ContextPool,
  effect: Effect,
): Promise<void> {
  const ref = effect.plugin;
  if (!ref) {
    pool.failed.set(effect.id, {
      effectId: effect.id,
      ref: {
        identifier: '',
        source: '',
        name: 'Plugin',
        vendor: '',
        version: '',
      },
      reason: 'This insert says it is a plugin but does not say which one.',
    });
    return;
  }
  const resolved = resolveSource(ref.source);
  if (resolved.url === null) {
    pool.failed.set(effect.id, { effectId: effect.id, ref, reason: resolved.reason });
    return;
  }

  try {
    const [groupId, Ctor] = await Promise.all([wamHostFor(ctx), loadPluginModule(resolved.url)]);
    // The saved state goes in at construction: it is the plugin's own opaque
    // blob and handing it over before the node exists is the only way a plugin
    // that builds its DSP from state comes back the way it was left.
    const instance = await Ctor.createInstance(groupId, ctx, ref.state);
    const node = instance.audioNode;

    // Belt and braces. `createInstance`'s `initialState` is honoured by the SDK
    // base class, but a plugin is free to override `initialize`, and a project
    // silently losing its settings is not a failure we can detect afterwards.
    if (ref.state !== undefined) {
      try {
        await node.setState(ref.state);
      } catch (e) {
        diagLog(
          'warn',
          `Plugin "${ref.name}" refused its saved state: ${e instanceof Error ? e.message : e}`,
        );
      }
    }

    const info = await node
      .getParameterInfo()
      .catch(() => ({}) as Record<string, WamParameterInfo>);
    const paramCache = Object.values(info).map(toParamCache);

    // Everything the render needs is applied and awaited here, before the graph
    // exists. `setParameterValues` is async and an offline context will not wait
    // for it, so a value pushed during the synchronous build could miss the
    // render entirely — which would be a bounce that quietly disagreed with what
    // was monitored, the one failure this whole design exists to prevent.
    const appliedParams = applicableParams(effect.params, info);
    if (Object.keys(appliedParams).length > 0) {
      const values: Record<string, { id: string; value: number; normalized: boolean }> = {};
      for (const [id, value] of Object.entries(appliedParams)) {
        values[id] = { id, value, normalized: false };
      }
      await node.setParameterValues(values).catch((e: unknown) => {
        diagLog(
          'warn',
          `Plugin "${ref.name}" refused some parameter values: ${e instanceof Error ? e.message : e}`,
        );
      });
    }

    pool.ready.set(effect.id, {
      effectId: effect.id,
      instance,
      appliedParams,
      bypass: effect.bypass,
      paramCache,
      token: instance.instanceId,
    });
    pool.failed.delete(effect.id);
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    pool.failed.set(effect.id, { effectId: effect.id, ref, reason });
    diagLog('warn', `Plugin "${ref.name}" could not be loaded: ${reason}`);
  }
}

/**
 * Keep only values the plugin actually has a parameter for.
 *
 * A project saved against v1.3 of a plugin and opened against v1.2 can hold a
 * key the plugin no longer knows. We do not send it — but note that we do *not*
 * delete it from the project either. A plugin updating and renaming a parameter
 * must not silently drop the user's setting; the value stays in `Effect.params`
 * and comes back if they roll the plugin back.
 */
function applicableParams(
  params: Readonly<Record<string, number>>,
  info: Record<string, WamParameterInfo>,
): Record<string, number> {
  const keys = Object.keys(info);
  if (keys.length === 0) return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(params)) {
    if (!Number.isFinite(v) || !(k in info)) continue;
    out[k] = v;
  }
  return out;
}

function toParamCache(p: WamParameterInfo): PluginParamCache {
  return {
    id: p.id,
    label: p.label || p.id,
    type: p.type,
    defaultValue: p.defaultValue,
    minValue: p.minValue,
    maxValue: p.maxValue,
    ...(p.exponent ? { exponent: p.exponent } : {}),
    ...(p.choices?.length ? { choices: [...p.choices] } : {}),
    ...(p.units ? { units: p.units } : {}),
  };
}

function disposeRecord(rec: PluginInstanceRecord): void {
  try {
    rec.instance.audioNode.destroy();
  } catch {
    /* a plugin that throws on teardown does not get to keep the pool */
  }
  try {
    rec.instance.audioNode.disconnect();
  } catch {
    /* already gone */
  }
}

/**
 * Forget a failure so the next preload tries again.
 *
 * This is what a "Retry" button on a tombstoned insert calls. It works because
 * we never threw the plugin's state away: the retry re-instantiates from the
 * same `PluginRef` the tombstone has been holding.
 */
export function retryPlugin(ctx: BaseAudioContext, effectId: string): void {
  pools.get(ctx)?.failed.delete(effectId);
}
