/**
 * A BaseAudioContext stand-in that records *how* every value was written, not
 * just what it ended up as.
 *
 * `tests/effectCurves.test.ts` already has a recording context, and it answers
 * "is this graph wired". The questions this audit asks are different and need
 * one more thing from the stand-in: an `AudioParam` here distinguishes a
 * scheduled ramp (`setTargetAtTime` and friends) from an outright assignment to
 * `.value`, and every mutable node field (`curve`, `buffer`, `type`, `fftSize`)
 * records that it was replaced. That is what makes "does this control reach the
 * audio at all", "does moving it under automation step or ramp" and "does
 * bypass jump anything" answerable by measurement rather than by reading.
 *
 * It is a simulation of the specification, not the browser. Anything it proves
 * is a fact about the graph this build constructs; it is not a null test.
 */

export interface WriteEvent {
  /** Dotted path, e.g. "gain#3.gain" or "waveshaper#1.curve". */
  path: string;
  /** 'assign' is a jump; every other kind is scheduled. */
  how:
    | 'assign'
    | 'setTarget'
    | 'setValue'
    | 'linearRamp'
    | 'expRamp'
    | 'valueCurve'
    | 'cancel'
    | 'field';
  value: number | string;
  /**
   * True when the write landed the value it already held.
   *
   * Worth carrying because several builders rewrite every field on every
   * update — the analyser inserts rewrite `fftSize` whether or not it moved —
   * and a write that changes nothing cannot click. Only a *changing* jump is a
   * fault, so a test that ignores this would report six of them that are not.
   */
  same: boolean;
}

export interface ProbeContext {
  ctx: BaseAudioContext;
  /** Every write since the log was last cleared. */
  writes: WriteEvent[];
  /** A deterministic snapshot of every node's settled state. */
  snapshot(): string;
  clear(): void;
  connections: { from: string; to: string; output?: number; input?: number }[];
  /**
   * The stand-in nodes of one kind, so a test can set a field the browser owns.
   * `DynamicsCompressorNode.reduction` is the case this exists for: it is
   * read-only and written by the implementation, so the only way to ask what a
   * builder does with it is to supply one.
   */
  nodesOfKind(kind: string): Record<string, unknown>[];
}

function hashNumbers(a: ArrayLike<number>): string {
  // FNV-1a over the bit patterns, so two curves that differ anywhere differ
  // here. A float-by-float comparison would be exact too but is far larger to
  // carry around in a snapshot string.
  let h = 2166136261 >>> 0;
  const view = new Float64Array(1);
  const bytes = new Uint8Array(view.buffer);
  for (let i = 0; i < a.length; i++) {
    view[0] = a[i];
    for (let b = 0; b < 8; b++) {
      h ^= bytes[b];
      h = Math.imul(h, 16777619) >>> 0;
    }
  }
  return `${a.length}:${h.toString(16)}`;
}

