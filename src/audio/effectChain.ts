/**
 * Insert effect chain.
 *
 * An `EffectNode` presents one uniform face to the mixer graph — an `input` to
 * connect into and an `output` to connect onward — so the channel does not know
 * or care which effect it is holding. Rebuilding the chain only happens when
 * the *shape* changes (effects added, removed or reordered); parameter changes
 * are applied in place with scheduled ramps so nothing clicks.
 *
 * Everything here is built from Web Audio primitives. No external DSP, no
 * impulse-response downloads: the reverb synthesises its own impulse so the app
 * stays fully offline and self-contained.
 */
import { paramOf } from '../model/effects';
import type { Effect } from '../model/types';

const RAMP = 0.02;

export interface EffectNode {
  id: string;
  kind: string;
  input: AudioNode;
  output: AudioNode;
  /** Apply parameter values; called on every project change. */
  update(effect: Effect, bpm: number, bypass: boolean): void;
  dispose(): void;
}

function setParam(p: AudioParam, value: number, ctx: BaseAudioContext): void {
  if (!Number.isFinite(value)) return;
  // setTargetAtTime avoids the zipper noise a direct assignment produces.
  p.setTargetAtTime(value, ctx.currentTime, RAMP);
}

function dbToGain(db: number): number {
  return Math.pow(10, db / 20);
}

/**
 * Wet/dry wrapper shared by delay and reverb. Bypassing forces dry to unity and
 * wet to zero rather than disconnecting, so no reconnect glitch is audible.
 */
class WetDry {
  readonly input: GainNode;
  readonly output: GainNode;
  readonly dry: GainNode;
  readonly wet: GainNode;

  constructor(private ctx: BaseAudioContext) {
    this.input = ctx.createGain();
    this.output = ctx.createGain();
    this.dry = ctx.createGain();
    this.wet = ctx.createGain();
    this.input.connect(this.dry).connect(this.output);
    this.wet.connect(this.output);
  }

  setMix(mix: number, bypass: boolean): void {
    const m = bypass ? 0 : Math.min(1, Math.max(0, mix));
    setParam(this.dry.gain, 1 - m, this.ctx);
    setParam(this.wet.gain, m, this.ctx);
  }

  dispose(): void {
    for (const n of [this.input, this.output, this.dry, this.wet]) {
      try {
        n.disconnect();
      } catch {
        /* already gone */
      }
    }
  }
}

function buildTrim(ctx: BaseAudioContext, effect: Effect): EffectNode {
  const gain = ctx.createGain();
  return {
    id: effect.id,
    kind: effect.kind,
    input: gain,
    output: gain,
    update: (e, _bpm, bypass) => setParam(gain.gain, bypass ? 1 : dbToGain(paramOf(e, 'gainDb')), ctx),
    dispose: () => {
      try {
        gain.disconnect();
      } catch {
        /* already gone */
      }
    },
  };
}

function buildEq3(ctx: BaseAudioContext, effect: Effect): EffectNode {
  const low = ctx.createBiquadFilter();
  low.type = 'lowshelf';
  const mid = ctx.createBiquadFilter();
  mid.type = 'peaking';
  const high = ctx.createBiquadFilter();
  high.type = 'highshelf';
  low.connect(mid).connect(high);

  return {
    id: effect.id,
    kind: effect.kind,
    input: low,
    output: high,
    update: (e, _bpm, bypass) => {
      setParam(low.gain, bypass ? 0 : paramOf(e, 'lowDb'), ctx);
      setParam(low.frequency, paramOf(e, 'lowFreq'), ctx);
      setParam(mid.gain, bypass ? 0 : paramOf(e, 'midDb'), ctx);
      setParam(mid.frequency, paramOf(e, 'midFreq'), ctx);
      setParam(mid.Q, paramOf(e, 'midQ'), ctx);
      setParam(high.gain, bypass ? 0 : paramOf(e, 'highDb'), ctx);
      setParam(high.frequency, paramOf(e, 'highFreq'), ctx);
    },
    dispose: () => {
      for (const n of [low, mid, high]) {
        try {
          n.disconnect();
        } catch {
          /* already gone */
        }
      }
    },
  };
}

