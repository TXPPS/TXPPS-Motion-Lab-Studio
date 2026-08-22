/**
 * Applying and capturing a device chain.
 *
 * Both racks — the console's and the inspector's — used to apply a chain by
 * looping over its steps and calling the store once per device and once per
 * parameter. A six-device chain therefore arrived as forty-odd separate steps
 * of undo, so taking it back meant pressing undo forty times. Everything here
 * runs inside one gesture, which is what makes "add this chain" one action.
 *
 * The other half is capture: what a saved chain has to hold for the chain to
 * come back the same. For a stock device that is its kind, its parameters and
 * whether it was bypassed. For a third-party plugin it is also *which* plugin
 * and the state it was left in — a saved chain that restored a plugin at its
 * defaults would quietly throw away the reason it was saved.
 */
import type { Effect, EffectKind, PluginRef } from '../model/types';
import { useProjectStore } from '../state/projectStore';
import { allEffectChains } from '../audio/wam/shelf';

/** One device in a chain, as a preset or a saved chain describes it. */
export interface ChainStepLike {
  kind: EffectKind;
  params: Record<string, number>;
  bypass?: boolean;
  /** Only on a `'wam'` step: which plugin, and what state it held. */
  plugin?: PluginRef;
}

/** The mutations applying a chain needs. Both rack hosts satisfy it. */
export interface ChainTarget {
  add: (kind: EffectKind) => string | null;
  setParam: (effectId: string, key: string, value: number) => void;
  setBypass: (effectId: string, bypass: boolean) => void;
}

/**
 * Put a chain on a target, in order.
 *
 * Returns the number of devices that did not fit, so the caller can say so —
 * silently dropping the tail of a chain at the insert limit is how a user ends
 * up mixing through half a chain without knowing.
 */
export function applyChainSteps(target: ChainTarget, steps: readonly ChainStepLike[]): number {
  const store = useProjectStore.getState();
  let dropped = 0;
  store.beginGesture();
  try {
    for (const step of steps) {
      const id = target.add(step.kind);
      if (!id) {
        dropped++;
        continue;
      }
      for (const [key, value] of Object.entries(step.params)) target.setParam(id, key, value);
      if (step.bypass) target.setBypass(id, true);
      if (step.plugin) attachPlugin(id, step.plugin);
    }
  } finally {
    store.endGesture();
  }
  return dropped;
}

/**
 * Write a plugin reference onto a slot that was just added.
 *
 * The rack hosts deliberately expose only the five mutations every chain
 * shares, and a plugin reference is not one of them — `audio/wam/shelf.ts`
 * reaches into the project the same way for the same reason. Not undoable on
 * its own: it is part of the gesture the caller opened, and a `'wam'` slot
 * without its reference is a device with no identity.
 */
function attachPlugin(effectId: string, plugin: PluginRef): void {
  useProjectStore.getState().update(
    (draft) => {
      for (const chain of allEffectChains(draft)) {
        const target = chain.find((e) => e.id === effectId);
        if (target) {
          target.plugin = structuredClone(plugin);
          return;
        }
      }
    },
    { undoable: false },
  );
}

/**
 * What a chain is, as something that can be stored.
 *
 * Bypass travels with it because a chain saved with its de-esser switched off
 * is a chain whose author meant it to arrive that way.
 */
export function captureChain(effects: readonly Effect[]): ChainStepLike[] {
  return effects.map((e) => ({
    kind: e.kind,
    params: { ...e.params },
    ...(e.bypass ? { bypass: true } : {}),
    ...(e.plugin ? { plugin: structuredClone(e.plugin) } : {}),
  }));
}
