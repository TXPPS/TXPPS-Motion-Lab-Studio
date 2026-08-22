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
 * impulse-response downloads: the reverb and the speaker cabinets synthesise
 * their own impulses so the app stays fully offline and self-contained. The
 * maths that shapes those impulses, the filter coefficients and the transfer
 * curves all live in `dsp/curves.ts`, which knows nothing about Web Audio and
 * is unit-tested on its own.
 */
import {
  ANALYSER_SIZES,
  BASS_MONO_OFF_HZ,
  CRUSH_FACTORS,
  EQ8_BANDS,
  bassMonoActive,
  choiceOf,
  deesserBand,
  dynamicsCurveKey,
  dynamicsGain,
  dynamicsLawOf,
  multibandSplits,
  paramOf,
  shaperCurveKey,
  shaperCurveOf,
} from '../model/effects';
import {
  BUTTERWORTH_Q,
  BUTTERWORTH_Q_DB,
  cabinetByIndex,
  cabinetImpulse,
  clamp,
  clipCurve,
  crusherGroupDelaySamples,
  dbToGain,
  gainToDb,
  identityCurve,
  quantiserCurve,
  qToDb,
  rectifierCurve,
  saturationCurve,
  syncHz,
  syncModifierByIndex,
  syncSeconds,
  timeConstantHz,
  transferCurve,
} from './dsp/curves';
import type { DynamicsLaw } from '../model/effects';
import type { Effect } from '../model/types';
import { getPluginSync, pluginToken } from './wam/pluginPool';
import { buildWamEffectNode } from './wam/wamEffectNode';

const RAMP = 0.02;

/** Rotor speed changes coast rather than jump — that inertia is the sound. */
const ROTOR_RAMP = 1.1;

export interface EffectNode {
  id: string;
  kind: string;
  input: AudioNode;
  output: AudioNode;
  /** Apply parameter values; called on every project change. */
  update(effect: Effect, bpm: number, bypass: boolean): void;
  /**
   * Current gain reduction in dB (0 or negative) for effects that report it.
   * Reading it needs a running context: an AnalyserNode returns silence inside
   * an OfflineAudioContext, so a bounce reports 0 while still processing
   * correctly.
   */
  gainReductionDb?(): number;
  /** Measurement tap for spectrum, scope and tuner displays. Never in series. */
  tap?: AnalyserNode;
  /**
   * Where another channel's signal is connected to key this effect's detector.
   * Only the dynamics processors have one.
   */
  sidechain?: AudioNode;
  /** Switch the detector between the channel's own signal and the key input. */
  setSidechain?(external: boolean): void;
  dispose(): void;
}

function setParam(p: AudioParam, value: number, ctx: BaseAudioContext): void {
  if (!Number.isFinite(value)) return;
  // setTargetAtTime avoids the zipper noise a direct assignment produces.
  p.setTargetAtTime(value, ctx.currentTime, RAMP);
}

function setParamSlow(p: AudioParam, value: number, ctx: BaseAudioContext, seconds: number): void {
  if (!Number.isFinite(value)) return;
  p.setTargetAtTime(value, ctx.currentTime, seconds);
}

function kill(nodes: readonly (AudioNode | undefined)[]): void {
  for (const n of nodes) {
    if (!n) continue;
    try {
      n.disconnect();
    } catch {
      /* already gone */
    }
  }
}

function stopSource(node: AudioScheduledSourceNode): void {
  try {
    node.stop();
  } catch {
    /* never started, or already stopped */
  }
}

function makeGain(ctx: BaseAudioContext, value: number): GainNode {
  const g = ctx.createGain();
  g.gain.value = value;
  return g;
}

function makeShaper(
  ctx: BaseAudioContext,
  curve: Float32Array,
  oversample: OverSampleType = 'none',
): WaveShaperNode {
  const ws = ctx.createWaveShaper();
  ws.curve = curve;
  ws.oversample = oversample;
  return ws;
}

function makeFilter(
  ctx: BaseAudioContext,
  type: BiquadFilterType,
  freq: number,
  q: number,
): BiquadFilterNode {
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  return f;
}

/** One Butterworth section. Pass filters read Q in dB; everything else does not. */
function makeButterworth(
  ctx: BaseAudioContext,
  type: 'lowpass' | 'highpass',
  freq: number,
): BiquadFilterNode {
  return makeFilter(ctx, type, freq, BUTTERWORTH_Q_DB);
}

/**
 * Force a two-channel speaker up-mix. Splitters interpret their input as
 * discrete channels, so without this a mono source would arrive with a silent
 * right channel and every mid/side network downstream would be wrong.
 */
function makeStereoTap(ctx: BaseAudioContext): GainNode {
  const g = ctx.createGain();
  g.channelCount = 2;
  g.channelCountMode = 'explicit';
  g.channelInterpretation = 'speakers';
  return g;
}

/**
 * Wet/dry wrapper shared by most effects. Bypassing forces dry to unity and
 * wet to zero rather than disconnecting, so no reconnect glitch is audible and
 * a bypassed insert is mathematically transparent whatever the wet path does.
 *
 * A Mix control reads as a blend, and it only is one while the two legs stay
 * time-aligned: a wet path that lags the dry one turns every intermediate
 * setting into a comb filter, deepest at 50 %. Where the wet path's delay is
 * exactly known the dry leg is held back to match — pass `maxDryDelaySec` and
 * call `setDryDelay`. Where it is not, the two legs stay as they are and the
 * comb is stated at the parameter rather than compensated by a guess.
 */
class WetDry {
  readonly input: GainNode;
  readonly output: GainNode;
  readonly dry: GainNode;
  readonly wet: GainNode;
  private readonly align: DelayNode | null;

  constructor(
    private ctx: BaseAudioContext,
    maxDryDelaySec = 0,
  ) {
    this.input = ctx.createGain();
    this.output = ctx.createGain();
    this.dry = ctx.createGain();
    this.wet = ctx.createGain();
    this.align = maxDryDelaySec > 0 ? ctx.createDelay(maxDryDelaySec) : null;
    if (this.align) this.input.connect(this.align).connect(this.dry).connect(this.output);
    else this.input.connect(this.dry).connect(this.output);
    this.wet.connect(this.output);
  }

  setMix(mix: number, bypass: boolean): void {
    const m = bypass ? 0 : clamp(mix, 0, 1);
    setParam(this.dry.gain, 1 - m, this.ctx);
    setParam(this.wet.gain, m, this.ctx);
  }

  /**
   * Hold the dry leg back by the wet path's own group delay, in seconds.
   *
   * Ramped rather than jumped, on the same time constant as everything else
   * here, because the delay it is matching is itself crossfaded into place —
   * and because a `DelayNode` whose length is reassigned outright clicks.
   * Bypass must pass 0: a bypassed insert that delayed the signal by half a
   * millisecond would not be the wire it promises to be.
   */
  setDryDelay(seconds: number): void {
    if (this.align) setParam(this.align.delayTime, seconds, this.ctx);
  }

  dispose(): void {
    kill([this.input, this.output, this.dry, this.wet, this.align ?? undefined]);
  }
}

/** Difference the min/max identity stays exact over. */
const COMBINER_HEADROOM = 4;

/**
 * Sample-accurate max() or min() of two control signals, from nothing but a
 * summing node and an absolute-value shaper:
 *
 *   max(a, b) = (a + b + |a − b|) / 2      min(a, b) = (a + b − |a − b|) / 2
 *
 * This is the piece that gives the dynamics processors genuinely asymmetric
 * ballistics without an AudioWorklet: a fast and a slow smoothed copy of the
 * same control signal, combined so that one wins on the way up and the other
 * on the way down.
 */
class Combiner {
  readonly a: GainNode;
  readonly b: GainNode;
  readonly out: GainNode;
  private readonly parts: AudioNode[];

  constructor(ctx: BaseAudioContext, mode: 'max' | 'min') {
    this.a = makeGain(ctx, 1);
    this.b = makeGain(ctx, 1);
    this.out = makeGain(ctx, 1);
    const sum = makeGain(ctx, 0.5);
    // A WaveShaper holds its end value for anything outside -1…+1, so a raw
    // |a - b| silently saturates and the identity above stops being true past
    // a difference of one. Dividing into the shaper and multiplying back out
    // costs nothing — |x| is piecewise linear and the curve has a point at
    // exactly zero, so interpolation is exact at any scale — and buys the
    // headroom for nothing here to be quietly wrong.
    const diff = makeGain(ctx, 1 / COMBINER_HEADROOM);
    const negate = makeGain(ctx, -1);
    const abs = makeShaper(ctx, rectifierCurve());
    const half = makeGain(ctx, (mode === 'max' ? 0.5 : -0.5) * COMBINER_HEADROOM);

    this.a.connect(sum);
    this.b.connect(sum);
    this.a.connect(diff);
    this.b.connect(negate).connect(diff);
    diff.connect(abs).connect(half);
    sum.connect(this.out);
    half.connect(this.out);
    this.parts = [this.a, this.b, this.out, sum, diff, negate, abs, half];
  }

  dispose(): void {
    kill(this.parts);
  }
}

/**
 * How far above full scale an envelope detector can still measure, as a factor.
 *
 * The rectifier in front of every detector here is a WaveShaper, and a
 * WaveShaper clamps its input to -1…+1: a plain |x| reads 1.0 for an input of
 * 1.0 and 1.0 again for an input of 4.0, so above full scale the detector
 * simply stops hearing the level rise and the processor stops responding to
 * it. That is not a corner case — `buildLimiter` puts up to +24 dB of drive in
 * front of its VCA, and it went unnoticed only because the brickwall clipper
 * downstream tidied up the overshoot the detector had missed. Sixteen is that
 * whole drive range on top of an already full-scale signal.
 *
 * It costs nothing to buy. The scale into the shaper rides on the two key
 * gains that were already there, the scale back out is folded into the curve
 * itself, and |x| is two straight lines meeting at a point the curve holds
 * exactly, so the widened rectifier is still exact for ordinary levels.
 *
 * What this fixes is the *reading*: the detector no longer under-reports a hot
 * signal as full scale. How much of that reading a processor's gain actually
 * follows is a separate decision, because it costs curve resolution to follow
 * it — that decision is `ControlVca`'s `envelopeTop`, and this constant is the
 * widest a processor may set it to.
 */
export const DETECTOR_HEADROOM = 16;

/** An open key path: unity, pre-scaled into the rectifier's headroom. */
const KEY_OPEN = 1 / DETECTOR_HEADROOM;

/**
 * How far above its threshold an expander's transfer curve is still sampled,
 * as a factor. Six decibels of unity above the turn, which is enough for the
 * corner itself to land well inside the curve rather than on its last point.
 */
const EXPANDER_CURVE_TOP = 2;

/**
 * The floor for a sampled envelope range, so a nonsense threshold cannot
 * divide the rectifier's scale by zero. Well below the −80 dB the gate's own
 * parameter stops at.
 */
const MIN_ENVELOPE_TOP = 1e-5;

/**
 * The envelope range a law's transfer curve is worth spending its points on.
 *
 * A WaveShaper is indexed linearly in amplitude while every one of these laws
 * is written in decibels, so resolution in dB collapses as the level falls: at
 * the default 2048 points the smallest envelope any curve entry stands for is
 * −66.2 dBFS, and around −45 dBFS consecutive entries are 1.4 dB apart. A
 * compressor does not care, because it works near full scale where the points
 * are dense. An expander only ever works below its threshold, and the default
 * gate — threshold −45 dB, 8:1, 45 dB of range — had its entire law described
 * by twelve curve points: at −48 dBFS it delivered 18.73 dB of attenuation
 * where its face plots 21.00, at −51.4 dBFS it was out by 6.4 dB, and a gate
 * set below −66.2 dBFS had *no* entry under its threshold at all and did
 * nothing whatsoever while the face drew a working expander.
 *
 * Narrowing the sampled range is what fixes that, and it is free rather than a
 * trade: above its threshold an expander is exactly unity, and a WaveShaper
 * holds its last value for anything past the end of the curve — so a curve that
 * stops six decibels above the threshold answers every louder level with the
 * same unity it would have stored there anyway. All 2048 points land where the
 * law bends. The worst disagreement with the drawn curve over the plotted
 * −60…0 dBFS axis falls from 57.5 dB to 0.29 dB, and the −48 dBFS case above
 * becomes exact.
 */
