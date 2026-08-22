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
import { ANALYSER_SIZES, CRUSH_FACTORS, EQ8_BANDS, choiceOf, paramOf } from '../model/effects';
import {
  BUTTERWORTH_Q,
  BUTTERWORTH_Q_DB,
  cabinetByIndex,
  cabinetImpulse,
  clamp,
  clipCurve,
  compressorCurve,
  dbToGain,
  expanderCurve,
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
} from './dsp/curves';
import type { SaturationModel } from './dsp/curves';
import type { Effect } from '../model/types';

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
    const m = bypass ? 0 : clamp(mix, 0, 1);
    setParam(this.dry.gain, 1 - m, this.ctx);
    setParam(this.wet.gain, m, this.ctx);
  }

  dispose(): void {
    kill([this.input, this.output, this.dry, this.wet]);
  }
}

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
    const diff = makeGain(ctx, 1);
    const negate = makeGain(ctx, -1);
    const abs = makeShaper(ctx, rectifierCurve());
    const half = makeGain(ctx, mode === 'max' ? 0.5 : -0.5);

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

const MAX_LOOKAHEAD_SEC = 0.02;
const MAX_HOLD_SEC = 0.6;
/** Critically damped smoothing: an envelope follower must not overshoot. */
const SMOOTHING_Q_DB = qToDb(0.5);

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
  private readonly fast: BiquadFilterNode;
  private readonly slow: BiquadFilterNode;
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

  constructor(
    private ctx: BaseAudioContext,
    law: 'expand' | 'compress',
  ) {
    const mode = law === 'expand' ? 'max' : 'min';
    this.input = makeGain(ctx, 1);
    this.output = makeGain(ctx, 1);
    this.lookahead = ctx.createDelay(MAX_LOOKAHEAD_SEC);
    // Intrinsic zero: the control chain supplies the whole gain value.
    this.vca = makeGain(ctx, 0);
    this.input.connect(this.lookahead).connect(this.vca).connect(this.output);

    this.rect = makeShaper(ctx, rectifierCurve());
    this.detector = makeFilter(ctx, 'lowpass', 120, SMOOTHING_Q_DB);
    // Fully open until the first update installs the real law.
    this.shaper = makeShaper(ctx, new Float32Array([1, 1]));
    this.holdDelay = ctx.createDelay(MAX_HOLD_SEC);
    this.holdMix = new Combiner(ctx, mode);
    this.fast = makeFilter(ctx, 'lowpass', 200, SMOOTHING_Q_DB);
    this.slow = makeFilter(ctx, 'lowpass', 4, SMOOTHING_Q_DB);
    this.ballistics = new Combiner(ctx, mode);
    this.depth = makeGain(ctx, 1);
    this.dry = makeGain(ctx, 0);
    this.unity = ctx.createConstantSource();
    this.tap = ctx.createAnalyser();
    this.tap.fftSize = 256;
    this.probe = new Float32Array(this.tap.fftSize);

    this.internalKey = makeGain(ctx, 1);
    this.keyInput = makeGain(ctx, 0);
    this.input.connect(this.internalKey).connect(this.rect);
    this.keyInput.connect(this.rect);
    this.rect.connect(this.detector).connect(this.shaper);
    this.shaper.connect(this.holdMix.a);
    this.shaper.connect(this.holdDelay).connect(this.holdMix.b);
    this.holdMix.out.connect(this.fast).connect(this.ballistics.a);
    this.holdMix.out.connect(this.slow).connect(this.ballistics.b);
    this.ballistics.out.connect(this.depth);
    this.depth.connect(this.vca.gain);
    this.depth.connect(this.tap);
    this.unity.connect(this.dry).connect(this.vca.gain);
    this.unity.start();
  }

  /** Swap the transfer curve, but only when its defining values changed. */
  setCurve(key: string, build: () => Float32Array): void {
    if (key === this.curveKey) return;
    this.curveKey = key;
    this.shaper.curve = build();
  }

  setBallistics(attackMs: number, releaseMs: number, holdMs: number): void {
    const attack = Math.max(attackMs, 0.05) / 1000;
    const release = Math.max(releaseMs, 1) / 1000;
    // The detector only has to strip ripple; the timing lives in the ballistics.
    setParam(this.detector.frequency, clamp(timeConstantHz(attack), 25, 400), this.ctx);
    setParam(this.fast.frequency, clamp(timeConstantHz(attack), 1, 2000), this.ctx);
    setParam(this.slow.frequency, clamp(timeConstantHz(release), 0.2, 400), this.ctx);
    setParam(this.holdDelay.delayTime, clamp(holdMs / 1000, 0, MAX_HOLD_SEC), this.ctx);
  }

  /**
   * Cross-fade between the channel's own signal and the external key.
   * Both paths stay connected so the swap cannot click.
   */
  setSidechain(external: boolean): void {
    setParam(this.internalKey.gain, external ? 0 : 1, this.ctx);
    setParam(this.keyInput.gain, external ? 1 : 0, this.ctx);
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
    kill([
      this.input,
      this.output,
      this.lookahead,
      this.vca,
      this.rect,
      this.detector,
      this.shaper,
      this.holdDelay,
      this.fast,
      this.slow,
      this.depth,
      this.dry,
      this.unity,
      this.tap,
    ]);
  }
}