function buildCompressor(ctx: BaseAudioContext, effect: Effect): EffectNode {
  const comp = ctx.createDynamicsCompressor();
  const makeup = ctx.createGain();
  comp.connect(makeup);

  return {
    id: effect.id,
    kind: effect.kind,
    input: comp,
    output: makeup,
    update: (e, _bpm, bypass) => {
      // Bypass flattens the curve instead of rerouting: ratio 1 with a 0 dB
      // threshold is mathematically transparent.
      setParam(comp.threshold, bypass ? 0 : paramOf(e, 'threshold'), ctx);
      setParam(comp.ratio, bypass ? 1 : paramOf(e, 'ratio'), ctx);
      setParam(comp.attack, paramOf(e, 'attack') / 1000, ctx);
      setParam(comp.release, paramOf(e, 'release') / 1000, ctx);
      setParam(comp.knee, bypass ? 0 : paramOf(e, 'knee'), ctx);
      setParam(makeup.gain, bypass ? 1 : dbToGain(paramOf(e, 'makeupDb')), ctx);
    },
    dispose: () => {
      for (const n of [comp, makeup]) {
        try {
          n.disconnect();
        } catch {
          /* already gone */
        }
      }
    },
  };
}

const MAX_DELAY_SEC = 4;

function buildDelay(ctx: BaseAudioContext, effect: Effect): EffectNode {
  const wd = new WetDry(ctx);
  const delay = ctx.createDelay(MAX_DELAY_SEC);
  const feedback = ctx.createGain();
  const tone = ctx.createBiquadFilter();
  tone.type = 'lowpass';

  // input → delay → tone → wet, with tone → feedback → delay closing the loop.
  // Filtering inside the loop is what makes repeats darken instead of pile up.
  wd.input.connect(delay);
  delay.connect(tone);
  tone.connect(wd.wet);
  tone.connect(feedback);
  feedback.connect(delay);

  return {
    id: effect.id,
    kind: effect.kind,
    input: wd.input,
    output: wd.output,
    update: (e, bpm, bypass) => {
      const sixteenth = 60 / Math.max(20, bpm) / 4;
      const time = Math.min(MAX_DELAY_SEC, paramOf(e, 'timeSixteenths') * sixteenth);
      setParam(delay.delayTime, time, ctx);
      // Feedback is hard-capped below 1 so the loop can never run away.
      setParam(feedback.gain, bypass ? 0 : Math.min(0.9, Math.max(0, paramOf(e, 'feedback'))), ctx);
      setParam(tone.frequency, paramOf(e, 'tone'), ctx);
      wd.setMix(paramOf(e, 'mix'), bypass);
    },
    dispose: () => {
      for (const n of [delay, feedback, tone]) {
        try {
          n.disconnect();
        } catch {
          /* already gone */
        }
      }
      wd.dispose();
    },
  };
}

/**
 * Synthesised impulse: exponentially decaying noise, decorrelated per channel.
 * Cheap, deterministic, and good enough for a plate-ish tail without shipping
 * an IR file.
 */
function renderImpulse(ctx: BaseAudioContext, seconds: number, damping: number): AudioBuffer {
  const rate = ctx.sampleRate;
  const len = Math.max(1, Math.floor(rate * Math.min(6, Math.max(0.1, seconds))));
  const buf = ctx.createBuffer(2, len, rate);
  // One-pole lowpass coefficient from the damping frequency.
  const coeff = Math.exp((-2 * Math.PI * Math.min(damping, rate / 2)) / rate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      last = white * (1 - coeff) + last * coeff;
      data[i] = last * Math.pow(1 - i / len, 2.2);
    }
  }
  return buf;
}

function buildReverb(ctx: BaseAudioContext, effect: Effect): EffectNode {
  const wd = new WetDry(ctx);
  const pre = ctx.createDelay(0.5);
  const conv = ctx.createConvolver();
  conv.normalize = true;

  let renderedSize = -1;
  let renderedDamping = -1;

  wd.input.connect(pre).connect(conv).connect(wd.wet);

  return {
    id: effect.id,
    kind: effect.kind,
    input: wd.input,
    output: wd.output,
    update: (e, _bpm, bypass) => {
      const size = paramOf(e, 'size');
      const damping = paramOf(e, 'damping');
      // Re-rendering the impulse is expensive, so only do it when the tail
      // actually changed — not on every unrelated project edit.
      if (Math.abs(size - renderedSize) > 0.05 || Math.abs(damping - renderedDamping) > 50) {
        conv.buffer = renderImpulse(ctx, size, damping);
        renderedSize = size;
        renderedDamping = damping;
      }
      setParam(pre.delayTime, paramOf(e, 'predelay') / 1000, ctx);
      wd.setMix(paramOf(e, 'mix'), bypass);
    },
    dispose: () => {
      for (const n of [pre, conv]) {
        try {
          n.disconnect();
        } catch {
          /* already gone */
        }
      }
      wd.dispose();
    },
  };
}