function envelopeTopFor(law: DynamicsLaw, limit: number): number {
  if (law.law !== 'expand') return limit;
  return clamp(EXPANDER_CURVE_TOP * dbToGain(law.thresholdDb), MIN_ENVELOPE_TOP, limit);
}

const MAX_LOOKAHEAD_SEC = 0.02;
const MAX_HOLD_SEC = 0.6;
/** Critically damped smoothing: an envelope follower must not overshoot. */
const SMOOTHING_Q_DB = qToDb(0.5);

/** Web Audio's render quantum, fixed at 128 frames by the specification. */
const RENDER_QUANTUM = 128;

/**
 * The lowest corner a `BiquadFilterNode` can be trusted to smooth with.
 *
 * A lowpass biquad is the obvious envelope smoother, and the corner an
 * envelope wants is sub-Hz — a 180 ms release is 0.9 Hz. At 44.1 kHz that puts
 * both poles so close to z = 1 that the coefficients lose their precision:
 * measured in Chrome, a 0.9 Hz lowpass fed a constant 1 settles at eleven and
 * is still climbing, 2 Hz settles at 1.73 and 4 Hz at 1.18. Above about 60 Hz
 * the DC gain is inside 0.1% at 44.1 kHz and 0.4% at 96 kHz, which is where
 * the biquads stop and `Smoother`'s own pole takes over.
 */
const MIN_SMOOTHING_HZ = 60;

/**
 * Envelope smoother with a time constant of any length and a DC gain of
 * exactly one.
 *
 * Unity at DC is the property the whole control chain rests on: the transfer
 * curves never return more than 1, so a smoother that cannot hold that promise
 * turns a gate into an amplifier. Two stages, because neither alone can keep
 * it. A feedback loop round a delay — y = (1 - g)·x + g·y[-T] — sums to
 * exactly one at DC whatever g is, and Web Audio pins any delay inside a cycle
 * to one render quantum, so T is known, is the same online and offline, and
 * the pole can be placed from it. But T is 2.9 ms at 44.1 kHz, so left alone
 * the loop walks the gain in audible steps. A biquad in front, held above
 * `MIN_SMOOTHING_HZ` where its arithmetic still holds, carries the first two
 * or three milliseconds and rounds those steps off; the loop carries the rest.
 */
class Smoother {
  /** Feed the control signal here. */
  readonly input: BiquadFilterNode;
  /** The smoothed control signal. */
  readonly output: GainNode;
  private readonly tap: GainNode;
  private readonly delay: DelayNode;
  private readonly feedback: GainNode;
  private readonly period: number;

  constructor(private ctx: BaseAudioContext) {
    this.period = RENDER_QUANTUM / ctx.sampleRate;
    this.input = makeFilter(ctx, 'lowpass', 2000, SMOOTHING_Q_DB);
    this.tap = makeGain(ctx, 1);
    this.output = makeGain(ctx, 1);
    // Room for the render quantum at any rate the app can be asked to render.
    this.delay = ctx.createDelay(MAX_LOOKAHEAD_SEC);
    this.feedback = makeGain(ctx, 0);
    this.input.connect(this.tap).connect(this.output);
    // Leaving delayTime at zero is deliberate: the cycle is what sets it, and
    // one render quantum is exactly the sample period the pole is placed for.
    this.output.connect(this.delay).connect(this.feedback).connect(this.output);
  }

  /** Time to reach 1 - 1/e of a step, in seconds, across both stages. */
  setTimeConstant(seconds: number): void {
    const tau = Math.max(seconds, 0);
    // The biquad takes as much as it can hold accurately and the pole takes
    // what is left, so the two add back up to the time that was asked for.
    const held = Math.min(tau, 1 / (2 * Math.PI * MIN_SMOOTHING_HZ));
    setParam(this.input.frequency, clamp(timeConstantHz(held), MIN_SMOOTHING_HZ, 2000), this.ctx);
    const rest = tau - held;
    const g = rest > 0 ? Math.exp(-this.period / rest) : 0;
    // Ramped as exact complements — `setTargetAtTime` is affine in its target,
    // so the pair still sums to one at every instant of the ramp and moving
    // the ballistics cannot nudge the gain on its way.
    setParam(this.feedback.gain, g, this.ctx);
    setParam(this.tap.gain, 1 - g, this.ctx);
  }

  dispose(): void {
    kill([this.input, this.tap, this.output, this.delay, this.feedback]);
  }
}

/**
 * The core every dynamics processor here is built from: an envelope detector
 * and a static transfer curve driving a gain node at audio rate.
 *
 *   audio    input → lookahead → vca → output
 *   control  input → |x| → detector → transfer curve → hold → ballistics
 *                  → depth ┐
 *                  const 1 → dry ┴→ vca.gain
 *
 * The guarantee this design gives: it is only an audio graph. It renders
 * identically in an OfflineAudioContext, so a bounce and live playback agree
 * sample for sample; it is sample-accurate rather than frame-rate; and it needs
 * no ScriptProcessor, AudioWorklet or engine callback, so it works on any
 * context the app can create.
 *
 * The guarantee it does not give: the detector is a linear filter on a
 * rectified signal, so like an analogue detector it ripples on low-frequency
 * material, and the transfer curve is a WaveShaper — threshold, ratio and range
 * change the curve in one block instead of ramping. Curves are therefore
 * rebuilt only when one of those values actually moves, and the level controls
 * that a musician sweeps live (depth, lookahead, ballistics) are all ramped.
 * The gain-reduction figure is read from an AnalyserNode, which is silent
 * offline; that costs a readout, never the processing.
 */
class ControlVca {
  readonly input: GainNode;
  readonly output: GainNode;
  readonly tap: AnalyserNode;
  private readonly lookahead: DelayNode;
  private readonly vca: GainNode;
  private readonly detector: BiquadFilterNode;
  private readonly shaper: WaveShaperNode;
  private readonly holdDelay: DelayNode;
  private readonly holdMix: Combiner;
  private readonly fast: Smoother;
  private readonly slow: Smoother;
  private readonly ballistics: Combiner;
  private readonly depth: GainNode;
  private readonly dry: GainNode;
  private readonly unity: ConstantSourceNode;
  private readonly rect: WaveShaperNode;
  private readonly probe: Float32Array;
  /**
   * What the detector listens to. By default the channel's own signal; an
   * external key swaps it for another channel's, which is what makes a kick
   * duck a bass rather than the bass ducking itself.
   */
  readonly keyInput: GainNode;
  private readonly internalKey: GainNode;
  private curveKey = '';
  /** The envelope the far end of the transfer curve currently stands for. */
  private envelopeTop: number;

  constructor(
    private ctx: BaseAudioContext,
    law: 'expand' | 'compress',
    /**
     * The loudest envelope this processor's transfer curve may be sampled over,
     * as a linear factor of full scale. Above the sampled range the curve runs
     * out and the gain stops moving, however much louder the detector says the
     * signal got — so the range has to cover every level whose law is not
     * already flat, and every point spent past that is a point not spent where
     * the law bends.
     *
     * One spends the whole curve on levels up to full scale, which is what a
     * compressor wants. A limiter is the opposite case. Its own drive control
     * reaches +24 dB, so a curve stopping at full scale stops asking for
     * reduction exactly where a limiter's work starts: the clipper behind it
     * removes the rest, silently, while the meter reads the VCA and reports the
     * four tenths of a dB the curve managed. Trading resolution below −36 dBFS
     * for that range is free for a limiter, whose law is unity everywhere down
     * there.
     *
     * A gate is the opposite case again, and it is the reason this is a ceiling
     * rather than a fixed value: `envelopeTopFor` narrows the sampled range to
     * just above an expander's threshold, because that is the only place an
     * expander's law does anything at all.
     */
    private readonly topLimit = 1,
  ) {
    this.envelopeTop = topLimit;
    const mode = law === 'expand' ? 'max' : 'min';
    this.input = makeGain(ctx, 1);
    this.output = makeGain(ctx, 1);
    this.lookahead = ctx.createDelay(MAX_LOOKAHEAD_SEC);
    // Intrinsic zero: the control chain supplies the whole gain value.
    this.vca = makeGain(ctx, 0);
    this.input.connect(this.lookahead).connect(this.vca).connect(this.output);

    // The key gains divide by the whole detector headroom on the way in, and
    // the rectifier multiplies back only as far as the curve is not already
    // scaled: a curve sampled over the full headroom is indexed by the divided
    // signal directly, so its rectifier is a plain |x|.
    this.rect = makeShaper(ctx, rectifierCurve(DETECTOR_HEADROOM / this.envelopeTop));
    this.detector = makeFilter(ctx, 'lowpass', 120, SMOOTHING_Q_DB);
    // Fully open until the first update installs the real law.
    this.shaper = makeShaper(ctx, new Float32Array([1, 1]));
    this.holdDelay = ctx.createDelay(MAX_HOLD_SEC);
    this.holdMix = new Combiner(ctx, mode);
    this.fast = new Smoother(ctx);
    this.slow = new Smoother(ctx);
    this.ballistics = new Combiner(ctx, mode);
    this.depth = makeGain(ctx, 1);
    this.dry = makeGain(ctx, 0);
    this.unity = ctx.createConstantSource();
    this.tap = ctx.createAnalyser();
    this.tap.fftSize = 256;
    this.probe = new Float32Array(this.tap.fftSize);

    // Both key paths carry the rectifier's scale-in, so whichever one is open
    // arrives at the shaper divided by the headroom the curve multiplies back.
    this.internalKey = makeGain(ctx, KEY_OPEN);
    this.keyInput = makeGain(ctx, 0);
    this.input.connect(this.internalKey).connect(this.rect);
    this.keyInput.connect(this.rect);
    this.rect.connect(this.detector).connect(this.shaper);
    this.shaper.connect(this.holdMix.a);
    this.shaper.connect(this.holdDelay).connect(this.holdMix.b);
    this.holdMix.out.connect(this.fast.input);
    this.fast.output.connect(this.ballistics.a);
    this.holdMix.out.connect(this.slow.input);
    this.slow.output.connect(this.ballistics.b);
    this.ballistics.out.connect(this.depth);
    this.depth.connect(this.vca.gain);
    this.depth.connect(this.tap);
    this.unity.connect(this.dry).connect(this.vca.gain);
    this.unity.start();
  }

  /** Install a gain law as the transfer curve, but only when its values moved. */
  setLaw(law: DynamicsLaw): void {
    const key = dynamicsCurveKey(law);
    if (key === this.curveKey) return;
    this.curveKey = key;
    this.envelopeTop = envelopeTopFor(law, this.topLimit);
    // Both curves in one block, and in this order. The rectifier's scale and
    // the curve's are two halves of one division — the signal arrives at the
    // shaper as envelope / top and the shaper answers for envelope = index ×
    // top — so a render quantum that saw one without the other would read the
    // law at the wrong level entirely. Assigning both synchronously is what
    // makes them arrive together.
    this.rect.curve = rectifierCurve(DETECTOR_HEADROOM / this.envelopeTop);
    // The shaper is indexed by the envelope divided by the top, so the law has
    // to be asked about the envelope each index stands for rather than about
    // the index. At a top of one that is `dynamicsCurve(law)` point for point
    // — the array the plugin face plots.
    this.shaper.curve = transferCurve((e) => dynamicsGain(law, e * this.envelopeTop));
  }

