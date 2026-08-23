/**
 * Motion Wave — what this host can actually do, probed rather than assumed.
 *
 * ADR-0005 is the reason this file exists. Four of the five shipping targets
 * cannot be compiled on the build host and no audio device can be opened at
 * all, so a large part of the Definition of Done cannot run here and will not
 * run here for as long as that is true. The wrong response is to relax the
 * checks until they pass on what we have; the right one is to say, per check,
 * which capability is missing and what would supply it.
 *
 * Every capability below is *probed*, not declared. A table of hard-coded
 * answers is a table that goes stale the day somebody installs Emscripten, and
 * the first thing it would do is keep reporting BLOCKED for a gate that had
 * quietly become runnable.
 */

export type Capability =
  /** The shared C++ core, compiled to WebAssembly and loaded. */
  | 'wasmCore'
  /** A Web Audio context can be constructed. */
  | 'audioContext'
  /** An output device can be opened, so xruns and round-trip latency exist. */
  | 'audioDevice'
  /** A thread with real-time priority — an AudioWorklet is the closest here. */
  | 'realtimeThread'
  /** A display refresh clock, so frame pacing can be measured. */
  | 'displayRefresh'
  /** An engine that computes geometry, so a breakpoint can be observed. */
  | 'layoutEngine'
  /** A phone, tablet or desktop machine to run on. */
  | 'physicalDevice'
  /** A screen reader that can be driven and observed. */
  | 'assistiveTech';

/** What would unblock each capability. Taken from ADR-0005's table verbatim. */
export const UNBLOCKED_BY: Readonly<Record<Capability, string>> = {
  wasmCore: 'Emscripten on the build host, to compile motionwave/core to WebAssembly',
  audioContext: 'a browser or a host that provides Web Audio',
  audioDevice: 'ALSA/JACK/PortAudio headers on this host, plus a sound device',
  realtimeThread: 'an audio callback thread — an AudioWorklet, or a native device callback',
  displayRefresh: 'a display and a requestAnimationFrame clock',
  layoutEngine: 'a browser that computes layout; jsdom reports every box as zero',
  physicalDevice: 'a physical phone, tablet, Mac or Windows machine',
  assistiveTech: 'a device running VoiceOver or TalkBack',
};

/** The subset of globals the probes look at, so they can be faked in a test. */
export interface ProbeEnvironment {
  readonly WebAssembly?: unknown;
  readonly AudioContext?: unknown;
  readonly requestAnimationFrame?: unknown;
  readonly document?: {
    createElement(tag: string): {
      style: Record<string, string>;
      getBoundingClientRect(): { width: number };
      remove(): void;
    };
    body?: { appendChild(node: unknown): void };
  };
}

export class HostCapabilities {
  private readonly present: ReadonlySet<Capability>;

  constructor(present: Iterable<Capability>) {
    this.present = new Set(present);
  }

  has(capability: Capability): boolean {
    return this.present.has(capability);
  }

  /** The BLOCKED reason for a capability, naming what would supply it. */
  reasonFor(capability: Capability): string {
    return `no ${capability} — needs ${UNBLOCKED_BY[capability]}`;
  }

  /** The first missing capability from a list, or null if all are present. */
  firstMissing(required: readonly Capability[]): Capability | null {
    for (const capability of required) {
      if (!this.present.has(capability)) return capability;
    }
    return null;
  }

  list(): Capability[] {
    return [...this.present];
  }
}

/**
 * True when a WASM build of the core has been registered.
 *
 * Registration is explicit rather than sniffed, because `typeof WebAssembly`
 * being defined says the runtime could load a module, not that one exists.
 * Reporting D1–D12 as runnable on a host that has the ability to load a core it
 * does not have is exactly the false green ADR-0005 forbids.
 */
let coreModuleRegistered = false;

export function registerCoreModule(): void {
  coreModuleRegistered = true;
}

export function unregisterCoreModule(): void {
  coreModuleRegistered = false;
}

/**
 * Measures whether the host computes layout.
 *
 * jsdom implements `getBoundingClientRect` and answers zero for everything, so
 * "the method exists" is not the question — a harness that trusted it would
 * report every responsive check as passing against boxes that are all the same
 * size, which is worse than reporting them blocked.
 */
function probeLayout(environment: ProbeEnvironment): boolean {
  const document = environment.document;
  if (document === undefined || document.body === undefined) return false;
  try {
    const probe = document.createElement('div');
    probe.style.width = '100px';
    probe.style.position = 'absolute';
    document.body.appendChild(probe);
    const width = probe.getBoundingClientRect().width;
    probe.remove();
    return width > 0;
  } catch {
    return false;
  }
}

export function probeHost(
  environment: ProbeEnvironment = globalThis as ProbeEnvironment,
): HostCapabilities {
  const present: Capability[] = [];
  if (environment.WebAssembly !== undefined && coreModuleRegistered) present.push('wasmCore');
  if (typeof environment.AudioContext === 'function') present.push('audioContext');
  if (typeof environment.requestAnimationFrame === 'function') present.push('displayRefresh');
  if (probeLayout(environment)) present.push('layoutEngine');
  // `audioDevice`, `realtimeThread`, `physicalDevice` and `assistiveTech` are
  // never probed true from inside a sandboxed runtime. An AudioContext that
  // exists is not a device that opened, and there is no interface that reports
  // "a human has a phone in their hand". They are listed here so the report
  // says which one is missing rather than saying nothing.
  return new HostCapabilities(present);
}
