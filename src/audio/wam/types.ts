/**
 * The slice of the Web Audio Modules 2.0 API we actually use.
 *
 * These are re-declarations, not re-exports, and that is deliberate. The
 * upstream `@webaudiomodules/api` package has been frozen at `2.0.0-alpha.6`
 * since March 2023 and the SDK has not been published since July 2024 — the
 * standard is stable but unmaintained, so the plan (docs/THIRD-PARTY-PLUGINS.md
 * §2.1, risk R3) is to own our copy of the contract rather than depend on
 * upstream ever shipping again. Narrowing it here means a plugin adapter that
 * compiles against exactly the surface we rely on, and one file to change if a
 * future format (WCLAP, say) arrives behind the same seam.
 *
 * Two traps in the upstream API worth recording next to the types:
 *
 * 1. `createInstance` is documented in the api README as
 *    `createInstance(audioCtx, initialState)`. It is not. The real signature —
 *    in `types.d.ts` and in `sdk/src/WebAudioModule.js`, and confirmed in a
 *    real browser — is `createInstance(groupId, audioContext, initialState)`.
 * 2. `getCompensationDelay` is documented "in samples" on `WamNode` and "in
 *    seconds" on `WamProcessor`, and the SDK converts neither. The unit is
 *    whatever the plugin author believed, so we do not use it to shift audio.
 *    It is not in this interface at all until we have a way to measure it.
 *
 * Everything here is typed on `BaseAudioContext`, exactly as upstream is. That
 * is not incidental: it is the property that lets a plugin instantiate inside
 * an `OfflineAudioContext`, which is what keeps the bounce and the monitor
 * path the same renderer.
 */

export type WamParameterType = 'float' | 'int' | 'boolean' | 'choice';

export interface WamParameterInfo {
  readonly id: string;
  readonly label: string;
  readonly type: WamParameterType;
  readonly defaultValue: number;
  readonly minValue: number;
  readonly maxValue: number;
  readonly discreteStep: number;
  readonly exponent: number;
  readonly choices: string[];
  readonly units: string;
}

export interface WamParameterData {
  id: string;
  value: number;
  /** True when `value` is 0..1 rather than in the parameter's own range. */
  normalized: boolean;
}

export interface WamDescriptor {
  identifier: string;
  name: string;
  vendor: string;
  version: string;
  description?: string;
  website?: string;
  isInstrument?: boolean;
  hasAudioInput?: boolean;
  hasAudioOutput?: boolean;
}

/**
 * The plugin's audio node. It *is* an `AudioNode` — `connect`/`disconnect`
 * work exactly as on anything else, which is why the adapter needs no special
 * routing.
 */
export interface WamNode extends AudioNode {
  getParameterInfo(...ids: string[]): Promise<Record<string, WamParameterInfo>>;
  getParameterValues(
    normalized?: boolean,
    ...ids: string[]
  ): Promise<Record<string, WamParameterData>>;
  setParameterValues(values: Record<string, WamParameterData>): Promise<void>;
  /** Opaque and structured-cloneable. We store it; we never read into it. */
  getState(): Promise<unknown>;
  setState(state: unknown): Promise<void>;
  destroy(): void;
}

export interface WebAudioModuleInstance {
  readonly moduleId: string;
  readonly instanceId: string;
  readonly descriptor: WamDescriptor;
  readonly audioNode: WamNode;
  audioContext: BaseAudioContext;
  createGui(): Promise<Element | undefined>;
  destroyGui(gui: Element): void;
}

export interface WebAudioModuleConstructor {
  isWebAudioModuleConstructor?: boolean;
  createInstance(
    groupId: string,
    audioContext: BaseAudioContext,
    initialState?: unknown,
  ): Promise<WebAudioModuleInstance>;
}

/** Shape of the default export of a WAM's entry module. */
export function isWamConstructor(v: unknown): v is WebAudioModuleConstructor {
  if (typeof v !== 'function') return false;
  const c = v as unknown as Partial<WebAudioModuleConstructor>;
  return c.isWebAudioModuleConstructor === true && typeof c.createInstance === 'function';
}