  setBallistics(attackMs: number, releaseMs: number, holdMs: number): void {
    const attack = Math.max(attackMs, 0.05) / 1000;
    const release = Math.max(releaseMs, 1) / 1000;
    // The detector only has to strip ripple; the timing lives in the ballistics.
    setParam(this.detector.frequency, clamp(timeConstantHz(attack), 25, 400), this.ctx);
    this.fast.setTimeConstant(attack);
    this.slow.setTimeConstant(release);
    setParam(this.holdDelay.delayTime, clamp(holdMs / 1000, 0, MAX_HOLD_SEC), this.ctx);
  }

  /**
   * Cross-fade between the channel's own signal and the external key.
   * Both paths stay connected so the swap cannot click.
   */
  setSidechain(external: boolean): void {
    setParam(this.internalKey.gain, external ? 0 : KEY_OPEN, this.ctx);
    setParam(this.keyInput.gain, external ? KEY_OPEN : 0, this.ctx);
  }

  setLookahead(ms: number): void {
    setParam(this.lookahead.delayTime, clamp(ms / 1000, 0, MAX_LOOKAHEAD_SEC), this.ctx);
  }

  /** Crossfade the whole processor in or out. Bypass is exactly unity gain. */
  setActive(active: boolean): void {
    setParam(this.depth.gain, active ? 1 : 0, this.ctx);
    setParam(this.dry.gain, active ? 0 : 1, this.ctx);
  }

  gainReductionDb(): number {
    this.tap.getFloatTimeDomainData(this.probe);
    let sum = 0;
    for (let i = 0; i < this.probe.length; i++) sum += this.probe[i];
    const mean = sum / this.probe.length;
    if (!(mean > 0)) return 0;
    return clamp(gainToDb(mean), -80, 0);
  }

  dispose(): void {
    stopSource(this.unity);
    this.holdMix.dispose();
    this.ballistics.dispose();
    this.fast.dispose();
    this.slow.dispose();
    kill([
      this.input,
      this.output,
      this.lookahead,
      this.vca,
      this.rect,
      this.detector,
      this.shaper,
      this.holdDelay,
      this.depth,
      this.dry,
      this.unity,
      this.tap,
    ]);
  }
}

/**
 * Where a context's clock sits in the song, so a modulator can be started at
 * the phase the song position implies.
 *
 * Without one, an LFO's phase at a given bar is whatever the wall clock left it
 * at: the oscillators were started the instant the chain was built, which is
 * seconds before playback live and `preRoll` seconds before the delivered audio
 * offline. That made a bounce disagree with what was monitored, and — worse —
 * made a bounce of bars 5-8 disagree with the same bars inside a full-song
 * bounce, because the run-up is the same length whatever range was asked for
 * while the song time at the range start is not.
 *
 * One rule covers both switch positions of Tempo sync: phase advances with
 * *song* time, so a synced modulator completes exactly one cycle per division
 * from the top of the song and is therefore locked to the bar and not only to
 * the rate, and a free-running one is at least reproducible — the same bars
 * bounce to the same samples however the range was cut. Under a tempo map the
 * lock is approximate in the same way the rate is, because both come from the
 * one bpm the chain is handed.
 */
export interface ModulationClock {
  /** Context time the modulators are to start at. */
  startAt: number;
  /** Song time, in seconds, at `startAt`. Negative for a render's run-up. */
  songSec: number;
}

/**
 * The clock a chain uses when nobody supplies one: start now, at phase zero.
 *
 * That is what the live engine has always done, and it is the honest answer for
 * a graph built while the transport is parked — which is when a channel's
 * inserts are usually built, since a chain is rebuilt on a project change and
 * not on play. `renderProject` supplies a real clock because a bounce has an
 * exact one to give. Live, the anchor exists too — `Scheduler` keeps a list of
 * `{ ctx, sec }` pairs, which is precisely this pair under other names — and
 * passing the newest of them into `new InsertChain` is what would bar-lock
 * playback as well.
 */
function clockOf(ctx: BaseAudioContext, clock?: ModulationClock): ModulationClock {
  return clock ?? { startAt: ctx.currentTime, songSec: 0 };
}

/**
 * Where in its cycle a modulator running at `hz` sits at this clock's start,
 * in radians.
 *
 * Reduced to one cycle before it is turned into radians: an hour into a song a
 * 5 Hz modulator is eighteen thousand cycles in, and rotating a fifteenth
 * harmonic by that many turns would spend the mantissa on whole revolutions
 * nobody can hear.
 */
function phaseAt(clock: ModulationClock, hz: number): number {
  const cycles = hz * clock.songSec;
  if (!Number.isFinite(cycles)) return 0;
  return 2 * Math.PI * (cycles - Math.floor(cycles));
}

/**
 * A sine LFO and its exact 90°-shifted twin, from two oscillators fed the same
 * frequency and started at the same instant. Quadrature is what lets a chorus
 * spread two voices, and a rotary put the doppler peak a quarter-turn away from
 * the amplitude peak, without a control-rate delay line.
 *
 * Nothing runs, and no waveform is installed, until `start` is called: the
 * phase a modulator should begin at is not known at construction, because it
 * depends on the rate and the rate arrives with the first `update`.
 */
class QuadratureLfo {
  readonly sine: OscillatorNode;
  readonly cosine: OscillatorNode;
  private started = false;

  constructor(
    private ctx: BaseAudioContext,
    hz: number,
    /** Sine-phase harmonic amplitudes, index 0 unused. A plain sine by default. */
    private readonly series: readonly number[] = [0, 1],
  ) {
    this.sine = ctx.createOscillator();
    this.cosine = ctx.createOscillator();
    this.sine.frequency.value = hz;
    this.cosine.frequency.value = hz;
  }

  /**
   * Begin at `when`, running at `hz`, `phase` radians into the cycle.
   *
   * The phase is baked into the waveform rather than bought by delaying the
   * start, because the two are only equivalent for a modulator whose period
   * fits inside the run-up: an auto-pan at 0.05 Hz has a twenty-second cycle,
   * and holding its start back by up to twenty seconds would leave the front of
   * the bounce unmodulated. Rotating the coefficients costs nothing and works
   * at any rate.
   *
   * The rate is set outright rather than ramped to. `setRate`'s glide exists so
   * a musician sweeping a knob hears no step; applied to the first value it
   * would instead leave every modulator a fraction of a cycle behind where the
   * song says it is, permanently, because phase is the integral of frequency.
   */
  start(when: number, hz: number, phase: number): void {
    if (this.started) return;
    this.started = true;
    this.setWaves(phase);
    this.sine.frequency.value = hz;
    this.cosine.frequency.value = hz;
    this.sine.start(when);
    this.cosine.start(when);
  }

  setRate(hz: number, timeConstant = RAMP): void {
    setParamSlow(this.sine.frequency, hz, this.ctx, timeConstant);
    setParamSlow(this.cosine.frequency, hz, this.ctx, timeConstant);
  }

  /**
   * Hand both oscillators the series shifted so the fundamental starts `phase`
   * radians in. Shifting a waveform in *time* rotates harmonic n by n times the
   * fundamental's rotation, which is what keeps a shape that is not a sine the
   * same shape — and, applied to both oscillators alike, keeps the twin exactly
   * a quarter cycle away whatever the shape is.
   */
  private setWaves(phase: number): void {
    this.sine.setPeriodicWave(this.wave(phase));
    this.cosine.setPeriodicWave(this.wave(phase + Math.PI / 2));
  }

  private wave(phase: number): PeriodicWave {
    const real = new Float32Array(this.series.length);
    const imag = new Float32Array(this.series.length);
    for (let n = 1; n < this.series.length; n++) {
      real[n] = this.series[n] * Math.sin(n * phase);
      imag[n] = this.series[n] * Math.cos(n * phase);
    }
    return this.ctx.createPeriodicWave(real, imag);
  }

  dispose(): void {
    stopSource(this.sine);
    stopSource(this.cosine);
    kill([this.sine, this.cosine]);
  }
}

/**
 * Selectable-shape LFO with a quadrature twin, built as three crossfaded
 * quadrature pairs. Switching shape ramps between whole oscillators instead of
 * reassigning a waveform mid-cycle, which would step the control signal.
 */
class ShapedLfo {
  readonly out0: GainNode;
  readonly out90: GainNode;
  private readonly pairs: QuadratureLfo[];
  private readonly mix0: GainNode[];
  private readonly mix90: GainNode[];

  constructor(
    private ctx: BaseAudioContext,
    hz: number,
  ) {
    this.out0 = makeGain(ctx, 1);
    this.out90 = makeGain(ctx, 1);
    this.pairs = [];
    this.mix0 = [];
    this.mix90 = [];

    // Fourier series, sine phase: a pure tone, an odd 1/n² set and an odd 1/n set.
    const shapes: number[][] = [
      [0, 1],
      harmonics(15, (n) =>
        n % 2 === 1 ? ((8 / (Math.PI * Math.PI)) * (n % 4 === 1 ? 1 : -1)) / (n * n) : 0,
      ),
      harmonics(15, (n) => (n % 2 === 1 ? 4 / (Math.PI * n) : 0)),
    ];

    for (let i = 0; i < shapes.length; i++) {
      const pair = new QuadratureLfo(ctx, hz, shapes[i]);
      const g0 = makeGain(ctx, i === 0 ? 1 : 0);
      const g90 = makeGain(ctx, i === 0 ? 1 : 0);
      pair.sine.connect(g0).connect(this.out0);
      pair.cosine.connect(g90).connect(this.out90);
      this.pairs.push(pair);
      this.mix0.push(g0);
      this.mix90.push(g90);
    }
  }

  /**
   * Start all three shapes together at the same phase, so switching shape
   * mid-song crossfades between waveforms that agree about where in the cycle
   * they are rather than jumping to whatever the silent one had reached.
   */
  start(when: number, hz: number, phase: number): void {
    for (const p of this.pairs) p.start(when, hz, phase);
  }

  setRate(hz: number): void {
    for (const p of this.pairs) p.setRate(hz);
  }

  setShape(index: number): void {
    const chosen = clamp(Math.round(index), 0, this.pairs.length - 1);
    for (let i = 0; i < this.pairs.length; i++) {
      setParam(this.mix0[i].gain, i === chosen ? 1 : 0, this.ctx);
      setParam(this.mix90[i].gain, i === chosen ? 1 : 0, this.ctx);
    }
  }

  dispose(): void {
    for (const p of this.pairs) p.dispose();
    kill([this.out0, this.out90, ...this.mix0, ...this.mix90]);
  }
}

function harmonics(count: number, amplitude: (n: number) => number): number[] {
  const out = [0];
  for (let n = 1; n <= count; n++) out.push(amplitude(n));
  return out;
}

/** A filter that can be taken fully out of circuit with a ramped crossfade. */
class SwitchableFilter {
  readonly input: GainNode;
  readonly output: GainNode;
  readonly filter: BiquadFilterNode;
  private readonly wet: GainNode;
  private readonly dry: GainNode;

  constructor(
    private ctx: BaseAudioContext,
    type: BiquadFilterType,
    freq: number,
    q: number,
  ) {
    this.input = makeGain(ctx, 1);
    this.output = makeGain(ctx, 1);
    this.filter = makeFilter(ctx, type, freq, q);
    this.wet = makeGain(ctx, 0);
    this.dry = makeGain(ctx, 1);
    this.input.connect(this.filter).connect(this.wet).connect(this.output);
    this.input.connect(this.dry).connect(this.output);
  }

  setActive(active: boolean): void {
    setParam(this.wet.gain, active ? 1 : 0, this.ctx);
    setParam(this.dry.gain, active ? 0 : 1, this.ctx);
  }

