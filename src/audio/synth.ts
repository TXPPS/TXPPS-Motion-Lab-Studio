/**
 * TXPPS MotionSynth — lightweight polyphonic subtractive synth, plus the
 * sample-based drum kit. Instruments render into a track channel input node
 * and register every voice with the engine's source registry so panic /
 * stop-all and the diagnostics active-source count stay truthful.
 */
import { midiToFreq, clamp } from '../model/music';
import {
  synthGlideOf,
  synthLfoOf,
  synthMorphDelaySec,
  synthOscillatorOf,
  synthSubOf,
  synthVoiceFilter,
  SYNTH_SUB_WAVE,
  type SynthGlide,
} from '../model/synthFace';
import type { SynthParams } from '../model/types';
import { getDrumBuffer } from './demoAudio';

export interface SourceRegistry {
  register: (h: ActiveHandle) => void;
  unregister: (h: ActiveHandle) => void;
  /** true when there is room for another source (safety cap) */
  canAllocate: () => boolean;
}

export interface ActiveHandle {
  kind: 'voice' | 'buffer' | 'metronome';
  trackId?: string;
  clipId?: string;
  /**
   * Stop with a short fade; `hard` stops as fast as possible.
   *
   * `at` is when the stop should happen, in context time. It matters wherever
   * the decision is made ahead of the moment — a loop wrap is scheduled a
   * lookahead early, and stopping the outgoing pass immediately would cut the
   * audio before the wrap it belongs to.
   */
  stop: (hard?: boolean, at?: number) => void;
}

export interface Instrument {
  scheduleNote(
    pitch: number,
    velocity: number,
    when: number,
    durSec: number,
    clipId?: string,
  ): void;
  noteOn(pitch: number, velocity: number): void;
  noteOff(pitch: number): void;
  setSustain(on: boolean): void;
  allNotesOff(): void;
  dispose(): void;
}

const MAX_VOICES = 24;

/**
 * Start a frequency at `hz`, or glide to it from the note before.
 *
 * The ramp is exponential because pitch is heard in ratios: a linear sweep
 * between two frequencies spends most of its time near the top note and
 * arrives at the bottom one in a rush, which is not what a portamento sounds
 * like on anything that has ever had one.
 *
 * The start is the destination scaled by the glide's own ratio rather than the
 * previous note's frequency itself, which is what lets the sub-oscillator take
 * the same call: an octave below the target, gliding from an octave below the
 * origin, is one ratio applied to one number.
 */
function startPitch(param: AudioParam, hz: number, glide: SynthGlide | null, when: number): void {
  if (!glide) {
    // No automation at all where there is no glide, so a patch that has never
    // touched portamento assigns the frequency exactly as it always did.
    param.value = hz;
    return;
  }
  param.setValueAtTime(hz * (glide.fromHz / glide.toHz), when);
  param.exponentialRampToValueAtTime(hz, when + glide.seconds);
}

class Voice {
  readonly handle: ActiveHandle;
  private osc: OscillatorNode;
  /**
   * The sub-oscillator and the LFO. They are started and stopped with the main
   * oscillator rather than left to their own devices: an LFO that outlives its
   * voice is a modulator running into a disconnected graph for the rest of the
   * session, and 24 of those is a measurable cost for silence.
   */
  private extraOscs: OscillatorNode[] = [];
  /** The delay line, its inverting gain, and the modulator's depth gains. */
  private extraNodes: AudioNode[] = [];
  private filter: BiquadFilterNode;
  private amp: GainNode;
  private ended = false;
  released = false;
  readonly startedAt: number;
  /**
   * When this voice's oscillator is scheduled to stop, or Infinity while it is
   * still being held. `PolySynth` retires voices by this rather than by
   * `onended`, which offline has not run for anything yet.
   */
  endsAt = Infinity;