/**
 * Build a node for one effect. An unrecognised kind becomes a unity pass-through
 * so a project written by a newer build still plays, minus that effect.
 */
export function buildEffectNode(ctx: BaseAudioContext, effect: Effect): EffectNode {
  switch (effect.kind) {
    case 'trim':
      return buildTrim(ctx, effect);
    case 'eq3':
      return buildEq3(ctx, effect);
    case 'compressor':
      return buildCompressor(ctx, effect);
    case 'delay':
      return buildDelay(ctx, effect);
    case 'reverb':
      return buildReverb(ctx, effect);
    default: {
      const pass = ctx.createGain();
      return {
        id: effect.id,
        kind: effect.kind,
        input: pass,
        output: pass,
        update: () => {},
        dispose: () => {
          try {
            pass.disconnect();
          } catch {
            /* already gone */
          }
        },
      };
    }
  }
}

/**
 * The insert chain for one channel. Owns its nodes and the connections between
 * `entry` and `exit`, both of which stay stable for the channel's lifetime so
 * the surrounding graph never has to be rewired.
 */
export class InsertChain {
  readonly entry: GainNode;
  readonly exit: GainNode;
  private nodes: EffectNode[] = [];
  /** Shape signature of the current chain — order and kinds. */
  private signature = '';

  constructor(private ctx: BaseAudioContext) {
    this.entry = ctx.createGain();
    this.exit = ctx.createGain();
    this.entry.connect(this.exit);
  }

  get count(): number {
    return this.nodes.length;
  }

  get kinds(): string[] {
    return this.nodes.map((n) => n.kind);
  }

  /**
   * Rebuild only when the chain's shape changed; otherwise update in place.
   * `overrides` carries automated parameter values (by effect id) so a static
   * re-sync never stomps a value the automation engine currently owns.
   */
  sync(effects: Effect[], bpm: number, overrides?: Map<string, Record<string, number>>): void {
    const sig = effects.map((e) => `${e.id}:${e.kind}`).join('|');
    if (sig !== this.signature) {
      this.rebuild(effects);
      this.signature = sig;
    }
    for (let i = 0; i < this.nodes.length; i++) {
      const e = effects[i];
      if (!e) continue;
      const ov = overrides?.get(e.id);
      this.nodes[i].update(ov ? { ...e, params: { ...e.params, ...ov } } : e, bpm, e.bypass);
    }
  }

  /** Apply one effect's parameters in place (automation tick). No-op when the
   *  effect is not in the chain — the next sync rebuilds and catches up. */
  updateOne(effect: Effect, bpm: number, params: Record<string, number>): void {
    const node = this.nodes.find((n) => n.id === effect.id);
    if (!node) return;
    node.update({ ...effect, params: { ...effect.params, ...params } }, bpm, effect.bypass);
  }

  private rebuild(effects: Effect[]): void {
    for (const n of this.nodes) n.dispose();
    this.nodes = [];
    try {
      this.entry.disconnect();
    } catch {
      /* already gone */
    }

    if (effects.length === 0) {
      this.entry.connect(this.exit);
      return;
    }

    this.nodes = effects.map((e) => buildEffectNode(this.ctx, e));
    let cursor: AudioNode = this.entry;
    for (const n of this.nodes) {
      cursor.connect(n.input);
      cursor = n.output;
    }
    cursor.connect(this.exit);
  }

  dispose(): void {
    for (const n of this.nodes) n.dispose();
    this.nodes = [];
    for (const n of [this.entry, this.exit]) {
      try {
        n.disconnect();
      } catch {
        /* already gone */
      }
    }
  }
}