  dispose(): void {
    kill([this.input, this.output, this.filter, this.wet, this.dry]);
  }
}

// ------------------------------------------------------------------- dynamics

/**
 * Install an effect's own gain law on its VCA.
 *
 * The law comes from the effect spec, which is also where the plugin face
 * reads it, so the curve the shaper is filled with and the curve the face
 * draws are one description evaluated twice rather than two descriptions that
 * have to be kept in step. The two evaluations are sampled over each
 * processor's own envelope range, which is why the VCA is handed the law
 * itself rather than a finished curve. Only the multiband has no law of this
 * shape, and it is not built on a VCA.
 */
function applyLaw(vca: ControlVca, effect: Effect): void {
  const law = dynamicsLawOf(effect);
  if (law) vca.setLaw(law);
}

function buildTrim(ctx: BaseAudioContext, effect: Effect): EffectNode {
  const gain = ctx.createGain();
  return {
    id: effect.id,
    kind: effect.kind,
    input: gain,
    output: gain,
    update: (e, _bpm, bypass) =>
      setParam(gain.gain, bypass ? 1 : dbToGain(paramOf(e, 'gainDb')), ctx),
    dispose: () => kill([gain]),
  };
}

/**
 * Feed-forward compressor on the shared control VCA.
 *
 * A `DynamicsCompressorNode` is fewer nodes and was what this was, but it has
 * no external key input — so a compressor built on one can never be keyed from
 * another channel, which is the single thing a mixer's sidechain menu is for.
 * Sharing the core with the gate, the limiter and the de-esser buys three
 * things at once: the key input, a transfer curve that is literally the
 * function the plugin face plots, and a bypass that crossfades to a dry path
 * instead of flattening a curve in front of the native node's own look-ahead.
 */
function buildCompressor(ctx: BaseAudioContext, effect: Effect): EffectNode {
  const vca = new ControlVca(ctx, 'compress');
  const makeup = makeGain(ctx, 1);
  vca.output.connect(makeup);

  return {
    id: effect.id,
    kind: effect.kind,
    input: vca.input,
    output: makeup,
    tap: vca.tap,
    sidechain: vca.keyInput,
    setSidechain: (external: boolean) => vca.setSidechain(external),
    gainReductionDb: () => vca.gainReductionDb(),
    update: (e, _bpm, bypass) => {
      applyLaw(vca, e);
      vca.setBallistics(paramOf(e, 'attack'), paramOf(e, 'release'), 0);
      vca.setLookahead(0);
      vca.setActive(!bypass);
      // Makeup sits downstream of the VCA, so the VCA's dry path cannot undo
      // it: bypass has to return it to unity itself for the insert to be the
      // exact unity gain the crossfade promises.
      setParam(makeup.gain, bypass ? 1 : dbToGain(paramOf(e, 'makeupDb')), ctx);
    },
    dispose: () => {
      vca.dispose();
      kill([makeup]);
    },
  };
}

function buildGate(ctx: BaseAudioContext, effect: Effect): EffectNode {
  const vca = new ControlVca(ctx, 'expand');
  return {
    id: effect.id,
    kind: effect.kind,
    input: vca.input,
    output: vca.output,
    tap: vca.tap,
    sidechain: vca.keyInput,
    setSidechain: (external: boolean) => vca.setSidechain(external),
    gainReductionDb: () => vca.gainReductionDb(),
    update: (e, _bpm, bypass) => {
      applyLaw(vca, e);
      vca.setBallistics(paramOf(e, 'attack'), paramOf(e, 'release'), paramOf(e, 'hold'));
      vca.setLookahead(0);
      vca.setActive(!bypass);
    },
    dispose: () => vca.dispose(),
  };
}

function buildLimiter(ctx: BaseAudioContext, effect: Effect): EffectNode {
  const drive = makeGain(ctx, 1);
  // The one processor whose curve is sampled over the whole detector range:
  // 24 dB of drive in front of a ceiling at full scale is what this device is
  // for, and a curve stopping at 0 dBFS would hand all of it to the clipper.
  const vca = new ControlVca(ctx, 'compress', DETECTOR_HEADROOM);
  // Scale so the ceiling lands on full scale, clip there, then scale back:
  // the shaper's own input clamping is an exact brickwall inside the rails.
  const preClip = makeGain(ctx, 1);
  const brickwall = makeShaper(ctx, identityCurve(), '4x');
  const postClip = makeGain(ctx, 1);
  // The clipper's own bypass leg. Its curve is the identity, so inside the
  // rails the shaper is transparent — but `oversample: '4x'` switches on the
  // browser's up- and down-sampling filters, which are neither transparent nor
  // latency-free, and a bypassed insert that quietly filters and delays the
  // channel is the comb filter every other insert here crossfades to avoid.
  const clipperDry = makeGain(ctx, 0);
  const output = makeGain(ctx, 1);

  drive.connect(vca.input);
  vca.output.connect(preClip).connect(brickwall).connect(postClip).connect(output);
  vca.output.connect(clipperDry).connect(output);

  return {
    id: effect.id,
    kind: effect.kind,
    input: drive,
    output,
    tap: vca.tap,
    sidechain: vca.keyInput,
    setSidechain: (external: boolean) => vca.setSidechain(external),
    gainReductionDb: () => vca.gainReductionDb(),
    update: (e, _bpm, bypass) => {
      const ceiling = paramOf(e, 'ceiling');
      const ceilingGain = dbToGain(ceiling);
      setParam(drive.gain, bypass ? 1 : dbToGain(paramOf(e, 'drive')), ctx);
      // A high ratio at the ceiling does the work; the clipper only mops up the
      // overshoot a finite ratio always leaves behind. That division of labour
      // holds only as far as the VCA's curve reaches, which is why this one is
      // sampled over the whole detector range. The ratio and knee are
      // `LIMITER_RATIO` and `LIMITER_KNEE_DB`, declared with the effect so the
      // face plots the limiter rather than a straight line.
      applyLaw(vca, e);
      vca.setBallistics(0.2, paramOf(e, 'release'), 0);
      vca.setLookahead(bypass ? 0 : paramOf(e, 'lookahead'));
      vca.setActive(!bypass);
      setParam(preClip.gain, bypass ? 1 : 1 / ceilingGain, ctx);
      // Muting the wet leg is what actually takes the oversampled shaper out
      // of circuit; returning its two scale gains to unity, which is all this
      // used to do, leaves the signal passing through it. The ceiling scale
      // rides on the same gain, so the mute costs no extra node.
      setParam(postClip.gain, bypass ? 0 : ceilingGain, ctx);
      setParam(clipperDry.gain, bypass ? 1 : 0, ctx);
    },
    dispose: () => {
      vca.dispose();
      kill([drive, preClip, brickwall, postClip, clipperDry, output]);
    },
  };
}

/**
 * Three-band Linkwitz-Riley crossover into three compressors.
 *
 * Each split is two cascaded Butterworth sections. An LR4 pair sums to a
 * second-order allpass rather than to unity, so the low band carries a matching
 * allpass at the upper split frequency and the three bands sum flat — proven in
 * `tests/effectCurves.test.ts` against the same coefficient maths the browser
 * uses. Phase is not preserved, which is why bypass crossfades to a dry path
 * rather than relying on neutral compressor settings.
 *
 * The bands stay on `DynamicsCompressorNode` where the single-band compressor
 * no longer does, and deliberately: an `EffectNode` offers one key input, and
 * one external key driving all three detectors at once is not what keying a
 * multiband means. With nothing worth exposing, the trade is only fidelity
 * against weight, and three control VCAs would be some ninety extra nodes on a
 * processor whose home is a bus. All three bands carry the same node latency,
 * so the flat sum above is untouched — but this is the one dynamics processor
 * here that cannot be keyed, and no menu says otherwise.
 */
function buildMultiband(ctx: BaseAudioContext, effect: Effect): EffectNode {
  const wd = new WetDry(ctx);
  const lowA = makeButterworth(ctx, 'lowpass', 220);
  const lowB = makeButterworth(ctx, 'lowpass', 220);
  const highA = makeButterworth(ctx, 'highpass', 220);
  const highB = makeButterworth(ctx, 'highpass', 220);
  const midA = makeButterworth(ctx, 'lowpass', 3200);
  const midB = makeButterworth(ctx, 'lowpass', 3200);
  const topA = makeButterworth(ctx, 'highpass', 3200);
  const topB = makeButterworth(ctx, 'highpass', 3200);
  const phaseMatch = makeFilter(ctx, 'allpass', 3200, BUTTERWORTH_Q);

  const bands = (['low', 'mid', 'high'] as const).map((name) => ({
    name,
    comp: ctx.createDynamicsCompressor(),
    makeup: makeGain(ctx, 1),
  }));

  wd.input.connect(lowA).connect(lowB).connect(phaseMatch).connect(bands[0].comp);
  wd.input.connect(highA).connect(highB);
  highB.connect(midA).connect(midB).connect(bands[1].comp);
  highB.connect(topA).connect(topB).connect(bands[2].comp);
  for (const b of bands) b.comp.connect(b.makeup).connect(wd.wet);

  return {
    id: effect.id,
    kind: effect.kind,
    input: wd.input,
    output: wd.output,
    gainReductionDb: () => Math.min(...bands.map((b) => b.comp.reduction)),
    update: (e, _bpm, bypass) => {
      const { lowHz, highHz } = multibandSplits(e);
      for (const f of [lowA, lowB, highA, highB]) setParam(f.frequency, lowHz, ctx);
      for (const f of [midA, midB, topA, topB, phaseMatch]) setParam(f.frequency, highHz, ctx);

      const attack = paramOf(e, 'attack') / 1000;
      const release = paramOf(e, 'release') / 1000;
      for (const b of bands) {
        setParam(b.comp.threshold, paramOf(e, `${b.name}Threshold`), ctx);
        setParam(b.comp.ratio, paramOf(e, `${b.name}Ratio`), ctx);
        setParam(b.comp.attack, attack, ctx);
        setParam(b.comp.release, release, ctx);
        setParam(b.comp.knee, 6, ctx);
        setParam(b.makeup.gain, dbToGain(paramOf(e, `${b.name}Makeup`)), ctx);
      }
      wd.setMix(1, bypass);
    },
    dispose: () => {
      kill([lowA, lowB, highA, highB, midA, midB, topA, topB, phaseMatch]);
      for (const b of bands) kill([b.comp, b.makeup]);
      wd.dispose();
    },
  };
}

/**
 * De-esser: compress the sibilance band only, then put the rest of the spectrum
 * back. The remainder is built by subtraction (`input − band`) rather than by a
 * complementary filter, so band plus remainder is the input exactly and an idle
 * de-esser is transparent — which is also why the band is compressed by the
 * control VCA rather than a DynamicsCompressor, whose internal latency would
 * comb-filter against the untouched path.
 */
function buildDeesser(ctx: BaseAudioContext, effect: Effect): EffectNode {
  const input = makeGain(ctx, 1);
  const output = makeGain(ctx, 1);
  const band = makeFilter(ctx, 'bandpass', 6500, 3.5);
  const negate = makeGain(ctx, -1);
  const remainder = makeGain(ctx, 1);
  const vca = new ControlVca(ctx, 'compress');

  input.connect(band).connect(vca.input);
  vca.output.connect(output);
  input.connect(remainder).connect(output);
  band.connect(negate).connect(remainder);

  return {
    id: effect.id,
    kind: effect.kind,
    input,
    output,
    tap: vca.tap,
    sidechain: vca.keyInput,
    setSidechain: (external: boolean) => vca.setSidechain(external),
    gainReductionDb: () => vca.gainReductionDb(),
    update: (e, _bpm, bypass) => {
      const sibilance = deesserBand(e);
      setParam(band.frequency, sibilance.freqHz, ctx);
      setParam(band.Q, sibilance.q, ctx);
      applyLaw(vca, e);
      vca.setBallistics(1, paramOf(e, 'release'), 0);
      vca.setLookahead(0);
      vca.setActive(!bypass);
    },
    dispose: () => {
      vca.dispose();
      kill([input, output, band, negate, remainder]);
    },
  };
}