  constructor(
    private ctx: BaseAudioContext,
    out: AudioNode,
    params: SynthParams,
    readonly pitch: number,
    velocity: number,
    when: number,
    private onEnd: (v: Voice) => void,
    trackId: string,
    clipId?: string,
    /** The pitch this note glides from, or null to start on its own. */
    glideFrom: number | null = null,
  ) {
    this.startedAt = when;
    const freqHz = midiToFreq(pitch);
    const glide = synthGlideOf(params, glideFrom, pitch);
    const oscillator = synthOscillatorOf(params);
    const lfo = synthLfoOf(params, pitch);

    this.osc = ctx.createOscillator();
    this.osc.type = oscillator.type;
    startPitch(this.osc.frequency, freqHz, glide, when);
    this.filter = ctx.createBiquadFilter();
    // Key tracking, and the clamps, come from the descriptor the face draws
    // from — computing them a second time here is exactly the divergence
    // `model/synthFace.ts` exists to make impossible.
    const voiceFilter = synthVoiceFilter(params, pitch);
    this.filter.type = voiceFilter.type;
    this.filter.frequency.value = voiceFilter.freqHz;
    this.filter.Q.value = voiceFilter.qDb;

    /*
     * The pulse: this oscillator, minus a delayed copy of itself.
     *
     * A saw delayed half a cycle and subtracted is a square; delayed less it is
     * a narrower pulse; subtracted at less than full it is a saw with a notch.
     * So `shape` sweeps saw→square continuously and `pulseWidth` sets the duty,
     * out of one oscillator and one delay line — and because the delay is an
     * AudioParam, the LFO below can sweep the width, which nothing built from a
     * PeriodicWave could do.
     */
    let morphDelay: DelayNode | null = null;
    if (oscillator.morph) {
      // The delay never exceeds one cycle (the width and its sweep are clamped
      // well inside one), so a cycle of capacity is all this ever needs; the
      // floor keeps the top of the keyboard from asking for a buffer of a
      // handful of samples.
      morphDelay = ctx.createDelay(Math.max(0.002, 1 / freqHz));
      const delaySec = synthMorphDelaySec(oscillator, freqHz);
      if (glide) {
        // Delay is cycles over frequency, so gliding it as the reciprocal of
        // the pitch ramp holds the duty *constant* through the glide. Left
        // fixed, a note gliding an octave would arrive with half the pulse
        // width it started with.
        morphDelay.delayTime.setValueAtTime((delaySec * glide.toHz) / glide.fromHz, when);
        morphDelay.delayTime.exponentialRampToValueAtTime(delaySec, when + glide.seconds);
      } else {
        morphDelay.delayTime.value = delaySec;
      }
      const morphGain = ctx.createGain();
      morphGain.gain.value = -oscillator.morph.shape;
      this.osc.connect(morphDelay);
      morphDelay.connect(morphGain);
      morphGain.connect(this.filter);
      this.extraNodes.push(morphDelay, morphGain);
    }

    // The sub sits in front of the filter with the oscillator it doubles, so
    // the cutoff shapes the whole voice and not just its top half.
    const sub = synthSubOf(params, pitch);
    let subOsc: OscillatorNode | null = null;
    if (sub) {
      subOsc = ctx.createOscillator();
      subOsc.type = SYNTH_SUB_WAVE;
      startPitch(subOsc.frequency, sub.freqHz, glide, when);
      const subGain = ctx.createGain();
      subGain.gain.value = sub.gain;
      subOsc.connect(subGain);
      subGain.connect(this.filter);
      this.extraOscs.push(subOsc);
      this.extraNodes.push(subGain);
    }

    if (lfo) {
      const mod = ctx.createOscillator();
      mod.frequency.value = lfo.rateHz;
      this.extraOscs.push(mod);
      // One depth gain per destination, and none for a destination at zero:
      // the depth a face reports is the gain a node holds, and a routing that
      // reaches nothing does not exist in the graph either.
      if (lfo.toPitchCents > 0) {
        const g = ctx.createGain();
        g.gain.value = lfo.toPitchCents;
        mod.connect(g);
        // Cents, so the sub keeps its exact octave while both are bent.
        g.connect(this.osc.detune);
        if (subOsc) g.connect(subOsc.detune);
        this.extraNodes.push(g);
      }
      if (lfo.toFilterHz > 0) {
        const g = ctx.createGain();
        g.gain.value = lfo.toFilterHz;
        mod.connect(g);
        g.connect(this.filter.frequency);
        this.extraNodes.push(g);
      }
      if (lfo.toWidthDuty > 0 && morphDelay) {
        const g = ctx.createGain();
        // Duty is a fraction of a cycle; the delay wants seconds, and one
        // cycle is 1/f of them.
        g.gain.value = lfo.toWidthDuty / freqHz;
        mod.connect(g);
        g.connect(morphDelay.delayTime);
        this.extraNodes.push(g);
      }
    }

    this.amp = ctx.createGain();
    const peak = clamp(params.volume, 0, 1) * Math.pow(velocity / 127, 1.4) * 0.5;
    const g = this.amp.gain;
    g.setValueAtTime(0, when);
    g.linearRampToValueAtTime(peak, when + Math.max(0.002, params.attack));
    g.setTargetAtTime(
      peak * clamp(params.sustain, 0, 1),
      when + Math.max(0.002, params.attack),
      Math.max(0.01, params.decay) / 3,
    );
    this.osc.connect(this.filter);
    this.filter.connect(this.amp);
    this.amp.connect(out);
    this.osc.onended = () => {
      if (this.ended) return;
      this.ended = true;
      try {
        this.osc.disconnect();
        this.filter.disconnect();
        this.amp.disconnect();
        for (const n of this.extraNodes) n.disconnect();
        for (const o of this.extraOscs) o.disconnect();
      } catch {}
      this.onEnd(this);
    };
    // Every oscillator this voice owns starts on the same sample, which is what
    // makes the delayed copy line up with the original and the sub sit exactly
    // an octave under it.
    this.osc.start(when);
    for (const o of this.extraOscs) o.start(when);
    this.releaseTau = Math.max(0.01, params.release) / 3;
    this.handle = { kind: 'voice', trackId, clipId, stop: (hard, at) => this.stopNow(hard, at) };
  }