export function createProbeContext(sampleRate = 48000): ProbeContext {
  const writes: WriteEvent[] = [];
  const connections: { from: string; to: string; output?: number; input?: number }[] = [];
  const nodes: { name: string; state: Record<string, unknown>; node: Record<string, unknown> }[] =
    [];
  const counters = new Map<string, number>();

  const nameFor = (kind: string): string => {
    const n = (counters.get(kind) ?? 0) + 1;
    counters.set(kind, n);
    return `${kind}#${n}`;
  };

  interface ProbeParam {
    value: number;
    setTargetAtTime(v: number, when: number, tau: number): ProbeParam;
    setValueAtTime(v: number, when: number): ProbeParam;
    linearRampToValueAtTime(v: number, when: number): ProbeParam;
    exponentialRampToValueAtTime(v: number, when: number): ProbeParam;
    setValueCurveAtTime(c: Float32Array, when: number, dur: number): ProbeParam;
    cancelScheduledValues(when: number): ProbeParam;
    /** The value the param is heading for, whichever way it was written. */
    target: number;
  }

  const makeParam = (path: string, initial: number): ProbeParam => {
    let target = initial;
    const record = (how: WriteEvent['how'], v: number): void => {
      const same = Object.is(target, v);
      target = v;
      writes.push({ path, how, value: v, same });
    };
    const p: ProbeParam = {
      get value() {
        return target;
      },
      set value(v: number) {
        record('assign', v);
      },
      get target() {
        return target;
      },
      setTargetAtTime(v) {
        record('setTarget', v);
        return p;
      },
      setValueAtTime(v) {
        record('setValue', v);
        return p;
      },
      linearRampToValueAtTime(v) {
        record('linearRamp', v);
        return p;
      },
      exponentialRampToValueAtTime(v) {
        record('expRamp', v);
        return p;
      },
      setValueCurveAtTime(c) {
        record('valueCurve', c.length > 0 ? c[c.length - 1] : 0);
        return p;
      },
      cancelScheduledValues() {
        // Recorded because it is the one call that separates a voice being cut
        // short from a voice being released: `Voice.stopNow` cancels first and
        // `Voice.release` does not, and both then ramp the same gain to zero.
        writes.push({ path, how: 'cancel', value: target, same: false });
        return p;
      },
    };
    return p;
  };

  const isParam = (x: unknown): x is ProbeParam =>
    typeof x === 'object' && x !== null && typeof (x as ProbeParam).setTargetAtTime === 'function';

  interface ProbeNode {
    kind: string;
    name: string;
    connect(dest: unknown, output?: number, input?: number): unknown;
    disconnect(): void;
    [key: string]: unknown;
  }

  const makeNode = (
    kind: string,
    params: Record<string, number> = {},
    fields: Record<string, unknown> = {},
    extra: Record<string, unknown> = {},
  ): ProbeNode => {
    const name = nameFor(kind);
    const state: Record<string, unknown> = {};
    const self = { kind, name } as ProbeNode;
    for (const [key, initial] of Object.entries(params)) {
      const p = makeParam(`${name}.${key}`, initial);
      Object.defineProperty(self, key, { get: () => p, enumerable: true });
      state[key] = p;
    }
    for (const [key, initial] of Object.entries(fields)) {
      let held = initial;
      state[key] = held;
      Object.defineProperty(self, key, {
        get: () => held,
        set: (v: unknown) => {
          const describe = (x: unknown): number | string =>
            x instanceof Float32Array
              ? hashNumbers(x)
              : typeof x === 'number' || typeof x === 'string'
                ? x
                : x === null || x === undefined
                  ? 'null'
                  : describeBuffer(x);
          const was = describe(held);
          const now = describe(v);
          held = v;
          state[key] = v;
          writes.push({ path: `${name}.${key}`, how: 'field', value: now, same: was === now });
        },
        enumerable: true,
      });
    }
    Object.assign(self, extra);
    self.connect = (dest: unknown, output?: number, input?: number) => {
      const to = isParam(dest)
        ? // A parameter connection is named by the parameter it lands on, which
          // is what makes a modulation route visible in the connection list.
          (paramNames.get(dest as ProbeParam) ?? 'param?')
        : ((dest as ProbeNode)?.name ?? 'unknown');
      connections.push({ from: name, to, output, input });
      return isParam(dest) ? undefined : dest;
    };
    self.disconnect = () => {};
    for (const [key, v] of Object.entries(state)) {
      if (isParam(v)) paramNames.set(v, `${name}.${key}`);
    }
    nodes.push({ name, state, node: self as unknown as Record<string, unknown> });
    return self;
  };

  const paramNames = new Map<ProbeParam, string>();

  function describeBuffer(v: unknown): string {
    const b = v as { numberOfChannels?: number; length?: number; getChannelData?: unknown };
    if (typeof b?.length === 'number' && typeof b.getChannelData === 'function') {
      const data = (b as { getChannelData(i: number): Float32Array }).getChannelData(0);
      return `buffer(${b.numberOfChannels ?? 1}x${b.length}) ${hashNumbers(data)}`;
    }
    return 'object';
  }

  const source = (
    kind: string,
    params: Record<string, number> = {},
    fields: Record<string, unknown> = {},
    extra: Record<string, unknown> = {},
  ): ProbeNode =>
    makeNode(kind, params, fields, {
      ...extra,
      start(when?: number) {
        const self = this as ProbeNode;
        writes.push({ path: `${self.name}.start`, how: 'field', value: when ?? 0, same: false });
        self.startedAt = when ?? 0;
      },
      stop(when?: number) {
        (this as ProbeNode).stoppedAt = when ?? 0;
      },
    });

  const ctx = {
    sampleRate,
    currentTime: 0,
    destination: undefined,
    createGain: () =>
      makeNode(
        'gain',
        { gain: 1 },
        {},
        { channelCount: 2, channelCountMode: 'max', channelInterpretation: 'speakers' },
      ),
    createBiquadFilter: () =>
      makeNode('biquad', { frequency: 350, Q: 1, gain: 0, detune: 0 }, { type: 'lowpass' }),
    createWaveShaper: () => makeNode('waveshaper', {}, { curve: null, oversample: 'none' }),
    createDelay: (max?: number) => makeNode('delay', { delayTime: 0 }, {}, { maxDelayTime: max }),
    createConvolver: () => makeNode('convolver', {}, { buffer: null, normalize: true }),
    createDynamicsCompressor: () =>
      makeNode(
        'compressor',
        { threshold: -24, knee: 30, ratio: 12, attack: 0.003, release: 0.25 },
        {},
        { reduction: 0 },
      ),
    createChannelSplitter: () => makeNode('splitter'),
    createChannelMerger: () => makeNode('merger'),
    createStereoPanner: () => makeNode('panner', { pan: 0 }),
    createAnalyser: () =>
      makeNode(
        'analyser',
        {},
        { fftSize: 2048, smoothingTimeConstant: 0.8 },
        {
          getFloatTimeDomainData: (b: Float32Array) => b.fill(0),
          getFloatFrequencyData: (b: Float32Array) => b.fill(-140),
        },
      ),
    createOscillator: () => {
      const osc = source('oscillator', { frequency: 440, detune: 0 }, { type: 'sine' }, {});
      osc.setPeriodicWave = (w: unknown) => {
        osc.wave = w;
        writes.push({
          path: `${osc.name}.wave`,
          how: 'field',
          value: hashNumbers((w as { real: Float32Array }).real),
          same: false,
        });
      };
      return osc;
    },
    createConstantSource: () => source('constant', { offset: 1 }),
    createBufferSource: () =>
      source(
        'bufferSource',
        { playbackRate: 1, detune: 0 },
        { buffer: null, loop: false, loopStart: 0, loopEnd: 0 },
      ),
    createPeriodicWave: (real: Float32Array, imag: Float32Array) => ({ real, imag }),
    createBuffer: (channels: number, length: number, rate?: number) => {
      const data = Array.from({ length: channels }, () => new Float32Array(length));
      return {
        length,
        numberOfChannels: channels,
        sampleRate: rate ?? sampleRate,
        duration: length / (rate ?? sampleRate),
        getChannelData: (i: number) => data[i],
        copyToChannel: (src: Float32Array, i: number) => data[i].set(src.subarray(0, length)),
      };
    },
  };

  const snapshot = (): string =>
    nodes
      .map((n) => {
        const fields = Object.entries(n.state)
          .map(([k, v]) => {
            if (isParam(v)) return `${k}=${fmt((v as ProbeParam).target)}`;
            if (v instanceof Float32Array) return `${k}=${hashNumbers(v)}`;
            if (v && typeof v === 'object') return `${k}=${describeBuffer(v)}`;
            return `${k}=${String(v)}`;
          })
          .sort()
          .join(',');
        return `${n.name}{${fields}}`;
      })
      .join('|');

  return {
    ctx: ctx as unknown as BaseAudioContext,
    writes,
    connections,
    snapshot,
    nodesOfKind: (kind: string) =>
      nodes.filter((n) => n.name.startsWith(`${kind}#`)).map((n) => n.node),
    clear: () => {
      writes.length = 0;
    },
  };
}

/** Fixed precision, so a snapshot diff is a real difference and not a rounding. */
function fmt(v: number): string {
  if (!Number.isFinite(v)) return String(v);
  return v.toPrecision(12);
}