// ----------------------------------------------------------------------- tone

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
    dispose: () => kill([low, mid, high]),
  };
}

function buildEq8(ctx: BaseAudioContext, effect: Effect): EffectNode {
  // A gain band switches off by ramping to 0 dB, which is exactly unity. A pass
  // filter has no such setting, so it crossfades around itself instead.
  const gainBands = EQ8_BANDS.filter((b) => b.hasGain).map((b) => ({
    prefix: b.prefix,
    hasQ: b.hasQ,
    filter: makeFilter(ctx, b.type, 1000, 1),
  }));
  const passBands = EQ8_BANDS.filter((b) => !b.hasGain).map((b) => ({
    prefix: b.prefix,
    stage: new SwitchableFilter(ctx, b.type, b.prefix === 'hp' ? 80 : 18000, BUTTERWORTH_Q_DB),
  }));

  const hp = passBands[0];
  const lp = passBands[1];
  let cursor: AudioNode = hp.stage.output;
  for (const g of gainBands) cursor = cursor.connect(g.filter);
  cursor.connect(lp.stage.input);

  return {
    id: effect.id,
    kind: effect.kind,
    input: hp.stage.input,
    output: lp.stage.output,
    update: (e, _bpm, bypass) => {
      for (const g of gainBands) {
        const on = !bypass && choiceOf(e, `${g.prefix}On`) === 1;
        setParam(g.filter.frequency, paramOf(e, `${g.prefix}Freq`), ctx);
        // The two shelves are left at whatever `Q` they were born with, on
        // purpose: Web Audio fixes a shelf's slope at S = 1 and never reads the
        // field, so writing to it moved nothing but made the parameter look
        // alive. Ramping a value the platform discards is how a dead control
        // stays dead for a year.
        if (g.hasQ) setParam(g.filter.Q, paramOf(e, `${g.prefix}Q`), ctx);
        setParam(g.filter.gain, on ? paramOf(e, `${g.prefix}Gain`) : 0, ctx);
      }
      for (const p of passBands) {
        setParam(p.stage.filter.frequency, paramOf(e, `${p.prefix}Freq`), ctx);
        setParam(p.stage.filter.Q, qToDb(paramOf(e, `${p.prefix}Q`)), ctx);
        p.stage.setActive(!bypass && choiceOf(e, `${p.prefix}On`) === 1);
      }
    },
    dispose: () => {
      for (const g of gainBands) kill([g.filter]);
      for (const p of passBands) p.stage.dispose();
    },
  };
}

/**
 * Input drive that is transparent at 0 dB: the shaped path is crossfaded in by
 * the drive amount rather than always being in circuit, so the control has a
 * real zero instead of a "least coloured" setting.
 */
class DriveStage {
  readonly input: GainNode;
  readonly output: GainNode;
  private readonly pre: GainNode;
  private readonly shaper: WaveShaperNode;
  private readonly wet: GainNode;
  private readonly dry: GainNode;

  constructor(
    private ctx: BaseAudioContext,
    private maxDriveDb: number,
  ) {
    this.input = makeGain(ctx, 1);
    this.output = makeGain(ctx, 1);
    this.pre = makeGain(ctx, 1);
    this.shaper = makeShaper(ctx, saturationCurve('tape', 12), '4x');
    this.wet = makeGain(ctx, 0);
    this.dry = makeGain(ctx, 1);
    this.input.connect(this.pre).connect(this.shaper).connect(this.wet).connect(this.output);
    this.input.connect(this.dry).connect(this.output);
  }

  setDrive(driveDb: number, active: boolean): void {
    const amount = active ? clamp(driveDb / this.maxDriveDb, 0, 1) : 0;
    setParam(this.pre.gain, dbToGain(active ? driveDb : 0), this.ctx);
    setParam(this.wet.gain, amount, this.ctx);
    setParam(this.dry.gain, 1 - amount, this.ctx);
  }

  dispose(): void {
    kill([this.input, this.output, this.pre, this.shaper, this.wet, this.dry]);
  }
}

const FILTER_MODES: readonly BiquadFilterType[] = ['lowpass', 'bandpass', 'highpass'];

/**
 * Low, band and high pass in parallel with crossfaded outputs. Reassigning a
 * BiquadFilterNode's `type` swaps the coefficients in one block and thumps;
 * three filters and a ramp cost a few nodes and never do.
 */
function buildFilter(ctx: BaseAudioContext, effect: Effect): EffectNode {
  const input = makeGain(ctx, 1);
  const drive = new DriveStage(ctx, 24);
  const output = makeGain(ctx, 1);
  const dry = makeGain(ctx, 0);
  input.connect(drive.input);
  input.connect(dry).connect(output);
  const modes = FILTER_MODES.map((type, i) => {
    const filter = makeFilter(ctx, type, 1200, type === 'bandpass' ? 1.2 : qToDb(1.2));
    const gain = makeGain(ctx, i === 0 ? 1 : 0);
    drive.output.connect(filter).connect(gain).connect(output);
    return { type, filter, gain };
  });

  return {
    id: effect.id,
    kind: effect.kind,
    input,
    output,
    update: (e, _bpm, bypass) => {
      const chosen = bypass ? -1 : choiceOf(e, 'mode');
      const cutoff = paramOf(e, 'cutoff');
      const resonance = paramOf(e, 'resonance');
      drive.setDrive(paramOf(e, 'drive'), !bypass);
      for (let i = 0; i < modes.length; i++) {
        const m = modes[i];
        setParam(m.filter.frequency, cutoff, ctx);
        // Only bandpass reads Q as a plain factor; the pass filters read dB.
        setParam(m.filter.Q, m.type === 'bandpass' ? resonance : qToDb(resonance), ctx);
        setParam(m.gain.gain, i === chosen ? 1 : 0, ctx);
      }
      // When bypassed every mode is muted, so the dry path carries the signal.
      setParam(dry.gain, bypass ? 1 : 0, ctx);
    },
    dispose: () => {
      drive.dispose();
      for (const m of modes) kill([m.filter, m.gain]);
      kill([input, output, dry]);
    },
  };
}

function buildSaturator(ctx: BaseAudioContext, effect: Effect): EffectNode {
  const wd = new WetDry(ctx);
  const shaper = makeShaper(ctx, saturationCurve('tube', 8), '4x');
  // The tube curve is asymmetric on purpose, so it generates a DC offset along
  // with its even harmonics; the blocker keeps that out of the mix bus.
  const dcBlock = makeFilter(ctx, 'highpass', 20, BUTTERWORTH_Q_DB);
  const output = makeGain(ctx, 1);
  let curveKey = '';

  wd.input.connect(shaper).connect(dcBlock).connect(output).connect(wd.wet);

  return {
    id: effect.id,
    kind: effect.kind,
    input: wd.input,
    output: wd.output,
    update: (e, _bpm, bypass) => {
      // One evaluation, shared with the face: see shaperCurveOf.
      const key = shaperCurveKey(e);
      if (key !== curveKey) {
        curveKey = key;
        shaper.curve = shaperCurveOf(e) ?? shaper.curve;
      }
      setParam(output.gain, dbToGain(paramOf(e, 'output')), ctx);
      wd.setMix(paramOf(e, 'mix'), bypass);
    },
    dispose: () => {
      kill([shaper, dcBlock, output]);
      wd.dispose();
    },
  };
}

function buildDistortion(ctx: BaseAudioContext, effect: Effect): EffectNode {
  const wd = new WetDry(ctx);
  const shaper = makeShaper(ctx, clipCurve(18, 8), '4x');
  const bass = makeFilter(ctx, 'lowshelf', 180, 0.7);
  const treble = makeFilter(ctx, 'highshelf', 2600, 0.7);
  const dcBlock = makeFilter(ctx, 'highpass', 20, BUTTERWORTH_Q_DB);
  const output = makeGain(ctx, 1);
  let curveKey = '';

  wd.input.connect(shaper).connect(bass).connect(treble).connect(dcBlock).connect(output);
  output.connect(wd.wet);

  return {
    id: effect.id,
    kind: effect.kind,
    input: wd.input,
    output: wd.output,
    update: (e, _bpm, bypass) => {
      const key = shaperCurveKey(e);
      if (key !== curveKey) {
        curveKey = key;
        shaper.curve = shaperCurveOf(e) ?? shaper.curve;
      }
      setParam(bass.gain, paramOf(e, 'bass'), ctx);
      setParam(treble.gain, paramOf(e, 'treble'), ctx);
      setParam(output.gain, dbToGain(paramOf(e, 'output')), ctx);
      wd.setMix(paramOf(e, 'mix'), bypass);
    },
    dispose: () => {
      kill([shaper, bass, treble, dcBlock, output]);
      wd.dispose();
    },
  };
}

function buildAmpSim(ctx: BaseAudioContext, effect: Effect): EffectNode {
  const wd = new WetDry(ctx);
  const pre = makeGain(ctx, 1);
  const shaper = makeShaper(ctx, saturationCurve('transistor', 8), '4x');
  const bass = makeFilter(ctx, 'lowshelf', 120, 0.7);
  const mid = makeFilter(ctx, 'peaking', 650, 0.9);
  const treble = makeFilter(ctx, 'highshelf', 3000, 0.7);
  const presence = makeFilter(ctx, 'highshelf', 5200, 0.7);
  const cab = ctx.createConvolver();
  cab.normalize = true;
  const output = makeGain(ctx, 1);
  let modelKey = -1;
  let cabKey = -1;

  wd.input.connect(pre).connect(shaper).connect(bass).connect(mid).connect(treble);
  treble.connect(presence).connect(cab).connect(output).connect(wd.wet);

  return {
    id: effect.id,
    kind: effect.kind,
    input: wd.input,
    output: wd.output,
    update: (e, _bpm, bypass) => {
      const modelIndex = choiceOf(e, 'model');
      if (modelIndex !== modelKey) {
        modelKey = modelIndex;
        shaper.curve = shaperCurveOf(e) ?? shaper.curve;
      }
      const cabIndex = choiceOf(e, 'cab');
      if (cabIndex !== cabKey) {
        cabKey = cabIndex;
        cab.buffer = toBuffer(ctx, cabinetImpulse(cabinetByIndex(cabIndex), ctx.sampleRate));
      }
      setParam(pre.gain, dbToGain(paramOf(e, 'gain')), ctx);
      setParam(bass.gain, paramOf(e, 'bass'), ctx);
      setParam(mid.gain, paramOf(e, 'mid'), ctx);
      setParam(treble.gain, paramOf(e, 'treble'), ctx);
      setParam(presence.gain, paramOf(e, 'presence'), ctx);
      setParam(output.gain, dbToGain(paramOf(e, 'output')), ctx);
      wd.setMix(1, bypass);
    },
    dispose: () => {
      kill([pre, shaper, bass, mid, treble, presence, cab, output]);
      wd.dispose();
    },
  };
}

function toBuffer(ctx: BaseAudioContext, samples: Float32Array): AudioBuffer {
  const buf = ctx.createBuffer(1, samples.length, ctx.sampleRate);
  buf.getChannelData(0).set(samples);
  return buf;
}

/**
 * Room for the crusher's longest hold, and for the dry delay that matches it,
 * at any rate the app can be asked to render. The longest single stage is 32
 * samples and the whole cascade is 31.5, so ten milliseconds covers both down
 * to a 3.2 kHz sample rate — far below anything a browser will open.
 */