  private releaseTau: number;

  release(at: number): void {
    if (this.ended) return;
    this.released = true;
    this.amp.gain.setTargetAtTime(0, at, this.releaseTau);
    const end = at + this.releaseTau * 6 + 0.05;
    if (end < this.endsAt) this.endsAt = end;
    this.stopSources(end);
  }

  /**
   * Cut this voice short.
   *
   * `at` is when the cut should happen — voice stealing passes the moment the
   * stealing voice starts. Defaulting to `ctx.currentTime` is right live and
   * catastrophic offline, where currentTime stays 0 while the whole song is
   * being scheduled: a steal would silence a voice that had not started yet,
   * and the bounce would be missing notes the live playback had.
   */
  stopNow(hard?: boolean, at?: number): void {
    if (this.ended) return;
    this.released = true;
    // Never schedule a stop before this voice's own start.
    const t = Math.max(at ?? this.ctx.currentTime, this.startedAt);
    const tau = hard ? 0.005 : 0.02;
    this.amp.gain.cancelScheduledValues(t);
    this.amp.gain.setTargetAtTime(0, t, tau);
    const end = t + tau * 6 + 0.02;
    if (end < this.endsAt) this.endsAt = end;
    this.stopSources(end);
  }

  /**
   * Stop every oscillator this voice owns at the same moment.
   *
   * Only the main one carries `onended`, so it is the one that retires the
   * voice; the sub and the modulator have to be told separately or they keep
   * running with nothing listening.
   */
  private stopSources(end: number): void {
    for (const o of [this.osc, ...this.extraOscs]) {
      try {
        o.stop(end);
      } catch {}
    }
  }
}

export class PolySynth implements Instrument {
  private voices = new Set<Voice>();
  private live = new Map<number, Voice>();
  private sustain = false;
  private sustained = new Set<Voice>();
  /**
   * The note a portamento glides from, per source of notes: one entry per clip
   * and one shared entry for the keyboard.
   *
   * Per clip, because a glide is the only thing this instrument remembers
   * between notes and the two schedulers do not hand it its notes in the same
   * order. The bounce walks `project.clips` and empties each one before moving
   * to the next; playback walks a lookahead window across all of them. Ordered
   * by clip, both paths agree — every clip's own notes arrive in time order in
   * both — where a single "last note played" would glide from a different note
   * in a bounce than it did through the speakers on any track holding more than
   * one clip. That difference is the kind a musician only ever finds in the
   * exported file.
   */
  private lastNote = new Map<string, { pitch: number; at: number }>();

  constructor(
    private ctx: BaseAudioContext,
    private out: AudioNode,
    private trackId: string,
    private getParams: () => SynthParams,
    private registry: SourceRegistry,
  ) {}

  /**
   * The pitch a note starting at `when` glides from, and the record of this one
   * for the note after it.
   *
   * A note scheduled *before* one already recorded neither glides nor becomes
   * the origin: note effects can emit out of order, and a glide that ran
   * backwards through a phrase would be neither what was played nor repeatable.
   */
  private glideOrigin(pitch: number, when: number, clipId?: string): number | null {
    const key = clipId ?? '';
    const previous = this.lastNote.get(key);
    if (previous && when < previous.at) return null;
    this.lastNote.set(key, { pitch, at: when });
    return previous?.pitch ?? null;
  }