/**
 * A sine LFO and its exact 90°-shifted twin, from two oscillators fed the same
 * frequency and started at the same instant. Quadrature is what lets a chorus
 * spread two voices, and a rotary put the doppler peak a quarter-turn away from
 * the amplitude peak, without a control-rate delay line.
 */
class QuadratureLfo {
  readonly sine: OscillatorNode;
  readonly cosine: OscillatorNode;

  constructor(
    private ctx: BaseAudioContext,
    hz: number,
  ) {
    this.sine = ctx.createOscillator();
    this.cosine = ctx.createOscillator();
    const zero = new Float32Array([0, 0]);
    this.sine.setPeriodicWave(ctx.createPeriodicWave(zero, new Float32Array([0, 1])));
    this.cosine.setPeriodicWave(ctx.createPeriodicWave(new Float32Array([0, 1]), zero));
    this.sine.frequency.value = hz;
    this.cosine.frequency.value = hz;
    this.sine.start();
    this.cosine.start();
  }

  setRate(hz: number, timeConstant = RAMP): void {
    setParamSlow(this.sine.frequency, hz, this.ctx, timeConstant);
    setParamSlow(this.cosine.frequency, hz, this.ctx, timeConstant);
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
      const series = shapes[i];
      const pair = shapedPair(ctx, series, hz);
      const g0 = makeGain(ctx, i === 0 ? 1 : 0);
      const g90 = makeGain(ctx, i === 0 ? 1 : 0);
      pair.sine.connect(g0).connect(this.out0);
      pair.cosine.connect(g90).connect(this.out90);
      this.pairs.push(pair);
      this.mix0.push(g0);
      this.mix90.push(g90);
    }
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

/**
 * One quadrature pair for an arbitrary sine-phase harmonic series. Shifting a
 * waveform by 90° rotates harmonic n by n·90°, which is why the twin is built
 * from rotated coefficients rather than by swapping the real and imaginary
 * parts wholesale.
 */
function shapedPair(ctx: BaseAudioContext, series: number[], hz: number): QuadratureLfo {
  const lfo = new QuadratureLfo(ctx, hz);
  const realA = new Float32Array(series.length);
  const imagA = new Float32Array(series);
  const realB = new Float32Array(series.length);
  const imagB = new Float32Array(series.length);
  for (let n = 1; n < series.length; n++) {
    const phase = (n * Math.PI) / 2;
    realB[n] = series[n] * Math.sin(phase);
    imagB[n] = series[n] * Math.cos(phase);
  }
  lfo.sine.setPeriodicWave(ctx.createPeriodicWave(realA, imagA));
  lfo.cosine.setPeriodicWave(ctx.createPeriodicWave(realB, imagB));
  return lfo;
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

function buildCompressor(ctx: BaseAudioContext, effect: Effect): EffectNode {
  const comp = ctx.createDynamicsCompressor();
  const makeup = ctx.createGain();
  comp.connect(makeup);

  return {
    id: effect.id,
    kind: effect.kind,
    input: comp,
    output: makeup,
    gainReductionDb: () => comp.reduction,
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
    dispose: () => kill([comp, makeup]),
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
      const threshold = paramOf(e, 'threshold');
      const ratio = paramOf(e, 'ratio');
      const range = paramOf(e, 'range');
      vca.setCurve(`${threshold}/${ratio}/${range}`, () => expanderCurve(threshold, ratio, range));
      vca.setBallistics(paramOf(e, 'attack'), paramOf(e, 'release'), paramOf(e, 'hold'));
      vca.setLookahead(0);
      vca.setActive(!bypass);
    },
    dispose: () => vca.dispose(),
  };
}

function buildLimiter(ctx: BaseAudioContext, effect: Effect): EffectNode {
  const drive = makeGain(ctx, 1);
  const vca = new ControlVca(ctx, 'compress');
  // Scale so the ceiling lands on full scale, clip there, then scale back:
  // the shaper's own input clamping is an exact brickwall inside the rails.
  const preClip = makeGain(ctx, 1);
  const brickwall = makeShaper(ctx, identityCurve(), '4x');
  const postClip = makeGain(ctx, 1);

  drive.connect(vca.input);
  vca.output.connect(preClip).connect(brickwall).connect(postClip);

  return {
    id: effect.id,
    kind: effect.kind,
    input: drive,
    output: postClip,
    tap: vca.tap,
    sidechain: vca.keyInput,
    setSidechain: (external: boolean) => vca.setSidechain(external),
    gainReductionDb: () => vca.gainReductionDb(),
    update: (e, _bpm, bypass) => {
      const ceiling = paramOf(e, 'ceiling');
      const ceilingGain = dbToGain(ceiling);
      setParam(drive.gain, bypass ? 1 : dbToGain(paramOf(e, 'drive')), ctx);
      // A 20:1 ratio with a 2 dB knee does the work; the clipper only mops up
      // the overshoot a finite ratio always leaves behind.
      vca.setCurve(`${ceiling}`, () => compressorCurve(ceiling, 20, 2));
      vca.setBallistics(0.2, paramOf(e, 'release'), 0);
      vca.setLookahead(bypass ? 0 : paramOf(e, 'lookahead'));
      vca.setActive(!bypass);
      setParam(preClip.gain, bypass ? 1 : 1 / ceilingGain, ctx);
      setParam(postClip.gain, bypass ? 1 : ceilingGain, ctx);
    },
    dispose: () => {
      vca.dispose();
      kill([drive, preClip, brickwall, postClip]);
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
      const lowSplit = paramOf(e, 'lowSplit');
      const highSplit = Math.max(paramOf(e, 'highSplit'), lowSplit * 1.2);
      for (const f of [lowA, lowB, highA, highB]) setParam(f.frequency, lowSplit, ctx);
      for (const f of [midA, midB, topA, topB, phaseMatch]) setParam(f.frequency, highSplit, ctx);

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
      setParam(band.frequency, paramOf(e, 'freq'), ctx);
      setParam(band.Q, paramOf(e, 'q'), ctx);
      const threshold = paramOf(e, 'threshold');
      const ratio = paramOf(e, 'ratio');
      vca.setCurve(`${threshold}/${ratio}`, () => compressorCurve(threshold, ratio, 6));
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
        setParam(g.filter.Q, paramOf(e, `${g.prefix}Q`), ctx);
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

const SATURATION_BY_INDEX: readonly SaturationModel[] = ['tube', 'tape', 'transistor'];

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
      const model = SATURATION_BY_INDEX[choiceOf(e, 'model')] ?? 'tube';
      const driveDb = paramOf(e, 'drive');
      const key = `${model}/${driveDb}`;
      if (key !== curveKey) {
        curveKey = key;
        shaper.curve = saturationCurve(model, driveDb);
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
      const driveDb = paramOf(e, 'drive');
      const hardness = paramOf(e, 'hardness');
      const key = `${driveDb}/${hardness}`;
      if (key !== curveKey) {
        curveKey = key;
        shaper.curve = clipCurve(driveDb, hardness);
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

/** Preamp voicings: how hard the front end is driven before the tone stack. */
const AMP_MODELS: readonly { model: SaturationModel; driveDb: number }[] = [
  { model: 'tube', driveDb: 2 },
  { model: 'transistor', driveDb: 8 },
  { model: 'transistor', driveDb: 16 },
  { model: 'tape', driveDb: 4 },
];

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
        const voice = AMP_MODELS[modelIndex] ?? AMP_MODELS[0];
        shaper.curve = saturationCurve(voice.model, voice.driveDb);
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
 * Bit depth comes from a quantising WaveShaper. Rate reduction is the hold a
 * decimator applies: cascading (1 + z^-1)/2, (1 + z^-2)/2, (1 + z^-4)/2 … gives
 * an exact N-point boxcar for N a power of two, which is the zero-order hold's
 * response — the same dulling and the same comb nulls at multiples of the hold
 * rate. What it does not reproduce is the aliasing a real decimator folds back,
 * because that needs a per-sample decision an AudioWorklet-free graph cannot
 * make. Every stage crossfades in and out, so changing the factor never clicks.
 */
function buildBitcrusher(ctx: BaseAudioContext, effect: Effect): EffectNode {
  const wd = new WetDry(ctx);
  const quantiser = makeShaper(ctx, quantiserCurve(8));
  let bitsKey = -1;

  const stageCount = Math.log2(CRUSH_FACTORS[CRUSH_FACTORS.length - 1]);
  const stages: { direct: GainNode; delayed: GainNode; delay: DelayNode; sum: GainNode }[] = [];
  let cursor: AudioNode = quantiser;
  for (let i = 0; i < stageCount; i++) {
    const delay = ctx.createDelay(0.01);
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

function buildChorus(ctx: BaseAudioContext, effect: Effect): EffectNode {
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
      lfo.setRate(paramOf(e, 'rate'));
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
function buildFlanger(ctx: BaseAudioContext, effect: Effect): EffectNode {
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
      lfo.setRate(paramOf(e, 'rate'));
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

function buildPhaser(ctx: BaseAudioContext, effect: Effect): EffectNode {
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
      lfo.setRate(paramOf(e, 'rate'));
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

/** Phase relationships a two-channel modulator can hold exactly. */
const STEREO_PHASES = [0, 90, 180] as const;

function buildTremolo(ctx: BaseAudioContext, effect: Effect): EffectNode {
  const stereo = makeStereoTap(ctx);
  const splitter = ctx.createChannelSplitter(2);
  const merger = ctx.createChannelMerger(2);
  const left = makeGain(ctx, 1);
  const right = makeGain(ctx, 1);
  const lfo = new ShapedLfo(ctx, 5);
  const leftDepth = makeGain(ctx, 0);
  // The right channel picks its phase by crossfading between the LFO, its
  // quadrature twin and its inverse — the three offsets a pair of oscillators
  // can hold exactly for any waveform.
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
      const rate = synced
        ? syncHz(paramOf(e, 'division'), bpm, syncModifierByIndex(choiceOf(e, 'modifier')))
        : paramOf(e, 'rate');
      lfo.setRate(clamp(rate, 0.02, 40));
      lfo.setShape(choiceOf(e, 'shape'));
      const depth = bypass ? 0 : clamp(paramOf(e, 'depth'), 0, 1);
      // gain = 1 − depth/2 + (depth/2)·lfo keeps the peak at unity.
      setParam(left.gain, 1 - depth / 2, ctx);
      setParam(right.gain, 1 - depth / 2, ctx);
      setParam(leftDepth.gain, depth / 2, ctx);
      setParam(rightDepth.gain, depth / 2, ctx);
      const phase = closestPhaseIndex(paramOf(e, 'stereoPhase'));
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

/** Snap a phase control to the offsets the modulator can hold exactly. */
function closestPhaseIndex(degrees: number): number {
  let best = 0;
  for (let i = 1; i < STEREO_PHASES.length; i++) {
    if (Math.abs(STEREO_PHASES[i] - degrees) < Math.abs(STEREO_PHASES[best] - degrees)) best = i;
  }
  return best;
}

/**
 * Rotary speaker: a crossover into a bass rotor and a treble horn, each with a
 * doppler delay in quadrature with its amplitude modulation — the pitch shift
 * peaks a quarter turn away from the loudness peak, which is where it happens
 * on a real cabinet. Mic spread swings the second mic from in phase with the
 * first to fully opposite. Speed changes coast over about a second instead of
 * jumping, because the run-up is most of the effect.
 */
function buildRotary(ctx: BaseAudioContext, effect: Effect): EffectNode {
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
        r.lfo.setRate(rate * r.rateScale, ROTOR_RAMP);
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
  const bassMono = makeFilter(ctx, 'highpass', 20, BUTTERWORTH_Q_DB);
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
  side.connect(bassMono).connect(width);
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
      setParam(width.gain, clamp(paramOf(e, 'width'), 0, 2), ctx);
      setParam(bassMono.frequency, paramOf(e, 'bassMono'), ctx);
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
        bassMono,
        width,
        sideToLeft,
        sideToRight,
        output,
      ]);
      wd.dispose();
    },
  };
}

function buildAutoPan(ctx: BaseAudioContext, effect: Effect): EffectNode {
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
      const rate = synced
        ? syncHz(paramOf(e, 'division'), bpm, syncModifierByIndex(choiceOf(e, 'modifier')))
        : paramOf(e, 'rate');
      lfo.setRate(clamp(rate, 0.02, 40));
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
 */
export function buildEffectNode(ctx: BaseAudioContext, effect: Effect): EffectNode {
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
      return buildChorus(ctx, effect);
    case 'flanger':
      return buildFlanger(ctx, effect);
    case 'phaser':
      return buildPhaser(ctx, effect);
    case 'tremolo':
      return buildTremolo(ctx, effect);
    case 'rotary':
      return buildRotary(ctx, effect);
    case 'delay':
      return buildDelay(ctx, effect);
    case 'pingpong':
      return buildPingPong(ctx, effect);
    case 'reverb':
      return buildReverb(ctx, effect);
    case 'width':
      return buildWidth(ctx, effect);
    case 'autopan':
      return buildAutoPan(ctx, effect);
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
    default:
      return buildPassThrough(ctx, effect);
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
    kill([this.entry, this.exit]);
  }
}