const MAX_CRUSH_HOLD_SEC = 0.01;

/**
 * Bit depth comes from a quantising WaveShaper. Rate reduction is the hold a
 * decimator applies: cascading (1 + z^-1)/2, (1 + z^-2)/2, (1 + z^-4)/2 … gives
 * an exact N-point boxcar for N a power of two, which is the zero-order hold's
 * response — the same dulling and the same comb nulls at multiples of the hold
 * rate. What it does not reproduce is the aliasing a real decimator folds back,
 * because that needs a per-sample decision an AudioWorklet-free graph cannot
 * make. Every stage crossfades in and out, so changing the factor never clicks.
 *
 * The cascade is linear phase, and its group delay is what makes Mix a blend
 * rather than a comb: `crusherGroupDelaySamples` is exact, so the dry leg is
 * held back by precisely as much and the two legs sum in time at every setting.
 */
function buildBitcrusher(ctx: BaseAudioContext, effect: Effect): EffectNode {
  // The only wet/dry pair in this file that asks for an alignment delay, because
  // this is the only wet path here whose latency is a number rather than a guess.
  const wd = new WetDry(ctx, MAX_CRUSH_HOLD_SEC);
  const quantiser = makeShaper(ctx, quantiserCurve(8));
  let bitsKey = -1;

  const stageCount = Math.log2(CRUSH_FACTORS[CRUSH_FACTORS.length - 1]);
  const stages: { direct: GainNode; delayed: GainNode; delay: DelayNode; sum: GainNode }[] = [];
  let cursor: AudioNode = quantiser;
  for (let i = 0; i < stageCount; i++) {
    const delay = ctx.createDelay(MAX_CRUSH_HOLD_SEC);
    delay.delayTime.value = Math.pow(2, i) / ctx.sampleRate;
    const direct = makeGain(ctx, 1);
    const delayed = makeGain(ctx, 0);
    const sum = makeGain(ctx, 1);
    cursor.connect(direct).connect(sum);
    cursor.connect(delay).connect(delayed).connect(sum);
    stages.push({ direct, delayed, delay, sum });
    cursor = sum;
  }
  wd.input.connect(quantiser);
  cursor.connect(wd.wet);

  return {
    id: effect.id,
    kind: effect.kind,
    input: wd.input,
    output: wd.output,
    update: (e, _bpm, bypass) => {
      const bits = Math.round(paramOf(e, 'bits'));
      if (bits !== bitsKey) {
        bitsKey = bits;
        quantiser.curve = quantiserCurve(bits);
      }
      const factor = CRUSH_FACTORS[choiceOf(e, 'downsample')] ?? 1;
      const active = Math.round(Math.log2(factor));
      for (let i = 0; i < stages.length; i++) {
        const on = i < active;
        setParam(stages[i].direct.gain, on ? 0.5 : 1, ctx);
        setParam(stages[i].delayed.gain, on ? 0.5 : 0, ctx);
      }
      // Bypass hands back a wire, so the alignment goes with the processing it
      // was aligning to.
      wd.setDryDelay(bypass ? 0 : crusherGroupDelaySamples(active) / ctx.sampleRate);
      wd.setMix(paramOf(e, 'mix'), bypass);
    },
    dispose: () => {
      kill([quantiser]);
      for (const s of stages) kill([s.direct, s.delayed, s.delay, s.sum]);
      wd.dispose();
    },
  };
}

// ----------------------------------------------------------------- modulation

const MAX_MOD_DELAY_SEC = 0.06;

function buildChorus(ctx: BaseAudioContext, effect: Effect, clock: ModulationClock): EffectNode {
  const wd = new WetDry(ctx);
  const stereo = makeStereoTap(ctx);
  const lfo = new QuadratureLfo(ctx, 0.6);
  const voices = [
    { control: lfo.sine, pan: -1 },
    { control: lfo.cosine, pan: 1 },
  ].map((v) => {
    const delay = ctx.createDelay(MAX_MOD_DELAY_SEC);
    const depth = makeGain(ctx, 0);
    const panner = ctx.createStereoPanner();
    v.control.connect(depth).connect(delay.delayTime);
    stereo.connect(delay).connect(panner).connect(wd.wet);
    return { delay, depth, panner, side: v.pan };
  });
  wd.input.connect(stereo);

  return {
    id: effect.id,
    kind: effect.kind,
    input: wd.input,
    output: wd.output,
    update: (e, _bpm, bypass) => {
      const rate = paramOf(e, 'rate');
      lfo.start(clock.startAt, rate, phaseAt(clock, rate));
      lfo.setRate(rate);
      const base = paramOf(e, 'delay') / 1000;
      const swing = Math.min(paramOf(e, 'depth') / 1000, base);
      const spread = paramOf(e, 'spread');
      for (const v of voices) {
        setParam(v.delay.delayTime, base, ctx);
        setParam(v.depth.gain, bypass ? 0 : swing, ctx);
        setParam(v.panner.pan, v.side * spread, ctx);
      }
      wd.setMix(paramOf(e, 'mix'), bypass);
    },
    dispose: () => {
      lfo.dispose();
      for (const v of voices) kill([v.delay, v.depth, v.panner]);
      kill([stereo]);
      wd.dispose();
    },
  };
}

/**
 * Flanger. Through-zero delays the dry path by the same base amount as the wet
 * path, so the sweep can cross it and null.
 *
 * Web Audio clamps any delay inside a feedback cycle to one render quantum
 * (2.7 ms at 48 kHz), so at the shortest delay settings the resonant comb sits
 * lower than the sweep control suggests. That is a platform floor, not a choice.
 */
function buildFlanger(ctx: BaseAudioContext, effect: Effect, clock: ModulationClock): EffectNode {
  const input = makeGain(ctx, 1);
  const output = makeGain(ctx, 1);
  const dryDirect = makeGain(ctx, 1);
  const dryDelayed = makeGain(ctx, 0);
  const dryDelay = ctx.createDelay(MAX_MOD_DELAY_SEC);
  const wet = makeGain(ctx, 0);
  const delay = ctx.createDelay(MAX_MOD_DELAY_SEC);
  const feedback = makeGain(ctx, 0);
  const lfo = new QuadratureLfo(ctx, 0.25);
  const depth = makeGain(ctx, 0);

  input.connect(dryDirect).connect(output);
  input.connect(dryDelay).connect(dryDelayed).connect(output);
  input.connect(delay).connect(wet).connect(output);
  delay.connect(feedback).connect(delay);
  lfo.sine.connect(depth).connect(delay.delayTime);

  return {
    id: effect.id,
    kind: effect.kind,
    input,
    output,
    update: (e, _bpm, bypass) => {
      const base = paramOf(e, 'delay') / 1000;
      const mix = bypass ? 0 : clamp(paramOf(e, 'mix'), 0, 1);
      const throughZero = choiceOf(e, 'throughZero') === 1 && !bypass;
      const rate = paramOf(e, 'rate');
      lfo.start(clock.startAt, rate, phaseAt(clock, rate));
      lfo.setRate(rate);
      setParam(delay.delayTime, base, ctx);
      setParam(dryDelay.delayTime, base, ctx);
      setParam(depth.gain, bypass ? 0 : Math.min(paramOf(e, 'depth') / 1000, base), ctx);
      setParam(feedback.gain, bypass ? 0 : clamp(paramOf(e, 'feedback'), -0.9, 0.9), ctx);
      setParam(wet.gain, mix, ctx);
      setParam(dryDirect.gain, throughZero ? 0 : 1 - mix, ctx);
      setParam(dryDelayed.gain, throughZero ? 1 - mix : 0, ctx);
    },
    dispose: () => {
      lfo.dispose();
      kill([input, output, dryDirect, dryDelayed, dryDelay, wet, delay, feedback, depth]);
    },
  };
}

const PHASER_STAGES = [4, 6, 8, 10, 12] as const;

function buildPhaser(ctx: BaseAudioContext, effect: Effect, clock: ModulationClock): EffectNode {
  const wd = new WetDry(ctx);
  const wetBus = makeGain(ctx, 1);
  const lfo = new QuadratureLfo(ctx, 0.4);
  const depth = makeGain(ctx, 0);
  const feedback = makeGain(ctx, 0);
  // A cycle needs a DelayNode or the browser mutes it; this is the shortest
  // one the platform allows, so the resonance is a comb rather than a pure peak.
  const loopDelay = ctx.createDelay(0.05);
  loopDelay.delayTime.value = 0;
  const chainIn = makeGain(ctx, 1);

  const allpass: BiquadFilterNode[] = [];
  const taps: GainNode[] = [];
  let cursor: AudioNode = chainIn;
  const maxStages = PHASER_STAGES[PHASER_STAGES.length - 1];
  lfo.sine.connect(depth);
  for (let i = 0; i < maxStages; i++) {
    const stage = makeFilter(ctx, 'allpass', 700, 0.6);
    depth.connect(stage.detune);
    cursor.connect(stage);
    cursor = stage;
    allpass.push(stage);
    const tapIndex = PHASER_STAGES.indexOf((i + 1) as (typeof PHASER_STAGES)[number]);
    if (tapIndex >= 0) {
      const tap = makeGain(ctx, tapIndex === 1 ? 1 : 0);
      stage.connect(tap).connect(wetBus);
      taps.push(tap);
    }
  }
  wd.input.connect(chainIn);
  wetBus.connect(wd.wet);
  wetBus.connect(loopDelay).connect(feedback).connect(chainIn);

  return {
    id: effect.id,
    kind: effect.kind,
    input: wd.input,
    output: wd.output,
    update: (e, _bpm, bypass) => {
      const rate = paramOf(e, 'rate');
      lfo.start(clock.startAt, rate, phaseAt(clock, rate));
      lfo.setRate(rate);
      // Depth in cents: a musical sweep is a constant interval, not constant Hz.
      setParam(depth.gain, bypass ? 0 : paramOf(e, 'depth') * 1800, ctx);
      for (const stage of allpass) setParam(stage.frequency, paramOf(e, 'centre'), ctx);
      setParam(feedback.gain, bypass ? 0 : clamp(paramOf(e, 'feedback'), 0, 0.9), ctx);
      const chosen = PHASER_STAGES.indexOf(
        clamp(Math.round(paramOf(e, 'stages') / 2) * 2, 4, 12) as (typeof PHASER_STAGES)[number],
      );
      for (let i = 0; i < taps.length; i++) setParam(taps[i].gain, i === chosen ? 1 : 0, ctx);
      wd.setMix(paramOf(e, 'mix'), bypass);
    },
    dispose: () => {
      lfo.dispose();
      kill([wetBus, depth, feedback, loopDelay, chainIn, ...allpass, ...taps]);
      wd.dispose();
    },
  };
}