  private spawn(pitch: number, velocity: number, when: number, clipId?: string): Voice | null {
    if (!this.registry.canAllocate()) return null;
    this.retireBy(when);
    if (this.voices.size >= MAX_VOICES) {
      // steal the oldest voice
      let oldest: Voice | null = null;
      for (const v of this.voices) if (!oldest || v.startedAt < oldest.startedAt) oldest = v;
      oldest?.stopNow(true, when);
    }
    const v = new Voice(
      this.ctx,
      this.out,
      this.getParams(),
      pitch,
      velocity,
      when,
      (voice) => {
        this.voices.delete(voice);
        this.sustained.delete(voice);
        if (this.live.get(voice.pitch) === voice) this.live.delete(voice.pitch);
        this.registry.unregister(voice.handle);
      },
      this.trackId,
      clipId,
      this.glideOrigin(pitch, when, clipId),
    );
    this.voices.add(v);
    this.registry.register(v.handle);
    return v;
  }

  /**
   * Forget every voice that has finished by `when`.
   *
   * `when` rather than `ctx.currentTime` because the clock that matters is the
   * one the notes are scheduled on: an offline render schedules the whole song
   * synchronously, so no `onended` can fire, `currentTime` stays at 0 and the
   * voice set would only ever grow. Left alone, every note past the 24th steals
   * voice 1 — a held pad rings out live and is cut mid-note in the bounce.
   */
  private retireBy(when: number): void {
    for (const v of this.voices) if (v.endsAt <= when) this.voices.delete(v);
  }

  scheduleNote(
    pitch: number,
    velocity: number,
    when: number,
    durSec: number,
    clipId?: string,
  ): void {
    const v = this.spawn(pitch, velocity, when, clipId);
    v?.release(when + Math.max(0.02, durSec));
  }

  noteOn(pitch: number, velocity: number): void {
    const existing = this.live.get(pitch);
    if (existing) existing.release(this.ctx.currentTime);
    const v = this.spawn(pitch, velocity, this.ctx.currentTime);
    if (v) this.live.set(pitch, v);
  }

  noteOff(pitch: number): void {
    const v = this.live.get(pitch);
    if (!v) return;
    this.live.delete(pitch);
    if (this.sustain) this.sustained.add(v);
    else v.release(this.ctx.currentTime);
  }

  setSustain(on: boolean): void {
    this.sustain = on;
    if (!on) {
      for (const v of this.sustained) v.release(this.ctx.currentTime);
      this.sustained.clear();
    }
  }

  allNotesOff(): void {
    for (const v of [...this.voices]) v.stopNow();
    this.live.clear();
    this.sustained.clear();
    // A panic, a transport stop or a track rebuild ends the phrase: the next
    // note starts on its own pitch rather than sliding in from whatever was
    // playing before everything was cut.
    this.lastNote.clear();
  }

  dispose(): void {
    this.allNotesOff();
  }
}

/** Sample-based drum kit (kick/snare/clap/hats) sharing the Instrument interface. */
export class DrumKit implements Instrument {
  private active = new Set<{ src: AudioBufferSourceNode; g: GainNode; handle: ActiveHandle }>();

  constructor(
    private ctx: BaseAudioContext,
    private out: AudioNode,
    private trackId: string,
    private getParams: () => SynthParams,
    private registry: SourceRegistry,
  ) {}

  private trigger(pitch: number, velocity: number, when: number, clipId?: string): void {
    if (!this.registry.canAllocate()) return;
    const buffer = getDrumBuffer(pitch);
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    const g = this.ctx.createGain();
    g.gain.value = clamp(this.getParams().volume, 0, 1) * Math.pow(velocity / 127, 1.3);
    src.connect(g);
    g.connect(this.out);
    const entry = {
      src,
      g,
      handle: {
        kind: 'buffer' as const,
        trackId: this.trackId,
        clipId,
        stop: (hard?: boolean, at?: number) => {
          const t = Math.max(this.ctx.currentTime, at ?? this.ctx.currentTime);
          g.gain.setTargetAtTime(0, t, hard ? 0.004 : 0.015);
          try {
            src.stop(t + 0.06);
          } catch {}
        },
      },
    };
    src.onended = () => {
      this.active.delete(entry);
      this.registry.unregister(entry.handle);
      try {
        src.disconnect();
        g.disconnect();
      } catch {}
    };
    this.active.add(entry);
    this.registry.register(entry.handle);
    src.start(when);
  }

  scheduleNote(
    pitch: number,
    velocity: number,
    when: number,
    _durSec: number,
    clipId?: string,
  ): void {
    this.trigger(pitch, velocity, when, clipId);
  }

  noteOn(pitch: number, velocity: number): void {
    this.trigger(pitch, velocity, this.ctx.currentTime);
  }

  noteOff(): void {
    // one-shots — nothing to do
  }

  setSustain(): void {}

  allNotesOff(): void {
    for (const e of [...this.active]) e.handle.stop(true);
  }

  dispose(): void {
    this.allNotesOff();
  }
}