function buildTremolo(ctx: BaseAudioContext, effect: Effect, clock: ModulationClock): EffectNode {
  const stereo = makeStereoTap(ctx);
  const splitter = ctx.createChannelSplitter(2);
  const merger = ctx.createChannelMerger(2);
  const left = makeGain(ctx, 1);
  const right = makeGain(ctx, 1);
  const lfo = new ShapedLfo(ctx, 5);
  const leftDepth = makeGain(ctx, 0);
  // The right channel picks its phase by crossfading between the LFO, its
  // quadrature twin and its inverse — the three offsets a pair of oscillators
  // can hold exactly for any waveform, and therefore the three settings
  // `STEREO_PHASES` declares, in the same order.
  const rightAt0 = makeGain(ctx, 0);
  const rightAt90 = makeGain(ctx, 0);
  const rightAt180 = makeGain(ctx, 0);
  const rightDepth = makeGain(ctx, 0);
  const rightSum = makeGain(ctx, 1);

  stereo.connect(splitter);
  splitter.connect(left, 0);
  splitter.connect(right, 1);
  left.connect(merger, 0, 0);
  right.connect(merger, 0, 1);
  lfo.out0.connect(leftDepth).connect(left.gain);
  lfo.out0.connect(rightAt0).connect(rightSum);
  lfo.out90.connect(rightAt90).connect(rightSum);
  lfo.out0.connect(rightAt180).connect(rightSum);
  rightSum.connect(rightDepth).connect(right.gain);

  return {
    id: effect.id,
    kind: effect.kind,
    input: stereo,
    output: merger,
    update: (e, bpm, bypass) => {
      const synced = choiceOf(e, 'sync') === 1;
      const rate = clamp(
        synced
          ? syncHz(paramOf(e, 'division'), bpm, syncModifierByIndex(choiceOf(e, 'modifier')))
          : paramOf(e, 'rate'),
        0.02,
        40,
      );
      lfo.start(clock.startAt, rate, phaseAt(clock, rate));
      lfo.setRate(rate);
      lfo.setShape(choiceOf(e, 'shape'));
      const depth = bypass ? 0 : clamp(paramOf(e, 'depth'), 0, 1);
      // gain = 1 − depth/2 + (depth/2)·lfo keeps the peak at unity.
      setParam(left.gain, 1 - depth / 2, ctx);
      setParam(right.gain, 1 - depth / 2, ctx);
      setParam(leftDepth.gain, depth / 2, ctx);
      setParam(rightDepth.gain, depth / 2, ctx);
      const phase = choiceOf(e, 'phaseOffset');
      setParam(rightAt0.gain, phase === 0 ? 1 : 0, ctx);
      setParam(rightAt90.gain, phase === 1 ? 1 : 0, ctx);
      setParam(rightAt180.gain, phase === 2 ? -1 : 0, ctx);
    },
    dispose: () => {
      lfo.dispose();
      kill([
        stereo,
        splitter,
        merger,
        left,
        right,
        leftDepth,
        rightAt0,
        rightAt90,
        rightAt180,
        rightDepth,
        rightSum,
      ]);
    },
  };
}

/**
 * Rotary speaker: a crossover into a bass rotor and a treble horn, each with a
 * doppler delay in quadrature with its amplitude modulation — the pitch shift
 * peaks a quarter turn away from the loudness peak, which is where it happens
 * on a real cabinet. Mic spread swings the second mic from in phase with the
 * first to fully opposite. Speed changes coast over about a second instead of
 * jumping, because the run-up is most of the effect.
 */
function buildRotary(ctx: BaseAudioContext, effect: Effect, clock: ModulationClock): EffectNode {
  const wd = new WetDry(ctx);
  const stereo = makeStereoTap(ctx);
  const lowPass = makeButterworth(ctx, 'lowpass', 800);
  const highPass = makeButterworth(ctx, 'highpass', 800);
  wd.input.connect(stereo);
  stereo.connect(lowPass);
  stereo.connect(highPass);

  const rotors = [
    { source: lowPass, dopplerMs: 0.6, rateScale: 0.78, depthKey: 'drumDepth' },
    { source: highPass, dopplerMs: 1.6, rateScale: 1, depthKey: 'hornDepth' },
  ].map((r) => {
    const lfo = new QuadratureLfo(ctx, 0.8);
    const delay = ctx.createDelay(0.02);
    delay.delayTime.value = 0.004;
    const doppler = makeGain(ctx, 0);
    const left = makeGain(ctx, 1);
    const right = makeGain(ctx, 1);
    const leftDepth = makeGain(ctx, 0);
    const rightDepth = makeGain(ctx, 0);
    const panLeft = ctx.createStereoPanner();
    const panRight = ctx.createStereoPanner();
    panLeft.pan.value = -1;
    panRight.pan.value = 1;

    r.source.connect(delay);
    delay.connect(left).connect(panLeft).connect(wd.wet);
    delay.connect(right).connect(panRight).connect(wd.wet);
    lfo.cosine.connect(doppler).connect(delay.delayTime);
    lfo.sine.connect(leftDepth).connect(left.gain);
    lfo.sine.connect(rightDepth).connect(right.gain);
    return { ...r, lfo, delay, doppler, left, right, leftDepth, rightDepth, panLeft, panRight };
  });

  return {
    id: effect.id,
    kind: effect.kind,
    input: wd.input,
    output: wd.output,
    update: (e, _bpm, bypass) => {
      const crossover = paramOf(e, 'crossover');
      setParam(lowPass.frequency, crossover, ctx);
      setParam(highPass.frequency, crossover, ctx);
      const fast = choiceOf(e, 'speed') === 1;
      const rate = fast ? paramOf(e, 'fastRate') : paramOf(e, 'slowRate');
      const spread = clamp(paramOf(e, 'spread'), 0, 1);
      for (const r of rotors) {
        const rotorHz = rate * r.rateScale;
        r.lfo.start(clock.startAt, rotorHz, phaseAt(clock, rotorHz));
        r.lfo.setRate(rotorHz, ROTOR_RAMP);
        const depth = bypass ? 0 : clamp(paramOf(e, r.depthKey), 0, 1);
        setParam(r.doppler.gain, bypass ? 0 : r.dopplerMs / 1000, ctx);
        setParam(r.left.gain, 1 - depth / 2, ctx);
        setParam(r.right.gain, 1 - depth / 2, ctx);
        setParam(r.leftDepth.gain, depth / 2, ctx);
        // 1 − 2·spread walks the second mic from in phase to fully opposite.
        setParam(r.rightDepth.gain, (depth / 2) * (1 - 2 * spread), ctx);
        setParam(r.panLeft.pan, -spread, ctx);
        setParam(r.panRight.pan, spread, ctx);
      }
      wd.setMix(paramOf(e, 'mix'), bypass);
    },
    dispose: () => {
      for (const r of rotors) {
        r.lfo.dispose();
        kill([
          r.delay,
          r.doppler,
          r.left,
          r.right,
          r.leftDepth,
          r.rightDepth,
          r.panLeft,
          r.panRight,
        ]);
      }
      kill([stereo, lowPass, highPass]);
      wd.dispose();
    },
  };
}

// ----------------------------------------------------------------------- time

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
      const time = Math.min(
        MAX_DELAY_SEC,
        syncSeconds(paramOf(e, 'timeSixteenths'), bpm, 'straight'),
      );
      setParam(delay.delayTime, time, ctx);
      // Feedback is hard-capped below 1 so the loop can never run away.
      setParam(feedback.gain, bypass ? 0 : clamp(paramOf(e, 'feedback'), 0, 0.9), ctx);
      setParam(tone.frequency, paramOf(e, 'tone'), ctx);
      wd.setMix(paramOf(e, 'mix'), bypass);
    },
    dispose: () => {
      kill([delay, feedback, tone]);
      wd.dispose();
    },
  };
}

/**
 * Ping-pong: two delay lines that feed each other, one panned to each side.
 * The band-pass in the cross-feed path is inside the loop, so repeats narrow
 * and darken with every bounce instead of staying as bright as the source.
 */
function buildPingPong(ctx: BaseAudioContext, effect: Effect): EffectNode {
  const wd = new WetDry(ctx);
  const leftDelay = ctx.createDelay(MAX_DELAY_SEC);
  const rightDelay = ctx.createDelay(MAX_DELAY_SEC);
  const lowCut = makeFilter(ctx, 'highpass', 180, BUTTERWORTH_Q_DB);
  const highCut = makeFilter(ctx, 'lowpass', 6000, BUTTERWORTH_Q_DB);
  const feedback = makeGain(ctx, 0);
  const panLeft = ctx.createStereoPanner();
  const panRight = ctx.createStereoPanner();

  wd.input.connect(leftDelay);
  leftDelay.connect(panLeft).connect(wd.wet);
  leftDelay.connect(rightDelay);
  rightDelay.connect(panRight).connect(wd.wet);
  rightDelay.connect(lowCut).connect(highCut).connect(feedback).connect(leftDelay);

  return {
    id: effect.id,
    kind: effect.kind,
    input: wd.input,
    output: wd.output,
    update: (e, bpm, bypass) => {
      const modifier = syncModifierByIndex(choiceOf(e, 'modifier'));
      const time = Math.min(
        MAX_DELAY_SEC,
        syncSeconds(paramOf(e, 'timeSixteenths'), bpm, modifier),
      );
      setParam(leftDelay.delayTime, time, ctx);
      setParam(rightDelay.delayTime, time, ctx);
      setParam(lowCut.frequency, paramOf(e, 'lowCut'), ctx);
      setParam(highCut.frequency, paramOf(e, 'highCut'), ctx);
      setParam(feedback.gain, bypass ? 0 : clamp(paramOf(e, 'feedback'), 0, 0.9), ctx);
      const width = clamp(paramOf(e, 'width'), 0, 1);
      setParam(panLeft.pan, -width, ctx);
      setParam(panRight.pan, width, ctx);
      wd.setMix(paramOf(e, 'mix'), bypass);
    },
    dispose: () => {
      kill([leftDelay, rightDelay, lowCut, highCut, feedback, panLeft, panRight]);
      wd.dispose();
    },
  };
}

/**
 * Deterministic 32-bit PRNG (mulberry32).
 *
 * A reverb tail built from `Math.random()` is different every time the node is
 * created, so a bounce never matches what was monitored and two bounces of the
 * same project never match each other. Seeding from stable inputs makes the
 * tail a function of the settings, which is what "render" has to mean.
 */
function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable 32-bit hash of a string, so an effect id can seed its own tail. */
function hashSeed(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Synthesised impulse: exponentially decaying noise, decorrelated per channel.
 * Cheap and good enough for a plate-ish tail without shipping an IR file — and
 * reproducible, because the noise is seeded rather than random.
 */
function renderImpulse(
  ctx: BaseAudioContext,
  seconds: number,
  damping: number,
  seed: number,
): AudioBuffer {
  const rate = ctx.sampleRate;
  const len = Math.max(1, Math.floor(rate * Math.min(6, Math.max(0.1, seconds))));
  const buf = ctx.createBuffer(2, len, rate);
  // One-pole lowpass coefficient from the damping frequency.
  const coeff = Math.exp((-2 * Math.PI * Math.min(damping, rate / 2)) / rate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch);
    // A different stream per channel is what decorrelates the two sides; both
    // are still a function of the seed, so the stereo image is reproducible.
    const rand = seededRandom(seed + ch * 0x9e3779b9);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const white = rand() * 2 - 1;
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
  // The tail is seeded from the effect's own id: this reverb sounds the same
  // in every session and in every bounce, while two reverbs in one project
  // still have different tails.
  const seed = hashSeed(effect.id);

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
        conv.buffer = renderImpulse(ctx, size, damping, seed);
        renderedSize = size;
        renderedDamping = damping;
      }
      setParam(pre.delayTime, paramOf(e, 'predelay') / 1000, ctx);
      wd.setMix(paramOf(e, 'mix'), bypass);
    },
    dispose: () => {
      kill([pre, conv]);
      wd.dispose();
    },
  };
}

// --------------------------------------------------------------------- stereo

/**
 * Mid/side width with a mono bass. Side is highpassed before it is widened, so
 * everything below the crossover collapses to the centre — the usual fix for a
 * wide mix that will not survive a club system or a vinyl cut.
 */
function buildWidth(ctx: BaseAudioContext, effect: Effect): EffectNode {
  const wd = new WetDry(ctx);
  const stereo = makeStereoTap(ctx);
  const splitter = ctx.createChannelSplitter(2);
  const merger = ctx.createChannelMerger(2);
  const midFromLeft = makeGain(ctx, 0.5);
  const midFromRight = makeGain(ctx, 0.5);
  const sideFromLeft = makeGain(ctx, 0.5);
  const sideFromRight = makeGain(ctx, -0.5);
  const mid = makeGain(ctx, 1);
  const side = makeGain(ctx, 1);
  // Switchable, because the parameter's minimum is an off position and not
  // just a low corner: a Butterworth highpass at 20 Hz still rotates the phase
  // of the bottom octave and takes the very lowest of it off the sides, so a
  // face that stops drawing the line down there would be describing a filter
  // that was still in circuit.
  const bassMono = new SwitchableFilter(ctx, 'highpass', BASS_MONO_OFF_HZ, BUTTERWORTH_Q_DB);
  const width = makeGain(ctx, 1);
  const sideToLeft = makeGain(ctx, 1);
  const sideToRight = makeGain(ctx, -1);
  const output = makeGain(ctx, 1);

  wd.input.connect(stereo).connect(splitter);
  splitter.connect(midFromLeft, 0);
  splitter.connect(midFromRight, 1);
  splitter.connect(sideFromLeft, 0);
  splitter.connect(sideFromRight, 1);
  midFromLeft.connect(mid);
  midFromRight.connect(mid);
  sideFromLeft.connect(side);
  sideFromRight.connect(side);
  side.connect(bassMono.input);
  bassMono.output.connect(width);
  width.connect(sideToLeft);
  width.connect(sideToRight);
  mid.connect(merger, 0, 0);
  mid.connect(merger, 0, 1);
  sideToLeft.connect(merger, 0, 0);
  sideToRight.connect(merger, 0, 1);
  merger.connect(output).connect(wd.wet);

  return {
    id: effect.id,
    kind: effect.kind,
    input: wd.input,
    output: wd.output,
    update: (e, _bpm, bypass) => {
      const bassMonoHz = paramOf(e, 'bassMono');
      setParam(width.gain, clamp(paramOf(e, 'width'), 0, 2), ctx);
      setParam(bassMono.filter.frequency, bassMonoHz, ctx);
      // The same test the face draws from, so "off" cannot mean one thing in
      // the picture and another in the audio.
      bassMono.setActive(!bypass && bassMonoActive(bassMonoHz));
      setParam(output.gain, dbToGain(paramOf(e, 'output')), ctx);
      wd.setMix(1, bypass);
    },
    dispose: () => {
      kill([
        stereo,
        splitter,
        merger,
        midFromLeft,
        midFromRight,
        sideFromLeft,
        sideFromRight,
        mid,
        side,
        width,
        sideToLeft,
        sideToRight,
        output,
      ]);
      bassMono.dispose();
      wd.dispose();
    },
  };
}

function buildAutoPan(ctx: BaseAudioContext, effect: Effect, clock: ModulationClock): EffectNode {
  const stereo = makeStereoTap(ctx);
  const panner = ctx.createStereoPanner();
  const lfo = new ShapedLfo(ctx, 0.8);
  const depth = makeGain(ctx, 0);

  stereo.connect(panner);
  lfo.out0.connect(depth).connect(panner.pan);

  return {
    id: effect.id,
    kind: effect.kind,
    input: stereo,
    output: panner,
    update: (e, bpm, bypass) => {
      const synced = choiceOf(e, 'sync') === 1;
      const rate = clamp(
        synced
          ? syncHz(paramOf(e, 'division'), bpm, syncModifierByIndex(choiceOf(e, 'modifier')))
          : paramOf(e, 'rate'),
        0.02,
        40,
      );
      lfo.start(clock.startAt, rate, phaseAt(clock, rate));
      lfo.setRate(rate);
      lfo.setShape(choiceOf(e, 'shape'));
      setParam(depth.gain, bypass ? 0 : clamp(paramOf(e, 'depth'), 0, 1), ctx);
      setParam(panner.pan, 0, ctx);
    },
    dispose: () => {
      lfo.dispose();
      kill([stereo, panner, depth]);
    },
  };
}

// -------------------------------------------------------------------- utility

/**
 * Measured level trim. The node applies `trim` and nothing else; the analyser
 * is a dead-end branch the UI reads to work out what trim would land the
 * material on the target, so the value stays a real, automatable number rather
 * than an invisible auto-gain.
 */
function buildGainMatch(ctx: BaseAudioContext, effect: Effect): EffectNode {
  const gain = makeGain(ctx, 1);
  const tap = ctx.createAnalyser();
  tap.fftSize = 2048;
  gain.connect(tap);

  return {
    id: effect.id,
    kind: effect.kind,
    input: gain,
    output: gain,
    tap,
    update: (e, _bpm, bypass) =>
      setParam(gain.gain, bypass ? 1 : dbToGain(paramOf(e, 'trim')), ctx),
    dispose: () => kill([gain, tap]),
  };
}

/**
 * Measurement-only inserts. The signal node is a single gain left at unity and
 * never written to, and the analyser hangs off it as a dead-end branch, so
 * these cannot colour the channel even by accident — `tests/effectCurves.test.ts`
 * asserts the input and output are the same node and its gain stays 1.
 */
function buildMeasurement(
  ctx: BaseAudioContext,
  effect: Effect,
  configure: (tap: AnalyserNode, e: Effect) => void,
): EffectNode {
  const pass = ctx.createGain();
  const tap = ctx.createAnalyser();
  pass.connect(tap);

  return {
    id: effect.id,
    kind: effect.kind,
    input: pass,
    output: pass,
    tap,
    update: (e) => configure(tap, e),
    dispose: () => kill([pass, tap]),
  };
}

/**
 * Unity pass-through, used by Vocal Tune and by any kind this build does not
 * recognise.
 *
 * Vocal Tune is a pass-through on purpose. Pitch correction has to see a whole
 * phrase before it can decide anything, so it runs as an offline render in the
 * audio editor and its parameters here are the settings that render reads.
 * Faking a live version with a delay line and a detector would sound worse than
 * nothing and would not agree with the rendered result.
 */
function buildPassThrough(ctx: BaseAudioContext, effect: Effect): EffectNode {
  const pass = ctx.createGain();
  return {
    id: effect.id,
    kind: effect.kind,
    input: pass,
    output: pass,
    update: () => {},
    dispose: () => kill([pass]),
  };
}

/**
 * Build a node for one effect. An unrecognised kind becomes a unity pass-through
 * so a project written by a newer build still plays, minus that effect.
 *
 * The clock only reaches the six kinds that carry a modulator; everything else
 * is a function of its input and cannot tell what time it is.
 */
export function buildEffectNode(
  ctx: BaseAudioContext,
  effect: Effect,
  clock?: ModulationClock,
): EffectNode {
  const at = clockOf(ctx, clock);
  switch (effect.kind) {
    case 'trim':
      return buildTrim(ctx, effect);
    case 'compressor':
      return buildCompressor(ctx, effect);
    case 'gate':
      return buildGate(ctx, effect);
    case 'limiter':
      return buildLimiter(ctx, effect);
    case 'multiband':
      return buildMultiband(ctx, effect);
    case 'deesser':
      return buildDeesser(ctx, effect);
    case 'eq3':
      return buildEq3(ctx, effect);
    case 'eq8':
      return buildEq8(ctx, effect);
    case 'filter':
      return buildFilter(ctx, effect);
    case 'saturator':
      return buildSaturator(ctx, effect);
    case 'distortion':
      return buildDistortion(ctx, effect);
    case 'ampsim':
      return buildAmpSim(ctx, effect);
    case 'bitcrusher':
      return buildBitcrusher(ctx, effect);
    case 'chorus':
      return buildChorus(ctx, effect, at);
    case 'flanger':
      return buildFlanger(ctx, effect, at);
    case 'phaser':
      return buildPhaser(ctx, effect, at);
    case 'tremolo':
      return buildTremolo(ctx, effect, at);
    case 'rotary':
      return buildRotary(ctx, effect, at);
    case 'delay':
      return buildDelay(ctx, effect);
    case 'pingpong':
      return buildPingPong(ctx, effect);
    case 'reverb':
      return buildReverb(ctx, effect);
    case 'width':
      return buildWidth(ctx, effect);
    case 'autopan':
      return buildAutoPan(ctx, effect, at);
    case 'gainMatch':
      return buildGainMatch(ctx, effect);
    case 'analyser':
      return buildMeasurement(ctx, effect, (tap, e) => {
        tap.fftSize = ANALYSER_SIZES[choiceOf(e, 'resolution')] ?? 2048;
        tap.smoothingTimeConstant = clamp(paramOf(e, 'smoothing'), 0, 0.95);
      });
    case 'tuner':
      // Pitch detection needs a long window; the reference pitch only shifts
      // how the measured frequency is named, never the audio.
      return buildMeasurement(ctx, effect, (tap) => {
        tap.fftSize = 8192;
        tap.smoothingTimeConstant = 0;
      });
    case 'vocaltune':
      return buildPassThrough(ctx, effect);
    case 'wam':
      return buildPlugin(ctx, effect);
    default:
      return buildPassThrough(ctx, effect);
  }
}

/**
 * A third-party plugin slot.
 *
 * The instance is looked up *synchronously* — it was resolved ahead of time by
 * `preloadPlugins`, exactly as a clip's audio is decoded ahead of time by
 * `preloadForRender` and then found with `getBufferSync`. If it is not there
 * this is a unity pass-through, and that covers both of the reasons it might
 * not be:
 *
 * - it is still loading, in which case the chain rebuilds when it lands
 *   (`pluginToken` folds the pool's state into the chain's shape signature, so
 *   a plugin arriving *is* a shape change);
 * - it could not be loaded at all, in which case this stays a pass-through and
 *   the effect remains in the chain as a tombstone — in order, with its name,
 *   its source and every parameter value intact, so nothing is destroyed and a
 *   retry can still restore it.
 *
 * Either way audio flows immediately and the graph never waits.
 */
function buildPlugin(ctx: BaseAudioContext, effect: Effect): EffectNode {
  const record = getPluginSync(ctx, effect.id);
  if (!record) return buildPassThrough(ctx, effect);
  return buildWamEffectNode(ctx, effect, {
    instance: record.instance,
    appliedParams: record.appliedParams,
    initialBypass: record.bypass,
  });
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

  constructor(
    private ctx: BaseAudioContext,
    /**
     * Where this context's clock sits in the song, for the modulators. Omitted
     * by a caller that has no song position to offer, which leaves every LFO
     * anchored to the moment its chain was built — reproducible only within one
     * sitting, which is why the offline renderer supplies one.
     */
    private clock?: ModulationClock,
  ) {
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
    // `pluginToken` is empty for every built-in kind, so the signature is
    // unchanged for them. For a plugin it carries the pool's state — pending,
    // failed, or the instance's own id — which is what makes a plugin finishing
    // its (asynchronous) load register here as a change of shape. Without it the
    // placeholder pass-through would never be replaced.
    const sig = effects.map((e) => `${e.id}:${e.kind}${pluginToken(this.ctx, e)}`).join('|');
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

  /** Gain reduction of one insert, in dB, or 0 when it does not report any. */
  gainReductionOf(effectId: string): number {
    const node = this.nodes.find((n) => n.id === effectId);
    return node?.gainReductionDb?.() ?? 0;
  }

  /** Measurement tap of one insert, for spectrum, scope and tuner displays. */
  tapOf(effectId: string): AnalyserNode | undefined {
    return this.nodes.find((n) => n.id === effectId)?.tap;
  }

  /**
   * Every key input in this chain, so the engine can feed them from another
   * channel — and switch each detector over — in one pass.
   */
  sidechainInputs(): AudioNode[] {
    return this.nodes.map((n) => n.sidechain).filter((n): n is AudioNode => !!n);
  }

  /** Point every dynamics detector at the external key, or back at the channel. */
  setSidechain(external: boolean): void {
    for (const n of this.nodes) n.setSidechain?.(external);
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

    this.nodes = effects.map((e) => buildEffectNode(this.ctx, e, this.clock));
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
    kill([this.entry, this.exit]);
  }
}
